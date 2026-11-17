'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面验收沿用既有 CommonJS，并由包内 Electron Node 执行。 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const http = require('node:http')
const syncFs = require('node:fs')
const { randomUUID } = require('node:crypto')
const evidence = require('./effects-release-evidence')
const root = path.resolve(__dirname, '../../build/effects/evidence-tests')

test('第13草稿仅页面刷新不能代领应用重启验收', () => {
  const page = { first_count: 12, second_count: 1, selected_id: 'oldest', reopened_id: 'oldest',
    edited_title: '保留文字', persisted_title: '保留文字', timeline_unchanged: true, reachable_after_reload: true }
  assert.throws(() => evidence.assertDraftPageEvidence(page), /应用重启/)
  const complete = { ...page, restarted_id: 'oldest', restarted_title: '保留文字',
    restart_first_count: 12, restart_second_count: 1, restart_timeline_unchanged: true,
    restart: { before: { pid: 101, started_at: '2026-11-17T12:00:00.000Z' },
      after: { pid: 102, started_at: '2026-11-17T12:00:10.000Z' },
      exit_ms: 100, residual_processes: 0, same_user_data: true } }
  delete complete.reachable_after_reload
  assert.doesNotThrow(() => evidence.assertDraftPageEvidence(complete))
  for (const mutate of [
    proof => { delete proof.restart },
    proof => { proof.restart.after = { ...proof.restart.before } },
    proof => { proof.restart.residual_processes = 1 },
    proof => { proof.restart.same_user_data = false },
    proof => { proof.restart.exit_ms = 12001 },
    proof => { delete proof.restart.after.pid },
    proof => { proof.restarted_id = 'another' },
    proof => { proof.restarted_title = '丢失文字' },
    proof => { proof.restart_second_count = 0 },
    proof => { proof.restart_timeline_unchanged = false },
  ]) { const proof = structuredClone(complete); mutate(proof); assert.throws(() => evidence.assertDraftPageEvidence(proof)) }
})

test('报告v2保留独占marker与附件v1，旧报告不能签发', async () => {
  const report = evidence.createAcceptanceReport({ scenario: 'package', mode: 'unpacked' })
  assert.equal(report.schema_version, 2)
  assert.equal(evidence.bindRecord(report, {}).schema_version, 1)
  report.schema_version = 1
  assert.equal((await evidence.validateAcceptanceReport(report)).valid, false)
})
test('新AC在相应blocked报告中可被整体校验，不能错误归为未知', async () => {
  for (const scenario of ['package', 'visual', 'desktop']) {
    const report = evidence.createAcceptanceReport({ scenario, mode: 'unpacked' })
    report.steps[scenario] = { status: 'blocked', acceptance_ids: [], measurements: {}, attachments: [], reason: '待本次安装' }
    for (const id of evidence.acIds(scenario)) report.acceptance_results[id] = { status: 'blocked', case_ids: [], attachment_refs: [] }
    const result = await evidence.validateAcceptanceReport(report, { evidenceRoot: root })
    assert.equal(result.valid, true, result.errors.join('\n')); assert.equal(result.exitCode, 2)
  }
})

