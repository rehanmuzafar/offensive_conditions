/**
 * GLSL fragments shared between the scene's shaders.
 *
 * These are strings rather than a chunk registered with THREE.ShaderChunk
 * because nothing here is a material feature — it is this scene's own
 * vocabulary, and keeping it out of the global chunk table means two shaders
 * can be read side by side without hunting for where `wake()` came from.
 */

/** Value noise on a 2D lattice, plus the hash it is built on. */
export const NOISE = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

/**
 * The pointer wake.
 *
 * Every ripple is one expanding ring. `uRipples[i]` carries its origin in
 * normalised screen space and its normalised age in `.z`; the ring's radius is
 * driven by that age, so older ripples are wider, fainter and lower frequency —
 * the same way a real disturbance loses its high frequencies first.
 *
 * Returns a signed height field. Callers use it two ways: added to brightness
 * it lights the crests, and fed into a UV offset it bends whatever is drawn
 * underneath, which is what actually sells it as water rather than as a glow.
 *
 * Screen space, not surface UV: the wake has to sit exactly under the cursor,
 * and the surfaces this is drawn on are a bowed plane and a camera-facing quad
 * with completely different parameterisations.
 */
export const WAKE = /* glsl */ `
  uniform vec3 uRipples[RIPPLE_COUNT];
  uniform vec2 uResolution;
  uniform float uAspect;

  float wake(vec2 screenUv) {
    float total = 0.0;

    for (int i = 0; i < RIPPLE_COUNT; i++) {
      vec3 r = uRipples[i];
      float age = r.z;

      // Fully faded ripples still cost the loop iteration, but skipping their
      // contribution keeps dead slots from adding a static ring at the origin.
      float alive = step(age, 0.999);

      // Correct for viewport aspect so rings are round, not elliptical.
      vec2 d = (screenUv - r.xy) * vec2(uAspect, 1.0);
      float dist = length(d);

      /**
       * The ring travels outward and thins as it goes.
       *
       * The travel is eased out rather than linear. A ring moving at constant
       * speed covers the same distance every frame no matter how faded it is,
       * and once the amplitude was raised that showed up as the grid appearing
       * to shake: the displaced lines jumped further between frames than the
       * eye could integrate, which is temporal aliasing, not motion. Real water
       * loses energy — the disturbance sprints away from the impact and then
       * crawls — and decelerating it fixes both the physics and the shimmer.
       */
      float travel = 1.0 - (1.0 - age) * (1.0 - age);
      float radius = travel * 0.95;
      float front = dist - radius;

      // A few oscillations trailing the leading edge, not an infinite train.
      // Low frequency: a few fat oscillations rather than fine chatter, which
      // also keeps the per-frame phase step small.
      float wave = sin(front * 19.0 - age * 3.6);

      // Envelope: tight around the current radius, and gone by the time the
      // ripple has aged out.
      float band = exp(-front * front * 34.0);
      float fade = (1.0 - age) * (1.0 - age);

      total += wave * band * fade * alive;
    }

    return total;
  }
`;

/**
 * Rain that has stopped falling.
 *
 * Droplets are placed one per jittered grid cell, at sizes drawn from a heavy
 * tail so most are specks and a few are fat. Only the fat ones have enough mass
 * to beat surface tension and run; the rest stay pinned where they landed,
 * which is what the aftermath of rain on a vertical pane actually looks like —
 * motion is the exception, not the rule.
 *
 * Two details do most of the realism work:
 *
 *  - **Stick-slip.** A runner does not slide at constant speed. It hangs, then
 *    releases, then hangs again. `travel` is a ramp with a sine folded into it,
 *    which stays monotonic (its derivative never reaches zero) while spending
 *    most of its time nearly stopped. A linear slide reads as a falling dot.
 *  - **Shading as a bead, not a ring.** Each drop is treated as a spherical cap:
 *    the surface normal is reconstructed from the offset to its centre, then lit
 *    for a specular highlight and a bright/dark split across the light
 *    direction. A drop drawn as a uniform ring reads as a sticker; the same drop
 *    with a highlight on one side and shadow on the other reads as glass.
 *
 * Returns (coverage, rim, shade, specular).
 */
