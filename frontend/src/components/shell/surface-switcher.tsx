"use client";

/**
 * The grid button that reaches the other surfaces.
 *
 * Four products on four hostnames need one predictable way to move between
 * them. HackTheBox puts this in the same corner on every one of theirs, and the
 * reason it works is that it never changes position or contents — it is the one
 * control that means the same thing everywhere.
 *
 * Every entry opens in a new tab. Crossing to another surface is a context
 * switch, not a step in a flow: someone jumping from a CTF scoreboard to look
 * up a machine wants the scoreboard still there when they come back.
 */

import { useEffect, useRef, useState } from "react";
import { Bug, GraduationCap, LayoutDashboard, LayoutGrid, Swords } from "lucide-react";

import { surfaceLinks } from "@/lib/surfaces";
import { cn } from "@/lib/cn";

const SURFACES = [
  {
    href: surfaceLinks.dashboard(),
    label: "Dashboard",
    blurb: "Your progress and profile",
    icon: LayoutDashboard,
  },
  {
    href: surfaceLinks.app("/machines"),
    label: "Academy",
    blurb: "Machines, tracks and labs",
    icon: GraduationCap,
  },
  { href: surfaceLinks.ctf(), label: "CTF", blurb: "Events and competitions", icon: Swords },
  {
    href: surfaceLinks.bugbounty(),
    label: "Bug Bounty",
    blurb: "Programs and reports",
    icon: Bug,
  },
];

export function SurfaceSwitcher() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. Both, because a menu that only closes
  // one way is a menu people end up clicking twice.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch product"
        aria-expanded={open}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-lg transition-colors",
          open ? "bg-white/8 text-text" : "text-text-faint hover:bg-white/5 hover:text-text",
        )}
      >
        <LayoutGrid className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div
          role="menu"
          className="glass-strong absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] overflow-hidden rounded-xl border border-line shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]"
        >
          <p className="border-b border-line px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
            OFFCON products
          </p>
          {SURFACES.map((s) => {
            const Icon = s.icon;
            return (
              // Plain anchors: these cross an origin, so there is no
              // client-side navigation for next/link to preserve.
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/5"
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-white/5 text-text-dim">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[13.5px] font-semibold text-text">
                    {s.label}
                  </span>
                  <span className="block text-[12px] text-text-faint">{s.blurb}</span>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
