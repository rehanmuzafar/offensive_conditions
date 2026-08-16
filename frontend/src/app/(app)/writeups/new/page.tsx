"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, Pencil, Info } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { usePublishWriteup } from "@/hooks/use-community";
import { cn } from "@/lib/cn";

export default function NewWriteupPage() {
  const router = useRouter();
  const publish = usePublishWriteup();

  const [title, setTitle] = useState("");
  const [targetSlug, setTargetSlug] = useState("");
  const [body, setBody] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [preview, setPreview] = useState(false);

  const canPublish = title.trim().length >= 10 && targetSlug.trim().length > 0 && body.trim().length >= 100;

  function submit() {
    if (!canPublish) return;
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6);
    publish.mutate(
      { title, targetSlug, bodyMd: body, tags },
      {
        onSuccess: (w) => router.push(`/writeups/${w.slug}`),
        onError: () => router.push("/writeups"),
      },
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/writeups" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Back to writeups
      </Link>

      <div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Publish a writeup</h1>
        <p className="mt-1 text-[14.5px] text-text-dim">Share how you rooted a box or solved a challenge.</p>
      </div>

      {/* gating notice */}
      <div className="flex items-start gap-3 rounded-xl border border-info/25 bg-info/8 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" />
        <p className="text-[13.5px] text-text-dim">
          Your writeup will be <b className="text-text">locked for readers</b> until they&apos;ve rooted the same target — so it&apos;s safe to share full solutions here.
        </p>
      </div>

      <Card>
        <CardBody className="space-y-1">
          <FormField label="Title" htmlFor="title" required>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sentinel — From SQLi to Root via Cron PATH Hijack" />
          </FormField>

          <FormField label="Target" htmlFor="target" required help="The machine or challenge slug this writeup covers, e.g. 'sentinel'.">
            <Input id="target" value={targetSlug} onChange={(e) => setTargetSlug(e.target.value)} placeholder="sentinel" />
          </FormField>

          {/* body editor */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-text">Writeup <span className="text-danger">*</span></span>
              <div className="flex rounded-lg border border-line-strong p-0.5">
                <button onClick={() => setPreview(false)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium", !preview ? "bg-surface-hover text-text" : "text-text-faint")}>
                  <Pencil className="h-3.5 w-3.5" /> Write
                </button>
                <button onClick={() => setPreview(true)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium", preview ? "bg-surface-hover text-text" : "text-text-faint")}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
              </div>
            </div>
            {preview ? (
              <div className="min-h-[320px] rounded-xl border border-line bg-bg-elevated p-5">
                {body.trim() ? <Markdown>{body}</Markdown> : <span className="text-[14px] text-text-faint">Nothing to preview yet.</span>}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={16}
                placeholder={"## Reconnaissance\n\nStart with an nmap scan…\n\n```bash\nnmap -sC -sV 10.10.14.7\n```\n\n## Foothold\n\n…"}
                className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 font-mono text-[13.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            )}
            <p className="mt-1.5 text-[12px] text-text-faint">Markdown supported: headings, **bold**, `code`, ```fenced blocks```, lists, &gt; quotes.</p>
          </div>

          <FormField label="Tags" htmlFor="tags" help="Comma-separated, up to 6.">
            <Input id="tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="sqli, privesc, linux" />
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link href="/writeups">
              <Button variant="ghost">Cancel</Button>
            </Link>
            <Button loading={publish.isPending} disabled={!canPublish} onClick={submit}>
              Publish writeup
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
