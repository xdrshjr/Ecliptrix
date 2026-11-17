'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面验收沿用既有 CommonJS，并由包内 Electron Node 执行。 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const evidence = require('./lib/effects-release-evidence')
const desktop = require('./lib/effects-desktop-acceptance')
const visual = require('./lib/effects-visual-acceptance')
const WORKSPACE = path.resolve(__dirname, '../..')

/** Accept only the documented six inputs; duplicate parameters are errors. */
function parseArguments(argv) {
  const allowed = ['unpacked', 'installed', 'manifest', 'report', 'scenario']
  const parsed = {}
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index].replace(/^--/, '')
    if (!argv[index].startsWith('--') || !allowed.includes(key)) throw new Error(`未知参数 ${argv[index]}`)
    if (Object.hasOwn(parsed, key)) throw new Error(`重复参数 ${key}`)
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${key} 缺值`)
    parsed[key] = argv[++index]
  }
  for (const key of ['unpacked', 'manifest', 'report', 'scenario']) if (!parsed[key]) throw new Error(`必须显式 --${key}`)
  if (![...evidence.SCENARIOS, 'all'].includes(parsed.scenario)) throw new Error('未知场景')
  evidence.rejectOverrides()
  return parsed
}
function git(argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: WORKSPACE,
    encoding: 'utf8', windowsHide: true, timeout: 15000 })
  if (result.status !== 0) throw new Error('无法核验源码身份')
  return result.stdout.trim()
}
async function initialize(options, reservation) {
  const unpackedRoot = path.resolve(options.unpacked)
  const installedRoot = options.installed && path.resolve(options.installed)
  const targetRoot = installedRoot || unpackedRoot
  const manifestPath = path.resolve(options.manifest)
  const evidenceRoot = path.dirname(path.resolve(options.report))
  if (!evidence.inside(WORKSPACE, evidenceRoot)) throw new Error('证据根必须在工作区内')
  for (const root of [unpackedRoot, installedRoot].filter(Boolean)) {
    if (evidence.inside(root, evidenceRoot) || evidence.inside(evidenceRoot, root)) throw new Error('证据根不能与被测目标树重叠')
    await evidence.checkedPath(root)
  }
  await evidence.checkedPath(manifestPath)
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const resourceRoot = path.join(targetRoot, 'resources/effects')
  const runtimePath = await evidence.checkedPath(path.join(resourceRoot, 'manifest.json'))
  const runtime = JSON.parse(await fs.readFile(runtimePath, 'utf8'))
  const { runtimeFingerprint, ...identity } = runtime
  if (evidence.hash(JSON.stringify(identity)) !== runtimeFingerprint) throw new Error('特效运行清单指纹不匹配')
  const packageFiles = new Map(manifest.files.map(file => [file.path, file]))
  for (const entry of runtime.files) {
    const declared = packageFiles.get(`resources/effects/${entry.path}`)
    if (!declared || declared.sha256 !== entry.sha256 || declared.size !== entry.bytes) throw new Error('特效资源不属于本次包清单')
  }
  const report = evidence.createAcceptanceReport({ scenario: options.scenario,
    mode: installedRoot ? 'installed' : 'unpacked', runId: reservation.runId,
    sourceHead: manifest.source_head, packageId: manifest.package_id,
    manifestSha256: (await evidence.hashFile(manifestPath)).sha256,
    runtimeFingerprint, catalogHash: runtime.catalogHash,
    fontHash: runtime.fontHash, bundleHash: runtime.bundleHash,
    installerSha256: manifest.installer?.sha256 })
  const context = { workspaceRoot: WORKSPACE, unpackedRoot, installedRoot,
    targetRoot, manifestPath, manifest, evidenceRoot, resourceRoot,
    entryRoot: path.join(resourceRoot, 'runtime'),
    electron: path.join(targetRoot, 'Ecliptrix.exe'),
    ffmpeg: path.join(targetRoot, 'resources/ffmpeg/ffmpeg.exe'),
    ffprobe: path.join(targetRoot, 'resources/ffmpeg/ffprobe.exe'),
    python: path.join(targetRoot, 'resources/python/python.exe'),
    projectsRoot: path.join(evidenceRoot, '中文 空格/projects'),
    report, processes: [], onProgress: phase => console.log(`[effects-acceptance] ${phase}`) }
  for (const executable of [context.electron, context.ffmpeg, context.ffprobe, context.python]) await evidence.checkedPath(executable)
  await evidence.verifyPackagedEffectResources(context)
  return context
}
async function packageScenario(context) {
  await evidence.verifyPackagedEffectResources(context)
  const attachments = []
  const before = await evidence.verifyIdentity(context)
  attachments.push(await evidence.writeAttachment(context, 'identity_before', 'package/identity-before.json', before))
  if (context.installedRoot) {
    if (!context.manifest.installer) throw new desktop.AcceptanceBlocked('本次清单没有安装器')
    let record
    try { record = JSON.parse(await fs.readFile(path.join(context.evidenceRoot, 'install-record.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') throw new desktop.AcceptanceBlocked('缺少本次 NSIS 安装记录 install-record.json'); throw error }
    if (record.installer_sha256 !== context.manifest.installer.sha256
      || path.resolve(record.installed_root) !== context.installedRoot
      || record.exit_code !== 0 || !record.started_at || !record.finished_at) throw new Error('安装记录与本次安装器/目标不一致')
    attachments.push(await evidence.writeAttachment(context, 'install_record', 'package/install.json',
      evidence.bindRecord(context.report, { case_id: 'install', input_sha256: context.manifest.installer.sha256, ...record })))
  }
  const smokePath = path.join(context.evidenceRoot, 'package/runtime-report.json')
  const argv = [path.join(__dirname, 'effects-smoke.js'), '--unpacked', context.unpackedRoot,
    ...(context.installedRoot ? ['--installed', context.installedRoot] : []),
    '--manifest', context.manifestPath, '--report', smokePath]
  const result = await evidence.runProgram(process.execPath, argv, { cwd: WORKSPACE,
    timeoutMs: 360000, onOutput: text => process.stdout.write(text),
    onSpawn: record => context.processes.push(record) })
  if (result.exit_code !== 0) throw new Error(`真实运行时 smoke 失败 (${result.exit_code})`)
  const smoke = JSON.parse(await fs.readFile(smokePath, 'utf8'))
  if (!smoke.passed || smoke.mode !== context.report.mode || smoke.package_id !== context.manifest.package_id) throw new Error('运行时 smoke 未通过或包身份不匹配')
  const cases = evidence.CASES.package.map(case_id => ({ case_id, status: 'pass', input_sha256: context.report.manifest_sha256 }))
  attachments.push(await evidence.writeAttachment(context, 'runtime_smoke', 'package/runtime.json',
    evidence.bindRecord(context.report, { cases, input_sha256: context.report.manifest_sha256,
      versions: smoke.steps.renderer.versions, actual: smoke, executable_records: context.processes })))
  const after = await evidence.verifyIdentity(context)
  attachments.push(await evidence.writeAttachment(context, 'identity_after', 'package/identity-after.json', after))
  return { status: 'pass', acceptance_ids: evidence.acIds('package'),
    measurements: { development_modules_loaded: 0, dependencies_complete: true,
      trees_match: true }, attachments }
}

async function visualScenario(context) {
  const session = await desktop.startSession(context)
  try {
    const fixtures = await visual.createFixtures({ ...context,
      evidenceRoot: path.join(context.evidenceRoot, 'player-fixtures') })
    const project = await desktop.seedProject(session, fixtures)
    return await visual.runVisual({ ...context, playerSession: session, projectId: project.projectId,
      capturePlayer: (...args) => desktop.capturePlayer(session, project, ...args) })
  } finally { await session.close() }
}
function regressionCommands(root, evidenceRoot) {
  const node = process.execPath
  const npm = path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js')
  const backend = path.join(root, 'backend-services/basic-service')
  const commands = [
    { id: 'typecheck', executable: node, argv: [npm, 'run', 'type-check'], cwd: root },
    { id: 'frontend', executable: node, argv: [npm, 'test', '--', 'src/lib/effects', 'src/components/video/effects', 'src/app/api/effects/__tests__/route.test.ts', 'src/app/api/effects-apply-receipts/__tests__/route.test.ts', '--maxWorkers=4', '--reporter=json', '--outputFile=desktop/build/effects/regression-frontend.json'], cwd: root },
    { id: 'agent', executable: node, argv: [npm, 'test', '--', 'src/lib/video-editing-agent/__tests__/effectsTools.test.ts', 'src/lib/video-editing-agent/__tests__/effectsActivation.test.ts', 'src/lib/video-editing-agent/__tests__/effectsOperations.test.ts', 'src/components/video/hooks/__tests__/useAgentExecution.effects.test.tsx', '--maxWorkers=4', '--reporter=json', '--outputFile=desktop/build/effects/regression-agent.json'], cwd: root },
    { id: 'timeline', executable: node, argv: [npm, 'test', '--', 'src/components/video/timeline/store/actions/__tests__/applyEffects.test.ts', 'src/components/video/projects/__tests__/effectsPersistence.integration.test.tsx', 'src/components/video/projects/__tests__/VideoProjectListView.effects.test.tsx', '--reporter=json', '--outputFile=desktop/build/effects/regression-timeline.json'], cwd: root },
    { id: 'runtime-typecheck', executable: node, argv: [npm, '--prefix', 'effects-runtime', 'run', 'type-check'], cwd: root },
    { id: 'runtime-build', executable: node, argv: [npm, '--prefix', 'effects-runtime', 'run', 'build'], cwd: root },
    { id: 'runtime-tests', executable: node, argv: ['--test', '--test-reporter=junit', '--test-reporter-destination=runtime-junit.xml', '--test-concurrency=1', ...['lifecycle', 'mediaServer', 'render.integration', 'stopReason', 'fontResources'].map(name => `tests/${name}.test.mjs`)], cwd: path.join(root, 'effects-runtime'), env: { EFFECTS_REAL_RUNTIME_TEST: '1', EFFECTS_MANIFEST_STARTUP_TEST: '1' } },
    { id: 'desktop-tests', executable: node, argv: ['--test', '--test-reporter=junit', '--test-reporter-destination=desktop-junit.xml', 'desktop/scripts/effects-smoke.test.js', 'desktop/scripts/lib/effects-release-evidence.test.js', 'desktop/scripts/lib/effects-font-usage.test.js', 'desktop/main/effectsService.test.js'], cwd: root },
    { id: 'backend', executable: path.join(backend, 'venv/Scripts/python.exe'), argv: ['-B', '-X', 'utf8', '-m', 'pytest', 'tests/test_effects_contract.py', 'tests/test_effects_text_layout.py', 'tests/test_effects_draft_replay.py', 'tests/test_effects_jobs.py', 'tests/test_effects_assets.py', 'tests/test_effects_lifecycle.py', 'tests/test_effects_paths.py', 'tests/test_effects_runtime_client.py', '--junitxml=effects-junit.xml'], cwd: backend, env: { ECLIPTRIX_EFFECTS_RUNTIME_TEST: '1' } },
    { id: 'build', executable: node, argv: [npm, 'run', 'build'], cwd: root },
  ]
  for (const command of commands) command.argv = command.argv.map(argument => {
    if (argument.startsWith('--outputFile=')) return `--outputFile=${path.join(evidenceRoot, 'regression', `${command.id}.json`)}`
    if (argument.startsWith('--test-reporter-destination=')) return `--test-reporter-destination=${path.join(evidenceRoot, 'regression', `${command.id}.xml`)}`
    if (argument.startsWith('--junitxml=')) return `--junitxml=${path.join(evidenceRoot, 'regression', `${command.id}.xml`)}`
    return argument
  })
  return commands
}
function scrubLog(log) {
  return log.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|sk-proj|sk-ant-api\d+)-[a-zA-Z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)\s*["']?\s*[:=]\s*["']?)[^\s"',}\]]+/gi, '$1[REDACTED]')
}
function parseJunitCases(xml) {
  if (/<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error('JUnit 不允许外部实体')
  const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return Array.from(xml.matchAll(/<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g), match => {
    const name = decode(/\bname="([^"]*)"/.exec(match[1])?.[1] || '')
    const namespace = decode(/\bclassname="([^"]*)"/.exec(match[1])?.[1] || '')
    return { name: `${namespace}::${name}`, status: /<(?:failure|error|skipped)\b/.test(match[2] || '') ? 'fail' : 'pass' }
  })
}
async function sourceRegression(context) {
  const beforeHead = git(['rev-parse', 'HEAD'])
  const trackedBefore = git(['diff', '--binary', 'HEAD', '--'])
  if (beforeHead !== context.manifest.source_head || context.manifest.dirty || trackedBefore) throw new desktop.AcceptanceBlocked('必须由下游先提交并重建本次包；当前源码或清单不满足干净提交身份')
  const commands = []
  await fs.mkdir(path.join(context.evidenceRoot, 'regression'), { recursive: true })
  for (const command of regressionCommands(WORKSPACE, context.evidenceRoot)) {
    context.onProgress(`source-regression ${command.id}`)
    const result = await evidence.runProgram(command.executable, command.argv, {
      cwd: command.cwd, timeoutMs: 600000, env: command.env,
      onSpawn: record => context.processes.push(record) })
    const log = scrubLog(`${result.stdout}\n${result.stderr}`)
    const logName = `regression/${command.id}.log`
    const logFile = path.join(context.evidenceRoot, logName)
    await fs.mkdir(path.dirname(logFile), { recursive: true })
    // Logs stay local; reports publish only sanitized argv and the log hash.
    await fs.writeFile(logFile, log, { flag: 'wx' })
    let tests = 0; let skipped = 0; let failed = 0; let cases = []
    const testCommand = /tests|frontend|agent|timeline|backend/.test(command.id)
    if (testCommand && command.argv.includes('--reporter=json')) {
      const output = command.argv.find(arg => arg.startsWith('--outputFile=')).split('=')[1]
      const summary = JSON.parse(await fs.readFile(output, 'utf8'))
      tests = summary.numTotalTests; skipped = summary.numPendingTests;
      failed = summary.numFailedTests
      cases = summary.testResults.flatMap(file => file.assertionResults.map(assertion => ({
        name: `${file.name}::${assertion.fullName || assertion.title}`,
        status: assertion.status === 'passed' ? 'pass' : 'fail' })))
    } else if (testCommand) {
      const junit = await fs.readFile(path.join(context.evidenceRoot, 'regression', `${command.id}.xml`), 'utf8')
      tests = (junit.match(/<testcase(?:\s|>)/g) || []).length
      skipped = (junit.match(/<skipped(?:\s|\/|>)/g) || []).length
      failed = (junit.match(/<(?:failure|error)(?:\s|>)/g) || []).length
      cases = parseJunitCases(junit)
    }
    commands.push({ id: command.id, argv: [command.executable, ...command.argv],
      cwd: command.cwd, exit_code: result.exit_code, tests, skipped, failed,
      test_command: testCommand, log: logName, log_sha256: evidence.hash(log), cases })
    if (result.exit_code !== 0 || testCommand && (!tests || skipped || failed)) throw new Error(`源码回归 ${command.id} 失败或关键测试未执行`)
  }
  const sourceHeadAfter = git(['rev-parse', 'HEAD'])
  const trackedAfter = git(['diff', '--binary', 'HEAD', '--'])
  const acceptanceBindings = Object.fromEntries(Object.entries(evidence.REGRESSION_BINDINGS).map(([id, patterns]) => {
    const cases = commands.flatMap(command => command.cases)
    const names = patterns.map(pattern => {
      const found = cases.find(executed => executed.status === 'pass' && executed.name.includes(pattern))
      if (!found) throw new Error(`${id} 缺少实际通过的用例 ${pattern}`)
      return found.name
    })
    return [id, names]
  }))
  const attachment = await evidence.writeAttachment(context, 'source_regression', 'regression/results.json',
    evidence.bindRecord(context.report, { case_id: 'source-regression',
      input_sha256: evidence.hash(beforeHead), commands,
      source_head_before: beforeHead, source_head_after: sourceHeadAfter,
      tracked_before: evidence.hash(trackedBefore), tracked_after: evidence.hash(trackedAfter),
      acceptance_bindings: acceptanceBindings }))
  return { status: 'pass', source_head: beforeHead, attachment: attachment.path,
    bindings: acceptanceBindings }
}
async function executeScenarios(context, reservation) {
  const runners = { package: packageScenario, visual: visualScenario,
    desktop: desktop.runDesktop, process: desktop.runProcess,
    performance: desktop.runPerformance, agent: desktop.runAgent }
  for (const name of evidence.selectedScenarios(context.report.requested_scenario)) {
    context.onProgress(name)
    try { context.report.steps[name] = await runners[name](context) }
    catch (error) { context.report.steps[name] = { status: error instanceof desktop.AcceptanceBlocked ? 'blocked' : 'fail',
      acceptance_ids: [], measurements: {}, attachments: [], reason: error.message } }
    await reservation.progress(context.report)
  }
  if (context.report.requested_scenario === 'all') {
    try {
      const regression = await sourceRegression(context)
      const { bindings, ...publicResult } = regression
      context.report.regression = publicResult
      for (const [id, names] of Object.entries(bindings)) context.report.acceptance_results[id] = {
        status: 'pass', case_ids: names, attachment_refs: [regression.attachment] }
    }
    catch (error) { context.report.regression = { status: error instanceof desktop.AcceptanceBlocked ? 'blocked' : 'fail', source_head: context.report.source_head, attachment: 'regression/not-run.json' }
      await evidence.writeAttachment(context, 'source_regression', 'regression/not-run.json', evidence.bindRecord(context.report, { case_id: 'source-regression', input_sha256: context.report.manifest_sha256, reason: error.message })) }
    for (const id of Object.keys(evidence.REGRESSION_BINDINGS)) if (!context.report.acceptance_results[id]) context.report.acceptance_results[id] = { status: context.report.regression.status, case_ids: [], attachment_refs: [context.report.regression.attachment] }
  }
  // New AC rows are bound to actual scenario evidence. Historical ACs require
  // explicit regression test-name bindings and are never inherited from prose.
  for (const [name, step] of Object.entries(context.report.steps)) for (const id of evidence.ACS[name]) {
    context.report.acceptance_results[`AC-${String(id).padStart(2, '0')}`] = { status: step.status,
      case_ids: step.status === 'pass' ? (evidence.CASES[name] || ['visual-matrix']) : [],
      attachment_refs: step.attachments.map(entry => entry.path) }
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  if (!evidence.inside(WORKSPACE, path.resolve(options.report))) throw new Error('报告必须在工作区内')
  for (const root of [options.unpacked, options.installed].filter(Boolean)) {
    if (evidence.inside(path.resolve(root), path.resolve(options.report))) throw new Error('报告不能写入只读目标树')
  }
  const reservation = await evidence.reserveReport(path.resolve(options.report), randomUUID())
  let context
  try {
    context = await initialize(options, reservation)
    await evidence.verifyIdentity(context)
    await executeScenarios(context, reservation)
    await evidence.verifyIdentity(context)
    context.report.finished_at = new Date().toISOString()
    context.report.release_ready = evidence.deriveReleaseReady(context.report, context)
    const validation = await evidence.validateAcceptanceReport(context.report, context)
    if (!validation.valid) {
      for (const name of evidence.selectedScenarios(options.scenario)) context.report.steps[name] = {
        ...context.report.steps[name], status: 'fail', acceptance_ids: [], reason: validation.errors.join('; ') }
      for (const result of Object.values(context.report.acceptance_results)) result.status = 'fail'
      if (context.report.regression) context.report.regression.status = 'fail'
      context.report.release_ready = false
    }
    await reservation.finalize(context.report)
    process.exitCode = validation.valid ? validation.exitCode : 1
    return context.report
  } catch (error) {
    const report = context?.report || evidence.createAcceptanceReport({ scenario: options.scenario,
      mode: options.installed ? 'installed' : 'unpacked', runId: reservation.runId })
    for (const name of evidence.selectedScenarios(options.scenario)) report.steps[name] = {
      status: 'fail', acceptance_ids: [], measurements: {}, attachments: [], reason: error.message }
    for (const name of evidence.selectedScenarios(options.scenario)) for (const id of evidence.acIds(name)) report.acceptance_results[id] = { status: 'fail', case_ids: [], attachment_refs: [] }
    if (options.scenario === 'all') for (const id of Object.keys(evidence.REGRESSION_BINDINGS)) report.acceptance_results[id] = { status: 'fail', case_ids: [], attachment_refs: [] }
    report.finished_at = new Date().toISOString()
    await reservation.finalize(report); process.exitCode = 1
    return report
  }
}
if (require.main === module) main().catch(error => { console.error(`[effects-acceptance] ${error.message}`); process.exitCode = 1 })
module.exports = { parseArguments, main, packageScenario, initialize, sourceRegression,
  scrubLog, parseJunitCases, regressionCommands }
