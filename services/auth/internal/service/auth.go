package service

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/offensive-conditions/auth/internal/audit"
	"github.com/offensive-conditions/auth/internal/config"
	"github.com/offensive-conditions/auth/internal/crypto"
	"github.com/offensive-conditions/auth/internal/email"
	autherrors "github.com/offensive-conditions/auth/internal/errors"
	"github.com/offensive-conditions/auth/internal/oauth"
	"github.com/offensive-conditions/auth/internal/ratelimit"
	"github.com/offensive-conditions/auth/internal/repository"
	"github.com/offensive-conditions/auth/internal/tokens"
)

// AuthService is the primary application service orchestrating auth flows.
// Methods take RequestMetadata so caller IPs/User-Agents can be threaded through.
type AuthService struct {
	cfg          *config.Config
	log          zerolog.Logger
	users        repository.UserRepository
	tfaSecrets   repository.TFASecretRepository
	refreshes    repository.RefreshTokenRepository
	sessions     repository.SessionRepository
	emailVerify  repository.EmailVerificationRepository
	passwordRst  repository.PasswordResetRepository
	loginAttempts repository.LoginAttemptRepository
	oauthLinks    repository.OAuthLinkRepository
	jwt          *tokens.JWTIssuer
	totp         *tokens.TOTPManager
	limiter      *ratelimit.Limiter
	mail         email.Sender
	audit        *audit.Logger
	oauthRegistry *oauth.Registry
	tfaEncKey    []byte // Used to encrypt TOTP secrets at rest (from Vault)
}

// GetUserByID loads a full user account by ID (used by the /me profile endpoint).
func (s *AuthService) GetUserByID(ctx context.Context, id uuid.UUID) (*repository.User, error) {
	return s.users.GetByID(ctx, id)
}

type Deps struct {
	Cfg           *config.Config
	Log           zerolog.Logger
	Users         repository.UserRepository
	TFASecrets    repository.TFASecretRepository
	Refreshes     repository.RefreshTokenRepository
	Sessions      repository.SessionRepository
	EmailVerify   repository.EmailVerificationRepository
	PasswordRst   repository.PasswordResetRepository
	LoginAttempts repository.LoginAttemptRepository
	OAuthLinks    repository.OAuthLinkRepository
	JWT           *tokens.JWTIssuer
	TOTP          *tokens.TOTPManager
	Limiter       *ratelimit.Limiter
	Mail          email.Sender
	Audit         *audit.Logger
	OAuthRegistry *oauth.Registry
	TFAEncKey     []byte
}

func New(d Deps) *AuthService {
	return &AuthService{
		cfg: d.Cfg, log: d.Log,
		users: d.Users, tfaSecrets: d.TFASecrets,
		refreshes: d.Refreshes, sessions: d.Sessions,
		emailVerify: d.EmailVerify, passwordRst: d.PasswordRst,
		loginAttempts: d.LoginAttempts, oauthLinks: d.OAuthLinks,
		jwt: d.JWT, totp: d.TOTP,
		limiter: d.Limiter, mail: d.Mail, audit: d.Audit,
		oauthRegistry: d.OAuthRegistry,
		tfaEncKey:     d.TFAEncKey,
	}
}

// RequestMeta carries per-request context for auditing.
type RequestMeta struct {
	IP        netip.Addr
	UserAgent string
	Country   string
	RequestID string
}

// =============================================================================
// Registration
// =============================================================================

type RegisterInput struct {
	Email    string
	Username string
	Password string
}

type RegisterOutput struct {
	UserID                uuid.UUID
	VerificationRequired  bool
}

