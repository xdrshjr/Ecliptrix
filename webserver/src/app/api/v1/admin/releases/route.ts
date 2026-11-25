import { ok, readSearch, withContext } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite } from '@/server/auth/guards'
import { releaseListQuerySchema, releaseUploadQuerySchema } from '@/server/validation/schemas'
import * as releaseService from '@/server/services/releaseService'
import { uploadRelease } from '@/server/services/releaseUpload'
import { RELEASE_CHANNELS, RELEASE_PLATFORMS } from '@/lib/releases'

/**
 * `/api/v1/admin/releases` — the console's upload + list surface.
 *
 * `POST` streams: the metadata arrives in the query string and the body is the
 * raw file (`Content-Type: application/octet-stream`). A multipart form would
 * force `request.formData()`, which buffers the whole installer in memory before
 * the first byte reaches the disk — see `releaseUpload.ts`.
 *
 * `runtime = 'nodejs'` is not optional: the handler writes files with `node:fs`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withContext(async ({ request, context, searchParams }) => {
  requireAdminRead(request, context, 'releases.read')
  const query = readSearch(searchParams, releaseListQuerySchema)
  const items = releaseService.adminList()
  return ok({
    // The catalogue vocabulary is sent with the list so the console renders the
    // platform picker from the server's own registry instead of a second list.
    items: typeof query.limit === 'number' ? items.slice(0, query.limit) : items,
    channels: RELEASE_CHANNELS,
    platforms: RELEASE_PLATFORMS.map((platform) => ({
      id: platform.id,
      label: platform.label,
      arches: platform.arches,
      extensions: platform.extensions,
    })),
    counts: releaseService.statusCounts(),
    latestVersion: releaseService.latestPublishedVersion(),
    latest: releaseService.latestPublished(),
  })
})

export const POST = withContext(async ({ request, context, searchParams }) => {
  const auth = requireAdminWrite(request, context, 'releases.write')
  const query = readSearch(searchParams, releaseUploadQuerySchema)

  const release = await uploadRelease(
    {
      version: query.version,
      platform: query.platform,
      arch: query.arch,
      fileName: query.fileName,
      declaredSha256: query.sha256,
    },
    request.body,
    auth.audit,
  )

  return ok(
    { release },
    { status: 201, message: '安装包已上传，处于草稿状态；确认无误后点「发布」' },
  )
})
