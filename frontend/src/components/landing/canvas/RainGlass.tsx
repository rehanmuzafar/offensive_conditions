"use client";

import { useCallback, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { neon } from "@/components/landing/lib/palette";
import { rippleBuffer, RIPPLE_COUNT } from "@/components/landing/lib/ripples";
import { scroll } from "@/components/landing/lib/telemetry";
import { NOISE, WAKE, RAIN } from "./glsl";

/**
 * After the rain: a wet pane between the viewer and the scene.
 *
 * A quad locked to the camera, one unit in front of it and scaled to exactly
 * fill the frustum at that distance, so it always covers the view without ever
 * being something the camera can move around. Everything on it is in screen
 * space, which is what makes it read as being on the viewer's side of the glass
 * rather than as weather happening inside the scene.
 *
 * Because the drops are lit additively rather than by sampling what is behind
 * them, they are speculars and rim highlights, not true refractions — a real
 * lens would need the frame buffer as a texture and a second full-screen pass.
 * Each drop is shaded as a spherical cap (highlight on the light side, shadow
 * opposite, a tight specular dot) which is what makes it read as a bead of
 * glass rather than as a ring.
 *
 * The quad's transform is set in `onBeforeRender`, not in `useFrame`. That is
 * not a style choice: this component mounts before the rig, so its useFrame
 * callback runs first and would copy the camera's *previous* transform. The
 * resulting one-frame lag is invisible while the camera is still and reads as
 * the whole pane shaking during scroll, when the camera moves fastest.
 * `onBeforeRender` runs after every frame callback, immediately before the draw,
 * so the pane is always locked to the camera's final position.
 *
 * The pointer wake runs through here too, so dragging the cursor disturbs the
 * water on the pane as well as the grid behind it. That doubling is deliberate:
 * a ripple on only one of the two layers reads as a decal on that layer, while
 * the same disturbance on both reads as a single volume of water.
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uIntensity;
  uniform float uDensity;
  uniform vec3  uNeonLead;
  uniform vec3  uNeonTrail;

  varying vec2 vUv;

  ${NOISE}
  ${WAKE}
  ${RAIN}

  void main() {
    vec2 screenUv = gl_FragCoord.xy / uResolution;

    // Height only, no gradient. The pane used to displace its droplets by the
    // wake's slope, which cost three wake() calls per pixel instead of one — and
    // wake() loops over every ripple slot, so it was the most expensive thing in
    // this shader. The displacement it bought was 0.012 of a UV: invisible next
    // to the glint the height already gives. The grid behind still displaces,
    // which is where the effect actually reads.
    float h = wake(screenUv);
    vec2 uv = vUv;

    // A single pass. The drop radius is already heavy-tailed — most cells hold
    // a speck and a few hold a fat runner — so a second finer layer added
    // almost nothing visually while doubling the most expensive loop on the
    // page (nine cells sampled per pixel, full screen, every frame).
    // Light from the upper left, matching the scene's key.
    vec4 drops = rainDrops(uv * vec2(uAspect, 1.0), uTime, uDensity, normalize(vec2(-0.6, 0.8)));
    float coverage = drops.x;
    float rim = drops.y;
    float shade = drops.z;
    float spec = drops.w;

    // Drops pick up the neon from the scene behind them — they are lit by it,
    // so they have no colour of their own. The bright side of each bead runs
    // toward the lead colour, the shadowed side toward the trailing one.
    vec3 col = mix(uNeonTrail * 0.6, uNeonLead, shade);
    col = mix(col, vec3(1.0), rim * 0.4 + spec * 0.9);

    // A drop shows mostly where its rim bends light and where the highlight
    // catches. The body stays nearly invisible, which is why the pane reads as
    // wet rather than as dotted.
    float alpha = (rim * 0.42 + spec * 0.75 + coverage * 0.1) * uIntensity;

    // The wake itself glints on the wet pane.
    float crest = max(h, 0.0);
    col += uNeonLead * crest * 0.85;
    alpha += crest * 0.10;

    // A faint film so the whole pane feels slightly misted, heaviest at the
    // edges where a real pane holds the most water.
    vec2 c = vUv * 2.0 - 1.0;
    float film = smoothstep(0.35, 1.25, length(c)) * 0.035;
    alpha += film;
    col = mix(col, uNeonTrail, film * 4.0);

    if (alpha < 0.003) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/** How far in front of the camera the pane sits, in world units. */
const DISTANCE = 1;

export default function RainGlass() {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const size = useThree((s) => s.size);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uDensity: { value: 14 },
      uNeonLead: { value: new THREE.Color(0.3, 0.4, 1) },
      uNeonTrail: { value: new THREE.Color(0.6, 0.4, 1) },
      uRipples: { value: rippleBuffer },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 },
    }),
    [],
  );

  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ gl }, dt) => {
    /* three keeps the very object handed to `uniforms`, so this cast is not
       hiding anything — it restores the concrete shape that ShaderMaterial's
       index signature erases. Without it `noUncheckedIndexedAccess` makes every
       uniform `possibly undefined` and the frame loop fills with guards. */
    const u = material.current?.uniforms as typeof uniforms | undefined;
    if (!u) return;

    u.uTime.value += dt;
    u.uNeonLead.value.setRGB(neon.lead[0], neon.lead[1], neon.lead[2]);
    u.uNeonTrail.value.setRGB(neon.trail[0], neon.trail[1], neon.trail[2]);

    const dpr = gl.getPixelRatio();
    u.uResolution.value.set(size.width * dpr, size.height * dpr);
    u.uAspect.value = size.width / Math.max(1, size.height);

    // Rain thins out as the page descends — by the closing section the pane has
    // mostly dried, so the finale is not read through water.
    u.uIntensity.value = 0.72 - scroll.progress * 0.4;
  });

  /**
   * Lock the quad to the camera. Runs immediately before the draw call, so it
   * sees the camera after the rig has finished moving it this frame.
   */
  const lockToCamera = useCallback(
    (_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) => {
      const quad = mesh.current;
      if (!quad) return;

      camera.getWorldDirection(forward);
      quad.position.copy(camera.position).addScaledVector(forward, DISTANCE);
      quad.quaternion.copy(camera.quaternion);

      // Scale a unit quad to exactly the frustum cross-section at DISTANCE.
      const perspective = camera as THREE.PerspectiveCamera;
      const fov = (perspective.fov * Math.PI) / 180;
      const height = 2 * Math.tan(fov / 2) * DISTANCE;
      quad.scale.set(height * perspective.aspect, height, 1);

      // The matrix is normally computed during the scene traversal that has
      // already happened by now, so it has to be refreshed by hand.
      quad.updateMatrixWorld(true);
    },
    [forward],
  );

  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={10} onBeforeRender={lockToCamera}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        defines={{ RIPPLE_COUNT }}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}
