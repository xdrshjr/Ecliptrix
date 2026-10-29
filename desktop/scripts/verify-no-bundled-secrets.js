'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- 桌面 CLI 沿用现有 CommonJS 运行方式。 */

// POST-package secret gate. Run it on the artifact electron-builder actually
// produced, after `npm run build` and BEFORE the installer is published:
//
//   cd desktop
//   node scripts/verify-no-bundled-secrets.js
//   node scripts/verify-no-bundled-secrets.js <path-to-app.asar>
//   node scripts/verify-no-bundled-secrets.js <app.asar> --json
//
// It opens the asar with @electron/asar, reads every env/config-ish entry
// (scripts/env.template.desktop plus any `.env`, `env.template*` or `*.env`
// entry), and hands each one to findSecretShapedPairs() from
// ./lib/secret-shape. Only KEY NAMES and value LENGTHS are ever printed —
// never a value — so the gate cannot leak the credentials it hunts. Exit codes
// exist to be gated on in a release pipeline: 0 = clean, publish; 1 = secrets
// found, do NOT publish; 2 = could not check (bad usage, missing asar,
// unreadable entry, missing predicate module) — treat 2 as a failed gate too,
// because "dirty" and "unknown" must never collapse into one signal. The
// tracked-file scanner (scripts/scan-secrets.py) cannot see inside app.asar;
// this script is the only thing that can.
//
// Args: optional asar path (default: desktop/release/win-unpacked/resources/
// app.asar, resolved from this script's directory, not from the cwd), --json
// for a single machine-readable line, --help. JSON shape:
// { success, asar, scannedEntries, findings: [{ entry, key, length }],
//   exitCode, error? , note? }.

const fs = require('node:fs')
const path = require('node:path')

const EXIT_CLEAN = 0
const EXIT_DIRTY = 1
const EXIT_ERROR = 2
const PRIMARY_ENTRY = 'scripts/env.template.desktop'
const ENV_ISH = /(^|\/)(\.env(\.[^/]+)?|env\.template(\.[^/]+)?|[^/]+\.env)$/i
const DEFAULT_ASAR = path.resolve(
  __dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar',
)
const USAGE = [
  'Usage: node scripts/verify-no-bundled-secrets.js [<app.asar>] [--json]',
  '',
  '  <app.asar>  Archive to inspect. Default:',
  `              ${DEFAULT_ASAR}`,
  '  --json      Print one JSON object instead of the human report.',
  '  --help, -h  Print this help and exit 0.',
  '',
  'Exit codes: 0 = clean, 1 = secret-shaped values found, 2 = could not check.',
  'Only key names and value lengths are reported; values are never printed.',
].join('\n')

/**
 * Print the usage block to stdout.
 *
 * @param {(chunk: string) => void} writeOutput Sink for stdout.
 * @returns {void}
 */
function writeUsage(writeOutput) {
  writeOutput(`${USAGE}\n`)
}

/**
 * Turn the raw argv list into a validated command description.
 *
 * @param {string[]} argv Arguments without node/script entries.
 * @returns {{asarPath: string, json: boolean, help: boolean}} Parsed command.
 * @throws {Error} On an unknown option or more than one path argument.
 */
function parseArguments(argv) {
  const parsed = { asarPath: DEFAULT_ASAR, json: false, help: false }
  const positional = []
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') parsed.help = true
    else if (argument === '--json') parsed.json = true
    else if (argument.startsWith('-')) {
      throw new Error(`unknown option "${argument}"`)
    } else positional.push(argument)
  }
  if (positional.length > 1) {
    throw new Error(`expected one asar path, got ${positional.length}`)
  }
  if (positional.length === 1) parsed.asarPath = path.resolve(positional[0])
  return parsed
}

/**
 * Require @electron/asar from desktop/node_modules.
 *
 * @returns {object} The asar API (listPackage, statFile, extractFile, ...).
 * @throws {Error} With the expected install location when it is unavailable.
 */
function loadAsarApi() {
  try {
    return require('@electron/asar')
  } catch (error) {
    throw new Error(
      'cannot load @electron/asar (expected desktop/node_modules/' +
        `@electron/asar): ${error.message}`,
    )
  }
}

