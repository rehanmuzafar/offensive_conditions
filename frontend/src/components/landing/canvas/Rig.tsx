"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { pointer, scroll, damp } from "@/components/landing/lib/telemetry";

/**
 * Camera motion.
 *
 * Two separate jobs, deliberately kept apart:
 *  - scroll dollies the camera along z and tips it slightly, which is what
 *    makes the grid open up as the page descends;
 *  - the pointer offsets the camera laterally and re-aims it at the origin,
 *    which is what produces true parallax between the dust, the shield and
 *    the grid (a rotation-only "look around" would not).
 *
 * Both are damped, and the damping is frame-rate independent, so a 120Hz
 * display doesn't get a twitchier camera than a 60Hz one.
 */
export default function Rig() {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const desired = useRef(new THREE.Vector3(0, 0, 6));

  useFrame((_, dt) => {
    const p = scroll.progress;

    // Pull back through the first half of the page, then push in for the
    // finale so the closing shield fills the frame.
    const z = 6.4 - Math.sin(p * Math.PI) * 1.4 - p * 0.6;
    const y = Math.sin(p * Math.PI * 2) * 0.35;

    desired.current.set(
      pointer.smooth.x * 0.85,
      y + pointer.smooth.y * 0.5,
      z,
    );

    camera.position.x = damp(camera.position.x, desired.current.x, 3.2, dt);
    camera.position.y = damp(camera.position.y, desired.current.y, 3.2, dt);
    camera.position.z = damp(camera.position.z, desired.current.z, 2.6, dt);

    // Aim slightly ahead of the pointer so the framing leads the motion.
    target.current.set(pointer.smooth.x * -0.25, pointer.smooth.y * -0.15, 0);
    camera.lookAt(target.current);

    // A whisper of roll tied to scroll velocity — sells momentum on flicks.
    camera.rotation.z = damp(
      camera.rotation.z,
      THREE.MathUtils.clamp(-scroll.velocity * 0.0006, -0.05, 0.05),
      4,
      dt,
    );
  });

  return null;
}
