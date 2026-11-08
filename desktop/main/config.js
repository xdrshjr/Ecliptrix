'use strict'

const fs = require('fs')
const path = require('path')

// 18320/18321 sit in an uncommon range to minimise collisions (spec §7 risk 5);
// frontend is even, backend odd, and port probing steps by 2 so the two
// fallback series never intersect.
const DEFAULT_FRONTEND_PORT = 18320
const DEFAULT_BACKEND_PORT = 18321
const CONFIG_FILE_NAME = 'desktop-config.json'
// Identity gate artefacts (spec §5.1 / §5.3). Both live in userData next to
// desktop-config.json; the session file only exists when "remember this device"
// was left checked.
const AUTH_SESSION_FILE_NAME = 'auth-session.json'
const AUTH_ATTEMPTS_FILE_NAME = 'auth-attempts.json'

function defaultConfig(appVersion) {
  return {
    schemaVersion: 1,
    // Placed right after schemaVersion so a human editing the file sees the
    // break-glass account first (spec §3.1). Re-added when absent on purpose:
    // the rescue channel must not disappear because someone deleted a line —
    // disable it with `"enabled": false` instead (§5.2).
    localAdmin: { username: 'admin', password: 'adminjr', enabled: true },
    // `accountServerUrl` is the AUTHORITATIVE source for the account server
    // (P0-1). The main process never parses userData/.env, so a URL written
    // there would never be read.
    auth: { accountServerUrl: '', offlineGraceDays: 7 },
    frontendPort: DEFAULT_FRONTEND_PORT,
    backendPort: DEFAULT_BACKEND_PORT,
    windowBounds: null,
    lastRunVersion: appVersion,
  }
}

/**
 * Initialise the userData layout (spec §5): data/, storage/, logs/, a
 * first-run .env copied from the bundled template, and desktop-config.json.
 *
 * The merge below is SHALLOW (`{...defaults, ...parsed}`): a missing top-level
 * key gets its default, but a half-written nested object does not gain missing
 * fields. `authConfig.js` backfills those field by field (P2-5).
 *
 * Returns { config, envPath, configPath, sessionPath, attemptsPath }.
 */
function initUserData({ userDataPath, appVersion, envTemplatePath }) {
  for (const dir of ['data', 'storage', 'logs']) {
    fs.mkdirSync(path.join(userDataPath, dir), { recursive: true })
  }

  const envPath = path.join(userDataPath, '.env')
  if (!fs.existsSync(envPath)) {
    // copyFileSync reads through asar transparently when packaged.
    fs.copyFileSync(envTemplatePath, envPath)
  }

  const configPath = path.join(userDataPath, CONFIG_FILE_NAME)
  let config = defaultConfig(appVersion)
  if (fs.existsSync(configPath)) {
    try {
      config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) }
    } catch {
      // Corrupted config — fall back to defaults; rewritten just below.
    }
  }
  config.lastRunVersion = appVersion
  saveConfig(userDataPath, config)
  return {
    config,
    envPath,
    configPath,
    sessionPath: path.join(userDataPath, AUTH_SESSION_FILE_NAME),
    attemptsPath: path.join(userDataPath, AUTH_ATTEMPTS_FILE_NAME),
  }
}

function saveConfig(userDataPath, config) {
  const configPath = path.join(userDataPath, CONFIG_FILE_NAME)
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

module.exports = {
  initUserData,
  saveConfig,
  CONFIG_FILE_NAME,
  AUTH_SESSION_FILE_NAME,
  AUTH_ATTEMPTS_FILE_NAME,
  DEFAULT_FRONTEND_PORT,
  DEFAULT_BACKEND_PORT,
}
