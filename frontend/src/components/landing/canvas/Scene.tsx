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
  // Three tiers. "off" gets the CSS fallback; "mid" a materially cheaper scene
  // (half the transmission resolution, a quarter of the blur taps, no rain-glass
  // pass, no super-sampling, native dpr); "high" the full thing. The transmission
  // FBO is essentially the whole frame cost, so tuning it down is what makes the
  // page smooth on a laptop iGPU or a phone instead of dropping the scene.
  const [tier, setTier] = useState<"off" | "mid" | "high">("high");
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const hasWebGL2 = !!canvas.getContext("webgl2");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const cores = navigator.hardwareConcurrency ?? 8;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;

    if (!hasWebGL2 || reduced || cores <= 2 || mem <= 2 || (coarse && (cores <= 4 || mem <= 4))) {
      setTier("off"); // no WebGL2, reduced-motion, or genuinely low-end / weak phone
    } else if (cores <= 4 || mem <= 4 || coarse) {
      setTier("mid"); // capable but not a desktop GPU — a phone or a light laptop
    } else {
      setTier("high");
    }
  }, []);

  // A hidden or background tab renders nothing anyone can see; keep the GPU idle
  // there rather than burning a continuous transmission loop.
  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? "never" : "always");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (tier === "off") {
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

  const high = tier === "high";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <Canvas
        /* Two full-screen shader planes are drawn twice per frame (once into
           the transmission buffer, once to screen), so cost is almost entirely
           fragment-bound and scales with the square of the pixel ratio. Capped
           below a Retina 2x for that reason; AdaptiveDpr walks it down further
           if the GPU cannot hold the frame. */
        dpr={high ? [1, 1.5] : [1, 1]}
        gl={{
          antialias: high,
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
        frameloop={frameloop}
      >
        {/* Ahead of everything else in the frame loop — see SceneDrivers. */}
        <SceneDrivers />

        <Suspense fallback={null}>
          <Lighting />
          <CurvedGrid />
          <DataBackdrop />
          <DustField />
          <GlassSkull quality={high ? "high" : "mid"} />
          {/* Last in the scene and depth-test disabled: the wet pane is on the
              viewer's side of everything. A full-screen pass, so it is dropped
              on the lighter tier. */}
          {high && <RainGlass />}
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
