/**
 * Stroke glyph table for the human-verification challenge.
 *
 * 32 unambiguous characters — `A–Z` without `I`/`O`, plus `2–9` — matching the
 * alphabet already used by `newTempPassword` / `newInviteCode`, so an operator
 * reading a code over the phone never has to guess `0` from `O`.
 *
 * Coordinates live in a 0–100 box with y pointing DOWN (SVG convention). Every
 * glyph is one or more polylines; there is no character outline, no font file and
 * no `<text>` anywhere in the output, which is the whole point: a script must run
 * OCR rather than read the DOM (spec §3.2.1).
 *
 * Arcs are expanded from a deterministic helper instead of being typed out as
 * ~20 hand-measured points each. The output is still a fixed point table — the
 * helper runs once at module load and always produces the same numbers — but a
 * mistyped coordinate in a bowl would ship as an unreadable character, and a human
 * has to read these under noise.
 */

export type Point = readonly [number, number]
/** One continuous stroke: the pen goes down at the first point and lifts at the last. */
export type Stroke = readonly Point[]

/** Polyline approximation of an arc, in degrees, y pointing down. */
function arc(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
  steps = 16,
): Point[] {
  const points: Point[] = []
  for (let index = 0; index <= steps; index += 1) {
    const angle = ((startDeg + ((endDeg - startDeg) * index) / steps) * Math.PI) / 180
    points.push([
      round(cx + radius * Math.cos(angle)),
      round(cy + radius * Math.sin(angle)),
    ])
  }
  return points
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** A full ellipse, used by `8` and `0`-free round glyphs. */
function ellipse(cx: number, cy: number, rx: number, ry: number, steps = 20): Point[] {
  const points: Point[] = []
  for (let index = 0; index <= steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps
    points.push([round(cx + rx * Math.cos(angle)), round(cy + ry * Math.sin(angle))])
  }
  return points
}

export const GLYPHS: Record<string, readonly Stroke[]> = {
  A: [
    [[6, 100], [50, 0], [94, 100]],
    [[24, 62], [76, 62]],
  ],
  B: [
    [[14, 0], [14, 100]],
    [[14, 0], [58, 0], [78, 14], [78, 34], [58, 48], [14, 48]],
    [[14, 48], [64, 48], [86, 64], [86, 84], [64, 100], [14, 100]],
  ],
  C: [arc(58, 50, 48, 40, 320).reverse()],
  D: [
    [[14, 0], [14, 100]],
    [[14, 0], [48, 0], ...arc(48, 50, 50, 270, 90, 18).slice(1), [14, 100]],
  ],
  E: [
    [[86, 0], [14, 0], [14, 100], [86, 100]],
    [[14, 50], [70, 50]],
  ],
  F: [
    [[86, 0], [14, 0], [14, 100]],
    [[14, 50], [70, 50]],
  ],
  G: [
    [...arc(56, 50, 48, 40, 330).reverse(), [56, 56]],
  ],
  H: [
    [[14, 0], [14, 100]],
    [[86, 0], [86, 100]],
    [[14, 52], [86, 52]],
  ],
  J: [
    [[70, 0], [70, 74], ...arc(44, 74, 26, 0, 180, 12).slice(1)],
  ],
  K: [
    [[14, 0], [14, 100]],
    [[86, 0], [14, 56]],
    [[40, 42], [88, 100]],
  ],
  L: [
    [[14, 0], [14, 100], [86, 100]],
  ],
  M: [
    [[8, 100], [16, 0], [50, 62], [84, 0], [92, 100]],
  ],
  N: [
    [[12, 100], [12, 0], [88, 100], [88, 0]],
  ],
  P: [
    [[14, 0], [14, 100]],
    [[14, 0], [62, 0], [86, 18], [86, 38], [62, 56], [14, 56]],
  ],
  Q: [
    ellipse(50, 50, 44, 48),
    [[62, 66], [92, 100]],
  ],
  R: [
    [[14, 0], [14, 100]],
    [[14, 0], [62, 0], [86, 18], [86, 38], [62, 56], [14, 56]],
    [[52, 56], [88, 100]],
  ],
  S: [
    [...arc(50, 25, 30, 340, 180, 10), ...arc(50, 72, 32, 180, 20, 12).slice(1)],
  ],
  T: [
    [[4, 0], [96, 0]],
    [[50, 0], [50, 100]],
  ],
  U: [
    [
      [12, 0],
      [12, 62],
      ...arc(50, 62, 38, 180, 0, 14).slice(1),
      [88, 0],
    ],
  ],
  V: [
    [[6, 0], [50, 100], [94, 0]],
  ],
  W: [
    [[4, 0], [26, 100], [50, 30], [74, 100], [96, 0]],
  ],
  X: [
    [[6, 0], [94, 100]],
    [[94, 0], [6, 100]],
  ],
  Y: [
    [[6, 0], [50, 52], [94, 0]],
    [[50, 52], [50, 100]],
  ],
  Z: [
    [[8, 0], [92, 0], [8, 100], [92, 100]],
  ],
  '2': [
    [...arc(48, 26, 32, 200, 20, 14), [10, 100], [90, 100]],
  ],
  '3': [
    [...arc(48, 26, 30, 200, 60, 12), ...arc(48, 74, 33, 290, 160, 12).slice(1)],
  ],
  '4': [
    [[68, 0], [8, 70], [92, 70]],
    [[68, 0], [68, 100]],
  ],
  '5': [
    [[84, 0], [26, 0], [20, 46], [52, 38], ...arc(52, 70, 30, 290, 160, 12).slice(1)],
  ],
  '6': [
    [...arc(50, 70, 34, 0, 360, 20)],
    [[30, 40], [50, 0], [78, 0]],
  ],
  '7': [
    [[6, 0], [94, 0], [38, 100]],
  ],
  '8': [
    ellipse(50, 25, 30, 25, 16),
    ellipse(50, 74, 33, 26, 18),
  ],
  '9': [
    [...arc(50, 30, 32, 0, 360, 18)],
    [[82, 30], [62, 100]],
  ],
}

/**
 * The alphabet, in a fixed order.
 *
 * Order is part of the contract: `captchaService` indexes into it with a
 * uniform random integer, so a reordering changes nothing functionally — but a
 * test that asserts "the answer is drawn from this set" reads better against a
 * stable list.
 */
export const CAPTCHA_ALPHABET = Object.freeze(Object.keys(GLYPHS))

export type CaptchaAlphabetChar = keyof typeof GLYPHS
