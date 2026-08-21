"use client";

/**
 * Event-wide announcements: who spawned what, who pwned what.
 *
 * A store rather than hook state because the socket is opened once per page by
 * `useEventLive`, while the banner that renders these lives somewhere else in
 * the tree entirely — and on the arena page the two are in different columns.
 * Passing messages down through props would mean threading them through every
 * component in between.
 */

import { create } from "zustand";

export type LiveNotice = {
  id: string;
  kind: "spawned" | "pwned";
  playerName: string;
  challengeName: string;
  teamName?: string | null;
  firstBlood?: boolean;
  points?: number;
  at: number;
};

// Enough to fill the strip during a burst of solves without the list growing
// without bound over a 48-hour event.
const MAX = 6;

type LiveFeedState = {
  notices: LiveNotice[];
  push: (n: Omit<LiveNotice, "id" | "at">) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

export const useLiveFeedStore = create<LiveFeedState>((set) => ({
  notices: [],
  push: (n) =>
    set((s) => ({
      notices: [
        { ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() },
        ...s.notices,
      ].slice(0, MAX),
    })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  clear: () => set({ notices: [] }),
}));
