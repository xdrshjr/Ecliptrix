'use strict'

// cdpEngine.js — Chrome DevTools Protocol over `webContents.debugger` (spec §4.2.5, D-BW2-2).
//
// Why debugger and not --remote-debugging-port: an open port lets ANY local process drive
// a browser that holds the user's logins; the in-process debugger is visible to the main
// process only. Per tab: lazy attach, FIFO command queue (one command at a time), a
// lazily (re)built isolated world `ecx` so page JS cannot read or forge `__ecx`.

const { sentinelSource, BINDING_NAME, WORLD_NAME } = require('./pageScripts/sentinel')

const DEFAULT_TIMEOUT_MS = 15_000

class CdpError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

/**
 * @param {{ logger?: object }} [deps]
 * @returns {object} engine
 */
function createCdpEngine(deps = {}) {
  /** @type {Map<string, object>} */
  const tabs = new Map()
  const handlers = { userInput: [], dialog: [], fileChooser: [], detached: [] }
  const emit = (kind, ...args) => handlers[kind].forEach((fn) => { try { fn(...args) } catch { /* listener bug must not break CDP */ } })

  async function sendRaw(entry, method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CdpError('cdp_timeout', `${method} timed out`)), timeoutMs)
    })
    try {
      return await Promise.race([entry.wc.debugger.sendCommand(method, params || {}), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  function onMessage(tabId, entry, method, params) {
    if (method === 'Runtime.executionContextCreated' && params.context.name === WORLD_NAME) {
      entry.contextId = params.context.id
    } else if (method === 'Runtime.executionContextDestroyed' && params.executionContextId === entry.contextId) {
      entry.contextId = null
    } else if (method === 'Runtime.executionContextsCleared' || (method === 'Page.frameNavigated' && !params.frame.parentId)) {
      entry.contextId = null
    } else if (method === 'Runtime.bindingCalled' && params.name === BINDING_NAME) {
      emit('userInput', tabId)
    } else if (method === 'Page.javascriptDialogOpening') {
      const accept = handlers.dialog.map((fn) => fn(tabId, params)).find((v) => typeof v === 'boolean')
      if (accept !== undefined) sendRaw(entry, 'Page.handleJavaScriptDialog', { accept }).catch(() => {})
    } else if (method === 'Page.fileChooserOpened') {
      emit('fileChooser', tabId, params)
    }
  }

  /**
   * Attach (once) and enable the domains the workspace needs.
   * @param {string} tabId
   * @param {object} wc Electron WebContents.
   */
  async function ensure(tabId, wc) {
    let entry = tabs.get(tabId)
    if (entry && entry.attached && entry.wc === wc) return entry
    // Keep the FIFO chain of an entry that enqueue() created before the first attach.
    entry = Object.assign(entry || { queue: Promise.resolve() }, { wc, attached: false, contextId: null })
    tabs.set(tabId, entry)
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    entry.attached = true
    const onMsg = (_e, method, params) => onMessage(tabId, entry, method, params)
    const onDetach = (_e, reason) => {
      entry.attached = false
      entry.contextId = null
      wc.debugger.removeListener('message', onMsg)
      wc.debugger.removeListener('detach', onDetach)
      emit('detached', tabId, reason)
    }
    wc.debugger.on('message', onMsg)
    wc.debugger.on('detach', onDetach)
    await sendRaw(entry, 'Page.enable')
    await sendRaw(entry, 'Runtime.enable')
    await sendRaw(entry, 'Emulation.setFocusEmulationEnabled', { enabled: true })
    await sendRaw(entry, 'Page.addScriptToEvaluateOnNewDocument', { source: sentinelSource(), worldName: WORLD_NAME })
    await sendRaw(entry, 'Runtime.addBinding', { name: BINDING_NAME, executionContextName: WORLD_NAME })
    return entry
  }

  async function worldContext(entry) {
    if (entry.contextId) return entry.contextId
    const { frameTree } = await sendRaw(entry, 'Page.getFrameTree')
    const { executionContextId } = await sendRaw(entry, 'Page.createIsolatedWorld', {
      frameId: frameTree.frame.id, worldName: WORLD_NAME, grantUniveralAccess: false,
    })
    entry.contextId = executionContextId
    return executionContextId
  }

  /**
   * Evaluate an expression in the isolated world; returns the JSON value.
   * @param {string} tabId
   * @param {string} expression
   * @param {{ timeoutMs?: number }} [options]
   */
  async function evalIsolated(tabId, expression, options = {}) {
    const entry = tabs.get(tabId)
    if (!entry || !entry.attached) throw new CdpError('tab_crashed', 'debugger not attached')
    const run = async () => sendRaw(entry, 'Runtime.evaluate', {
      expression, contextId: await worldContext(entry), returnByValue: true, awaitPromise: true,
    }, options.timeoutMs)
    let result
    try {
      result = await run()
    } catch (err) {
      if (!/context|Cannot find/i.test(String(err.message))) throw err
      entry.contextId = null // navigation raced us: rebuild the world once
      result = await run()
    }
    if (result.exceptionDetails) {
      throw new CdpError('page_script_error', String((result.exceptionDetails.exception || {}).description || 'page script failed').slice(0, 200))
    }
    return result.result.value
  }

  /** @returns {Promise<unknown>} CDP command on the tab (raw). */
  function send(tabId, method, params, timeoutMs) {
    const entry = tabs.get(tabId)
    if (!entry || !entry.attached) return Promise.reject(new CdpError('tab_crashed', 'debugger not attached'))
    return sendRaw(entry, method, params, timeoutMs)
  }

  /**
   * FIFO per tab: one command at a time; an aborted signal rejects before start.
   * @template T
   * @param {string} tabId
   * @param {(signal?: AbortSignal) => Promise<T>} task
   * @param {AbortSignal} [signal]
   * @returns {Promise<T>}
   */
  function enqueue(tabId, task, signal) {
    let entry = tabs.get(tabId)
    if (!entry) { entry = { queue: Promise.resolve(), attached: false }; tabs.set(tabId, entry) }
    const run = entry.queue.then(() => {
      if (signal && signal.aborted) throw new CdpError('command_cancelled')
      return task(signal)
    })
    entry.queue = run.catch(() => {})
    return run
  }

  function release(tabId) {
    const entry = tabs.get(tabId)
    if (entry && entry.attached) { try { entry.wc.debugger.detach() } catch { /* already gone */ } }
    tabs.delete(tabId)
  }

  return {
    ensure, evalIsolated, send, enqueue, release,
    setFileChooserIntercept: (tabId, enabled) => send(tabId, 'Page.setInterceptFileChooserDialog', { enabled }).catch(() => {}),
    isAttached: (tabId) => Boolean(tabs.get(tabId) && tabs.get(tabId).attached),
    onUserInput: (fn) => handlers.userInput.push(fn),
    /** fn(tabId, params) → true/false to handle the dialog, anything else leaves it alone. */
    onDialog: (fn) => handlers.dialog.push(fn),
    onFileChooser: (fn) => handlers.fileChooser.push(fn),
    onDetached: (fn) => handlers.detached.push(fn),
  }
}

module.exports = { createCdpEngine, CdpError }
