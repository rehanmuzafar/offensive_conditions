// Package service implements the flag verification flow.
//
// The flow:
//
//  1. Rate limit check (user×content, user×global, ip×global)
//  2. Idempotency cache lookup (60s replay window)
//  3. Parse flag string → extract HMAC, slug, user_short
//  4. Look up instance (verify the user owns it)
//  5. Fetch HMAC secret from Vault/cache
//  6. Compute expected HMAC and constant-time compare
//  7. Persist submission row (accepted or rejected)
//  8. Emit Kafka event (correct or incorrect)
//  9. Cache the result for idempotency
//
// Every error path still persists a submission row for audit.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/flag-verifier/internal/config"
	scoringerrors "github.com/offensive-conditions/flag-verifier/internal/errors"
	hmacpkg "github.com/offensive-conditions/flag-verifier/internal/hmac"
	"github.com/offensive-conditions/flag-verifier/internal/idempotency"
	"github.com/offensive-conditions/flag-verifier/internal/producers"
	"github.com/offensive-conditions/flag-verifier/internal/ratelimit"
	"github.com/offensive-conditions/flag-verifier/internal/repository"
	"github.com/offensive-conditions/flag-verifier/internal/secrets"
)

type Verifier struct {
	cfg          *config.Config
	log          zerolog.Logger
	parser       *hmacpkg.Parser
	hmacVerifier *hmacpkg.Verifier
	rateLimit    *ratelimit.Limiter
	idemCache    *idempotency.Cache
	secrets      secrets.Store
	publisher    EventPublisher

	submissions repository.SubmissionRepository
	owns        repository.OwnsLookup
	instances   repository.InstanceLookup
	machines    repository.MachineLookup
}

// EventPublisher is the Kafka write side; abstracted for tests.
type EventPublisher interface {
	PublishCorrect(ctx context.Context, userID uuid.UUID, instanceID *uuid.UUID, machineID *uuid.UUID, data producers.CorrectFlagData, requestID string) error
	PublishIncorrect(ctx context.Context, userID uuid.UUID, instanceID *uuid.UUID, data producers.IncorrectFlagData, requestID string) error
}

type Deps struct {
	Cfg          *config.Config
	Log          zerolog.Logger
	Parser       *hmacpkg.Parser
	HMACVerifier *hmacpkg.Verifier
	RateLimit    *ratelimit.Limiter
	IdemCache    *idempotency.Cache
	Secrets      secrets.Store
	Publisher    EventPublisher
	Submissions  repository.SubmissionRepository
	Owns         repository.OwnsLookup
	Instances    repository.InstanceLookup
	Machines     repository.MachineLookup
}

func New(d Deps) *Verifier {
	return &Verifier{
		cfg: d.Cfg, log: d.Log,
		parser: d.Parser, hmacVerifier: d.HMACVerifier,
		rateLimit: d.RateLimit, idemCache: d.IdemCache,
		secrets: d.Secrets, publisher: d.Publisher,
		submissions: d.Submissions, owns: d.Owns,
		instances: d.Instances, machines: d.Machines,
	}
}

// =============================================================================
// SubmitFlag — main entry point from the HTTP handler
// =============================================================================

type SubmitInput struct {
	UserID      uuid.UUID
	ContentType string
	ContentID   uuid.UUID
	InstanceID  *uuid.UUID // optional for static challenges
	Flag        string
	IPAddress   string
	UserAgent   string
	RequestID   string
}

type SubmitResult struct {
	Accepted        bool
	SubmissionID    uuid.UUID
	FlagType        string
	IsFirstBlood    bool
	BloodRank       int
	RejectionReason string
	SecondsToSolve  int
	Message         string
	FromCache       bool
}

