"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, AdaptiveEvents, Preload } from "@react-three/drei";
import * as THREE from "three";
import CurvedGrid from "./CurvedGrid";
import DataBackdrop from "./DataBackdrop";
import DustField from "./DustField";
import RainGlass from "./RainGlass";
import GlassSkull from "./GlassSkull";
import Lighting from "./Lighting";
import Rig from "./Rig";
import SceneDrivers from "./SceneDrivers";
import { useUI } from "@/components/landing/lib/store";

/**
 * The persistent WebGL layer. Fixed behind the whole document — it is never
 * unmounted, never re-created per section, and the DOM simply scrolls over it.
 *
 * `pointer-events: none` matters: the canvas covers the viewport, and without
 * it every link on the page would be dead. That also means R3F never receives
 * pointer events and never raycasts, so all interaction is read from the
 * global pointer tracker instead.
 */
function ReadyFlag() {
  const setSceneReady = useUI((s) => s.setSceneReady);
  useEffect(() => {
    // One frame of slack so the flag flips after the first real paint, not
    // before it — otherwise the intro overlay lifts onto a blank canvas.
    const id = requestAnimationFrame(() => setSceneReady(true));
    return () => cancelAnimationFrame(id);
  }, [setSceneReady]);
  return null;
}

export default function Scene() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    // Bail out entirely where the effect would cost more than it gives:
    // no WebGL2, or a user who has asked for reduced motion.
    const canvas = document.createElement("canvas");
    const hasWebGL2 = !!canvas.getContext("webgl2");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Transmission renders the scene to an FBO every frame; on a 2-core
    // machine that is a slideshow, and a static page is the better product.
    const weak = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2;
    setEnabled(hasWebGL2 && !reduced && !weak);
  }, []);

  if (!enabled) {
    // Static stand-in: the same grid, drawn in CSS, so the page never looks
    // broken — just quieter.
    return (
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(76,29,149,0.25), transparent 70%), #000",
        }}
      />
    );
  }

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <Canvas
        /* Two full-screen shader planes are drawn twice per frame (once into
           the transmission buffer, once to screen), so cost is almost entirely
           fragment-bound and scales with the square of the pixel ratio. Capped
           below a Retina 2x for that reason; AdaptiveDpr walks it down further
           if the GPU cannot hold the frame. */
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          stencil: false,
          depth: true,
        }}
        camera={{ position: [0, 0, 6.4], fov: 38, near: 0.1, far: 60 }}
        /* Let AdaptiveDpr fall as far as 40% of the target before giving up —
           a soft-focus scene at 60fps beats a crisp one at 20. */
        performance={{ min: 0.4 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.setClearColor("#000000", 1);
        }}
        frameloop="always"
      >
        {/* Ahead of everything else in the frame loop — see SceneDrivers. */}
        <SceneDrivers />

        <Suspense fallback={null}>
          <Lighting />
          <CurvedGrid />
          <DataBackdrop />
          <DustField />
          <GlassSkull />
          {/* Last in the scene and depth-test disabled: the wet pane is on the
              viewer's side of everything. */}
          <RainGlass />
          <Preload all />
        </Suspense>
        <Rig />
        <ReadyFlag />
        {/* Drop resolution rather than frames when the GPU falls behind. */}
        <AdaptiveDpr pixelated={false} />
        <AdaptiveEvents />
      </Canvas>

      {/* Vignette. The scene is lit for the centre of the frame; without this
          the corners stay milky and the page loses the black ground that the
          type and the rules are drawn against. Cheaper and steadier here as a
          CSS overlay than as a post-processing pass. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 66% at 50% 46%, transparent 0%, rgba(0,0,0,0.38) 66%, rgba(0,0,0,0.85) 100%)",
        }}
      />
    </div>
  );
}