func (s *AuthService) Register(ctx context.Context, in RegisterInput, m RequestMeta) (*RegisterOutput, error) {
	// Rate limit by IP
	rlKey := "rl:register:" + m.IP.String()
	res, err := s.limiter.Allow(ctx, rlKey, s.cfg.RateLimit.RegisterPerHour, time.Hour)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	if !res.Allowed {
		return nil, autherrors.RateLimited(res.RetryAfter.String())
	}

	// Validate
	email := strings.ToLower(strings.TrimSpace(in.Email))
	username := strings.TrimSpace(in.Username)
	if email == "" || username == "" || in.Password == "" {
		return nil, autherrors.New(autherrors.CodeValidation, "email, username, password are required")
	}
	if err := crypto.ValidatePasswordStrength(in.Password, s.cfg.Security.MinPasswordLength); err != nil {
		return nil, autherrors.New(autherrors.CodeWeakPassword, err.Error())
	}

	// Hash password
	hash, err := crypto.HashPassword(in.Password, crypto.Argon2idParams{
		Time: s.cfg.Argon2.Time, Memory: s.cfg.Argon2.Memory,
		Threads: s.cfg.Argon2.Threads, KeyLen: s.cfg.Argon2.KeyLen, SaltLen: s.cfg.Argon2.SaltLen,
	})
	if err != nil {
		return nil, autherrors.Internal(err)
	}

	initialStatus := repository.UserStatusPending
	if !s.cfg.Security.EmailVerificationRequired {
		initialStatus = repository.UserStatusActive
	}

	user, err := s.users.Create(ctx, repository.CreateUserInput{
		Email: email, Username: username, PasswordHash: hash,
		Status: initialStatus, Role: repository.RoleUser,
	})
	if err != nil {
		if strings.Contains(err.Error(), "conflict") {
			// We can't tell which column conflicted without parsing more — use a generic conflict.
			// In practice the DB constraint name tells us; keep it simple here.
			return nil, autherrors.New(autherrors.CodeConflict, "email or username already taken")
		}
		return nil, autherrors.Internal(err)
	}

	// Send verification email (best-effort)
	if s.cfg.Security.EmailVerificationRequired {
		if err := s.sendVerificationEmail(ctx, user.ID, user.Email); err != nil {
			s.log.Error().Err(err).Str("user_id", user.ID.String()).Msg("send verification email failed")
		}
	}

	s.audit.UserRegistered(ctx, user.ID, m.IP, m.UserAgent, m.RequestID)

	return &RegisterOutput{
		UserID:               user.ID,
		VerificationRequired: s.cfg.Security.EmailVerificationRequired,
	}, nil
}

// =============================================================================
// Login (Password)
// =============================================================================

type LoginInput struct {
	Email    string
	Password string
}

type LoginOutput struct {
	AccessToken    string
	RefreshToken   string
	ExpiresIn      int    // seconds
	TFAChallenge   string // present if 2FA needed; submit to /auth/login/2fa
	UserID         uuid.UUID
}

func (s *AuthService) Login(ctx context.Context, in LoginInput, m RequestMeta) (*LoginOutput, error) {
	// Rate limit by IP
	rlKey := "rl:login:" + m.IP.String()
	res, err := s.limiter.Allow(ctx, rlKey, s.cfg.RateLimit.LoginPerMinute, time.Minute)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	if !res.Allowed {
		return nil, autherrors.RateLimited(res.RetryAfter.String())
	}

	email := strings.ToLower(strings.TrimSpace(in.Email))

	user, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		// Record failed attempt without leaking whether email exists
		s.recordFailedLogin(ctx, nil, email, "email_not_found", m)
		return nil, autherrors.InvalidCredentials()
	}

	// Status / lock checks
	switch user.Status {
	case repository.UserStatusBanned:
		s.recordFailedLogin(ctx, &user.ID, email, "account_banned", m)
		return nil, autherrors.New(autherrors.CodeAccountBanned, "Account is banned")
	case repository.UserStatusSuspended:
		s.recordFailedLogin(ctx, &user.ID, email, "account_suspended", m)
		return nil, autherrors.New(autherrors.CodeAccountSuspended, "Account is suspended")
	case repository.UserStatusDeleted:
		s.recordFailedLogin(ctx, &user.ID, email, "account_deleted", m)
		return nil, autherrors.InvalidCredentials()
	}
	if user.IsLocked() {
		s.recordFailedLogin(ctx, &user.ID, email, "account_locked", m)
		return nil, autherrors.AccountLocked(time.Until(*user.LockedUntil).String())
	}
	if s.cfg.Security.EmailVerificationRequired && !user.EmailVerified {
		s.recordFailedLogin(ctx, &user.ID, email, "email_not_verified", m)
		return nil, autherrors.EmailNotVerified()
	}

	// Password
	if user.PasswordHash == "" {
		// OAuth-only account
		s.recordFailedLogin(ctx, &user.ID, email, "no_password", m)
		return nil, autherrors.InvalidCredentials()
	}
	valid, needsRehash, err := crypto.VerifyPassword(in.Password, user.PasswordHash, crypto.Argon2idParams{
		Time: s.cfg.Argon2.Time, Memory: s.cfg.Argon2.Memory,
		Threads: s.cfg.Argon2.Threads, KeyLen: s.cfg.Argon2.KeyLen, SaltLen: s.cfg.Argon2.SaltLen,
	})
	if err != nil || !valid {
		s.handleBadPassword(ctx, user, email, m)
		return nil, autherrors.InvalidCredentials()
	}

	// Transparently rehash with new params if needed
	if needsRehash {
		if newHash, err := crypto.HashPassword(in.Password, crypto.Argon2idParams{
			Time: s.cfg.Argon2.Time, Memory: s.cfg.Argon2.Memory,
			Threads: s.cfg.Argon2.Threads, KeyLen: s.cfg.Argon2.KeyLen, SaltLen: s.cfg.Argon2.SaltLen,
		}); err == nil {
			_ = s.users.UpdatePassword(ctx, user.ID, newHash)
		}
	}

	// If 2FA is enabled, return a pending challenge instead of tokens
	if user.TFAEnabled {
		challenge, err := s.issueTFAChallenge(ctx, user.ID)
		if err != nil {
			return nil, autherrors.Internal(err)
		}
		return &LoginOutput{TFAChallenge: challenge, UserID: user.ID}, nil
	}

	// Issue tokens
	return s.issueTokens(ctx, user, m)
}

