# Content Service

Owns all learning content on the Offensive Conditions platform — machines,
challenges, learning paths (tracks), tags, categories, ratings, and reviews.

## Responsibilities

### Machines
- Boxes you SSH/RDP into. Two-flag (user/root) or single-flag.
- Lifecycle: `draft → review → active → retired → archived`
- Difficulty, OS, points, image refs, resource requests
- Tier gating (`free | vip | vip_plus`)
- Aggregate stats (denormalized: total_owns, rating_avg, avg_solve_minutes)

### Challenges
- Stand-alone tasks. Categories: web, crypto, pwn, reversing, forensics, etc.
- Static (downloadable files) or instance-based
- Single solve per user

### Learning paths
- Curated sequences of machines + challenges + lessons
- Module progression with optional gating
- Completion certificates + badge awards

### Ratings + reviews
- 5-star ratings + difficulty votes
- One per user per machine/challenge
- Aggregates refreshed by Celery beat job

### Search
- Postgres full-text + trigram for fuzzy search
- Faceted filters: difficulty, OS, category, tags, tier, status

### Creator workflow
- Users with `content_creator` role can submit machines/challenges
- Admin review queue
- Approval → publish → retirement lifecycle

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Three processes:                                                │
│                                                                 │
│ uvicorn app.main:app   → HTTP API (:8003) + gRPC (:9003)       │
│ celery -A app.workers worker → background jobs                 │
│ celery -A app.workers beat   → cron schedules                  │
└────────────────────────────────────────────────────────────────┘
```

### HTTP endpoints

Machines:
- `GET /v1/machines` — list with filters + facets
- `GET /v1/machines/:id` — details
- `GET /v1/machines/by-slug/:slug` — slug lookup
- `POST /v1/machines` — create draft (creator only)
- `PATCH /v1/machines/:id` — update draft (creator only)
- `POST /v1/machines/:id/submit-for-review` — creator submits for moderation
- `POST /v1/machines/:id/approve` — moderator approves
- `POST /v1/machines/:id/publish` — admin publishes (sets `released_at`)
- `POST /v1/machines/:id/retire` — admin retires (sets `retired_at`)
- `POST /v1/machines/:id/rate` — 1-5 stars + perceived difficulty
- `GET /v1/machines/:id/reviews` — paginated reviews
- `GET /v1/machines/:id/stats` — aggregate stats
- `GET /v1/machines/:id/owners` — list users who owned it

Challenges:
- `GET /v1/challenges`
- `GET /v1/challenges/:id`
- `POST /v1/challenges` (creator)
- `PATCH /v1/challenges/:id` (creator)
- `POST /v1/challenges/:id/publish` (admin)
- `POST /v1/challenges/:id/retire` (admin)
- `POST /v1/challenges/:id/rate`

Learning paths:
- `GET /v1/paths`
- `GET /v1/paths/:id`
- `POST /v1/paths/:id/enroll`
- `GET /v1/paths/:id/progress` — current user's progress
- `POST /v1/paths/:id/modules/:module_id/complete` — submit answers
- `GET /v1/paths/me/enrolled` — paths user is enrolled in

Tags + categories:
- `GET /v1/tags`
- `GET /v1/categories`

Search:
- `GET /v1/search?q=...&type=machine|challenge|path&difficulty=&tags=`

### gRPC (internal)

For scoring and orchestrator:
- `GetMachineMetadata(machine_id)` → difficulty, points, slug, status
- `BatchGetMachineMetadata([]ids)`
- `GetChallengeMetadata(challenge_id)`
- `ResolveContentBySlug(slug, type)` → id
- `ListActiveContent()` — for leaderboard recompute

### Kafka events emitted

- `content.machine.created`, `content.machine.published`, `content.machine.retired`
- `content.machine.rated`
- `content.challenge.created`, `content.challenge.published`, `content.challenge.retired`
- `content.challenge.solved` (from scoring → here for stats)
- `content.path.enrolled`, `content.path.completed`

### Celery jobs

- `refresh_machine_stats` — recompute aggregate stats from scoring events (every 5 min)
- `refresh_challenge_stats`
- `refresh_path_stats`
- `expire_drafts` — auto-archive drafts inactive > 90 days (daily)
- `reindex_search` — on schema changes / data corrections

## Build & Run

```bash
# Local dev
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8003

# Worker + beat
celery -A app.workers.celery_app worker -l info
celery -A app.workers.celery_app beat -l info

# Tests
pytest

# Docker
docker build -t content-svc .

# K8s
kubectl apply -f deployments/kubernetes.yaml -n offcon
```
