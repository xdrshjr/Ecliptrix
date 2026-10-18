'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面 CLI 沿用现有 CommonJS 运行方式。 */

const path = require('node:path')
const { validateReleaseEvidence } = require('./lib/research-release-evidence')

async function main(argv = process.argv.slice(2)) {
  let result
  try {
    const allowed = ['--unpacked', '--installed', '--manifest', '--evidence']
    const values = {}
    for (let i = 0; i < argv.length; i += 2) {
      const key = argv[i]
      if (!allowed.includes(key) || Object.hasOwn(values, key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('参数无效、重复或缺少值')
      values[key] = path.resolve(argv[i + 1])
    }
    if (!values['--unpacked'] || !values['--manifest'] || !values['--evidence']) throw new Error('必须提供 --unpacked、--manifest 和 --evidence')
    result = await validateReleaseEvidence({
      workspaceRoot: path.resolve(__dirname, '../..'),
      packageRoot: values['--unpacked'],
      releaseRoot: path.dirname(values['--manifest']),
      evidenceRoot: path.dirname(values['--evidence']),
      installedRoot: values['--installed'],
      manifestPath: values['--manifest'],
      evidencePath: values['--evidence'],
      onProgress: progress => process.stdout.write(`${JSON.stringify({ progress })}\n`),
    })
  } catch (error) {
    result = { success: false, release_ready: false, package_id: null, checks: [], blockers: [error.message], exitCode: 1 }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.exitCode
}

if (require.main === module) main().then(code => { process.exitCode = code })

module.exports = { main }
