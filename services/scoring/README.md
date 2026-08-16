# Scoring Service

The scoring service consumes lab/CTF events from Kafka, computes points and
ratings, maintains leaderboards, and awards badges/achievements.

## Responsibilities

1. **Consume events** from Kafka:
   - `flag.submitted.correct` (from orchestrator) → award machine points
   - `challenge.solved` (from CTF service) → award challenge points
   - `ctf.match.completed` (from CTF service) → update ELO ratings

2. **Compute and persist scores** in PostgreSQL:
   - Per-user total points (machine + challenge + bonus)
   - ELO rating (PvP only)
   - Solve history (immutable audit log)
   - Streak tracking (daily activity)

3. **Maintain Redis leaderboards**:
   - Global all-time
   - Global current season
   - Per-country
   - Per-university (institutional accounts)
   - Per-team
   - Per-category (web, pwn, reverse, etc.)

4. **Award badges & achievements** based on rules:
   - First 10 boxes solved
   - First-blood badges
   - Domination badges (all flags in category)
   - Streak badges (30/100/365 day streaks)
   - Season-end badges (top 1%, top 10%, etc.)

5. **Manage seasons** (quarterly):
   - Snapshot final standings
   - Reset season scores
   - Distribute season rewards
   - Carry over fraction of points to next season

6. **Anti-cheat hooks**:
   - Flag share detection (same flag, different users)
   - Improbable solve time (too fast)
   - Geographic anomaly (sudden IP jump)
   - Mark suspicious; admin reviews

7. **REST API** for dashboards:
   - User profile stats
   - Leaderboard slices
   - Solve history
   - Badge gallery

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Three binaries                                              │
│                                                              │
│  cmd/server   → HTTP API for read queries (leaderboards,     │
│                 profiles), authenticated by JWT              │
│                                                              │
│  cmd/worker   → Kafka consumers + points/ELO computation     │
│                 Long-running goroutine pool                  │
│                                                              │
│  cmd/seasonjob → Scheduled cron jobs                         │
│                 (season rollover, streak refresh, decay)     │
└──────────────────────────────────────────────────────────────┘
```

## Points Formula

Base points per difficulty:

| Difficulty | Base | User Share (30%) | Root Share (70%) |
|-----------|------|------------------|------------------|
| very_easy | 10   | 3                | 7                |
| easy      | 20   | 6                | 14               |
| medium    | 30   | 9                | 21               |
| hard      | 40   | 12               | 28               |
| insane    | 50   | 15               | 35               |

Final points = `base_share × first_blood_mult × time_decay`

- **first_blood_mult**: 1.5x (first solver), 1.25x (2nd), 1.1x (3rd), 1.0x (rest)
- **time_decay**: machines worth less over time; `max(0.5, 1 - days_old/365 * 0.5)`
  - Day 0: 1.0× (100%)
  - Day 180: 0.75× (75%)
  - Day 365+: 0.5× (50% floor)

## ELO

Used only for PvP CTF matches (head-to-head challenges).

- Initial rating: 1500
- K-factor: 32 (under 2400 rating), 16 (above)
- Decay: inactive players (no match in 60d) lose 25 rating

## State

**PostgreSQL tables** (in `scoring` schema):
- `user_scores` — totals per user + season
- `solves` — append-only solve log
- `elo_ratings` — current rating + history
- `badges` — earned badges per user
- `seasons` — season definitions + rollovers
- `streaks` — daily activity tracking
- `anti_cheat_flags` — suspicious activity log

**Redis keys**:
- `lb:global:all` — sorted set, score=points
- `lb:global:season:{id}` — current season
- `lb:country:{iso}` — per-country
- `lb:team:{id}` — per-team
- `lb:category:{cat}` — per-category

**ClickHouse tables**:
- `solves_timeline` — every solve event with timestamp (analytics)
- `points_history` — daily snapshot per user

## Configuration

```
HTTP_PORT=8003
GRPC_PORT=9003

DB_HOST=...
DB_NAME=offcon
DB_USER=svc_scoring

REDIS_ADDR=...

KAFKA_BROKERS=...
KAFKA_TOPIC_FLAGS=flag.submissions       # consume
KAFKA_TOPIC_CTF=ctf.events               # consume
KAFKA_TOPIC_USER_EVENTS=user.events      # produce (badge awarded etc)

CLICKHOUSE_ADDRS=clickhouse-0:9000,...

# Auth
AUTH_JWT_PUBLIC_KEY_PATH=...

# Scoring config
POINTS_FIRST_BLOOD_MULT=1.5
POINTS_SECOND_BLOOD_MULT=1.25
POINTS_THIRD_BLOOD_MULT=1.1
POINTS_TIME_DECAY_DAYS=365
POINTS_TIME_DECAY_FLOOR=0.5

# ELO
ELO_INITIAL=1500
ELO_K_FACTOR=32
ELO_K_FACTOR_HIGH=16
ELO_HIGH_THRESHOLD=2400
ELO_DECAY_DAYS=60
ELO_DECAY_AMOUNT=25

# Season
SEASON_DURATION_DAYS=90
SEASON_CARRYOVER_FRACTION=0.25
```

## API Endpoints (summary)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/v1/profile/me` | ✓ | Caller's full scoring profile |
| GET | `/v1/profile/:user_id` | ✓ | Public profile (limited) |
| GET | `/v1/leaderboard/global` | optional | Global top-N |
| GET | `/v1/leaderboard/season/:id` | optional | Season top-N |
| GET | `/v1/leaderboard/country/:iso` | optional | Per-country |
| GET | `/v1/leaderboard/category/:cat` | optional | Per-category |
| GET | `/v1/seasons` | optional | List of seasons |
| GET | `/v1/seasons/current` | optional | Current season + your rank |
| GET | `/v1/badges` | optional | All available badges |
| GET | `/v1/badges/me` | ✓ | Your earned badges |
| GET | `/v1/solves/me` | ✓ | Your solve history |
| GET | `/v1/admin/anti-cheat-flags` | admin | Suspicious activity |
| POST | `/v1/admin/seasons/:id/rollover` | admin | Force season end |
| POST | `/v1/admin/recompute/:user_id` | admin | Rebuild user from solves |
