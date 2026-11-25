'use client'

import { ApiError, type ApiEnvelope, type ApiErrorBody } from '@/lib/api/client'

/**
 * Browser upload of one installer.
 *
 * `XMLHttpRequest` rather than `fetch`, for one reason: `fetch` cannot report
 * upload progress, and a 188 MB installer over a home connection is minutes of
 * silence. The endpoint streams the body, so the file is handed over as-is —
 * no `FormData`, which would make the server buffer the whole thing.
 *
 * Release notes are NOT part of this request: they belong in a URL only up to a few
 * hundred bytes, and the upload carries the metadata in the query string. The
 * caller sends them with a `PATCH {action:'notes'}` on the draft this returns.
 *
 * The request is cookie-authenticated, so it must carry the double-submit CSRF
 * header exactly as `lib/api/client.ts` does for `fetch`.
 */

export interface UploadProgress {
  /** 0–100, integer. */
  percent: number
  loaded: number
  total: number
}

export interface UploadReleaseRequest {
  version: string
  platform: string
  arch: string
  fileName: string
  file: File
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)ecs_csrf=([^;]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/** Resolve the envelope, or throw the same typed error `api` throws. */
function settle<T>(status: number, raw: string): T {
  let payload: ApiEnvelope<T> | ApiErrorBody | null = null
  try {
    payload = raw ? (JSON.parse(raw) as ApiEnvelope<T> | ApiErrorBody) : null
  } catch {
    payload = null
  }
  if (status >= 200 && status < 300 && payload && 'data' in payload) {
    return payload.data
  }
  const body = payload as ApiErrorBody | null
  throw new ApiError(
    body?.error_code ?? 'internal_error',
    body?.message ?? `上传失败（HTTP ${status}）`,
    status,
    body?.error_details,
  )
}

/**
 * Upload an installer and leave it as a draft on the server.
 *
 * @param onProgress called on every progress event, and once at the end with 100.
 * @throws {ApiError} carrying the server's code, so the dialog can render the
 *         same inline message the REST layer would.
 */
export function uploadInstaller<T = { release: { id: string } }>(
  input: UploadReleaseRequest,
  onProgress: (progress: UploadProgress | null) => void,
): Promise<T> {
  const query = new URLSearchParams({
    version: input.version,
    platform: input.platform,
    arch: input.arch,
    fileName: input.fileName,
  })

  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `/api/v1/admin/releases?${query.toString()}`)
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.setRequestHeader('Accept', 'application/json')
    const csrf = readCsrfCookie()
    if (csrf) request.setRequestHeader('X-CSRF-Token', csrf)

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return
      onProgress({
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
        loaded: event.loaded,
        total: event.total,
      })
    }

    request.onload = () => {
      onProgress(null)
      // The console's 401 handling lives in `api`, which this request bypasses.
      // A session that died mid-upload must not leave the dialog spinning.
      if (request.status === 401) {
        window.location.assign('/login?reason=session-expired&next=%2Fadmin%2Freleases')
        reject(new ApiError('session_expired', '登录已过期', 401))
        return
      }
      try {
        resolve(settle<T>(request.status, request.responseText))
      } catch (error) {
        reject(error)
      }
    }
    request.onerror = () => {
      onProgress(null)
      reject(new ApiError('network_error', '网络中断，上传未完成', 0))
    }
    request.onabort = () => {
      onProgress(null)
      reject(new ApiError('upload_aborted', '上传已取消', 0))
    }

    request.send(input.file)
  })
}
