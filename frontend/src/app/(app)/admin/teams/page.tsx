"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";

import { Card, Skeleton } from "@/components/ui/card";
import { Avatar } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { teamsApi } from "@/lib/teams-api";

/**
 * Team monitoring.
 *
 * Read-only, and deliberately so: user-svc owns teams and exposes no
 * moderation endpoint, so anything beyond looking would be a button that
 * cannot work. The roster it does serve — name, category, country, size,
 * whether it is recruiting — is enough to answer the question an organiser
 * actually has, which is who is out there and how big they are.
 */
export default function AdminTeamsPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-teams", q.trim()],
    queryFn: () => teamsApi.browse({ q: q.trim() }),
    staleTime: 30_000,
  });

  const teams = data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-[20px] font-bold">Team monitoring</h2>
        <p className="mt-1 text-[13px] text-text-dim">
          Every public team on the platform. Private teams are excluded by
          user-svc and are not visible here.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search teams…"
          className="h-10 w-full border border-line bg-transparent pl-10 pr-4 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : isError ? (
        <Card>
          <p className="px-5 py-14 text-center text-[13px] text-danger">
            Team directory is unavailable right now.
          </p>
        </Card>
      ) : teams.length === 0 ? (
        <Card>
          <p className="px-5 py-14 text-center text-[13px] text-text-dim">
            {q.trim() ? `No team matches “${q.trim()}”.` : "No public teams yet."}
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="grid grid-cols-[1fr_100px_90px] gap-3 border-b border-line px-5 py-3 text-[12px] font-bold uppercase tracking-[1px] text-text-faint sm:grid-cols-[1fr_150px_110px_100px]">
            <span>Team</span>
            <span className="hidden sm:block">Category</span>
            <span>Country</span>
            <span className="text-right">Members</span>
          </div>
          {teams.map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[1fr_100px_90px] items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-surface-hover sm:grid-cols-[1fr_150px_110px_100px]"
            >
              <Link href={`/teams/${t.slug || t.id}`} className="flex min-w-0 items-center gap-3">
                <Avatar username={t.name} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-display text-[14px] font-semibold text-text">
                    {t.name}
                  </span>
                  {t.is_recruiting && (
                    <span className="text-[11px] uppercase tracking-wide text-success">recruiting</span>
                  )}
                </span>
              </Link>
              <span className="hidden truncate text-[12.5px] capitalize text-text-dim sm:block">
                {t.category?.replace("_", " ") || "—"}
              </span>
              <span className="flex items-center gap-1.5 text-[12.5px] text-text-dim">
                {t.country_code ? (
                  <>
                    <Flag code={t.country_code} /> {t.country_code}
                  </>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </span>
              <span className="flex items-center justify-end gap-1.5 text-[13px] tabular-nums text-text-dim">
                <Users className="h-3.5 w-3.5 text-text-faint" />
                {t.member_count}
                {t.max_members ? `/${t.max_members}` : ""}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
