"use client";

import { useRef } from "react";
import clsx from "clsx";
import { Reveal, RevealWords } from "@/components/landing/ui/Reveal";
import { Eyebrow, GhostWord } from "@/components/landing/ui/Bits";

type Machine = {
  name: string;
  os: "Linux" | "Windows" | "OT";
  difficulty: "Easy" | "Medium" | "Hard" | "Insane";
  points: number;
  rooted: string;
  tags: string[];
};

const MACHINES: Machine[] = [
  { name: "SENTINEL", os: "Linux", difficulty: "Medium", points: 30, rooted: "4,182", tags: ["web", "pivot", "suid"] },
  { name: "GLASSHOUSE", os: "Windows", difficulty: "Hard", points: 40, rooted: "912", tags: ["ad", "kerberos", "relay"] },
  { name: "TIDEPOOL", os: "Linux", difficulty: "Easy", points: 20, rooted: "18,340", tags: ["enum", "cron"] },
  { name: "BLACKSITE", os: "OT", difficulty: "Insane", points: 60, rooted: "137", tags: ["modbus", "firmware", "rce"] },
  { name: "PALEHOUR", os: "Windows", difficulty: "Medium", points: 30, rooted: "3,047", tags: ["uac", "dpapi"] },
];

const DIFFICULTY_TONE: Record<Machine["difficulty"], string> = {
  Easy: "text-emerald-400",
  Medium: "text-amber-300",
  Hard: "text-orange-400",
  Insane: "text-rose-400",
};

/**
 * A card that tilts toward the cursor.
 *
 * The rotation is written directly to the element's style from the pointer
 * event — no state, no re-render — and the whole rail shares one perspective
 * container so neighbouring cards tilt as parts of the same space rather than
 * as six unrelated boxes. Rotation is capped low (about 7°); past that the
 * text starts to keystone and legibility goes before the effect gets better.
 */
function MachineCard({ machine, index }: { machine: Machine; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const glare = useRef<HTMLSpanElement>(null);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;

    const rx = (0.5 - py) * 14;
    const ry = (px - 0.5) * 14;
    el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateZ(28px)`;

    // Specular sheen tracking the cursor, which is what sells the tilt as a
    // physical surface rather than a skewed image.
    if (glare.current) {
      glare.current.style.background = `radial-gradient(420px circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,0.13), transparent 60%)`;
    }
  };

  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "rotateX(0deg) rotateY(0deg) translateZ(0px)";
    if (glare.current) glare.current.style.background = "transparent";
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      data-cursor="hover"
      className="group relative w-[290px] shrink-0 border border-white/[0.09] bg-black/55 p-6 backdrop-blur-xl transition-transform duration-300 ease-out will-change-transform sm:w-[330px]"
      style={{ transformStyle: "preserve-3d" }}
    >
      <span
        ref={glare}
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
      />

      <div className="flex items-start justify-between">
        <span className="text-[10px] tabular-nums text-text-ghost">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className={clsx("text-[10px] uppercase tracking-wide", DIFFICULTY_TONE[machine.difficulty])}>
          {machine.difficulty}
        </span>
      </div>

      <h3 className="mt-8 font-display text-[27px] font-extrabold tracking-mega">{machine.name}</h3>

      <div className="mt-1.5 flex items-center gap-2 text-[10.5px] uppercase tracking-wide text-text-faint">
        <span>{machine.os}</span>
        <span className="text-text-ghost">·</span>
        <span>{machine.points} pts</span>
      </div>

      <div className="mt-7 flex flex-wrap gap-1.5">
        {machine.tags.map((t) => (
          <span key={t} className="border border-white/10 px-2 py-1 text-[9.5px] text-text-faint">
            {t}
          </span>
        ))}
      </div>

      <div className="mt-7 flex items-center justify-between border-t border-white/[0.07] pt-4 text-[10px] text-text-ghost">
        <span>{machine.rooted} rooted</span>
        <span className="inline-flex items-center gap-1.5 text-text-faint transition-colors group-hover:text-text">
          spawn
          <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The proof panel: a transcript of a real session, sitting beside the rail.
 * It exists because everything else on this page is a claim — the terminal is
 * the one place the product shows its own output.
 */
function Transcript() {
  const lines: { text: string; tone?: string }[] = [
    { text: "offcon@arena:~$ box spawn sentinel" },
    { text: "→ provisioning gVisor sandbox…", tone: "text-text-faint" },
    { text: "→ target up at 10.10.14.7 · vpn connected", tone: "text-text-faint" },
    { text: "offcon@arena:~$ submit OFFCON{r00t_d4nce}" },
    { text: "✓ user flag accepted · +25 pts", tone: "text-emerald-400" },
    { text: "✓ root flag accepted · first blood +50", tone: "text-emerald-400" },
  ];

  return (
    <div className="bracket-frame glass-strong w-full max-w-[440px] p-6">
      <div className="flex items-center gap-2 border-b border-white/[0.07] pb-3">
        <span className="h-2 w-2 rounded-full bg-white/25" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/10" />
        <span className="ml-2 text-[10.5px] text-text-ghost">root@offcon: ~/targets/sentinel</span>
      </div>

      <div className="space-y-1.5 pt-4 text-[11.5px] leading-[1.85]">
        {lines.map((l, i) => (
          <div key={i} className={l.tone ?? "text-text-dim"}>
            {l.text}
          </div>
        ))}
        <div className="flex items-center gap-1 text-text-dim">
          offcon@arena:~$
          <span className="inline-block h-3 w-[7px] animate-blink bg-text align-middle" />
        </div>
      </div>
    </div>
  );
}

export default function Machines() {
  return (
    <section id="machines" className="relative overflow-hidden px-6 py-28 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <div className="relative flex flex-wrap items-end justify-between gap-8">
          <div>
            <GhostWord className="absolute -top-16 right-0 hidden text-[13vw] lg:block">
              Targets
            </GhostWord>
            <Reveal>
              <Eyebrow index="II" label="Live targets" />
            </Reveal>
            <h2 className="mt-7 font-display text-[clamp(30px,5vw,72px)] font-extrabold uppercase leading-[0.94] tracking-mega">
              <RevealWords text="Real systems." className="block" />
              <RevealWords text="Real root." className="iridescent-text block" />
            </h2>
          </div>

          <Reveal delay={0.15}>
            <p className="max-w-[380px] text-[13.5px] leading-[1.75] text-text-dim">
              Every target is a full machine in an isolated sandbox — no
              simulations, no scripted paths. Get in however you can, then prove
              it with a flag.
            </p>
          </Reveal>
        </div>

        {/* One shared perspective so the rail reads as a single 3D space. */}
        <div
          className="-mx-6 mt-16 flex gap-5 overflow-x-auto px-6 pb-8 pt-4 lg:-mx-10 lg:px-10 [scrollbar-width:none]"
          style={{ perspective: "1400px" }}
        >
          {MACHINES.map((m, i) => (
            <MachineCard key={m.name} machine={m} index={i} />
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-end justify-between gap-10">
          <Reveal>
            <Transcript />
          </Reveal>

          <Reveal delay={0.15}>
            <div className="max-w-[300px] text-[11.5px] leading-[1.9] text-text-faint">
              <span className="highlight-run font-medium">Proof, not progress bars.</span>
              <p className="mt-4">
                Flags are verified server-side against a per-user secret, so a
                shared answer is worth nothing. Writeups stay locked until your
                own submission lands.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
