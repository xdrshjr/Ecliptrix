/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

// Walkthrough-table gate (spec agent-browser-workspace-r3 §2.3 / AC-R3-6).
//
// The walkthrough list lived in desktop/README.md for humans while
// acceptance.md needed RESULTS. The trap the spec closes: "every row has a
// conclusion" is satisfied by writing 未执行 everywhere, which is a compliant
// fake. So the 实测 column must open with one of three tiers, and 未执行 must say
// WHAT is missing; 阻塞 must name a defect id.
//
// What this script does NOT do: decide whether a walkthrough "passed". That is a
// human judgement and the script has no right to sign for it.
//
// Argument order and column names ARE the contract (a silent format drift would
// disable every check below), so both are asserted literally.

const fs = require('fs')
const path = require('path')

// Anchored to the repository root, never to the caller's cwd (spec P1-4): the
// target lives under docs/ in the repo, while this file lives in desktop/scripts.
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_TARGET = path.join(REPO_ROOT, 'docs/plans/agent-browser-workspace/acceptance.md')

const SECTION = '## I2-8'
const COLUMNS = ['步骤', '预期', '实测', '日期', '执行人']
const ROWS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪']
const TIER_PATTERN = /^(已执行|未执行|阻塞)\s*[:：]\s*\S/

/** Split one markdown table row into trimmed cells (outer pipes dropped). */
function cells(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

/** Collect the I2-8 section body: from the heading to the next `## ` heading. */
function sectionLines(lines) {
  const start = lines.findIndex((line) => line.trim().startsWith(SECTION))
  if (start === -1) return null
  const body = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) break
    body.push(lines[index])
  }
  return body
}

/** Parse the tier tally line: `已执行 N / 未执行 M / 阻塞 K（N+M+K=11）`. */
function parseTally(body) {
  const pattern = /已执行\s*(\d+)\s*\/\s*未执行\s*(\d+)\s*\/\s*阻塞\s*(\d+)/
  for (const line of body) {
    const match = pattern.exec(line)
    if (match) {
      return { executed: Number(match[1]), skipped: Number(match[2]), blocked: Number(match[3]) }
    }
  }
  return null
}

/**
 * Validate the walkthrough table.
 *
 * @param {string} text Whole acceptance.md.
 * @returns {{ok: boolean, problems: string[], tally: object|null, counts: object}}
 */
function checkWalkthroughTable(text) {
  const lines = text.split(/\r?\n/)
  const problems = []
  const body = sectionLines(lines)
  if (!body) {
    return {
      ok: false,
      problems: [`missing section ${SECTION}`],
      tally: null,
      counts: { executed: 0, skipped: 0, blocked: 0 },
    }
  }

  // 1) The header row must match the contract column-for-column.
  const header = body.map(cells).find((row) => row && row[0] === COLUMNS[0])
  if (!header) {
    problems.push(`missing header row starting with ${COLUMNS[0]}`)
  } else if (header.join('|') !== COLUMNS.join('|')) {
    problems.push(`header must be exactly ${COLUMNS.join(' / ')}, got ${header.join(' / ')}`)
  }

  // 2) Every step ①–⑪ must exist with five cells.
  const rowsByStep = new Map()
  for (const row of body.map(cells)) {
    if (!row || row.length === 0) continue
    if (ROWS.includes(row[0])) rowsByStep.set(row[0], row)
  }
  const counts = { executed: 0, skipped: 0, blocked: 0 }
  for (const step of ROWS) {
    const row = rowsByStep.get(step)
    if (!row) {
      problems.push(`step ${step} is missing`)
      continue
    }
    if (row.length !== COLUMNS.length) {
      problems.push(`step ${step} has ${row.length} columns, expected ${COLUMNS.length}`)
      continue
    }
    const measured = row[2]
    if (!TIER_PATTERN.test(measured)) {
      problems.push(`step ${step} 实测 must start with 已执行:/未执行:/阻塞: and say more`)
      continue
    }
    if (measured.startsWith('已执行')) counts.executed += 1
    else if (measured.startsWith('未执行')) counts.skipped += 1
    else counts.blocked += 1
  }

  // 3) The tally line must agree with the rows (a table edited without its
  //    summary is exactly how a stale verdict survives).
  const tally = parseTally(body)
  if (!tally) {
    problems.push('missing tier tally line (已执行 N / 未执行 M / 阻塞 K)')
  } else {
    const sum = tally.executed + tally.skipped + tally.blocked
    if (sum !== ROWS.length) {
      problems.push(`tally sums to ${sum}, expected ${ROWS.length}`)
    }
    if (tally.executed !== counts.executed || tally.skipped !== counts.skipped
      || tally.blocked !== counts.blocked) {
      problems.push(
        `tally (${tally.executed}/${tally.skipped}/${tally.blocked}) disagrees with the rows `
        + `(${counts.executed}/${counts.skipped}/${counts.blocked})`,
      )
    }
  }

  return { ok: problems.length === 0, problems, tally, counts }
}

module.exports = { checkWalkthroughTable, DEFAULT_TARGET, COLUMNS, ROWS }

if (require.main === module) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_TARGET
  let text
  try {
    text = fs.readFileSync(target, 'utf8')
  } catch (error) {
    console.error(`[check-walkthrough-table] cannot read ${target}: ${error.message}`)
    process.exit(2)
  }
  const result = checkWalkthroughTable(text)
  if (!result.ok) {
    console.error(`[check-walkthrough-table] FAIL ${target}`)
    for (const problem of result.problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  const { executed, skipped, blocked } = result.counts
  console.log(`[check-walkthrough-table] PASS ${target}`)
  console.log(`  rows ①–⑪ present, tiers 已执行 ${executed} / 未执行 ${skipped} / 阻塞 ${blocked}`)
  if (executed === 0) {
    // The spec is explicit: a table with no executed row proves nothing, so say
    // so out loud instead of letting an exit 0 read as "walkthrough passed".
    console.log('  NOTE: 已执行 = 0 — format is compliant, but there is no hands-on evidence.')
  }
}
