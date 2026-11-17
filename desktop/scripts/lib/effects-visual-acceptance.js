'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面验收沿用既有 CommonJS，并由包内 Electron Node 执行。 */

const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const evidence = require('./effects-release-evidence')
const fontUsage = require('./effects-font-usage')
const { TEXT_VECTORS, FAMILIES, createTextVectorDocument } = require('./effects-text-vectors')
const FRAMES = [0, 14, 29, 44, 59]
const CANVASES = [[1920, 1080], [1080, 1920], [1080, 1080]]

/** The same read-only DOM observation is used for renderer and real Player. */
function collectTextLayout(selector, frame) {
  const root = document.querySelector(selector)
  if (!root) throw new Error('Composition DOM is missing')
  const boundary = root.getBoundingClientRect()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const lines = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.textContent.trim() || node.parentElement.closest('[data-effects-measure]')) continue
    let visible = true
    let parent = node.parentElement
    while (parent && parent !== root.parentElement) {
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) visible = false
      parent = parent.parentElement
    }
    if (!visible) continue
    const range = document.createRange(); range.selectNodeContents(node)
    const style = getComputedStyle(node.parentElement)
    for (const rect of range.getClientRects()) if (rect.width && rect.height) lines.push({
      text: node.textContent, field: node.parentElement.closest('[data-effects-text]')?.dataset.effectsText,
      line_height: parseFloat(style.lineHeight), font_size: parseFloat(style.fontSize),
      font: style.fontFamily,
      x: rect.x - boundary.x, y: rect.y - boundary.y,
      width: rect.width, height: rect.height })
  }
  const text_boxes = [...root.querySelectorAll('[data-effects-text]')].map(node => ({
    field: node.dataset.effectsText, line_count: node.querySelectorAll('[data-effects-line]').length,
    height: node.offsetHeight, width: node.clientWidth, scroll_width: node.scrollWidth,
    font_size: parseFloat(getComputedStyle(node).fontSize), line_height: parseFloat(getComputedStyle(node).lineHeight) }))
  return { frame, text_boxes, boundary: { x: boundary.x, y: boundary.y,
    width: boundary.width, height: boundary.height },
  device_scale_factor: window.devicePixelRatio, lines }
}

function compareLayouts(renderer, player, canvas) {
  const ratio = player.boundary.width / canvas.width
  if (renderer.lines.length !== player.lines.length) return { linesMatch: false, error: Infinity }
  let error = 0
  for (let index = 0; index < renderer.lines.length; index++) {
    const source = renderer.lines[index]; const actual = player.lines[index]
    if (source.text !== actual.text || source.font !== actual.font) return { linesMatch: false, error: Infinity }
    for (const key of ['x', 'y', 'width', 'height']) error = Math.max(error,
      Math.abs(source[key] * ratio - actual[key]))
  }
  return { linesMatch: true, error }
}
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
function fixtureDocument(template, canvas, bindings = []) {
  return { schemaVersion: 1, templateId: template.id, templateVersion: template.version,
    canvas: { width: canvas[0], height: canvas[1], fps: 30 }, durationFrames: 60,
    seed: 1, content: { title: '新的故事 Effects', subtitle: '本地制作 · Frame 30' },
    palette: { background: '#15171A', foreground: '#F5F4F1', accent: '#C87758' },
    typography: { family: 'sans', scale: 1, align: 'center' },
    motion: { speed: 1, intensity: 1 }, params: structuredClone(template.defaults),
    inputs: bindings }
}
async function execute(context, executable, argv, extra = {}) {
  const result = await evidence.runProgram(executable, argv, {
    cwd: context.evidenceRoot, timeoutMs: 240000, ...extra,
    onSpawn: record => context.processes?.push(record) })
  if (result.exit_code !== 0) throw new Error(`验收子进程失败: ${path.basename(executable)} (${result.exit_code}) ${result.stderr.slice(-400)}`)
  return result.stdout
}

