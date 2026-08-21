"use client";

/**
 * The contextual sidebar beside the rail.
 *
 * Its contents come from whichever section the rail has selected, and it
 * collapses — a program's scope table and a report thread both want the width
 * back, and on those pages the sidebar is a bookmark rather than a map.
 *
 * Collapsed state is per-browser, not per-session: someone who works collapsed
 * wants it collapsed tomorrow too.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { cn } from "@/lib/cn";

export interface SidebarLink {
  href: string;
  label: string;
  exact?: boolean;
}

export interface SidebarGroup {
  /** Rendered as a small caret heading, like "Security page". */
  title?: string;
  links: SidebarLink[];
}

const STORAGE_KEY = "offcon.bounty.sidebar";

export function BountySidebar({ groups }: { groups: SidebarGroup[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Read after mount: localStorage does not exist during the server render, and
  // seeding state from it directly would hydrate mismatched.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      window.localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  if (groups.length === 0) return null;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-[68px] z-30 hidden border-r border-line bg-bg/60 backdrop-blur-sm transition-[width] duration-200 lg:block",
        collapsed ? "w-[52px]" : "w-[248px]",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex justify-end px-2 pt-3">
          <button
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-1.5 text-text-faint transition-colors hover:bg-white/5 hover:text-text"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        {!collapsed && (
          <nav className="flex-1 overflow-y-auto px-3 pb-6">
            {groups.map((group, i) => (
              <div key={group.title ?? i} className={cn(i > 0 && "mt-5")}>
                {group.title && (
                  <p className="mb-1.5 px-2.5 text-[12.5px] font-semibold text-text">
                    {group.title}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {group.links.map((l) => {
                    const active = l.exact
                      ? pathname === l.href
                      : pathname === l.href || pathname.startsWith(`${l.href}/`);
                    return (
                      <li key={l.href}>
                        <Link
                          href={l.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "block rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                            active
                              ? "bg-accent/12 font-semibold text-accent"
                              : "text-text-dim hover:bg-white/5 hover:text-text",
                          )}
                        >
                          {l.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}

/** Left offset the content needs to clear the rail and an expanded sidebar. */
export const CONTENT_OFFSET = "lg:pl-[316px] pl-[68px]";
