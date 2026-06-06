'use strict'

const { contextBridge } = require('electron')

function argValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

// v1 deliberately exposes read-only metadata only — the renderer is the
// unmodified web app talking HTTP to local services; no privileged IPC
// (spec §4.3).
contextBridge.exposeInMainWorld('ecliptrixDesktop', {
  version: argValue('--ecliptrix-version='),
  logsPath: argValue('--ecliptrix-logs-path='),
})
