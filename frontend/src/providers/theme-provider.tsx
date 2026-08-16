"use client";

/**
 * Theme provider. Wraps next-themes which:
 *   - writes data-theme="dark|light" on <html> BEFORE first paint (no flash)
 *   - persists the choice to localStorage
 *   - can follow the OS preference when set to "system"
 *
 * Default is dark (the brand's native mood); users can flip to light.
 */

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange={false}
      themes={["dark", "light"]}
      storageKey="offcon-theme"
    >
      {children}
    </NextThemeProvider>
  );
}
