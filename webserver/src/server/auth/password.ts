import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { isWeakPassword } from '@/server/auth/weakPasswords'

/**
 * Password hashing and policy.
 *
 * Algorithm: scrypt with N=32768, r=8, p=1, keyLen=64 — the OWASP baseline.
 * `scrypt` is not a native addon, so installs cannot fail for lack of a
 * compiler (unlike bcrypt/argon2), which matters for a service that may be
 * deployed on a machine the maintainer does not control.
 *
 * Storage format: `scrypt$N$r$p$<saltBase64>$<hashBase64>`. Parameters are
 * stored per row so `needsRehash` can upgrade old rows on next login without a
 * migration.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, keyLen: 64 } as const
const MAX_MEM = 64 * 1024 * 1024

export const PASSWORD_MIN_LENGTH = 10
/** Measured in UTF-8 bytes, not code points: the limit exists to bound work. */
export const PASSWORD_MAX_BYTES = 128

function encode(password: string, salt: Buffer, hash: Buffer): string {
  const { N, r, p } = SCRYPT_PARAMS
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

interface ParsedHash {
  N: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null
  // Boundary validation: these numbers come from a database row, which is outside
  // the process. `scrypt` throws `RangeError` for a non-power-of-two N or a memory
  // cost above the cap, so a corrupted or tampered row must be rejected here
  // rather than surfacing as a 500 on the login path.
  if (N < 1024 || N > 1 << 20 || (N & (N - 1)) !== 0) return null
  if (r < 1 || r > 32 || p < 1 || p > 16) return null
  if (N * r * 128 > MAX_MEM) return null
  const salt = Buffer.from(rawSalt ?? '', 'base64')
  const hash = Buffer.from(rawHash ?? '', 'base64')
  if (salt.length === 0 || hash.length === 0) return null
  return { N, r, p, salt, hash }
}

/**
 * Hash a password with a fresh 16-byte salt.
 *
 * @throws {Error} never for policy violations — this function hashes whatever it
 *         is given; `validatePasswordPolicy` is the gate.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const normalised = password.normalize('NFKC')
  const hash = await scrypt(normalised, salt, SCRYPT_PARAMS.keyLen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: MAX_MEM,
  })
  return encode(normalised, salt, hash)
}

/**
 * Constant-time verification. Returns false (never throws) for a stored value
 * that cannot be parsed, so a corrupted row cannot crash the login endpoint.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false
  try {
    const candidate = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEM,
    })
    if (candidate.length !== parsed.hash.length) return false
    return timingSafeEqual(candidate, parsed.hash)
  } catch {
    // A parameter set that passed the parse bounds but still fails in the native
    // binding means the row is unusable: fail closed, do not crash the request.
    return false
  }
}

/** True when the row was hashed with weaker parameters than today's standard. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored)
  if (!parsed) return true
  return (
    parsed.N !== SCRYPT_PARAMS.N ||
    parsed.r !== SCRYPT_PARAMS.r ||
    parsed.p !== SCRYPT_PARAMS.p ||
    parsed.hash.length !== SCRYPT_PARAMS.keyLen
  )
}

/**
 * A fixed hash used to spend the same CPU time when the identifier does not
 * exist (spec §2.9 item 8). Computed once per process.
 */
let dummyHashPromise: Promise<string> | undefined

export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-parity-0000')
  return dummyHashPromise
}

/** Burn one scrypt cycle without revealing whether an account exists. */
export async function burnPasswordWork(password: string): Promise<void> {
  const stored = await getDummyHash()
  await verifyPassword(password, stored)
}

export type PasswordPolicyRejection =
  | 'too_short'
  | 'too_long'
  | 'too_weak'
  | 'similar_to_identifier'
  | 'repeated_character'

export interface PasswordPolicyInput {
  password: string
  email?: string
  username?: string
  displayName?: string
}

export interface PasswordPolicyResult {
  ok: boolean
  reasons: PasswordPolicyRejection[]
}

function alphanumericOnly(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** True when ≥ 80 % of the password is one repeated character. */
function isRepeated(password: string): boolean {
  if (password.length < 6) return false
  const counts = new Map<string, number>()
  for (const char of password) counts.set(char, (counts.get(char) ?? 0) + 1)
  const highest = Math.max(...counts.values())
  return highest / password.length >= 0.8
}

/**
 * Evaluate a candidate password.
 *
 * Deliberately does NOT require character classes: composition rules push users
 * towards `Password1!` (NIST 800-63B §5.1.1.2). Length, denylist and
 * identifier-similarity are the controls that actually work.
 *
 * The candidate is NFKC-normalised FIRST, exactly like `hashPassword` does before
 * storing it. Measuring the raw string let `"ｐａｓｓｗｏｒｄ１２３"` (full-width) pass
 * every check and then hash to the same bytes as the denylisted ASCII
 * `password123` — a policy bypass with no attacker effort beyond a keyboard
 * layout.
 */
export function validatePasswordPolicy(input: PasswordPolicyInput): PasswordPolicyResult {
  const reasons: PasswordPolicyRejection[] = []
  const password = input.password.normalize('NFKC')
  const byteLength = Buffer.byteLength(password, 'utf8')

  if (Array.from(password).length < PASSWORD_MIN_LENGTH) reasons.push('too_short')
  if (byteLength > PASSWORD_MAX_BYTES) reasons.push('too_long')
  if (isWeakPassword(password)) reasons.push('too_weak')
  if (isRepeated(password)) reasons.push('repeated_character')

  const candidate = alphanumericOnly(password)
  const identifiers = [input.email, input.username, input.displayName]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => alphanumericOnly(value.normalize('NFKC')))
    .filter((value) => value.length >= 3)

  const similar = identifiers.some((identifier) => {
    if (candidate.length === 0) return false
    if (candidate === identifier) return true
    // Substring in either direction catches `ada@example.com` -> `adaexamplecom1`.
    return candidate.includes(identifier) || identifier.includes(candidate)
  })
  if (similar) reasons.push('similar_to_identifier')

  return { ok: reasons.length === 0, reasons }
}
