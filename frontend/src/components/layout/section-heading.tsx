import { cn } from "@/lib/cn";

/**
 * <SectionHeading /> — the centered eyebrow + title + subtitle block used at
 * the top of marketing sections. Keeps spacing/typography consistent.
 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-[660px]",
        align === "center" ? "mx-auto text-center" : "text-left",
        className,
      )}
    >
      {eyebrow && (
        <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          {eyebrow}
        </div>
      )}
      <h2 className="font-display text-[clamp(30px,3.8vw,44px)] font-bold leading-[1.1] tracking-[-1px]">
        {title}
      </h2>
      {subtitle && <p className="mt-4 text-[17.5px] text-text-dim">{subtitle}</p>}
    </div>
  );
}
