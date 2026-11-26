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
  // A deterministic source address, as a real forwarder would provide. Without it
  // `clientIpFrom` answers the shared `0.0.0.0` constant and every per-IP budget
  // here — captcha issue, register, login — becomes one site-wide bucket.
  headers['X-Forwarded-For'] = '127.0.0.1'

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

/**
 * Obtain a challenge and the answer a human would type.
 *
 * Registration is gated unconditionally, so every account this script creates has
 * to present one. The server returns `debugAnswer` only when it runs with
 * `ECLIPTRIX_E2E=true` (or `NODE_ENV=test`) AND the caller looks loopback — a
 * production deployment can never satisfy both, because `config.ts` forces
 * `e2eMode` false there.
 *
 * A missing `debugAnswer` therefore means "the server was started without the e2e
 * switch", not a bug in the gate. Failing loudly with that instruction beats a
 * wall of unexplained 400s three sections later.
 */
async function solveCaptcha(purpose = 'register') {
  const issued = await call(`/api/v1/auth/captcha?purpose=${purpose}`)
  const captcha = issued.json?.data?.captcha
  if (!captcha?.id) {
    throw new Error(`captcha issue failed (${issued.status}): ${issued.text.slice(0, 200)}`)
  }
  if (!captcha.debugAnswer) {
    throw new Error(
      'the server did not return debugAnswer — start it with ECLIPTRIX_E2E=true ' +
        '(and no NODE_ENV=production) so the smoke run can solve its own challenges',
    )
  }
  return { captchaId: captcha.id, captchaAnswer: captcha.debugAnswer }
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

  // ---- guest surface: may read, may not download ---------------------------
  // Spec §3.5. These are the four promises the requirement makes, each pinned so
  // a later refactor cannot quietly open the installer to the world or lock the
  // marketing page behind a session.
  const downloadPage = await fetch(`${BASE}/download`, { redirect: 'manual' })
  const downloadHtml = await downloadPage.text()
  check('guest GET /download → 200', downloadPage.status === 200, `got ${downloadPage.status}`)
  check(
    'the download page carries no installer link for a guest',
    !downloadHtml.includes('/api/v1/downloads/'),
    'the page links the installer endpoint, which requires a session',
  )

  const guestDownload = await call('/api/v1/downloads/stable/win')
  check(
    'guest GET /api/v1/downloads/stable/win → 401',
    guestDownload.status === 401,
    `got ${guestDownload.status}`,
  )

  const guestAccount = await fetch(`${BASE}/account`, { redirect: 'manual' })
  check(
    'guest GET /account redirects to /login',
    guestAccount.status === 307 || guestAccount.status === 302,
    `got ${guestAccount.status}`,
  )
  check(
    '/account is marked noindex',
    (guestAccount.headers.get('x-robots-tag') ?? '').includes('noindex'),
    `got ${guestAccount.headers.get('x-robots-tag') ?? 'no header'}`,
  )

  const robots = await call('/robots.txt')
  check('/robots.txt disallows /admin', robots.text.includes('Disallow: /admin'), robots.text.slice(0, 200))

  // ---- registration -------------------------------------------------------
  // A registration without a challenge must be refused, and must not create the
  // account. This is asserted BEFORE the successful sign-up so the check cannot be
  // satisfied by leftover state.
  const withoutCaptcha = await call('/api/v1/auth/register', {
    method: 'POST',
    body: { email: `captcha-probe-${Date.now()}@example.com`, password, client: 'web' },
  })
  check(
    'POST /auth/register without a captcha → 400 captcha_required',
    withoutCaptcha.status === 400 && withoutCaptcha.json?.error_code === 'captcha_required',
    `got ${withoutCaptcha.status} ${withoutCaptcha.json?.error_code ?? ''}`,
  )

  const registered = await call('/api/v1/auth/register', {
    method: 'POST',
    body: {
      email,
      password,
      username: `smoke${Date.now() % 100000}`,
      client: 'web',
      ...(await solveCaptcha('register')),
    },
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
      ...(await solveCaptcha('register')),
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
    body: {
      email: lockEmail,
      password: lockPassword,
      client: 'web',
      ...(await solveCaptcha('register')),
    },
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

  // ---- account lifecycle (migration 0005) ---------------------------------
  // A dedicated throwaway account, because the interesting checks below either
  // mutate the account (address change, deletion) or burn a per-account budget.
  // The owner's jar is parked and restored for the admin sections.
  const smtpEnabled = meta.json?.data?.smtpEnabled === true
  const ownerJar = new Map(cookies)
  const switchJar = (jar) => {
    cookies.clear()
    for (const [name, value] of jar) cookies.set(name, value)
  }

  const lifeEmail = `life-${Date.now()}@example.com`
  cookies.clear()
  const lifeRegistered = await call('/api/v1/auth/register', {
    method: 'POST',
    body: { email: lifeEmail, password, client: 'web', ...(await solveCaptcha('register')) },
  })
  const lifeJar = new Map(cookies)
  check(
    'the lifecycle account registers as unverified',
    lifeRegistered.status === 201 && lifeRegistered.json?.data?.user?.emailVerified === false,
    `got ${lifeRegistered.status}`,
  )

  const lifeMeta = await call('/api/v1/meta')
  check(
    '/meta exposes emailVerificationRequired',
    typeof lifeMeta.json?.data?.emailVerificationRequired === 'boolean',
  )

  const meLifecycle = await call('/api/v1/me')
  check(
    '/me exposes emailVerified, pendingEmail and deletion',
    typeof meLifecycle.json?.data?.emailVerified === 'boolean' &&
      'pendingEmail' in (meLifecycle.json?.data ?? {}) &&
      'deletion' in (meLifecycle.json?.data ?? {}),
  )

  const verifyPage = await fetch(`${BASE}/verify-email?token=smoke-token-value-123456`, {
    headers: { Cookie: cookieHeader() },
  })
  check('GET /verify-email renders the shell', verifyPage.status === 200)
  check(
    'the token pages send Referrer-Policy: no-referrer',
    verifyPage.headers.get('referrer-policy') === 'no-referrer',
    `got ${verifyPage.headers.get('referrer-policy') ?? 'none'}`,
  )

  const deletionPage = await fetch(`${BASE}/confirm-deletion?token=smoke-token-value-123456`, {
    headers: { Cookie: cookieHeader() },
  })
  check('GET /confirm-deletion renders the shell', deletionPage.status === 200)

  const bogusVerify = await call('/api/v1/auth/email/verify', {
    method: 'POST',
    body: { token: 'not-a-real-token-value' },
  })
  check(
    'POST /auth/email/verify with an unknown token -> 400 token_invalid',
    bogusVerify.status === 400 && bogusVerify.json?.error_code === 'token_invalid',
    `got ${bogusVerify.status} ${bogusVerify.json?.error_code ?? ''}`,
  )

  const bogusDeletionConfirm = await call('/api/v1/auth/deletion/confirm', {
    method: 'POST',
    body: { token: 'not-a-real-token-value' },
  })
  check(
    'POST /auth/deletion/confirm with an unknown token -> 400 token_invalid',
    bogusDeletionConfirm.status === 400 &&
      bogusDeletionConfirm.json?.error_code === 'token_invalid',
    `got ${bogusDeletionConfirm.status}`,
  )

  const lifeResend = await call('/api/v1/auth/email/verify/resend', {
    method: 'POST',
    csrf: true,
  })
  check(
    smtpEnabled
      ? 'POST /auth/email/verify/resend -> 202 on an unverified account'
      : 'POST /auth/email/verify/resend -> 503 mail_disabled without smtp',
    smtpEnabled ? lifeResend.status === 202 : lifeResend.status === 503,
    `got ${lifeResend.status} ${lifeResend.json?.error_code ?? ''}`,
  )

  // ---- admin override for "this user cannot receive mail" -----------------
  const lifeId = lifeRegistered.json?.data?.user?.id
  switchJar(ownerJar)
  const markedVerified = await call(`/api/v1/admin/users/${lifeId}/email-verify`, {
    method: 'POST',
    csrf: true,
  })
  check(
    'POST /admin/users/{id}/email-verify marks the address verified',
    markedVerified.status === 200 && typeof markedVerified.json?.data?.emailVerifiedAt === 'string',
    `got ${markedVerified.status} ${markedVerified.json?.error_code ?? ''}`,
  )
  const markedAgain = await call(`/api/v1/admin/users/${lifeId}/email-verify`, {
    method: 'POST',
    csrf: true,
  })
  check(
    'a second admin verification answers 409 email_already_verified',
    markedAgain.status === 409 && markedAgain.json?.error_code === 'email_already_verified',
    `got ${markedAgain.status}`,
  )

  // ---- address change -----------------------------------------------------
  switchJar(lifeJar)
  const changeWrongPassword = await call('/api/v1/me/email/change', {
    method: 'POST',
    csrf: true,
    body: { password: 'wrong-password-1', newEmail: `changed-${Date.now()}@example.com` },
  })
  check(
    'POST /me/email/change with a wrong password -> 401 password_mismatch',
    changeWrongPassword.status === 401 &&
      changeWrongPassword.json?.error_code === 'password_mismatch',
    `got ${changeWrongPassword.status}`,
  )

  const changeSame = await call('/api/v1/me/email/change', {
    method: 'POST',
    csrf: true,
    body: { password, newEmail: lifeEmail },
  })
  check(
    'changing to the current address -> 422 validation_failed',
    changeSame.status === 422,
    `got ${changeSame.status} ${changeSame.json?.error_code ?? ''}`,
  )

  const newAddress = `changed-${Date.now()}@example.com`
  const changeAccepted = await call('/api/v1/me/email/change', {
    method: 'POST',
    csrf: true,
    body: { password, newEmail: newAddress },
  })
  check(
    smtpEnabled
      ? 'POST /me/email/change -> 202 with a masked pending address'
      : 'POST /me/email/change -> 503 mail_disabled without smtp',
    smtpEnabled
      ? changeAccepted.status === 202 &&
          String(changeAccepted.json?.data?.pendingEmail ?? '').includes('***')
      : changeAccepted.status === 503,
    `got ${changeAccepted.status} ${changeAccepted.json?.error_code ?? ''}`,
  )

  const mePending = await call('/api/v1/me')
  check(
    'GET /me reports the pending address only in masked form',
    smtpEnabled
      ? typeof mePending.json?.data?.pendingEmail === 'string' &&
          !String(mePending.json?.data?.pendingEmail).includes('changed-')
      : mePending.json?.data?.pendingEmail === null,
    JSON.stringify(mePending.json?.data?.pendingEmail ?? null),
  )

  const cancelChange = await call('/api/v1/me/email/change', { method: 'DELETE', csrf: true })
  check(
    smtpEnabled
      ? 'DELETE /me/email/change -> 200 when a change is pending'
      : 'DELETE /me/email/change -> 404 when no change could be started',
    smtpEnabled ? cancelChange.status === 200 : cancelChange.status === 404,
    `got ${cancelChange.status}`,
  )
  const cancelAgain = await call('/api/v1/me/email/change', { method: 'DELETE', csrf: true })
  check('cancelling a change twice answers 404', cancelAgain.status === 404, `got ${cancelAgain.status}`)

  // ---- data export --------------------------------------------------------
  const exported = await call('/api/v1/me/export')
  check(
    'GET /me/export answers 200 with an attachment',
    exported.status === 200 &&
      (exported.headers.get('content-disposition') ?? '').startsWith('attachment;'),
    `got ${exported.status}`,
  )
  check(
    'the export carries the six documented blocks and no hash field',
    exported.json?.format === 'ecliptrix.account.export' &&
      Boolean(exported.json?.account) &&
      Boolean(exported.json?.sessions) &&
      Boolean(exported.json?.activity) &&
      !JSON.stringify(exported.json).includes('_hash'),
  )
  const exportedAgain = await call('/api/v1/me/export')
  check(
    'a second export inside the cooldown answers 429 as json',
    exportedAgain.status === 429 &&
      (exportedAgain.headers.get('content-type') ?? '').includes('application/json') &&
      exportedAgain.headers.get('content-disposition') === null,
    `got ${exportedAgain.status}`,
  )

  // ---- real deletion ------------------------------------------------------
  // Two throwaway accounts: one for the "missing/wrong password" probes (each call
  // spends a slot of the per-account deletion budget) and one for the state machine.
  const probeEmail = `probe-${Date.now()}@example.com`
  cookies.clear()
  await call('/api/v1/auth/register', {
    method: 'POST',
    body: { email: probeEmail, password, client: 'web', ...(await solveCaptcha('register')) },
  })
  const deletionNoPassword = await call('/api/v1/me/deletion-request', {
    method: 'POST',
    csrf: true,
    body: {},
  })
  check(
    'POST /me/deletion-request without a password -> 422',
    deletionNoPassword.status === 422,
    `got ${deletionNoPassword.status}`,
  )
  const deletionWrongPassword = await call('/api/v1/me/deletion-request', {
    method: 'POST',
    csrf: true,
    body: { password: 'definitely-not-it' },
  })
  check(
    'POST /me/deletion-request with a wrong password -> 401',
    deletionWrongPassword.status === 401,
    `got ${deletionWrongPassword.status}`,
  )

  switchJar(lifeJar)
  const deletionRequest = await call('/api/v1/me/deletion-request', {
    method: 'POST',
    csrf: true,
    body: { password, reason: 'smoke test' },
  })
  check(
    'POST /me/deletion-request -> 202 and never deletes immediately',
    deletionRequest.status === 202,
    `got ${deletionRequest.status} ${deletionRequest.json?.error_code ?? ''}`,
  )
  check(
    'the response says whether a confirmation mail is required',
    typeof deletionRequest.json?.data?.requiresConfirmation === 'boolean' &&
      'scheduledFor' in (deletionRequest.json?.data ?? {}),
  )
  check(
    'without smtp the request is scheduled immediately',
    smtpEnabled
      ? deletionRequest.json?.data?.requiresConfirmation === true
      : deletionRequest.json?.data?.requiresConfirmation === false &&
          typeof deletionRequest.json?.data?.scheduledFor === 'string',
  )

  const stillThere = await call('/api/v1/me')
  check(
    'the account still works while the request is live',
    stillThere.status === 200 && stillThere.json?.data?.deletion !== null,
  )

  const secondRequest = await call('/api/v1/me/deletion-request', {
    method: 'POST',
    csrf: true,
    body: { password },
  })
  check(
    'a second request while one is live -> 409 deletion_pending',
    secondRequest.status === 409 && secondRequest.json?.error_code === 'deletion_pending',
    `got ${secondRequest.status} ${secondRequest.json?.error_code ?? ''}`,
  )

  const patchDuringDeletion = await call('/api/v1/me', {
    method: 'PATCH',
    csrf: true,
    body: { displayName: 'Blocked Rename' },
  })
  check(
    'PATCH /me is refused while a deletion is pending',
    patchDuringDeletion.status === 409 && patchDuringDeletion.json?.error_code === 'deletion_pending',
    `got ${patchDuringDeletion.status} ${patchDuringDeletion.json?.error_code ?? ''}`,
  )

  const cancelled = await call('/api/v1/me/deletion-request', { method: 'DELETE', csrf: true })
  check(
    'DELETE /me/deletion-request -> 200 and cancels',
    cancelled.status === 200 && cancelled.json?.data?.cancelled === true,
    `got ${cancelled.status}`,
  )
  const cancelDeletionAgain = await call('/api/v1/me/deletion-request', {
    method: 'DELETE',
    csrf: true,
  })
  check(
    'cancelling a deletion twice answers 404',
    cancelDeletionAgain.status === 404,
    `got ${cancelDeletionAgain.status}`,
  )
  const afterCancel = await call('/api/v1/me')
  check(
    'the account is untouched after a cancelled deletion',
    afterCancel.status === 200 && afterCancel.json?.data?.deletion === null,
  )

  const activity = await call('/api/v1/me/activity?page=1&pageSize=10')
  check(
    'GET /me/activity exposes a masked IP and the new self-service actions',
    activity.status === 200 &&
      Array.isArray(activity.json?.data?.items) &&
      activity.json.data.items.every((item) => typeof item.ipMasked === 'string') &&
      activity.json.data.items.some((item) => item.action.startsWith('account.deletion')),
    `got ${activity.status}`,
  )

  // ---- admin session governance ------------------------------------------
  switchJar(ownerJar)

  const adminSessions = await call('/api/v1/admin/sessions?page=1&pageSize=10')
  check(
    'GET /admin/sessions lists rows with masked addresses and IPs',
    adminSessions.status === 200 &&
      Array.isArray(adminSessions.json?.data?.rows) &&
      adminSessions.json?.data?.rows?.every(
        (row) =>
          row.userEmail.includes('***') && (/(x\.x|…)$/.test(row.ip) || row.ip === ''),
      ),
    `got ${adminSessions.status}`,
  )

  const activeSessionsOnly = await call(`/api/v1/admin/sessions?activeOnly=1&client=desktop`)
  check(
    'GET /admin/sessions honours activeOnly and client',
    activeSessionsOnly.status === 200 &&
      activeSessionsOnly.json?.data?.rows?.every((row) => row.active && row.client === 'desktop'),
  )

  const bulkRevokeUnknown = await call('/api/v1/admin/sessions/revoke', {
    method: 'POST',
    csrf: true,
    body: { ids: ['does-not-exist-1'], reason: 'admin_revoke' },
  })
  check(
    'POST /admin/sessions/revoke skips unknown ids instead of failing',
    bulkRevokeUnknown.status === 200 &&
      bulkRevokeUnknown.json?.data?.revoked === 0 &&
      bulkRevokeUnknown.json?.data?.skipped === 1,
    JSON.stringify(bulkRevokeUnknown.json?.data ?? null),
  )

  const bulkRevokeTooMany = await call('/api/v1/admin/sessions/revoke', {
    method: 'POST',
    csrf: true,
    body: { ids: Array.from({ length: 101 }, (_, index) => `sess_${index}`) },
  })
  check(
    'POST /admin/sessions/revoke refuses more than 100 ids (422)',
    bulkRevokeTooMany.status === 422,
    `got ${bulkRevokeTooMany.status}`,
  )

  const sessionsPage = await fetch(`${BASE}/admin/sessions`, { headers: { Cookie: cookieHeader() } })
  check('GET /admin/sessions renders', sessionsPage.status === 200)

  // ---- mail observability -------------------------------------------------
  const mailList = await call('/api/v1/admin/mail?page=1&pageSize=10')
  check(
    'GET /admin/mail lists the outbox with masked recipients',
    mailList.status === 200 &&
      Array.isArray(mailList.json?.data?.rows) &&
      mailList.json?.data?.rows?.every((row) => row.toMasked.includes('***')),
    `got ${mailList.status}`,
  )
  check(
    'outbox rows expose status, attempts and retryable',
    (mailList.json?.data?.rows ?? []).every(
      (row) =>
        typeof row.status === 'string' &&
        typeof row.attempts === 'number' &&
        typeof row.retryable === 'boolean',
    ),
  )

  const badMailFilter = await call('/api/v1/admin/mail?status=sentt')
  check(
    'GET /admin/mail with an unknown status -> 422 (not the whole table)',
    badMailFilter.status === 422 && badMailFilter.json?.error_code === 'validation_failed',
    `got ${badMailFilter.status} ${badMailFilter.json?.error_code ?? ''}`,
  )

  const mailPage = await fetch(`${BASE}/admin/mail`, { headers: { Cookie: cookieHeader() } })
  check('GET /admin/mail renders', mailPage.status === 200)

  const missingMail = await call('/api/v1/admin/mail/00000000-0000-4000-8000-000000000000')
  check('GET /admin/mail/{unknown} -> 404', missingMail.status === 404, `got ${missingMail.status}`)

  const settingsWithMail = await call('/api/v1/admin/settings')
  const mailBlock = settingsWithMail.json?.data?.mail
  check(
    'GET /admin/settings includes the read-only mail capability block',
    typeof mailBlock?.mode === 'string' &&
      typeof mailBlock?.sent24h === 'number' &&
      typeof mailBlock?.failed24h === 'number' &&
      typeof mailBlock?.fromAddress === 'string',
    JSON.stringify(mailBlock ?? null),
  )
  const mailPolicyPatch = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: {
      'account.deletionGraceHours': 72,
      'account.exportCooldownMinutes': 60,
      'audit.retentionDays': 180,
    },
  })
  const mailPolicyRead = await call('/api/v1/admin/settings')
  const policySettings = mailPolicyRead.json?.data?.settings ?? {}
  check(
    'the new account-policy settings round-trip',
    mailPolicyPatch.status === 200 &&
      policySettings['account.deletionGraceHours'] === 72 &&
      policySettings['account.exportCooldownMinutes'] === 60 &&
      policySettings['audit.retentionDays'] === 180,
  )
  const verificationGate = await call('/api/v1/admin/settings', {
    method: 'PATCH',
    csrf: true,
    body: { 'mail.verificationRequired': true },
  })
  check(
    smtpEnabled
      ? 'enabling the verification gate is accepted with smtp configured'
      : 'enabling the verification gate is refused without smtp (422)',
    smtpEnabled ? verificationGate.status === 200 : verificationGate.status === 422,
    `got ${verificationGate.status}`,
  )

  // ---- metrics and csv ----------------------------------------------------
  const metrics30 = await call('/api/v1/admin/metrics?days=30')
  check(
    'GET /admin/metrics?days=30 returns the new series',
    metrics30.status === 200 &&
      metrics30.json?.data?.loginsTrend?.length === 30 &&
      metrics30.json?.data?.sessionsTrend?.length === 30 &&
      typeof metrics30.json?.data?.emailVerifiedRate === 'number' &&
      typeof metrics30.json?.data?.pendingDeletions === 'number' &&
      Array.isArray(metrics30.json?.data?.clientBreakdown),
    `got ${metrics30.status}`,
  )
  const metricsInvalid = await call('/api/v1/admin/metrics?days=365')
  check(
    'GET /admin/metrics?days=365 -> 422',
    metricsInvalid.status === 422,
    `got ${metricsInvalid.status}`,
  )

  const csv = await call('/api/v1/admin/users/export')
  check(
    'GET /admin/users/export answers csv with an attachment',
    csv.status === 200 &&
      (csv.headers.get('content-type') ?? '').includes('text/csv') &&
      (csv.headers.get('content-disposition') ?? '').includes('attachment'),
    `got ${csv.status}`,
  )
  check(
    'the csv keeps the documented header row',
    csv.text.includes(
      'email,username,display_name,role,status,plan_tag,email_verified,created_at,last_login_at,active_sessions',
    ),
  )

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\nsmoke crashed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
