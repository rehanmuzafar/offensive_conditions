"use client";

/**
 * The bug bounty shell — its own, not the application one.
 *
 * This surface has a different shape from the rest of the platform: a narrow
 * icon rail, a contextual sidebar that changes per section, and content that
 * runs to the full remaining width because scope tables and report threads need
 * it. Sharing `(app)`'s single 248px sidebar would mean either cramming a
 * program's seven sub-pages into the global nav, or having no room for them.
 *
 * The sidebar's contents are decided here, from the path, so no page has to
 * render its own navigation.
 *
 * No ambient scene on this surface — no skull, no pointer wake. That is a
 * deliberate difference from the CTF and application shells, where both stay:
 * this is where someone reads a scope table, writes up a vulnerability, or
 * works a triage queue, and a background that turns and ripples under the
 * cursor competes with all three. The rest of the theme is unchanged —
 * iridescent edges, hovers, the aurora ground and every transition.
 */

import { usePathname } from "next/navigation";

import { AuthGuard } from "@/app/(app)/_components/auth-guard";
import { SurfaceTopbar } from "@/components/shell/surface-topbar";
import { UserControls } from "@/components/shell/user-controls";
import { BountyRail } from "@/components/bounty/shell/rail";
import { BountySidebar, type SidebarGroup } from "@/components/bounty/shell/sidebar";
import { cn } from "@/lib/cn";

export default function BountyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const groups = sidebarFor(pathname);
  const hasSidebar = groups.length > 0;

  return (
    <AuthGuard>
      <div className="app-aurora min-h-screen">
        <BountyRail />
        {hasSidebar && <BountySidebar groups={groups} />}

        <SurfaceTopbar label="BUG BOUNTY" home="/bounty" right={<UserControls />} />

        <div className={cn("pl-[68px]", hasSidebar && "lg:pl-[316px]")}>
          <main className="mx-auto w-full max-w-[1500px] px-4 py-6 lg:px-7">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}

/**
 * Which sidebar the current path gets.
 *
 * A program page is the interesting case: its sub-pages are nested under the
 * program's own slug, so the links have to be built from the path rather than
 * being a static list.
 */
function sidebarFor(pathname: string): SidebarGroup[] {
  // A single program — /bounty/<slug> and everything under it.
  const program = matchProgram(pathname);
  if (program) {
    return [
      {
        title: "Security page",
        links: [
          { href: `/bounty/${program}`, label: "Program guidelines", exact: true },
          { href: `/bounty/${program}/scope`, label: "Scope and Rewards" },
          { href: `/bounty/${program}/hacktivity`, label: "Hacktivity" },
          { href: `/bounty/${program}/thanks`, label: "Thanks" },
          { href: `/bounty/${program}/updates`, label: "Updates" },
          { href: `/bounty/${program}/collaborators`, label: "Collaborators" },
          { href: `/bounty/${program}/safe-harbor`, label: "Safe harbor" },
        ],
      },
    ];
  }

  if (pathname === "/bounty" || pathname.startsWith("/bounty?")) {
    return [
      {
        links: [
          { href: "/bounty", label: "All programs", exact: true },
          { href: "/bounty/reports", label: "My reports" },
        ],
      },
    ];
  }

  if (pathname.startsWith("/bounty/hacktivity")) {
    return [
      {
        links: [
          { href: "/bounty/hacktivity", label: "Overview", exact: true },
          { href: "/bounty/hacktivity/cwe", label: "Weakness discovery" },
        ],
      },
    ];
  }

  if (pathname.startsWith("/bounty/dashboard")) {
    return [
      {
        links: [
          { href: "/bounty/dashboard", label: "Overview", exact: true },
        ],
      },
    ];
  }

  // Reports and the leaderboard have their own in-page tab bars, so a sidebar
  // would just be a second navigation for the same thing.
  return [];
}

/**
 * The program slug, if this path is a program page.
 *
 * Everything directly under /bounty that is not one of the section roots is a
 * program — the same shape the URLs already had.
 */
const SECTIONS = new Set([
  "dashboard",
  "reports",
  "hacktivity",
  "leaderboard",
  "programs",
  "my-programs",
  "bookmarks",
  "invitations",
  "company",
]);

function matchProgram(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "bounty" || parts.length < 2) return null;
  const slug = parts[1]!;
  return SECTIONS.has(slug) ? null : slug;
}
