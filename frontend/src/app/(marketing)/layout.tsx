/**
 * Marketing layout — top nav, footer, and the WebGL scene the whole public
 * site now sits on.
 *
 * The ground used to be `.app-aurora`, a flat CSS grid. It has been replaced by
 * the landing page's live scene (glass skull, refracted data backdrop, curved
 * grid, rain-glass water) mounted as a fixed background, so every marketing and
 * SEO page carries the same signature look the front door does — the skull
 * reacting to scroll, a ripple wake following the cursor, the matrix/grid/glow
 * behind the content. See <MarketingScene> for what is and is not carried over
 * from the landing layout (no smooth-scroll, no cursor hijack, no intro).
 *
 * `data-theme="dark"` is pinned here. The scene is a black room with a lit glass
 * object in it; there is no light-theme reading of that, so this subtree fixes
 * itself to the ink palette exactly as the landing does. The tokens are CSS
 * custom properties on `[data-theme]`, so the attribute re-declares them for
 * everything inside without touching the rest of the app.
 *
 * The scene is `aria-hidden` and client-only (loaded after hydration), so it
 * adds nothing to the server-rendered HTML the crawler reads and cannot shift
 * layout — the SEO content and Core Web Vitals are unaffected.
 */

import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import MarketingScene from "@/components/landing/canvas/MarketingScene";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className="relative min-h-screen text-text">
      {/* Fixed background scene (skull + grid + data backdrop + rain glass),
          its own black ground, the pointer wake, and the readability veil. */}
      <MarketingScene />

      {/* Content rides above the scene. z-10 puts the whole document in front of
          every negative-z layer the scene lays down. */}
      <div className="relative z-10">
        <MarketingNav />
        <main>{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
