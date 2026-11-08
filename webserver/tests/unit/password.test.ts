import { describe, expect, it } from 'vitest'
import { hashPassword, needsRehash, validatePasswordPolicy, verifyPassword } from '@/server/auth/password'
import { getDummyHash } from '@/server/auth/password'

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false)
  })

  it('produces a different digest per call, so salts are unique', async () => {
    const first = await hashPassword('same-password-twice')
    const second = await hashPassword('same-password-twice')
    expect(first).not.toBe(second)
    expect(await verifyPassword('same-password-twice', first)).toBe(true)
    expect(await verifyPassword('same-password-twice', second)).toBe(true)
  })

  it('stores the parameters it used, so hashes can be upgraded later', async () => {
    const stored = await hashPassword('upgrade-me-please')
    expect(stored.startsWith('scrypt$32768$8$1$')).toBe(true)
    expect(needsRehash(stored)).toBe(false)
  })

  it('treats an unparseable stored value as a failed verification, not a crash', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$1$2$3$bad$bad')).toBe(false)
    expect(needsRehash('garbage')).toBe(true)
  })

  it('normalises unicode before hashing and verifying', async () => {
    // NFKC folds full-width characters; both spellings must open the same account.
    const stored = await hashPassword('ｐａｓｓｗｏｒｄ-unicode-１')
    expect(await verifyPassword('password-unicode-1', stored)).toBe(true)
  })

  it('exposes a dummy hash for timing parity', async () => {
    const dummy = await getDummyHash()
    expect(dummy.startsWith('scrypt$')).toBe(true)
  })
})

describe('password policy', () => {
  it('rejects a password shorter than 10 characters', () => {
    const result = validatePasswordPolicy({ password: 'short12' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('too_short')
  })

  it('rejects a well-known weak password even when it is long enough', () => {
    const result = validatePasswordPolicy({ password: 'password123' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('too_weak')
  })

  it('rejects a password closely derived from the identifier', () => {
    const result = validatePasswordPolicy({
      password: 'adaexamplecom',
      email: 'ada@example.com',
      username: 'ada',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('similar_to_identifier')
  })

  it('rejects a password that is one character repeated', () => {
    const result = validatePasswordPolicy({ password: 'aaaaaaaaaaaa' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('repeated_character')
  })

  it('accepts a long passphrase with no character classes', () => {
    const result = validatePasswordPolicy({ password: 'quiet meadow lantern drift' })
    expect(result).toEqual({ ok: true, reasons: [] })
  })

  it('measures the upper bound in UTF-8 bytes', () => {
    const result = validatePasswordPolicy({ password: '密'.repeat(50) })
    expect(result.reasons).toContain('too_long')
  })

  // Regression: the policy used to test the raw string while `hashPassword`
  // stored its NFKC form, so a full-width rendering of a denylisted password
  // passed every check and then hashed to the same bytes as the ASCII original.
  it('normalises NFKC before judging, so full-width weak passwords are rejected', () => {
    const fullWidth = 'ｐａｓｓｗｏｒｄ１２３'
    expect(fullWidth.normalize('NFKC')).toBe('password123')
    const result = validatePasswordPolicy({ password: fullWidth })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('too_weak')
  })

  it('detects identifier similarity through compatibility characters', () => {
    const result = validatePasswordPolicy({
      password: 'ＡＤＡｅｘａｍｐｌｅｃｏｍ',
      email: 'ada@example.com',
      username: 'ada',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('similar_to_identifier')
  })
})

