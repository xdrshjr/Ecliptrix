/**
 * `npm run release:publish -- --file <installer> --version 1.0.2 [options]`
 *
 * The second upload channel, for a build machine or a link too slow for a browser
 * form. It goes through the SAME service as the HTTP endpoint, so the checksum,
 * the content-addressed file name, the `.part` → `rename` sequence and the draft
 * row are identical — there is no second implementation to drift.
 *
 * Options
 *   --file      path to the installer (required)
 *   --version   x.y.z (required)
 *   --platform  win (default win; see RELEASE_PLATFORMS)
 *   --arch      x64 | arm64 (default x64)
 *   --notes     release notes, plain text
 *   --publish   also make it the current build for its platform
 *   --channel   stable | beta (default stable; only meaningful with --publish)
 *   --dry-run   validate and print what would happen, touch nothing
 *
 * Exit codes: 0 done, 1 refused/failed, 2 usage.
 */
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { basename } from 'node:path'
import { openDatabase, setDbForTests } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import { runSeed } from '../src/server/db/seed'
import { SYSTEM_ACTOR } from '../src/server/services/auditService'
import { uploadRelease } from '../src/server/services/releaseUpload'
import * as releaseService from '../src/server/services/releaseService'
import { DEFAULT_RELEASE_CHANNEL, platformSpec } from '../src/lib/releases'

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  if (index >= 0) return argv[index + 1]
  const inline = argv.find((value) => value.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : undefined
}

function usage(): never {
  console.error(
    'usage: npm run release:publish -- --file <installer> --version <x.y.z> ' +
      '[--platform win] [--arch x64] [--notes "..."] [--publish] [--channel stable] [--dry-run]',
  )
  process.exit(2)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) usage()
  const file = arg(argv, 'file')
  const version = arg(argv, 'version')
  const platform = arg(argv, 'platform') ?? 'win'
  const arch = arg(argv, 'arch') ?? platformSpec(platform)?.arches[0] ?? 'x64'
  const notes = arg(argv, 'notes') ?? ''
  const channel = arg(argv, 'channel') ?? DEFAULT_RELEASE_CHANNEL
  const publish = argv.includes('--publish')
  const dryRun = argv.includes('--dry-run')

  if (!file || !version) usage()

  // Same boot order as every other CLI: read `.env` before anything asks for
  // configuration, or a plain `npm run release:publish` fails on the first read.
  loadDotEnv()

  const stats = statSync(file)
  const fileName = basename(file)
  console.log(
    `[release:publish] ${fileName} (${stats.size} bytes) → ${version} (${platform}/${arch})` +
      (publish ? `, channel ${channel}` : ', draft only'),
  )
  if (dryRun) {
    console.log('[release:publish] --dry-run: nothing written')
    return
  }

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)
  await runSeed()

  const release = await uploadRelease(
    { version, platform, arch, fileName, notes },
    Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
    SYSTEM_ACTOR,
  )
  console.log(`[release:publish] draft created id=${release.id} sha256=${release.sha256.slice(0, 12)}…`)

  if (publish) {
    const published = releaseService.publishRelease(release.id, SYSTEM_ACTOR, channel)
    console.log(`[release:publish] published ${published.version} on ${channel}/${published.platform}`)
  } else {
    console.log('[release:publish] left as draft — publish it in /admin/releases or re-run with --publish')
  }
  db.close()
}

main().catch((error: unknown) => {
  console.error(`[release:publish] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
