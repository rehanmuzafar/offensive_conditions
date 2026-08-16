package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgUserRepo implements UserRepository against PostgreSQL.
type pgUserRepo struct {
	pool *pgxpool.Pool
}

func NewPGUserRepo(pool *pgxpool.Pool) UserRepository {
	return &pgUserRepo{pool: pool}
}

// last_login_ip is a Postgres inet; cast to text so pgx can scan it into a
// *string (scanning inet directly into *string fails once it has a value).
const colsUsers = `id, email, username, password_hash, email_verified, tfa_enabled,
	status, role, failed_login_count, locked_until, last_login_at, last_login_ip::text,
	created_at, updated_at, deleted_at`

func scanUser(row pgx.Row) (*User, error) {
	u := &User{}
	var (
		passwordHash *string
		lockedUntil  *time.Time
		lastLoginAt  *time.Time
		lastLoginIP  *string
		deletedAt    *time.Time
	)
	err := row.Scan(
		&u.ID, &u.Email, &u.Username, &passwordHash, &u.EmailVerified, &u.TFAEnabled,
		&u.Status, &u.Role, &u.FailedLoginCount, &lockedUntil, &lastLoginAt, &lastLoginIP,
		&u.CreatedAt, &u.UpdatedAt, &deletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan user: %w", err)
	}
	if passwordHash != nil {
		u.PasswordHash = *passwordHash
	}
	u.LockedUntil = lockedUntil
	u.LastLoginAt = lastLoginAt
	u.DeletedAt = deletedAt
	return u, nil
}

func (r *pgUserRepo) Create(ctx context.Context, in CreateUserInput) (*User, error) {
	const q = `
		INSERT INTO auth.users (email, username, password_hash, status, role, email_verified)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, FALSE)
		RETURNING ` + colsUsers
	row := r.pool.QueryRow(ctx, q, in.Email, in.Username, in.PasswordHash, in.Status, in.Role)
	u, err := scanUser(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, fmt.Errorf("%w: %s", ErrConflict, pgErr.ConstraintName)
		}
		return nil, err
	}
	return u, nil
}

func (r *pgUserRepo) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	const q = `SELECT ` + colsUsers + ` FROM auth.users WHERE id = $1 AND deleted_at IS NULL`
	return scanUser(r.pool.QueryRow(ctx, q, id))
}

func (r *pgUserRepo) GetByEmail(ctx context.Context, email string) (*User, error) {
	const q = `SELECT ` + colsUsers + ` FROM auth.users WHERE email = $1 AND deleted_at IS NULL`
	return scanUser(r.pool.QueryRow(ctx, q, email))
}

func (r *pgUserRepo) GetByUsername(ctx context.Context, username string) (*User, error) {
	const q = `SELECT ` + colsUsers + ` FROM auth.users WHERE username = $1 AND deleted_at IS NULL`
	return scanUser(r.pool.QueryRow(ctx, q, username))
}

func (r *pgUserRepo) UpdatePassword(ctx context.Context, userID uuid.UUID, newHash string) error {
	const q = `UPDATE auth.users SET password_hash = $2 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, userID, newHash)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *pgUserRepo) UpdateStatus(ctx context.Context, userID uuid.UUID, status UserStatus) error {
	const q = `UPDATE auth.users SET status = $2 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, userID, status)
	if err != nil {
		return fmt.Errorf("update status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *pgUserRepo) UpdateEmailVerified(ctx context.Context, userID uuid.UUID, verified bool) error {
	// When verifying, also activate pending accounts
	const q = `
		UPDATE auth.users
		SET email_verified = $2,
		    status = CASE WHEN $2 = TRUE AND status = 'pending' THEN 'active' ELSE status END
		WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, userID, verified)
	if err != nil {
		return fmt.Errorf("update email_verified: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *pgUserRepo) UpdateTFAEnabled(ctx context.Context, userID uuid.UUID, enabled bool) error {
	const q = `UPDATE auth.users SET tfa_enabled = $2 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, userID, enabled)
	if err != nil {
		return fmt.Errorf("update tfa_enabled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *pgUserRepo) IncrementFailedLogins(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `
		UPDATE auth.users
		SET failed_login_count = failed_login_count + 1
		WHERE id = $1
		RETURNING failed_login_count`
	var count int
	if err := r.pool.QueryRow(ctx, q, userID).Scan(&count); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("increment failed logins: %w", err)
	}
	return count, nil
}

func (r *pgUserRepo) ResetFailedLogins(ctx context.Context, userID uuid.UUID) error {
	const q = `UPDATE auth.users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

func (r *pgUserRepo) Lock(ctx context.Context, userID uuid.UUID, untilSeconds int) error {
	const q = `UPDATE auth.users SET locked_until = NOW() + ($2 || ' seconds')::interval WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, userID, untilSeconds)
	if err != nil {
		return fmt.Errorf("lock account: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *pgUserRepo) RecordLogin(ctx context.Context, userID uuid.UUID, ip string) error {
	const q = `
		UPDATE auth.users
		SET last_login_at = NOW(),
		    last_login_ip = NULLIF($2, '')::inet,
		    failed_login_count = 0,
		    locked_until = NULL
		WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, userID, ip)
	return err
}
