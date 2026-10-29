'use strict'

/**
 * Secret-shape predicate shared by every build-time credential gate.
 *
 * `scripts/scan-secrets.py` scans the raw bytes of every *tracked* file for
 * vendor credential shapes (sk-…, tvly-…, LTAI…). That gate structurally
 * cannot see `desktop/build/env.template.desktop` or the packaged app.asar —
 * `git ls-files` never lists them — so this module answers the complementary
 * question for one env-style pair: "is this value a credential that must never
 * be published?".
 *
 * A pair is secret-shaped when its key NAME looks sensitive, its value is long
 * enough to be a credential, and the value matches no documented placeholder.
 * Vendor value shapes from the Python scanner are honoured too, so a credential
 * under an opaque key name is still caught. Where the two definitions diverge
 * the reason is commented below: two gates that disagree teach people to
 * bypass both.
 *
 * Pure by design — no fs, no process.env — so it can run against file text, an
 * in-memory asar entry or a test fixture without touching the machine.
 */

// scan-secrets.py decides by value shape alone; here the key name carries the
// intent, because a first-run env template legitimately holds non-secret
// defaults (URLs, model names, voice/region ids, log levels) that must be kept.
const SENSITIVE_KEY_PATTERN =
  /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|ACCESS|CREDENTIAL)/

// A key that names the *location* of a credential is not the credential
// (OSS_CREDENTIAL_FILE, VOLCANO_TTS_TOKEN_URL). scan-secrets.py cannot make
// this distinction — it never looks at key names — so this is a precision
// improvement on its philosophy, not a contradiction of it.
const NON_SECRET_KEY_SUFFIXES = Object.freeze([
  '_URL',
  '_URI',
  '_PATH',
  '_FILE',
  '_DIR',
  '_HOST',
  '_ENDPOINT',
  '_TYPE',
  '_MODEL',
  '_LEVEL',
  '_ENV',
  '_TIMEOUT',
  '_EXPIRES',
  '_COUNT',
  '_SIZE',
])

// scan-secrets.py only matches shapes carrying >=16 payload characters
// ("long enough that prose, examples and synthetic fixtures do not match").
// The same floor applies here, measured on the whole value.
const MIN_SECRET_LENGTH = 16

// Documented placeholders — the shapes the committed templates, main/envCheck
// and the docs actually use. Anything matching one of these is configuration
// guidance, not credential material, so it survives into the shipped template.
const PLACEHOLDER_PATTERNS = Object.freeze([
  /^your_[a-z0-9_]*$/i, // committed convention: your_llm_api_key_here
  /^x+$/i, // xxx / xxxxxxxx
  /^<.+>$/, // <your-api-key>
  /^(change|replace)[_-]?me$/i,
  /^(test|example|dummy|fake|sample|placeholder|todo|none|null)$/i,
  /^0+$/, // 00000000
  /EXAMPLE/, // AKIAIOSFODNN7EXAMPLE, the vendor-docs example key
  /xxxxxxxx/, // scan-secrets.py KNOWN_PLACEHOLDERS
  /^sk-test/i,
])

// Value shapes lifted from scripts/scan-secrets.py PATTERNS, kept as a second
// layer so a credential living under an opaque key name (WEB_SEARCH=tvly-…) is
// still caught. scan-secrets.py would flag exactly these in a tracked file.
const VENDOR_SECRET_PATTERNS = Object.freeze([
  /\bsk-proj-[A-Za-z0-9_-]{32,}\b/,
  /\bsk-kimi-[A-Za-z0-9]{30,}/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\btvly-[A-Za-z0-9]{30,}/,
  /\bLTAI[0-9A-Za-z]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
])

// Any scheme://host form, including socks5:// and redis://.
const URL_VALUE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

// A URL carrying user:password@ is a credential even though it looks like a
// URL — proxy and database DSNs leak secrets in exactly this shape.
const CREDENTIAL_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+:[^/\s@]+@/i

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Normalise a raw env value: trim it and drop one layer of matching quotes,
 * mirroring main/envCheck.js parseEnvFile() so a quoted placeholder is still
 * recognised as a placeholder.
 *
 * @param {unknown} value Raw value from an env line.
 * @returns {string} Trimmed, unquoted value ('' for null/undefined).
 */
function normalizeValue(value) {
  const text = String(value === undefined || value === null ? '' : value)
    .trim()
  const isDoubleQuoted =
    text.length >= 2 && text.startsWith('"') && text.endsWith('"')
  const isSingleQuoted =
    text.length >= 2 && text.startsWith("'") && text.endsWith("'")
  if (isDoubleQuoted || isSingleQuoted) return text.slice(1, -1)
  return text
}

