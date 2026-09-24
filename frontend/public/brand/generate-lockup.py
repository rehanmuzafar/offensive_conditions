"""The OFFCON lockup: the wordmark, with OFFENSE CONDITIONS set beneath it.

Two rules make a descriptor read as a descriptor rather than as more of the
name: it is lighter and much smaller, and it is tracked out. Both are here.

The tracking is *computed* rather than picked — the descriptor is justified to
the exact width of the wordmark above it, so the two edges line up on both
sides. That alignment is what makes a lockup look drawn rather than typed, and
it holds at any size because it is baked into the geometry.
"""
import json, re, sys

G = json.load(open("glyphs2.json"))
BOLD, REG = G["Bold"], G["Regular"]
SKULL = open("skull_path.txt").read().strip()

O_TOP, O_BOT = 1440, -10          # the round letters' optical overshoot
O_H, O_ADV = O_TOP - O_BOT, BOLD["advances"]["O"]

nums = [float(n) for n in re.findall(r'-?\d*\.?\d+', SKULL)]
sx, sy = nums[0::2], nums[1::2]
SK_X0, SK_X1, SK_Y0, SK_Y1 = min(sx), max(sx), min(sy), max(sy)

# ---- the wordmark ---------------------------------------------------------
# Matched to the O's height and dropped 2%: the skull's mass is all cranium
# while the jaw tapers, so at equal height and centred it reads high.
sk_scale = O_H / (SK_Y1 - SK_Y0)
sk_w = (SK_X1 - SK_X0) * sk_scale
sk_cy = (O_TOP + O_BOT) / 2 - O_H * 0.02

word, x = [], 0
for item in ["O", "F", "F", "C", "SKULL", "N"]:
    if item == "SKULL":
        tx = x + (O_ADV - sk_w) / 2 - SK_X0 * sk_scale
        ty = sk_cy + (SK_Y0 + SK_Y1) / 2 * sk_scale
        word.append(f'      <path fill="url(#offcon-skull)" fill-rule="evenodd"\n'
                    f'            transform="translate({tx:.2f} {ty:.2f}) '
                    f'scale({sk_scale:.4f} {-sk_scale:.4f})" d="{SKULL}"/>')
        x += O_ADV
    else:
        word.append(f'      <path transform="translate({x} 0)" d="{BOLD["paths"][item]}"/>')
        x += BOLD["advances"][item]
WORD_W = x

# ---- the descriptor -------------------------------------------------------
TEXT = "OFFENSIVE CONDITIONS"
DESC_CAP = 1440                     # Regular cap height, same units
SCALE = float(sys.argv[1]) if len(sys.argv) > 1 else 0.175
GAP = float(sys.argv[2]) if len(sys.argv) > 2 else 0.30   # of the wordmark cap height

# Natural width at this scale, before any tracking.
natural = sum(REG["advances"][c] if c != " " else REG["advances"]["O"] * 0.42 for c in TEXT) * SCALE
# Tracking is what is left over, shared between the gaps. The trailing gap is
# excluded — letterspacing after the final letter would push the descriptor
# left of the wordmark's right edge by exactly one track.
tracking = (WORD_W - natural) / (len(TEXT) - 1)

desc, dx = [], 0.0
for ch in TEXT:
    if ch == " ":
        dx += REG["advances"]["O"] * 0.42 * SCALE + tracking
        continue
    desc.append(f'      <path transform="translate({dx:.2f} 0) scale({SCALE:.4f})" '
                f'd="{REG["paths"][ch]}"/>')
    dx += REG["advances"][ch] * SCALE + tracking

DESC_W = dx - tracking
DESC_H = DESC_CAP * SCALE

# ---- layout ---------------------------------------------------------------
PAD = 110
gap = O_H * GAP
total_h = O_H + gap + DESC_H
VB_W, VB_H = WORD_W + PAD * 2, total_h + PAD * 2

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VB_W:.0f} {VB_H:.0f}"
     role="img" aria-label="OFFCON — Offensive Conditions" color="#F4F4F5">
  <title>OFFCON — Offensive Conditions</title>
  <!--
    Letters: Sansation, converted to outlines. SIL Open Font License.
    Skull:   the contour createSkullShape() extrudes for the 3D mark.

    The descriptor's letterspacing is computed, not chosen: it is whatever
    makes OFFENSE CONDITIONS span exactly the width of OFFCON above it, so the
    two align on both edges at any size.

    Letters use currentColor, so one file serves both grounds — standalone it
    takes the color attribute above, inlined it inherits the page's text
    colour, and the skull keeps its gradient either way.
  -->
  <defs>
    <linearGradient id="offcon-skull" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C8B4FF"/>
      <stop offset="1" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>

  <g fill="currentColor">
    <!-- wordmark -->
    <g transform="translate({PAD} {PAD + O_H:.2f}) scale(1 -1)">
{chr(10).join(word)}
    </g>
    <!-- descriptor -->
    <g transform="translate({PAD} {PAD + O_H + gap + DESC_H:.2f}) scale(1 -1)" opacity="0.72">
{chr(10).join(desc)}
    </g>
  </g>
</svg>
'''
open("offcon-lockup.svg", "w").write(svg)
print(f"wordmark {WORD_W:.0f} wide · descriptor {DESC_W:.0f} wide "
      f"(delta {abs(WORD_W - DESC_W):.1f}) · tracking {tracking:.0f} units "
      f"= {tracking / (DESC_CAP * SCALE):.3f}em")
print(f"viewBox 0 0 {VB_W:.0f} {VB_H:.0f}")
