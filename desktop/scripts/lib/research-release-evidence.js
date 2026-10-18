'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面脚本沿用现有 CommonJS 运行方式。 */

const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const MAX_JSON = 2 * 1024 * 1024
const MAX_MANIFEST = 64 * 1024 * 1024
const MAX_FILES = 200000
const HEX = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const IDS = ['package_offline', 'installer', 'public_browser', 'real_search', 'offline_reopen_export', 'model_modes', 'regression']
const METRICS = {
  package_offline: ['success', 'skipped', 'browser_actions', 'screenshot_count', 'residual_processes', 'desktop_checks_passed'],
  installer: ['installer_sha256', 'installed_resources_match', 'launch_passed', 'installer_file'],
  public_browser: ['final_url', 'dynamic_change', 'visible_actions', 'screenshot_count', 'policy_unchanged', 'reviewed'],
  real_search: ['source_domains', 'independent_publishers', 'downloaded_images', 'project_id', 'real_provider', 'reviewed'],
  offline_reopen_export: ['project_id', 'public_network_blocked', 'loopback_available', 'reopened', 'duration_seconds', 'video_streams', 'frame_checks', 'reviewed'],
  model_modes: ['auxiliary_calls_disabled', 'auxiliary_calls_enabled', 'configured_model', 'effective_model', 'sources_valid'],
  regression: ['scoped_failures', 'scoped_errors', 'typecheck_exit', 'build_exit', 'lint_changed_exit', 'baseline_comparison'],
}
const ROLES = {
  package_offline: ['smoke_report'],
  installer: ['install_record', 'launch_record'],
  public_browser: ['before_image', 'after_image', 'tool_record'],
  real_search: ['source_records', 'provider_record', 'image'],
  offline_reopen_export: ['save_record', 'reopen_record', 'network_record', 'export_request', 'video', 'probe_record', 'frame'],
  model_modes: ['disabled_record', 'enabled_record'],
  regression: ['test_results', 'baseline_comparison'],
}
const RECORD_EXTRA = {
  install_record: ['uninstaller'], launch_record: [], tool_record: [],
  source_records: ['sources', 'images'], provider_record: [],
  save_record: ['images'], reopen_record: [], network_record: ['method'],
  export_request: ['media_paths'], probe_record: ['width', 'height'],
  disabled_record: [], enabled_record: [], test_results: ['commands'], baseline_comparison: ['summary'],
}
const IMAGE_ROLES = new Set(['before_image', 'after_image', 'image', 'frame', 'screenshot'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = data => crypto.createHash('sha256').update(data).digest('hex')
const order = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))
const packageId = files => digest(JSON.stringify(files.map(({ path: name, size, sha256 }) => ({ path: name, size, sha256 }))))
const now = options => new Date(options.now ? options.now() : Date.now()).getTime()
function requireThat(condition, message) { if (!condition) throw new Error(message) }
function fields(value, allowed, required = allowed) {
  requireThat(object(value), '对象结构无效')
  requireThat(Object.keys(value).every(key => allowed.includes(key)), '包含未知字段')
  requireThat(required.every(key => Object.hasOwn(value, key)), '缺少必需字段')
}
function text(value, limit = 2000) { return typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value) }
function relative(name) {
  requireThat(typeof name === 'string' && name.length > 0 && !/[\\:\u0000-\u001f]/.test(name), '相对路径无效')
  const parts = name.split('/')
  requireThat(parts.every(part => part && part !== '.' && part !== '..' && !/[ .]$/.test(part) && !/^[<>"|?*]/.test(part) && !/[<>"|?*]/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), '相对路径包含歧义片段')
  return parts
}
function inside(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}
function samePath(a, b) { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() }
function sameStat(a, b) { return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev }

