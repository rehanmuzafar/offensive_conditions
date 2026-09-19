"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scroll, pointer } from "@/components/landing/lib/telemetry";
import { neon } from "@/components/landing/lib/palette";
import { NOISE } from "./glsl";

/**
 * The thing the glass actually refracts.
 *
 * Transmission materials are only as interesting as whatever is behind them —
 * against a flat black plate the hero would render as a grey blob. So this
 * plane sits just behind the skull carrying a procedural "packet dump":
 * blocks of hex-ish glyph noise scrolling in columns, streaked with spectral
 * bands.
 *
 * It is deliberately small and dim: a light box sized to the hero, not a
 * background. Seen directly it should barely register above black — all of
 * its brightness is meant to arrive *through* the glass, concentrated by
 * refraction. Turned up far enough to look good on its own, it floods the
 * page and the monochrome ground the whole design rests on is gone.
 *
 * Drawn additively rather than as an opaque plane. At this size it covers the
 * whole viewport, so an opaque version — even one that fades to black at the
 * edges — occludes the grid sitting further back entirely. Additive means its
 * dark regions contribute nothing and the grid reads straight through them.
 *
 * ## Why it does not visibly loop
 *
 * Every animated quantity here is either per-column or per-cell, and seeded by
 * a hash of its own coordinates. There is no `floor(uTime * k)` applied to the
 * whole field, which is the usual reason a glyph rain looks like a two-second
 * clip on repeat: one global step function makes every cell change at the same
 * instant, and the eye locks onto that beat immediately. Instead each cell
 * flips on its own clock and crossfades rather than snapping, and the row
 * energy is a blend of three drifts whose periods (7s, 11s, 19s) share no
 * common multiple short enough to notice. The field takes minutes to repeat and
 * has no beat at any point.
 */
const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uScroll;
  uniform vec2  uPointer;
  uniform float uIntensity;
  uniform float uCols;
  uniform float uRows;
  uniform vec3  uNeonLead;
  uniform vec3  uNeonTrail;

  varying vec2 vUv;

  ${NOISE}

  // A 5x7 glyph cell: on/off blocks that read as monospace text at a glance.
  float glyphCell(vec2 uv, vec2 cell, float seed) {
    vec2 g = fract(uv) * vec2(5.0, 7.0);
    vec2 gi = floor(g);
    float bit = hash(cell * 7.13 + gi * 1.77 + seed * 3.31);
    // Bias toward "off" so the field looks like sparse text, not static.
    float on = step(0.62, bit);
    // Slight inset so cells don't merge into a solid block.
    vec2 f = fract(g);
    float inset = step(0.12, f.x) * step(f.x, 0.88) * step(0.1, f.y) * step(f.y, 0.9);
    return on * inset;
  }

  void main() {
    vec2 uv = vUv;

    // Columns scroll downward at per-column speeds. The speeds are irrational
    // multiples of each other, so no two columns ever line back up.
    float colIndex = floor(uv.x * uCols);
    float colSeed = hash(vec2(colIndex, 3.0));
    float speed = 0.28 + colSeed * 1.35;
    float offset = uTime * speed * 0.055 + uScroll * (1.2 + hash(vec2(colIndex, 9.0)));

    vec2 textUv = vec2(uv.x * uCols, uv.y * uRows - offset * uRows * 0.35);
    vec2 cell = floor(textUv);

    // Each cell re-rolls its glyph on its own clock, and crossfades into the
    // next roll instead of snapping. The crossfade is short — a glyph should
    // still feel like it changed, not like it dissolved.
    float flickerRate = 0.4 + hash(cell + 17.0) * 0.9;
    float flicker = uTime * flickerRate + hash(cell + 5.0) * 10.0;
    float seed = floor(flicker);
    float blend = smoothstep(0.82, 1.0, fract(flicker));
    float glyph = mix(
      glyphCell(textUv, cell, seed),
      glyphCell(textUv, cell, seed + 1.0),
      blend
    );

    // Row energy: three drifts at 7s, 11s and 19s. A single drift would give
    // the field a pulse; three incommensurate ones give it weather.
    float e1 = noise(cell * 0.21 + vec2(uTime / 7.0, 0.0));
    float e2 = noise(cell * 0.09 - vec2(0.0, uTime / 11.0));
    float e3 = noise(cell * 0.37 + vec2(uTime / 19.0, uTime / 19.0));
    float rowEnergy = (e1 * 0.5 + e2 * 0.3 + e3 * 0.2);

    float brightness = 0.03 + pow(rowEnergy, 4.0) * 0.85;

    // Broad nebula wash so the refraction has large-scale colour to bend,
    // not just high-frequency speckle (which the glass would blur to grey).
    float n = noise(uv * 2.6 + vec2(uTime * 0.05, -uTime * 0.03));
    float n2 = noise(uv * 5.5 - vec2(uTime * 0.02, uTime * 0.04));

    // The wash rides the neon cycle rather than fixed hues, so the whole field
    // drifts through the palette with the rest of the scene.
    vec3 wash = mix(uNeonTrail * 0.55, uNeonLead * 0.65, n);
    wash = mix(wash, uNeonLead * 1.1, pow(n2, 3.0) * 0.5);
    wash *= 0.11 + n * 0.26;

    // Cursor acts as a light source over the data field.
    vec2 c = uv * 2.0 - 1.0;
    float lamp = 1.0 - smoothstep(0.0, 0.85, length(c - uPointer * vec2(0.55, 0.4)));
    wash += uNeonLead * pow(lamp, 2.5) * 0.34;

    // Glyphs read near-white so they survive being smeared by transmission;
    // the hottest ones pick up the accent.
    vec3 glyphColor = mix(vec3(0.72, 0.95, 0.85), uNeonLead + vec3(0.4), rowEnergy);

    vec3 col = wash + glyphColor * glyph * brightness;

    // Horizontal spectral streaks — this is what turns into the rainbow
    // fringing you see through the thick parts of the skull. Two layers at
    // different rates so the streaking never pulses on one beat either.
    float streakA = pow(noise(vec2(uv.y * 40.0, uTime * 0.17)), 8.0);
    float streakB = pow(noise(vec2(uv.y * 23.0, uTime * 0.09 + 40.0)), 6.0);
    col += uNeonLead * (streakA * 0.16 + streakB * 0.1);

    // Radial falloff rather than per-edge: the plane reads as a pool of light
    // centred behind the skull, with no straight borders to give it away.
    vec2 e = (uv - 0.5) * vec2(1.0, 1.35);
    float edge = 1.0 - smoothstep(0.14, 0.5, length(e));
    edge *= edge;

    gl_FragColor = vec4(col * uIntensity * edge, edge);
  }
`;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export default function DataBackdrop() {
  const material = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uIntensity: { value: 0.7 },
      // Coarser than the original 58x30. At that density the glyphs were a
      // fine speckle that transmission blurred straight into a flat wash;
      // bigger cells survive the refraction and read as characters.
      uCols: { value: 34 },
      uRows: { value: 18 },
      uNeonLead: { value: new THREE.Color(0.3, 0.4, 1) },
      uNeonTrail: { value: new THREE.Color(0.6, 0.4, 1) },
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
  });

  return (
    <mesh position={[0, 0, -3.4]} frustumCulled={false}>
      <planeGeometry args={[13, 9]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}
