/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createBackendDescriptor } = require('./backendService')

test('包内绝对入口配合隔离用户目录，禁止写 pyc', () => {
  const resourcesPath = path.resolve('package with spaces/resources')
  const userDataPath = path.resolve('.agentmesh/research-r2/test user')
  const descriptor = createBackendDescriptor({ resourcesPath, userDataPath,
    backendPort: 18001, frontendPort: 18002, userEnv: {
      TEMP: 'wrong', tmp: 'wrong', TEMP_DIR: 'wrong', PORT: '42',
      AGENT_BROWSER_CDP_URL: 'wrong',
    } })
  assert.equal(descriptor.cwd, userDataPath)
  assert.deepEqual(descriptor.args,
    ['-B', '-X', 'utf8', path.join(resourcesPath, 'backend', 'run.py')])
  for (const name of ['TEMP', 'TMP', 'TEMP_DIR']) {
    const keys = Object.keys(descriptor.env).filter(key => key.toUpperCase() === name)
    assert.equal(keys.length, 1)
    assert.equal(descriptor.env[keys[0]], path.join(userDataPath, 'temp'))
  }
  assert.equal(descriptor.env.PORT, '18001')
  assert.equal(descriptor.env.RESEARCH_RENDERER_ORIGIN, 'http://127.0.0.1:18002')
  // CDP 方案（spec §3.6）：不打包 playwright 浏览器目录；宿主端点由主进程
  // 探测注入（researchBrowserEnv 覆盖 userEnv 中的同名键）。
  assert.equal(descriptor.env.PLAYWRIGHT_BROWSERS_PATH, undefined)
  assert.equal(descriptor.env.AGENT_BROWSER_CDP_URL, 'wrong')
  assert.ok(descriptor.env.DATABASE_URL.includes('/test user/data/ecliptrix.db'))
  assert.equal(descriptor.env.STORAGE_ROOT, path.join(userDataPath, 'storage'))
})

test('researchBrowserEnv 注入覆盖用户 env 并透传系统代理', () => {
  const resourcesPath = path.resolve('package with spaces/resources')
  const userDataPath = path.resolve('.agentmesh/research-r2/test user')
  const descriptor = createBackendDescriptor({ resourcesPath, userDataPath,
    backendPort: 18001, frontendPort: 18002, userEnv: {
      AGENT_BROWSER_CDP_URL: 'wrong', WEB_RESEARCH_SYSTEM_PROXY: 'wrong',
    },
    researchBrowserEnv: {
      AGENT_BROWSER_CDP_URL: 'http://127.0.0.1:9222',
      AGENT_BROWSER_CONTROL_URL: 'http://127.0.0.1:9333',
      WEB_RESEARCH_SYSTEM_PROXY: 'http://127.0.0.1:7890',
    } })
  assert.equal(descriptor.env.AGENT_BROWSER_CDP_URL, 'http://127.0.0.1:9222')
  assert.equal(descriptor.env.AGENT_BROWSER_CONTROL_URL, 'http://127.0.0.1:9333')
  assert.equal(descriptor.env.WEB_RESEARCH_SYSTEM_PROXY,
    'http://127.0.0.1:7890')
})
