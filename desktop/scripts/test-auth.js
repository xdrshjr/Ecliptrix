'use strict'

// Runs the six identity-gate unit suites in one process (spec §3.4 / §6.1).
//
// `npm run test:auth` has to work on Windows, macOS and Linux, so the suites are
// required and awaited in-process instead of chained with `&&`: any suite that
// throws stops the run with exit code 1 and names the failing file.

const suites = [
  'authConfig',
  'authPolicy',
  'authSessionStore',
  'authHttp',
  'localAdmin',
  'authBridge',
]

// `require` paths are static so a bundler/packager can see them.
const LOADERS = {
  authConfig: () => require('../main/authConfig.test.js'),
  authPolicy: () => require('../main/authPolicy.test.js'),
  authSessionStore: () => require('../main/authSessionStore.test.js'),
  authHttp: () => require('../main/authHttp.test.js'),
  localAdmin: () => require('../main/localAdmin.test.js'),
  authBridge: () => require('../main/authBridge.test.js'),
}

async function main() {
  const totals = []
  for (const name of suites) {
    process.stdout.write(`\n[test-auth] ── ${name} ──\n`)
    const suite = LOADERS[name]()
    // eslint-disable-next-line no-await-in-loop
    const count = await suite.run()
    totals.push({ name, count })
  }
  const total = totals.reduce((sum, entry) => sum + entry.count, 0)
  const summary = totals.map((entry) => `${entry.name}=${entry.count}`).join(' ')
  console.log(`\n[test-auth] PASS — ${suites.length} suites, ${total} checks (${summary})`)
  return total
}

main().catch((err) => {
  console.error(`\n[test-auth] FAIL: ${(err && err.stack) || err}`)
  process.exit(1)
})
