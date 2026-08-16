// Package gdpr implements data export and right-to-erasure workflows.
package gdpr

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/user-svc/internal/config"
	uerrors "github.com/offensive-conditions/user-svc/internal/errors"
	"github.com/offensive-conditions/user-svc/internal/producers"
	"github.com/offensive-conditions/user-svc/internal/repository"
	"github.com/offensive-conditions/user-svc/internal/storage"
)

type Service struct {
	gdprRepo    repository.GDPRRepository
	profileRepo repository.ProfileRepository
	friendRepo  repository.FriendRepository
	followRepo  repository.FollowRepository
	teamRepo    repository.TeamRepository
	storage     *storage.Client
	publisher   *producers.Publisher
	pool        *pgxpool.Pool
	cfg         *config.Config
	log         zerolog.Logger
}

type Deps struct {
	GDPRRepo    repository.GDPRRepository
	ProfileRepo repository.ProfileRepository
	FriendRepo  repository.FriendRepository
	FollowRepo  repository.FollowRepository
	TeamRepo    repository.TeamRepository
	Storage     *storage.Client
	Publisher   *producers.Publisher
	Pool        *pgxpool.Pool
	Cfg         *config.Config
	Log         zerolog.Logger
}

func New(d Deps) *Service {
	return &Service{
		gdprRepo: d.GDPRRepo, profileRepo: d.ProfileRepo,
		friendRepo: d.FriendRepo, followRepo: d.FollowRepo,
		teamRepo: d.TeamRepo, storage: d.Storage,
		publisher: d.Publisher, pool: d.Pool,
		cfg: d.Cfg, log: d.Log,
	}
}

// =============================================================================
// Deletion
// =============================================================================

// RequestDeletion schedules account deletion grace period in the future.
// User retains the ability to cancel until processing begins.
func (s *Service) RequestDeletion(ctx context.Context, userID uuid.UUID, requestID string) error {
	// Reject if a pending request already exists
	existing, err := s.gdprRepo.GetDeletionRequest(ctx, userID)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return uerrors.Internal(err)
	}
	if existing != nil && existing.Status == "pending" {
		return uerrors.New(uerrors.CodeDeletionAlreadyPending, "deletion already scheduled")
	}

	scheduledAt := time.Now().Add(s.cfg.GDPR.DeletionGracePeriod)
	req := &repository.DeletionRequest{
		UserID:      userID,
		Status:      "pending",
		ScheduledAt: scheduledAt,
	}
	if err := s.gdprRepo.CreateDeletionRequest(ctx, req); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishDeletionRequested(ctx, userID, scheduledAt, requestID)
	}
	return nil
}

// CancelDeletion lets the user reverse a pending deletion request.
func (s *Service) CancelDeletion(ctx context.Context, userID uuid.UUID, requestID string) error {
	existing, err := s.gdprRepo.GetDeletionRequest(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return uerrors.New(uerrors.CodeDeletionNotPending, "no pending deletion to cancel")
		}
		return uerrors.Internal(err)
	}
	if existing.Status != "pending" {
		return uerrors.New(uerrors.CodeDeletionNotPending, "no pending deletion to cancel")
	}
	if err := s.gdprRepo.CancelDeletionRequest(ctx, userID); err != nil {
		return uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishDeletionCancelled(ctx, userID, requestID)
	}
	return nil
}

// GetDeletionStatus returns current deletion request status for the user.
func (s *Service) GetDeletionStatus(ctx context.Context, userID uuid.UUID) (*repository.DeletionRequest, error) {
	r, err := s.gdprRepo.GetDeletionRequest(ctx, userID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, nil // not having one is normal
		}
		return nil, uerrors.Internal(err)
	}
	return r, nil
}

// ProcessDueDeletions is called by the gdprjob cron.
// Returns the number of users processed.
func (s *Service) ProcessDueDeletions(ctx context.Context, limit int) (int, error) {
	due, err := s.gdprRepo.ListDueForDeletion(ctx, limit)
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, req := range due {
		if err := s.completeDeletion(ctx, req.UserID); err != nil {
			s.log.Error().Err(err).Str("user_id", req.UserID.String()).Msg("deletion failed")
			continue
		}
		processed++
	}
	return processed, nil
}

func (s *Service) completeDeletion(ctx context.Context, userID uuid.UUID) error {
	// Best-effort cleanup. We don't actually destroy the auth row from this service;
	// we emit user.deleted and the auth service handles its own row.
	// Here we scrub the profile and supporting tables under our ownership.

	// 1. Delete avatar from storage
	if existing, err := s.profileRepo.Get(ctx, userID); err == nil && existing.AvatarStorageKey != "" {
		if err := s.storage.DeleteAvatar(ctx, existing.AvatarStorageKey); err != nil {
			s.log.Warn().Err(err).Msg("storage delete on deletion failed")
		}
	}

	// 2. Delete the profile (PII scrub via Delete())
	if err := s.profileRepo.Delete(ctx, userID); err != nil {
		return fmt.Errorf("profile delete: %w", err)
	}

	// 3. Mark deletion complete
	if err := s.gdprRepo.CompleteDeletionRequest(ctx, userID); err != nil {
		return fmt.Errorf("mark complete: %w", err)
	}

	// 4. Emit event so other services can clean up
	if s.publisher != nil {
		if err := s.publisher.PublishUserDeleted(ctx, userID, ""); err != nil {
			s.log.Warn().Err(err).Msg("publish user.deleted failed")
		}
	}
	return nil
}

// =============================================================================
// Data export
// =============================================================================

