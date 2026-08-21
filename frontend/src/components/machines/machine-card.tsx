import Link from "next/link";
import { Users, Crown, Lock } from "lucide-react";

import { Tilt } from "@/components/ui/motion";
import { Card } from "@/components/ui/card";
import { DifficultyBadge, OsIcon } from "@/components/ui/identity";
import { Rating } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import type { Machine } from "@/types/content";

/**
 * A target, as a spec sheet entry.
 *
 * The old card led with a coloured header band — a per-machine gradient built
 * from `thumbnailColor`. That was the single largest source of arbitrary colour
 * in the product: every card picked its own hue, so a grid of twelve machines
 * was twelve unrelated gradients competing with the content underneath.
 *
 * The band is now a ruled plate. `thumbnailColor` still identifies the machine,
 * but as a single hairline stripe down the left edge rather than as a fill —
 * enough to tell two cards apart at a glance, not enough to be the loudest
 * thing on the page.
 */
export function MachineCard({ machine }: { machine: Machine }) {
  /* The same pointer-tracked tilt the dashboard tiles use, so a grid of cards
     answers the mouse the way the rest of the product does. */
  return (
    <Tilt className="h-full">
      <Link href={`/machines/${machine.slug}`} className="block">
        <Card interactive className="group relative h-full overflow-hidden">
          {/* Identity stripe — the only place the per-machine colour survives. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-px opacity-70"
            style={{ background: machine.thumbnailColor }}
          />

          <div className="bg-grid relative border-b border-line px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-2.5">
                <OsIcon os={machine.os} className="h-4 w-4 text-text-faint" />
                <span className="font-display text-[19px] font-bold tracking-mega">
                  {machine.name}
                </span>
              </span>

              <span className="flex shrink-0 gap-1.5">
                {machine.isFree ? (
                  <span className="border border-line px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-text-faint">
                    Free
                  </span>
                ) : (
                  <span className="flex items-center gap-1 border border-line px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-text-faint">
                    <Lock className="h-2.5 w-2.5" /> Pro
                  </span>
                )}
                {!machine.isActive && (
                  <span className="border border-line px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-text-ghost">
                    Retired
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* body */}
          <div className="p-4">
            <div className="flex items-center justify-between">
              <DifficultyBadge difficulty={machine.difficulty} />
              <span className="font-display text-[15px] font-bold tabular-nums">
                {machine.points}
                <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-text-faint">
                  pts
                </span>
              </span>
            </div>

            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {machine.tags.slice(0, 3).map((t) => (
                <span key={t} className="border border-line px-2 py-0.5 text-[10px] text-text-faint">
                  {t}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <Rating value={machine.rating} count={machine.ratingCount} />
            </div>

            <div className="mt-2.5 flex items-center gap-4 text-[11px] tabular-nums text-text-faint">
              <span className="flex items-center gap-1.5">
                <Users className="h-3 w-3" /> {formatNumber(machine.userOwns)} user
              </span>
              <span className="flex items-center gap-1.5">
                <Crown className="h-3 w-3" /> {formatNumber(machine.rootOwns)} root
              </span>
            </div>
          </div>
        </Card>
      </Link>
    </Tilt>
  );
}
