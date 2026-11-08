import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { getConfig } from '@/server/config'

export type Db = Database.Database

let instance: Db | undefined

/**
 * Open (or create) the SQLite database and apply the pragmas this service
 * depends on.
 *
 * WAL keeps readers from blocking the single writer; `busy_timeout` turns a
 * transient write lock into a short wait instead of an immediate failure;
 * `foreign_keys` is OFF by default in SQLite and must be enabled per
 * connection or the ON DELETE CASCADE rules in 0001_init.sql never fire.
 */
export function openDatabase(databasePath: string): Db {
  const isMemory = databasePath === ':memory:'
  if (!isMemory) {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true })
  }
  const db = new Database(databasePath)
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  if (!isMemory) {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
  }
  return db
}

/** Process-wide connection, opened lazily from `DATABASE_PATH`. */
export function getDb(): Db {
  if (!instance) {
    instance = openDatabase(getConfig().databasePath)
  }
  return instance
}

/** Replace the shared connection — tests only. */
export function setDbForTests(db: Db | undefined): void {
  instance = db
}

/** Close the shared connection. Safe to call when nothing is open. */
export function closeDatabase(): void {
  if (instance?.open) instance.close()
  instance = undefined
}