/**
 * Is this value one of the documented placeholder shapes (including empty)?
 *
 * @param {unknown} value Raw or normalised value.
 * @returns {boolean} True when the value carries no credential material.
 */
function isPlaceholderValue(value) {
  const text = normalizeValue(value)
  if (text === '') return true
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Does this value look like a URL (scheme://…)?
 *
 * @param {unknown} value Raw or normalised value.
 * @returns {boolean} True for URL-shaped values.
 */
function isUrlValue(value) {
  return URL_VALUE_PATTERN.test(normalizeValue(value))
}

/**
 * Does this key NAME name a credential field?
 *
 * Sensitivity is decided by name, not by value, so that URLs, model names and
 * region/voice ids under non-credential keys stay publishable.
 *
 * @param {string} key Environment variable name, e.g. `PEXELS_API_KEY`.
 * @returns {boolean} True when the name marks a credential field.
 */
function isSensitiveKeyName(key) {
  const name = normalizeValue(key)
  if (!ENV_KEY_PATTERN.test(name)) return false
  const upperName = name.toUpperCase()
  if (!SENSITIVE_KEY_PATTERN.test(upperName)) return false
  return !NON_SECRET_KEY_SUFFIXES.some((suffix) => upperName.endsWith(suffix))
}

/**
 * Does this value match a known vendor credential shape?
 *
 * @param {unknown} value Raw or normalised value.
 * @returns {boolean} True when the shape is a live-credential shape.
 */
function hasVendorSecretShape(value) {
  const text = normalizeValue(value)
  return VENDOR_SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Decide whether one KEY=VALUE pair carries a credential that must never be
 * written into a published artifact.
 *
 * Order matters: an empty value, a documented placeholder and a plain URL are
 * configuration and clear first; a credential-bearing URL and any vendor
 * credential shape are caught next; only then does the key-name plus
 * minimum-length rule apply.
 *
 * @param {string} key Environment variable name.
 * @param {unknown} value Its value, quoted or not.
 * @returns {boolean} True when the pair is a non-placeholder credential.
 */
function isSecretShapedPair(key, value) {
  const text = normalizeValue(value)
  if (text === '') return false
  if (isPlaceholderValue(text)) return false
  if (CREDENTIAL_URL_PATTERN.test(text)) return true
  if (isUrlValue(text)) return false
  if (hasVendorSecretShape(text)) return true
  if (!isSensitiveKeyName(key)) return false
  return text.length >= MIN_SECRET_LENGTH
}

/**
 * Yield the KEY=VALUE pairs of env-file text, in file order.
 *
 * Commented-out lines are skipped: this parses env syntax, it is not a raw
 * scanner. A credential inside a comment is out of scope here because
 * scan-secrets.py already scans raw bytes of tracked files, and the artifact
 * gate reads the shipped file text itself.
 *
 * @param {string} text Env-file style text.
 * @returns {Iterable<{key: string, value: string}>} Parsed pairs.
 */
function* iterateEnvPairs(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (!ENV_KEY_PATTERN.test(key)) continue
    yield { key, value: normalizeValue(line.slice(separator + 1)) }
  }
}

/**
 * Find every non-placeholder secret-shaped KEY=VALUE pair in env-file text.
 *
 * This is the contract every gate shares (prepare-env.js, build.js and the
 * packaged-artifact check). Each entry carries the KEY NAME and the value's
 * character length only — never the value — so a failure can be logged, pasted
 * into a ticket or attached to release evidence without leaking the credential.
 *
 * @param {string} text Env-file style text (comments and blanks ignored).
 * @returns {{key: string, length: number}[]} One entry per offending pair, in
 *   file order; empty when the text is publication-safe.
 * @throws {TypeError} When `text` is not a string — returning [] instead would
 *   turn a caller's bug into a silently green security gate.
 */
function findSecretShapedPairs(text) {
  if (typeof text !== 'string') {
    throw new TypeError(
      'findSecretShapedPairs(text): text must be a string, got ' +
        typeof text
    )
  }
  const findings = []
  for (const { key, value } of iterateEnvPairs(text)) {
    if (!isSecretShapedPair(key, value)) continue
    findings.push({ key, length: value.length })
  }
  return findings
}

module.exports = {
  findSecretShapedPairs,
  isSecretShapedPair,
  isPlaceholderValue,
  isSensitiveKeyName,
  isUrlValue,
  hasVendorSecretShape,
  PLACEHOLDER_PATTERNS,
  VENDOR_SECRET_PATTERNS,
  SENSITIVE_KEY_PATTERN,
  MIN_SECRET_LENGTH,
}
