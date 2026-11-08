/**
 * `npm run db:backup`
 *
 * Online backup via SQLite's own `.backup` API — safe while the server is running,
 * which a filesystem copy of a WAL database is not.
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const source = process.env.DATABASE_PATH ?? './data/webserver.db'
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const target = process.env.BACKUP_PATH ?? resolve(dirname(source), `backup-${stamp}.db`)

mkdirSync(dirname(target), { recursive: true })

const db = new Database(source, { readonly: true })
db.backup(target)
  .then(() => {
    db.close()
    console.log(`[db:backup] wrote ${target}`)
  })
  .catch((error) => {
    db.close()
    console.error(`[db:backup] failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
