import { describe, expect, it } from 'vitest'
import { codeHint, hashToken, newInviteCode, newTempPassword, newToken, safeEqual } from '@/server/auth/tokens'

const SECRET = 'test-secret-for-token-tests-0123456789'

describe('opaque tokens', () => {
  it('produces 32 bytes of base64url entropy', () => {
    const token = newToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newToken()))
    expect(seen.size).toBe(200)
  })

  it('hashes deterministically under the same secret', () => {
    const token = newToken()
    expect(hashToken(SECRET, token)).toBe(hashToken(SECRET, token))
    expect(hashToken(SECRET, token)).toHaveLength(64)
  })

  it('produces a different digest under a rotated secret', () => {
    const token = newToken()
    expect(hashToken(SECRET, token)).not.toBe(hashToken('other-secret-0123456789abcdefghij', token))
  })
})

describe('safeEqual', () => {
  it('is true only for identical strings of identical length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('temporary passwords', () => {
  it('is 16 characters from an unambiguous alphabet', () => {
    const password = newTempPassword()
    expect(password).toHaveLength(16)
    expect(password).not.toMatch(/[0O1lI]/)
  })

  it('does not repeat across calls', () => {
    const seen = new Set(Array.from({ length: 100 }, () => newTempPassword()))
    expect(seen.size).toBe(100)
  })
})

describe('invite codes', () => {
  it('follows the ECL-XXXX-XXXX-XXXX shape', () => {
    expect(newInviteCode()).toMatch(/^ECL-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })

  it('exposes only the last four characters as its hint', () => {
    const code = newInviteCode()
    expect(codeHint(code)).toBe(code.slice(-4))
  })
})
