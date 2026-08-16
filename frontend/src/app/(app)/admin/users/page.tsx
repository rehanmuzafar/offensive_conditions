"use client";

import { useState, useMemo } from "react";
import { Search, Ban, ShieldCheck, MoreVertical, UserCheck } from "lucide-react";

import { Card, Skeleton } from "@/components/ui/card";
import { Avatar } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { useAdminUsers, useSetUserStatus } from "@/hooks/use-admin";
import { formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AdminUser } from "@/types/admin";

const STATUS_STYLE: Record<AdminUser["status"], string> = {
  active: "text-success bg-success/12",
  suspended: "text-warning bg-warning/12",
  banned: "text-danger bg-danger/12",
};

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useAdminUsers();
  const setStatus = useSetUserStatus();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const users = useMemo(() => {
    let list = data?.items ?? [];
    if (q) {
      const n = q.toLowerCase();
      list = list.filter((u) => u.username.toLowerCase().includes(n) || u.email.toLowerCase().includes(n));
    }
    return list;
  }, [data, q]);

  function action(id: string, status: string) {
    setStatus.mutate({ id, status });
    setMenuFor(null);
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[20px] font-bold">User management</h2>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username or email…" className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <Card className="overflow-visible p-0">
          <div className="grid grid-cols-[1fr_90px_50px] gap-3 border-b border-line px-5 py-3 text-[12px] font-bold uppercase tracking-[1px] text-text-faint sm:grid-cols-[1fr_140px_90px_110px_50px]">
            <span>User</span>
            <span className="hidden sm:block">Roles</span>
            <span>Status</span>
            <span className="hidden sm:block">Last seen</span>
            <span></span>
          </div>
          {users.map((u) => (
            <div key={u.id} className="grid grid-cols-[1fr_90px_50px] items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-surface-hover sm:grid-cols-[1fr_140px_90px_110px_50px]">
              <div className="flex items-center gap-3">
                <Avatar username={u.username} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-[14px] font-semibold">{u.username}</span>
                    {u.country && <Flag code={u.country} className="!h-3 !w-[17px]" />}
                  </div>
                  <div className="truncate text-[12px] text-text-faint">{u.email} · {formatNumber(u.points)} pts</div>
                </div>
              </div>
              <div className="hidden flex-wrap gap-1 sm:flex">
                {u.roles.filter((r) => r !== "user").map((r) => (
                  <span key={r} className="rounded bg-brand-gradient-soft px-1.5 py-0.5 text-[10.5px] font-semibold capitalize text-accent">{r.replace("_", " ")}</span>
                ))}
                {u.roles.length === 1 && <span className="text-[12px] text-text-faint">member</span>}
              </div>
              <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold capitalize", STATUS_STYLE[u.status])}>{u.status}</span>
              <span className="hidden text-[12px] text-text-faint sm:block">{formatRelative(u.lastSeenAt)}</span>
              <div className="relative flex justify-end">
                <button onClick={() => setMenuFor(menuFor === u.id ? null : u.id)} className="grid h-8 w-8 place-items-center rounded-lg text-text-faint hover:bg-surface-hover hover:text-text">
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menuFor === u.id && (
                  <div className="absolute right-0 top-9 z-10 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg">
                    {u.status !== "active" && <MenuRow icon={<UserCheck className="h-4 w-4" />} label="Reinstate" onClick={() => action(u.id, "active")} />}
                    {u.status === "active" && <MenuRow icon={<ShieldCheck className="h-4 w-4 text-warning" />} label="Suspend" onClick={() => action(u.id, "suspended")} />}
                    {u.status !== "banned" && <MenuRow icon={<Ban className="h-4 w-4 text-danger" />} label="Ban" danger onClick={() => action(u.id, "banned")} />}
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function MenuRow({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-colors hover:bg-surface-hover", danger ? "text-danger" : "text-text-dim hover:text-text")}>
      {icon} {label}
    </button>
  );
}
