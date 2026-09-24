"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { GripVertical, RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/identity";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { ctfAdminApi, type AdminCtfEntry } from "@/lib/ctf-admin-api";

/**
 * The final standings, set by dragging.
 *
 * Pinning one row at a time asked the organiser to think in absolute positions
 * — "this team is third" — when what they actually mean is "this team goes
 * above that one". Dragging says the second thing, and everything between
 * shifts by one on its own, the way a playlist behaves.
 *
 * Only rows that actually moved are pinned. Everything else stays free to
 * follow the points, so a later solve still reorders the part of the board
 * nobody has overruled.
 */
export function CtfBoardOrder({
  eventId,
  entries,
  onClose,
  onSaved,
}: {
  eventId: string;
  entries: AdminCtfEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<AdminCtfEntry[]>(entries);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  // The natural order, to compare against so untouched rows stay unpinned.
  const [original] = useState(() => entries.map(keyOf));
  const moved = rows.map(keyOf).some((k, i) => k !== original[i]);

  useEffect(() => setRows(entries), [entries]);

  function move(from: number, to: number) {
    if (from === to) return;
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(from, 1);
      if (row) next.splice(to, 0, row);
      return next;
    });
  }

  const save = useMutation({
    mutationFn: () =>
      ctfAdminApi.reorderBoard(
        eventId,
        rows.map((r, i) => ({
          team_id: r.team_id,
          user_id: r.user_id,
          // Untouched rows are left to the points; only what moved is fixed.
          pinned: keyOf(r) !== original[i],
        })),
        reason.trim() || undefined,
      ),
    onSuccess: (res) => {
      toast.success(
        res.pinned === 0
          ? "Order restored — every row follows its points again."
          : `Order saved — ${res.pinned} ${res.pinned === 1 ? "row is" : "rows are"} fixed by hand.`,
      );
      onSaved();
      onClose();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not save that order.")),
  });

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Reorder the scoreboard"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent flex max-h-[86vh] w-full max-w-[620px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">Final standings</h2>
            <p className="mt-0.5 text-[12px] text-text-dim">
              Drag a team to where it finishes. Everything between shifts by one.
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

        <div className="flex-1 overflow-y-auto p-3">
          {rows.length === 0 && (
            <p className="py-12 text-center text-[13px] text-text-dim">
              Nobody has registered for this event yet.
            </p>
          )}

          {rows.map((r, i) => (
            <div
              key={keyOf(r)}
              draggable
              onDragStart={() => setDragging(i)}
              onDragEnter={() => setOver(i)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={() => {
                if (dragging != null && over != null) move(dragging, over);
                setDragging(null);
                setOver(null);
              }}
              className={cn(
                "mb-1.5 flex cursor-grab items-center gap-3 border px-4 py-2.5 last:mb-0 active:cursor-grabbing",
                dragging === i ? "border-accent opacity-60" : "border-line",
                over === i && dragging !== i && "border-accent",
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-text-faint" />
              <span className="w-7 shrink-0 font-mono text-[13px] tabular-nums text-text-faint">
                {i + 1}
              </span>
              <Avatar username={r.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{r.name}</span>
              <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-text-dim">
                {formatNumber(r.points)}
              </span>
            </div>
          ))}
        </div>

        <footer className="space-y-3 border-t border-line px-5 py-4">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason — shown on the board beside every row you moved"
            className="h-9 w-full border border-line bg-transparent px-3 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setRows(entries)} disabled={!moved}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                <Save className="h-4 w-4" /> Save order
              </Button>
            </div>
          </div>
          <p className="text-[11.5px] text-warning">
            Rows you move are fixed by hand and marked as such on the public
            board — it cannot show a placed position as an earned one. The rest
            keep following their points.
          </p>
        </footer>
      </div>
    </div>
  );
}

function keyOf(e: AdminCtfEntry): string {
  return e.team_id ?? e.user_id ?? e.name;
}

function msg(e: unknown, fallback: string): string {
  const m = (e as { message?: string } | null)?.message;
  return m && m.length < 200 ? m : fallback;
}
