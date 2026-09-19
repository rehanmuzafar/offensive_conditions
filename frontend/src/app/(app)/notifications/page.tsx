"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Bell, Check, Server, Flag, MessagesSquare, Target, Wallet, TrendingUp, Settings as SettingsIcon, CheckCheck } from "lucide-react";

import { Card, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNotifications, useMarkAllRead } from "@/hooks/use-account";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Notification, NotificationType } from "@/types/account";

const ICON: Record<NotificationType, React.ReactNode> = {
  machine_owned: <Server className="h-[18px] w-[18px]" />,
  ctf_starting: <Flag className="h-[18px] w-[18px]" />,
  forum_reply: <MessagesSquare className="h-[18px] w-[18px]" />,
  report_update: <Target className="h-[18px] w-[18px]" />,
  payout: <Wallet className="h-[18px] w-[18px]" />,
  rank_change: <TrendingUp className="h-[18px] w-[18px]" />,
  system: <Bell className="h-[18px] w-[18px]" />,
};

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading } = useNotifications();
  const markAll = useMarkAllRead();

  const items = useMemo(() => {
    const list = data?.items ?? [];
    return unreadOnly ? list.filter((n) => !n.read) : list;
  }, [data, unreadOnly]);

  const unreadCount = (data?.items ?? []).filter((n) => !n.read).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
            <Bell className="h-6 w-6 text-text-faint" strokeWidth={1.6} /> Notifications
            {unreadCount > 0 && <span className="bg-brand-gradient px-2.5 py-0.5 text-[13px] font-bold text-white">{unreadCount}</span>}
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <Link href="/settings/notifications">
            <Button variant="ghost" size="sm"><SettingsIcon className="h-4 w-4" /> Preferences</Button>
          </Link>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" loading={markAll.isPending} onClick={() => markAll.mutate()}>
              <CheckCheck className="h-4 w-4" /> Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* filter */}
      <div className="flex rounded-xl border border-line-strong p-0.5 w-fit">
        <button onClick={() => setUnreadOnly(false)} className={cn("rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors", !unreadOnly ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text")}>All</button>
        <button onClick={() => setUnreadOnly(true)} className={cn("rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors", unreadOnly ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text")}>Unread</button>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line py-20 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-hover text-text-faint">
            <Check className="h-7 w-7" />
          </div>
          <h3 className="font-display text-[18px] font-semibold">{unreadOnly ? "All caught up!" : "No notifications"}</h3>
          <p className="mt-1 text-[14px] text-text-dim">{unreadOnly ? "You have no unread notifications." : "We'll let you know when something happens."}</p>
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          {items.map((n) => <NotificationRow key={n.id} n={n} />)}
        </Card>
      )}
    </div>
  );
}

function NotificationRow({ n }: { n: Notification }) {
  const inner = (
    <div className={cn("flex items-start gap-3 border-b border-line px-5 py-4 transition-colors last:border-0 hover:bg-surface-hover", !n.read && "bg-brand-gradient-soft/40")}>
      <span className={cn("relative grid h-10 w-10 shrink-0 place-items-center rounded-xl", !n.read ? "bg-brand-gradient text-white" : "bg-surface-hover text-text-dim")}>
        {ICON[n.type]}
        {!n.read && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold">{n.title}</div>
        <div className="mt-0.5 text-[13.5px] text-text-dim">{n.body}</div>
        <div className="mt-1 text-[12px] text-text-faint">{formatRelative(n.createdAt)}</div>
      </div>
    </div>
  );
  return n.link ? <Link href={n.link} className="block">{inner}</Link> : inner;
}
