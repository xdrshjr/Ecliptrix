'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Node 内置测试直接加载桌面 CommonJS 模块。 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { spawnSync } = require('node:child_process')
const api = require('./research-release-evidence')
const { createResearchReport } = require('../smoke-test')

const NOW = '2026-10-06T14:00:00.000Z'
const START = '2026-10-06T13:01:00.000Z'
const END = '2026-10-06T13:10:00.000Z'
const PROJECT = '43cf56fa-01da-4a20-b5a6-9c41a971d0dc'
const IDS = ['package_offline', 'installer', 'public_browser', 'real_search', 'offline_reopen_export', 'model_modes', 'regression']
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg==', 'base64')
const hash = data => crypto.createHash('sha256').update(data).digest('hex')

async function write(root, name, data) {
  const file = path.join(root, name)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, data)
  return file
}

async function fixture(t, complete = false) {
  const parent = path.resolve(__dirname, '../../..', '.agentmesh', 'research-evidence-tests')
  await fs.mkdir(parent, { recursive: true })
  const workspaceRoot = await fs.mkdtemp(path.join(parent, 'case-'))
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }))
  const releaseRoot = path.join(workspaceRoot, 'release')
  const packageRoot = path.join(releaseRoot, 'win-unpacked')
  const evidenceRoot = path.join(workspaceRoot, 'run-1')
  const installedRoot = path.join(evidenceRoot, 'installed')
  await fs.mkdir(evidenceRoot, { recursive: true })
  for (const name of ['Ecliptrix.exe', 'resources/backend/run.py', 'resources/browser/chrome.exe', 'resources/ffmpeg/ffprobe.exe', 'resources/ffmpeg/ffmpeg.exe']) await write(packageRoot, name, name)
  await write(releaseRoot, 'Ecliptrix-Setup.exe', 'installer')
  const options = { workspaceRoot, releaseRoot, packageRoot, evidenceRoot, installedRoot, now: () => new Date(NOW) }
  const created = await api.createPackageManifest({ ...options, sourceHead: 'a'.repeat(40), dirty: true, frontendBuildId: 'build-1', runtime: { python: '3.11.9', playwright: '1.63.0', beautifulsoup: '4.15.0', browser: 'embedded-electron-chromium (CDP)', ffmpeg: 'resources/ffmpeg/ffmpeg.exe', ffprobe: 'resources/ffmpeg/ffprobe.exe' }, installerPath: 'Ecliptrix-Setup.exe', now: () => new Date('2026-10-06T13:00:00.000Z') })
  assert.equal(created.success, true, JSON.stringify(created))
  const manifest = created.manifest
  const manifestBytes = JSON.stringify(manifest)
  options.manifestPath = await write(releaseRoot, 'research-build-manifest.json', manifestBytes)
  options.evidencePath = path.join(evidenceRoot, 'evidence.json')
  const evidence = { schema_version: 1, run_id: 'run-1', package_id: manifest.package_id, manifest_sha256: hash(manifestBytes), created_at: END, checks: IDS.map(id => ({ id, package_id: manifest.package_id, status: 'blocked', started_at: null, finished_at: null, evidence_files: [], metrics: {}, review: null, note: '缺少真实环境' })) }
  const attachment = async (check, role, name, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
    await write(evidenceRoot, name, bytes)
    const item = { role, path: name, size: bytes.length, sha256: hash(bytes) }
    check.evidence_files.push(item)
    return item
  }
  const record = (id, fields = {}) => ({ schema_version: 1, run_id: evidence.run_id, package_id: manifest.package_id, check_id: id, ...fields })
  const persist = () => write(evidenceRoot, 'evidence.json', JSON.stringify(evidence))
  const f = { options, manifest, evidence, attachment, record, persist }
  if (complete) await completeFixture(f)
  await persist()
  return f
}

function probeSpawn(payload = { format: { duration: '20.0' }, streams: [{ codec_type: 'video', width: 1280, height: 720 }] }, observe) {
  return (command, args, options) => {
    observe?.(command, args, options)
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGKILL')); return true }
    queueMicrotask(() => { child.stdout.end(JSON.stringify(payload)); child.emit('close', 0, null) })
    return child
  }
}

