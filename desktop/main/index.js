'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, dialog, session, shell, safeStorage, ipcMain, powerMonitor } = require('electron')

const { initUserData, saveConfig } = require('./config')
const { loadUserEnv, backfillUserEnv } = require('./envCheck')
const { pickPort } = require('./ports')
const { ManagedService } = require('./processManager')
const { createBackendDescriptor } = require('./backendService')
const { createFrontendDescriptor } = require('./frontendService')
const { Logger, LogLevel } = require('./logger')
const { APP_ICON_PATH, resolveAppUserModelId } = require('./appIcon')
const { registerWindowControlIpc } = require('./windowControls')
const { resolveBrowserHostCwd } = require('./browserHostPaths')
const { probeSystemProxy } = require('./proxyProbe')
const { readAuthConfig } = require('./authConfig')
const { createSessionStore } = require('./authSessionStore')
const { createAccountClient } = require('./authHttp')
const { createAuthController } = require('./authController')
const { registerAuthIpc, EVENT_CHANNEL: AUTH_CHANGED_CHANNEL } = require('./authBridge')
const windows = require('./window')

// `npm run dev` — attach to manually started dev servers instead of spawning
// packaged children (spec §4.1).
const isDev = process.argv.includes('--dev')
const DEV_FRONTEND_URL = 'http://localhost:3000'

// Must precede any BrowserWindow: ties running windows to the NSIS shortcut's
// AUMID so taskbar pinning/grouping uses our icon (spec brand-logo-refresh
// §3.2.3).
if (process.platform === 'win32') {
  app.setAppUserModelId(resolveAppUserModelId(isDev))
}

// Minimum structured-log level, overridable via ECLIPTRIX_LOG_LEVEL (spec §4).
const LEVEL_BY_NAME = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
}

// Smoke tests isolate their state via --user-data-dir (spec §6.2). Must be
// set before any app.getPath('userData') consumer runs.
const userDataDirArg = process.argv.find((a) => a.startsWith('--user-data-dir='))
if (userDataDirArg) {
  app.setPath('userData', path.resolve(userDataDirArg.slice('--user-data-dir='.length)))
}

// Module-level state shared by lifecycle handlers.
const state = {
  logger: null,
  logsPath: '',
  userDataPath: '',
  config: null,
  userEnv: null,
  frontendPort: 0,
  backendPort: 0,
  backend: null,
  frontend: null,
  browserHost: null,
  browserHostRestarts: 0,
  researchBrowserEnv: null,
  // 端口只在首次挑选后固定：后端在 spawn 时已锁定 CDP/控制端口的 env，
  // 宿主崩溃重启若换端口，后端会继续拨号死端口（能力永远不会恢复）。
  researchBrowserPorts: null,
  mainWindow: null,
  splash: null,
  // 身份闸门（spec desktop-account-login-gate §3.1）：控制器是唯一的状态真相，
  // authIpc 只为 before-quit 的注销保留句柄。
  authController: null,
  authIpc: null,
  quitting: false,
  cleanupDone: false,
}

// Double-starting would collide on ports and the SQLite WAL lock (spec §2.1).
// --agent-browser-host 子进程模式必须在抢锁之前分流：绝不抢单实例锁、
// 不建主窗口、不启动后端/前端（spec agent-general-capabilities §3.6）。
if (process.argv.includes('--agent-browser-host')) {
  require('./agentBrowserHost')
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore()
      state.mainWindow.focus()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    state.quitting = true
    if (state.cleanupDone) return
    event.preventDefault()
    // The gate owns a timer and an IPC surface: neither may outlive the app.
    // This project has no `will-quit` handler (P2-6), so it belongs here.
    disposeAuthGate()
    stopChildren().finally(() => {
      state.cleanupDone = true
      if (state.logger) state.logger.close()
      app.quit()
    })
  })

  app
    .whenReady()
    .then(main)
    .catch((err) => {
      dialog.showErrorBox('Ecliptrix 启动失败', String((err && err.stack) || err))
      app.exit(1)
    })
}

