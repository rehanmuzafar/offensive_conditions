# Setup

Everything you need to run OFFCON locally, and the three rules that keep the
team from breaking each other's checkouts.

---

## 1. First time

```bash
git clone https://github.com/rehanmuzafar/offensive_conditions.git
cd offensive_conditions
git checkout redesign/offcon-theme
./setup.sh
```

That is all of it. `./setup.sh` takes a while on the first run — it builds
around twenty images.

When it finishes:

| URL | What |
|-----|------|
| http://localhost:3000 | The site |
| http://localhost:8080 | API edge (nginx → services) |
| http://localhost:8025 | Mailpit — **every** outgoing email lands here, nothing is sent |
| http://localhost:9101 | MinIO console — credentials are in `deploy/.env` |
| localhost:5432 | Postgres — credentials are in `deploy/.env` |

> The work is on **`redesign/offcon-theme`**, not `main`. Check it out or you
> will get the old tree.

**You need:** Docker with ~8 GB of RAM free, and `openssl` (already on macOS
and Linux).

---

## 2. Every day after that

```bash
git pull
./setup.sh
```

Run `./setup.sh` after **every** pull. It is idempotent — it never regenerates
a secret you already have and never touches your database — and it is what
applies a teammate's new migration and picks up any new configuration their
commit introduced.

Skipping it is the usual reason for "it works on their machine": your
containers are still running the image built from the old code.

### What it actually does

1. `deploy/bootstrap.sh` — generates any missing secret and the JWT keypair
2. `docker compose build` — rebuilds images from the code you just pulled
3. starts Postgres and Redis, and waits for Postgres to accept connections
4. `docker compose run --rm migrator` — applies migrations that have not run yet
5. starts everything else

The order matters. The migrator connects on startup, so starting it alongside
the database means it races the thing it is migrating.

---

## 3. Secrets — why there is no `.env` in the repo

`deploy/.env` and `deploy/secrets/` hold database passwords and the JWT signing
key. Anyone with that private key can mint valid tokens for any account, so
they are in `.gitignore` and must stay there.

`./setup.sh` generates them **on your machine**. Nothing is shared out of band,
and no two developers share a secret. You will never be asked for a `.env`
file.

### Adding a new configuration variable

Put it in **`deploy/.env.example`** in the same commit as the code that reads
it. Everyone else picks it up on their next `./setup.sh`.

If the name ends in `_SECRET`, `_PASSWORD`, `_TOKEN`, `_KEY` or `_SALT`, a
value is generated for them automatically. Credentials issued by an outside
provider — Stripe, SMTP, OAuth — are deliberately left blank instead, so the
feature behind them stays visibly switched off rather than half-working against
a fake key.

If you only add it to your own `.env`, the stack starts for you and fails for
everybody else.

---

## 4. Migrations — pull before you write one

Migrations live in `database/migrations/<schema>/` and are numbered **per
schema**:

```
database/migrations/ctf/0016_challenge_instances.up.sql
database/migrations/ctf/0016_challenge_instances.down.sql
```

Two people who both create `0018_*` in the same schema will break the migrator
for everyone — and git will merge both files without complaining, because their
filenames differ. So:

- `git pull` first, then take the next free number
- always write the `.down.sql` too
- **your migration will run against real data on someone else's machine.**
  `ADD COLUMN ... NOT NULL` with no default passes on an empty table and fails
  on a full one. So does a new `CHECK` constraint that existing rows violate.

To see which version each schema is on before you pick a number:

```bash
cd deploy && docker compose exec postgres psql -U offcon_admin -d offcon -c "
SELECT 'ctf' AS schema, version FROM public.schema_migrations_ctf
UNION ALL SELECT 'users',   version FROM public.schema_migrations_users
UNION ALL SELECT 'bounty',  version FROM public.schema_migrations_bounty
UNION ALL SELECT 'scoring', version FROM public.schema_migrations_scoring
UNION ALL SELECT 'content', version FROM public.schema_migrations_content
ORDER BY 1;"
```

A `dirty` column set to `t` means a migration stopped half way and has to be
sorted out by hand before anything else will apply.

---

## 5. Building the frontend

Always through compose:

```bash
cd deploy && docker compose build frontend
```

**Never** a bare `docker build` on `frontend/`. `NEXT_PUBLIC_API_BASE_URL` is a
*build* argument — Next inlines it at build time, including into the `/api`
rewrite in `next.config.mjs`. An image built without the argument bakes in the
production API hostname, and every request from the browser returns 500 while
the container looks perfectly healthy.

