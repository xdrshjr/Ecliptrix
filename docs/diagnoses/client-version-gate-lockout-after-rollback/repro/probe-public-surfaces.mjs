/**
 * Second half of the live evidence: with the gate armed at the withdrawn build,
 * what do the two public surfaces say? Run with the same server as `live-repro.mjs`.
 *
 *   node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/probe-public-surfaces.mjs
 */
const BASE = process.env.REPRO_BASE_URL ?? 'http://127.0.0.1:8787'

const meta = await (await fetch(`${BASE}/api/v1/meta`)).json()
console.log('GET /api/v1/meta')
console.log(`  minClientVersion    = ${meta.data.minClientVersion}`)
console.log(`  latestClientVersion = ${meta.data.latestClientVersion}`)
console.log(`  downloadUrl         = ${meta.data.downloadUrl}`)

const latest = await (await fetch(`${BASE}/api/v1/releases/latest`)).json()
console.log('GET /api/v1/releases/latest')
console.log(`  release.version     = ${latest.data.release?.version}`)
console.log(`  platforms           = ${JSON.stringify(latest.data.release?.platforms.map((p) => `${p.platform}/${p.arch} ${p.version}`))}`)

const page = await fetch(`${BASE}/download`)
const html = await page.text()
const shown = [...html.matchAll(/>(\d+\.\d+\.\d+)</g)].map((match) => match[1])
console.log('GET /download')
console.log(`  status              = ${page.status}`)
console.log(`  versions rendered   = ${[...new Set(shown)].join(', ')}`)

const gateAboveServed =
  meta.data.minClientVersion !== '' &&
  meta.data.latestClientVersion !== null &&
  meta.data.minClientVersion !== meta.data.latestClientVersion
console.log(
  gateAboveServed
    ? '\nCONTRADICTION: the same /meta payload tells the client it must be >= minClientVersion while latestClientVersion is older, so the build it can download cannot clear the gate.'
    : '\nNo contradiction in /meta.',
)
process.exit(gateAboveServed ? 0 : 1)
