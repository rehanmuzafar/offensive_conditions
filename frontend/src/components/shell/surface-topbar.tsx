"use client";

/**
 * The bar every surface wears.
 *
 * Replaces the single global sidebar. That sidebar listed all twelve
 * destinations on every page of every surface, which is the shape of a product
 * with one home — and there are four now. On the CTF arena it spent 248px
 * advertising Machines and Writeups, neither of which lives there.
 *
 * So navigation is per surface: the mark says which one you are on, a few links
 * cover that surface, and the switcher on the right reaches the others. Nothing
 * here enumerates another surface's pages.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { OffconMark } from "@/components/brand/offcon-mark";
import { SurfaceSwitcher } from "@/components/shell/surface-switcher";
import { cn } from "@/lib/cn";

export interface TopbarLink {
  href: string;
  label: string;
  exact?: boolean;
}

export function SurfaceTopbar({
  label,
  home,
  links = [],
  right,
}: {
  /** Surface name beside the wordmark — "LABS", "CTF", "BUG BOUNTY". */
  label?: string;
  /** Where the mark points. */
  home: string;
  links?: TopbarLink[];
  /** Surface-specific controls, left of the switcher. */
  right?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg-elevated/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-6 px-4 lg:px-6">
        <Link href={home} className="shrink-0 transition-opacity hover:opacity-80">
          <OffconMark label={label} />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
          {links.map((l) => {
            const active = l.exact
              ? pathname === l.href
              : pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors",
                  active
                    ? "bg-white/6 text-text"
                    : "text-text-dim hover:bg-white/4 hover:text-text",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {right}
          <SurfaceSwitcher />
        </div>
      </div>
    </header>
  );
}
