"use client";

/**
 * Shared frame for a program's sub-pages.
 *
 * The aside is fetched and rendered once here rather than by each of the seven
 * pages under it — otherwise every sub-page navigation would refetch the
 * program and repaint the panel that is supposed to be the fixed part of the
 * screen.
 */

import { use } from "react";

import { ProgramAside } from "@/components/bounty/program-aside";
import { Card, Skeleton } from "@/components/ui/card";
import { useProgram } from "@/hooks/use-account";

export default function ProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { data: program, isLoading, error } = useProgram(slug);

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-96 w-full rounded-2xl" />
        <Skeleton className="hidden h-80 w-full rounded-2xl lg:block" />
      </div>
    );
  }

  if (error || !program) {
    return (
      <Card className="p-12 text-center">
        <p className="font-display text-[17px] font-bold">Program not found</p>
        <p className="mt-1.5 text-[13.5px] text-text-dim">
          It may be private, paused, or the link may be wrong.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">{children}</div>
      <ProgramAside program={program} />
    </div>
  );
}