/** Inputs have fixed content, frame numbers and calibrated 10ms unity pulses. */
async function allocateFixturePaths(context) {
  const parent = path.join(context.evidenceRoot, 'fixtures')
  await fs.mkdir(parent, { recursive: true })
  const directory = path.join(parent, randomUUID())
  await fs.mkdir(directory)
  return { directory, image: path.join(directory, 'checker.png'),
    video: path.join(directory, 'frame-source.mp4') }
}
async function createFixtures(context) {
  const { image, video } = await allocateFixturePaths(context)
  const fonts = JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'fonts/manifest.json'), 'utf8'))
  const font = path.join(context.resourceRoot, 'fonts', fonts.fonts.find(f => f.family === 'sans' && f.path.endsWith('.ttf')).path).replaceAll('\\', '/').replaceAll(':', '\\:')
  await execute(context, context.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=256x256:rate=1', '-frames:v', '1', image])
  await execute(context, context.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i',
    'aevalsrc=if(lt(mod(t\\,1)\\,0.01)\\,0.9*sin(2*PI*1000*t)\\,0):s=48000:d=6',
    '-vf', `drawtext=fontfile='${font}':text='%{n}':x=40:y=80:fontsize=40:fontcolor=white,drawbox=x=0:y=0:w=64:h=64:color=white:t=fill:enable='lt(mod(t,1),0.033333)'`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
  return { image, video, imageHash: await evidence.hashFile(image),
    videoHash: await evidence.hashFile(video) }
}

/** Worker uses only target package dependencies, never imports renderChild. */
async function renderStillsWorker(requestPath) {
  const request = JSON.parse(await fs.readFile(requestPath, 'utf8'))
  if (request.targetRoot) evidence.installModuleBoundary(request.targetRoot)
  const load = createRequire(path.join(request.entryRoot, 'package.json'))
  const renderer = load('@remotion/renderer')
  const { createMediaServer } = load('./mediaServer.js')
  const manifest = JSON.parse(await fs.readFile(path.join(request.resourceRoot, 'manifest.json'), 'utf8'))
  const port = await freePort()
  const server = await createMediaServer({ resourceRoot: request.resourceRoot,
    jobDirectory: request.jobDirectory, inputs: request.submission.inputs, proxyPort: port })
  let browser
  try {
    browser = await renderer.openBrowser('chrome', { browserExecutable:
      path.join(request.resourceRoot, manifest.browserExecutable), logLevel: 'error' })
    const fonts = JSON.parse(await fs.readFile(path.join(request.resourceRoot, 'fonts/manifest.json'), 'utf8'))
    const fontUrls = Object.fromEntries(fonts.fonts.filter(font => font.role === 'font')
      .map(font => [font.family, `${server.baseUrl}fonts/${encodeURIComponent(font.path)}`]))
    if (fonts.schemaVersion !== 2 || ['sans', 'serif', 'mono', 'emoji'].some(key => !fontUrls[key])) throw Error('Font resources incomplete')
    const inputProps = { document: request.submission.document, fontUrls,
      assets: Object.fromEntries(request.submission.inputs.map(input => [input.assetId, `${server.baseUrl}inputs/${input.assetId}`])) }
    const original = browser.newPage.bind(browser)
    let currentFrame = 0; const layouts = []; const usages = []
    browser.newPage = async (...args) => {
      const page = await original(...args)
      const client = page._client(); const command = client.send.bind(client)
      client.on('Fetch.requestPaused', paused => {
        const url = paused.request.url; const proxy = `http://localhost:${port}/proxy?`
        const allowed = url.startsWith(server.baseUrl) || url.startsWith(proxy)
        void command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
          requestId: paused.requestId, ...(url.startsWith(proxy) ? { url: `${server.baseUrl}proxy?${url.slice(proxy.length)}` } : {}),
          ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) })
      })
      await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
      return page
    }
    const restricted = browser.newPage
    const composition = await renderer.selectComposition({ serveUrl: `${server.baseUrl}bundle/index.html`,
      id: 'Effect', inputProps, puppeteerInstance: browser, port })
    // Metadata pages are not rendered frames and may lack the composition DOM.
    browser.newPage = restricted
    for (const frame of request.frames) for (const repetition of ['a', 'b']) {
      currentFrame = frame
      let captured, captureFailure
      browser.newPage = async (...args) => {
        const page = await restricted(...args); const close = page.close.bind(page)
        let closing
        page.close = async (...closeArgs) => {
          if (closing) return closing
          closing = (async () => {
          try {
          captured = await page.evaluate(collectTextLayout, '#remotion-canvas', currentFrame)
          if (request.fontBinding && repetition === 'a') usages.push(await fontUsage.collectFontUsage(
            (...args) => page._client().send(...args).then(result => result.value), '#remotion-canvas', { ...request.fontBinding,
              side: 'renderer', frame: currentFrame, fontHash: manifest.fontHash }))
          } catch (error) { captureFailure = error }
          // Remotion also calls cleanup from its error event without awaiting it.
          // Record observation errors here and reject the awaited happy path below.
          try { await close(...closeArgs) } catch (error) { captureFailure ||= error }
          })()
          return closing
        }
        return page
      }
      await renderer.renderStill({ serveUrl: `${server.baseUrl}bundle/index.html`, composition,
        inputProps, puppeteerInstance: browser, frame, imageFormat: 'png', port,
        binariesDirectory: path.join(request.resourceRoot, manifest.binariesDirectory),
        output: path.join(request.outputDirectory, `${frame}-${repetition}.png`) })
      if (captureFailure) throw captureFailure
      if (!captured || captured.frame !== frame) throw new Error('Renderer frame layout was not observed')
      if (repetition === 'a') layouts.push(captured)
    }
    await fs.writeFile(path.join(request.outputDirectory, 'layouts.json'), JSON.stringify(layouts), { flag: 'wx' })
    if (request.fontBinding) await fs.writeFile(path.join(request.outputDirectory, 'font-usage.json'), JSON.stringify(usages), { flag: 'wx' })
  } finally { await browser?.close({ silent: true }); await server.close() }
}

