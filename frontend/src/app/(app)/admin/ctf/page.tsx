"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Calendar, Flag, Pencil, Plus, Send, Settings2, Users } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CtfEventForm } from "@/components/admin/ctf-event-form";
import { CtfChallengeManager } from "@/components/admin/ctf-challenge-manager";
import { CtfEventEdit } from "@/components/admin/ctf-event-edit";
import { ctfAdminApi, type AdminCtfEvent, type CtfEventStatus } from "@/lib/ctf-admin-api";
import { formatNumber, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_STYLE: Record<CtfEventStatus, string> = {
  draft: "text-text-faint bg-surface-hover",
  published: "text-info bg-info/12",
  registration: "text-info bg-info/12",
  live: "text-success bg-success/12",
  ended: "text-text-faint bg-surface-hover",
  archived: "text-text-faint bg-surface-hover",
};

const RUNTIME_LABEL: Record<AdminCtfEvent["challenge_runtime"], string> = {
  cloud: "cloud (public IPs)",
  onsite: "on-site LAN",
  static_only: "static only",
};

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export default function AdminCtfPage() {
  const [events, setEvents] = useState<AdminCtfEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [managing, setManaging] = useState<AdminCtfEvent | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await ctfAdminApi.listEvents();
      setEvents(res.items ?? []);
    } catch {
      toast.error("Could not load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function publish(ev: AdminCtfEvent) {
    try {
      await ctfAdminApi.publishEvent(ev.id);
      toast.success(`“${ev.name}” published — it goes live automatically at the start time`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
    }
  }

  return (
    <div className="space-y-5">
      {managing ? (
        <>
          <button
            onClick={() => { setManaging(null); setEditing(false); }}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-text-dim hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" /> All events
          </button>

          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-[18px] font-bold text-text">{managing.name}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[managing.status])}>
                    {managing.status}
                  </span>
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold text-text-dim">
                    {managing.entry_fee_cents > 0 ? money(managing.entry_fee_cents, managing.currency) : "Free"}
                  </span>
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold text-text-dim">
                    runs on: {RUNTIME_LABEL[managing.challenge_runtime]}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px] text-text-faint">
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {formatDate(managing.starts_at)}</span>
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {formatNumber(managing.total_registered)} registered</span>
                  <span>/ctf/{managing.slug}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setEditing((v) => !v)}>
                  <Pencil className="h-4 w-4" /> {editing ? "Close" : "Edit details"}
                </Button>
                {managing.status === "draft" && (
                  <Button onClick={() => publish(managing)}>
                    <Send className="h-4 w-4" /> Publish
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          {editing && (
            <CtfEventEdit
              event={managing}
              onSaved={async () => {
                setEditing(false);
                const fresh = await ctfAdminApi.getEvent(managing.id).catch(() => null);
                if (fresh) setManaging(fresh);
                void load();
              }}
              onCancel={() => setEditing(false)}
            />
          )}

          {managing.status !== "draft" && (
            <p className="text-[13px] text-warning">
              This event is {managing.status} — challenges can no longer be added, and existing ones
              are frozen apart from hints and ordering.
            </p>
          )}

          <CtfChallengeManager
            eventId={managing.id}
            eventName={managing.name}
            runtime={managing.challenge_runtime}
          />
        </>
      ) : (
      <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
          <Flag className="h-5 w-5 text-accent" /> CTF management
        </h2>
        <Button onClick={() => { setShowForm((v) => !v); setManaging(null); }}>
          <Plus className="h-[18px] w-[18px]" /> New event
        </Button>
      </div>

      {showForm && (
        <CtfEventForm
          onCreated={() => { setShowForm(false); void load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <p className="text-[14px] text-text-dim">Loading events…</p>
      ) : events.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-[14px] text-text-dim">
              No events yet. Create one, add challenges, then publish it — the scheduler opens
              registration and starts the event on its own.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {events.map((e) => (
            <Card key={e.id}>
              <CardBody className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-[16px] font-bold text-text">{e.name}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[e.status])}>
                      {e.status}
                    </span>
                    <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold text-text-dim">
                      {e.entry_fee_cents > 0 ? money(e.entry_fee_cents, e.currency) : "Free"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px] text-text-faint">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" /> {formatDate(e.starts_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {formatNumber(e.total_registered)} registered
                    </span>
                    <span>/ctf/{e.slug}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setManaging(e)}>
                    <Settings2 className="h-4 w-4" /> Manage
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
