# What OFFCON is, and why it is built this way

## The product

A cybersecurity training and CTF platform in the mould of HackTheBox and
TryHackMe: players solve security challenges, capture flags, earn points, and
compete on scoreboards — individually and in teams.

**The immediate goal** is to host a real CTF and open registrations for it. That
deadline drives every prioritisation call in ROADMAP.md.

Domain: **offensiveconditions.org**.

## Who it serves

- **Players** — individually, or as part of a team, entering CTF events
- **Teams** — universities, companies, countries, or open squads
- **Organisers (admins)** — creating events and scenarios, running them live

The organiser story matters more than it looks. An API-only admin surface is
unusable for a non-technical organiser, so admin work needs a real GUI.

## Shape of the system

12 backend microservices, a Next.js 15 frontend, an nginx edge, and shared
infrastructure — 21 containers in all.

| Language | Services |
|---|---|
| Go | auth, user-svc, orchestrator, scoring, flag-verifier |
| Python (FastAPI) | content-svc, ctf-svc, forum-svc, writeup-svc, bounty-svc |
| Node | payment-svc, notification-svc |

Infrastructure: PostgreSQL 16 (a schema per service), Redis 7, Kafka (KRaft),
MinIO for object storage, Mailpit for mail in development.

## Decisions worth remembering

**Registration is per player, not per team.** Each player enters an event
themselves and picks which of their teams they represent. A five-person team is
five participant rows sharing one `team_id`. This is why the scoreboard has to
aggregate — see KNOWN-ISSUES.md.

**Teams are universal.** Anyone can browse teams and request to join. Private
teams are excluded from browse: they are invitation-only, so listing them would
only produce failed requests.

**Team affiliation is one optional free-text field**, not a category enum. An
earlier design asked the captain to pick a "category" of `country` — which is
not a category of anything. Country is its own field with a proper selector;
"organisation, university or company" is optional text, and searchable.

**The arena is a separate route with no app chrome.** `/ctf/[slug]` is the
public landing page; `/ctf/[slug]/play` is the arena, outside the app shell —
no sidebar, no platform topbar, no banner. HackTheBox achieves this with a
separate subdomain; a dedicated route group buys the same focus without
splitting the deployment.

**Two point systems exist and they are not the same thing.** scoring-svc counts
platform points (machines, standalone challenges); ctf-svc counts event points.
They are separate ledgers. Showing both unlabelled on one screen is the worst
option — label them or merge them before launch.

**Challenge flags are never stored or transmitted in plaintext.** The API takes
`static_flag_hash`; the service compares `sha256(submitted).hexdigest()`. Any
admin GUI must hash before sending.