async function prepareSubmission(context, template, canvas, fixtures) {
  const jobId = randomUUID(); const projectId = context.projectId || randomUUID()
  const jobDirectory = path.join(context.projectsRoot, projectId, '.work', jobId)
  await fs.mkdir(path.join(jobDirectory, 'inputs'), { recursive: true })
  const inputs = []; const bindings = []
  for (const slot of template.slots.filter(slot => slot.required || slot.id === 'base')) {
    const kind = slot.kinds.includes('video') ? 'video' : 'image'
    const count = Math.max(1, slot.min)
    for (let index = 0; index < count; index++) {
      const assetId = randomUUID(); const fileName = `${assetId}.${kind === 'video' ? 'mp4' : 'png'}`
      const source = kind === 'video' ? fixtures.video : fixtures.image
      await fs.copyFile(source, path.join(jobDirectory, 'inputs', fileName))
      const identity = await evidence.hashFile(source)
      inputs.push({ assetId, fileName, bytes: identity.bytes, sha256: identity.sha256 })
      bindings.push({ slot: slot.id, assetId, kind, fit: 'cover', focalX: 0.5,
        focalY: 0.5, ...(slot.id === 'images' ? { index } : {}),
        ...(kind === 'video' ? { trimStartSeconds: 2 } : {}) })
    }
  }
  const document = fixtureDocument(template, canvas, bindings)
  return { jobDirectory, submission: { projectId, jobId,
    requestHash: evidence.hash(JSON.stringify(document)), document, inputs,
    output: { profile: 'mp4-1080p' } } }
}
async function renderMp4(context, submission) {
  const smoke = require('../effects-smoke')
  smoke.configure({ ...(context.targetRoot ? { installed: context.targetRoot,
    unpacked: context.unpackedRoot } : { packaged: true }),
    report: path.join(context.evidenceRoot, 'internal-smoke.json') })
  await smoke.runChild(submission, 'render')
}
async function metric(context, args) {
  const output = await execute(context, context.python, ['-B', '-X', 'utf8',
    path.join(__dirname, 'effects_metrics.py'), ...args], { env: { PYTHONNOUSERSITE: '1' } })
  return JSON.parse(output)
}
async function renderStills(context, prepared, directory, frames = FRAMES) {
  await fs.mkdir(directory, { recursive: true })
  const requestPath = path.join(directory, 'request.json')
  await fs.writeFile(requestPath, JSON.stringify({ ...prepared, frames,
    outputDirectory: directory, targetRoot: context.targetRoot,
    entryRoot: context.entryRoot, resourceRoot: context.resourceRoot }), { flag: 'wx' })
  await execute(context, context.electron, [__filename, '--still-worker', requestPath], {
    env: { ELECTRON_RUN_AS_NODE: '1', EFFECTS_ACCEPTANCE_TARGET_ROOT: context.targetRoot,
      NODE_OPTIONS: `--require=${JSON.stringify(require.resolve('./effects-release-evidence'))}` } })
}
async function sampleFrame(context, entry, frame, directory) {
  const prefix = path.relative(context.evidenceRoot, directory).replaceAll('\\', '/')
  const pngA = path.join(directory, `${frame}-a.png`)
  const pngB = path.join(directory, `${frame}-b.png`)
  const decoded = path.join(directory, `${frame}-mp4.png`)
  await execute(context, context.ffmpeg, ['-v', 'error', '-i', entry.video,
    '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-pix_fmt', 'rgb24', decoded])
  const player = await context.capturePlayer(entry.submission.document, entry.submission.inputs,
    entry.jobDirectory, frame, path.join(directory, `${frame}-player.png`), entry.fontBinding)
  const mp4 = await metric(context, ['compare', '--reference', pngA,
    '--repeated', pngB, '--candidate', decoded, '--mask', path.join(directory, `${frame}-mask.png`)])
  const playerMetrics = await metric(context, ['compare', '--reference', pngA,
    '--repeated', pngB, '--candidate', path.join(directory, `${frame}-player.png`),
    '--mask', path.join(directory, `${frame}-player-mask.png`), '--allow-resize'])
  const renderer = entry.layouts.find(layout => layout.frame === frame)
  const compared = compareLayouts(renderer, player.layout, entry.submission.document.canvas)
  const layoutRecord = evidence.bindRecord(context.report, { case_id: entry.caseId,
    input_sha256: entry.submission.requestHash, frame, renderer, player: player.layout })
  const metricsRecord = evidence.bindRecord(context.report, { case_id: entry.caseId,
    input_sha256: entry.submission.requestHash, frame, mp4, player: playerMetrics,
    layout_error_css_px: Number.isFinite(compared.error) ? compared.error : 1000000 })
  const attachments = []
  for (const [role, filename, value] of [
    ['frame_pair', `${frame}-a.png`], ['frame_pair', `${frame}-b.png`],
    ['frame_pair', `${frame}-mp4.png`], ['player_frame', `${frame}-player.png`],
    ['frame_pair', `${frame}-mask.png`], ['frame_pair', `${frame}-player-mask.png`],
    ['layout', `${frame}-layout.json`, layoutRecord], ['layout', `${frame}-metrics.json`, metricsRecord],
  ]) attachments.push(await evidence.writeAttachment(context, role, `${prefix}/${filename}`, value))
  if (entry.fontBinding) {
    const usage = entry.usages?.find(item => item.frame === frame)
    if (!usage || !player.fontUsage) throw Error('缺少双端字体来源')
    for (const [side, raw] of [['renderer', usage], ['player', player.fontUsage]])
      attachments.push(await evidence.writeAttachment(context, 'font_usage', `${prefix}/${frame}-${side}-fonts.json`,
        evidence.bindRecord(context.report, raw)))
  }
  return { attachments, frame: { frame, png_a: `${prefix}/${frame}-a.png`,
    png_b: `${prefix}/${frame}-b.png`, mp4_frame: `${prefix}/${frame}-mp4.png`,
    player_frame: `${prefix}/${frame}-player.png`, layout: `${prefix}/${frame}-layout.json`,
    metrics: `${prefix}/${frame}-metrics.json`, mask: `${prefix}/${frame}-mask.png`,
    player_mask: `${prefix}/${frame}-player-mask.png`, png_equal: mp4.png_equal,
    rgba_equal: mp4.rgba_equal, mp4_flat_mae: mp4.flat_mae,
    player_flat_mae: playerMetrics.flat_mae, layout_lines_match: compared.linesMatch,
    layout_error_css_px: Number.isFinite(compared.error) ? compared.error : 1000000,
    ...(entry.fontBinding ? { renderer_font_usage: `${prefix}/${frame}-renderer-fonts.json`,
      player_font_usage: `${prefix}/${frame}-player-fonts.json` } : {}) } }
}

