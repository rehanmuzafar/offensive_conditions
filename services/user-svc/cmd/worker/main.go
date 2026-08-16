// cmd/worker consumes Kafka events from auth/scoring and updates user state.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/segmentio/kafka-go"

	"github.com/offensive-conditions/user-svc/internal/config"
	"github.com/offensive-conditions/user-svc/internal/repository"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}

	log := setupLogger(cfg)
	log.Info().Str("env", cfg.App.Env).Msg("starting user-svc worker")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- Postgres ---
	pool, err := repository.NewPool(ctx, repository.PoolConfig{
		DSN:      cfg.DB.DSN(),
		MaxConns: int32(cfg.DB.MaxConns),
		MinConns: int32(cfg.DB.MinConns),
	})
	if err != nil {
		log.Fatal().Err(err).Msg("postgres connect failed")
	}
	defer pool.Close()

	profileRepo := repository.NewPGProfileRepo(pool)

	// --- Kafka reader (auth.events) ---
	dialer := &kafka.Dialer{Timeout: 10 * time.Second}
	if cfg.Kafka.UseTLS {
		dialer.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:         cfg.Kafka.Brokers,
		GroupID:         cfg.Kafka.ConsumerGroup,
		Topic:           cfg.Kafka.TopicAuthEvents,
		MinBytes:        1,
		MaxBytes:        10 * 1024 * 1024,
		MaxWait:         500 * time.Millisecond,
		Dialer:          dialer,
		StartOffset:     kafka.LastOffset,
		CommitInterval:  0, // we commit manually after handling
		ReadLagInterval: -1,
	})
	defer reader.Close()

	w := &worker{
		reader:      reader,
		profileRepo: profileRepo,
		log:         log,
		cfg:         cfg,
	}

	// --- Signal handling ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		w.run(ctx)
	}()

	<-sigCh
	log.Info().Msg("shutdown signal received")
	cancel()
	wg.Wait()
	log.Info().Msg("shutdown complete")
}

// =============================================================================
// Worker
// =============================================================================

type worker struct {
	reader      *kafka.Reader
	profileRepo repository.ProfileRepository
	log         zerolog.Logger
	cfg         *config.Config
}

// Envelope mirrors what auth-svc emits (and what user-svc emits).
type envelope struct {
	EventID    string          `json:"event_id"`
	EventType  string          `json:"event_type"`
	OccurredAt time.Time       `json:"occurred_at"`
	SubjectID  *uuid.UUID      `json:"subject_id,omitempty"`
	Payload    json.RawMessage `json:"payload"`
}

func (w *worker) run(ctx context.Context) {
	w.log.Info().Strs("brokers", w.cfg.Kafka.Brokers).Str("topic", w.cfg.Kafka.TopicAuthEvents).Msg("starting kafka consumer")
	for {
		msg, err := w.reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			w.log.Error().Err(err).Msg("kafka fetch failed; backing off")
			time.Sleep(w.cfg.Worker.RetryBackoff)
			continue
		}

		if err := w.handle(ctx, msg); err != nil {
			w.log.Error().Err(err).
				Str("topic", msg.Topic).Int64("offset", msg.Offset).
				Msg("event handling failed; continuing")
			// In production: route to DLQ here. For now we commit anyway so we don't get stuck.
		}

		if err := w.reader.CommitMessages(ctx, msg); err != nil {
			w.log.Warn().Err(err).Msg("kafka commit failed")
		}
	}
}

func (w *worker) handle(ctx context.Context, msg kafka.Message) error {
	var env envelope
	if err := json.Unmarshal(msg.Value, &env); err != nil {
		return fmt.Errorf("unmarshal envelope: %w", err)
	}
	w.log.Debug().Str("event_type", env.EventType).Str("event_id", env.EventID).Msg("event received")

	switch env.EventType {
	case "auth.user.registered":
		return w.handleUserRegistered(ctx, env)
	case "auth.user.email_verified":
		return w.handleEmailVerified(ctx, env)
	case "auth.user.deleted":
		// Reflexive: if auth says deleted, we make sure our profile is scrubbed.
		// Avoids drift if user deletion flows through auth path directly.
		return w.handleUserDeleted(ctx, env)
	default:
		// Other events ignored
		return nil
	}
}

type userRegisteredPayload struct {
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	Username    string    `json:"username"`
	CountryCode string    `json:"country_code,omitempty"`
	Timezone    string    `json:"timezone,omitempty"`
	Locale      string    `json:"locale,omitempty"`
}

func (w *worker) handleUserRegistered(ctx context.Context, env envelope) error {
	var p userRegisteredPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return fmt.Errorf("unmarshal user.registered: %w", err)
	}
	profile := &repository.Profile{
		UserID:      p.UserID,
		Timezone:    valueOr(p.Timezone, "UTC"),
		Locale:      valueOr(p.Locale, "en"),
		CountryCode: p.CountryCode,
		Privacy: repository.PrivacySettings{
			ProfileVisibility:   "public",
			ShowCountry:         true,
			ShowTeam:            true,
			ShowAchievements:    true,
			ShowOnLeaderboard:   true,
			AllowFriendRequests: true,
			AllowMessages:       "anyone",
		},
	}
	if err := w.profileRepo.Create(ctx, profile); err != nil {
		return fmt.Errorf("create profile: %w", err)
	}
	w.log.Info().Str("user_id", p.UserID.String()).Msg("profile created from auth.user.registered")
	return nil
}

type emailVerifiedPayload struct {
	UserID uuid.UUID `json:"user_id"`
}

func (w *worker) handleEmailVerified(ctx context.Context, env envelope) error {
	var p emailVerifiedPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return fmt.Errorf("unmarshal email_verified: %w", err)
	}
	if err := w.profileRepo.MarkEmailVerified(ctx, p.UserID); err != nil {
		return fmt.Errorf("mark email verified: %w", err)
	}
	w.log.Info().Str("user_id", p.UserID.String()).Msg("profile updated for email verification")
	return nil
}

type userDeletedPayload struct {
	UserID uuid.UUID `json:"user_id"`
}

func (w *worker) handleUserDeleted(ctx context.Context, env envelope) error {
	var p userDeletedPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return fmt.Errorf("unmarshal user_deleted: %w", err)
	}
	if err := w.profileRepo.Delete(ctx, p.UserID); err != nil {
		return fmt.Errorf("scrub profile: %w", err)
	}
	w.log.Info().Str("user_id", p.UserID.String()).Msg("profile scrubbed for auth.user.deleted")
	return nil
}

func valueOr(s, def string) string {
	if s == "" {
		return def
	}
	return s
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
			With().Timestamp().Str("svc", cfg.App.Name+".worker").Logger()
	} else {
		l = zerolog.New(os.Stderr).With().Timestamp().Str("svc", cfg.App.Name+".worker").Logger()
	}
	return l
}