async function main() {
  state.userDataPath = app.getPath('userData')
  const envTemplatePath = path.join(app.getAppPath(), 'scripts', 'env.template.desktop')
  const { config, envPath, attemptsPath } = initUserData({
    userDataPath: state.userDataPath,
    appVersion: app.getVersion(),
    envTemplatePath,
  })
  state.config = config
  // Packaged builds log to userData/logs; `npm run dev` redirects into the repo
  // via ECLIPTRIX_LOG_DIR so categorised files land in desktop/logs (spec §2.4).
  state.logsPath = process.env.ECLIPTRIX_LOG_DIR || path.join(state.userDataPath, 'logs')
  const minLevel = LEVEL_BY_NAME[(process.env.ECLIPTRIX_LOG_LEVEL || '').toLowerCase()] || LogLevel.INFO
  state.logger = new Logger(state.logsPath, { minLevel })
  state.logger.info('main', `Ecliptrix ${app.getVersion()} starting (userData=${state.userDataPath})`)
  // A missing icon never blocks startup, but the window would silently fall
  // back to the default icon — leave a trace (spec brand-logo-refresh RV-2).
  if (!fs.existsSync(APP_ICON_PATH)) {
    state.logger.warn('main', `App icon missing at ${APP_ICON_PATH}`)
  }

  // Read userData/.env BEFORE the gate: `readAuthConfig` needs it for
  // ECLIPTRIX_AUTH_GATE and the optional ACCOUNT_SERVER_URL override. Pure read
  // (no writes), so moving it above the dev early-return changes nothing that
  // used to happen (spec §2.6 / P0-2). Backfill stays below: it WRITES the
  // file, and `npm run dev` must not rewrite a developer's .env.
  const early = loadUserEnv(envPath)
  state.userEnv = early.env

  // Register renderer-facing IPC BEFORE the `--dev` early-return (spec §2.3b /
  // R2). main() runs once via app.whenReady(), so these never double-register.
  // Window controls need no env.
  registerWindowControlIpc(state.logger)

  // Identity gate first, window second: `desktop/ npm run dev` returns right
  // after `createMainWindow`, and the dev window also carries the preload — an
  // unregistered `auth` namespace would make the renderer fail closed and lock
  // developers out of their own app (P0-2).
  startIdentityGate({ config, attemptsPath })

  powerMonitor.on('resume', () => {
    if (state.authController) state.authController.onWindowFocused().catch(() => {})
  })

  if (isDev) {
    state.logger.info('main', `dev mode — attaching to ${DEV_FRONTEND_URL}`)
    createMainWindow(DEV_FRONTEND_URL)
    openDevToolsIfRequested()
    watchDevFrontend()
    return
  }

  // Self-heal an old placeholder .env left by a pre-round-1 install: rewrite
  // any key still holding a placeholder with the bundled template's real
  // default credential (config.js only copies the template on first run, so
  // upgrade users never receive the keys otherwise). Must run BEFORE the
  // second loadUserEnv so the injected child-process env carries the healed
  // values.
  const healed = backfillUserEnv(envPath, envTemplatePath)
  if (healed.length > 0) {
    state.logger.info('config', `self-healed ${healed.length} placeholder credential(s) from bundled template: ${healed.join(', ')}`)
  }

  // Second read on purpose: the gate already took its snapshot above, the
  // children get the healed one (spec §2.6 — one extra readFileSync instead of
  // an ordering dependency).
  const { env: userEnv, missing } = loadUserEnv(envPath)
  if (missing.length > 0) {
    // Round 3: do NOT block — the renderer shows an in-app setup guide instead.
    state.logger.warn('config', `config incomplete (${missing.join(', ')}) — starting anyway; in-app setup guide will prompt`)
  }
  state.userEnv = userEnv

  state.splash = windows.createSplashWindow()
  windows.setSplashStatus(state.splash, '正在准备本地服务…')

  try {
    await resolvePorts()
    await startResearchBrowserHost()
    await startServices()
    createMainWindow(`http://127.0.0.1:${state.frontendPort}`)
  } catch (err) {
    state.logger.error('process', `startup failed: ${(err && err.stack) || err}`)
    closeSplash()
    await stopChildren()
    windows.showErrorWindow({
      serviceName: (err && err.serviceName) || '',
      logsPath: state.logsPath,
      detail: String((err && err.message) || err),
    })
  }
}

