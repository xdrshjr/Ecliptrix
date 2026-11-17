'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面验收沿用既有 CommonJS，并由包内 Electron Node 执行。 */

const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { connectCdp } = require('../smoke-test')
const evidence = require('./effects-release-evidence')
const visual = require('./effects-visual-acceptance')
const { installFaultInjection, processSnapshot, killPid, waitForOwnedExit } = require('../effects-smoke')

if (process.env.EFFECTS_ACCEPTANCE_FAULT_FILE) installFaultInjection()

class AcceptanceBlocked extends Error {}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function until(label, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await predicate(); if (result) return result; await pause(100) }
  throw new Error(`实际界面验收超时: ${label}`)
}
async function jsonRequest(url, method = 'GET', body) {
  const response = await fetch(url, { method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`本地验收 API ${method} ${new URL(url).pathname}: ${response.status}`)
  const result = await response.json()
  if (result.success === false) throw new Error(`本地验收 API 拒绝 ${new URL(url).pathname}`)
  return result.data ?? result
}
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function restoreRequestInterception(session) {
  await session.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
}
/** Launch an isolated real application; never touch the user's active profile. */
async function startSession(context, previousUserData) {
  if (process.platform !== 'win32') throw new AcceptanceBlocked('桌面安装矩阵需要 Windows')
  const userData = previousUserData || path.join(context.evidenceRoot, 'user-data', randomUUID())
  await fs.mkdir(userData, { recursive: true })
  const [frontendPort, backendPort, debugPort] = await Promise.all([freePort(), freePort(), freePort()])
  await fs.writeFile(path.join(userData, 'desktop-config.json'), JSON.stringify({ schemaVersion: 1, frontendPort, backendPort }))
  if (!previousUserData) await fs.writeFile(path.join(userData, '.env'), '')
  const temporary = path.join(userData, 'temp'); await fs.mkdir(temporary, { recursive: true })
  const faultFile = path.join(userData, 'acceptance-fault.json')
  if (!previousUserData) await fs.writeFile(faultFile, JSON.stringify({ mode: 'none', requests: [] }))
  const env = { ...evidence.cleanEnvironment(), TEMP: temporary, TMP: temporary,
    ECLIPTRIX_AUTH_GATE: 'off', EFFECTS_ACCEPTANCE_FAULT_FILE: faultFile,
    EFFECTS_ACCEPTANCE_TARGET_ROOT: context.targetRoot,
    NODE_OPTIONS: `--require=${JSON.stringify(__filename)}` }
  const child = spawn(context.electron, [`--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'],
  { cwd: context.targetRoot, env, windowsHide: true, stdio: 'ignore' })
  const startedAt = new Date().toISOString(); const requests = []; const responses = new Map()
  const compositions = []; const agentEvents = []; const interceptors = []
  const frontend = `http://127.0.0.1:${frontendPort}`
  const backend = `http://127.0.0.1:${backendPort}`
  let cdp
  try {
    const target = await until('Electron 页面', async () => {
      if (child.exitCode !== null) throw new Error('应用启动期间退出')
      try { const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1000) }); const targets = await response.json(); return targets.find(entry => entry.type === 'page' && entry.url.startsWith(frontend)) } catch { return false }
    }, 120000)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('ecliptrix-locale','en')" })
    cdp.on('Network.requestWillBeSent', message => {
      const url = new URL(message.request.url)
      requests.push({ request_id: message.requestId, method: message.request.method,
        path: ['data:', 'blob:'].includes(url.protocol) ? url.protocol : url.pathname,
        local: ['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol),
        ...(url.pathname === '/api/video-compose' && message.request.postData ? { composition: JSON.parse(message.request.postData) } : {}) })
    })
    cdp.on('Network.responseReceived', message => responses.set(message.requestId, { status: message.response.status }))
    cdp.on('Network.loadingFinished', message => {
      const request = requests.find(entry => entry.request_id === message.requestId)
      if (request?.path === '/api/video-editing-agent/chat') {
        void cdp.send('Network.getResponseBody', { requestId: message.requestId }).then(result => {
          const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body
          for (const match of body.matchAll(/^data:\s*(\{.*\})$/gm)) {
            const event = JSON.parse(match[1])
            const publicTool = /^(?:explore_tools|(?:list|get|create|update|render|cancel|prepare|apply)_effect|undo)/.test(event.toolName || '')
            if (event.type === 'effects_action' || publicTool && ['tool_call', 'tool_result'].includes(event.type)) agentEvents.push(event)
          }
        }).catch(() => {})
      }
      const submitted = requests.find(entry => entry.request_id === message.requestId && entry.composition)
      if (!submitted) return
      void cdp.send('Network.getResponseBody', { requestId: message.requestId }).then(result => {
        const response = JSON.parse(result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body)
        if (response.composition_id) compositions.push({ request: submitted.composition, response })
      }).catch(() => {})
    })
    cdp.on('Fetch.requestPaused', message => {
      const rule = interceptors.find(entry => entry.matches(message))
      if (rule) { void rule.handle(message).catch(() => {}); return }
      if (message.responseStatusCode !== undefined) return
      const url = new URL(message.request.url)
      const allowed = ['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)
      void cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: message.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }).catch(() => {})
    })
    await restoreRequestInterception({ cdp })
    await until('本地服务', async () => { try { await jsonRequest(`${backend}/api/health`); return true } catch { return false } }, 120000)
    await cdp.send('Page.reload', { ignoreCache: true })
    await until('首页', async () => {
      await cdp.evaluate(`(() => { const wizard=document.querySelector('[aria-labelledby="setup-wizard-title"]'); const b=wizard&&[...wizard.querySelectorAll('button')].find(e=>/^(Maybe later|稍后再说|Discard|放弃)$/i.test(e.textContent.trim())); b?.click(); })()`)
      return cdp.evaluate("!!document.querySelector('button') && !document.querySelector('[aria-labelledby=\"setup-wizard-title\"]')")
    })
    const session = { context, child, cdp, userData, frontend, backend, debugPort, requests, responses, compositions, agentEvents, faultFile,
      intercept(matches, handle) {
        const rule = { matches, handle }; interceptors.push(rule)
        return () => { const index = interceptors.indexOf(rule); if (index >= 0) interceptors.splice(index, 1) }
      },
      startedAt, processes: processSnapshot(child.pid),
      async close(force = false) {
        const owned = processSnapshot(child.pid)
        if (force) killPid(child.pid, false)
        else { try { await cdp.send('Browser.close') } catch { /* CDP closes with its browser. */ } }
        cdp.close()
        const result = await waitForOwnedExit(owned)
        if (result.residual_processes) for (const record of result.residual_records) killPid(record.pid)
        return { ...result, processes: owned }
      } }
    return session
  } catch (error) { cdp?.close(); if (child.pid) killPid(child.pid); throw error }
}

