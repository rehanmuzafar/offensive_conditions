"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Shield, Bell, Key, Wifi, CreditCard } from "lucide-react";

import { cn } from "@/lib/cn";

const NAV = [
  { href: "/settings", label: "Account", icon: User, exact: true },
  { href: "/settings/security", label: "Security", icon: Shield },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/api-keys", label: "API keys", icon: Key },
  { href: "/settings/vpn", label: "VPN", icon: Wifi },
  { href: "/settings/billing", label: "Billing & payouts", icon: CreditCard },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">Settings</h1>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        {/* sub-nav */}
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition-colors lg:shrink",
                  active ? "bg-brand-gradient-soft text-accent" : "text-text-dim hover:bg-surface-hover hover:text-text",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* content */}
        <div className="min-w-0 max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
