// Package producers publishes user-facing events (badge awarded, rank up,
// season ended) so notification + frontend can react.
package producers

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/segmentio/kafka-go"
)

const (
	TypeBadgeAwarded   = "user.badge_awarded"
	TypeRankTierUp     = "user.rank_tier_up"
	TypeRankTierDown   = "user.rank_tier_down"
	TypeStreakMilestone = "user.streak_milestone"
	TypeSeasonEnded    = "season.ended"
	TypeSeasonStarted  = "season.started"
	TypeELOUpdated     = "user.elo_updated"
)

type Event struct {
	ID         uuid.UUID      `json:"id"`
	Type       string         `json:"type"`
	OccurredAt time.Time      `json:"occurred_at"`
	UserID     uuid.UUID      `json:"user_id"`
	Data       map[string]any `json:"data,omitempty"`
	RequestID  string         `json:"request_id,omitempty"`
}

type Publisher struct {
	writer *kafka.Writer
	log    zerolog.Logger
	topic  string
}

type Config struct {
	Brokers []string
	Topic   string
	UseTLS  bool
}

func New(cfg Config, log zerolog.Logger) *Publisher {
	transport := &kafka.Transport{}
	if cfg.UseTLS {
		transport.TLS = &tls.Config{}
	}
	w := &kafka.Writer{
		Addr:         kafka.TCP(cfg.Brokers...),
		Topic:        cfg.Topic,
		Balancer:     &kafka.Hash{},
		BatchTimeout: 100 * time.Millisecond,
		BatchSize:    50,
		RequiredAcks: kafka.RequireOne,
		Async:        false,
		Transport:    transport,
	}
	return &Publisher{writer: w, log: log, topic: cfg.Topic}
}

func (p *Publisher) Publish(ctx context.Context, evt Event) {
	if evt.ID == uuid.Nil {
		evt.ID = uuid.New()
	}
	if evt.OccurredAt.IsZero() {
		evt.OccurredAt = time.Now().UTC()
	}
	body, err := json.Marshal(evt)
	if err != nil {
		p.log.Error().Err(err).Msg("event marshal failed")
		return
	}
	msg := kafka.Message{
		Key:   evt.UserID[:],
		Value: body,
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte(evt.Type)},
			{Key: "event_id", Value: []byte(evt.ID.String())},
		},
	}
	writeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := p.writer.WriteMessages(writeCtx, msg); err != nil {
		p.log.Error().
			Err(err).
			Str("event_type", evt.Type).
			Str("event_id", evt.ID.String()).
			Msg("kafka write failed")
	}
}

func (p *Publisher) Close() error { return p.writer.Close() }

// Convenience helpers

func (p *Publisher) BadgeAwarded(ctx context.Context, userID, achievementID uuid.UUID, code, name string, points int) {
	p.Publish(ctx, Event{
		Type: TypeBadgeAwarded, UserID: userID,
		Data: map[string]any{
			"achievement_id": achievementID.String(),
			"code":           code,
			"name":           name,
			"points":         points,
		},
	})
}

func (p *Publisher) RankTierUp(ctx context.Context, userID uuid.UUID, fromTier, toTier string) {
	p.Publish(ctx, Event{
		Type: TypeRankTierUp, UserID: userID,
		Data: map[string]any{"from": fromTier, "to": toTier},
	})
}

func (p *Publisher) StreakMilestone(ctx context.Context, userID uuid.UUID, days int) {
	p.Publish(ctx, Event{
		Type: TypeStreakMilestone, UserID: userID,
		Data: map[string]any{"days": days},
	})
}

func (p *Publisher) ELOUpdated(ctx context.Context, userID uuid.UUID, before, after int, matchID uuid.UUID) {
	p.Publish(ctx, Event{
		Type: TypeELOUpdated, UserID: userID,
		Data: map[string]any{
			"rating_before": before,
			"rating_after":  after,
			"delta":         after - before,
			"match_id":      matchID.String(),
		},
	})
}

// NoopPublisher for tests.
type NoopPublisher struct {
	Published []Event
}

func (n *NoopPublisher) Publish(_ context.Context, evt Event) {
	n.Published = append(n.Published, evt)
}
func (n *NoopPublisher) Close() error { return nil }
func (n *NoopPublisher) BadgeAwarded(_ context.Context, _, _ uuid.UUID, _, _ string, _ int) {}
func (n *NoopPublisher) RankTierUp(_ context.Context, _ uuid.UUID, _, _ string)             {}
func (n *NoopPublisher) StreakMilestone(_ context.Context, _ uuid.UUID, _ int)              {}
func (n *NoopPublisher) ELOUpdated(_ context.Context, _ uuid.UUID, _, _ int, _ uuid.UUID)   {}
