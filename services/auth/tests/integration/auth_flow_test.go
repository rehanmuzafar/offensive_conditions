// Package integration runs end-to-end auth flow tests against real Postgres + Redis.
// Requires Docker. Run with: go test -tags=integration ./tests/integration/...
//
//go:build integration

package integration_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/offensive-conditions/auth/internal/audit"
	"github.com/offensive-conditions/auth/internal/config"
	"github.com/offensive-conditions/auth/internal/email"
	"github.com/offensive-conditions/auth/internal/oauth"
	"github.com/offensive-conditions/auth/internal/ratelimit"
	"github.com/offensive-conditions/auth/internal/repository"
	"github.com/offensive-conditions/auth/internal/service"
	"github.com/offensive-conditions/auth/internal/tokens"
)

// testEnv encapsulates test dependencies.
// In a full implementation this would spin up Postgres + Redis via testcontainers-go.
// For now we expect DATABASE_URL and REDIS_URL env vars pointing to dev instances.
type testEnv struct {
	cfg       *config.Config
	pool      *pgxpool.Pool
	rdb       *redis.Client
	svc       *service.AuthService
	noopMail  *email.NoopSender
	cleanupFns []func()
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://offcon_admin:devpass@localhost:5432/offcon?sslmode=disable"
	}
	redisAddr := os.Getenv("TEST_REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	pool, err := repository.NewPool(ctx, repository.PoolConfig{
		DSN: dbURL, MaxConns: 5, MinConns: 1,
	})
	require.NoError(t, err)

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	require.NoError(t, rdb.Ping(ctx).Err())

	// Generate test JWT keys
	privPath, pubPath := genTestKeys(t)

	cfg := &config.Config{
		App: config.AppConfig{Env: "development", Name: "auth-test", Version: "test"},
		JWT: config.JWTConfig{
			PrivateKeyPath: privPath, PublicKeyPath: pubPath,
			Issuer: "https://test.offensiveconditions.org", Audience: "test-api",
			AccessTTL: 15 * time.Minute, RefreshTTL: 24 * time.Hour, ClockSkew: 5 * time.Second,
		},
		Argon2: config.Argon2Config{Time: 1, Memory: 16 * 1024, Threads: 1, KeyLen: 32, SaltLen: 16},
		RateLimit: config.RateLimitConfig{
			LoginPerMinute: 100, RegisterPerHour: 100,
			PasswordResetPerHour: 100, EmailVerifyPerHour: 100,
		},
		Security: config.SecurityConfig{
			FailedLoginsBeforeLock: 5, AccountLockDuration: 15 * time.Minute,
			EmailVerificationRequired: false, // simpler for tests
			EmailVerifyTokenTTL: 1 * time.Hour, PasswordResetTokenTTL: 1 * time.Hour,
			SessionTTL: 24 * time.Hour, BackupCodesCount: 10, MinPasswordLength: 12,
		},
		OAuth: config.OAuthConfig{
			CallbackBase: "http://localhost/oauth", StateSecret: "test-state-secret",
			StateTTL: 10 * time.Minute,
		},
	}

	jwt, err := tokens.NewJWTIssuer(tokens.JWTConfig{
		PrivateKeyPath: privPath, PublicKeyPath: pubPath,
		Issuer: cfg.JWT.Issuer, Audience: cfg.JWT.Audience,
		AccessTTL: cfg.JWT.AccessTTL, ClockSkew: cfg.JWT.ClockSkew,
	})
	require.NoError(t, err)

	tfaKey := make([]byte, 32)
	_, _ = rand.Read(tfaKey)

	noopMail := &email.NoopSender{}
	logger := zerolog.Nop()

	env := &testEnv{
		cfg: cfg, pool: pool, rdb: rdb, noopMail: noopMail,
	}

	env.svc = service.New(service.Deps{
		Cfg: cfg, Log: logger,
		Users:         repository.NewPGUserRepo(pool),
		TFASecrets:    repository.NewPGTFASecretRepo(pool),
		Refreshes:     repository.NewPGRefreshTokenRepo(pool),
		Sessions:      repository.NewPGSessionRepo(pool),
		EmailVerify:   repository.NewPGEmailVerificationRepo(pool),
		PasswordRst:   repository.NewPGPasswordResetRepo(pool),
		LoginAttempts: repository.NewPGLoginAttemptRepo(pool),
		OAuthLinks:    repository.NewPGOAuthLinkRepo(pool),
		JWT:           jwt,
		TOTP:          tokens.NewTOTPManager("offcon-test"),
		Limiter:       ratelimit.NewLimiter(rdb),
		Mail:          noopMail,
		Audit:         audit.New(pool, "auth-test", logger),
		OAuthRegistry: oauth.NewRegistry(),
		TFAEncKey:     tfaKey,
	})

	env.cleanupFns = append(env.cleanupFns,
		func() { pool.Close() },
		func() { rdb.Close() },
	)

	return env
}

func (e *testEnv) cleanup(t *testing.T) {
	for _, fn := range e.cleanupFns {
		fn()
	}
}

// cleanupUser removes a test user and dependent data.
func (e *testEnv) cleanupUser(t *testing.T, email string) {
	ctx := context.Background()
	_, _ = e.pool.Exec(ctx, `DELETE FROM auth.login_attempts WHERE email_attempted = $1`, email)
	_, _ = e.pool.Exec(ctx, `DELETE FROM auth.users WHERE email = $1`, email)
}

func genTestKeys(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	privBytes := x509.MarshalPKCS1PrivateKey(priv)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: privBytes})
	privPath := filepath.Join(dir, "p.pem")
	require.NoError(t, os.WriteFile(privPath, privPEM, 0o600))
	pubBytes, _ := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})
	pubPath := filepath.Join(dir, "pub.pem")
	require.NoError(t, os.WriteFile(pubPath, pubPEM, 0o644))
	return privPath, pubPath
}