/**
 * Build and start the identity gate (spec §2.6 P0-2 order):
 * readAuthConfig → createSessionStore → createAccountClient →
 * createAuthController → registerAuthIpc → controller.start().
 *
 * `serverUrl` comes from `desktop-config.json` → `auth.accountServerUrl`; the
 * .env snapshot only contributes the optional overrides (P0-1).
 *
 * Dev deliberately ignores the .env snapshot: a packaged `ECLIPTRIX_AUTH_GATE=on`
 * left in `%APPDATA%\Ecliptrix\.env` must not silently switch the gate on during
 * `desktop/ npm run dev` (spec §2.13 / R10 — dev stays gate-disabled unless the
 * developer exports the variable themselves).
 *
 * @param {{ config: object, attemptsPath: string }} input
 * @returns {void}
 */
function startIdentityGate({ config, attemptsPath }) {
  const authConfig = readAuthConfig({
    config,
    env: gateEnv(),
    isDev,
    userDataPath: state.userDataPath,
    hostname: os.hostname(),
    appVersion: app.getVersion(),
    logger: state.logger,
  })
  const store = createSessionStore({ dir: state.userDataPath, safeStorage })
  const client = createAccountClient({
    baseUrl: authConfig.serverUrl,
    clientVersion: authConfig.appVersion,
    logger: state.logger,
    timeouts: {
      probeMs: authConfig.probeTimeoutMs,
      loginMs: authConfig.loginTimeoutMs,
      heartbeatMs: authConfig.heartbeatTimeoutMs,
      sessionMs: authConfig.sessionTimeoutMs,
    },
  })
  state.authController = createAuthController({
    config: authConfig,
    store,
    client,
    attemptsPath,
    logger: state.logger,
  })
  state.authIpc = registerAuthIpc({
    ipcMain,
    controller: state.authController,
    logger: state.logger,
    serverUrl: authConfig.serverUrl,
    broadcast: broadcastAuthStatus,
    openExternal: (url) => shell.openExternal(url),
  })
  if (!authConfig.serverUrl) {
    state.logger.warn('auth', 'auth.accountServerUrl is empty — the gate will report server-not-configured (break-glass login still works)')
  }
  if (!authConfig.gateEnabled) {
    state.logger.warn('auth', 'identity gate disabled (dev default or ECLIPTRIX_AUTH_GATE=off) — every user is let through')
  }
  // Not awaited: the window must appear immediately, the booting status covers
  // the gap while the server probe runs (spec §2.6).
  state.authController.start().catch((err) => {
    state.logger.error('auth', `auth controller start failed: ${(err && err.stack) || err}`)
  })
}

/**
 * Environment the identity gate reads.
 *
 * Packaged builds merge the `userData/.env` snapshot, which is what makes
 * `ACCOUNT_SERVER_URL` an *optional* override and keeps `desktop-config.json`
 * authoritative (P0-1). Dev reads only the inherited environment so a packaged
 * `.env` in the developer's %APPDATA% cannot flip `ECLIPTRIX_AUTH_GATE` on.
 *
 * @returns {Record<string, string|undefined>}
 */
function gateEnv() {
  if (isDev) return { ...process.env }
  return { ...process.env, ...(state.userEnv || {}) }
}

/**
 * Push an AuthStatus to the main window (spec §4.5). Only the main window: a
 * splash or error window has no business receiving session state.
 *
 * @param {object} status AuthStatus
 */
function broadcastAuthStatus(status) {
  const win = state.mainWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send(AUTH_CHANGED_CHANNEL, status)
}

/** Tear the gate down: stop its timer, unsubscribe, drop the IPC handlers. */
function disposeAuthGate() {
  if (state.authIpc) {
    state.authIpc.dispose()
    state.authIpc = null
  }
  if (state.authController) {
    state.authController.dispose()
    state.authController = null
  }
}

async function resolvePorts() {
  const backendPick = await pickPort(state.config.backendPort)
  let frontendPick = await pickPort(state.config.frontendPort)
  if (frontendPick.port === backendPick.port) {
    // Only reachable if the user pinned same-parity ports in the config.
    frontendPick = await pickPort(frontendPick.port + 1)
  }
  state.backendPort = backendPick.port
  state.frontendPort = frontendPick.port

  if (backendPick.changed || frontendPick.changed) {
    state.logger.info(
      'config',
      `port fallback: frontend=${state.frontendPort} backend=${state.backendPort} ` +
        `(configured ${state.config.frontendPort}/${state.config.backendPort})`
    )
    if (frontendPick.changed) {
      // The desktop session lives in the main process and on disk, so an origin
      // change only costs renderer-local preferences — say exactly that instead
      // of scaring the user about "login state" (spec §7 risk 6 / R6).
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Ecliptrix 端口变更',
        message: `默认端口被占用,本次使用 ${state.frontendPort} 端口启动。`,
        detail:
          '由于浏览器存储按端口隔离,本地偏好可能需要重新设置,登录状态不受影响。\n' +
          `新端口已写入配置文件,后续启动将继续使用;如需固定其他端口,可编辑:\n` +
          `${path.join(state.userDataPath, 'desktop-config.json')}`,
        buttons: ['知道了'],
      })
    }
    // Persist the picked ports so the origin stays stable from now on.
    state.config.frontendPort = state.frontendPort
    state.config.backendPort = state.backendPort
    saveConfig(state.userDataPath, state.config)
  }
}