async function resourceFixture() {
  const resourceRoot = path.join(root, randomUUID()); await fs.mkdir(path.join(resourceRoot, 'fonts'), { recursive: true })
  await fs.mkdir(path.join(resourceRoot, 'runtime'))
  const resources = []
  for (const family of ['sans', 'serif', 'mono', 'emoji']) for (const role of family === 'emoji' ? ['font', 'license', 'metadata'] : ['font', 'license']) {
    const bytes = Buffer.from(`${family}-${role}`), name = `${family}-${role}.bin`
    await fs.writeFile(path.join(resourceRoot, 'fonts', name), bytes)
    resources.push({ family, role, path: name, bytes: bytes.length, sha256: evidence.hash(bytes),
      sourceRevision: family === 'emoji' ? 'a'.repeat(40) : 'repository-baseline',
      sourceUrl: family === 'emoji' ? `https://raw.githubusercontent.com/google/fonts/${'a'.repeat(40)}/ofl/notoemoji/${name}` : null,
      ...(role === 'font' ? { weight: family === 'emoji' ? '300 700' : '100 900' } : {}) })
  }
  resources.sort((a, b) => a.path.localeCompare(b.path))
  await fs.writeFile(path.join(resourceRoot, 'fonts/source-lock.json'), JSON.stringify({ schemaVersion: 1, resources }))
  await fs.writeFile(path.join(resourceRoot, 'fonts/manifest.json'), JSON.stringify({ schemaVersion: 2,
    fonts: resources.map(({ sourceRevision, sourceUrl, ...item }) => item) }))
  const fonts = []
  for (const name of (await fs.readdir(path.join(resourceRoot, 'fonts'))).sort()) fonts.push({ path: `fonts/${name}`, ...await evidence.hashFile(path.join(resourceRoot, 'fonts', name)) })
  const layout = Buffer.from('{"schemaVersion":1,"components":{}}')
  await fs.writeFile(path.join(resourceRoot, 'runtime/text-layout.json'), layout)
  const manifest = { fontHash: evidence.hash(JSON.stringify(fonts)), textLayoutHash: evidence.hash(layout),
    files: [...fonts, { path: 'runtime/text-layout.json', bytes: layout.length, sha256: evidence.hash(layout) }] }
  await fs.writeFile(path.join(resourceRoot, 'manifest.json'), JSON.stringify(manifest))
  return { resourceRoot }
}
test('包字体锁闭包核对拒绝缺源锁、改字节和错误规则', async () => {
  const valid = await resourceFixture(); assert.equal(await evidence.verifyPackagedEffectResources(valid), true)
  for (const mutate of [
    async context => fs.unlink(path.join(context.resourceRoot, 'fonts/source-lock.json')),
    async context => fs.writeFile(path.join(context.resourceRoot, 'fonts/sans-font.bin'), 'changed'),
    async context => fs.unlink(path.join(context.resourceRoot, 'fonts/emoji-license.bin')),
    async context => fs.writeFile(path.join(context.resourceRoot, 'runtime/text-layout.json'), '{}'),
  ]) { const context = await resourceFixture(); await mutate(context); await assert.rejects(evidence.verifyPackagedEffectResources(context)) }
})
test('包内Player旧字体即使全包清单自洽仍拒绝与renderer混装', async () => {
  const context = await resourceFixture(); context.targetRoot = path.join(root, randomUUID())
  const frontend = 'resources/frontend/public/effects/fonts'
  await fs.cp(path.join(context.resourceRoot, 'fonts'), path.join(context.targetRoot, frontend), { recursive: true })
  const backend = 'resources/backend/app/services/effects/text-layout.generated.json'
  await fs.mkdir(path.dirname(path.join(context.targetRoot, backend)), { recursive: true })
  await fs.copyFile(path.join(context.resourceRoot, 'runtime/text-layout.json'), path.join(context.targetRoot, backend))
  const files = []
  for (const name of await fs.readdir(path.join(context.targetRoot, frontend))) {
    const identity = await evidence.hashFile(path.join(context.targetRoot, frontend, name))
    files.push({ path: `${frontend}/${name}`, sha256: identity.sha256, size: identity.bytes })
  }
  const layout = await evidence.hashFile(path.join(context.targetRoot, backend))
  files.push({ path: backend, sha256: layout.sha256, size: layout.bytes }); context.manifest = { files }
  assert.equal(await evidence.verifyPackagedEffectResources(context), true)
  const entry = files.find(file => file.path.endsWith('emoji-font.bin'))
  await fs.writeFile(path.join(context.targetRoot, entry.path), 'old bytes')
  const changed = await evidence.hashFile(path.join(context.targetRoot, entry.path))
  Object.assign(entry, { sha256: changed.sha256, size: changed.bytes })
  await assert.rejects(evidence.verifyPackagedEffectResources(context), /Player与renderer/)
})
test('补充向量拒绝缺帧、空文案、重复family及旧输入hash', () => {
  const { TEXT_VECTORS, FAMILIES, createTextVectorDocument } = require('./effects-text-vectors')
  const template = { id: 'title-rise', version: 1, defaults: { distance: 0.08 } }
  const entries = TEXT_VECTORS.flatMap(vector => FAMILIES.map(family => {
    const document = createTextVectorDocument(template, vector, family)
    return { case_id: vector.case_id, family, input_sha256: evidence.hash(JSON.stringify(document)),
      document, frames: [0, 29, 59].map(frame => ({ frame, png_a: `${vector.case_id}/${family}/${frame}-a.png`,
        png_b: `${vector.case_id}/${family}/${frame}-b.png`, mp4_frame: 'mp4.png', player_frame: 'player.png',
        renderer_font_usage: `r-${frame}.json`, player_font_usage: `p-${frame}.json` })) }
  }))
  assert.doesNotThrow(() => evidence.validateSupplementalVectors(entries, template))
  for (const change of [e => e.pop(), e => { e[0].frames.pop() }, e => { e[0].document.content.title = '' },
    e => { e[0].family = 'serif' }, e => { e[0].input_sha256 = '0'.repeat(64) },
    e => { delete e[0].frames[0].png_b }, e => { delete e[0].frames[0].player_frame },
    e => { delete e[0].frames[0].mp4_frame }, e => { e[0].frames[0].png_b = e[0].frames[0].png_a },
    e => { delete e[0].frames[1].renderer_font_usage },
  ]) { const mutated = structuredClone(entries); change(mutated); assert.throws(() => evidence.validateSupplementalVectors(mutated, template)) }
})

