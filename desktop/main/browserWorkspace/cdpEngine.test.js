'use strict'

// Pure-node tests for cdpEngine with a fake `webContents.debugger`.

const assert = require('assert')
const { EventEmitter } = require('events')
const { createCdpEngine } = require('./cdpEngine')
const { createRunner, main } = require('./testkit')

function fakeWc(handler = async () => ({})) {
  const dbg = new EventEmitter()
  let attached = false
  dbg.log = []
  dbg.isAttached = () => attached
  dbg.attach = () => { attached = true }
  dbg.detach = () => { attached = false; dbg.emit('detach', {}, 'target closed') }
  dbg.sendCommand = async (method, params) => { dbg.log.push(method); return handler(method, params) }
  return { debugger: dbg }
}

async function run() {
  const t = createRunner()

  await t.test('ensure attaches once, enables domains, registers the sentinel in world ecx', async () => {
    const wc = fakeWc()
    const cdp = createCdpEngine()
    await cdp.ensure('t1', wc)
    await cdp.ensure('t1', wc)
    assert.deepStrictEqual(wc.debugger.log.filter((m) => m === 'Page.enable').length, 1)
    assert.ok(wc.debugger.log.includes('Emulation.setFocusEmulationEnabled'))
    assert.ok(wc.debugger.log.includes('Page.addScriptToEvaluateOnNewDocument'))
    assert.ok(wc.debugger.log.includes('Runtime.addBinding'))
  })

  await t.test('evalIsolated builds the isolated world once and rebuilds after navigation', async () => {
    let worlds = 0
    const wc = fakeWc(async (method) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'f' } } }
      if (method === 'Page.createIsolatedWorld') { worlds += 1; return { executionContextId: worlds } }
      if (method === 'Runtime.evaluate') return { result: { value: 42 } }
      return {}
    })
    const cdp = createCdpEngine()
    await cdp.ensure('t1', wc)
    assert.strictEqual(await cdp.evalIsolated('t1', '1+1'), 42)
    await cdp.evalIsolated('t1', '1+1')
    assert.strictEqual(worlds, 1)
    wc.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'f' } })
    await cdp.evalIsolated('t1', '1+1')
    assert.strictEqual(worlds, 2)
  })

  await t.test('page exceptions surface as page_script_error without leaking the stack', async () => {
    const wc = fakeWc(async (method) => (method === 'Runtime.evaluate'
      ? { exceptionDetails: { exception: { description: 'ReferenceError: x' } } }
      : method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'f' } } } : { executionContextId: 1 }))
    const cdp = createCdpEngine()
    await cdp.ensure('t1', wc)
    await assert.rejects(cdp.evalIsolated('t1', 'x'), { code: 'page_script_error' })
  })

  await t.test('binding calls → onUserInput; dialogs → handler decides accept; file chooser reported', async () => {
    const wc = fakeWc()
    const cdp = createCdpEngine()
    const seen = []
    cdp.onUserInput((id) => seen.push(['input', id]))
    cdp.onDialog((id, p) => (p.type === 'alert' ? false : undefined))
    cdp.onFileChooser((id) => seen.push(['chooser', id]))
    await cdp.ensure('t1', wc)
    wc.debugger.emit('message', {}, 'Runtime.bindingCalled', { name: '__ecxUser' })
    wc.debugger.emit('message', {}, 'Runtime.bindingCalled', { name: 'other' })
    wc.debugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'hi' })
    wc.debugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'prompt', message: 'hi' })
    wc.debugger.emit('message', {}, 'Page.fileChooserOpened', {})
    await new Promise((r) => setImmediate(r))
    assert.deepStrictEqual(seen, [['input', 't1'], ['chooser', 't1']])
    assert.strictEqual(wc.debugger.log.filter((m) => m === 'Page.handleJavaScriptDialog').length, 1)
  })

  await t.test('enqueue is FIFO per tab and an aborted signal never starts the task', async () => {
    const cdp = createCdpEngine()
    const order = []
    const slow = cdp.enqueue('t1', async () => { await new Promise((r) => setTimeout(r, 30)); order.push('a') })
    const fast = cdp.enqueue('t1', async () => { order.push('b') })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(cdp.enqueue('t1', async () => order.push('never'), controller.signal), { code: 'command_cancelled' })
    await Promise.all([slow, fast])
    assert.deepStrictEqual(order, ['a', 'b'])
  })

  await t.test('detach (e.g. user opened DevTools) clears the attach flag; next ensure re-attaches once', async () => {
    const wc = fakeWc()
    const cdp = createCdpEngine()
    const detached = []
    cdp.onDetached((id, reason) => detached.push([id, reason]))
    await cdp.ensure('t1', wc)
    wc.debugger.detach()
    assert.strictEqual(cdp.isAttached('t1'), false)
    await assert.rejects(cdp.evalIsolated('t1', '1'), { code: 'tab_crashed' })
    await cdp.ensure('t1', wc)
    assert.strictEqual(cdp.isAttached('t1'), true)
    assert.deepStrictEqual(detached, [['t1', 'target closed']])
    assert.strictEqual(wc.debugger.listenerCount('message'), 1)
  })

  return t.count()
}

if (require.main === module) main('cdpEngine', run)
module.exports = { run }
