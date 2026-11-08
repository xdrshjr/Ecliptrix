/**
 * Start the standalone bundle the way a real deployment does.
 *
 * `node .next/standalone/server.js` does NOT read a `.env` file — in production the
 * environment comes from systemd `EnvironmentFile` / Docker `env_file`. This script
 * exists to reproduce that contract locally: it parses the project `.env`, passes
 * the values through explicitly, and pins the port so a stray `PORT` in the parent
 * shell cannot point the health check at a different service.
 *
 *   node scripts/start-standalone.mjs          # PORT 8791, DATABASE_PATH data/standalone.db
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const standaloneDir = resolve(root, '.next/standalone')
const serverFile = resolve(standaloneDir, 'server.js')

if (!existsSync(serverFile)) {
  console.error('[start-standalone] missing .next/standalone/server.js — run `npm run build` first')
  process.exit(1)
}

/** Minimal .env parser: `KEY=value`, `#` comments, optional surrounding quotes. */
function readDotEnv(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const comment = value.indexOf(' #')
      if (comment >= 0) value = value.slice(0, comment).trim()
    }
    out[key] = value
  }
  return out
}

const env = {
  ...readDotEnv(resolve(root, '.env')),
  ...process.env,
  NODE_ENV: 'production',
  PORT: process.env.STANDALONE_PORT ?? '8791',
  HOSTNAME: process.env.STANDALONE_HOST ?? '127.0.0.1',
  DATABASE_PATH: process.env.DATABASE_PATH ?? resolve(root, 'data/standalone.db'),
  MIGRATIONS_DIR:
    process.env.MIGRATIONS_DIR ?? resolve(standaloneDir, 'src/server/db/migrations'),
}

const child = spawn(process.execPath, [serverFile], { cwd: standaloneDir, env, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
