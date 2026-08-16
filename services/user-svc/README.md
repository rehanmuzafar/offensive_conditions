# User Service

The user service owns everything about *who* a user is on the platform — their
profile data, their relationships (friends/follows), their team memberships,
and their data rights (GDPR).

It does NOT own:
- Authentication (auth service)
- Scoring/leaderboard data (scoring service)
- Lab instances (orchestrator)

## Responsibilities

### Profiles
- Bio, avatar URL, country, timezone, custom URL
- Social links (Twitter, GitHub, LinkedIn, personal site)
- Privacy settings (profile visibility, show country, show team)
- Display preferences

### Teams
- Create / update / disband
- Captain transfer
- Invitations (with expiry)
- Member management (join, leave, kick)
- Team rosters limited by tier (free=5, pro=25)

### Friends
- Bidirectional friendship requests
- Block / unblock
- Friend list visible to whom (privacy)

### Follows
- Asymmetric (X follows Y, Y might not follow back)
- Used for activity feeds (writeups, achievements, blood drops)

### Country & Search
- Country lookup (used by scoring leaderboards)
- Username search with prefix matching
- Country-filtered search

### GDPR
- Async data export (compiles user data → email link to ZIP in MinIO)
- Scheduled deletion (30-day grace period; user can cancel)
- Hard-delete on schedule (via `cmd/gdprjob`)

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Three binaries:                                                  │
│                                                                  │
│ cmd/server   → HTTP API (:8001) + gRPC (:9001)                   │
│ cmd/worker   → Kafka consumer (user.events from auth/scoring)    │
│ cmd/gdprjob  → cron job: data exports + scheduled deletions      │
└──────────────────────────────────────────────────────────────────┘
```

### HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/v1/users/me` | Current user's full profile |
| PATCH  | `/v1/users/me` | Update profile fields |
| GET    | `/v1/users/:id` | Public profile |
| GET    | `/v1/users/by-username/:username` | Lookup by username |
| POST   | `/v1/users/me/avatar` | Upload avatar (multipart) |
| DELETE | `/v1/users/me/avatar` | Remove avatar |
| GET    | `/v1/users/search` | Search by username/country |
| POST   | `/v1/teams` | Create team |
| GET    | `/v1/teams/:id` | Team details |
| PATCH  | `/v1/teams/:id` | Update (captain only) |
| DELETE | `/v1/teams/:id` | Disband (captain only) |
| POST   | `/v1/teams/:id/invitations` | Invite a user |
| GET    | `/v1/teams/invitations/me` | My pending invites |
| POST   | `/v1/teams/invitations/:id/accept` | Accept invite |
| POST   | `/v1/teams/invitations/:id/decline` | Decline invite |
| POST   | `/v1/teams/:id/leave` | Leave team |
| POST   | `/v1/teams/:id/kick/:user_id` | Kick member (captain) |
| POST   | `/v1/teams/:id/promote/:user_id` | Transfer captaincy |
| POST   | `/v1/friends/requests` | Send friend request |
| GET    | `/v1/friends/requests` | Incoming + outgoing |
| POST   | `/v1/friends/requests/:id/accept` | Accept request |
| POST   | `/v1/friends/requests/:id/decline` | Decline request |
| DELETE | `/v1/friends/:user_id` | Unfriend |
| POST   | `/v1/users/:id/block` | Block user |
| DELETE | `/v1/users/:id/block` | Unblock user |
| POST   | `/v1/follows/:user_id` | Follow |
| DELETE | `/v1/follows/:user_id` | Unfollow |
| GET    | `/v1/users/:id/followers` | List followers |
| GET    | `/v1/users/:id/following` | List who they follow |
| POST   | `/v1/gdpr/export` | Request data export |
| POST   | `/v1/gdpr/delete` | Schedule deletion |
| POST   | `/v1/gdpr/delete/cancel` | Cancel scheduled deletion |

### gRPC (internal)

For other services that need to resolve user metadata:

- `GetUserMetadata(user_id) → (username, country, tier, ...)`
- `BatchGetUserMetadata([]user_id) → []metadata`
- `GetTeamMemberships(user_id) → []team_id`
- `ResolveUsernames([]user_id) → map[id]username`

### Kafka events emitted

- `user.profile.updated` — when profile fields change (scoring service updates cached country)
- `user.avatar.updated`
- `user.team.created`, `user.team.joined`, `user.team.left`, `user.team.disbanded`
- `user.friend.added`, `user.friend.removed`
- `user.followed`, `user.unfollowed`
- `user.blocked`, `user.unblocked`
- `user.deletion.requested`, `user.deletion.cancelled`, `user.deleted`

### Kafka events consumed

- `auth.user.registered` — auto-create profile row
- `auth.user.email_verified` — flip flag in profile

## Build & Run

```bash
make build
make run-server
make test
make docker
make k8s-apply
```
