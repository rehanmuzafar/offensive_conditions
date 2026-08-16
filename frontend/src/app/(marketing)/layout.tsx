/**
 * Marketing layout — wraps all public pages with the top nav + footer and the
 * atmospheric background (grid + brand glow blobs) that defines the premium
 * dark look. The atmosphere adapts to the active theme via CSS tokens.
 */

import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      {/* atmosphere */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute inset-0 bg-grid"
          style={{
            opacity: "var(--grid-opacity)",
            maskImage:
              "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
          }}
        />
        <div
          className="absolute -left-24 -top-40 h-[520px] w-[520px] rounded-full blur-[90px]"
          style={{
            background: "radial-gradient(circle, #7C3AED, transparent 65%)",
            opacity: "var(--atmos-opacity)",
          }}
        />
        <div
          className="absolute -right-28 -top-20 h-[480px] w-[480px] rounded-full blur-[90px]"
          style={{
            background: "radial-gradient(circle, #2563EB, transparent 65%)",
            opacity: "var(--atmos-opacity)",
          }}
        />
      </div>

      <div className="relative z-10">
        <MarketingNav />
        <main>{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
