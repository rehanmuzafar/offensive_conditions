"use client";

/**
 * Marketing top navigation — sticky, glass, with the brand logo, primary nav
 * links, theme toggle, and auth CTAs. Mobile collapses to a slide-down menu.
 */

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/brand/theme-toggle";
import { Button } from "@/components/ui/button";
import { MARKETING_NAV } from "@/config/nav";
import { cn } from "@/lib/cn";

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-6">
        <Logo size={34} />

        {/* desktop links */}
        <div className="hidden items-center gap-9 lg:flex">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group relative text-[14.5px] font-medium text-text-dim transition-colors hover:text-text"
            >
              {item.label}
              <span className="absolute -bottom-1.5 left-0 h-0.5 w-0 rounded bg-brand-gradient transition-all duration-200 group-hover:w-full" />
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/register" className="hidden sm:block">
            <Button variant="primary" size="sm">
              Start free
            </Button>
          </Link>
          <button
            type="button"
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-line-strong text-text lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* mobile drawer */}
      <div
        className={cn(
          "overflow-hidden border-t border-line transition-[max-height] duration-300 lg:hidden",
          open ? "max-h-96" : "max-h-0",
        )}
      >
        <div className="flex flex-col gap-1 px-6 py-4">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-text-dim hover:bg-surface-hover hover:text-text"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-3 flex gap-3 border-t border-line pt-4">
            <Link href="/login" className="flex-1">
              <Button variant="ghost" fullWidth>
                Sign in
              </Button>
            </Link>
            <Link href="/register" className="flex-1">
              <Button variant="primary" fullWidth>
                Start free
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
