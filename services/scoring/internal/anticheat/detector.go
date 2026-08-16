// Package anticheat detects suspicious solve patterns.
//
// Three detectors run on every successful submission:
//
//  1. SpeedCheck — solve time below MinSolveSeconds is suspicious
//  2. SharedFlagCheck — same flag submitted by multiple users (impossible
//     given our per-user HMAC flags; if it happens, either two accounts are
//     sharing or the flag generator was compromised)
//  3. IPChangeCheck — user submits from a wildly different IP than last solve
//
// All detections produce a CheatFlag row (status=pending) for admin review.
// Confidence scores guide auto-action: critical may auto-revoke points;
// lower severities just warn.
package anticheat

import (
	"context"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/scoring/internal/repository"
)

type Detector struct {
	log         zerolog.Logger
	cheatFlags  repository.CheatFlagRepository
	submissions repository.SubmissionRepository

	// Tunables
	enableSpeed       bool
	minSolveSeconds   int
	enableSharedFlag  bool
	enableIPChange    bool
	ipChangeWindow    time.Duration
}

type Deps struct {
	Log         zerolog.Logger
	CheatFlags  repository.CheatFlagRepository
	Submissions repository.SubmissionRepository
}

type Config struct {
	EnableSpeed      bool
	MinSolveSeconds  int
	EnableSharedFlag bool
	EnableIPChange   bool
	IPChangeWindow   time.Duration
}

func NewDetector(d Deps, cfg Config) *Detector {
	if cfg.MinSolveSeconds <= 0 {
		cfg.MinSolveSeconds = 60
	}
	if cfg.IPChangeWindow == 0 {
		cfg.IPChangeWindow = 4 * time.Hour
	}
	return &Detector{
		log: d.Log, cheatFlags: d.CheatFlags, submissions: d.Submissions,
		enableSpeed:      cfg.EnableSpeed,
		minSolveSeconds:  cfg.MinSolveSeconds,
		enableSharedFlag: cfg.EnableSharedFlag,
		enableIPChange:   cfg.EnableIPChange,
		ipChangeWindow:   cfg.IPChangeWindow,
	}
}

// CheckInput is everything the detector needs about the new submission.
type CheckInput struct {
	UserID          uuid.UUID
	SubmissionID    uuid.UUID
	ContentType     string
	ContentID       uuid.UUID
	FlagType        string
	SubmittedHash   string // SHA-256 hash, used to detect shared flags
	SecondsToSolve  int    // since instance spawn / content release
	IPAddress       netip.Addr
	UserAgent       string
	SubmittedAt     time.Time
}

// Result captures all suspicious patterns detected.
type Result struct {
	Suspicions     []Suspicion
	HighestSeverity repository.CheatFlagSeverity
	ShouldBlock    bool // true if the submission should be rejected outright
}

type Suspicion struct {
	Type     string                            // matches DB enum
	Severity repository.CheatFlagSeverity
	Score    float64                            // 0..100
	Evidence map[string]any
}

// Check runs all enabled detectors and returns a unified result.
func (d *Detector) Check(ctx context.Context, in CheckInput) Result {
	res := Result{}

	if d.enableSpeed {
		if s := d.checkSpeed(in); s != nil {
			res.Suspicions = append(res.Suspicions, *s)
		}
	}
	if d.enableSharedFlag {
		if s := d.checkSharedFlag(ctx, in); s != nil {
			res.Suspicions = append(res.Suspicions, *s)
		}
	}
	if d.enableIPChange {
		if s := d.checkIPChange(ctx, in); s != nil {
			res.Suspicions = append(res.Suspicions, *s)
		}
	}

	res.HighestSeverity = highestSeverity(res.Suspicions)

	// Auto-block on critical (e.g. truly shared flags)
	for _, s := range res.Suspicions {
		if s.Severity == repository.SeverityCritical && s.Score >= 95 {
			res.ShouldBlock = true
			break
		}
	}

	return res
}

// RecordSuspicions persists the suspicions to the cheat_flags table for review.
// Should be called even if ShouldBlock is true (to audit the block).
func (d *Detector) RecordSuspicions(ctx context.Context, in CheckInput, res Result) error {
	for _, s := range res.Suspicions {
		flag := &repository.CheatFlag{
			UserID:        in.UserID,
			FlagType:      s.Type,
			Severity:      s.Severity,
			Confidence:    s.Score,
			Evidence:      s.Evidence,
			SubmissionIDs: []uuid.UUID{in.SubmissionID},
			Status:        "pending",
		}
		if err := d.cheatFlags.Insert(ctx, flag); err != nil {
			d.log.Error().Err(err).Str("type", s.Type).Msg("insert cheat flag failed")
		}
	}
	return nil
}

