'use strict'

// Close guard for the main window (ME-08). Closing the last window quits the
// app and stops the local backend, so an edit still inside the renderer's
// 800 ms autosave debounce was lost. Before the window closes we ask the
// renderer to flush pending saves and only then let the close proceed.
//
// Electron objects are injected so this module is testable under plain Node.

const crypto = require('crypto')

const CLOSE_FLUSH_TIMEOUT_MS = 3000

function isValidPrompt(prompt) {
  return (
    !!prompt &&
    ['title', 'body', 'keepOpen', 'closeAnyway'].every((key) => typeof prompt[key] === 'string')
  )
}

function normalizeResult(result) {
  if (result && result.ok === false && isValidPrompt(result.prompt)) {
    return { ok: false, prompt: result.prompt }
  }
  return { ok: true }
}

function isRendererGone(webContents) {
  if (!webContents || webContents.isDestroyed()) return true
  return typeof webContents.isCrashed === 'function' && webContents.isCrashed()
}

// Resolves with the renderer's verdict. A dead renderer or a missing reply
// never blocks the close: the user must always be able to close the window.
function requestRendererFlush(win, ipcMain, timeoutMs, logger) {
  return new Promise((resolve) => {
    const webContents = win.webContents
    if (isRendererGone(webContents)) {
      resolve({ ok: true })
      return
    }
    const token = crypto.randomUUID()
    let settled = false
    let timer = null

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.removeListener('app:close-ready', onReady)
      resolve(result)
    }
    function onReady(_event, replyToken, result) {
      if (replyToken !== token) return
      finish(normalizeResult(result))
    }

    timer = setTimeout(() => {
      if (logger) logger.warn('main', '[closeGuard] renderer flush timed out')
      finish({ ok: true, timedOut: true })
    }, timeoutMs)
    ipcMain.on('app:close-ready', onReady)
    try {
      webContents.send('app:before-close', token)
    } catch (err) {
      if (logger) logger.warn('main', `[closeGuard] could not reach renderer: ${(err && err.message) || err}`)
      finish({ ok: true })
    }
  })
}

/**
 * @param {object} win BrowserWindow
 * @param {object} deps { ipcMain, dialog, logger, timeoutMs, shouldBypass }
 *   shouldBypass — true once the app is already quitting: services are stopped,
 *   so a flush can only fail and a second dialog would strand the user (RV-02).
 */
function installCloseGuard(win, { ipcMain, dialog, logger, timeoutMs = CLOSE_FLUSH_TIMEOUT_MS, shouldBypass = () => false }) {
  let approved = false
  let flushing = false

  win.on('close', (event) => {
    if (approved || shouldBypass()) return
    event.preventDefault()
    // A second click while flushing waits for the same result.
    if (flushing) return
    flushing = true
    requestRendererFlush(win, ipcMain, timeoutMs, logger).then((result) => {
      flushing = false
      if (win.isDestroyed()) return
      if (!result.ok && result.prompt) {
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          buttons: [result.prompt.keepOpen, result.prompt.closeAnyway],
          defaultId: 0,
          cancelId: 0,
          title: result.prompt.title,
          message: result.prompt.body,
        })
        if (choice === 0) return
      }
      approved = true
      win.close()
    })
  })
}

module.exports = { installCloseGuard, CLOSE_FLUSH_TIMEOUT_MS }
