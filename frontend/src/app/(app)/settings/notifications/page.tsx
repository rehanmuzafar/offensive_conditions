"use client";

import { useState, useEffect } from "react";
import { Mail, Smartphone, Monitor } from "lucide-react";
import { toast } from "sonner";

import { Card, Skeleton } from "@/components/ui/card";
import { usePreferences } from "@/hooks/use-account";
import { notificationApi } from "@/lib/account-api";
import { cn } from "@/lib/cn";
import type { NotificationPreference } from "@/types/account";

type Channel = "email" | "push" | "inApp";

export default function NotificationSettingsPage() {
  const { data, isLoading } = usePreferences();
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);

  useEffect(() => {
    if (data) setPrefs(data);
  }, [data]);

  function toggle(category: string, channel: Channel) {
    setPrefs((prev) =>
      prev.map((p) => (p.category === category ? { ...p, [channel]: !p[channel] } : p)),
    );
    const pref = prefs.find((p) => p.category === category);
    if (pref) {
      notificationApi.updatePreference(category, channel, !pref[channel]).catch(() => {});
    }
    toast.success("Preference saved");
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[20px] font-bold">Notifications</h2>
        <p className="mt-1 text-[14px] text-text-dim">Choose how you want to be notified for each type of activity.</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <Card className="overflow-hidden p-0">
          {/* header */}
          <div className="grid grid-cols-[1fr_60px_60px_60px] items-center gap-2 border-b border-line px-5 py-3 sm:grid-cols-[1fr_80px_80px_80px]">
            <span className="text-[12px] font-bold uppercase tracking-[1px] text-text-faint">Category</span>
            <ChannelHead icon={<Mail className="h-4 w-4" />} label="Email" />
            <ChannelHead icon={<Smartphone className="h-4 w-4" />} label="Push" />
            <ChannelHead icon={<Monitor className="h-4 w-4" />} label="In-app" />
          </div>

          {prefs.map((p) => (
            <div key={p.category} className="grid grid-cols-[1fr_60px_60px_60px] items-center gap-2 border-b border-line px-5 py-4 last:border-0 sm:grid-cols-[1fr_80px_80px_80px]">
              <div className="min-w-0 pr-2">
                <div className="text-[14.5px] font-semibold">{p.label}</div>
                <div className="text-[12.5px] text-text-faint">{p.description}</div>
              </div>
              <Toggle on={p.email} onClick={() => toggle(p.category, "email")} />
              <Toggle on={p.push} onClick={() => toggle(p.category, "push")} />
              <Toggle on={p.inApp} onClick={() => toggle(p.category, "inApp")} />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function ChannelHead({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-text-faint">
      {icon}
      <span className="text-[10.5px] font-semibold uppercase tracking-wide">{label}</span>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onClick}
        className={cn("relative h-6 w-10 rounded-full transition-colors", on ? "bg-brand-gradient" : "bg-line-strong")}
      >
        <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-transform", on ? "translate-x-5" : "translate-x-1")} />
      </button>
    </div>
  );
}
