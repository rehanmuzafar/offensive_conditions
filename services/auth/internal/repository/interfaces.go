package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotFound is returned when no row matches a lookup.
var ErrNotFound = errors.New("not found")

// ErrConflict is returned on unique constraint violations.
var ErrConflict = errors.New("conflict")

// UserRepository handles auth.users CRUD.
type UserRepository interface {
	Create(ctx context.Context, input CreateUserInput) (*User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	GetByUsername(ctx context.Context, username string) (*User, error)
	UpdatePassword(ctx context.Context, userID uuid.UUID, newHash string) error
	UpdateStatus(ctx context.Context, userID uuid.UUID, status UserStatus) error
	UpdateEmailVerified(ctx context.Context, userID uuid.UUID, verified bool) error
	UpdateTFAEnabled(ctx context.Context, userID uuid.UUID, enabled bool) error
	IncrementFailedLogins(ctx context.Context, userID uuid.UUID) (int, error)
	ResetFailedLogins(ctx context.Context, userID uuid.UUID) error
	Lock(ctx context.Context, userID uuid.UUID, until_seconds int) error
	RecordLogin(ctx context.Context, userID uuid.UUID, ip string) error
}

// TFASecretRepository handles 2FA secret persistence.
type TFASecretRepository interface {
	Create(ctx context.Context, secret *TFASecret) error
	GetByUserID(ctx context.Context, userID uuid.UUID) (*TFASecret, error)
	Confirm(ctx context.Context, userID uuid.UUID) error
	UpdateBackupCodes(ctx context.Context, userID uuid.UUID, encrypted string) error
	Delete(ctx context.Context, userID uuid.UUID) error
}

// RefreshTokenRepository handles the rotation chain.
type RefreshTokenRepository interface {
	Create(ctx context.Context, token *RefreshToken) error
	GetByHash(ctx context.Context, tokenHash string) (*RefreshToken, error)
	GetFamily(ctx context.Context, familyID uuid.UUID) ([]*RefreshToken, error)
	Revoke(ctx context.Context, tokenID uuid.UUID, reason string) error
	RevokeFamily(ctx context.Context, familyID uuid.UUID, reason string) error
	RevokeAllForUser(ctx context.Context, userID uuid.UUID, reason string) error
	DeleteExpired(ctx context.Context) (int64, error)
}

// SessionRepository handles active sessions.
type SessionRepository interface {
	Create(ctx context.Context, session *Session) error
	GetByID(ctx context.Context, id uuid.UUID) (*Session, error)
	ListByUser(ctx context.Context, userID uuid.UUID) ([]*Session, error)
	UpdateLastActive(ctx context.Context, id uuid.UUID) error
	Revoke(ctx context.Context, id uuid.UUID) error
	RevokeAllForUser(ctx context.Context, userID uuid.UUID) error
}

// OAuthLinkRepository links external identities to users.
type OAuthLinkRepository interface {
	Create(ctx context.Context, link *OAuthLink) error
	GetByProviderID(ctx context.Context, provider, providerUserID string) (*OAuthLink, error)
	ListByUser(ctx context.Context, userID uuid.UUID) ([]*OAuthLink, error)
	Delete(ctx context.Context, id uuid.UUID) error
}

// EmailVerificationRepository handles email confirmation tokens.
type EmailVerificationRepository interface {
	Create(ctx context.Context, ev *EmailVerification) error
	GetByHash(ctx context.Context, tokenHash string) (*EmailVerification, error)
	MarkUsed(ctx context.Context, id uuid.UUID) error
	InvalidatePreviousForUser(ctx context.Context, userID uuid.UUID) error
}

// PasswordResetRepository handles password reset tokens.
type PasswordResetRepository interface {
	Create(ctx context.Context, pr *PasswordReset) error
	GetByHash(ctx context.Context, tokenHash string) (*PasswordReset, error)
	MarkUsed(ctx context.Context, id uuid.UUID) error
	InvalidatePreviousForUser(ctx context.Context, userID uuid.UUID) error
}

// LoginAttemptRepository records login attempts.
type LoginAttemptRepository interface {
	Record(ctx context.Context, attempt *LoginAttempt) error
	CountRecentByIP(ctx context.Context, ip string, windowSeconds int) (int, error)
	CountRecentByEmail(ctx context.Context, email string, windowSeconds int) (int, error)
}

// Transactor coordinates multi-repository transactions.
type Transactor interface {
	WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error
}
