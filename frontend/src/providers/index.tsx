"use client";

/**
 * Single composition point for all client-side providers, mounted once in the
 * root layout. Order matters: theme outermost (paint), then data, then toasts.
 */

import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";
import { AuthBootstrap } from "./auth-bootstrap";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthBootstrap />
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            classNames: {
              toast:
                "!bg-surface !text-text !border !border-line !rounded-xl !shadow-card-lg",
              description: "!text-text-dim",
            },
          }}
        />
      </QueryProvider>
    </ThemeProvider>
  );
}
