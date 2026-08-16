// Package events publishes instance lifecycle events to Kafka.
// Other services (scoring, notification, analytics) consume these.
package events

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/segmentio/kafka-go"
)

// Type identifies the event.
type Type string

const (
	TypeInstanceSpawnRequested Type = "instance.spawn_requested"
	TypeInstanceSpawned        Type = "instance.spawned"
	TypeInstanceRunning        Type = "instance.running"
	TypeInstanceFailed         Type = "instance.failed"
	TypeInstanceExtended       Type = "instance.extended"
	TypeInstanceTerminated     Type = "instance.terminated"
	TypeInstanceExpired        Type = "instance.expired"
	TypeFlagSubmittedCorrect   Type = "flag.submitted.correct"
	TypeFlagSubmittedIncorrect Type = "flag.submitted.incorrect"
)

// Event is the wire format.
type Event struct {
	ID         uuid.UUID      `json:"id"`
	Type       Type           `json:"type"`
	OccurredAt time.Time      `json:"occurred_at"`
	UserID     uuid.UUID      `json:"user_id"`
	InstanceID *uuid.UUID     `json:"instance_id,omitempty"`
	MachineID  *uuid.UUID     `json:"machine_id,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
	RequestID  string         `json:"request_id,omitempty"`
}

// Publisher writes events to Kafka.
type Publisher struct {
	writer *kafka.Writer
	topic  string
	log    zerolog.Logger
}

type Config struct {
	Brokers []string
	Topic   string
	UseTLS  bool
}

func NewPublisher(cfg Config, log zerolog.Logger) *Publisher {
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
		Async:        false, // synchronous so we know if a send fails
		Transport:    transport,
	}

	return &Publisher{writer: w, topic: cfg.Topic, log: log}
}

// Publish sends a single event. Errors are logged but not returned —
// events are a best-effort signal, not a transactional dependency.
func (p *Publisher) Publish(ctx context.Context, evt Event) {
	if evt.ID == uuid.Nil {
		evt.ID = uuid.New()
	}
	if evt.OccurredAt.IsZero() {
		evt.OccurredAt = time.Now().UTC()
	}

	body, err := json.Marshal(evt)
	if err != nil {
		p.log.Error().Err(err).Str("event_type", string(evt.Type)).Msg("event marshal failed")
		return
	}

	// Partition by user_id so events for the same user land on the same partition
	key := evt.UserID[:]

	msg := kafka.Message{
		Key:   key,
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
			Str("event_type", string(evt.Type)).
			Str("event_id", evt.ID.String()).
			Msg("kafka write failed")
		// In production also write to a fallback (e.g. retry-on-disk queue)
	}
}

func (p *Publisher) Close() error {
	return p.writer.Close()
}

// Convenience helpers

func (p *Publisher) InstanceSpawned(ctx context.Context, userID, instanceID, machineID uuid.UUID, backend string, requestID string) {
	p.Publish(ctx, Event{
		Type: TypeInstanceSpawned, UserID: userID,
		InstanceID: &instanceID, MachineID: &machineID,
		RequestID: requestID,
		Data:      map[string]any{"backend": backend},
	})
}

func (p *Publisher) InstanceRunning(ctx context.Context, userID, instanceID, machineID uuid.UUID, ip string) {
	p.Publish(ctx, Event{
		Type: TypeInstanceRunning, UserID: userID,
		InstanceID: &instanceID, MachineID: &machineID,
		Data: map[string]any{"ip_address": ip},
	})
}

func (p *Publisher) InstanceTerminated(ctx context.Context, userID, instanceID, machineID uuid.UUID, reason string) {
	p.Publish(ctx, Event{
		Type: TypeInstanceTerminated, UserID: userID,
		InstanceID: &instanceID, MachineID: &machineID,
		Data: map[string]any{"reason": reason},
	})
}

func (p *Publisher) InstanceExpired(ctx context.Context, userID, instanceID, machineID uuid.UUID) {
	p.Publish(ctx, Event{
		Type: TypeInstanceExpired, UserID: userID,
		InstanceID: &instanceID, MachineID: &machineID,
	})
}

func (p *Publisher) FlagSubmitted(ctx context.Context, userID, machineID uuid.UUID, instanceID *uuid.UUID, flagType string, correct bool) {
	t := TypeFlagSubmittedIncorrect
	if correct {
		t = TypeFlagSubmittedCorrect
	}
	p.Publish(ctx, Event{
		Type: t, UserID: userID, InstanceID: instanceID, MachineID: &machineID,
		Data: map[string]any{"flag_type": flagType},
	})
}

// NoopPublisher is a dev/test stub.
type NoopPublisher struct {
	Published []Event
}

func (n *NoopPublisher) Publish(_ context.Context, evt Event) {
	n.Published = append(n.Published, evt)
}
func (n *NoopPublisher) Close() error { return nil }
