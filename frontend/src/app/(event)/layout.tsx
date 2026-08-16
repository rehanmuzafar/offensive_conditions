"use client";

/**
 * Layout for the in-event arena.
 *
 * Deliberately outside the app shell: no sidebar, no platform topbar. Once a
 * player is inside a running CTF the rest of the site is a distraction, and the
 * screen is already three columns wide. This is the same reason HackTheBox
 * runs its CTF on its own subdomain — we get the focus without splitting the
 * deployment.
 */

import { AuthGuard } from "../(app)/_components/auth-guard";

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-bg">{children}</div>
    </AuthGuard>
  );
}