func (v *Verifier) SubmitFlag(ctx context.Context, in SubmitInput) (*SubmitResult, *scoringerrors.Error) {
	log := v.log.With().
		Str("user_id", in.UserID.String()).
		Str("content_type", in.ContentType).
		Str("content_id", in.ContentID.String()).
		Str("request_id", in.RequestID).
		Logger()

	startedAt := time.Now()

	// 1. Rate limit
	if v.rateLimit != nil {
		decision, err := v.rateLimit.CheckAll(ctx, in.UserID, in.ContentID, in.IPAddress)
		if err != nil {
			log.Warn().Err(err).Msg("rate limiter failed; allowing through")
		} else if !decision.Allowed {
			log.Info().
				Str("bucket", decision.Bucket).
				Int("retry_after", decision.RetryAfterSec).
				Msg("rate limited")
			return nil, scoringerrors.New(scoringerrors.CodeRateLimited,
				fmt.Sprintf("rate limit hit: %s", decision.Bucket)).
				WithRetryAfter(decision.RetryAfterSec)
		}
	}

	// 2. Idempotency cache
	if cached, hit, err := v.idemCache.Get(ctx, in.UserID, in.ContentID, in.Flag); err == nil && hit {
		log.Debug().Bool("accepted", cached.Accepted).Msg("idempotency cache hit")
		return &SubmitResult{
			Accepted:        cached.Accepted,
			SubmissionID:    cached.SubmissionID,
			FlagType:        cached.FlagType,
			IsFirstBlood:    cached.IsFirstBlood,
			BloodRank:       cached.BloodRank,
			RejectionReason: cached.RejectionReason,
			Message:         cached.Message,
			FromCache:       true,
		}, nil
	}

	// 3. Parse the flag
	parsed, perr := v.parser.Parse(in.Flag)
	if perr != nil {
		log.Debug().Err(perr).Msg("malformed flag")
		return v.recordRejection(ctx, in, "malformed_flag", "", "Flag format is invalid.")
	}

	// 4. Verify the user owns the instance (if instance-based content)
	var instance *repository.InstanceSummary
	if in.InstanceID != nil && *in.InstanceID != uuid.Nil {
		inst, err := v.instances.GetInstance(ctx, *in.InstanceID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				return nil, scoringerrors.New(scoringerrors.CodeInstanceNotFound, "instance not found")
			}
			return nil, scoringerrors.Internal(err)
		}
		if inst.UserID != in.UserID {
			log.Warn().
				Str("instance_owner", inst.UserID.String()).
				Msg("instance ownership mismatch")
			return v.recordRejection(ctx, in, "instance_not_owned", "",
				"You don't own this instance.")
		}
		if inst.State == "stopped" {
			return v.recordRejection(ctx, in, "expired_instance", "",
				"Instance has expired.")
		}
		instance = inst
	}

	// 5. Determine machine metadata + flag type
	machineID := in.ContentID
	if instance != nil {
		machineID = instance.MachineID
	}
	machine, err := v.machines.GetMachine(ctx, machineID)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return nil, scoringerrors.Internal(err)
	}

	// 6. Fetch HMAC secret
	secret, err := v.secrets.GetSecret(ctx, machineID.String())
	if err != nil {
		if errors.Is(err, secrets.ErrSecretNotFound) {
			log.Error().Str("machine_id", machineID.String()).Msg("HMAC secret missing in vault")
			return nil, scoringerrors.New(scoringerrors.CodeSecretUnavailable,
				"flag verification temporarily unavailable")
		}
		return nil, scoringerrors.Internal(err)
	}

	// 7. HMAC verify
	expectedInstanceID := uuid.Nil
	if instance != nil {
		expectedInstanceID = instance.InstanceID
	}
	res := v.hmacVerifier.Verify(hmacpkg.VerifyInput{
		Flag:       parsed,
		Secret:     secret,
		UserID:     in.UserID,
		ContentID:  machineID,
		InstanceID: expectedInstanceID,
	})

	if !res.Valid {
		log.Debug().Str("reason", res.Reason).Msg("hmac mismatch")
		return v.recordRejection(ctx, in, "wrong_flag", "",
			"Incorrect flag.")
	}

	// 8. Determine flag_type — for user/root we infer from which HMAC matches
	flagType := inferFlagType(parsed.Slug, machine)

	// 9. Idempotency check: already owned?
	if alreadyOwned, _ := v.owns.HasOwned(ctx, in.UserID, in.ContentType, in.ContentID, flagType); alreadyOwned {
		log.Info().Msg("flag already owned; idempotent success")
		result := &SubmitResult{
			Accepted:     true,
			SubmissionID: uuid.New(),
			FlagType:     flagType,
			Message:      "You've already solved this flag.",
		}
		_ = v.idemCache.Put(ctx, in.UserID, in.ContentID, in.Flag, idempotency.CachedResult{
			SubmissionID: result.SubmissionID,
			Accepted:     true,
			FlagType:     flagType,
			Message:      result.Message,
		})
		return result, nil
	}

	// 10. Compute blood rank
	priorSolvers, _ := v.owns.CountSolversForContent(ctx, in.ContentType, in.ContentID, flagType)
	bloodRank := 0
	if priorSolvers < 3 {
		bloodRank = priorSolvers + 1
	}

	// 11. Persist submission
	flagHash := hashFlag(in.Flag)
	submissionID := uuid.New()
	secondsSinceSpawn := 0
	if instance != nil {
		secondsSinceSpawn = int(time.Since(instance.SpawnedAt).Seconds())
	}

	ipAddr := parseIP(in.IPAddress)
	if err := v.submissions.Insert(ctx, &repository.Submission{
		ID:                submissionID,
		UserID:            in.UserID,
		ContentType:       in.ContentType,
		ContentID:         in.ContentID,
		InstanceID:        in.InstanceID,
		FlagType:          flagType,
		SubmittedValue:    flagHash,
		Accepted:          true,
		PointsAwarded:     0, // scoring service will compute and update
		IsFirstBlood:      bloodRank > 0 && bloodRank <= 3,
		BloodRank:         bloodRank,
		IPAddress:         ipAddr,
		UserAgent:         in.UserAgent,
		ResponseTimeMS:    int(time.Since(startedAt).Milliseconds()),
		SecondsSinceSpawn: secondsSinceSpawn,
		SubmittedAt:       time.Now().UTC(),
	}); err != nil {
		log.Error().Err(err).Msg("submission insert failed")
		return nil, scoringerrors.Internal(err)
	}

	// 12. Emit Kafka event
	slug := ""
	if machine != nil {
		slug = machine.Slug
	}
	if err := v.publisher.PublishCorrect(ctx, in.UserID, in.InstanceID, &machineID, producers.CorrectFlagData{
		FlagType:       flagType,
		ContentType:    in.ContentType,
		ContentID:      in.ContentID,
		MachineSlug:    slug,
		SecondsToSolve: secondsSinceSpawn,
		IPAddress:      in.IPAddress,
		FlagHash:       flagHash,
		SubmissionID:   submissionID,
		IsFirstBlood:   bloodRank > 0 && bloodRank <= 3,
		BloodRank:      bloodRank,
	}, in.RequestID); err != nil {
		log.Warn().Err(err).Msg("publish kafka event failed (submission already persisted)")
		// We do NOT fail the request — scoring service can be re-run from submissions table
	}

	message := "Flag accepted! Points will be awarded shortly."
	if bloodRank == 1 {
		message = "First blood! 🩸 You're the first to solve this."
	} else if bloodRank == 2 {
		message = "Second blood! Congrats."
	} else if bloodRank == 3 {
		message = "Third blood! Nice."
	}

	result := &SubmitResult{
		Accepted:       true,
		SubmissionID:   submissionID,
		FlagType:       flagType,
		IsFirstBlood:   bloodRank > 0 && bloodRank <= 3,
		BloodRank:      bloodRank,
		SecondsToSolve: secondsSinceSpawn,
		Message:        message,
	}

	_ = v.idemCache.Put(ctx, in.UserID, in.ContentID, in.Flag, idempotency.CachedResult{
		SubmissionID: submissionID,
		Accepted:     true,
		FlagType:     flagType,
		IsFirstBlood: result.IsFirstBlood,
		BloodRank:    bloodRank,
		Message:      message,
	})

	log.Info().
		Str("submission_id", submissionID.String()).
		Str("flag_type", flagType).
		Int("blood_rank", bloodRank).
		Msg("flag accepted")
	return result, nil
}