// RequestExport creates a new export job; returns the export ID.
// Rate-limited to 1 active export per user.
func (s *Service) RequestExport(ctx context.Context, userID uuid.UUID, requestID string) (uuid.UUID, error) {
	// Prevent overlapping exports
	existing, err := s.gdprRepo.GetActiveExportForUser(ctx, userID)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return uuid.Nil, uerrors.Internal(err)
	}
	if existing != nil {
		return uuid.Nil, uerrors.New(uerrors.CodeExportInProgress, "an export is already in progress")
	}

	expID := uuid.New()
	exp := &repository.DataExport{
		ID:        expID,
		UserID:    userID,
		Status:    "pending",
		ExpiresAt: time.Now().Add(s.cfg.GDPR.ExportTTL),
	}
	if err := s.gdprRepo.CreateExport(ctx, exp); err != nil {
		return uuid.Nil, uerrors.Internal(err)
	}
	if s.publisher != nil {
		_ = s.publisher.PublishExportRequested(ctx, userID, expID, requestID)
	}
	return expID, nil
}

// GetExport returns export status; users can only see their own.
func (s *Service) GetExport(ctx context.Context, exportID, actorID uuid.UUID) (*repository.DataExport, string, error) {
	exp, err := s.gdprRepo.GetExport(ctx, exportID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, "", uerrors.New(uerrors.CodeNotFound, "export not found")
		}
		return nil, "", uerrors.Internal(err)
	}
	if exp.UserID != actorID {
		return nil, "", uerrors.New(uerrors.CodeForbidden, "not your export")
	}

	signedURL := ""
	if exp.Status == "completed" && exp.StorageKey != "" {
		url, err := s.storage.GetSignedExportURL(ctx, exp.StorageKey, s.cfg.GDPR.ExportSignedURLTTL)
		if err != nil {
			s.log.Warn().Err(err).Msg("sign export url failed")
		}
		signedURL = url
	}
	return exp, signedURL, nil
}

// ProcessPendingExports is called by the gdprjob cron. Builds the ZIP and uploads it.
func (s *Service) ProcessPendingExports(ctx context.Context, limit int) (int, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id FROM users.data_exports
		WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type job struct {
		ID, UserID uuid.UUID
	}
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.ID, &j.UserID); err != nil {
			return 0, err
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	processed := 0
	for _, j := range jobs {
		if err := s.processExport(ctx, j.ID, j.UserID); err != nil {
			s.log.Error().Err(err).Str("export_id", j.ID.String()).Msg("export processing failed")
			_ = s.gdprRepo.UpdateExportStatus(ctx, j.ID, "failed", "", err.Error(), 0)
			continue
		}
		processed++
	}
	return processed, nil
}

func (s *Service) processExport(ctx context.Context, exportID, userID uuid.UUID) error {
	if err := s.gdprRepo.UpdateExportStatus(ctx, exportID, "processing", "", "", 0); err != nil {
		return err
	}

	// Collect user data and assemble a ZIP
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)

	// Profile
	if profile, err := s.profileRepo.Get(ctx, userID); err == nil {
		if err := writeJSON(w, "profile.json", profile); err != nil {
			return err
		}
	}

	// Friendships
	if friendIDs, err := s.friendRepo.ListFriends(ctx, userID, 10000, 0); err == nil {
		if err := writeJSON(w, "friends.json", friendIDs); err != nil {
			return err
		}
	}

	// Followers / Following
	if followers, err := s.followRepo.ListFollowers(ctx, userID, 10000, 0); err == nil {
		if err := writeJSON(w, "followers.json", followers); err != nil {
			return err
		}
	}
	if following, err := s.followRepo.ListFollowing(ctx, userID, 10000, 0); err == nil {
		if err := writeJSON(w, "following.json", following); err != nil {
			return err
		}
	}

	// Teams
	if teams, err := s.teamRepo.ListByMember(ctx, userID); err == nil {
		if err := writeJSON(w, "teams.json", teams); err != nil {
			return err
		}
	}

	// Blocks
	if blocked, err := s.friendRepo.ListBlocked(ctx, userID); err == nil {
		if err := writeJSON(w, "blocked.json", blocked); err != nil {
			return err
		}
	}

	if err := w.Close(); err != nil {
		return err
	}

	body := bytes.NewReader(buf.Bytes())
	size := int64(buf.Len())
	storageKey, err := s.storage.UploadExport(ctx, exportID, body, size)
	if err != nil {
		return err
	}

	if err := s.gdprRepo.UpdateExportStatus(ctx, exportID, "completed", storageKey, "", size); err != nil {
		return err
	}
	if s.publisher != nil {
		_ = s.publisher.PublishExportCompleted(ctx, userID, exportID, "")
	}
	return nil
}

func writeJSON(w *zip.Writer, name string, v any) error {
	f, err := w.Create(name)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// CleanupExpiredExports is called by gdprjob cron to delete old export files.
func (s *Service) CleanupExpiredExports(ctx context.Context, limit int) (int, error) {
	exports, err := s.gdprRepo.ListExpiredExports(ctx, limit)
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, exp := range exports {
		if exp.StorageKey != "" {
			if err := s.storage.DeleteExport(ctx, exp.StorageKey); err != nil {
				s.log.Warn().Err(err).Msg("storage delete on export expiry failed")
			}
		}
		if err := s.gdprRepo.DeleteExport(ctx, exp.ID); err != nil {
			s.log.Warn().Err(err).Msg("db delete on export expiry failed")
			continue
		}
		deleted++
	}
	return deleted, nil
}
