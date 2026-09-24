/**
 * Which catalogue rows are allowed into the index.
 *
 * Not everything public is worth ranking, and the difference matters more than
 * it sounds. Google scores a domain partly on the aggregate quality of what it
 * finds there, so a sitemap that lists eight events — six of them called some
 * variant of "test" with zero challenges attached — does not produce six
 * neutral pages. It produces six thin pages that drag the four real ones down
 * with them, and a manual-action risk on top. Having no event pages indexed is
 * strictly better than having the seed data indexed.
 *
 * So the rule is opt-out by quality rather than opt-in by hand: a row earns its
 * place by having the things a useful page needs — a name, a description, and
 * in the case of an event, challenges to actually solve. Real content passes
 * these on its own the day it is created, with nobody remembering to add it to
 * a list. Seed and staging rows do not.
 *
 * Both predicates are used twice, and must stay in step: `sitemap.ts` decides
 * what to submit, and the page itself decides whether to emit `noindex`. A row
 * that fails here is still reachable and still renders — it is simply not
 * advertised, which is the correct treatment for a draft event that a
 * participant has the link to.
 */

/**
 * Slugs that name a dev artefact rather than a product.
 *
 * Deliberately anchored on word boundaries: `test` matches `payment-test-2026`
 * and `testing`, but not `pentest-basics` or `contested`, which are plausible
 * names for real content. The false-negative direction is the safe one here —
 * an unindexed real event costs a little traffic, an indexed "Payment Test CTF"
 * costs domain trust.
 */
const DEV_ARTEFACT = /(?:^|[-_])(test|testing|tests|demo|staging|sandbox|dummy|example|sample|tmp|temp|wip|draft|foo|bar|placeholder)(?:[-_]|$)/i;

/** Minimum challenges before an event page has anything to say. */
const MIN_CHALLENGES = 3;

/** Minimum description length that counts as a description rather than a stub. */
const MIN_DESCRIPTION = 40;

function looksReal(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return !DEV_ARTEFACT.test(slug);
}

function hasProse(text: string | null | undefined, min = MIN_DESCRIPTION): boolean {
  return typeof text === "string" && text.trim().length >= min;
}

/** The fields the gate reads. Structural on purpose, so both the API type and a
 *  partial from the sitemap query satisfy it without a cast. */
export interface IndexableEvent {
  slug: string;
  name?: string | null;
  description?: string | null;
  visibility?: string | null;
  status?: string | null;
  challenge_count?: number | null;
  invitation_only?: boolean | null;
}

export interface IndexableMachine {
  slug: string;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  retired_at?: string | null;
  os?: string | null;
  difficulty?: string | null;
}

export interface IndexablePath {
  slug: string;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  module_count?: number | null;
}

/**
 * An event is worth indexing when someone arriving from a search would find a
 * competition they could read about and enter — or one that ran and left a
 * scoreboard behind. An invitation-only event fails regardless of its content:
 * ranking a page nobody in the search result can join is a bounce.
 */
export function isIndexableEvent(e: IndexableEvent): boolean {
  if (!looksReal(e.slug)) return false;
  if (e.visibility !== "public") return false;
  if (e.invitation_only) return false;
  if (!hasProse(e.description)) return false;
  if ((e.challenge_count ?? 0) < MIN_CHALLENGES) return false;
  // `draft` and `archived` are not states a stranger should land in.
  if (e.status && !["live", "ended", "upcoming", "published", "registration"].includes(e.status)) {
    return false;
  }
  return true;
}

/** A machine earns a page once it is live, unretired and described. */
export function isIndexableMachine(m: IndexableMachine): boolean {
  if (!looksReal(m.slug)) return false;
  if (m.status !== "active") return false;
  if (m.retired_at) return false;
  if (!hasProse(m.description, 20)) return false;
  return true;
}

/** Same test for a learning track, which needs modules to be worth entering. */
export function isIndexablePath(p: IndexablePath): boolean {
  if (!looksReal(p.slug)) return false;
  if (p.status && p.status !== "active" && p.status !== "published") return false;
  if (!hasProse(p.description, 20)) return false;
  if ((p.module_count ?? 0) < 1) return false;
  return true;
}
