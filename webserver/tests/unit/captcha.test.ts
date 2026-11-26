import { describe, expect, it } from 'vitest'
import { CAPTCHA_ALPHABET, GLYPHS } from '@/server/services/captchaGlyphs'
import { CAPTCHA_HEIGHT, CAPTCHA_WIDTH, renderCaptcha } from '@/server/services/captchaRender'

/**
 * Rendering is the one part of the captcha that must be provable without a
 * browser: the whole design claim is "the markup cannot be used to read the
 * answer" (spec §3.2.1), and a single `<text>` node would quietly void it.
 */

const ANSWER = 'K7QX2'

describe('glyph table', () => {
  it('is the unambiguous 32-character alphabet', () => {
    // No `I` or `O` (both misread), no `0`/`1`, so a human is never asked to
    // distinguish characters a stroke renderer makes indistinguishable anyway.
    expect(CAPTCHA_ALPHABET).toHaveLength(32)
    for (const forbidden of ['I', 'O', '0', '1']) {
      expect(CAPTCHA_ALPHABET).not.toContain(forbidden)
    }
  })

  it('gives every character at least one stroke', () => {
    for (const character of CAPTCHA_ALPHABET) {
      const strokes = GLYPHS[character]
      expect(strokes, character).toBeDefined()
      expect(strokes?.length, character).toBeGreaterThan(0)
      for (const stroke of strokes ?? []) expect(stroke.length).toBeGreaterThan(1)
    }
  })
})

describe('renderCaptcha', () => {
  it('never emits the answer as text (AC-08)', () => {
    const svg = renderCaptcha({ id: 'challenge-1', answer: ANSWER })
    expect(svg).not.toMatch(new RegExp(ANSWER, 'i'))
    expect(svg.toLowerCase()).not.toContain('<text')
    // Only vector primitives: a script or an event attribute would be an
    // injection surface the control's own guard would then have to catch.
    expect(svg.toLowerCase()).not.toContain('<script')
    expect(svg.toLowerCase()).not.toContain('onload=')
  })

  it('draws one stroke group per character', () => {
    const svg = renderCaptcha({ id: 'challenge-1', answer: ANSWER })
    const expected = [...ANSWER].reduce((sum, character) => sum + (GLYPHS[character]?.length ?? 0), 0)
    const paths = svg.match(/<path d="M/g) ?? []
    // `noiseCurves` also emits paths, so the character strokes are a subset — the
    // assertion is that every character contributed, not that nothing else did.
    expect(paths.length).toBeGreaterThanOrEqual(expected)
  })

  it('is deterministic for one id and differs across ids', () => {
    const first = renderCaptcha({ id: 'challenge-1', answer: ANSWER })
    const again = renderCaptcha({ id: 'challenge-1', answer: ANSWER })
    const other = renderCaptcha({ id: 'challenge-2', answer: ANSWER })
    expect(again).toBe(first)
    expect(other).not.toBe(first)
  })

  it('declares the canvas size it renders at', () => {
    const svg = renderCaptcha({ id: 'c', answer: ANSWER })
    expect(svg).toContain(`viewBox="0 0 ${CAPTCHA_WIDTH} ${CAPTCHA_HEIGHT}"`)
    expect(svg).toContain('role="img"')
    // The accessible name describes the task, never the answer.
    expect(svg).toContain('aria-label="图形验证码')
  })

  it('ignores characters it has no glyph for instead of throwing', () => {
    // The alphabet is closed, but a stored answer from an older build could
    // contain anything; rendering must degrade, not 500 the sign-up page.
    expect(() => renderCaptcha({ id: 'c', answer: 'A-A' })).not.toThrow()
  })
})
