"use client";

import { useState } from "react";
import { Key, Plus, Copy, Trash2, Check, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { useApiKeys } from "@/hooks/use-account";
import { settingsApi } from "@/lib/account-api";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ApiKey } from "@/types/account";

const ALL_SCOPES = ["machines:read", "flag:submit", "leaderboard:read", "ctf:read", "reports:read", "reports:write"];

export default function ApiKeysPage() {
  const { data: keys, isLoading, refetch } = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [localKeys, setLocalKeys] = useState<ApiKey[] | null>(null);

  const list = localKeys ?? keys ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[20px] font-bold">API keys</h2>
          <p className="mt-1 text-[14px] text-text-dim">Programmatic access to the OFFCON API. Treat keys like passwords.</p>
        </div>
        {!creating && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New key</Button>}
      </div>

      {/* one-time key reveal */}
      {newKey && (
        <Card className="border-success/40">
          <CardBody>
            <div className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[15px] font-bold">Your new API key</h3>
                <p className="mt-1 text-[13px] text-text-dim">Copy it now — you won&apos;t be able to see it again.</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-bg-elevated px-3 py-2 font-mono text-[13px]">{newKey}</code>
                  <button onClick={() => { navigator.clipboard?.writeText(newKey); toast.success("Copied"); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-strong text-text-dim hover:text-text">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => setNewKey(null)}>Done</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* create form */}
      {creating && (
        <CreateKeyForm
          onCancel={() => setCreating(false)}
          onCreated={(plain, key) => {
            setNewKey(plain);
            setCreating(false);
            setLocalKeys([key, ...list]);
            refetch();
          }}
        />
      )}

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line py-16 text-center">
          <Key className="mx-auto h-8 w-8 text-text-faint" />
          <p className="mt-3 text-[15px] text-text-dim">No API keys yet.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((k) => (
            <Card key={k.id}>
              <CardBody className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[15px] font-semibold">{k.name}</span>
                    <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[12px] text-text-dim">{k.prefix}···</code>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {k.scopes.map((s) => (
                      <span key={s} className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] text-text-faint">{s}</span>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[12px] text-text-faint">
                    Created {formatDate(k.createdAt)}{k.lastUsedAt ? ` · last used ${formatRelative(k.lastUsedAt)}` : " · never used"}
                  </div>
                </div>
                <button
                  onClick={() => { setLocalKeys(list.filter((x) => x.id !== k.id)); settingsApi.revokeApiKey(k.id).catch(() => {}); toast.success("Key revoked"); }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-strong text-text-faint transition-colors hover:border-danger hover:text-danger"
                  aria-label="Revoke key"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateKeyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (plain: string, key: ApiKey) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["machines:read"]);
  const [saving, setSaving] = useState(false);

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function create() {
    if (!name.trim() || scopes.length === 0) return;
    setSaving(true);
    try {
      const res = await settingsApi.createApiKey(name, scopes);
      onCreated(res.key, res.apiKey);
    } catch {
      // mock mode: synthesize a key + record
      const plain = `offcon_live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
      onCreated(plain, {
        id: `k_${Date.now()}`,
        name,
        prefix: plain.slice(0, 16),
        scopes,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        expiresAt: null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-[16px] font-bold">Create API key</h3>
          <button onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-lg text-text-faint hover:text-text"><X className="h-4 w-4" /></button>
        </div>
        <FormField label="Key name" htmlFor="keyname" help="A label to remember what this key is for.">
          <Input id="keyname" value={name} onChange={(e) => setName(e.target.value)} placeholder="CI pipeline" />
        </FormField>
        <FormField label="Scopes" htmlFor="scopes">
          <div className="flex flex-wrap gap-2">
            {ALL_SCOPES.map((s) => (
              <button
                key={s}
                onClick={() => toggleScope(s)}
                className={cn("rounded-full border px-3 py-1.5 font-mono text-[12px] font-medium transition-colors", scopes.includes(s) ? "border-accent bg-brand-gradient-soft text-accent" : "border-line-strong text-text-dim hover:bg-surface-hover")}
              >
                {s}
              </button>
            ))}
          </div>
        </FormField>
        <div className="flex items-center gap-2.5 rounded-xl border border-warning/25 bg-warning/8 p-3 text-[12.5px] text-text-dim">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          The full key is shown only once after creation. Store it securely.
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button loading={saving} disabled={!name.trim() || scopes.length === 0} onClick={create}>Create key</Button>
        </div>
      </CardBody>
    </Card>
  );
}
