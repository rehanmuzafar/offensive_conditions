# Runbook

## Running the stack

```bash
./setup.sh                 # from the repo root: secrets, build, migrate, start
docker compose up -d       # 21 containers
```

| URL | What |
|---|---|
| http://localhost:3000 | Frontend |
| http://localhost:8080/v1/... | API edge (nginx) |
| http://localhost:8025 | Mailpit — catches all auth email |
| http://localhost:9101 | MinIO console |

Rebuild one service: `docker compose build <svc> && docker compose up -d --no-deps --force-recreate <svc>`

## Test accounts

Local development accounts are **not listed here** — this repository is public,
and a working credential in a README is a working credential for anyone who
finds it. Keep them in your password manager.

There is one admin and one player account, both on team **Alpha Squad** with the
admin as captain. To create fresh ones:

```bash
curl -X POST http://localhost:8080/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","username":"you","password":"<pick one>"}'
# email verification is on, so collect the link from Mailpit:
open http://localhost:8025
```

## Traps

These have each cost real time. They are not hypothetical.

### `docker compose build … | tail` hides failures
The pipeline's exit code is `tail`'s, which is always 0. A user-svc build failed
and reported success; the old binary kept running and new code silently did
nothing. **Always** redirect to a file and check `$?`:

```bash
docker compose build user-svc > /tmp/build.log 2>&1; echo "EXIT=$?"
```

### user-svc silently drops unknown update fields
`teams.UpdateRequest` had no `avatar_url` and no `category_detail`, and the
repository's `UPDATE` did not write `category_detail` either — so PATCH returned
**200** while saving nothing. If a save "succeeds" but nothing changes, check the
request struct and the SQL column list before suspecting the client.

### Verify a save by changing the value
Re-saving a form and seeing the old, correct value in the database proves
nothing. Change the value to something new, then read it back. The bug above
survived a first check exactly this way.

### A one-to-many join silently corrupts every SUM
Adding `LEFT JOIN ctf.event_solves` to the aggregated leaderboard — just to count
first bloods — multiplied each participant row by its number of solves. Every
`SUM` inflated: the top team read 4,872 points and "4/2 flags" instead of 2,454
and 0/2. Nothing errored; the numbers were simply wrong.

Count the child rows in a subquery and join the total:

```sql
LEFT JOIN (
    SELECT participant_id, COUNT(*)::INT AS fb
      FROM ctf.event_solves WHERE is_first_blood
     GROUP BY participant_id
) sv ON sv.participant_id = p.id
```

The tell is a total that grew after a change that should only have added a
column. Check row counts before and after when touching an aggregate query.

### A missing `limit` truncates silently
The frontend asked for the leaderboard without a limit, so the service applied
its default of 100. With 121 teams, every team below 100th — including the
viewer's own — vanished from the payload, and the "your team" card simply never
appeared. No error, no empty state, just absence.

### Postgres has no `min(uuid)`
Aggregate `id::text` and cast back. The service log showed only
`sqlalche.me/e/20/f405`; the real message appeared only when the query was run
directly in psql.

### Reclaiming disk space needs `fstrim`, not just prune
colima's disk is a sparse file that grows and never shrinks. `docker system
prune` frees space *inside* the VM and macOS sees nothing. Follow with:

```bash
colima ssh -- sudo fstrim -av
```

This took `~/.colima` from 44 GB to 13 GB and returned ~30 GB to the Mac.
Pruning the build cache also means the next Python service rebuild re-downloads
every wheel — slow, and a network blip mid-download fails the whole build.

### Test through the browser, not only curl
A bodyless POST from the frontend failed validation while `{}` from curl passed.
Only testing the actual UI caught it.

## Useful checks

```bash
docker compose ps                       # what is up
docker compose logs -f ctf-svc          # tail one service
docker compose exec -T postgres psql -U offcon_admin -d offcon -c '\dt ctf.*'
```
