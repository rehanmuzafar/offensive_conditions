"use client";

import { useState } from "react";
import { Flag, CheckCircle2, Crown } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSubmitFlag } from "@/hooks/use-content";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { MachineDetail } from "@/types/content";

export function FlagSubmit({ machine }: { machine: MachineDetail }) {
  const submit = useSubmitFlag(machine.id);
  const [userFlag, setUserFlag] = useState("");
  const [rootFlag, setRootFlag] = useState("");

  const p = machine.progress;

  return (
    <Card>
      <CardBody>
        <h3 className="mb-4 font-display text-[17px] font-bold">Submit flags</h3>

        <div className="space-y-3">
          {/* user flag */}
          <FlagRow
            kind="user"
            owned={p.userFlagged}
            ownedAt={p.userFlaggedAt}
            icon={<Flag className="h-[18px] w-[18px]" />}
            label="User flag"
            points={Math.round(machine.points / 3)}
            value={userFlag}
            onChange={setUserFlag}
            onSubmit={() => submit.mutate({ flag: userFlag, kind: "user" })}
            loading={submit.isPending && submit.variables?.kind === "user"}
          />

          {/* root flag */}
          <FlagRow
            kind="root"
            owned={p.rootFlagged}
            ownedAt={p.rootFlaggedAt}
            icon={<Crown className="h-[18px] w-[18px]" />}
            label="Root flag"
            points={machine.points}
            value={rootFlag}
            onChange={setRootFlag}
            onSubmit={() => submit.mutate({ flag: rootFlag, kind: "root" })}
            loading={submit.isPending && submit.variables?.kind === "root"}
          />
        </div>

        <p className="mt-4 text-[12px] text-text-faint">
          Flags look like <code className="rounded bg-surface-hover px-1.5 py-0.5">OFFCON&#123;...&#125;</code>. Each
          flag can only be claimed once.
        </p>
      </CardBody>
    </Card>
  );
}

function FlagRow({
  owned,
  ownedAt,
  icon,
  label,
  points,
  value,
  onChange,
  onSubmit,
  loading,
}: {
  kind: "user" | "root";
  owned: boolean;
  ownedAt: string | null;
  icon: React.ReactNode;
  label: string;
  points: number;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  if (owned) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3.5">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-text">{label} captured</div>
          {ownedAt && <div className="text-[12px] text-text-faint">{formatRelative(ownedAt)}</div>}
        </div>
        <span className="font-display text-[14px] font-bold text-success">+{points}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold text-text">
          <span className="text-text-faint">{icon}</span> {label}
        </span>
        <span className="text-[12.5px] font-medium text-accent">+{points} pts</span>
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="OFFCON{...}"
          className={cn(
            "h-10 flex-1 rounded-lg border border-line-strong bg-bg-elevated px-3 font-mono text-[13.5px] text-text",
            "placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSubmit();
          }}
        />
        <Button size="sm" loading={loading} disabled={!value.trim()} onClick={onSubmit} className="px-4">
          Submit
        </Button>
      </div>
    </div>
  );
}
