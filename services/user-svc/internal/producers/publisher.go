// Package producers emits Kafka events for user lifecycle changes.
package producers

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/segmentio/kafka-go"
)

type EventType string

const (
	EventProfileUpdated     EventType = "user.profile.updated"
	EventAvatarUpdated      EventType = "user.avatar.updated"
	EventTeamCreated        EventType = "user.team.created"
	EventTeamJoined         EventType = "user.team.joined"
	EventTeamLeft           EventType = "user.team.left"
	EventTeamKicked         EventType = "user.team.kicked"
	EventTeamPromoted       EventType = "user.team.promoted"
	EventTeamDisbanded      EventType = "user.team.disbanded"
	EventFriendRequest      EventType = "user.friend.requested"
	EventFriendAdded        EventType = "user.friend.added"
	EventFriendRemoved      EventType = "user.friend.removed"
	EventBlocked            EventType = "user.blocked"
	EventUnblocked          EventType = "user.unblocked"
	EventFollowed           EventType = "user.followed"
	EventUnfollowed         EventType = "user.unfollowed"
	EventDeletionRequested  EventType = "user.deletion.requested"
	EventDeletionCancelled  EventType = "user.deletion.cancelled"
	EventUserDeleted        EventType = "user.deleted"
	EventExportRequested    EventType = "user.export.requested"
	EventExportCompleted    EventType = "user.export.completed"
)

