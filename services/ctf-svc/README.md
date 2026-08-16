# CTF Service

Runs time-bound competitive hacking events. Sister to the content service but
distinct: content-svc owns the permanent catalog (machines, challenges,
learning paths); ctf-svc owns the per-event lifecycle (registration, dynamic
scoring, leaderboard freeze, first blood awards, live updates).

## Responsibilities

### Events
- Lifecycle: `draft → published → registration → live → ended → archived`
- Formats: jeopardy, attack/defense, hybrid, king of the hill
- Visibility: public, private (invitation code), invite-only (admin invites)
- Solo + team play, configurable max team size
- Scoreboard freeze (last hour locked from public view)
- Prize pool (JSON: rank → description, amount, currency)

### Event challenges (separate from content-svc challenges)
- Lives ONLY within an event — temporary by definition
- Dynamic scoring: points decay as solve count grows
- Staged unlock (timed releases) + prerequisite chaining
- Per-challenge hints with point deductions
- First-blood tracking (user + team + timestamp)

### Registration
- Solo: one user per registration
- Team: captain registers team; members already in the team via user-svc
- Snapshot team name at registration (in case team renames mid-event)

### Submission + scoring
- Player submits flag → ctf-svc verifies via flag-verifier gRPC
- On accept: insert event_solves row, recompute participant points,
  potentially crown first blood, broadcast via WebSocket
- Dynamic scoring formula: `current_points = max(min_points, base * decay(solve_count))`
- Standard decay: `f(n) = ceiling((1.0 - (n - 1) * 0.012)^4)` (matches CTFd default)

### Leaderboard
- Real-time ordering by (points DESC, last_solve_at ASC)
- Freeze: after `scoreboard_freeze_at`, public board shows pre-freeze state;
  organizers see live
- CSV export for organizer post-event archives

### Announcements
- Organizer broadcasts to all participants (text, optional pinned)
- Delivered via WebSocket + persisted for late joiners

### WebSocket live feed
- One connection per authenticated participant
- Emits: solves, first bloods, score updates, announcements, hint unlocks

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Four processes:                                                  │
│  uvicorn app.main:app   → HTTP API (:8004) + gRPC (:9004)       │
│                          + WebSocket /v1/events/:id/live        │
│  celery worker          → submission processing, ranking        │
│  celery beat            → event lifecycle transitions, freeze   │
│  kafka consumer         → flag-verifier accept events           │
└─────────────────────────────────────────────────────────────────┘
```

### HTTP endpoints

Events:
- `GET    /v1/events` — list (status, format, visibility filters)
- `GET    /v1/events/:id`
- `GET    /v1/events/by-slug/:slug`
- `POST   /v1/events` (organizer)
- `PATCH  /v1/events/:id`
- `POST   /v1/events/:id/publish`
- `POST   /v1/events/:id/start`
- `POST   /v1/events/:id/end`
- `GET    /v1/events/:id/leaderboard?frozen=auto`
- `GET    /v1/events/:id/scoreboard.csv` (organizer)
- `GET    /v1/events/:id/announcements`
- `POST   /v1/events/:id/announcements` (organizer)

Registration:
- `POST   /v1/events/:id/register` — solo registration
- `POST   /v1/events/:id/register-team` — captain registers team
- `DELETE /v1/events/:id/registration`
- `GET    /v1/events/:id/participants`
- `GET    /v1/events/:id/my-participation`
- `POST   /v1/events/:id/disqualify/:participant_id` (organizer)

Challenges:
- `GET    /v1/events/:id/challenges` (locked until event starts)
- `GET    /v1/events/:id/challenges/:cid`
- `POST   /v1/events/:id/challenges` (organizer)
- `PATCH  /v1/events/:id/challenges/:cid` (organizer)
- `POST   /v1/events/:id/challenges/:cid/submit` — submit flag
- `POST   /v1/events/:id/challenges/:cid/hint/:hint_id` — unlock hint

### WebSocket
- `WS /v1/events/:id/live` — JWT in subprotocol or query

### gRPC internal
- `IsUserInEvent(user_id, event_id)`
- `GetEventState(event_id)` → status, freeze, end timestamps
- `GetTeamForUser(user_id, event_id)`
- `GetParticipant(participant_id)`

### Kafka events
- **Emits**: `ctf.event.published`, `ctf.event.started`, `ctf.event.ended`,
  `ctf.registration.created`, `ctf.solve.recorded`, `ctf.first_blood.awarded`,
  `ctf.announcement.posted`
- **Consumes**: `flagverify.events` (filtered for CTF flag accepts)

### Celery jobs
- `transition_event_status` — every 30s, advance state machines
- `recompute_dynamic_scores` — every 60s during live events
- `recompute_ranks` — every 30s during live events
- `freeze_scoreboard_snapshot` — when freeze time hits
- `finalize_event` — when ends_at hits

## Build & Run

```bash
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8004
celery -A app.workers.celery_app worker -l info
celery -A app.workers.celery_app beat -l info

docker build -t ctf-svc .
kubectl apply -f deployments/kubernetes.yaml -n offcon
```
