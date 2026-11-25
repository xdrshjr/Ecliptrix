import { getDb } from '@/server/db/client'
import * as releasesRepo from '@/server/db/repositories/releasesRepo'
import * as auditService from '@/server/services/auditService'
import * as storage from '@/server/services/releaseStorage'
import { inTransaction } from '@/server/db/repositories/shared'
import { AppError } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import { getConfig } from '@/server/config'
import { compareVersions } from '@/server/services/version'
import {
  DEFAULT_RELEASE_CHANNEL,
  DOWNLOAD_PAGE_PATH,
  isReleaseChannel,
  isReleaseVersion,
  type ReleaseChannel,
} from '@/lib/releases'
import {
  iso,
  toClientReleaseDto,
  type ClientReleaseDto,
  type ClientReleaseRow,
  type ClientReleaseStatus,
  type PublishedReleaseDto,
} from '@/server/db/types'

/**
 * The release catalogue: what is current, what came before, and the actions that
 * move one pointer.
 *
 * Design rule that everything below follows: **history is rows, "current" is one
 * pointer row per (channel, platform).** Publish, rollback and retract are all a
 * single `UPDATE` on that pointer, so they are atomic under SQLite's single
 * writer and a rollback can never lose the build it rolled back from.
 */

export interface LatestReleaseView {
  /** Highest version currently published across platforms. */
  version: string
  notes: string
  publishedAt: string | null
  channel: ReleaseChannel
  platforms: (PublishedReleaseDto & { downloadPath: string })[]
}

export interface AdminReleaseRow extends ClientReleaseDto {
  createdByLabel: string | null
  /** Channels currently pointing at this release. */
  pointedBy: { channel: string; platform: string }[]
}

export interface DownloadTarget {
  release: ClientReleaseRow
  path: string
  size: number
  /** Channel the request was made on (a named build is still channel-scoped). */
  channel: ReleaseChannel
}

function assertChannel(channel: string): ReleaseChannel {
  if (!isReleaseChannel(channel)) {
    throw new AppError(ERROR_CODE.notFound, '未知的发布通道')
  }
  return channel
}

function requireRelease(id: string): ClientReleaseRow {
  const row = releasesRepo.findById(getDb(), id)
  if (!row) throw new AppError(ERROR_CODE.notFound, '发布记录不存在')
  return row
}

/** `{origin}/download` — built from configuration, never from a Host header. */
export function downloadPageUrl(): string {
  return `${getConfig().publicBaseUrl}${DOWNLOAD_PAGE_PATH}`
}

/**
 * Highest version the channel currently serves, or `null` when it serves nothing.
 *
 * Deliberately derived from the POINTERS, not from "every row whose status is
 * published": a build published only to `beta` is not downloadable on `/download`,
 * so counting it would let an operator arm `client.minVersion` at a version the
 * stable channel cannot hand out — the fleet upgrades to the same build it already
 * has and is locked out again, which is the exact failure this whole feature
 * exists to remove. "What can a user actually install?" has one answer and this is
 * the function that reads it.
 */
export function latestPublishedVersion(channel: string = DEFAULT_RELEASE_CHANNEL): string | null {
  const resolved = assertChannel(channel)
  const versions = releasesRepo
    .listCurrent(getDb(), resolved)
    .map((row) => row.version)
    .filter(isReleaseVersion)
  if (versions.length === 0) return null
  return versions.reduce((newest, candidate) =>
    (compareVersions(candidate, newest) ?? 0) > 0 ? candidate : newest,
  )
}

/**
 * Refuse a `client.minVersion` that cannot be satisfied.
 *
 * Three rules (analysis C10):
 *  - an empty value means "no gate" and is always allowed;
 *  - the channel serves nothing at all → non-empty is refused: that combination is
 *    a fleet-wide lockout with no download behind it;
 *  - a value above the newest build the channel serves is refused for the same
 *    reason.
 *
 * @throws {AppError} `validation_failed` with a `fields` entry for the form.
 */
export function assertMinVersionAllowed(minVersion: string): void {
  const trimmed = minVersion.trim()
  if (trimmed === '') return
  const latest = latestPublishedVersion()
  if (latest === null) {
    throw new AppError(ERROR_CODE.validationFailed, '当前还没有已发布的客户端版本，不能设置最低版本闸门', {
      details: {
        fields: [
          {
            path: 'client.minVersion',
            message: '尚未发布任何客户端版本；请先在「客户端发布」上传并发布一个版本',
          },
        ],
      },
    })
  }
  const comparison = compareVersions(trimmed, latest)
  // An unorderable value is left to the existing behaviour: the shape is the
  // console's job and `authService` already fails OPEN on it (with a log line).
  // Tightening that here would be a second, silently different rule.
  if (comparison === null) return
  if (comparison > 0) {
    throw new AppError(ERROR_CODE.validationFailed, '最低版本不能高于已发布的最新版本', {
      details: {
        fields: [
          {
            path: 'client.minVersion',
            message: `当前最新已发布版本是 ${latest}，闸门不能高于它`,
          },
        ],
      },
    })
  }
}

