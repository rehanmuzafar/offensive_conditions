import Link from "next/link";
import { Users, Crown, Lock } from "lucide-react";

import { Card } from "@/components/ui/card";
import { DifficultyBadge, OsIcon } from "@/components/ui/identity";
import { Rating } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import type { Machine } from "@/types/content";

export function MachineCard({ machine }: { machine: Machine }) {
  return (
    <Link href={`/machines/${machine.slug}`} className="block">
      <Card interactive className="group h-full overflow-hidden">
        {/* header band with brand accent */}
        <div
          className="relative h-24 overflow-hidden"
          style={{ background: `linear-gradient(120deg, ${machine.thumbnailColor}, #2563EB)` }}
        >
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.18) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.18) 1px,transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="absolute right-3 top-3 flex gap-1.5">
            {machine.isFree ? (
              <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                Free
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                <Lock className="h-3 w-3" /> Pro
              </span>
            )}
            {!machine.isActive && (
              <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                Retired
              </span>
            )}
          </div>
          <div className="absolute bottom-3 left-4 flex items-center gap-2 text-white">
            <OsIcon os={machine.os} className="h-[18px] w-[18px]" />
            <span className="font-display text-[19px] font-bold drop-shadow">{machine.name}</span>
          </div>
        </div>

        {/* body */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <DifficultyBadge difficulty={machine.difficulty} />
            <span className="font-display text-[15px] font-bold text-accent">{machine.points} pts</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {machine.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-md bg-surface-hover px-2 py-0.5 text-[11.5px] font-medium text-text-dim">
                {t}
              </span>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <Rating value={machine.rating} count={machine.ratingCount} />
          </div>

          <div className="mt-2.5 flex items-center gap-4 text-[12.5px] text-text-faint">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> {formatNumber(machine.userOwns)} user
            </span>
            <span className="flex items-center gap-1.5">
              <Crown className="h-3.5 w-3.5" /> {formatNumber(machine.rootOwns)} root
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
