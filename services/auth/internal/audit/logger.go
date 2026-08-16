package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// Severity levels mirror syslog conventions.
type Severity string

const (
	SeverityDebug     Severity = "debug"
	SeverityInfo      Severity = "info"
	SeverityNotice    Severity = "notice"
	SeverityWarning   Severity = "warning"
	SeverityError     Severity = "error"
	SeverityCritical  Severity = "critical"
	SeverityAlert     Severity = "alert"
	SeverityEmergency Severity = "emergency"
)

// Category groups related actions.
type Category string

const (
	CategoryAuth     Category = "auth"
	CategoryAdmin    Category = "admin"
	CategorySecurity Category = "security"
)

// ActorType describes who performed the action.
type ActorType string

const (
	ActorUser      ActorType = "user"
	ActorAdmin     ActorType = "admin"
	ActorSystem    ActorType = "system"
	ActorAPIKey    ActorType = "api_key"
	ActorAnonymous ActorType = "anonymous"
)

// Outcome of the action.
type Outcome string

const (
	OutcomeSuccess Outcome = "success"
	OutcomeFailure Outcome = "failure"
	OutcomeDenied  Outcome = "denied"
	OutcomePartial Outcome = "partial"
)

// Event represents a single audit log entry.
type Event struct {
	ActorType     ActorType
	ActorID       *uuid.UUID
	ActorIP       netip.Addr
	ActorUA       string
	Action        string         // e.g. "user.login", "user.password_reset"
	Category      Category
	Severity      Severity
	TargetType    string
	TargetID      *uuid.UUID
	Service       string
	RequestID     string
	Outcome       Outcome
	StatusCode    int
	ErrorMessage  string
	Metadata      map[string]any
	Diff          map[string]any
	OccurredAt    time.Time
}

// Logger writes events to the audit.log table.
// In production a batching writer should be used; for the auth service
// audit events are infrequent enough to write synchronously.
type Logger struct {
	pool    *pgxpool.Pool
	service string
	log     zerolog.Logger
}

func New(pool *pgxpool.Pool, service string, log zerolog.Logger) *Logger {
	return &Logger{pool: pool, service: service, log: log}
}

// Write persists an audit event. Errors are logged but not returned because
// audit logging must never block the caller's main action.
func (l *Logger) Write(ctx context.Context, e Event) {
	if e.Service == "" {
		e.Service = l.service
	}
	if e.OccurredAt.IsZero() {
		e.OccurredAt = time.Now().UTC()
	}
	if e.Severity == "" {
		e.Severity = SeverityInfo
	}

	metaJSON, _ := json.Marshal(e.Metadata)
	var diffJSON []byte
	if e.Diff != nil {
		diffJSON, _ = json.Marshal(e.Diff)
	}

	ip := ""
	if e.ActorIP.IsValid() {
		ip = e.ActorIP.String()
	}

	const q = `
		INSERT INTO audit.log (
			actor_type, actor_id, actor_ip, actor_user_agent,
			action, category, severity,
			target_type, target_id,
			service, request_id,
			outcome, status_code, error_message,
			metadata, diff, occurred_at
		) VALUES (
			$1, $2, NULLIF($3, '')::inet, NULLIF($4, ''),
			$5, $6, $7,
			NULLIF($8, ''), $9,
			$10, NULLIF($11, ''),
			$12, NULLIF($13, 0), NULLIF($14, ''),
			$15, $16, $17
		)`

	_, err := l.pool.Exec(ctx, q,
		e.ActorType, e.ActorID, ip, e.ActorUA,
		e.Action, e.Category, e.Severity,
		e.TargetType, e.TargetID,
		e.Service, e.RequestID,
		e.Outcome, e.StatusCode, e.ErrorMessage,
		metaJSON, diffJSON, e.OccurredAt,
	)
	if err != nil {
		l.log.Error().Err(err).
			Str("action", e.Action).
			Str("actor_type", string(e.ActorType)).
			Msg("audit log write failed")
	}
}

