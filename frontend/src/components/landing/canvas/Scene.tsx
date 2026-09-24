"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Preload } from "@react-three/drei";
import * as THREE from "three";
import CurvedGrid from "./CurvedGrid";
import DataBackdrop from "./DataBackdrop";
import DustField from "./DustField";
import RainGlass from "./RainGlass";
import GlassSkull from "./GlassSkull";
import FrameLimiter from "./FrameLimiter";
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
  // Four tiers. "off" is the CSS fallback, reserved for devices that genuinely
  // cannot run WebGL2 (or a reduced-motion request); everyone else keeps the
  // skull. "low" is the cheapest live scene (tiny transmission FBO, native dpr,
  // no rain-glass, no multisampling), "mid" a middle step, "high" the full
  // thing. The transmission FBO is essentially the whole cost, so shrinking it —
  // not dropping the scene — is what makes the skull show on a weak machine.
  const [tier, setTier] = useState<"off" | "low" | "mid" | "high">("high");

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const hasWebGL2 = !!canvas.getContext("webgl2");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const cores = navigator.hardwareConcurrency ?? 8;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;

    if (!hasWebGL2 || reduced) {
      setTier("off");
    } else if (cores <= 2 || mem <= 2) {
      setTier("low"); // genuinely low-end — still gets a (tiny) skull
    } else if (cores <= 4 || mem <= 4 || coarse) {
      setTier("mid"); // a phone or a light laptop
    } else {
      setTier("high");
    }
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
           the transmission buffer, once to screen), so cost is fragment-bound
           and scales with the square of the pixel ratio. High tier renders at
           full Retina 2x so the glass stays crisp; lighter tiers cap at 1x. The
           frame rate is held steady by FrameLimiter instead of trading the
           resolution away, so the scene never softens mid-view. */
        dpr={high ? [1, 2] : [1, 1]}
        gl={{
          antialias: high,
          alpha: false,
          powerPreference: "high-performance",
          stencil: false,
          depth: true,
        }}
        camera={{ position: [0, 0, 6.4], fov: 38, near: 0.1, far: 60 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.setClearColor("#000000", 1);
        }}
        /* Paints only when FrameLimiter asks, which caps the GPU. */
        frameloop="demand"
      >
        {/* Ahead of everything else in the frame loop — see SceneDrivers. */}
        <SceneDrivers />
        {/* Steady ~60fps whenever the tab is visible; nothing when it is hidden. */}
        <FrameLimiter activeFps={60} idleFps={60} />

        <Suspense fallback={null}>
          <Lighting />
          <CurvedGrid />
          <DataBackdrop />
          <DustField />
          <GlassSkull quality={tier} />
          {/* Last in the scene and depth-test disabled: the wet pane is on the
              viewer's side of everything. A full-screen pass, so it is dropped
              on the lighter tier. */}
          {high && <RainGlass />}
          <Preload all />
        </Suspense>
        <Rig />
        <ReadyFlag />
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
