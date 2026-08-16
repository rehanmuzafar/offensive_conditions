"use client";

import { useState } from "react";
import { Wifi, Download, Copy, Globe } from "lucide-react";
import { toast } from "sonner";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useVpnConfig } from "@/hooks/use-account";
import { cn } from "@/lib/cn";

const REGIONS = [
  { value: "eu-west", label: "EU West", city: "Frankfurt" },
  { value: "us-east", label: "US East", city: "Virginia" },
  { value: "us-west", label: "US West", city: "Oregon" },
  { value: "ap-south", label: "Asia Pacific", city: "Singapore" },
];

export default function VpnSettingsPage() {
  const [region, setRegion] = useState("eu-west");
  const { data: vpn, isLoading } = useVpnConfig(region);

  function download() {
    if (!vpn) return;
    const blob = new Blob([vpn.config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = vpn.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Config downloaded");
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[20px] font-bold">VPN access</h2>
        <p className="mt-1 text-[14px] text-text-dim">Connect to the lab network over WireGuard to reach machines.</p>
      </div>

      {/* region picker */}
      <Card>
        <CardBody>
          <h3 className="mb-3 flex items-center gap-2 font-display text-[16px] font-bold">
            <Globe className="h-5 w-5 text-accent" /> Server region
          </h3>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {REGIONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setRegion(r.value)}
                className={cn("rounded-xl border p-3 text-left transition-colors", region === r.value ? "border-accent bg-brand-gradient-soft" : "border-line-strong hover:bg-surface-hover")}
              >
                <div className="text-[14px] font-semibold">{r.label}</div>
                <div className="text-[12px] text-text-faint">{r.city}</div>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* config */}
      <Card>
        <CardBody>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-[16px] font-bold">
              <Wifi className="h-5 w-5 text-accent" /> WireGuard config
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => { if (vpn) { navigator.clipboard?.writeText(vpn.config); toast.success("Copied"); } }}
                className="grid h-9 w-9 place-items-center rounded-lg border border-line-strong text-text-dim hover:text-text"
                aria-label="Copy config"
              >
                <Copy className="h-4 w-4" />
              </button>
              <Button size="sm" onClick={download}><Download className="h-4 w-4" /> Download</Button>
            </div>
          </div>

          {isLoading || !vpn ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : (
            <pre className="overflow-x-auto rounded-xl border border-line bg-bg-elevated p-4 font-mono text-[12.5px] leading-relaxed text-text-dim">{vpn.config}</pre>
          )}

          <div className="mt-4 rounded-xl bg-surface-hover p-4">
            <h4 className="text-[13.5px] font-semibold">How to connect</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-text-dim">
              <li>Install the WireGuard client for your OS.</li>
              <li>Download the config above and import it as a tunnel.</li>
              <li>Activate the tunnel, then spawn a machine to get its IP.</li>
            </ol>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
