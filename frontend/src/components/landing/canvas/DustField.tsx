"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scroll, pointer } from "@/components/landing/lib/telemetry";

/**
 * Sparse motes drifting through the volume. Their only job is parallax: with
 * nothing between the camera and the backdrop, moving the mouse produces no
 * sense of depth, and the scene reads as a flat image of a 3D render.
 *
 * Drawn as a single Points object with a procedural round sprite — a texture
 * would be one more asset for ~1px dots, and gl_PointCoord is free.
 */
const COUNT = 420;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform vec2  uPointer;
  uniform float uPixelRatio;

  attribute float aScale;
  attribute float aSpeed;
  attribute float aPhase;

  varying float vAlpha;

  void main() {
    vec3 p = position;

    // Slow vertical drift that wraps, plus a lateral sway per-mote.
    p.y = mod(p.y + uTime * aSpeed * 0.12 + uScroll * 6.0 * aSpeed, 14.0) - 7.0;
    p.x += sin(uTime * 0.3 * aSpeed + aPhase) * 0.28;

    // Depth-scaled pointer parallax: near motes travel further than far ones.
    float depth = (p.z + 6.0) / 8.0;
    p.xy += uPointer * (0.35 + depth * 0.9);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Perspective-correct point size.
    gl_PointSize = aScale * uPixelRatio * (60.0 / -mv.z);

    // Fade at the near and far limits so motes never pop in.
    vAlpha = smoothstep(0.0, 3.0, -mv.z) * (1.0 - smoothstep(9.0, 16.0, -mv.z));
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vAlpha;

  void main() {
    // Round sprite with a soft core.
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.18, 0.5, d);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.86, 0.87, 0.95), a * vAlpha * 0.32);
  }
`;

export default function DustField() {
  const material = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const scales = new Float32Array(COUNT);
    const speeds = new Float32Array(COUNT);
    const phases = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = -6 + Math.random() * 8;
      scales[i] = 0.4 + Math.random() * 1.1;
      speeds[i] = 0.4 + Math.random() * 1.6;
      phases[i] = Math.random() * Math.PI * 2;
    }

    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    g.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uPixelRatio: { value: 1 },
    }),
    [],
  );

  useFrame(({ gl }, dt) => {
    /* three keeps the very object handed to `uniforms`, so this cast is not
       hiding anything — it restores the concrete shape that ShaderMaterial's
       index signature erases. Without it `noUncheckedIndexedAccess` makes every
       uniform `possibly undefined` and the frame loop fills with guards. */
    const u = material.current?.uniforms as typeof uniforms | undefined;
    if (!u) return;
    u.uTime.value += dt;
    u.uScroll.value = scroll.progress;
    u.uPointer.value.set(pointer.smooth.x, pointer.smooth.y);
    u.uPixelRatio.value = gl.getPixelRatio();
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
