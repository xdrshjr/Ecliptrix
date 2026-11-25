/**
 * Release-catalogue vocabulary shared by the server and the console UI.
 *
 * The platform list is the single source of truth for "which artifacts may exist".
 * The desktop app only produces Windows x64 NSIS installers today, so the landing
 * page used to advertise macOS — a promise with no artifact behind it. Rendering
 * the buttons from published rows (and validating uploads against this list)
 * removes both the false promise and the chance of an upload the download page
 * could never show.
 *
 * Not in `lib/api/endpoints.ts`: that file is the client-side HTTP surface, while
 * this is domain vocabulary the server also imports.
 */

export const RELEASE_CHANNELS = ['stable', 'beta'] as const

export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]

/** The channel `/download` and the 426 body point at. */
export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = 'stable'

export function isReleaseChannel(value: string): value is ReleaseChannel {
  return (RELEASE_CHANNELS as readonly string[]).includes(value)
}

export interface PlatformSpec {
  /** Stored in the database and used in URLs. */
  readonly id: string
  /** Human name, shown in the console and on `/download`. */
  readonly label: string
  readonly arches: readonly string[]
  /** File extensions an installer for this platform may have. */
  readonly extensions: readonly string[]
}

/**
 * Platforms this build knows how to publish.
 *
 * One arch per platform, deliberately. "Which build is current" is one pointer row
 * per `(channel, platform)` and the download URL carries no arch, so offering
 * `x64` and `arm64` for the same platform would let an arm64 upload silently
 * replace the pointer every x64 user is served — with no visible warning and no
 * way for them to get their build back. The desktop app produces one Windows x64
 * NSIS installer today (`desktop/electron-builder.yml`), so that is the one entry;
 * adding a real second artifact means adding it as a distinct platform (or making
 * arch part of the pointer key and the URL), not widening this array.
 */
export const RELEASE_PLATFORMS: readonly PlatformSpec[] = [
  { id: 'win', label: 'Windows', arches: ['x64'], extensions: ['.exe', '.msi', '.zip'] },
]

export function platformSpec(platform: string): PlatformSpec | undefined {
  return RELEASE_PLATFORMS.find((candidate) => candidate.id === platform)
}

export function isReleasePlatform(platform: string): boolean {
  return platformSpec(platform) !== undefined
}

export function platformLabel(platform: string): string {
  return platformSpec(platform)?.label ?? platform
}

export function isAllowedArch(platform: string, arch: string): boolean {
  const spec = platformSpec(platform)
  return spec ? spec.arches.includes(arch) : false
}

export function isAllowedExtension(platform: string, fileName: string): boolean {
  const spec = platformSpec(platform)
  if (!spec) return false
  const lower = fileName.toLowerCase()
  return spec.extensions.some((extension) => lower.endsWith(extension))
}

/**
 * `1.0.2`, or `1.0.2.1`. Deliberately stricter than the version gate's own
 * parse: this is a *write* boundary, and a value that cannot be ordered would
 * make "is this newer?" unanswerable.
 */
export const RELEASE_VERSION_PATTERN = /^\d+(\.\d+){1,3}$/

/**
 * `1.0.10` → `[1, 0, 10]`; `null` when the string is not dotted digits.
 *
 * Tolerant of a leading `v` and of unequal segment counts; intolerant of anything
 * else, because an unorderable version is exactly the value that turns a policy
 * decision into a guess.
 */
export function parseVersion(value: string): number[] | null {
  const trimmed = value.trim().replace(/^v/i, '')
  if (!trimmed) return null
  const numbers: number[] = []
  for (const part of trimmed.split('.')) {
    if (!/^\d+$/.test(part)) return null
    numbers.push(Number(part))
  }
  return numbers
}

/**
 * Negative when `left` is older, positive when newer, `0` when equal, and `null`
 * when either side cannot be parsed.
 *
 * Shared by the version gate, the release catalogue and the console form: three
 * places that must agree about "is this build too old", so there is one function.
 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Semver-style comparison, tolerant of unequal segment counts (`1.2` vs `1.2.0`).
 *
 * An unparseable value on EITHER side answers `false`: a typo in a setting must
 * never become a fleet-wide lockout. The console validates the format; this is
 * the belt to that braces.
 */
export function isVersionOutdated(clientVersion: string, minVersion: string): boolean {
  const comparison = compareVersions(clientVersion, minVersion)
  if (comparison === null) return false
  return comparison < 0
}

export function isReleaseVersion(value: string): boolean {
  return RELEASE_VERSION_PATTERN.test(value.trim())
}

/** `188.4 MB` — the console and `/download` must show the same number. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1)
  return `${rounded} ${units[unit]}`
}

/**
 * Upper bound for one installer upload (1 GiB).
 *
 * A local desktop installer is ~188 MB, so this is headroom, not a target. The
 * limit is enforced while streaming and aborts immediately: waiting until the
 * body has been buffered would let a single request fill the disk. Nginx must be
 * at least this large for `POST /api/v1/admin/releases` (see
 * `deploy/nginx.conf.example`), which is why it is a documented constant rather
 * than a per-deployment setting.
 */
export const MAX_RELEASE_BYTES = 1024 * 1024 * 1024

/** The authenticated byte endpoint for one channel/platform pair. */
export function releaseDownloadPath(channel: string, platform: string): string {
  return `/api/v1/downloads/${encodeURIComponent(channel)}/${encodeURIComponent(platform)}`
}

/** Where the browser-facing download page lives (the app's own route). */
export const DOWNLOAD_PAGE_PATH = '/download'
