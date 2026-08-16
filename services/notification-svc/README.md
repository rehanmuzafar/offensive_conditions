# Notification Service

Centralised notification fan-out for the Offensive Conditions platform.
Consumes domain events from Kafka, applies per-user routing + preferences,
and delivers via email, in-app, and outbound webhook channels.

## Responsibilities

### Channels
- **Email** — Transactional via Resend (primary) + SendGrid (failover). MJML
  templates compiled to HTML once, then rendered with per-recipient variables.
- **In-app** — Persistent notifications in `notification.notifications`, exposed
  via REST + WebSocket for real-time delivery.
- **Webhook** — Outbound HTTP POST with HMAC-SHA256 signature, retry with
  exponential backoff, signed with per-endpoint secret.
- **Push / SMS / Slack / Discord** — Hook points exist; production wiring later.

### Routing
- Each event type maps to a default notification template + channel set
- Per-user channel preferences override defaults
- Quiet hours respected (user TZ aware) — non-urgent goes to next morning
- Digest batching for low-priority (forum activity, new writeups, etc.)

### Event sources (Kafka consumers)
- `auth.events` — registered, login_alert, password_changed, tfa_enabled
- `scoring.events` — solve, first_blood, season_winner, badge_earned
- `payment.events` — subscription_renewed, payment_failed, invoice_paid, refund_issued
- `forum.events` — reply_to_thread, mention, post_reported (mods)
- `writeup.events` — writeup_approved, writeup_rejected, featured
- `ctf.events` — ctf_starting_soon, team_invite, ctf_completed

### Idempotency + reliability
- Every published notification keyed by `(event_id, user_id, channel)`
- Failed delivery → BullMQ retry with backoff, max 5 attempts
- Dead-letter queue + alerting after retries exhausted
- Channel provider quotas tracked per-day to avoid burning out keys

## HTTP API

User-facing:
- `GET    /v1/me/notifications` — list with cursor pagination
- `GET    /v1/me/notifications/unread-count`
- `POST   /v1/me/notifications/mark-read` — by IDs or all
- `DELETE /v1/me/notifications/:id` — soft delete
- `GET    /v1/me/preferences` — current channel prefs
- `PUT    /v1/me/preferences` — bulk update prefs

Outbound webhooks (third-party):
- `GET    /v1/me/webhooks`
- `POST   /v1/me/webhooks` — register endpoint + event filters
- `DELETE /v1/me/webhooks/:id`
- `POST   /v1/me/webhooks/:id/rotate-secret`
- `POST   /v1/me/webhooks/:id/test` — synthetic event

Admin:
- `GET    /v1/admin/templates`
- `POST   /v1/admin/templates`
- `PATCH  /v1/admin/templates/:id`
- `POST   /v1/admin/broadcast` — system-wide announcement
- `GET    /v1/admin/deliveries?status=&channel=`
- `POST   /v1/admin/notifications/replay` — replay failed sends

WebSocket:
- `GET    /v1/ws/notifications` — live stream of new notifications for the
  authenticated user (Bearer token via query param for browser WS)

## gRPC

- `SendNotification(user_id, event_type, payload)` — service-to-service direct
  send (bypasses Kafka, for sync flows like password reset)
- `GetUnreadCount(user_id)` → number
- `GetUserPreferences(user_id)` → channel prefs

## BullMQ queues

- `email-delivery` — concurrency 8, primary then failover provider
- `webhook-delivery` — concurrency 16, HMAC sign + POST + retry
- `digest-rollup` — daily/weekly batchers
- `template-render` — pre-render expensive templates on a schedule
- `quiet-hours-resume` — delayed jobs to deliver at user's morning

## Schema

This service owns the `notification` schema:
- `notifications` — in-app records (user_id, event_id, type, title, body,
  read_at, created_at, deleted_at)
- `templates` — MJML/Handlebars source + compiled cache
- `preferences` — per-user-per-event-type channel toggles
- `webhooks` — registered third-party endpoints
- `deliveries` — every send attempt for observability + replay
- `consumed_events` — Kafka offset + dedup table

See `src/migrations/` for the up scripts.

## Build & Run

```bash
npm install
npm run db:migrate
npm run dev                # HTTP + gRPC server
npm run worker:dev         # BullMQ worker
npm run consumer:dev       # Kafka consumers
npm test
```
