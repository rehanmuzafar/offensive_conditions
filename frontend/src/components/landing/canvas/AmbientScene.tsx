"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, Preload } from "@react-three/drei";
import * as THREE from "three";
import CurvedGrid from "./CurvedGrid";
import DataBackdrop from "./DataBackdrop";
import DustField from "./DustField";
import GlassSkull from "./GlassSkull";
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
  const [enabled, setEnabled] = useState(true);
  const [, setReady] = useState(false);

  useEffect(() => {
    // Same capability gate as the landing: no WebGL2, reduced-motion, or a
    // machine with too few cores, and the scene simply does not appear.
    const probe = document.createElement("canvas");
    const hasWebGL2 = !!probe.getContext("webgl2");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const weak = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2;
    setEnabled(hasWebGL2 && !reduced && !weak);
  }, []);

  if (!enabled) return null;

  return (
    <div aria-hidden className={className ?? "pointer-events-none fixed inset-0 -z-10"}>
      <Canvas
        dpr={[1, 1.35]}
        gl={{
          antialias: true,
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
        <Suspense fallback={null}>
          <Lighting />
          {matrix && <DataBackdrop />}
          <CurvedGrid wakeGain={wakeGain} />
          <DustField />
          {skull && <GlassSkull mode="ambient" anchor={anchor} faceForward={faceForward} />}
          <Preload all />
        </Suspense>
        <Rig />
        <ReadyGate onReady={() => setReady(true)} />
        <AdaptiveDpr pixelated={false} />
      </Canvas>
    </div>
  );
}
