import { ok, withContext } from '@/server/http/route'
import { errors } from '@/server/http/errors'
import * as releaseService from '@/server/services/releaseService'
import { DEFAULT_RELEASE_CHANNEL, isReleaseChannel } from '@/lib/releases'

/**
 * `GET /api/v1/releases/latest` — what a client may install right now.
 *
 * Public on purpose: the landing page and `/download` render from it, and a user
 * locked out by the version gate is by definition not signed in anywhere. It
 * exposes published fields only (version, size, checksum, notes, per-platform
 * list) — never a storage path, never a draft, never an uploader identity.
 *
 * `downloadUrl` is the human page, not the byte endpoint: the bytes require a
 * session, and the caller of this endpoint may have none.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ searchParams }) => {
  const channel = searchParams.get('channel') ?? DEFAULT_RELEASE_CHANNEL
  if (!isReleaseChannel(channel)) throw errors.notFound('未知的发布通道')
  return ok({
    channel,
    release: releaseService.latestPublished(channel),
    downloadUrl: releaseService.downloadPageUrl(),
  })
})