/** Run 72 production MP4 renders and 720 stills, plus real Player comparisons. */
async function runVisual(context) {
  const fixtures = await createFixtures(context)
  const catalog = JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'catalog.json'), 'utf8'))
  if (catalog.templates.length !== 24) throw new Error('Catalog must contain 24 templates')
  const entries = []; const attachments = []; const cases = []
  const referencePaths = {}
  for (const side of ['renderer', 'player']) {
    const reference = await fontUsage.probeTargetFonts(context, side)
    referencePaths[side] = `visual/${side}-font-reference.json`
    attachments.push(await evidence.writeAttachment(context, 'font_usage_reference', referencePaths[side],
      evidence.bindRecord(context.report, { case_id: 'font-reference', input_sha256: context.report.font_hash, ...reference })))
  }
  for (const template of catalog.templates) for (const canvas of CANVASES) {
    const caseId = `${template.id}:${canvas.join('x')}`
    context.onProgress?.(`visual ${caseId}`)
    const prepared = await prepareSubmission(context, template, canvas, fixtures)
    const directory = path.join(context.evidenceRoot, 'visual', caseId.replaceAll(':', '-'))
    await renderStills(context, prepared, directory)
    await renderMp4(context, prepared.submission)
    const video = path.join(prepared.jobDirectory, 'video.part.mp4')
    const layouts = JSON.parse(await fs.readFile(path.join(directory, 'layouts.json'), 'utf8'))
    const frames = []
    for (const frame of FRAMES) {
      const sample = await sampleFrame(context, { ...prepared, video, layouts, caseId }, frame, directory)
      frames.push(sample.frame); attachments.push(...sample.attachments)
    }
    const probe = JSON.parse(await execute(context, context.ffprobe, ['-v', 'error',
      '-count_frames', '-show_streams', '-show_format', '-of', 'json', video]))
    attachments.push(await evidence.writeAttachment(context, 'media_probe',
      `visual/${caseId.replaceAll(':', '-')}/probe.json`, evidence.bindRecord(context.report,
        { case_id: caseId, input_sha256: prepared.submission.requestHash, probe })))
    const documentPath = `visual/${caseId.replaceAll(':', '-')}/document.json`
    attachments.push(await evidence.writeAttachment(context, 'fixture_document', documentPath,
      evidence.bindRecord(context.report, { case_id: caseId, input_sha256: prepared.submission.requestHash,
        document: prepared.submission.document, inputs: prepared.submission.inputs })))
    const videoPath = path.relative(context.evidenceRoot, video).replaceAll('\\', '/')
    attachments.push(await evidence.writeAttachment(context, 'video', videoPath))
    entries.push({ case_id: caseId, input_sha256: prepared.submission.requestHash,
      template_id: template.id, width: canvas[0], height: canvas[1],
      document: documentPath, video: videoPath,
      probe: `visual/${caseId.replaceAll(':', '-')}/probe.json`, frames })
  }
  // Every supplemental vector has the same independent still/MP4/Player gates.
  const supplemental = []
  for (const vector of TEXT_VECTORS) for (const family of FAMILIES) {
    const template = catalog.templates.find(t => t.id === 'title-rise')
    const prepared = await prepareSubmission(context, template, CANVASES[0], fixtures)
    prepared.submission.document = createTextVectorDocument(template, vector, family)
    prepared.submission.inputs = []
    prepared.submission.requestHash = evidence.hash(JSON.stringify(prepared.submission.document))
    prepared.fontBinding = { case_id: vector.case_id, family, input_sha256: prepared.submission.requestHash }
    context.onProgress?.(`visual ${vector.case_id}/${family}`)
    const directory = path.join(context.evidenceRoot, 'visual', `${vector.case_id}-${family}`)
    await renderStills(context, prepared, directory, [0, 29, 59])
    await renderMp4(context, prepared.submission)
    const video = path.join(prepared.jobDirectory, 'video.part.mp4')
    const layouts = JSON.parse(await fs.readFile(path.join(directory, 'layouts.json'), 'utf8'))
    const usages = JSON.parse(await fs.readFile(path.join(directory, 'font-usage.json'), 'utf8'))
    const frames = []
    for (const frame of [0, 29, 59]) {
      const sample = await sampleFrame(context, { ...prepared, video, layouts, usages, caseId: vector.case_id }, frame, directory)
      frames.push(sample.frame); attachments.push(...sample.attachments)
    }
    const prefix = `visual/${vector.case_id}-${family}`
    const probe = JSON.parse(await execute(context, context.ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', video]))
    const documentPath = `${prefix}/document.json`, probePath = `${prefix}/probe.json`
    const videoPath = path.relative(context.evidenceRoot, video).replaceAll('\\', '/')
    const binding = { case_id: vector.case_id, input_sha256: prepared.submission.requestHash, family }
    attachments.push(await evidence.writeAttachment(context, 'fixture_document', documentPath,
      evidence.bindRecord(context.report, { ...binding, document: prepared.submission.document, inputs: [] })))
    attachments.push(await evidence.writeAttachment(context, 'media_probe', probePath,
      evidence.bindRecord(context.report, { ...binding, probe })))
    attachments.push(await evidence.writeAttachment(context, 'video', videoPath))
    const fonts = JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'fonts/manifest.json'), 'utf8'))
    const paths = fontUsage.fontKeys(family).map(key => path.join(context.resourceRoot, 'fonts', fonts.fonts.find(font => font.role === 'font' && font.family === key).path))
    const text = vector.title + '\n' + vector.subtitle
    const glyphs = await metric(context, ['glyphs', ...paths.flatMap(file => ['--font', file]), '--text', text])
    if (!glyphs.offline_glyphs_complete) throw Error(`Offline glyphs missing: ${vector.case_id}/${family}`)
    attachments.push(await evidence.writeAttachment(context, 'layout', `${prefix}/glyphs.json`,
      evidence.bindRecord(context.report, { ...binding, text, glyphs })))
    supplemental.push({ ...binding, document: documentPath, video: videoPath, probe: probePath, frames })
  }
  for (const vector of TEXT_VECTORS) cases.push({ case_id: vector.case_id,
    input_sha256: evidence.hash(JSON.stringify(vector)), status: 'pass' })
  attachments.push(await evidence.writeAttachment(context, 'supplemental_index', 'visual/supplemental.json',
    evidence.bindRecord(context.report, { input_sha256: evidence.hash(JSON.stringify(supplemental)), entries: supplemental, reference_paths: referencePaths })))
  // Audio uses the same calibrated source and the renderer's real output.
  const audio = await runAudioVectors(context, catalog, fixtures)
  cases.push(...audio.cases); attachments.push(...audio.attachments)
  cases.push({ case_id: 'visual-matrix', input_sha256: evidence.hash(JSON.stringify(entries)), status: 'pass' })
  attachments.push(await evidence.writeAttachment(context, 'matrix_index', 'visual/matrix.json',
    evidence.bindRecord(context.report, { entries, cases, input_sha256: evidence.hash(JSON.stringify(fixtures)) })))
  return { status: 'pass', acceptance_ids: evidence.acIds('visual'),
    measurements: { combinations: 72, sample_frames: 360, supplemental_vector_count: 27, supplemental_sample_frames: 81 }, attachments }
}
async function runAudioVectors(context, catalog, fixtures) {
  const cases = []; const attachments = []
  const template = catalog.templates.find(entry => entry.id === 'video-cinematic')
  const prepared = await prepareSubmission(context, template, CANVASES[0], fixtures)
  prepared.submission.document.durationFrames = 102
  await renderMp4(context, prepared.submission)
  for (const [name, gain] of [['unity', 1], ['half', 0.5], ['muted', 0], ['detached', 1]]) {
    const wav = path.join(context.evidenceRoot, `audio-${name}.wav`)
    // Detached is analyzed at the desktop outer track; this standalone branch
    // keeps the calibrated source as a separate reference, never doubles sound.
    const source = name === 'detached' ? fixtures.video : path.join(prepared.jobDirectory, 'video.part.mp4')
    await execute(context, context.ffmpeg, ['-v', 'error', '-i', source,
      ...(name === 'detached' ? ['-ss', '2', '-t', '3.4'] : []),
      '-vn', '-af', `volume=${gain}`, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    const metrics = await metric(context, ['audio', '--audio', wav, '--gain', String(gain),
      '--expected', gain === 0 ? '[]' : '[0,1,2,3]'])
    if (gain && metrics.max_av_error_seconds > 1 / 30) throw new Error('A/V pulse alignment exceeds one frame')
    cases.push({ case_id: `audio-${name}`, input_sha256: fixtures.videoHash.sha256, status: 'pass' })
    attachments.push(await evidence.writeAttachment(context, 'audio_metrics', `visual/audio-${name}.json`,
      evidence.bindRecord(context.report, { case_id: `audio-${name}`, input_sha256: fixtures.videoHash.sha256,
        audio: path.relative(context.evidenceRoot, wav).replaceAll('\\', '/'),
        source: path.relative(context.evidenceRoot, source).replaceAll('\\', '/'),
        gain, trim_start: name === 'detached' ? 2 : 0, expected: gain === 0 ? [] : [0, 1, 2, 3], metrics })))
    attachments.push(await evidence.writeAttachment(context, 'audio_wave', path.relative(context.evidenceRoot, wav).replaceAll('\\', '/')))
  }
  for (const filename of [fixtures.video, path.join(prepared.jobDirectory, 'video.part.mp4')]) attachments.push(await evidence.writeAttachment(context, 'audio_source', path.relative(context.evidenceRoot, filename).replaceAll('\\', '/')))
  return { cases, attachments }
}

if (require.main === module && process.argv[2] === '--still-worker') {
  renderStillsWorker(process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1 })
}
async function measureDesktopExport(context, exported, fixtures) {
  const video = exported.probe.streams.find(stream => stream.codec_type === 'video')
  if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p'
    || video.r_frame_rate !== '30/1') throw new Error('真实导出格式不符合 H.264/yuv420p/30fps')
  const sourceItems = exported.request.video_items || []
  const source = sourceItems.find(item => item.id === 'effects-source-clip')
  const other = sourceItems.find(item => item.id === 'effects-other-clip')
  if (!source || !other || source.clip_start !== 0 || Math.abs(source.clipped_duration - 3.37) > 1 / 30) throw new Error('真实导出裁剪没有保持 3.37 秒')
  const suffix = path.basename(exported.video, '.mp4').replace(/^export-/, '')
  const audioName = `desktop/${suffix}.wav`
  const referenceName = `desktop/${suffix === 'final' ? 'source' : `source-${suffix}`}.wav`
  const wav = path.join(context.evidenceRoot, audioName)
  await execute(context, context.ffmpeg, ['-v', 'error', '-i', exported.video,
    '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  const expected = [0, 1, 2, 3, other.start_time, other.start_time + 1]
  const audioStart = Number(exported.probe.streams.find(stream => stream.codec_type === 'audio')?.start_time || 0)
  const metrics = await metric(context, ['audio', '--audio', wav, '--gain', '0.5',
    '--start-time', String(audioStart), '--expected', JSON.stringify(expected)])
  const reference = path.join(context.evidenceRoot, referenceName)
  await execute(context, context.ffmpeg, ['-v', 'error', '-i', fixtures.video,
    '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', reference])
  const calibrated = await metric(context, ['audio', '--audio', reference,
    '--gain', '1', '--expected', '[0,1,2,3,4,5]'])
  const referencePeak = calibrated.peaks[2].peak
  const gainError = Math.max(...metrics.peaks.map((peak, index) =>
    Math.abs(peak.peak / referencePeak - (index < 4 ? 0.5 : 1)) / (index < 4 ? 0.5 : 1)))
  const measurements = { degradations: exported.status.degradations?.length || 0,
    codec: video.codec_name, pixel_format: video.pix_fmt,
    fps: Number(video.r_frame_rate.split('/')[0]) / Number(video.r_frame_rate.split('/')[1]),
    max_av_error_seconds: metrics.max_av_error_seconds, gain_ratio_error: gainError }
  return { measurements, audio: audioName, reference: referenceName,
    expected, audio_start_time: audioStart, metrics, calibrated }
}

/** Exercise the actual Electron capture handlers, including the IME guard. */
async function runCloseKeyboardCase(session) {
  const ui = require('./effects-desktop-acceptance')
  await ui.restoreRequestInterception(session)
  await ui.openEffects(session)
  const title = `Keyboard ${randomUUID()}`
  await ui.setValue(session, '.effects-inspector textarea', title)
  await ui.click(session, '[data-effects-studio] header button[aria-label="Close"]')
  await ui.until('未保存确认', () => session.cdp.evaluate("!!document.querySelector('[role=alertdialog]')"))
  const focus = async () => session.cdp.evaluate(`(() => {const d=document.querySelector('[role=alertdialog]');return {inside:!!d?.contains(document.activeElement),label:document.activeElement?.textContent.trim(),count:d?.querySelectorAll('button').length}})()`)
  const initial = await focus(); const tabs = []
  if (!/Continue editing|继续编辑/.test(initial.label) || initial.count !== 3) throw new Error('确认层初始焦点或动作数错误')
  for (const modifiers of [0, 0, 0, 8, 8, 8]) { await ui.key(session, 'Tab', modifiers); const sample = await focus(); if (!sample.inside) throw new Error('Tab 离开确认层'); tabs.push(sample) }
  await session.cdp.evaluate("document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}))")
  await ui.key(session, 'Escape'); await ui.key(session, 'z', 2)
  if (!await session.cdp.evaluate("!!document.querySelector('[role=alertdialog]')")) throw new Error('IME Escape错误关闭确认层')
  await session.cdp.evaluate("document.activeElement.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}))")
  await ui.key(session, 'Escape')
  await ui.until('Escape回编辑器', () => session.cdp.evaluate("!!document.querySelector('[data-effects-studio]')&&!document.querySelector('[role=alertdialog]')"))
  await session.cdp.evaluate("document.querySelector('.effects-inspector textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}))")
  await ui.key(session, 'z', 2); await ui.key(session, 'Escape')
  if (!await session.cdp.evaluate(`document.querySelector('.effects-inspector textarea')?.value===${JSON.stringify(title)}&&!document.querySelector('[role=alertdialog]')`)) throw new Error('IME期间触发了草稿撤销或关闭')
  await session.cdp.evaluate("document.querySelector('.effects-inspector textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}))")
  await ui.setValue(session, '.effects-inspector textarea', `${title} save failure`)
  await ui.click(session, '[data-effects-studio] header button[aria-label="Close"]')
  const remove = session.intercept(message => message.responseStatusCode === undefined && /\/drafts(?:\/[^/]+)?$/.test(new URL(message.request.url).pathname)
    && ['POST', 'PUT'].includes(message.request.method), message => session.cdp.send('Fetch.fulfillRequest', {
    requestId: message.requestId, responseCode: 500, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify({ success: false, error_code: 'EFFECT_RENDER_FAILED', message: 'Acceptance save failure' })).toString('base64') }))
  try {
    await ui.clickText(session, '^Save and close$|保存并关闭', '[role=alertdialog]')
    await ui.until('保存失败摘要焦点', () => session.cdp.evaluate("document.activeElement?.getAttribute('role')==='alert'&&!!document.querySelector('[role=alertdialog]')"))
    if (!await session.cdp.evaluate(`document.querySelector('.effects-inspector textarea')?.value===${JSON.stringify(`${title} save failure`)}`)) throw new Error('保存失败丢失输入')
  } finally { remove() }
  await ui.clickText(session, '^Continue editing$|继续编辑', '[role=alertdialog]')
  await ui.closeEffects(session)
  return { initial_focus: initial.label, tab_samples: tabs, ime_escape_preserved: true,
    ime_undo_preserved: true, save_500_preserved: true, error_summary_focused: true,
    ime_injection: 'DOM composition events + trusted CDP keys' }
}

/** Fail one real FontFace URL, then retry in the same renderer document. */
async function runFontRetryCase(session, project) {
  const ui = require('./effects-desktop-acceptance')
  await ui.restoreRequestInterception(session)
  const beforeJobs = await ui.jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)
  const beforeDrafts = await ui.jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/drafts`)
  let failedUrl; let retryCount = 0
  const remove = session.intercept(message => message.responseStatusCode === undefined
    && /\/effects\/fonts\/.*\.ttf$/.test(new URL(message.request.url).pathname), async message => {
    if (!failedUrl) { failedUrl = message.request.url; await session.cdp.send('Fetch.failRequest', { requestId: message.requestId, errorReason: 'Failed' }) }
    else { if (message.request.url === failedUrl) retryCount++; await session.cdp.send('Fetch.continueRequest', { requestId: message.requestId }) }
  })
  await session.cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  try {
    await ui.openProject(session, project.name); await ui.openEffects(session)
    await ui.until('字体资源真实失败', () => session.cdp.evaluate("!!document.querySelector('.effects-preview [role=alert]')"))
    if (!failedUrl) throw new Error('没有注入真实FontFace请求失败')
    const beforeProject = await ui.jsonRequest(`${session.backend}/api/video-projects/${project.projectId}`)
    const historyBefore = await session.cdp.evaluate("document.querySelector('.ws-topbar button[aria-label^=\"Undo\"]')?.disabled??true")
    await ui.clickText(session, '^Retry preview$|重试预览', '.effects-preview')
    await ui.until('相同URL重新加载字体', async () => retryCount > 0 && session.cdp.evaluate("!document.querySelector('.effects-preview [role=alert]')&&[...document.fonts].some(face=>face.family.includes('Effects-')&&face.status==='loaded')"))
    const afterJobs = await ui.jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/jobs`)
    const afterDrafts = await ui.jsonRequest(`${session.frontend}/api/effects/projects/${project.projectId}/drafts`)
    const afterProject = await ui.jsonRequest(`${session.backend}/api/video-projects/${project.projectId}`)
    const historyAfter = await session.cdp.evaluate("document.querySelector('.ws-topbar button[aria-label^=\"Undo\"]')?.disabled??true")
    const ids = page => (page.items || page).map(entry => entry.job_id || `${entry.draft_id}:${entry.version}`).sort()
    if (JSON.stringify(ids(beforeJobs)) !== JSON.stringify(ids(afterJobs))
      || JSON.stringify(ids(beforeDrafts)) !== JSON.stringify(ids(afterDrafts))
      || JSON.stringify(beforeProject.project_data.uiState.currentTimelineState.tracks) !== JSON.stringify(afterProject.project_data.uiState.currentTimelineState.tracks)
      || historyBefore !== historyAfter) throw new Error('预览重试改变了草稿、任务或时间线历史')
    await ui.closeEffects(session)
    return { failed_url: new URL(failedUrl).pathname, same_url_retry_count: retryCount,
      preview_recovered: true, jobs_unchanged: true, drafts_unchanged: true,
      timeline_unchanged: true, history_controls_unchanged: true }
  } finally { remove(); await session.cdp.send('Network.setCacheDisabled', { cacheDisabled: false }) }
}

module.exports = { runCloseKeyboardCase, runFontRetryCase, measureDesktopExport, FRAMES, CANVASES, collectTextLayout, compareLayouts,
  createFixtures, allocateFixturePaths, fixtureDocument, prepareSubmission, runVisual, renderStillsWorker,
  execute, metric, renderMp4 }
