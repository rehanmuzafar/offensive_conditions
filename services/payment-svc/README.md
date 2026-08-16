# Payment Service

Stripe-backed billing, subscriptions, invoices, refunds, payouts. Built on
Node.js + TypeScript with Fastify.

## Responsibilities

### Plans
- `vip_monthly`, `vip_annual`, `vip_plus_monthly`, `vip_plus_annual`, lifetime
- Regional pricing (PPP-adjusted for PK, IN, BD, etc.)
- Feature flags per plan (max concurrent instances, daily spawns)

### Subscriptions
- Lifecycle: `trialing → active → past_due → canceled | unpaid | incomplete`
- Stripe-managed billing periods; we mirror state via webhooks
- `cancel_at_period_end` honored; immediate cancel only by mod/admin
- Tier upgrade/downgrade with prorating

### Checkout
- Stripe Checkout Session (hosted) for subscription signup
- Stripe Customer Portal for self-service plan changes + card updates

### Invoices
- Auto-issued by Stripe on each billing cycle
- PDF link stored; status mirrored
- One-time charges (e.g. lifetime plan, bounty hunter payout) also create invoices

### Transactions (double-entry ledger)
- Partitioned by month (Phase 2 schema)
- Records every charge, refund, adjustment, chargeback, payout
- Idempotency-Key header forwarded to Stripe
- Each row links to the originating invoice + subscription

### Webhooks
- Stripe → our `/webhooks/stripe` endpoint
- Signature verification using `STRIPE_WEBHOOK_SECRET`
- Event deduplication via Redis (event_id replay protection, 7-day window)
- BullMQ async processing for non-trivial handlers

### Refunds + disputes
- Manual refund initiated by admin (full or partial)
- Auto-refund for failed subscription provisioning (rare but covered)
- Dispute notifications routed to support queue

### Coupons + promo codes
- `payment.coupons` + `payment.coupon_redemptions` (Phase 2)
- Percentage or fixed-amount discount
- Per-user redemption limit + total redemption cap

### Payouts (Stripe Connect)
- Connected accounts for bounty hunters (Phase 12 dependency)
- Manual + scheduled payouts
- KYC handled by Stripe; we just route the payout

## Architecture

```
fastify (HTTP :8007)   → checkout, customer portal, webhooks, admin endpoints
                       + gRPC (:9007) for tier checks from other services
bullmq worker          → refund processing, webhook side-effects,
                         invoice generation, retry failures
```

### HTTP endpoints

Public/customer:
- `GET    /v1/plans` — list active plans (filtered by region)
- `GET    /v1/plans/:code` — get plan details
- `POST   /v1/checkout/session` — create Stripe Checkout Session
- `POST   /v1/portal/session` — create Stripe Customer Portal session
- `GET    /v1/me/subscription` — get my active subscription
- `POST   /v1/me/subscription/cancel` — set `cancel_at_period_end=true`
- `POST   /v1/me/subscription/resume` — undo a pending cancel
- `GET    /v1/me/invoices` — list invoices
- `GET    /v1/me/invoices/:id` — get invoice with PDF link
- `POST   /v1/coupons/redeem` — validate + reserve a coupon (used at checkout)

Admin:
- `GET    /v1/admin/subscriptions?status=&tier=`
- `POST   /v1/admin/subscriptions/:id/cancel` — immediate cancel
- `POST   /v1/admin/refunds` — issue refund
- `GET    /v1/admin/transactions` — ledger search
- `POST   /v1/admin/plans` — create plan
- `PATCH  /v1/admin/plans/:id` — update plan
- `POST   /v1/admin/coupons` — create coupon
- `POST   /v1/admin/payouts` — initiate Stripe Connect payout

Webhooks:
- `POST /webhooks/stripe` — signature verified, idempotent

### gRPC

- `GetUserTier(user_id)` → current tier (free/vip/vip_plus/team/enterprise)
- `GetUserSubscription(user_id)` → status + period + plan
- `IsFeatureEnabled(user_id, feature_code)` → boolean
- `GetActiveSubscribers(plan_code)` → for marketing rollouts

### Kafka events

Emitted to `payment.events`:
- `payment.subscription.created`
- `payment.subscription.updated`
- `payment.subscription.canceled`
- `payment.invoice.paid`
- `payment.invoice.failed`
- `payment.charge.succeeded`
- `payment.refund.issued`
- `payment.dispute.created`
- `payment.payout.sent`

Consumed (from `auth.events` to set up customer on signup):
- `auth.user.registered`

### BullMQ queues

- `webhook-processing` — heavy handlers extracted from sync path
- `refund-processing` — async refund execution
- `invoice-pdf-generation` — Stripe finalize → cache locally
- `subscription-cleanup` — expire `incomplete` subs after 24h
- `dunning-retry` — retry failed payments per Stripe Smart Retries config

## Build & Run

```bash
npm install
npm run db:migrate
npm run dev                # nodemon on src/server.ts
npm run worker:dev         # BullMQ worker
npm test
docker build -t payment-svc .
```
