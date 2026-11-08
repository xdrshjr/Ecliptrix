'use strict'

const os = require('os')

const { AccountError, SERVER_CODE, LOCAL_CODE } = require('./authErrors')
const {
  decideStartup,
  graceDeadline,
  nextTimerDelay,
  toMillis,
  toIso,
  clearsSession,
  HEARTBEAT_STATUS,
} = require('./authPolicy')
const {
  verifyLocalAdmin,
  clearFailures,
  readAttempts,
  writeAttempts,
  isWeakLocalAdminPassword,
  LOCK_THRESHOLD,
} = require('./localAdmin')

// The identity state machine (spec §2.6). One instance per process; it is the
// only place that knows whether the user is signed in.
//
// Two properties everything else depends on:
//   * `status()` always answers — before `start()` settles it returns the frozen
//     BOOTING_STATUS, because the renderer invokes `auth:status` as soon as it
//     mounts (P1-2);
//   * every token rotation goes through `withTokenLock()` — two concurrent
//     refreshes look like token reuse to the server, which then revokes every
//     session of the user (R2).

const LOCAL_ADMIN_USER_ID = 'local-admin'
const SOURCE = {
  SERVER: 'server',
  OFFLINE_CACHE: 'offline-cache',
  LOCAL_ROOT: 'local-root',
  GATE_DISABLED: 'gate-disabled',
}

/**
 * Frozen cold-start status: the process is up, the decision is not in yet.
 * `booting` is produced here and only here — `decideStartup()` never returns it.
 *
 * @param {string} appVersion
 * @returns {object} AuthStatus
 */
// One page of activity is all the desktop shows; the web timeline is the place to
// scroll. 30 rows is also what the account centre's "recent activity" tab promises.
const ACTIVITY_PAGE_SIZE = 30

/**
 * Mask an address for the renderer: `203.0.113.42` → `203.0.x.x`, IPv6 keeps its
 * first non-empty group.
 *
 * @param {unknown} raw
 * @returns {string}
 */
/** `1.2.3.4`, optionally with a port — decided by the DOTS, not the colon. */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/
/** Already masked by the server (`/me/activity` returns both forms). */
const MASKED_IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.x\.x$/

/**
 * `203.0.113.42` → `203.0.x.x`; `2001:db8::1` → `2001:…`.
 *
 * The order of the two branches matters: `ip:port` also contains a colon, so a
 * colon-first test turns `203.0.113.42:51234` into `203.0.113.42:…` — a full
 * address handed to the renderer by the function whose job is to prevent exactly
 * that. Anything unparsable becomes `…` rather than being echoed.
 */
