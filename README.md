# OFFCON — Offense Conditions

A full-scale cybersecurity training platform (HackTheBox / TryHackMe style):
12 backend microservices, a Next.js web frontend, an API gateway, full
observability, and CI/CD — all in one monorepo.

> **Heads-up (read this):** This is a ~100k-line, 13-component system. The
> **first** time you build and run it, expect to hit a few build or integration
> issues — that's normal for a stack this size, not a sign anything is broken.
> The infrastructure layer (databases) comes up cleanly; the application
> services are brought up and fixed iteratively.

---

## Quick start

> **New here? Read [`SETUP.md`](SETUP.md).** It covers the whole workflow —
> first run, what to do after every pull, how secrets are handled, and the two
> rules (migration numbering, and always building the frontend through compose)
> that stop us breaking each other's checkouts.

One command, from a fresh clone:

```bash
git clone https://github.com/rehanmuzafar/offensive_conditions.git
cd offensive_conditions
./setup.sh
```

That is the whole setup. `setup.sh` generates every secret the stack needs
locally, builds the images, brings up Postgres and Redis, applies the
migrations, and starts the rest.

**Run the same command after every `git pull`.** It is idempotent — it never
regenerates a secret you already have and never touches your data — and it is
what applies a colleague's new migration and picks up any new configuration
their commit introduced.

Then open:

| URL | What |
|-----|------|
| http://localhost:3000 | **Frontend** (the website) |
| http://localhost:8080/v1/... | API edge (nginx → services) |
| http://localhost:8025 | Mailpit — catches every outgoing email |
| http://localhost:9101 | MinIO console (credentials are in `deploy/.env`) |

### Secrets

`deploy/.env` and `deploy/secrets/` are not in git, and never should be — they
hold the database passwords and the JWT signing key. `setup.sh` generates both
on first run, so nothing has to be shared out of band and no two machines share
a secret.

If a commit adds a new configuration variable, put it in
`deploy/.env.example`. Everyone else picks it up on their next `./setup.sh`,
and if the name looks like a secret (`*_SECRET`, `*_PASSWORD`, `*_TOKEN`,
`*_KEY`) a value is generated for them automatically. Credentials issued by an
outside provider — Stripe, SMTP, OAuth — are deliberately left empty instead,
so the feature behind them stays visibly switched off rather than half-working.

### Migrations

Migrations live in `database/migrations/<schema>/` and are numbered per schema.
**Pull before you write one.** Two people who both create `0018_*` in the same
schema will produce a duplicate-version error for everybody, and git will merge
the two files without complaint because their names differ.

### Bringing it up piece by piece

`./setup.sh` starts everything. To bring services up one at a time instead —
useful when debugging a single one:

```bash
./deploy/bootstrap.sh                                  # secrets only
cd deploy
docker compose up -d postgres redis kafka minio mailpit
docker compose run --rm migrator
docker compose up -d --build auth                      # then one service at a time
```

If a service fails, read its logs (`docker compose logs -f <service>`).

### Just want to see the UI? (no Docker, no backend)

The frontend runs standalone on mock data:

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

---

## 📁 What's in here

```
offensive_conditions/
├── deploy/          ⭐ Run the whole platform locally (start here)
│   ├── docker-compose.yml   19 containers: infra + 12 services + edge + frontend
│   ├── .env                 shared dev config
│   ├── nginx.conf           API edge routing
│   ├── setup.sh             generates JWT keys
│   └── README.md            full run guide + troubleshooting
│
├── frontend/        Next.js 15 web app — 48 pages, runs on mock data standalone
│
├── services/        The 12 backend microservices
│   ├── auth/            (Go)     authentication, JWT, 2FA, OAuth
│   ├── orchestrator/   (Go)     lab/machine instance lifecycle
│   ├── scoring/        (Go)     points, ranks, leaderboards, seasons
│   ├── flag-verifier/  (Go)     flag submission + verification
│   ├── user-svc/       (Go)     profiles, sessions, API keys
│   ├── content-svc/    (Python) machine/challenge catalog
│   ├── ctf-svc/        (Python) CTF events + challenges
│   ├── forum-svc/      (Python) community forum
│   ├── writeup-svc/    (Python) writeups
│   ├── bounty-svc/     (Python) bug bounty programs + reports
│   ├── payment-svc/    (Node)   billing, subscriptions (Stripe)
│   └── notification-svc(Node)   notifications (email/push/in-app)
│
├── database/        PostgreSQL schemas, migrations, init.sql
│
├── gateway/         API gateway (Istio/Envoy) config for production
│
├── observability/   Prometheus + Grafana + Loki + Tempo + OTel + AlertManager
│   └── docker-compose.observability.yml   run the monitoring stack locally
│
├── cicd/            Helm charts + ArgoCD GitOps
├── .github/         GitHub Actions CI/CD workflows
│
├── ARCHITECTURE.md          system design overview
└── REPOSITORY_STRUCTURE.md  detailed repo layout
```

---

## 🧩 Prerequisites

- **Docker** + **Docker Compose v2** (`docker compose version`)
- **~8 GB RAM** free for Docker
- **Node.js 20+** (only if running the frontend outside Docker)
- **openssl** (used by `setup.sh` to generate secrets — preinstalled on macOS/Linux)

---

## 🛠️ Common Docker commands

```bash
cd deploy

docker compose up                 # start (after first --build)
docker compose up -d              # start in background
docker compose stop               # stop (keeps data)
docker compose down               # stop + remove containers (keeps data in volumes)
docker compose down -v            # stop + remove + WIPE all data (fresh start)
docker compose ps                 # what's running
docker compose logs -f auth       # tail one service's logs
docker compose up --build auth    # rebuild + restart one service
```

---

## 📊 Observability (optional, separate stack)

```bash
cd observability
docker compose -f docker-compose.observability.yml up -d
# Grafana → http://localhost:3000  (admin / admin)
```

---

## ⚠️ Production note

The values in `deploy/.env` are **dev-only** (weak passwords, disabled TLS, stub
payment keys). Never use them in production. Production deployment uses the Helm
charts in `cicd/` + secrets management — see `cicd/README.md`.
