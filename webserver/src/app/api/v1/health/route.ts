import { withContext, ok } from '@/server/http/route'
import { getConfig } from '@/server/config'

/** Liveness probe: intentionally does not touch the database. */
export const dynamic = 'force-dynamic'

const startedAt = Date.now()

export const GET = withContext(async () => {
  const config = getConfig()
  return ok({
    status: 'ok',
    version: process.env.npm_package_version ?? '0.1.0',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    env: config.nodeEnv,
  })
})
