'use strict'

// jsdom tests for the page-side scripts. jsdom has no layout, so rects / hit testing /
// innerText are stubbed through data attributes (spec §8.2). jsdom lives in the repo root
// node_modules; the suite skips (and says so) when it is absent.

const assert = require('assert')
const { buildCall, snapshotPage, collectImages, prepareTarget, selectOption, describeFocus, waitCondition, waitDomQuiet,
  showAgentCursor, hideAgentOverlay, sentinelSource } = require('./index')
const { createRunner, main } = require('../testkit')

let JSDOM = null
try { ({ JSDOM } = require('jsdom')) } catch { JSDOM = null }

const HTML = `<!doctype html><html><head><title>News</title>
<meta property="og:image" content="https://cdn.example/og.jpg"></head><body>
<main>Headline text. <a id="a1" href="/world" data-rect="10,10,100,20">World</a>
<button id="b1" data-rect="10,40,80,30">Search</button>
<input id="q" placeholder="搜索" data-rect="10,80,200,30">
<input id="pw" type="password" aria-label="密码" data-rect="10,120,200,30">
<input id="cc" name="card-number" data-rect="10,160,200,30">
<select id="s" data-rect="10,200,100,30"><option value="a">Alpha</option><option value="b">Beta</option></select>
<button id="far" data-rect="10,5000,80,30">Far away</button>
<button id="hidden" data-rect="0,0,0,0">Hidden</button>
<div role="button" id="rb" data-rect="10,240,80,30">Role btn</div>
<img id="im" src="https://cdn.example/a.jpg" alt="pic" data-rect="0,300,400,300">
</main></body></html>`

function makeWindow() {
  const dom = new JSDOM(HTML, { url: 'https://news.example/', pretendToBeVisual: true, runScripts: 'outside-only' })
  const w = dom.window
  w.TextEncoder = TextEncoder
  w.innerWidth = 1280
  w.innerHeight = 720
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent } })
  w.Element.prototype.getBoundingClientRect = function rect() {
    const raw = this.getAttribute && this.getAttribute('data-rect')
    const [x, y, width, height] = (raw || '0,0,0,0').split(',').map(Number)
    return { left: x, top: y, right: x + width, bottom: y + height, x, y, width, height }
  }
  w.Element.prototype.scrollIntoView = function noop() {}
  w.document.elementFromPoint = (x, y) => [...w.document.querySelectorAll('[data-rect]')].find((el) => {
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }) || null
  return w
}

const exec = (w, fn, arg) => w.eval(buildCall(fn, arg))
const OPTS = { version: 3, maxElements: 60, maxBytes: 4000, fullBytes: 200000, budgetMs: 250 }

