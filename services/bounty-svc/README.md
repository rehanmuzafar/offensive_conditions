# Bounty Service

Bug bounty platform. Companies publish programs, security researchers submit
vulnerability reports, triagers validate severity and award payouts.

## Responsibilities

### Programs
- Public + private bounty programs scoped to assets (domains, IPs, mobile apps, source repos)
- Reward tiers by severity (critical/high/medium/low) with min/max bounds in currency
- VRT (Vulnerability Rating Taxonomy) categories defining what's in/out of scope
- Program states: `draft → published → paused → closed`
- Submission policy: who can submit (open, invite-only, qualifying-tier-only)

### Reports
- Researcher submits: title, description, steps to reproduce, impact, attachments
- States: `submitted → triaging → accepted/rejected/duplicate/informational → resolved → paid`
- Severity assessment (CVSS 3.1 vector + score)
- Duplicate linking — newer report links to original, no payout
- Attachment uploads (S3/MinIO presigned URLs)
- Comments / activity timeline per report (researcher + triager threads)

### Payouts
- Calls `payment-svc` gRPC to create Stripe Connect payouts to the researcher
- Tracks payout state independently: `requested → processing → paid → failed`
- Researchers must have a verified Stripe Connect account
- Tax forms (W-9 / W-8BEN) tracked but stored elsewhere (out of scope here)

### Leaderboards
- Per-program: top researchers by total reports / total payout / reputation
- Global: all-time + last 90 days

### Compliance hooks
- Audit log of every state transition + payout (for company accounting)
- CVE coordination: when a report is published, can mint a CVE via MITRE API
  (production wiring later)

## HTTP API

Researcher-facing:
- `GET    /v1/programs` — list public programs
- `GET    /v1/programs/:slug` — program details + scope
- `POST   /v1/programs/:slug/reports` — submit a new report
- `GET    /v1/me/reports` — my submissions
- `GET    /v1/reports/:id` — full report (researcher or program member only)
- `POST   /v1/reports/:id/comments` — add a comment
- `POST   /v1/reports/:id/attachments` — request presigned upload URL
- `POST   /v1/me/payout-account` — register Stripe Connect account (proxies to payment-svc)
- `GET    /v1/me/payouts` — payout history

Program-owner / triager:
- `POST   /v1/admin/programs` — create program
- `PATCH  /v1/admin/programs/:slug` — update
- `POST   /v1/admin/programs/:slug/publish` — flip draft → published
- `POST   /v1/admin/programs/:slug/pause` — pause new submissions
- `POST   /v1/admin/reports/:id/triage` — set severity + accept/reject/duplicate
- `POST   /v1/admin/reports/:id/award` — set bounty amount + trigger payout
- `POST   /v1/admin/reports/:id/resolve` — close as fixed
- `GET    /v1/admin/programs/:slug/reports` — moderator dashboard

Public:
- `GET    /v1/leaderboards/global`
- `GET    /v1/leaderboards/programs/:slug`
- `GET    /v1/hall-of-fame/:program_slug`

## gRPC

- `GetReportSummary(report_id)` — for cross-service refs
- `GetProgramSummary(program_slug)` — used by content-svc to link programs
- `RecordPayout(report_id, amount_cents, currency)` — called by payment-svc
  when a Stripe Connect payout settles

## Kafka

Publishes to `bounty.events`:
- `bounty.report.submitted`
- `bounty.report.triaged`
- `bounty.report.accepted`
- `bounty.report.rejected`
- `bounty.report.duplicate`
- `bounty.report.resolved`
- `bounty.report.awarded`
- `bounty.payout.requested`
- `bounty.payout.completed`
- `bounty.program.published`

Consumes:
- `payment.events` → `payment.payout.sent` to update report state

## Schema (owns `bounty.*`)

- `programs` — bounty programs
- `program_scope` — assets in scope per program
- `program_rewards` — reward tiers
- `reports` — vulnerability reports
- `report_comments` — comment thread
- `report_attachments` — uploaded files (S3 keys)
- `report_state_transitions` — audit log
- `payouts` — payout requests + states
- `cve_records` — when a report becomes a public CVE

## Build & Run

```bash
poetry install
poetry run alembic upgrade head
poetry run uvicorn app.main:app --reload --port 8009
poetry run celery -A app.workers.celery_app worker --loglevel=info
poetry run python -m scripts.seed_dev_bounty
pytest
```
