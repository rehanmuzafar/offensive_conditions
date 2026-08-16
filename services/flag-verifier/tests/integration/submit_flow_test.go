//go:build integration
// +build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/offensive-conditions/flag-verifier/internal/config"
	hmacpkg "github.com/offensive-conditions/flag-verifier/internal/hmac"
	"github.com/offensive-conditions/flag-verifier/internal/idempotency"
	"github.com/offensive-conditions/flag-verifier/internal/producers"
	"github.com/offensive-conditions/flag-verifier/internal/ratelimit"
	"github.com/offensive-conditions/flag-verifier/internal/repository"
	"github.com/offensive-conditions/flag-verifier/internal/secrets"
	"github.com/offensive-conditions/flag-verifier/internal/service"
)

// noopPublisher captures events in memory for assertions.
type noopPublisher struct {
	correct   []producers.CorrectFlagData
	incorrect []producers.IncorrectFlagData
}

func (n *noopPublisher) PublishCorrect(_ context.Context, _ uuid.UUID, _ *uuid.UUID, _ *uuid.UUID, d producers.CorrectFlagData, _ string) error {
	n.correct = append(n.correct, d)
	return nil
}

func (n *noopPublisher) PublishIncorrect(_ context.Context, _ uuid.UUID, _ *uuid.UUID, d producers.IncorrectFlagData, _ string) error {
	n.incorrect = append(n.incorrect, d)
	return nil
}

func TestSubmitFlow_EndToEnd(t *testing.T) {
	dsn := os.Getenv("TEST_DB_DSN")
	redisAddr := os.Getenv("TEST_REDIS_ADDR")
	if dsn == "" || redisAddr == "" {
		t.Skip("set TEST_DB_DSN and TEST_REDIS_ADDR to run integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// --- Setup ---
	pool, err := repository.NewPool(ctx, repository.PoolConfig{DSN: dsn, MaxConns: 5})
	require.NoError(t, err)
	defer pool.Close()

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	require.NoError(t, rdb.Ping(ctx).Err())
	defer rdb.Close()

	userID := uuid.New()
	contentID := uuid.New()
	instanceID := uuid.New()
	machineID := contentID
	masterSecret := "test-master-secret-do-not-use-in-prod"

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM scoring.submissions WHERE user_id = $1", userID)
		_, _ = pool.Exec(ctx, "DELETE FROM scoring.owns WHERE user_id = $1", userID)
		_, _ = pool.Exec(ctx, "DELETE FROM lab.lab_instances WHERE id = $1", instanceID)
		rdb.FlushDB(ctx)
	})

	// Insert a fake lab instance so the ownership check passes
	_, err = pool.Exec(ctx, `
		INSERT INTO lab.lab_instances (id, user_id, machine_id, state, spawned_at, expires_at, network_cidr)
		VALUES ($1, $2, $3, 'running', NOW(), NOW() + INTERVAL '1 hour', '10.10.0.0/30')
		ON CONFLICT (id) DO NOTHING`,
		instanceID, userID, machineID)
	require.NoError(t, err)

	cfg := &config.Config{
		App: config.AppConfig{Env: "test"},
		FlagFormat: config.FlagFormatConfig{
			Prefix: "OFFCON{", Suffix: "}", HMACBytes: 16, MaxLength: 256,
		},
		RateLimit: config.RateLimitConfig{
			PerContentPerMin: 10, PerUserPerMin: 100, PerIPPerMin: 200,
			CooldownSeconds: 60, IPCooldownSeconds: 300, WindowSeconds: 60,
		},
		Idempotency: config.IdempotencyConfig{TTLSeconds: 60, Enabled: true},
	}

	log := zerolog.New(os.Stderr).Level(zerolog.WarnLevel)

	parser := hmacpkg.NewParser("OFFCON{", "}", 16, 256)
	verifier := hmacpkg.NewVerifier(16)
	limiter := ratelimit.New(rdb, ratelimit.Config{
		PerContentPerMin: 10, PerUserPerMin: 100, PerIPPerMin: 200,
		CooldownSeconds: 60, IPCooldownSeconds: 300, WindowSeconds: 60,
	}, log)
	idemCache := idempotency.New(rdb, idempotency.Config{
		TTL: 60 * time.Second, Enabled: true,
	}, log)
	secretsStore := secrets.NewStaticStore(map[string]string{}, masterSecret)
	publisher := &noopPublisher{}

	svc := service.New(service.Deps{
		Cfg: cfg, Log: log,
		Parser: parser, HMACVerifier: verifier,
		RateLimit: limiter, IdemCache: idemCache,
		Secrets: secretsStore, Publisher: publisher,
		Submissions: repository.NewPGSubmissionRepo(pool),
		Owns:        repository.NewPGOwnsLookup(pool),
		Instances:   repository.NewPGInstanceLookup(pool),
		Machines:    repository.NewPGMachineLookup(pool),
	})

	// --- Test 1: Generate a valid flag and submit it ---
	hmacHex := hmacpkg.ComputeHMAC([]byte(masterSecret), machineID, userID, instanceID, 16)
	flagStr := hmacpkg.BuildFlag("OFFCON{", "}", "test_machine", userID, hmacHex)

	res, sErr := svc.SubmitFlag(ctx, service.SubmitInput{
		UserID:      userID,
		ContentType: "machine",
		ContentID:   contentID,
		InstanceID:  &instanceID,
		Flag:        flagStr,
		IPAddress:   "192.168.1.100",
		UserAgent:   "test-agent",
		RequestID:   uuid.NewString(),
	})
	require.Nil(t, sErr)
	require.NotNil(t, res)
	assert.True(t, res.Accepted, "correct flag should be accepted")
	assert.NotEqual(t, uuid.Nil, res.SubmissionID)
	assert.Len(t, publisher.correct, 1, "should emit one correct event")
	assert.Empty(t, publisher.incorrect)

	// --- Test 2: Wrong flag ---
	wrongFlag := hmacpkg.BuildFlag("OFFCON{", "}", "test_machine", userID, "00000000000000000000000000000000")
	res2, sErr := svc.SubmitFlag(ctx, service.SubmitInput{
		UserID:      userID,
		ContentType: "machine",
		ContentID:   contentID,
		InstanceID:  &instanceID,
		Flag:        wrongFlag,
		IPAddress:   "192.168.1.100",
		RequestID:   uuid.NewString(),
	})
	require.Nil(t, sErr)
	require.NotNil(t, res2)
	assert.False(t, res2.Accepted)
	assert.Equal(t, "wrong_flag", res2.RejectionReason)
	assert.Len(t, publisher.incorrect, 1, "should emit one incorrect event")

	// --- Test 3: Replay (idempotency cache) ---
	res3, sErr := svc.SubmitFlag(ctx, service.SubmitInput{
		UserID:      userID,
		ContentType: "machine",
		ContentID:   contentID,
		InstanceID:  &instanceID,
		Flag:        flagStr, // same flag as test 1
		IPAddress:   "192.168.1.100",
		RequestID:   uuid.NewString(),
	})
	require.Nil(t, sErr)
	assert.True(t, res3.Accepted)
	assert.True(t, res3.FromCache, "should hit idempotency cache")
	// Should still only have 1 correct event (cache prevents re-publish)
	assert.Len(t, publisher.correct, 1)

	// --- Test 4: Malformed flag ---
	res4, sErr := svc.SubmitFlag(ctx, service.SubmitInput{
		UserID:      userID,
		ContentType: "machine",
		ContentID:   contentID,
		InstanceID:  &instanceID,
		Flag:        "this is not a valid flag at all",
		IPAddress:   "192.168.1.100",
		RequestID:   uuid.NewString(),
	})
	require.Nil(t, sErr)
	assert.False(t, res4.Accepted)
	assert.Equal(t, "malformed_flag", res4.RejectionReason)
}