async function completeFixture(f) {
  const { options, manifest, evidence, attachment, record } = f
  await fs.cp(options.packageRoot, options.installedRoot, { recursive: true })
  const metrics = {
    package_offline: { success: true, skipped: false, browser_actions: 1, screenshot_count: 1, residual_processes: 0, desktop_checks_passed: true },
    installer: { installer_sha256: manifest.installer.sha256, installed_resources_match: true, launch_passed: true, installer_file: manifest.installer.path },
    public_browser: { final_url: 'https://example.org/page', dynamic_change: true, visible_actions: 1, screenshot_count: 2, policy_unchanged: true, reviewed: true },
    real_search: { source_domains: ['example.org', 'example.net'], independent_publishers: 2, downloaded_images: 2, project_id: PROJECT, real_provider: true, reviewed: true },
    offline_reopen_export: { project_id: PROJECT, public_network_blocked: true, loopback_available: true, reopened: true, duration_seconds: 20, video_streams: 1, frame_checks: 2, reviewed: true },
    model_modes: { auxiliary_calls_disabled: 0, auxiliary_calls_enabled: 1, configured_model: 'research-model', effective_model: 'research-model', sources_valid: true },
    regression: { scoped_failures: 0, scoped_errors: 0, typecheck_exit: 0, build_exit: 0, lint_changed_exit: 0, baseline_comparison: 'regression/baseline.json' },
  }
  for (const check of evidence.checks) Object.assign(check, { status: 'pass', started_at: START, finished_at: END, metrics: metrics[check.id], note: '' })
  const byId = id => evidence.checks.find(check => check.id === id)
  const json = (id, role, fields = {}) => attachment(byId(id), role, `${id}/${role}.json`, record(id, fields))
  const shot = (id, role) => attachment(byId(id), role, `${id}/${role}.png`, png)
  const smoke = { schema_version: 1, run_id: evidence.run_id, package_id: manifest.package_id, manifest_sha256: evidence.manifest_sha256, started_at: START, finished_at: END, status: 'pass', success: true, skipped: false, steps: {} }
  for (const name of ['identity_before', 'browser', 'desktop', 'export', 'cleanup', 'identity_after']) {
    const holder = { evidence_files: [] }
    const a = await attachment(holder, 'execution_record', `smoke/${name}.json`, record('package_offline', { step: name, success: true }))
    const files = [a]
    if (name === 'browser') files.push(await attachment(holder, 'screenshot', 'smoke/browser.png', png))
    smoke.steps[name] = { status: 'pass', started_at: START, finished_at: END, evidence_files: files, metrics: name === 'browser' ? { actions: 1, screenshots: 1 } : name === 'cleanup' ? { residual_processes: 0 } : {}, note: '' }
  }
  await attachment(byId('package_offline'), 'smoke_report', 'package_offline.json', smoke)
  await json('installer', 'install_record', { ...metrics.installer, uninstaller: null })
  await json('installer', 'launch_record', { launch_passed: true })
  await shot('public_browser', 'before_image')
  await shot('public_browser', 'after_image')
  await json('public_browser', 'tool_record', metrics.public_browser)
  const imageFiles = []
  for (let i = 1; i <= 2; i++) imageFiles.push(await attachment(byId('real_search'), 'image', `real_search/image-${i}.png`, png))
  const images = imageFiles.map((item, i) => ({ path: item.path, sha256: item.sha256, source_id: `source-${i}`, source_url: `https://${metrics.real_search.source_domains[i]}/source` }))
  await json('real_search', 'source_records', { ...metrics.real_search, sources: metrics.real_search.source_domains.map(hostname => ({ hostname, registrable_domain: hostname, publisher: hostname })), images })
  await json('real_search', 'provider_record', { project_id: PROJECT, real_provider: true })
  await json('offline_reopen_export', 'save_record', { project_id: PROJECT, images })
  await json('offline_reopen_export', 'reopen_record', { project_id: PROJECT, reopened: true })
  await json('offline_reopen_export', 'network_record', { public_network_blocked: true, loopback_available: true, method: '隔离测试环境出站阻断，保留回环；外网探测失败。' })
  await json('offline_reopen_export', 'export_request', { project_id: PROJECT, media_paths: images.map(item => item.path) })
  await attachment(byId('offline_reopen_export'), 'video', 'offline/video.mp4', 'media-fixture')
  await json('offline_reopen_export', 'probe_record', { duration_seconds: 20, video_streams: 1, width: 1280, height: 720 })
  for (let i = 1; i <= 2; i++) await attachment(byId('offline_reopen_export'), 'frame', `offline/frame-${i}.png`, png)
  await json('model_modes', 'disabled_record', { auxiliary_calls_disabled: 0 })
  await json('model_modes', 'enabled_record', { auxiliary_calls_enabled: 1, configured_model: 'research-model', effective_model: 'research-model', sources_valid: true })
  await json('regression', 'test_results', { ...metrics.regression, commands: [{ command: 'node --test scoped.test.js', exit_code: 0, failures: 0, errors: 0 }] })
  await attachment(byId('regression'), 'baseline_comparison', 'regression/baseline.json', record('regression', { summary: '同环境基线与本轮结果一致，专项无失败。' }))
  for (const check of evidence.checks.filter(item => !['package_offline', 'regression'].includes(item.id))) check.review = { reviewer: 'review-agent', reviewed_at: END, verdict: 'pass', evidence_paths: check.evidence_files.map(item => item.path), limitations: '已核对安装附加文件、真实供应商记录、独立发布者归属、网络隔离探测、字幕与画面及模型选择；不证明图片授权。' }
  options.spawn = probeSpawn()
}

