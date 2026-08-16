# Roadmap

Ordered by what actually unblocks a launch, not by what is most interesting.

## Before opening registrations

### 1. Decide free or paid
This one decision removes or creates a whole workstream.

- **Free CTF** — payments disappear from the critical path entirely.
- **Paid CTF** — the payment UI becomes the first job: a player screen showing
  the bank details, and an organiser approval queue. The backend is already
  done; only screens are missing.

### 2. Deploy to a real server
A domain, TLS, and real SMTP. Until mail leaves Mailpit, no external user can
verify an account or reset a password. Nothing else matters more than this.

### 3. Dress rehearsal
Three or four real people, end to end: sign up → email → team → register →
submit a flag → scoreboard. Every serious bug so far surfaced this way and not
from unit-level checks.

### 4. Label the two point systems
Small, and currently confusing on the profile page.

## Arena, remaining

- Teamless modal: "Create a team" / "Join a team"
- Collapsible app sidebar (icons-only)
- Team page events list (upcoming / ongoing / past)

## Deliberately deferred

**Per-team Docker spawning.** Three separate pieces of work with a hard blocker
at the front (see KNOWN-ISSUES.md). A jeopardy CTF runs fine on static flags and
shared containers, which is how most of them run. This is not on the launch path.

**A CTF subdomain.** HackTheBox runs `ctf.hackthebox.com` separately. Doing that
properly means a second deployment, a shared cookie domain, and CORS. The
dedicated arena route already delivers the focus that matters; the split can
wait until there is a reason beyond aesthetics.
