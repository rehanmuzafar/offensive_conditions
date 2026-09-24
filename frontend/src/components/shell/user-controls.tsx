"use client";

/**
 * Theme, notifications and the account menu.
 *
 * Pulled out of the old topbar so all four surfaces show the same account
 * controls without each one rebuilding them. These are the parts that follow
 * the *person* rather than the product, which is why they are identical
 * everywhere while the navigation beside them is not.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, LogOut, Settings, User } from "lucide-react";

import { Avatar } from "@/components/ui/identity";
import { ThemeToggle } from "@/components/brand/theme-toggle";
import { useAuthStore } from "@/stores/auth-store";
import { useLogout } from "@/hooks/use-auth";
import { cn } from "@/lib/cn";

export function UserControls() {
  const user = useAuthStore((s) => s.user);
  const username = user?.username ?? "operator";
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const logout = useLogout();

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
    <>
      <ThemeToggle />

      <Link
        href="/notifications"
        aria-label="Notifications"
        className="grid h-9 w-9 place-items-center rounded-lg text-text-faint transition-colors hover:bg-white/5 hover:text-text"
      >
        <Bell className="h-[18px] w-[18px]" />
      </Link>

      <div ref={box} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 transition-colors",
            open ? "bg-white/8" : "hover:bg-white/5",
          )}
        >
          <Avatar username={username} src={user?.avatarUrl} size="sm" />
          <ChevronDown className="h-4 w-4 text-text-faint" />
        </button>

        {open && (
          <div className="glass-strong absolute right-0 top-[calc(100%+8px)] z-50 w-[220px] overflow-hidden rounded-xl border border-line shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]">
            <div className="border-b border-line px-4 py-3">
              <p className="truncate font-display text-[13.5px] font-semibold text-text">
                {username}
              </p>
              {user?.email && (
                <p className="truncate text-[12px] text-text-faint">{user.email}</p>
              )}
            </div>
            <MenuLink href={`/u/${username}`} icon={<User className="h-4 w-4" />} label="Profile" onClick={() => setOpen(false)} />
            <MenuLink href="/settings" icon={<Settings className="h-4 w-4" />} label="Settings" onClick={() => setOpen(false)} />
            <button
              onClick={() => {
                setOpen(false);
                logout.mutate();
              }}
              className="flex w-full items-center gap-2.5 border-t border-line px-4 py-2.5 text-left text-[13.5px] text-danger transition-colors hover:bg-danger/8"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2.5 text-[13.5px] text-text-dim transition-colors hover:bg-white/5 hover:text-text"
    >
      {icon}
      {label}
    </Link>
  );
}
