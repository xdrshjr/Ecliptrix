import { withContext, ok } from '@/server/http/route'
import { fail } from '@/server/http/envelope'
import { AppError } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import { getDb } from '@/server/db/client'
import { pendingMigrations } from '@/server/db/migrate'

/** Readiness probe: proves the database answers and the schema is current. */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ context }) => {
  try {
    const db = getDb()
    db.prepare('SELECT 1 AS ok').get()
    const pending = pendingMigrations(db)
    if (pending.length > 0) {
      return fail(
        new AppError(ERROR_CODE.serviceUnavailable, '数据库结构未升级完成', {
          details: { pendingMigrations: pending.map((migration) => migration.version) },
        }),
        context.requestId,
      )
    }
    return ok({ status: 'ready', database: 'ok', migrations: 'current' })
  } catch (error) {
    return fail(
      new AppError(ERROR_CODE.serviceUnavailable, '数据库不可用', {
        details: { reason: error instanceof Error ? error.message : String(error) },
      }),
      context.requestId,
    )
  }
})
