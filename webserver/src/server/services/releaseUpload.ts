import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { getDb } from '@/server/db/client'
import * as releasesRepo from '@/server/db/repositories/releasesRepo'
import * as auditService from '@/server/services/auditService'
import * as storage from '@/server/services/releaseStorage'
import { newId } from '@/server/auth/tokens'
import { AppError } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import {
  MAX_RELEASE_BYTES,
  isAllowedArch,
  isAllowedExtension,
  isReleasePlatform,
  isReleaseVersion,
} from '@/lib/releases'
import { toClientReleaseDto, type ClientReleaseDto } from '@/server/db/types'

/**
 * Installer upload — the write half of the release catalogue.
 *
 * Order is the whole point (analysis R-6(c)); every step exists because skipping
 * it produces a specific, observed failure:
 *
 *   1. validate the metadata and reject a duplicate `(version, platform, arch)`
 *      BEFORE reading a byte — otherwise a 188 MB body is streamed in only to be
 *      refused, and a "browser upload of the same file twice" overwrites a
 *      shipped build;
 *   2. stream to `RELEASES_DIR/.incoming/<uuid>.part` while counting bytes and
 *      hashing, aborting the moment the cap is exceeded;
 *   3. verify: non-zero size, declared checksum (when given) matches;
 *   4. fsync + rename to the content-addressed path;
 *   5. only then INSERT the row — and if that insert loses a race, delete the new
 *      file, leaving neither a half package nor a phantom draft.
 *
 * Any failure deletes the `.part` and writes no row.
 */

export interface UploadReleaseInput {
  readonly version: string
  readonly platform: string
  readonly arch: string
  readonly fileName: string
  readonly notes?: string
  /** Optional pre-computed checksum from a build script; verified when present. */
  readonly declaredSha256?: string
}

interface ValidatedUpload {
  version: string
  platform: string
  arch: string
  fileName: string
  notes: string
  declaredSha256: string | null
}

function invalid(field: string, message: string): AppError {
  return new AppError(ERROR_CODE.validationFailed, message, {
    details: { fields: [{ path: field, message }] },
  })
}

function validate(input: UploadReleaseInput): ValidatedUpload {
  const version = (input.version ?? '').trim()
  const platform = (input.platform ?? '').trim()
  const arch = (input.arch ?? '').trim()

  if (!isReleaseVersion(version)) {
    throw invalid('version', '版本号必须是 x.y.z 形式（例如 1.0.2）')
  }
  if (!isReleasePlatform(platform)) {
    throw invalid('platform', `不支持的平台：${platform || '(空)'}`)
  }
  if (!isAllowedArch(platform, arch)) {
    throw invalid('arch', `不支持的架构：${arch || '(空)'}`)
  }
  const fileName = storage.sanitizeFileName(input.fileName ?? '')
  if (!isAllowedExtension(platform, fileName)) {
    throw invalid('fileName', '扩展名与该平台不匹配（Windows 需要 .exe/.msi/.zip）')
  }
  const declared = (input.declaredSha256 ?? '').trim().toLowerCase()
  if (declared && !/^[0-9a-f]{64}$/.test(declared)) {
    throw invalid('sha256', '校验和必须是 64 位十六进制 SHA-256')
  }
  return {
    version,
    platform,
    arch,
    fileName,
    notes: (input.notes ?? '').slice(0, 2000),
    declaredSha256: declared || null,
  }
}

/** Reject a duplicate before the body is consumed. */
function assertNotDuplicate(input: ValidatedUpload): void {
  const existing = releasesRepo.findVersion(getDb(), input.version, input.platform, input.arch)
  if (!existing) return
  throw new AppError(
    ERROR_CODE.conflict,
    `${input.version} (${input.platform}/${input.arch}) 已存在，请勿重复上传；如需替换请先撤回该版本`,
    { details: { releaseId: existing.id, status: existing.status } },
  )
}

interface ReceivedArtifact {
  sha256: string
  byteSize: number
  partPath: string
}

/**
 * Stream the body to a temporary file, hashing and capping as it goes.
 *
 * `Readable.fromWeb` keeps the request as a stream: `request.formData()` or
 * `arrayBuffer()` would buffer the whole installer in memory (analysis §6.4).
 */
async function receive(
  body: ReadableStream<Uint8Array> | null,
  declaredSha256: string | null,
): Promise<ReceivedArtifact> {
  if (!body) {
    throw invalid('file', '请求体缺少安装包内容')
  }
  const partPath = storage.newIncomingPath()
  const hash = createHash('sha256')
  let byteSize = 0

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length
      if (byteSize > MAX_RELEASE_BYTES) {
        callback(
          new AppError(ERROR_CODE.payloadTooLarge, '安装包超过 1 GiB 上限，已中止上传'),
        )
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(partPath),
    )
  } catch (error) {
    storage.discardArtifact(partPath)
    throw error
  }

  if (byteSize === 0) {
    storage.discardArtifact(partPath)
    throw invalid('file', '安装包内容为空，已拒绝')
  }
  const sha256 = hash.digest('hex')
  if (declaredSha256 && declaredSha256 !== sha256) {
    storage.discardArtifact(partPath)
    throw invalid('sha256', '上传内容与声明的校验和不一致')
  }
  return { sha256, byteSize, partPath }
}

/**
 * Upload one installer and leave it in `draft`.
 *
 * @param body the raw request body stream.
 * @param audit ambient audit context; the action `releases.upload` is recorded.
 * @throws {AppError} `validation_failed` / `conflict` / `payload_too_large`.
 */
export async function uploadRelease(
  input: UploadReleaseInput,
  body: ReadableStream<Uint8Array> | null,
  audit: auditService.AuditContext,
): Promise<ClientReleaseDto> {
  const validated = validate(input)
  assertNotDuplicate(validated)

  const received = await receive(body, validated.declaredSha256)
  const storageKey = storage.buildStorageKey(
    validated.version,
    validated.platform,
    received.sha256,
    validated.fileName,
  )

  try {
    storage.finalizeArtifact(received.partPath, storageKey)
  } catch (error) {
    storage.discardArtifact(received.partPath)
    throw error
  }

  const now = Date.now()
  const id = newId()
  try {
    releasesRepo.insert(getDb(), {
      id,
      version: validated.version,
      platform: validated.platform,
      arch: validated.arch,
      fileName: validated.fileName,
      storageKey,
      byteSize: received.byteSize,
      sha256: received.sha256,
      notes: validated.notes,
      createdBy: audit.actorUserId,
      now,
    })
  } catch (error) {
    // Lost a race with a concurrent upload of the same version: the file this
    // request just wrote is unreferenced, so remove it rather than leaking it.
    const target = storage.artifactPath(storageKey)
    if (target) storage.discardArtifact(target)
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      throw new AppError(ERROR_CODE.conflict, '该版本已存在，请刷新后重试')
    }
    throw error
  }

  const created = releasesRepo.findById(getDb(), id)
  if (!created) throw new AppError(ERROR_CODE.internalError, '上传后无法读取发布记录')

  auditService.record(audit, {
    action: 'releases.upload',
    targetType: 'client_release',
    targetId: id,
    // Never the storage path: it leaks the deployment layout into the audit log.
    metadata: {
      version: validated.version,
      platform: validated.platform,
      arch: validated.arch,
      byteSize: received.byteSize,
      sha256: received.sha256.slice(0, 12),
    },
  })

  return toClientReleaseDto(created)
}
