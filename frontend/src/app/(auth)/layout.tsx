/**
 * Auth layout — a ruled sheet split in two: a showcase panel carrying the brand
 * argument on the left, the form on the right.
 *
 * The panel used to be a violet gradient block, which was the single largest
 * area of chroma anywhere in the product. It is now the same drafting ground as
 * the rest of the app — grid, crosshair ticks, corner brackets — with the
 * weight carried by type instead of by fill. The only division between the two
 * halves is a hairline.
 */

import Link from "next/link";

import AmbientScene from "@/components/landing/canvas/AmbientScene";
import PointerTracker from "@/components/landing/PointerTracker";
import { SignInTransition } from "@/components/auth/sign-in-transition";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/brand/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* The gate gets the live scene: it is the one page where the visitor is
          waiting on something anyway, and it is the last thing they see before
          the product turns into a tool. The pointer tracker is what the wake and
          the skull's tilt read from. */}
      <PointerTracker />
      {/* Anchored left, into the showcase column. The default ambient pose
          drifts right with the scroll timeline's opening keyframes, which put
          the skull directly behind the form. */}
      <AmbientScene
        anchor={[-2.1, -0.15, -0.6]}
        className="pointer-events-none fixed inset-0 -z-10 opacity-80"
      />
      <SignInTransition />
      {/* showcase (desktop only) */}
      <aside className="bg-grid relative hidden overflow-hidden border-r border-line lg:block">
        {/* Crosshair ticks — kept for the case where the scene is gated off
            (no WebGL2, reduced motion), so the panel is never bare. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cpath d='M128 121v14M121 128h14' stroke='currentColor' stroke-width='1'/%3E%3C/svg%3E\")",
            color: "rgb(var(--grid-ink))",
            opacity: "var(--tick-opacity)",
          }}
        />

        <div className="bracket-frame relative m-8 flex h-[calc(100%-4rem)] flex-col justify-between p-10">
          <Logo size={34} href="/" />

          <div className="max-w-md">
            <div className="mb-6 flex items-center gap-3 text-[10.5px] uppercase tracking-widest text-text-faint">
              <span className="iridescent-rule h-px w-10 opacity-70" />
              The arena
            </div>
            <h2 className="font-display text-[clamp(30px,3.4vw,46px)] font-extrabold uppercase leading-[0.95] tracking-mega">
              Forge yourself in <span className="text-gradient">offensive security</span>.
            </h2>
            <p className="mt-6 max-w-[380px] text-[13px] leading-[1.75] text-text-dim">
              Join 128,000+ hackers training on real vulnerable machines, live CTFs,
              and guided tracks. Your first root is minutes away.
            </p>
            <div className="mt-9 flex gap-10">
              <Stat n="540+" l="Machines" />
              <Stat n="86" l="Live CTFs" />
              <Stat n="195" l="Countries" />
            </div>
          </div>

          <p className="text-[11.5px] text-text-faint">
            “The best place I’ve found to actually <em>practice</em> offensive security.”
          </p>
        </div>
      </aside>

      {/* form side */}
      <main className="relative flex min-h-screen flex-col">
        {/*
          A scrim under the form column. The scene runs full-bleed on purpose —
          clipping it to the showcase panel would put a hard vertical seam down
          the middle of the page — but a login form has to stay readable while a
          glass skull passes behind it. This fades the ground back in from the
          left so the type sits on something solid without the scene appearing to
          stop.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-[5]"
          style={{
            background:
              "linear-gradient(90deg, rgb(var(--bg) / 0) 0%, rgb(var(--bg) / 0.72) 22%, rgb(var(--bg) / 0.92) 55%)",
          }}
        />
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
      <div className="font-display text-[26px] font-extrabold tracking-mega text-text">{n}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-text-faint">{l}</div>
    </div>
  );
}
