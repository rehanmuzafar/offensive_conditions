"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";

import { ADMIN_NAV } from "@/config/nav";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const initializing = useAuthStore((s) => s.initializing);
  const isStaff = useAuthStore((s) => s.hasRole("admin", "moderator", "ctf_organizer", "triager"));

  useEffect(() => {
    if (!initializing && !isStaff) router.replace("/dashboard");
  }, [initializing, isStaff, router]);

  if (initializing) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-danger/12 text-danger">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h2 className="font-display text-[20px] font-bold">Staff access only</h2>
        <p className="mt-1 text-[14px] text-text-dim">You don&apos;t have permission to view the admin panel.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient text-[14px] font-bold text-white shadow-glow">A</span>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Admin</h1>
        <span className="bg-danger/12 px-2.5 py-0.5 text-[11.5px] font-semibold text-danger">Staff</span>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        {/* sub-nav */}
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon!;
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition-colors",
                  active ? "bg-brand-gradient-soft text-accent" : "text-text-dim hover:bg-surface-hover hover:text-text",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