// LoginTFA completes a 2FA login after the password step.
func (s *AuthService) LoginTFA(ctx context.Context, challenge, code string, m RequestMeta) (*LoginOutput, error) {
	userID, err := s.consumeTFAChallenge(ctx, challenge)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeInvalidToken, "Invalid or expired challenge")
	}

	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, autherrors.Internal(err)
	}

	secret, err := s.tfaSecrets.GetByUserID(ctx, userID)
	if err != nil {
		return nil, autherrors.New(autherrors.CodeTFANotEnabled, "2FA not configured")
	}

	plainSecret, err := decryptString(secret.SecretEncrypted, s.tfaEncKey)
	if err != nil {
		return nil, autherrors.Internal(err)
	}

	valid, err := s.totp.Validate(code, plainSecret)
	if err != nil || !valid {
		s.audit.LoginFailed(ctx, user.Email, m.IP, m.UserAgent, "tfa_invalid", m.RequestID)
		return nil, autherrors.New(autherrors.CodeTFAInvalidCode, "Invalid 2FA code")
	}

	return s.issueTokens(ctx, user, m)
}

// =============================================================================
// Token Refresh (with rotation + theft detection)
// =============================================================================

type RefreshOutput struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string, m RequestMeta) (*RefreshOutput, error) {
	tokenHash := crypto.HashToken(refreshToken)
	rt, err := s.refreshes.GetByHash(ctx, tokenHash)
	if err != nil {
		// Only a genuine miss is an invalid token. Collapsing every error into
		// "not found" previously hid a driver-level scan failure and made the
		// whole refresh flow look like an expired-token problem.
		if !errors.Is(err, repository.ErrNotFound) {
			return nil, autherrors.Internal(err)
		}
		return nil, autherrors.InvalidToken("not found")
	}

	// Theft detection: a revoked token from this family means someone is replaying it
	if rt.Revoked {
		// Revoke the entire family — original holder will be forced to re-login
		_ = s.refreshes.RevokeFamily(ctx, rt.FamilyID, "theft_suspected")
		s.audit.RefreshTokenReused(ctx, rt.UserID, rt.FamilyID, m.IP, m.RequestID)
		return nil, autherrors.New(autherrors.CodeTokenReused, "Refresh token reuse detected; please log in again")
	}

	if time.Now().After(rt.ExpiresAt) {
		return nil, autherrors.ExpiredToken()
	}

	user, err := s.users.GetByID(ctx, rt.UserID)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	if !user.CanLogin() {
		return nil, autherrors.New(autherrors.CodeForbidden, "Account cannot log in")
	}

	// Revoke old token
	if err := s.refreshes.Revoke(ctx, rt.ID, "rotation"); err != nil {
		return nil, autherrors.Internal(err)
	}

	// Issue new refresh token in same family chain
	newRaw, err := crypto.RandomToken(48)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	newHash := crypto.HashToken(newRaw)

	parentID := rt.ID
	newRT := &repository.RefreshToken{
		ID:            uuid.New(),
		UserID:        user.ID,
		TokenHash:     newHash,
		FamilyID:      rt.FamilyID,
		ParentTokenID: &parentID,
		UserAgent:     m.UserAgent,
		IPAddress:     m.IP,
		ExpiresAt:     time.Now().Add(s.cfg.JWT.RefreshTTL),
	}
	if err := s.refreshes.Create(ctx, newRT); err != nil {
		return nil, autherrors.Internal(err)
	}

	// Issue new access token
	sessionID := ""
	if rt.ID != uuid.Nil {
		// Reuse the same session as the original token
		// (sessions are tied to families via refresh_token_id on first issue)
		sessionID = rt.ID.String()
	}

	access, err := s.jwt.IssueAccessToken(user.ID.String(), sessionID, user.Username, "free", []string{user.Role})
	if err != nil {
		return nil, autherrors.Internal(err)
	}

	return &RefreshOutput{
		AccessToken:  access,
		RefreshToken: newRaw,
		ExpiresIn:    int(s.cfg.JWT.AccessTTL.Seconds()),
	}, nil
}

