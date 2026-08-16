// Package producers publishes flag-submission events to Kafka.
//
// Two event types:
//   - flag.submitted.correct   → scoring service awards points
//   - flag.submitted.incorrect → analytics / anti-cheat learning
//
// Partition key = user_id, so all of a user's submissions land on the same
// partition (preserves per-user ordering).
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
	TypeCorrect   = "flag.submitted.correct"
	TypeIncorrect = "flag.submitted.incorrect"
)

type Event struct {
	ID         uuid.UUID       `json:"id"`
	Type       string          `json:"type"`
	OccurredAt time.Time       `json:"occurred_at"`
	UserID     uuid.UUID       `json:"user_id"`
	InstanceID *uuid.UUID      `json:"instance_id,omitempty"`
	MachineID  *uuid.UUID      `json:"machine_id,omitempty"`
	Data       json.RawMessage `json:"data,omitempty"`
	RequestID  string          `json:"request_id,omitempty"`
}

type CorrectFlagData struct {
	FlagType       string    `json:"flag_type"`
	ContentType    string    `json:"content_type"`
	ContentID      uuid.UUID `json:"content_id"`
	MachineSlug    string    `json:"machine_slug,omitempty"`
	SecondsToSolve int       `json:"seconds_to_solve,omitempty"`
	IPAddress      string    `json:"ip_address,omitempty"`
	FlagHash       string    `json:"flag_hash"`
	SubmissionID   uuid.UUID `json:"submission_id"`
	IsFirstBlood   bool      `json:"is_first_blood"`
	BloodRank      int       `json:"blood_rank,omitempty"`
}

type IncorrectFlagData struct {
	ContentType     string    `json:"content_type"`
	ContentID       uuid.UUID `json:"content_id"`
	IPAddress       string    `json:"ip_address,omitempty"`
	SubmissionID    uuid.UUID `json:"submission_id"`
	RejectionReason string    `json:"rejection_reason"`
	FlagHashPrefix  string    `json:"flag_hash_prefix,omitempty"` // first 12 chars only (privacy)
}

type Publisher struct {
	writer *kafka.Writer
	log    zerolog.Logger
}

type Config struct {
	Brokers []string
	Topic   string
	UseTLS  bool
	Acks    string // "all" | "one"
}

func New(cfg Config, log zerolog.Logger) *Publisher {
	transport := &kafka.Transport{}
	if cfg.UseTLS {
		transport.TLS = &tls.Config{}
	}

	acks := kafka.RequireAll
	if cfg.Acks == "one" {
		acks = kafka.RequireOne
	}

	w := &kafka.Writer{
		Addr:         kafka.TCP(cfg.Brokers...),
		Topic:        cfg.Topic,
		Balancer:     &kafka.Hash{},
		BatchTimeout: 50 * time.Millisecond,
		BatchSize:    20,
		RequiredAcks: acks,
		Async:        false,
		Transport:    transport,
	}
	return &Publisher{writer: w, log: log}
}

// PublishCorrect emits a flag.submitted.correct event.
func (p *Publisher) PublishCorrect(ctx context.Context, userID uuid.UUID, instanceID *uuid.UUID, machineID *uuid.UUID, data CorrectFlagData, requestID string) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return p.publish(ctx, Event{
		ID: uuid.New(), Type: TypeCorrect, OccurredAt: time.Now().UTC(),
		UserID: userID, InstanceID: instanceID, MachineID: machineID,
		Data: body, RequestID: requestID,
	})
}

// PublishIncorrect emits a flag.submitted.incorrect event.
func (p *Publisher) PublishIncorrect(ctx context.Context, userID uuid.UUID, instanceID *uuid.UUID, data IncorrectFlagData, requestID string) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return p.publish(ctx, Event{
		ID: uuid.New(), Type: TypeIncorrect, OccurredAt: time.Now().UTC(),
		UserID: userID, InstanceID: instanceID, Data: body, RequestID: requestID,
	})
}

func (p *Publisher) publish(ctx context.Context, evt Event) error {
	body, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	err = p.writer.WriteMessages(writeCtx, kafka.Message{
		Key:   evt.UserID[:],
		Value: body,
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte(evt.Type)},
			{Key: "event_id", Value: []byte(evt.ID.String())},
		},
	})
	if err != nil {
		p.log.Error().
			Err(err).
			Str("event_type", evt.Type).
			Str("event_id", evt.ID.String()).
			Msg("kafka write failed")
		return err
	}
	return nil
}

func (p *Publisher) Close() error { return p.writer.Close() }
