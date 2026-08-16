// Package main starts the flag-verifier HTTP API.
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

	"github.com/offensive-conditions/flag-verifier/internal/auth"
	"github.com/offensive-conditions/flag-verifier/internal/config"
	"github.com/offensive-conditions/flag-verifier/internal/handlers"
	hmacpkg "github.com/offensive-conditions/flag-verifier/internal/hmac"
	"github.com/offensive-conditions/flag-verifier/internal/idempotency"
	"github.com/offensive-conditions/flag-verifier/internal/middleware"
	"github.com/offensive-conditions/flag-verifier/internal/producers"
	"github.com/offensive-conditions/flag-verifier/internal/ratelimit"
	"github.com/offensive-conditions/flag-verifier/internal/repository"
	"github.com/offensive-conditions/flag-verifier/internal/secrets"
	"github.com/offensive-conditions/flag-verifier/internal/service"
)

func main() {
	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("flag-verifier server failed")
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := newLogger(cfg.Log.Level, cfg.Log.Format)
	logger.Info().Str("env", cfg.App.Env).Str("version", cfg.App.Version).Msg("starting flag-verifier")

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

	// --- Secrets store ---
	secretsStore, err := buildSecretsStore(cfg, logger)
	if err != nil {
		return err
	}
	defer secretsStore.Close()

	// --- Auth ---
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
	ownsLookup := repository.NewPGOwnsLookup(pool)
	instanceLookup := repository.NewPGInstanceLookup(pool)
	machineLookup := repository.NewPGMachineLookup(pool)

	// --- Engines ---
	parser := hmacpkg.NewParser(cfg.FlagFormat.Prefix, cfg.FlagFormat.Suffix, cfg.FlagFormat.HMACBytes, cfg.FlagFormat.MaxLength)
	hmacVerifier := hmacpkg.NewVerifier(cfg.FlagFormat.HMACBytes)

	limiter := ratelimit.New(rdb, ratelimit.Config{
		PerContentPerMin:  cfg.RateLimit.PerContentPerMin,
		PerUserPerMin:     cfg.RateLimit.PerUserPerMin,
		PerIPPerMin:       cfg.RateLimit.PerIPPerMin,
		CooldownSeconds:   cfg.RateLimit.CooldownSeconds,
		IPCooldownSeconds: cfg.RateLimit.IPCooldownSeconds,
		WindowSeconds:     cfg.RateLimit.WindowSeconds,
	}, logger.With().Str("component", "ratelimit").Logger())

	idemCache := idempotency.New(rdb, idempotency.Config{
		TTL:     time.Duration(cfg.Idempotency.TTLSeconds) * time.Second,
		Enabled: cfg.Idempotency.Enabled,
	}, logger.With().Str("component", "idempotency").Logger())

	publisher := producers.New(producers.Config{
		Brokers: cfg.Kafka.Brokers, Topic: cfg.Kafka.TopicFlagSubmissions,
		UseTLS: cfg.Kafka.UseTLS, Acks: cfg.Kafka.Acks,
	}, logger.With().Str("component", "kafka").Logger())
	defer publisher.Close()

	svc := service.New(service.Deps{
		Cfg: cfg, Log: logger,
		Parser: parser, HMACVerifier: hmacVerifier,
		RateLimit: limiter, IdemCache: idemCache,
		Secrets: secretsStore, Publisher: publisher,
		Submissions: submissionRepo, Owns: ownsLookup,
		Instances: instanceLookup, Machines: machineLookup,
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

	healthH := handlers.NewHealthHandler(pool, rdb, cfg.App.Version)
	healthH.Register(r)

	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	authed := r.Group("/v1")
	authed.Use(middleware.RequireAuth(validator, logger))
	flagH := handlers.NewFlagHandler(svc, logger)
	flagH.Register(authed)

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
	logger.Info().Msg("flag-verifier stopped")
	return nil
}

func buildSecretsStore(cfg *config.Config, log zerolog.Logger) (secrets.Store, error) {
	if cfg.Vault.Enabled {
		return secrets.NewVaultStore(secrets.VaultConfig{
			Addr:            cfg.Vault.Addr,
			Token:           cfg.Vault.Token,
			TokenPath:       cfg.Vault.TokenPath,
			Prefix:          cfg.Vault.FlagSecretsPath,
			CacheTTL:        cfg.Vault.RefreshInterval,
			RefreshInterval: cfg.Vault.RefreshInterval,
		}, log)
	}

	// Development fallback — use env var SECRETS_LOCAL_KEY for all content
	fallback := os.Getenv("SECRETS_LOCAL_KEY")
	if fallback == "" {
		fallback = "dev-only-fallback-secret-do-not-use-in-prod"
	}
	log.Warn().Msg("Using static secrets store (development mode)")
	return secrets.NewStaticStore(map[string]string{}, fallback), nil
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
			With().Timestamp().Str("svc", "flag-verifier").Logger()
	}
	return zerolog.New(os.Stdout).With().Timestamp().Str("svc", "flag-verifier").Logger()
}