// =============================================================================
// Logout
// =============================================================================

func (s *AuthService) Logout(ctx context.Context, refreshToken string, m RequestMeta) error {
	if refreshToken == "" {
		return nil // idempotent
	}
	rt, err := s.refreshes.GetByHash(ctx, crypto.HashToken(refreshToken))
	if err != nil {
		return nil // idempotent
	}
	_ = s.refreshes.Revoke(ctx, rt.ID, "logout")
	return nil
}

func (s *AuthService) LogoutAll(ctx context.Context, userID uuid.UUID, m RequestMeta) error {
	if err := s.refreshes.RevokeAllForUser(ctx, userID, "logout_all"); err != nil {
		return autherrors.Internal(err)
	}
	if err := s.sessions.RevokeAllForUser(ctx, userID); err != nil {
		return autherrors.Internal(err)
	}
	return nil
}

// =============================================================================
// Helpers
// =============================================================================

func (s *AuthService) issueTokens(ctx context.Context, user *repository.User, m RequestMeta) (*LoginOutput, error) {
	// Refresh token
	rawRefresh, err := crypto.RandomToken(48)
	if err != nil {
		return nil, autherrors.Internal(err)
	}
	refreshHash := crypto.HashToken(rawRefresh)

	familyID := uuid.New()
	rt := &repository.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: refreshHash,
		FamilyID:  familyID,
		UserAgent: m.UserAgent,
		IPAddress: m.IP,
		ExpiresAt: time.Now().Add(s.cfg.JWT.RefreshTTL),
	}
	if err := s.refreshes.Create(ctx, rt); err != nil {
		return nil, autherrors.Internal(err)
	}

	// Session
	sess := &repository.Session{
		ID:             uuid.New(),
		UserID:         user.ID,
		RefreshTokenID: &rt.ID,
		UserAgent:      m.UserAgent,
		IPAddress:      m.IP,
		CountryCode:    m.Country,
		IsCurrent:      true,
		LastActiveAt:   time.Now(),
		ExpiresAt:      time.Now().Add(s.cfg.Security.SessionTTL),
	}
	if err := s.sessions.Create(ctx, sess); err != nil {
		return nil, autherrors.Internal(err)
	}

	// Access token
	access, err := s.jwt.IssueAccessToken(user.ID.String(), sess.ID.String(), user.Username, "free", []string{user.Role})
	if err != nil {
		return nil, autherrors.Internal(err)
	}

	// Update user
	_ = s.users.RecordLogin(ctx, user.ID, m.IP.String())
	s.recordLoginAttempt(ctx, &user.ID, user.Email, true, "", m)
	s.audit.LoginSuccess(ctx, user.ID, m.IP, m.UserAgent, m.RequestID)

	return &LoginOutput{
		AccessToken:  access,
		RefreshToken: rawRefresh,
		ExpiresIn:    int(s.cfg.JWT.AccessTTL.Seconds()),
		UserID:       user.ID,
	}, nil
}

func (s *AuthService) handleBadPassword(ctx context.Context, user *repository.User, email string, m RequestMeta) {
	count, _ := s.users.IncrementFailedLogins(ctx, user.ID)
	s.recordFailedLogin(ctx, &user.ID, email, "bad_password", m)
	if count >= s.cfg.Security.FailedLoginsBeforeLock {
		lockSeconds := int(s.cfg.Security.AccountLockDuration.Seconds())
		_ = s.users.Lock(ctx, user.ID, lockSeconds)
		s.audit.AccountLocked(ctx, user.ID, m.IP, m.RequestID)
	}
}

