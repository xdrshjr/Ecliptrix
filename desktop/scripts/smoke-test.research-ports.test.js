/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const SMOKE_TEST = path.join(__dirname, 'smoke-test.js')
const WRAPPER = 'researchBrowserSmoke'
const RUNNER = 'runResearchBrowserSmoke'

// Regression (pipeline-audit D1). researchBrowserSmoke() accepted the running
// app host's CDP/control ports and then called runResearchBrowserSmoke() with
// three arguments. The runner builds its child environment from
// researchPorts.cdp / researchPorts.control, so every packaged smoke run died
// with "TypeError: Cannot read properties of undefined (reading 'cdp')" and the
// default build.ps1 gate could never pass. These tests pin the forwarding: the
// wrapper must pass the same object it was handed, never a re-derived port.

const realSpawn = childProcess.spawn
let capturedSpawns = null

// smoke-test.js destructures child_process.spawn while loading, so the recorder
// has to be installed before that module is required and must stay installed.
childProcess.spawn = (file, args, options) => {
  if (!capturedSpawns) return realSpawn(file, args, options)
  capturedSpawns.push({ file, args, options })
  return fakeChildProcess()
}

/** Stub child: emits `close` with code 0 after the runner registers listeners. */
function fakeChildProcess() {
  const listeners = new Map()
  const stream = { on() {} }
  const child = {
    pid: 424242,
    stdout: stream,
    stderr: stream,
    once(event, listener) {
      listeners.set(event, listener)
      return child
    },
  }
  setImmediate(() => {
    const close = listeners.get('close')
    if (close) close(0)
  })
  return child
}

/** Load smoke-test.js once, with the spawn recorder already in place. */
function loadSmokeTest() {
  return require('./smoke-test')
}

/**
 * Return the text inside the balanced delimiter pair that follows `marker`.
 * @param {string} source text to scan
 * @param {string} marker literal located before the opening delimiter
 * @param {string} [open] opening delimiter
 * @param {string} [close] closing delimiter
 * @returns {string} inner text, delimiters excluded
 */
function balancedAfter(source, marker, open = '(', close = ')') {
  const at = source.indexOf(marker)
  if (at < 0) throw new Error(`marker not found: ${marker}`)
  const start = source.indexOf(open, at)
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open) depth += 1
    else if (source[index] === close) {
      depth -= 1
      if (depth === 0) return source.slice(start + 1, index)
    }
  }
  throw new Error(`unbalanced ${open}${close} after ${marker}`)
}

/** Split a parameter/argument list on its top-level commas. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of text) {
    if ('([{'.includes(character)) depth += 1
    if (')]}'.includes(character)) depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += character
    }
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(Boolean)
}

/**
 * Return a declared function's source, braces balanced.
 * @param {string} source whole file
 * @param {string} name declared function name
 * @returns {string} declaration text
 */
function functionSource(source, name) {
  const at = source.indexOf(`function ${name}(`)
  if (at < 0) throw new Error(`function not declared: ${name}`)
  // The audited wrappers hold no braces inside string literals, so plain
  // brace counting locates the body end.
  let depth = 0
  for (let index = source.indexOf('{', at); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(at, index + 1)
    }
  }
  throw new Error(`unbalanced body for ${name}`)
}

/**
 * Assert that `wrapper` forwards its own last parameter to `runner`.
 * @param {string} source whole file
 * @param {string} wrapper outer function name
 * @param {string} runner inner function name
 * @returns {{parameter: string, passed: string}} forwarded identifier
 */
function assertForwardsLastParameter(source, wrapper, runner) {
  const body = functionSource(source, wrapper)
  const parameters = splitTopLevel(balancedAfter(body, `function ${wrapper}`))
  const passed = splitTopLevel(balancedAfter(body, `${runner}(`))
  const where = `${wrapper}() -> ${runner}()`
  if (passed.length !== parameters.length) {
    throw new Error(`${where}: wrapper advertises ${parameters.length} ` +
      `argument(s) ${JSON.stringify(parameters)} but the call passes ` +
      `${passed.length} ${JSON.stringify(passed)}`)
  }
  const last = parameters[parameters.length - 1]
  const forwarded = passed[passed.length - 1]
  if (forwarded !== last) {
    throw new Error(`${where}: last argument must forward the parameter ` +
      `"${last}" (got "${forwarded}"); never invent ports`)
  }
  return { parameter: last, passed: forwarded }
}