test('同一报告仅允许一个真实进程独占预留，终态也不可覆盖', async () => {
  const report = path.join(root, randomUUID(), 'report.json')
  await fs.mkdir(path.dirname(report), { recursive: true })
  const script = `const x=require(${JSON.stringify(require.resolve('./effects-release-evidence'))});x.reserveReport(process.argv[1]).then(()=>process.exit(0)).catch(()=>process.exit(1))`
  const run = () => new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', script, report], { windowsHide: true })
    child.once('exit', resolve)
  })
  assert.deepEqual((await Promise.all([run(), run()])).sort(), [0, 1])
  await assert.rejects(evidence.reserveReport(report))
})

test('空测量、自报 AC 和缺少附件不能证明场景通过', async () => {
  const report = evidence.createAcceptanceReport({ scenario: 'package', mode: 'unpacked' })
  report.steps.package = { status: 'pass', acceptance_ids: ['AC-42'],
    measurements: {}, attachments: [] }
  const result = await evidence.validateAcceptanceReport(report, { evidenceRoot: root })
  assert.equal(result.valid, false)
})

test('严格报告拒绝未知 AC、场景、非有限测量及越界附件', async () => {
  for (const mutate of [
    r => { r.steps.fake = {} },
    r => { r.steps.package.acceptance_ids = ['AC-99'] },
    r => { r.steps.package.measurements = { elapsed_ms: Infinity } },
    r => { r.steps.package.attachments = [{ role: 'identity_before', path: '../escape', bytes: 1, sha256: 'a'.repeat(64) }] },
  ]) {
    const report = evidence.createAcceptanceReport({ scenario: 'package', mode: 'unpacked' })
    report.steps.package = { status: 'blocked', acceptance_ids: [], measurements: {}, attachments: [], reason: '尚未安装' }
    mutate(report)
    assert.equal((await evidence.validateAcceptanceReport(report, { evidenceRoot: root })).valid, false)
  }
})

test('单场景 blocked 报告不能自报发行通过', async () => {
  const report = evidence.createAcceptanceReport({ scenario: 'package', mode: 'unpacked' })
  report.steps.package = { status: 'blocked', acceptance_ids: [], measurements: {}, attachments: [], reason: '缺少真实包' }
  report.release_ready = true
  assert.equal((await evidence.validateAcceptanceReport(report, { evidenceRoot: root })).valid, false)
})