// Envelope is the wire format for every Kafka message.
type Envelope struct {
	EventID     string          `json:"event_id"`
	EventType   EventType       `json:"event_type"`
	OccurredAt  time.Time       `json:"occurred_at"`
	ActorUserID *uuid.UUID      `json:"actor_user_id,omitempty"`
	SubjectID   *uuid.UUID      `json:"subject_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
	RequestID   string          `json:"request_id,omitempty"`
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
	Acks    string // "all" recommended
}

func New(cfg Config, log zerolog.Logger) (*Publisher, error) {
	if len(cfg.Brokers) == 0 {
		return nil, fmt.Errorf("no kafka brokers configured")
	}
	if cfg.Topic == "" {
		return nil, fmt.Errorf("kafka topic required")
	}

	transport := &kafka.Transport{
		DialTimeout: 10 * time.Second,
	}
	if cfg.UseTLS {
		transport.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	requiredAcks := kafka.RequireAll
	if cfg.Acks == "one" {
		requiredAcks = kafka.RequireOne
	} else if cfg.Acks == "none" {
		requiredAcks = kafka.RequireNone
	}

	w := &kafka.Writer{
		Addr:                   kafka.TCP(cfg.Brokers...),
		Topic:                  cfg.Topic,
		Balancer:               &kafka.Hash{},
		BatchTimeout:           50 * time.Millisecond,
		BatchSize:              100,
		WriteTimeout:           10 * time.Second,
		ReadTimeout:            10 * time.Second,
		RequiredAcks:           requiredAcks,
		AllowAutoTopicCreation: false,
		Async:                  false,
		Compression:            kafka.Snappy,
		Transport:              transport,
	}

	return &Publisher{writer: w, topic: cfg.Topic, log: log}, nil
}

func (p *Publisher) Close() error {
	if p.writer == nil {
		return nil
	}
	return p.writer.Close()
}

// publish does the dirty work for one event.
func (p *Publisher) publish(ctx context.Context, evtType EventType, actorID, subjectID *uuid.UUID, payload any, requestID string) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	env := Envelope{
		EventID:     uuid.NewString(),
		EventType:   evtType,
		OccurredAt:  time.Now().UTC(),
		ActorUserID: actorID,
		SubjectID:   subjectID,
		Payload:     raw,
		RequestID:   requestID,
	}
	body, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}
	// Partition by subject_id (or actor) so all events for a given user land on one partition.
	key := []byte{}
	if subjectID != nil {
		key = []byte(subjectID.String())
	} else if actorID != nil {
		key = []byte(actorID.String())
	}

	headers := []kafka.Header{
		{Key: "event_type", Value: []byte(evtType)},
		{Key: "event_id", Value: []byte(env.EventID)},
	}
	if requestID != "" {
		headers = append(headers, kafka.Header{Key: "request_id", Value: []byte(requestID)})
	}

	msg := kafka.Message{
		Key:     key,
		Value:   body,
		Headers: headers,
		Time:    env.OccurredAt,
	}

	if err := p.writer.WriteMessages(ctx, msg); err != nil {
		p.log.Error().Err(err).Str("event_type", string(evtType)).Msg("kafka publish failed")
		return err
	}
	p.log.Debug().Str("event_type", string(evtType)).Str("event_id", env.EventID).Msg("published")
	return nil
}

// =============================================================================
// Typed payloads
// =============================================================================

type ProfileUpdatedPayload struct {
	UserID       uuid.UUID         `json:"user_id"`
	ChangedFields []string         `json:"changed_fields"`
	NewValues    map[string]string `json:"new_values,omitempty"`
}

func (p *Publisher) PublishProfileUpdated(ctx context.Context, userID uuid.UUID, fields []string, vals map[string]string, requestID string) error {
	return p.publish(ctx, EventProfileUpdated, &userID, &userID,
		ProfileUpdatedPayload{UserID: userID, ChangedFields: fields, NewValues: vals}, requestID)
}

type AvatarUpdatedPayload struct {
	UserID    uuid.UUID `json:"user_id"`
	AvatarURL string    `json:"avatar_url"`
	Removed   bool      `json:"removed,omitempty"`
}

func (p *Publisher) PublishAvatarUpdated(ctx context.Context, userID uuid.UUID, url string, removed bool, requestID string) error {
	return p.publish(ctx, EventAvatarUpdated, &userID, &userID,
		AvatarUpdatedPayload{UserID: userID, AvatarURL: url, Removed: removed}, requestID)
}

type TeamEventPayload struct {
	TeamID  uuid.UUID  `json:"team_id"`
	UserID  uuid.UUID  `json:"user_id"`
	Role    string     `json:"role,omitempty"`
	ActorID *uuid.UUID `json:"actor_id,omitempty"`
}

func (p *Publisher) PublishTeamCreated(ctx context.Context, teamID, ownerID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventTeamCreated, &ownerID, &teamID,
		TeamEventPayload{TeamID: teamID, UserID: ownerID, Role: "owner"}, requestID)
}

func (p *Publisher) PublishTeamJoined(ctx context.Context, teamID, userID uuid.UUID, role, requestID string) error {
	return p.publish(ctx, EventTeamJoined, &userID, &teamID,
		TeamEventPayload{TeamID: teamID, UserID: userID, Role: role}, requestID)
}

func (p *Publisher) PublishTeamLeft(ctx context.Context, teamID, userID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventTeamLeft, &userID, &teamID,
		TeamEventPayload{TeamID: teamID, UserID: userID}, requestID)
}

func (p *Publisher) PublishTeamKicked(ctx context.Context, teamID, kickedID, actorID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventTeamKicked, &actorID, &teamID,
		TeamEventPayload{TeamID: teamID, UserID: kickedID, ActorID: &actorID}, requestID)
}

func (p *Publisher) PublishTeamPromoted(ctx context.Context, teamID, newOwnerID, previousOwnerID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventTeamPromoted, &previousOwnerID, &teamID,
		TeamEventPayload{TeamID: teamID, UserID: newOwnerID, Role: "owner", ActorID: &previousOwnerID}, requestID)
}

func (p *Publisher) PublishTeamDisbanded(ctx context.Context, teamID, actorID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventTeamDisbanded, &actorID, &teamID,
		TeamEventPayload{TeamID: teamID, UserID: actorID}, requestID)
}

type FriendEventPayload struct {
	RequesterID uuid.UUID `json:"requester_id"`
	ReceiverID  uuid.UUID `json:"receiver_id"`
	RequestID   uuid.UUID `json:"request_id,omitempty"`
}

func (p *Publisher) PublishFriendRequested(ctx context.Context, requestID uuid.UUID, requester, receiver uuid.UUID, reqID string) error {
	return p.publish(ctx, EventFriendRequest, &requester, &receiver,
		FriendEventPayload{RequesterID: requester, ReceiverID: receiver, RequestID: requestID}, reqID)
}

func (p *Publisher) PublishFriendAdded(ctx context.Context, a, b uuid.UUID, requestID string) error {
	return p.publish(ctx, EventFriendAdded, &a, &b,
		FriendEventPayload{RequesterID: a, ReceiverID: b}, requestID)
}

func (p *Publisher) PublishFriendRemoved(ctx context.Context, a, b uuid.UUID, requestID string) error {
	return p.publish(ctx, EventFriendRemoved, &a, &b,
		FriendEventPayload{RequesterID: a, ReceiverID: b}, requestID)
}

type BlockPayload struct {
	BlockerID uuid.UUID `json:"blocker_id"`
	BlockedID uuid.UUID `json:"blocked_id"`
}

func (p *Publisher) PublishBlocked(ctx context.Context, blocker, blocked uuid.UUID, requestID string) error {
	return p.publish(ctx, EventBlocked, &blocker, &blocked,
		BlockPayload{BlockerID: blocker, BlockedID: blocked}, requestID)
}

func (p *Publisher) PublishUnblocked(ctx context.Context, blocker, blocked uuid.UUID, requestID string) error {
	return p.publish(ctx, EventUnblocked, &blocker, &blocked,
		BlockPayload{BlockerID: blocker, BlockedID: blocked}, requestID)
}

type FollowPayload struct {
	FollowerID  uuid.UUID `json:"follower_id"`
	FollowingID uuid.UUID `json:"following_id"`
}

func (p *Publisher) PublishFollowed(ctx context.Context, follower, following uuid.UUID, requestID string) error {
	return p.publish(ctx, EventFollowed, &follower, &following,
		FollowPayload{FollowerID: follower, FollowingID: following}, requestID)
}

func (p *Publisher) PublishUnfollowed(ctx context.Context, follower, following uuid.UUID, requestID string) error {
	return p.publish(ctx, EventUnfollowed, &follower, &following,
		FollowPayload{FollowerID: follower, FollowingID: following}, requestID)
}

type DeletionPayload struct {
	UserID      uuid.UUID `json:"user_id"`
	ScheduledAt time.Time `json:"scheduled_at,omitempty"`
}

func (p *Publisher) PublishDeletionRequested(ctx context.Context, userID uuid.UUID, scheduledAt time.Time, requestID string) error {
	return p.publish(ctx, EventDeletionRequested, &userID, &userID,
		DeletionPayload{UserID: userID, ScheduledAt: scheduledAt}, requestID)
}

func (p *Publisher) PublishDeletionCancelled(ctx context.Context, userID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventDeletionCancelled, &userID, &userID,
		DeletionPayload{UserID: userID}, requestID)
}

func (p *Publisher) PublishUserDeleted(ctx context.Context, userID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventUserDeleted, &userID, &userID,
		DeletionPayload{UserID: userID}, requestID)
}

type ExportPayload struct {
	UserID   uuid.UUID `json:"user_id"`
	ExportID uuid.UUID `json:"export_id"`
}

func (p *Publisher) PublishExportRequested(ctx context.Context, userID, exportID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventExportRequested, &userID, &userID,
		ExportPayload{UserID: userID, ExportID: exportID}, requestID)
}

func (p *Publisher) PublishExportCompleted(ctx context.Context, userID, exportID uuid.UUID, requestID string) error {
	return p.publish(ctx, EventExportCompleted, &userID, &userID,
		ExportPayload{UserID: userID, ExportID: exportID}, requestID)
}