function readSource() {
  return fs.readFileSync(SMOKE_TEST, 'utf8')
}

function testWrapperForwardsResearchPorts() {
  const forwarded = assertForwardsLastParameter(readSource(), WRAPPER, RUNNER)
  assert.strictEqual(forwarded.parameter, 'researchPorts',
    'the wrapper must still receive the app host ports as its 4th parameter')
  assert.strictEqual(forwarded.passed, 'researchPorts',
    'the call must forward the very object the wrapper was handed')
}

function testCheckerRejectsDroppedArgument() {
  const dropped = `async function ${WRAPPER}(a, b, c, ports) {\n` +
    `  return ${RUNNER}(a, b, c)\n}\n`
  assert.throws(() => assertForwardsLastParameter(dropped, WRAPPER, RUNNER),
    /advertises 4 argument/, 'the checker must catch the original defect')
}

function testCheckerRejectsInventedPorts() {
  const invented = `async function ${WRAPPER}(a, b, c, ports) {\n` +
    `  return ${RUNNER}(a, b, c, { cdp: 18320, control: 18321 })\n}\n`
  assert.throws(() => assertForwardsLastParameter(invented, WRAPPER, RUNNER),
    /never invent ports/, 'hardcoded ports must not satisfy the guardrail')
}

function testExportsMatchDeclaredFunctions() {
  const source = readSource()
  const names = splitTopLevel(balancedAfter(source, 'module.exports', '{', '}'))
  assert.ok(names.length > 0, 'smoke-test.js must export something')
  for (const name of names) {
    assert.ok(source.includes(`function ${name}(`),
      `module.exports.${name} has no matching function declaration`)
  }
}

async function testRunnerReceivesPortsFromArgument() {
  const api = loadSmokeTest()
  const ports = { cdp: 49321, control: 49322 }
  const spawns = capturedSpawns = []
  let output
  try {
    output = await api[RUNNER](path.join('C:', 'pkg', 'resources'),
      path.join('C:', 'pkg', 'user-data'), null, ports)
  } finally {
    capturedSpawns = null
  }
  assert.strictEqual(output, '', 'the runner must resolve the child stdout')
  assert.strictEqual(spawns.length, 1, 'the runner must start python once')
  const { args, options } = spawns[0]
  assert.deepStrictEqual(args.slice(-2),
    ['-m', 'app.services.web_research.smoke'])
  assert.strictEqual(options.env.AGENT_BROWSER_CDP_URL,
    `http://127.0.0.1:${ports.cdp}`)
  assert.strictEqual(options.env.AGENT_BROWSER_CONTROL_URL,
    `http://127.0.0.1:${ports.control}`)
}

async function testDroppedPortsRejectBeforeSpawn() {
  const api = loadSmokeTest()
  const spawns = capturedSpawns = []
  try {
    // The dropped argument is what D1 reported: a rejected promise, not a
    // skippable check. Pinning it keeps the ports load-bearing.
    await assert.rejects(
      api[RUNNER](path.join('C:', 'pkg'), path.join('C:', 'pkg', 'user-data')),
      TypeError)
  } finally {
    capturedSpawns = null
  }
  assert.strictEqual(spawns.length, 0, 'must fail before spawning python')
}

testWrapperForwardsResearchPorts()
testCheckerRejectsDroppedArgument()
testCheckerRejectsInventedPorts()
testExportsMatchDeclaredFunctions()

Promise.resolve()
  .then(testRunnerReceivesPortsFromArgument)
  .then(testDroppedPortsRejectBeforeSpawn)
  .then(() => {
    console.log('smoke-test research port tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
