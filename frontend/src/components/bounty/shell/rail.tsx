"use client";

/**
 * The icon rail — the bug bounty surface's primary navigation.
 *
 * Two levels, not one: a narrow rail of sections on the far left, and a wider
 * contextual sidebar next to it that changes with the section. It is the shape
 * HackerOne uses and the reason is structural rather than stylistic — a program
 * page has seven sub-pages of its own (guidelines, scope, hacktivity, thanks,
 * updates, collaborators, safe harbor), and a single flat sidebar would have to
 * hold both those and the top-level sections at the same time.
 *
 * Icon-only, with the label on hover. Six destinations is few enough to learn
 * by position, and the rail's whole job is to give the content the width.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bug,
  ClipboardCheck,
  LayoutGrid,
  LineChart,
  Target,
} from "lucide-react";

import { cn } from "@/lib/cn";

export interface RailItem {
  href: string;
  label: string;
  icon: typeof Target;
  /** Longest-prefix match wins, so /bounty does not light up on /bounty/reports. */
  exact?: boolean;
}

export const RAIL_ITEMS: RailItem[] = [
  { href: "/bounty", label: "Opportunities", icon: Target, exact: true },
  { href: "/bounty/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/bounty/reports", label: "Reports", icon: Bug },
  { href: "/bounty/hacktivity", label: "Hacktivity", icon: LineChart },
  { href: "/bounty/leaderboard", label: "Leaderboard", icon: BarChart3 },
  { href: "/bounty/programs", label: "Programs", icon: ClipboardCheck },
];

export function isActive(pathname: string, item: RailItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function BountyRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Bug bounty sections"
      // Starts below the topbar, which now carries the mark. The rail used to
      // hold a sparkles glyph up here — HackerOne's AI badge, which is theirs
      // and means nothing on this platform.
      className="fixed inset-y-0 left-0 top-14 z-30 flex w-[68px] flex-col items-center gap-1 border-r border-line bg-bg-elevated py-3"
    >
      {RAIL_ITEMS.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative grid h-10 w-10 place-items-center rounded-xl transition-colors",
              active
                ? "bg-accent/14 text-accent"
                : "text-text-faint hover:bg-white/5 hover:text-text",
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
            {/* Tooltip rather than a permanent label: the rail is 68px and a
                label at that width would truncate to noise. */}
            <span
              role="tooltip"
              className="pointer-events-none absolute left-[calc(100%+8px)] z-50 whitespace-nowrap rounded-lg border border-line bg-bg-elevated px-2.5 py-1 text-[12px] font-medium text-text opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