/**
 * Require the shared secret predicate lazily so a missing module is reported
 * as a clear "wait for it" gate failure instead of a stack trace at load time.
 *
 * @returns {(text: string) => Array<{key: string, length: number}>} Predicate.
 * @throws {Error} When desktop/scripts/lib/secret-shape.js does not exist yet.
 */
function loadFindSecretShapedPairs() {
  try {
    return require('./lib/secret-shape').findSecretShapedPairs
  } catch (error) {
    const isOurModule = String(error.message).includes('secret-shape')
    if (error.code !== 'MODULE_NOT_FOUND' || !isOurModule) throw error
    throw new Error(
      'desktop/scripts/lib/secret-shape.js is missing, so bundled ' +
        'credentials cannot be detected. It is created by the generator fix; ' +
        'wait for it to land and re-run. Do not bypass this gate.',
    )
  }
}

/**
 * Normalise an asar listing entry to `a/b/c` without a leading separator.
 *
 * @param {string} entry Entry name as produced by listPackage.
 * @returns {string} Normalised name ('' for the archive root).
 */
function normalizeEntry(entry) {
  return String(entry)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/**
 * Decide whether an entry name looks env/config-ish.
 *
 * @param {string} name Normalised entry name.
 * @returns {boolean} True for `.env`, `env.template*`, `*.env` entries.
 */
function isEnvConfigEntry(name) {
  return name === PRIMARY_ENTRY || ENV_ISH.test(name)
}

/**
 * List every packed FILE entry, skipping directory headers.
 *
 * @param {object} asar The asar API.
 * @param {string} archivePath Absolute archive path.
 * @returns {string[]} Normalised file entries in archive order.
 * @throws {Error} When the archive cannot be listed or an entry cannot be
 *   stat'ed; the message names the archive and the entry.
 */
function listPackedFiles(asar, archivePath) {
  const files = []
  for (const entry of asar.listPackage(archivePath)) {
    const name = normalizeEntry(entry)
    if (!name) continue
    const header = asar.statFile(archivePath, name)
    if (!header || !header.files) files.push(name)
  }
  return files
}

/**
 * Order the entries to scan: the first-run template first, then the rest.
 *
 * @param {string[]} fileEntries Normalised packed file entries.
 * @returns {string[]} Entries this gate must read.
 */
function selectEntries(fileEntries) {
  const matches = fileEntries.filter(isEnvConfigEntry)
  const primary = matches.includes(PRIMARY_ENTRY) ? [PRIMARY_ENTRY] : []
  const rest = matches.filter((name) => name !== PRIMARY_ENTRY).sort()
  return primary.concat(rest)
}

/**
 * Read one packed entry as UTF-8 text.
 *
 * @param {object} asar The asar API.
 * @param {string} archivePath Absolute archive path.
 * @param {string} entry Normalised entry name.
 * @returns {string} Entry contents.
 * @throws {Error} When the entry cannot be extracted; names archive + entry.
 */
function readEntry(asar, archivePath, entry) {
  try {
    return asar.extractFile(archivePath, entry).toString('utf8')
  } catch (error) {
    throw new Error(
      `cannot read asar entry "${entry}" in ${archivePath}: ${error.message}`,
    )
  }
}

/**
 * Scan every env/config-ish entry of the archive for secret-shaped values.
 *
 * @param {object} asar The asar API.
 * @param {string} archivePath Absolute archive path.
 * @param {(text: string) => Array<{key: string, length: number}>} predicate
 *   Secret detector from ./lib/secret-shape.
 * @returns {{scannedEntries: string[], findings: Array<object>}} Scan outcome.
 * @throws {Error} When the archive is unreadable; see the message for where.
 */
function scanArchive(asar, archivePath, predicate) {
  const scannedEntries = selectEntries(listPackedFiles(asar, archivePath))
  const findings = []
  for (const entry of scannedEntries) {
    const detected = predicate(readEntry(asar, archivePath, entry))
    for (const pair of detected) {
      findings.push({ entry, key: pair.key, length: pair.length })
    }
  }
  return { scannedEntries, findings }
}

/**
 * Build the result object that both the human report and --json are derived
 * from. Never carries a secret value: findings hold key + length only.
 *
 * @param {string} asarPath Absolute archive path.
 * @param {object} [options] Injection points for tests.
 * @returns {object} Result with success/scannedEntries/findings/exitCode.
 */
function runCheck(asarPath, options = {}) {
  const result = {
    success: false,
    asar: asarPath,
    scannedEntries: [],
    findings: [],
    exitCode: EXIT_ERROR,
  }
  try {
    if (!fs.existsSync(asarPath)) {
      throw new Error(
        `asar not found: ${asarPath} — pass the path to app.asar`,
      )
    }
    const asar = options.asar || loadAsarApi()
    const predicate =
      options.findSecretShapedPairs || loadFindSecretShapedPairs()
    const scanned = scanArchive(asar, asarPath, predicate)
    result.scannedEntries = scanned.scannedEntries
    result.findings = scanned.findings
    if (scanned.scannedEntries.length === 0) {
      result.note = 'no env/config-ish entry found; nothing to verify'
    }
    result.success = scanned.findings.length === 0
    result.exitCode = result.success ? EXIT_CLEAN : EXIT_DIRTY
  } catch (error) {
    result.error = error.message
    result.exitCode = EXIT_ERROR
  }
  return result
}

/**
 * Render the operator-facing report. Contains entry names, key names and value
 * lengths only.
 *
 * @param {object} result Outcome of runCheck().
 * @returns {string} Report text ending in a newline.
 */
function formatHumanReport(result) {
  const lines = [`[verify-no-bundled-secrets] asar: ${result.asar}`]
  if (result.error) {
    lines.push(`[verify-no-bundled-secrets] ERROR: ${result.error}`)
    lines.push(`[verify-no-bundled-secrets] exit ${result.exitCode}: ` +
      'could not check the artifact — treat as a failed release gate')
    return `${lines.join('\n')}\n`
  }
  const count = result.scannedEntries.length
  lines.push(`[verify-no-bundled-secrets] scanned ${count} entry/entries: ` +
    `${result.scannedEntries.join(', ') || '(none)'}`)
  if (result.findings.length > 0) {
    lines.push(`[verify-no-bundled-secrets] DIRTY: ${result.findings.length} ` +
      'secret-shaped value(s) — key names and lengths only:')
    for (const finding of result.findings) {
      lines.push(`  - ${finding.key} (length ${finding.length}) ` +
        `in ${finding.entry}`)
    }
    lines.push(`[verify-no-bundled-secrets] exit ${result.exitCode}: ` +
      'do NOT publish this artifact; rebuild with both source .env files ' +
      'absent so prepare-env.js emits placeholders')
    return `${lines.join('\n')}\n`
  }
  lines.push(`[verify-no-bundled-secrets] OK: no secret-shaped value in ` +
    `${count} scanned entry/entries`)
  if (result.note) {
    lines.push(`[verify-no-bundled-secrets] note: ${result.note}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Run the gate.
 *
 * @param {string[]} [argv] Arguments without node/script entries.
 * @param {object} [options] Injection points: asar, findSecretShapedPairs,
 *   stdout, stderr.
 * @returns {number} 0 clean, 1 dirty, 2 usage/IO error.
 */
function main(argv = process.argv.slice(2), options = {}) {
  const writeOutput = options.stdout || ((chunk) => process.stdout.write(chunk))
  const writeError = options.stderr || ((chunk) => process.stderr.write(chunk))
  let parsed
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    writeError(`[verify-no-bundled-secrets] ${error.message}\n`)
    writeError(`${USAGE}\n`)
    return EXIT_ERROR
  }
  if (parsed.help) {
    writeUsage(writeOutput)
    return EXIT_CLEAN
  }
  const result = runCheck(parsed.asarPath, options)
  if (parsed.json) writeOutput(`${JSON.stringify(result)}\n`)
  else if (result.error) writeError(formatHumanReport(result))
  else writeOutput(formatHumanReport(result))
  return result.exitCode
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = {
  main,
  runCheck,
  scanArchive,
  formatHumanReport,
  parseArguments,
  selectEntries,
  isEnvConfigEntry,
  loadSecretPredicate: loadFindSecretShapedPairs,
}
