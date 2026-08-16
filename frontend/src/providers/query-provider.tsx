"use client";

/**
 * React Query provider — the data-fetching + cache layer for every API call.
 * Sensible defaults: 30s stale time, 1 retry, no refetch-on-focus spam.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ApiError } from "@/lib/api";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry auth/permission/not-found — only transient ones.
              if (error instanceof ApiError) {
                if ([400, 401, 403, 404, 409, 422].includes(error.status)) return false;
              }
              return failureCount < 1;
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
