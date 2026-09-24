'use strict'

// Guards the exe/taskbar icon chain (spec brand-logo-refresh §7.1).
// Run: node main/appIcon.test.js

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const {
  APP_ID,
  APP_ICON_PATH,
  resolveAppUserModelId,
  resolveUnpackedPath,
} = require('./appIcon')

const DESKTOP_ROOT = path.join(__dirname, '..')
const BUILDER_ICON_PATH = path.join(DESKTOP_ROOT, 'resources', 'icons', 'icon.ico')
const BUILDER_CONFIG = fs.readFileSync(
  path.join(DESKTOP_ROOT, 'electron-builder.yml'),
  'utf8',
)
const ICO_HEADER = Buffer.from([0x00, 0x00, 0x01, 0x00])
const ICONDIR_SIZE = 6
const ICONDIRENTRY_SIZE = 16
const TASKBAR_SIZES = [16, 24, 32, 48, 256]

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// ICONDIR: reserved(2) type(2) count(2); each entry starts with width and
// height bytes, where 0 means 256.
function readIcoSizes(filePath) {
  const data = fs.readFileSync(filePath)
  const count = data.readUInt16LE(4)
  const sizes = []
  for (let i = 0; i < count; i += 1) {
    const width = data[ICONDIR_SIZE + i * ICONDIRENTRY_SIZE]
    sizes.push(width === 0 ? 256 : width)
  }
  return sizes
}

function testIconFileExists() {
  assert.ok(fs.existsSync(APP_ICON_PATH), `missing ${APP_ICON_PATH}`)
  const header = fs.readFileSync(APP_ICON_PATH).subarray(0, 4)
  assert.ok(header.equals(ICO_HEADER), 'runtime icon must be an ICO file')
}

function testIconHasTaskbarSizes() {
  const sizes = readIcoSizes(APP_ICON_PATH)
  for (const size of TASKBAR_SIZES) {
    assert.ok(sizes.includes(size), `icon.ico lacks a ${size}px frame`)
  }
}

function testBuilderIconMatchesRuntimeIcon() {
  assert.strictEqual(
    sha256(BUILDER_ICON_PATH),
    sha256(APP_ICON_PATH),
    'resources/icons/icon.ico and assets/icon.ico must be byte-identical',
  )
}

function testBuilderEditsExecutable() {
  // Without rcedit the exe (and so the taskbar) keeps Electron's atom icon.
  assert.ok(
    !/^\s*signAndEditExecutable:\s*false\s*$/m.test(BUILDER_CONFIG),
    'signAndEditExecutable must not be false',
  )
  assert.ok(
    /^\s*signAndEditExecutable:\s*true\s*$/m.test(BUILDER_CONFIG),
    'signAndEditExecutable must be true',
  )
}

function testAppIdMatchesBuilderConfig() {
  const match = BUILDER_CONFIG.match(/^appId:\s*(\S+)\s*$/m)
  assert.ok(match, 'electron-builder.yml must declare appId')
  assert.strictEqual(match[1], APP_ID)
}

function testDevAumidIsDistinct() {
  assert.notStrictEqual(resolveAppUserModelId(true), resolveAppUserModelId(false))
  assert.strictEqual(resolveAppUserModelId(false), APP_ID)
}

function testIconIsUnpackedFromAsar() {
  assert.ok(
    /^asarUnpack:\s*\n(?:\s+-\s*\S+\s*\n)*\s+-\s*assets\/icon\.ico\s*$/m.test(
      BUILDER_CONFIG,
    ),
    'asarUnpack must list assets/icon.ico (Win32 cannot load .ico from asar)',
  )
}

function testUnpackedPathRewrite() {
  assert.strictEqual(
    resolveUnpackedPath('C:\\x\\resources\\app.asar\\assets\\icon.ico'),
    'C:\\x\\resources\\app.asar.unpacked\\assets\\icon.ico',
  )
  assert.strictEqual(
    resolveUnpackedPath('/opt/x/resources/app.asar/assets/icon.ico'),
    '/opt/x/resources/app.asar.unpacked/assets/icon.ico',
  )
  const devPath = 'M:\\repo\\desktop\\assets\\icon.ico'
  assert.strictEqual(resolveUnpackedPath(devPath), devPath)
  const unpacked = 'C:\\x\\resources\\app.asar.unpacked\\assets\\icon.ico'
  assert.strictEqual(resolveUnpackedPath(unpacked), unpacked)
}

testIconFileExists()
testIconHasTaskbarSizes()
testBuilderIconMatchesRuntimeIcon()
testBuilderEditsExecutable()
testAppIdMatchesBuilderConfig()
testDevAumidIsDistinct()
testIconIsUnpackedFromAsar()
testUnpackedPathRewrite()

console.log('appIcon tests ok')
