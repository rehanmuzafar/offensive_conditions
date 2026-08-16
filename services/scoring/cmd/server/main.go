// Package main starts the scoring HTTP API.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/offensive-conditions/scoring/internal/auth"
	"github.com/offensive-conditions/scoring/internal/badges"
	"github.com/offensive-conditions/scoring/internal/config"
	"github.com/offensive-conditions/scoring/internal/elo"
	"github.com/offensive-conditions/scoring/internal/handlers"
	"github.com/offensive-conditions/scoring/internal/leaderboard"
	"github.com/offensive-conditions/scoring/internal/middleware"
	"github.com/offensive-conditions/scoring/internal/points"
	"github.com/offensive-conditions/scoring/internal/producers"
	"github.com/offensive-conditions/scoring/internal/repository"
	"github.com/offensive-conditions/scoring/internal/seasons"
	"github.com/offensive-conditions/scoring/internal/service"
)

func main() {
	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("scoring server failed")
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := newLogger(cfg.Log.Level, cfg.Log.Format)
	logger.Info().Str("env", cfg.App.Env).Str("version", cfg.App.Version).Msg("starting scoring server")

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

	// --- Auth validator ---
	validator, err := auth.NewValidator(auth.Config{
		PublicKeyPath: cfg.Auth.JWTPublicKeyPath,
		Issuer:        cfg.Auth.JWTIssuer,
		Audience:      cfg.Auth.JWTAudience,
		ClockSkew:     cfg.Auth.JWTClockSkew,
		CacheTTL:      cfg.Auth.TokenCacheTTL,
	})
	if err != nil {
		return err
	}

	// --- Repositories ---
	submissionRepo := repository.NewPGSubmissionRepo(pool)
	ownRepo := repository.NewPGOwnRepo(pool)
	pointHistoryRepo := repository.NewPGPointHistoryRepo(pool)
	userScoreRepo := repository.NewPGUserScoreRepo(pool)
	achievementRepo := repository.NewPGAchievementRepo(pool)
	userAchievementRepo := repository.NewPGUserAchievementRepo(pool)
	rankTierRepo := repository.NewPGRankTierRepo(pool)
	seasonRepo := repository.NewPGSeasonRepo(pool)
	seasonScoreRepo := repository.NewPGSeasonUserScoreRepo(pool)
	seasonSnapshotRepo := repository.NewPGSeasonSnapshotRepo(pool)
	eloRepo := repository.NewPGELORepo(pool)
	dailyActivityRepo := repository.NewPGDailyActivityRepo(pool)
	cheatFlagRepo := repository.NewPGCheatFlagRepo(pool)

	// --- Engines ---
	pointsCalc := points.NewCalculator(points.Config{
		BaseByDifficulty: map[points.Difficulty]int{
			points.VeryEasy: cfg.Points.BasePointsVeryEasy,
			points.Easy:     cfg.Points.BasePointsEasy,
			points.Medium:   cfg.Points.BasePointsMedium,
			points.Hard:     cfg.Points.BasePointsHard,
			points.Insane:   cfg.Points.BasePointsInsane,
		},
		UserShare:       cfg.Points.UserFlagShare,
		RootShare:       cfg.Points.RootFlagShare,
		FirstBloodMult:  cfg.Points.FirstBloodMult,
		SecondBloodMult: cfg.Points.SecondBloodMult,
		ThirdBloodMult:  cfg.Points.ThirdBloodMult,
		DecayDays:       cfg.Points.TimeDecayDays,
		DecayFloor:      cfg.Points.TimeDecayFloor,
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

	lbManager := leaderboard.NewManager(rdb, logger.With().Str("component", "leaderboard").Logger())

	badgeEngine := badges.NewEngine(badges.Deps{
		Log:              logger.With().Str("component", "badges").Logger(),
		Achievements:     achievementRepo,
		UserAchievements: userAchievementRepo,
		Owns:             ownRepo,
		UserScores:       userScoreRepo,
	})

	publisher := producers.New(producers.Config{
		Brokers: cfg.Kafka.Brokers, Topic: cfg.Kafka.TopicUserEvents, UseTLS: cfg.Kafka.UseTLS,
	}, logger.With().Str("component", "producer").Logger())
	defer publisher.Close()

	seasonManager := seasons.NewManager(seasons.Deps{
		Cfg: cfg, Log: logger.With().Str("component", "seasons").Logger(),
		Seasons: seasonRepo, SeasonScores: seasonScoreRepo,
		Snapshots: seasonSnapshotRepo, Leaderboards: lbManager,
	})

	// Note: anticheat and content resolver are wired in cmd/worker (where solves are processed).
	// The server process only handles reads, so we leave them nil.
	svc := service.New(service.Deps{
		Cfg: cfg, Log: logger,
		PointsCalc: pointsCalc, ELOCalc: eloCalc,
		Leaderboards: lbManager, BadgeEngine: badgeEngine,
		EventPublisher:    publisher,
		Submissions:       submissionRepo,
		Owns:              ownRepo,
		PointHistory:      pointHistoryRepo,
		UserScores:        userScoreRepo,
		Achievements:      achievementRepo,
		UserAchievements:  userAchievementRepo,
		RankTiers:         rankTierRepo,
		Seasons:           seasonRepo,
		SeasonScores:      seasonScoreRepo,
		SeasonSnapshots:   seasonSnapshotRepo,
		ELORepo:           eloRepo,
		DailyActivity:     dailyActivityRepo,
	})

	// --- HTTP ---
	if cfg.App.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	if len(cfg.HTTP.TrustedProxies) > 0 {
		_ = r.SetTrustedProxies(cfg.HTTP.TrustedProxies)
	}
	r.Use(
		middleware.RequestID(),
		middleware.Logger(logger),
		middleware.Recovery(logger),
		middleware.CORS(cfg.HTTP.CORSOrigins),
		middleware.SecurityHeaders(),
	)

	// Health (unauthenticated)
	healthH := handlers.NewHealthHandler(pool, rdb, cfg.App.Version)
	healthH.Register(r)

	// Metrics
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// Public-ish endpoints (optional auth)
	public := r.Group("/v1")
	public.Use(middleware.OptionalAuth(validator))
	lbH := handlers.NewLeaderboardHandler(lbManager, pool, logger)
	lbH.Register(public)
	seasonH := handlers.NewSeasonHandler(seasonRepo, seasonScoreRepo, seasonManager, logger)
	seasonH.Register(public)
	badgeH := handlers.NewBadgeHandler(achievementRepo, userAchievementRepo, logger)
	badgeH.Register(public)

	// Authenticated endpoints
	authed := r.Group("/v1")
	authed.Use(middleware.RequireAuth(validator, logger))
	profileH := handlers.NewProfileHandler(svc, logger)
	profileH.Register(authed)

	// Admin
	admin := r.Group("/v1")
	admin.Use(middleware.RequireAuth(validator, logger), middleware.RequireRole("admin"))
	adminH := handlers.NewAdminHandler(seasonManager, cheatFlagRepo, logger)
	adminH.Register(admin)

	srv := &http.Server{
		Addr:         ":" + strconv.Itoa(cfg.HTTP.Port),
		Handler:      r,
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}

	go func() {
		logger.Info().Int("port", cfg.HTTP.Port).Msg("http server listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal().Err(err).Msg("http listen failed")
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("http shutdown error")
	}
	logger.Info().Msg("scoring server stopped")
	return nil
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
			With().Timestamp().Str("svc", "scoring").Logger()
	}
	return zerolog.New(os.Stdout).With().Timestamp().Str("svc", "scoring").Logger()
}