func (s *AuthService) recordFailedLogin(ctx context.Context, userID *uuid.UUID, email, reason string, m RequestMeta) {
	_ = s.loginAttempts.Record(ctx, &repository.LoginAttempt{
		UserID:         userID,
		EmailAttempted: email,
		Success:        false,
		FailureReason:  reason,
		IPAddress:      m.IP,
		UserAgent:      m.UserAgent,
		CountryCode:    m.Country,
	})
	s.audit.LoginFailed(ctx, email, m.IP, m.UserAgent, reason, m.RequestID)
}

func (s *AuthService) recordLoginAttempt(ctx context.Context, userID *uuid.UUID, email string, success bool, reason string, m RequestMeta) {
	_ = s.loginAttempts.Record(ctx, &repository.LoginAttempt{
		UserID:         userID,
		EmailAttempted: email,
		Success:        success,
		FailureReason:  reason,
		IPAddress:      m.IP,
		UserAgent:      m.UserAgent,
		CountryCode:    m.Country,
	})
}

// TFA challenge is a short-lived ID stored in Redis mapping to user_id
func (s *AuthService) issueTFAChallenge(ctx context.Context, userID uuid.UUID) (string, error) {
	challenge, err := crypto.RandomToken(24)
	if err != nil {
		return "", err
	}
	key := "tfa:challenge:" + challenge
	if err := s.limiter.GetRedis().Set(ctx, key, userID.String(), 5*time.Minute).Err(); err != nil {
		return "", err
	}
	return challenge, nil
}

func (s *AuthService) consumeTFAChallenge(ctx context.Context, challenge string) (uuid.UUID, error) {
	key := "tfa:challenge:" + challenge
	val, err := s.limiter.GetRedis().GetDel(ctx, key).Result()
	if err != nil {
		return uuid.Nil, fmt.Errorf("challenge not found")
	}
	return uuid.Parse(val)
}

func (s *AuthService) sendVerificationEmail(ctx context.Context, userID uuid.UUID, emailAddr string) error {
	// Invalidate previous tokens
	_ = s.emailVerify.InvalidatePreviousForUser(ctx, userID)

	rawToken, err := crypto.RandomToken(32)
	if err != nil {
		return err
	}
	ev := &repository.EmailVerification{
		UserID:    userID,
		TokenHash: crypto.HashToken(rawToken),
		Email:     emailAddr,
		ExpiresAt: time.Now().Add(s.cfg.Security.EmailVerifyTokenTTL),
	}
	if err := s.emailVerify.Create(ctx, ev); err != nil {
		return err
	}

	return s.mail.Send(ctx, email.Message{
		To:       emailAddr,
		Subject:  "Verify your Offense Conditions account",
		Template: "verify_email.html",
		Data: map[string]any{
			"VerifyURL": fmt.Sprintf("%s/verify?token=%s", s.cfg.OAuth.CallbackBase, rawToken),
			"ExpiresIn": s.cfg.Security.EmailVerifyTokenTTL.String(),
		},
	})
}

// =============================================================================
// Email Verification
// =============================================================================

func (s *AuthService) VerifyEmail(ctx context.Context, rawToken string, m RequestMeta) error {
	ev, err := s.emailVerify.GetByHash(ctx, crypto.HashToken(rawToken))
	if err != nil {
		return autherrors.InvalidToken("verification token")
	}
	if ev.UsedAt != nil {
		return autherrors.New(autherrors.CodeEmailAlreadyVerified, "Token already used")
	}
	if time.Now().After(ev.ExpiresAt) {
		return autherrors.ExpiredToken()
	}

	if err := s.emailVerify.MarkUsed(ctx, ev.ID); err != nil {
		return autherrors.Internal(err)
	}
	if err := s.users.UpdateEmailVerified(ctx, ev.UserID, true); err != nil {
		return autherrors.Internal(err)
	}
	return nil
}

// =============================================================================
// Password Reset
// =============================================================================