func TestSubmitFlow_RateLimit(t *testing.T) {
	dsn := os.Getenv("TEST_DB_DSN")
	redisAddr := os.Getenv("TEST_REDIS_ADDR")
	if dsn == "" || redisAddr == "" {
		t.Skip("set TEST_DB_DSN and TEST_REDIS_ADDR to run integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := repository.NewPool(ctx, repository.PoolConfig{DSN: dsn, MaxConns: 5})
	require.NoError(t, err)
	defer pool.Close()

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	require.NoError(t, rdb.Ping(ctx).Err())
	defer rdb.Close()

	userID := uuid.New()
	contentID := uuid.New()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM scoring.submissions WHERE user_id = $1", userID)
		rdb.FlushDB(ctx)
	})

	log := zerolog.New(os.Stderr).Level(zerolog.WarnLevel)

	// Very tight limit for testing: 3 per minute
	limiter := ratelimit.New(rdb, ratelimit.Config{
		PerContentPerMin: 3, PerUserPerMin: 100, PerIPPerMin: 200,
		CooldownSeconds: 60, WindowSeconds: 60,
	}, log)
	idemCache := idempotency.New(rdb, idempotency.Config{
		TTL: 1 * time.Second, Enabled: false, // disable so each call hits limiter
	}, log)

	cfg := &config.Config{
		App:        config.AppConfig{Env: "test"},
		FlagFormat: config.FlagFormatConfig{Prefix: "OFFCON{", Suffix: "}", HMACBytes: 16, MaxLength: 256},
	}

	svc := service.New(service.Deps{
		Cfg: cfg, Log: log,
		Parser:       hmacpkg.NewParser("OFFCON{", "}", 16, 256),
		HMACVerifier: hmacpkg.NewVerifier(16),
		RateLimit:    limiter,
		IdemCache:    idemCache,
		Secrets:      secrets.NewStaticStore(map[string]string{}, "secret"),
		Publisher:    &noopPublisher{},
		Submissions:  repository.NewPGSubmissionRepo(pool),
		Owns:         repository.NewPGOwnsLookup(pool),
		Instances:    repository.NewPGInstanceLookup(pool),
		Machines:     repository.NewPGMachineLookup(pool),
	})

	flag := "OFFCON{slug_aaaaaa_00000000000000000000000000000000}"

	// First 3 should succeed (or at least not get rate limited)
	for i := 0; i < 3; i++ {
		_, sErr := svc.SubmitFlag(ctx, service.SubmitInput{
			UserID:      userID,
			ContentType: "machine",
			ContentID:   contentID,
			Flag:        flag,
			IPAddress:   "192.168.1.200",
		})
		require.Nil(t, sErr, "attempt %d should not be rate limited", i+1)
	}

	// 4th should be rate limited
	_, sErr := svc.SubmitFlag(ctx, service.SubmitInput{
		UserID:      userID,
		ContentType: "machine",
		ContentID:   contentID,
		Flag:        flag,
		IPAddress:   "192.168.1.200",
	})
	require.NotNil(t, sErr)
	assert.Equal(t, "RATE_LIMITED", string(sErr.Code))
	assert.Greater(t, sErr.RetryAfterSeconds, 0)
}
