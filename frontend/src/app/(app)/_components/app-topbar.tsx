"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { GlobalSearch } from "@/components/search/global-search";
import { Bell, Menu, LogOut, User, Settings, ChevronDown } from "lucide-react";

import { ThemeToggle } from "@/components/brand/theme-toggle";
import { Avatar, TierBadge } from "@/components/ui/identity";
import { useAuthStore } from "@/stores/auth-store";
import { useLogout } from "@/hooks/use-auth";
import { formatNumber } from "@/lib/format";

export function AppTopbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Fallbacks so the shell renders even before profile loads.
  const username = user?.username ?? "operator";
  const tier = user?.tier ?? "hacker";
  const points = user?.points ?? 0;

  return (
    // A floating panel like the sidebar, not a rule across the top — the
    // aurora needs to show above and beside it.
    <header className="glass sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-line px-4 lg:px-6">
      <button
        onClick={onOpenSidebar}
        className="grid h-9 w-9 place-items-center border border-line-strong text-text lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />

        <Link
          href="/notifications"
          className="relative grid h-9 w-9 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" />
        </Link>

        {/* user menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 border border-line py-1 pl-1 pr-2 transition-colors hover:border-line-strong"
          >
            <Avatar username={username} src={user?.avatarUrl} size="sm" />
            <span className="hidden text-left sm:block">
              <span className="block text-[12px] leading-tight">{username}</span>
              <span className="block text-[10px] leading-tight text-text-ghost">{formatNumber(points)} pts</span>
            </span>
            <ChevronDown className="h-4 w-4 text-text-faint" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] w-60 overflow-hidden border border-line-strong bg-bg-elevated">
              <div className="border-b border-line p-4">
                <div className="flex items-center gap-3">
                  <Avatar username={username} src={user?.avatarUrl} size="md" />
                  <div className="min-w-0">
                    <div className="truncate font-display text-[14px] font-bold tracking-mega">{username}</div>
                    <TierBadge tier={tier} className="mt-0.5" />
                  </div>
                </div>
              </div>
              <div className="p-1.5">
                <MenuLink href={`/u/${username}`} icon={<User className="h-[17px] w-[17px]" />} label="My profile" onClick={() => setMenuOpen(false)} />
                <MenuLink href="/settings" icon={<Settings className="h-[17px] w-[17px]" />} label="Settings" onClick={() => setMenuOpen(false)} />
              </div>
              <div className="border-t border-line p-1.5">
                <button
                  onClick={() => logout.mutate()}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[12.5px] text-danger transition-colors hover:bg-danger/10"
                >
                  <LogOut className="h-[17px] w-[17px]" /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuLink({ href, icon, label, onClick }: { href: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
    >
      {icon} {label}
    </Link>
  );
}