async function click(session, selector) {
  return until(`点击 ${selector}`, () => session.cdp.evaluate(`(() => {
    const e=document.querySelector(${JSON.stringify(selector)}); if(!e||e.disabled)return false;
    e.scrollIntoView({block:'center'});e.focus();e.click();return true;
  })()`))
}
async function clickText(session, pattern, root = 'body') {
  return until(`点击 ${pattern}`, () => session.cdp.evaluate(`(() => {
    const e=[...document.querySelectorAll(${JSON.stringify(root)}+' button')].find(e=>new RegExp(${JSON.stringify(pattern)},'i').test((e.getAttribute('aria-label')||e.title||e.textContent).trim()));
    if(!e||e.disabled)return false;e.focus();e.click();return true;
  })()`))
}
async function setValue(session, selector, value) {
  await session.cdp.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)});
    if(!e)throw Error('Input missing');const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true})); })()`)
}
async function key(session, keyValue, modifiers = 0) {
  await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyValue, modifiers,
    windowsVirtualKeyCode: keyValue.length === 1 ? keyValue.toUpperCase().charCodeAt(0)
      : ({ Escape: 27, Delete: 46, Control: 17, Enter: 13, Tab: 9 })[keyValue] || 0 })
  await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyValue, modifiers })
}
async function rightClick(session, selector) {
  const point = await session.cdp.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Target missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'right', buttons: 2, clickCount: 1, ...point })
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'right', buttons: 0, clickCount: 1, ...point })
}
async function openProject(session, name) {
  if (await session.cdp.evaluate("!!document.querySelector('.editor-workbench')")) {
    await click(session, '.ws-topbar > button:first-of-type')
  }
  await session.cdp.send('Page.reload', { ignoreCache: true })
  await clickText(session, `^${name}$`)
  await until('剪辑工作区', () => session.cdp.evaluate("!!document.querySelector('.editor-workbench')"))
}
async function openEffects(session) {
  await clickText(session, '^Effects$|^特效$')
  await until('特效预览', () => session.cdp.evaluate("!!document.querySelector('.effects-inspector textarea')"))
}
async function closeEffects(session) {
  await click(session, '[data-effects-studio] header button[aria-label="Close"]')
  if (await session.cdp.evaluate("!!document.querySelector('[role=alertdialog]')")) await clickText(session, '^Save and close$|保存并关闭', '[role=alertdialog]')
  await until('特效关闭', () => session.cdp.evaluate("!document.querySelector('[data-effects-studio]')"))
}
function toWire(document) {
  return { schema_version: 1, template_id: document.templateId,
    template_version: document.templateVersion, canvas: document.canvas,
    duration_frames: document.durationFrames, seed: document.seed,
    content: document.content, palette: document.palette, typography: document.typography,
    motion: document.motion, params: document.params, inputs: document.inputs.map(input => ({
      slot: input.slot, asset_id: input.assetId, kind: input.kind, fit: input.fit,
      focal_x: input.focalX, focal_y: input.focalY,
      ...(input.index === undefined ? {} : { index: input.index }),
      ...(input.trimStartSeconds === undefined ? {} : { trim_start_seconds: input.trimStartSeconds }) })) }
}
async function seedProject(session, fixtures) {
  for (const [kind, source, filename] of [['video', fixtures.video, 'effects-frame.mp4'], ['image', fixtures.image, 'effects-checker.png']]) {
    const directory = path.join(session.userData, 'storage', kind)
    await fs.mkdir(directory, { recursive: true }); await fs.copyFile(source, path.join(directory, filename))
  }
  const materials = ['video', 'image'].map(kind => ({ id: `effects-${kind}`, type: kind,
    name: `Effects ${kind}`, source: 'upload', duration: kind === 'video' ? 6 : undefined,
    width: kind === 'video' ? 640 : 256, height: kind === 'video' ? 360 : 256,
    url: `/api/storage/files/${kind}/effects-${kind === 'video' ? 'frame.mp4' : 'checker.png'}`,
    serverUrl: `/api/storage/files/${kind}/effects-${kind === 'video' ? 'frame.mp4' : 'checker.png'}` }))
  const tracks = [{ id: 'effects-source-track', name: 'Frame fixture', type: 'video', height: 64,
    order: 0, isLocked: false, isVisible: true, isMuted: false, volume: 100,
    items: [{ id: 'effects-source-clip', materialId: 'effects-video', trackId: 'effects-source-track',
      name: 'Trim 2s', type: 'video', startTime: 0, duration: 3.37, clipStart: 2,
      clipEnd: 5.37, originalDuration: 6, color: '#4285f4', volume: 50,
      transitionOut: { type: 'fade', duration: 0.1 },
      cameraMotion: { version: 1, mode: '2d', presetId: 'custom', intensity: 1,
        easing: 'linear', start: { scale: 1, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
        end: { scale: 1.08, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 } } },
    { id: 'effects-other-clip', materialId: 'effects-video', trackId: 'effects-source-track',
      name: 'Other edit', type: 'video', startTime: 3.37, duration: 2, clipStart: 0,
      clipEnd: 2, originalDuration: 6, color: '#4285f4', volume: 100 }] }]
  const name = `Effects-${randomUUID()}`
  const project = await jsonRequest(`${session.backend}/api/video-projects`, 'POST', {
    name, project_data: { markdownContent: '', materials,
      canvasSettings: { aspectRatioId: '16:9', fit: 'contain' },
      uiState: { currentTimelineState: { tracks, currentTime: 0, totalDuration: 5.37,
        zoomLevel: 1, playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0 } } } })
  await openProject(session, name)
  return { projectId: project.id, name, materials }
}

/** Capture only the actual Player composition, after seek/font/media settling. */
async function capturePlayer(session, project, document, inputs, jobDirectory, frame, target) {
  const documentCopy = structuredClone(document)
  for (const input of inputs) {
    const binding = documentCopy.inputs.find(entry => entry.assetId === input.assetId)
    const kind = binding.kind; const directory = path.join(session.userData, 'storage', kind)
    await fs.mkdir(directory, { recursive: true })
    await fs.copyFile(path.join(jobDirectory, 'inputs', input.fileName), path.join(directory, input.fileName))
    const attached = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/inputs`, 'POST', { source_ref: `/api/storage/files/${kind}/${input.fileName}` })
    for (const entry of documentCopy.inputs) if (entry.assetId === input.assetId) entry.assetId = attached.asset.asset_id
  }
  const draftId = randomUUID()
  await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/drafts`, 'POST', {
    draft_id: draftId, name: `Matrix ${draftId}`, document: toWire(documentCopy) })
  if (await session.cdp.evaluate("!!document.querySelector('[data-effects-studio]')")) await closeEffects(session)
  await openEffects(session)
  await setValue(session, '[data-effects-studio] select[aria-label="Saved drafts"]', draftId)
  await until('矩阵草稿加载', () => session.cdp.evaluate(`document.querySelector('[data-effects-studio] select[aria-label="Saved drafts"]')?.value===${JSON.stringify(draftId)}`))
  await setValue(session, '.effects-preview input[type=range]', frame)
  const actualFrame = await until('Player 实例定位到指定帧', async () => {
    const displayed = await session.cdp.evaluate("document.querySelector('.effects-preview output')?.textContent.trim()")
    const parts = String(displayed || '').split(':').map(Number)
    const current = parts.length === 3 ? parts[0] * 1800 + parts[1] * 30 + parts[2] : -1
    return current === frame && { frame: current }
  })
  await session.cdp.evaluate(`(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.effects-preview img')].map(image=>image.decode()));await Promise.all([...document.querySelectorAll('.effects-preview video')].map(video=>video.seeking?new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true})):Promise.resolve()));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()`)
  const layout = await session.cdp.evaluate(`(${visual.collectTextLayout.toString()})('.effects-preview .__remotion-player',${actualFrame.frame})`)
  const screenshot = await session.cdp.send('Page.captureScreenshot', { format: 'png',
    clip: { ...layout.boundary, scale: 1 }, captureBeyondViewport: true })
  await fs.writeFile(target, Buffer.from(screenshot.data, 'base64'), { flag: 'wx' })
  return { layout }
}
function markCase(cases, caseId, input) {
  cases.push({ case_id: caseId, input_sha256: evidence.hash(JSON.stringify(input)), status: 'pass' })
}
async function readTimeline(session, projectId) {
  const record = await jsonRequest(`${session.backend}/api/video-projects/${projectId}`)
  return record.project_data.uiState.currentTimelineState.tracks
}
async function generate(session, projectId, cancel = false) {
  await clickText(session, '^Generate video$|生成视频', '[data-effects-studio]')
  const job = await until('生成任务', async () => {
    const page = await jsonRequest(`${session.frontend}/api/effects/projects/${projectId}/jobs`)
    return page.items.find(entry => cancel ? ['queued', 'running'].includes(entry.status) : entry.status === 'succeeded')
  }, 180000)
  if (cancel) {
    await clickText(session, '^Cancel generation$|取消生成', '[data-effects-studio]')
    await until('已取消', async () => (await jsonRequest(`${session.frontend}/api/effects/projects/${projectId}/jobs/${job.job_id}`)).status === 'cancelled')
  }
  return job
}

