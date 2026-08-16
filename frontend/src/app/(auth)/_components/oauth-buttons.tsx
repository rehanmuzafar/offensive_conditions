"use client";

/**
 * OAuth buttons — GitHub / Google / Discord sign-in. Clicking starts the OAuth
 * flow (redirects to the provider via the gateway).
 */

import type { JSX } from "react";
import { useOAuthStart, useAuthProviders } from "@/hooks/use-auth";
import type { OAuthProvider } from "@/types/auth";
import { cn } from "@/lib/cn";

const PROVIDERS: { id: OAuthProvider; label: string; icon: JSX.Element }[] = [
  {
    id: "github",
    label: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
        <path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.6.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.3-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 3.9-1.3 6.8-5.1 6.8-9.6C22 6.6 17.5 2 12 2z" />
      </svg>
    ),
  },
  {
    id: "google",
    label: "Google",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]">
        <path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6z" />
        <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z" />
        <path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9z" />
        <path fill="#EA4335" d="M12 6.4c1.5 0 2.9.5 3.9 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7c.8-2.5 3.1-3.4 5.8-3.4z" />
      </svg>
    ),
  },
  {
    id: "discord",
    label: "Discord",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="#5865F2">
        <path d="M20 4.4A19 19 0 0 0 15.3 3l-.2.5c1.6.4 2.9 1 4.2 1.9-2.4-1.3-5.1-1.9-7.3-1.9s-4.9.6-7.3 1.9c1.3-.8 2.6-1.5 4.2-1.9L8.7 3A19 19 0 0 0 4 4.4C1.5 8.1.8 11.8 1.1 15.4a19 19 0 0 0 5.8 2.9l.5-1.1c-.6-.2-1.2-.5-1.8-.9l.4-.3c3.4 1.6 7.1 1.6 10.5 0l.4.3c-.6.4-1.2.7-1.8.9l.5 1.1c2-.6 4-1.6 5.8-2.9.4-4.2-.7-7.9-2.6-11zM8.6 13.2c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8c0 1-.7 1.8-1.6 1.8zm6.8 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8c0 1-.7 1.8-1.6 1.8z" />
      </svg>
    ),
  },
];

export function OAuthButtons({ disabled }: { disabled?: boolean }) {
  const oauth = useOAuthStart();
  const { data: enabledProviders } = useAuthProviders();
  const pendingId = oauth.isPending ? (oauth.variables as OAuthProvider) : null;

  // If we have a definitive list from the server, filter to only enabled providers.
  // If the query hasn't resolved yet (undefined), show all buttons as a fallback.
  const visible = enabledProviders !== undefined
    ? PROVIDERS.filter((p) => enabledProviders.includes(p.id))
    : PROVIDERS;

  if (visible.length === 0) return null;

  return (
    <div className={cn("grid gap-3", visible.length === 1 ? "grid-cols-1" : visible.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
      {visible.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={disabled || oauth.isPending}
          onClick={() => oauth.mutate(p.id)}
          className={cn(
            "flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface",
            "text-[14px] font-medium text-text transition-colors hover:bg-surface-hover",
            "disabled:opacity-50",
          )}
          aria-label={`Continue with ${p.label}`}
        >
          {pendingId === p.id ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-faint border-t-transparent" />
          ) : (
            p.icon
          )}
          <span className="hidden sm:inline">{p.label}</span>
        </button>
      ))}
    </div>
  );
}

/* Small "or" divider used between OAuth and the email form. */
export function OrDivider({ text = "or continue with email" }: { text?: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[12.5px] text-text-faint">{text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
