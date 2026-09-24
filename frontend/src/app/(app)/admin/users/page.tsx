"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { Avatar } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { useAdminUsers, useDeleteUser } from "@/hooks/use-admin";

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  /* Server-side: user-svc exposes no roster, only a search that needs two
     characters. Filtering a list we cannot fetch was the old shape of this. */
  const { data, isLoading, isError } = useAdminUsers(q.trim());
  const deleteUser = useDeleteUser();
  const users = data?.items ?? [];
  const ready = q.trim().length >= 2;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-[20px] font-bold">User management</h2>
        <p className="mt-1 text-[13px] text-text-dim">
          Look up any account. Suspending, banning and role changes are still not
          wired up — user-svc has no status/role endpoint yet. Deletion schedules
          the same 30-day GDPR erasure a user gets requesting their own account be
          deleted; there is no immediate purge, admin or not.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username or email…" className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
      </div>

      {!ready ? (
        <Card>
          <p className="px-5 py-14 text-center text-[13px] text-text-dim">
            Type at least two characters to find a user.
          </p>
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : isError ? (
        <Card>
          <p className="px-5 py-14 text-center text-[13px] text-danger">
            User search is unavailable right now.
          </p>
        </Card>
      ) : users.length === 0 ? (
        <Card>
          <p className="px-5 py-14 text-center text-[13px] text-text-dim">
            Nobody matches “{q.trim()}”.
          </p>
        </Card>
      ) : (
        <Card className="overflow-visible p-0">
          <div className="grid grid-cols-[1fr_120px_90px] gap-3 border-b border-line px-5 py-3 text-[12px] font-bold uppercase tracking-[1px] text-text-faint">
            <span>User</span>
            <span>Country</span>
            <span></span>
          </div>
          {users.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-[1fr_120px_90px] items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-surface-hover"
            >
              <Link href={`/u/${u.username}`} className="flex items-center gap-3">
                <Avatar username={u.username} size="sm" />
                <span className="truncate font-display text-[14px] font-semibold text-text">
                  {u.username}
                </span>
              </Link>
              <span className="flex items-center gap-1.5 text-[12.5px] text-text-dim">
                {u.country ? (
                  <>
                    <Flag code={u.country} /> {u.country}
                  </>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </span>
              {/* Two-step, and the confirm label says what actually happens --
                  a schedule, not an instant purge -- so it cannot be misread
                  as more destructive (or less) than it is. */}
              <Button
                variant="danger"
                size="sm"
                loading={deleteUser.isPending && confirming === u.id}
                onClick={() => {
                  if (confirming !== u.id) {
                    setConfirming(u.id);
                    return;
                  }
                  deleteUser.mutate(u.id, { onSuccess: () => setConfirming(null) });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirming === u.id ? "Confirm" : "Delete"}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
