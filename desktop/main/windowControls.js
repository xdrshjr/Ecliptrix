'use strict'

// Window-control IPC for the frameless main window (spec §2.3b). The renderer's
// self-drawn title bar (`src/components/desktop/DesktopTitleBar.tsx`) drives
// minimize / maximize / close through these channels. We resolve the target
// window from the invoking webContents so the handlers never assume a single
// window instance.
const { ipcMain, BrowserWindow } = require('electron')

function winOf(e) {
  return BrowserWindow.fromWebContents(e.sender)
}

/**
 * Register the four window-control IPC handlers. Must be called exactly once,
 * before any `if (isDev) … return` early-exit in `main()` (spec §2.3b / R2),
 * otherwise the self-drawn buttons have no handler under `npm run dev`.
 *
 * @param {object} [logger] Optional main-process logger; IPC calls are traced at
 *   DEBUG into ipc.log, so ipc.log is empty unless ECLIPTRIX_LOG_LEVEL=debug
 *   (spec §2.4 / R3).
 */
function registerWindowControlIpc(logger) {
  const trace = (channel) => {
    if (logger) logger.debug('ipc', channel)
  }
  ipcMain.handle('window:minimize', (e) => {
    trace('window:minimize')
    const w = winOf(e)
    if (w) w.minimize()
  })
  ipcMain.handle('window:toggle-maximize', (e) => {
    trace('window:toggle-maximize')
    const w = winOf(e)
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })
  ipcMain.handle('window:close', (e) => {
    trace('window:close')
    const w = winOf(e)
    if (w) w.close()
  })
  ipcMain.handle('window:is-maximized', (e) => {
    trace('window:is-maximized')
    const w = winOf(e)
    return !!(w && w.isMaximized())
  })
}

module.exports = { registerWindowControlIpc }
