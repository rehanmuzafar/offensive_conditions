"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Droplet, X } from "lucide-react";

import { activityApi } from "@/lib/ctf-api";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/identity";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

/**
 * What a team has actually solved, broken down by category.
 *
 * There is no per-team solves endpoint, so this is assembled client-side from
 * two sources the platform already exposes: the event activity feed (which
 * carries the team, the challenge, the category and the time) and the challenge
 * list (which carries the points). Joining them here rather than asking for a
 * new endpoint keeps this a front-end change — but it is worth knowing that the
 * feed is a *window*, not history: it returns the most recent N solves, so on a
 * long-running event with many teams the oldest solves fall off the end. The
 * limit is asked for at the server's maximum for that reason, and the totals
 * are labelled as coming from the feed rather than presented as authoritative.
 */
/** Only the fields this dialog reads off the raw challenge payload. */
interface RawChallenge {
  id: string;
  category: string;
  base_points?: number;
  current_points?: number;
}

export function TeamSolvesDialog({
  eventId,
  teamId,
  teamName,
  onClose,
}: {
  eventId: string;
  teamId: string;
  teamName: string;
  onClose: () => void;
}) {
  // 200 is the server's ceiling (`le=200`), not a preference. Asking for 500
  // failed validation outright, so the feed never loaded and this dialog showed
  // "no solves" for teams that had plenty.
  const ACTIVITY_LIMIT = 200;

  const { data: activity, isLoading, isError } = useQuery({
    queryKey: ["ctf-activity", eventId, "team-solves"],
    queryFn: () => activityApi.list(eventId, ACTIVITY_LIMIT),
    staleTime: 30_000,
  });

  /**
   * Challenge points, for the per-solve score.
   *
   * Two things were wrong here. The path took the event *slug* where the API
   * wants the event id, which is why this returned "request validation failed".
   * And the query key was `["ctf-challenges", slug]` — the exact key the real
   * challenge list uses, but with a different fetcher, so whichever ran last
   * won and the scenario board could end up reading this raw payload instead of
   * its mapped one.
   */
  /**
   * The endpoint answers with `{ items: [...] }`, not a bare array. Typed as an
   * array, `challenges` was an object, and iterating it threw "not iterable" —
   * which is what turned this dialog into a blank Application-error page rather
   * than a dialog missing its points column.
   *
   * These are raw API rows, so the field names are the server's.
   */
  const { data: challenges } = useQuery({
    queryKey: ["ctf-challenges-raw", eventId],
    queryFn: async () => {
      const page = await api.get<{ items: RawChallenge[] }>(
        `/v1/ctf/events/${eventId}/challenges`,
      );
      return page.items ?? [];
    },
    staleTime: 60_000,
  });

  /** challenge id → points, so the feed's rows can show a score. */
  const points = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of challenges ?? []) map.set(c.id, c.current_points ?? c.base_points ?? 0);
    return map;
  }, [challenges]);

  /** How many challenges exist per category — the denominator in "8 of 8". */
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of challenges ?? []) map.set(c.category, (map.get(c.category) ?? 0) + 1);
    return map;
  }, [challenges]);

  const grouped = useMemo(() => {
    const rows = (activity ?? []).filter((a) => a.team_id === teamId);
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    // Most-solved category first: it is the one that says what the team is good
    // at, which is the question this dialog exists to answer.
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [activity, teamId]);

  /**
   * Everything starts closed.
   *
   * This used to fall back to `grouped[0]` when nothing had been picked, which
   * made "no choice yet" and "the first category" the same state — so the
   * dialog always opened with one section already hanging open, and the empty
   * string below existed only to mean "closed on purpose". Holding the choice
   * plainly removes both.
   */
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalSolves = grouped.reduce((n, [, rows]) => n + rows.length, 0);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Solves by ${teamName}`}
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent flex max-h-[85vh] w-full max-w-[640px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <Avatar username={teamName} size="sm" />
            <div>
              <div className="font-display text-[16px] font-bold tracking-mega">{teamName}</div>
              <div className="text-[10px] uppercase tracking-wide text-text-faint">
                {totalSolves} solve{totalSolves === 1 ? "" : "s"} in this feed
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading && <p className="p-6 text-center text-[12.5px] text-text-faint">Loading solves…</p>}

          {isError && (
            <p className="p-8 text-center text-[12.5px] text-danger">
              Could not load the activity feed. Try again in a moment.
            </p>
          )}

          {!isLoading && !isError && grouped.length === 0 && (
            <p className="p-8 text-center text-[12.5px] text-text-faint">
              No solves from this team in the current feed.
            </p>
          )}

          {grouped.map(([category, rows]) => {
            const isOpen = expanded === category;
            const total = categoryTotals.get(category);
            return (
              <section key={category} className="mb-2 border border-line">
                <button
                  onClick={() => setExpanded(isOpen ? null : category)}
                  className="group flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="relative text-[13px] capitalize">
                    {category}
                    {/* The rule under the open category is the same spectral
                        mark the segmented control uses for "you are here". */}
                    <span
                      className={cn(
                        "iridescent-rule absolute -bottom-1 left-0 h-px transition-[width] duration-300",
                        isOpen ? "w-full" : "w-0 group-hover:w-full",
                      )}
                    />
                  </span>
                  <span className="flex items-center gap-2.5 text-[10.5px] uppercase tracking-wide text-text-faint">
                    {rows.length}
                    {total != null && ` of ${total}`} flags
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform duration-300", isOpen && "rotate-180")}
                    />
                  </span>
                </button>

                {isOpen && (
                  <ul className="border-t border-line">
                    {rows.map((row, i) => (
                      <li
                        key={`${row.challenge_id}-${i}`}
                        className="group grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-line px-4 py-2.5 text-[12px] transition-colors last:border-0 hover:bg-surface-hover"
                      >
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          {row.is_first_blood && (
                            <Droplet className="h-3 w-3 shrink-0 text-danger" aria-label="First blood" />
                          )}
                          <span className="truncate text-text-dim transition-colors group-hover:text-text">
                            {row.challenge_name}
                          </span>
                        </span>
                        <span className="tabular-nums text-text-faint">
                          {points.get(row.challenge_id) ?? "—"}
                          <span className="ml-1 text-[9.5px] uppercase text-text-ghost">pts</span>
                        </span>
                        <span className="whitespace-nowrap text-[10.5px] text-text-ghost">
                          {formatDate(row.solved_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
