/**
 * Landing layout — the one full-bleed route.
 *
 * It sits in its own route group rather than under (marketing) for two reasons:
 * the marketing layout paints the ruled `.app-aurora` ground, which would show
 * through and fight the WebGL scene; and the landing needs the smooth-scroll and
 * cursor machinery that must NOT be mounted anywhere else in the app.
 *
 * Three things are deliberately scoped to this subtree:
 *
 *   `data-theme="dark"` — the scene is a black room with a glass object in it.
 *     There is no light-theme reading of that, so the landing pins itself to the
 *     ink palette. The tokens are CSS custom properties declared on
 *     `[data-theme]`, so putting the attribute on this wrapper re-declares them
 *     for everything inside without touching the rest of the app.
 *
 *   `<SmoothScroll>` — installs a document-wide Lenis instance and intercepts
 *     anchor clicks. Mounted in the root layout it would give every dashboard
 *     table in the product momentum scrolling.
 *
 *   `<Cursor>` — hides the native cursor via a class on <html>. Same reasoning:
 *     the app is a tool, and a tool should keep its pointer.
 */

import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import SmoothScroll from "@/components/landing/SmoothScroll";
import PointerTracker from "@/components/landing/PointerTracker";
import Cursor from "@/components/landing/ui/Cursor";
import ScrollRuler from "@/components/landing/ui/ScrollRuler";
import IntroOverlay from "@/components/landing/ui/IntroOverlay";
import SceneLoader from "@/components/landing/canvas/SceneLoader";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className="landing-scene relative min-h-screen text-text">
      {/* The black ground, as its own fixed layer rather than a background on
          this wrapper.

          Painting order is the reason: within a stacking context, negative
          z-index children paint *before* descendant block backgrounds. The
          canvas sits at -z-10, so an opaque background on this wrapper covers
          it completely — the scene mounts, sizes correctly, and renders to
          nothing visible. Putting the ground at -z-20 stacks it correctly
          underneath. It cannot be left to <body> either: body is outside this
          subtree and so follows the app's real theme, which may be light. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 bg-bg" />
      {/* WebGL layer: client-only, loaded after hydration so the DOM paints
          without waiting on three.js. The intro overlay covers the gap. */}
      <SceneLoader />

      <PointerTracker />
      <Cursor />
      <IntroOverlay />

      <SmoothScroll>
        <MarketingNav />
        <ScrollRuler />

        <main className="relative z-10">{children}</main>

        <SiteFooter />
      </SmoothScroll>
    </div>
  );
}