export const RAIN = /* glsl */ `
  vec4 rainDrops(vec2 uv, float time, float density, vec2 lightDir) {
    vec2 grid = uv * density;
    vec2 cell = floor(grid);
    vec2 local = fract(grid) - 0.5;

    float coverage = 0.0;
    float rim = 0.0;
    float shade = 0.5;
    float spec = 0.0;

    // Sample the neighbouring cells so drops are not clipped at cell borders.
    for (int oy = -1; oy <= 1; oy++) {
      for (int ox = -1; ox <= 1; ox++) {
        vec2 offset = vec2(float(ox), float(oy));
        vec2 id = cell + offset;

        float h1 = hash(id);
        float h2 = hash(id + 31.7);
        float h3 = hash(id + 71.3);

        // Most cells are empty; rain is sparse once it has stopped. Raising
        // this threshold is what breaks up the grid the drops are placed on —
        // too low and the lattice shows through.
        float present = step(0.66, h3);

        // Heavy-tailed radius: h1^3 keeps most drops tiny.
        float radius = mix(0.03, 0.24, h1 * h1 * h1) * present;

        // Only the largest drops run.
        float runs = step(0.16, radius);

        // Stick-slip descent. The folded sine makes the drop hang and release
        // instead of sliding evenly; amplitude just under 1 keeps it monotonic.
        float t = time * (0.035 + h2 * 0.06) + h1 * 9.0;
        float travel = t - 0.93 * sin(t * 6.2831853) / 6.2831853;
        float cycle = fract(travel);

        // Static drops sit at rest in the middle of their cycle so they are
        // never caught in the fade at either end of a run.
        cycle = mix(0.5, cycle, runs);

        // Fade in at the top of the run and out at the bottom. Without this the
        // drop teleports back to the start every cycle, which is the single
        // most obvious tell in a looping rain shader.
        float lifeFade = mix(
          1.0,
          smoothstep(0.0, 0.1, cycle) * (1.0 - smoothstep(0.8, 1.0, cycle)),
          runs
        );

        vec2 centre = offset + vec2(h1, h2) - 0.5;
        centre.y += (0.5 - cycle) * runs;

        vec2 d = local - centre;
        float dist = length(d);

        // Body of the drop, and the bead normal reconstructed from it.
        float body = (1.0 - smoothstep(radius * 0.75, radius, dist)) * lifeFade;
        vec2 nd = d / max(radius, 0.0001);
        float r2 = min(1.0, dot(nd, nd));
        vec3 n = vec3(nd, sqrt(max(0.0, 1.0 - r2)));

        // Trail: a narrow smear behind a running drop, thinning with distance.
        float trailWidth = radius * 0.3;
        float behind = clamp(d.y / max(0.0001, cycle * 1.1), 0.0, 1.0);
        float trail =
          runs * lifeFade *
          (1.0 - smoothstep(trailWidth * (1.0 - behind * 0.8), trailWidth, abs(d.x))) *
          step(0.0, d.y) * (1.0 - behind) * 0.5;

        float drop = max(body, trail);

        // Keep the shading of whichever drop is on top at this pixel rather
        // than blending several — beads overlap, they do not average.
        float takeover = step(coverage, drop);
        shade = mix(shade, dot(n.xy, lightDir) * 0.5 + 0.5, takeover * body);
        spec = max(spec, pow(max(dot(n, normalize(vec3(lightDir, 0.7))), 0.0), 42.0) * body);
        rim = max(rim, smoothstep(0.45, 1.0, sqrt(r2)) * body);
        coverage = max(coverage, drop);
      }
    }

    return vec4(coverage, rim, shade, spec);
  }
`;
