# Writeup Service

Long-form solution writeups for machines, challenges, dojo levels, pro labs.
Sister to forum-svc but with stricter gating, moderation queue, and
spoiler-aware presentation.

## Responsibilities

### Writeups
- One author, one piece of long-form markdown content
- Per-target: machine, challenge, dojo_level, pro_lab
- Lifecycle: `pending → approved → archived`, or `pending → rejected`
- Language tag (en/ur/ar/etc.) for i18n filtering
- Pre-rendered HTML cache; rebuilt on edit
- Word count + reading time auto-computed
- Optional video URL companion
- Featured by moderators (homepage carousel)

### Gating
- **Read access:** by default user must have solved the target to read
- VIP-only writeups for premium machines
- "Spoiler warning shown" interstitial gate served by the frontend

### Comments
- Threaded comments scoped to a writeup
- Markdown body, soft delete
- Per-comment voting reuses the forum vote pattern

### Votes
- Up/down on writeups (drives the homepage ranking)
- Distinct from comment votes

### Bookmarks
- Per-user, per-writeup; powers the "My bookmarks" page

### Moderation
- Pending writeups in moderator queue
- Reject with reason → notification back to author
- Approve → published; spoiler scan recommended

## Architecture

```
uvicorn app.main:app   → HTTP (:8006) + gRPC (:9006)
celery worker          → markdown render, view rollup, notifications
celery beat            → stat recompute, archive old rejected
```

### Endpoints

- `GET    /v1/writeups?content_type=&content_id=&q=&language=&sort=`
- `GET    /v1/writeups/:id`
- `GET    /v1/writeups/by-slug/:slug`
- `POST   /v1/writeups` — submit (status=pending)
- `PATCH  /v1/writeups/:id` — author edits draft
- `POST   /v1/writeups/:id/publish` (mod)
- `POST   /v1/writeups/:id/reject` (mod, body: {reason})
- `POST   /v1/writeups/:id/feature` (mod)
- `POST   /v1/writeups/:id/vote` (body: {direction: up|down|clear})
- `POST   /v1/writeups/:id/bookmark`
- `DELETE /v1/writeups/:id/bookmark`
- `GET    /v1/writeups/:id/comments`
- `POST   /v1/writeups/:id/comments`
- `PATCH  /v1/comments/:id`
- `DELETE /v1/comments/:id`
- `POST   /v1/comments/:id/vote`
- `GET    /v1/me/bookmarks`
- `GET    /v1/mod/writeups/pending` (mod)

### gRPC

- `GetWriteupMetadata(id)`
- `BatchGetWriteupsByTarget(content_type, content_ids)`
- `CheckReadAccess(writeup_id, user_id)` — verifies the user solved the target

### Kafka events

- `writeup.submitted`, `writeup.approved`, `writeup.rejected`, `writeup.featured`
- `writeup.vote.cast`, `writeup.bookmark.added`
- `writeup.comment.created`, `writeup.comment.deleted`

### Celery jobs

- `render_writeup_markdown` — markdown → HTML cache
- `recompute_writeup_stats` — word_count, comment_count, score
- `flush_view_counts` — Redis HINCRBY drain
- `archive_old_rejected` — daily cleanup
