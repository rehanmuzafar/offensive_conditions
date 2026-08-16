package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// Pool helper
// =============================================================================

type PoolConfig struct {
	DSN      string
	MaxConns int32
	MinConns int32
}

func NewPool(ctx context.Context, c PoolConfig) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(c.DSN)
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}
	if c.MaxConns > 0 {
		cfg.MaxConns = c.MaxConns
	}
	if c.MinConns > 0 {
		cfg.MinConns = c.MinConns
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return pool, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// =============================================================================
// Submission repo
// =============================================================================

type pgSubmissionRepo struct{ pool *pgxpool.Pool }

func NewPGSubmissionRepo(pool *pgxpool.Pool) SubmissionRepository {
	return &pgSubmissionRepo{pool: pool}
}

func (r *pgSubmissionRepo) Insert(ctx context.Context, s *Submission) error {
	const q = `
		INSERT INTO scoring.submissions
			(id, user_id, team_id, content_type, content_id, instance_id, flag_type,
			 submitted_value, accepted, rejection_reason, points_awarded, is_first_blood, blood_rank,
			 ip_address, user_agent, response_time_ms, seconds_since_spawn,
			 suspicion_score, flagged_for_review, submitted_at)
		VALUES (COALESCE(NULLIF($1::uuid, '00000000-0000-0000-0000-000000000000'), public.uuid_generate_v7()),
		        $2, $3, $4, $5, $6, NULLIF($7, ''),
		        $8, $9, NULLIF($10, ''), $11, $12, NULLIF($13, 0),
		        $14::inet, $15, $16, $17,
		        $18, $19, COALESCE($20, NOW()))`
	ipStr := ""
	if s.IPAddress.IsValid() {
		ipStr = s.IPAddress.String()
	}
	_, err := r.pool.Exec(ctx, q,
		s.ID, s.UserID, s.TeamID, s.ContentType, s.ContentID, s.InstanceID, s.FlagType,
		s.SubmittedValue, s.Accepted, s.RejectionReason, s.PointsAwarded, s.IsFirstBlood, s.BloodRank,
		nullableInet(ipStr), s.UserAgent, s.ResponseTimeMS, s.SecondsSinceSpawn,
		s.SuspicionScore, s.FlaggedForReview, s.SubmittedAt,
	)
	return err
}

func (r *pgSubmissionRepo) GetByID(ctx context.Context, id uuid.UUID) (*Submission, error) {
	const q = `SELECT id, user_id, team_id, content_type, content_id, instance_id, flag_type,
		submitted_value, accepted, COALESCE(rejection_reason, ''), points_awarded, is_first_blood,
		COALESCE(blood_rank, 0), COALESCE(host(ip_address), ''), COALESCE(user_agent, ''),
		COALESCE(response_time_ms, 0), COALESCE(seconds_since_spawn, 0),
		COALESCE(suspicion_score, 0), flagged_for_review, submitted_at
		FROM scoring.submissions WHERE id = $1`
	return scanSubmission(r.pool.QueryRow(ctx, q, id))
}

func scanSubmission(row pgx.Row) (*Submission, error) {
	s := &Submission{}
	var (
		teamID     *uuid.UUID
		instanceID *uuid.UUID
		flagType   *string
		ipStr      string
		suspicion  float64
	)
	err := row.Scan(
		&s.ID, &s.UserID, &teamID, &s.ContentType, &s.ContentID, &instanceID, &flagType,
		&s.SubmittedValue, &s.Accepted, &s.RejectionReason, &s.PointsAwarded, &s.IsFirstBlood,
		&s.BloodRank, &ipStr, &s.UserAgent, &s.ResponseTimeMS, &s.SecondsSinceSpawn,
		&suspicion, &s.FlaggedForReview, &s.SubmittedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.TeamID = teamID
	s.InstanceID = instanceID
	if flagType != nil {
		s.FlagType = *flagType
	}
	if ipStr != "" {
		if addr, err := netip.ParseAddr(ipStr); err == nil {
			s.IPAddress = addr
		}
	}
	s.SuspicionScore = suspicion
	return s, nil
}

func (r *pgSubmissionRepo) ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Submission, error) {
	const q = `SELECT id, user_id, team_id, content_type, content_id, instance_id, flag_type,
		submitted_value, accepted, COALESCE(rejection_reason, ''), points_awarded, is_first_blood,
		COALESCE(blood_rank, 0), COALESCE(host(ip_address), ''), COALESCE(user_agent, ''),
		COALESCE(response_time_ms, 0), COALESCE(seconds_since_spawn, 0),
		COALESCE(suspicion_score, 0), flagged_for_review, submitted_at
		FROM scoring.submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Submission
	for rows.Next() {
		s, err := scanSubmission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *pgSubmissionRepo) CountBloodsForContent(ctx context.Context, contentType string, contentID uuid.UUID, flagType string) (int, error) {
	const q = `SELECT COUNT(*) FROM scoring.submissions
		WHERE content_type = $1 AND content_id = $2 AND flag_type = $3
		  AND accepted = TRUE AND is_first_blood = TRUE`
	var n int
	err := r.pool.QueryRow(ctx, q, contentType, contentID, flagType).Scan(&n)
	return n, err
}

func (r *pgSubmissionRepo) GetFirstNBloodWinners(ctx context.Context, contentType string, contentID uuid.UUID, flagType string, n int) ([]uuid.UUID, error) {
	const q = `SELECT user_id FROM scoring.submissions
		WHERE content_type = $1 AND content_id = $2 AND flag_type = $3 AND accepted = TRUE
		ORDER BY submitted_at LIMIT $4`
	rows, err := r.pool.Query(ctx, q, contentType, contentID, flagType, n)
	if err != nil {
		return nil, err
	}
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

// FindOtherUsersWithSameFlag finds any other users who submitted the same
// (hashed) flag value for the given content. Used by anti-cheat to detect
// flag sharing — per-user HMAC flags should NEVER match across users.
func (r *pgSubmissionRepo) FindOtherUsersWithSameFlag(ctx context.Context, contentType string, contentID uuid.UUID, flagHash string, excludeUserID uuid.UUID) ([]uuid.UUID, error) {
	const q = `SELECT DISTINCT user_id FROM scoring.submissions
		WHERE content_type = $1 AND content_id = $2 AND submitted_value = $3
		  AND accepted = TRUE AND user_id != $4
		LIMIT 5`
	rows, err := r.pool.Query(ctx, q, contentType, contentID, flagHash, excludeUserID)
	if err != nil {
		return nil, err
	}
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

func nullableInet(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// =============================================================================
// Own repo
// =============================================================================

type pgOwnRepo struct{ pool *pgxpool.Pool }

func NewPGOwnRepo(pool *pgxpool.Pool) OwnRepository {
	return &pgOwnRepo{pool: pool}
}

func (r *pgOwnRepo) Insert(ctx context.Context, o *Own) error {
	const q = `
		INSERT INTO scoring.owns
			(id, user_id, content_type, content_id, flag_type, points,
			 is_first_blood, blood_rank, solve_time_seconds, submission_id, owned_at)
		VALUES (COALESCE(NULLIF($1::uuid, '00000000-0000-0000-0000-000000000000'), gen_random_uuid()),
		        $2, $3, $4, NULLIF($5, ''), $6,
		        $7, NULLIF($8, 0), NULLIF($9, 0), $10, COALESCE($11, NOW()))`
	_, err := r.pool.Exec(ctx, q,
		o.ID, o.UserID, o.ContentType, o.ContentID, o.FlagType, o.Points,
		o.IsFirstBlood, o.BloodRank, o.SolveTimeSeconds, o.SubmissionID, o.OwnedAt,
	)
	if isUniqueViolation(err) {
		return ErrDuplicate
	}
	return err
}

func (r *pgOwnRepo) GetByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Own, error) {
	const q = `SELECT id, user_id, content_type, content_id, COALESCE(flag_type, ''), points,
		is_first_blood, COALESCE(blood_rank, 0), COALESCE(solve_time_seconds, 0), submission_id, owned_at
		FROM scoring.owns WHERE user_id = $1 ORDER BY owned_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Own
	for rows.Next() {
		o, err := scanOwn(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *pgOwnRepo) GetByUserAndContent(ctx context.Context, userID uuid.UUID, contentType string, contentID uuid.UUID, flagType string) (*Own, error) {
	const q = `SELECT id, user_id, content_type, content_id, COALESCE(flag_type, ''), points,
		is_first_blood, COALESCE(blood_rank, 0), COALESCE(solve_time_seconds, 0), submission_id, owned_at
		FROM scoring.owns
		WHERE user_id = $1 AND content_type = $2 AND content_id = $3 AND COALESCE(flag_type, '') = $4`
	return scanOwn(r.pool.QueryRow(ctx, q, userID, contentType, contentID, flagType))
}

func scanOwn(row pgx.Row) (*Own, error) {
	o := &Own{}
	var submissionID *uuid.UUID
	err := row.Scan(
		&o.ID, &o.UserID, &o.ContentType, &o.ContentID, &o.FlagType, &o.Points,
		&o.IsFirstBlood, &o.BloodRank, &o.SolveTimeSeconds, &submissionID, &o.OwnedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	o.SubmissionID = submissionID
	return o, nil
}

func (r *pgOwnRepo) HasOwned(ctx context.Context, userID uuid.UUID, contentType string, contentID uuid.UUID, flagType string) (bool, error) {
	const q = `SELECT EXISTS(
		SELECT 1 FROM scoring.owns
		WHERE user_id = $1 AND content_type = $2 AND content_id = $3 AND COALESCE(flag_type, '') = $4)`
	var exists bool
	err := r.pool.QueryRow(ctx, q, userID, contentType, contentID, flagType).Scan(&exists)
	return exists, err
}

func (r *pgOwnRepo) CountByUserAndType(ctx context.Context, userID uuid.UUID, contentType string) (int, error) {
	const q = `SELECT COUNT(*) FROM scoring.owns WHERE user_id = $1 AND content_type = $2`
	var n int
	err := r.pool.QueryRow(ctx, q, userID, contentType).Scan(&n)
	return n, err
}

func (r *pgOwnRepo) CountFirstBloodsForUser(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT COUNT(*) FROM scoring.owns WHERE user_id = $1 AND is_first_blood = TRUE`
	var n int
	err := r.pool.QueryRow(ctx, q, userID).Scan(&n)
	return n, err
}

// =============================================================================
// Point history
// =============================================================================

type pgPointHistoryRepo struct{ pool *pgxpool.Pool }

func NewPGPointHistoryRepo(pool *pgxpool.Pool) PointHistoryRepository {
	return &pgPointHistoryRepo{pool: pool}
}

func (r *pgPointHistoryRepo) Insert(ctx context.Context, p *PointHistory) error {
	metaJSON, _ := json.Marshal(p.Metadata)
	if len(metaJSON) == 0 {
		metaJSON = []byte("{}")
	}
	const q = `INSERT INTO scoring.point_history
		(user_id, event_type, points, reference_type, reference_id, description, metadata, occurred_at)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), $7::jsonb, COALESCE($8, NOW()))`
	_, err := r.pool.Exec(ctx, q,
		p.UserID, p.EventType, p.Points, p.ReferenceType, p.ReferenceID,
		p.Description, metaJSON, p.OccurredAt,
	)
	return err
}

func (r *pgPointHistoryRepo) ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*PointHistory, error) {
	const q = `SELECT id, user_id, event_type, points, COALESCE(reference_type, ''), reference_id,
		COALESCE(description, ''), metadata, occurred_at
		FROM scoring.point_history WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*PointHistory
	for rows.Next() {
		p := &PointHistory{}
		var refID *uuid.UUID
		var metaRaw []byte
		err := rows.Scan(&p.ID, &p.UserID, &p.EventType, &p.Points, &p.ReferenceType,
			&refID, &p.Description, &metaRaw, &p.OccurredAt)
		if err != nil {
			return nil, err
		}
		p.ReferenceID = refID
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &p.Metadata)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *pgPointHistoryRepo) SumByUser(ctx context.Context, userID uuid.UUID) (int64, error) {
	const q = `SELECT COALESCE(SUM(points), 0) FROM scoring.point_history WHERE user_id = $1`
	var n int64
	err := r.pool.QueryRow(ctx, q, userID).Scan(&n)
	return n, err
}

func (r *pgPointHistoryRepo) SumByUserInRange(ctx context.Context, userID uuid.UUID, from, to time.Time) (int64, error) {
	const q = `SELECT COALESCE(SUM(points), 0) FROM scoring.point_history
		WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at < $3`
	var n int64
	err := r.pool.QueryRow(ctx, q, userID, from, to).Scan(&n)
	return n, err
}
