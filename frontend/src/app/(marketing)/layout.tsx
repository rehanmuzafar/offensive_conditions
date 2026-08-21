/**
 * Marketing layout — top nav, footer, and the ruled ground the public pages
 * sit on.
 *
 * The ground is `.app-aurora`: a fine grid with crosshair ticks, the same
 * drafting language used inside the app. It replaced a pair of blurred violet
 * and blue blobs — those read as a generic SaaS gradient and, more practically,
 * were the reason every marketing page had a wash of chroma behind its type.
 */

import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-aurora relative min-h-screen">
      <div className="relative z-10">
        <MarketingNav />
        <main>{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
