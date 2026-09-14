'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')

const { installCloseGuard } = require('./closeGuard')

const PROMPT = { title: 'Unsaved', body: 'Saving failed', keepOpen: 'Keep open', closeAnyway: 'Close anyway' }

function createHarness({ dialogChoice = 1, shouldBypass, timeoutMs = 1000 } = {}) {
  const ipcMain = new EventEmitter()
  const sent = []
  let resolveClosed
  const closed = new Promise((resolve) => { resolveClosed = resolve })
  let resolveDialog
  const dialogShown = new Promise((resolve) => { resolveDialog = resolve })

  const win = new EventEmitter()
  win.closeCalls = 0
  win.isDestroyed = () => false
  win.webContents = {
    isDestroyed: () => false,
    isCrashed: () => false,
    send: (channel, token) => sent.push({ channel, token }),
  }
  win.close = () => {
    win.closeCalls += 1
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    win.emit('close', event)
    if (!event.defaultPrevented) resolveClosed()
  }
  const dialog = {
    showMessageBoxSync: (_win, options) => {
      resolveDialog(options)
      return dialogChoice
    },
  }
  const logger = { warn: () => {} }

  installCloseGuard(win, { ipcMain, dialog, logger, timeoutMs, shouldBypass })

  function userClose() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    win.emit('close', event)
    return event
  }
  function reply(result) {
    const { token } = sent[sent.length - 1]
    ipcMain.emit('app:close-ready', {}, token, result)
  }
  return { win, sent, ipcMain, closed, dialogShown, userClose, reply }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function testCloseIsDeferredUntilCloseReadyArrives() {
  const h = createHarness()
  const event = h.userClose()
  assert.strictEqual(event.defaultPrevented, true, 'the first close must be held back')
  assert.deepStrictEqual(h.sent.map((m) => m.channel), ['app:before-close'])
  await settle()
  assert.strictEqual(h.win.closeCalls, 0, 'nothing closes before the renderer replies')

  h.reply({ ok: true })
  await h.closed
  assert.strictEqual(h.win.closeCalls, 1)
  assert.strictEqual(h.ipcMain.listenerCount('app:close-ready'), 0, 'the reply listener is removed')
}

async function testCloseProceedsAfterTheTimeout() {
  const h = createHarness({ timeoutMs: 10 })
  h.userClose()
  await h.closed
  assert.strictEqual(h.win.closeCalls, 1, 'an unresponsive renderer never traps the user')
}

async function testKeepOpenChoiceCancelsTheClose() {
  const h = createHarness({ dialogChoice: 0 })
  h.userClose()
  h.reply({ ok: false, prompt: PROMPT })
  const options = await h.dialogShown
  await settle()
  assert.deepStrictEqual(options.buttons, ['Keep open', 'Close anyway'])
  assert.strictEqual(h.win.closeCalls, 0, 'keep open leaves the window open')

  h.userClose()
  assert.strictEqual(h.sent.length, 2, 'a later close asks the renderer again')
}

async function testSecondCloseClickWhileFlushingSendsOneRequest() {
  const h = createHarness()
  h.userClose()
  const second = h.userClose()
  assert.strictEqual(second.defaultPrevented, true)
  assert.strictEqual(h.sent.length, 1, 'only one flush request is in flight')
  h.reply({ ok: true })
  await h.closed
  assert.strictEqual(h.win.closeCalls, 1)
}

async function testCloseAnywayChoiceClosesTheWindow() {
  const h = createHarness({ dialogChoice: 1 })
  h.userClose()
  h.reply({ ok: false, prompt: PROMPT })
  await h.closed
  assert.strictEqual(h.win.closeCalls, 1, 'close anyway closes without asking the renderer again')
  assert.strictEqual(h.sent.length, 1)
}

async function testDeadRendererClosesWithoutWaiting() {
  const h = createHarness({ timeoutMs: 60 * 1000 })
  h.win.webContents.isCrashed = () => true
  h.userClose()
  await h.closed
  assert.strictEqual(h.sent.length, 0, 'a crashed renderer is not asked to flush')
  assert.strictEqual(h.ipcMain.listenerCount('app:close-ready'), 0)
}

async function testCloseWhileAlreadyQuittingBypassesTheFlush() {
  const h = createHarness({ shouldBypass: () => true })
  const event = h.userClose()
  assert.strictEqual(event.defaultPrevented, false, 'quitting closes straight away')
  assert.strictEqual(h.sent.length, 0, 'no flush is requested from stopped services')
}

async function testIgnoresRepliesWithAnotherToken() {
  const h = createHarness({ timeoutMs: 10 })
  h.userClose()
  h.ipcMain.emit('app:close-ready', {}, 'stale-token', { ok: false, prompt: PROMPT })
  await h.closed
  assert.strictEqual(h.win.closeCalls, 1, 'a stale reply neither prompts nor blocks')
}

async function main() {
  await testCloseIsDeferredUntilCloseReadyArrives()
  await testCloseProceedsAfterTheTimeout()
  await testKeepOpenChoiceCancelsTheClose()
  await testSecondCloseClickWhileFlushingSendsOneRequest()
  await testCloseAnywayChoiceClosesTheWindow()
  await testDeadRendererClosesWithoutWaiting()
  await testCloseWhileAlreadyQuittingBypassesTheFlush()
  await testIgnoresRepliesWithAnotherToken()
  console.log('close-guard tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
