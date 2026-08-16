# Changelog

Newest first. Dates are when the work landed.

## 2026-08-16

### Scoreboard — finished
- **Top 10 teams chart** and **Trending stats**, paged with `‹ ›`. Two new
  endpoints: `GET /v1/ctf/events/{id}/series` (cumulative points over time) and
  `/trending`. The chart is hand-drawn SVG with step lines — points only change
  on a solve, so a smooth curve would imply scoring in between.
- **Country flags** on the podium and in the standings.
- **Sticky "your team" card**: rank, points, flags, first bloods, and the gap to
  the next rank up — the last is ours, not from the reference design.
- **Fixed: the arena rank was stale.** It read the participant row's own `rank`
  and showed `#122` while the team stood at 115. It now takes the team's
  standing from the aggregated leaderboard.
- **Fixed: `mapScoreboardRow` set `teamId` from `participant_id`**, so the
  own-row highlight could never match.
- **Fixed: the leaderboard request sent no `limit`**, so the service's default of
  100 cut off every team below 100th — including the viewer's own.
- **Fixed: a fan-out that corrupted every total.** Joining `event_solves` to
  count first bloods multiplied participant rows by their solve count; the top
  team read 4,872 points instead of 2,454. First bloods are now counted in a
  subquery.

### Scoreboard
- **Fixed: the leaderboard ranked participants, not teams.** Since registration
  became per player, a five-person team appeared as five rows competing against
  itself. Now aggregated by `team_id` (points and flags summed, tie-broken on the
  team's last solve); solo events still rank per player. Both paths verified.
- Built the event scoreboard: podium (2 left, 1 centre with a crown and taller,
  3 right), searchable standings, own-row highlight, and a team card with rank,
  points and flags.
- Seeded 120 test teams into the `testing` event to judge it at realistic length.

### Arena
- **`/ctf/[slug]/play` is now a separate route outside the app shell** — no
  sidebar, no platform topbar, no banner. `/ctf/[slug]` reverts to a public
  landing page (About, Going, Specifications) with "Join event" or "Enter arena".
  This is why the arena has no banner: it is a different page, not a hidden one.
- Scenario detail became a **left slide-over drawer**, replacing the modal.
- **Global Activity** — new `GET /v1/ctf/events/{id}/activity` endpoint (recent
  solves, newest first) and a right rail pairing it with Team Chat. Team chat was
  split into an inline panel and the floating widget, sharing one query cache.
- Stat strip gained rank, points and flags. The data was already being fetched
  and thrown away — `my-participation` was called only to test registration.

## 2026-08-15

### Teams
- Rebuilt on the HackTheBox layout: `/teams` is a list with All Teams / My Teams
  tabs; each team gets its own page with Details / Players / Settings / Join
  Requests tabs.
- **Removed the "category" concept from the UI.** Asking a captain to pick a
  category of `country` was meaningless. Country is its own selector; affiliation
  is one optional free-text field, and searchable.
- Universal browse with server-side filters: free text across name, affiliation
  and country, plus exact country.
- **Team pictures** — new `POST /v1/media/avatar`, open to any signed-in user
  (the banner route is gated on content_creator, so a captain could never set
  one). 2 MB cap, SVG refused because avatars render in other players' pages.
- **Fixed: user-svc silently dropped `avatar_url` and `category_detail` on
  update** — PATCH returned 200 and saved nothing.

### Stats
- Team stats (points, flags, first bloods, events, best rank) via
  `GET /v1/ctf/teams/{id}/stats`; profile CTF record via
  `GET /v1/ctf/users/{id}/ctf-stats`.
- No new tracking was needed — the numbers were already in
  `ctf.event_participants`.

### Play screen
- Unsolved and solved split into separate sections. Solved rows carry no status
  or assignee, because there is nothing left to coordinate.
- Category rail with per-category progress and a tick when complete.
- Status and assignee became compact pickers (a coloured diamond and a ⊕) after
  the first version made every row too tall.

### Infrastructure
- Reclaimed ~30 GB: pruned build cache and stopped containers, deleted an unused
  x86_64 colima VM, then **`fstrim`** to return the space to macOS —
  `~/.colima` went 44 GB → 13 GB, free space 3.9 GB → 34 GB.

## Earlier

Stack brought from zero to 21 running containers with real data. Roughly 30
bugs fixed across schema drift, routing, auth, serialization and infrastructure.
Teams, invitations, per-player event registration, task status and assignment,
websockets, team chat, banners and admin live-editing were built in that period.
