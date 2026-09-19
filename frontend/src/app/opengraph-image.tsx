/**
 * The share card, generated rather than drawn.
 *
 * The root metadata has claimed `twitter:card = summary_large_image` since the
 * site launched, with no image behind it — which is the worst of the available
 * states. A card that declares a large image and supplies none renders as a
 * bare text stub on every surface that honours the tag, so every link shared
 * to Twitter, LinkedIn, Slack, Discord or WhatsApp has been arriving as three
 * grey lines. Link previews are not a ranking factor directly, but the
 * click-through they buy on social and in chat is where a new domain's first
 * backlinks come from.
 *
 * Generated with `ImageResponse` so it stays in step with the brand tokens
 * instead of being a PNG somebody has to re-export whenever the palette moves.
 * Next renders it once at build and serves it as a static asset, so there is no
 * per-request cost.
 *
 * No custom font is loaded on purpose: `next/og` ships a default face, and
 * pulling one of the vendored woff2 files in would mean reading from the
 * filesystem at build time — which works locally and fails in the standalone
 * image, where only the traced files are present.
 */

import { ImageResponse } from "next/og";

import { BRAND } from "@/config/brand";

export const alt = `${BRAND.name} — ${BRAND.fullName}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#070710",
          padding: "72px 80px",
          position: "relative",
        }}
      >
        {/* The aurora, flattened to two radial washes. Satori supports
            background-image gradients but not filters, so the blur that the
            real page uses is baked into the colour stops instead. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background: `radial-gradient(900px 500px at 12% -10%, ${BRAND.gradient.purple}33, transparent 70%), radial-gradient(800px 460px at 96% 108%, ${BRAND.gradient.blue}2E, transparent 70%)`,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 62,
              height: 62,
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `linear-gradient(135deg, ${BRAND.gradient.purple}, ${BRAND.gradient.blue})`,
              fontSize: 34,
              fontWeight: 800,
              color: "#fff",
            }}
          >
            O
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 800,
              color: "#fff",
              letterSpacing: "0.18em",
            }}
          >
            {BRAND.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              fontSize: 82,
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
              maxWidth: 940,
            }}
          >
            Forge yourself in offensive security.
          </div>
          <div style={{ fontSize: 31, color: "#A3A3B8", maxWidth: 900, lineHeight: 1.35 }}>
            Live CTF competitions, vulnerable machines and real bug bounties.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #FFFFFF1F",
            paddingTop: 26,
          }}
        >
          <div style={{ fontSize: 25, color: "#6E6E85", letterSpacing: "0.06em" }}>
            {BRAND.siteUrl.replace(/^https?:\/\//, "")}
          </div>
          <div style={{ display: "flex", gap: 30, fontSize: 23, color: "#6E6E85" }}>
            <div style={{ display: "flex" }}>CTF</div>
            <div style={{ display: "flex" }}>LABS</div>
            <div style={{ display: "flex" }}>BUG BOUNTY</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
