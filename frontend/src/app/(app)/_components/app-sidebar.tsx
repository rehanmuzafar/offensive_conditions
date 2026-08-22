"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { APP_NAV } from "@/config/nav";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isAdmin = useAuthStore((s) => s.hasRole("admin", "moderator", "ctf_organizer", "triager"));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[68px] items-center border-b border-line px-5">
        {/* No sub-label here: "OFFENSE CONDITIONS" at its display tracking
            does not fit a 248px rail and wrapped onto two lines. */}
        <Logo size={28} showSub={false} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {APP_NAV.map((item) => {
          const Icon = item.icon!;
          // Nav hrefs are absolute once the surfaces are split across hosts, so
          // comparing them to a pathname would never match and nothing would
          // ever look selected. Compare on the path portion instead.
          const target = item.href.startsWith("http")
            ? new URL(item.href).pathname
            : item.href;
          const active =
            target !== "/" && (pathname === target || pathname.startsWith(target + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-2 text-[12.5px] transition-colors",
                /* Active state is a full-contrast label and a rule in the
                   gutter — not a tinted pill. On a ruled ground a filled block
                   behind one item is the loudest thing on the screen. */
                active ? "text-text" : "text-text-faint hover:bg-surface-hover hover:text-text-dim",
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-text" />}
              <Icon className="h-4 w-4" strokeWidth={1.6} />
              {item.label}
              {item.badge && (
                <span className="ml-auto border border-line px-1.5 text-[9.5px] tabular-nums text-text-faint">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            href="/admin"
            onClick={onNavigate}
            className="mt-3 flex items-center gap-3 border border-line px-3 py-2 text-[12.5px] text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <span className="grid h-4 w-4 place-items-center border border-line-strong text-[9px]">A</span>
            Admin panel
          </Link>
        )}
      </nav>

      <div className="border-t border-line p-3">
        <Link
          href="/pricing"
          onClick={onNavigate}
          className="bracket-frame block p-4 transition-colors hover:bg-surface-hover"
        >
          <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-wide text-text-faint">
            <span className="iridescent-rule h-px w-6 opacity-70" />
            Upgrade
          </div>
          <div className="mt-2 font-display text-[15px] font-bold tracking-mega text-text">Go Pro</div>
          <div className="mt-1 text-[11px] leading-[1.6] text-text-faint">
            Unlock all active machines &amp; unlimited labs.
          </div>
        </Link>
      </div>
    </div>
  );
}
