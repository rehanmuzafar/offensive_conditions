// Package consumers reads Kafka events and dispatches them to the scoring service.
//
// Two consumer groups:
//   - flagSubmissionsConsumer  → orchestrator events
//   - ctfEventsConsumer        → CTF service events (match results, challenge solves)
//
// Each consumer is single-threaded per partition (Kafka semantics) and uses
// the service's idempotent handlers so re-delivery is safe.
package consumers

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/segmentio/kafka-go"

	"github.com/offensive-conditions/scoring/internal/service"
)

// EventEnvelope is the wire format the platform actually publishes.
//
// It did not match. This struct read `id`, `type`, `user_id` and `data`, while
// every producer — and notification-svc, the other consumer of these topics —
// uses `event_id`, `event_type`, `actor_user_id` and `payload`. Nothing here
// decoded, so every field came out zero and no solve was ever scored. The
// producer's shape wins: it is in the topics already, with history behind it.
type EventEnvelope struct {
	ID         uuid.UUID       `json:"event_id"`
	Type       string          `json:"event_type"`
	OccurredAt time.Time       `json:"occurred_at"`
	//: Whose action this was. `subject_id` is what it happened *to* (the event).
	UserID     uuid.UUID       `json:"actor_user_id"`
	SubjectID  *uuid.UUID      `json:"subject_id,omitempty"`
	InstanceID *uuid.UUID      `json:"instance_id,omitempty"`
	MachineID  *uuid.UUID      `json:"machine_id,omitempty"`
	Data       json.RawMessage `json:"payload,omitempty"`
	RequestID  string          `json:"request_id,omitempty"`
}

// Consumer holds Kafka readers for the topics we care about.
type Consumer struct {
	log        zerolog.Logger
	flagReader *kafka.Reader
	ctfReader  *kafka.Reader
	svc        *service.Scoring

	stopOnce sync.Once
	stopped  chan struct{}
}

type Config struct {
	Brokers              []string
	ConsumerGroup        string
	TopicFlagSubmissions string
	TopicCTFEvents       string
	UseTLS               bool
}

func New(cfg Config, log zerolog.Logger, svc *service.Scoring) *Consumer {
	dialer := &kafka.Dialer{Timeout: 10 * time.Second}
	if cfg.UseTLS {
		dialer.TLS = &tls.Config{}
	}

	flagReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        cfg.Brokers,
		GroupID:        cfg.ConsumerGroup,
		Topic:          cfg.TopicFlagSubmissions,
		MinBytes:       1,
		MaxBytes:       10 * 1024 * 1024,
		MaxWait:        500 * time.Millisecond,
		StartOffset:    kafka.LastOffset,
		CommitInterval: time.Second,
		Dialer:         dialer,
	})

	ctfReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        cfg.Brokers,
		GroupID:        cfg.ConsumerGroup,
		Topic:          cfg.TopicCTFEvents,
		MinBytes:       1,
		MaxBytes:       10 * 1024 * 1024,
		MaxWait:        500 * time.Millisecond,
		StartOffset:    kafka.LastOffset,
		CommitInterval: time.Second,
		Dialer:         dialer,
	})

	return &Consumer{
		log:        log,
		flagReader: flagReader,
		ctfReader:  ctfReader,
		svc:        svc,
		stopped:    make(chan struct{}),
	}
}

// Run starts both consumers and blocks until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context) {
	var wg sync.WaitGroup

	wg.Add(2)
	go func() {
		defer wg.Done()
		c.runReader(ctx, c.flagReader, c.handleFlagEvent, "flag-events")
	}()
	go func() {
		defer wg.Done()
		c.runReader(ctx, c.ctfReader, c.handleCTFEvent, "ctf-events")
	}()

	wg.Wait()
	close(c.stopped)
}

// Stop closes the readers and waits for graceful shutdown.
func (c *Consumer) Stop() {
	c.stopOnce.Do(func() {
		_ = c.flagReader.Close()
		_ = c.ctfReader.Close()
	})
	<-c.stopped
}

type handlerFunc func(ctx context.Context, evt EventEnvelope) error

func (c *Consumer) runReader(ctx context.Context, r *kafka.Reader, h handlerFunc, name string) {
	log := c.log.With().Str("consumer", name).Logger()
	log.Info().Strs("topic_pattern", []string{r.Config().Topic}).Msg("consumer starting")

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("consumer context cancelled")
			return
		default:
		}

		msg, err := r.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if strings.Contains(err.Error(), "use of closed network connection") {
				return
			}
			log.Error().Err(err).Msg("fetch message failed")
			time.Sleep(time.Second)
			continue
		}

		var evt EventEnvelope
		if err := json.Unmarshal(msg.Value, &evt); err != nil {
			log.Warn().Err(err).Str("topic", msg.Topic).Msg("malformed event; skipping")
			_ = r.CommitMessages(ctx, msg)
			continue
		}

		// Handle with timeout
		hCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err = h(hCtx, evt)
		cancel()

		if err != nil {
			log.Error().
				Err(err).
				Str("event_type", evt.Type).
				Str("event_id", evt.ID.String()).
				Msg("handler failed; will retry on rebalance")
			// Don't commit; will be re-delivered. In production we'd send to a DLQ
			// after N retries (tracked via headers).
			time.Sleep(500 * time.Millisecond)
			continue
		}

		if err := r.CommitMessages(ctx, msg); err != nil {
			log.Warn().Err(err).Msg("commit failed")
		}
	}
}

