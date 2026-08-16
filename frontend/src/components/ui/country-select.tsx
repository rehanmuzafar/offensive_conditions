"use client";

/**
 * <CountrySelect /> — dropdown for picking a country by ISO 3166-1 alpha-2 code.
 *
 * Options come from the curated COUNTRIES list (Israel/IL is not selectable).
 * If the bound value is an unrecognised code (e.g. a legacy "IL"), no flag is
 * rendered and COUNTRY_ERROR is shown above the control instead.
 */

import { cn } from "@/lib/cn";
import { Flag } from "@/components/ui/flag";
import { COUNTRIES, COUNTRY_ERROR, isSupportedCountry } from "@/lib/countries";

interface CountrySelectProps {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  className?: string;
}

export function CountrySelect({ value, onChange, id, className }: CountrySelectProps) {
  const code = (value ?? "").trim().toUpperCase();
  const hasValue = code.length > 0;
  const valid = isSupportedCountry(code);

  return (
    <div className="space-y-2">
      {hasValue && !valid && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {COUNTRY_ERROR}
        </p>
      )}
      <div className="flex items-center gap-2.5">
        {valid ? (
          <Flag code={code} />
        ) : (
          <span className="h-4 w-[22px] shrink-0 rounded-[3px] border border-dashed border-line-strong" aria-hidden />
        )}
        <select
          id={id}
          value={valid ? code : ""}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-11 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14.5px] text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
            className,
          )}
        >
          <option value="">Select a country…</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