function toPublishedDto(row: ClientReleaseRow): PublishedReleaseDto {
  return {
    platform: row.platform,
    arch: row.arch,
    version: row.version,
    fileName: row.file_name,
    byteSize: row.byte_size,
    sha256: row.sha256,
    notes: row.notes,
    publishedAt: iso(row.published_at) ?? iso(row.created_at) ?? '',
    downloads: row.downloads,
  }
}

/**
 * The current release per platform, for `/download` and the 426 body.
 *
 * Rows are ordered by platform, and the version shown at the top of the page is
 * the newest of them; each platform card prints its own row, so a channel whose
 * platforms lag one another cannot display a version that is not the one behind
 * that button.
 *
 * @returns `null` when the channel has no pointer (a brand-new deployment, or
 *          everything retracted) — never a fabricated placeholder.
 */
export function latestPublished(channel: string = DEFAULT_RELEASE_CHANNEL): LatestReleaseView | null {
  const resolved = assertChannel(channel)
  const rows = releasesRepo.listCurrent(getDb(), resolved)
  if (rows.length === 0) return null

  const newest = rows.reduce((best, candidate) =>
    (compareVersions(candidate.version, best.version) ?? 0) > 0 ? candidate : best,
  )
  return {
    version: newest.version,
    notes: newest.notes,
    publishedAt: iso(newest.published_at) ?? iso(newest.created_at),
    channel: resolved,
    platforms: rows.map((row) => ({
      ...toPublishedDto(row),
      downloadPath: `/api/v1/downloads/${resolved}/${row.platform}`,
    })),
  }
}

/** Public history: published and retracted builds, newest first. */
export function history(limit = 20): ClientReleaseDto[] {
  return releasesRepo.listVisible(getDb(), limit).map(toClientReleaseDto)
}

/** Console list: every row, drafts included, with who uploaded it. */
export function adminList(): AdminReleaseRow[] {
  const db = getDb()
  const pointers = releasesRepo.pointerTargets(db)
  return releasesRepo.listWithAuthor(db).map((row) => ({
    ...toClientReleaseDto(row),
    createdByLabel: row.created_by_label,
    pointedBy: pointers.get(row.id) ?? [],
  }))
}

export function statusCounts(): Record<ClientReleaseStatus, number> {
  return releasesRepo.countByStatus(getDb())
}

/**
 * Resolve the artifact behind `(channel, platform)`.
 *
 * @param channel release channel; unknown values answer `not_found`.
 * @param platform platform id (`win`).
 * @param releaseId when given, serve THAT build instead of the channel's current
 *        one. The download page lists the previous builds and tells the user they
 *        can fetch them again — a user whose installed build was withdrawn is
 *        exactly who needs it — so an older published row must stay reachable.
 *        A release id for another platform, or one that is not published, is
 *        refused rather than served through the wrong URL.
 * @throws {AppError} `not_found` when the channel has no current build, the
 *         requested release is not downloadable, or the file on disk is missing —
 *         the last case names the deployment problem instead of streaming an
 *         empty 200.
 */
export function resolveDownload(
  channel: string,
  platform: string,
  releaseId?: string | null,
): DownloadTarget {
  const resolved = assertChannel(channel)
  if (releaseId) return resolveExact(resolved, platform, releaseId)

  const pointer = releasesRepo.pointer(getDb(), resolved, platform)
  if (!pointer?.release_id) {
    throw new AppError(ERROR_CODE.notFound, '该平台当前没有已发布的安装包')
  }
  const release = releasesRepo.findById(getDb(), pointer.release_id)
  if (!release || release.status !== 'published') {
    // A pointer must always aim at a published row (enforced on write); this
    // guard exists so a hand-edited database cannot serve a retracted build.
    throw new AppError(ERROR_CODE.notFound, '该平台当前没有已发布的安装包')
  }
  const artifact = storage.resolveArtifact(release.storage_key)
  return { release, path: artifact.path, size: artifact.size, channel: resolved }
}

/** One named build, served regardless of which build the channel points at now. */
function resolveExact(
  channel: ReleaseChannel,
  platform: string,
  releaseId: string,
): DownloadTarget {
  const release = releasesRepo.findById(getDb(), releaseId)
  if (!release || release.platform !== platform || release.status !== 'published') {
    throw new AppError(ERROR_CODE.notFound, '该版本不可下载或不属于此平台')
  }
  const artifact = storage.resolveArtifact(release.storage_key)
  return { release, path: artifact.path, size: artifact.size, channel }
}

export function noteDownload(id: string): void {
  releasesRepo.incrementDownloads(getDb(), id)
}

