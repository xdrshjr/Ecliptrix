/**
 * `Range` request parsing for the installer download endpoint.
 *
 * Pure functions, no filesystem access, so the whole boundary table from the
 * analysis (R-6(b)) is unit-testable: `webserver/` had no Range implementation at
 * all before this feature, and a downloader that resumes is the normal case for a
 * 188 MB installer.
 *
 * RFC 9110 rules that matter here and are easy to get wrong:
 *  - an unparsable or satisfied-by-nothing-but-multi-range header is IGNORED, which
 *    means a plain `200`, never a `400`;
 *  - a first-byte position outside the representation is `416`, never an empty
 *    `206` and never a `500`;
 *  - the `Content-Length` of a `206` is the slice length, and `Content-Range`
 *    carries the full size.
 */

export type ByteRange =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' }

const RANGE_PREFIX = /^bytes\s*=\s*(.+)$/i

function parsePosition(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) return null
  return value
}

/**
 * Parse one `Range` header value against a known representation size.
 *
 * @param header the raw header (already lower-cased by `Headers`, but that is
 *        not relied on), or `null` when the request did not send one.
 * @param size representation length in bytes; must be a positive integer.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (!header) return { kind: 'full' }
  if (!Number.isSafeInteger(size) || size <= 0) return { kind: 'unsatisfiable' }

  const match = RANGE_PREFIX.exec(header.trim())
  if (!match) return { kind: 'full' }
  const spec = (match[1] ?? '').trim()
  // Multi-range: serving `multipart/byteranges` is not worth the complexity here,
  // and RFC 9110 lets a server ignore the header entirely.
  if (spec.includes(',')) return { kind: 'full' }

  const parts = spec.split('-')
  if (parts.length !== 2) return { kind: 'full' }
  const [rawStart, rawEnd] = parts as [string, string]

  if (rawStart === '') {
    // Suffix form: the LAST n bytes.
    const suffixLength = parsePosition(rawEnd)
    if (suffixLength === null) return { kind: 'full' }
    if (suffixLength === 0) return { kind: 'unsatisfiable' }
    const start = Math.max(0, size - suffixLength)
    return { kind: 'partial', start, end: size - 1 }
  }

  const start = parsePosition(rawStart)
  if (start === null) return { kind: 'full' }
  if (rawEnd === '') {
    if (start >= size) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start, end: size - 1 }
  }

  const end = parsePosition(rawEnd)
  if (end === null) return { kind: 'full' }
  // An inverted range is a syntax error in RFC terms, so it is ignored (200), not
  // answered with 416 — 416 means "the range you asked for is beyond the file".
  if (end < start) return { kind: 'full' }
  if (start >= size) return { kind: 'unsatisfiable' }
  return { kind: 'partial', start, end: Math.min(end, size - 1) }
}

/** `bytes 0-1023/4096` for a partial response. */
export function contentRangeHeader(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`
}

// `bytes */4096` for a 416 — the star form (written without a comment here, since
// a literal star-slash inside a block comment terminates it).
/** Header value for a 416: `bytes *` + `/` + size. */
export function unsatisfiedRangeHeader(size: number): string {
  return `bytes */${size}`
}
