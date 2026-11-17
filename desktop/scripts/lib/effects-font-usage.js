'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Desktop test tools use the existing CommonJS entry convention. */
const assert = require('node:assert/strict')

const fontKeys = family => family === 'sans' ? ['sans', 'emoji'] : [family, 'sans', 'emoji']
const attributes = node => Object.fromEntries(Array.from({ length: (node.attributes || []).length / 2 }, (_, index) => node.attributes.slice(index * 2, index * 2 + 2)))
const faceKey = font => `${font.familyName}:${font.postScriptName}`
const validFont = font => typeof font.familyName === 'string' && !!font.familyName
  && typeof font.postScriptName === 'string' && !!font.postScriptName
  && font.isCustomFont === true && Number.isInteger(font.glyphCount) && font.glyphCount >= 0

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error('字体探针执行失败')
  return result.result.value
}
async function enable(send) { await send('DOM.enable'); await send('CSS.enable') }

/** Capture each direct text owner, rather than asking CSS about an empty root. */
async function collectFontUsage(send, selector, binding) {
  await enable(send)
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `${selector} [data-effects-text]` })
  const nodes = []
  for (const nodeId of nodeIds) {
    const { node } = await send('DOM.describeNode', { nodeId, depth: -1, pierce: true })
    const field = attributes(node)['data-effects-text']
    const owners = []
    const walk = (element, hidden = false) => {
      const attrs = attributes(element)
      if (Object.hasOwn(attrs, 'data-effects-measure')) return
      const style = attrs.style || ''
      const invisible = hidden || /visibility:\s*hidden|display:\s*none/.test(style)
      for (const child of element.children || []) {
        if (child.nodeType === 3 && child.nodeValue.trim() && !invisible)
          owners.push({ nodeId: element.nodeId, text: child.nodeValue })
        else if (child.nodeType === 1) walk(child, invisible)
      }
    }
    walk(node)
    for (const owner of owners) {
      const raw = await send('CSS.getPlatformFontsForNode', { nodeId: owner.nodeId })
      nodes.push({ field, text: owner.text, node_index: nodes.length, node_id: owner.nodeId, fonts: raw.fonts })
    }
  }
  return { ...binding, nodes }
}

/** Call only in an independent, same-origin test page; no local() or CSS fallback. */
async function collectFontReference(send, resources, fontUrls, side, fontHash) {
  await enable(send)
  const fonts = []
  for (const resource of resources.filter(item => item.role === 'font')) for (const weight of [400, 600]) {
    const sample = resource.family === 'emoji' ? '😀' : 'Aa01'
    await evaluate(send, `(async()=>{document.fonts.clear();document.body.replaceChildren();
      const font=await new FontFace(${JSON.stringify(`Effects-${resource.family}`)},${JSON.stringify(`url("${fontUrls[resource.family]}")`)},{weight:${JSON.stringify(resource.weight)}}).load();
      document.fonts.add(font);const node=document.createElement('div');node.id='effects-font-probe';node.textContent=${JSON.stringify(sample)};
      node.style.cssText=${JSON.stringify(`font-family:Effects-${resource.family};font-size:48px;font-weight:${weight}`)};document.body.append(node);
      await document.fonts.ready;await new Promise(requestAnimationFrame);})()`)
    const { root } = await send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#effects-font-probe' })
    const raw = await send('CSS.getPlatformFontsForNode', { nodeId })
    assert(raw.fonts.length && raw.fonts.every(validFont) && raw.fonts.some(font => font.glyphCount > 0), '离线字体探针为空或使用系统字体')
    fonts.push({ family: resource.family, path: resource.path, sha256: resource.sha256, weight, fonts: raw.fonts })
  }
  assert.equal(fonts.length, 8, '字体探针必须覆盖四字体的400/600字重')
  return { side, fontHash, fonts }
}

async function navigateProbe(send, url) {
  await send('Page.enable'); await send('Page.navigate', { url })
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    try { if (await evaluate(send, `document.URL===${JSON.stringify(url)}&&document.readyState==='complete'`)) return }
    catch { /* Navigation replaces its execution context. */ }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error('字体探针页导航超时')
}

