package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// Follow
// =============================================================================

type pgFollowRepo struct{ pool *pgxpool.Pool }

func NewPGFollowRepo(pool *pgxpool.Pool) FollowRepository {
	return &pgFollowRepo{pool: pool}
}

func (r *pgFollowRepo) Follow(ctx context.Context, follower, following uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users.follows (follower_id, following_id, created_at)
		VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
		follower, following)
	return err
}

func (r *pgFollowRepo) Unfollow(ctx context.Context, follower, following uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM users.follows WHERE follower_id = $1 AND following_id = $2`,
		follower, following)
	return err
}

func (r *pgFollowRepo) IsFollowing(ctx context.Context, follower, following uuid.UUID) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users.follows WHERE follower_id = $1 AND following_id = $2)`,
		follower, following).Scan(&exists)
	return exists, err
}

func (r *pgFollowRepo) ListFollowers(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT follower_id FROM users.follows WHERE following_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset)
	if err != nil {
		return nil, err
	}
	return scanUUIDList(rows)
}

func (r *pgFollowRepo) ListFollowing(ctx context.Context, userID uuid.UUID, limit, offset int) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT following_id FROM users.follows WHERE follower_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset)
	if err != nil {
		return nil, err
	}
	return scanUUIDList(rows)
}

func (r *pgFollowRepo) CountFollowers(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users.follows WHERE following_id = $1`,
		userID).Scan(&n)
	return n, err
}

func (r *pgFollowRepo) CountFollowing(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users.follows WHERE follower_id = $1`,
		userID).Scan(&n)
	return n, err
}

func scanUUIDList(rows pgx.Rows) ([]uuid.UUID, error) {
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// =============================================================================
// GDPR
// =============================================================================

type pgGDPRRepo struct{ pool *pgxpool.Pool }

func NewPGGDPRRepo(pool *pgxpool.Pool) GDPRRepository {
	return &pgGDPRRepo{pool: pool}
}

func (r *pgGDPRRepo) CreateDeletionRequest(ctx context.Context, req *DeletionRequest) error {
	const q = `INSERT INTO users.deletion_requests
		(user_id, status, scheduled_at, requested_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			status = EXCLUDED.status,
			scheduled_at = EXCLUDED.scheduled_at,
			requested_at = NOW(),
			completed_at = NULL`
	_, err := r.pool.Exec(ctx, q, req.UserID, req.Status, req.ScheduledAt)
	return err
}

func (r *pgGDPRRepo) GetDeletionRequest(ctx context.Context, userID uuid.UUID) (*DeletionRequest, error) {
	req := &DeletionRequest{}
	err := r.pool.QueryRow(ctx,
		`SELECT user_id, status, scheduled_at, requested_at, completed_at
		FROM users.deletion_requests WHERE user_id = $1`, userID).
		Scan(&req.UserID, &req.Status, &req.ScheduledAt, &req.RequestedAt, &req.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return req, err
}

func (r *pgGDPRRepo) CancelDeletionRequest(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.deletion_requests SET status = 'cancelled'
		WHERE user_id = $1 AND status = 'pending'`, userID)
	return err
}

func (r *pgGDPRRepo) CompleteDeletionRequest(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users.deletion_requests SET status = 'completed', completed_at = NOW()
		WHERE user_id = $1 AND status = 'pending'`, userID)
	return err
}

func (r *pgGDPRRepo) ListDueForDeletion(ctx context.Context, limit int) ([]*DeletionRequest, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT user_id, status, scheduled_at, requested_at, completed_at
		FROM users.deletion_requests
		WHERE status = 'pending' AND scheduled_at <= NOW()
		ORDER BY scheduled_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*DeletionRequest
	for rows.Next() {
		req := &DeletionRequest{}
		if err := rows.Scan(&req.UserID, &req.Status, &req.ScheduledAt, &req.RequestedAt, &req.CompletedAt); err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

func (r *pgGDPRRepo) CreateExport(ctx context.Context, e *DataExport) error {
	const q = `INSERT INTO users.data_exports
		(id, user_id, status, created_at, expires_at)
		VALUES ($1, $2, $3, NOW(), $4)`
	_, err := r.pool.Exec(ctx, q, e.ID, e.UserID, e.Status, e.ExpiresAt)
	return err
}

func (r *pgGDPRRepo) GetExport(ctx context.Context, id uuid.UUID) (*DataExport, error) {
	e := &DataExport{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, status, COALESCE(storage_key, ''), COALESCE(size_bytes, 0),
			created_at, completed_at, expires_at, COALESCE(error_msg, '')
		FROM users.data_exports WHERE id = $1`, id).
		Scan(&e.ID, &e.UserID, &e.Status, &e.StorageKey, &e.SizeBytes,
			&e.CreatedAt, &e.CompletedAt, &e.ExpiresAt, &e.ErrorMsg)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

func (r *pgGDPRRepo) GetActiveExportForUser(ctx context.Context, userID uuid.UUID) (*DataExport, error) {
	e := &DataExport{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, status, COALESCE(storage_key, ''), COALESCE(size_bytes, 0),
			created_at, completed_at, expires_at, COALESCE(error_msg, '')
		FROM users.data_exports
		WHERE user_id = $1 AND status IN ('pending', 'processing') AND created_at > NOW() - INTERVAL '1 hour'
		ORDER BY created_at DESC LIMIT 1`, userID).
		Scan(&e.ID, &e.UserID, &e.Status, &e.StorageKey, &e.SizeBytes,
			&e.CreatedAt, &e.CompletedAt, &e.ExpiresAt, &e.ErrorMsg)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

func (r *pgGDPRRepo) UpdateExportStatus(ctx context.Context, id uuid.UUID, status, storageKey, errMsg string, size int64) error {
	completedAt := (*time.Time)(nil)
	if status == "completed" || status == "failed" {
		now := time.Now().UTC()
		completedAt = &now
	}
	const q = `UPDATE users.data_exports SET
		status = $2,
		storage_key = NULLIF($3, ''),
		error_msg = NULLIF($4, ''),
		size_bytes = NULLIF($5, 0),
		completed_at = $6
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id, status, storageKey, errMsg, size, completedAt)
	return err
}

func (r *pgGDPRRepo) ListExpiredExports(ctx context.Context, limit int) ([]*DataExport, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, status, COALESCE(storage_key, ''), COALESCE(size_bytes, 0),
			created_at, completed_at, expires_at, COALESCE(error_msg, '')
		FROM users.data_exports
		WHERE expires_at < NOW() AND status = 'completed'
		ORDER BY expires_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*DataExport
	for rows.Next() {
		e := &DataExport{}
		if err := rows.Scan(&e.ID, &e.UserID, &e.Status, &e.StorageKey, &e.SizeBytes,
			&e.CreatedAt, &e.CompletedAt, &e.ExpiresAt, &e.ErrorMsg); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *pgGDPRRepo) DeleteExport(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM users.data_exports WHERE id = $1`, id)
	return err
}
