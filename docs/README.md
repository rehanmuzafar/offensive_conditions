# OFFCON — Documentation

Working documentation for **OFFCON** (Offensive Conditions), a cybersecurity
training and CTF platform at **offensiveconditions.org**.

Start here, then follow the file that matches what you need.

| File | What it answers |
|---|---|
| [PRODUCT.md](PRODUCT.md) | What OFFCON is, who it is for, and the decisions behind how it works |
| [STATUS.md](STATUS.md) | What is actually built and verified today |
| [ROADMAP.md](ROADMAP.md) | What is next, in priority order, and what is deliberately not being done |
| [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | Open bugs and gaps, with the evidence for each |
| [RUNBOOK.md](RUNBOOK.md) | How to run it, accounts, and the traps that have cost real hours |
| [CHANGELOG.md](CHANGELOG.md) | What changed, when, and why |

## The one thing to know

This codebase has a **recurring bug class**: services were written against a
schema and an API contract that were never reconciled. Missing columns, unrouted
endpoints, features implemented but never wired, and stubs that silently
disable a check. Most of the bugs found so far are instances of it.

The practical consequence: **verify through the real path**. A hand-rolled curl
that sends `{}` passes where the browser's bodyless POST fails. A save that
"succeeds" may be dropping your field. See RUNBOOK.md → *Traps*.