/** Export through the editor's actual preflight/button and composition API. */
async function exportProject(session, context, suffix) {
  const previous = session.compositions.length
  await clickText(session, '^Export( video)?$|^导出(视频)?$')
  await click(session, '.ws-preflight [data-autofocus]')
  const completed = await until('实际导出请求', () => session.compositions[previous], 90000)
  const captured = completed.request
  const status = await until('实际导出完成', async () => {
    const response = await jsonRequest(`${session.frontend}/api/video-compose/${completed.response.composition_id}/status?task_id=${encodeURIComponent(captured.task_id)}`)
    if (['failed', 'error'].includes(response.status)) throw new Error('编辑器真实导出失败')
    return response.status === 'completed' && response
  }, 180000)
  if (status.degradations?.length) throw new Error('导出存在 degradations')
  const video = path.join(context.evidenceRoot, `desktop/export-${suffix}.mp4`)
  const response = await fetch(`${session.frontend}/api/video-compose/${completed.response.composition_id}/download?task_id=${encodeURIComponent(captured.task_id)}`)
  if (!response.ok) throw new Error('导出成品下载失败')
  await fs.writeFile(video, Buffer.from(await response.arrayBuffer()), { flag: 'wx' })
  const probe = JSON.parse(await visual.execute(context, context.ffprobe,
    ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', video]))
  return { request: captured, status, video, probe }
}

/** Fixed desktop route. Every passed case corresponds to an observed UI result. */
async function runDesktop(context) {
  if (!context.installedRoot) throw new AcceptanceBlocked('桌面完整验收需要本次实际 installed 目录')
  const session = await startSession(context)
  const cases = []; const attachments = []; let measurements
  try {
    const fixtures = await visual.createFixtures(context)
    const project = await seedProject(session, fixtures)
    await fs.mkdir(path.join(context.evidenceRoot, 'desktop'), { recursive: true })
    await openEffects(session); markCase(cases, 'entry-main', project)
    await setValue(session, '.effects-inspector textarea', '中文标题 · Effects')
    const job = await generate(session, project.projectId)
    await clickText(session, '^Save to library$|保存到素材库', '[data-effects-studio]')
    await clickText(session, '^Insert on a new video track$|插入新视频轨道', '[data-effects-studio]')
    await closeEffects(session)
    const committed = await until('时间线自动保存', async () => {
      const tracks = await readTimeline(session, project.projectId)
      return tracks.some(track => track.items.some(item => item.metadata?.effects)) && tracks
    })
    await key(session, 'z', 2); await until('撤销', async () => !(await readTimeline(session, project.projectId)).some(track => track.items.some(item => item.metadata?.effects)))
    markCase(cases, 'undo', committed)
    await key(session, 'z', 10); await until('重做', async () => (await readTimeline(session, project.projectId)).some(track => track.items.some(item => item.metadata?.effects)))
    markCase(cases, 'redo', committed)
    await openEffects(session); await generate(session, project.projectId, true)
    markCase(cases, 'cancel', job); await closeEffects(session)
    const closed = await session.close()
    if (closed.residual_processes) throw new Error('正常关闭存在所属进程残留')
    const reopened = await startSession(context, session.userData)
    try {
      await openProject(reopened, project.name)
      const restored = await readTimeline(reopened, project.projectId)
      if (JSON.stringify(restored) !== JSON.stringify(committed)) throw new Error('重启后时间线不一致')
      markCase(cases, 'save-reopen', restored)
      await rightClick(reopened, '[data-material-id="effects-video"]'); await clickText(reopened, 'Create effect|Make effect|制作特效')
      await until('素材入口', () => reopened.cdp.evaluate("!!document.querySelector('[data-effects-studio]')")); markCase(cases, 'entry-material', project); await closeEffects(reopened)
      await click(reopened, '[data-clip-id="effects-source-clip"]'); await click(reopened, '.timeline-toolbar button[aria-label^="Effects"]')
      await until('toolbar入口', () => reopened.cdp.evaluate("!!document.querySelector('[data-effects-studio]')")); markCase(cases, 'entry-toolbar', project); await closeEffects(reopened)
      await rightClick(reopened, '[data-clip-id="effects-source-clip"]'); await clickText(reopened, 'Create effect|Make effect|制作特效')
      await until('clip入口', () => reopened.cdp.evaluate("!!document.querySelector('[data-effects-studio]')")); markCase(cases, 'entry-clip', project)
      await closeEffects(reopened)
      await exerciseBackgroundReplacement(reopened, project, cases)
      const exported = await exportProject(reopened, context, 'final')
      const audio = await visual.measureDesktopExport(context, exported, fixtures)
      measurements = audio.measurements
      markCase(cases, 'final-export', exported.request)
      attachments.push(await evidence.writeAttachment(context, 'save_reopen', 'desktop/save-reopen.json', evidence.bindRecord(context.report, { case_id: 'save-reopen', input_sha256: evidence.hash(JSON.stringify(committed)), committed, restored })))
      attachments.push(await evidence.writeAttachment(context, 'export_request', 'desktop/export-request.json', evidence.bindRecord(context.report, { case_id: 'final-export', input_sha256: evidence.hash(JSON.stringify(exported.request)), request: exported.request, degradations: exported.status.degradations || [] })))
      attachments.push(await evidence.writeAttachment(context, 'video', 'desktop/export-final.mp4'))
      attachments.push(await evidence.writeAttachment(context, 'media_probe', 'desktop/probe.json', evidence.bindRecord(context.report, { case_id: 'final-export', input_sha256: evidence.hash(JSON.stringify(exported.request)), probe: exported.probe })))
      for (const filename of ['final.wav', 'source.wav']) attachments.push(await evidence.writeAttachment(context, 'audio_wave', `desktop/${filename}`))
      attachments.push(await evidence.writeAttachment(context, 'audio_metrics', 'desktop/audio.json', evidence.bindRecord(context.report,
        { case_id: 'final-export', input_sha256: evidence.hash(JSON.stringify(exported.request)), ...audio })))
      // Boundary cases have independent fixtures and cannot be inferred from a
      // successful happy path; missing observations remain a hard failure.
      await verifyDesktopBoundaries(reopened, context, project, cases, attachments)
      const keyboard = await visual.runCloseKeyboardCase(reopened)
      cases.push({ case_id: 'close-keyboard', status: 'pass', input_sha256: evidence.hash(project.projectId), proof: keyboard })
      const font = await visual.runFontRetryCase(reopened, project)
      cases.push({ case_id: 'font-retry', status: 'pass', input_sha256: evidence.hash(project.projectId), proof: font })
      const lease = await runEditorLeaseCase(reopened, project)
      cases.push({ case_id: 'editor-lease', status: 'pass', input_sha256: evidence.hash(project.projectId), proof: lease })
      await exerciseUnavailableExports(reopened, context, project, cases, attachments)
      attachments.push(await evidence.writeAttachment(context, 'network_log', 'desktop/network.json', evidence.bindRecord(context.report, { case_id: 'network', input_sha256: fixtures.videoHash.sha256, requests: reopened.requests })))
    } finally { await reopened.close() }
    attachments.push(await evidence.writeAttachment(context, 'action_trace', 'desktop/actions.json', evidence.bindRecord(context.report, { cases, input_sha256: fixtures.videoHash.sha256 })))
    return { status: 'pass', acceptance_ids: evidence.acIds('desktop'),
      measurements, attachments }
  } finally { if (session.child.exitCode === null) await session.close() }
}

async function dragClip(session, selector, distance) {
  const point = await session.cdp.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, button: 'left', clickCount: 1, ...point })
  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1, ...point, x: point.x + distance * fraction })
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, button: 'left', clickCount: 1, ...point, x: point.x + distance })
}
async function exerciseBackgroundReplacement(session, project, cases) {
  // Remove the introductory inserted title through the real timeline delete so
  // the calibrated frame-number source remains visible for the export probe.
  const current = await readTimeline(session, project.projectId)
  const inserted = current.flatMap(track => track.items).find(item => item.metadata?.effects)
  if (!inserted) throw new Error('缺少先前插入并重开的真实特效片段')
  await click(session, `[data-clip-id="${inserted.id}"]`)
  await key(session, 'Delete')
  const before = await until('插入已撤销', async () => {
    const tracks = await readTimeline(session, project.projectId)
    return !tracks.some(track => track.items.some(item => item.metadata?.effects)) && tracks
  })
  const oldJobs = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)
  const known = new Set(oldJobs.items.map(job => job.job_id))
  await rightClick(session, '[data-clip-id="effects-source-clip"]')
  await clickText(session, 'Create effect|Make effect|制作特效')
  await until('原片特效工作台', () => session.cdp.evaluate("!!document.querySelector('.effects-inspector textarea')"))
  await setValue(session, '.effects-inspector textarea', 'Trim 2s / 3.37s')
  await clickText(session, '^Generate video$|生成视频', '[data-effects-studio]')
  await closeEffects(session)
  await dragClip(session, '[data-clip-id="effects-other-clip"]', 40)
  const edited = await until('另一片段编辑已保存', async () => {
    const tracks = await readTimeline(session, project.projectId)
    const previous = before.flatMap(track => track.items).find(item => item.id === 'effects-other-clip')
    const current = tracks.flatMap(track => track.items).find(item => item.id === previous.id)
    return current.startTime !== previous.startTime && current
  })
  const rendered = await until('源片生成完成', async () => {
    const page = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)
    return page.items.find(job => !known.has(job.job_id) && job.status === 'succeeded')
  }, 180000)
  await rightClick(session, '[data-clip-id="effects-source-clip"]')
  await clickText(session, 'Create effect|Make effect|制作特效')
  await until('替换模式', () => session.cdp.evaluate("!!document.querySelector('[data-effects-studio] option[value=replace]')"))
  await session.cdp.evaluate("document.querySelector('[data-effects-studio] details')?.setAttribute('open','')")
  await clickText(session, '^Replace this clip$|替换此片段', '[data-effects-studio] article')
  await closeEffects(session)
  const replacement = await until('源片替换持久化', async () => {
    const tracks = await readTimeline(session, project.projectId)
    const clip = tracks.flatMap(track => track.items).find(item => item.id === 'effects-source-clip')
    return clip.metadata?.effects?.jobId === rendered.job_id && { tracks, clip }
  })
  const other = replacement.tracks.flatMap(track => track.items).find(item => item.id === 'effects-other-clip')
  if (JSON.stringify(other) !== JSON.stringify(edited)
    || replacement.clip.duration !== 3.37 || replacement.clip.clipStart !== 0
    || replacement.clip.volume !== 50 || !replacement.clip.cameraMotion
    || replacement.clip.transitionOut?.duration !== 0.1) throw new Error('后台替换覆盖其它编辑或重复/丢失外层属性')
  markCase(cases, 'replace-preserves-edits', { rendered: rendered.job_id, edited, clip: replacement.clip })
}
async function exerciseUnavailableExports(session, context, project, cases, attachments) {
  const ready = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)
  const produced = ready.items.find(job => job.status === 'succeeded' && job.output_asset)
  if (!produced) throw new Error('缺少待软删除的真实已生成草稿')
  const draft = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/drafts/${produced.draft_id}`)
  await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/drafts/${produced.draft_id}`, 'DELETE', { expected_version: draft.version })
  const deletedExport = await exportProject(session, context, 'deleted-draft')
  attachments.push(await evidence.writeAttachment(context, 'video', 'desktop/export-deleted-draft.mp4'))
  markCase(cases, 'deleted-draft-export', { draft: produced.draft_id })
  const controller = processSnapshot(session.child.pid).find(entry => entry.role === 'controller')
  if (!controller) throw new Error('缺少可停止的本次 controller')
  killPid(controller.pid)
  await until('渲染器降级', async () => !(await jsonRequest(`${session.frontend}/api/effects/capabilities`)).ready)
  const unavailableExport = await exportProject(session, context, 'runtime-unavailable')
  attachments.push(await evidence.writeAttachment(context, 'video', 'desktop/export-runtime-unavailable.mp4'))
  attachments.push(await evidence.writeAttachment(context, 'media_probe', 'desktop/unavailable-probes.json', evidence.bindRecord(context.report,
    { case_id: 'runtime-unavailable-export', input_sha256: evidence.hash(JSON.stringify(unavailableExport.request)),
      unavailable: unavailableExport.probe, deleted_draft: deletedExport.probe })))
  markCase(cases, 'runtime-unavailable-export', { pid: controller.pid })
}

