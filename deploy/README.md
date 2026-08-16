# OFFCON — Run the Whole Platform Locally

One folder, (almost) one command. This brings up **all 12 backend services +
the Next.js frontend + Postgres + Redis + Kafka + MinIO + Mailpit** with an
nginx edge fronting the API.

> Heads-up: this is a ~100k-line, 13-component stack. The **first** `docker
> compose up` will likely surface a few build or integration issues — that is
> normal for a system this size and we fix them iteratively. This is not a
> "double-click and it's perfect" setup; it's a real backend.

## Prerequisites

- **Docker** + **Docker Compose v2** (`docker compose version` should work)
- **~8 GB RAM** free for Docker (12 services + Kafka + Postgres add up)
- **openssl** (for the one-time key generation; preinstalled on macOS/Linux)
- Ports free on the host: `3000, 5432, 6379, 8001-8012, 8025, 8080, 9000-9012`

## Quick start

```bash
cd deploy
./setup.sh                 # one-time: generates the JWT keypair
docker compose up --build  # build + start everything (first run is slow)
```

Then open:

| URL | What |
|-----|------|
| http://localhost:3000 | **Frontend** (the website) |
| http://localhost:8080/v1/... | API edge (nginx → services) |
| http://localhost:8025 | Mailpit — catches all auth emails |
| http://localhost:9101 | MinIO console (`offcon_dev` / `dev_only_change_in_prod`) |
| localhost:5432 | Postgres (`offcon_admin` / `dev_only_change_in_prod`) |

Stop everything: `docker compose down`
Wipe data too: `docker compose down -v`

## What's inside

```
deploy/
├── docker-compose.yml   the whole platform
├── .env                 shared dev config (DB, Redis, Kafka, JWT paths, ...)
├── nginx.conf           edge routing /v1/<area> → owning service
├── setup.sh             generates the shared JWT keypair
└── secrets/             jwt-private.pem + jwt-public.pem (created by setup.sh)
```

### Port map (collisions resolved here)

The services' default ports collided (several wanted 8001/8003/8005). The
compose file remaps them via `HTTP_PORT`/`GRPC_PORT`:

| Service | HTTP | gRPC |  | Service | HTTP | gRPC |
|---------|------|------|--|---------|------|------|
| auth | 8001 | 9001 | | payment-svc | 8007 | 9007 |
| orchestrator | 8002 | 9002 | | notification-svc | 8008 | 9008 |
| scoring | 8003 | 9003 | | bounty-svc | 8009 | 9009 |
| ctf-svc | 8004 | 9004 | | content-svc | 8010 | 9010 |
| flag-verifier | 8005 | — | | writeup-svc | 8011 | 9011 |
| forum-svc | 8006 | 9006 | | user-svc | 8012 | 9012 |

## How requests flow

```
browser → frontend (:3000)
        → /api/v1/* rewritten by Next to http://localhost:8080/v1/*
        → nginx edge (:8080) routes by path prefix
        → the owning service (e.g. /v1/machines → orchestrator:8002)
```

## Database

`postgres` runs `database/scripts/init.sql` on first boot (schemas + roles).
For dev, every service connects as the `offcon_admin` superuser (set in `.env`)
to avoid per-service-role friction. If a service needs its tables migrated and
they're not auto-applied on startup, run the migrations:

```bash
# from the repo root, against the running postgres
docker compose -f database/docker-compose.yml run --rm migrate \
  -path /migrations/auth \
  -database "postgres://offcon_admin:dev_only_change_in_prod@postgres:5432/offcon?sslmode=disable" up
```

(Repeat per schema: auth, users, content, ctf, forum, writeup, payment, scoring, lab, audit.)

## Running a subset

You don't have to run everything while debugging:

```bash
docker compose up postgres redis kafka minio      # infra only
docker compose up --build auth orchestrator edge frontend   # a slice
```

## When something fails (expected on first run)

```bash
docker compose ps                 # what's up / crashing
docker compose logs -f auth       # tail one service
docker compose up --build auth    # rebuild just one
```

Copy the failing log and we fix it. Typical first-run issues: a missing Go/Python/Node
dependency, a service expecting a migration that hasn't run, or a service that needs
ClickHouse/Stripe creds (left as dev stubs here).

## Frontend-only (no backend)

If you just want to see the UI, the frontend runs standalone on mock data:

```bash
cd ../frontend && npm install && npm run dev   # http://localhost:3000
```
