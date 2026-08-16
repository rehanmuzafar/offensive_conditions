package repository

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// Refresh Token Repository
// =============================================================================

type pgRefreshTokenRepo struct {
	pool *pgxpool.Pool
}

func NewPGRefreshTokenRepo(pool *pgxpool.Pool) RefreshTokenRepository {
	return &pgRefreshTokenRepo{pool: pool}
}

const colsRefreshToken = `id, user_id, token_hash, family_id, parent_token_id,
	user_agent, host(ip_address), expires_at, revoked, revoked_at, revoked_reason, created_at`

func scanRefreshToken(row pgx.Row) (*RefreshToken, error) {
	t := &RefreshToken{}
	var (
		parentID      *uuid.UUID
		userAgent     *string
		ipStr         *string
		revokedAt     *time.Time
		revokedReason *string
	)
	err := row.Scan(
		&t.ID, &t.UserID, &t.TokenHash, &t.FamilyID, &parentID,
		&userAgent, &ipStr, &t.ExpiresAt, &t.Revoked, &revokedAt, &revokedReason, &t.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan refresh token: %w", err)
	}
	t.ParentTokenID = parentID
	if userAgent != nil {
		t.UserAgent = *userAgent
	}
	if ipStr != nil {
		addr, _ := netip.ParseAddr(*ipStr)
		t.IPAddress = addr
	}
	t.RevokedAt = revokedAt
	if revokedReason != nil {
		t.RevokedReason = *revokedReason
	}
	return t, nil
}

func (r *pgRefreshTokenRepo) Create(ctx context.Context, t *RefreshToken) error {
	const q = `
		INSERT INTO auth.refresh_tokens
			(id, user_id, token_hash, family_id, parent_token_id, user_agent, ip_address, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::inet, $8)`
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	if t.FamilyID == uuid.Nil {
		t.FamilyID = uuid.New()
	}
	ip := ""
	if t.IPAddress.IsValid() {
		ip = t.IPAddress.String()
	}
	_, err := r.pool.Exec(ctx, q,
		t.ID, t.UserID, t.TokenHash, t.FamilyID, t.ParentTokenID,
		t.UserAgent, ip, t.ExpiresAt,
	)
	if err != nil {
		return fmt.Errorf("create refresh token: %w", err)
	}
	return nil
}

func (r *pgRefreshTokenRepo) GetByHash(ctx context.Context, tokenHash string) (*RefreshToken, error) {
	const q = `SELECT ` + colsRefreshToken + ` FROM auth.refresh_tokens WHERE token_hash = $1`
	return scanRefreshToken(r.pool.QueryRow(ctx, q, tokenHash))
}

