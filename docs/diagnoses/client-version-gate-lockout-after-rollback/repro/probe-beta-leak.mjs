/**
 * Live evidence for finding 2 in `analysis.md`: a build published ONLY to the beta
 * channel is listed on the public `/download` page and its bytes are served from
 * the stable download URL.
 *
 * Run against the same throwaway server as `live-repro.mjs`.
 *
 *   node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/probe-beta-leak.mjs
 *
 * Exit code 0 = the leak reproduced.
 */
const BASE = process.env.REPRO_BASE_URL ?? 'http://127.0.0.1:8787'
const OWNER_EMAIL = process.env.ROOT_ADMIN_EMAIL ?? 'owner@example.com'
const OWNER_PASSWORD = process.env.ROOT_ADMIN_PASSWORD ?? 'owner-password-123'

const BETA_VERSION = `9.9.${100 + (Math.floor(Date.now() / 1000) % 800)}`
const cookies = new Map()

function absorb(response) {
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair] = entry.split(';')
    const index = pair.indexOf('=')
    if (index < 0) continue
    const name = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (value === '') cookies.delete(name)
    else cookies.set(name, value)
  }
}

async function call(path, { method = 'GET', body, csrf = false, raw } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (raw !== undefined) headers['Content-Type'] = 'application/octet-stream'
  if (cookies.size > 0) {
    headers.Cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }
  if (csrf && cookies.get('ecs_csrf')) headers['X-CSRF-Token'] = cookies.get('ecs_csrf')
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  })
  absorb(response)
  return response
}

const step = (message) => console.log(`\n— ${message}`)
const line = (message) => console.log(`  ${message}`)

const login = await call('/api/v1/auth/login', {
  method: 'POST',
  body: { identifier: OWNER_EMAIL, password: OWNER_PASSWORD, client: 'web' },
})
if (login.status !== 200) throw new Error(`owner login failed: ${login.status}`)

step(`upload ${BETA_VERSION} and publish it ONLY to the beta channel`)
const query = new URLSearchParams({
  version: BETA_VERSION,
  platform: 'win',
  arch: 'x64',
  fileName: `Ecliptrix-Setup-${BETA_VERSION}.exe`,
})
const bytes = Buffer.alloc(4096, 7)
const uploaded = await call(`/api/v1/admin/releases?${query.toString()}`, {
  method: 'POST',
  csrf: true,
  raw: bytes,
})
if (uploaded.status !== 201) throw new Error(`upload failed: ${uploaded.status} ${await uploaded.text()}`)
const release = (await uploaded.json()).data.release
const published = await call(`/api/v1/admin/releases/${release.id}`, {
  method: 'PATCH',
  csrf: true,
  body: { action: 'publish', channel: 'beta' },
})
line(`PATCH publish channel=beta → ${published.status}`)

step('what the STABLE channel says it serves (correct: the beta build is not current)')
const stableLatest = await (await call('/api/v1/releases/latest?channel=stable')).json()
line(`stable current = ${stableLatest.data.release?.version}`)
line(`beta current   = ${(await (await call('/api/v1/releases/latest?channel=beta')).json()).data.release?.version}`)

step('what the public /download page renders for a signed-out visitor')
const page = await call('/download')
const html = await page.text()
line(`GET /download → ${page.status}`)
line(`page mentions ${BETA_VERSION}: ${html.includes(BETA_VERSION)}`)

step(`GET /api/v1/downloads/stable/win?release=<beta build>, signed in as a plain user`)
const download = await call(`/api/v1/downloads/stable/win?release=${encodeURIComponent(release.id)}`)
const body = Buffer.from(await download.arrayBuffer())
line(`status = ${download.status}, bytes = ${body.length}, sha256 in header = ${download.headers.get('x-checksum-sha256')}`)

const leaked = html.includes(BETA_VERSION) && download.status === 200 && body.length === bytes.length
console.log(
  leaked
    ? '\nREPRODUCED: an unreleased beta build is advertised on the public download page and served through the stable byte endpoint.'
    : '\nNOT REPRODUCED.',
)
process.exit(leaked ? 0 : 1)
