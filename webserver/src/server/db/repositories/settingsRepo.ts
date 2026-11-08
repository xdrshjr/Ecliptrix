import type { Db } from '@/server/db/client'

/** Key/value application settings (JSON-encoded scalars). */

export function getAll(db: Db): Record<string, unknown> {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as {
    key: string
    value: string
  }[]
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    out[row.key] = parseValue(row.value)
  }
  return out
}

export function get<T = unknown>(db: Db, key: string): T | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? (parseValue(row.value) as T) : undefined
}

export function getBoolean(db: Db, key: string, fallback: boolean): boolean {
  const value = get(db, key)
  return typeof value === 'boolean' ? value : fallback
}

export function getNumber(db: Db, key: string, fallback: number): number {
  const value = get(db, key)
  return typeof value === 'number' ? value : fallback
}

export function getString(db: Db, key: string, fallback: string): string {
  const value = get(db, key)
  return typeof value === 'string' ? value : fallback
}

/** Insert-or-replace. Callers validate before reaching here. */
export function setMany(
  db: Db,
  values: Record<string, unknown>,
  updatedBy: string | null,
  now: number,
): void {
  const statement = db.prepare(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  )
  for (const [key, value] of Object.entries(values)) {
    statement.run(key, JSON.stringify(value), updatedBy, now)
  }
}

/** Only insert when absent — used by the boot seed so console edits survive. */
export function setDefaults(
  db: Db,
  values: Record<string, unknown>,
  updatedBy: string | null,
  now: number,
): void {
  const statement = db.prepare(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO NOTHING`,
  )
  for (const [key, value] of Object.entries(values)) {
    statement.run(key, JSON.stringify(value), updatedBy, now)
  }
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    // A hand-edited row must not crash the whole console; treat it as a string.
    return raw
  }
}
