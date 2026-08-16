"use client";

/**
 * Edit an existing CTF event.
 *
 * ctf-svc accepts a narrower set of fields than create: the schedule can be
 * pushed out but the event cannot be pulled earlier than its registration
 * close, and some fields freeze once the event is running. Everything the
 * service will not accept is simply not offered here.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  ctfAdminApi,
  uploadBanner,
  type AdminCtfEvent,
  type ChallengeRuntime,
  type CtfEventUpdateInput,
} from "@/lib/ctf-admin-api";

const field =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";
const label = "mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-dim";

/** ISO → the value a datetime-local input expects, in local time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CtfEventEdit({
  event,
  onSaved,
  onCancel,
}: {
  event: AdminCtfEvent;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(event.name);
  const [description, setDescription] = useState(event.description ?? "");
  const [rules, setRules] = useState(event.rules_markdown ?? "");
  const [regEnd, setRegEnd] = useState(toLocalInput(event.registration_ends_at));
  const [start, setStart] = useState(toLocalInput(event.starts_at));
  const [end, setEnd] = useState(toLocalInput(event.ends_at));
  const [runtime, setRuntime] = useState<ChallengeRuntime>(event.challenge_runtime);
  const [scoreboard, setScoreboard] = useState(event.scoreboard_visibility ?? "public");
  const [isPaid, setIsPaid] = useState(event.entry_fee_cents > 0);
  const [fee, setFee] = useState((event.entry_fee_cents / 100).toFixed(2));
  const [currency, setCurrency] = useState(event.currency);
  const [banner, setBanner] = useState<string | null>(event.cover_image_url);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const started = event.status === "live" || event.status === "ended" || event.status === "archived";

  async function handleBanner(file: File) {
    setUploading(true);
    try {
      setBanner(await uploadBanner(file, "ctf"));
      toast.success("Banner uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Banner upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const re = new Date(regEnd).getTime();
    const st = new Date(start).getTime();
    const en = new Date(end).getTime();
    if ([re, st, en].some(Number.isNaN)) return toast.error("All dates are required");
    if (!(re <= st)) return toast.error("Registration must close at or before the event starts");
    if (!(st < en)) return toast.error("The event must start before it ends");
    if (isPaid && !(Number(fee) > 0)) return toast.error("A paid event needs an entry fee above 0");

    setSaving(true);
    try {
      const body: CtfEventUpdateInput = {
        name: name.trim(),
        description: description.trim(),
        rules_markdown: rules.trim(),
        cover_image_url: banner,
        challenge_runtime: runtime,
        scoreboard_visibility: scoreboard,
        entry_fee_cents: isPaid ? Math.round(Number(fee) * 100) : 0,
        currency,
        // Schedule fields are rejected once the event is running.
        ...(started
          ? {}
          : {
              registration_ends_at: new Date(regEnd).toISOString(),
              starts_at: new Date(start).toISOString(),
              ends_at: new Date(end).toISOString(),
            }),
      };
      await ctfAdminApi.updateEvent(event.id, body);
      toast.success("Event updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[16px] font-bold">Edit event</h3>
          <button onClick={onCancel} className="text-text-faint hover:text-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className={label}>Event name</label>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className={label}>Short description</label>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <label className={label}>Banner image</label>
          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-2 text-[13px] hover:border-accent">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : banner ? "Replace image" : "Choose image"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleBanner(f);
                }}
              />
            </label>
            {banner && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={banner} alt="Event banner" className="h-12 rounded-lg border border-line object-cover" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={label}>Registration closes</label>
            <input type="datetime-local" className={field} value={regEnd} disabled={started} onChange={(e) => setRegEnd(e.target.value)} />
          </div>
          <div>
            <label className={label}>Event starts</label>
            <input type="datetime-local" className={field} value={start} disabled={started} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className={label}>Event ends</label>
            <input type="datetime-local" className={field} value={end} disabled={started} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {started && (
          <p className="-mt-2 text-[12px] text-warning">
            The schedule is frozen because this event has already started.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Challenges run on</label>
            <select className={field} value={runtime} onChange={(e) => setRuntime(e.target.value as ChallengeRuntime)}>
              <option value="static_only">Static only — no spawning</option>
              <option value="cloud">Cloud — public IPs</option>
              <option value="onsite">On-site — LAN</option>
            </select>
          </div>
          <div>
            <label className={label}>Scoreboard visible to</label>
            <select className={field} value={scoreboard} onChange={(e) => setScoreboard(e.target.value as AdminCtfEvent["scoreboard_visibility"])}>
              <option value="public">Everyone</option>
              <option value="participants">Registered players only</option>
              <option value="hidden">Organisers only</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-bg-elevated/50 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" checked={!isPaid} onChange={() => setIsPaid(false)} /> Free entry
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" checked={isPaid} onChange={() => setIsPaid(true)} /> Paid entry
            </label>
          </div>
          {isPaid && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Entry fee</label>
                <input type="number" min="0" step="0.01" className={field} value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <div>
                <label className={label}>Currency</label>
                <select className={field} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="PKR">PKR</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className={label}>Rules (markdown)</label>
          <textarea className={`${field} h-24 py-2`} value={rules} onChange={(e) => setRules(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
