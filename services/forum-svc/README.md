# Forum Service

Community discussion forum: categories → threads → posts (nested) → votes,
reports, subscriptions, reputation.

## Responsibilities

### Categories
- Hierarchical (parent_id) categories with sort order
- Locked categories (mod-only posting)
- Tier gating

### Threads
- Title + slug, status: `open | closed | locked | archived | deleted`
- Pinned + announcement flags
- Solved threads can mark a post as the accepted answer
- Optional links to a related machine/challenge
- Tags (array column for search)

### Posts
- Markdown content with pre-rendered HTML cache
- Nested replies (`parent_post_id`)
- Edit history (count + edited_at), soft delete
- Spoiler flag (frontend hides until clicked)
- Per-post up/down vote with `score = upvotes - downvotes`

### Votes
- One per (user, post) pair
- Switching vote (up → down) handled atomically
- Author can't vote on own post

### Subscriptions
- Per-thread email + in-app notification
- Auto-subscribe on post

### Reputation
- Per-user reputation derived from received upvotes/downvotes
- Recomputed nightly by Celery beat

### Moderation
- User reports → moderator queue
- Lock thread, soft-delete posts, ban user (calls user-svc)
- Audit trail in JSONB metadata

## Architecture

```
uvicorn app.main:app   → HTTP (:8005) + gRPC (:9005)
celery worker          → markdown render, reputation recompute, notifications
celery beat            → daily reputation rollup, view count flush
```

### Endpoints

- `GET /v1/categories`
- `GET /v1/threads?category=&tag=&q=&status=`
- `POST /v1/threads` — create (with first post body)
- `GET /v1/threads/:id` / `GET /v1/threads/by-slug/:slug`
- `PATCH /v1/threads/:id`
- `POST /v1/threads/:id/lock` / `unlock` / `pin` / `unpin` / `solve` / `unsolve` (mod)
- `GET /v1/threads/:id/posts?cursor=&limit=`
- `POST /v1/threads/:id/posts` — reply
- `PATCH /v1/posts/:id`
- `DELETE /v1/posts/:id`
- `POST /v1/posts/:id/vote` (body: {direction: up|down|clear})
- `POST /v1/posts/:id/report` (body: {reason, details})
- `POST /v1/threads/:id/subscribe` / `unsubscribe`
- `GET /v1/me/subscriptions`
- `GET /v1/users/:id/reputation`
- `GET /v1/mod/reports` (mod)
- `POST /v1/mod/reports/:id/resolve` (mod)

### gRPC

- `GetThreadMetadata(thread_id)`
- `GetUserReputation(user_id)`
- `CheckThreadAccess(thread_id, user_id)` — for cross-service permission

### Kafka events

- `forum.thread.created`, `forum.thread.locked`, `forum.thread.solved`
- `forum.post.created`, `forum.post.deleted`, `forum.post.edited`
- `forum.vote.cast`, `forum.report.filed`, `forum.user.reputation_changed`

### Celery jobs

- `render_post_markdown` — render + sanitize HTML cache
- `recompute_thread_stats` — fix denormalized counts (every 10 min)
- `recompute_reputation` — daily
- `notify_subscribers` — on new posts
- `flush_view_counts` — Redis → Postgres (every 5 min)
- `expire_deleted_posts` — hard-delete soft-deleted after 30 days
