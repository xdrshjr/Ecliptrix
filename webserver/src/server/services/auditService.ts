import { getDb } from '@/server/db/client'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import { newId } from '@/server/auth/tokens'
import { log } from '@/server/http/requestContext'

/**
 * Audit façade.
 *
 * Every write path calls `record`. `metadata` carries before/after diffs of
 * non-sensitive fields only — tokens, hashes and plaintext passwords are never
 * passed in, and `redact()` runs as a second line of defence.
 */

export interface AuditContext {
  actorUserId: string | null
  actorLabel: string
  ip: string
  requestId: string
}

export interface RecordAuditOptions {
  action: string
  targetType: string
  targetId?: string
  metadata?: Record<string, unknown>
  /** Overrides the ambient context (CLI, seeding, system auto-unlock). */
  actor?: Partial<AuditContext>
}

export const SYSTEM_ACTOR: AuditContext = {
  actorUserId: null,
  actorLabel: 'system',
  ip: '',
  requestId: '',
}

/**
 * Write one audit row. Never throws: losing an audit line must not roll back a
 * successful business transaction, but it MUST be visible in the logs.
 */
export function record(context: AuditContext, options: RecordAuditOptions): void {
  try {
    const actor = { ...context, ...options.actor }
    auditRepo.insert(getDb(), {
      id: newId(),
      actorUserId: actor.actorUserId,
      actorLabel: actor.actorLabel,
      action: options.action,
      targetType: options.targetType,
      targetId: options.targetId ?? '',
      metadata: options.metadata ?? {},
      ip: actor.ip,
      requestId: actor.requestId,
      now: Date.now(),
    })
  } catch (error) {
    log('error', 'audit write failed', {
      action: options.action,
      targetType: options.targetType,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Convenience for changes where both sides are useful for forensics. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {}
  for (const [key, nextValue] of Object.entries(after)) {
    const previous = before[key]
    if (previous === nextValue) continue
    out[key] = { before: previous, after: nextValue }
  }
  return out
}