func (s *AuthService) ForgotPassword(ctx context.Context, emailAddr string, m RequestMeta) error {
	emailAddr = strings.ToLower(strings.TrimSpace(emailAddr))

	rlKey := "rl:pwreset:" + m.IP.String()
	res, err := s.limiter.Allow(ctx, rlKey, s.cfg.RateLimit.PasswordResetPerHour, time.Hour)
	if err != nil {
		return autherrors.Internal(err)
	}
	if !res.Allowed {
		return autherrors.RateLimited(res.RetryAfter.String())
	}

	user, err := s.users.GetByEmail(ctx, emailAddr)
	if err != nil {
		// Always return success to prevent email enumeration
		return nil
	}

	_ = s.passwordRst.InvalidatePreviousForUser(ctx, user.ID)

	rawToken, err := crypto.RandomToken(32)
	if err != nil {
		return autherrors.Internal(err)
	}
	pr := &repository.PasswordReset{
		UserID:    user.ID,
		TokenHash: crypto.HashToken(rawToken),
		IPAddress: m.IP,
		ExpiresAt: time.Now().Add(s.cfg.Security.PasswordResetTokenTTL),
	}
	if err := s.passwordRst.Create(ctx, pr); err != nil {
		return autherrors.Internal(err)
	}

	_ = s.mail.Send(ctx, email.Message{
		To:       user.Email,
		Subject:  "Reset your Offense Conditions password",
		Template: "password_reset.html",
		Data: map[string]any{
			"ResetURL":  fmt.Sprintf("%s/reset-password?token=%s", s.cfg.OAuth.CallbackBase, rawToken),
			"ExpiresIn": s.cfg.Security.PasswordResetTokenTTL.String(),
		},
	})

	return nil
}

func (s *AuthService) ResetPassword(ctx context.Context, rawToken, newPassword string, m RequestMeta) error {
	pr, err := s.passwordRst.GetByHash(ctx, crypto.HashToken(rawToken))
	if err != nil {
		return autherrors.InvalidToken("reset token")
	}
	if pr.UsedAt != nil {
		return autherrors.InvalidToken("token already used")
	}
	if time.Now().After(pr.ExpiresAt) {
		return autherrors.ExpiredToken()
	}

	if err := crypto.ValidatePasswordStrength(newPassword, s.cfg.Security.MinPasswordLength); err != nil {
		return autherrors.New(autherrors.CodeWeakPassword, err.Error())
	}

	hash, err := crypto.HashPassword(newPassword, crypto.Argon2idParams{
		Time: s.cfg.Argon2.Time, Memory: s.cfg.Argon2.Memory,
		Threads: s.cfg.Argon2.Threads, KeyLen: s.cfg.Argon2.KeyLen, SaltLen: s.cfg.Argon2.SaltLen,
	})
	if err != nil {
		return autherrors.Internal(err)
	}

	if err := s.users.UpdatePassword(ctx, pr.UserID, hash); err != nil {
		return autherrors.Internal(err)
	}
	if err := s.passwordRst.MarkUsed(ctx, pr.ID); err != nil {
		return autherrors.Internal(err)
	}

	// Revoke all sessions and refresh tokens — force re-login everywhere
	_ = s.refreshes.RevokeAllForUser(ctx, pr.UserID, "password_reset")
	_ = s.sessions.RevokeAllForUser(ctx, pr.UserID)

	s.audit.PasswordChanged(ctx, pr.UserID, m.IP, m.RequestID)
	return nil
}

// =============================================================================
// Password Change (authenticated)
// =============================================================================

func (s *AuthService) ChangePassword(ctx context.Context, userID uuid.UUID, current, next string, m RequestMeta) error {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return autherrors.New(autherrors.CodeNotFound, "user not found")
	}

	valid, _, err := crypto.VerifyPassword(current, user.PasswordHash, crypto.Argon2idParams{
		Time: s.cfg.Argon2.Time, Memory: s.cfg.Argon2.Memory,
		Threads: s.cfg.Argon2.Threads, KeyLen: s.cfg.Argon2.KeyLen, SaltLen: s.cfg.Argon2.SaltLen,
	})
	if err != nil || !valid {
		return autherrors.InvalidCredentials()
	}
	if current == next {
		return autherrors.New(autherrors.CodeSamePassword, "New password cannot be the same as the old one")
	}
	if err := crypto.ValidatePasswordStrength(next, s.cfg.Security.MinPasswordLength); err != nil {
		return autherrors.New(autherrors.CodeWeakPassword, err.Error())
	}

	hash, err := crypto.HashPassword(next, crypto.Argon2idParams{
		Time: s.cfg.Argon2.Time, Memory: s.cfg.Argon2.Memory,
		Threads: s.cfg.Argon2.Threads, KeyLen: s.cfg.Argon2.KeyLen, SaltLen: s.cfg.Argon2.SaltLen,
	})
	if err != nil {
		return autherrors.Internal(err)
	}
	if err := s.users.UpdatePassword(ctx, userID, hash); err != nil {
		return autherrors.Internal(err)
	}

	_ = s.refreshes.RevokeAllForUser(ctx, userID, "password_change")
	s.audit.PasswordChanged(ctx, userID, m.IP, m.RequestID)
	return nil
}
