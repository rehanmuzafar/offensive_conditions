"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import type { MeshPhysicalMaterial } from "three";
import * as THREE from "three";
import {
  createSkullGeometry,
  hexCorners,
  EYE_ANCHORS,
  EYE_RADIUS,
} from "./skullGeometry";
import { scroll, pointer, heroTelemetry, damp, range } from "@/components/landing/lib/telemetry";
import { transition, PHASE_MS } from "@/components/landing/lib/transition";
import { verdict } from "@/components/landing/lib/verdict";

/**
 * The hero: the OFFCON skull cut from glass, tumbling on a scroll timeline.
 *
 * Two things make it read as a real object rather than a spinning logo:
 *
 *  1. Orientation is a *quaternion slerped between keyframes*, not three Euler
 *     angles. Eulers gimbal-lock on the pass where the shield turns edge-on to
 *     camera, which produces a visible snap right at the moment the dispersion
 *     is most dramatic.
 *  2. The pointer contributes a small extra rotation on top of the scroll
 *     pose, damped, so the object keeps moving when the page is still.
 *
 * A wireframe copy sits at a slight scale offset and lags the solid by a few
 * frames, which gives the silhouette a ghost the way a hard-edged solid never
 * would.
 *
 * The eye badges are separate meshes rather than children of the skull: drei
 * hides the transmission mesh while rendering its refraction buffer, and
 * anything parented to it is hidden along with it — the badges would then be
 * missing from exactly the reflection that makes them worth having. They are
 * siblings whose transform is copied from the skull each frame instead, and
 * they depth-test against it, so the skull's front face occludes them
 * everywhere except through the sockets.
 */

type Keyframe = {
  /** Scroll progress this pose is anchored at. */
  at: number;
  /** Euler angles (radians) — converted to quaternions once, up front. */
  rotation: [number, number, number];
  position: [number, number, number];
  scale: number;
};

/**
 * The choreography. Positions are in world units with the camera at z=6;
 * roughly, x=±2.2 parks the shield against the left/right edge at this fov.
 */
const TIMELINE: Keyframe[] = [
  { at: 0.0, rotation: [0.12, -0.35, 0], position: [0.35, -0.55, -0.4], scale: 1.02 },
  { at: 0.13, rotation: [0.35, Math.PI * 0.85, 0.12], position: [1.75, 0.1, -0.6], scale: 1.0 },
  { at: 0.3, rotation: [-0.28, Math.PI * 1.9, -0.34], position: [-1.9, -0.25, -0.2], scale: 1.1 },
  { at: 0.47, rotation: [0.62, Math.PI * 2.9, 0.5], position: [1.55, 0.35, 0.6], scale: 0.85 },
  { at: 0.63, rotation: [-0.15, Math.PI * 3.85, -0.18], position: [-1.35, 0.0, -1.4], scale: 1.45 },
  { at: 0.8, rotation: [0.25, Math.PI * 4.9, 0.08], position: [1.2, -0.35, 0.2], scale: 1.05 },
  { at: 1.0, rotation: [0, Math.PI * 6, 0], position: [0, 0.05, -1.2], scale: 1.7 },
];

/** drei's transmission material extends MeshPhysicalMaterial with its own
 *  uniforms exposed as plain properties. It is reached through the mesh rather
 *  than through a ref on the component: the component's ref type is written
 *  for JSX props, not for the instance, so a ref would need a cast anyway. */
type TransmissionMaterial = MeshPhysicalMaterial & {
  chromaticAberration: number;
  distortion: number;
  temporalDistortion: number;
};

/**
 * `scroll` drives the pose from the page's scroll timeline — the landing page.
 * `ambient` holds the opening pose and lets the pointer do all the work, for
 * surfaces with nothing to scroll (sign-in) or where scrolling belongs to the
 * content rather than to the scene (the dashboard).
 */
export type SkullMode = "scroll" | "ambient";

