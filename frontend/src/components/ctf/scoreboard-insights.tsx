"use client";

/**
 * The panel above the podium: a points-over-time chart and an event summary,
 * paged with ‹ ›.
 *
 * The chart is hand-drawn SVG rather than a charting library — it is one shape
 * (cumulative step lines) and pulling in a library for it would cost more than
 * it saves.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { insightsApi, type TeamSeries, type TrendingStats } from "@/lib/activity-api";
import { cn } from "@/lib/cn";

const LINE_COLORS = [
  "#8B5CF6", "#22D3EE", "#F59E0B", "#EC4899", "#34D399",
  "#60A5FA", "#F87171", "#A78BFA", "#FBBF24", "#4ADE80",
];

export function ScoreboardInsights({ eventId }: { eventId: string }) {
  const [panel, setPanel] = useState<0 | 1>(0);
  const { data: series } = useQuery({
    queryKey: ["ctf-series", eventId],
    queryFn: () => insightsApi.series(eventId, 10),
  });
  const { data: trending } = useQuery({
    queryKey: ["ctf-trending", eventId],
    queryFn: () => insightsApi.trending(eventId),
  });

  return (
    <section className="edge-iridescent glass p-5">
      <div className="flex items-center justify-between gap-4 border-b border-line pb-3">
        <h2 className="font-display text-[16px] font-bold text-text">
          {panel === 0 ? "Top 10 teams" : "Trending stats"}
        </h2>
        <div className="flex gap-1.5">
          <PageBtn onClick={() => setPanel(0)} active={panel === 0} label="Previous panel">
            <ChevronLeft className="h-4 w-4" />
          </PageBtn>
          <PageBtn onClick={() => setPanel(1)} active={panel === 1} label="Next panel">
            <ChevronRight className="h-4 w-4" />
          </PageBtn>
        </div>
      </div>

      {panel === 0 ? <PointsChart series={series ?? []} /> : <Trending stats={trending} />}
    </section>
  );
}

function PageBtn({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full border transition-colors",
        active
          ? "border-line-strong bg-surface-hover text-text"
          : "border-line text-text-faint hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function PointsChart({ series }: { series: TeamSeries[] }) {
  const [hover, setHover] = useState<{ x: number; name: string; points: number; at: string } | null>(
    null,
  );

  const model = useMemo(() => {
    const pts = series.flatMap((s) => s.points_over_time);
    if (pts.length === 0) return null;
    const times = pts.map((p) => new Date(p.at).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const values = pts.map((p) => p.points);
    const maxP = Math.max(...values, 1);
    /* The floor is zero unless a penalty has pushed a team below it. The scale
       used to divide by maxP alone, which put any negative running total below
       the axis and off the chart — impossible before organisers could deduct
       points, and reachable now. */
    const minP = Math.min(0, ...values);
    return { minT, maxT: maxT === minT ? minT + 1 : maxT, maxP, minP };
  }, [series]);

  if (!model) {
    return (
      <p className="py-16 text-center text-[13.5px] text-text-dim">
        The chart fills in once teams start solving.
      </p>
    );
  }

  const W = 1000;
  const H = 280;
  const PAD = { l: 46, r: 12, t: 12, b: 42 };
  const x = (t: number) =>
    PAD.l + ((t - model.minT) / (model.maxT - model.minT)) * (W - PAD.l - PAD.r);
  const span = model.maxP - model.minP || 1;
  const y = (p: number) => H - PAD.b - ((p - model.minP) / span) * (H - PAD.t - PAD.b);

  return (
    <div className="pt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Points over time">
        {/*
          The time axis. The chart had a points scale and no answer to "when",
          which on a scoreboard is half the question — a step upward means
          nothing without knowing whether it happened an hour in or five minutes
          ago. Five ticks across the event's actual span, labelled with the date
          when the window is longer than a day and the clock when it is not, so
          a two-hour CTF does not repeat the same date five times.
        */}
        {(() => {
          const spansDays = model.maxT - model.minT > 36 * 3600 * 1000;
          return [0, 0.25, 0.5, 0.75, 1].map((f) => {
            const t = model.minT + (model.maxT - model.minT) * f;
            const d = new Date(t);
            const label = spansDays
              ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            return (
              <g key={`t-${f}`}>
                <line
                  x1={x(t)}
                  x2={x(t)}
                  y1={PAD.t}
                  y2={H - PAD.b}
                  stroke="currentColor"
                  className="text-line"
                  strokeWidth={1}
                  opacity={f === 0 || f === 1 ? 0 : 0.5}
                />
                <text
                  x={x(t)}
                  y={H - PAD.b + 18}
                  textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
                  className="fill-current text-text-ghost"
                  style={{ fontSize: 11 }}
                >
                  {label}
                </text>
              </g>
            );
          });
        })()}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(model.minP + span * f)}
              y2={y(model.minP + span * f)}
              stroke="currentColor"
              className="text-line"
              strokeWidth={1}
            />
            <text
              x={PAD.l - 8}
              y={y(model.minP + span * f) + 4}
              textAnchor="end"
              className="fill-text-faint text-[11px]"
            >
              {Math.round(model.minP + span * f).toLocaleString()}
            </text>
          </g>
        ))}

        {series.map((s, i) => {
          // Points are cumulative and only change on a solve, so a step line is
          // the honest shape — a smooth curve would imply scoring in between.
          const d = s.points_over_time
            .map((p, j) => {
              const px = x(new Date(p.at).getTime());
              const py = y(p.points);
              const prev = s.points_over_time[j - 1];
              if (j === 0 || !prev) return `M ${px} ${py}`;
              return `L ${px} ${y(prev.points)} L ${px} ${py}`;
            })
            .join(" ");
          const color = LINE_COLORS[i % LINE_COLORS.length];
          return (
            <g key={s.team_id ?? s.name}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} opacity={hover && hover.name !== s.name ? 0.25 : 1} />
              {s.points_over_time.map((p) => (
                <circle
                  key={p.at}
                  cx={x(new Date(p.at).getTime())}
                  cy={y(p.points)}
                  r={4}
                  fill={color}
                  opacity={hover && hover.name !== s.name ? 0.25 : 1}
                  onMouseEnter={() =>
                    setHover({ x: x(new Date(p.at).getTime()), name: s.name, points: p.points, at: p.at })
                  }
                  onMouseLeave={() => setHover(null)}
                  className="cursor-pointer"
                />
              ))}
            </g>
          );
        })}

        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="currentColor"
            className="text-text-faint"
            strokeWidth={1}
          />
        )}
      </svg>

      {hover && (
        <div className="mt-1 rounded-lg border border-line bg-bg-elevated px-3 py-2 text-[12.5px]">
          <span className="font-semibold text-text">{hover.name}</span>{" "}
          <span className="text-text-dim">{hover.points.toLocaleString()} pts</span>{" "}
          <span className="text-text-faint">{new Date(hover.at).toLocaleString()}</span>
        </div>
      )}

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {series.map((s, i) => (
          <li key={s.team_id ?? s.name} className="flex items-center gap-1.5 text-[12.5px] text-text-dim">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: LINE_COLORS[i % LINE_COLORS.length] }}
            />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Trending({ stats }: { stats?: TrendingStats }) {
  if (!stats) return <p className="py-16 text-center text-[13.5px] text-text-dim">Loading…</p>;

  const maxTotal = Math.max(...stats.solves_by_difficulty.map((d) => d.total), 1);

  return (
    <div className="grid grid-cols-1 gap-6 pt-5 lg:grid-cols-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Tile label="Most valuable player" main={stats.mvp_name ?? "—"} sub={stats.mvp_team ?? ""} right={`${stats.mvp_points.toLocaleString()} points`} />
        <Tile label="Most popular scenario" main={stats.popular_challenge ?? "—"} sub={stats.popular_category ?? ""} right={`${stats.popular_solves} solves`} />
        <Tile label="Event overview" main={`${stats.total_teams}`} sub="teams" right={`${stats.total_players} players`} />
        <Tile label="Most valuable scenario" main={stats.valuable_challenge ?? "—"} sub={stats.valuable_category ?? ""} right={`${stats.valuable_points} points`} />
      </div>

      <div>
        <p className="mb-4 text-center text-[13.5px] text-text-dim">Scenarios solved per difficulty</p>
        <div className="flex h-[200px] items-end justify-around gap-3">
          {stats.solves_by_difficulty.map((d, i) => (
            <div key={d.difficulty} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="relative w-full max-w-[52px] rounded-t bg-bg-elevated"
                style={{ height: `${(d.total / maxTotal) * 160}px` }}
              >
                <span
                  className="absolute bottom-0 left-0 right-0 rounded-t"
                  style={{
                    height: `${d.total ? (d.solved / d.total) * 100 : 0}%`,
                    background: LINE_COLORS[i % LINE_COLORS.length],
                  }}
                />
              </div>
              <span className="text-center text-[11.5px] capitalize text-text-faint">
                {d.difficulty}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  main,
  sub,
  right,
}: {
  label: string;
  main: string;
  sub: string;
  right: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg-elevated/50 p-4">
      <p className="text-[12px] text-text-dim">{label}</p>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="truncate font-display text-[15px] font-bold text-text" title={main}>
          {main}
        </p>
      </div>
      <p className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-text-faint">
        <span className="capitalize">{sub}</span>
        <span>{right}</span>
      </p>
    </div>
  );
}
