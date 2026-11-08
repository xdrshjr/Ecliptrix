import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * Token primitives.
 *
 * Design (spec §2.9 item 3): tokens are opaque random bytes, NOT JWTs. The
 * database stores only `HMAC-SHA256(SESSION_SECRET, token)` in hex, so a
 * database leak alone cannot mint a session, and rotating SESSION_SECRET
 * invalidates every stored token at once (intended, document it).
 */

export const TOKEN_BYTES = 32

/** A fresh opaque token. Only ever returned to the client once. */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Stable hex digest used as the stored representation of a token. */
export function hashToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token, 'utf8').digest('hex')
}

/** Wall-clock-safe comparison of two hex digests of equal length. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/**
 * High-entropy temporary password an administrator hands over out of band.
 * Ambiguous glyphs (0/O, 1/l/I) are excluded so it can be read over a phone.
 */
export function newTempPassword(length = 16): string {
  let out = ''
  for (let index = 0; index < length; index += 1) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)]
  }
  return out
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** `ECL-XXXX-XXXX-XXXX` — grouped so it survives being read aloud. */
export function newInviteCode(): string {
  const group = (): string => {
    let out = ''
    for (let index = 0; index < 4; index += 1) {
      out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]
    }
    return out
  }
  return `ECL-${group()}-${group()}-${group()}`
}

/** Last four characters of a code, the only part the console shows again. */
export function codeHint(code: string): string {
  return code.slice(-4)
}

/** CSRF double-submit value: random, not secret-derived, compared literally. */
export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url')
}

/** UUIDv4 identifier (node:crypto keeps this dependency-free). */
export function newId(): string {
  return randomUUID()
}
