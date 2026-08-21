"use client";

import { Copy, Download, ShieldCheck, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LabLauncher } from "@/components/machines/lab-launcher";
import type { MachineDetail } from "@/types/content";

/**
 * How a player gets at a machine.
 *
 * Three kinds, and only one of them is something the platform starts:
 *
 *   spawn        the orchestrator provisions a box per player — the launcher.
 *   static_host  one always-on host everyone attacks. Nothing to start, so a
 *                Spawn button here would be a control with nothing behind it.
 *   download     a boot2root image the player runs on their own hardware. The
 *                platform hosts the file and the checksum; the machine itself
 *                never exists on our side.
 *
 * The whole reason this exists is that the detail page used to assume the first
 * kind for every machine, which is fine until you have more boxes than VPSes.
 */
export function MachineAccess({ machine }: { machine: MachineDetail }) {
  if (machine.delivery === "static_host") {
    return <StaticHost host={machine.staticHost} />;
  }
  if (machine.delivery === "download") {
    return <Boot2Root machine={machine} />;
  }
  return <LabLauncher machineId={machine.id} machineSlug={machine.slug} />;
}

function StaticHost({ host }: { host: string | null }) {
  if (!host) return null;
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2.5">
          <Terminal className="h-4 w-4 text-accent" />
          <h3 className="font-display text-[15px] font-bold">Always on</h3>
        </div>
        <p className="mt-1.5 text-[13px] text-text-dim">
          This box runs continuously — there is nothing to spawn. Connect over
          the VPN and start.
        </p>
        <div className="mt-4 flex items-center gap-2 border border-line bg-surface px-3 py-2.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[13.5px] text-accent">{host}</code>
          <button
            aria-label="Copy address"
            onClick={() => {
              void navigator.clipboard.writeText(host);
              toast.success("Address copied.");
            }}
            className="shrink-0 p-1 text-text-faint transition-colors hover:text-text"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardBody>
    </Card>
  );
}

function Boot2Root({ machine }: { machine: MachineDetail }) {
  const size = machine.downloadSizeBytes;
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2.5">
          <Download className="h-4 w-4 text-accent" />
          <h3 className="font-display text-[15px] font-bold">Boot2root image</h3>
        </div>
        <p className="mt-1.5 text-[13px] text-text-dim">
          Run this one yourself. Download the image, boot it in your own
          hypervisor, and work it from there.
        </p>

        <a href={machine.downloadUrl ?? "#"} className="mt-4 block" download>
          <Button fullWidth size="lg">
            <Download className="h-4 w-4" />
            Download{machine.downloadFormat ? ` ${machine.downloadFormat.toUpperCase()}` : ""}
            {size ? ` · ${(size / 1024 ** 3).toFixed(1)} GB` : ""}
          </Button>
        </a>

        {machine.downloadSha256 && (
          <div className="mt-4">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
              <ShieldCheck className="h-3.5 w-3.5" /> SHA-256
            </p>
            {/* Published so the file can be verified before it is booted — this
                is an image people run with elevated privileges on their own
                hardware. */}
            <code className="mt-1 block break-all font-mono text-[11.5px] leading-relaxed text-text-dim">
              {machine.downloadSha256}
            </code>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