async function verifyDesktopBoundaries(session, context, project, cases, attachments) {
  const original = await jsonRequest(`${session.backend}/api/video-projects/${project.projectId}`)
  const casesToExercise = ['locked-track', 'multi-select', 'cover', 'detached-audio']
  for (const name of casesToExercise) {
    const changed = structuredClone(original.project_data)
    const track = changed.uiState.currentTimelineState.tracks[0]
    if (name === 'locked-track') track.isLocked = true
    if (name === 'detached-audio') {
      track.items[0].audioDetached = true
      const raw = changed.materials.find(material => material.id === 'effects-video')
      const audio = { ...raw, id: 'effects-detached-audio', type: 'audio' }
      changed.materials.push(audio)
      changed.uiState.currentTimelineState.tracks.push({ id: 'effects-audio-track', name: 'Detached original',
        type: 'audio', height: 64, order: 1, isLocked: false, isVisible: true, isMuted: false, volume: 100,
        items: [{ id: 'effects-audio-clip', materialId: audio.id, trackId: 'effects-audio-track',
          name: 'Original audio', type: 'audio', startTime: 0, duration: 3.37,
          clipStart: 2, clipEnd: 5.37, originalDuration: 6, volume: 50 }] })
    }
    await jsonRequest(`${session.backend}/api/video-projects/${project.projectId}`, 'PUT', { project_data: changed })
    await openProject(session, project.name)
    if (name === 'cover') {
      await click(session, '.ws-canvas-trigger'); await click(session, '[data-cover-entry]')
      await until('封面面板', () => session.cdp.evaluate("!!document.querySelector('.cover-inspector textarea')"))
      await setValue(session, '.cover-inspector textarea', 'Cover boundary')
      await click(session, '.cover-apply')
      await until('封面片段', () => session.cdp.evaluate("!!document.querySelector('[data-clip-id^=\"cover-clip:\"]')"))
      if (await session.cdp.evaluate("!!document.querySelector('.cover-studio')")) await click(session, '.cover-header > button')
      await click(session, '[data-clip-id^="cover-clip:"]')
    } else await click(session, '[data-clip-id="effects-source-clip"]')
    if (name === 'multi-select') {
      await key(session, 'Control')
      await session.cdp.evaluate("document.querySelector('[data-clip-id=\"effects-other-clip\"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))")
    }
    if (name === 'locked-track') {
      const disabled = await session.cdp.evaluate("[...document.querySelectorAll('button')].some(e=>/Effects/.test(e.title||e.getAttribute('aria-label')||'')&&e.disabled)")
      if (!disabled) throw new Error('锁轨特效入口未禁用')
    } else if (name === 'cover' || name === 'multi-select') {
      await click(session, '.timeline-toolbar button[aria-label^="Effects"]')
      if (await session.cdp.evaluate("!!document.querySelector('[data-effects-studio] .effects-inspector textarea') && !!document.querySelector('[data-effects-studio] option[value=replace]')")) throw new Error(`${name} 不应授权原位替换`)
      if (await session.cdp.evaluate("!!document.querySelector('[data-effects-studio]')")) await closeEffects(session)
    } else {
      await openEffects(session)
      await generate(session, project.projectId)
      await closeEffects(session)
      const detached = await exportProject(session, context, 'detached')
      if (detached.request.audio_items?.length !== 1 || !detached.request.video_items?.find(item => item.id === 'effects-source-clip')?.audio_detached) throw new Error('分离音轨没有保持单条原音')
      const measured = await visual.measureDesktopExport(context, detached,
        { video: path.join(session.userData, 'storage/video/effects-frame.mp4') })
      if (measured.measurements.max_av_error_seconds > 1 / 30 || measured.measurements.gain_ratio_error > 0.05) throw new Error('分离音轨时序或增益不符')
      attachments.push(await evidence.writeAttachment(context, 'video', 'desktop/export-detached.mp4'))
    }
    markCase(cases, name, changed)
  }
  await jsonRequest(`${session.backend}/api/video-projects/${project.projectId}`, 'PUT', { project_data: original.project_data })
  await openProject(session, project.name)
  await exerciseLostReplies(session, project, cases)
  const other = await jsonRequest(`${session.backend}/api/video-projects`, 'POST', { name: `Other-${randomUUID()}`, project_data: original.project_data })
  await openEffects(session); await closeEffects(session); await openProject(session, other.name)
  if (await session.cdp.evaluate("!!document.querySelector('[data-effects-studio]')")) throw new Error('跨项目残留旧工作台')
  markCase(cases, 'project-switch', { a: project.projectId, b: other.id })
  await openProject(session, project.name)
}
async function exerciseLostReplies(session, project, cases) {
  await openEffects(session)
  for (const kind of ['save', 'submit']) {
    let intercepted = false; let active = true
    const suffix = kind === 'save' ? '/drafts' : '/jobs'
    session.cdp.on('Fetch.requestPaused', message => {
      if (!active || message.responseStatusCode === undefined) return
      if (!intercepted && ['POST', 'PUT'].includes(message.request.method)
        && new URL(message.request.url).pathname.includes(suffix)) {
        intercepted = true
        void session.cdp.send('Fetch.failRequest', { requestId: message.requestId, errorReason: 'Failed' }).catch(() => {})
      } else void session.cdp.send('Fetch.continueRequest', { requestId: message.requestId }).catch(() => {})
    })
    try {
      await session.cdp.send('Fetch.enable', { patterns: [{ urlPattern: `*api/effects/*${suffix}*`, requestStage: 'Response' }] })
      if (kind === 'save') await setValue(session, '.effects-inspector textarea', `Lost response ${randomUUID()}`)
      else await clickText(session, '^Generate video$|生成视频', '[data-effects-studio]')
      await until('回包丢失已注入', () => intercepted)
    } finally {
      active = false
      await session.cdp.send('Fetch.disable')
      await restoreRequestInterception(session)
    }
    const before = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/${suffix.slice(1)}`)
    await openProject(session, project.name); await openEffects(session)
    await until('同键恢复', async () => {
      const after = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/${suffix.slice(1)}`)
      return JSON.stringify((after.items || after).map(entry => entry.job_id || entry.draft_id).sort()) === JSON.stringify((before.items || before).map(entry => entry.job_id || entry.draft_id).sort())
    })
    markCase(cases, `lost-${kind}`, before)
  }
  await closeEffects(session)
}

