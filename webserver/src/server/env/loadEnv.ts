import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Minimal `.env` loader for non-Next entry points (CLI scripts).
 *
 * `next dev` / `next build` load `.env` themselves; a `tsx scripts/*.ts` process
 * does not, and having the CLI silently fail on a required variable that IS in
 * `.env` is the kind of papercut that gets misdiagnosed as a broken config.
 *
 * Rules mirror Next's: an already-set variable always wins, values are trimmed,
 * `#` starts a comment, and a quoted value keeps its inner spaces.
 */
export function loadDotEnv(path = resolve(process.cwd(), '.env')): void {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (process.env[key] !== undefined) continue

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const comment = value.indexOf(' #')
      if (comment >= 0) value = value.slice(0, comment).trim()
    }
    process.env[key] = value
  }
}