function validateFontUsage({ usage, reference, expectedReference, binding, fields, layout }) {
  assert(usage && reference && expectedReference, '缺少字体来源或独立探针')
  for (const [key, value] of Object.entries(binding)) assert.deepEqual(usage[key], value, `字体来源绑定错误: ${key}`)
  assert.deepEqual(reference, expectedReference, '字体参考与本端独立探针不一致')
  assert.equal(reference.side, binding.side); assert.equal(reference.fontHash, binding.fontHash)
  assert.equal(reference.fonts.length, 8)
  const allowed = new Map(), emojiFaces = new Set()
  for (const probe of reference.fonts) {
    assert([400, 600].includes(probe.weight) && probe.fonts.length && probe.fonts.every(validFont), '错误探针')
    if (fontKeys(binding.family).includes(probe.family)) for (const font of probe.fonts) {
      allowed.set(faceKey(font), true)
      if (probe.family === 'emoji') emojiFaces.add(faceKey(font))
    }
  }
  assert(Array.isArray(usage.nodes), '缺少正式文字节点')
  const texts = {}, positive = new Set(); let emojiUsed = false
  const indices = new Set()
  for (const node of usage.nodes) {
    assert(Object.hasOwn(fields, node.field) && typeof node.text === 'string' && node.text.trim(), '字体节点不属于固定文案')
    assert(Number.isInteger(node.node_index) && !indices.has(node.node_index), '字体节点重复'); indices.add(node.node_index)
    assert(Array.isArray(node.fonts) && node.fonts.every(validFont), '系统字体或错误glyph记录')
    if (binding.frame === 29) assert(node.fonts.some(font => font.glyphCount > 0), '中帧正式节点缺少实际glyph')
    for (const font of node.fonts) if (font.glyphCount > 0) {
      assert(allowed.has(faceKey(font)), '出现未加载字体')
      positive.add(node.field); if (emojiFaces.has(faceKey(font))) emojiUsed = true
    }
    texts[node.field] = (texts[node.field] || '') + node.text
  }
  if (binding.frame === 29) {
    for (const [field, text] of Object.entries(fields)) if (text.trim()) {
      const comparable = value => value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\n/g, '')
      assert.equal(comparable(texts[field] || ''), comparable(text), '正式文字节点覆盖不完整')
      assert(positive.has(field), '中帧没有实际glyph')
    }
    if (binding.case_id === 'text-emoji' || binding.case_id === 'text-emoji-sequence') assert(emojiUsed, 'emoji没有使用随包face')
    if (layout) {
      const observed = layout.lines.filter(line => line.field && fields[line.field]?.trim())
      for (const field of Object.keys(fields).filter(key => fields[key].trim())) assert(observed.some(line => line.field === field), '布局与字体字段覆盖不一致')
      for (const node of usage.nodes) assert(observed.some(line => line.field === node.field && line.text === node.text), '字体节点不在实际布局中')
    }
  }
  return true
}
/** Fresh browser probes are also used by the verifier, never supplied by a report. */
async function probeTargetFonts(context, side) {
  const fs = require('node:fs/promises'), path = require('node:path')
  const { createRequire } = require('node:module'), { randomUUID } = require('node:crypto')
  const load = createRequire(path.join(context.entryRoot, 'package.json'))
  const { createMediaServer } = load('./mediaServer.js')
  const directory = path.join(context.evidenceRoot, 'font-probes', randomUUID())
  await fs.mkdir(path.join(directory, 'inputs'), { recursive: true })
  const manifest = JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'manifest.json'), 'utf8'))
  const resources = JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'fonts/manifest.json'), 'utf8')).fonts
  const server = await createMediaServer({ resourceRoot: context.resourceRoot, jobDirectory: directory, inputs: [], proxyPort: 0 })
  const fontUrls = Object.fromEntries(resources.filter(item => item.role === 'font')
    .map(item => [item.family, `${server.baseUrl}fonts/${encodeURIComponent(item.path)}`]))
  const request = { resources, fontUrls, side, fontHash: manifest.fontHash, url: `${server.baseUrl}fonts/manifest.json` }
  try {
    if (side === 'renderer') {
      const renderer = load('@remotion/renderer')
      const browser = await renderer.openBrowser('chrome', { browserExecutable: path.join(context.resourceRoot, manifest.browserExecutable), logLevel: 'error' })
      try {
        const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => {} })
        const send = (...args) => page._client().send(...args).then(result => result.value)
        await navigateProbe(send, request.url)
        return await collectFontReference(send, resources, fontUrls, side, manifest.fontHash)
      } finally { await browser.close({ silent: true }) }
    }
    if (context.targetRoot) {
      const desktop = require('./effects-desktop-acceptance')
      const session = context.playerSession || await desktop.startSession(context)
      try { return await probeSessionFontReference(session, request) }
      finally { if (!context.playerSession) await session.close() }
    }
    const input = path.join(directory, 'request.json'), output = path.join(directory, 'reference.json')
    await fs.writeFile(input, JSON.stringify(request), { flag: 'wx' })
    const evidence = require('./effects-release-evidence')
    const env = { ...evidence.cleanEnvironment() }; delete env.ELECTRON_RUN_AS_NODE
    const result = await evidence.runProgram(context.electron, [__filename, '--probe-worker', input, output], { cwd: context.evidenceRoot, timeoutMs: 30000, env })
    if (result.exit_code !== 0) {
      const detail = await fs.readFile(`${output}.error.json`, 'utf8').catch(() => result.stderr || result.stdout)
      throw Error(`Electron字体探针失败: ${detail}`)
    }
    return JSON.parse(await fs.readFile(output, 'utf8'))
  } finally { await server.close() }
}

