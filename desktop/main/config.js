'use strict'

const fs = require('fs')
const path = require('path')

// 18320/18321 sit in an uncommon range to minimise collisions (spec §7 risk 5);
// frontend is even, backend odd, and port probing steps by 2 so the two
// fallback series never intersect.
const DEFAULT_FRONTEND_PORT = 18320
const DEFAULT_BACKEND_PORT = 18321
const CONFIG_FILE_NAME = 'desktop-config.json'

function defaultConfig(appVersion) {
  return {
    schemaVersion: 1,
    frontendPort: DEFAULT_FRONTEND_PORT,
    backendPort: DEFAULT_BACKEND_PORT,
    windowBounds: { width: 1440, height: 900 },
    lastRunVersion: appVersion,
  }
}

/**
 * Initialise the userData layout (spec §5): data/, storage/, logs/, a
 * first-run .env copied from the bundled template, and desktop-config.json.
 * Returns { config, envPath, configPath }.
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
  return { config, envPath, configPath }
}

function saveConfig(userDataPath, config) {
  const configPath = path.join(userDataPath, CONFIG_FILE_NAME)
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

module.exports = {
  initUserData,
  saveConfig,
  DEFAULT_FRONTEND_PORT,
  DEFAULT_BACKEND_PORT,
}
