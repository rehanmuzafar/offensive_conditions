# Known issues and gaps

Each entry states the evidence, not just the symptom.

## Blocking a real launch

### Payments have no user interface
The backend is complete: `manual` mode, intent → bank details → an admin
approval queue, with `PAYOUT_*` variables in `deploy/.env` waiting for real bank
details. **There is not one screen for it** — neither the player's "here is where
to pay" nor the organiser's approval queue.

Evidence: no component in the frontend references `payments/pending`,
`PendingPayment`, or `payment_status`; `app/(app)/admin/` has no payments page.

Consequence: if a paid CTF opens, nobody can pay and no organiser can approve.
A free CTF sidesteps this entirely.

### Everything runs on localhost
Mail goes to **Mailpit**, a fake inbox — a real user's verification email never
arrives and password reset cannot work. `deploy/.env` holds development
passwords, TLS is off, and `offensiveconditions.org` points nowhere.

## Correctness

### Two point systems shown unlabelled
The profile header shows `0 pts` (scoring-svc: machines and platform challenges)
beside a CTF record of `125` (ctf-svc: event points). Both correct, different
ledgers. Label them distinctly or merge them.

## Missing features

### Scoreboard — complete
Nothing outstanding. One documented exception: the leaderboard query joins
`users.teams` for `country_code`. That is another service's schema, accepted
because it is the same database and the alternative was one lookup per row on
the most-read page in the app. The exception is commented in the query.

### Elsewhere
- **Teamless modal** — a player with no team who opens an event should be
  offered "Create a team" / "Join a team".
- **Collapsible app sidebar** — icons-only when collapsed.
- **Team page events list** — upcoming / ongoing / past events per team.

## Docker spawning (per-team instances) — blocked

The orchestrator's Docker backend is written and wired
(`internal/backends/docker/docker.go`, Engine REST API over the daemon socket,
all capabilities dropped, read-only rootfs, no-new-privileges, memory/CPU/PID
limits). **No spawn has ever succeeded**, for three reasons:

1. **`GetBySlug` reads `FROM lab.machines`, which does not exist.** The catalog
   lives in `content.machines`. Every spawn fails `MACHINE_NOT_FOUND` before
   reaching any backend.
2. `lab.instances` gained `team_id`, `participant_id`, `event_id` columns but
   **nothing reads them** — three queries still key on `user_id` alone, so each
   teammate would spawn their own box.
3. There is **no path at all** between ctf-svc and the orchestrator.

Worth repeating: a jeopardy CTF does not need this. Static flags plus shared
containers is how most of them run. Per-team spawning matters only for
destructive challenges or per-team flags.

## Test data in the database

120 seeded teams sit in the `testing` event, slugs `seed-scoreboard-NNN`. They
were inserted directly with SQL — useful for judging scoreboard layout, but they
prove nothing about the registration path. Remove with:

```sql
DELETE FROM ctf.event_participants WHERE team_id IN
  (SELECT id FROM users.teams WHERE slug LIKE 'seed-scoreboard-%');
DELETE FROM users.teams WHERE slug LIKE 'seed-scoreboard-%';
```