// Convenience helpers for common auth events

func (l *Logger) UserRegistered(ctx context.Context, userID uuid.UUID, ip netip.Addr, ua, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorUser, ActorID: &userID, ActorIP: ip, ActorUA: ua,
		Action: "user.registered", Category: CategoryAuth, Severity: SeverityInfo,
		TargetType: "user", TargetID: &userID,
		RequestID: requestID, Outcome: OutcomeSuccess,
	})
}

func (l *Logger) LoginSuccess(ctx context.Context, userID uuid.UUID, ip netip.Addr, ua, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorUser, ActorID: &userID, ActorIP: ip, ActorUA: ua,
		Action: "user.login", Category: CategoryAuth, Severity: SeverityInfo,
		TargetType: "user", TargetID: &userID,
		RequestID: requestID, Outcome: OutcomeSuccess,
	})
}

func (l *Logger) LoginFailed(ctx context.Context, email string, ip netip.Addr, ua, reason, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorAnonymous, ActorIP: ip, ActorUA: ua,
		Action: "user.login_failed", Category: CategoryAuth, Severity: SeverityWarning,
		RequestID: requestID, Outcome: OutcomeFailure,
		ErrorMessage: reason,
		Metadata:     map[string]any{"email_attempted": email},
	})
}

func (l *Logger) AccountLocked(ctx context.Context, userID uuid.UUID, ip netip.Addr, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorSystem, ActorIP: ip,
		Action: "user.account_locked", Category: CategorySecurity, Severity: SeverityWarning,
		TargetType: "user", TargetID: &userID,
		RequestID: requestID, Outcome: OutcomeSuccess,
	})
}

func (l *Logger) RefreshTokenReused(ctx context.Context, userID uuid.UUID, familyID uuid.UUID, ip netip.Addr, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorAnonymous, ActorIP: ip,
		Action: "user.refresh_token_reuse", Category: CategorySecurity, Severity: SeverityCritical,
		TargetType: "user", TargetID: &userID,
		RequestID: requestID, Outcome: OutcomeDenied,
		Metadata: map[string]any{"family_id": familyID.String()},
	})
}

func (l *Logger) PasswordChanged(ctx context.Context, userID uuid.UUID, ip netip.Addr, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorUser, ActorID: &userID, ActorIP: ip,
		Action: "user.password_changed", Category: CategorySecurity, Severity: SeverityNotice,
		TargetType: "user", TargetID: &userID,
		RequestID: requestID, Outcome: OutcomeSuccess,
	})
}

func (l *Logger) TFAEnabled(ctx context.Context, userID uuid.UUID, ip netip.Addr, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorUser, ActorID: &userID, ActorIP: ip,
		Action: "user.tfa_enabled", Category: CategorySecurity, Severity: SeverityNotice,
		TargetType: "user", TargetID: &userID,
		RequestID: requestID, Outcome: OutcomeSuccess,
	})
}

func (l *Logger) TFADisabled(ctx context.Context, userID uuid.UUID, ip netip.Addr, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorUser, ActorID: &userID, ActorIP: ip,
		Action: "user.tfa_disabled", Category: CategorySecurity, Severity: SeverityWarning,
		TargetType: "user", TargetID: &userID,
		RequestID: requestID, Outcome: OutcomeSuccess,
	})
}

func (l *Logger) SessionRevoked(ctx context.Context, userID, sessionID uuid.UUID, requestID string) {
	l.Write(ctx, Event{
		ActorType: ActorUser, ActorID: &userID,
		Action: "user.session_revoked", Category: CategoryAuth, Severity: SeverityNotice,
		TargetType: "session", TargetID: &sessionID,
		RequestID: requestID, Outcome: OutcomeSuccess,
		Metadata: map[string]any{"target_user_id": userID.String()},
	})
}

// helper to convert anything implementing fmt.Stringer to string in metadata
func ToString(v any) string {
	if s, ok := v.(fmt.Stringer); ok {
		return s.String()
	}
	return fmt.Sprintf("%v", v)
}
