"use client";

/**
 * Full CTF event creation form.
 *
 * Encodes the two scheduling rules ctf-svc enforces, because hitting them as a
 * 400 after filling in a long form is miserable:
 *   registration_starts_at < registration_ends_at <= starts_at < ends_at
 * and `starts_at` cannot be changed after creation, so it is validated here.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  ctfAdminApi,
  uploadBanner,
  type CtfEventCreateInput,
  type CtfEventFormat,
  type CtfRequiredTier,
  type ChallengeRuntime,
} from "@/lib/ctf-admin-api";

const field =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";
const label = "mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-dim";

/** datetime-local gives "2026-08-14T18:30" (local); the API wants UTC ISO. */
function toIso(local: string): string {
  return new Date(local).toISOString();
}

function plusHours(h: number): string {
  const d = new Date(Date.now() + h * 3600_000);
  d.setSeconds(0, 0);
  // format for datetime-local without shifting to UTC
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CtfEventForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [format, setFormat] = useState<CtfEventFormat>("jeopardy");
  const [teamPlay, setTeamPlay] = useState(false);
  const [maxTeamSize, setMaxTeamSize] = useState(4);
  const [regStart, setRegStart] = useState(plusHours(0));
  const [regEnd, setRegEnd] = useState(plusHours(24));
  const [start, setStart] = useState(plusHours(24));
  const [end, setEnd] = useState(plusHours(72));
  const [tier, setTier] = useState<CtfRequiredTier>("free");
  const [isPaid, setIsPaid] = useState(false);
  const [fee, setFee] = useState("10.00");
  const [currency, setCurrency] = useState("USD");
  const [refundPolicy, setRefundPolicy] = useState("");
  const [firstBlood, setFirstBlood] = useState(25);
  const [minPoints, setMinPoints] = useState(50);
  const [dynamicScoring, setDynamicScoring] = useState(true);
  const [runtime, setRuntime] = useState<ChallengeRuntime>("static_only");
  const [banner, setBanner] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  function autoSlug(v: string) {
    setName(v);
    if (!slug || slug === slugify(name)) setSlug(slugify(v));
  }

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

  function validate(): string | null {
    if (name.trim().length < 3) return "Name must be at least 3 characters";
    if (!/^[a-z0-9-]+$/.test(slug)) return "Slug may only contain lowercase letters, numbers and dashes";
    const rs = new Date(regStart).getTime();
    const re = new Date(regEnd).getTime();
    const st = new Date(start).getTime();
    const en = new Date(end).getTime();
    if ([rs, re, st, en].some(Number.isNaN)) return "All four dates are required";
    if (!(rs < re)) return "Registration must open before it closes";
    if (!(re <= st)) return "Registration must close at or before the event starts";
    if (!(st < en)) return "The event must start before it ends";
    if (isPaid && !(Number(fee) > 0)) return "A paid event needs an entry fee above 0";
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const body: CtfEventCreateInput = {
        slug,
        name: name.trim(),
        description: description.trim() || undefined,
        rules_markdown: rules.trim() || undefined,
        format,
        visibility: "public",
        team_play: teamPlay,
        solo_play: !teamPlay,
        max_team_size: teamPlay ? maxTeamSize : null,
        registration_starts_at: toIso(regStart),
        registration_ends_at: toIso(regEnd),
        starts_at: toIso(start),
        ends_at: toIso(end),
        dynamic_scoring: dynamicScoring,
        min_points: minPoints,
        first_blood_bonus: firstBlood,
        required_tier: tier,
        challenge_runtime: runtime,
        // money is stored in minor units
        entry_fee_cents: isPaid ? Math.round(Number(fee) * 100) : 0,
        currency,
        refund_policy: isPaid ? refundPolicy.trim() || null : null,
        cover_image_url: banner,
      };
      await ctfAdminApi.createEvent(body);
      toast.success("Event created — add challenges, then publish it");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[16px] font-bold">Create event</h3>
          <button onClick={onCancel} className="text-text-faint hover:text-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Event name</label>
            <input className={field} value={name} onChange={(e) => autoSlug(e.target.value)} placeholder="OFFCON Winter CTF 2026" />
          </div>
          <div>
            <label className={label}>URL slug</label>
            <input className={field} value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="offcon-winter-ctf-2026" />
          </div>
        </div>

        <div>
          <label className={label}>Short description</label>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on the event card" />
        </div>

        {/* banner */}
        <div>
          <label className={label}>Banner image</label>
          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-2 text-[13px] hover:border-accent">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Choose image"}
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
              <img src={banner} alt="Event banner" className="h-10 rounded-lg border border-line object-cover" />
            )}
            <span className="text-[12px] text-text-faint">PNG/JPEG/WebP/GIF/SVG · max 5 MB</span>
          </div>
        </div>

        {/* schedule */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label}>Registration opens</label>
            <input type="datetime-local" className={field} value={regStart} onChange={(e) => setRegStart(e.target.value)} />
          </div>
          <div>
            <label className={label}>Registration closes</label>
            <input type="datetime-local" className={field} value={regEnd} onChange={(e) => { setRegEnd(e.target.value); if (new Date(e.target.value) > new Date(start)) setStart(e.target.value); }} />
          </div>
          <div>
            <label className={label}>Event starts</label>
            <input type="datetime-local" className={field} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className={label}>Event ends</label>
            <input type="datetime-local" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-[12px] text-text-faint">
          Registration must close at or before the start time, and the start time cannot be changed once the event is created.
        </p>

        {/* format + access */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={label}>Format</label>
            <select className={field} value={format} onChange={(e) => setFormat(e.target.value as CtfEventFormat)}>
              <option value="jeopardy">Jeopardy</option>
              <option value="attack_defense">Attack / Defense</option>
              <option value="hybrid">Hybrid</option>
              <option value="king_of_hill">King of the Hill</option>
            </select>
          </div>
          <div>
            <label className={label}>Participation</label>
            <select className={field} value={teamPlay ? "team" : "solo"} onChange={(e) => setTeamPlay(e.target.value === "team")}>
              <option value="solo">Solo</option>
              <option value="team">Teams</option>
            </select>
          </div>
          {teamPlay ? (
            <div>
              <label className={label}>Max team size</label>
              <input type="number" min={1} max={20} className={field} value={maxTeamSize} onChange={(e) => setMaxTeamSize(Number(e.target.value))} />
            </div>
          ) : (
            <div>
              <label className={label}>Minimum tier</label>
              <select className={field} value={tier} onChange={(e) => setTier(e.target.value as CtfRequiredTier)}>
                <option value="free">Free — anyone</option>
                <option value="vip">VIP and above</option>
                <option value="vip_plus">VIP+ only</option>
              </select>
            </div>
          )}
        </div>

        {/* where challenges run */}
        <div className="rounded-xl border border-line bg-bg-elevated/50 p-4">
          <label className={label}>Where do challenges run?</label>
          <div className="mt-1 space-y-2">
            <label className="flex items-start gap-2 text-[14px]">
              <input type="radio" className="mt-1" checked={runtime === "static_only"} onChange={() => setRuntime("static_only")} />
              <span>
                <span className="font-semibold">Static only</span>
                <span className="block text-[12px] text-text-faint">
                  No spawning. Downloadable files and shared-host challenges — covers most jeopardy CTFs.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[14px]">
              <input type="radio" className="mt-1" checked={runtime === "cloud"} onChange={() => setRuntime("cloud")} />
              <span>
                <span className="font-semibold">Cloud — public IPs</span>
                <span className="block text-[12px] text-text-faint">
                  Per-player instances get a public address. For online events.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[14px]">
              <input type="radio" className="mt-1" checked={runtime === "onsite"} onChange={() => setRuntime("onsite")} />
              <span>
                <span className="font-semibold">On-site — LAN</span>
                <span className="block text-[12px] text-text-faint">
                  Per-player instances get a private address on the venue network.
                </span>
              </span>
            </label>
          </div>
          <p className="mt-3 text-[12px] text-text-faint">
            This only affects per-player spawns. Static and shared-host challenges work either way, and
            every challenge can carry downloadable files.
          </p>
        </div>

        {/* pricing */}
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
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
              <div>
                <label className={label}>Refund policy</label>
                <input className={field} value={refundPolicy} onChange={(e) => setRefundPolicy(e.target.value)} placeholder="e.g. refundable up to 24h before start" />
              </div>
            </div>
          )}
          {isPaid && (
            <p className="mt-3 text-[12px] text-warning">
              Registrations stay pending until payment settles, and only count toward the participant total once paid.
            </p>
          )}
        </div>

        {/* scoring */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={label}>First-blood bonus</label>
            <input type="number" min={0} className={field} value={firstBlood} onChange={(e) => setFirstBlood(Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Minimum points (decay floor)</label>
            <input type="number" min={0} className={field} value={minPoints} onChange={(e) => setMinPoints(Number(e.target.value))} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2.5 text-[14px]">
              <input type="checkbox" checked={dynamicScoring} onChange={(e) => setDynamicScoring(e.target.checked)} />
              Dynamic scoring
            </label>
          </div>
        </div>

        <div>
          {/* Stored as `rules_markdown` — the column predates this use and
              renaming it needs a migration. Every human-facing label says
              "About", which is what it actually holds. */}
          <label className={label}>About this event (markdown)</label>
          <textarea
            className={`${field} h-40 py-2`}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder={"What the event is, who it is for, how scoring works, any rules players need to know."}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create event
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function slugify(v: string): string {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
