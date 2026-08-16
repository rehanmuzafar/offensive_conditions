"use client";

/**
 * AuthGuard — gates the app shell. While the initial silent-refresh is in
 * flight we show a splash; if the user ends up unauthenticated we redirect to
 * /login (preserving where they were headed).
 */

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

import { useAuthStore } from "@/stores/auth-store";
import { Logo } from "@/components/brand/logo";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const initializing = useAuthStore((s) => s.initializing);
  const isAuthed = useAuthStore((s) => s.isAuthenticated());

  useEffect(() => {
    if (!initializing && !isAuthed) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    }
  }, [initializing, isAuthed, pathname, router]);

  if (initializing) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4">
          <Logo size={42} showSub={false} href={null} />
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!isAuthed) return null; // redirecting

  return <>{children}</>;
}
