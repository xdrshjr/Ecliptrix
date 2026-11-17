'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { createEffectsDescriptor, createEffectsRuntimeEnv,
  startParentHeartbeat } = require('./effectsService')

test('特效进程使用独立 IPC、固定鉴权和 resources 外置目录', () => {
  const descriptor = createEffectsDescriptor({ resourcesPath: 'M:/应用 路径',
    storageRoot: 'M:/用户 数据', electronExecPath: 'electron.exe',
    effectsPort: 18323, runtimeToken: 'private-token', parentNonce: 'nonce' })
  assert.equal(descriptor.args[0], path.join('M:/应用 路径/effects/runtime/server.js'))
  assert.equal(descriptor.stdio[3], 'ipc')
  assert.equal(descriptor.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(descriptor.env.EFFECTS_RUNTIME_PORT, '18323')
  assert.equal(descriptor.env.EFFECTS_PARENT_NONCE, 'nonce')
  assert.deepEqual(descriptor.healthHeaders, { Authorization: 'Bearer private-token' })
  assert.equal(descriptor.env.EFFECTS_PROJECTS_ROOT,
    path.join('M:/用户 数据', 'effects', 'projects'))
  assert.equal(Object.keys(createEffectsRuntimeEnv({ storageRoot: 'M:/数据' }))
    .some(key => key.startsWith('NEXT_PUBLIC')), false)
})

test('心跳绑定当前 nonce，退出清理且不再向断开的 IPC 发送', t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const child = new EventEmitter()
  child.connected = true
  const received = []
  child.send = message => received.push(message)
  const cleanup = startParentHeartbeat(child, 'current-owner')
  assert.deepEqual(received, [{ type: 'heartbeat', nonce: 'current-owner' }])
  t.mock.timers.tick(2000)
  assert.equal(received.length, 2)
  child.connected = false
  t.mock.timers.tick(2000)
  assert.equal(received.length, 2)
  child.emit('exit', 0)
  t.mock.timers.tick(10000)
  assert.equal(received.length, 2)
  cleanup()
})
