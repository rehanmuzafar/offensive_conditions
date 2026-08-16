package repository

import (
	"context"
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
			 submitted_value, submitted_raw_length, accepted, rejection_reason,
			 points_awarded, is_first_blood, blood_rank,
			 ip_address, user_agent, response_time_ms, seconds_since_spawn,
			 suspicion_score, flagged_for_review, submitted_at)
		VALUES (COALESCE(NULLIF($1::uuid, '00000000-0000-0000-0000-000000000000'), public.uuid_generate_v7()),
		        $2, $3, $4, $5, $6, NULLIF($7, ''),
		        $8, $9, $10, NULLIF($11, ''),
		        $12, $13, NULLIF($14, 0),
		        $15::inet, $16, $17, $18,
		        $19, $20, COALESCE($21, NOW()))`
	ipStr := ""
	if s.IPAddress.IsValid() {
		ipStr = s.IPAddress.String()
	}
	_, err := r.pool.Exec(ctx, q,
		s.ID, s.UserID, s.TeamID, s.ContentType, s.ContentID, s.InstanceID, s.FlagType,
		s.SubmittedValue, len(s.SubmittedValue), s.Accepted, s.RejectionReason,
		s.PointsAwarded, s.IsFirstBlood, s.BloodRank,
		nullableInet(ipStr), s.UserAgent, s.ResponseTimeMS, s.SecondsSinceSpawn,
		s.SuspicionScore, s.FlaggedForReview, s.SubmittedAt,
	)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	return err
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
		s := &Submission{}
		var (
			teamID     *uuid.UUID
			instanceID *uuid.UUID
			flagType   *string
			ipStr      string
		)
		err := rows.Scan(
			&s.ID, &s.UserID, &teamID, &s.ContentType, &s.ContentID, &instanceID, &flagType,
			&s.SubmittedValue, &s.Accepted, &s.RejectionReason, &s.PointsAwarded, &s.IsFirstBlood,
			&s.BloodRank, &ipStr, &s.UserAgent, &s.ResponseTimeMS, &s.SecondsSinceSpawn,
			&s.SuspicionScore, &s.FlaggedForReview, &s.SubmittedAt,
		)
		if err != nil {
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
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *pgSubmissionRepo) CountWrongAttemptsRecent(ctx context.Context, userID, contentID uuid.UUID, sinceSeconds int) (int, error) {
	const q = `SELECT COUNT(*) FROM scoring.submissions
		WHERE user_id = $1 AND content_id = $2 AND accepted = FALSE
		  AND submitted_at > NOW() - ($3 || ' seconds')::interval`
	var n int
	err := r.pool.QueryRow(ctx, q, userID, contentID, fmt.Sprint(sinceSeconds)).Scan(&n)
	return n, err
}

func (r *pgSubmissionRepo) CountAcceptedForContent(ctx context.Context, contentType string, contentID uuid.UUID, flagType string) (int, error) {
	const q = `SELECT COUNT(*) FROM scoring.submissions
		WHERE content_type = $1 AND content_id = $2 AND COALESCE(flag_type, '') = $3 AND accepted = TRUE`
	var n int
	err := r.pool.QueryRow(ctx, q, contentType, contentID, flagType).Scan(&n)
	return n, err
}

func nullableInet(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// =============================================================================
// Owns lookup (read-only on scoring.owns)
// =============================================================================

type pgOwnsLookup struct{ pool *pgxpool.Pool }

func NewPGOwnsLookup(pool *pgxpool.Pool) OwnsLookup {
	return &pgOwnsLookup{pool: pool}
}

func (r *pgOwnsLookup) HasOwned(ctx context.Context, userID uuid.UUID, contentType string, contentID uuid.UUID, flagType string) (bool, error) {
	const q = `SELECT EXISTS(SELECT 1 FROM scoring.owns
		WHERE user_id = $1 AND content_type = $2 AND content_id = $3 AND COALESCE(flag_type, '') = $4)`
	var exists bool
	err := r.pool.QueryRow(ctx, q, userID, contentType, contentID, flagType).Scan(&exists)
	return exists, err
}

func (r *pgOwnsLookup) CountSolversForContent(ctx context.Context, contentType string, contentID uuid.UUID, flagType string) (int, error) {
	const q = `SELECT COUNT(*) FROM scoring.owns
		WHERE content_type = $1 AND content_id = $2 AND COALESCE(flag_type, '') = $3`
	var n int
	err := r.pool.QueryRow(ctx, q, contentType, contentID, flagType).Scan(&n)
	return n, err
}

// =============================================================================
// Instance lookup (lab.lab_instances)
// =============================================================================

type pgInstanceLookup struct{ pool *pgxpool.Pool }

func NewPGInstanceLookup(pool *pgxpool.Pool) InstanceLookup {
	return &pgInstanceLookup{pool: pool}
}

func (r *pgInstanceLookup) GetInstance(ctx context.Context, instanceID uuid.UUID) (*InstanceSummary, error) {
	const q = `SELECT id, user_id, machine_id, state, spawned_at,
		COALESCE(expires_at, NOW() + INTERVAL '1 day')
		FROM lab.lab_instances WHERE id = $1`
	s := &InstanceSummary{}
	err := r.pool.QueryRow(ctx, q, instanceID).Scan(
		&s.InstanceID, &s.UserID, &s.MachineID, &s.State, &s.SpawnedAt, &s.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// =============================================================================
// Machine lookup (content.machines — for v1 fetched from content schema)
// =============================================================================

type pgMachineLookup struct{ pool *pgxpool.Pool }

func NewPGMachineLookup(pool *pgxpool.Pool) MachineLookup {
	return &pgMachineLookup{pool: pool}
}

func (r *pgMachineLookup) GetMachine(ctx context.Context, machineID uuid.UUID) (*MachineSummary, error) {
	// content schema may not be built yet; we degrade gracefully.
	const q = `SELECT id, slug,
		CASE WHEN has_root_flag THEN 'root' ELSE 'user' END,
		has_root_flag,
		COALESCE(released_at, created_at),
		COALESCE(difficulty, 'medium')
		FROM content.machines WHERE id = $1`
	s := &MachineSummary{}
	err := r.pool.QueryRow(ctx, q, machineID).Scan(
		&s.MachineID, &s.Slug, &s.UserFlagType, &s.HasRootFlag, &s.ReleasedAt, &s.Difficulty,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		// Tolerate missing content schema during early development
		return &MachineSummary{
			MachineID:    machineID,
			Slug:         "unknown",
			UserFlagType: "root",
			HasRootFlag:  true,
			ReleasedAt:   time.Now().AddDate(0, -1, 0),
			Difficulty:   "medium",
		}, nil
	}
	return s, nil
}