test('安装树逐文件核对拒绝缺件、被改文件和未声明依赖', async () => {
  const installed = path.join(root, randomUUID(), 'installed')
  await fs.mkdir(installed, { recursive: true })
  const filename = path.join(installed, 'Ecliptrix.exe')
  await fs.writeFile(filename, 'package')
  const identity = await evidence.hashFile(filename)
  const manifest = { files: [{ path: 'Ecliptrix.exe', size: identity.bytes, sha256: identity.sha256 }] }
  assert.deepEqual(await evidence.verifyInstalledTree(installed, manifest), [])
  await fs.writeFile(filename, 'changed')
  await assert.rejects(evidence.verifyInstalledTree(installed, manifest), /不匹配/)
  await fs.writeFile(filename, 'package')
  await fs.writeFile(path.join(installed, 'injected.dll'), 'not declared')
  await assert.rejects(evidence.verifyInstalledTree(installed, manifest), /未声明/)
  await fs.unlink(path.join(installed, 'injected.dll'))
  await fs.unlink(filename)
  await assert.rejects(evidence.verifyInstalledTree(installed, manifest), /缺少/)
})

test('错误源码的回归证据不可借其它场景通过', async () => {
  const report = evidence.createAcceptanceReport({ scenario: 'package', mode: 'unpacked' })
  report.steps.package = { status: 'blocked', acceptance_ids: [], measurements: {}, attachments: [], reason: '缺少真实包' }
  report.regression = { status: 'pass', source_head: 'b'.repeat(40), attachment: 'other.json' }
  const result = await evidence.validateAcceptanceReport(report, { evidenceRoot: root })
  assert.equal(result.valid, false)
  assert.match(result.errors[0], /其它提交/)
})

test('封存只替换本次 running 预留，异体篡改不能封存', async () => {
  const target = path.join(root, randomUUID(), 'report.json')
  const reserved = await evidence.reserveReport(target)
  await fs.writeFile(target, 'another owner')
  await assert.rejects(reserved.finalize({ passed: true }), /身份已改变/)
  assert.equal(await fs.readFile(target, 'utf8'), 'another owner')
})

test('固定映射覆盖全部66项且没有重复或未知 AC', () => {
  const ids = [...Object.keys(evidence.REGRESSION_BINDINGS), ...Object.keys(evidence.ACS).flatMap(evidence.acIds)]
  assert.equal(ids.length, 66)
  assert.equal(new Set(ids).size, 66)
  for (let number = 1; number <= 66; number++) assert.ok(ids.includes(`AC-${String(number).padStart(2, '0')}`))
  assert.ok(evidence.acIds('agent').includes('AC-46'))
  assert.ok(!evidence.acIds('performance').includes('AC-46'))
  assert.ok(evidence.acIds('visual').includes('AC-54'))
  assert.ok(evidence.REGRESSION_BINDINGS['AC-37'].includes('put_only_replays_exact_expected_plus_one'))
  assert.ok(evidence.REGRESSION_BINDINGS['AC-38'].some(name => name.includes('单坏任务')))
  assert.ok(evidence.REGRESSION_BINDINGS['AC-51'].some(name => name.includes('十秒独立超时')))
})

test('发行派生能接受全部66项完成的干净安装验收，缺任一门禁即拒绝', () => {
  const report = evidence.createAcceptanceReport({ scenario: 'all', mode: 'installed', installerSha256: 'a'.repeat(64) })
  report.steps = Object.fromEntries(evidence.SCENARIOS.map(name => [name, { status: 'pass' }]))
  report.regression = { status: 'pass' }
  report.acceptance_results = Object.fromEntries(Array.from({ length: 66 }, (_, index) => [`AC-${String(index + 1).padStart(2, '0')}`, { status: 'pass' }]))
  assert.equal(evidence.deriveReleaseReady(report, { manifest: { dirty: false } }), true)
  assert.equal(evidence.deriveReleaseReady(report, { manifest: { dirty: true } }), false)
  report.acceptance_results['AC-13'].status = 'blocked'
  assert.equal(evidence.deriveReleaseReady(report, { manifest: { dirty: false } }), false)
})