// Every component is checked before reading. realpath alone would silently follow junctions.
async function checkedPath(io, root, name = '', directory = false) {
  const parts = name ? relative(name) : []
  let current = root
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i])
    const stat = await io.lstat(current)
    requireThat(!stat.isSymbolicLink(), '不允许符号链接或junction')
    requireThat(samePath(await io.realpath(current), current), '真实路径与声明路径不一致')
    requireThat(inside(root, current), '路径越出允许根目录')
    if (i < parts.length - 1 || directory) requireThat(stat.isDirectory(), '路径应为目录')
    else requireThat(stat.isFile(), '路径应为普通文件')
  }
  return current
}
async function rootPath(io, workspace, target) {
  requireThat(typeof target === 'string' && path.isAbsolute(target), '必须显式提供绝对根路径')
  const absolute = path.resolve(target)
  requireThat(inside(workspace, absolute), '根目录不在工作区内')
  const rel = path.relative(workspace, absolute).split(path.sep).join('/')
  await checkedPath(io, workspace, rel, true)
  return absolute
}
async function roots(options, evidence = false) {
  const io = options.fs || fs
  requireThat(typeof options.workspaceRoot === 'string' && path.isAbsolute(options.workspaceRoot), '缺少显式工作区根')
  const workspace = path.resolve(options.workspaceRoot)
  // Include ancestors of the workspace, so a linked workspace cannot widen the boundary.
  const volume = path.parse(workspace).root
  await checkedPath(io, volume, path.relative(volume, workspace).split(path.sep).join('/'), true)
  const release = await rootPath(io, workspace, options.releaseRoot)
  const pkg = await rootPath(io, workspace, options.packageRoot)
  requireThat(inside(release, pkg) && !samePath(release, pkg), '包根必须位于release根内')
  const result = { io, workspace, release, pkg }
  if (evidence) {
    result.evidence = await rootPath(io, workspace, options.evidenceRoot)
    requireThat(!inside(release, result.evidence) && !inside(result.evidence, release), '证据根与release根不能重叠')
    const installed = path.join(result.evidence, 'installed')
    if (options.installedRoot) requireThat(samePath(options.installedRoot, installed), '安装根必须是证据目录下installed')
    try { result.installed = await rootPath(io, workspace, installed) } catch (error) { if (error.code !== 'ENOENT') throw error }
    result.verifiedAttachments = new Map()
  }
  return result
}
async function hashFile(io, root, name, limit = Infinity, capture = false) {
  const target = await checkedPath(io, root, name)
  const before = await io.lstat(target)
  requireThat(before.size <= limit, '文件超过读取上限')
  const handle = await io.open(target, 'r')
  const chunks = []
  const hash = crypto.createHash('sha256')
  let size = 0
  try {
    requireThat(sameStat(before, await handle.stat()), '文件在打开时发生变化')
    const buffer = Buffer.alloc(64 * 1024)
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      size += bytesRead
      requireThat(size <= limit, '文件超过读取上限')
      hash.update(buffer.subarray(0, bytesRead))
      if (capture) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    requireThat(sameStat(before, await handle.stat()), '文件在读取期间发生变化')
  } finally { await handle.close() }
  await checkedPath(io, root, name)
  requireThat(size === before.size && sameStat(before, await io.lstat(target)), '文件在散列期间发生变化')
  return { path: name, size, sha256: hash.digest('hex'), ...(capture ? { bytes: Buffer.concat(chunks) } : {}) }
}
async function enumerate(io, root) {
  const entries = []
  const folded = new Set()
  async function walk(name) {
    const directory = await checkedPath(io, root, name, true)
    for (const leaf of await io.readdir(directory)) {
      const child = name ? `${name}/${leaf}` : leaf
      relative(child)
      const key = child.toLowerCase()
      requireThat(!folded.has(key), 'Windows路径大小写碰撞')
      folded.add(key)
      const stat = await io.lstat(path.join(root, child))
      requireThat(!stat.isSymbolicLink(), '不允许符号链接或junction')
      if (stat.isDirectory()) await walk(child)
      else {
        await checkedPath(io, root, child)
        requireThat(entries.length < MAX_FILES, '包文件数量超过上限')
        entries.push({ path: child, stat })
      }
    }
  }
  await walk('')
  return entries.sort((a, b) => order(a.path, b.path))
}
async function tree(options, io, root) {
  const before = await enumerate(io, root)
  const files = new Array(before.length)
  let next = 0
  let completed = 0
  async function worker() {
    while (next < before.length) {
      const index = next++
      files[index] = await hashFile(io, root, before[index].path)
      requireThat(sameStat(before[index].stat, await io.lstat(path.join(root, before[index].path))), '包文件在扫描期间发生变化')
      completed++
    }
  }
  // At most two streaming readers, including on very large browser installations.
  const progress = setInterval(() => options.onProgress?.({ phase: 'hash', completed, total: before.length }), 30000)
  let results
  try { results = await Promise.allSettled([worker(), worker()]) } finally { clearInterval(progress) }
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const after = await enumerate(io, root)
  requireThat(before.length === after.length && before.every((entry, i) => entry.path === after[i].path && sameStat(entry.stat, after[i].stat)), '包文件集合或元数据发生变化')
  return files
}
function timestamp(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), 'UTC时间格式无效')
  return Date.parse(value)
}
function fileEntry(item) {
  fields(item, ['path', 'size', 'sha256'])
  relative(item.path)
  requireThat(Number.isSafeInteger(item.size) && item.size >= 0 && HEX.test(item.sha256), '文件大小或散列无效')
}
function manifestSchema(manifest, options) {
  fields(manifest, ['schema_version', 'created_at', 'source_head', 'dirty', 'frontend_build_id', 'package_id', 'runtime', 'files', 'installer'])
  requireThat(manifest.schema_version === 1 && HEX.test(manifest.package_id) && typeof manifest.dirty === 'boolean', '构建清单身份无效')
  requireThat(/^[a-f0-9]{40,64}$/.test(manifest.source_head) && text(manifest.frontend_build_id, 256), '源码或前端构建身份无效')
  requireThat(timestamp(manifest.created_at) <= now(options) + 300000, '构建时间位于未来')
  fields(manifest.runtime, ['python', 'playwright', 'beautifulsoup', 'browser', 'ffmpeg', 'ffprobe'])
  requireThat(Object.values(manifest.runtime).every(value => text(value, 512)), '运行时字段无效')
  // CDP 方案：browser 指向内嵌 Electron Chromium（非包内相对路径），
  // 只强制 ffmpeg/ffprobe 为固定包内程序。
  requireThat(manifest.runtime.browser.includes('CDP'), '浏览器必须为内嵌 Electron Chromium（CDP）')
  requireThat(manifest.runtime.ffprobe === 'resources/ffmpeg/ffprobe.exe', 'ffprobe必须为固定包内程序')
  requireThat(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= MAX_FILES, '包文件列表无效')
  const folded = new Set()
  manifest.files.forEach((file, index) => {
    fileEntry(file)
    requireThat(!folded.has(file.path.toLowerCase()), 'Windows路径大小写碰撞')
    folded.add(file.path.toLowerCase())
    requireThat(index === 0 || order(manifest.files[index - 1].path, file.path) < 0, '清单文件未按UTF-8字节排序')
  })
  // CDP 方案：浏览器为内嵌 Electron Chromium，不在包文件清单中；
  // 只要求 ffmpeg/ffprobe 在包内。
  for (const key of ['ffmpeg', 'ffprobe']) requireThat(manifest.files.some(file => file.path === manifest.runtime[key]), '清单缺少必需运行时文件')
  requireThat(packageId(manifest.files) === manifest.package_id, '清单包身份不匹配')
  if (manifest.installer !== null) fileEntry(manifest.installer)
}
function safeError(error) { return error.code ? `文件系统操作失败 (${error.code})` : error.message }
async function createPackageManifest(options) {
  try {
    const root = await roots(options)
    const files = await tree(options, root.io, root.pkg)
    let installer = null
    if (options.installerPath) {
      relative(options.installerPath)
      requireThat(!inside(root.pkg, path.join(root.release, options.installerPath)), '安装器不能位于包树内')
      installer = await hashFile(root.io, root.release, options.installerPath)
    }
    const manifest = { schema_version: 1, created_at: new Date(now(options)).toISOString(), source_head: options.sourceHead, dirty: options.dirty, frontend_build_id: options.frontendBuildId, package_id: packageId(files), runtime: options.runtime, files, installer }
    manifestSchema(manifest, options)
    return { success: true, manifest, package_id: manifest.package_id, errors: [] }
  } catch (error) { return { success: false, errors: [safeError(error)] } }
}
async function verifyPackageManifest(options) {
  try {
    manifestSchema(options.manifest, options)
    const root = await roots(options)
    const files = await tree(options, root.io, root.pkg)
    requireThat(JSON.stringify(files) === JSON.stringify(options.manifest.files), '实际包文件集合或内容与清单不匹配')
    if (options.manifest.installer) {
      requireThat(!inside(root.pkg, path.join(root.release, options.manifest.installer.path)), '安装器不能位于包树内')
      const actual = await hashFile(root.io, root.release, options.manifest.installer.path)
      requireThat(JSON.stringify(actual) === JSON.stringify(options.manifest.installer), '实际安装器与清单不匹配')
    }
    return { success: true, package_id: packageId(files), errors: [] }
  } catch (error) { return { success: false, errors: [safeError(error)] } }
}

