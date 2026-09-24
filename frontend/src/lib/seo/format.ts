/**
 * Date formatting for the public pages.
 *
 * Pinned to `en-GB` and UTC rather than the visitor's locale, and that is not
 * laziness. These pages are server-rendered and then hydrated, and a date
 * formatted from the runtime's own locale produces one string on the server and
 * a different one in the browser — the classic hydration mismatch, which React
 * resolves by throwing the server HTML away and re-rendering the subtree on the
 * client. For a page whose entire purpose is to hand a crawler server-rendered
 * text, quietly discarding that text is the one failure that matters.
 */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** "14 Sep 2026 → 16 Sep 2026", collapsing a same-day range to one date. */
export function formatRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const from = formatDate(start);
  if (!end) return from;
  const to = formatDate(end);
  return from === to ? from : `${from} → ${to}`;
}
