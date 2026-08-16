/**
 * Auth layout — a centered card on a branded, atmospheric backdrop. On large
 * screens a left "showcase" panel carries the brand story; the form sits on the
 * right. Fully theme-aware.
 */

import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/brand/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* showcase (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-brand-gradient lg:block">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at 30% 30%, #000, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse at 30% 30%, #000, transparent 80%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo size={34} href="/" className="[&_*]:!text-white" />

          <div className="max-w-md">
            <h2 className="font-display text-[40px] font-extrabold leading-[1.1] tracking-[-1px] text-white">
              Forge yourself in offensive security.
            </h2>
            <p className="mt-5 text-[17px] text-white/85">
              Join 128,000+ hackers training on real vulnerable machines, live CTFs,
              and guided tracks. Your first root is minutes away.
            </p>
            <div className="mt-8 flex gap-6">
              <Stat n="540+" l="Machines" />
              <Stat n="86" l="Live CTFs" />
              <Stat n="195" l="Countries" />
            </div>
          </div>

          <p className="text-[13px] text-white/70">
            “The best place I’ve found to actually <em>practice</em> offensive security.”
          </p>
        </div>
      </aside>

      {/* form side */}
      <main className="relative flex min-h-screen flex-col">
        {/* atmosphere on the form side too (mobile + light/dark) */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -right-20 -top-24 h-80 w-80 rounded-full blur-[80px]"
            style={{ background: "radial-gradient(circle,#7C3AED,transparent 65%)", opacity: "var(--atmos-opacity)" }}
          />
        </div>

        <div className="relative flex items-center justify-between p-6">
          {/* mobile logo */}
          <div className="lg:hidden">
            <Logo size={30} />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <div className="relative flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>

        <footer className="relative px-6 pb-6 text-center text-[13px] text-text-faint">
          <Link href="/" className="hover:text-text">
            ← Back to offensiveconditions.org
          </Link>
        </footer>
      </main>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="font-display text-[26px] font-extrabold text-white">{n}</div>
      <div className="text-[13px] text-white/70">{l}</div>
    </div>
  );
}
