"use client";

/**
 * Invite someone by username.
 *
 * Membership is keyed by user id, but nobody types a UUID — this searches
 * user-svc and passes the id along behind the scenes.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { searchUsers, type UserSearchResult } from "@/lib/teams-api";

const field =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-9 pr-9 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

export function InvitePicker({
  excludeIds,
  onInvite,
}: {
  /** Already on the team — offering them would only produce a failed invite. */
  excludeIds: string[];
  onInvite: (userId: string, username: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    // Debounced so a fast typist does not fire one request per keystroke.
    const timer = setTimeout(async () => {
      try {
        const found = await searchUsers(q);
        // Ignore responses from queries the user has already typed past.
        if (mine === seq.current) setResults(found.filter((u) => !excludeIds.includes(u.user_id)));
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, excludeIds]);

  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-dim">
        Invite a player
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        <input
          className={field}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by username…"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-faint" />
        )}
      </div>

      {q.trim().length >= 2 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line">
          {results.length === 0 && !searching ? (
            <p className="px-3.5 py-3 text-[13px] text-text-faint">
              No players match &ldquo;{q.trim()}&rdquo;.
            </p>
          ) : (
            results.map((u) => (
              <div
                key={u.user_id}
                className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5 last:border-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-bold text-text-on-brand">
                    {u.username.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate text-[14px] font-semibold text-text">{u.username}</span>
                  {u.display_name && u.display_name !== u.username && (
                    <span className="truncate text-[12px] text-text-faint">{u.display_name}</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  disabled={inviting === u.user_id}
                  onClick={async () => {
                    setInviting(u.user_id);
                    try {
                      await onInvite(u.user_id, u.username);
                      setQ("");
                      setResults([]);
                    } finally {
                      setInviting(null);
                    }
                  }}
                >
                  {inviting === u.user_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Invite
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