// =============================================================================
// Detectors
// =============================================================================

func (d *Detector) checkSpeed(in CheckInput) *Suspicion {
	if in.SecondsToSolve <= 0 {
		return nil
	}
	if in.SecondsToSolve >= d.minSolveSeconds {
		return nil
	}

	severity := repository.SeverityMedium
	score := 75.0
	if in.SecondsToSolve < d.minSolveSeconds/4 {
		severity = repository.SeverityHigh
		score = 90.0
	}
	if in.SecondsToSolve < 5 {
		severity = repository.SeverityCritical
		score = 99.0
	}

	return &Suspicion{
		Type:     "impossible_speed",
		Severity: severity,
		Score:    score,
		Evidence: map[string]any{
			"seconds_to_solve":  in.SecondsToSolve,
			"min_threshold":     d.minSolveSeconds,
			"content_type":      in.ContentType,
			"content_id":        in.ContentID.String(),
		},
	}
}

func (d *Detector) checkSharedFlag(ctx context.Context, in CheckInput) *Suspicion {
	// Our flags are per-user HMAC, so the same submitted_value should never
	// match between users. If it does, either two users have shared the raw
	// flag (extremely suspicious — flag was leaked to a different user's
	// machine) or the flag generator has been compromised.
	other, err := d.submissions.FindOtherUsersWithSameFlag(ctx, in.ContentType, in.ContentID, in.SubmittedHash, in.UserID)
	if err != nil {
		d.log.Warn().Err(err).Msg("shared flag check query failed")
		return nil
	}
	if len(other) == 0 {
		return nil
	}

	return &Suspicion{
		Type:     "shared_flag",
		Severity: repository.SeverityCritical,
		Score:    99.0,
		Evidence: map[string]any{
			"content_type":     in.ContentType,
			"content_id":       in.ContentID.String(),
			"other_users":      stringifyIDs(other),
			"flag_hash_prefix": shortHash(in.SubmittedHash),
		},
	}
}

func (d *Detector) checkIPChange(ctx context.Context, in CheckInput) *Suspicion {
	if !in.IPAddress.IsValid() {
		return nil
	}

	// Look at user's recent submissions
	recent, err := d.submissions.ListByUser(ctx, in.UserID, 20, 0)
	if err != nil {
		return nil
	}

	cutoff := in.SubmittedAt.Add(-d.ipChangeWindow)
	for _, s := range recent {
		if s.SubmittedAt.Before(cutoff) {
			continue
		}
		if !s.IPAddress.IsValid() {
			continue
		}
		if s.ID == in.SubmissionID {
			continue
		}
		// Check if /24 differs (same subnet → fine; cross-country jumps are red flag)
		if differentSubnet(in.IPAddress, s.IPAddress) {
			return &Suspicion{
				Type:     "ip_change",
				Severity: repository.SeverityLow,
				Score:    40.0,
				Evidence: map[string]any{
					"new_ip":       in.IPAddress.String(),
					"recent_ip":    s.IPAddress.String(),
					"time_delta_s": int(in.SubmittedAt.Sub(s.SubmittedAt).Seconds()),
				},
			}
		}
	}
	return nil
}

// =============================================================================
// Helpers
// =============================================================================

func highestSeverity(suspicions []Suspicion) repository.CheatFlagSeverity {
	order := map[repository.CheatFlagSeverity]int{
		repository.SeverityLow: 1, repository.SeverityMedium: 2,
		repository.SeverityHigh: 3, repository.SeverityCritical: 4,
	}
	var highest repository.CheatFlagSeverity
	highestOrder := 0
	for _, s := range suspicions {
		if order[s.Severity] > highestOrder {
			highest = s.Severity
			highestOrder = order[s.Severity]
		}
	}
	return highest
}

func differentSubnet(a, b netip.Addr) bool {
	if !a.Is4() || !b.Is4() {
		return a != b
	}
	aBytes := a.As4()
	bBytes := b.As4()
	// Different /16 → red flag (cross-region jump)
	return aBytes[0] != bBytes[0] || aBytes[1] != bBytes[1]
}

func stringifyIDs(ids []uuid.UUID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out
}

func shortHash(h string) string {
	if len(h) > 12 {
		return h[:12]
	}
	return h
}
