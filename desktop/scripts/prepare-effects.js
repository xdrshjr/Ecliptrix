'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const RUNTIME_ROOT = path.join(PROJECT_ROOT, 'effects-runtime')
const PAYLOAD = path.join(PROJECT_ROOT, 'desktop/build/effects')

function run(command, args, cwd) {
  console.log(`[prepare-effects] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit',
    shell: command === 'npm' && process.platform === 'win32',
    windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Effects preparation exited ${result.status}`)
}

/** Install dependencies into the shipped payload before sealing its hashes. */
function prepareEffects() {
  run('npm', ['ci', '--ignore-scripts'], RUNTIME_ROOT)
  run(process.execPath, ['scripts/prepare.mjs'], RUNTIME_ROOT)
  const destination = path.join(PAYLOAD, 'runtime')
  fs.mkdirSync(destination, { recursive: true })
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(RUNTIME_ROOT, name), path.join(destination, name))
  }
  run('npm', ['ci', '--omit=dev', '--ignore-scripts'], destination)
  run('npm', ['run', 'build'], RUNTIME_ROOT)
  const manifest = JSON.parse(fs.readFileSync(path.join(PAYLOAD, 'manifest.json')))
  if (manifest.supportedTemplates !== 24) throw new Error('Effects catalog incomplete')
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(PAYLOAD, file.path))
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes)
      .digest('hex') !== file.sha256) throw new Error(`Effects hash mismatch: ${file.path}`)
  }
  console.log('[prepare-effects] verified offline runtime payload')
}

if (require.main === module) prepareEffects()
module.exports = { prepareEffects }
