"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/identity";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ctfApi } from "@/lib/community-api";

/**
 * The captain's roster for one event.
 *
 * A team's slots belong to the team, not to whoever clicked first. On a
 * four-slot event the wrong four teammates may have entered, and the captain
 * needs to take a seat back and hand it to someone else.
 *
 * Only until the event starts. After that a participant owns solves, first
 * bloods and a rank, and removing them would either destroy that record or
 * leave it pointing at nobody — the server enforces this and the dialog says so
 * rather than offering controls that would be refused.
 */
export function TeamRosterDialog({
  slug,
  teamId,
  onClose,
}: {
  slug: string;
  teamId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const key = ["ctf-roster", slug, teamId];

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => ctfApi.roster(slug, teamId),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["ctf-team-slots", slug] });
    qc.invalidateQueries({ queryKey: ["ctf-event", slug] });
  }

  const add = useMutation({
    mutationFn: (userId: string) => ctfApi.rosterAdd(slug, teamId, userId),
    onSuccess: () => {
      invalidate();
      toast.success("Added to the roster.");
    },
    onError: (e: unknown) => toast.error(message(e, "Could not add that player.")),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => ctfApi.rosterRemove(slug, teamId, userId),
    onSuccess: () => {
      invalidate();
      toast.success("Slot freed.");
    },
    onError: (e: unknown) => toast.error(message(e, "Could not remove that player.")),
  });

  const entered = (data?.members ?? []).filter((m) => m.entered).length;
  const max = data?.maxTeamSize ?? null;
  const full = max != null && entered >= max;
  const busy = add.isPending || remove.isPending;

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Team roster"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent w-full max-w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">
              {data?.teamName ?? "Team roster"}
            </h2>
            <p className="mt-0.5 text-[12px] text-text-dim">
              {max != null ? `${entered} of ${max} slots filled` : `${entered} entered`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {data?.locked && (
          <p className="border-b border-line bg-warning/8 px-5 py-3 text-[12.5px] text-warning">
            The event has started — the roster is locked. Removing a player now
            would take their solves with them.
          </p>
        )}

        <div className="max-h-[52vh] overflow-y-auto p-3">
          {isLoading && (
            <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the roster…
            </p>
          )}
          {isError && (
            <p className="px-4 py-10 text-center text-[13px] text-danger">
              Only the team owner or a captain can manage this roster.
            </p>
          )}

          {(data?.members ?? []).map((m) => {
            const isCaptain = ["owner", "captain"].includes(m.role.toLowerCase());
            const blocked = data?.locked || busy || (!m.entered && full);
            return (
              <div
                key={m.userId}
                className={cn(
                  "mb-2 flex items-center gap-3 border px-4 py-3 last:mb-0",
                  m.entered ? "border-line-strong" : "border-line opacity-80",
                )}
              >
                <Avatar username={m.username} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] text-text">{m.username}</span>
                    {isCaptain && <Crown className="h-3.5 w-3.5 shrink-0 text-warning" />}
                  </span>
                  <span className="text-[11.5px] text-text-faint">
                    {m.entered ? "entered" : "not entered"}
                  </span>
                </span>
                {m.entered ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={blocked}
                    onClick={() => remove.mutate(m.userId)}
                  >
                    <Minus className="h-3.5 w-3.5" /> Remove
                  </Button>
                ) : (
                  <Button size="sm" disabled={blocked} onClick={() => add.mutate(m.userId)}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                )}
              </div>
            );
          })}

          {full && !data?.locked && (
            <p className="px-4 py-2 text-center text-[12px] text-text-faint">
              Every slot is taken. Remove someone to free one.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function message(e: unknown, fallback: string): string {
  const m = (e as { message?: string } | null)?.message;
  return m && m.length < 160 ? m : fallback;
}
