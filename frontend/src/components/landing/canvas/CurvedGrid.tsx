"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { scroll, pointer } from "@/components/landing/lib/telemetry";
import { neon } from "@/components/landing/lib/palette";
import { rippleBuffer, RIPPLE_COUNT } from "@/components/landing/lib/ripples";
import { NOISE, WAKE } from "./glsl";

/**
 * The backdrop the whole page sits inside: a large plane bowed away from the
 * camera, ruled with a technical grid and crosshair ticks.
 *
 * The curvature is done in the vertex shader rather than by modelling a curved
 * surface, so the same geometry can breathe with scroll velocity. The grid
 * itself is drawn analytically in the fragment shader with `fwidth`-based
 * anti-aliasing — a texture would alias badly at the horizon where the
 * curvature compresses hundreds of cells into a few pixels.
 *
 * This is also the surface the pointer disturbs. The wake is computed in screen
 * space and used twice: once to displace the grid's own coordinates, which bends
 * the ruled lines the way a ripple bends a reflection, and once added to the
 * emitted light so the crests catch. Displacing the lines is what does the work
 * — a wake that only glowed would read as a torch beam, not as water.
 */
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBend;
  uniform float uWave;

  varying vec2 vUv;
  varying float vDepth;

  void main() {
    vUv = uv;

    vec3 p = position;

    // Barrel the plane away from centre on both axes. The squared falloff
    // keeps the middle almost flat so the hero object reads against a calm
    // area, while the edges wrap toward the camera.
    vec2 c = uv * 2.0 - 1.0;
    float bowl = (c.x * c.x) * 1.0 + (c.y * c.y) * 0.55;
    p.z -= bowl * uBend;

    // A slow travelling swell, amplitude driven by scroll velocity.
    p.z += sin(c.x * 3.1 + uTime * 0.35) * cos(c.y * 2.3 - uTime * 0.22) * uWave;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uCells;
  uniform float uOpacity;
  uniform vec2  uPointer;
  uniform float uScroll;
  uniform vec3  uNeonLead;
  uniform vec3  uNeonTrail;
  /* 1 = the marketing wake. Working surfaces turn this most of the way down:
     the effect should register at the edge of attention, not compete with a
     scoreboard that people are reading under time pressure. */
  uniform float uWakeGain;

  varying vec2 vUv;
  varying float vDepth;

  ${NOISE}
  ${WAKE}

  // Distance to the nearest cell edge, in cells — anti-aliased with fwidth so
  // the line stays one pixel wide no matter how compressed the cell is.
  float gridLine(vec2 uv, float cells, float thickness) {
    vec2 g = uv * cells;
    vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = min(d.x, d.y);
    return 1.0 - smoothstep(0.0, thickness, line);
  }

  // A '+' tick centred on every Nth intersection.
  float crosshair(vec2 uv, float cells, float size, float thickness) {
    vec2 g = uv * cells;
    vec2 f = fract(g) - 0.5;
    vec2 w = fwidth(g);
    float arm_x = (1.0 - smoothstep(0.0, thickness * w.x, abs(f.x))) *
                  (1.0 - smoothstep(size, size + w.y, abs(f.y)));
    float arm_y = (1.0 - smoothstep(0.0, thickness * w.y, abs(f.y))) *
                  (1.0 - smoothstep(size, size + w.x, abs(f.x)));
    return clamp(arm_x + arm_y, 0.0, 1.0);
  }

  void main() {
    vec2 screenUv = gl_FragCoord.xy / uResolution;

    // The disturbance, and its slope. The slope is what the surface is bent
    // by: a height field displaces nothing on its own, but its gradient is a
    // refraction direction. Sampled with finite differences because the wake
    // is a sum of rings with no closed-form derivative worth writing out.
    // Forward differences rather than central: the gradient is slightly biased
    // half a texel, which is invisible, and it costs three wake() calls per
    // pixel instead of five. wake() loops over every ripple slot, so that
    // difference is the single biggest cost in this shader.
    float h = wake(screenUv);
    float e = 1.5 / uResolution.y;
    vec2 slope = vec2(
      wake(screenUv + vec2(e, 0.0)) - h,
      wake(screenUv + vec2(0.0, e)) - h
    );

    vec2 uv = vUv + slope * 0.085;

    // Fine grid, a coarser grid every 4 cells, and ticks every 8.
    float fine   = gridLine(uv, uCells, 1.2) * 0.42;
    float coarse = gridLine(uv, uCells * 0.25, 1.6) * 0.78;
    float ticks  = crosshair(uv, uCells * 0.125, 0.07, 1.4) * 0.9;

    float ink = max(max(fine, coarse), ticks);

    // Depth haze: the far edges of the bowl dissolve instead of hard-stopping.
    // The near bound sits past the plane's own distance from camera, so the
    // centre of the grid is not already half-faded before the bowl starts.
    float haze = 1.0 - smoothstep(14.0, 40.0, vDepth);

    // Vignette against the plane's own uv, so corners never fight the content.
    vec2 c = vUv * 2.0 - 1.0;
    float vignette = 1.0 - smoothstep(0.55, 1.35, length(c));

    // A soft pool of light that follows the cursor — the only thing on this
    // plane that reacts to input, and the reason the grid feels physical.
    vec2 lightPos = uPointer * vec2(0.42, 0.30);
    float glow = 1.0 - smoothstep(0.0, 0.62, length(c * vec2(1.0, 0.62) - lightPos));
    glow = pow(glow, 2.2);

    float alpha = ink * haze * vignette * uOpacity * (0.55 + glow * 1.5);

    // Neutral ground, pushed toward the current neon colour where the light
    // pools. The cycle lives in the glow rather than in the base grey so the
    // page still reads as monochrome with one accent, not as a rainbow.
    vec3 col = mix(vec3(0.72, 0.73, 0.78), uNeonLead, glow * 0.75);

    // A scan band drifting with scroll, borrowed from CRT calibration charts.
    float band = smoothstep(0.0, 0.02, abs(fract(vUv.y * 2.0 - uScroll * 1.5 - uTime * 0.02) - 0.5) - 0.48);
    col += vec3(0.35) * band * ink * 0.6;

    // Crests of the wake catch the trailing neon, so the disturbance is a
    // different colour from the pool of light it moves through. Held well below
    // the grid's own brightness: the wake should read as the surface being
    // disturbed, not as a light source following the cursor.
    float crest = max(h, 0.0);
    col += uNeonTrail * crest * 1.7 * uWakeGain;
    alpha += crest * ink * 1.0 * haze * uWakeGain;
    // The trough shows too, so a ring reads as a full wave rather than a rim.
    alpha += abs(h) * 0.06 * haze * vignette * uWakeGain;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export default function CurvedGrid({ wakeGain = 1 }: { wakeGain?: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const size = useThree((s) => s.size);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBend: { value: 7.5 },
      uWave: { value: 0.0 },
      uCells: { value: 96 },
      uOpacity: { value: 0.62 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uScroll: { value: 0 },
      uNeonLead: { value: new THREE.Color(0.3, 0.4, 1) },
      uNeonTrail: { value: new THREE.Color(0.6, 0.4, 1) },
      uRipples: { value: rippleBuffer },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 },
      uWakeGain: { value: 1 },
    }),
    [],
  );

  useFrame((_, dt) => {
    /* three keeps the very object handed to `uniforms`, so this cast is not
       hiding anything — it restores the concrete shape that ShaderMaterial's
       index signature erases. Without it `noUncheckedIndexedAccess` makes every
       uniform `possibly undefined` and the frame loop fills with guards. */
    const u = material.current?.uniforms as typeof uniforms | undefined;
    if (!u) return;

    u.uTime.value += dt;
    u.uScroll.value = scroll.progress;
    u.uPointer.value.set(pointer.smooth.x, pointer.smooth.y);
    u.uNeonLead.value.setRGB(neon.lead[0], neon.lead[1], neon.lead[2]);
    u.uNeonTrail.value.setRGB(neon.trail[0], neon.trail[1], neon.trail[2]);
    u.uWakeGain.value = wakeGain;

    // Fast scrolling ripples the plane; it settles the moment you stop.
    const target = Math.min(0.55, Math.abs(scroll.velocity) * 0.012);
    u.uWave.value += (target - u.uWave.value) * Math.min(1, dt * 3);
  });

  useFrame(({ gl }) => {
    const u = material.current?.uniforms as typeof uniforms | undefined;
    if (!u) return;
    // Drawing-buffer pixels, not CSS pixels: gl_FragCoord is in the former.
    const dpr = gl.getPixelRatio();
    u.uResolution.value.set(size.width * dpr, size.height * dpr);
    u.uAspect.value = size.width / Math.max(1, size.height);
  });

  return (
    <mesh position={[0, 0, -9]} frustumCulled={false}>
      {/* Enough segments to bend smoothly, no more — the curvature is a broad
          bowl, and 16k vertices bought nothing over 6k. */}
      <planeGeometry args={[52, 30, 96, 60]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        // RIPPLE_COUNT sizes a uniform array, so it has to be a compile-time
        // constant in the shader rather than a uniform of its own.
        defines={{ RIPPLE_COUNT }}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
