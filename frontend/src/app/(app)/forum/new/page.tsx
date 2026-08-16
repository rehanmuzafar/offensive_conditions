"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, Pencil } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { useForumCategories, useCreateThread } from "@/hooks/use-community";
import { cn } from "@/lib/cn";

function Composer() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: categories } = useForumCategories();
  const create = useCreateThread();

  const [title, setTitle] = useState("");
  const [categorySlug, setCategorySlug] = useState(params.get("category") ?? "machines");
  const [body, setBody] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [preview, setPreview] = useState(false);

  const canPost = title.trim().length >= 8 && body.trim().length >= 20;

  function submit() {
    if (!canPost) return;
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5);
    create.mutate(
      { title, categorySlug, bodyMd: body, tags },
      {
        onSuccess: (thread) => router.push(`/forum/thread/${thread.id}`),
        // mock fallback: createThread will throw → still navigate back to forum
        onError: () => router.push("/forum"),
      },
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/forum" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Back to forum
      </Link>

      <div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Start a new thread</h1>
        <p className="mt-1 text-[14.5px] text-text-dim">Ask a question or start a discussion. Be specific, and never post spoilers.</p>
      </div>

      <Card>
        <CardBody className="space-y-1">
          <FormField label="Title" htmlFor="title" required help="A clear, specific title gets better answers.">
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sentinel — stuck on privesc after www-data shell" />
          </FormField>

          <FormField label="Category" htmlFor="category" required>
            <div className="flex flex-wrap gap-2">
              {(categories ?? []).map((c) => (
                <button
                  key={c.slug}
                  onClick={() => setCategorySlug(c.slug)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    categorySlug === c.slug ? "border-accent bg-brand-gradient-soft text-accent" : "border-line-strong text-text-dim hover:bg-surface-hover",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </FormField>

          {/* body with preview toggle */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-text">Body <span className="text-danger">*</span></span>
              <div className="flex rounded-lg border border-line-strong p-0.5">
                <button
                  onClick={() => setPreview(false)}
                  className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium", !preview ? "bg-surface-hover text-text" : "text-text-faint")}
                >
                  <Pencil className="h-3.5 w-3.5" /> Write
                </button>
                <button
                  onClick={() => setPreview(true)}
                  className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium", preview ? "bg-surface-hover text-text" : "text-text-faint")}
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
              </div>
            </div>
            {preview ? (
              <div className="min-h-[180px] rounded-xl border border-line bg-bg-elevated p-4">
                {body.trim() ? <Markdown>{body}</Markdown> : <span className="text-[14px] text-text-faint">Nothing to preview yet.</span>}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={9}
                placeholder="Describe your problem or topic. Markdown supported. Include what you've already tried."
                className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            )}
          </div>

          <FormField label="Tags" htmlFor="tags" help="Comma-separated, up to 5. e.g. sentinel, linux, privesc">
            <Input id="tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="tag1, tag2, tag3" />
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link href="/forum">
              <Button variant="ghost">Cancel</Button>
            </Link>
            <Button loading={create.isPending} disabled={!canPost} onClick={submit}>
              Post thread
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default function NewThreadPage() {
  return (
    <Suspense fallback={<div className="h-40" />}>
      <Composer />
    </Suspense>
  );
}
