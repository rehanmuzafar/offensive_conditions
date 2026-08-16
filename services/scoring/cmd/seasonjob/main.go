// Package main runs scheduled jobs:
//   - hourly: check & rollover due seasons
//   - daily:  ELO decay for inactive players, streak invalidation
//
// Single instance only (use Kubernetes Job or a leader-elected Deployment).
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/robfig/cron/v3"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/offensive-conditions/scoring/internal/config"
	"github.com/offensive-conditions/scoring/internal/elo"
	"github.com/offensive-conditions/scoring/internal/leaderboard"
	"github.com/offensive-conditions/scoring/internal/repository"
	"github.com/offensive-conditions/scoring/internal/seasons"
)

func main() {
	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("scoring seasonjob failed")
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := newLogger(cfg.Log.Level, cfg.Log.Format)
	logger.Info().Msg("starting scoring seasonjob")

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- DB ---
	pool, err := repository.NewPool(rootCtx, repository.PoolConfig{
		DSN: cfg.DB.DSN(), MaxConns: int32(cfg.DB.MaxConns), MinConns: int32(cfg.DB.MinConns),
	})
	if err != nil {
		return err
	}
	defer pool.Close()

	// --- Redis ---
	rdb := redis.NewClient(&redis.Options{
		Addr: cfg.Redis.Addr, Password: cfg.Redis.Password,
		DB: cfg.Redis.DB, PoolSize: cfg.Redis.PoolSize,
	})
	defer rdb.Close()
	if err := rdb.Ping(rootCtx).Err(); err != nil {
		return err
	}

	// --- Repos ---
	seasonRepo := repository.NewPGSeasonRepo(pool)
	seasonScoreRepo := repository.NewPGSeasonUserScoreRepo(pool)
	seasonSnapshotRepo := repository.NewPGSeasonSnapshotRepo(pool)
	eloRepo := repository.NewPGELORepo(pool)
	userScoreRepo := repository.NewPGUserScoreRepo(pool)

	// --- Engines ---
	lbManager := leaderboard.NewManager(rdb, logger.With().Str("component", "leaderboard").Logger())
	seasonManager := seasons.NewManager(seasons.Deps{
		Cfg: cfg, Log: logger.With().Str("component", "seasons").Logger(),
		Seasons: seasonRepo, SeasonScores: seasonScoreRepo,
		Snapshots: seasonSnapshotRepo, Leaderboards: lbManager,
	})
	eloCalc := elo.NewCalculator(elo.Config{
		InitialRating:       cfg.ELO.InitialRating,
		KFactorDefault:      cfg.ELO.KFactorDefault,
		KFactorHigh:         cfg.ELO.KFactorHigh,
		KFactorProvisional:  cfg.ELO.KFactorProvisional,
		HighRatingThreshold: cfg.ELO.HighRatingThreshold,
		ProvisionalMatches:  cfg.ELO.ProvisionalMatches,
		InactivityDays:      cfg.ELO.InactivityDays,
		DecayPerCycle:       cfg.ELO.DecayPerCycle,
	})

	jobs := &Jobs{
		log: logger,
		seasonManager: seasonManager,
		eloRepo: eloRepo,
		eloCalc: eloCalc,
		userScoreRepo: userScoreRepo,
		cfg: cfg,
	}

	// Cron schedule
	c := cron.New(cron.WithLogger(cronLogger{log: logger.With().Str("component", "cron").Logger()}))
	// Every hour, check for season rollover
	if _, err := c.AddFunc("0 * * * *", jobs.SeasonRolloverCheck); err != nil {
		return err
	}
	// Daily at 03:15 UTC, decay ELO for inactive players
	if _, err := c.AddFunc("15 3 * * *", jobs.ELODecay); err != nil {
		return err
	}
	// Daily at 03:30 UTC, validate streaks
	if _, err := c.AddFunc("30 3 * * *", jobs.StreakValidation); err != nil {
		return err
	}
	c.Start()
	logger.Info().Msg("cron started")

	// --- Metrics ---
	metricsPort := cfg.HTTP.Port + 2000 // 10003 if HTTP_PORT=8003
	go startMetricsServer(rootCtx, metricsPort, logger)

	// Run an immediate check on startup so a stuck rollover doesn't wait an hour
	go jobs.SeasonRolloverCheck()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")

	ctx := c.Stop()
	select {
	case <-ctx.Done():
	case <-time.After(30 * time.Second):
		logger.Warn().Msg("cron jobs did not finish within 30s")
	}
	logger.Info().Msg("scoring seasonjob stopped")
	return nil
}

