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
      <div className="flex h-[68px] items-center px-5">
        <Logo size={30} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {APP_NAV.map((item) => {
          const Icon = item.icon!;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium transition-colors",
                active
                  ? "bg-brand-gradient-soft text-accent"
                  : "text-text-dim hover:bg-surface-hover hover:text-text",
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-gradient" />}
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
              {item.badge && (
                <span className="ml-auto rounded-full bg-brand-gradient px-1.5 py-0.5 text-[10px] font-bold text-white">
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
            className="mt-2 flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-[14.5px] font-medium text-text-dim transition-colors hover:bg-surface-hover hover:text-text"
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded bg-brand-gradient text-[10px] font-bold text-white">A</span>
            Admin panel
          </Link>
        )}
      </nav>

      <div className="border-t border-line p-3">
        <Link
          href="/pricing"
          onClick={onNavigate}
          className="block rounded-xl bg-brand-gradient-soft p-4 transition-opacity hover:opacity-90"
        >
          <div className="font-display text-[14px] font-semibold text-accent">Go Pro</div>
          <div className="mt-0.5 text-[12.5px] text-text-dim">Unlock all active machines &amp; unlimited labs.</div>
        </Link>
      </div>
    </div>
  );
}
