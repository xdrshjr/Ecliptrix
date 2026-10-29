/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const path = require('path')

/**
 * Resolve a posix-style payload path under a concrete root directory.
 *
 * Payload lists are written with forward slashes so they stay readable and
 * platform-neutral; the filesystem call needs the OS separator.
 *
 * @param {string} root Absolute directory owning the payload.
 * @param {string} relativePath Posix-style path relative to `root`.
 * @returns {string} Absolute path to probe.
 */
function resolveUnder(root, relativePath) {
  return path.join(root, ...relativePath.split('/'))
}

/**
 * Build one root group: the directory, its declared payloads and its label.
 *
 * @param {string} root Absolute directory owning the payloads.
 * @param {string[]} payloads Posix-style paths relative to `root`.
 * @param {string|undefined} label Display label override.
 * @returns {{root: string, payloads: string[], label: string}} Root group.
 */
function rootGroup(root, payloads, label) {
  return { root, payloads, label: label || path.basename(root) }
}

/**
 * Check that every declared payload exists under the directory that OWNS it.
 *
 * A desktop build has two payload owners, and conflating them is exactly what
 * broke the packaging gate: `main/agentBrowserHost.js` is app-shell SOURCE at
 * desktop/main/ that electron-builder packs into app.asar, so probing it under
 * desktop/build/ (which only ever holds frontend/, backend/, python/, ffmpeg/
 * and env.template.desktop) could never succeed and aborted every build.
 * Keeping the two roots explicit here means a payload cannot be checked
 * against a directory that is structurally unable to contain it. Every entry
 * is still reported, with the root it was expected under, so failures stay
 * loud and self-locating.
 *
 * @param {object} options Check inputs.
 * @param {string} options.buildDir Generated runtime payload root (build/).
 * @param {string} options.appRoot App-shell source root packed into the asar.
 * @param {string[]} options.buildPayloads Posix-style paths under buildDir.
 * @param {string[]} options.appPayloads Posix-style paths under appRoot.
 * @param {(target: string) => boolean} options.existsSync Existence probe.
 * @param {string} [options.buildDirLabel] Display label for buildDir misses.
 * @param {string} [options.appRootLabel] Display label for appRoot misses.
 * @returns {{path: string, root: string, expected: string}[]} Missing payloads
 *   (`expected` is e.g. `build/frontend/server.js` vs `desktop/main/x.js`);
 *   empty when every declared payload is present.
 */
function checkPayloads(options) {
  const { buildPayloads, appPayloads, existsSync } = options
  const groups = [
    rootGroup(options.buildDir, buildPayloads, options.buildDirLabel),
    rootGroup(options.appRoot, appPayloads, options.appRootLabel),
  ]
  const missing = []
  for (const { root, payloads, label } of groups) {
    for (const relativePath of payloads) {
      if (existsSync(resolveUnder(root, relativePath))) continue
      missing.push({
        path: relativePath,
        root,
        expected: `${label}/${relativePath}`,
      })
    }
  }
  return missing
}

/**
 * Render missing payloads as indented bullet lines for an error message.
 *
 * @param {{expected: string}[]} missing Entries from checkPayloads().
 * @returns {string} Bullet list, each line prefixed with `  - `.
 */
function formatMissingPayloads(missing) {
  return missing.map((entry) => `  - ${entry.expected}`).join('\n')
}

module.exports = {
  checkPayloads,
  formatMissingPayloads,
}