function maskIp(raw) {
  const value = String(raw == null ? '' : raw).trim()
  if (!value) return ''
  // Masking must be idempotent: `authController.activity()` re-masks a value the
  // server may already have masked.
  if (MASKED_IPV4_PATTERN.test(value)) return value
  const ipv4 = IPV4_PATTERN.exec(value)
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.x.x`
  // Bracketed IPv6 with a port (`[2001:db8::1]:443`) — drop the brackets first.
  const bare = value.replace(/^\[/, '').replace(/\].*$/, '')
  if (bare.includes(':')) {
    const groups = bare.split(':').filter(Boolean)
    return groups.length === 0 ? '::…' : `${groups[0]}:…`
  }
  return '…'
}

/**
 * Map a revocation reason onto the renderer's `AuthReason` vocabulary.
 *
 * Exported for the tests: the two-way mapping (`account_deleted` and the older
 * admin-only `deleted`) is exactly what this release had to get right.
 *
 * @param {unknown} reason Server `revoked_reason` / `error_details.reason`
 * @returns {string|null}
 */
function toUiReasonForRevoke(reason) {
  const value = String(reason == null ? '' : reason)
  if (value === 'account_deleted' || value === 'deleted') return 'account-deleted'
  if (value === 'suspended') return 'account-suspended'
  if (value === 'refresh_reuse') return 'session-revoked'
  return null
}

/**
 * Normalise the `MeView` payload (defaults for a server that predates a field).
 *
 * @param {unknown} raw
 * @returns {object}
 */
function normaliseMe(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const role = source.role && typeof source.role === 'object' ? source.role : {}
  const deletion = source.deletion && typeof source.deletion === 'object' ? source.deletion : null
  return {
    id: String(source.id || ''),
    email: String(source.email || ''),
    emailVerified: source.emailVerified === true,
    displayName: String(source.displayName || ''),
    username: String(source.username || ''),
    locale: source.locale === 'en-US' ? 'en-US' : 'zh-CN',
    timezone: String(source.timezone || ''),
    role: { key: String(role.key || 'member'), name: String(role.name || '') },
    planTag: String(source.planTag || 'free'),
    createdAt: String(source.createdAt || ''),
    lastLoginAt: source.lastLoginAt ? String(source.lastLoginAt) : null,
    pendingEmail: source.pendingEmail ? String(source.pendingEmail) : null,
    deletion: deletion
      ? {
          status: deletion.status === 'scheduled' ? 'scheduled' : 'awaiting_confirmation',
          scheduledFor: deletion.scheduledFor ? String(deletion.scheduledFor) : null,
        }
      : null,
  }
}

function bootingStatus(appVersion) {
  return Object.freeze({
    state: 'booting',
    source: null,
    reason: null,
    user: null,
    sessionId: null,
    expiresAt: null,
    lastVerifiedAt: null,
    graceUntil: null,
    mustChangePassword: false,
    appVersion: appVersion || '',
    server: null,
    reachable: false,
    lockedUntil: null,
    attemptsLeft: null,
    securityWarning: null,
  })
}

/** `BOOTING_STATUS` for callers that just need the constant (§2.5). */
const BOOTING_STATUS = bootingStatus('')

/**
 * Delay before the next heartbeat after a failed timer round.
 *
 * The session's own deadlines are useless after a failure (they are what made the
 * attempt fire), so `nextTimerDelay()` would clamp to its 1 s floor and hammer a
 * dead network once per second.
 */
const FAILURE_RETRY_MS = 60 * 1000

/**
 * Error codes that mean "the server refused this refresh token": reuse detected,
 * revoked, expired, or the account is suspended. Anything outside this set during
 * a rotation is transport trouble and must never clear the session (R-02).
 */
const REFRESH_REJECTED = new Set([
  SERVER_CODE.UNAUTHORIZED,
  SERVER_CODE.SESSION_EXPIRED,
  SERVER_CODE.SESSION_REVOKED,
  SERVER_CODE.ACCOUNT_SUSPENDED,
])

/**
 * @param {{
 *   config: object, store: object, client: object,
 *   attemptsPath: string, logger?: object, now?: () => number,
 *   hostname?: string, platform?: string, arch?: string,
 *   attemptWriter?: Function,
 * }} deps Everything Electron-flavoured is injected, so this module loads
 *   under plain Node (the smoke test relies on it).
 * @returns {object} Controller (§3.1): start/status/login/loginLocal/logout/
 *   register/changePassword/requestPasswordReset/listSessions/revokeSession/
 *   on/emit/dispose/markServicesRestarted/onWindowFocused.
 */
function createAuthController(deps) {
  const config = deps.config
  const store = deps.store
  const client = deps.client
  const logger = deps.logger || null
  const now = deps.now || Date.now
  const hostname = deps.hostname || os.hostname()
  const platform = `${deps.platform || process.platform}-${deps.arch || process.arch}`
  const attemptsPath = deps.attemptsPath
  const attemptWriter = deps.attemptWriter || writeAttempts

  const state = {
    phase: 'booting',
    state: 'booting',
    source: null,
    reason: null,
    session: null,
    localRoot: null,
    serverMeta: null,
    reachable: false,
    mustChangePassword: false,
    rememberDevice: true,
    plaintextSession: false,
    attempts: readAttempts(attemptsPath),
    signature: '',
    /** Last `/me` view, so reopening the dialogue does not refetch blindly. */
    lastMe: null,
  }
  const listeners = new Set()
  let tokenLock = null
  /** Cause of the last dead session, when the server named one. */
  let pendingRevokeReason = null
  let timer = null

  // ---------------------------------------------------------------- status --

  /**
   * Render the current state as an `AuthStatus` (epoch → ISO happens here and
   * nowhere else, spec §2.4.2).
   * @returns {object} AuthStatus
   */
  function buildStatus() {
    if (state.phase === 'booting') return bootingStatus(config.appVersion)
    const session = state.session
    const lockedUntil = Number.isFinite(state.attempts.lockedUntil) ? state.attempts.lockedUntil : 0
    const locked = lockedUntil > now()
    return {
      state: state.state,
      source: state.source,
      reason: state.reason,
      user: currentUser(),
      sessionId: state.localRoot || !session ? null : session.sessionId || null,
      expiresAt: state.localRoot || !session ? null : toIso(session.expiresAt),
      lastVerifiedAt: state.localRoot || !session ? null : toIso(session.lastVerifiedAt),
      graceUntil: state.localRoot || !session ? null : toIso(graceDeadline(session, config)),
      mustChangePassword: Boolean(state.mustChangePassword),
      appVersion: config.appVersion || '',
      server: state.serverMeta,
      reachable: state.reachable,
      lockedUntil: locked ? toIso(lockedUntil) : null,
      attemptsLeft: attemptsLeft(locked),
      securityWarning: securityWarning(),
    }
  }

  /** @returns {number|null} `5 - n` while counting, 0 while locked, null when clean. */
  function attemptsLeft(locked) {
    if (locked) return 0
    const failures = state.attempts.failures
    if (!Number.isFinite(failures) || failures <= 0) return null
    return Math.max(0, LOCK_THRESHOLD - failures)
  }

  /** @returns {string|null} Which degradation banner applies, highest first. */
  function securityWarning() {
    if (state.plaintextSession && state.session) return 'plaintext-session'
    // Only the explicit `ECLIPTRIX_AUTH_GATE=off` valve earns the red strip; a
    // merely gate-less runtime (dev default, browser) is an amber notice the
    // renderer derives from `source === 'gate-disabled'` (AC-19 vs AC-29).
    if (config.gateDisabledByEnv === true) return 'gate-disabled'
    if (state.localRoot && isWeakLocalAdminPassword(config.localAdmin.password)) {
      return 'local-default-password'
    }
    return null
  }

  /** @returns {object|null} SessionUser for a server or break-glass session. */
  function currentUser() {
    if (state.localRoot) {
      return {
        id: LOCAL_ADMIN_USER_ID,
        email: '',
        username: config.localAdmin.username,
        displayName: '本地管理员',
        avatarUrl: null,
        status: 'active',
        planTag: 'local',
        mustChangePassword: false,
        role: { key: 'owner', name: '本地管理员' },
        permissions: ['*'],
      }
    }
    const session = state.session
    if (!session || !session.user) return null
    // A blocked or signed-out state keeps the cached session for its next
    // launch, but it must not present a user as if they were inside the app.
    if (state.state !== 'authenticated') return null
    // `emailVerified` is coerced here because a session file written before the
    // field existed has no key at all, and the renderer branches on a boolean.
    return {
      ...session.user,
      emailVerified: session.user.emailVerified === true,
      mustChangePassword: Boolean(state.mustChangePassword),
    }
  }

  /**
   * Push `auth:changed` when something the renderer renders actually changed.
   * @param {boolean} [force] Emit even when the signature is unchanged.
   * @returns {object} The status that was (or would have been) pushed.
   */
  function emitChanged(force) {
    const status = buildStatus()
    const signature = statusSignature(status)
    if (!force && signature === state.signature) return status
    state.signature = signature
    for (const listener of listeners) {
      try {
        listener(status)
      } catch (err) {
        log('warn', `auth:changed listener failed: ${(err && err.message) || err}`)
      }
    }
    return status
  }

  /** @returns {string} Fields whose change must reach the renderer (§2.5). */
  function statusSignature(status) {
    const user = status.user
    const server = status.server
    return JSON.stringify([
      status.state,
      status.source,
      status.mustChangePassword,
      status.lockedUntil,
      status.reachable,
      status.securityWarning,
      user
        ? [
            user.id,
            user.permissions,
            user.role && user.role.key,
            // Without these two a heartbeat that merely verified the address or
            // renamed the account hashes to the same signature, so `auth:changed`
            // never fires and the account centre keeps its stale snapshot.
            user.emailVerified === true,
            user.displayName,
          ]
        : null,
      server ? server.maintenanceMessage : null,
    ])
  }

  /**
   * Apply a `decideStartup()` verdict (or an equivalent one from a later
   * heartbeat) to the in-memory state.
   * @param {{ state: string, source: string|null, reason: string|null,
   *           mustChangePassword?: boolean }} decision
   */
  function applyDecision(decision) {
    // The decision is the end of the cold path: `status()` may stop answering
    // `booting` as soon as one exists (a login can also be the first decision).
    state.phase = 'ready'
    state.state = decision.state
    state.source = decision.source
    // A dead session reports the generic verdict; prefer the specific cause the
    // server gave us (`account-deleted`) when there is one.
    state.reason = decision.reason === 'session-revoked' && pendingRevokeReason
      ? pendingRevokeReason
      : decision.reason
    state.mustChangePassword = Boolean(decision.mustChangePassword)
      || Boolean(decision.state === 'authenticated' && state.session
        && state.session.user && state.session.user.mustChangePassword)
    if (clearsSession(decision.reason)) clearSession()
    if (decision.state !== 'authenticated') cancelTimer()
    // One-shot: a later decision must not inherit a stale cause.
    pendingRevokeReason = null
  }

  // --------------------------------------------------------------- session --

  /** Delete the cached session from disk and memory (never the break-glass). */
  function clearSession() {
    store.clear()
    state.session = null
    state.plaintextSession = false
  }

  /** Persist the current session when "remember this device" is on (§5.1). */
  function persist() {
    if (!state.rememberDevice || !state.session) return
    try {
      const { encrypted } = store.write(state.session)
      if (!encrypted && !state.plaintextSession) {
        state.plaintextSession = true
        log('warn', 'auth.session.plaintext — safeStorage unavailable, tokens stored as plain base64')
      }
    } catch (err) {
      log('error', `cannot persist auth session: ${(err && err.message) || err}`)
    }
  }

  /**
   * Single-flight guard. A second concurrent refresh would present an already
   * rotated token, and the server answers that with "revoke every session".
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  function withTokenLock(fn) {
    if (tokenLock) return tokenLock
    tokenLock = Promise.resolve()
      .then(fn)
      .finally(() => {
        tokenLock = null
      })
    return tokenLock
  }

  /**
   * Rotate the token pair. MUST be called inside `withTokenLock()`.
   * @returns {Promise<object>} The updated session.
   */
  async function rotateTokens() {
    const session = state.session
    if (!session || !session.refreshToken) {
      throw new AccountError(LOCAL_CODE.REQUEST_TIMEOUT, { message: '没有可续期的会话' })
    }
    const data = await client.refresh(session.refreshToken)
    const updated = {
      ...session,
      accessToken: data.accessToken || session.accessToken,
      refreshToken: data.refreshToken || session.refreshToken,
      expiresAt: toMillis(data.expiresAt) ?? session.expiresAt,
      refreshExpiresAt: toMillis(data.refreshExpiresAt) ?? session.refreshExpiresAt,
      lastVerifiedAt: now(),
      serverTimeAt: serverTimeOf(data) ?? session.serverTimeAt,
    }
    state.session = updated
    persist()
    return updated
  }

  // ------------------------------------------------------------- heartbeat --

  /**
   * One heartbeat round-trip plus its error mapping (§2.6 / P1-3).
   * @returns {Promise<{status: string, mustChangePassword?: boolean, expiresAt?: string }>}
   */
  async function probeHeartbeat(session) {
    try {
      const body = await client.heartbeat(session.accessToken)
      return applyHeartbeatBody(session, body)
    } catch (err) {
      // Remember WHY the session died before the verdict vocabulary flattens it.
      // `decideStartup()` speaks `session-revoked` for everything, so the specific
      // cause has to travel separately (`account_deleted` / `deleted`).
      const cause = revokeReasonFor(err)
      if (cause) pendingRevokeReason = cause
      return handleHeartbeatError(session, err)
    }
  }

  /** @returns {object} Heartbeat verdict, with the session refreshed in place. */
  function applyHeartbeatBody(session, body) {
    const payload = body || {}
    session.lastVerifiedAt = now()
    const expiresAt = toMillis(payload.expiresAt)
    if (expiresAt !== null) session.expiresAt = expiresAt
    if (session.user) {
      session.user = {
        ...session.user,
        mustChangePassword: payload.mustChangePassword === true,
        role: payload.role && payload.role.key ? payload.role : session.user.role,
        permissions: Array.isArray(payload.permissions)
          ? payload.permissions
          : session.user.permissions,
        // The heartbeat echoes these two so a user who verified their address (or
        // renamed themselves) mid-session sees it without restarting the app.
        // Older servers do not send them — keep the cached value then.
        emailVerified: typeof payload.emailVerified === 'boolean'
          ? payload.emailVerified
          : session.user.emailVerified === true,
        displayName: typeof payload.displayName === 'string' && payload.displayName
          ? payload.displayName
          : session.user.displayName,
      }
    }
    persist()
    return {
      status: payload.mustChangePassword === true
        ? HEARTBEAT_STATUS.PASSWORD_CHANGE_REQUIRED
        : HEARTBEAT_STATUS.OK,
      mustChangePassword: payload.mustChangePassword === true,
      expiresAt: payload.expiresAt,
    }
  }

  /** @returns {Promise<object>} Heartbeat verdict for a failed heartbeat. */
  async function handleHeartbeatError(session, err) {
    const code = err && err.code
    if (code === SERVER_CODE.SESSION_EXPIRED) {
      try {
        await withTokenLock(() => rotateTokens())
      } catch (refreshError) {
        // A failed refresh is NOT automatically a dead session. `rotateTokens()`
        // throws `network_unreachable` / `request_timeout` / `service_unavailable`
        // too, and answering `expired` there tells `decideStartup()` that the
        // token was rejected — which clears `auth-session.json` and destroys the
        // 90-day refresh token. Measured path: laptop asleep past the 12h access
        // TTL, woken without a network yet → one heartbeat logged the user out
        // and threw away the offline grace window (AC-09).
        //
        // Only a REFUSED refresh token (+ a suspension) means the session is dead;
        // everything else keeps the session and lets the grace window decide.
        // The refresh endpoint reports the revocation cause in
        // `error.details.reason` (webserver: /auth/refresh writes
        // `account_deleted` there), and this is the ONLY path a deleted account
        // takes when its access token had already expired. Reading the cause here
        // is what keeps "your account was closed" from becoming "session expired".
        const refreshCause = revokeReasonFor(refreshError)
        if (refreshCause) pendingRevokeReason = refreshCause
        const refreshCode = refreshError && refreshError.code
        if (REFRESH_REJECTED.has(refreshCode)) {
          return { status: HEARTBEAT_STATUS.EXPIRED }
        }
        return { status: heartbeatStatusFor(refreshError) }
      }
      // Retry with the NEW access token: `session` is the pre-rotation object,
      // so reusing it here would send the token that just expired.
      const rotated = state.session || session
      try {
        return applyHeartbeatBody(rotated, await client.heartbeat(rotated.accessToken))
      } catch (retryError) {
        const retryCause = revokeReasonFor(retryError)
        if (retryCause) pendingRevokeReason = retryCause
        return { status: heartbeatStatusFor(retryError) }
      }
    }
    return { status: heartbeatStatusFor(err) }
  }

  /**
   * Map a heartbeat failure onto the verdict vocabulary.
   *
   * 429 rate limiting is a NETWORK verdict on purpose: throttling a heartbeat
   * must never log a working user out (R15 / AC-32). 423 belongs to the login
   * rate limiter, not to established sessions, so it degrades the same way.
   *
   * @param {object} err AccountError
   * @returns {string} Heartbeat verdict
   */
  function heartbeatStatusFor(err) {
    const code = err && err.code
    if (code === SERVER_CODE.SESSION_REVOKED || code === SERVER_CODE.UNAUTHORIZED) {
      return HEARTBEAT_STATUS.REVOKED
    }
    if (code === SERVER_CODE.ACCOUNT_SUSPENDED) return HEARTBEAT_STATUS.SUSPENDED
    if (code === SERVER_CODE.PASSWORD_CHANGE_REQUIRED) {
      return HEARTBEAT_STATUS.PASSWORD_CHANGE_REQUIRED
    }
    if (code === SERVER_CODE.CLIENT_OUTDATED) return HEARTBEAT_STATUS.OUTDATED
    return HEARTBEAT_STATUS.NETWORK
  }

  // -------------------------------------------------------------- schedule --

  function cancelTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** Arm the single timer (§2.6: one timer, never several racing ones). */
  function schedule() {
    cancelTimer()
    if (state.state !== 'authenticated' || state.localRoot || !state.session) return
    const { action, delayMs } = nextTimerDelay(state.session, now(), config)
    timer = setTimeout(() => runTimer(action), delayMs)
    // Never hold a plain-Node process open on the gate's timer (tests, smoke).
    if (typeof timer.unref === 'function') timer.unref()
  }

  /** @param {'refresh'|'heartbeat'} action */
  async function runTimer(action) {
    timer = null
    if (state.state !== 'authenticated' || !state.session) return
    let failed = false
    try {
      if (action === 'refresh') await withTokenLock(() => rotateTokens())
      else await runHeartbeatRound()
    } catch (err) {
      failed = true
      handleTimerFailure(err)
    }
    if (state.state !== 'authenticated') return
    // After a failure the timestamps are stale (`expiresAt` is in the past), so
    // recomputing would clamp to the 1 s floor and re-send a request every second
    // for as long as the network is down. One bounded retry delay instead.
    if (failed) scheduleRetry()
    else schedule()
  }

  /**
   * Re-arm the timer after a failed round: `FAILURE_RETRY_MS`, never the expired
   * session's own (already passed) deadlines.
   */
  function scheduleRetry() {
    cancelTimer()
    timer = setTimeout(() => runTimer('heartbeat'), FAILURE_RETRY_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }

  /** @returns {Promise<object>} Status after one heartbeat round. */
  async function runHeartbeatRound() {
    const verdict = await probeHeartbeat(state.session)
    applyDecision(decideStartup({
      session: state.session,
      now: now(),
      config,
      heartbeat: verdict,
    }))
    return emitChanged()
  }

  /** @param {object} err Failure from a timer-triggered operation. */
  function handleTimerFailure(err) {
    const code = err && err.code
    const dead = code === SERVER_CODE.SESSION_REVOKED
      || code === SERVER_CODE.SESSION_EXPIRED
      || code === SERVER_CODE.UNAUTHORIZED
      || code === SERVER_CODE.ACCOUNT_SUSPENDED
    log('warn', `auth timer failed: ${code || (err && err.message) || err}`)
    if (!dead) {
      // Network trouble: the offline grace window, not a logout (§2.6).
      applyDecision(decideStartup({
        session: state.session,
        now: now(),
        config,
        heartbeat: { status: HEARTBEAT_STATUS.NETWORK },
      }))
      emitChanged(true)
      return
    }
    clearSession()
    applyDecision({
      state: 'unauthenticated',
      source: null,
      reason: revokeReasonFor(err) || 'session-revoked',
    })
    emitChanged(true)
  }

  /**
   * Which reason a dead session should show.
   *
   * The server reports the revocation cause in `error.details.reason`. Two of them
   * are NOT the generic "you were signed out":
   *  - `account_deleted` — the owner closed their account (self-service);
   *  - `deleted` — an administrator deleted it.
   * Both must become `account-deleted`, otherwise the user sees "session revoked"
   * and keeps retrying a login that can never succeed again.
   *
   * @param {object} err AccountError
   * @returns {string|null}
   */
  function revokeReasonFor(err) {
    return toUiReasonForRevoke(err && err.details && err.details.reason)
  }

  // ----------------------------------------------------------------- config --

  /** @returns {Promise<object|null>} `ServerMeta`, or null when unreachable. */
  async function loadServerMeta() {
    if (!config.serverUrl) {
      state.reachable = false
      return null
    }
    try {
      const meta = await client.meta()
      state.reachable = true
      return normaliseServerMeta({ ...meta, baseUrl: config.serverUrl })
    } catch (err) {
      state.reachable = false
      log('warn', `account server metadata unavailable: ${(err && err.code) || err}`)
      return null
    }
  }

  // ------------------------------------------------------------------ start --

  /**
   * Run the startup decision. Never throws: a broken cache, an unreachable
   * server and a rejecting server all have a defined state (§2.6).
   * @returns {Promise<object>} The resulting status.
   */
  async function start() {
    try {
      const { session, corrupt } = store.read()
      if (corrupt) {
        log('warn', 'auth.session.corrupt — treating as signed out (file kept for forensics)')
      }
      state.session = session
      state.serverMeta = await loadServerMeta()
      const heartbeat = session ? await probeHeartbeat(state.session) : null
      applyDecision(decideStartup({
        session: state.session,
        now: now(),
        config,
        heartbeat,
      }))
    } catch (err) {
      log('error', `auth startup failed: ${(err && err.stack) || err}`)
      applyDecision({ state: 'unauthenticated', source: null, reason: 'no-session' })
    }
    state.phase = 'ready'
    log(
      'info',
      `startup decision state=${state.state} source=${state.source} reason=${state.reason}`,
    )
    emitChanged(true)
    if (state.state === 'authenticated') schedule()
    return buildStatus()
  }

  // ------------------------------------------------------------- user flows --

  /**
   * Sign in against the account server (form A).
   * @param {{ identifier: string, password: string, rememberDevice?: boolean }} input
   * @returns {Promise<object>} AuthStatus
   * @throws {AccountError}
   */
  async function login(input) {
    if (!config.serverUrl) {
      throw new AccountError(LOCAL_CODE.SERVER_NOT_CONFIGURED, {
        message: '未配置账号服务器地址 (desktop-config.json → auth.accountServerUrl)',
      })
    }
    const rememberDevice = input.rememberDevice !== false
    const data = await client.login(loginPayload(input))
    // "Don't remember this device" must ALSO remove a previously cached session,
    // otherwise the next launch signs the user in with the old one (§5.1).
    if (!rememberDevice) {
      store.clear()
      state.plaintextSession = false
    }
    state.rememberDevice = rememberDevice
    state.localRoot = null
    state.session = sessionFromLogin(data, now())
    state.mustChangePassword = Boolean(state.session.user.mustChangePassword)
    if (!state.serverMeta) state.serverMeta = await loadServerMeta()
    persist()
    applyDecision({ state: 'authenticated', source: SOURCE.SERVER, reason: null })
    schedule()
    return emitChanged(true)
  }

  /**
   * Sign in with the break-glass account (form B). No HTTP, no session file.
   * @param {{ username: string, password: string }} input
   * @returns {Promise<object>} AuthStatus
   * @throws {AccountError} `invalid_credentials` / `local_admin_locked` /
   *   `local_admin_disabled`
   */
  async function loginLocal(input) {
    const verdict = verifyLocalAdmin({
      username: input.username,
      password: input.password,
      localAdmin: config.localAdmin,
      state: state.attempts,
      now: now(),
    })
    state.attempts = verdict.nextState || state.attempts
    persistAttempts()
    if (!verdict.ok) {
      emitChanged(true)
      const code = verdict.code === 'invalid_credentials'
        ? SERVER_CODE.INVALID_CREDENTIALS
        : verdict.code
      throw new AccountError(code, {
        message: verdict.code === 'local_admin_locked'
          ? '本地管理员已锁定，请稍后再试或删除 auth-attempts.json'
          : '本地管理员凭据不正确',
        details: {
          ...(verdict.attemptsLeft === undefined ? {} : { attemptsLeft: verdict.attemptsLeft }),
          ...(verdict.lockedUntil === undefined ? {} : { lockedUntil: toIso(verdict.lockedUntil) }),
        },
      })
    }
    state.attempts = clearFailures()
    persistAttempts()
    // The break-glass session is memory-only: the cached server session on disk
    // is never touched, so a later launch restores it (§2.9 item 3).
    state.localRoot = { verifiedAt: now() }
    state.mustChangePassword = false
    log('info', 'auth.local_root.login')
    if (isWeakLocalAdminPassword(config.localAdmin.password)) {
      log('warn', 'auth.local_root.weak_password — default or short localAdmin password in use')
    }
    applyDecision({ state: 'authenticated', source: SOURCE.LOCAL_ROOT, reason: null })
    return emitChanged(true)
  }

  /**
   * Sign out. Revoking the remote session comes first: clearing locally first
   * would orphan a 90-day refresh token nobody can revoke any more (§2.12).
   * @returns {Promise<object>} AuthStatus (`state:'unauthenticated'`)
   */
  async function logout() {
    if (state.localRoot) {
      state.localRoot = null
      applyDecision({ state: 'unauthenticated', source: null, reason: null })
      return emitChanged(true)
    }
    const session = state.session
    if (session && session.accessToken && config.serverUrl) {
      try {
        await client.logout(session.accessToken)
      } catch (err) {
        log('warn', `remote logout failed (ignored): ${(err && err.code) || err}`)
      }
    }
    clearSession()
    applyDecision({ state: 'unauthenticated', source: null, reason: null })
    return emitChanged(true)
  }

  /**
   * Register through the account server, then adopt the issued session.
   * @param {{ email: string, password: string, username?: string,
   *           displayName?: string, inviteCode?: string }} input
   * @returns {Promise<object>} AuthStatus
   */
  async function register(input) {
    if (!config.serverUrl) {
      throw new AccountError(LOCAL_CODE.SERVER_NOT_CONFIGURED, {
        message: '未配置账号服务器地址 (desktop-config.json → auth.accountServerUrl)',
      })
    }
    const data = await client.register({
      email: input.email,
      password: input.password,
      ...(input.username ? { username: input.username } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
      client: 'desktop',
      clientVersion: config.appVersion,
      device: devicePayload(),
    })
    state.rememberDevice = true
    state.localRoot = null
    state.session = sessionFromLogin(data, now())
    state.mustChangePassword = Boolean(state.session.user.mustChangePassword)
    if (!state.serverMeta) state.serverMeta = await loadServerMeta()
    persist()
    applyDecision({ state: 'authenticated', source: SOURCE.SERVER, reason: null })
    schedule()
    return emitChanged(true)
  }

  /**
   * Change the signed-in user's password.
   * @param {{ currentPassword: string, newPassword: string,
   *           signOutOtherSessions?: boolean }} input
   * @returns {Promise<object>} AuthStatus with `mustChangePassword: false`
   */
  async function changePassword(input) {
    const session = requireServerSession()
    await client.changePassword(session.accessToken, {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      signOutOtherSessions: input.signOutOtherSessions === true,
    })
    state.session = {
      ...session,
      lastVerifiedAt: now(),
      user: { ...session.user, mustChangePassword: false },
    }
    state.mustChangePassword = false
    persist()
    return emitChanged(true)
  }

  /**
   * Ask the server to mail a reset link. The answer never reveals whether the
   * address exists (§2.8), so `{ ok: true }` is always the shape on success.
   * @param {{ email: string }} input
   * @returns {Promise<{ ok: true }>}
   */
  async function requestPasswordReset(input) {
    if (!config.serverUrl) {
      throw new AccountError(LOCAL_CODE.SERVER_NOT_CONFIGURED, {
        message: '未配置账号服务器地址',
      })
    }
    await client.requestPasswordReset(input.email)
    return { ok: true }
  }

  /**
   * List the user's sessions/devices.
   * @returns {Promise<{ ok: true, items: object[], currentId: string }>}
   */
  async function listSessions() {
    const session = requireServerSession()
    const data = await client.listSessions(session.accessToken)
    const items = Array.isArray(data.items) ? data.items.map(normaliseSessionInfo) : []
    const fallbackCurrent = items.find((item) => item.current)
    return {
      ok: true,
      items,
      currentId: session.sessionId || (fallbackCurrent ? fallbackCurrent.id : ''),
    }
  }

  /**
   * Revoke one of the user's sessions. Revoking the CURRENT session succeeds
   * server-side (200) and must sign this machine out immediately (P1-7).
   * @param {string} id
   * @returns {Promise<{ ok: true }>}
   */
  async function revokeSession(id) {
    const session = requireServerSession()
    await client.revokeSession(session.accessToken, id)
    if (session.sessionId && id === session.sessionId) {
      clearSession()
      applyDecision({ state: 'unauthenticated', source: null, reason: 'session-revoked' })
      emitChanged(true)
    }
    return { ok: true }
  }

  // ------------------------------------------------------- account centre --

  /**
   * `GET /me` — the account centre's data source.
   *
   * @returns {Promise<object>} `MeView`
   * @throws {AccountError} when there is no usable session
   */
  async function me() {
    const session = requireServerSession()
    const view = normaliseMe(await client.me(session.accessToken))
    state.lastMe = view
    return view
  }

  /**
   * `PATCH /me` — display name / locale / time zone only.
   *
   * The payload is rebuilt from the whitelist here as well as in the bridge: a
   * field the server does not accept must never leave the main process, and the
   * extra copy costs nothing.
   *
   * @param {{ displayName?: string, locale?: string, timezone?: string }} input
   * @returns {Promise<object>} The refreshed `MeView`
   */
  async function updateProfile(input) {
    const session = requireServerSession()
    const patch = {}
    if (input && input.displayName !== undefined) patch.displayName = input.displayName
    if (input && input.locale !== undefined) patch.locale = input.locale
    if (input && input.timezone !== undefined) patch.timezone = input.timezone
    const view = normaliseMe(await client.updateProfile(session.accessToken, patch))
    state.lastMe = view
    // The display name is part of the session snapshot the title bar renders, so
    // the cached copy has to follow the change or the two disagree until restart.
    if (session.user && view.displayName) session.user.displayName = view.displayName
    emitChanged(true)
    return view
  }

  /**
   * `GET /me/activity` — the caller's own timeline, IPs masked HERE.
   *
   * Masking happens in the main process on purpose (spec §3.10): the server
   * returns the real `ip` because the account holder is entitled to it, but the
   * Electron renderer must never receive a full address. `truncated` means "there
   * are more rows", not "the server cut the list".
   *
   * @returns {Promise<{ items: object[], truncated: boolean }>}
   */
  async function activity() {
    const session = requireServerSession()
    const result = await client.activity(session.accessToken, { page: 1, pageSize: ACTIVITY_PAGE_SIZE })
    const items = Array.isArray(result.items) ? result.items : []
    const total = result.page && Number.isFinite(result.page.total)
      ? result.page.total
      : items.length
    return {
      items: items.map((item) => ({
        id: String(item.id || ''),
        action: String(item.action || ''),
        targetType: String(item.targetType || ''),
        targetId: String(item.targetId || ''),
        ipMasked: maskIp(item.ipMasked || item.ip),
        createdAt: String(item.createdAt || ''),
      })),
      truncated: total > items.length,
    }
  }

  /**
   * `POST /auth/email/verify/resend`.
   *
   * @returns {Promise<{ sentAt: string, expiresAt: string }>}
   */
  async function resendVerification() {
    const session = requireServerSession()
    const result = await client.resendVerification(session.accessToken)
    return { sentAt: result.sentAt || '', expiresAt: result.expiresAt || '' }
  }

  // ----------------------------------------------------------------- helper --

  /** @returns {object} The active server session. @throws {AccountError} */
  function requireServerSession() {
    if (state.localRoot) {
      // Break-glass sessions have no account-server counterpart: the device,
      // password and session channels need one, and this is not a server error.
      throw new AccountError(SERVER_CODE.FORBIDDEN, {
        message: '本地管理员会话没有账号服务器会话',
      })
    }
    if (!state.session) {
      throw new AccountError(SERVER_CODE.UNAUTHORIZED, { message: '尚未登录' })
    }
    return state.session
  }

  /** @returns {object} `device` block of the login/register body (§4.2). */
  function devicePayload() {
    return {
      name: hostname,
      platform,
      appVersion: config.appVersion || '',
      deviceKey: config.deviceKey,
    }
  }

  /** @returns {object} Login request body. */
  function loginPayload(input) {
    return {
      identifier: input.identifier,
      password: input.password,
      client: 'desktop',
      clientVersion: config.appVersion || '',
      device: devicePayload(),
    }
  }

  /** Persist the break-glass failure counter. */
  function persistAttempts() {
    try {
      attemptWriter(attemptsPath, state.attempts)
    } catch (err) {
      log('error', `cannot persist auth attempts: ${(err && err.message) || err}`)
    }
  }

  /** @param {string} level @param {string} message */
  function log(level, message) {
    if (!logger || typeof logger[level] !== 'function') return
    logger[level]('auth', message)
  }

  // -------------------------------------------------------------- interface --

  return {
    start,
    me,
    updateProfile,
    activity,
    resendVerification,

    /** @returns {object} AuthStatus — always answers, even before `start()`. */
    status: buildStatus,

    login,
    loginLocal,
    logout,
    register,
    changePassword,
    requestPasswordReset,
    listSessions,
    revokeSession,

    /**
     * Subscribe to status changes (the bridge forwards them as `auth:changed`).
     * @param {(status: object) => void} listener
     * @returns {() => void} Unsubscribe.
     */
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Emit the current status, when it actually changed. @returns {object} */
    emit() {
      return emitChanged()
    },

    /**
     * Local services were restarted: tell the renderer so a "retry" button can
     * become meaningful even though no auth field changed (§3.1).
     * @returns {object} AuthStatus
     */
    markServicesRestarted() {
      log('info', 'auth: local services restarted — re-emitting status')
      return emitChanged(true)
    },

    /**
     * Window regained focus or the machine resumed: heartbeat if the last
     * verification is older than one interval (§2.6 / D2-07).
     * @returns {Promise<object>} AuthStatus
     */
    async onWindowFocused() {
      if (state.state !== 'authenticated' || state.localRoot || !state.session) {
        return buildStatus()
      }
      const lastVerifiedAt = toMillis(state.session.lastVerifiedAt)
      if (lastVerifiedAt !== null && now() - lastVerifiedAt < config.heartbeatIntervalMs) {
        return buildStatus()
      }
      return runHeartbeatRound()
    },

    /** Stop the timer and drop every listener (before-quit, §3.1). */
    dispose() {
      cancelTimer()
      listeners.clear()
    },

    /** Test/diagnostic hook: the parsed-but-not-JSON status of the moment. */
    _debug() {
      return { state, config }
    },
  }
}

/**
 * Whitelist the server's user payload onto `SessionUser` (§4.1).
 * @param {object} raw
 * @returns {object} SessionUser
 */
function normaliseUser(raw) {
  const user = raw && typeof raw === 'object' ? raw : {}
  const role = user.role && typeof user.role === 'object' ? user.role : {}
  return {
    id: String(user.id || ''),
    email: String(user.email || ''),
    username: String(user.username || ''),
    displayName: String(user.displayName || user.username || ''),
    avatarUrl: typeof user.avatarUrl === 'string' && user.avatarUrl ? user.avatarUrl : null,
    status: String(user.status || 'active'),
    planTag: String(user.planTag || ''),
    mustChangePassword: user.mustChangePassword === true,
    // The account centre shows an "unverified" banner from this flag. A session
    // file written before the field existed reads back as `false` (spec §6.5).
    emailVerified: user.emailVerified === true,
    role: { key: String(role.key || ''), name: String(role.name || '') },
    permissions: Array.isArray(user.permissions) ? user.permissions.map(String) : [],
  }
}

/**
 * Build the persistable session record from a login/register response (§5.1).
 * @param {object} data Server `data` payload.
 * @param {number} [nowMs] Injected clock (tests/smoke pass a fake one).
 * @returns {object} Session record with epoch-ms times.
 */
function sessionFromLogin(data, nowMs) {
  const payload = data && typeof data === 'object' ? data : {}
  const timestamp = Number.isFinite(nowMs) ? nowMs : Date.now()
  return {
    schemaVersion: 1,
    accessToken: String(payload.accessToken || ''),
    refreshToken: String(payload.refreshToken || ''),
    expiresAt: toMillis(payload.expiresAt),
    refreshExpiresAt: toMillis(payload.refreshExpiresAt),
    sessionId: String(payload.sessionId || ''),
    deviceKey: String(payload.deviceKey || ''),
    user: normaliseUser(payload.user),
    source: SOURCE.SERVER,
    lastVerifiedAt: timestamp,
    serverTimeAt: serverTimeOf(payload) ?? timestamp,
  }
}

/**
 * Envelope timestamp of a response, in epoch ms (`serverTimeAt`, §5.1).
 * The client attaches it as `_serverTimeAt`; it never reaches the renderer.
 * @param {object} payload
 * @returns {number|null}
 */
function serverTimeOf(payload) {
  const value = payload && payload._serverTimeAt
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Whitelist a server session DTO onto `SessionInfo` (§4.1).
 * @param {object} raw
 * @returns {object} SessionInfo
 */
function normaliseSessionInfo(raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  return {
    id: String(item.id || ''),
    client: item.client === 'web' ? 'web' : 'desktop',
    deviceName: String(item.deviceName || ''),
    platform: String(item.platform || ''),
    appVersion: String(item.appVersion || ''),
    deviceKey: String(item.deviceKey || ''),
    ip: String(item.ip || ''),
    userAgent: String(item.userAgent || ''),
    createdAt: String(item.createdAt || ''),
    lastSeenAt: String(item.lastSeenAt || ''),
    expiresAt: String(item.expiresAt || ''),
    current: item.current === true,
  }
}

/**
 * Normalise `GET /meta` onto `ServerMeta` (§4.1). Every field has a default so
 * the renderer never has to null-check a server that predates a field.
 * @param {object} raw
 * @returns {object} ServerMeta
 */
function normaliseServerMeta(raw) {
  const meta = raw && typeof raw === 'object' ? raw : {}
  const passwordPolicy = meta.passwordPolicy && typeof meta.passwordPolicy === 'object'
    ? meta.passwordPolicy
    : {}
  return {
    registrationEnabled: meta.registrationEnabled === true,
    inviteRequired: meta.inviteRequired === true,
    smtpEnabled: meta.smtpEnabled === true,
    passwordPolicy: {
      minLength: Number.isFinite(passwordPolicy.minLength) ? passwordPolicy.minLength : 10,
      maxBytes: Number.isFinite(passwordPolicy.maxBytes) ? passwordPolicy.maxBytes : 128,
    },
    appName: String(meta.appName || 'Ecliptrix'),
    supportEmail: String(meta.supportEmail || ''),
    version: String(meta.version || ''),
    minClientVersion: String(meta.minClientVersion || ''),
    maintenanceMessage: String(meta.maintenanceMessage || ''),
    maxActiveSessions: Number.isFinite(meta.maxActiveSessions) ? meta.maxActiveSessions : 10,
    // Whether an unverified desktop login is refused on this deployment.
    emailVerificationRequired: meta.emailVerificationRequired === true,
    // The runtime origin the renderer must use for "open in browser" links. It is
    // already in the `openExternal` allowlist (the allowlist is derived from it).
    baseUrl: String(meta.baseUrl || ''),
  }
}

module.exports = {
  toUiReasonForRevoke,
  maskIp,
  normaliseMe,
  createAuthController,
  bootingStatus,
  BOOTING_STATUS,
  normaliseUser,
  normaliseSessionInfo,
  normaliseServerMeta,
  sessionFromLogin,
  SOURCE,
  LOCAL_ADMIN_USER_ID,
}