// =============================================================================
// Handlers — one per event type the service cares about
// =============================================================================

func (c *Consumer) handleFlagEvent(ctx context.Context, evt EventEnvelope) error {
	switch evt.Type {
	case "flag.submitted.correct":
		return c.handleCorrectFlag(ctx, evt)
	case "flag.submitted.incorrect":
		// We could track failure rate for anti-cheat; for now ignore.
		return nil
	default:
		// Unknown / not our concern
		return nil
	}
}

func (c *Consumer) handleCorrectFlag(ctx context.Context, evt EventEnvelope) error {
	var data struct {
		FlagType    string    `json:"flag_type"`
		MachineSlug string    `json:"machine_slug"`
		ContentType string    `json:"content_type"`
		ContentID   uuid.UUID `json:"content_id"`
		SecondsToSolve int    `json:"seconds_to_solve"`
		IPAddress   string    `json:"ip_address"`
		FlagHash    string    `json:"flag_hash"`
	}
	if err := json.Unmarshal(evt.Data, &data); err != nil {
		return fmt.Errorf("decode flag event: %w", err)
	}

	// Backfill from envelope where data omitted
	contentType := data.ContentType
	contentID := data.ContentID
	if contentType == "" {
		contentType = "machine"
	}
	if contentID == uuid.Nil && evt.MachineID != nil {
		contentID = *evt.MachineID
	}
	if contentID == uuid.Nil {
		return fmt.Errorf("no content ID in event")
	}

	in := service.AwardInput{
		UserID:         evt.UserID,
		ContentType:    contentType,
		ContentID:      contentID,
		FlagType:       data.FlagType,
		InstanceID:     evt.InstanceID,
		SecondsToSolve: data.SecondsToSolve,
		FlagHash:       data.FlagHash,
		IPAddress:      data.IPAddress,
		SubmittedAt:    evt.OccurredAt,
		RequestID:      evt.RequestID,
	}
	_, err := c.svc.AwardSolve(ctx, in)
	return err
}

func (c *Consumer) handleCTFEvent(ctx context.Context, evt EventEnvelope) error {
	switch evt.Type {
	// ctf-svc names this `ctf.solve.recorded`. The old name was never emitted
	// by anything.
	case "ctf.solve.recorded":
		return c.handleCTFChallengeSolved(ctx, evt)
	case "ctf.match.completed":
		return c.handleCTFMatchCompleted(ctx, evt)
	default:
		return nil
	}
}

func (c *Consumer) handleCTFChallengeSolved(ctx context.Context, evt EventEnvelope) error {
	// The payload ctf-svc sends. It carries the points the event itself
	// awarded — dynamic scoring means the value depends on how many teams had
	// already solved it, so recomputing here would disagree with the CTF's own
	// scoreboard. Difficulty and IP are not in this event; the award falls back
	// to the points as given.
	var data struct {
		ChallengeID   uuid.UUID  `json:"challenge_id"`
		ParticipantID uuid.UUID  `json:"participant_id"`
		Points        int        `json:"points"`
		//: When the event finishes — the season this result belongs to.
		EventEndsAt   *time.Time `json:"event_ends_at"`
	}
	if err := json.Unmarshal(evt.Data, &data); err != nil {
		return fmt.Errorf("decode ctf solve event: %w", err)
	}

	in := service.AwardInput{
		UserID:      evt.UserID,
		ContentType: "ctf_challenge",
		ContentID:   data.ChallengeID,
		FlagType:    "challenge",
		SubmittedAt: evt.OccurredAt,
		Points:      data.Points,
		RequestID:   evt.RequestID,
	}
	if data.EventEndsAt != nil {
		in.SeasonAt = *data.EventEndsAt
	}
	_, err := c.svc.AwardSolve(ctx, in)
	return err
}

func (c *Consumer) handleCTFMatchCompleted(ctx context.Context, evt EventEnvelope) error {
	var data struct {
		MatchID         uuid.UUID `json:"match_id"`
		PlayerAID       uuid.UUID `json:"player_a_id"`
		PlayerBID       uuid.UUID `json:"player_b_id"`
		Result          float64   `json:"result"` // 1, 0.5, 0
		DurationSeconds int       `json:"duration_seconds"`
	}
	if err := json.Unmarshal(evt.Data, &data); err != nil {
		return fmt.Errorf("decode ctf match event: %w", err)
	}

	return c.svc.RecordELOMatch(ctx, service.ELOMatchInput{
		MatchID:         data.MatchID,
		PlayerAID:       data.PlayerAID,
		PlayerBID:       data.PlayerBID,
		Result:          data.Result,
		DurationSeconds: data.DurationSeconds,
		CompletedAt:     evt.OccurredAt,
	})
}
