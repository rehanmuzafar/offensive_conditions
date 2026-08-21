"use client";

import { useState } from "react";

import { AppAmbient } from "./_components/app-ambient";
import { AppSidebar } from "./_components/app-sidebar";
import { AppTopbar } from "./_components/app-topbar";
import { AuthGuard } from "./_components/auth-guard";
import { cn } from "@/lib/cn";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="app-aurora min-h-screen">
        {/* One canvas for every page under this shell; see AppAmbient. */}
        <AppAmbient />

        {/* desktop sidebar */}
        <aside className="glass fixed inset-y-4 left-4 z-40 hidden w-[248px] overflow-y-auto lg:block">
          <AppSidebar />
        </aside>

        {/* mobile sidebar drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <aside className="glass absolute inset-y-3 left-3 w-[280px] animate-fade-in overflow-y-auto">
              <AppSidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        {/* main column */}
        <div className={cn("lg:pl-[280px]")}>
          <AppTopbar onOpenSidebar={() => setMobileOpen(true)} />
          <main className="mx-auto max-w-[1280px] px-4 py-6 lg:px-6 lg:py-7">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