async function probeSessionFontReference(session, request) {
  const { connectCdp } = require('../smoke-test')
  const { until } = require('./effects-desktop-acceptance')
  const info = await (await fetch(`http://127.0.0.1:${session.debugPort}/json/version`)).json()
  const browser = await connectCdp(info.webSocketDebuggerUrl)
  const before = await (await fetch(`http://127.0.0.1:${session.debugPort}/json/list`)).json()
  let targetId, secondary
  try {
    try { targetId = (await browser.send('Target.createTarget', { url: session.frontend })).targetId }
    catch { await session.cdp.evaluate(`window.open(${JSON.stringify(session.frontend)},'effects-font-probe');true`) }
    const target = await until('独立Electron字体探针页', async () => {
      const pages = await (await fetch(`http://127.0.0.1:${session.debugPort}/json/list`)).json()
      return pages.find(page => page.type === 'page' && (targetId ? page.id === targetId : !before.some(old => old.id === page.id)))
    })
    targetId = target.id; secondary = await connectCdp(target.webSocketDebuggerUrl)
    await navigateProbe(secondary.send, request.url)
    return await collectFontReference(secondary.send, request.resources, request.fontUrls, request.side, request.fontHash)
  } finally {
    if (targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    secondary?.close(); browser.close()
  }
}

if (process.type === 'browser' && process.argv[2] === '--probe-worker') {
  const { app, BrowserWindow } = require('electron')
  const path = require('node:path')
  app.setPath('userData', path.join(path.dirname(process.argv[3]), 'electron-profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const fs = require('node:fs/promises')
    const request = JSON.parse(await fs.readFile(process.argv[3], 'utf8'))
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    try {
      await window.loadURL(request.url)
      window.webContents.debugger.attach('1.3')
      const send = window.webContents.debugger.sendCommand.bind(window.webContents.debugger)
      const reference = await collectFontReference(send, request.resources, request.fontUrls, request.side, request.fontHash)
      await fs.writeFile(process.argv[4], JSON.stringify(reference), { flag: 'wx' })
      window.destroy(); app.exit(0)
    } catch (error) {
      await fs.writeFile(`${process.argv[4]}.error.json`, JSON.stringify({ error: error.stack || String(error) }))
      window.destroy(); app.exit(1)
    }
  }).catch(error => { console.error(error); app.exit(1) })
}
module.exports = { fontKeys, collectFontUsage, collectFontReference, navigateProbe, validateFontUsage, evaluate, probeTargetFonts }
