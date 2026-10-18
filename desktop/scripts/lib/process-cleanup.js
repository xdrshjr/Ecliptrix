/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const { spawnSync } = require('child_process')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Build the PowerShell -like pattern matching any executable path under
 * `rootDir`. Exported so the escaping rules can be regression-tested without
 * live OS processes.
 *
 * The pattern is interpolated into a PowerShell SINGLE-quoted string compared
 * with -like. In both a single-quoted string and a -like wildcard, backslash is
 * a literal character (the only -like metacharacters are * ? [ ]) — so the path
 * must NOT be backslash-escaped. Doubling them (the previous bug) made -like
 * require two backslashes per separator, matching nothing and silently
 * returning zero processes. Wildcards and backticks must be escaped for -like;
 * single quotes are doubled for the outer literal. A trailing separator prevents
 * a sibling dir (e.g. win-unpacked-old) from prefix-matching win-unpacked.
 *
 * @param {string} rootDir Absolute directory to match executable paths against.
 * @returns {string} The -like wildcard pattern (trailing `*` included).
 */
function buildUnderPattern(rootDir) {
  const normalized = rootDir.replace(/\//g, '\\')
  const sep = normalized.endsWith('\\') ? '' : '\\'
  return (normalized + sep).replace(/[`*?\[\]]/g, '`$&').replace(/'/g, "''") + '*'
}

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
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${buildUnderPattern(rootDir)}' } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf-8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 }
  )
  if (result.error || result.status !== 0) {
    throw new Error('进程枚举失败，不能确认零残留')
  }
  const pids = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (pids.some(pid => !/^[1-9][0-9]*$/.test(pid))) {
    throw new Error('进程枚举返回非法结果')
  }
  return pids
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

async function waitForNoProcessesUnder(rootDir, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000
  const intervalMs = options.intervalMs ?? 250
  const listProcesses = options.processesUnder || processesUnder
  const wait = options.sleep || sleep
  const now = options.now || (() => Date.now())
  const deadline = now() + timeoutMs
  let leftovers = []

  while (now() <= deadline) {
    leftovers = listProcesses(rootDir)
    if (leftovers.length === 0) return []
    const remainingMs = deadline - now()
    if (remainingMs <= 0) break
    await wait(Math.min(intervalMs, remainingMs))
  }

  return leftovers
}

module.exports = {
  buildUnderPattern,
  processesUnder,
  killPids,
  waitForNoProcessesUnder,
}
