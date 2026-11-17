'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面验收沿用既有 CommonJS，并由包内 Electron Node 执行。 */

const fs = require('node:fs/promises')
const syncFs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { verifyPackageManifest } = require('./research-release-evidence')

/** Preload into controller and nested child; dependencies must stay in the target. */
function installModuleBoundary(targetRoot) {
  const Module = require('node:module')
  const original = Module._resolveFilename
  const runtime = path.join(path.resolve(targetRoot), 'resources/effects/runtime')
  const scripts = path.resolve(__dirname, '..')
  Module._resolveFilename = function (request, parent, ...rest) {
    const resolved = original.call(this, request, parent, ...rest)
    if (Module.isBuiltin(resolved) || request === 'electron' && resolved === 'electron') return resolved
    const isTool = inside(scripts, resolved) && !resolved.includes('node_modules')
    const fromRuntime = parent?.filename && inside(runtime, parent.filename)
    requireThat(isTool || inside(fromRuntime ? runtime : targetRoot, resolved),
      `拒绝目标包外被测模块: ${resolved}`)
    return resolved
  }
}
if (process.env.EFFECTS_ACCEPTANCE_TARGET_ROOT) {
  installModuleBoundary(process.env.EFFECTS_ACCEPTANCE_TARGET_ROOT)
}

const SCENARIOS = ['package', 'visual', 'desktop', 'process', 'performance', 'agent']
const HEX = /^[a-f0-9]{64}$/
const ROLES = {
  package: ['identity_before', 'identity_after', 'runtime_smoke'],
  visual: ['matrix_index', 'frame_pair', 'player_frame', 'layout', 'media_probe', 'audio_metrics'],
  desktop: ['action_trace', 'save_reopen', 'export_request', 'video', 'media_probe', 'network_log'],
  process: ['process_trace'], performance: ['raw_samples', 'device_record'],
  agent: ['tool_trace', 'provider_record', 'apply_receipt', 'undo_record'],
}
const CASES = {
  package: ['tree-before', 'tree-after', 'runtime-render', 'runtime-cancel', 'runtime-parent-loss', 'dependency-boundary'],
  desktop: ['entry-main', 'entry-material', 'entry-toolbar', 'entry-clip', 'cancel', 'undo', 'redo', 'save-reopen', 'replace-preserves-edits', 'detached-audio', 'locked-track', 'cover', 'multi-select', 'project-switch', 'lost-save', 'lost-submit', 'close-keyboard', 'font-retry', 'editor-lease', 'final-export', 'runtime-unavailable-export', 'deleted-draft-export'],
  process: ['close', 'kill-main', 'kill-controller', 'restart-backend'],
  performance: ['cold', 'warm', 'previews-48', 'player-first-frame', 'input', 'render-30s', 'working-set'],
  agent: ['provider', 'progressive-schema', 'unknown-replay', 'stop', 'apply-receipt', 'undo'],
}
const ACS = {
  package: [22, 23, 42, 45, 55, 56],
  visual: [1, 2, 3, 5, 11, 43, 54],
  desktop: [6, 7, 8, 14, 15, 16, 17, 19, 24, 28, 35, 36, 39, 40, 44, 47, 48, 49, 52],
  process: [25, 31, 41, 53], performance: [], agent: [20, 21, 29, 46, 50],
}
const REGRESSION_BINDINGS = {
  'AC-04': ['invalid_structure_is_rejected_even_for_draft', '拒绝未知参数、额外字段和非有限数值'],
  'AC-09': ['project_quota_and_replay_order', 'concurrent_duplicate_and_cross_project_global_quota'],
  'AC-10': ['concurrent_duplicate_and_cross_project_global_quota', 'cancel_between_select_and_claim'],
  'AC-12': ['queued_cancel_is_terminal', 'real_worker_publish_restart_recovery_and_cancel'],
  'AC-13': ['real_worker_publish_restart_recovery_and_cancel', 'recovery_rechecks_job_after_waiting_for_project_lock'],
  'AC-18': ['real_image_snapshot_deduplicates_and_survives_source_deletion'],
  'AC-26': ['project_closing_blocks_every_writer', 'project_delete_removes_effect_rows'],
  'AC-27': ['replay_survives_draft_change_soft_delete_and_runtime_loss', 'concurrent_duplicate_and_cross_project_global_quota'],
  'AC-30': ['incomplete_draft_is_savable_but_not_renderable', 'incomplete_draft_never_creates_job'],
  'AC-32': ['project_deleted_during_staging_never_creates_formal_assets', 'failed_delete_keeps_files'],
  'AC-33': ['real_fastapi_envelopes_cas_etag_and_quota_headers'],
  'AC-34': ['binding_requires_kind_and_forbids_image_trim', 'missing_kind_cross_project_and_remote_boundaries'],
  'AC-37': ['create_replay_preserves_one_row_and_version', 'put_only_replays_exact_expected_plus_one', 'concurrent_identical_put_advances_once'],
  'AC-38': ['单坏任务不会丢弃其它本轮进度，也不会等挂起任务', '取消立即使旧GET失效且重复取消不会重复请求', '翻页失败保留原cursor并同页重试合并去重'],
  'AC-51': ['挂起GET在十秒独立超时释放且不伪造终态', '取消失败保留卡片并恢复局部轮询', '同项目重查列表后旧分页不能推进新cursor链'],
}
const acIds = name => ACS[name].map(id => `AC-${String(id).padStart(2, '0')}`)
const REPORT_KEYS = ['schema_version', 'run_id', 'requested_scenario', 'source_head', 'package_id', 'manifest_sha256', 'runtime_fingerprint', 'catalog_hash', 'font_hash', 'bundle_hash', 'installer_sha256', 'mode', 'started_at', 'finished_at', 'steps', 'regression', 'acceptance_results', 'release_ready']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const selectedScenarios = scenario => scenario === 'all' ? SCENARIOS : [scenario]
function requireThat(value, message) { if (!value) throw new Error(message) }
function fields(value, allowed, required = allowed) {
  requireThat(object(value), '报告对象无效')
  requireThat(Object.keys(value).every(key => allowed.includes(key)), '报告包含未知字段')
  requireThat(required.every(key => Object.hasOwn(value, key)), '报告缺少字段')
}
function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
function relativePath(name) {
  requireThat(typeof name === 'string' && name && !/[\\:\u0000-\u001f]/.test(name), '附件路径必须相对本次证据根')
  requireThat(name.split('/').every(part => part && part !== '.' && part !== '..' && !/[ .]$/.test(part)), '附件路径越界或含歧义')
  return name
}
function utc(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), '必须使用 UTC 时间')
  return Date.parse(value)
}

