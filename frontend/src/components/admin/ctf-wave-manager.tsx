"use client";

/**
 * Wave management for one CTF event.
 *
 * A wave is a release window: the challenges filed under it open when it starts
 * and stop accepting flags when it ends. Leaving the end empty means the wave
 * runs to the finish of the event, which is the common case — that is stored as
 * NULL rather than a copy of the event's end, so pushing the event out later
 * carries its waves along instead of stranding them on a stale timestamp.
 *
 * Waves stay editable while the event is live. Moving round two by an hour is a
 * normal organiser action mid-CTF, not an emergency.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Layers, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ctfAdminApi, type CtfWave } from "@/lib/ctf-admin-api";

const field =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";
const label = "mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-dim";

const STATE_STYLE: Record<CtfWave["state"], string> = {
  upcoming: "border-line-strong text-text-dim",
  live: "border-accent text-accent",
  closed: "border-line-strong text-text-faint",
};

/** `datetime-local` needs "YYYY-MM-DDTHH:mm" in local time, not an ISO string. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function CtfWaveManager({ eventId }: { eventId: string }) {
  const [waves, setWaves] = useState<CtfWave[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<CtfWave | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await ctfAdminApi.listWaves(eventId);
      setWaves(res.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load waves");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setEditing(null);
    setShowForm(false);
    setName("");
    setStartsAt("");
    setEndsAt("");
  }

  function startEdit(w: CtfWave) {
    setEditing(w);
    setShowForm(true);
    setName(w.name);
    setStartsAt(toLocalInput(w.starts_at));
    setEndsAt(toLocalInput(w.ends_at));
  }

  async function submit() {
    if (!name.trim()) return toast.error("Give the wave a name");
    if (!startsAt) return toast.error("A wave needs a start time");

    setSaving(true);
    try {
      if (editing) {
        await ctfAdminApi.updateWave(eventId, editing.id, {
          name: name.trim(),
          starts_at: fromLocalInput(startsAt) ?? undefined,
          // An emptied end field means "run to the end of the event", which is
          // a value in its own right and needs the explicit flag to express.
          ...(endsAt ? { ends_at: fromLocalInput(endsAt) } : { clear_ends_at: true }),
        });
        toast.success("Wave updated");
      } else {
        await ctfAdminApi.createWave(eventId, {
          name: name.trim(),
          starts_at: fromLocalInput(startsAt)!,
          ends_at: fromLocalInput(endsAt),
        });
        toast.success("Wave added");
      }
      reset();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the wave");
    } finally {
      setSaving(false);
    }
  }

  async function remove(w: CtfWave) {
    setSaving(true);
    try {
      await ctfAdminApi.deleteWave(eventId, w.id);
      toast.success(
        w.challenge_count > 0
          ? `“${w.name}” removed — its ${w.challenge_count} challenge${w.challenge_count === 1 ? "" : "s"} are now unfiled and open`
          : `“${w.name}” removed`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the wave");
    } finally {
      setSaving(false);
    }
  }

  async function move(w: CtfWave, delta: number) {
    setSaving(true);
    try {
      await ctfAdminApi.updateWave(eventId, w.id, { position: w.position + delta });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reorder");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-text-dim">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading waves…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <Layers className="h-4 w-4" /> Waves
        </div>
        {!showForm && (
          <Button variant="ghost" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Add wave
          </Button>
        )}
      </div>

      <p className="text-[12px] text-text-faint">
        Challenges filed under a wave open when it starts and stop taking flags when it
        ends. Leave the end empty to run to the finish of the event. A challenge left out
        of every wave is open from the start.
      </p>

      {showForm && (
        <Card>
          <CardBody className="space-y-3">
            <div>
              <label className={label}>Name</label>
              <input
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Wave 1"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>Opens</label>
                <input
                  type="datetime-local"
                  className={field}
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div>
                <label className={label}>Closes (optional)</label>
                <input
                  type="datetime-local"
                  className={field}
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-text-faint">
                  Empty = runs until the event ends.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={submit} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save wave" : "Add wave"}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={saving}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {waves.length === 0 ? (
        <p className="text-[13px] text-text-dim">
          No waves yet — every challenge is open from the moment the event starts.
        </p>
      ) : (
        <ul className="space-y-2">
          {waves.map((w, i) => (
            <li
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold">{w.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${STATE_STYLE[w.state]}`}
                  >
                    {w.state}
                  </span>
                </div>
                <div className="mt-0.5 text-[12px] text-text-faint">
                  {new Date(w.starts_at).toLocaleString()} →{" "}
                  {w.ends_at ? new Date(w.ends_at).toLocaleString() : "end of event"}
                  {" · "}
                  {w.challenge_count} challenge{w.challenge_count === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  disabled={saving || i === 0}
                  onClick={() => move(w, -1)}
                  aria-label={`Move ${w.name} earlier`}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  disabled={saving || i === waves.length - 1}
                  onClick={() => move(w, 1)}
                  aria-label={`Move ${w.name} later`}
                >
                  ↓
                </Button>
                <Button variant="ghost" onClick={() => startEdit(w)} aria-label={`Edit ${w.name}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => remove(w)}
                  aria-label={`Delete ${w.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