/**
 * Publish a build: mark it published (when it is a draft) and point the channel
 * at it — one transaction, one pointer `UPDATE`.
 */
export function publishRelease(
  id: string,
  audit: auditService.AuditContext,
  channel: string = DEFAULT_RELEASE_CHANNEL,
): ClientReleaseDto {
  const resolved = assertChannel(channel)
  const db = getDb()
  const row = requireRelease(id)
  const now = Date.now()
  let before: string | null = null

  inTransaction(db, () => {
    if (row.status !== 'published') releasesRepo.markPublished(db, id, now)
    before = releasesRepo.pointer(db, resolved, row.platform)?.release_id ?? null
    releasesRepo.setPointer(db, {
      channel: resolved,
      platform: row.platform,
      releaseId: id,
      updatedBy: audit.actorUserId,
      now,
    })
  })

  auditService.record(audit, {
    action: 'releases.publish',
    targetType: 'client_release',
    targetId: id,
    metadata: {
      version: row.version,
      platform: row.platform,
      arch: row.arch,
      channel: resolved,
      beforeReleaseId: before,
      afterReleaseId: id,
    },
  })
  return toClientReleaseDto(requireRelease(id))
}

/**
 * Roll the channel back onto an older build.
 *
 * The target must already be published: "rollback" is a pointer move, not a
 * second publishing path, and a retracted build has to be published again first
 * so the audit trail says what happened.
 */
export function rollbackRelease(
  id: string,
  audit: auditService.AuditContext,
  channel: string = DEFAULT_RELEASE_CHANNEL,
): ClientReleaseDto {
  const resolved = assertChannel(channel)
  const db = getDb()
  const row = requireRelease(id)

  if (row.status !== 'published') {
    throw new AppError(ERROR_CODE.conflict, '该版本不在已发布状态，无法回溯；请先发布它', {
      details: { status: row.status },
    })
  }

  const current = releasesRepo.pointer(db, resolved, row.platform)
  const currentRow = current?.release_id ? releasesRepo.findById(db, current.release_id) : undefined
  if (currentRow?.id === row.id) {
    throw new AppError(ERROR_CODE.conflict, '该版本已经是当前版本')
  }
  if (currentRow) {
    const comparison = compareVersions(row.version, currentRow.version)
    if (comparison === null || comparison >= 0) {
      throw new AppError(ERROR_CODE.validationFailed, '回溯目标必须早于当前版本；发布请用「发布」', {
        details: {
          fields: [
            {
              path: 'version',
              message: `当前是 ${currentRow.version}，回溯目标必须更早`,
            },
          ],
        },
      })
    }
  }

  const now = Date.now()
  releasesRepo.setPointer(db, {
    channel: resolved,
    platform: row.platform,
    releaseId: id,
    updatedBy: audit.actorUserId,
    now,
  })
  auditService.record(audit, {
    action: 'releases.rollback',
    targetType: 'client_release',
    targetId: id,
    metadata: {
      version: row.version,
      platform: row.platform,
      channel: resolved,
      beforeReleaseId: currentRow?.id ?? null,
      beforeVersion: currentRow?.version ?? null,
      afterReleaseId: id,
    },
  })
  return toClientReleaseDto(requireRelease(id))
}

/**
 * Retract a build: mark it retracted and clear every pointer aimed at it.
 *
 * The file and the row stay. Deleting them would break the users whose installed
 * build was pulled and who now need it again; physical cleanup is an explicit
 * operations task, not a side effect of this action.
 */
export function retractRelease(id: string, audit: auditService.AuditContext): ClientReleaseDto {
  const db = getDb()
  const row = requireRelease(id)
  const cleared = releasesRepo.pointerTargets(db).get(id) ?? []
  const now = Date.now()

  inTransaction(db, () => {
    releasesRepo.markRetracted(db, id, now)
    releasesRepo.clearPointersFor(db, id, audit.actorUserId, now)
  })

  auditService.record(audit, {
    action: 'releases.retract',
    targetType: 'client_release',
    targetId: id,
    metadata: {
      version: row.version,
      platform: row.platform,
      clearedChannels: cleared.map((pointer) => `${pointer.channel}/${pointer.platform}`),
    },
  })
  return toClientReleaseDto(requireRelease(id))
}

export function updateReleaseNotes(
  id: string,
  notes: string,
  audit: auditService.AuditContext,
): ClientReleaseDto {
  const row = requireRelease(id)
  const next = notes.slice(0, 2000)
  releasesRepo.updateNotes(getDb(), id, next)
  auditService.record(audit, {
    action: 'releases.notes',
    targetType: 'client_release',
    targetId: id,
    metadata: {
      version: row.version,
      before: row.notes.slice(0, 400),
      after: next.slice(0, 400),
    },
  })
  return toClientReleaseDto(requireRelease(id))
}
