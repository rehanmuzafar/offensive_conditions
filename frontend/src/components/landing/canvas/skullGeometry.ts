import * as THREE from "three";

/**
 * The OFFCON skull, as solid geometry.
 *
 * Traced from the brand mark rather than sampled from it: the logo's skull is
 * a field of binary digits, which has no silhouette a mesh can use. What the
 * eye actually reads in that mark is four things — a wide rounded cranium, two
 * hexagonal eye badges, a small triangular nose, and the digits dripping off
 * the jaw like teeth. All four are built here as real contours, so the object
 * survives being rotated, lit and refracted, which a textured plane would not.
 *
 * The eyes and nose are holes rather than inset faces. Through a transmission
 * material an opening is far stronger than a dimple: the grid behind the object
 * reads sharp through the hole and smeared through the glass beside it, and
 * that contrast is what makes the whole thing look like an object with
 * thickness instead of a lit decal.
 *
 * Coordinate space: origin at the skull's centre, roughly 2 units wide and
 * 2.5 tall, y up. The mesh is recentred after extrusion anyway.
 */

/**
 * Where the eye badges sit, in pre-centred shape space. Exported because the
 * glow that shows through each socket has to line up with the hole to within
 * a pixel, and duplicating these numbers in the component is how that quietly
 * drifts the next time the silhouette is adjusted.
 */
export const EYE_ANCHORS = [
  { x: -0.45, y: 0.14 },
  { x: 0.45, y: 0.14 },
] as const;

export const EYE_RADIUS = 0.33;

/** The six corners of a pointy-top hexagon, walked clockwise from the top. */
export function hexCorners(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI / 2 - (i * Math.PI) / 3;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
}

/** Pointy-top hexagon, matching the eye badges in the mark. */
function hexPath(cx: number, cy: number, r: number) {
  const path = new THREE.Path();
  hexCorners(cx, cy, r).forEach((c, i) => {
    if (i === 0) path.moveTo(c.x, c.y);
    else path.lineTo(c.x, c.y);
  });
  path.closePath();
  return path;
}

/** The small triangular nasal opening, with softened corners. */
function nosePath(cx: number, cy: number, halfWidth: number, height: number) {
  const path = new THREE.Path();
  path.moveTo(cx, cy + height * 0.5);
  path.quadraticCurveTo(cx + halfWidth * 0.7, cy, cx + halfWidth, cy - height * 0.5);
  path.quadraticCurveTo(cx, cy - height * 0.34, cx - halfWidth, cy - height * 0.5);
  path.quadraticCurveTo(cx - halfWidth * 0.7, cy, cx, cy + height * 0.5);
  path.closePath();
  return path;
}

/**
 * The dripping lower edge. In the mark the teeth are columns of digits running
 * off the jaw at uneven lengths; here they are lobes on the outer contour
 * rather than separate holes, which keeps the silhouette a single closed path
 * and avoids the bevel pinching in the gaps between five thin slots.
 */
const DRIP_DEPTHS = [0.2, 0.3, 0.38, 0.29, 0.19];
const DRIP_WIDTH = 0.185;
const DRIP_GAP = 0.035;

/** Total width the drip row occupies. The jaw contour has to arrive at exactly
 *  ±half of this, or the path doubles back on itself and leaves a notch. */
const DRIP_SPAN =
  DRIP_DEPTHS.length * DRIP_WIDTH + (DRIP_DEPTHS.length - 1) * DRIP_GAP;

function addDrips(shape: THREE.Shape, jawY: number) {
  const count = DRIP_DEPTHS.length;
  let x = DRIP_SPAN / 2;

  for (const [i, depth] of DRIP_DEPTHS.entries()) {
    const left = x - DRIP_WIDTH;
    // A single cubic makes the lobe hang with a rounded tip; the control points
    // reach past the depth so the sides stay near-vertical where they meet the
    // jaw, which is what reads as a drip rather than a scallop.
    shape.bezierCurveTo(x, jawY - depth * 1.25, left, jawY - depth * 1.25, left, jawY);
    x = left;
    if (i < count - 1) {
      x -= DRIP_GAP;
      shape.lineTo(x, jawY);
    }
  }
}

/**
 * The silhouette on its own, in the XY plane. Exported separately from the
 * extruded mesh so the same outline can be reused flat — currently by the
 * offline shape check, and available for any 2D echo of the mark.
 */
export function createSkullShape() {
  const shape = new THREE.Shape();
  const JAW_Y = -0.66;

  // --- outer contour, clockwise from the crown ---
  shape.moveTo(0, 1.2);
  // right cranium
  shape.bezierCurveTo(0.62, 1.2, 1.02, 0.88, 1.02, 0.34);
  // temple into cheekbone — stays wide, the way the mark's head does
  shape.bezierCurveTo(1.02, 0.02, 0.96, -0.16, 0.9, -0.3);
  // taper to the jaw
  shape.bezierCurveTo(0.82, -0.46, 0.7, -0.57, 0.57, -0.61);
  shape.lineTo(DRIP_SPAN / 2, JAW_Y);

  addDrips(shape, JAW_Y);

  // mirror back up the left side
  shape.lineTo(-0.57, -0.61);
  shape.bezierCurveTo(-0.7, -0.57, -0.82, -0.46, -0.9, -0.3);
  shape.bezierCurveTo(-0.96, -0.16, -1.02, 0.02, -1.02, 0.34);
  shape.bezierCurveTo(-1.02, 0.88, -0.62, 1.2, 0, 1.2);
  shape.closePath();

  // --- openings ---
  for (const eye of EYE_ANCHORS) shape.holes.push(hexPath(eye.x, eye.y, EYE_RADIUS));
  shape.holes.push(nosePath(0, -0.34, 0.1, 0.26));

  return shape;
}

export function createSkullGeometry(scale = 1) {
  const geometry = new THREE.ExtrudeGeometry(createSkullShape(), {
    depth: 0.44,
    bevelEnabled: true,
    // Small enough to clear the narrowest feature — the 0.04 gaps between the
    // drips. A larger bevel folds through itself there and the normals invert.
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelOffset: 0,
    bevelSegments: 4,
    curveSegments: 18,
  });

  geometry.scale(scale, scale, scale);

  // Extrude builds forward from z=0 and the silhouette is not symmetric about
  // y, so recentre to make the mesh rotate about itself. The shift is recorded
  // because anything positioned in shape space (the eye glows) has to move by
  // the same amount to stay aligned.
  geometry.computeBoundingBox();
  const offset = geometry.boundingBox!.getCenter(new THREE.Vector3()).negate();
  geometry.translate(offset.x, offset.y, offset.z);
  geometry.computeVertexNormals();

  geometry.userData.centerOffset = offset;

  return geometry;
}
