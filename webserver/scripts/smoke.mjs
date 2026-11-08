/**
 * End-to-end smoke test against a RUNNING server.
 *
 *   npm run dev            # terminal 1
 *   node scripts/smoke.mjs # terminal 2
 *
 * It walks the real HTTP surface with real cookies and a real CSRF token, in the
 * order a person would: see the landing page, register, sign in as the owner,
 * create and suspend a user, change a setting, read the audit log, sign out. The
 * unit suite cannot prove those paths work; this can.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787'

let passed = 0
let failed = 0
const cookies = new Map()

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

function absorbCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? []
  for (const entry of raw) {
    const [pair] = entry.split(';')
    const index = pair.indexOf('=')
    if (index < 0) continue
    const name = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (value === '') cookies.delete(name)
    else cookies.set(name, value)
  }
}

async function call(path, { method = 'GET', body, csrf = false, bearer } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookies.size > 0) headers.Cookie = cookieHeader()
  if (csrf && cookies.get('ecs_csrf')) headers['X-CSRF-Token'] = cookies.get('ecs_csrf')
  if (bearer) headers.Authorization = `Bearer ${bearer}`

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  absorbCookies(response)
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, json, text, headers: response.headers }
}

async function main() {
  console.log(`\nsmoke → ${BASE}\n`)
  const email = `smoke-${Date.now()}@example.com`
  const password = 'quiet meadow lantern drift'
  const ownerPassword = process.env.ROOT_ADMIN_PASSWORD ?? 'owner-password-123'
  const ownerEmail = process.env.ROOT_ADMIN_EMAIL ?? 'owner@example.com'

  // ---- public surface -----------------------------------------------------
  const health = await call('/api/v1/health')
  check('GET /health → 200 ok', health.status === 200 && health.json?.data?.status === 'ok')

  const ready = await call('/api/v1/ready')
  check('GET /ready → 200 ready', ready.status === 200 && ready.json?.data?.status === 'ready')

  const meta = await call('/api/v1/meta')
  check('GET /meta exposes the registration switch', typeof meta.json?.data?.registrationEnabled === 'boolean')

  const landing = await fetch(`${BASE}/`)
  const landingHtml = await landing.text()
  check('GET / renders the landing page', landing.status === 200 && landingHtml.includes('Ecliptrix'))
  check(
    'middleware sets a CSP header',
    (landing.headers.get('content-security-policy') ?? '').includes("default-src 'self'"),
  )
  check('middleware sets X-Frame-Options', landing.headers.get('x-frame-options') === 'DENY')

  const guarded = await fetch(`${BASE}/admin`, { redirect: 'manual' })
  check(
    'GET /admin without a cookie redirects to /login',
    guarded.status === 307 || guarded.status === 302,
    `got ${guarded.status}`,
  )

  // ---- registration -------------------------------------------------------
  const registered = await call('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password, username: `smoke${Date.now() % 100000}`, client: 'web' },
  })
  check('POST /auth/register → 201', registered.status === 201, JSON.stringify(registered.json))
  check('registration set the session cookie', cookies.has('ecs_session'))
  check('registration set the csrf cookie', cookies.has('ecs_csrf'))

  const me = await call('/api/v1/me')
  check('GET /me returns the new user', me.status === 200 && me.json?.data?.email === email)

  const forbidden = await call('/api/v1/admin/users')
  check('member cannot list users (403)', forbidden.status === 403)

  const patched = await call('/api/v1/me', {
    method: 'PATCH',
    csrf: true,
    body: { displayName: 'Smoke Tester' },
  })
  check('PATCH /me updates the display name', patched.json?.data?.displayName === 'Smoke Tester')

  const rejected = await call('/api/v1/me', {
    method: 'PATCH',
    csrf: true,
    body: { displayName: 'x', status: 'active' },
  })
  check('PATCH /me rejects an admin-only field (422)', rejected.status === 422)

  const noCsrf = await call('/api/v1/me', { method: 'PATCH', body: { displayName: 'nope' } })
  check('PATCH /me without CSRF is refused', noCsrf.status === 403 && noCsrf.json?.error_code === 'csrf_failed')

  const loggedOut = await call('/api/v1/auth/logout', { method: 'POST', csrf: true })
  check('POST /auth/logout → 200', loggedOut.status === 200)
  cookies.clear()

  // ---- owner sign-in ------------------------------------------------------
  const login = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: ownerEmail, password: ownerPassword, client: 'web' },
  })
  check('owner sign-in → 200', login.status === 200, JSON.stringify(login.json))
  check('owner carries the wildcard permission', login.json?.data?.user?.permissions?.includes('*'))
  check('web login does not leak the access token in the body', login.json?.data?.accessToken === undefined)

  // The desktop client has no cookie jar. Drop the browser cookies for the desktop
  // calls; the owner signs in again below, because reuse detection deliberately
  // revokes EVERY session of the account.
  cookies.clear()

  const desktopLogin = await call('/api/v1/auth/login', {
    method: 'POST',
    body: {
      identifier: ownerEmail,
      password: ownerPassword,
      client: 'desktop',
      device: { name: 'Smoke Device', platform: 'win32', appVersion: '0.1.0' },
    },
  })
  check(
    'desktop login returns tokens',
    typeof desktopLogin.json?.data?.accessToken === 'string' &&
      typeof desktopLogin.json?.data?.refreshToken === 'string',
  )
  const desktopToken = desktopLogin.json?.data?.accessToken
  const desktopRefresh = desktopLogin.json?.data?.refreshToken

  const heartbeat = await call('/api/v1/auth/heartbeat', { method: 'POST', bearer: desktopToken })
  check('desktop heartbeat → 200', heartbeat.status === 200 && heartbeat.json?.data?.ok === true)

  const refreshed = await call('/api/v1/auth/refresh', {
    method: 'POST',
    bearer: desktopToken,
    body: { refreshToken: desktopRefresh },
  })
  check('refresh rotates the token pair', refreshed.status === 200 && Boolean(refreshed.json?.data?.refreshToken))

  const reuse = await call('/api/v1/auth/refresh', {
    method: 'POST',
    bearer: desktopToken,
    body: { refreshToken: desktopRefresh },
  })
  check('replaying the old refresh token is refused', reuse.status === 401, `got ${reuse.status}`)

  const afterReuse = await call('/api/v1/auth/heartbeat', { method: 'POST', bearer: desktopToken })
  check('reuse detection revoked the session', afterReuse.status === 401, `got ${afterReuse.status}`)

  // Back to the browser jar for the console surface. Reuse detection deliberately
  // revoked EVERY session of the account (that is the point of the control), so the
  // browser session captured above is dead too — sign in again, exactly as a person
  // whose token leaked would have to.
  cookies.clear()
  const relogin = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: ownerEmail, password: ownerPassword, client: 'web' },
  })
  check(
    'owner can sign in again after reuse detection revoked everything',
    relogin.status === 200 && cookies.has('ecs_session'),
  )

  // ---- admin surface ------------------------------------------------------
  const metrics = await call('/api/v1/admin/metrics')
  check('GET /admin/metrics → 200', metrics.status === 200 && typeof metrics.json?.data?.totalUsers === 'number')

  const created = await call('/api/v1/admin/users', {
    method: 'POST',
    csrf: true,
    body: { email: `managed-${Date.now()}@example.com`, username: `managed${Date.now() % 100000}` },
  })
  check('POST /admin/users → 201', created.status === 201, JSON.stringify(created.json))
  check('creation returns a one-time password once', typeof created.json?.data?.temporaryPassword === 'string')
  const managedId = created.json?.data?.user?.id

  const list = await call('/api/v1/admin/users?query=managed&page=1&pageSize=10')
  check('GET /admin/users filters', list.status === 200 && Array.isArray(list.json?.data?.items))
  check('list reports pagination meta', typeof list.json?.data?.page?.total === 'number')

  const suspended = await call(`/api/v1/admin/users/${managedId}`, {
    method: 'PATCH',
    csrf: true,
    body: { status: 'suspended' },
  })
  check('PATCH /admin/users/{id} suspends', suspended.json?.data?.user?.status === 'suspended')

  const ownerProtected = await call(`/api/v1/admin/users/${login.json?.data?.user?.id}`, {
    method: 'PATCH',
    csrf: true,
    body: { status: 'suspended' },
  })
  check(
    'owner cannot be suspended through the API',
    ownerProtected.status === 409 && ownerProtected.json?.error_code === 'cannot_modify_owner',
  )

  const roles = await call('/api/v1/admin/roles')
  check('GET /admin/roles lists four system roles', roles.json?.data?.items?.length >= 4)

  const ownerRole = roles.json?.data?.items?.find((role) => role.key === 'owner')
  const protectOwner = await call(`/api/v1/admin/roles/${ownerRole?.id}/permissions`, {
    method: 'PUT',
    csrf: true,
    body: { permissions: ['users.read'] },
  })
  check(
    'owner permission set is immutable',
    protectOwner.status === 403 && protectOwner.json?.error_code === 'system_role_protected',
  )

  const invite = await call('/api/v1/admin/invites', {
    method: 'POST',
    csrf: true,
    body: { maxUses: 2, expiresInDays: 7, roleKey: 'member' },
  })
  check('POST /admin/invites returns the code once', typeof invite.json?.data?.invite?.code === 'string')

  const invites = await call('/api/v1/admin/invites')
  check(
    'invite list only shows the hint',
    invites.json?.data?.items?.every((item) => item.code === undefined && item.codeHint),
  )

  const audit = await call('/api/v1/admin/audit?page=1&pageSize=20')
  check('GET /admin/audit → 200', audit.status === 200 && audit.json?.data?.items?.length > 0)
  check('audit rows carry an action', typeof audit.json?.data?.items?.[0]?.action === 'string')

  const settingsRead = await call('/api/v1/admin/settings')
  check('GET /admin/settings → 200', settingsRead.status === 200)

  const settingsWrite = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'branding.appName': 'Ecliptrix' },
  })
  check('PATCH /admin/settings → 200', settingsWrite.status === 200)

  const settingsInvalid = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'security.loginMaxAttempts': 99 },
  })
  check('out-of-range setting → 422', settingsInvalid.status === 422)

  // ---- desktop login gate -------------------------------------------------
  // Everything below runs against a throwaway account, and the console cookies
  // are parked: a desktop call must arrive with no `ecs_session`, or the login
  // route (rightly) demands a CSRF token for the session-fixation guard.
  const gateJar = new Map(cookies)
  const withOwnerJar = () => {
    cookies.clear()
    for (const [name, value] of gateJar) cookies.set(name, value)
  }
  const withDesktopJar = () => cookies.clear()

  const gateEmail = `gate-${Date.now()}@example.com`
  const gateDeviceA = 'smokedeviceaaaa1111'
  const gateDeviceB = 'smokedevicebbbb2222'
  const gateDeviceC = 'smokedevicecccc3333'
  const device = (deviceKey) => ({
    name: 'Smoke Gate',
    platform: 'win32-x64',
    appVersion: '1.0.1',
    deviceKey,
  })
  const gateLogin = (clientVersion, deviceKey = gateDeviceA) =>
    call('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: gateEmail,
        password,
        client: 'desktop',
        clientVersion,
        device: device(deviceKey),
      },
    })

  const gateMeta = await call('/api/v1/meta')
  check(
    '/meta exposes minClientVersion, maintenanceMessage and maxActiveSessions',
    typeof gateMeta.json?.data?.minClientVersion === 'string' &&
      typeof gateMeta.json?.data?.maintenanceMessage === 'string' &&
      typeof gateMeta.json?.data?.maxActiveSessions === 'number',
  )

  withDesktopJar()
  // Registration already opened a session on device A (desktop mode sets no cookies).
  const gateRegistered = await call('/api/v1/auth/register', {
    method: 'POST',
    body: {
      email: gateEmail,
      password,
      client: 'desktop',
      clientVersion: '1.0.1',
      device: device(gateDeviceA),
    },
  })
  const gateFirst = await gateLogin('1.0.1')
  const gateSecond = await gateLogin('1.0.1')
  const oldHeartbeat = await call('/api/v1/auth/heartbeat', {
    method: 'POST',
    bearer: gateFirst.json?.data?.accessToken,
  })
  check(
    'signing in twice from one deviceKey revokes the first session',
    gateRegistered.status === 201 &&
      gateSecond.status === 200 &&
      oldHeartbeat.status === 401 &&
      oldHeartbeat.json?.error_code === 'session_revoked',
    `register ${gateRegistered.status}, second ${gateSecond.status}, heartbeat ${oldHeartbeat.status}`,
  )

  withOwnerJar()
  const gateMin = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'client.minVersion': '9.9.9' },
  })
  withDesktopJar()
  const outdated = await gateLogin('1.0.0')
  check(
    'an outdated desktop build → 426 client_outdated with details.minVersion',
    gateMin.status === 200 &&
      outdated.status === 426 &&
      outdated.json?.error_code === 'client_outdated' &&
      outdated.json?.error?.details?.minVersion === '9.9.9',
    `got ${outdated.status} ${outdated.json?.error_code ?? ''}`,
  )

  const current = await gateLogin('10.0.0')
  const currentToken = current.json?.data?.accessToken
  check(
    'a current build still signs in right after a 426',
    current.status === 200 && typeof currentToken === 'string',
    `got ${current.status}`,
  )

  const mySessions = await call('/api/v1/me/sessions', { bearer: currentToken })
  const sessionItems = mySessions.json?.data?.items ?? []
  check(
    '/me/sessions marks exactly one session as current',
    mySessions.status === 200 &&
      sessionItems.filter((item) => item.current).length === 1 &&
      sessionItems.find((item) => item.current)?.id === current.json?.data?.sessionId,
  )
  check(
    '/me/sessions echoes the deviceKey of each desktop row',
    sessionItems.some((item) => item.deviceKey === gateDeviceA),
  )

  withOwnerJar()
  const gateSettings = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: {
      'client.minVersion': '1.0.0',
      'app.maintenanceMessage': '',
      'security.maxActiveSessions': 10,
    },
  })
  const gateSettingsRead = await call('/api/v1/admin/settings')
  const gateSettingsData = gateSettingsRead.json?.data?.settings ?? {}
  check(
    'the three new settings round-trip through PATCH /admin/settings',
    gateSettings.status === 200 &&
      gateSettingsData['client.minVersion'] === '1.0.0' &&
      gateSettingsData['app.maintenanceMessage'] === '' &&
      gateSettingsData['security.maxActiveSessions'] === 10,
  )

  const maintenanceOn = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'app.maintenanceMessage': '今晚 23:00 数据库维护' },
  })
  withDesktopJar()
  const blocked = await gateLogin('1.0.1')
  const beatingDuringMaintenance = await call('/api/v1/auth/heartbeat', {
    method: 'POST',
    bearer: currentToken,
  })
  withOwnerJar()
  const maintenanceOff = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'app.maintenanceMessage': '' },
  })
  withDesktopJar()
  const reopened = await gateLogin('1.0.1')

  check(
    'maintenance mode answers 503 details.reason=maintenance, then reopens on clear',
    maintenanceOn.status === 200 &&
      blocked.status === 503 &&
      blocked.json?.error?.details?.reason === 'maintenance' &&
      maintenanceOff.status === 200 &&
      reopened.status === 200,
    `blocked ${blocked.status}, reopened ${reopened.status}`,
  )
  check(
    'heartbeat keeps working while the announcement is up',
    beatingDuringMaintenance.status === 200,
    `got ${beatingDuringMaintenance.status}`,
  )

  withOwnerJar()
  await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'app.maintenanceMessage': '', 'security.maxActiveSessions': 2 },
  })
  withDesktopJar()
  const slotOne = await gateLogin('1.0.1', gateDeviceA)
  await call('/api/v1/auth/heartbeat', { method: 'POST', bearer: slotOne.json?.data?.accessToken })
  const slotTwo = await gateLogin('1.0.1', gateDeviceB)
  const slotThree = await gateLogin('1.0.1', gateDeviceC)
  const evicted = await call('/api/v1/auth/heartbeat', {
    method: 'POST',
    bearer: slotOne.json?.data?.accessToken,
  })
  const thirdAlive = await call('/api/v1/auth/heartbeat', {
    method: 'POST',
    bearer: slotThree.json?.data?.accessToken,
  })
  check(
    'security.maxActiveSessions=2 evicts the least recently used session',
    slotTwo.status === 200 &&
      slotThree.status === 200 &&
      evicted.status === 401 &&
      thirdAlive.status === 200,
    `evicted ${evicted.status}, third ${thirdAlive.status}`,
  )

  withOwnerJar()
  await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'security.maxActiveSessions': 10 },
  })

  // ---- lockout ------------------------------------------------------------
  // Use a throwaway account, not the owner: this section deliberately burns the
  // failure budget and must never lock the human out of their own console.
  const lockEmail = `lock-${Date.now()}@example.com`
  const lockPassword = 'quiet meadow lantern drift'
  const lockJar = new Map(cookies)
  cookies.clear()
  const lockRegister = await call('/api/v1/auth/register', {
    method: 'POST',
    body: { email: lockEmail, password: lockPassword, client: 'web' },
  })
  check('throwaway account registered for the lockout test', lockRegister.status === 201)

  for (let index = 0; index < 5; index += 1) {
    await call('/api/v1/auth/login', {
      method: 'POST',
      csrf: true,
      body: { identifier: lockEmail, password: `wrong-${index}-password`, client: 'web' },
    })
  }
  const locked = await call('/api/v1/auth/login', {
    method: 'POST',
    csrf: true,
    body: { identifier: lockEmail, password: lockPassword, client: 'web' },
  })
  check(
    'repeated failures lock the account (423, not 429)',
    locked.status === 423 && locked.json?.error_code === 'account_locked',
    `got ${locked.status} ${locked.json?.error_code ?? ''}`,
  )
  check(
    'the lockout reports a retry-after hint',
    typeof locked.json?.error?.details?.retryAfterSeconds === 'number',
  )

  cookies.clear()
  for (const [name, value] of lockJar) cookies.set(name, value)

  // ---- console pages ------------------------------------------------------
  const adminPage = await fetch(`${BASE}/admin`, { headers: { Cookie: cookieHeader() } })
  const adminHtml = await adminPage.text()
  check('GET /admin renders for the owner', adminPage.status === 200 && adminHtml.includes('概览'))

  const usersPage = await fetch(`${BASE}/admin/users`, { headers: { Cookie: cookieHeader() } })
  check('GET /admin/users renders', usersPage.status === 200)

  // Detail page: the tab shell plus the account it belongs to.
  const detailPage = await fetch(`${BASE}/admin/users/${managedId}`, {
    headers: { Cookie: cookieHeader() },
  })
  const detailHtml = await detailPage.text()
  check(
    'GET /admin/users/{id} renders the detail tabs',
    detailPage.status === 200 && detailHtml.includes('会话') && detailHtml.includes('活动'),
  )

  // A deleted or invented id must answer 404, not a 500 stack trace.
  const missingUser = await fetch(`${BASE}/admin/users/00000000-0000-4000-8000-000000000000`, {
    headers: { Cookie: cookieHeader() },
  })
  check('GET /admin/users/{unknown} → 404', missingUser.status === 404, `got ${missingUser.status}`)

  // The OG card is exposed under a hashed path (route-group metadata routes get a
  // suffix), so read the URL out of the landing page's metadata instead of guessing.
  const ogLanding = await fetch(`${BASE}/`)
  const ogLandingHtml = await ogLanding.text()
  const ogMatch = ogLandingHtml.match(/property="og:image" content="([^"]+)"/)
  const ogUrl = ogMatch?.[1]?.replace(/^https?:\/\/[^/]+/, '')
  check('the landing page advertises an OG image', Boolean(ogUrl))
  if (ogUrl) {
    const ogImage = await fetch(`${BASE}${ogUrl}`)
    check(
      'the OG image renders as png',
      ogImage.status === 200 && (ogImage.headers.get('content-type') ?? '').includes('image/png'),
      `got ${ogImage.status} ${ogImage.headers.get('content-type') ?? ''}`,
    )
  }

  // Deletion request: records intent, deletes nothing.
  const deletionRequest = await call('/api/v1/me/deletion-request', { method: 'POST', csrf: true })
  check(
    'POST /me/deletion-request → 200 without deleting the account',
    deletionRequest.status === 200,
    `got ${deletionRequest.status}`,
  )
  const stillThere = await call('/api/v1/me')
  check('the account still exists after a deletion request', stillThere.status === 200)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\nsmoke crashed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
