"use client";

import { create } from "zustand";
import type { SectionId } from "./telemetry";

/**
 * The small slice of state that genuinely needs to re-render React.
 * Everything continuous (scroll, pointer, quaternion) lives in telemetry.ts.
 */
type UIState = {
  /** Flips once the WebGL scene has drawn its first frame — gates the intro. */
  sceneReady: boolean;
  setSceneReady: (v: boolean) => void;

  /** Section the viewport is currently sitting in. */
  active: SectionId;
  setActive: (id: SectionId) => void;

};

export const useUI = create<UIState>((set) => ({
  sceneReady: false,
  setSceneReady: (v) => set({ sceneReady: v }),

  active: "top",
  setActive: (id) => set((s) => (s.active === id ? s : { active: id })),

}));