func (r *pgRefreshTokenRepo) GetFamily(ctx context.Context, familyID uuid.UUID) ([]*RefreshToken, error) {
	const q = `SELECT ` + colsRefreshToken + ` FROM auth.refresh_tokens WHERE family_id = $1 ORDER BY created_at`
	rows, err := r.pool.Query(ctx, q, familyID)
	if err != nil {
		return nil, fmt.Errorf("query family: %w", err)
	}
	defer rows.Close()

	var out []*RefreshToken
	for rows.Next() {
		t, err := scanRefreshToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *pgRefreshTokenRepo) Revoke(ctx context.Context, tokenID uuid.UUID, reason string) error {
	const q = `
		UPDATE auth.refresh_tokens
		SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
		WHERE id = $1 AND revoked = FALSE`
	_, err := r.pool.Exec(ctx, q, tokenID, reason)
	return err
}

func (r *pgRefreshTokenRepo) RevokeFamily(ctx context.Context, familyID uuid.UUID, reason string) error {
	const q = `
		UPDATE auth.refresh_tokens
		SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
		WHERE family_id = $1 AND revoked = FALSE`
	_, err := r.pool.Exec(ctx, q, familyID, reason)
	return err
}

func (r *pgRefreshTokenRepo) RevokeAllForUser(ctx context.Context, userID uuid.UUID, reason string) error {
	const q = `
		UPDATE auth.refresh_tokens
		SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
		WHERE user_id = $1 AND revoked = FALSE`
	_, err := r.pool.Exec(ctx, q, userID, reason)
	return err
}

func (r *pgRefreshTokenRepo) DeleteExpired(ctx context.Context) (int64, error) {
	const q = `DELETE FROM auth.refresh_tokens WHERE expires_at < NOW() - INTERVAL '30 days'`
	tag, err := r.pool.Exec(ctx, q)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// =============================================================================
// Session Repository
// =============================================================================

type pgSessionRepo struct {
	pool *pgxpool.Pool
}

func NewPGSessionRepo(pool *pgxpool.Pool) SessionRepository {
	return &pgSessionRepo{pool: pool}
}

const colsSession = `id, user_id, refresh_token_id, device_fingerprint, user_agent,
	host(ip_address), country_code, city, is_current, last_active_at, created_at, expires_at`

func scanSession(row pgx.Row) (*Session, error) {
	s := &Session{}
	var (
		refreshTokenID    *uuid.UUID
		deviceFingerprint *string
		userAgent         *string
		ipStr             *string
		countryCode       *string
		city              *string
	)
	err := row.Scan(
		&s.ID, &s.UserID, &refreshTokenID, &deviceFingerprint, &userAgent,
		&ipStr, &countryCode, &city, &s.IsCurrent, &s.LastActiveAt, &s.CreatedAt, &s.ExpiresAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan session: %w", err)
	}
	s.RefreshTokenID = refreshTokenID
	if deviceFingerprint != nil {
		s.DeviceFingerprint = *deviceFingerprint
	}
	if userAgent != nil {
		s.UserAgent = *userAgent
	}
	if ipStr != nil {
		addr, _ := netip.ParseAddr(*ipStr)
		s.IPAddress = addr
	}
	if countryCode != nil {
		s.CountryCode = *countryCode
	}
	if city != nil {
		s.City = *city
	}
	return s, nil
}

func (r *pgSessionRepo) Create(ctx context.Context, s *Session) error {
	const q = `
		INSERT INTO auth.sessions
			(id, user_id, refresh_token_id, device_fingerprint, user_agent, ip_address,
			 country_code, city, is_current, expires_at)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::inet, NULLIF($7, ''), NULLIF($8, ''), $9, $10)`
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	ip := ""
	if s.IPAddress.IsValid() {
		ip = s.IPAddress.String()
	}
	_, err := r.pool.Exec(ctx, q,
		s.ID, s.UserID, s.RefreshTokenID, s.DeviceFingerprint, s.UserAgent, ip,
		s.CountryCode, s.City, s.IsCurrent, s.ExpiresAt,
	)
	return err
}

func (r *pgSessionRepo) GetByID(ctx context.Context, id uuid.UUID) (*Session, error) {
	const q = `SELECT ` + colsSession + ` FROM auth.sessions WHERE id = $1`
	return scanSession(r.pool.QueryRow(ctx, q, id))
}

func (r *pgSessionRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]*Session, error) {
	const q = `
		SELECT ` + colsSession + `
		FROM auth.sessions
		WHERE user_id = $1 AND is_current = TRUE AND expires_at > NOW()
		ORDER BY last_active_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *pgSessionRepo) UpdateLastActive(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE auth.sessions SET last_active_at = NOW() WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id)
	return err
}

func (r *pgSessionRepo) Revoke(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE auth.sessions SET is_current = FALSE WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, id)
	return err
}

func (r *pgSessionRepo) RevokeAllForUser(ctx context.Context, userID uuid.UUID) error {
	const q = `UPDATE auth.sessions SET is_current = FALSE WHERE user_id = $1 AND is_current = TRUE`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

// =============================================================================
// Email Verification Repository
// =============================================================================

type pgEmailVerifyRepo struct {
	pool *pgxpool.Pool
}

func NewPGEmailVerificationRepo(pool *pgxpool.Pool) EmailVerificationRepository {
	return &pgEmailVerifyRepo{pool: pool}
}

func (r *pgEmailVerifyRepo) Create(ctx context.Context, ev *EmailVerification) error {
	const q = `
		INSERT INTO auth.email_verifications (id, user_id, token_hash, email, expires_at)
		VALUES ($1, $2, $3, $4, $5)`
	if ev.ID == uuid.Nil {
		ev.ID = uuid.New()
	}
	_, err := r.pool.Exec(ctx, q, ev.ID, ev.UserID, ev.TokenHash, ev.Email, ev.ExpiresAt)
	return err
}

func (r *pgEmailVerifyRepo) GetByHash(ctx context.Context, tokenHash string) (*EmailVerification, error) {
	const q = `
		SELECT id, user_id, token_hash, email, expires_at, used_at, created_at
		FROM auth.email_verifications
		WHERE token_hash = $1`
	ev := &EmailVerification{}
	var usedAt *time.Time
	err := r.pool.QueryRow(ctx, q, tokenHash).Scan(
		&ev.ID, &ev.UserID, &ev.TokenHash, &ev.Email, &ev.ExpiresAt, &usedAt, &ev.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	ev.UsedAt = usedAt
	return ev, nil
}

func (r *pgEmailVerifyRepo) MarkUsed(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE auth.email_verifications SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`
	_, err := r.pool.Exec(ctx, q, id)
	return err
}

func (r *pgEmailVerifyRepo) InvalidatePreviousForUser(ctx context.Context, userID uuid.UUID) error {
	const q = `UPDATE auth.email_verifications SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

// =============================================================================
// Password Reset Repository
// =============================================================================

type pgPasswordResetRepo struct {
	pool *pgxpool.Pool
}

func NewPGPasswordResetRepo(pool *pgxpool.Pool) PasswordResetRepository {
	return &pgPasswordResetRepo{pool: pool}
}

func (r *pgPasswordResetRepo) Create(ctx context.Context, pr *PasswordReset) error {
	const q = `
		INSERT INTO auth.password_resets (id, user_id, token_hash, ip_address, expires_at)
		VALUES ($1, $2, $3, NULLIF($4, '')::inet, $5)`
	if pr.ID == uuid.Nil {
		pr.ID = uuid.New()
	}
	ip := ""
	if pr.IPAddress.IsValid() {
		ip = pr.IPAddress.String()
	}
	_, err := r.pool.Exec(ctx, q, pr.ID, pr.UserID, pr.TokenHash, ip, pr.ExpiresAt)
	return err
}

func (r *pgPasswordResetRepo) GetByHash(ctx context.Context, tokenHash string) (*PasswordReset, error) {
	const q = `
		SELECT id, user_id, token_hash, host(ip_address), expires_at, used_at, created_at
		FROM auth.password_resets
		WHERE token_hash = $1`
	pr := &PasswordReset{}
	var (
		ipStr  *string
		usedAt *time.Time
	)
	err := r.pool.QueryRow(ctx, q, tokenHash).Scan(
		&pr.ID, &pr.UserID, &pr.TokenHash, &ipStr, &pr.ExpiresAt, &usedAt, &pr.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if ipStr != nil {
		addr, _ := netip.ParseAddr(*ipStr)
		pr.IPAddress = addr
	}
	pr.UsedAt = usedAt
	return pr, nil
}

func (r *pgPasswordResetRepo) MarkUsed(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE auth.password_resets SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`
	_, err := r.pool.Exec(ctx, q, id)
	return err
}

func (r *pgPasswordResetRepo) InvalidatePreviousForUser(ctx context.Context, userID uuid.UUID) error {
	const q = `UPDATE auth.password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

// =============================================================================
// Login Attempt Repository
// =============================================================================

type pgLoginAttemptRepo struct {
	pool *pgxpool.Pool
}

func NewPGLoginAttemptRepo(pool *pgxpool.Pool) LoginAttemptRepository {
	return &pgLoginAttemptRepo{pool: pool}
}

func (r *pgLoginAttemptRepo) Record(ctx context.Context, a *LoginAttempt) error {
	const q = `
		INSERT INTO auth.login_attempts
			(user_id, email_attempted, success, failure_reason, ip_address, user_agent, country_code)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5::inet, $6, NULLIF($7, ''))`
	ip := a.IPAddress.String()
	if !a.IPAddress.IsValid() {
		ip = "127.0.0.1"
	}
	_, err := r.pool.Exec(ctx, q,
		a.UserID, a.EmailAttempted, a.Success, a.FailureReason, ip, a.UserAgent, a.CountryCode,
	)
	return err
}

func (r *pgLoginAttemptRepo) CountRecentByIP(ctx context.Context, ip string, windowSeconds int) (int, error) {
	const q = `
		SELECT COUNT(*) FROM auth.login_attempts
		WHERE ip_address = $1::inet
		  AND attempted_at > NOW() - ($2 || ' seconds')::interval
		  AND success = FALSE`
	var count int
	err := r.pool.QueryRow(ctx, q, ip, windowSeconds).Scan(&count)
	return count, err
}

func (r *pgLoginAttemptRepo) CountRecentByEmail(ctx context.Context, email string, windowSeconds int) (int, error) {
	const q = `
		SELECT COUNT(*) FROM auth.login_attempts
		WHERE email_attempted = $1
		  AND attempted_at > NOW() - ($2 || ' seconds')::interval
		  AND success = FALSE`
	var count int
	err := r.pool.QueryRow(ctx, q, email, windowSeconds).Scan(&count)
	return count, err
}

// =============================================================================
// TFA Secret Repository
// =============================================================================

type pgTFASecretRepo struct {
	pool *pgxpool.Pool
}

func NewPGTFASecretRepo(pool *pgxpool.Pool) TFASecretRepository {
	return &pgTFASecretRepo{pool: pool}
}

func (r *pgTFASecretRepo) Create(ctx context.Context, s *TFASecret) error {
	const q = `
		INSERT INTO auth.tfa_secrets (user_id, secret_encrypted, backup_codes_encrypted, method)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE
			SET secret_encrypted = EXCLUDED.secret_encrypted,
			    backup_codes_encrypted = EXCLUDED.backup_codes_encrypted,
			    confirmed_at = NULL`
	_, err := r.pool.Exec(ctx, q, s.UserID, s.SecretEncrypted, s.BackupCodesEncrypted, s.Method)
	return err
}

func (r *pgTFASecretRepo) GetByUserID(ctx context.Context, userID uuid.UUID) (*TFASecret, error) {
	const q = `
		SELECT user_id, secret_encrypted, backup_codes_encrypted, method,
		       confirmed_at, created_at, updated_at
		FROM auth.tfa_secrets WHERE user_id = $1`
	s := &TFASecret{}
	var confirmedAt *time.Time
	err := r.pool.QueryRow(ctx, q, userID).Scan(
		&s.UserID, &s.SecretEncrypted, &s.BackupCodesEncrypted, &s.Method,
		&confirmedAt, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.ConfirmedAt = confirmedAt
	return s, nil
}

func (r *pgTFASecretRepo) Confirm(ctx context.Context, userID uuid.UUID) error {
	const q = `UPDATE auth.tfa_secrets SET confirmed_at = NOW() WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

func (r *pgTFASecretRepo) UpdateBackupCodes(ctx context.Context, userID uuid.UUID, encrypted string) error {
	const q = `UPDATE auth.tfa_secrets SET backup_codes_encrypted = $2 WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID, encrypted)
	return err
}

func (r *pgTFASecretRepo) Delete(ctx context.Context, userID uuid.UUID) error {
	const q = `DELETE FROM auth.tfa_secrets WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}
