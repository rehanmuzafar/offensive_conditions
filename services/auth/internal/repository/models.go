package repository

import (
	"net/netip"
	"time"

	"github.com/google/uuid"
)

// User represents an account from auth.users.
type User struct {
	ID                uuid.UUID
	Email             string
	Username          string
	PasswordHash      string // empty for OAuth-only accounts
	EmailVerified     bool
	TFAEnabled        bool
	Status            UserStatus
	Role              string
	FailedLoginCount  int
	LockedUntil       *time.Time
	LastLoginAt       *time.Time
	LastLoginIP       *netip.Addr
	CreatedAt         time.Time
	UpdatedAt         time.Time
	DeletedAt         *time.Time
}

type UserStatus string

const (
	UserStatusPending   UserStatus = "pending"
	UserStatusActive    UserStatus = "active"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusBanned    UserStatus = "banned"
	UserStatusDeleted   UserStatus = "deleted"
)

const (
	RoleUser            = "user"
	RoleAdmin           = "admin"
	RoleModerator       = "moderator"
	RoleContentCreator  = "content_creator"
	RoleSupport         = "support"
)

func (u *User) IsLocked() bool {
	return u.LockedUntil != nil && u.LockedUntil.After(time.Now())
}

func (u *User) CanLogin() bool {
	return u.Status == UserStatusActive && !u.IsLocked()
}

// TFASecret stores encrypted 2FA configuration.
type TFASecret struct {
	UserID               uuid.UUID
	SecretEncrypted      string
	BackupCodesEncrypted string
	Method               string // "totp"
	ConfirmedAt          *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// RefreshToken is a hashed refresh token record with rotation chain tracking.
type RefreshToken struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	TokenHash     string
	FamilyID      uuid.UUID
	ParentTokenID *uuid.UUID
	UserAgent     string
	IPAddress     netip.Addr
	ExpiresAt     time.Time
	Revoked       bool
	RevokedAt     *time.Time
	RevokedReason string
	CreatedAt     time.Time
}

func (rt *RefreshToken) IsValid() bool {
	return !rt.Revoked && rt.ExpiresAt.After(time.Now())
}

// Session represents an active user session.
type Session struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	RefreshTokenID    *uuid.UUID
	DeviceFingerprint string
	UserAgent         string
	IPAddress         netip.Addr
	CountryCode       string
	City              string
	IsCurrent         bool
	LastActiveAt      time.Time
	CreatedAt         time.Time
	ExpiresAt         time.Time
}

// OAuthLink connects a user to an external identity provider.
type OAuthLink struct {
	ID                    uuid.UUID
	UserID                uuid.UUID
	Provider              string
	ProviderUserID        string
	ProviderEmail         string
	AccessTokenEncrypted  string
	RefreshTokenEncrypted string
	Metadata              map[string]any
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// EmailVerification is a single-use token for confirming an email.
type EmailVerification struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash string
	Email     string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

// PasswordReset is a single-use token for resetting a forgotten password.
type PasswordReset struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash string
	IPAddress netip.Addr
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

// LoginAttempt records every login attempt (success or fail) for security analytics.
type LoginAttempt struct {
	ID             uuid.UUID
	UserID         *uuid.UUID
	EmailAttempted string
	Success        bool
	FailureReason  string
	IPAddress      netip.Addr
	UserAgent      string
	CountryCode    string
	AttemptedAt    time.Time
}

// CreateUserInput is the data needed to register a new user.
type CreateUserInput struct {
	Email        string
	Username     string
	PasswordHash string // empty for OAuth-only
	Status       UserStatus
	Role         string
}
