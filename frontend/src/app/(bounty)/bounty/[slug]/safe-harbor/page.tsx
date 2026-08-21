"use client";

/**
 * Safe harbor — whether good-faith testing is legally protected here.
 *
 * The text is the same for every program that offers it, because that is the
 * point of a standard: a hacker should not have to read a bespoke legal
 * paragraph per program to know where they stand. What varies is only whether
 * the program has adopted it, and a program that has not says so plainly rather
 * than showing nothing.
 */

import { use } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { useProgram } from "@/hooks/use-account";

export default function ProgramSafeHarborPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { data: program } = useProgram(slug);
  if (!program) return null;

  if (!program.safeHarbor) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <h1 className="font-display text-[17px] font-bold">No safe harbor</h1>
              <p className="mt-2 text-[14px] leading-relaxed text-text-dim">
                {program.name} has not adopted a safe harbor statement. That does not make
                testing forbidden, but it does mean nothing here commits them to treating your
                research as authorised. Read the program policy carefully, stay strictly inside
                the declared scope, and ask before anything you are unsure about.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div className="min-w-0">
            <h1 className="font-display text-[17px] font-bold">Safe harbor</h1>
            <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-text-dim">
              <p>
                {program.name} supports good-faith security research. Good-faith research means
                accessing a system solely to test, investigate or correct a security flaw,
                carried out so as to avoid harm to individuals or the public, and where what you
                learn is used to improve the security of the systems involved.
              </p>
              <p>
                For activity conducted while this program is active, {program.name}:
              </p>
              <ul className="ml-4 list-disc space-y-1.5">
                <li>
                  <strong className="text-text">Will not</strong> pursue legal action against you
                  or report you for good-faith security research, including for bypassing
                  technical measures protecting the assets in scope; and
                </li>
                <li>
                  <strong className="text-text">Will</strong> make known that your research was
                  conducted in good faith if a third party brings action against you.
                </li>
              </ul>
              <p>
                Contact the program before doing anything you think might fall outside good-faith
                research or is not addressed by the policy.
              </p>
              <p className="text-text-faint">
                This cannot authorise research on third-party infrastructure, and a third party is
                not bound by this statement.
              </p>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
