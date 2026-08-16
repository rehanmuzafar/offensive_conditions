# Status — what is actually built

Last updated: **2026-08-16**.

"Verified" below means exercised through the real path (browser or the same call
the browser makes) and the result checked, not just that code exists.

## Platform

- All **21 containers** run from `deploy/` (`docker compose up -d`)
- Real data end to end — no mock fallbacks in the paths listed below

## Teams — complete

| Feature | State |
|---|---|
| Create, invite by username, captain/member roles | Verified |
| Universal browse with search | Verified |
| Filters: country, affiliation, free text across name/affiliation/country | Verified |
| Join requests: send, captain review, accept/decline | Verified in browser |
| Team page: Details / Players / Settings / Join Requests tabs | Verified |
| Team picture upload (own endpoint, 2 MB, no SVG) | Verified in browser |
| Team stats: points, flags, first bloods, events, best rank | Verified with real solves |

Layout: `/teams` is a list only (All Teams / My Teams tabs). Managing a team
happens on `/teams/[slug]`.

## Profile

- **CTF record** card on `/u/[username]`: points, flags, first bloods, events,
  teams played with, best rank. Career-wide, solo and team events together.

## CTF event

| Feature | State |
|---|---|
| Landing page `/ctf/[slug]`: banner, About, Going, Specifications | Verified |
| "Join event" / "Enter arena" depending on registration | Verified |
| Arena `/ctf/[slug]/play` — no app chrome | Verified |
| Scenario board: unsolved/solved split, category rail with progress | Verified |
| Status control (Not started / In progress / Need help / Clear) | Verified |
| Assignee picker with roster search | Verified |
| Scenario drawer — left slide-over, Escape and backdrop close | Verified |
| Team Chat + Global Activity right rail | Verified with real solves |
| Stat strip: rank, points, flags, scenarios | Verified — reads the team's aggregated standing |
| Scoreboard: podium, standings table, own-row highlight, team card | Verified |
| Leaderboard aggregates by team; solo events stay per player | Verified both paths |
| Country flags on the podium and in the table | Verified |
| Top 10 teams chart (step lines, hover crosshair, legend) | Verified |
| Trending stats panel behind `‹ ›` | Verified |
| Sticky "your team" card: rank, points, flags, first bloods, gap to next rank | Verified |

## Infrastructure and correctness fixes

Roughly 30 distinct bugs fixed, including: `uuid_generate_v7()` producing
26-byte values; monthly partitions expired; Kafka configured for `snappy` with
no codec installed; pgx unable to scan `inet` into `*string`; JWT issuer
mismatch between signer and validators; `MissingGreenlet` from SQLAlchemy
deferred loads; a Pydantic error handler that turned every 400 into a 500.
