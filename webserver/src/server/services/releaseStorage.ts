import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  type ReadStream,
} from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfig } from '@/server/config'
import { AppError } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'

/**
 * Artifact storage for desktop installers.
 *
 * Three rules, each of which the analysis found a concrete way to break:
 *
 *  1. **Never under `public/`.** A standalone `next start` does not serve files
 *     added to `public/` after the build, so an installer copied there uploads
 *     fine and then 404s for everyone. The root comes from `RELEASES_DIR`.
 *  2. **The on-disk name is content-addressed** (`<version>/<platform>/<sha256>.exe`).
 *     The uploaded `file_name` is caller-controlled — `../../config.ts` or two
 *     uploads of `Ecliptrix-Setup.exe` were both real overwrite/traversal vectors.
 *  3. **Write to `.incoming/*.part`, verify, then rename.** A half-written upload
 *     must never look like a downloadable build, and a row must never exist
 *     without its bytes.
 */

/** Absolute root of the artifact directory. */
export function releasesRoot(): string {
  return resolve(getConfig().releasesDir)
}

/**
 * Absolute path of one artifact, or `null` when the key escapes the root.
 *
 * `resolve()` collapses `..`, so the containment check below is what stops a
 * hand-edited row (or a future bug) from reading `../../.env`.
 */
export function artifactPath(storageKey: string): string | null {
  const key = storageKey.trim()
  if (!key || key.includes('\0')) return null
  const root = releasesRoot()
  const candidate = resolve(root, key)
  return candidate.startsWith(`${root}${sep}`) ? candidate : null
}

/** Resolve an artifact that must exist, or raise `not_found`. */
export function resolveArtifact(storageKey: string): { path: string; size: number } {
  const path = artifactPath(storageKey)
  if (!path || !existsSync(path)) {
    // The row outlived its file (a restored database without the artifacts, or a
    // manual cleanup). Say so; do not stream an empty body as if it were a build.
    throw new AppError(ERROR_CODE.notFound, '安装包文件不存在，请联系管理员重新发布')
  }
  const stats = statSync(path)
  if (!stats.isFile() || stats.size <= 0) {
    throw new AppError(ERROR_CODE.notFound, '安装包文件不可用，请联系管理员重新发布')
  }
  return { path, size: stats.size }
}

/**
 * Validate a caller-supplied file name and strip any path component.
 *
 * @throws {AppError} `validation_failed` for an empty, control-character-laden or
 *         traversal-shaped name.
 */
export function sanitizeFileName(raw: string): string {
  const unified = (raw ?? '').replace(/\\/g, '/')
  const base = basename(unified)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!base || base === '.' || base === '..' || base.includes('..')) {
    throw new AppError(ERROR_CODE.validationFailed, '文件名不合法', {
      details: { fields: [{ path: 'fileName', message: '文件名包含非法字符' }] },
    })
  }
  return base.slice(0, 120)
}

/**
 * Storage key for a verified upload: `<version>/<platform>/<sha256><ext>`.
 *
 * Content-addressed, so the same build uploaded twice cannot overwrite itself and
 * a re-upload of different bytes lands on a different path instead of replacing a
 * shipped installer.
 */
export function buildStorageKey(
  version: string,
  platform: string,
  sha256: string,
  fileName: string,
): string {
  if (!/^[0-9A-Za-z._-]+$/.test(version) || !/^[a-z0-9]+$/.test(platform)) {
    throw new AppError(ERROR_CODE.validationFailed, '版本号或平台不合法')
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new AppError(ERROR_CODE.internalError, '哈希不可用于存储路径')
  }
  const extension = extname(fileName).toLowerCase()
  if (!/^\.[a-z0-9]{1,8}$/.test(extension)) {
    throw new AppError(ERROR_CODE.validationFailed, '安装包扩展名不合法', {
      details: { fields: [{ path: 'fileName', message: '需要 .exe/.msi/.zip 等扩展名' }] },
    })
  }
  return `${version}/${platform}/${sha256}${extension}`
}

/** A fresh `.part` path inside the incoming directory (created on demand). */
export function newIncomingPath(): string {
  const directory = join(releasesRoot(), '.incoming')
  mkdirSync(directory, { recursive: true })
  return join(directory, `${randomUUID()}.part`)
}

/**
 * Flush a finished upload to disk and move it into place.
 *
 * `fsync` before `rename` is what makes "the row exists" mean "the bytes are
 * durable": rename without it can leave a zero-length file after a power loss,
 * which the checksum would then report as corrupt with no explanation.
 */
export function finalizeArtifact(partPath: string, storageKey: string): void {
  const target = artifactPath(storageKey)
  if (!target) {
    throw new AppError(ERROR_CODE.internalError, '存储路径越界，拒绝落盘')
  }
  const fd = openSync(partPath, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  mkdirSync(dirname(target), { recursive: true })
  renameSync(partPath, target)
}

/** Remove a partial or rejected file. Missing is fine. */
export function discardArtifact(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // A leftover temporary file in `.incoming/` is not worth failing a request
    // over; the directory is excluded from downloads and pruned by hand.
  }
}

/** Read stream for one byte range of an artifact. */
export function openArtifactStream(path: string, start?: number, end?: number): ReadStream {
  return createReadStream(path, start === undefined ? {} : { start, end })
}

/** Extension of a storage key, for `Content-Type`. */
export function artifactExtension(storageKey: string): string {
  return extname(storageKey).toLowerCase()
}
