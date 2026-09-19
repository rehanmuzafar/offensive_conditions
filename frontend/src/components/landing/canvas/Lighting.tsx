"use client";

import { Environment, Lightformer } from "@react-three/drei";

/**
 * A hand-built environment instead of an HDRI preset.
 *
 * drei's `preset` values fetch an .hdr from a CDN at runtime, which means the
 * hero renders grey until a multi-megabyte download lands — and fails outright
 * offline. Four lightformers baked into a 256px cubemap give the glass the
 * long specular streaks it needs, cost nothing to ship, and are rendered once.
 */
export default function Lighting() {
  return (
    <>
      <ambientLight intensity={0.35} />
      {/* Key from upper-left, the direction the shield's bevel reads best from. */}
      <directionalLight position={[-4, 5, 4]} intensity={1.1} color="#dcd9ff" />
      {/* Cool rim from behind separates the silhouette from the grid. */}
      <directionalLight position={[3, -2, -5]} intensity={0.7} color="#7dd3fc" />

      <Environment resolution={256}>
        {/* Long vertical bars produce the stretched highlights that make an
            edge read as polished rather than merely bright. */}
        <Lightformer
          form="rect"
          intensity={3.2}
          color="#ffffff"
          position={[-5, 2, 4]}
          scale={[4, 12, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={2.0}
          color="#a78bfa"
          position={[5, -1, 3]}
          scale={[3, 10, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="circle"
          intensity={2.4}
          color="#67e8f9"
          position={[0, 6, -3]}
          scale={[6, 6, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="ring"
          intensity={1.6}
          color="#f0abfc"
          position={[2, -5, -2]}
          scale={[5, 5, 1]}
          target={[0, 0, 0]}
        />
      </Environment>
    </>
  );
}
