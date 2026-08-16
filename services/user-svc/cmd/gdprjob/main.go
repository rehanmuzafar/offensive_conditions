// cmd/gdprjob runs scheduled GDPR maintenance:
//   - Process due deletion requests (after 30-day grace)
//   - Build pending data export ZIPs
//   - Clean up expired exports
//   - Expire old team invitations
//
// Invoked as a CronJob in Kubernetes; runs once and exits.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/rs/zerolog"

	"github.com/offensive-conditions/user-svc/internal/config"
	"github.com/offensive-conditions/user-svc/internal/gdpr"
	"github.com/offensive-conditions/user-svc/internal/producers"
	"github.com/offensive-conditions/user-svc/internal/repository"
	"github.com/offensive-conditions/user-svc/internal/storage"
)

const (
	defaultBatchSize    = 100
	defaultJobTimeout   = 30 * time.Minute
	defaultStepDeadline = 10 * time.Minute
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}

	log := setupLogger(cfg)
	log.Info().Str("env", cfg.App.Env).Msg("starting user-svc gdprjob")

	ctx, cancel := context.WithTimeout(context.Background(), defaultJobTimeout)
	defer cancel()

	// --- Postgres ---
	pool, err := repository.NewPool(ctx, repository.PoolConfig{
		DSN: cfg.DB.DSN(), MaxConns: 8, MinConns: 1,
	})
	if err != nil {
		log.Fatal().Err(err).Msg("postgres connect failed")
	}
	defer pool.Close()

	// --- Storage ---
	store, err := storage.New(storage.Config{
		Endpoint: cfg.Storage.Endpoint, AccessKey: cfg.Storage.AccessKey,
		SecretKey: cfg.Storage.SecretKey, UseSSL: cfg.Storage.UseSSL,
		Region: cfg.Storage.Region, AvatarBucket: cfg.Storage.AvatarBucket,
		ExportBucket: cfg.Storage.ExportBucket, CDNBaseURL: cfg.Storage.CDNBaseURL,
	}, log.With().Str("component", "storage").Logger())
	if err != nil {
		log.Fatal().Err(err).Msg("storage init failed")
	}

	// --- Kafka publisher (optional) ---
	var publisher *producers.Publisher
	if len(cfg.Kafka.Brokers) > 0 {
		publisher, err = producers.New(producers.Config{
			Brokers: cfg.Kafka.Brokers, Topic: cfg.Kafka.TopicUserEvents,
			UseTLS: cfg.Kafka.UseTLS, Acks: "all",
		}, log.With().Str("component", "kafka").Logger())
		if err != nil {
			log.Warn().Err(err).Msg("kafka publisher init failed; events disabled")
		} else {
			defer publisher.Close()
		}
	}

	// --- Repos + service ---
	profileRepo := repository.NewPGProfileRepo(pool)
	teamRepo := repository.NewPGTeamRepo(pool)
	friendRepo := repository.NewPGFriendRepo(pool)
	followRepo := repository.NewPGFollowRepo(pool)
	gdprRepo := repository.NewPGGDPRRepo(pool)

	gdprSvc := gdpr.New(gdpr.Deps{
		GDPRRepo: gdprRepo, ProfileRepo: profileRepo, FriendRepo: friendRepo,
		FollowRepo: followRepo, TeamRepo: teamRepo, Storage: store,
		Publisher: publisher, Pool: pool, Cfg: cfg,
		Log: log.With().Str("svc", "gdpr").Logger(),
	})

	// --- Step 1: due deletions ---
	stepCtx, stepCancel := context.WithTimeout(ctx, defaultStepDeadline)
	processed, err := gdprSvc.ProcessDueDeletions(stepCtx, defaultBatchSize)
	stepCancel()
	if err != nil {
		log.Error().Err(err).Msg("ProcessDueDeletions failed")
	} else {
		log.Info().Int("count", processed).Msg("processed due deletions")
	}

	// --- Step 2: pending exports ---
	stepCtx, stepCancel = context.WithTimeout(ctx, defaultStepDeadline)
	exports, err := gdprSvc.ProcessPendingExports(stepCtx, defaultBatchSize)
	stepCancel()
	if err != nil {
		log.Error().Err(err).Msg("ProcessPendingExports failed")
	} else {
		log.Info().Int("count", exports).Msg("processed pending exports")
	}

	// --- Step 3: cleanup expired exports ---
	stepCtx, stepCancel = context.WithTimeout(ctx, defaultStepDeadline)
	cleaned, err := gdprSvc.CleanupExpiredExports(stepCtx, defaultBatchSize)
	stepCancel()
	if err != nil {
		log.Error().Err(err).Msg("CleanupExpiredExports failed")
	} else {
		log.Info().Int("count", cleaned).Msg("cleaned up expired exports")
	}

	// --- Step 4: expire stale team invitations ---
	stepCtx, stepCancel = context.WithTimeout(ctx, defaultStepDeadline)
	expired, err := teamRepo.ExpireOldInvitations(stepCtx)
	stepCancel()
	if err != nil {
		log.Error().Err(err).Msg("ExpireOldInvitations failed")
	} else {
		log.Info().Int64("count", expired).Msg("expired stale invitations")
	}

	log.Info().Msg("gdprjob complete")
}

func setupLogger(cfg *config.Config) zerolog.Logger {
	level, err := zerolog.ParseLevel(cfg.Log.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	var l zerolog.Logger
	if cfg.Log.Format == "console" {
		l = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
			With().Timestamp().Str("svc", cfg.App.Name+".gdprjob").Logger()
	} else {
		l = zerolog.New(os.Stderr).With().Timestamp().Str("svc", cfg.App.Name+".gdprjob").Logger()
	}
	return l
}