async function run() {
  const t = createRunner()
  if (!JSDOM) {
    console.log('  skip - jsdom not installed (root node_modules), pageScripts not exercised')
    return 0
  }

  await t.test('snapshot: roles, names, order (in-viewport first), invisible dropped, refs numbered', () => {
    const w = makeWindow()
    const snap = exec(w, snapshotPage, OPTS)
    const names = snap.elements.map((e) => e.name)
    assert.ok(names.includes('World') && names.includes('Search') && names.includes('Role btn'))
    assert.ok(!names.includes('Hidden'))
    assert.strictEqual(snap.elements.at(-1).name, 'Far away')
    assert.strictEqual(snap.elements[0].ref, 'e1')
    assert.strictEqual(snap.elements.find((e) => e.name === 'World').role, 'link')
    assert.strictEqual(snap.elements.find((e) => e.name === 'World').href, 'https://news.example/world')
    assert.strictEqual(snap.elements.find((e) => e.name === '搜索').role, 'textbox')
    assert.strictEqual(snap.elements.find((e) => e.name === 'Alpha Beta' || e.role === 'combobox').role, 'combobox')
    assert.ok(snap.text.includes('Headline text'))
    assert.strictEqual(snap.title, 'News')
  })

  await t.test('snapshot: password / card fields flagged sensitive and no value leaks', () => {
    const w = makeWindow()
    w.document.getElementById('pw').value = 'hunter2'
    const snap = exec(w, snapshotPage, OPTS)
    const pw = snap.elements.find((e) => e.name === '密码')
    assert.strictEqual(pw.sensitive, true)
    assert.ok(!JSON.stringify(snap).includes('hunter2'))
    assert.strictEqual(snap.elements.find((e) => e.type === 'text' && !e.name).sensitive, true)
  })

  await t.test('snapshot: maxElements truncates and sets truncated/more_below; text byte cap', () => {
    const w = makeWindow()
    const small = exec(w, snapshotPage, { ...OPTS, maxElements: 3, maxBytes: 10 })
    assert.strictEqual(small.elements.length, 3)
    assert.ok(small.truncated && small.more_below)
    assert.ok(new TextEncoder().encode(small.text).length <= 10)
    assert.ok(small.full_text.length > small.text.length)
  })

  await t.test('prepareTarget: stale version / stale ref / not found / sensitive / obscured / ok', async () => {
    const w = makeWindow()
    const snap = exec(w, snapshotPage, OPTS)
    const ref = (name) => snap.elements.find((e) => e.name === name).ref
    assert.strictEqual((await exec(w, prepareTarget, { ref: 'e1', expectVersion: 2, intent: 'click' })).code, 'stale_snapshot')
    assert.strictEqual((await exec(w, prepareTarget, { ref: 'e99', expectVersion: 3, intent: 'click' })).code, 'element_not_found')
    assert.strictEqual((await exec(w, prepareTarget, { ref: ref('密码'), expectVersion: 3, intent: 'fill' })).code, 'sensitive_field')
    const ok = await exec(w, prepareTarget, { ref: ref('Search'), expectVersion: 3, intent: 'click' })
    assert.deepStrictEqual([ok.ok, ok.x, ok.y, ok.name], [true, 50, 55, 'Search'])
    // something else covers the button's centre
    w.document.elementFromPoint = () => w.document.getElementById('a1')
    const obscured = await exec(w, prepareTarget, { ref: ref('Search'), expectVersion: 3, intent: 'click' })
    assert.strictEqual(obscured.code, 'element_obscured')
    assert.ok(obscured.details.obscured_by.includes('a#a1'))
    // element replaced after the snapshot → stale_ref
    const replaced = w.document.getElementById('b1')
    replaced.textContent = 'Something else'
    assert.strictEqual((await exec(w, prepareTarget, { ref: ref('Search'), expectVersion: 3, intent: 'click' })).code, 'stale_ref')
  })

  await t.test('prepareTarget fill focuses the field; selectOption sets value + fires change', async () => {
    const w = makeWindow()
    const snap = exec(w, snapshotPage, OPTS)
    const q = snap.elements.find((e) => e.name === '搜索').ref
    const res = await exec(w, prepareTarget, { ref: q, expectVersion: 3, intent: 'fill' })
    assert.ok(res.ok)
    assert.strictEqual(w.document.activeElement.id, 'q')
    assert.strictEqual(exec(w, describeFocus).sensitive, false)
    const sel = snap.elements.find((e) => e.role === 'combobox').ref
    let changed = 0
    w.document.getElementById('s').addEventListener('change', () => { changed += 1 })
    assert.ok(exec(w, selectOption, { ref: sel, expectVersion: 3, option_text: 'Beta' }).ok)
    assert.strictEqual(w.document.getElementById('s').value, 'b')
    assert.strictEqual(changed, 1)
    assert.strictEqual(exec(w, selectOption, { ref: sel, expectVersion: 3, value: 'zzz' }).code, 'element_not_found')
  })

  await t.test('images: img + og:image collected, sorted by area, inline kind flagged', () => {
    const w = makeWindow()
    const images = exec(w, collectImages, { limit: 100 })
    assert.strictEqual(images[0].image_url, 'https://cdn.example/a.jpg')
    assert.strictEqual(images[0].rendered_w, 400)
    assert.ok(images.some((i) => i.is_og && i.image_url === 'https://cdn.example/og.jpg'))
    w.document.body.insertAdjacentHTML('beforeend', '<img src="data:image/png;base64,AAAA" data-rect="0,0,10,10">')
    assert.ok(exec(w, collectImages, { limit: 100 }).some((i) => i.kind === 'inline'))
  })

  await t.test('waitCondition: matches text, times out with matched:false (not an error)', async () => {
    const w = makeWindow()
    assert.strictEqual((await exec(w, waitCondition, { until_text: 'Headline', timeout_ms: 500 })).matched, true)
    assert.strictEqual((await exec(w, waitCondition, { until_text: 'nope', timeout_ms: 250 })).matched, false)
    assert.strictEqual((await exec(w, waitCondition, { until_gone_text: 'nope', timeout_ms: 250 })).matched, true)
  })

  await t.test('waitDomQuiet resolves true once mutations stop', async () => {
    const w = makeWindow()
    const p = exec(w, waitDomQuiet, { quietMs: 60, maxMs: 1000 })
    w.document.body.appendChild(w.document.createElement('p'))
    assert.strictEqual(await p, true)
  })

  await t.test('overlay creates one closed-shadow host, hide removes it; sentinel is an IIFE string', () => {
    const w = makeWindow()
    exec(w, showAgentCursor, { x: 5, y: 6, rect: { x: 1, y: 1, w: 10, h: 10 }, label: 'click' })
    exec(w, showAgentCursor, { x: 7, y: 8, reduced: true })
    const hosts = [...w.document.documentElement.children].filter((e) => e.style.zIndex === '2147483647')
    assert.strictEqual(hosts.length, 1)
    assert.strictEqual(hosts[0].shadowRoot, null)
    exec(w, hideAgentOverlay)
    assert.strictEqual([...w.document.documentElement.children].filter((e) => e.style.zIndex === '2147483647').length, 0)
    assert.ok(/__ecxUser/.test(sentinelSource()) && sentinelSource().includes('isTrusted'))
    w.eval(sentinelSource())
  })

  return t.count()
}

if (require.main === module) main('pageScripts', run)
module.exports = { run }