// recordRejection persists a failed submission and emits an incorrect event.
// Common path for: malformed flag, wrong HMAC, instance not owned, etc.
func (v *Verifier) recordRejection(ctx context.Context, in SubmitInput, reason, flagType, message string) (*SubmitResult, *scoringerrors.Error) {
	submissionID := uuid.New()
	flagHash := hashFlag(in.Flag)

	_ = v.submissions.Insert(ctx, &repository.Submission{
		ID:              submissionID,
		UserID:          in.UserID,
		ContentType:     in.ContentType,
		ContentID:       in.ContentID,
		InstanceID:      in.InstanceID,
		FlagType:        flagType,
		SubmittedValue:  flagHash,
		Accepted:        false,
		RejectionReason: reason,
		IPAddress:       parseIP(in.IPAddress),
		UserAgent:       in.UserAgent,
		SubmittedAt:     time.Now().UTC(),
	})

	_ = v.publisher.PublishIncorrect(ctx, in.UserID, in.InstanceID, producers.IncorrectFlagData{
		ContentType:     in.ContentType,
		ContentID:       in.ContentID,
		IPAddress:       in.IPAddress,
		SubmissionID:    submissionID,
		RejectionReason: reason,
		FlagHashPrefix:  flagHash[:min(12, len(flagHash))],
	}, in.RequestID)

	if message == "" {
		message = "Submission rejected."
	}

	result := &SubmitResult{
		Accepted:        false,
		SubmissionID:    submissionID,
		RejectionReason: reason,
		Message:         message,
	}
	_ = v.idemCache.Put(ctx, in.UserID, in.ContentID, in.Flag, idempotency.CachedResult{
		SubmissionID:    submissionID,
		Accepted:        false,
		RejectionReason: reason,
		Message:         message,
	})
	return result, nil
}

// =============================================================================
// History queries
// =============================================================================

func (v *Verifier) ListHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*repository.Submission, error) {
	return v.submissions.ListByUser(ctx, userID, limit, offset)
}

// =============================================================================
// Helpers
// =============================================================================

// inferFlagType picks user|root|challenge based on machine metadata.
// For v1, we default to "root" for machines with root flags, "challenge" for
// single-flag content. A more sophisticated version would inspect the slug.
func inferFlagType(_ string, m *repository.MachineSummary) string {
	if m == nil {
		return "root"
	}
	if m.HasRootFlag {
		return m.UserFlagType
	}
	return "challenge"
}

// hashFlag returns a SHA-256 hex of the flag. We never store the raw flag.
func hashFlag(flag string) string {
	h := sha256.Sum256([]byte(flag))
	return hex.EncodeToString(h[:])
}

func parseIP(s string) netip.Addr {
	if s == "" {
		return netip.Addr{}
	}
	addr, _ := netip.ParseAddr(s)
	return addr
}
