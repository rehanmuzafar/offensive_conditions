"use client";

import { useState } from "react";

import { AppSidebar } from "./_components/app-sidebar";
import { AppTopbar } from "./_components/app-topbar";
import { AuthGuard } from "./_components/auth-guard";
import { cn } from "@/lib/cn";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="min-h-screen">
        {/* desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] border-r border-line bg-bg-elevated lg:block">
          <AppSidebar />
        </aside>

        {/* mobile sidebar drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-bg-elevated animate-fade-in">
              <AppSidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        {/* main column */}
        <div className={cn("lg:pl-[260px]")}>
          <AppTopbar onOpenSidebar={() => setMobileOpen(true)} />
          <main className="mx-auto max-w-[1200px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
