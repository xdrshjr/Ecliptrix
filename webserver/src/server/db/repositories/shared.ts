import type { Db } from '@/server/db/client'

/**
 * Thin repository helpers.
 *
 * Repositories are the only place SQL is written (spec §2.2 rule 3). They return
 * rows verbatim — no DTO mapping, no business branching — so services stay
 * readable and the SQL stays greppable.
 */

/** Build `?, ?, ?` for an IN list; returns '' for an empty list. */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ')
}

/** Run `fn` inside a transaction; rolls back on any throw. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)()
}

export interface CountRow {
  count: number
}

/** `SELECT COUNT(*)` helper — one column, one row, always a number. */
export function scalarCount(db: Db, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as CountRow | undefined
  return row?.count ?? 0
}

/**
 * Count with named parameters.
 *
 * SQLite rejects positional values for a statement written with `@name`
 * placeholders, so filter builders that use names must count through this variant.
 */
export function scalarCountNamed(db: Db, sql: string, params: Record<string, unknown>): number {
  const row = db.prepare(sql).get(params) as CountRow | undefined
  return row?.count ?? 0
}

/**
 * LIKE pattern for a prefix search, escaping the wildcards a user could type.
 * `%` and `_` in a search box must match literally, not act as wildcards.
 */
export function likePrefix(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (match) => `\\${match}`)
  return `${escaped}%`
}

/** LIKE pattern for a contains search (used for display names). */
export function likeContains(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (match) => `\\${match}`)
  return `%${escaped}%`
}
