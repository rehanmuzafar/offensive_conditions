"use client";

/**
 * The first question, asked once.
 *
 * Hacker and company are not two views of one product — they are two products
 * that share an account system. A hacker's first screen is programs to hunt and
 * an inbox of their own reports; a company's is a program to run and a triage
 * queue. There is no sensible default that serves both, so nothing is guessed:
 * the answer is asked before the shell renders anything, and remembered.
 *
 * Deliberately not skippable. "Decide later" would mean designing a third,
 * neutral home page that neither audience wants, and every account that took it
 * would sit in that state indefinitely.
 */

import { useState } from "react";
import { Building2, Loader2, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useSetAccountType } from "@/hooks/use-auth";
import { surfaceLinks } from "@/lib/surfaces";

type Choice = "hacker" | "company";

export default function OnboardingPage() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const setType = useSetAccountType();

  const canSubmit =
    choice === "hacker" || (choice === "company" && companyName.trim().length >= 2);

  function submit() {
    if (!choice || !canSubmit) return;
    setType.mutate(
      {
        accountType: choice,
        companyName: companyName.trim(),
        companyWebsite: companyWebsite.trim(),
      },
      {
        onSuccess: () => {
          // A hacker lands on opportunity discovery, a company on its programs.
          // Both are on the bug bounty surface, which is why this is a full
          // navigation rather than a client-side push.
          window.location.href =
            choice === "hacker"
              ? surfaceLinks.bugbounty("/bounty")
              : surfaceLinks.bugbounty("/bounty/company");
        },
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <div className="text-center">
        <h1 className="font-display text-[30px] font-extrabold leading-tight tracking-[-0.6px]">
          How will you use OFFCON?
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-[14.5px] leading-relaxed text-text-dim">
          This sets up your account. You can&apos;t change it later without contacting
          support, so pick the one that describes you.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <ChoiceCard
          selected={choice === "hacker"}
          onSelect={() => setChoice("hacker")}
          icon={<Terminal className="h-6 w-6" />}
          title="I'm a hacker"
          blurb="Hunt bug bounty programs, play CTFs, own machines and climb the leaderboard."
          points={["Submit vulnerability reports", "Earn bounties and reputation", "Join CTF teams and events"]}
        />
        <ChoiceCard
          selected={choice === "company"}
          onSelect={() => setChoice("company")}
          icon={<Building2 className="h-6 w-6" />}
          title="I'm a company"
          blurb="Run a bug bounty program, triage incoming reports and pay out bounties."
          points={["Publish a program and scope", "Triage and resolve reports", "Invite hackers and set rewards"]}
        />
      </div>

      {choice === "company" && (
        <div className="edge-iridescent mt-5 rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-display text-[15px] font-bold">About your organisation</h2>
          <p className="mt-1 text-[12.5px] text-text-dim">
            This is the name hackers will see on your program.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                Company name
              </span>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Security"
                autoFocus
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                Website <span className="text-text-ghost">(optional)</span>
              </span>
              <input
                value={companyWebsite}
                onChange={(e) => setCompanyWebsite(e.target.value)}
                placeholder="https://acme.com"
                className={FIELD}
              />
            </label>
          </div>
        </div>
      )}

      <div className="mt-7 flex justify-center">
        <Button
          size="lg"
          disabled={!canSubmit || setType.isPending}
          onClick={submit}
          className="min-w-[220px]"
        >
          {setType.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </div>
    </div>
  );
}

const FIELD =
  "mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

function ChoiceCard({
  selected,
  onSelect,
  icon,
  title,
  blurb,
  points,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  points: string[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "edge-iridescent group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300",
        "hover:-translate-y-1",
        selected
          ? "border-accent bg-accent/[0.06] shadow-[0_0_0_1px_rgb(var(--accent)/0.5)]"
          : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <span
        className={cn(
          "grid h-11 w-11 place-items-center rounded-xl border transition-colors",
          selected ? "border-accent/40 bg-accent/12 text-accent" : "border-line bg-white/5 text-text-dim",
        )}
      >
        {icon}
      </span>
      <h2 className="mt-3.5 font-display text-[18px] font-bold tracking-[-0.3px]">{title}</h2>
      <p className="mt-1 text-[13.5px] leading-relaxed text-text-dim">{blurb}</p>
      <ul className="mt-3.5 space-y-1.5 border-t border-line pt-3.5">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-[12.5px] text-text-faint">
            <span
              aria-hidden
              className={cn(
                "mt-[7px] h-1 w-1 shrink-0 rounded-full",
                selected ? "bg-accent" : "bg-text-ghost",
              )}
            />
            {p}
          </li>
        ))}
      </ul>
    </button>
  );
}
