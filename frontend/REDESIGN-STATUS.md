# OFFCON redesign — status

Branch: `redesign/offcon-theme` (off `main`; `main` untouched).
Serve: `npm run build && npx next start -p 3000` (the docker `offcon-frontend-1`
container is stopped — `docker start offcon-frontend-1` restores the old UI).

## Done

### Foundation
- Two-material token system: **ink** (dark) and **paper** (light, a drafting
  sheet rather than an inverted dark theme).
- **Iridescent accent** — `--accent` cycles a five-stop neon ring over 48s via
  `@property`-registered channels (plain custom properties don't interpolate).
  Freezes under `prefers-reduced-motion`.
- Radius scale squared globally; `brand-gradient`/`shadow-glow` redefined so
  ~80 call sites changed without touching them.
- Fonts vendored locally (Archivo / IBM Plex Mono / IBM Plex Sans) — Google
  Fonts is unreachable on this machine and hangs the build.
- Primitives: Button, Card (+ `spotlight`), Badge, Input, identity, progress,
  Stat, `Segmented` (shared sliding-indicator tabs), `motion.tsx`
  (Tilt / Reveal / CountUp).
- Utilities: `.glass`, `.glass-strong`, `.edge-iridescent`, `.bracket-frame`,
  `.chip-solid`, `.prose-reading`, glitch keyframes.

### Surfaces
- Landing page ported in as its own route group, full WebGL scene.
- Sign-in / sign-up: ambient scene, skull facing forward, sign-in cinematic
  (ripple → dive into the eye → glitched "WELCOME TO DARKNESS").
- Dashboard: ambient scene (skull turns with the pointer), tilt + spotlight +
  iridescent edges + counted figures.
- CTF surfaces: scene without skull, matrix field on, pointer wake at 1%.
- Machine / CTF / bounty / forum cards, marketing pages, app shell.
- Scoreboard: podium + row hovers, first-bloods column, graph time axis,
  team-solves dialog (built from the activity feed + challenge list).

### Bugs fixed
- **Session died every 15 minutes.** `isAuthenticated()` only compared
  `expiresAt` to the clock, so AuthGuard bounced users to /login with a valid
  refresh token in the store. Now renews 60s before expiry and the guard
  attempts recovery before redirecting. *Affected every user, not just testing.*
- **Challenge link never shown.** Two causes: the mapper hardcoded
  `connectionInfo: null`, and the admin form only saved `connection_url` when
  delivery was `shared_host`. Both fixed — but **challenges created before this
  have `null` in the DB and must be re-edited** to get their link back.
- **Scenario board status/assignee menus buried** — a regression from the blur
  sweep: `backdrop-filter` creates a stacking context, trapping the menus behind
  later siblings. Panels now lift while holding an open menu.
- **Team name linked to `/teams/{uuid}`** — that route looks up by *handle*, so
  it always 404'd. Now opens the solve breakdown instead.
- Default avatars: solid accent chip + initials (the grid experiment was wrong
  at 30px).
- Event banner: 16:9, image contained, blurred copy filling the letterbox.
- Rules field surfaced as **About** on the event page (stored as
  `rules_markdown`; renaming the column needs a migration).
- Flag submission cinematic: peek / shake + red eyes / nod + ripple + 360 spin
  into the eye / "already solved".

## Not done

### Needs backend
1. **Admin delete for events and tasks** — no DELETE endpoints exist in
   `ctf-admin-api.ts`. UI is straightforward once routes exist.
2. **Team solves shows "no flags"** despite reported flags. The dialog reads the
   event activity feed and filters on `team_id`; those solves aren't coming back
   with a matching team. Needs the live response inspected.
3. **Scoreboard rows carry no team handle** — until the payload includes one,
   team names cannot link to team pages.

### Frontend, not started
4. **~30 pages never seen**: tracks, teams, forum, writeups, bounty, admin (7),
   settings sub-pages, notifications, billing, profile.
5. **Light theme never tested on app surfaces** — only the pricing page.
6. **Responsive** — no page has been checked at a mobile width.
7. **Blur sweep audit** — the stacking trap that hit the scenario board may also
   affect the topbar user menu, country select, and admin form popovers.
8. Batches still planned: dense data → detail skeleton → forms → long-form
   reading → live surfaces → empty/loading/error states.
9. Landing page figures are still static — see `HANDOFF-PROMPT.md` in
   `~/offcon-landing-page` for the per-section inventory.

## Verification gap

Everything from the banner fix onward was written but **not seen working** —
sessions kept expiring and passwords can't be typed by Claude. The session fix
should end that. Worth re-checking first: the flag cinematic, the challenge
link, the About block, the graph axis, and the first-bloods column.
