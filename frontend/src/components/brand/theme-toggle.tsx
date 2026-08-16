"use client";

/**
 * Theme toggle — sun/moon button for the nav bar. Cycles dark ⇄ light.
 * Renders a neutral placeholder until mounted to avoid hydration mismatch
 * (the server doesn't know the persisted theme).
 */

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative grid h-10 w-10 place-items-center rounded-xl border border-line-strong",
        "text-text-dim transition-colors hover:bg-surface-hover hover:text-text",
        className,
      )}
    >
      {/* Avoid mismatch: show nothing meaningful until mounted */}
      {mounted ? (
        isDark ? (
          <Moon className="h-[18px] w-[18px]" />
        ) : (
          <Sun className="h-[18px] w-[18px]" />
        )
      ) : (
        <span className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}
