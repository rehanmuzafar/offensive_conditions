"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, Preload } from "@react-three/drei";
import * as THREE from "three";
import CurvedGrid from "./CurvedGrid";
import DataBackdrop from "./DataBackdrop";
import DustField from "./DustField";
import GlassSkull from "./GlassSkull";
import FrameLimiter from "./FrameLimiter";
import Lighting from "./Lighting";
import Rig from "./Rig";
import SceneDrivers from "./SceneDrivers";

/**
 * The scene, cut down for surfaces that are not the landing page.
 *
 * The full landing scene is a marketing object: a bowed grid, a scrolling data
 * field, a rain-covered pane and a glass skull, all redrawn twice a frame
 * because transmission renders the scene into its own buffer. That is the right
 * budget for a front door and the wrong one for a workspace.
 *
 * `RainGlass` is never included: it is a full-screen shader pass on top of
 * everything and its droplets fight small type. Everything else is a switch,
 * because three surfaces want three different mixtures:
 *
 *   sign-in    skull (facing forward), grid, motes, full wake
 *   dashboard  skull (turning with the pointer), grid, motes, full wake
 *   CTF        no skull, matrix field on, grid, motes, wake at 5%
 *
 * The CTF setting is the interesting one. Those pages are read under time
 * pressure, so the scene has to be atmosphere and nothing else — no object
 * moving through the content, and a pointer wake turned down far enough that it
 * registers at the edge of attention rather than pulling the eye off a
 * scoreboard.
 */
function ReadyGate({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    const id = requestAnimationFrame(onReady);
    return () => cancelAnimationFrame(id);
  }, [onReady]);
  return null;
}

export default function AmbientScene({
  className,
  anchor,
  skull = true,
  faceForward = true,
  matrix = false,
  wakeGain = 1,
}: {
  className?: string;
  /** Where the skull sits, in world units. See GlassSkull. */
  anchor?: [number, number, number];
  /** Include the glass skull. Off for surfaces the object would sit on top of. */
  skull?: boolean;
  /** Keep the skull square to camera rather than letting the pointer turn it. */
  faceForward?: boolean;
  /** The scrolling glyph field — "matrix" — behind everything. */
  matrix?: boolean;
  /** Pointer-wake strength, 0..1. */
  wakeGain?: number;
}) {
  // Same three tiers as the landing scene: off (no scene), mid (cheaper glass
  // transmission, native dpr, no multisampling), high (unchanged).
  const [tier, setTier] = useState<"off" | "low" | "mid" | "high">("high");
  const [, setReady] = useState(false);

  useEffect(() => {
    const probe = document.createElement("canvas");
    const hasWebGL2 = !!probe.getContext("webgl2");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const cores = navigator.hardwareConcurrency ?? 8;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;

    if (!hasWebGL2 || reduced) {
      setTier("off");
    } else if (cores <= 2 || mem <= 2) {
      setTier("low");
    } else if (cores <= 4 || mem <= 4 || coarse) {
      setTier("mid");
    } else {
      setTier("high");
    }
  }, []);

  if (tier === "off") return null;

  const high = tier === "high";

  return (
    <div aria-hidden className={className ?? "pointer-events-none fixed inset-0 -z-10"}>
      <Canvas
        dpr={high ? [1, 1.35] : [1, 1]}
        frameloop="demand"
        gl={{
          antialias: high,
          alpha: true,
          powerPreference: "high-performance",
          stencil: false,
        }}
        camera={{ position: [0, 0, 6.4], fov: 38, near: 0.1, far: 60 }}
        performance={{ min: 0.4 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          // Transparent clear: the ambient scene sits over whatever ground the
          // page already paints, instead of owning the background itself.
          gl.setClearColor("#000000", 0);
        }}
      >
        <SceneDrivers />
        <FrameLimiter activeFps={60} idleFps={10} />
        <Suspense fallback={null}>
          <Lighting />
          {matrix && <DataBackdrop />}
          <CurvedGrid wakeGain={wakeGain} />
          <DustField />
          {skull && <GlassSkull mode="ambient" quality={tier} anchor={anchor} faceForward={faceForward} />}
          <Preload all />
        </Suspense>
        <Rig />
        <ReadyGate onReady={() => setReady(true)} />
        <AdaptiveDpr pixelated={false} />
      </Canvas>
    </div>
  );
}
