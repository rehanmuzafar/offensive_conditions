"use client";

/**
 * Bug bounty programs — the admin side.
 *
 * Nothing on the platform could create a program, so every researcher-facing
 * bounty page was reading an endpoint that would always be empty. This is the
 * missing end: define the program, its scope and its reward tiers, then
 * publish it.
 *
 * Scope and rewards are part of the create form rather than a later step
 * because bounty-svc takes them on create, and a published program with no
 * declared scope is one nobody can safely test against.
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Target, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { adminApi, type ProgramCreateInput } from "@/lib/admin-api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Severity } from "@/types/bounty";

const FIELD =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3 text-[13.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";
const AREA = "min-h-[90px] w-full rounded-xl border border-line-strong bg-bg-elevated p-3 text-[13.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

const ASSET_TYPES = ["domain", "wildcard", "ip", "ip_range", "mobile_app", "source_code", "api", "other"];
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

const EMPTY: ProgramCreateInput = {
  slug: "",
  name: "",
  description: "",
  policy: "",
  visibility: "public",
  currency: "USD",
  minRewardCents: null,
  maxRewardCents: null,
  disclosurePolicy: "coordinated",
  responseSlaHours: 72,
  triageSlaHours: 168,
  resolutionSlaDays: 90,
  inScopeSummary: "",
  outOfScopeSummary: "",
  safeHarbor: true,
  scope: [],
  rewards: [],
};

export default function AdminBountyProgramsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ProgramCreateInput>(EMPTY);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-bounty-programs"],
    queryFn: () => adminApi.listProgramsAdmin(),
  });

  const create = useMutation({
    mutationFn: (body: ProgramCreateInput) => adminApi.createProgram(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-bounty-programs"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      setForm(EMPTY);
      setCreating(false);
      toast.success("Program created as a draft. Publish it when the policy is final.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't create the program"),
  });

  const setStatus = useMutation({
    mutationFn: ({ slug, action }: { slug: string; action: "publish" | "pause" | "close" }) =>
      adminApi.setProgramStatus(slug, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-bounty-programs"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      toast.success("Program updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't update the program"),
  });

  const set = <K extends keyof ProgramCreateInput>(k: K, v: ProgramCreateInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    if (!form.slug.trim() || !form.name.trim()) return toast.error("A program needs a name and a slug.");
    if (form.description.trim().length < 1) return toast.error("Add a short description.");
    if (form.policy.trim().length < 1) return toast.error("Add the program policy — researchers must read it before testing.");
    create.mutate(form);
  }

  return (
    <div className="space-y-5">
      <Link href="/admin/bounty" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Triage queue
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
            <Target className="h-5 w-5 text-accent" /> Bounty programs
          </h2>
          <p className="mt-1 text-[13.5px] text-text-dim">
            Programs start as drafts. Only published ones are visible to researchers.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((c) => !c)}>
          <Plus className="h-4 w-4" /> New program
        </Button>
      </div>

      {creating && (
        <Card>
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Labelled label="Name">
                <input className={FIELD} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="OFFCON Platform" />
              </Labelled>
              <Labelled label="Slug" hint="Lowercase, used in the URL.">
                <input className={FIELD} value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="offcon-platform" />
              </Labelled>
            </div>

            <Labelled label="Description" hint="One or two lines, shown on the program card.">
              <textarea className={AREA} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Labelled>

            <Labelled label="Policy" hint="Rules of engagement. Researchers read this before testing.">
              <textarea className={cn(AREA, "min-h-[140px]")} value={form.policy} onChange={(e) => set("policy", e.target.value)} />
            </Labelled>

            <div className="grid gap-3 sm:grid-cols-3">
              <Labelled label="Visibility">
                <select className={FIELD} value={form.visibility} onChange={(e) => set("visibility", e.target.value as ProgramCreateInput["visibility"])}>
                  <option value="public">Public</option>
                  <option value="invite_only">Invite only</option>
                  <option value="private">Private</option>
                </select>
              </Labelled>
              <Labelled label="Disclosure">
                <select className={FIELD} value={form.disclosurePolicy} onChange={(e) => set("disclosurePolicy", e.target.value as ProgramCreateInput["disclosurePolicy"])}>
                  <option value="coordinated">Coordinated</option>
                  <option value="full">Full</option>
                  <option value="none">None</option>
                </select>
              </Labelled>
              <Labelled label="Currency">
                <input className={FIELD} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))} />
              </Labelled>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Labelled label="Response SLA (hours)">
                <input type="number" className={FIELD} value={form.responseSlaHours} onChange={(e) => set("responseSlaHours", Number(e.target.value))} />
              </Labelled>
              <Labelled label="Triage SLA (hours)">
                <input type="number" className={FIELD} value={form.triageSlaHours} onChange={(e) => set("triageSlaHours", Number(e.target.value))} />
              </Labelled>
              <Labelled label="Resolution SLA (days)">
                <input type="number" className={FIELD} value={form.resolutionSlaDays} onChange={(e) => set("resolutionSlaDays", Number(e.target.value))} />
              </Labelled>
            </div>

            <label className="flex items-center gap-2 text-[13.5px] text-text-dim">
              <input type="checkbox" checked={form.safeHarbor} onChange={(e) => set("safeHarbor", e.target.checked)} />
              Safe harbor — researchers acting in good faith will not be pursued
            </label>

            <ScopeEditor value={form.scope} onChange={(scope) => set("scope", scope)} />
            <RewardEditor value={form.rewards} currency={form.currency} onChange={(rewards) => set("rewards", rewards)} />

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="ghost" size="sm" onClick={() => { setForm(EMPTY); setCreating(false); }}>Cancel</Button>
              <Button size="sm" loading={create.isPending} onClick={submit}>Create draft</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (data?.items ?? []).length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-display text-[16px] font-bold">No programs yet</p>
          <p className="mt-1.5 text-[13.5px] text-text-dim">Create one to open the bug bounty section to researchers.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {(data?.items ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-[15px] font-semibold">{p.name}</h3>
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
                    p.status === "published" ? "bg-success/12 text-success"
                      : p.status === "draft" ? "bg-surface-hover text-text-dim"
                      : "bg-warning/12 text-warning",
                  )}>
                    {p.status}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] text-text-faint">
                  <code className="font-mono">{p.slug}</code>
                  <span>{p.total_reports} reports</span>
                  {p.max_reward_cents ? <span>up to {formatMoney(p.max_reward_cents, p.currency)}</span> : null}
                </div>
              </div>
              <div className="flex gap-2">
                {p.status !== "published" && (
                  <Button size="sm" loading={setStatus.isPending} onClick={() => setStatus.mutate({ slug: p.slug, action: "publish" })}>
                    Publish
                  </Button>
                )}
                {p.status === "published" && (
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ slug: p.slug, action: "pause" })}>
                    Pause
                  </Button>
                )}
                <Link href={`/bounty/${p.slug}`}>
                  <Button size="sm" variant="ghost">View</Button>
                </Link>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">{label}</label>
      {hint && <p className="mt-0.5 text-[11.5px] text-text-ghost">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** In-scope and out-of-scope assets. An empty list is allowed but discouraged. */
