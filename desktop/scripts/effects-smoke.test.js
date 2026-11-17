'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面验收沿用既有 CommonJS，并由包内 Electron Node 执行。 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const smoke = require('./effects-smoke')

test('安装包入口与可执行程序都从同一目标树解析', () => {
  assert.equal(typeof smoke.resolveTarget, 'function')
  const target = smoke.resolveTarget({ unpacked: path.resolve('desktop/release/win-unpacked'),
    report: path.resolve('desktop/build/effects/test/report.json') }, {})
  assert.equal(target.entryRoot, path.join(target.targetRoot, 'resources/effects/runtime'))
  assert.equal(target.electron, path.join(target.targetRoot, 'Ecliptrix.exe'))
  assert.equal(target.mode, 'unpacked')
})

test('安装包模式拒绝开发覆盖与缺省报告路径', () => {
  assert.equal(typeof smoke.resolveTarget, 'function')
  const unpacked = path.resolve('desktop/release/win-unpacked')
  assert.throws(() => smoke.resolveTarget({ unpacked }, {}), /report/)
  assert.throws(() => smoke.resolveTarget({ unpacked, report: path.resolve('desktop/build/a.json') },
    { ECLIPTRIX_EFFECTS_ELECTRON: 'elsewhere.exe' }), /override|覆盖/)
})

test('旧 packaged 参数只代表开发 payload', () => {
  assert.equal(typeof smoke.resolveTarget, 'function')
  assert.equal(smoke.resolveTarget({ packaged: true }, {}).mode, 'development')
})

test('严格参数解析拒绝重复、未知及缺值参数', () => {
  assert.equal(typeof smoke.parseArguments, 'function')
  for (const argv of [['--unknown'], ['--report'], ['--render', '--render']]) {
    assert.throws(() => smoke.parseArguments(argv))
  }
})

test('预加载模块边界拒绝仓库 dist 和仓库 node_modules，包括嵌套进程', async () => {
  const fixtureRoot = path.resolve('desktop/build/effects/evidence-tests', randomUUID())
  const target = path.join(fixtureRoot, 'package')
  await fs.mkdir(path.join(target, 'resources/effects/runtime'), { recursive: true })
  await fs.writeFile(path.join(target, 'resources/effects/runtime/allowed.js'), 'module.exports=42')
  const hook = require.resolve('./lib/effects-release-evidence')
  const env = { ...process.env, EFFECTS_ACCEPTANCE_TARGET_ROOT: target,
    NODE_OPTIONS: `--require=${JSON.stringify(hook)}` }
  const allowed = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(target, 'resources/effects/runtime/allowed.js'))})`], { env, windowsHide: true, encoding: 'utf8' })
  assert.equal(allowed.status, 0, allowed.stderr)
  for (const name of ['effects-runtime/dist/protocol.js', 'node_modules/react/index.js']) {
    const modulePath = path.join(fixtureRoot, 'repository', name)
    await fs.mkdir(path.dirname(modulePath), { recursive: true })
    await fs.writeFile(modulePath, 'module.exports=42')
    const blocked = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)})`], { env, windowsHide: true, encoding: 'utf8' })
    assert.equal(blocked.status, 1)
    assert.match(blocked.stderr, /拒绝目标包外被测模块/)
  }
})

test('真实应用可加载同一目标树，而runtime不能借用frontend的依赖', async () => {
  const target = path.resolve('desktop/build/effects/evidence-tests', randomUUID(), 'package')
  const write = async (name, source) => {
    const filename = path.join(target, name)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, source)
    return filename
  }
  await write('resources/frontend/node_modules/react/index.js', 'module.exports=42')
  await write('resources/frontend/server.js', "module.exports=require('react')")
  const main = await write('resources/app.asar/main/index.js', "module.exports=require('../../frontend/server.js')")
  const runtime = await write('resources/effects/runtime/server.js', "module.exports=require('../../frontend/server.js')")
  const env = { ...process.env, EFFECTS_ACCEPTANCE_TARGET_ROOT: target,
    NODE_OPTIONS: `--require=${JSON.stringify(require.resolve('./lib/effects-release-evidence'))}` }
  const run = filename => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(filename)})`],
    { env, windowsHide: true, encoding: 'utf8' })
  const allowed = run(main)
  assert.equal(allowed.status, 0, allowed.stderr)
  const rejected = run(runtime)
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /拒绝目标包外被测模块/)
})
