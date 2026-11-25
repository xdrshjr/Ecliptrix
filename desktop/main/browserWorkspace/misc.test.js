'use strict'

// Pure-node tests: shortcuts, context-menu template, resource fetcher, bridge validators.

const assert = require('assert')
const { EventEmitter } = require('events')
const { matchShortcut } = require('./viewShortcuts')
const { buildMenuTemplate } = require('./contextMenu')
const { createResourceFetcher } = require('./resourceFetch')
const { VALIDATORS, METHODS } = require('./bridge')
const { checkUrl } = require('./navigationGuard')
const { createRunner, main } = require('./testkit')

/** Fake electron.net.request driven by a script of responses keyed by URL. */
function fakeNet(script) {
  return {
    request({ url }) {
      const req = new EventEmitter()
      let current = url
      req.setHeader = (k, v) => { req.headers = { ...(req.headers || {}), [k]: v } }
      req.abort = () => { req.aborted = true }
      req.followRedirect = () => { current = script[current].location; setImmediate(() => play(req, current)) }
      req.end = () => setImmediate(() => play(req, current))
      return req
    },
  }
  function play(req, url) {
    const step = script[url]
    if (step.location) { req.emit('redirect', 302, 'GET', step.location); return }
    const response = new EventEmitter()
    response.statusCode = step.status || 200
    response.headers = { 'content-type': step.type }
    req.emit('response', response)
    for (const chunk of step.chunks || []) response.emit('data', Buffer.from(chunk))
    response.emit('end')
  }
}

function makeFetcher(script, tabOwner = 'agent') {
  const tab = { id: 't1', owner: tabOwner, url: 'https://page.example/a' }
  return createResourceFetcher({
    net: fakeNet(script), sessionFor: () => ({}), tabs: { get: (id) => (id === 't1' ? tab : null), profileId: () => 'default' },
    profiles: { partitionFor: (id) => `persist:wb-${id}` }, cdp: {}, checkUrl: (u, actor) => checkUrl(u, { actor }),
  })
}

async function run() {
  const t = createRunner()

  await t.test('shortcuts: mapped while focus is in a page; plain typing is left alone', () => {
    const key = (k, extra = {}) => matchShortcut({ type: 'keyDown', key: k, ...extra })
    assert.strictEqual(key('l', { control: true }), 'focus-address')
    assert.strictEqual(key('t', { meta: true }), 'new-tab')
    assert.strictEqual(key('w', { control: true }), 'close-tab')
    assert.strictEqual(key('F5'), 'reload')
    assert.strictEqual(key('Tab', { control: true, shift: true }), 'prev-tab')
    assert.strictEqual(key('ArrowLeft', { alt: true }), 'back')
    assert.strictEqual(key('b', { control: true, alt: true }), 'toggle-dock')
    assert.strictEqual(key('b', { alt: true }), null)
    assert.strictEqual(key('a'), null)
    assert.strictEqual(key('c', { control: true }), null)
    assert.strictEqual(matchShortcut({ type: 'keyUp', key: 'l', control: true }), null)
  })

  await t.test('context menu: image offers save-to-library which only emits a request', () => {
    const calls = []
    const handlers = new Proxy({}, { get: (_t, name) => (...args) => calls.push([name, ...args]) })
    const items = buildMenuTemplate({ mediaType: 'image', srcURL: 'https://c/x.jpg', linkURL: '', x: 1, y: 2 },
      { tab: { canGoBack: false, canGoForward: true }, handlers })
    const save = items.find((i) => i.label === '保存到素材库')
    save.click()
    assert.deepStrictEqual(calls[0], ['saveResource', { url: 'https://c/x.jpg', kind: 'image' }])
    assert.strictEqual(items.find((i) => i.label === '后退').enabled, false)
    assert.strictEqual(items.find((i) => i.label === '前进').enabled, true)
    const blob = buildMenuTemplate({ mediaType: 'video', srcURL: 'blob:abc' }, { tab: {}, handlers })
    assert.ok(!blob.some((i) => i.label === '保存到素材库'))
  })

  await t.test('resourceFetch: data URL, content-type gate, size cap, Referer from the tab', async () => {
    const f = makeFetcher({
      'https://cdn.example/a.png': { type: 'image/png', chunks: ['abc', 'def'] },
      'https://cdn.example/page.html': { type: 'text/html', chunks: ['<p>'] },
      'https://cdn.example/big.png': { type: 'image/png', chunks: ['x'.repeat(100)] },
    })
    const ok = await f.fetchResource({ tab_id: 't1', url: 'https://cdn.example/a.png', kind: 'image' })
    assert.deepStrictEqual([ok.status, ok.body.toString(), ok.headers['content-type'], ok.headers['x-final-url']], [200, 'abcdef', 'image/png', 'https://cdn.example/a.png'])
    await assert.rejects(f.fetchResource({ tab_id: 't1', url: 'https://cdn.example/page.html', kind: 'image' }), { code: 'resource_not_image' })
    await assert.rejects(f.fetchResource({ tab_id: 't1', url: 'https://cdn.example/big.png', kind: 'image', max_bytes: 10 }), { code: 'resource_too_large' })
    const data = await f.fetchResource({ tab_id: 't1', url: 'data:image/png;base64,AAAA', kind: 'image' })
    assert.strictEqual(data.body.length, 3)
    await assert.rejects(f.fetchResource({ tab_id: 'zzz', url: 'https://cdn.example/a.png', kind: 'image' }), { code: 'browser_session_lost' })
  })

  await t.test('resourceFetch: every redirect hop is re-guarded (private hop refused for agent tabs)', async () => {
    const script = {
      'https://cdn.example/r.png': { location: 'http://10.0.0.5/internal.png' },
      'https://cdn.example/ok.png': { location: 'https://cdn2.example/final.png' },
      'https://cdn2.example/final.png': { type: 'image/jpeg', chunks: ['jj'] },
    }
    const agent = makeFetcher(script, 'agent')
    await assert.rejects(agent.fetchResource({ tab_id: 't1', url: 'https://cdn.example/r.png', kind: 'image' }), { code: 'private_network_blocked' })
    const followed = await agent.fetchResource({ tab_id: 't1', url: 'https://cdn.example/ok.png', kind: 'image' })
    assert.strictEqual(followed.body.toString(), 'jj')
    await assert.rejects(agent.fetchResource({ tab_id: 't1', url: 'http://127.0.0.1:1/', kind: 'image' }), { code: 'private_network_blocked' })
  })

  await t.test('bridge validators: every channel has a validator and a method; bad shapes are rejected', () => {
    for (const channel of Object.keys(METHODS)) assert.strictEqual(typeof VALIDATORS[channel], 'function', channel)
    assert.strictEqual(VALIDATORS['browser:set-bounds']({ x: 0, y: 0, width: -1, height: 5 }), null)
    assert.strictEqual(VALIDATORS['browser:set-bounds']({ x: 0, y: 0, width: Infinity, height: 5 }), null)
    assert.deepStrictEqual(VALIDATORS['browser:set-bounds'](null), [null])
    assert.strictEqual(VALIDATORS['browser:resolve-approval']('a', 'maybe'), null)
    assert.strictEqual(VALIDATORS['browser:navigate']('a', 'x'.repeat(5000)), null)
    assert.strictEqual(VALIDATORS['browser:reorder-tabs'](new Array(40).fill('a')), null)
    assert.strictEqual(VALIDATORS['browser:profiles-create']({ name: 5 }), null)
    assert.deepStrictEqual(VALIDATORS['browser:open-tab'](undefined), [{}])
  })

  return t.count()
}

if (require.main === module) main('misc', run)
module.exports = { run }