/** Two real same-origin Electron pages must share a single editor lease. */
async function runEditorLeaseCase(session, project) {
  await openEffects(session)
  const lockName = `ecliptrix-effects-editor:${project.projectId}`
  const held = () => session.cdp.evaluate(`navigator.locks.query().then(q=>q.held.filter(l=>l.name===${JSON.stringify(lockName)}).length)`)
  await until('主页面编辑租约', async () => await held() === 1)
  const browserInfo = await (await fetch(`http://127.0.0.1:${session.debugPort}/json/version`)).json()
  const browser = await connectCdp(browserInfo.webSocketDebuggerUrl)
  const before = await (await fetch(`http://127.0.0.1:${session.debugPort}/json/list`)).json()
  let targetId; let secondary
  try {
    try { targetId = (await browser.send('Target.createTarget', { url: session.frontend })).targetId }
    catch {
      // Electron's browser delegate can reject createTarget; its existing
      // loopback window.open handler creates a real child BrowserWindow.
      await session.cdp.evaluate(`window.open(${JSON.stringify(session.frontend)},${JSON.stringify(`effects-lease-${randomUUID()}`)});true`)
    }
    const target = await until('第二Electron页面', async () => {
      const pages = await (await fetch(`http://127.0.0.1:${session.debugPort}/json/list`)).json()
      return pages.find(page => page.type === 'page' && page.url.startsWith(session.frontend)
        && (targetId ? page.id === targetId : !before.some(previous => previous.id === page.id)))
    })
    targetId = target.id; secondary = await connectCdp(target.webSocketDebuggerUrl)
    await secondary.send('Runtime.enable'); await secondary.send('Network.enable')
    await until('第二页面初始化', async () => {
      await secondary.evaluate(`(() => {const w=document.querySelector('[aria-labelledby="setup-wizard-title"]');[...w?.querySelectorAll('button')||[]].find(e=>/^(Maybe later|稍后再说|Discard|放弃)$/i.test(e.textContent.trim()))?.click()})()`)
      return secondary.evaluate("!!document.querySelector('button')&&!document.querySelector('[aria-labelledby=\"setup-wizard-title\"]')")
    })
    const writes = []
    secondary.on('Network.requestWillBeSent', event => {
      if (['POST', 'PUT'].includes(event.request.method) && /\/api\/effects\/.*\/drafts/.test(new URL(event.request.url).pathname)) writes.push(event.request.method)
    })
    const peer = { ...session, cdp: secondary }
    await openProject(peer, project.name); await openEffects(peer)
    await until('第二页面只读提示', () => secondary.evaluate("/another window|另一窗口/.test(document.querySelector('[data-effects-studio]')?.textContent||'')"))
    const blocked = await secondary.evaluate("[...document.querySelectorAll('[data-effects-studio] fieldset')].some(e=>e.disabled)")
    if (!blocked) throw new Error('第二页面仍允许编辑输入')
    const blockedCount = writes.length
    await setValue(peer, '.effects-inspector textarea', 'Blocked peer input')
    await pause(650)
    if (writes.length !== blockedCount || await held() !== 1) throw new Error('未取得租约的页面发送保存或产生第二租约')
    await closeEffects(session); await closeEffects(peer); await openEffects(peer)
    await until('第二页面接管租约', () => secondary.evaluate(`navigator.locks.query().then(q=>q.held.filter(l=>l.name===${JSON.stringify(lockName)}).length===1&&!document.querySelector('[data-effects-studio] fieldset')?.disabled)`))
    await setValue(peer, '.effects-inspector textarea', `Lease acquired ${randomUUID()}`)
    await until('接管后正常保存', () => writes.length > blockedCount)
    await closeEffects(peer)
    return { page_count: 2, held_before: 1, blocked_write_count: writes.slice(0, blockedCount).length,
      denied_writes: 0, reacquired: true, accepted_writes: writes.length - blockedCount }
  } finally {
    secondary?.close()
    if (targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    browser.close()
  }
}

/** Observe process ownership by PID/creation time for each independent fault. */
async function runProcess(context) {
  if (!context.installedRoot) throw new AcceptanceBlocked('进程矩阵需要本次实际 installed 目录')
  const cases = []
  for (const mode of evidence.CASES.process) {
    const session = await startSession(context)
    try {
      const owned = processSnapshot(session.child.pid)
      const selected = owned.find(entry => entry.role === (mode === 'kill-controller' ? 'controller' : 'backend'))
      if (mode === 'close') await session.cdp.send('Browser.close').catch(() => {})
      else if (mode === 'kill-main') killPid(session.child.pid, false)
      else {
        if (!selected) throw new Error(`缺少被测 ${mode} 进程`)
        killPid(selected.pid)
        if (mode === 'restart-backend') await until('后端恢复', async () => {
          try { await jsonRequest(`${session.backend}/api/health`); return !processSnapshot(session.child.pid).some(entry => entry.pid === selected.pid) } catch { return false }
        }, 120000)
        await session.cdp.send('Browser.close').catch(() => {})
      }
      const result = await waitForOwnedExit(owned)
      if (result.residual_processes) throw new Error(`${mode} 存在进程残留`)
      cases.push({ case_id: mode, status: 'pass', input_sha256: evidence.hash(mode), processes: owned, ...result })
    } finally { session.cdp.close(); if (session.child.exitCode === null) await session.close(true) }
  }
  const attachment = await evidence.writeAttachment(context, 'process_trace', 'process/trace.json', evidence.bindRecord(context.report, { cases, input_sha256: evidence.hash(JSON.stringify(cases)) }))
  return { status: 'pass', acceptance_ids: evidence.acIds('process'),
    measurements: { residual_processes: 0, max_exit_ms: Math.max(...cases.map(entry => entry.exit_ms)) }, attachments: [attachment] }
}

async function runPerformance(context) {
  if (!context.installedRoot) throw new AcceptanceBlocked('性能矩阵需要本次实际 installed 目录')
  const samples = []; const cases = []; let userData
  for (const temperature of ['cold', 'warm']) {
    const started = Date.now(); const session = await startSession(context, userData)
    userData = session.userData
    try {
      const fixtures = await visual.createFixtures({ ...context, evidenceRoot: path.join(context.evidenceRoot, temperature) })
      const project = await seedProject(session, fixtures)
      const openStarted = Date.now(); await openEffects(session)
      const interaction = Date.now() - openStarted
      const inputStarted = Date.now(); await setValue(session, '.effects-inspector textarea', 'Latency input')
      await until('预览文字响应', () => session.cdp.evaluate("document.querySelector('.effects-preview .__remotion-player')?.textContent.includes('Latency input')"))
      const inputResponse = Date.now() - inputStarted
      const previewLoad = await session.cdp.evaluate(`(async()=>{const names=${JSON.stringify(JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'catalog.json'), 'utf8')).templates.flatMap(t => [t.thumbnail, t.demoPreview]))}; const start=performance.now();await Promise.all(names.map(url=>fetch(url).then(r=>{if(!r.ok)throw Error('Preview missing');return r.arrayBuffer()})));return performance.now()-start})()`)
      await session.cdp.evaluate(`(() => {const label=[...document.querySelectorAll('.effects-inspector label')].find(e=>/^Duration \(seconds\)|^时长/.test(e.textContent.trim()));const e=label?.querySelector('input[type=number]');if(!e)throw Error('Duration field missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'30');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      const workingSets = []; const timer = setInterval(() => {
        try { workingSets.push({ time: new Date().toISOString(), processes: processSnapshot(session.child.pid) }) } catch { /* Final sample is required below. */ }
      }, 1000)
      const renderStarted = Date.now()
      let job
      try { job = await generate(session, project.projectId) } finally { clearInterval(timer) }
      const saved = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/drafts/${job.draft_id}`)
      if (saved.document.duration_frames !== 900) throw new Error('性能渲染实际不是30秒')
      workingSets.push({ time: new Date().toISOString(), processes: processSnapshot(session.child.pid) })
      samples.push({ temperature, startup_ms: openStarted - started,
        template_interaction_ms: interaction, input_response_ms: inputResponse,
        previews_load_ms: previewLoad, previews_count: 48, render_frames: saved.document.duration_frames,
        render_30s_ms: Date.now() - renderStarted,
        peak_working_set_bytes: Math.max(...workingSets.map(sample => sample.processes.reduce((sum, entry) => sum + entry.working_set_bytes, 0))), workingSets })
      markCase(cases, temperature, samples.at(-1))
    } finally { await session.close() }
  }
  for (const name of ['previews-48', 'player-first-frame', 'input', 'render-30s', 'working-set']) markCase(cases, name, samples)
  const metrics = Object.fromEntries(['template_interaction_ms', 'input_response_ms', 'render_30s_ms', 'peak_working_set_bytes'].map(key => [key, Math.max(...samples.map(sample => sample[key]))]))
  const attachments = [await evidence.writeAttachment(context, 'raw_samples', 'performance/samples.json', evidence.bindRecord(context.report, { cases, samples, input_sha256: evidence.hash(JSON.stringify(samples)) })),
    await evidence.writeAttachment(context, 'device_record', 'performance/device.json', evidence.bindRecord(context.report, { case_id: 'device', input_sha256: evidence.hash(os.hostname()), os: os.release(), arch: os.arch(), cpus: os.cpus().map(cpu => ({ model: cpu.model, speed: cpu.speed })), total_memory_bytes: os.totalmem() }))]
  return { status: 'pass', acceptance_ids: evidence.acIds('performance'), measurements: metrics, attachments }
}

/** A real provider is required; keyless profiles cannot pass this scenario. */
async function sendAgentTurn(session, prompt, predicate) {
  const previous = session.agentEvents.length
  await setValue(session, '[data-agent-input]', prompt)
  await clickText(session, '^Send( message)?$|^发送$')
  return until('真实 Agent 回合结构化结果', async () => {
    const events = session.agentEvents.slice(previous)
    return events.some(predicate) && events
  }, 240000)
}
async function setFault(session, mode) {
  const previous = JSON.parse(await fs.readFile(session.faultFile, 'utf8'))
  await fs.writeFile(session.faultFile, JSON.stringify({ mode, requests: previous.requests }))
}
async function undoAgentTurn(session, receipt) {
  const before = await readTimeline(session, receipt.projectId)
  const clicked = await until('已完成应用回合的真实撤销控件', () => session.cdp.evaluate(`(() => {
    const buttons=[...document.querySelectorAll('button')].filter(e=>/^(Undo all|撤销本轮)$/.test(e.textContent.trim())&&!e.disabled);
    const e=buttons.at(-1);if(!e)return false;const observed={label:e.textContent.trim(),title:e.title};e.click();return observed;
  })()`))
  const after = await until('真实客户端整轮撤销已保存', async () => {
    const tracks = await readTimeline(session, receipt.projectId)
    return !tracks.some(track => track.items.some(item => item.metadata?.effects)) && tracks
  })
  return { source: 'client.undoAllOperations', operation_id: receipt.operationId,
    tool_call_id: receipt.toolCallId, control: clicked, before, after }
}
async function runAgent(context) {
  if (!context.installedRoot) throw new AcceptanceBlocked('Agent 矩阵需要本次实际 installed 目录与已配置测试模型')
  const session = await startSession(context)
  try {
    const capabilities = await jsonRequest(`${session.backend}/api/config/capability-status`)
    const configured = (capabilities.capabilities || capabilities.items || []).some(item => item.id === 'chat' && item.state === 'ready')
    if (!configured) throw new AcceptanceBlocked('隔离测试环境没有真实 LLM 配置，保留 blocked')
    const fixtures = await visual.createFixtures(context); const project = await seedProject(session, fixtures)
    const baseline = await readTimeline(session, project.projectId)
    const prompt = '先 explore_tools 加载特效工具，查询 title-rise 单模板，创建中文标题“安装验收”的2秒草稿。只创建，不渲染或应用。遇到未知结果立即停下并保留完整 recovery。'
    await setFault(session, 'draft')
    const first = await sendAgentTurn(session, prompt, event => event.type === 'tool_result'
      && event.toolName === 'create_effect_draft' && event.result?.status === 'unknown')
    const unknownDraft = first.find(event => event.toolName === 'create_effect_draft' && event.result?.status === 'unknown')
    await setFault(session, 'none')
    await sendAgentTurn(session, '用刚才返回的完整 recovery 独占分支确认原草稿，禁止重做输入、换ID或渲染。',
      event => event.type === 'tool_result' && event.toolName === 'create_effect_draft' && event.result?.success === true)
    await setFault(session, 'render')
    const renderEvents = await sendAgentTurn(session, '只渲染刚才确认的同一草稿，遇到提交未知立即停下，不换 requestId、不应用。',
      event => event.type === 'tool_result' && event.toolName === 'render_effect' && event.result?.status === 'unknown')
    const unknownRender = renderEvents.find(event => event.toolName === 'render_effect' && event.result?.status === 'unknown')
    await setFault(session, 'none')
    await sendAgentTurn(session, '先按原 requestId 调用 get_effect_job 恢复，404才同键同体重放原render；查询到成品生成成功后停下，禁止上轨。',
      event => event.type === 'tool_result' && event.toolName === 'get_effect_job' && event.result?.success === true)
    const ready = await until('原请求真实成品', async () => {
      const page = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)
      return page.items.find(job => job.request_id === unknownRender.result.requestId && job.status === 'succeeded')
    }, 180000)
    await sendAgentTurn(session, '查询刚才成功任务后，将该成品用 apply_effect_asset 插入新轨，等待真实客户端回执，不执行其它修改。',
      event => event.type === 'tool_result' && /apply_effect/.test(event.toolName) && event.result?.success === true)
    const traces = session.agentEvents
    const discovery = traces.findIndex(event => event.type === 'tool_call' && event.toolName === 'explore_tools')
    const template = traces.findIndex(event => event.type === 'tool_call' && event.toolName === 'get_effect_template')
    if (discovery < 0 || template <= discovery) throw new Error('Agent 未遵守逐步披露')
    const timeline = await readTimeline(session, project.projectId)
    const receipt = traces.find(event => event.type === 'tool_result' && /apply_effect/.test(event.toolName) && ['applied', 'noop'].includes(event.result?.state))
    if (!receipt || !timeline.some(track => track.items.some(item => item.metadata?.effects))) throw new Error('Agent apply 没有真实回执或上轨')
    const undo = await undoAgentTurn(session, { projectId: project.projectId,
      operationId: receipt.result.operationId || receipt.toolCallId, toolCallId: receipt.toolCallId })
    const known = new Set((await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)).items.map(job => job.job_id))
    await setValue(session, '[data-agent-input]', '创建新的60秒特效草稿并渲染，生成完成后才插入新轨。')
    await clickText(session, '^Send( message)?$|^发送$')
    const stoppedJob = await until('Stop前真实任务', async () => (await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)).items.find(job => !known.has(job.job_id) && ['queued', 'running'].includes(job.status)), 180000)
    await click(session, '[data-testid="agent-stop-button"]')
    await until('Stop 取消真实任务', async () => (await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs/${stoppedJob.job_id}`)).status === 'cancelled')
    const cancelled = await jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs/${stoppedJob.job_id}`)
    const afterStop = await readTimeline(session, project.projectId)
    if (JSON.stringify(afterStop) !== JSON.stringify(baseline)) throw new Error('Stop 后时间线发生修改')
    const faults = JSON.parse(await fs.readFile(session.faultFile, 'utf8'))
    const creations = faults.requests.filter(entry => entry.method === 'POST' && entry.path.endsWith('/drafts'))
    const renders = faults.requests.filter(entry => entry.method === 'POST' && entry.path.endsWith('/jobs'))
    if (!creations.length || !renders.length || new Set(creations.map(entry => JSON.stringify(entry.body))).size !== 1
      || new Set(renders.map(entry => JSON.stringify(entry.body))).size !== 1
      || renders[0].body.request_id !== ready.request_id) throw new Error('未知恢复更换了稳定身份或请求内容')
    const cases = evidence.CASES.agent.map(case_id => ({ case_id, status: 'pass', input_sha256: evidence.hash(prompt) }))
    const attachments = []
    for (const role of evidence.ROLES.agent) attachments.push(await evidence.writeAttachment(context, role,
      `agent/${role}.json`, evidence.bindRecord(context.report, { cases, case_id: role, input_sha256: evidence.hash(prompt), traces,
        unknown_draft: unknownDraft.result, unknown_render: unknownRender.result,
        provider_calls: session.requests.filter(request => request.path === '/api/video-editing-agent/chat').length,
        receipt: receipt.result, undo, baseline, timeline, after_stop: afterStop,
        stopped_job: stoppedJob.job_id, stopped_job_result: cancelled, faults })))
    return { status: 'pass', acceptance_ids: evidence.acIds('agent'), measurements: {
      real_provider: true, progressive_schema: true, stop_applied: false, undo_restored: true }, attachments }
  } finally { await setFault(session, 'none'); await session.close() }
}

module.exports = { AcceptanceBlocked, until, jsonRequest, startSession,
  processSnapshot, waitForOwnedExit, seedProject, capturePlayer,
  runDesktop, runProcess, runPerformance, runAgent, undoAgentTurn,
  click, clickText, setValue, key, openProject, openEffects, closeEffects,
  restoreRequestInterception }
