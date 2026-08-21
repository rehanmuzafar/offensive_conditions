"use client";

import { useMemo } from "react";
import { Play, Square, RotateCcw, Clock, Copy, Loader2, Wifi, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import {
  useInstances,
  useSpawnInstance,
  useStopInstance,
  useExtendInstance,
  useResetInstance,
} from "@/hooks/use-content";
import { formatRelative } from "@/lib/format";
import type { Instance, InstanceState } from "@/types/content";

const STATE_LABEL: Record<InstanceState, string> = {
  queued: "Queued",
  provisioning: "Provisioning",
  running: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
  expired: "Expired",
};

export function LabLauncher({
  machineId,
  machineSlug,
}: {
  /** Matches running instances, which the orchestrator keys by machine id. */
  machineId: string;
  /** Spawns: `POST /instances` looks the machine up by slug. */
  machineSlug: string;
}) {
  const { data: instances } = useInstances();
  const spawn = useSpawnInstance();
  const stop = useStopInstance();
  const extend = useExtendInstance();
  const reset = useResetInstance();

  const instance = useMemo<Instance | undefined>(
    () => instances?.find((i) => i.machineId === machineId && i.state !== "stopped" && i.state !== "expired"),
    [instances, machineId],
  );

  const isBusy = instance?.state === "provisioning" || instance?.state === "queued" || instance?.state === "stopping";

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-[17px] font-bold">Lab instance</h3>
          {instance && <StatePill state={instance.state} />}
        </div>

        {/* No instance → spawn */}
        {!instance && (
          <div className="text-center">
            <p className="mb-4 text-[14px] text-text-dim">
              Spawn a dedicated, sandboxed instance of this machine to attack.
            </p>
            <Button fullWidth size="lg" loading={spawn.isPending} onClick={() => spawn.mutate(machineSlug)}>
              <Play className="h-[18px] w-[18px]" /> Spawn machine
            </Button>
          </div>
        )}

        {/* Provisioning */}
        {instance && isBusy && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-[14px] text-text-dim">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              {instance.state === "provisioning" ? "Building your sandbox…" : STATE_LABEL[instance.state] + "…"}
            </div>
            <ProgressBar value={instance.provisionProgress || 15} />
            <p className="mt-3 text-[12.5px] text-text-faint">This usually takes under a minute.</p>
          </div>
        )}

        {/* Running */}
        {instance && instance.state === "running" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-bg-elevated p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[12.5px] font-medium text-text-faint">
                  <Wifi className="h-4 w-4 text-success" /> Target IP
                </span>
                {instance.expiresAt && (
                  <span className="flex items-center gap-1.5 text-[12.5px] text-text-faint">
                    <Clock className="h-3.5 w-3.5" /> expires {formatRelative(instance.expiresAt)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <code className="font-mono text-[18px] font-bold text-text">{instance.ipAddress ?? "10.10.14.7"}</code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(instance.ipAddress ?? "10.10.14.7");
                    toast.success("IP copied");
                  }}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-line-strong text-text-dim hover:text-text"
                  aria-label="Copy IP"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button variant="ghost" size="sm" loading={extend.isPending} onClick={() => extend.mutate(instance.id)}>
                <Clock className="h-4 w-4" /> Extend
              </Button>
              <Button variant="ghost" size="sm" loading={reset.isPending} onClick={() => reset.mutate(instance.id)}>
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
              <Button variant="danger" size="sm" loading={stop.isPending} onClick={() => stop.mutate(instance.id)}>
                <Square className="h-4 w-4" /> Stop
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {instance && instance.state === "error" && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-danger" />
            <p className="mt-2 text-[14px] text-text-dim">Something went wrong spawning this machine.</p>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => spawn.mutate(machineSlug)}>
              Try again
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function StatePill({ state }: { state: InstanceState }) {
  const map: Record<InstanceState, string> = {
    running: "text-success bg-success/12",
    provisioning: "text-info bg-info/12",
    queued: "text-info bg-info/12",
    stopping: "text-warning bg-warning/12",
    stopped: "text-text-faint bg-surface-hover",
    expired: "text-text-faint bg-surface-hover",
    error: "text-danger bg-danger/12", }; return ( <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold ${map[state]}`}> <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATE_LABEL[state]}
    </span>
  );
}
