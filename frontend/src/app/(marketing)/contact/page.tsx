"use client";

import { useState, type FormEvent } from "react";
import { Mail, Building2, MessageSquare, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/layout/section-heading";
import { BRAND } from "@/config/brand";

const TOPICS = ["Sales / Enterprise", "Education", "Support", "Press", "Partnerships"];

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]!);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Wired to a real endpoint later; for now acknowledge.
    setSent(true);
    toast.success("Message sent — we'll get back to you soon.");
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-20">
      <SectionHeading
        eyebrow="Contact"
        title="Let's talk."
        subtitle="Questions about teams, education, press, or partnerships? Drop us a line."
      />

      <div className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.3fr]">
        {/* left: channels */}
        <div className="space-y-4">
          <ContactCard icon={<Mail className="h-5 w-5" />} title="Email us" body={BRAND.contactEmail} />
          <ContactCard icon={<Building2 className="h-5 w-5" />} title="Enterprise & education" body="Custom labs, SSO, and volume seats for orgs and universities." />
          <ContactCard icon={<MessageSquare className="h-5 w-5" />} title="Community" body="Join the Discord for real-time help from the community." />
        </div>

        {/* right: form */}
        <Card className="p-8">
          {sent ? (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-success/15">
                <Check className="h-7 w-7 text-success" strokeWidth={2.5} />
              </div>
              <h3 className="font-display text-[22px] font-bold">Thanks for reaching out</h3>
              <p className="mt-2 max-w-[340px] text-[14.5px] text-text-dim">
                We&apos;ve received your message and will reply to your email shortly.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <FormField label="Name" htmlFor="name" required>
                  <Input id="name" required placeholder="Your name" />
                </FormField>
                <FormField label="Email" htmlFor="email" required>
                  <Input id="email" type="email" required placeholder="you@example.com" leftIcon={<Mail className="h-[18px] w-[18px]" />} />
                </FormField>
              </div>

              <FormField label="Topic" htmlFor="topic">
                <div className="flex flex-wrap gap-2">
                  {TOPICS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTopic(t)}
                      className={
                        "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors " +
                        (topic === t
                          ? "border-accent bg-brand-gradient-soft text-accent"
                          : "border-line-strong text-text-dim hover:bg-surface-hover")
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </FormField>

              <FormField label="Message" htmlFor="message" required>
                <textarea
                  id="message"
                  required
                  rows={5}
                  placeholder="How can we help?"
                  className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[15px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </FormField>

              <Button type="submit" size="lg" fullWidth>Send message</Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function ContactCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card className="flex items-start gap-4 p-6">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient-soft text-accent">
        {icon}
      </div>
      <div>
        <h4 className="font-display text-[16px] font-semibold">{title}</h4>
        <p className="mt-1 text-[14px] text-text-dim">{body}</p>
      </div>
    </Card>
  );
}
