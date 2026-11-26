import { GLYPHS, type Point, type Stroke } from '@/server/services/captchaGlyphs'

/**
 * Challenge → SVG, with no `<text>` node and no answer string anywhere.
 *
 * This is the one and only renderer. If the stroke approach is ever beaten by an
 * OCR service, replacing THIS FILE changes the implementation behind an unchanged
 * interface — that is the single extension point the design reserves for itself
 * (spec §3.2.1).
 *
 * Three properties are load-bearing:
 *
 *  1. **No answer in the output.** Every glyph is emitted as `<path d="…">`. There
 *     is no `<text>`, no `data-` attribute and no `<title>` that names it. A bot
 *     that reads the JSON gets geometry, not characters.
 *  2. **Deterministic per id.** All jitter comes from a PRNG seeded with the
 *     challenge id, so the same challenge renders byte-identically twice. Without
 *     that, the browser's re-render would change the picture and the user would
 *     be typing against a shape they no longer see.
 *  3. **Backend-safe markup.** The string is injected with
 *     `dangerouslySetInnerHTML` in the browser, so it only ever contains the
 *     element and attribute names listed below — no script, no event handler, no
 *     external reference.
 */

export const CAPTCHA_WIDTH = 200
export const CAPTCHA_HEIGHT = 64

/** Box the glyph table is authored in; scaled per character below. */
const GLYPH_BOX = 100

/**
 * How much of the canvas the characters occupy.
 *
 * Leaves a margin so the rotation and translation below cannot push a stroke
 * outside the viewBox — a clipped `V` looks like a `Y` and the user gets blamed
 * for the renderer's arithmetic.
 */
const FIELD_X = 14

export interface RenderInput {
  /** Seeds the PRNG; the challenge id, never the answer. */
  id: string
  /** The plaintext answer. Consumed here for geometry only, never emitted. */
  answer: string
  width?: number
  height?: number
}

/**
 * 32-bit FNV-1a, then xorshift32.
 *
 * Purpose-built tiny PRNG rather than `Math.random()` because determinism is a
 * requirement, and rather than `node:crypto` because this must also run in a unit
 * test that asserts two calls produce identical bytes.
 */
function createRandom(seed: string): () => number {
  let state = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 0x01000193) >>> 0
  }
  // A zero state is a fixed point for xorshift; nudge it off the origin.
  if (state === 0) state = 0x9e3779b9
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0xffffffff
  }
}

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min)
}

/** One decimal place — keeps the markup short without visible rounding. */
function n(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function toPathData(points: Stroke): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`).join(' ')
}

/**
 * Rotate, scale and translate one glyph into its slot.
 *
 * The rotation is centred on the glyph itself, not on the canvas: rotating about
 * the origin would swing the character sideways instead of tilting it in place.
 */
function transformStroke(
  stroke: Stroke,
  options: { scale: number; angle: number; dx: number; dy: number; centreX: number; centreY: number },
): Stroke {
  const radians = (options.angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return stroke.map(([rawX, rawY]): Point => {
    const x = (rawX - GLYPH_BOX / 2) * options.scale
    const y = (rawY - GLYPH_BOX / 2) * options.scale
    return [
      options.centreX + x * cos - y * sin + options.dx,
      options.centreY + x * sin + y * cos + options.dy,
    ]
  })
}

/** Two sine curves that cross the characters, roughly one inward and one across. */
function noiseCurves(random: () => number, height: number): string[] {
  const curves: string[] = []
  const strokes = 2
  for (let index = 0; index < strokes; index += 1) {
    const amplitude = between(random, 3, 8)
    const baseY = between(random, height * 0.25, height * 0.75)
    const frequency = between(random, 0.02, 0.05)
    const phase = between(random, 0, Math.PI * 2)
    const points: string[] = []
    for (let x = 0; x <= CAPTCHA_WIDTH; x += 8) {
      const y = baseY + Math.sin(x * frequency + phase) * amplitude
      points.push(`${points.length === 0 ? 'M' : 'L'}${x} ${n(y)}`)
    }
    curves.push(points.join(' '))
  }
  return curves
}

/** ~40 specks; enough to break clean template matching, few enough to stay legible. */
function noiseDots(random: () => number, height: number): { cx: number; cy: number; r: number }[] {
  const dots: { cx: number; cy: number; r: number }[] = []
  const count = 40
  for (let index = 0; index < count; index += 1) {
    dots.push({
      cx: Math.round(between(random, 0, CAPTCHA_WIDTH)),
      cy: Math.round(between(random, 0, height)),
      r: Math.round(between(random, 0.4, 1.4) * 10) / 10,
    })
  }
  return dots
}

/**
 * Render the challenge.
 *
 * @param input challenge id (seed) and plaintext answer (geometry only)
 * @returns an SVG document string. Inlines `currentColor` so the stroke follows
 *          the surrounding theme in both light and dark mode.
 */
export function renderCaptcha(input: RenderInput): string {
  const width = input.width ?? CAPTCHA_WIDTH
  const height = input.height ?? CAPTCHA_HEIGHT
  const random = createRandom(input.id)
  const characters = [...input.answer]
  const slotWidth = (width - FIELD_X * 2) / Math.max(1, characters.length)

  const characterPaths: string[] = []
  characters.forEach((character, index) => {
    const glyph = GLYPHS[character]
    if (!glyph) return
    const centreX = FIELD_X + slotWidth * (index + 0.5)
    const centreY = height / 2
    const scale = between(random, 0.4, 0.5) * Math.min(1, slotWidth / 44)
    const angle = between(random, -18, 18)
    const dx = between(random, -2.5, 2.5)
    const dy = between(random, -3.5, 3.5)
    // Stroke width jitter is per character: a uniform width across the whole
    // challenge is the easiest signal for a template matcher to normalise away.
    const strokeWidth = between(random, 2.1, 3.2)

    for (const stroke of glyph) {
      const points = transformStroke(stroke, { scale, angle, dx, dy, centreX, centreY })
      characterPaths.push(
        `<path d="${toPathData(points)}" fill="none" stroke="currentColor" ` +
          `stroke-width="${n(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
    }
  })

  const noise = noiseDots(random, height)
    .map((dot) => `<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="currentColor" opacity="0.25"/>`)
    .join('')

  const curves = noiseCurves(random, height)
    .map(
      (data) =>
        `<path d="${data}" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.35"/>`,
    )
    .join('')

  // `aria-label` describes the TASK, never the answer: a screen reader user needs
  // to know a picture of 5 characters is there, and the copy tells them to ask an
  // administrator rather than leaving them with an unsolvable form (review R-15).
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img" ` +
    `aria-label="图形验证码，请照图输入 ${characters.length} 个字符" ` +
    `class="captcha-svg">` +
    `<title>图形验证码，请照图输入 ${characters.length} 个字符</title>` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="none"/>` +
    curves +
    noise +
    characterPaths.join('') +
    `</svg>`
  )
}
