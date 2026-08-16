"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Users, Crown, Calendar, Download, Wifi } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DifficultyBadge, OsIcon, Avatar } from "@/components/ui/identity";
import { Rating } from "@/components/ui/progress";
import { LabLauncher } from "@/components/machines/lab-launcher";
import { FlagSubmit } from "@/components/machines/flag-submit";
import { useMachine } from "@/hooks/use-content";
import { formatNumber, formatDate } from "@/lib/format";

export default function MachineDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: machine, isLoading } = useMachine(slug);

  if (isLoading || !machine) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 w-full rounded-2xl lg:col-span-2" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/machines" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> All machines
      </Link>

      {/* hero */}
      <Card className="overflow-hidden">
        <div
          className="relative h-36"
          style={{ background: `linear-gradient(120deg, ${machine.thumbnailColor}, #2563EB)` }}
        >
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.2) 1px,transparent 1px)",
              backgroundSize: "26px 26px",
            }}
          />
        </div>
        <CardBody className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <OsIcon os={machine.os} className="h-6 w-6 text-text-dim" />
                <h1 className="font-display text-[30px] font-extrabold tracking-[-0.5px]">{machine.name}</h1>
                {!machine.isActive && (
                  <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-[12px] font-semibold text-text-faint">
                    Retired
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <DifficultyBadge difficulty={machine.difficulty} />
                <Rating value={machine.rating} count={machine.ratingCount} />
                <span className="font-display text-[15px] font-bold text-accent">{machine.points} pts</span>
              </div>
            </div>

            {/* makers */}
            <div className="text-right">
              <div className="mb-1.5 text-[12px] text-text-faint">Created by</div>
              <div className="flex items-center justify-end gap-2">
                {machine.makers.map((m) => (
                  <div key={m.username} className="flex items-center gap-1.5">
                    <Avatar username={m.username} src={m.avatarUrl} size="sm" />
                    <span className="text-[13.5px] font-medium">{m.username}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* meta strip */}
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px] text-text-dim">
            <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-text-faint" /> {formatNumber(machine.userOwns)} user owns</span>
            <span className="flex items-center gap-1.5"><Crown className="h-4 w-4 text-text-faint" /> {formatNumber(machine.rootOwns)} root owns</span>
            <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4 text-text-faint" /> Released {formatDate(machine.releasedAt)}</span>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* left column */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <h3 className="mb-3 font-display text-[17px] font-bold">About this machine</h3>
              <p className="text-[15px] leading-relaxed text-text-dim">{machine.description}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {machine.tags.map((t) => (
                  <span key={t} className="rounded-md bg-surface-hover px-2.5 py-1 text-[12.5px] font-medium text-text-dim">
                    {t}
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>

          <FlagSubmit machine={machine} />

          {/* VPN reminder */}
          <Card variant="glass">
            <CardBody className="flex items-center gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient-soft text-accent">
                <Wifi className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-display text-[15px] font-semibold">Connect to the VPN</div>
                <div className="text-[13px] text-text-dim">Download your WireGuard config to reach the lab network.</div>
              </div>
              <Link href="/settings/vpn">
                <Button variant="ghost" size="sm">
                  <Download className="h-4 w-4" /> Get config
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>

        {/* right column: launcher */}
        <div className="space-y-6">
          <LabLauncher machineId={machine.id} />
        </div>
      </div>
    </div>
  );
}
