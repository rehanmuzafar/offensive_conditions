"use client";

import { useState } from "react";
import { Bell, Plus, Send, Mail, Smartphone, Monitor, Check, Clock } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { useBroadcasts, useCreateBroadcast } from "@/hooks/use-admin";
import { formatNumber, formatRelative, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Broadcast } from "@/types/admin";

const AUDIENCES: Broadcast["audience"][] = ["all", "pro", "free", "staff"];
const CHANNELS: { value: "in_app" | "email" | "push"; label: string; icon: React.ReactNode }[] = [
  { value: "in_app", label: "In-app", icon: <Monitor className="h-4 w-4" /> },
  { value: "email", label: "Email", icon: <Mail className="h-4 w-4" /> },
  { value: "push", label: "Push", icon: <Smartphone className="h-4 w-4" /> },
];

export default function AdminBroadcastPage() {
  const { data, isLoading } = useBroadcasts();
  const create = useCreateBroadcast();

  const [compose, setCompose] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Broadcast["audience"]>("all");
  const [channels, setChannels] = useState<Set<"in_app" | "email" | "push">>(new Set(["in_app"]));

  function toggleChannel(c: "in_app" | "email" | "push") {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  const canSend = title.trim().length >= 5 && body.trim().length >= 10 && channels.size > 0;

  function submit() {
    if (!canSend) return;
    create.mutate(
      { title, body, audience, channel: [...channels], scheduledFor: null },
      { onSuccess: () => { setCompose(false); setTitle(""); setBody(""); }, onError: () => setCompose(false) },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
          <Bell className="h-5 w-5 text-accent" /> Broadcasts
        </h2>
        <Button onClick={() => setCompose((v) => !v)}><Plus className="h-[18px] w-[18px]" /> New broadcast</Button>
      </div>

      {/* composer */}
      {compose && (
        <Card>
          <CardBody className="space-y-1">
            <FormField label="Title" htmlFor="bt" required>
              <Input id="bt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance this weekend" />
            </FormField>
            <FormField label="Message" htmlFor="bb" required>
              <textarea id="bb" value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="What do you want to tell users?" className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </FormField>

            <FormField label="Audience">
              <div className="flex flex-wrap gap-2">
                {AUDIENCES.map((a) => (
                  <button key={a} onClick={() => setAudience(a)} className={cn("border px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors", audience === a ? "border-accent bg-brand-gradient-soft text-accent" : "border-line-strong text-text-dim hover:bg-surface-hover")}>
                    {a === "all" ? "All users" : a}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="Channels">
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((c) => (
                  <button key={c.value} onClick={() => toggleChannel(c.value)} className={cn("flex items-center gap-1.5 border px-3.5 py-1.5 text-[13px] font-medium transition-colors", channels.has(c.value) ? "border-accent bg-brand-gradient-soft text-accent" : "border-line-strong text-text-dim hover:bg-surface-hover")}>
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </FormField>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setCompose(false)}>Cancel</Button>
              <Button size="sm" loading={create.isPending} disabled={!canSend} onClick={submit}>
                <Send className="h-4 w-4" /> Send broadcast
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* history */}
      {isLoading ? (
        <Skeleton className="h-80 w-full rounded-2xl" />
      ) : (
        <div className="space-y-3">
          {data?.map((b) => (
            <Card key={b.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-[15.5px] font-semibold">{b.title}</h3>
                      <StatusPill status={b.status} />
                    </div>
                    <p className="mt-1 text-[13.5px] text-text-dim">{b.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-faint">
                      <span className="capitalize">Audience: {b.audience === "all" ? "all users" : b.audience}</span>
                      <span className="flex items-center gap-1">
                        {b.channel.map((c) => (
                          <span key={c} className="rounded bg-surface-hover px-1.5 py-0.5 text-[10.5px] font-medium capitalize">{c.replace("_", "-")}</span>
                        ))}
                      </span>
                      {b.status === "sent" && b.sentAt && <span>· {formatNumber(b.recipientCount)} recipients · {formatRelative(b.sentAt)}</span>}
                      {b.status === "scheduled" && b.scheduledFor && <span className="flex items-center gap-1 text-info"><Clock className="h-3.5 w-3.5" /> {formatDate(b.scheduledFor)}</span>}
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Broadcast["status"] }) {
  const map = {
    sent: { label: "Sent", cls: "text-success bg-success/12", icon: <Check className="h-3 w-3" /> },
    scheduled: { label: "Scheduled", cls: "text-info bg-info/12", icon: <Clock className="h-3 w-3" /> },
    draft: { label: "Draft", cls: "text-text-dim bg-surface-hover", icon: null },
  } as const;
  const s = map[status];
  return (
    <span className={cn("flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold", s.cls)}>
      {s.icon} {s.label}
    </span>
  );
}
