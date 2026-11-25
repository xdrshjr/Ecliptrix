'use strict'

// Runs the browser-workspace unit/integration suites in one process (spec agent-browser-workspace
// §8.2). Pure node, no Electron: `npm run test:browser` works on every platform. jsdom is read from
// the repo-root node_modules; without it the page-script and integration suites report a skip.

const LOADERS = {
  navigationGuard: () => require('../main/browserWorkspace/navigationGuard.test.js'),
  core: () => require('../main/browserWorkspace/core.test.js'),
  cookiePersister: () => require('../main/browserWorkspace/cookiePersister.test.js'),
  hardening: () => require('../main/browserWorkspace/hardening.test.js'),
  pageScripts: () => require('../main/browserWorkspace/pageScripts/pageScripts.test.js'),
  cdpEngine: () => require('../main/browserWorkspace/cdpEngine.test.js'),
  control: () => require('../main/browserWorkspace/control.test.js'),
  controlServer: () => require('../main/browserWorkspace/controlServer.test.js'),
  misc: () => require('../main/browserWorkspace/misc.test.js'),
  integration: () => require('../main/browserWorkspace/integration.test.js'),
}

async function main() {
  const totals = []
  for (const [name, load] of Object.entries(LOADERS)) {
    process.stdout.write(`\n[test-browser] ── ${name} ──\n`)
    // eslint-disable-next-line no-await-in-loop
    totals.push({ name, count: await load().run() })
  }
  const total = totals.reduce((sum, entry) => sum + entry.count, 0)
  console.log(`\n[test-browser] PASS — ${totals.map((e) => `${e.name}=${e.count}`).join(' ')} (total ${total})`)
  process.exit(0)
}

main().catch((err) => {
  console.error(`[test-browser] FAIL: ${(err && err.stack) || err}`)
  process.exit(1)
})
