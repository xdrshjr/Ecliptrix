/**
 * Personal-data masking.
 *
 * One module so that every place which shows an address or an IP to somebody who
 * does not need the real value masks it the same way. The rules are deliberately
 * lossy-but-recognisable: `a***@b.c` lets a user recognise their own address and
 * an administrator tell two accounts apart, without putting a readable address
 * into an audit row, a console table or a desktop IPC payload.
 *
 * Nothing here is reversible, and nothing here is a security control on its own —
 * it is what keeps a page from becoming a bulk export of personal data.
 */

/** `ada.lovelace@example.com` → `a***@example.com`. */
export function maskEmail(email: string): string {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return trimmed ? `${trimmed.slice(0, 1)}***` : ''
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const head = local.slice(0, 1)
  const domainHead = domain.includes('.') ? domain : domain
  return `${head}***@${domainHead}`
}

/**
 * `203.0.113.42` → `203.0.x.x`; IPv6 keeps its first non-empty group.
 *
 * Two octets are kept because that is what "same network as me" needs in a
 * support conversation, and no more because anything beyond that narrows to a
 * household. `::1` would otherwise mask to a bare `:…`, which tells nobody anything.
 *
 * Anything that is not four dotted parts is NOT returned verbatim: a proxy header
 * carrying a port, a bare hostname or a list `a, b` would otherwise pass a full
 * address straight through to a console table or an export.
 */
/** `1.2.3.4`, optionally with a port — decided by the DOTS, not the colon. */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/
/** Already masked (`203.0.x.x`) — masking must be idempotent. */
const MASKED_IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.x\.x$/

export function maskIp(ip: string): string {
  const value = ip.trim()
  if (!value) return ''
  // Dotted-quad first: `ip:port` also contains a colon, and a colon-first test
  // would answer `203.0.113.42:…` — the full address, from the function whose job
  // is to remove it.
  if (MASKED_IPV4_PATTERN.test(value)) return value
  const ipv4 = IPV4_PATTERN.exec(value)
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.x.x`
  const bare = value.replace(/^\[/, '').replace(/\].*$/, '')
  if (bare.includes(':')) {
    const groups = bare.split(':').filter(Boolean)
    if (groups.length === 0) return '::…'
    return `${groups[0]}:…`
  }
  return '…'
}

/** First 8 characters of an opaque id — enough to correlate, useless to replay. */
export function shortId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8)
}
