"use client";

import { Tilt, Reveal, CountUp } from "@/components/ui/motion";
import Link from "next/link";
import {
  Server,
  Flag,
  Flame,
  Trophy,
  ArrowRight,
  Crosshair,
  BookCheck,
  TrendingUp,
  Award,
} from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { TierBadge } from "@/components/ui/identity";
import { Skeleton } from "@/components/ui/card";
import { useDashboard } from "@/hooks/use-content";
import { useAuthStore } from "@/stores/auth-store";
import { SurfaceLauncher } from "@/components/dashboard/surface-launcher";
import { surfaceLinks } from "@/lib/surfaces";
import { formatNumber, formatRelative } from "@/lib/format";
import type { ActivityItem } from "@/types/content";

export default function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const authUser = useAuthStore((s) => s.user);
  const name = authUser?.username ?? data?.user.username ?? "operator";

  return (
    <>
      <div className="space-y-6">
      {/* greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">
            Welcome back, {name} 👋
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">Here&apos;s where you stand today.</p>
        </div>
        <a href={surfaceLinks.app("/machines")}>
          <Button>
            <Crosshair className="h-[18px] w-[18px]" /> Find a target
          </Button>
        </a>
      </div>

      <SurfaceLauncher />

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard index={0} loading={isLoading} icon={<Server className="h-5 w-5" />} label="Machines owned" value={data ? formatNumber(data.stats.machinesOwned) : "—"} />
        <StatCard index={1} loading={isLoading} icon={<Flag className="h-5 w-5" />} label="Challenges solved" value={data ? formatNumber(data.stats.challengesSolved) : "—"} />
        <StatCard index={2} loading={isLoading} icon={<Flame className="h-5 w-5" />} label="Day streak" value={data ? `${data.stats.currentStreakDays}` : "—"} />
        <StatCard index={3} loading={isLoading} icon={<Trophy className="h-5 w-5" />} label="Global rank" value={data ? `#${formatNumber(data.stats.globalRank)}` : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* left: rank + track */}
        <div className="space-y-6 lg:col-span-2">
          {/* rank progress */}
          <Card>
            <CardBody>
              {isLoading || !data ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-[18px] font-bold">Your rank</span>
                      <TierBadge tier={data.user.tier} />
                    </div>
                    <span className="font-display text-[22px] font-extrabold text-gradient">
                      {formatNumber(data.user.points)} pts
                    </span>
                  </div>
                  {data.user.nextTier && (
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between text-[13px] text-text-dim">
                        <span>Progress to next tier</span>
                        <span>
                          <b className="text-text">{formatNumber(data.user.nextTier.pointsNeeded)}</b> pts to go
                        </span>
                      </div>
                      <ProgressBar
                        value={data.user.points}
                        max={data.user.points + data.user.nextTier.pointsNeeded}
                      />
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {/* active track */}
          {data?.activeTrack && (
            <Card interactive spotlight>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient-soft text-accent">
                      <BookCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-display text-[16px] font-semibold">{data.activeTrack.name}</div>
                      <div className="text-[13px] text-text-faint">
                        {data.activeTrack.completed} of {data.activeTrack.total} modules complete
                      </div>
                    </div>
                  </div>
                  <Link href={`/tracks/${data.activeTrack.slug}`}>
                    <Button variant="ghost" size="sm">
                      Resume <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
                <ProgressBar
                  className="mt-4"
                  value={data.activeTrack.completed}
                  max={data.activeTrack.total}
                />
              </CardBody>
            </Card>
          )}

          {/* recent activity */}
          <Card>
            <CardBody>
              <h2 className="mb-4 font-display text-[18px] font-bold">Recent activity</h2>
              {isLoading || !data ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <ul className="space-y-1">
                  {data.recentActivity.map((a) => (
                    <ActivityRow key={a.id} item={a} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* right: quick links */}
        <div className="space-y-6">
          <Card>
            <CardBody>
              <h2 className="mb-4 font-display text-[18px] font-bold">Jump back in</h2>
              <div className="space-y-2.5">
                <QuickLink href="/machines" icon={<Server className="h-[18px] w-[18px]" />} title="Browse machines" subtitle="540+ boxes to root" />
                <QuickLink href="/ctf" icon={<Flag className="h-[18px] w-[18px]" />} title="CTF arena" subtitle="Live events now" />
                <QuickLink href="/leaderboard" icon={<Trophy className="h-[18px] w-[18px]" />} title="Leaderboard" subtitle="See where you rank" />
              </div>
            </CardBody>
          </Card>

          <Card variant="glass">
            <CardBody>
              <div className="flex items-center gap-2 text-accent">
                <TrendingUp className="h-5 w-5" />
                <span className="font-display text-[15px] font-semibold">On a roll</span>
              </div>
              <p className="mt-2 text-[14px] text-text-dim">
                You&apos;ve owned {data ? data.stats.machinesOwned : "—"} machines. Root 3 more this week to
                reach your next tier faster.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
      </div>
    </>
  );
}

/**
 * A figure worth counting to.
 *
 * `value` arrives as a preformatted string ("#0", "1,204", "—"), so the counter
 * only runs when the string is a plain number — anything with a rank prefix, a
 * placeholder or a suffix is rendered as-is rather than animated into something
 * misleading.
 */
function StatCard({
  icon,
  label,
  value,
  loading,
  index = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading?: boolean;
  index?: number;
}) {
  const numeric = Number(value.replace(/,/g, ""));
  const countable = value !== "" && !Number.isNaN(numeric);

  return (
    <Reveal delay={index * 70}>
      <Tilt>
        <Card spotlight className="edge-iridescent h-full">
          <CardBody className="p-5">
            <div className="grid h-9 w-9 place-items-center border border-line text-text-faint">{icon}</div>
            {loading ? (
              <Skeleton className="mt-4 h-8 w-16" />
            ) : (
              <div className="mt-4 font-display text-[30px] font-extrabold leading-none tracking-mega">
                {countable ? <CountUp value={numeric} /> : value}
              </div>
            )}
            <div className="mt-2 text-[10.5px] uppercase tracking-wide text-text-faint">{label}</div>
          </CardBody>
        </Card>
      </Tilt>
    </Reveal>
  );
}

const ACTIVITY_ICON: Record<ActivityItem["type"], React.ReactNode> = {
  user_own: <Flag className="h-[18px] w-[18px]" />,
  root_own: <Server className="h-[18px] w-[18px]" />,
  challenge_solve: <Crosshair className="h-[18px] w-[18px]" />,
  rank_up: <TrendingUp className="h-[18px] w-[18px]" />,
  badge: <Award className="h-[18px] w-[18px]" />,
  ctf: <Flag className="h-[18px] w-[18px]" />,
};

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <li className="group relative flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-surface-hover">
      {/* A rule that draws in from the left on hover — the row equivalent of the
          iridescent edge, which would be too much repeated down a list. */}
      <span className="iridescent-rule absolute bottom-0 left-0 h-px w-0 transition-[width] duration-500 group-hover:w-full" />
      <span className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors group-hover:text-text">
        {ACTIVITY_ICON[item.type]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{item.title}</div>
        <div className="truncate text-[11px] text-text-ghost">{item.subtitle}</div>
      </div>
      <div className="text-right">
        {item.points != null && (
          <div className="font-display text-[14px] font-bold tabular-nums text-accent">+{item.points}</div>
        )}
        <div className="text-[11.5px] text-text-faint">{formatRelative(item.at)}</div>
      </div>
    </li>
  );
}

function QuickLink({ href, icon, title, subtitle }: { href: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link
      href={href}
      className="edge-iridescent group flex items-center gap-3 border border-line p-3 transition-colors hover:bg-surface-hover"
    >
      <span className="grid h-9 w-9 place-items-center border border-line text-text-faint transition-colors group-hover:text-text">
        {icon}
      </span>
      <div className="flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="text-[12px] text-text-faint">{subtitle}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-text-faint" />
    </Link>
  );
}