/** Reject links in every path component, including parents of the selected root. */
async function checkedPath(target) {
  const absolute = path.resolve(target)
  const volume = path.parse(absolute).root
  let current = volume
  for (const part of path.relative(volume, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const stat = await fs.lstat(current)
    requireThat(!stat.isSymbolicLink(), '不允许 symlink / Junction')
    requireThat((await fs.realpath(current)).toLowerCase() === current.toLowerCase(), '真实路径与目标不符')
  }
  return absolute
}

/** Stream a stable file; media attachments need not fit in memory. */
async function hashFile(target) {
  await checkedPath(target)
  const before = await fs.stat(target)
  requireThat(before.isFile(), '附件必须是普通文件')
  const digest = crypto.createHash('sha256')
  for await (const chunk of syncFs.createReadStream(target)) digest.update(chunk)
  const after = await fs.stat(target)
  requireThat(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino, '文件在散列期间发生变化')
  return { bytes: after.size, sha256: digest.digest('hex') }
}

/** Reserve once. Only this run may atomically replace its running marker. */
async function reserveReport(target, runId = crypto.randomUUID()) {
  const absolute = path.resolve(target)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await checkedPath(path.dirname(absolute))
  const marker = JSON.stringify({ schema_version: 1, run_id: runId,
    state: 'running', release_ready: false }) + '\n'
  await fs.writeFile(absolute, marker, { flag: 'wx' })
  const partial = `${absolute}.partial.${runId}`
  const writeProgress = value => fs.writeFile(partial, JSON.stringify(value, null, 2) + '\n')
  return { runId, target: absolute, partial,
    async progress(value) { await writeProgress(value) },
    async finalize(value) {
      requireThat(await fs.readFile(absolute, 'utf8') === marker, '报告预留身份已改变')
      await writeProgress(value)
      await fs.rename(partial, absolute)
    } }
}

/** Reports may start blocked; pass is derived later from independently read evidence. */
function createAcceptanceReport(options) {
  const now = new Date().toISOString()
  return { schema_version: 1, run_id: options.runId || crypto.randomUUID(),
    requested_scenario: options.scenario, source_head: options.sourceHead || '0'.repeat(40),
    package_id: options.packageId || '0'.repeat(64),
    manifest_sha256: options.manifestSha256 || '0'.repeat(64),
    runtime_fingerprint: options.runtimeFingerprint || '0'.repeat(64),
    catalog_hash: options.catalogHash || '0'.repeat(64),
    font_hash: options.fontHash || '0'.repeat(64),
    bundle_hash: options.bundleHash || '0'.repeat(64),
    installer_sha256: options.installerSha256 || null,
    mode: options.mode, started_at: now, finished_at: now,
    steps: {}, acceptance_results: {}, release_ready: false }
}

/** All structured evidence binds run, package, source and a deterministic input. */
function bindRecord(report, values) {
  return { schema_version: 1, run_id: report.run_id,
    source_head: report.source_head, package_id: report.package_id, ...values }
}
async function writeAttachment(context, role, name, value) {
  relativePath(name)
  const target = path.join(context.evidenceRoot, name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (value !== undefined) await fs.writeFile(target,
    Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  const identity = await hashFile(target)
  return { role, path: name, ...identity }
}
async function readAttachment(context, entry) {
  fields(entry, ['role', 'path', 'bytes', 'sha256'])
  relativePath(entry.path)
  requireThat(typeof entry.role === 'string' && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && HEX.test(entry.sha256), '附件身份无效')
  const target = path.join(context.evidenceRoot, entry.path)
  requireThat(inside(context.evidenceRoot, target), '附件越界')
  const actual = await hashFile(target)
  requireThat(actual.bytes === entry.bytes && actual.sha256 === entry.sha256, '附件已改变')
  if (/\.(json|jsonl)$/.test(entry.path)) {
    requireThat(entry.bytes <= 32 * 1024 * 1024, '结构化附件过大')
    return JSON.parse(await fs.readFile(target, 'utf8'))
  }
  return undefined
}
function assertBound(record, report) {
  requireThat(object(record) && record.schema_version === 1
    && record.run_id === report.run_id && record.source_head === report.source_head
    && record.package_id === report.package_id, '附件运行或源码身份不匹配')
}
function assertCases(record, required) {
  requireThat(Array.isArray(record.cases), '缺少实际用例集合')
  const ids = record.cases.map(entry => entry.case_id)
  requireThat(new Set(ids).size === ids.length, '用例重复')
  for (const id of required) requireThat(ids.includes(id), `缺少用例 ${id}`)
  requireThat(ids.every(id => required.includes(id)), '未知用例不构成固定验收集合')
  for (const entry of record.cases) requireThat(typeof entry.case_id === 'string'
    && HEX.test(entry.input_sha256) && entry.status === 'pass', '用例未运行或输入身份无效')
}
function assertMetrics(step) {
  requireThat(object(step.measurements), '测量必须为对象')
  for (const value of Object.values(step.measurements)) requireThat(
    ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value), '测量数值必须有限')
}
function requireNumber(record, key, predicate) {
  requireThat(typeof record[key] === 'number' && Number.isFinite(record[key]) && predicate(record[key]), `测量 ${key} 不符合固定门禁`)
}
function assertScenarioMetrics(name, step, records) {
  const measurements = step.measurements
  if (name === 'package') {
    requireNumber(measurements, 'development_modules_loaded', value => value === 0)
    requireThat(measurements.trees_match === true && measurements.dependencies_complete === true, '包树或依赖闭包不完整')
  }
  if (name === 'process') {
    requireNumber(measurements, 'residual_processes', value => value === 0)
    requireNumber(measurements, 'max_exit_ms', value => value <= 12000)
    const cases = records.get('process_trace')[0].cases
    for (const entry of cases) {
      requireThat(Array.isArray(entry.processes) && entry.processes.length > 0
        && entry.processes.every(p => Number.isInteger(p.pid) && utc(p.started_at)), '缺少实际进程身份')
      requireNumber(entry, 'residual_processes', value => value === 0)
      requireNumber(entry, 'exit_ms', value => value >= 0 && value <= 12000)
    }
    requireThat(measurements.max_exit_ms === Math.max(...cases.map(entry => entry.exit_ms)), '进程汇总与实际用例不一致')
  }
  if (name === 'performance') {
    for (const [key, limit] of Object.entries({ template_interaction_ms: 300,
      input_response_ms: 150, render_30s_ms: 180000 })) requireNumber(measurements, key, value => value >= 0 && value <= limit)
    requireNumber(measurements, 'peak_working_set_bytes', value => value > 0 && value < 2000000000)
    const samples = records.get('raw_samples')[0].samples
    requireThat(Array.isArray(samples) && samples.length === 2
      && new Set(samples.map(sample => sample.temperature)).size === 2
      && samples.every(sample => ['cold', 'warm'].includes(sample.temperature)
        && sample.previews_count === 48 && sample.render_frames === 900
        && Array.isArray(sample.workingSets) && sample.workingSets.length > 0), '缺少冷/热/30秒原始采样')
    for (const key of ['template_interaction_ms', 'input_response_ms', 'render_30s_ms', 'peak_working_set_bytes']) requireThat(
      measurements[key] === Math.max(...samples.map(sample => sample[key])), '性能汇总与原始样本不一致')
    for (const sample of samples) requireThat(sample.peak_working_set_bytes === Math.max(...sample.workingSets.map(snapshot => {
      utc(snapshot.time)
      requireThat(snapshot.processes.length > 0 && snapshot.processes.every(entry => entry.working_set_bytes > 0), '工作集采样缺失')
      return snapshot.processes.reduce((sum, entry) => sum + entry.working_set_bytes, 0)
    })), '总峰值工作集与所属进程采样不一致')
  }
  if (name === 'desktop') {
    requireNumber(measurements, 'degradations', value => value === 0)
    requireThat(measurements.codec === 'h264' && measurements.pixel_format === 'yuv420p' && measurements.fps === 30, '真实导出格式无效')
    requireNumber(measurements, 'max_av_error_seconds', value => value <= 1 / 30)
    requireNumber(measurements, 'gain_ratio_error', value => value <= 0.05)
  }
  if (name === 'agent') requireThat(measurements.real_provider === true
    && measurements.progressive_schema === true && measurements.stop_applied === false
    && measurements.undo_restored === true, '缺少真实 Agent 交互证据')
}
async function assertDesktopEvidence(step, records, context) {
  const actions = records.get('action_trace')[0].cases
  const proof = id => actions.find(entry => entry.case_id === id)?.proof
  const keyboard = proof('close-keyboard')
  requireThat(keyboard?.tab_samples?.length === 6 && keyboard.tab_samples.every(sample => sample.inside)
    && keyboard.ime_escape_preserved && keyboard.ime_undo_preserved
    && keyboard.save_500_preserved && keyboard.error_summary_focused, '缺少真实Electron确认层键盘/IME/保存故障用例')
  const font = proof('font-retry')
  requireThat(font?.failed_url?.startsWith('/effects/fonts/') && font.same_url_retry_count >= 1
    && font.preview_recovered && font.jobs_unchanged && font.drafts_unchanged
    && font.timeline_unchanged && font.history_controls_unchanged, '缺少真实FontFace失败后同URL重试')
  const lease = proof('editor-lease')
  requireThat(lease?.page_count === 2 && lease.held_before === 1 && lease.denied_writes === 0
    && lease.reacquired && lease.accepted_writes >= 1, '缺少真实双页Web Locks租约/交接用例')
  requireThat(records.get('network_log')[0].requests.every(request => request.local), '安装场景尝试访问非本地资源')
  const exported = records.get('export_request')[0]
  const declared = records.get('media_probe').find(record => record.case_id === 'final-export')
  const video = step.attachments.find(entry => entry.role === 'video' && entry.path === 'desktop/export-final.mp4')
  requireThat(video && exported.case_id === 'final-export' && declared.input_sha256 === exported.input_sha256
    && hash(JSON.stringify(exported.request)) === exported.input_sha256, '导出请求、成品与探测身份不一致')
  const result = await runProgram(context.ffprobe, ['-v', 'error', '-count_frames',
    '-show_streams', '-show_format', '-of', 'json', path.join(context.evidenceRoot, video.path)],
  { cwd: context.evidenceRoot, timeoutMs: 30000 })
  requireThat(result.exit_code === 0, '独立成品 ffprobe 失败')
  const actual = JSON.parse(result.stdout)
  const stream = actual.streams.find(entry => entry.codec_type === 'video')
  const saved = declared.probe.streams.find(entry => entry.codec_type === 'video')
  for (const key of ['codec_name', 'pix_fmt', 'width', 'height', 'r_frame_rate', 'nb_read_frames']) requireThat(stream[key] === saved[key], '导出探测自报值与媒体不符')
  requireThat(step.measurements.codec === stream.codec_name && step.measurements.pixel_format === stream.pix_fmt
    && step.measurements.fps === Number(stream.r_frame_rate.split('/')[0]) / Number(stream.r_frame_rate.split('/')[1])
    && step.measurements.degradations === exported.degradations.length, '导出汇总与真实探测不符')
  const record = records.get('audio_metrics')?.[0]
  requireThat(record && record.input_sha256 === exported.input_sha256, '缺少本次最终导出的校准音频证据')
  const audio = await runProgram(context.python, ['-B', '-X', 'utf8', path.join(__dirname, 'effects_metrics.py'),
    'audio', '--audio', await checkedPath(path.join(context.evidenceRoot, relativePath(record.audio))),
    '--gain', '0.5', '--start-time', String(record.audio_start_time), '--expected', JSON.stringify(record.expected)],
  { cwd: context.evidenceRoot, timeoutMs: 30000 })
  requireThat(audio.exit_code === 0, '最终导出音频脉冲独立复核失败')
  const metrics = JSON.parse(audio.stdout)
  const reference = await runProgram(context.python, ['-B', '-X', 'utf8', path.join(__dirname, 'effects_metrics.py'),
    'audio', '--audio', await checkedPath(path.join(context.evidenceRoot, relativePath(record.reference))), '--gain', '1', '--expected', '[0,1,2,3,4,5]'],
  { cwd: context.evidenceRoot, timeoutMs: 30000 })
  requireThat(reference.exit_code === 0, '校准参考音频复核失败')
  const peak = JSON.parse(reference.stdout).peaks[2].peak
  const gain = Math.max(...metrics.peaks.map((entry, index) => Math.abs(entry.peak / peak - (index < 4 ? 0.5 : 1)) / (index < 4 ? 0.5 : 1)))
  requireThat(step.measurements.max_av_error_seconds === metrics.max_av_error_seconds
    && step.measurements.gain_ratio_error === gain, '音频汇总来自自报数值')
}
function assertAgentEvidence(records) {
  const trace = records.get('tool_trace')[0]
  requireNumber(trace, 'provider_calls', value => value >= 6)
  const calls = trace.traces.filter(event => event.type === 'tool_call')
  const results = trace.traces.filter(event => event.type === 'tool_result')
  requireThat(calls.findIndex(event => event.toolName === 'explore_tools') >= 0
    && calls.findIndex(event => event.toolName === 'get_effect_template') > calls.findIndex(event => event.toolName === 'explore_tools'), '真实 trace 缺少渐进披露')
  for (const tool of ['create_effect_draft', 'render_effect']) requireThat(results.some(event => event.toolName === tool
    && event.result?.status === 'unknown' && event.result?.success === false), '真实 trace 缺少未知写入')
  const creations = trace.faults.requests.filter(entry => entry.method === 'POST' && entry.path.endsWith('/drafts'))
  const renders = trace.faults.requests.filter(entry => entry.method === 'POST' && entry.path.endsWith('/jobs'))
  requireThat(creations.length > 0 && renders.length > 0
    && creations.every(entry => JSON.stringify(entry.body) === JSON.stringify(creations[0].body))
    && renders.every(entry => JSON.stringify(entry.body) === JSON.stringify(renders[0].body)), '真实故障请求没有保持冻结体')
  const applied = results.find(event => /apply_effect/.test(event.toolName) && ['applied', 'noop'].includes(event.result?.state))
  requireThat(applied
    && trace.undo?.source === 'client.undoAllOperations'
    && typeof trace.undo.operation_id === 'string' && typeof trace.undo.tool_call_id === 'string'
    && trace.undo.tool_call_id === applied.toolCallId
    && trace.undo.operation_id === (applied.result.operationId || applied.toolCallId)
    && /^(Undo all|撤销本轮)$/.test(trace.undo.control?.label)
    && trace.undo.before.some(track => track.items.some(item => item.metadata?.effects))
    && !trace.undo.after.some(track => track.items.some(item => item.metadata?.effects))
    && trace.timeline.some(track => track.items.some(item => item.metadata?.effects))
    && JSON.stringify(trace.baseline) === JSON.stringify(trace.after_stop)
    && trace.stopped_job_result?.status === 'cancelled', '真实回执、撤销或Stop证据缺失')
  for (const role of ['provider_record', 'apply_receipt', 'undo_record']) requireThat(
    JSON.stringify(records.get(role)?.[0]?.undo) === JSON.stringify(trace.undo), 'Agent角色附件没有绑定同一真实撤销')
}
async function readPngDimensions(context, relative) {
  const filename = await checkedPath(path.join(context.evidenceRoot, relative))
  const handle = await fs.open(filename, 'r')
  const header = Buffer.alloc(24)
  try { await handle.read(header, 0, 24, 0) } finally { await handle.close() }
  requireThat(header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && header.toString('ascii', 12, 16) === 'IHDR', 'PNG 附件不是有效图像')
  return [header.readUInt32BE(16), header.readUInt32BE(20)]
}
async function verifyImageMetrics(context, reference, repeated, candidate, mask, player = false) {
  requireThat(context.python, '像素 verifier 缺少包内 Python')
  const args = ['-B', '-X', 'utf8', path.join(__dirname, 'effects_metrics.py'), 'compare',
    '--reference', path.join(context.evidenceRoot, reference),
    '--repeated', path.join(context.evidenceRoot, repeated),
    '--candidate', path.join(context.evidenceRoot, candidate),
    '--mask', path.join(context.evidenceRoot, mask), '--verify-mask',
    ...(player ? ['--allow-resize'] : [])]
  const result = await runProgram(context.python, args, {
    cwd: context.evidenceRoot, timeoutMs: 30000, env: { PYTHONNOUSERSITE: '1' } })
  requireThat(result.exit_code === 0, '独立像素解码或固定 mask 复核失败')
  return JSON.parse(result.stdout)
}
async function verifyDecodedFrame(context, video, frame, declared) {
  const directory = path.join(context.evidenceRoot, 'verifier', crypto.randomUUID())
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, `${frame}.png`)
  const result = await runProgram(context.ffmpeg, ['-v', 'error', '-i',
    await checkedPath(path.join(context.evidenceRoot, relativePath(video))),
    '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-pix_fmt', 'rgb24', target],
  { cwd: context.evidenceRoot, timeoutMs: 30000 })
  requireThat(result.exit_code === 0 && (await hashFile(target)).sha256 === declared.sha256,
    'MP4 采样图不是对应实际视频的该帧')
}
async function assertVisual(records, step, attachments, context) {
  const matrix = records.get('matrix_index')[0]
  requireThat(Array.isArray(matrix.entries) && matrix.entries.length === 72, '视觉矩阵必须有 72 个唯一组合')
  const keys = new Set()
  const paths = new Set(attachments.map(entry => entry.path))
  const files = new Map(attachments.map(entry => [entry.path, entry]))
  const catalog = JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'catalog.json'), 'utf8'))
  for (const entry of matrix.entries) {
    const key = `${entry.template_id}:${entry.width}:${entry.height}`
    requireThat(!keys.has(key), '视觉矩阵重复')
    keys.add(key)
    requireThat(entry.case_id === `${entry.template_id}:${entry.width}x${entry.height}`
      && HEX.test(entry.input_sha256), '视觉用例或输入身份无效')
    for (const role of ['document', 'video', 'probe']) requireThat(paths.has(entry[role]), `视觉矩阵缺少 ${role} 证据`)
    const fixture = await readAttachment(context, files.get(entry.document))
    const template = catalog.templates.find(item => item.id === entry.template_id)
    requireThat(fixture.case_id === entry.case_id && fixture.input_sha256 === entry.input_sha256
      && hash(JSON.stringify(fixture.document)) === entry.input_sha256
      && fixture.document.templateId === entry.template_id && template
      && fixture.document.templateVersion === template.version && fixture.document.seed === 1
      && fixture.document.durationFrames === 60 && fixture.document.canvas.fps === 30
      && JSON.stringify(fixture.document.params) === JSON.stringify(template.defaults), '视觉文档不是该固定模板用例输入')
    const probeRecord = await readAttachment(context, files.get(entry.probe))
    requireThat(probeRecord.case_id === entry.case_id && probeRecord.input_sha256 === entry.input_sha256, '视频探测来自其它视觉用例')
    const stream = probeRecord.probe?.streams?.find(item => item.codec_type === 'video')
    requireThat(stream?.codec_name === 'h264' && stream.pix_fmt === 'yuv420p'
      && stream.width === entry.width && stream.height === entry.height
      && stream.r_frame_rate === '30/1' && Number(stream.nb_read_frames) === 60,
    '视觉 MP4 探测与固定文档不符')
    requireThat([[1920, 1080], [1080, 1920], [1080, 1080]].some(([w, h]) => entry.width === w && entry.height === h), '视觉矩阵画布错误')
    requireThat(Array.isArray(entry.frames) && entry.frames.length === 5, '视觉采样帧缺失')
    requireThat(JSON.stringify(entry.frames.map(frame => frame.frame)) === '[0,14,29,44,59]', '视觉采样帧号错误')
    for (const frame of entry.frames) {
      for (const role of ['png_a', 'png_b', 'mp4_frame', 'player_frame', 'layout', 'metrics', 'mask', 'player_mask']) requireThat(paths.has(frame[role]), `视觉采样缺少 ${role} 附件`)
      requireThat(frame.png_a !== frame.png_b && files.get(frame.png_a).sha256 === files.get(frame.png_b).sha256, '两份真实 PNG 字节不一致')
      requireThat(JSON.stringify(await readPngDimensions(context, frame.png_a)) === JSON.stringify([entry.width, entry.height]), 'PNG 尺寸与文档不符')
      const metrics = await readAttachment(context, files.get(frame.metrics))
      const layout = await readAttachment(context, files.get(frame.layout))
      for (const record of [metrics, layout]) requireThat(record.case_id === entry.case_id
        && record.input_sha256 === entry.input_sha256 && record.frame === frame.frame, '图像测量来自其它输入或帧')
      const recomputed = await verifyImageMetrics(context, frame.png_a, frame.png_b, frame.mp4_frame, frame.mask)
      const player = await verifyImageMetrics(context, frame.png_a, frame.png_b, frame.player_frame, frame.player_mask, true)
      await verifyDecodedFrame(context, entry.video, frame.frame, files.get(frame.mp4_frame))
      requireThat(recomputed.rgba_equal && recomputed.png_equal && recomputed.flat_mae <= 6
        && player.flat_mae <= 6, '独立解码的 PNG/MP4/Player 像素门禁失败')
      requireThat(metrics.mp4.flat_mae === recomputed.flat_mae
        && metrics.player.flat_mae === player.flat_mae
        && metrics.mp4.mask_sha256 === files.get(frame.mask).sha256
        && metrics.player.mask_sha256 === files.get(frame.player_mask).sha256,
      '视觉 metrics 与实际图像/mask 附件不符')
      const compared = require('./effects-visual-acceptance').compareLayouts(
        layout.renderer, layout.player, { width: entry.width, height: entry.height })
      requireThat(layout.renderer.frame === frame.frame && layout.player.frame === frame.frame
        && compared.linesMatch && compared.error <= 1,
      '实际 DOM 文字行数、字体或 CSS 坐标不一致')
      requireThat(frame.png_equal === recomputed.png_equal && frame.rgba_equal === recomputed.rgba_equal
        && frame.mp4_flat_mae === recomputed.flat_mae && frame.player_flat_mae === player.flat_mae
        && frame.layout_error_css_px === compared.error && frame.layout_lines_match === compared.linesMatch,
      '矩阵索引自报值与实际测量不符')
    }
  }
  requireThat(new Set(matrix.entries.map(entry => entry.template_id)).size === 24, '模板集合不足 24')
  assertCases(matrix, ['visual-matrix', 'text-zh', 'text-en', 'text-newline', 'text-120', 'text-300', 'text-combining', 'text-emoji', 'audio-unity', 'audio-half', 'audio-muted', 'audio-detached'])
  await assertVisualAudio(records, files, context)
  await assertVisualGlyphs(records, files, context)
  requireNumber(step.measurements, 'sample_frames', value => value === 360)
}
async function assertVisualGlyphs(records, files, context) {
  const fonts = JSON.parse(await fs.readFile(path.join(context.resourceRoot, 'fonts/manifest.json'), 'utf8'))
  const glyphs = (records.get('layout') || []).filter(record => record.glyphs)
  requireThat(glyphs.length === 21 && new Set(glyphs.map(record => `${record.case_id}:${record.family}`)).size === 21, '七组文字乘三种离线字体用例不完整')
  for (const record of glyphs) {
    requireThat(hash(record.text) === record.input_sha256
      && JSON.stringify(record.frames) === '[0,29,59]' && record.pngs.length === 3
      && record.pngs.every(ref => files.has(ref)), '文字输入或首中末帧身份错误')
    const paths = fonts.fonts.filter(font => font.path.endsWith('.ttf') && [record.family, 'sans'].includes(font.family))
      .map(font => path.join(context.resourceRoot, 'fonts', font.path))
    const result = await runProgram(context.python, ['-B', '-X', 'utf8', path.join(__dirname, 'effects_metrics.py'),
      'glyphs', ...paths.flatMap(file => ['--font', file]), '--text', record.text], { cwd: context.evidenceRoot, timeoutMs: 30000 })
    requireThat(result.exit_code === 0 && JSON.stringify(JSON.parse(result.stdout)) === JSON.stringify(record.glyphs)
      && record.glyphs.offline_glyphs_complete === true, '离线字体实际缺字，不能借系统字体通过')
  }
}
async function assertVisualAudio(records, files, context) {
  const vectors = records.get('audio_metrics') || []
  requireThat(vectors.length === 4 && new Set(vectors.map(record => record.case_id)).size === 4, '音频向量缺少或重复')
  const measured = new Map()
  for (const record of vectors) {
    const expectedGain = { 'audio-unity': 1, 'audio-half': 0.5, 'audio-muted': 0, 'audio-detached': 1 }[record.case_id]
    requireThat(record.gain === expectedGain && files.has(record.audio) && files.has(record.source)
      && JSON.stringify(record.expected) === (record.gain ? '[0,1,2,3]' : '[]'), '音频输入/增益与固定向量不符')
    const directory = path.join(context.evidenceRoot, 'verifier', crypto.randomUUID())
    await fs.mkdir(directory, { recursive: true })
    const decoded = path.join(directory, 'audio.wav')
    const result = await runProgram(context.ffmpeg, ['-v', 'error', '-i', path.join(context.evidenceRoot, relativePath(record.source)),
      ...(record.trim_start ? ['-ss', String(record.trim_start), '-t', '3.4'] : []),
      '-vn', '-af', `volume=${record.gain}`, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', decoded],
    { cwd: context.evidenceRoot, timeoutMs: 30000 })
    requireThat(result.exit_code === 0 && (await hashFile(decoded)).sha256 === files.get(record.audio).sha256, '音频附件不是该源视频按固定增益解码的结果')
    const measurement = await runProgram(context.python, ['-B', '-X', 'utf8', path.join(__dirname, 'effects_metrics.py'),
      'audio', '--audio', decoded, '--gain', String(record.gain), '--expected', JSON.stringify(record.expected)],
    { cwd: context.evidenceRoot, timeoutMs: 30000 })
    requireThat(measurement.exit_code === 0, '独立音频脉冲测量失败')
    const actual = JSON.parse(measurement.stdout)
    requireThat(JSON.stringify(actual) === JSON.stringify(record.metrics)
      && (record.gain === 0 || actual.max_av_error_seconds <= 1 / 30), '音频测量或时序自报值不符')
    measured.set(record.case_id, actual)
  }
  const unity = measured.get('audio-unity').absolute_peak
  requireThat(Math.abs(measured.get('audio-half').absolute_peak / unity - 0.5) <= 0.025,
    '50% 外层增益相对参考幅度超限')
  requireThat(Math.abs(unity / measured.get('audio-detached').absolute_peak - 1) <= 0.05,
    '嵌入原音或分离原音出现重复/丢失')
}
async function validateStep(name, step, report, context) {
  fields(step, ['status', 'acceptance_ids', 'measurements', 'attachments', 'reason'], ['status', 'acceptance_ids', 'measurements', 'attachments'])
  requireThat(['pass', 'fail', 'blocked'].includes(step.status), '场景状态无效')
  assertMetrics(step)
  requireThat(Array.isArray(step.acceptance_ids) && new Set(step.acceptance_ids).size === step.acceptance_ids.length, 'AC 重复或无效')
  const allowed = acIds(name)
  requireThat(step.acceptance_ids.every(id => allowed.includes(id)), '未知或不属于该场景的 AC')
  requireThat(Array.isArray(step.attachments), '附件必须是数组')
  const records = new Map()
  const paths = new Set()
  for (const attachment of step.attachments) {
    requireThat(!paths.has(attachment.path), '附件路径重复')
    paths.add(attachment.path)
    const record = await readAttachment(context, attachment)
    if (record) { assertBound(record, report); records.set(attachment.role, [...(records.get(attachment.role) || []), record]) }
  }
  if (step.status !== 'pass') { requireThat(typeof step.reason === 'string' && step.reason.trim(), '非通过项必须说明原因'); return }
  requireThat(context.manifest && context.targetRoot, '通过项必须绑定实际被测包')
  requireThat(step.acceptance_ids.length === allowed.length, '场景 AC 证据不齐全')
  for (const role of [...ROLES[name], ...(name === 'package' && report.mode === 'installed' ? ['install_record'] : [])]) requireThat(step.attachments.some(entry => entry.role === role), `缺少 ${role} 附件`)
  requireThat(Object.keys(step.measurements).length > 0, '空测量不能通过')
  const primaryRole = { package: 'runtime_smoke', desktop: 'action_trace', process: 'process_trace', performance: 'raw_samples', agent: 'tool_trace' }[name]
  if (primaryRole) assertCases(records.get(primaryRole)?.[0] || {}, CASES[name])
  if (name === 'visual') await assertVisual(records, step, step.attachments, context)
  assertScenarioMetrics(name, step, records)
  if (name === 'desktop') await assertDesktopEvidence(step, records, context)
  if (name === 'agent') assertAgentEvidence(records)
  if (name === 'package') {
    for (const role of ['identity_before', 'identity_after']) {
      const identity = records.get(role)?.[0]
      requireThat(identity?.input_sha256 === report.manifest_sha256
        && utc(identity.verified_at) >= utc(report.started_at), '包树前后核查身份不符')
    }
    const runtime = records.get('runtime_smoke')[0]
    requireThat(runtime.actual?.passed === true && runtime.actual.package_id === report.package_id
      && runtime.actual.source_head === report.source_head
      && runtime.actual.mode === report.mode, '真实 runtime 报告身份错误')
    requireThat(runtime.actual.module_boundary_enforced === true
      && Array.isArray(runtime.actual.commands) && runtime.actual.commands.length > 0
      && runtime.actual.commands.every(command => Number.isInteger(command.pid)
        && inside(context.targetRoot, command.executable)), '被测程序缺少目标树来源/PID或模块边界')
    const renderer = runtime.actual.steps?.renderer
    requireThat(renderer?.passed === true && renderer.versions?.electron
      && renderer.checks?.includes('cancel') && renderer.checks?.includes('ipc-disconnect'), '缺少真实 renderer/取消/断连证据')
    requireThat(renderer.packageVersions?.['@remotion/renderer'] === '4.0.544'
      && renderer.packageVersions.remotion === '4.0.544'
      && renderer.packageVersions.react === '19.1.1' && renderer.packageVersions['react-dom'] === '19.1.1'
      && typeof renderer.browserVersion === 'string' && renderer.browserVersion.includes('Chromium'), '运行包内探测的引擎/React/浏览器版本不符')
    const probe = renderer.probe?.streams?.find(stream => stream.codec_type === 'video')
    requireThat(probe?.codec_name === 'h264' && probe.pix_fmt === 'yuv420p'
      && Number(probe.nb_read_frames) === 150, '真实 smoke 媒体测量不符')
    requireThat(runtime.actual.steps?.controller?.checks?.includes('no-orphan-processes'), '缺少真实 controller 清理证据')
    if (report.mode === 'installed') {
      const install = records.get('install_record')?.[0]
      requireThat(install?.installer_sha256 === report.installer_sha256
        && path.resolve(install.installed_root) === path.resolve(context.targetRoot)
        && install.exit_code === 0, '安装记录来自错误安装器或目录')
    }
  }
}
async function validateRegression(report, context) {
  fields(report.regression, ['status', 'source_head', 'attachment'])
  requireThat(report.regression.source_head === report.source_head, '源码回归来自其它提交')
  relativePath(report.regression.attachment)
  const regression = JSON.parse(await fs.readFile(await checkedPath(path.join(context.evidenceRoot, report.regression.attachment)), 'utf8'))
  assertBound(regression, report)
  requireThat(report.regression.status === 'pass', '源码回归未通过')
  requireThat(Array.isArray(regression.commands) && regression.commands.length >= 9, '缺少全部实际回归命令')
  const required = ['typecheck', 'frontend', 'agent', 'timeline', 'runtime-typecheck', 'runtime-build', 'runtime-tests', 'desktop-tests', 'backend', 'build']
  requireThat(regression.commands.length === required.length && new Set(regression.commands.map(command => command.id)).size === required.length
    && required.every(id => regression.commands.some(command => command.id === id)), '源码回归命令集合缺失或重复')
  for (const command of regression.commands) {
    requireThat(Array.isArray(command.argv) && command.argv.length && command.cwd && command.exit_code === 0, '回归命令未实际成功')
    requireNumber(command, 'tests', value => command.test_command ? value > 0 : value === 0)
    requireNumber(command, 'failed', value => value === 0)
    requireNumber(command, 'skipped', value => value === 0)
    requireThat(HEX.test(command.log_sha256), '回归日志未绑定')
    relativePath(command.log)
    requireThat((await hashFile(path.join(context.evidenceRoot, command.log))).sha256 === command.log_sha256, '源码回归日志被改变')
  }
  fields(regression.acceptance_bindings, Object.keys(REGRESSION_BINDINGS))
  const actualCases = regression.commands.flatMap(command => command.cases || [])
  for (const [id, patterns] of Object.entries(REGRESSION_BINDINGS)) {
    const binding = regression.acceptance_bindings[id]
    requireThat(Array.isArray(binding) && binding.length > 0, `${id} 缺少源码用例绑定`)
    for (const pattern of patterns) requireThat(binding.some(name => name.includes(pattern)), `${id} 缺少规定真实测试 ${pattern}`)
    requireThat(binding.every(name => actualCases.some(executed => executed.name === name && executed.status === 'pass')), `${id} 引用了未执行测试`)
  }
  requireThat(regression.tracked_before === regression.tracked_after && regression.source_head_before === report.source_head && regression.source_head_after === report.source_head, '回归期间源码改变')
}

/** Validate evidence again from disk; never trust a runner's pass flags. */
async function validateAcceptanceReport(report, context = {}) {
  try {
    fields(report, REPORT_KEYS, REPORT_KEYS.filter(key => key !== 'regression'))
    requireThat(report.schema_version === 1 && typeof report.run_id === 'string', '报告版本或运行 ID 无效')
    requireThat([...SCENARIOS, 'all'].includes(report.requested_scenario), '未知场景')
    requireThat(['unpacked', 'installed'].includes(report.mode), '报告模式无效')
    for (const key of ['package_id', 'manifest_sha256', 'runtime_fingerprint', 'catalog_hash', 'font_hash', 'bundle_hash']) requireThat(HEX.test(report[key]), `报告 ${key} 散列无效`)
    requireThat(/^[a-f0-9]{40,64}$/.test(report.source_head), '源码身份无效')
    requireThat(report.installer_sha256 === null || HEX.test(report.installer_sha256), '安装器身份无效')
    requireThat(utc(report.finished_at) >= utc(report.started_at), '执行时间顺序错误')
    const selected = selectedScenarios(report.requested_scenario)
    fields(report.steps, selected)
    if (selected.some(name => report.steps[name].status === 'pass')) {
      requireThat(context.workspaceRoot && context.unpackedRoot && context.manifestPath,
        '缺少独立包身份验证上下文')
      await verifyIdentity({ ...context, report })
    }
    for (const name of selected) await validateStep(name, report.steps[name], report, context)
    requireThat(object(report.acceptance_results), 'AC 结果无效')
    for (const [id, result] of Object.entries(report.acceptance_results)) {
      requireThat(/^AC-(0[1-9]|[1-4][0-9]|5[0-6])$/.test(id), '未知 AC')
      fields(result, ['status', 'case_ids', 'attachment_refs'])
      requireThat(['pass', 'fail', 'blocked'].includes(result.status) && Array.isArray(result.case_ids) && Array.isArray(result.attachment_refs), 'AC 结果结构错误')
      if (result.status === 'pass') requireThat(result.case_ids.length > 0 && result.attachment_refs.length > 0, 'AC 缺少实际用例与附件')
      const owner = SCENARIOS.find(name => acIds(name).includes(id))
      if (owner) requireThat(selected.includes(owner) && result.status === report.steps[owner].status,
        'AC 状态或场景与固定映射不符')
      else requireThat(report.requested_scenario === 'all' && report.regression
        && result.status === report.regression.status
        && result.attachment_refs.includes(report.regression.attachment), '源码 AC 没有绑定本次回归')
      const attached = new Set(Object.values(report.steps).flatMap(step => step.attachments.map(entry => entry.path)))
      requireThat(result.attachment_refs.every(ref => attached.has(ref) || ref === report.regression?.attachment), 'AC 引用不存在的附件')
      if (result.status === 'pass') {
        const actualCases = new Set()
        for (const ref of result.attachment_refs) {
          const attachment = Object.values(report.steps).flatMap(step => step.attachments).find(entry => entry.path === ref)
          if (!attachment) {
            if (ref === report.regression?.attachment && report.regression.status === 'pass') {
              const regression = JSON.parse(await fs.readFile(path.join(context.evidenceRoot, ref), 'utf8'))
              for (const name of regression.acceptance_bindings?.[id] || []) actualCases.add(name)
            }
            continue
          }
          const record = await readAttachment(context, attachment)
          for (const executed of record?.cases || []) if (executed.status === 'pass') actualCases.add(executed.case_id)
        }
        requireThat(result.case_ids.every(caseId => actualCases.has(caseId)), 'AC 引用未执行或不存在的用例')
      }
    }
    for (const name of selected) if (report.steps[name].status === 'pass') for (const id of acIds(name)) requireThat(
      report.acceptance_results[id]?.status === 'pass', '通过场景缺少关联 AC 实际结果')
    if (report.requested_scenario === 'all') requireThat(Object.keys(report.acceptance_results).length === 56, 'all 必须逐项记录全部56个 AC')
    if (context.manifest) {
      requireThat(report.source_head === context.manifest.source_head && report.package_id === context.manifest.package_id && report.installer_sha256 === (context.manifest.installer?.sha256 || null), '报告与实际包/安装器身份不同')
    }
    if (report.regression?.status === 'pass') await validateRegression(report, context)
    const releaseReady = deriveReleaseReady(report, context)
    if (releaseReady) requireThat(report.regression?.status === 'pass', '缺少本次源码回归')
    requireThat(report.release_ready === releaseReady, 'release_ready 不符合实际门禁')
    if (selected.some(name => report.steps[name].status === 'pass')) await verifyIdentity({ ...context, report })
    const outcomes = [...selected.map(name => report.steps[name].status), ...(report.regression ? [report.regression.status] : [])]
    return { valid: true, releaseReady, errors: [], exitCode: outcomes.includes('fail') ? 1 : outcomes.includes('blocked') ? 2 : 0 }
  } catch (error) { return { valid: false, releaseReady: false, exitCode: 1, errors: [error.message] } }
}
function deriveReleaseReady(report, context) {
  return report.requested_scenario === 'all' && report.mode === 'installed'
    && report.installer_sha256 !== null && context.manifest?.dirty === false
    && SCENARIOS.every(name => report.steps[name]?.status === 'pass')
    && report.regression?.status === 'pass'
    && Array.from({ length: 56 }, (_, index) => `AC-${String(index + 1).padStart(2, '0')}`).every(id => report.acceptance_results[id]?.status === 'pass')
}

/** Compare the selected installed files, allowing only separately recorded NSIS files. */
async function verifyInstalledTree(root, manifest) {
  const extras = []
  const expected = new Map(manifest.files.map(entry => [entry.path, entry]))
  async function walk(directory, prefix = '') {
    await checkedPath(directory)
    for (const name of await fs.readdir(directory)) {
      const relative = prefix ? `${prefix}/${name}` : name
      const target = path.join(directory, name)
      await checkedPath(target)
      if ((await fs.stat(target)).isDirectory()) { await walk(target, relative); continue }
      const actual = await hashFile(target)
      const declared = expected.get(relative)
      if (!declared) { requireThat(/^(Uninstall.*\.exe|Uninstall.*\.dat|\.install-record\.json)$/i.test(relative), '安装树包含未声明执行资源'); extras.push({ path: relative, ...actual }); continue }
      requireThat(declared.size === actual.bytes && declared.sha256 === actual.sha256, `安装树文件不匹配 ${relative}`)
      expected.delete(relative)
    }
  }
  await walk(root)
  requireThat(expected.size === 0, '安装树缺少清单文件')
  return extras
}
async function verifyIdentity(context) {
  const result = await verifyPackageManifest({ workspaceRoot: context.workspaceRoot,
    releaseRoot: path.dirname(context.manifestPath), packageRoot: context.unpackedRoot,
    manifest: context.manifest, onProgress: context.onProgress })
  requireThat(result.success, result.errors.join('; '))
  const extras = context.installedRoot ? await verifyInstalledTree(context.installedRoot, context.manifest) : []
  return bindRecord(context.report, { case_id: 'identity', input_sha256: context.report.manifest_sha256, verified_at: new Date().toISOString(), extras })
}

/** Scrub inherited injection and record every program's real source and PID. */
function cleanEnvironment(environment = process.env) {
  const result = { ...environment }
  for (const key of Object.keys(result)) if (/^(NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete result[key]
  return result
}
function rejectOverrides(environment = process.env) {
  for (const key of Object.keys(environment)) requireThat(!/^ECLIPTRIX_EFFECTS_(RESOURCE_ROOT|ELECTRON|PROJECTS_ROOT)$/.test(key) || !environment[key], `目标包不允许开发 override: ${key}`)
}
async function runProgram(executable, argv, options) {
  await checkedPath(executable)
  const startedAt = new Date().toISOString()
  const child = spawn(executable, argv, { cwd: options.cwd, windowsHide: true,
    env: { ...cleanEnvironment(), ...options.env }, stdio: options.stdio || ['ignore', 'pipe', 'pipe'] })
  options.onSpawn?.({ executable, argv, pid: child.pid, started_at: startedAt })
  let stdout = ''; let stderr = ''
  child.stdout?.on('data', chunk => { stdout += chunk.toString(); options.onOutput?.(chunk.toString()) })
  child.stderr?.on('data', chunk => { stderr += chunk.toString() })
  const timeout = setTimeout(() => {
    if (process.platform === 'win32' && child.pid) {
      require('node:child_process').spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 })
    } else child.kill()
  }, options.timeoutMs || 180000)
  try {
    const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    return { executable, argv, cwd: options.cwd, pid: child.pid, started_at: startedAt,
      finished_at: new Date().toISOString(), exit_code: exitCode, stdout, stderr }
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill() }
}

module.exports = { SCENARIOS, ROLES, CASES, ACS, inside, hash, checkedPath,
  hashFile, reserveReport, createAcceptanceReport, bindRecord, writeAttachment,
  validateAcceptanceReport, verifyInstalledTree, verifyIdentity,
  cleanEnvironment, rejectOverrides, runProgram, selectedScenarios,
  installModuleBoundary, REGRESSION_BINDINGS, acIds, deriveReleaseReady,
  assertScenarioMetrics, assertAgentEvidence, assertVisual }
