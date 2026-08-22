"use client";

/**
 * The Academy section list.
 *
 * Only this surface gets a persistent sidebar, and only because it is the one
 * that is genuinely a catalogue: machines, tracks, writeups and the forum are
 * places you move between while browsing, so keeping them on screen saves a
 * trip to a menu every time.
 *
 * The dashboard does not get one — three cards already do that job — and the
 * CTF surface does not, because once you are inside an event the arena owns the
 * whole window.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  MessagesSquare,
  Route,
  Server,
  Trophy,
} from "lucide-react";

import { cn } from "@/lib/cn";

const SECTIONS = [
  { href: "/machines", label: "Machines", icon: Server },
  { href: "/tracks", label: "Tracks", icon: Route },
  { href: "/writeups", label: "Writeups", icon: BookOpen },
  { href: "/forum", label: "Forum", icon: MessagesSquare },
  { href: "/leaderboard", label: "Rankings", icon: Trophy },
];

export function AcademySidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 top-14 z-30 hidden w-[248px] border-r border-line bg-bg/60 backdrop-blur-sm lg:block">
      <nav className="flex flex-col gap-0.5 p-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <Link
              key={s.href}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                active
                  ? "bg-accent/12 font-semibold text-accent"
                  : "text-text-dim hover:bg-white/5 hover:text-text",
              )}
            >
              <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
              {s.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
