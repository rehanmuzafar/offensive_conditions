//go:build integration
// +build integration

// Package integration runs end-to-end tests against a real Postgres + Redis.
//
// Run with: make test-integration
// Needs env: TEST_DB_DSN, TEST_REDIS_ADDR
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

	"github.com/offensive-conditions/scoring/internal/badges"
	"github.com/offensive-conditions/scoring/internal/config"
	"github.com/offensive-conditions/scoring/internal/elo"
	"github.com/offensive-conditions/scoring/internal/leaderboard"
	"github.com/offensive-conditions/scoring/internal/points"
	"github.com/offensive-conditions/scoring/internal/producers"
	"github.com/offensive-conditions/scoring/internal/repository"
	"github.com/offensive-conditions/scoring/internal/service"
)

func TestAwardFlow_EndToEnd(t *testing.T) {
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

	// Clean state for test
	userID := uuid.New()
	machineID := uuid.New()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM scoring.user_scores WHERE user_id = $1", userID)
		_, _ = pool.Exec(ctx, "DELETE FROM scoring.owns WHERE user_id = $1", userID)
		_, _ = pool.Exec(ctx, "DELETE FROM scoring.submissions WHERE user_id = $1", userID)
		rdb.Del(ctx, "lb:global:all")
	})

	cfg := &config.Config{
		App:    config.AppConfig{Env: "test"},
		Points: defaultPointsConfig(),
		ELO:    defaultELOConfig(),
	}
	require.NoError(t, cfg.Validate())

	log := zerolog.New(os.Stderr).Level(zerolog.WarnLevel)

	// Build the service
	submissionRepo := repository.NewPGSubmissionRepo(pool)
	ownRepo := repository.NewPGOwnRepo(pool)
	phRepo := repository.NewPGPointHistoryRepo(pool)
	usRepo := repository.NewPGUserScoreRepo(pool)
	achRepo := repository.NewPGAchievementRepo(pool)
	uaRepo := repository.NewPGUserAchievementRepo(pool)
	rtRepo := repository.NewPGRankTierRepo(pool)
	sRepo := repository.NewPGSeasonRepo(pool)
	susRepo := repository.NewPGSeasonUserScoreRepo(pool)
	ssRepo := repository.NewPGSeasonSnapshotRepo(pool)
	eRepo := repository.NewPGELORepo(pool)
	daRepo := repository.NewPGDailyActivityRepo(pool)

	lbManager := leaderboard.NewManager(rdb, log)
	pointsCalc := points.NewCalculator(points.DefaultConfig())
	eloCalc := elo.NewCalculator(elo.DefaultConfig())
	badgeEngine := badges.NewEngine(badges.Deps{
		Log: log, Achievements: achRepo, UserAchievements: uaRepo,
		Owns: ownRepo, UserScores: usRepo,
	})
	noopPub := &producers.NoopPublisher{}

	svc := service.New(service.Deps{
		Cfg: cfg, Log: log,
		PointsCalc: pointsCalc, ELOCalc: eloCalc,
		Leaderboards: lbManager, BadgeEngine: badgeEngine,
		EventPublisher: noopPub,
		Submissions:    submissionRepo, Owns: ownRepo,
		PointHistory: phRepo, UserScores: usRepo,
		Achievements: achRepo, UserAchievements: uaRepo,
		RankTiers: rtRepo, Seasons: sRepo, SeasonScores: susRepo,
		SeasonSnapshots: ssRepo, ELORepo: eRepo, DailyActivity: daRepo,
	})

	// --- Execute: award solve ---
	result, err := svc.AwardSolve(ctx, service.AwardInput{
		UserID:      userID,
		ContentType: "machine",
		ContentID:   machineID,
		FlagType:    "root",
		Difficulty:  "medium",
		FlagHash:    "abc123def456",
		SubmittedAt: time.Now(),
	})
	require.NoError(t, err)
	require.NotNil(t, result)

	// --- Assertions ---
	assert.False(t, result.WasAlreadyOwned)
	assert.False(t, result.WasBlocked)
	assert.Greater(t, result.PointsAwarded, 0)
	assert.Equal(t, int64(result.PointsAwarded), result.NewTotalPoints)

	// User score row should exist
	score, err := usRepo.Get(ctx, userID)
	require.NoError(t, err)
	assert.Equal(t, int64(result.PointsAwarded), score.TotalPoints)
	assert.Equal(t, 1, score.MachinesOwned)
	assert.Equal(t, 1, score.RootFlagsCount)

	// Leaderboard should have the user
	entries, err := lbManager.Top(ctx, leaderboard.ScopeGlobalAll, "", 10, 0)
	require.NoError(t, err)
	found := false
	for _, e := range entries {
		if e.UserID == userID {
			found = true
			assert.Equal(t, int64(result.PointsAwarded), e.Score)
		}
	}
	assert.True(t, found, "user should be on global leaderboard")

	// Idempotency: replay same solve
	result2, err := svc.AwardSolve(ctx, service.AwardInput{
		UserID:      userID,
		ContentType: "machine",
		ContentID:   machineID,
		FlagType:    "root",
		Difficulty:  "medium",
		FlagHash:    "abc123def456",
		SubmittedAt: time.Now(),
	})
	require.NoError(t, err)
	assert.True(t, result2.WasAlreadyOwned, "replay should be idempotent")
}

func defaultPointsConfig() config.PointsConfig {
	return config.PointsConfig{
		BasePointsVeryEasy: 10, BasePointsEasy: 20, BasePointsMedium: 30,
		BasePointsHard: 40, BasePointsInsane: 50,
		UserFlagShare: 0.30, RootFlagShare: 0.70,
		FirstBloodMult: 1.50, SecondBloodMult: 1.25, ThirdBloodMult: 1.10,
		TimeDecayDays: 365, TimeDecayFloor: 0.50,
	}
}

func defaultELOConfig() config.ELOConfig {
	return config.ELOConfig{
		InitialRating: 1500, KFactorDefault: 32, KFactorHigh: 16,
		HighRatingThreshold: 2400, ProvisionalMatches: 10, KFactorProvisional: 40,
		InactivityDays: 60, DecayPerCycle: 25,
	}
}
