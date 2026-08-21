"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Clock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ctfAdminApi, type AdminCtfEvent } from "@/lib/ctf-admin-api";

/**
 * A pause window, booked in advance.
 *
 * Organisers know some of their stoppages ahead of time — a maintenance slot,
 * an overnight break in a multi-day event. Scheduling one is independent of the
 * pause button: the event runs normally until the window opens, and the window
 * becomes true on its own because the effective pause is computed at read time
 * rather than flipped by a job.
 *
 * Resuming by hand clears the schedule outright. An organiser who presses
 * resume means the event is running, and a window left armed would stop it
 * again behind them.
 */
export function CtfPauseScheduler({
  event,
  onClose,
  onSaved,
}: {
  event: AdminCtfEvent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [start, setStart] = useState(toLocalInput(event.pause_starts_at));
  const [end, setEnd] = useState(toLocalInput(event.pause_ends_at));
  const [reason, setReason] = useState(event.pause_reason ?? "");
  const [saving, setSaving] = useState(false);

  const hasSchedule = Boolean(event.pause_starts_at && event.pause_ends_at);

  function save() {
    if (!start || !end) return toast.error("A scheduled pause needs both a start and an end.");
    if (new Date(end) <= new Date(start)) return toast.error("The pause must end after it starts.");

    setSaving(true);
    ctfAdminApi
      .setPause(event.id, {
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
        reason: reason.trim() || undefined,
      })
      .then(() => {
        toast.success("Pause scheduled.");
        onSaved();
        onClose();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not schedule the pause."))
      .finally(() => setSaving(false));
  }

  function clear() {
    setSaving(true);
    ctfAdminApi
      .clearPauseSchedule(event.id)
      .then(() => {
        toast.success("Schedule cleared.");
        onSaved();
        onClose();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not clear the schedule."))
      .finally(() => setSaving(false));
  }

  const field =
    "h-10 w-full border border-line bg-transparent px-3 text-[13px] text-text focus:border-text focus:outline-none";
  const label = "block text-[11.5px] font-semibold uppercase tracking-wide text-text-faint";

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Schedule a pause"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent w-full max-w-[460px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[16px] font-bold tracking-mega">
              <Clock className="h-4 w-4 text-accent" /> Schedule a pause
            </h2>
            <p className="mt-0.5 text-[12px] text-text-dim">{event.name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div>
            <label className={label}>Pause from</label>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={`${field} mt-1.5`}
            />
          </div>
          <div>
            <label className={label}>Until</label>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={`${field} mt-1.5`}
            />
          </div>
          <div>
            <label className={label}>Reason (shown to players)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Infrastructure maintenance"
              className={`${field} mt-1.5`}
            />
          </div>
          <p className="text-[12px] text-text-faint">
            Play stops while the window is open; the scoreboard stays readable.
            Pressing resume before it ends cancels the schedule.
          </p>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
          {hasSchedule ? (
            <Button variant="ghost" loading={saving} onClick={clear}>
              Clear schedule
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** ISO → the value a datetime-local input wants, in the viewer's own zone. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
