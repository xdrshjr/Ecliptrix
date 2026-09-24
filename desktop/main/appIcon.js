'use strict'

// App identity for the Windows shell: taskbar grouping (AUMID) and the
// runtime window icon. Pure Node — no electron require — so it stays
// loadable from the plain-node unit tests.
// Spec: docs/plans/brand-logo-refresh/spec.md §3.2.2

const path = require('path')

// MUST equal `appId` in electron-builder.yml (appIcon.test.js).
const APP_ID = 'com.ecliptrix.desktop'

/**
 * Win32 loads .ico via LoadImage on a real disk path, which cannot read
 * inside app.asar; electron-builder's `asarUnpack` puts the file in
 * app.asar.unpacked, so rewrite the path there. No-op in dev (no asar).
 */
function resolveUnpackedPath(filePath) {
  return filePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

// Lives under assets/ (shipped via `files: assets/**`), not resources/,
// which is buildResources and is NOT packaged. Byte-identical copy of
// resources/icons/icon.ico (appIcon.test.js).
const APP_ICON_PATH = resolveUnpackedPath(
  path.join(__dirname, '..', 'assets', 'icon.ico'),
)

/**
 * Dev runs get their own AUMID so they never merge into an installed
 * copy's taskbar group.
 */
function resolveAppUserModelId(isDev) {
  return isDev ? `${APP_ID}.dev` : APP_ID
}

module.exports = {
  APP_ID,
  APP_ICON_PATH,
  resolveAppUserModelId,
  resolveUnpackedPath,
}
