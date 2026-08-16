"use client";

import { Users, Server, Activity, FileWarning, DollarSign, Boxes } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { MetricTile, Sparkline } from "@/components/admin/admin-bits";
import { Flag } from "@/components/ui/flag";
import { useAdminOverview } from "@/hooks/use-admin";
import { formatNumber, formatCompact, formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function AdminOverviewPage() {
  const { data, isLoading } = useAdminOverview();

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const m = data.metrics;

  return (
    <div className="space-y-6">
      {/* metric grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile label="Total users" value={formatNumber(m.totalUsers)} sub={`${formatCompact(m.activeUsers30d)} active (30d)`} icon={<Users className="h-4 w-4" />} spark={data.trends.signups7d} />
        <MetricTile label="Machines" value={`${m.activeMachines}`} sub={`${m.totalMachines} total in catalog`} icon={<Server className="h-4 w-4" />} />
        <MetricTile label="Running instances" value={formatNumber(m.runningInstances)} sub="live sandboxes" icon={<Boxes className="h-4 w-4" />} />
        <MetricTile label="Flags / day" value={formatCompact(data.trends.flagsSubmitted7d[data.trends.flagsSubmitted7d.length - 1] ?? 0)} icon={<Activity className="h-4 w-4" />} spark={data.trends.flagsSubmitted7d} />
        <MetricTile label="Open reports" value={`${m.openReports}`} sub="awaiting triage" icon={<FileWarning className="h-4 w-4" />} />
        <MetricTile label="Pending payouts" value={formatMoney(m.pendingPayoutsCents)} icon={<DollarSign className="h-4 w-4" />} />
        <MetricTile label="MRR" value={formatMoney(m.mrrCents)} sub="monthly recurring" icon={<DollarSign className="h-4 w-4" />} />
        <MetricTile label="Active (30d)" value={formatCompact(m.activeUsers30d)} sub={`of ${formatCompact(m.totalUsers)}`} icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* signups trend */}
        <Card className="lg:col-span-2">
          <CardBody>
            <h3 className="mb-1 font-display text-[16px] font-bold">Signups (last 7 days)</h3>
            <p className="text-[13px] text-text-faint">New registrations per day</p>
            <div className="mt-4">
              <Sparkline data={data.trends.signups7d} className="h-24" />
            </div>
            <div className="mt-2 flex justify-between text-[11.5px] text-text-faint">
              {data.trends.signups7d.map((v, i) => (
                <span key={i}>{formatCompact(v)}</span>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* system health */}
        <Card>
          <CardBody>
            <h3 className="mb-3 font-display text-[16px] font-bold">System health</h3>
            <div className="space-y-2">
              {data.systemHealth.map((s) => (
                <div key={s.service} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", s.status === "healthy" ? "bg-success" : s.status === "degraded" ? "bg-warning animate-pulse" : "bg-danger")} />
                    <span className="font-mono text-[12.5px]">{s.service}</span>
                  </div>
                  <span className={cn("text-[12px] font-medium", s.latencyMs > 100 ? "text-warning" : "text-text-faint")}>{s.latencyMs}ms</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* recent signups */}
      <Card>
        <CardBody>
          <h3 className="mb-3 font-display text-[16px] font-bold">Recent signups</h3>
          <div className="space-y-1">
            {data.recentSignups.map((u) => (
              <div key={u.username} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-surface-hover">
                <div className="flex items-center gap-2.5">
                  {u.country && <Flag code={u.country} />}
                  <span className="font-display text-[14px] font-semibold">{u.username}</span>
                </div>
                <span className="text-[12px] text-text-faint">{formatRelative(u.at)}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
