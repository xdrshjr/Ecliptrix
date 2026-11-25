import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { withContext } from '@/server/http/route'
import { requireSession } from '@/server/auth/guards'
import { errors } from '@/server/http/errors'
import * as releaseService from '@/server/services/releaseService'
import * as storage from '@/server/services/releaseStorage'
import {
  contentRangeHeader,
  parseByteRange,
  unsatisfiedRangeHeader,
} from '@/server/services/releaseRange'
import { fail } from '@/server/http/envelope'
import type { RequestContext } from '@/server/http/requestContext'

/**
 * `GET /api/v1/downloads/{channel}/{platform}` — the installer itself.
 *
 * Why this is not an `<a href>` to a file path:
 *  - the requirement is "download after signing in", so the endpoint takes a
 *    session (cookie or Bearer) and is never a public static asset;
 *  - installers are ~188 MB, so the response must stream and must honour `Range`
 *    — every downloader resumes, and a non-ranged 188 MB read is 188 MB of RAM in
 *    the browser;
 *  - `ETag` is the artifact's SHA-256, the same value `/download` prints, so a
 *    resumed or re-requested download is verified against one number.
 *
 * Header contract (analysis R-6(b), each row is a test case):
 *   200 full, 206 partial (prefix / suffix / open-ended), 304 when the ETag
 *   matches, 416 with `Content-Range: bytes * /size` when the range starts past
 *   the end, and HEAD answers the same headers with no body.
 *
 * `?release=<id>` serves one named build instead of the channel's current one, so
 * the "previous releases" table on `/download` is a promise the system keeps: a
 * withdrawn build stays fetchable for the people who already have it installed.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CONTENT_TYPES: Record<string, string> = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
  '.zip': 'application/zip',
}

/** `filename` is sanitised to ASCII because a raw UTF-8 name breaks old download
 * managers; the real name travels in `filename*` (RFC 6266). */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function baseHeaders(etag: string): Headers {
  return new Headers({
    // Private: this is an authenticated artifact, so no shared cache may keep it.
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Accept-Ranges': 'bytes',
    ETag: etag,
  })
}

interface Params {
  params: Promise<{ channel: string; platform: string }>
}

/**
 * Serve one request.
 *
 * 416 is answered through `fail()` like every other error (so the body is the
 * shared envelope), with the RFC-required `Content-Range: bytes * /size` bolted
 * on afterwards.
 */
function serve(
  request: Request,
  context: RequestContext,
  channel: string,
  platform: string,
  releaseId: string | null,
  headOnly: boolean,
): NextResponse {
  requireSession(request, context, { allowPasswordChangeRequired: true })

  const target = releaseService.resolveDownload(channel, platform, releaseId)
  const release = target.release
  const etag = `"${release.sha256}"`
  const headers = baseHeaders(etag)

  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && (ifNoneMatch.trim() === '*' || ifNoneMatch.includes(etag))) {
    return new NextResponse(null, { status: 304, headers })
  }

  const range = parseByteRange(request.headers.get('range'), target.size)
  if (range.kind === 'unsatisfiable') {
    const response = fail(errors.rangeNotSatisfiable(target.size), context.requestId)
    response.headers.set('Content-Range', unsatisfiedRangeHeader(target.size))
    response.headers.set('Accept-Ranges', 'bytes')
    response.headers.set('ETag', etag)
    return response
  }

  headers.set('Content-Type', CONTENT_TYPES[storage.artifactExtension(release.storage_key)] ?? 'application/octet-stream')
  headers.set('Content-Disposition', contentDisposition(release.file_name))
  headers.set('X-Checksum-Sha256', release.sha256)

  const start = range.kind === 'partial' ? range.start : undefined
  const end = range.kind === 'partial' ? range.end : undefined
  const length = range.kind === 'partial' ? range.end - range.start + 1 : target.size

  if (range.kind === 'partial') {
    headers.set('Content-Range', contentRangeHeader(range.start, range.end, target.size))
  }
  headers.set('Content-Length', String(length))

  if (headOnly) {
    return new NextResponse(null, { status: range.kind === 'partial' ? 206 : 200, headers })
  }

  const stream = storage.openArtifactStream(target.path, start, end)
  // A browser that cancels a download leaves the file handle open unless the
  // signal is honoured; repeat "download → cancel" enough times and the process
  // dies of EMFILE.
  request.signal.addEventListener('abort', () => stream.destroy())

  // Counted when the response is produced, not when the last byte lands: the
  // alternative is waiting for a 188 MB stream to finish before answering, and a
  // read error mid-flight cannot become a different status code anyway (the
  // headers are already on the wire). A truncated download stays detectable
  // because the checksum travels in `X-Checksum-Sha256` and on `/download` —
  // do not "fix" truncation by buffering the file.
  releaseService.noteDownload(release.id)

  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
  return new NextResponse(body, { status: range.kind === 'partial' ? 206 : 200, headers })
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { channel, platform } = await params
  const releaseId = new URL(request.url).searchParams.get('release')
  return withContext(async ({ context }) =>
    serve(request, context, channel, platform, releaseId, false),
  )(request)
}

/** Downloaders and browsers probe with HEAD before they commit to a transfer. */
export async function HEAD(request: Request, { params }: Params): Promise<Response> {
  const { channel, platform } = await params
  const releaseId = new URL(request.url).searchParams.get('release')
  return withContext(async ({ context }) =>
    serve(request, context, channel, platform, releaseId, true),
  )(request)
}