test('原始进程残留不能被汇总零值掩盖', () => {
  const step = { measurements: { residual_processes: 0, max_exit_ms: 1 } }
  const records = new Map([['process_trace', [{ cases: [{ processes: [{ pid: 1, started_at: new Date().toISOString() }], residual_processes: 2, exit_ms: 1 }] }]]])
  assert.throws(() => evidence.assertScenarioMetrics('process', step, records), /residual_processes/)
})

test('性能自报快速数值不能掩盖缺失的冷/热原始样本', () => {
  const step = { measurements: { template_interaction_ms: 1, input_response_ms: 1, render_30s_ms: 1, peak_working_set_bytes: 100 } }
  const records = new Map([['raw_samples', [{ samples: [] }]]])
  assert.throws(() => evidence.assertScenarioMetrics('performance', step, records), /原始采样/)
})

test('Agent 布尔成功不能替代真实工具与 provider 记录', () => {
  assert.throws(() => evidence.assertAgentEvidence(new Map([['tool_trace', [{ provider_calls: 0, traces: [] }]]])), /provider_calls/)
})

test('回归日志先脱敏，JUnit绑定保留实际测试名并拒绝外部实体', () => {
  const cli = require('../effects-acceptance')
  const secret = 'private'.repeat(5)
  assert.ok(!cli.scrubLog(`Authorization: Bearer ${secret}\napi_key=${secret}`).includes(secret))
  const cases = cli.parseJunitCases('<testsuite><testcase classname="tests.effects" name="test_replay" /></testsuite>')
  assert.deepEqual(cases, [{ name: 'tests.effects::test_replay', status: 'pass' }])
  assert.throws(() => cli.parseJunitCases('<!DOCTYPE anything>'))
})

test('报告不能绑定其它安装器，即使所有场景自报blocked', async () => {
  const report = evidence.createAcceptanceReport({ scenario: 'package', mode: 'installed' })
  report.steps.package = { status: 'blocked', acceptance_ids: [], measurements: {}, attachments: [], reason: '尚未实装' }
  const manifest = { source_head: report.source_head, package_id: report.package_id,
    installer: { sha256: 'f'.repeat(64) } }
  assert.equal((await evidence.validateAcceptanceReport(report, { evidenceRoot: root, manifest })).valid, false)
})

test('缺少72组真实矩阵不能靠sample_frames自报360通过', async () => {
  const records = new Map([['matrix_index', [{ entries: [] }]]])
  await assert.rejects(evidence.assertVisual(records, { measurements: { sample_frames: 360 } }, [], {}), /72/)
})

