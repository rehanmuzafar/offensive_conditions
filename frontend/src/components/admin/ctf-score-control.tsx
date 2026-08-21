"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, History, ListOrdered, Loader2, Minus, Pin, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/identity";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber } from "@/lib/format";
import { CtfBoardOrder } from "@/components/admin/ctf-board-order";
import { ctfAdminApi, type AdminCtfEntry } from "@/lib/ctf-admin-api";

/**
 * Organiser control over an event's scores.
 *
 * Two powers, both of which need to work before, during and after the event:
 * moving a score by hand, and banning an entry.
 *
 * Adjustments are kept apart from earned points rather than added into them.
 * A team's points are the sum of what its members solved; a penalty is not
 * something any member solved, and folding it in would pick an arbitrary
 * player to carry it and leave no record of who decided or why. So the table
 * shows earned and adjusted separately, and every change asks for a reason.
 */
export function CtfScoreControl({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);
  const [reordering, setReordering] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ctf-entries", eventId],
    queryFn: () => ctfAdminApi.listEntries(eventId),
  });

  const log = useQuery({
    queryKey: ["admin-ctf-adjustments", eventId],
    queryFn: () => ctfAdminApi.listAdjustments(eventId),
    enabled: showLog,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-ctf-entries", eventId] });
    qc.invalidateQueries({ queryKey: ["admin-ctf-adjustments", eventId] });
  }

  const entries = data?.items ?? [];

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Score control"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent flex max-h-[86vh] w-full max-w-[720px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">Scores &amp; bans</h2>
            <p className="mt-0.5 text-[12px] text-text-dim">
              Every entry, including banned ones. Changes take effect immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Dragging says "this team goes above that one", which is what an
                organiser actually means. Pinning one row at a time asked them
                to think in absolute positions instead. */}
            <Button size="sm" variant="ghost" onClick={() => setReordering(true)}>
              <ListOrdered className="h-3.5 w-3.5" /> Reorder
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)}>
              <History className="h-3.5 w-3.5" /> {showLog ? "Entries" : "History"}
            </Button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading && (
            <p className="flex items-center justify-center gap-2 py-12 text-[13px] text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading entries…
            </p>
          )}
          {isError && (
            <p className="py-12 text-center text-[13px] text-danger">
              Could not load the entries for this event.
            </p>
          )}

          {showLog ? (
            <AdjustmentLog rows={log.data?.items ?? []} loading={log.isLoading} />
          ) : (
            <>
              {!isLoading && entries.length === 0 && (
                <p className="py-12 text-center text-[13px] text-text-dim">
                  Nobody has registered for this event yet.
                </p>
              )}
              {entries.map((e) => (
                <EntryRow
                  key={e.team_id ?? e.user_id ?? e.name}
                  eventId={eventId}
                  entry={e}
                  boardSize={entries.length}
                  onChanged={refresh}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {reordering && (
        <CtfBoardOrder
          eventId={eventId}
          entries={entries}
          onClose={() => setReordering(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function EntryRow({
  eventId,
  entry,
  boardSize,
  onChanged,
}: {
  eventId: string;
  entry: AdminCtfEntry;
  /** How many entries the board actually has — a pin cannot exceed it. */
  boardSize: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  /* Off by default: most adjustments are quiet corrections. Turning it on
     publishes the change and its reason beside the team on the scoreboard,
     which is what makes it a *bonus* rather than an unexplained number. */
  const [announce, setAnnounce] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);
  /* Rank pinning is kept behind its own disclosure: it overrides the points
     ordering, which is a heavier thing to do than move a score, and it should
     not sit one stray click away. */
  const [pinOpen, setPinOpen] = useState(false);
  const [pinPos, setPinPos] = useState(entry.pinned_position ? String(entry.pinned_position) : "");
  const [pinReason, setPinReason] = useState(entry.pinned_reason ?? "");

  const subject = entry.team_id ? { team_id: entry.team_id } : { user_id: entry.user_id! };

  const adjust = useMutation({
    mutationFn: (delta: number) =>
      ctfAdminApi.adjustScore(eventId, {
        ...subject,
        delta,
        reason: reason.trim() || undefined,
        visible: announce,
      }),
    onSuccess: () => {
      toast.success("Score adjusted.");
      setAmount("");
      setReason("");
      setAnnounce(false);
      setOpen(false);
      onChanged();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not adjust that score.")),
  });

  const ban = useMutation({
    mutationFn: (banned: boolean) =>
      ctfAdminApi.setBan(eventId, {
        ...subject,
        banned,
        reason: banned ? reason.trim() || "Disqualified by the organisers" : undefined,
      }),
    onSuccess: (_r, banned) => {
      toast.success(banned ? "Entry banned." : "Entry reinstated.");
      setConfirmBan(false);
      setReason("");
      onChanged();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not change that ban.")),
  });

  const pin = useMutation({
    mutationFn: () =>
      ctfAdminApi.setRankPin(eventId, {
        ...subject,
        position: Number(pinPos),
        reason: pinReason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(
        clamped
          ? `Pinned to #${requested} — it shows at #${effective} until the board has that many entries.`
          : `Pinned to #${pinPos}.`,
      );
      setPinOpen(false);
      onChanged();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not pin that rank.")),
  });

  const unpin = useMutation({
    mutationFn: () => ctfAdminApi.clearRankPin(eventId, subject),
    onSuccess: () => {
      toast.success("Pin removed — back to its points position.");
      setPinPos("");
      setPinReason("");
      setPinOpen(false);
      onChanged();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not remove that pin.")),
  });

  /**
   * Where a pin will actually land.
   *
   * A board of N entries has no position N+1, so anything past the end settles
   * at the end — ranks must run 1..N with no gaps. The pin is still stored as
   * asked, so it becomes real if more teams enter later; what was missing was
   * anyone saying so. Pinning to #3 on a one-team event showed #1 and looked
   * broken.
   */
  const requested = Number(pinPos);
  const effective =
    Number.isInteger(requested) && requested > 0 ? Math.min(requested, Math.max(boardSize, 1)) : null;
  const clamped = effective != null && effective !== requested;

  function applyPin() {
    if (!Number.isInteger(requested) || requested < 1) return toast.error("Positions start at 1.");
    pin.mutate();
  }

  function apply(sign: 1 | -1) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return toast.error("Enter a number of points.");
    /* A reason is only required when it will be shown: the board cannot print
       "+50" with nothing beside it. A quiet correction has nothing to announce,
       and demanding a sentence there just produces "asdf". */
    if (announce && !reason.trim()) {
      return toast.error("A bonus shown on the scoreboard needs a reason to show with it.");
    }
    adjust.mutate(sign * Math.abs(Math.round(n)));
  }

  return (
    <div
      className={cn(
        "mb-2 border px-4 py-3 last:mb-0",
        entry.banned ? "border-danger/40 bg-danger/5" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Avatar username={entry.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] text-text">{entry.name}</span>
            {entry.banned && (
              <span className="bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">
                banned
              </span>
            )}
            {entry.pinned_position != null && (
              <span
                title={entry.pinned_reason ?? "Position set by hand"}
                className="flex items-center gap-1 bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent"
              >
                <Pin className="h-2.5 w-2.5" /> #{entry.pinned_position}
                {entry.pinned_position > boardSize && (
                  <span className="text-text-faint"> (shows #{Math.max(boardSize, 1)})</span>
                )}
              </span>
            )}
          </span>
          <span className="text-[11.5px] text-text-faint">
            {entry.is_team ? `${entry.member_count} entered · ` : ""}
            {entry.solve_count} solves
            {entry.banned && entry.ban_reason ? ` · ${entry.ban_reason}` : ""}
          </span>
        </span>

        <span className="text-right">
          <span className="block font-mono text-[14px] tabular-nums text-text">
            {formatNumber(entry.points)}
          </span>
          <span className="block text-[10.5px] text-text-ghost">
            {formatNumber(entry.earned_points)} earned
            {entry.adjustment !== 0 && (
              <span className={entry.adjustment > 0 ? "text-success" : "text-danger"}>
                {" "}
                {entry.adjustment > 0 ? "+" : ""}
                {formatNumber(entry.adjustment)}
              </span>
            )}
          </span>
        </span>

        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            Adjust
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPinOpen((v) => !v)}>
            <Pin className="h-3.5 w-3.5" /> Rank
          </Button>
          {entry.banned ? (
            <Button size="sm" variant="ghost" loading={ban.isPending} onClick={() => ban.mutate(false)}>
              <ShieldCheck className="h-3.5 w-3.5" /> Reinstate
            </Button>
          ) : (
            <Button
              size="sm"
              variant="danger"
              loading={ban.isPending}
              onClick={() => {
                if (!confirmBan) {
                  setConfirmBan(true);
                  setOpen(true);
                  return;
                }
                ban.mutate(true);
              }}
            >
              <Ban className="h-3.5 w-3.5" />
              {confirmBan ? `Ban ${entry.name}?` : "Ban"}
            </Button>
          )}
        </div>
      </div>

      {pinOpen && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={pinPos}
              onChange={(e) => setPinPos(e.target.value)}
              inputMode="numeric"
              placeholder="Position"
              className="h-9 w-[110px] border border-line bg-transparent px-3 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
            />
            <input
              value={pinReason}
              onChange={(e) => setPinReason(e.target.value)}
              placeholder="Reason — shown with the pin"
              className="h-9 min-w-[200px] flex-1 border border-line bg-transparent px-3 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
            />
            <Button size="sm" loading={pin.isPending} onClick={applyPin}>
              <Pin className="h-3.5 w-3.5" /> Pin
            </Button>
            {entry.pinned_position != null && (
              <Button size="sm" variant="ghost" loading={unpin.isPending} onClick={() => unpin.mutate()}>
                Unpin
              </Button>
            )}
          </div>
          {clamped && (
            <p className="mt-2 text-[11.5px] text-warning">
              This board has {boardSize} {boardSize === 1 ? "entry" : "entries"}, so #{requested}{" "}
              does not exist yet — the pin will show at #{effective} and move to #{requested} if
              enough teams enter.
            </p>
          )}
          <p className="mt-2 text-[11.5px] text-warning">
            A pin overrides the points order for this row. The scoreboard marks
            it as pinned — it cannot show a hand-set position as an earned one.
          </p>
        </div>
      )}

      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder="Points"
            className="h-9 w-[110px] border border-line bg-transparent px-3 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={announce ? "Reason — shown on the scoreboard" : "Reason (optional)"}
            className="h-9 min-w-[200px] flex-1 border border-line bg-transparent px-3 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
          />
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12.5px] text-text-dim">
            <input
              type="checkbox"
              checked={announce}
              onChange={(e) => setAnnounce(e.target.checked)}
              className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
            />
            Show on scoreboard
          </label>
          <Button size="sm" loading={adjust.isPending} onClick={() => apply(1)}>
            <Plus className="h-3.5 w-3.5" /> Award
          </Button>
          <Button size="sm" variant="ghost" loading={adjust.isPending} onClick={() => apply(-1)}>
            <Minus className="h-3.5 w-3.5" /> Deduct
          </Button>
        </div>
      )}
    </div>
  );
}

function AdjustmentLog({
  rows,
  loading,
}: {
  rows: { id: string; delta: number; reason: string | null; visible: boolean; created_at: string | null }[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="flex items-center justify-center gap-2 py-12 text-[13px] text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="py-12 text-center text-[13px] text-text-dim">No adjustments yet.</p>;
  }
  return (
    <>
      {rows.map((a) => (
        <div key={a.id} className="mb-2 flex items-center gap-3 border border-line px-4 py-2.5 last:mb-0">
          <span
            className={cn(
              "w-[70px] shrink-0 font-mono text-[13px] tabular-nums",
              a.delta > 0 ? "text-success" : "text-danger",
            )}
          >
            {a.delta > 0 ? "+" : ""}
            {a.delta}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-text-dim">
            {a.reason || <span className="text-text-faint">no reason recorded</span>}
          </span>
          {a.visible && (
            <span className="shrink-0 bg-surface-hover px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-faint">
              shown
            </span>
          )}
          <span className="shrink-0 text-[11px] text-text-ghost">
            {a.created_at ? formatDate(a.created_at) : ""}
          </span>
        </div>
      ))}
    </>
  );
}

function msg(e: unknown, fallback: string): string {
  const m = (e as { message?: string } | null)?.message;
  return m && m.length < 200 ? m : fallback;
}