test('清单稳定绑定整树内容，新增、后端或浏览器变化均失败', async t => {
  const f = await fixture(t)
  assert.equal((await api.verifyPackageManifest({ ...f.options, manifest: f.manifest })).success, true)
  for (const name of ['resources/backend/run.py', 'resources/browser/chrome.exe', 'extra.txt']) {
    const original = await fs.readFile(path.join(f.options.packageRoot, name)).catch(() => null)
    await write(f.options.packageRoot, name, 'changed')
    assert.equal((await api.verifyPackageManifest({ ...f.options, manifest: f.manifest })).success, false)
    if (original) await write(f.options.packageRoot, name, original)
    else await fs.unlink(path.join(f.options.packageRoot, name))
  }
})

test('完整可解析阻断报告退出2，缺检查或伪造pass退出1', async t => {
  const f = await fixture(t)
  const blocked = await api.validateReleaseEvidence(f.options)
  assert.equal(blocked.exitCode, 2, JSON.stringify(blocked))
  assert.equal(blocked.release_ready, false)
  f.evidence.checks[0].status = 'pass'
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
  f.evidence.checks.pop()
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('真实附件与跨记录一致时通过，ffprobe仅能使用包内程序和file协议', async t => {
  const f = await fixture(t, true)
  f.options.spawn = probeSpawn(undefined, (command, args, options) => {
    assert.equal(command, path.join(f.options.packageRoot, 'resources/ffmpeg/ffprobe.exe'))
    assert.deepEqual(args.slice(0, -1), ['-v', 'error', '-protocol_whitelist', 'file', '-show_streams', '-show_format', '-of', 'json'])
    assert.equal(options.shell, false)
    assert.equal(options.windowsHide, true)
  })
  const result = await api.validateReleaseEvidence(f.options)
  assert.equal(result.exitCode, 0, JSON.stringify(result))
  assert.equal(result.release_ready, true)
})

for (const [name, change] of [
  ['未来时间', f => { f.evidence.checks[0].finished_at = '2026-10-07T00:00:00.000Z' }],
  ['包身份跨记录冲突', f => { f.evidence.checks[1].package_id = 'b'.repeat(64) }],
  ['清单散列改变', f => { f.evidence.manifest_sha256 = 'b'.repeat(64) }],
  ['未知metrics', f => { f.evidence.checks[0].metrics.provider = { secret: 'hidden' } }],
  ['路径越界', f => { f.evidence.checks[0].evidence_files[0].path = '../outside.json' }],
  ['附件缺失', f => { f.evidence.checks[2].evidence_files.pop() }],
  ['项目身份不一致', f => { f.evidence.checks[4].metrics.project_id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
  ['重复检查', f => { f.evidence.checks.push(f.evidence.checks[0]) }],
  ['布尔冒充数字', f => { f.evidence.checks[0].metrics.browser_actions = true }],
]) test(`拒绝${name}`, async t => {
  const f = await fixture(t, true)
  change(f)
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('拒绝安装树未知exe与相同包不同安装器', async t => {
  const f = await fixture(t, true)
  await write(f.options.installedRoot, 'unknown.exe', 'unknown')
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
  await fs.unlink(path.join(f.options.installedRoot, 'unknown.exe'))
  await write(f.options.releaseRoot, 'Ecliptrix-Setup.exe', 'other installer')
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('原始smoke阶段失败不能由顶层pass覆盖', async t => {
  const f = await fixture(t, true)
  const check = f.evidence.checks[0]
  const report = JSON.parse(await fs.readFile(path.join(f.options.evidenceRoot, 'package_offline.json'), 'utf8'))
  report.steps.cleanup.status = 'fail'
  check.evidence_files = []
  await f.attachment(check, 'smoke_report', 'package_offline.json', report)
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('假图片与跨run记录即使散列正确仍拒绝', async t => {
  const f = await fixture(t, true)
  const check = f.evidence.checks[2]
  const original = check.evidence_files.slice()
  check.evidence_files = original.filter(item => item.role !== 'before_image')
  await f.attachment(check, 'before_image', 'public_browser/before_image.png', 'not a picture')
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
  check.evidence_files = original.filter(item => item.role !== 'tool_record')
  await write(f.options.evidenceRoot, 'public_browser/before_image.png', png)
  await f.attachment(check, 'tool_record', 'public_browser/tool_record.json', { ...f.record('public_browser', check.metrics), run_id: 'old-run' })
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('同站子域不能冒充两个独立发布者', async t => {
  const f = await fixture(t, true)
  const check = f.evidence.checks[3]
  const item = check.evidence_files.find(file => file.role === 'source_records')
  const record = JSON.parse(await fs.readFile(path.join(f.options.evidenceRoot, item.path), 'utf8'))
  check.metrics.source_domains = ['a.example.org', 'b.example.org']
  record.source_domains = check.metrics.source_domains
  record.sources = check.metrics.source_domains.map(hostname => ({ hostname, registrable_domain: 'example.org', publisher: 'Example' }))
  check.evidence_files = check.evidence_files.filter(file => file !== item)
  await f.attachment(check, 'source_records', item.path, record)
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('ffprobe不合格、溢出与超时均终止并失败', async t => {
  const f = await fixture(t, true)
  f.options.spawn = probeSpawn({ format: { duration: '10' }, streams: [] })
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
  for (const mode of ['overflow', 'timeout']) {
    let killed = false
    let closed = false
    f.options.probeTimeoutMs = 10
    f.options.spawn = () => {
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => { killed = true; queueMicrotask(() => { closed = true; child.emit('close', null, 'SIGKILL') }); return true }
      if (mode === 'overflow') queueMicrotask(() => child.stdout.write(Buffer.alloc(1024 * 1024 + 1)))
      return child
    }
    assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
    assert.equal(killed, true)
    assert.equal(closed, true)
  }
})

test('清单拒绝相对路径歧义、大小写碰撞和junction', async t => {
  const f = await fixture(t)
  for (const bad of ['../x', 'a//b', 'a/./b', 'a\\b', 'C:/x', 'a:x', 'a.', 'a ']) {
    const manifest = structuredClone(f.manifest)
    manifest.files[0].path = bad
    assert.equal((await api.verifyPackageManifest({ ...f.options, manifest })).success, false, bad)
  }
  const collision = structuredClone(f.manifest)
  collision.files.push({ ...collision.files[0], path: collision.files[0].path.toUpperCase() })
  assert.equal((await api.verifyPackageManifest({ ...f.options, manifest: collision })).success, false)
  await fs.symlink(f.options.evidenceRoot, path.join(f.options.packageRoot, 'linked'), 'junction')
  assert.equal((await api.verifyPackageManifest({ ...f.options, manifest: f.manifest })).success, false)
})

test('CLI拒绝参数绕过并以JSON结尾', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../verify-research-release.js'), '--force-pass'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).release_ready, false)
})

test('读取期间变动不得生成清单', async t => {
  const f = await fixture(t)
  let changed = false
  const io = { ...fs, open: async (name, flags) => {
    const handle = await fs.open(name, flags)
    if (name.endsWith('run.py') && !changed) {
      const read = handle.read.bind(handle)
      handle.read = async (...args) => {
        const result = await read(...args)
        if (!changed) { changed = true; await fs.appendFile(name, 'changed during read') }
        return result
      }
    }
    return handle
  } }
  const result = await api.verifyPackageManifest({ ...f.options, manifest: f.manifest, fs: io })
  assert.equal(changed, true)
  assert.equal(result.success, false)
})

test('同站子域不得通过伪造可注册主域绕过', async t => {
  const f = await fixture(t, true)
  const check = f.evidence.checks[3]
  const item = check.evidence_files.find(file => file.role === 'source_records')
  const record = JSON.parse(await fs.readFile(path.join(f.options.evidenceRoot, item.path), 'utf8'))
  check.metrics.source_domains = ['a.example.org', 'b.example.org']
  record.source_domains = check.metrics.source_domains
  record.sources = check.metrics.source_domains.map(hostname => ({ hostname, registrable_domain: hostname, publisher: hostname }))
  record.images.forEach((image, index) => { image.source_url = `https://${check.metrics.source_domains[index]}/source` })
  check.evidence_files = check.evidence_files.filter(file => file !== item)
  await f.attachment(check, 'source_records', item.path, record)
  const saved = f.evidence.checks[4]
  saved.evidence_files = saved.evidence_files.filter(file => file.role !== 'save_record')
  await f.attachment(saved, 'save_record', 'offline_reopen_export/save_record.json', f.record(saved.id, { project_id: PROJECT, images: record.images }))
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('已有安装目录即使未传参数和installer阻断也必须核实', async t => {
  const f = await fixture(t)
  await fs.cp(f.options.packageRoot, f.options.installedRoot, { recursive: true })
  await write(f.options.installedRoot, 'unexpected.exe', 'unexpected')
  delete f.options.installedRoot
  const result = await api.validateReleaseEvidence(f.options)
  assert.equal(result.exitCode, 1, JSON.stringify(result))
})

test('探测期间修改截图或安装资源不得放行', async t => {
  const f = await fixture(t, true)
  f.options.spawn = () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    setImmediate(async () => {
      await write(f.options.evidenceRoot, 'public_browser/before_image.png', 'changed')
      child.stdout.end(JSON.stringify({ format: { duration: '20' }, streams: [{ codec_type: 'video', width: 1280, height: 720 }] }))
      child.emit('close', 0)
    })
    return child
  }
  const result = await api.validateReleaseEvidence(f.options)
  assert.equal(result.exitCode, 1, JSON.stringify(result))
})

test('报告超过2MiB明确拒绝', async t => {
  const f = await fixture(t)
  await write(f.options.evidenceRoot, 'evidence.json', ' '.repeat(2 * 1024 * 1024 + 1))
  const result = await api.validateReleaseEvidence(f.options)
  assert.equal(result.exitCode, 1)
  assert.match(result.blockers.join(' '), /上限/)
})

test('CLI完整阻断报告返回2且只读', async t => {
  const f = await fixture(t)
  f.manifest.created_at = new Date(Date.now() - 60000).toISOString()
  const manifestBytes = JSON.stringify(f.manifest)
  await fs.writeFile(f.options.manifestPath, manifestBytes)
  f.evidence.manifest_sha256 = hash(manifestBytes)
  f.evidence.created_at = new Date().toISOString()
  await f.persist()
  const before = await fs.readFile(f.options.evidencePath)
  const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../verify-research-release.js'), '--unpacked', f.options.packageRoot, '--manifest', f.options.manifestPath, '--evidence', f.options.evidencePath], { encoding: 'utf8' })
  assert.equal(cli.status, 2, cli.stdout)
  assert.equal(JSON.parse(cli.stdout.trim().split('\n').at(-1)).release_ready, false)
  assert.deepEqual(await fs.readFile(f.options.evidencePath), before)
})

test('缺少--installed不能将installer声明为pass', async t => {
  const f = await fixture(t, true)
  delete f.options.installedRoot
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('截断图片即使具有PNG头也不能冒充截图', async t => {
  const f = await fixture(t, true)
  const check = f.evidence.checks[2]
  check.evidence_files = check.evidence_files.filter(file => file.role !== 'before_image')
  await f.attachment(check, 'before_image', 'public_browser/before_image.png', png.subarray(0, 24))
  await f.persist()
  assert.equal((await api.validateReleaseEvidence(f.options)).exitCode, 1)
})

test('dir清单不能通过安装门槛', async t => {
  const f = await fixture(t, true)
  f.manifest.installer = null
  const bytes = JSON.stringify(f.manifest)
  await fs.writeFile(f.options.manifestPath, bytes)
  f.evidence.manifest_sha256 = hash(bytes)
  await f.persist()
  const result = await api.validateReleaseEvidence(f.options)
  assert.equal(result.exitCode, 1)
  assert.equal(result.checks.find(check => check.id === 'installer').status, 'fail')
})

test('导出必须实际引用全部研究图片，重复同图不能充当两张', async t => {
  const f = await fixture(t, true)
  const check = f.evidence.checks.find(item => item.id === 'offline_reopen_export')
  const file = check.evidence_files.find(item => item.role === 'export_request')
  const record = JSON.parse(await fs.readFile(path.join(f.options.evidenceRoot, file.path), 'utf8'))
  record.media_paths = [record.media_paths[0], record.media_paths[0]]
  check.evidence_files = check.evidence_files.filter(item => item !== file)
  await f.attachment(check, 'export_request', file.path, record)
  await f.persist()
  const result = await api.validateReleaseEvidence(f.options)
  assert.equal(result.exitCode, 1, JSON.stringify(result))
  assert.equal(result.checks.find(item => item.id === check.id).status, 'fail')
})

test('ffprobe网络媒体失败及终止失败不能变为pass', async t => {
  const f = await fixture(t, true)
  for (const mode of ['network', 'cleanup']) {
    f.options.spawn = () => {
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => { queueMicrotask(() => child.emit('close', 1)); return false }
      queueMicrotask(() => {
        if (mode === 'network') { child.stderr.write('Protocol https not on whitelist file'); child.emit('close', 1) }
        else child.stderr.write(Buffer.alloc(1024 * 1024 + 1))
      })
      return child
    }
    const result = await api.validateReleaseEvidence(f.options)
    assert.equal(result.exitCode, 1)
    assert.equal(result.checks.find(check => check.id === 'offline_reopen_export').status, 'fail')
  }
})

test('身份UTF-8排序固定且删除或改名文件失败', async t => {
  const f = await fixture(t)
  const expected = hash(JSON.stringify(f.manifest.files.map(({ path, size, sha256 }) => ({ path, size, sha256 }))))
  assert.equal(f.manifest.package_id, expected)
  const from = path.join(f.options.packageRoot, 'resources/backend/run.py')
  await fs.rename(from, `${from}.renamed`)
  assert.equal((await api.verifyPackageManifest({ ...f.options, manifest: f.manifest })).success, false)
  await fs.unlink(`${from}.renamed`)
  assert.equal((await api.verifyPackageManifest({ ...f.options, manifest: f.manifest })).success, false)
})

async function generatedSmoke(t) {
  const f = await fixture(t)
  const workspaceRoot = path.resolve(__dirname, '../../..')
  const runsRoot = path.join(workspaceRoot, '.agentmesh', 'research-r2')
  const runId = `evidence-test-${crypto.randomUUID()}`
  const evidenceRoot = path.join(runsRoot, runId)
  const target = path.join(evidenceRoot, 'package_offline.json')
  t.after(async () => {
    assert.equal(path.dirname(evidenceRoot), runsRoot)
    await fs.rm(evidenceRoot, { recursive: true, force: true })
  })
  f.manifest.created_at = new Date(Date.now() - 60000).toISOString()
  const manifestBytes = JSON.stringify(f.manifest)
  await fs.writeFile(f.options.manifestPath, manifestBytes)
  Object.assign(f.options, { workspaceRoot, evidenceRoot, evidencePath: path.join(evidenceRoot, 'evidence.json'), now: () => new Date() })
  delete f.options.installedRoot
  Object.assign(f.evidence, { run_id: runId, manifest_sha256: hash(manifestBytes), created_at: new Date().toISOString() })
  const controller = createResearchReport(target, f.options.manifestPath, f.options.packageRoot)
  const finishAll = async (failedStep = null) => {
    for (const step of ['identity_before', 'browser', 'desktop', 'export', 'cleanup', 'identity_after']) {
      controller.start(step)
      if (step.startsWith('identity_')) await controller.identity()
      const files = []
      if (step === 'browser') {
        await write(evidenceRoot, 'browser-screenshots/screenshot.png', png)
        files.push(controller.attachment('screenshot', 'browser-screenshots/screenshot.png'))
      }
      controller.finish(step, step !== failedStep, step === 'browser' ? { actions: 1, screenshots: 1 } : step === 'cleanup' ? { residual_processes: 0 } : {}, files)
    }
  }
  const aggregate = async () => {
    const report = JSON.parse(await fs.readFile(target, 'utf8'))
    const body = await fs.readFile(target)
    const check = f.evidence.checks.find(check => check.id === 'package_offline')
    Object.assign(check, { status: 'pass', started_at: report.started_at, finished_at: report.finished_at,
      metrics: { success: true, skipped: false, browser_actions: 1, screenshot_count: 1, residual_processes: 0, desktop_checks_passed: true },
      evidence_files: [{ role: 'smoke_report', path: 'package_offline.json', size: body.length, sha256: hash(body) }], note: '' })
    f.evidence.created_at = new Date().toISOString()
    await fs.writeFile(f.options.evidencePath, JSON.stringify(f.evidence))
    return api.validateReleaseEvidence(f.options)
  }
  return { ...f, controller, target, finishAll, aggregate }
}

test('实际smoke报告生成器与聚合schema兼容且导入不启动应用', async t => {
  const f = await generatedSmoke(t)
  assert.equal(f.controller.report.status, 'not_run')
  await f.finishAll()
  f.controller.finalize()
  const result = await f.aggregate()
  assert.equal(result.exitCode, 2, JSON.stringify(result))
  assert.equal(result.checks.find(check => check.id === 'package_offline').status, 'pass')
})

test('smoke终态报告不能被再次创建或更新', async t => {
  const f = await generatedSmoke(t)
  await f.finishAll()
  f.controller.finalize()
  const before = await fs.readFile(f.target)
  assert.throws(() => createResearchReport(f.target, f.options.manifestPath, f.options.packageRoot))
  assert.throws(() => f.controller.start('browser'), /终态/)
  assert.throws(() => f.controller.finalize(), /终态/)
  assert.deepEqual(await fs.readFile(f.target), before)
})

test('smoke失败终态不能写入未运行阶段的新附件', async t => {
  const f = await generatedSmoke(t)
  f.controller.start('browser')
  f.controller.finish('browser', false)
  assert.throws(() => f.controller.finalize(), /未全部通过/)
  const before = await fs.readdir(f.options.evidenceRoot)
  assert.throws(() => f.controller.finish('desktop', true), /终态/)
  assert.deepEqual(await fs.readdir(f.options.evidenceRoot), before)
})

test('生成器记录阶段失败，篡改顶层pass仍无法通过聚合', async t => {
  const f = await generatedSmoke(t)
  await f.finishAll('cleanup')
  assert.throws(() => f.controller.finalize(), /未全部通过/)
  const report = JSON.parse(await fs.readFile(f.target, 'utf8'))
  assert.equal(report.success, false)
  assert.equal(report.status, 'fail')
  report.success = true
  report.status = 'pass'
  await fs.writeFile(f.target, JSON.stringify(report))
  const result = await f.aggregate()
  assert.equal(result.exitCode, 1, JSON.stringify(result))
  assert.equal(result.checks.find(check => check.id === 'package_offline').status, 'fail')
})

for (const invalid of ['missing', 'skip']) test(`生成报告的${invalid}阶段不能通过`, async t => {
  const f = await generatedSmoke(t)
  await f.finishAll()
  f.controller.finalize()
  const report = JSON.parse(await fs.readFile(f.target, 'utf8'))
  if (invalid === 'missing') delete report.steps.export
  else report.steps.export.status = 'skip'
  await fs.writeFile(f.target, JSON.stringify(report))
  const result = await f.aggregate()
  assert.equal(result.exitCode, 1, JSON.stringify(result))
})
