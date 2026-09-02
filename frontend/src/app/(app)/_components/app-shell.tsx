"use client";

/**
 * The shell for every signed-in page outside the bug bounty surface.
 *
 * One layout, three shapes, chosen from the path — because the route groups do
 * not line up with the hostnames. `/dashboard`, `/machines` and `/ctf` all live
 * under this group but belong to three different products, and the middleware
 * has already decided which host serves which.
 *
 * What each shape is for:
 *
 *   dashboard  A landing page. Three cards do the navigating, so a sidebar
 *              beside them would be a second copy of the same choice.
 *   academy    Machines, tracks, writeups and the forum — a catalogue you
 *              browse, which is what earns a persistent section list.
 *   ctf        Events and teams. A short top nav; the arena has its own chrome
 *              once you are inside an event.
 *
 * The old global sidebar is gone. It listed all twelve destinations on every
 * page of every surface — the shape of a product with one home, and there are
 * four now.
 */

import { AppAmbient } from "./app-ambient";
import { AuthGuard } from "./auth-guard";
import { AcademySidebar } from "@/components/shell/academy-sidebar";
import { SurfaceTopbar, type TopbarLink } from "@/components/shell/surface-topbar";
import { UserControls } from "@/components/shell/user-controls";
import { cn } from "@/lib/cn";

const CTF_LINKS: TopbarLink[] = [
  { href: "/ctf", label: "Events", exact: true },
  { href: "/teams", label: "Teams" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export type Shape = "dashboard" | "academy" | "ctf";

const DASHBOARD_LINKS: TopbarLink[] = [
  { href: "/dashboard", label: "Home", exact: true },
  { href: "/settings", label: "Settings" },
];

export function AppShell({
  shape,
  children,
}: {
  shape: Shape;
  children: React.ReactNode;
}) {
  const config = {
    dashboard: { label: undefined, home: "/dashboard", links: DASHBOARD_LINKS },
    academy: { label: "ACADEMY", home: "/machines", links: [] as TopbarLink[] },
    ctf: { label: "CTF", home: "/ctf", links: CTF_LINKS },
  }[shape];

  return (
    <AuthGuard>
      <div className="app-aurora min-h-screen">
        {/* One canvas for every page under this shell; see AppAmbient. */}
        <AppAmbient shape={shape} />

        <SurfaceTopbar
          label={config.label}
          home={config.home}
          links={config.links}
          right={<UserControls />}
        />

        {shape === "academy" && <AcademySidebar />}

        <main
          className={cn(
            "mx-auto w-full px-4 py-6 lg:px-6",
            // The dashboard is a landing page and reads better centred; the
            // catalogue surfaces want the width for their grids and tables.
            shape === "dashboard" ? "max-w-[1100px]" : "max-w-[1600px]",
            shape === "academy" && "lg:pl-[248px]",
          )}
        >
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
