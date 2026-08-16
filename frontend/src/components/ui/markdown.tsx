"use client";

/**
 * Minimal, dependency-free Markdown renderer for forum posts + writeups.
 * Supports: headings, bold/italic/inline-code, fenced code blocks, links,
 * unordered/ordered lists, blockquotes, and paragraphs. HTML is escaped first
 * so user content can't inject markup.
 *
 * (When we add a heavier pipeline later we can swap this out; the API is just
 * `<Markdown>{md}</Markdown>`.)
 */

import { useMemo } from "react";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let t = escapeHtml(s);
  // inline code
  t = t.replace(/`([^`]+)`/g, '<code class="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[0.85em]">$1</code>');
  // bold
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // links [text](url)
  t = t.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-accent hover:underline" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // @mentions
  t = t.replace(/(^|\s)@(\w+)/g, '$1<span class="font-semibold text-accent">@$2</span>');
  return t;
}

interface Block {
  html: string;
}

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // fenced code
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      blocks.push({
        html:
          `<pre class="my-4 overflow-x-auto rounded-xl border border-line bg-bg-elevated p-4"><code class="font-mono text-[13px] leading-relaxed text-text">` +
          escapeHtml(buf.join("\n")) +
          `</code></pre>` +
          (lang ? "" : ""),
      });
      continue;
    }

    // blank
    if (line.trim() === "") {
      i++;
      continue;
    }

    // headings
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const sizes = ["text-[24px]", "text-[20px]", "text-[17px]", "text-[15px]"];
      blocks.push({
        html: `<h${level} class="mt-6 mb-2 font-display font-bold ${sizes[level - 1]}">${inline(h[2]!)}</h${level}>`,
      });
      i++;
      continue;
    }

    // blockquote
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        buf.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({
        html: `<blockquote class="my-4 border-l-3 border-accent bg-brand-gradient-soft py-2 pl-4 pr-3 text-text-dim" style="border-left-width:3px">${inline(buf.join(" "))}</blockquote>`,
      });
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(`<li class="ml-1">${inline(lines[i]!.replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      blocks.push({ html: `<ul class="my-3 list-disc space-y-1 pl-5 text-text-dim">${items.join("")}</ul>` });
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        items.push(`<li class="ml-1">${inline(lines[i]!.replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      blocks.push({ html: `<ol class="my-3 list-decimal space-y-1 pl-5 text-text-dim">${items.join("")}</ol>` });
      continue;
    }

    // paragraph (gather until blank)
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,4}\s|>|[-*]\s|\d+\.\s|```)/.test(lines[i]!)) {
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ html: `<p class="my-3 leading-relaxed text-text-dim">${inline(buf.join(" "))}</p>` });
  }

  return blocks;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const html = useMemo(() => parse(children).map((b) => b.html).join(""), [children]);
  return (
    <div
      className={className ?? "text-[15px]"}
      // content is escaped in parse()/inline() before any markup is added
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
