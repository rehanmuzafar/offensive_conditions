"use client";

/**
 * Live marketing-home sections — real counts + real Hall of Fame from the API,
 * replacing the old hardcoded arrays. Public endpoints, so requests are anonymous.
 */

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { scoringApi } from "@/lib/scoring-api";
import { Stat } from "@/components/ui/stat";
import { Card } from "@/components/ui/card";
import { Flag } from "@/components/ui/flag";
import { initials } from "@/lib/format";
import { formatNumber } from "@/lib/format";
import { countryName } from "@/lib/countries";

async function fetchTotal(path: string): Promise<number> {
  try {
    const r = await api.get<{ meta?: { total?: number } }>(path, {
      params: { limit: 1 },
      anonymous: true,
    });
    return r.meta?.total ?? 0;
  } catch {
    return 0;
  }
}

export function HomeStats() {
  const { data } = useQuery({
    queryKey: ["home-stats"],
    queryFn: async () => {
      const [machines, challenges, paths, board] = await Promise.all([
        fetchTotal("/v1/machines"),
        fetchTotal("/v1/challenges"),
        fetchTotal("/v1/paths"),
        scoringApi.leaderboard({ limit: 200 }).catch(() => ({ items: [] as { country: string | null }[] })),
      ]);
      const countries = new Set(board.items.map((r) => r.country).filter(Boolean)).size;
      return { machines, challenges, paths, operators: board.items.length, countries };
    },
    staleTime: 60_000,
  });

  const stats = [
    { value: data ? formatNumber(data.machines + data.challenges) : "—", label: "Machines & challenges" },
    { value: data ? formatNumber(data.operators) : "—", label: "Active operators" },
    { value: data ? formatNumber(data.paths) : "—", label: "Learning paths" },
    { value: data ? formatNumber(data.countries) : "—", label: "Countries" },
  ];

  return (
    <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
      {stats.map((s) => (
        <Stat key={s.label} value={s.value} label={s.label} />
      ))}
    </div>
  );
}

export function HomeHallOfFame() {
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", { scope: "global", home: true }],
    queryFn: () => scoringApi.leaderboard({ scope: "global", limit: 8 }),
    staleTime: 60_000,
  });

  const rows = data?.items ?? [];

  if (!isLoading && rows.length === 0) {
    return (
      <Card className="p-10 text-center text-text-dim">
        No ranked operators yet — be the first to root a box and claim the top spot.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-2">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-5 py-4 text-[12px] font-bold uppercase tracking-[1.5px] text-text-faint">Rank</th>
            <th className="px-5 py-4 text-[12px] font-bold uppercase tracking-[1.5px] text-text-faint">Hacker</th>
            <th className="hidden px-5 py-4 text-[12px] font-bold uppercase tracking-[1.5px] text-text-faint sm:table-cell">Country</th>
            <th className="px-5 py-4 text-right text-[12px] font-bold uppercase tracking-[1.5px] text-text-faint">Points</th>
          </tr>
        </thead>
        <tbody>
          {(isLoading ? Array.from({ length: 8 }) : rows).map((row, i) => {
            const r = row as (typeof rows)[number] | undefined;
            const rank = r?.rank ?? i + 1;
            const top = rank <= 3;
            const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
            const avGrad =
              rank % 3 === 1
                ? "bg-brand-gradient"
                : rank % 3 === 2
                  ? "bg-gradient-to-br from-brand-blue-light to-brand-blue-dark"
                  : "bg-gradient-to-br from-violet-400 to-violet-700";
            return (
              <tr key={r?.userId ?? i} className="border-b border-line transition-colors last:border-0 hover:bg-surface-hover">
                <td className="px-5 py-[15px]">
                  <span className={`font-display font-extrabold ${top ? "text-[19px] text-gradient" : "text-[17px] text-text-faint"}`}>
                    {medal && <span className="mr-1.5">{medal}</span>}
                    {rank}
                  </span>
                </td>
                <td className="px-5 py-[15px]">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-[38px] w-[38px] shrink-0 place-items-center font-display text-[14px] font-bold text-white ${avGrad}`}>
                      {r ? initials(r.username) : "—"}
                    </span>
                    <div>
                      <div className="font-display font-semibold">{r?.username ?? "…"}</div>
                      <div className="text-[12px] text-text-faint">{r?.tier?.replace(/_/g, " ") ?? ""}</div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-5 py-[15px] sm:table-cell">
                  <span className="flex items-center gap-2.5 text-[14px] text-text-dim">
                    {r?.country && <Flag code={r.country} />} {r?.country ? countryName(r.country) ?? r.country : ""}
                  </span>
                </td>
                <td className="px-5 py-[15px] text-right font-display text-[15.5px] font-bold">
                  <span className={top ? "text-accent" : ""}>{r ? formatNumber(r.points) : ""}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