/**
 * 拉起并监管 agent-browser-host 子进程（spec §3.6）。
 *
 * 失败语义：宿主是能力件不是启动依赖——就绪失败只记录日志并跳过 env
 * 注入，后端把浏览器能力降级为 unavailable，静态搜索/抓取照常工作。
 * 崩溃自动重启（上限 3 次），重启后同样重新探测。
 */
async function startResearchBrowserHost() {
  try {
    const ports = await ensureResearchBrowserPorts()
    state.browserHost = createBrowserHostService(ports)
    state.browserHost.start()
    await state.browserHost.waitHealthy()
    // Unconditional marker: startup once stalled exactly here (the system-proxy
    // probe never returned) and left no line at all, so process.log could not
    // say how far it had got. Exactly one INFO line, no more.
    state.logger.info(
      'process',
      'agent-browser-host healthy — resolving research browser env',
    )
    state.researchBrowserEnv = await buildResearchBrowserEnv(ports)
    const cdpUrl = state.researchBrowserEnv.AGENT_BROWSER_CDP_URL
    state.logger.info(
      'process',
      `agent-browser-host ready (cdp=${cdpUrl})`,
    )
  } catch (err) {
    state.logger.warn(
      'process',
      `agent-browser-host unavailable — browser capability degraded: ${(err && err.message) || err}`,
    )
    if (state.browserHost) {
      await state.browserHost.stop().catch(() => {})
      state.browserHost = null
    }
    state.researchBrowserEnv = null
  }
}

/**
 * 挑选并记住宿主的 CDP / 控制端口。
 *
 * 端口只在首次挑选后固定：后端在 spawn 时已锁定这两个端口的 env，宿主崩溃
 * 重启若换端口，后端会继续拨号死端口（能力永远不会恢复）。
 *
 * @returns {Promise<{ cdpPort: number, controlPort: number }>} 固定端口。
 */
async function ensureResearchBrowserPorts() {
  // smoke/调试可经 env 固定端口；缺省动态挑选一次并记住（重启复用）。
  if (!state.researchBrowserPorts) {
    state.researchBrowserPorts = {
      cdpPort: Number(process.env.ECLIPTRIX_RESEARCH_CDP_PORT) ||
        (await pickPort(9222)).port,
      controlPort: Number(process.env.ECLIPTRIX_RESEARCH_CONTROL_PORT) ||
        (await pickPort(9333)).port,
    }
  }
  return state.researchBrowserPorts
}

/**
 * 构建宿主服务的描述符与监管器（尚未启动）。
 *
 * cwd 必须走 resolveBrowserHostCwd：打包态 app.getAppPath() 是 app.asar
 * 文件本身，拿它当子进程工作目录会让 spawn 立即 ENOENT。
 *
 * @param {{ cdpPort: number, controlPort: number }} ports 固定端口。
 * @returns {import('./processManager').ManagedService} 宿主服务实例。
 */
function createBrowserHostService({ cdpPort, controlPort }) {
  const portArgs = [`--cdp-port=${cdpPort}`, `--control-port=${controlPort}`]
  // dev 下 argv[1] 必须是应用目录，Electron 才能从源码加载宿主入口。
  const hostArgs = isDev
    ? [app.getAppPath(), '--agent-browser-host', ...portArgs]
    : ['--agent-browser-host', ...portArgs]
  // ELECTRON_RUN_AS_NODE 会把子进程降级成纯 Node，必须剥除。
  const hostEnv = { ...process.env }
  delete hostEnv.ELECTRON_RUN_AS_NODE
  return new ManagedService(
    {
      name: 'agent-browser-host',
      command: process.execPath,
      args: hostArgs,
      cwd: resolveBrowserHostCwd({
        appRoot: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      }),
      env: hostEnv,
      healthUrl: `http://127.0.0.1:${cdpPort}/json/version`,
      healthTimeoutMs: 20000,
    },
    {
      logger: state.logger,
      onUnexpectedExit: () => restartResearchBrowserHost(),
    },
  )
}