// =============================================================================
// Jobs
// =============================================================================

type Jobs struct {
	log           zerolog.Logger
	seasonManager *seasons.Manager
	eloRepo       repository.ELORepository
	eloCalc       *elo.Calculator
	userScoreRepo repository.UserScoreRepository
	cfg           *config.Config
}

func (j *Jobs) SeasonRolloverCheck() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	log := j.log.With().Str("job", "season-rollover-check").Logger()
	log.Info().Msg("running")
	if err := j.seasonManager.CheckAndRolloverDue(ctx); err != nil {
		log.Error().Err(err).Msg("failed")
		return
	}
	log.Info().Msg("done")
}

func (j *Jobs) ELODecay() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	log := j.log.With().Str("job", "elo-decay").Logger()
	log.Info().Msg("running")

	cutoff := time.Now().Add(-time.Duration(j.cfg.ELO.InactivityDays) * 24 * time.Hour)

	// Process in batches of 500
	const batchSize = 500
	totalDecayed := 0
	for {
		batch, err := j.eloRepo.ListInactive(ctx, cutoff, batchSize)
		if err != nil {
			log.Error().Err(err).Msg("list inactive failed")
			return
		}
		if len(batch) == 0 {
			break
		}
		for _, r := range batch {
			decay := j.eloCalc.DecayAmount(r.Rating)
			if decay == 0 {
				continue
			}
			r.Rating -= decay
			now := time.Now()
			r.LastDecayAt = &now
			if err := j.eloRepo.Upsert(ctx, r); err != nil {
				log.Warn().Err(err).Str("user_id", r.UserID.String()).Msg("decay update failed")
				continue
			}
			totalDecayed++
		}
		if len(batch) < batchSize {
			break
		}
	}
	log.Info().Int("decayed", totalDecayed).Msg("done")
}

// StreakValidation resets streaks for users who missed a day.
func (j *Jobs) StreakValidation() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	log := j.log.With().Str("job", "streak-validation").Logger()
	log.Info().Msg("running")

	n, err := j.userScoreRepo.ResetBrokenStreaks(ctx)
	if err != nil {
		log.Error().Err(err).Msg("streak reset failed")
		return
	}
	log.Info().Int64("reset_count", n).Msg("done")
}

// =============================================================================
// Helpers
// =============================================================================

func startMetricsServer(ctx context.Context, port int, log zerolog.Logger) {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	srv := &http.Server{Addr: ":" + strconv.Itoa(port), Handler: mux, ReadTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Info().Int("port", port).Msg("metrics server listening")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error().Err(err).Msg("metrics server failed")
	}
}

func newLogger(level, format string) zerolog.Logger {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lvl)
	zerolog.TimeFieldFormat = time.RFC3339Nano
	if format == "console" {
		return zerolog.New(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}).
			With().Timestamp().Str("svc", "scoring-seasonjob").Logger()
	}
	return zerolog.New(os.Stdout).With().Timestamp().Str("svc", "scoring-seasonjob").Logger()
}

// cronLogger adapts zerolog to robfig/cron's logger interface.
type cronLogger struct {
	log zerolog.Logger
}

func (cl cronLogger) Info(msg string, keysAndValues ...any) {
	cl.log.Info().Fields(keysAndValues).Msg(msg)
}
func (cl cronLogger) Error(err error, msg string, keysAndValues ...any) {
	cl.log.Error().Err(err).Fields(keysAndValues).Msg(msg)
}