export default function GlassSkull({
  mode = "scroll",
  anchor,
  faceForward = true,
}: {
  mode?: SkullMode;
  /**
   * Ambient mode only. `true` keeps the mark square to camera and lets the
   * pointer add no more than a slight tilt — right for a sign-in page, where
   * the mark should keep facing the person using it. `false` lets the pointer
   * actually turn it, which is what makes it feel like an object you can push
   * around rather than a logo pinned to the wall.
   */
  faceForward?: boolean;
  /**
   * Where the object sits in ambient mode, in world units. Without it the pose
   * still comes from the scroll timeline, whose opening keyframes drift to the
   * right — which put the skull directly behind the sign-in form. Anything that
   * has a column of content to stay clear of should pass its own anchor.
   */
  anchor?: [number, number, number];
}) {
  const solid = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.LineSegments>(null);
  const badges = useRef<THREE.Group>(null);
  /** Eye badge materials, so a verdict can recolour them without a re-render. */
  const eyeMaterials = useRef<THREE.Material[]>([]);

  const geometry = useMemo(() => createSkullGeometry(1), []);
  // EdgesGeometry off the solid rather than the flat silhouette: it picks up
  // the bevel too, so the ghost has the same faceting as the object it trails.
  // A 30° threshold keeps it to the real creases — the sockets, the drips and
  // the extrusion edge — instead of wireframing every bevel ring.
  const outline = useMemo(() => new THREE.EdgesGeometry(geometry, 30), [geometry]);

  /**
   * Ring and fill for the two badges, in the geometry's own space. The mark
   * uses a silver outline around the 0 and a solid violet plate behind the X;
   * that asymmetry is the most recognisable thing about it at a glance, so it
   * is reproduced rather than averaged into two matching eyes.
   */
  const eyes = useMemo(() => {
    const shift = (geometry.userData.centerOffset as THREE.Vector3) ?? new THREE.Vector3();

    return EYE_ANCHORS.map((anchor, i) => {
      const inset = EYE_RADIUS * 0.84;
      const corners = hexCorners(0, 0, inset);
      const points = corners.map((c) => new THREE.Vector3(c.x, c.y, 0));

      const ring = new THREE.BufferGeometry().setFromPoints(points);

      const shape = new THREE.Shape();
      corners.forEach((c, j) => (j === 0 ? shape.moveTo(c.x, c.y) : shape.lineTo(c.x, c.y)));
      shape.closePath();
      const plate = new THREE.ShapeGeometry(shape);

      return {
        ring,
        plate,
        filled: i === 1,
        color: i === 1 ? "#A855F7" : "#E8E8F2",
        // Mid-thickness rather than behind the skull, so the badge reads from
        // either face and never floats outside the silhouette when it turns.
        position: [anchor.x + shift.x, anchor.y + shift.y, 0] as [number, number, number],
      };
    });
  }, [geometry]);

  useEffect(
    () => () => {
      geometry.dispose();
      outline.dispose();
      for (const eye of eyes) {
        eye.ring.dispose();
        eye.plate.dispose();
      }
    },
    [geometry, outline, eyes],
  );

  // Pre-baked quaternions for each keyframe.
  const poses = useMemo(
    () =>
      TIMELINE.map((k) => ({
        at: k.at,
        quaternion: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(k.rotation[0], k.rotation[1], k.rotation[2], "XYZ"),
        ),
        position: new THREE.Vector3(...k.position),
        scale: k.scale,
      })),
    [],
  );

  // Scratch objects — allocating inside useFrame would churn the GC at 60fps.
  const scratch = useMemo(
    () => ({
      quat: new THREE.Quaternion(),
      pointerQuat: new THREE.Quaternion(),
      targetQuat: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      pos: new THREE.Vector3(),
      current: new THREE.Vector3(),
      /* Square-to-camera, used by the sign-in dive. */
      identity: new THREE.Quaternion(),
    }),
    [],
  );

  const smoothScale = useRef(TIMELINE[0]!.scale);
  const fpsAccum = useRef({ frames: 0, elapsed: 0 });

  useFrame((_, dt) => {
    const mesh = solid.current;
    if (!mesh) return;

    // In ambient mode the timeline is pinned near its start and a slow drift
    // stands in for scroll, so the object is never completely still.
    const p =
      mode === "ambient"
        ? 0.04 + Math.sin(performance.now() / 9000) * 0.03
        : scroll.progress;

    // Find the segment of the timeline we're inside and slerp across it.
    // The bounds are read out of the array rather than asserted, because the
    // segment search is the one place a bad TIMELINE edit would go wrong
    // silently — an early return is a still hero, not a crash.
    let i = 0;
    while (i < poses.length - 2) {
      const next = poses[i + 1];
      if (!next || p <= next.at) break;
      i++;
    }
    const a = poses[i];
    const b = poses[i + 1];
    if (!a || !b) return;

    const t = range(p, a.at, b.at);
    // Smoothstep the segment parameter so keyframe boundaries don't show as
    // velocity discontinuities.
    const ts = t * t * (3 - 2 * t);

    if (mode === "ambient") {
      /**
       * Face front, always.
       *
       * Ambient mode used to take its rotation from the scroll timeline like
       * everything else, and that timeline's second keyframe yaws most of a
       * half-turn — so the slow ambient drift alone swung the skull to about 77°
       * and it ended up looking away from the viewer. On a sign-in page the mark
       * has to keep facing the person using it.
       *
       * So the base pose is identity and the pointer only ever adds a slight
       * tilt: enough that the object clearly answers the mouse, nowhere near
       * enough to turn the face away. The parallax that actually reads as
       * movement is in the position, below.
       */
      // A slow idle yaw so the object is never completely still even with the
      // pointer parked. Small enough that the face stays readable.
      const idle = faceForward ? 0 : Math.sin(performance.now() / 7000) * 0.5;
      const gain = faceForward ? 1 : 4.2;

      scratch.euler.set(
        -pointer.smooth.y * 0.11 * gain,
        pointer.smooth.x * 0.15 * gain + idle,
        pointer.smooth.x * -0.03 * gain,
        "XYZ",
      );
      scratch.targetQuat.copy(scratch.identity);
      scratch.pointerQuat.setFromEuler(scratch.euler);
      scratch.targetQuat.multiply(scratch.pointerQuat);

      /**
       * Reactions to a flag submission.
       *
       * These are written as extra rotation *on top of* the ambient pose rather
       * than as poses of their own, so the object never snaps: whatever it was
       * doing, it shakes or nods from there and returns to it. Both use a
       * decaying oscillation — the amplitude falls off across the reaction — for
       * the same reason a real head shake does: the first movement is the
       * emphatic one and the rest is it settling.
       */
      if (verdict.phase === "wrong" || verdict.phase === "correct") {
        const t = verdict.progress;
        const decay = Math.pow(1 - t, 2);

        if (verdict.phase === "wrong") {
          // "No": yaw, three passes, sharp.
          scratch.euler.set(0, Math.sin(t * Math.PI * 6) * 0.6 * decay, 0, "XYZ");
        } else {
          // "Yes": pitch, and only during the celebration beat — the spin that
          // follows must not fight a nod.
          const nod = Math.min(1, t / 0.45);
          scratch.euler.set(
            Math.sin(nod * Math.PI * 4) * 0.45 * Math.pow(1 - nod, 1.5),
            0,
            0,
            "XYZ",
          );
        }
        scratch.pointerQuat.setFromEuler(scratch.euler);
        scratch.targetQuat.multiply(scratch.pointerQuat);
      }
    } else {
      scratch.targetQuat.copy(a.quaternion).slerp(b.quaternion, ts);

      // Pointer tilt, layered on top of the scroll pose.
      scratch.euler.set(
        -pointer.smooth.y * 0.34,
        pointer.smooth.x * 0.45,
        pointer.smooth.x * -0.08,
        "XYZ",
      );
      scratch.pointerQuat.setFromEuler(scratch.euler);
      scratch.targetQuat.multiply(scratch.pointerQuat);
    }

    // Damped follow rather than a hard set — this is the whole reason the
    // object feels weighted instead of glued to the scrollbar.
    mesh.quaternion.slerp(scratch.targetQuat, 1 - Math.exp(-6 * dt));

    // Position, with a little pointer parallax and a scroll-velocity lead.
    if (mode === "ambient" && anchor) {
      scratch.pos.set(anchor[0], anchor[1], anchor[2]);
    } else {
      scratch.pos.copy(a.position).lerp(b.position, ts);
    }
    scratch.pos.x += pointer.smooth.x * 0.42;
    scratch.pos.y += pointer.smooth.y * 0.3 - scroll.velocity * 0.004;
    mesh.position.lerp(scratch.pos, 1 - Math.exp(-7 * dt));

    let targetScale = THREE.MathUtils.lerp(a.scale, b.scale, ts);

    /**
     * The correct-answer exit.
     *
     * After the nod it spins a full turn and rushes its own right eye socket
     * until the socket fills the frame — the same move the sign-in cinematic
     * ends on, reused deliberately: solving a challenge and getting in the front
     * door are the two moments the product treats as arrivals, and they should
     * rhyme. Fade is handled by the scene wrapper's opacity, not here, so the
     * mesh does not need a transparent material.
     */
    if (mode === "ambient" && verdict.phase === "correct") {
      const t = verdict.progress;
      const exit = range(t, 0.45, 1);

      // One full turn, eased so it accelerates into the dive.
      scratch.euler.set(0, exit * exit * Math.PI * 2, 0, "XYZ");
      scratch.pointerQuat.setFromEuler(scratch.euler);
      scratch.targetQuat.multiply(scratch.pointerQuat);

      const rush = exit * exit * exit;
      targetScale = THREE.MathUtils.lerp(targetScale, 24, rush);

      const eye = EYE_ANCHORS[1];
      if (eye) {
        scratch.pos.x -= eye.x * targetScale * rush * 0.92;
        scratch.pos.y -= eye.y * targetScale * rush * 0.92;
      }
    }

    /**
     * The dive. Once the sequence is running the pose stops taking orders from
     * the timeline: the skull swings square to camera and rushes it, aiming the
     * right eye socket at the centre of the frame so the last thing on screen
     * is the inside of the hole. Scale is driven off the phase clock rather than
     * off `transition.progress` so the ripple beat that precedes it does not eat
     * into the dive's runway.
     */
    if (transition.phase !== "idle") {
      const elapsed = performance.now() - transition.startedAt;
      const dive = range(elapsed, PHASE_MS.ripple, PHASE_MS.ripple + PHASE_MS.dive);
      // Ease-in: it hangs, then accelerates, which reads as being pulled in.
      const rush = dive * dive * dive;

      scratch.targetQuat.copy(scratch.identity);
      targetScale = THREE.MathUtils.lerp(a.scale, 26, rush);

      // Slide the socket to the centre as it grows, so the camera ends up
      // looking through it rather than past it.
      const eye = EYE_ANCHORS[1];
      if (eye) {
        scratch.pos.x -= eye.x * targetScale * rush * 0.92;
        scratch.pos.y -= eye.y * targetScale * rush * 0.92;
      }
      mesh.position.lerp(scratch.pos, 1 - Math.exp(-9 * dt));
    }

    const chasing = transition.phase !== "idle" || verdict.phase === "correct";
    smoothScale.current = damp(smoothScale.current, targetScale, chasing ? 11 : 6, dt);
    mesh.scale.setScalar(smoothScale.current);

    /**
     * Eye colour answers the verdict.
     *
     * Red on a wrong flag, blinking rather than steady — a steady red reads as
     * a status light, a blinking one reads as a reaction. On a correct answer
     * they run hot toward the accent. Written straight to the materials because
     * this changes every frame and must not re-render the tree.
     */
    if (eyeMaterials.current.length) {
      const t = verdict.progress;
      for (const [i, material] of eyeMaterials.current.entries()) {
        const m = material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
        if (verdict.phase === "wrong") {
          // ~4Hz square-ish blink, fading out as the shake settles.
          const blink = Math.sin(t * Math.PI * 8) > -0.2 ? 1 : 0.25;
          m.color.setRGB(1 * blink, 0.12 * blink, 0.16 * blink);
        } else if (verdict.phase === "correct") {
          m.color.setRGB(0.55 + t * 0.4, 1, 0.65 + t * 0.3);
        } else {
          // Back to the mark's own colours: silver left, violet right.
          if (i % 2 === 0) m.color.setRGB(0.91, 0.91, 0.95);
          else m.color.setRGB(0.66, 0.33, 0.97);
        }
      }
    }

    // The badges are rigidly locked to the skull — any lag here would show as
    // the eyes sliding out of their sockets.
    if (badges.current) {
      badges.current.quaternion.copy(mesh.quaternion);
      badges.current.position.copy(mesh.position);
      badges.current.scale.copy(mesh.scale);
    }

    // The ghost trails: same pose, fractionally larger, one damp constant slower.
    if (ghost.current) {
      ghost.current.quaternion.slerp(mesh.quaternion, 1 - Math.exp(-2.4 * dt));
      ghost.current.position.lerp(mesh.position, 1 - Math.exp(-3 * dt));
      ghost.current.scale.setScalar(smoothScale.current * 1.045);
    }

    // Material response. The glass thickens through the middle of the page
    // and frosts slightly under fast scrolling, which reads as the object
    // resisting the motion. These are written to the material first and
    // published to the HUD second, so the readout is reporting the scene
    // rather than narrating alongside it.
    const thickness = 1.2 + Math.abs(Math.sin(p * Math.PI * 2)) * 1.4;
    const roughness = 0.04 + Math.min(0.22, Math.abs(scroll.velocity) * 0.0018);
    const dispersion = 0.5 + Math.min(0.45, Math.abs(scroll.velocity) * 0.0035);

    const material = mesh.material as TransmissionMaterial;
    material.thickness = thickness;
    material.roughness = roughness;
    material.chromaticAberration = dispersion;

    const q = mesh.quaternion;
    heroTelemetry.quaternion = [q.x, q.y, q.z, q.w];
    heroTelemetry.thickness = thickness;
    heroTelemetry.roughness = roughness;
    heroTelemetry.dispersion = dispersion;

    // Frame counter. Single frames longer than 250ms are dropped rather than
    // averaged in: a tab switch, a devtools screenshot or a shader compile all
    // produce one enormous dt, and including it drags the reported rate to zero
    // for the next half second — which reads as "the page is broken" when the
    // page is fine.
    const f = fpsAccum.current;
    if (dt < 0.25) {
      f.frames += 1;
      f.elapsed += dt;
    }
    if (f.elapsed >= 0.5) {
      heroTelemetry.fps = Math.round(f.frames / f.elapsed);
      f.frames = 0;
      f.elapsed = 0;
    }
  });

  return (
    <group>
      <mesh ref={solid} geometry={geometry} castShadow={false} receiveShadow={false}>
        <MeshTransmissionMaterial
          /* These two numbers are the frame budget. Transmission re-renders the
             entire scene into an FBO at `resolution` every frame and then takes
             `samples` blur taps through it, so cost scales with both. This is a
             middle setting: 768/8 is visibly crisper through the sockets, 384/4
             is materially cheaper, and neither has been measured on real
             hardware here. Tune it against the fps readout in the HUD — and
             take that reading with the tab focused, since a background tab has
             its animation frames throttled to near zero and will report single
             digits no matter what these are set to. */
          samples={6}
          resolution={512}
          transmission={1}
          thickness={1.2}
          roughness={0.04}
          ior={1.62}
          /* The dispersion budget. Pushed well past physical values because
             the whole colour story of the page comes off this edge. */
          chromaticAberration={0.5}
          /* Kept low on purpose. Anisotropic blur is what turns a transmission
             material into frosted acrylic: past ~0.1 it smears the refracted
             image into a milky slab and the dispersion — the entire colour
             story of this page — disappears with it. */
          anisotropicBlur={0.05}
          distortion={0.14}
          distortionScale={0.28}
          temporalDistortion={0.06}
          clearcoat={1}
          clearcoatRoughness={0.08}
          attenuationDistance={0.85}
          attenuationColor="#c8b4ff"
          color="#ffffff"
          background={new THREE.Color("#000000")}
          toneMapped={false}
        />
      </mesh>

      <group ref={badges}>
        {eyes.map((eye, i) => (
          <group key={i} position={eye.position}>
            {eye.filled && (
              <mesh geometry={eye.plate}>
                <meshBasicMaterial
                  ref={(m) => {
                    if (m) eyeMaterials.current.push(m);
                  }}
                  color={eye.color}
                  transparent
                  opacity={0.55}
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                  side={THREE.DoubleSide}
                  toneMapped={false}
                />
              </mesh>
            )}
            <lineLoop geometry={eye.ring}>
              <lineBasicMaterial
                ref={(m) => {
                  if (m) eyeMaterials.current.push(m);
                }}
                color={eye.color}
                transparent
                opacity={0.95}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </lineLoop>
          </group>
        ))}
      </group>

      <lineSegments ref={ghost} geometry={outline} frustumCulled={false}>
        <lineBasicMaterial
          color="#8B5CF6"
          transparent
          opacity={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