/**
 * 组装要注入后端的宿主环境变量，并附上系统代理（auto 模式第三优先级）。
 *
 * @param {{ cdpPort: number, controlPort: number }} ports 固定端口。
 * @returns {Promise<Record<string, string>>} 注入后端的宿主 env。
 */
async function buildResearchBrowserEnv({ cdpPort, controlPort }) {
  const researchBrowserEnv = {
    AGENT_BROWSER_CDP_URL: `http://127.0.0.1:${cdpPort}`,
    AGENT_BROWSER_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
  }
  const proxyUrl = await resolveSystemProxyUrl()
  if (proxyUrl) researchBrowserEnv.WEB_RESEARCH_SYSTEM_PROXY = proxyUrl
  return researchBrowserEnv
}

/**
 * 探测系统代理（spec §3.4/§3.6）；探测失败或超时只告警，改用直连。
 *
 * 探测有硬上限：打包态 resolveProxy 的回调可能永不触发，直接 await 会让
 * 启动卡在 startServices() 之前（见 proxyProbe.js）。
 *
 * @returns {Promise<string|null>} 代理 URL，未探测到或失败时为 null。
 */
async function resolveSystemProxyUrl() {
  try {
    const proxyUrl = await probeSystemProxy({
      // 必须包一层：resolveProxy 依赖 session 作为 this，不能只传方法引用。
      resolveProxy: (probeUrl, callback) =>
        session.defaultSession.resolveProxy(probeUrl, callback),
      logger: state.logger,
    })
    if (!proxyUrl) return null
    state.logger.info('process', `system proxy for research: ${proxyUrl}`)
    return proxyUrl
  } catch (error) {
    state.logger.warn('process', `resolveProxy failed: ${error.message}`)
    return null
  }
}

async function restartResearchBrowserHost() {
  if (state.quitting) return
  if (state.browserHostRestarts >= 3) {
    state.logger.error('process', 'agent-browser-host crashed too often — leaving browser capability degraded')
    state.browserHost = null
    state.researchBrowserEnv = null
    return
  }
  state.browserHostRestarts += 1
  state.logger.warn('process', `agent-browser-host crashed — restarting (${state.browserHostRestarts}/3)`)
  if (state.browserHost) {
    await state.browserHost.stop().catch(() => {})
    state.browserHost = null
  }
  await startResearchBrowserHost()
}

async function startServices() {
  const resourcesPath = process.resourcesPath

  windows.setSplashStatus(state.splash, '正在启动后端服务…')
  state.backend = new ManagedService(
    createBackendDescriptor({
      resourcesPath,
      userDataPath: state.userDataPath,
      backendPort: state.backendPort,
      frontendPort: state.frontendPort,
      userEnv: state.userEnv,
      researchBrowserEnv: state.researchBrowserEnv,
    }),
    { logger: state.logger, onUnexpectedExit: handleUnexpectedExit }
  )
  state.backend.start()
  await tagServiceError('后端服务 (backend)', () => state.backend.waitHealthy())

  windows.setSplashStatus(state.splash, '正在启动界面服务…')
  state.frontend = new ManagedService(
    createFrontendDescriptor({
      resourcesPath,
      frontendPort: state.frontendPort,
      backendPort: state.backendPort,
      userEnv: state.userEnv,
      electronExecPath: process.execPath,
    }),
    { logger: state.logger, onUnexpectedExit: handleUnexpectedExit }
  )
  state.frontend.start()
  await tagServiceError('界面服务 (frontend)', () => state.frontend.waitHealthy())

  windows.setSplashStatus(state.splash, '即将完成…')
}

async function tagServiceError(serviceName, fn) {
  try {
    await fn()
  } catch (err) {
    err.serviceName = serviceName
    throw err
  }
}

