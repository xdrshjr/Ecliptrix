/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

// Fixture tests for the walkthrough-table gate (spec agent-browser-workspace-r3
// §3.3: five cases — missing row / wrong column names / illegal prefix /
// disagreeing tally / compliant table).
//
// The compliant case is the important one: it must PASS, otherwise the gate gets
// relaxed until it accepts anything.

const assert = require('assert')
const { checkWalkthroughTable } = require('./check-walkthrough-table')

const STEPS = ['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465',
  '\u2466', '\u2467', '\u2468', '\u2469', '\u246a']

const HEADER = '| \u6b65\u9aa4 | \u9884\u671f | \u5b9e\u6d4b | \u65e5\u671f | \u6267\u884c\u4eba |'
const DIVIDER = '|---|---|---|---|---|'
const SKIP_CELL = '\u672a\u6267\u884c: \u7f3a\u684c\u9762\u5b89\u88c5\u5305'

/** Build table body lines; `overrides` maps a step to its 实测 cell text. */
function rows(overrides) {
  const map = overrides || {}
  return STEPS.map((step) => {
    const measured = map[step] || SKIP_CELL
    return `| ${step} | \u73b0\u8c61\u53ef\u5224\u5b9a | ${measured} | 2026-11-26 | node |`
  })
}

/** Assemble an acceptance.md-shaped document. */
function doc(options) {
  const opts = options || {}
  return [
    '# Acceptance',
    '',
    '## I2-7',
    '',
    '(\u7565)',
    '',
    '## I2-8 \u4eba\u5de5\u8d70\u67e5\u8868',
    '',
    opts.tally || '\u5df2\u6267\u884c 0 / \u672a\u6267\u884c 11 / \u963b\u585e 0 (N+M+K=11)',
    '',
    opts.headerRow || HEADER,
    DIVIDER,
    ...(opts.rows || rows()),
    '',
    '## I2-9',
    'tail',
  ].join('\n')
}

const CASES = []

/** 1) A compliant table passes (with 已执行 = 0 the CLI prints a NOTE, still exit 0). */
CASES.push(['a compliant table passes', () => {
  const result = checkWalkthroughTable(doc())
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems))
  assert.deepStrictEqual(result.counts, { executed: 0, skipped: 11, blocked: 0 })
}])

/** 2) A missing step fails and names it. */
CASES.push(['a missing step fails', () => {
  const body = rows().filter((line) => !line.startsWith(`| ${STEPS[6]} |`))
  const result = checkWalkthroughTable(doc({
    rows: body,
    tally: '\u5df2\u6267\u884c 0 / \u672a\u6267\u884c 10 / \u963b\u585e 0',
  }))
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some((p) => p.includes(STEPS[6])), JSON.stringify(result.problems))
}])

/** 3) A renamed column fails: the column names ARE the contract. */
CASES.push(['a renamed column fails', () => {
  const result = checkWalkthroughTable(doc({
    headerRow: HEADER.replace('\u5b9e\u6d4b', '\u7ed3\u679c'),
  }))
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some((p) => p.includes('header must be exactly')),
    JSON.stringify(result.problems))
}])

/** 4) An illegal prefix fails — including the bare "未执行" the spec calls a
 *     compliant fake, because it must say WHAT is missing. */
CASES.push(['a bare or invalid tier prefix fails', () => {
  const overrides = {}
  overrides[STEPS[2]] = '\u672a\u6267\u884c'
  const bare = checkWalkthroughTable(doc({ rows: rows(overrides) }))
  assert.strictEqual(bare.ok, false)
  assert.ok(bare.problems.some((p) => p.includes(STEPS[2])), JSON.stringify(bare.problems))

  const vagueOverrides = {}
  vagueOverrides[STEPS[4]] = '\u6b63\u5e38'
  const vague = checkWalkthroughTable(doc({ rows: rows(vagueOverrides) }))
  assert.strictEqual(vague.ok, false)
}])

/** 5) A tally that disagrees with the rows fails. */
CASES.push(['a disagreeing tally fails', () => {
  const overrides = {}
  overrides[STEPS[9]] = '\u5df2\u6267\u884c: Ctrl+L \u4ea4\u8fd8\u7126\u70b9, \u89c1 e2e 13/13'
  const result = checkWalkthroughTable(doc({
    rows: rows(overrides),
    tally: '\u5df2\u6267\u884c 0 / \u672a\u6267\u884c 11 / \u963b\u585e 0',
  }))
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some((p) => p.includes('disagrees')), JSON.stringify(result.problems))
}])

/** 6) A missing I2-8 section fails outright. */
CASES.push(['a missing section fails', () => {
  const result = checkWalkthroughTable('# Acceptance\n\n## I2-7 only\n')
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some((p) => p.includes('## I2-8')), JSON.stringify(result.problems))
}])

/** 7) A fully executed table counts correctly. */
CASES.push(['a fully executed table counts correctly', () => {
  const overrides = {}
  for (const step of STEPS) {
    overrides[step] = `\u5df2\u6267\u884c: 2026-11-26 \u624b\u5de5\u8d70\u67e5 (${step})`
  }
  const result = checkWalkthroughTable(doc({
    rows: rows(overrides),
    tally: '\u5df2\u6267\u884c 11 / \u672a\u6267\u884c 0 / \u963b\u585e 0',
  }))
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems))
  assert.deepStrictEqual(result.counts, { executed: 11, skipped: 0, blocked: 0 })
}])

async function run() {
  for (const [name, fn] of CASES) {
    // eslint-disable-next-line no-await-in-loop
    await fn()
    console.log(`  ok - ${name}`)
  }
  console.log(`check-walkthrough-table tests passed (${CASES.length})`)
  return CASES.length
}

module.exports = { run }

if (require.main === module) {
  run().catch((error) => {
    console.error(`check-walkthrough-table tests FAILED: ${(error && error.stack) || error}`)
    process.exit(1)
  })
}