async function readJson(io, root, name, limit = MAX_JSON) {
  const file = await hashFile(io, root, name, limit, true)
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
    return { value: JSON.parse(content), sha256: file.sha256 }
  } catch { throw new Error('JSON或UTF-8格式无效') }
}
function boundFile(root, file) {
  requireThat(typeof file === 'string' && path.isAbsolute(file) && inside(root, file), '输入文件必须位于规定根目录')
  const rel = path.relative(root, file).split(path.sep).join('/')
  relative(rel)
  return rel
}
function times(value, manifest, options, terminal = true) {
  if (value.started_at === null) {
    requireThat(!terminal && value.finished_at === null, '执行时间缺失')
    return
  }
  const start = timestamp(value.started_at)
  requireThat(start >= timestamp(manifest.created_at) - 300000 && start <= now(options) + 300000, '开始时间与构建时间不一致')
  if (value.finished_at === null) { requireThat(!terminal, '结束时间缺失'); return }
  const finish = timestamp(value.finished_at)
  requireThat(finish >= start && finish <= now(options) + 300000, '执行时间顺序无效或位于未来')
}
function count(value, min = 0) { return Number.isSafeInteger(value) && value >= min }
function cleanName(value) { return text(value, 200) && !/(?:https?:\/\/|authorization|api[_-]?key|token[=:]|[A-Za-z]:[\\/])/i.test(value) }
function cleanUrl(value) {
  requireThat(typeof value === 'string' && value.trim() === value && !/[\\\u0000-\u0020]/.test(value), 'URL无效')
  let url
  try { url = new URL(value) } catch { throw new Error('URL无效') }
  requireThat(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash, 'URL含凭证或不支持的协议')
  requireThat(!Array.from(url.searchParams.keys()).some(key => /key|token|auth|sign|secret|credential|password|session/i.test(key)), 'URL含敏感查询参数')
  return url
}
function validMetrics(id, metrics, pass) {
  fields(metrics, METRICS[id], pass ? METRICS[id] : [])
  for (const [key, value] of Object.entries(metrics)) {
    if (['installer_sha256'].includes(key)) requireThat(typeof value === 'string' && HEX.test(value), '指标散列无效')
    else if (['installer_file', 'baseline_comparison'].includes(key)) relative(value)
    else if (key === 'project_id') requireThat(typeof value === 'string' && UUID.test(value), '项目ID无效')
    else if (key === 'source_domains') requireThat(Array.isArray(value) && value.every(host => typeof host === 'string' && host === host.toLowerCase() && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes('.') && !host.includes('..')) && new Set(value).size === value.length, '来源域名无效或重复')
    else if (key === 'final_url') cleanUrl(value)
    else if (['configured_model', 'effective_model'].includes(key)) requireThat(cleanName(value), '模型名称无效或未脱敏')
    else if (key === 'duration_seconds') requireThat(typeof value === 'number' && Number.isFinite(value) && value > 0, '媒体时长无效')
    else if (['browser_actions', 'screenshot_count', 'residual_processes', 'visible_actions', 'independent_publishers', 'downloaded_images', 'video_streams', 'frame_checks', 'auxiliary_calls_disabled', 'auxiliary_calls_enabled', 'scoped_failures', 'scoped_errors', 'typecheck_exit', 'build_exit', 'lint_changed_exit'].includes(key)) requireThat(count(value), '计数必须为非负整数')
    else requireThat(typeof value === 'boolean', '布尔指标无效')
  }
  if (!pass) return
  const m = metrics
  const criteria = {
    package_offline: () => m.success === true && m.skipped === false && m.browser_actions >= 1 && m.screenshot_count >= 1 && m.residual_processes === 0 && m.desktop_checks_passed === true,
    installer: () => m.installed_resources_match === true && m.launch_passed === true,
    public_browser: () => m.dynamic_change === true && m.visible_actions >= 1 && m.screenshot_count >= 2 && m.policy_unchanged === true && m.reviewed === true,
    real_search: () => m.source_domains.length >= 2 && m.independent_publishers >= 2 && m.downloaded_images >= 2 && m.real_provider === true && m.reviewed === true,
    offline_reopen_export: () => m.public_network_blocked === true && m.loopback_available === true && m.reopened === true && m.duration_seconds >= 19 && m.duration_seconds <= 21 && m.video_streams >= 1 && m.frame_checks === 2 && m.reviewed === true,
    model_modes: () => m.auxiliary_calls_disabled === 0 && m.auxiliary_calls_enabled >= 1 && m.sources_valid === true,
    regression: () => ['scoped_failures', 'scoped_errors', 'typecheck_exit', 'build_exit', 'lint_changed_exit'].every(key => m[key] === 0),
  }
  requireThat(criteria[id](), '指标未满足通过条件')
}
async function imageFormat(io, root, name) {
  const target = await checkedPath(io, root, name)
  const handle = await io.open(target, 'r')
  const buffer = Buffer.alloc(32)
  const tail = Buffer.alloc(12)
  let bytesRead
  let size
  try {
    size = (await handle.stat()).size
    ;({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0))
    if (size >= tail.length) await handle.read(tail, 0, tail.length, size - tail.length)
  } finally { await handle.close() }
  const png = size >= 57 && bytesRead >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 && tail.toString('ascii', 4, 8) === 'IEND'
  const jpeg = size >= 32 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && tail[10] === 0xff && tail[11] === 0xd9
  const gif = size >= 32 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6)) && buffer.readUInt16LE(6) > 0 && buffer.readUInt16LE(8) > 0 && tail[11] === 0x3b
  const webp = size >= 32 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.readUInt32LE(4) + 8 === size && buffer.toString('ascii', 8, 12) === 'WEBP' && /^VP8[ LX]$/.test(buffer.toString('ascii', 12, 16))
  requireThat(png || jpeg || gif || webp, '图片附件格式无效')
}
async function attachments(root, files, roles) {
  requireThat(Array.isArray(files) && files.length <= 64, '附件数量无效或超过上限')
  const names = new Set()
  const byRole = new Map()
  for (const file of files) {
    fields(file, ['role', 'path', 'size', 'sha256'])
    fileEntry({ path: file.path, size: file.size, sha256: file.sha256 })
    requireThat(roles.includes(file.role), '附件角色未知')
    requireThat(!names.has(file.path.toLowerCase()), '附件路径重复')
    // Never accept whole runtime state or credentials as an evidence attachment.
    requireThat(!file.path.split('/').some(part => /^(user-data|installed)$/i.test(part)), '运行数据或安装树不能作为附件')
    names.add(file.path.toLowerCase())
    const actual = await hashFile(root.io, root.evidence, file.path)
    requireThat(actual.size === file.size && actual.sha256 === file.sha256, '附件大小或散列不匹配')
    const previous = root.verifiedAttachments.get(file.path.toLowerCase())
    requireThat(!previous || (previous.path === file.path && previous.sha256 === file.sha256 && previous.size === file.size), '跨检查附件身份冲突')
    root.verifiedAttachments.set(file.path.toLowerCase(), file)
    if (IMAGE_ROLES.has(file.role)) await imageFormat(root.io, root.evidence, file.path)
    const group = byRole.get(file.role) || []
    group.push(file)
    requireThat(['image', 'frame', 'screenshot', 'execution_record'].includes(file.role) || group.length === 1, '单一附件角色重复')
    byRole.set(file.role, group)
  }
  return byRole
}
function recordIdentity(record, evidence, checkId) {
  requireThat(record.schema_version === 1 && record.run_id === evidence.run_id && record.package_id === evidence.package_id && record.check_id === checkId, '附件记录身份与运行不一致')
}
async function records(root, evidence, check, roles) {
  const result = {}
  for (const [role, files] of roles) {
    if (!Object.hasOwn(RECORD_EXTRA, role)) continue
    const { value } = await readJson(root.io, root.evidence, files[0].path)
    fields(value, ['schema_version', 'run_id', 'package_id', 'check_id', ...METRICS[check.id], ...RECORD_EXTRA[role]], ['schema_version', 'run_id', 'package_id', 'check_id'])
    recordIdentity(value, evidence, check.id)
    for (const key of METRICS[check.id]) if (Object.hasOwn(value, key)) requireThat(JSON.stringify(value[key]) === JSON.stringify(check.metrics[key]), '附件观察值与汇总指标不匹配')
    result[role] = value
  }
  return result
}
function observed(record, keys) { requireThat(keys.every(key => Object.hasOwn(record, key)), '原始记录缺少必需观察值') }
function review(check, manifest, options) {
  if (['package_offline', 'regression'].includes(check.id) && check.review === null) return
  fields(check.review, ['reviewer', 'reviewed_at', 'verdict', 'evidence_paths', 'limitations'])
  requireThat(cleanName(check.review.reviewer) && check.review.verdict === 'pass' && text(check.review.limitations) && !/^(已检查|checked|ok|pass)[。.!]?$/i.test(check.review.limitations), '人工复核结论缺少明确观察或限制')
  const time = timestamp(check.review.reviewed_at)
  requireThat(time >= timestamp(manifest.created_at) - 300000 && time >= timestamp(check.finished_at) - 300000 && time <= now(options) + 300000, '复核时间无效')
  requireThat(Array.isArray(check.review.evidence_paths) && new Set(check.review.evidence_paths).size === check.review.evidence_paths.length, '复核附件路径无效')
  check.review.evidence_paths.forEach(relative)
  requireThat(check.evidence_files.every(file => check.review.evidence_paths.includes(file.path)) && check.review.evidence_paths.every(name => check.evidence_files.some(file => file.path === name)), '人工复核未覆盖关键附件')
}
async function smokeReport(root, evidence, check, manifest, options, roles) {
  const { value: report } = await readJson(root.io, root.evidence, roles.get('smoke_report')[0].path)
  fields(report, ['schema_version', 'run_id', 'package_id', 'manifest_sha256', 'started_at', 'finished_at', 'status', 'success', 'skipped', 'steps'])
  requireThat(report.schema_version === 1 && report.run_id === evidence.run_id && report.package_id === evidence.package_id && report.manifest_sha256 === evidence.manifest_sha256, 'smoke身份不匹配')
  requireThat(report.status === 'pass' && report.success === true && report.skipped === false, 'smoke未实际通过')
  times(report, manifest, options)
  requireThat(timestamp(report.started_at) >= timestamp(check.started_at) - 300000 && timestamp(report.finished_at) <= timestamp(check.finished_at) + 300000, 'smoke时间与聚合记录不一致')
  const names = ['identity_before', 'browser', 'desktop', 'export', 'cleanup', 'identity_after']
  fields(report.steps, names)
  for (const name of names) {
    const step = report.steps[name]
    fields(step, ['status', 'started_at', 'finished_at', 'evidence_files', 'metrics', 'note'])
    requireThat(step.status === 'pass' && typeof step.note === 'string' && step.note.length <= 2000, 'smoke子步骤未通过')
    times(step, manifest, options)
    requireThat(timestamp(step.started_at) >= timestamp(report.started_at) - 300000 && timestamp(step.finished_at) <= timestamp(report.finished_at) + 300000, 'smoke子步骤时间不一致')
    const files = await attachments(root, step.evidence_files, ['execution_record', 'screenshot'])
    requireThat(files.has('execution_record'), 'smoke子步骤缺少执行记录')
    for (const file of files.get('execution_record')) {
      const { value } = await readJson(root.io, root.evidence, file.path)
      fields(value, ['schema_version', 'run_id', 'package_id', 'check_id', 'step', 'success', 'summary'], ['schema_version', 'run_id', 'package_id', 'check_id', 'step', 'success'])
      recordIdentity(value, evidence, check.id)
      requireThat(value.step === name && value.success === true, 'smoke原始执行记录未通过')
    }
    if (name === 'browser') {
      fields(step.metrics, ['actions', 'screenshots'])
      requireThat(count(step.metrics.actions, 1) && count(step.metrics.screenshots, 1) && step.metrics.screenshots === (files.get('screenshot') || []).length, 'smoke浏览器动作或截图不足')
      requireThat(step.metrics.actions === check.metrics.browser_actions && step.metrics.screenshots === check.metrics.screenshot_count, 'smoke累计指标不一致')
    } else if (name === 'cleanup') {
      fields(step.metrics, ['residual_processes'])
      requireThat(step.metrics.residual_processes === 0 && check.metrics.residual_processes === 0, 'smoke存在残留进程')
    } else fields(step.metrics, [])
  }
}
async function installedTree(root, check, manifest, record, options) {
  requireThat(manifest.installer !== null && root.installed && options.installedRoot, '缺少完整安装器、实际安装目录或--installed参数')
  requireThat(check.metrics.installer_file === manifest.installer.path && check.metrics.installer_sha256 === manifest.installer.sha256, '安装器证据与清单不匹配')
  observed(record.install_record, ['installer_sha256', 'installer_file', 'installed_resources_match', 'uninstaller'])
  observed(record.launch_record, ['launch_passed'])
  const files = await tree(options, root.io, root.installed)
  const expected = new Map(manifest.files.map(file => [file.path, file]))
  const extras = []
  for (const file of files) {
    const entry = expected.get(file.path)
    if (!entry) extras.push(file)
    else { requireThat(file.size === entry.size && file.sha256 === entry.sha256, '安装资源与包不匹配'); expected.delete(file.path) }
  }
  requireThat(expected.size === 0, '安装资源缺失')
  const uninstaller = record.install_record.uninstaller
  if (uninstaller === null) requireThat(extras.length === 0, '安装树包含未授权额外文件')
  else {
    fileEntry(uninstaller)
    requireThat(!uninstaller.path.includes('/') && /^Uninstall Ecliptrix(?: [0-9.]+)?\.exe$/.test(uninstaller.path), '附加文件不是产品根级NSIS卸载器')
    requireThat(extras.length === 1 && extras[0].path === uninstaller.path && extras[0].size === uninstaller.size && extras[0].sha256 === uninstaller.sha256, '卸载器记录与实际附加文件不匹配')
  }
}
function imageProvenance(value, images) {
  requireThat(Array.isArray(value) && value.length === images.length, '图片provenance数量不匹配')
  const names = new Set()
  for (const item of value) {
    fields(item, ['path', 'sha256', 'source_id', 'source_url'])
    relative(item.path)
    cleanUrl(item.source_url)
    requireThat(cleanName(item.source_id) && HEX.test(item.sha256) && !names.has(item.path), '图片provenance字段无效')
    names.add(item.path)
    requireThat(images.some(image => image.path === item.path && image.sha256 === item.sha256), '图片provenance与本地附件不匹配')
  }
}
function searchRecords(check, record, roles) {
  observed(record.source_records, ['project_id', 'source_domains', 'independent_publishers', 'downloaded_images', 'sources', 'images'])
  observed(record.provider_record, ['project_id', 'real_provider'])
  const sources = record.source_records.sources
  requireThat(Array.isArray(sources) && sources.length >= 2 && sources.length <= 64, '来源记录不足')
  for (const source of sources) {
    fields(source, ['hostname', 'registrable_domain', 'publisher'])
    requireThat(check.metrics.source_domains.includes(source.hostname) && typeof source.registrable_domain === 'string' && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(source.registrable_domain) && (source.hostname === source.registrable_domain || source.hostname.endsWith(`.${source.registrable_domain}`)) && cleanName(source.publisher), '来源域或发布者记录无效')
  }
  requireThat(check.metrics.source_domains.every(host => sources.some(source => source.hostname === host)), '来源域缺少发布者记录')
  const domains = new Set(sources.map(source => source.registrable_domain))
  const publishers = new Set(sources.map(source => source.publisher.normalize('NFKC').trim().toLowerCase()))
  requireThat(domains.size >= 2 && publishers.size >= 2 && check.metrics.independent_publishers === publishers.size, '同站子域或相同发布者不算独立来源')
  // Conservative same-site grouping is an anti-subdomain check, not an ownership
  // or public-suffix service. Review still verifies registrable domain and publisher.
  const siteGroups = new Set(sources.map(source => {
    const labels = source.hostname.split('.')
    const ccSecondLevel = labels.at(-1).length === 2 && /^(ac|co|com|edu|gov|net|org)$/.test(labels.at(-2))
    return labels.slice(ccSecondLevel ? -3 : -2).join('.')
  }))
  requireThat(siteGroups.size >= 2, '同站子域不能作为独立来源')
  const images = roles.get('image') || []
  requireThat(images.length >= 2 && images.length === check.metrics.downloaded_images, '图片数量不一致')
  imageProvenance(record.source_records.images, images)
  requireThat(record.source_records.images.every(image => check.metrics.source_domains.includes(cleanUrl(image.source_url).hostname)), '图片来源未关联研究来源')
}
async function probeVideo(options, executable, media) {
  return new Promise((resolve, reject) => {
    let child
    try { child = (options.spawn || spawn)(executable, ['-v', 'error', '-protocol_whitelist', 'file', '-show_streams', '-show_format', '-of', 'json', media], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) } catch { reject(new Error('ffprobe启动失败')); return }
    let failure = null
    let settled = false
    let cleanupTimer
    const buffers = { stdout: [], stderr: [] }
    const sizes = { stdout: 0, stderr: 0 }
    function finish(error, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(cleanupTimer)
      if (error) reject(error)
      else resolve(value)
    }
    function stop(message) {
      if (failure || settled) return
      failure = new Error(message)
      // Wait for close after killing; a failed cleanup can never become a pass.
      cleanupTimer = setTimeout(() => finish(new Error('ffprobe终止后未退出，清理失败')), 5000)
      try { if (!child.kill('SIGKILL')) failure = new Error('ffprobe清理失败') } catch { failure = new Error('ffprobe清理失败') }
    }
    const timer = setTimeout(() => stop('ffprobe超时'), options.spawn ? Math.min(options.probeTimeoutMs || 30000, 30000) : 30000)
    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', chunk => {
        if (failure) return
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        sizes[stream] += bytes.length
        if (sizes[stream] > 1024 * 1024) stop(`ffprobe ${stream}超过上限`)
        else buffers[stream].push(bytes)
      })
      child[stream].on('error', () => stop('ffprobe输出读取失败'))
    }
    child.on('error', () => { failure = new Error('ffprobe启动或执行失败') })
    child.on('close', code => {
      if (failure) { finish(failure); return }
      if (code !== 0) { finish(new Error('ffprobe执行失败或媒体引用禁用协议')); return }
      try {
        const data = JSON.parse(Buffer.concat(buffers.stdout).toString('utf8'))
        const duration = Number(data.format?.duration)
        requireThat(Number.isFinite(duration) && duration >= 19 && duration <= 21, '实际视频时长不合格')
        requireThat(Array.isArray(data.streams), 'ffprobe未返回媒体流')
        const video = data.streams.filter(stream => stream.codec_type === 'video')
        requireThat(video.length >= 1 && video.every(stream => count(stream.width, 1) && count(stream.height, 1)), '实际视频流或宽高不合格')
        finish(null, { duration_seconds: duration, video_streams: video.length, width: video[0].width, height: video[0].height })
      } catch (error) { finish(new Error(error.message.startsWith('实际') || error.message.startsWith('ffprobe') ? error.message : 'ffprobe返回无效JSON')) }
    })
  })
}
async function exportRecords(root, evidence, check, record, roles, manifest, options, search) {
  requireThat(search?.check.status === 'pass' && check.metrics.project_id === search.check.metrics.project_id, '导出与真实研究项目不一致')
  for (const role of ['save_record', 'reopen_record', 'export_request']) observed(record[role], ['project_id'])
  observed(record.reopen_record, ['reopened'])
  observed(record.network_record, ['public_network_blocked', 'loopback_available', 'method'])
  requireThat(text(record.network_record.method), '缺少实际断网方法及探测说明')
  observed(record.save_record, ['images'])
  imageProvenance(record.save_record.images, search.roles.get('image'))
  requireThat(JSON.stringify(record.save_record.images) === JSON.stringify(search.record.source_records.images), '保存记录与研究provenance不一致')
  requireThat(Array.isArray(record.export_request.media_paths) && record.export_request.media_paths.length >= 2, '导出请求缺少本地素材')
  for (const name of record.export_request.media_paths) {
    relative(name)
    requireThat(search.roles.get('image').some(image => image.path === name), '导出引用未验证本地素材或网络协议')
  }
  requireThat(search.roles.get('image').every(image => record.export_request.media_paths.includes(image.path)), '导出未覆盖全部已验证研究图片')
  requireThat((roles.get('frame') || []).length === check.metrics.frame_checks, '抽帧数量不匹配')
  const media = roles.get('video')[0]
  requireThat(/\.mp4$/i.test(media.path), 'video附件必须为MP4')
  observed(record.probe_record, ['duration_seconds', 'video_streams', 'width', 'height'])
  const before = await hashFile(root.io, root.evidence, media.path)
  const executable = await checkedPath(root.io, root.pkg, manifest.runtime.ffprobe)
  const result = await probeVideo(options, executable, await checkedPath(root.io, root.evidence, media.path))
  const after = await hashFile(root.io, root.evidence, media.path)
  requireThat(before.sha256 === after.sha256 && before.sha256 === media.sha256, '探测期间媒体文件发生变化')
  requireThat(Math.abs(result.duration_seconds - check.metrics.duration_seconds) <= 0.05 && result.video_streams === check.metrics.video_streams, '实际视频与声明指标不一致')
  requireThat(Math.abs(result.duration_seconds - record.probe_record.duration_seconds) <= 0.05 && result.video_streams === record.probe_record.video_streams && result.width === record.probe_record.width && result.height === record.probe_record.height, 'probe_record与本次探测不一致')
}