func unique(prefix string) string {
	id := uuid.New().String()[:8]
	return fmt.Sprintf("%s_%s", prefix, id)
}

// =============================================================================
// Test: full registration → login → refresh flow
// =============================================================================

func TestFullAuthFlow(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup(t)

	ctx := context.Background()
	emailAddr := fmt.Sprintf("%s@test.offensiveconditions.org", unique("user"))
	username := unique("user")
	password := "TestPass123!@#"

	defer env.cleanupUser(t, emailAddr)

	meta := service.RequestMeta{
		IP: netip.MustParseAddr("127.0.0.1"), UserAgent: "test-agent",
		RequestID: uuid.New().String(),
	}

	// 1. Register
	regOut, err := env.svc.Register(ctx, service.RegisterInput{
		Email: emailAddr, Username: username, Password: password,
	}, meta)
	require.NoError(t, err)
	require.NotEqual(t, uuid.Nil, regOut.UserID)

	// 2. Login
	loginOut, err := env.svc.Login(ctx, service.LoginInput{
		Email: emailAddr, Password: password,
	}, meta)
	require.NoError(t, err)
	require.NotEmpty(t, loginOut.AccessToken)
	require.NotEmpty(t, loginOut.RefreshToken)
	require.Empty(t, loginOut.TFAChallenge, "fresh user should not need 2FA")

	// 3. Refresh
	refreshed, err := env.svc.Refresh(ctx, loginOut.RefreshToken, meta)
	require.NoError(t, err)
	require.NotEmpty(t, refreshed.AccessToken)
	require.NotEqual(t, loginOut.RefreshToken, refreshed.RefreshToken,
		"refresh token must rotate")

	// 4. Reuse old refresh token → must trigger theft detection
	_, err = env.svc.Refresh(ctx, loginOut.RefreshToken, meta)
	require.Error(t, err, "reused refresh token must be rejected")
}

// =============================================================================
// Test: failed logins lock the account
// =============================================================================

func TestAccountLockAfterFailedLogins(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup(t)

	ctx := context.Background()
	emailAddr := fmt.Sprintf("%s@test.offensiveconditions.org", unique("lock"))
	defer env.cleanupUser(t, emailAddr)

	password := "RealPass123!@#"
	meta := service.RequestMeta{
		IP: netip.MustParseAddr("127.0.0.1"), RequestID: uuid.New().String(),
	}

	_, err := env.svc.Register(ctx, service.RegisterInput{
		Email: emailAddr, Username: unique("u"), Password: password,
	}, meta)
	require.NoError(t, err)

	// 5 failed attempts trigger lock
	for i := 0; i < env.cfg.Security.FailedLoginsBeforeLock; i++ {
		_, err := env.svc.Login(ctx, service.LoginInput{
			Email: emailAddr, Password: "WrongPass!",
		}, meta)
		require.Error(t, err)
	}

	// Now even correct password should fail (account locked)
	_, err = env.svc.Login(ctx, service.LoginInput{
		Email: emailAddr, Password: password,
	}, meta)
	require.Error(t, err)
}

// =============================================================================
// Test: 2FA flow
// =============================================================================

func TestTFAEnrollAndLogin(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup(t)

	ctx := context.Background()
	emailAddr := fmt.Sprintf("%s@test.offensiveconditions.org", unique("tfa"))
	defer env.cleanupUser(t, emailAddr)

	password := "TFAPass123!@#"
	meta := service.RequestMeta{
		IP: netip.MustParseAddr("127.0.0.1"), RequestID: uuid.New().String(),
	}

	regOut, err := env.svc.Register(ctx, service.RegisterInput{
		Email: emailAddr, Username: unique("u"), Password: password,
	}, meta)
	require.NoError(t, err)

	// Enroll 2FA
	enrollment, err := env.svc.EnrollTFA(ctx, regOut.UserID, meta)
	require.NoError(t, err)
	require.NotEmpty(t, enrollment.Secret)
	require.NotEmpty(t, enrollment.OtpAuthURL)
	require.Len(t, enrollment.BackupCodes, 10)

	// Generate a code from the secret (using same library the service uses)
	code, err := totpFromSecret(enrollment.Secret)
	require.NoError(t, err)

	// Confirm enrollment
	require.NoError(t, env.svc.ConfirmTFA(ctx, regOut.UserID, code, meta))

	// Login now returns a TFA challenge instead of tokens
	loginOut, err := env.svc.Login(ctx, service.LoginInput{
		Email: emailAddr, Password: password,
	}, meta)
	require.NoError(t, err)
	require.NotEmpty(t, loginOut.TFAChallenge)
	require.Empty(t, loginOut.AccessToken)

	// Submit TOTP code to complete login
	freshCode, err := totpFromSecret(enrollment.Secret)
	require.NoError(t, err)
	final, err := env.svc.LoginTFA(ctx, loginOut.TFAChallenge, freshCode, meta)
	require.NoError(t, err)
	require.NotEmpty(t, final.AccessToken)
	require.NotEmpty(t, final.RefreshToken)
}

func totpFromSecret(secret string) (string, error) {
	return totp_GenerateCode(secret, time.Now())
}

// alias to avoid an extra import
func totp_GenerateCode(secret string, t time.Time) (string, error) {
	// Use the same totp package the service uses
	return generateTOTPCode(secret, t)
}

// Forward declaration — implemented in helper file
var generateTOTPCode = func(secret string, t time.Time) (string, error) {
	return "", fmt.Errorf("not implemented")
}