test('任意PNG的hash与自报零MAE不能冒充固定1920画布', async () => {
  const directory = path.join(root, randomUUID())
  await fs.mkdir(directory, { recursive: true })
  const catalog = require('../../../src/lib/effects/catalog.json')
  const visual = require('./effects-visual-acceptance')
  const document = visual.fixtureDocument(catalog.templates[0], [1920, 1080])
  const inputHash = evidence.hash(JSON.stringify(document))
  const context = { evidenceRoot: directory,
    resourceRoot: directory }
  await fs.writeFile(path.join(directory, 'catalog.json'), JSON.stringify(catalog))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg==', 'base64')
  const attachments = []
  for (const filename of ['a.png', 'b.png', 'mp4.png', 'player.png', 'mask.png']) {
    attachments.push(await evidence.writeAttachment(context, 'frame_pair', filename, png))
  }
  const caseId = `${catalog.templates[0].id}:1920x1080`
  const record = { schema_version: 1, case_id: caseId, input_sha256: inputHash }
  attachments.push(await evidence.writeAttachment(context, 'fixture_document', 'document.json', { ...record, document }))
  attachments.push(await evidence.writeAttachment(context, 'video', 'video.mp4', Buffer.from('not a render')))
  attachments.push(await evidence.writeAttachment(context, 'media_probe', 'probe.json', { ...record,
    probe: { streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920,
      height: 1080, r_frame_rate: '30/1', nb_read_frames: '60' }] } }))
  attachments.push(await evidence.writeAttachment(context, 'layout', 'layout.json', { ...record }))
  attachments.push(await evidence.writeAttachment(context, 'layout', 'metrics.json', { ...record }))
  const frames = visual.FRAMES.map(frame => ({ frame, png_a: 'a.png', png_b: 'b.png',
    mp4_frame: 'mp4.png', player_frame: 'player.png', mask: 'mask.png', player_mask: 'mask.png',
    layout: 'layout.json', metrics: 'metrics.json', png_equal: true, rgba_equal: true,
    mp4_flat_mae: 0, player_flat_mae: 0, layout_error_css_px: 0, layout_lines_match: true }))
  const entries = catalog.templates.flatMap(template => visual.CANVASES.map(([width, height]) => ({
    case_id: `${template.id}:${width}x${height}`, template_id: template.id, width, height,
    input_sha256: inputHash, document: 'document.json', video: 'video.mp4', probe: 'probe.json', frames })))
  const records = new Map([['matrix_index', [{ entries }]]])
  await assert.rejects(evidence.assertVisual(records,
    { measurements: { sample_frames: 360 } }, attachments, context), /PNG 尺寸/)
})

test('visual→desktop→agent顺序准备使用独占输入路径，保留已有证据', async () => {
  const visual = require('./effects-visual-acceptance')
  const evidenceRoot = path.join(root, randomUUID())
  const paths = []
  for (const scenario of ['visual', 'desktop', 'agent']) {
    const current = await visual.allocateFixturePaths({ evidenceRoot })
    assert.ok(evidence.inside(evidenceRoot, current.image))
    assert.ok(evidence.inside(evidenceRoot, current.video))
    await fs.writeFile(current.image, `immutable-${scenario}`, { flag: 'wx' })
    paths.push({ scenario, ...current })
  }
  assert.equal(new Set(paths.map(current => current.directory)).size, 3)
  for (const current of paths) assert.equal(await fs.readFile(current.image, 'utf8'), `immutable-${current.scenario}`)
})

test('真实客户端撤销入口可通过证据校验，不依赖不存在的LLM撤销工具', async () => {
  const source = await fs.readFile(path.resolve('src/components/video/components/VideoChatWindow/timeline/AgentResponseNode.tsx'), 'utf8')
  assert.match(source, /onClick=\{handleUndoAll\}/)
  assert.match(source, /t\.agentTimeline\.undoAll/)
  const baseline = [{ items: [] }]
  const timeline = [{ items: [{ metadata: { effects: {} } }] }]
  const trace = { provider_calls: 6, traces: [
    { type: 'tool_call', toolName: 'explore_tools' },
    { type: 'tool_call', toolName: 'get_effect_template' },
    { type: 'tool_result', toolName: 'create_effect_draft', result: { status: 'unknown', success: false } },
    { type: 'tool_result', toolName: 'render_effect', result: { status: 'unknown', success: false } },
    { type: 'tool_result', toolName: 'apply_effect_asset', toolCallId: 'apply-1', result: { state: 'applied', operationId: 'operation-1' } },
  ], faults: { requests: [
    { method: 'POST', path: '/drafts', body: { draft_id: 'stable-draft' } },
    { method: 'POST', path: '/jobs', body: { request_id: 'stable-request' } },
  ] }, baseline, timeline, after_stop: baseline, stopped_job_result: { status: 'cancelled' },
  undo: { source: 'client.undoAllOperations', operation_id: 'operation-1', tool_call_id: 'apply-1',
    control: { label: 'Undo all' }, before: timeline, after: baseline } }
  const records = new Map(['tool_trace', 'provider_record', 'apply_receipt', 'undo_record'].map(role => [role, [trace]]))
  assert.doesNotThrow(() => evidence.assertAgentEvidence(records))
  trace.undo.operation_id = 'different-operation'
  assert.throws(() => evidence.assertAgentEvidence(records), /真实回执/)
})