async function validateReleaseEvidence(options) {
  const result = { success: false, release_ready: false, package_id: null, checks: [], blockers: [], exitCode: 1 }
  try {
    const root = await roots(options, true)
    const manifestName = boundFile(root.release, options.manifestPath)
    requireThat(samePath(path.dirname(options.manifestPath), root.release) && !inside(root.pkg, options.manifestPath), '清单必须直接位于release根且在包树外')
    const evidenceName = boundFile(root.evidence, options.evidencePath)
    requireThat(samePath(path.dirname(options.evidencePath), root.evidence), '报告必须直接位于证据根')
    const manifestFile = await readJson(root.io, root.release, manifestName, MAX_MANIFEST)
    const manifest = manifestFile.value
    const verified = await verifyPackageManifest({ ...options, manifest })
    requireThat(verified.success, verified.errors.join('；'))
    result.package_id = verified.package_id
    const evidenceFile = await readJson(root.io, root.evidence, evidenceName)
    const evidence = evidenceFile.value
    fields(evidence, ['schema_version', 'run_id', 'package_id', 'manifest_sha256', 'created_at', 'checks'])
    requireThat(evidence.schema_version === 1 && evidence.run_id === path.basename(root.evidence) && text(evidence.run_id, 128), '报告运行身份无效')
    requireThat(evidence.package_id === verified.package_id && evidence.manifest_sha256 === manifestFile.sha256, '报告与包或清单身份不一致')
    requireThat(timestamp(evidence.created_at) >= timestamp(manifest.created_at) - 300000 && timestamp(evidence.created_at) <= now(options) + 300000, '报告创建时间无效')
    requireThat(Array.isArray(evidence.checks) && evidence.checks.length === IDS.length && new Set(evidence.checks.map(check => check.id)).size === IDS.length && evidence.checks.every(check => IDS.includes(check.id)), '必需检查缺失、重复或未知')
    const contexts = new Map()
    const installerCheck = evidence.checks.find(check => check.id === 'installer')
    if (root.installed && installerCheck.status !== 'pass') {
      const installed = await tree(options, root.io, root.installed)
      requireThat(packageId(installed) === manifest.package_id, '已有安装树与包不匹配，或附加文件缺少通过的安装复核')
    }
    let failed = false
    let blocked = false
    // Fixed order makes cross-record dependencies independent of JSON array order.
    for (const id of IDS) {
      const check = evidence.checks.find(item => item.id === id)
      try {
        fields(check, ['id', 'package_id', 'status', 'started_at', 'finished_at', 'evidence_files', 'metrics', 'review', 'note'])
        requireThat(check.package_id === evidence.package_id && ['pass', 'fail', 'blocked', 'not_run'].includes(check.status), '检查身份或状态无效')
        requireThat(typeof check.note === 'string' && check.note.length <= 2000, '检查说明无效')
        const pending = ['blocked', 'not_run'].includes(check.status)
        requireThat(!pending || check.note.trim().length > 0, '未执行检查必须说明外部条件')
        times(check, manifest, options, !pending)
        validMetrics(id, check.metrics, check.status === 'pass')
        const roles = await attachments(root, check.evidence_files, ROLES[id])
        if (pending) { blocked = true; result.blockers.push(`${id}: ${check.note}`); result.checks.push({ id, status: check.status }); continue }
        if (check.status === 'fail') { failed = true; result.checks.push({ id, status: 'fail' }); result.blockers.push(`${id}: 检查明确失败`); continue }
        requireThat(ROLES[id].every(role => roles.has(role)), '缺少必需角色附件')
        review(check, manifest, options)
        const record = await records(root, evidence, check, roles)
        if (id === 'package_offline') await smokeReport(root, evidence, check, manifest, options, roles)
        if (id === 'installer') await installedTree(root, check, manifest, record, options)
        if (id === 'public_browser') {
          observed(record.tool_record, METRICS[id])
          requireThat(check.metrics.screenshot_count === roles.get('before_image').length + roles.get('after_image').length, '浏览器截图数量不匹配')
        }
        if (id === 'real_search') searchRecords(check, record, roles)
        if (id === 'offline_reopen_export') await exportRecords(root, evidence, check, record, roles, manifest, options, contexts.get('real_search'))
        if (id === 'model_modes') {
          observed(record.disabled_record, ['auxiliary_calls_disabled'])
          observed(record.enabled_record, ['auxiliary_calls_enabled', 'configured_model', 'effective_model', 'sources_valid'])
        }
        if (id === 'regression') {
          observed(record.test_results, METRICS[id])
          requireThat(roles.get('baseline_comparison')[0].path === check.metrics.baseline_comparison && text(record.baseline_comparison.summary), '基线比较记录无效')
          requireThat(Array.isArray(record.test_results.commands) && record.test_results.commands.length > 0 && record.test_results.commands.length <= 64, '测试执行命令缺失')
          for (const command of record.test_results.commands) {
            fields(command, ['command', 'exit_code', 'failures', 'errors'])
            requireThat(text(command.command) && command.exit_code === 0 && command.failures === 0 && command.errors === 0, '专项测试原始结果未通过')
          }
        }
        contexts.set(id, { check, roles, record })
        result.checks.push({ id, status: 'pass' })
      } catch (error) { failed = true; result.checks.push({ id, status: 'fail' }); result.blockers.push(`${id}: ${safeError(error)}`) }
    }
    // Include any changes made while the sole permitted child process was running.
    const after = await verifyPackageManifest({ ...options, manifest })
    requireThat(after.success, after.errors.join('；'))
    for (const file of root.verifiedAttachments.values()) {
      const current = await hashFile(root.io, root.evidence, file.path)
      requireThat(current.sha256 === file.sha256 && current.size === file.size, '校验期间证据附件发生变化')
    }
    const installation = contexts.get('installer')
    if (installation) await installedTree(root, installation.check, manifest, installation.record, options)
    requireThat((await hashFile(root.io, root.release, manifestName)).sha256 === manifestFile.sha256 && (await hashFile(root.io, root.evidence, evidenceName)).sha256 === evidenceFile.sha256, '校验期间报告或清单发生变化')
    result.exitCode = failed ? 1 : blocked ? 2 : 0
    result.success = result.exitCode === 0
    result.release_ready = result.success
  } catch (error) { result.blockers.push(safeError(error)) }
  return result
}

module.exports = { createPackageManifest, verifyPackageManifest, validateReleaseEvidence }
