/**
 * Live repro for `client-version-gate-lockout-after-rollback`.
 *
 * Runs against a REAL webserver (`cd webserver && npm run dev`) with a throwaway
 * database — no mocks, no direct database access. It walks the exact sequence an
 * operator performs and then shows what a shipped desktop client gets.
 *
 *   cd webserver && npm run dev            # terminal 1 (throwaway DATABASE_PATH)
 *   node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/live-repro.mjs
 *
 * Versions are derived from the clock so the script is re-runnable against a
 * database that already holds earlier runs (a duplicate version is a 409 by design).
 *
 * Exit code 0 = the defect reproduced (the fleet is locked out), 1 = it did not.
 */
const BASE = process.env.REPRO_BASE_URL ?? 'http://127.0.0.1:8787'
const OWNER_EMAIL = process.env.ROOT_ADMIN_EMAIL ?? 'owner@example.com'
const OWNER_PASSWORD = process.env.ROOT_ADMIN_PASSWORD ?? 'owner-password-123'

/** The build the channel serves after the rollback, and the withdrawn one. */
const BASE_VERSION = 100 + (Math.floor(Date.now() / 1000) % 800)
const OLDER = `1.0.${BASE_VERSION}`
const NEWER = `1.0.${BASE_VERSION + 1}`

const cookies = new Map()

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

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

async function call(path, { method = 'GET', body, csrf = false, raw, bearer } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (raw !== undefined) headers['Content-Type'] = 'application/octet-stream'
  if (cookies.size > 0) headers.Cookie = cookieHeader()
  if (csrf && cookies.get('ecs_csrf')) headers['X-CSRF-Token'] = cookies.get('ecs_csrf')
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  })
  absorb(response)
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

/** A fake installer: deterministic bytes, big enough to exercise a Range request. */
function installer(seed, size = 8192) {
  const buffer = Buffer.alloc(size)
  for (let index = 0; index < size; index += 1) buffer[index] = (index * seed) % 251
  return buffer
}

async function upload(version) {
  const query = new URLSearchParams({
    version,
    platform: 'win',
    arch: 'x64',
    fileName: `Ecliptrix-Setup-${version}.exe`,
  })
  const response = await call(`/api/v1/admin/releases?${query.toString()}`, {
    method: 'POST',
    csrf: true,
    raw: installer(Number(version.split('.').pop()) || 3),
  })
  if (response.status !== 201) {
    throw new Error(`upload ${version} failed: ${response.status} ${response.text}`)
  }
  return response.json.data.release
}

const step = (message) => console.log(`\n— ${message}`)
const line = (message) => console.log(`  ${message}`)

async function main() {
  const ready = await call('/api/v1/ready')
  line(`server ready: ${ready.status} ${ready.json?.data?.status ?? ''}`)
  line(`this run uses ${OLDER} (kept) and ${NEWER} (withdrawn)`)

  step('operator signs in to the console')
  const login = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: OWNER_EMAIL, password: OWNER_PASSWORD, client: 'web' },
  })
  if (login.status !== 200) throw new Error(`owner login failed: ${login.text}`)
  line(`web login: ${login.status}, cookie session established`)

  step(`publish ${OLDER} on the stable channel`)
  const older = await upload(OLDER)
  await call(`/api/v1/admin/releases/${older.id}`, {
    method: 'PATCH',
    csrf: true,
    body: { action: 'publish', channel: 'stable' },
  })
  line(`served version: ${(await call('/api/v1/releases/latest')).json.data.release.version}`)

  step(`arm the version gate at ${OLDER} (allowed: it is what the channel serves)`)
  let gate = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'client.minVersion': OLDER },
  })
  line(`PATCH settings client.minVersion=${OLDER} → ${gate.status}`)

  step(`publish ${NEWER} and arm the gate at ${NEWER} (still allowed)`)
  const newer = await upload(NEWER)
  await call(`/api/v1/admin/releases/${newer.id}`, {
    method: 'PATCH',
    csrf: true,
    body: { action: 'publish', channel: 'stable' },
  })
  gate = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'client.minVersion': NEWER },
  })
  line(`PATCH settings client.minVersion=${NEWER} → ${gate.status}`)

  step(`${NEWER} turns out broken: the operator rolls back (the documented remedy)`)
  const rollback = await call(`/api/v1/admin/releases/${older.id}`, {
    method: 'PATCH',
    csrf: true,
    body: { action: 'rollback', channel: 'stable' },
  })
  line(`PATCH rollback to ${OLDER} → ${rollback.status}`)

  const latest = await call('/api/v1/releases/latest')
  const served = latest.json.data.release
  const settings = await call('/api/v1/admin/settings')
  const armed = settings.json.data.settings['client.minVersion']
  line(`channel now serves: ${served.version}`)
  line(`stored client.minVersion: ${armed}`)
  line(`download page: ${latest.json.data.downloadUrl}`)

  step(`a desktop client on ${OLDER} — the build the page now hands out — tries to sign in`)
  // The desktop client has no cookie jar, and a login that arrives WITH a session
  // cookie is refused as a session-fixation attempt (auth/login/route.ts:33).
  cookies.clear()
  const blocked = await call('/api/v1/auth/login', {
    method: 'POST',
    body: {
      identifier: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      client: 'desktop',
      clientVersion: OLDER,
      device: { name: 'repro-device', platform: 'win32', appVersion: OLDER },
    },
  })
  line(`POST /api/v1/auth/login (clientVersion=${OLDER}) → ${blocked.status}`)
  line(`error_code: ${blocked.json?.error_code}`)
  line(`details: ${JSON.stringify(blocked.json?.error?.details ?? blocked.json?.error_details)}`)

  step(`… and a client on the withdrawn ${NEWER} gets in, which is the only way back inside`)
  const allowed = await call('/api/v1/auth/login', {
    method: 'POST',
    body: {
      identifier: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      client: 'desktop',
      clientVersion: NEWER,
      device: { name: 'repro-device-3', platform: 'win32', appVersion: NEWER },
    },
  })
  line(`POST /api/v1/auth/login (clientVersion=${NEWER}) → ${allowed.status}`)

  const lockedOut = blocked.status === 426 && served.version === OLDER && allowed.status === 200
  console.log(
    lockedOut
      ? '\nREPRODUCED: every desktop client on the served build is refused before the password is checked, and the only build the 426 body can send them to is the one they already have.'
      : '\nNOT REPRODUCED.',
  )
  process.exit(lockedOut ? 0 : 1)
}

main().catch((error) => {
  console.error(`\nrepro failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
