'use strict'

const { spawnSync } = require('child_process')

/**
 * List PIDs of processes whose executable lives under `rootDir` (Windows).
 *
 * Used both by the smoke test (residual-process gate) and by the packaging
 * step (clearing a leftover Ecliptrix.exe instance that still holds a handle
 * on the previous build's exe before electron-builder rewrites it). Single
 * source of truth so the two call sites never drift.
 *
 * @param {string} rootDir Absolute directory to match executable paths against.
 * @returns {string[]} Matching PIDs as strings; empty when none / not Windows.
 */
function processesUnder(rootDir) {
  const escaped = rootDir.replace(/\\/g, '\\\\').replace(/'/g, "''")
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${escaped}*' } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf-8', windowsHide: true }
  )
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Force-kill the given PIDs together with their child process trees (Windows).
 *
 * @param {string[]} pids PIDs to terminate.
 */
function killPids(pids) {
  for (const pid of pids) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  }
}

module.exports = {
  processesUnder,
  killPids,
}
