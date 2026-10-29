'use strict'

// Packaged Electron keeps the app shell inside an asar archive, so
// `app.getAppPath()` returns `...\resources\app.asar` — a FILE. A child process
// cannot be spawned with a file as its cwd (CreateProcess/posix_spawn fails
// immediately with ENOENT), which is how the packaged app lost its browser
// capability (docs/diagnoses/desktop-build-agent-browser-host-missing-payload).
const ASAR_SUFFIX = '.asar'

/**
 * Whether a path names an asar archive instead of a real directory.
 *
 * @param {string} target filesystem path.
 * @returns {boolean} true for `*.asar` paths (Windows paths are case-blind).
 */
function isAsarArchive(target) {
  return target.toLowerCase().endsWith(ASAR_SUFFIX)
}

/**
 * Resolve a real directory to spawn the agent-browser-host child in.
 *
 * `app.getAppPath()` is the `desktop/` source directory in dev but the
 * `app.asar` archive in a packaged build. When it is an archive we fall back to
 * `process.resourcesPath` — the directory that contains the archive — because
 * it always exists in a packaged app and needs no archive extraction.
 *
 * @param {{ appRoot: string, resourcesPath: string }} paths `appRoot` is
 *   `app.getAppPath()`, `resourcesPath` is `process.resourcesPath`.
 * @returns {string} the app root in dev, else the resources directory.
 * @throws {Error} when `appRoot` is missing, or when it is an archive and
 *   `resourcesPath` is missing or itself an archive — no spawnable cwd then.
 */
function resolveBrowserHostCwd({ appRoot, resourcesPath }) {
  if (!appRoot) {
    throw new Error(
      'resolveBrowserHostCwd: appRoot is required (app.getAppPath())',
    )
  }
  if (!isAsarArchive(appRoot)) return appRoot
  if (!resourcesPath || isAsarArchive(resourcesPath)) {
    throw new Error(
      `resolveBrowserHostCwd: ${appRoot} is an asar archive and ` +
        `resourcesPath ${resourcesPath || '(missing)'} is not a directory`,
    )
  }
  return resourcesPath
}

module.exports = { isAsarArchive, resolveBrowserHostCwd }
