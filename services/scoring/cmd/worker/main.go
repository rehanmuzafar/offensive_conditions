// Package main runs the scoring worker: consumes Kafka events and
// processes solves, ELO matches, and other events.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/offensive-conditions/scoring/internal/anticheat"
	"github.com/offensive-conditions/scoring/internal/badges"
	"github.com/offensive-conditions/scoring/internal/config"
	"github.com/offensive-conditions/scoring/internal/consumers"
	"github.com/offensive-conditions/scoring/internal/elo"
	"github.com/offensive-conditions/scoring/internal/leaderboard"
	"github.com/offensive-conditions/scoring/internal/points"
	"github.com/offensive-conditions/scoring/internal/producers"
	"github.com/offensive-conditions/scoring/internal/repository"
	"github.com/offensive-conditions/scoring/internal/service"
)

func main() {
	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("scoring worker failed")
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := newLogger(cfg.Log.Level, cfg.Log.Format)
	logger.Info().Str("env", cfg.App.Env).Str("version", cfg.App.Version).Msg("starting scoring worker")

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

	antiCheatDetector := anticheat.NewDetector(anticheat.Deps{
		Log:         logger.With().Str("component", "anticheat").Logger(),
		CheatFlags:  cheatFlagRepo,
		Submissions: submissionRepo,
	}, anticheat.Config{
		EnableSpeed:      cfg.AntiCheat.EnableSpeedCheck,
		MinSolveSeconds:  cfg.AntiCheat.MinSolveSeconds,
		EnableSharedFlag: cfg.AntiCheat.EnableSharedFlagCheck,
		EnableIPChange:   cfg.AntiCheat.EnableIPChangeCheck,
	})

	publisher := producers.New(producers.Config{
		Brokers: cfg.Kafka.Brokers, Topic: cfg.Kafka.TopicUserEvents, UseTLS: cfg.Kafka.UseTLS,
	}, logger.With().Str("component", "producer").Logger())
	defer publisher.Close()

	// --- User metadata + content resolvers (HTTP clients to other services) ---
	userMeta := newUserMetaClient(os.Getenv("USER_SERVICE_URL"), logger)
	contentResolver := newContentResolverClient(os.Getenv("CONTENT_SERVICE_URL"), logger)

	svc := service.New(service.Deps{
		Cfg: cfg, Log: logger,
		PointsCalc: pointsCalc, ELOCalc: eloCalc,
		Leaderboards: lbManager, BadgeEngine: badgeEngine,
		AntiCheat:        antiCheatDetector,
		EventPublisher:   publisher,
		UserMeta:         userMeta,
		ContentResolver:  contentResolver,
		Submissions:      submissionRepo,
		Owns:             ownRepo,
		PointHistory:     pointHistoryRepo,
		UserScores:       userScoreRepo,
		Achievements:     achievementRepo,
		UserAchievements: userAchievementRepo,
		RankTiers:        rankTierRepo,
		Seasons:          seasonRepo,
		SeasonScores:     seasonScoreRepo,
		SeasonSnapshots:  seasonSnapshotRepo,
		ELORepo:          eloRepo,
		DailyActivity:    dailyActivityRepo,
	})

	consumer := consumers.New(consumers.Config{
		Brokers:              cfg.Kafka.Brokers,
		ConsumerGroup:        cfg.Kafka.ConsumerGroup,
		TopicFlagSubmissions: cfg.Kafka.TopicFlagSubmissions,
		TopicCTFEvents:       cfg.Kafka.TopicCTFEvents,
		UseTLS:               cfg.Kafka.UseTLS,
	}, logger.With().Str("component", "consumer").Logger(), svc)

	// --- Metrics endpoint (worker still needs /metrics for prometheus) ---
	metricsPort := cfg.HTTP.Port + 1000 // 9003 if HTTP_PORT=8003
	go startMetricsServer(rootCtx, metricsPort, logger)

	// --- Run consumers ---
	go consumer.Run(rootCtx)

	logger.Info().Msg("scoring worker running")

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")

	cancel()
	consumer.Stop()
	logger.Info().Msg("scoring worker stopped")
	return nil
}

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
			With().Timestamp().Str("svc", "scoring-worker").Logger()
	}
	return zerolog.New(os.Stdout).With().Timestamp().Str("svc", "scoring-worker").Logger()
}

// =============================================================================
// HTTP client adapters for cross-service lookups
// =============================================================================

type userMetaClient struct {
	baseURL string
	client  *http.Client
	log     zerolog.Logger
}

func newUserMetaClient(baseURL string, log zerolog.Logger) service.UserMetadataLookup {
	if baseURL == "" {
		// Return untyped nil so the service constructor's nil-check fires
		// and falls back to its noop implementation.
		return nil
	}
	return &userMetaClient{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 2 * time.Second},
		log:     log.With().Str("component", "user-meta-client").Logger(),
	}
}

func (c *userMetaClient) GetMetadata(ctx context.Context, userID uuid.UUID) (service.UserMetadata, error) {
	url := fmt.Sprintf("%s/internal/users/%s/metadata", c.baseURL, userID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return service.UserMetadata{}, err
	}
	req.Header.Set("X-Service", "scoring")
	resp, err := c.client.Do(req)
	if err != nil {
		return service.UserMetadata{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return service.UserMetadata{}, fmt.Errorf("user-svc %d: %s", resp.StatusCode, string(body))
	}
	var body struct {
		CountryCode string    `json:"country_code"`
		TeamID      uuid.UUID `json:"team_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return service.UserMetadata{}, err
	}
	return service.UserMetadata{CountryCode: body.CountryCode, TeamID: body.TeamID}, nil
}

type contentResolverClient struct {
	baseURL string
	client  *http.Client
	log     zerolog.Logger
}

func newContentResolverClient(baseURL string, log zerolog.Logger) service.ContentResolver {
	if baseURL == "" {
		return nil // service will use noop fallback
	}
	return &contentResolverClient{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 2 * time.Second},
		log:     log.With().Str("component", "content-client").Logger(),
	}
}

func (c *contentResolverClient) Resolve(ctx context.Context, contentType string, contentID uuid.UUID) (service.ContentInfo, error) {
	url := fmt.Sprintf("%s/internal/content/%s/%s", c.baseURL, contentType, contentID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return service.ContentInfo{}, err
	}
	req.Header.Set("X-Service", "scoring")
	resp, err := c.client.Do(req)
	if err != nil {
		return service.ContentInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return service.ContentInfo{}, fmt.Errorf("content-svc %d: %s", resp.StatusCode, string(body))
	}
	var body struct {
		Difficulty string    `json:"difficulty"`
		Category   string    `json:"category"`
		ReleasedAt time.Time `json:"released_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return service.ContentInfo{}, err
	}
	return service.ContentInfo{
		Difficulty: body.Difficulty,
		Category:   body.Category,
		ReleasedAt: body.ReleasedAt,
	}, nil
}
