"use client";

import dynamic from "next/dynamic";

/**
 * Client boundary for the WebGL layer.
 *
 * `dynamic(..., { ssr: false })` is only legal inside a client component in
 * the App Router, and the scene genuinely cannot be server-rendered — it
 * touches window on mount. Keeping the boundary in its own file lets the page
 * itself stay a server component.
 */
const Scene = dynamic(() => import("./Scene"), { ssr: false });

export default function SceneLoader() {
  return <Scene />;
}