function createMainWindow(url) {
  state.mainWindow = windows.createMainWindow({
    url,
    bounds: state.config.windowBounds,
    onBoundsChange: (bounds) => {
      state.config.windowBounds = bounds
      saveConfig(state.userDataPath, state.config)
    },
    version: app.getVersion(),
    logsPath: state.logsPath,
    logger: state.logger,
    // Once before-quit has stopped the services a flush can only fail (RV-02).
    isQuitting: () => state.quitting,
  })
  state.logger.info('main', `main window created (bounds=${JSON.stringify(state.mainWindow.getBounds())})`)
  state.mainWindow.once('show', () => {
    state.logger.info('main', `main window shown (bounds=${JSON.stringify(state.mainWindow.getBounds())})`)
    closeSplash()
  })
  // Minimising for two hours must not leave a fifteen-minute-old verdict on
  // screen (spec §2.6 / D2-07).
  state.mainWindow.on('focus', () => {
    if (state.authController) state.authController.onWindowFocused().catch(() => {})
  })
  state.mainWindow.on('closed', () => {
    state.logger.info('main', 'main window closed')
    state.mainWindow = null
  })
  state.mainWindow.webContents.on('render-process-gone', (_event, details) => {
    state.logger.error('main', `renderer process gone: ${JSON.stringify(details)}`)
  })
  state.mainWindow.webContents.on('did-finish-load', () => {
    state.logger.info('main', `main window finished load (${url})`)
  })
}

// `npm run dev` attaches to a separately started Next.js server (spec §4.1); it
// does NOT spawn one. If that server isn't up yet, loadURL fails and the window
// would sit blank white. Show a waiting page that auto-retries until :3000
// responds, so the developer sees what to do instead of a silent white screen.
function openDevToolsIfRequested() {
  if (process.env.ELECTRON_OPEN_DEVTOOLS !== '1') return
  const win = state.mainWindow
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.openDevTools({ mode: 'right' })
  } catch (err) {
    state.logger.warn('main', `failed to open devtools: ${(err && err.message) || err}`)
  }
}

function watchDevFrontend() {
  const win = state.mainWindow
  if (!win) return
  const wc = win.webContents
  const waitingPage = path.join(app.getAppPath(), 'assets', 'dev-waiting.html')
  let retryTimer = null

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 is ERR_ABORTED, fired by normal in-app navigation; the waiting page is
    // a local file:// load that should never bounce back into the retry loop.
    if (!isMainFrame || errorCode === -3) return
    if (validatedURL && validatedURL.startsWith('file://')) return
    state.logger.warn('process', `dev frontend unreachable (${errorCode} ${errorDescription}); waiting for ${DEV_FRONTEND_URL}`)
    if (win.isDestroyed()) return
    win.show()
    wc.loadFile(waitingPage).catch(() => {})
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      if (!win.isDestroyed()) wc.loadURL(DEV_FRONTEND_URL)
    }, 2000)
  })

  win.on('closed', () => {
    if (retryTimer) clearTimeout(retryTimer)
  })
}

function closeSplash() {
  if (state.splash && !state.splash.isDestroyed()) {
    state.splash.destroy()
  }
  state.splash = null
}

function handleUnexpectedExit(name, code) {
  if (state.quitting) return
  state.logger.error('process', `service ${name} exited unexpectedly (code=${code})`)
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Ecliptrix 服务异常退出',
    message: `本地服务 ${name} 异常退出 (code=${code})。`,
    detail: `详细原因请查看日志:\n${state.logsPath}`,
    buttons: ['重启服务', '退出'],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice === 0) {
    restartServices()
  } else {
    app.quit()
  }
}

async function restartServices() {
  try {
    await stopChildren()
    await startServices()
    // Local services are back: let the renderer turn its "retry" affordance into
    // a real action without waiting for an auth field to change (spec §3.1).
    if (state.authController) state.authController.markServicesRestarted()
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.reload()
    } else {
      createMainWindow(`http://127.0.0.1:${state.frontendPort}`)
    }
  } catch (err) {
    state.logger.error('process', `service restart failed: ${(err && err.stack) || err}`)
    closeSplash()
    windows.showErrorWindow({
      serviceName: (err && err.serviceName) || '',
      logsPath: state.logsPath,
      detail: String((err && err.message) || err),
    })
  }
}

async function stopChildren() {
  const children = [state.frontend, state.backend, state.browserHost].filter(Boolean)
  await Promise.all(
    children.map((service) =>
      service.stop().catch((err) => {
        if (state.logger) {
          state.logger.warn('process', `stop failed: ${(err && err.message) || err}`)
        }
      })
    )
  )
}