test('桌面键盘/字体/双页不能由happy path代领AC，实际回归启用冷启动case', () => {
  for (const caseId of ['close-keyboard', 'font-retry', 'editor-lease']) assert.ok(evidence.CASES.desktop.includes(caseId))
  const cli = require('../effects-acceptance')
  const runtime = cli.regressionCommands(process.cwd(), root).find(command => command.id === 'runtime-tests')
  assert.equal(runtime.env.EFFECTS_REAL_RUNTIME_TEST, '1')
  assert.equal(runtime.env.EFFECTS_MANIFEST_STARTUP_TEST, '1')
})

test('关闭Response拦截后，真实Chromium的保存和FontFace请求仍触发Request故障', {
  skip: !syncFs.existsSync(path.resolve('desktop/build/effects/browser/chrome-headless-shell.exe')),
  timeout: 20000,
}, async () => {
  const ui = require('./effects-desktop-acceptance')
  const { connectCdp } = require('../smoke-test')
  const { cleanEnvironment } = require('./effects-release-evidence')
  const directory = path.join(root, randomUUID())
  await fs.mkdir(directory, { recursive: true })
  const server = http.createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<html><body>Fetch contract</body></html>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const child = spawn(path.resolve('desktop/build/effects/browser/chrome-headless-shell.exe'),
    ['--headless', '--no-sandbox', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${directory}`, 'about:blank'],
  { cwd: directory, windowsHide: true, env: cleanEnvironment(), stdio: ['ignore', 'ignore', 'pipe'] })
  let diagnostics = ''; let cdp
  child.stderr.on('data', chunk => { diagnostics += chunk.toString() })
  try {
    const endpoint = await ui.until('Chromium CDP', () => /DevTools listening on (ws:\/\/\S+)/.exec(diagnostics)?.[1], 10000)
    const targets = await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()
    cdp = await connectCdp(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    assert.equal(await cdp.evaluate('location.origin'), 'null')
    await cdp.send('Page.enable')
    const navigation = await cdp.send('Page.navigate', { url: origin })
    assert.equal(navigation.errorText, undefined)
    // The debugging endpoint is ready before a page necessarily commits.
    // Keep the fixture same-origin rather than masking the race with CORS.
    await ui.until('同源fixture文档已提交', async () => {
      try {
        return await cdp.evaluate(`location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'&&document.body?.textContent==='Fetch contract'`)
      } catch (error) {
        if (/Execution context was destroyed|Cannot find (?:default execution )?context/i.test(error.message)) return false
        throw error
      }
    }, 10000)
    assert.equal(await cdp.evaluate('location.origin'), origin)
    const received = []
    cdp.on('Fetch.requestPaused', event => {
      const name = new URL(event.request.url).pathname
      if (name === '/drafts') { received.push('save'); void cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 500, body: '' }) }
      else if (name === '/effects/fonts/font.ttf') { received.push('font'); void cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' }) }
      else void cdp.send('Fetch.continueRequest', { requestId: event.requestId })
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] })
    await cdp.send('Fetch.disable')
    await ui.restoreRequestInterception({ cdp })
    const status = await cdp.evaluate(`fetch('${origin}/drafts',{method:'POST',body:'{}'}).then(r=>r.status)`)
    assert.equal(status, 500)
    await cdp.evaluate(`new FontFace('failure',"url('${origin}/effects/fonts/font.ttf')").load().catch(()=>true)`)
    assert.deepEqual(received, ['save', 'font'])
  } finally {
    if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.close() }
    if (child.exitCode === null) child.kill()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
})