The symptom is a login that fails with "could not sign you in" while
`curl http://localhost:8080/v1/auth/login` works fine. If you see that, rebuild
through compose.

### After changing a build argument, check it landed

Every `NEXT_PUBLIC_*` needs three things to reach the browser: an `ARG` in
`frontend/Dockerfile`, a build arg in compose, and a rebuild that does not
reuse a cached `npm run build`. Miss any one and the variable is simply empty
in the bundle — the image builds, the container is healthy, and the feature
that depends on it fails silently.

Verify rather than assume:

```bash
cd deploy
docker compose exec frontend sh -c \
  "grep -rlo 'localhost:3000' /app/.next/static/chunks | wc -l"
```

Zero means it did not make it. Rebuild with `docker build --no-cache` and the
`--build-arg` flags spelled out.

### If the frontend build dies downloading an SWC package

```
Downloading swc package @next/swc-linux-arm64-gnu...
TypeError: terminated ... SocketError: other side closed
```

Next is fetching a compiler binary that should already be in `node_modules`,
which means the cached `deps` layer was built without it. Docker keeps a
separate cache per builder, so a layer that is fine under one can be stale
under another — `docker buildx ls` shows which you are on. Build once with the
args spelled out to repopulate it:

```bash
docker build -t offcon-frontend \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://edge:8080 \
  --build-arg NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 \
  frontend
```

---

## 6. Useful commands

```bash
# from deploy/
docker compose logs -f <service>     # follow one service
docker compose ps                    # what is up, and is it healthy
docker compose restart <service>     # after changing only config
docker compose down                  # stop, keep data
docker compose down -v               # stop and WIPE the database

# rebuild and restart one service after a code change
docker compose build <service> && docker compose up -d <service>
```

### When something is wrong

```bash
# what is actually broken — prints nothing when everything is fine.
# Do not filter on `grep -v healthy`: several services have no healthcheck at
# all and show "Up 4 hours", so that flags a dozen perfectly good containers.
docker compose ps --format "{{.Service}}\t{{.Status}}" \
  | grep -E "unhealthy|Restarting|Exit [1-9]"

docker compose logs --tail 50 <service>
```

A service stuck restarting is almost always a config error in its startup path
— the log's last few lines say which.

---

## 7. The surfaces

The app is served from four hostnames, routed by `frontend/src/middleware.ts`:

| Host | Locally | What |
|------|---------|------|
| `offensiveconditions.org` | `lvh.me:3000` | landing page |
| `dashboard.…` | `dashboard.lvh.me:3000` | where a signed-in player lands |
| `ctf.…` | `ctf.lvh.me:3000` | events, teams, arena, scoreboards |
| `bugbounty.…` | `bugbounty.lvh.me:3000` | programs, reports, hacktivity |
| `app.…` | `app.lvh.me:3000` | tracks, machines, forum, writeups |

**Use `lvh.me`, not `localhost`.** Every subdomain of `lvh.me` resolves to
127.0.0.1 in public DNS, so there is still no hosts file to edit — but unlike
`localhost` it is a real registrable domain, which is what the shared session
cookie needs.

`*.localhost` looks like it should work and does not. Chrome accepts a cookie
with `Domain=localhost` when it is written on `localhost`, never sends it to
`dashboard.localhost`, and **silently rejects the write** when it comes from a
subdomain. The session can then never be stored, the auth guard reads that as
signed out, and signing in leads straight back to the login page — an infinite
loop rather than a visible error. Verified in Chrome, not assumed.

A path that belongs to another surface redirects there rather than 404ing, so
old single-origin links keep working: `localhost:3000/dashboard` sends you to
`dashboard.localhost:3000`.

Two things have to know about a new surface, or sign-in breaks on it:

- **`HTTP_CORS_ORIGINS`** in `deploy/.env` — every surface is its own origin,
  and the browser sends `Origin` on every POST. A surface missing from that
  list gets a 403 with an empty body, which the frontend can only report as
  "could not sign you in".
- **`NEXT_PUBLIC_ROOT_DOMAIN`** — a *build* argument. Cross-surface links are
  built from it, so an image built without it links to the wrong host.

They only split apart when `NEXT_PUBLIC_ROOT_DOMAIN` is set. If you write a
link that crosses from one surface to another, use `link()` from
`frontend/src/lib/surfaces.ts` — a bare `/machines` on the CTF host resolves to
a CTF path and 404s.
