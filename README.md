# OFFCON — Offensive Conditions

A full-scale cybersecurity training platform (HackTheBox / TryHackMe style):
12 backend microservices, a Next.js web frontend, an API gateway, full
observability, and CI/CD — all in one monorepo.

> **Heads-up (read this):** This is a ~100k-line, 13-component system. The
> **first** time you build and run it, expect to hit a few build or integration
> issues — that's normal for a stack this size, not a sign anything is broken.
> The infrastructure layer (databases) comes up cleanly; the application
> services are brought up and fixed iteratively.

---

## 🚀 Quickest start — run the whole thing

Everything is wired into one Docker Compose stack under `deploy/`.

```bash
cd deploy
./setup.sh                 # one-time: generates JWT keys
docker compose up --build  # builds + starts the whole platform
```

Then open:

| URL | What |
|-----|------|
| http://localhost:3000 | **Frontend** (the website) |
| http://localhost:8080/v1/... | API edge (nginx → services) |
| http://localhost:8025 | Mailpit — catches auth emails |
| http://localhost:9101 | MinIO console (`offcon_dev` / `dev_only_change_in_prod`) |

Full deploy instructions, port map, and troubleshooting: **[`deploy/README.md`](deploy/README.md)**

### Recommended first run (less overwhelming)

```bash
cd deploy
./setup.sh
docker compose up postgres redis kafka minio mailpit   # 1) infra only — comes up clean
docker compose up --build frontend                     # 2) the website (mock data, no backend needed)
docker compose up --build auth                          # 3) then add services one at a time
```

If a service fails, grab its logs (`docker compose logs -f <service>`) and fix from there.

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
- **openssl** (for `deploy/setup.sh` — preinstalled on macOS/Linux)

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
