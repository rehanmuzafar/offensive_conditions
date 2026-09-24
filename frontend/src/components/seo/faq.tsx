/**
 * A visible FAQ, paired with the `FAQPage` node that describes it.
 *
 * The pairing is the point. Google's structured-data policy is explicit that
 * FAQ markup must describe question-and-answer text the visitor can actually
 * see on the page, and markup for hidden content is one of the few SEO
 * offences that draws a manual action rather than a quiet ranking loss. So the
 * same array feeds both the markup and the DOM, and there is no way to emit one
 * without the other.
 *
 * `<details>` rather than a JS accordion: the answer text is in the document
 * either way, so a crawler reads it whether or not the item is open, and the
 * open/close behaviour costs no JavaScript and stays keyboard-accessible on its
 * own.
 */

import { JsonLd } from "@/components/seo/json-ld";
import { faqNode, graph } from "@/lib/seo/jsonld";

export interface QA {
  q: string;
  a: string;
}

export function Faq({ items, path, title = "Questions" }: { items: QA[]; path: string; title?: string }) {
  return (
    <section className="mt-24">
      <JsonLd data={graph(faqNode(items, path))} />
      <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
        {title}
      </h2>
      <div className="mt-8 border-t border-line">
        {items.map((item) => (
          <details key={item.q} className="group border-b border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16px] font-medium text-text marker:hidden hover:text-accent">
              {item.q}
              <span
                aria-hidden
                className="shrink-0 text-[20px] leading-none text-text-faint transition-transform duration-200 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="prose-reading max-w-[760px] pb-6 text-[15px] leading-[1.75] text-text-dim">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