function ScopeEditor({
  value,
  onChange,
}: {
  value: ProgramCreateInput["scope"];
  onChange: (v: ProgramCreateInput["scope"]) => void;
}) {
  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-center justify-between">
        <h4 className="font-display text-[14px] font-bold">Scope</h4>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange([...value, { assetType: "domain", assetIdentifier: "", severityMax: "critical", inScope: true, notes: "" }])
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add asset
        </Button>
      </div>
      {value.length === 0 && (
        <p className="mt-2 text-[12.5px] text-text-faint">
          No assets declared. Researchers will not know what they may test.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {value.map((s, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[130px_1fr_110px_90px_auto]">
            <select
              className={FIELD}
              value={s.assetType}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, assetType: e.target.value } : x)))}
            >
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
            <input
              className={FIELD}
              placeholder="*.offensiveconditions.org"
              value={s.assetIdentifier}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, assetIdentifier: e.target.value } : x)))}
            />
            <select
              className={FIELD}
              value={s.severityMax}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, severityMax: e.target.value as Severity } : x)))}
            >
              {SEVERITIES.map((sv) => <option key={sv} value={sv}>max {sv}</option>)}
            </select>
            <select
              className={FIELD}
              value={s.inScope ? "in" : "out"}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, inScope: e.target.value === "in" } : x)))}
            >
              <option value="in">In scope</option>
              <option value="out">Out</option>
            </select>
            <button
              aria-label="Remove asset"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="rounded-lg p-2 text-text-faint transition-colors hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reward bands per severity. bounty-svc caps this at five tiers. */
function RewardEditor({
  value,
  currency,
  onChange,
}: {
  value: ProgramCreateInput["rewards"];
  currency: string;
  onChange: (v: ProgramCreateInput["rewards"]) => void;
}) {
  const used = new Set(value.map((r) => r.severity));
  const next = SEVERITIES.find((s) => !used.has(s));

  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-center justify-between">
        <h4 className="font-display text-[14px] font-bold">Rewards</h4>
        <Button
          size="sm"
          variant="ghost"
          disabled={!next}
          onClick={() => next && onChange([...value, { severity: next, minCents: 0, maxCents: 0, currency }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add tier
        </Button>
      </div>
      {value.length === 0 && (
        <p className="mt-2 text-[12.5px] text-text-faint">No reward bands set — the program will show no payout range.</p>
      )}
      <div className="mt-2 space-y-2">
        {value.map((r, i) => (
          <div key={r.severity} className="grid gap-2 sm:grid-cols-[110px_1fr_1fr_auto]">
            <div className="flex h-10 items-center px-1 text-[13px] font-semibold capitalize text-text">{r.severity}</div>
            <MoneyInput
              label="min"
              cents={r.minCents}
              onChange={(c) => onChange(value.map((x, j) => (j === i ? { ...x, minCents: c } : x)))}
            />
            <MoneyInput
              label="max"
              cents={r.maxCents}
              onChange={(c) => onChange(value.map((x, j) => (j === i ? { ...x, maxCents: c } : x)))}
            />
            <button
              aria-label="Remove tier"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="rounded-lg p-2 text-text-faint transition-colors hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Takes whole units, stores cents — the API is cents throughout. */
function MoneyInput({ label, cents, onChange }: { label: string; cents: number; onChange: (cents: number) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-text-faint">{label}</span>
      <input
        type="number"
        min={0}
        value={cents ? cents / 100 : ""}
        onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))}
        placeholder="0"
        className={cn(FIELD, "pl-12")}
      />
    </div>
  );
}
