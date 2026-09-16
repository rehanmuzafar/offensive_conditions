/**
 * The structured-data graph.
 *
 * Structured data does not rank a page by itself. What it does is let Google
 * resolve "OFFCON" to an entity rather than a string, which is the difference
 * between a brand search returning a plain blue link and returning a knowledge
 * panel with the logo, the sitelinks and the social profiles attached. For a
 * domain nobody has heard of yet, that entity resolution is most of the early
 * win available.
 *
 * Everything is emitted as one `@graph` per page rather than as a scatter of
 * separate `<script>` blocks. Nodes in a graph can reference each other by
 * `@id` — the event points at the organiser, the breadcrumb points at the page
 * — and a parser that sees the relationships gets a far more confident reading
 * than one handed three unrelated objects. The `@id` values are URLs with a
 * fragment, which is the convention Google's own examples use.
 */

import { SITE, SOCIAL_PROFILES, absolute } from "./config";
import type { PublicEvent, PublicMachine, PublicPath } from "./public-data";

/** Stable node identities, so nodes can point at each other across pages. */
export const ID = {
  organization: `${SITE.url}/#organization`,
  website: `${SITE.url}/#website`,
  logo: `${SITE.url}/#logo`,
};

type Node = Record<string, unknown>;

/**
 * The publisher. `EducationalOrganization` rather than plain `Organization`
 * because that is what the product is — it teaches a skill and issues
 * completion certificates — and the more specific type is the one that can
 * surface in the education-flavoured result treatments.
 */
export function organizationNode(): Node {
  return {
    "@type": ["Organization", "EducationalOrganization"],
    "@id": ID.organization,
    name: SITE.fullName,
    alternateName: SITE.name,
    url: SITE.url,
    description: SITE.tagline,
    foundingDate: SITE.founded,
    email: SITE.email,
    logo: {
      "@type": "ImageObject",
      "@id": ID.logo,
      url: absolute("/offcon-mark.png"),
      contentUrl: absolute("/offcon-mark.png"),
      caption: SITE.fullName,
    },
    image: { "@id": ID.logo },
    ...(SOCIAL_PROFILES.length ? { sameAs: SOCIAL_PROFILES } : {}),
    knowsAbout: [
      "Offensive security",
      "Penetration testing",
      "Capture The Flag",
      "Bug bounty hunting",
      "Ethical hacking",
      "Red teaming",
      "Cybersecurity training",
    ],
  };
}

/**
 * The site itself, carrying the search action.
 *
 * `SearchAction` is what produces a search box inside the brand result. It is
 * only honoured when the target URL actually performs a search, so this points
 * at the machines catalogue's own query parameter rather than at a
 * search endpoint that does not exist — a target that 404s gets the whole node
 * ignored.
 */
export function websiteNode(): Node {
  return {
    "@type": "WebSite",
    "@id": ID.website,
    url: SITE.url,
    name: SITE.fullName,
    alternateName: SITE.name,
    description: SITE.tagline,
    publisher: { "@id": ID.organization },
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absolute("/hacking-labs?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** A single page node, tying the page to the site and the publisher. */
export function webPageNode(path: string, name: string, description: string): Node {
  const url = absolute(path);
  return {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    isPartOf: { "@id": ID.website },
    about: { "@id": ID.organization },
    inLanguage: "en",
  };
}

/**
 * Breadcrumbs.
 *
 * Worth emitting even on a two-level site: Google replaces the raw URL in the
 * result with the breadcrumb trail, which reads better and is one of the few
 * structured-data effects visible without any rich-result treatment at all.
 */
export function breadcrumbNode(trail: { name: string; path: string }[]): Node {
  return {
    "@type": "BreadcrumbList",
    "@id": `${absolute(trail[trail.length - 1]?.path ?? "/")}#breadcrumb`,
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: absolute(step.path),
    })),
  };
}

/** FAQ block. Only ever emit this for questions actually rendered on the page —
 *  markup describing text the visitor cannot see is a manual-action offence. */
export function faqNode(qa: { q: string; a: string }[], path: string): Node {
  return {
    "@type": "FAQPage",
    "@id": `${absolute(path)}#faq`,
    mainEntity: qa.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** An item list, used by the catalogue pages to describe what they list. */
export function itemListNode(
  path: string,
  name: string,
  items: { name: string; path: string }[],
): Node {
  return {
    "@type": "ItemList",
    "@id": `${absolute(path)}#list`,
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: absolute(it.path),
    })),
  };
}

/**
 * A CTF event as a schema.org Event.
 *
 * `eventAttendanceMode: OnlineEventAttendanceMode` and a `VirtualLocation` are
 * both required for an online event — without them Google reads the missing
 * physical address as an incomplete Event and drops the node. `offers` is
 * emitted even for a free event, because an Event with no offer is not
 * eligible for the event treatment at all; a zero price is a valid offer.
 */
export function eventNode(e: PublicEvent): Node | null {
  if (!e.starts_at) return null;
  const path = `/ctf-competitions/${e.slug}`;
  const url = absolute(path);
  const price = (e.entry_fee_cents ?? 0) / 100;
  return {
    "@type": "Event",
    "@id": `${url}#event`,
    name: e.name,
    url,
    description: e.description ?? SITE.tagline,
    startDate: e.starts_at,
    ...(e.ends_at ? { endDate: e.ends_at } : {}),
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "VirtualLocation",
      url: absolute("/ctf-competitions"),
    },
    organizer: { "@id": ID.organization },
    performer: { "@id": ID.organization },
    isAccessibleForFree: price === 0,
    offers: {
      "@type": "Offer",
      url,
      price: price.toFixed(2),
      priceCurrency: e.currency ?? "USD",
      availability: "https://schema.org/InStock",
      category: price === 0 ? "Free" : "Paid",
    },
  };
}

/**
 * A learning track as a Course.
 *
 * `hasCourseInstance` carries the delivery mode; a Course without one is valid
 * but is not eligible for the course carousel, which is the only reason to
 * emit this node at all.
 */
export function courseNode(p: PublicPath): Node {
  const path = `/offensive-security-training/${p.slug}`;
  const url = absolute(path);
  return {
    "@type": "Course",
    "@id": `${url}#course`,
    name: p.name,
    url,
    description: p.description ?? SITE.tagline,
    provider: { "@id": ID.organization },
    educationalLevel: p.difficulty ?? undefined,
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      courseWorkload: p.estimated_hours ? `PT${Math.round(p.estimated_hours)}H` : undefined,
    },
    offers: {
      "@type": "Offer",
      category: "Subscription",
      url: absolute("/pricing"),
    },
  };
}

/** A vulnerable machine, described as a learning resource rather than a product —
 *  it is not something you buy on its own, so `Product` would invite a price. */
export function machineNode(m: PublicMachine): Node {
  const path = `/hacking-labs/${m.slug}`;
  const url = absolute(path);
  return {
    "@type": "LearningResource",
    "@id": `${url}#resource`,
    name: m.name,
    url,
    description: m.description ?? SITE.tagline,
    provider: { "@id": ID.organization },
    learningResourceType: "Hands-on lab",
    educationalLevel: m.difficulty ?? undefined,
    teaches: m.tags?.length ? m.tags.join(", ") : undefined,
    inLanguage: "en",
  };
}

/** Wrap nodes into the single graph a page emits. */
export function graph(...nodes: (Node | null | undefined)[]) {
  return {
    "@context": "https://schema.org",
    "@graph": nodes.filter(Boolean),
  };
}
