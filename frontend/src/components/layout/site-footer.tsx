/**
 * Site footer — brand blurb, social links, and the nav columns from config.
 */

import Link from "next/link";
import { Github, Twitter, MessageCircle, Linkedin } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { BRAND } from "@/config/brand";
import { FOOTER_LINKS } from "@/config/nav";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-[1200px] px-6 py-14">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          {/* about */}
          <div>
            <Logo size={30} showSub={false} />
            <p className="mt-4 max-w-[280px] text-[14px] text-text-dim">
              The arena where ethical hackers are forged. Hands-on offensive
              security training for everyone, from first box to black-badge.
            </p>
            <div className="mt-5 flex gap-2.5">
              {BRAND.social.twitter && (
                <SocialLink href={BRAND.social.twitter} label="Twitter">
                  <Twitter className="h-[18px] w-[18px]" />
                </SocialLink>
              )}
              {BRAND.social.github && (
                <SocialLink href={BRAND.social.github} label="GitHub">
                  <Github className="h-[18px] w-[18px]" />
                </SocialLink>
              )}
              {BRAND.social.discord && (
                <SocialLink href={BRAND.social.discord} label="Discord">
                  <MessageCircle className="h-[18px] w-[18px]" />
                </SocialLink>
              )}
              {BRAND.social.linkedin && (
                <SocialLink href={BRAND.social.linkedin} label="LinkedIn">
                  <Linkedin className="h-[18px] w-[18px]" />
                </SocialLink>
              )}
            </div>
          </div>

          {/* link columns */}
          {FOOTER_LINKS.map((col) => (
            <div key={col.heading}>
              <h4 className="mb-4 font-display text-[14px] font-semibold text-text">
                {col.heading}
              </h4>
              {col.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="mb-2.5 block text-[14px] text-text-dim transition-colors hover:text-accent"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-11 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[13.5px] text-text-faint">
          <span>
            © {year} {BRAND.fullName}. All rights reserved.
          </span>
          <span>Terms · Privacy · Responsible disclosure</span>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      target="_blank"
      rel="noopener noreferrer"
      className="grid h-[38px] w-[38px] place-items-center border border-line-strong text-text-dim transition-all hover:border-transparent hover:bg-brand-gradient hover:text-white"
    >
      {children}
    </a>
  );
}
