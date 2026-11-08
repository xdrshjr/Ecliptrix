import { cookies } from 'next/headers'
import type { UserRow } from '@/server/db/types'
import { resolveAuth, type AuthContext } from '@/server/auth/guards'
import { SESSION_COOKIE } from '@/server/auth/constants'
import { buildRequestContext } from '@/server/http/requestContext'
import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'

/**
 * Session access for React Server Components.
 *
 * Server components cannot receive the `Request` object, so this reconstructs the
 * minimal shape the guards need from `next/headers`. It is the same guard code
 * the API routes run — there is exactly one authorisation implementation.
 */
export async function currentSession(): Promise<AuthContext | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const pseudoRequest = new Request('http://localhost/', {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
  })
  const context = buildRequestContext(pseudoRequest)

  try {
    return resolveAuth(pseudoRequest, context)
  } catch {
    // Any failure (revoked, expired, suspended, deleted) means "no usable
    // session" from a page's point of view; the API answers in detail.
    return null
  }
}

export async function currentUser(): Promise<UserRow | null> {
  const session = await currentSession()
  if (!session) return null
  return usersRepo.findById(getDb(), session.user.id) ?? null
}
