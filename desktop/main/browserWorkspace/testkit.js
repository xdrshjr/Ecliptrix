'use strict'

// Tiny test harness shared by the browserWorkspace suites (pure node, no
// framework) — same `run()` contract as the auth suites so
// scripts/test-browser-workspace.js can await each one in-process.

/**
 * @returns {{ test: (name: string, fn: Function) => Promise<void>, count: () => number }}
 */
function createRunner() {
  let passed = 0
  return {
    async test(name, fn) {
      try {
        await fn()
        passed += 1
        console.log(`  ok - ${name}`)
      } catch (err) {
        console.error(`  FAIL - ${name}`)
        throw err
      }
    },
    count: () => passed,
  }
}

/**
 * Run a suite directly (`node x.test.js`) while still exporting `run`.
 * @param {string} label
 * @param {() => Promise<number>} run
 */
function main(label, run) {
  run()
    .then((count) => console.log(`[${label}] PASS (${count} checks)`))
    .catch((err) => {
      console.error(`[${label}] FAIL: ${(err && err.stack) || err}`)
      process.exit(1)
    })
}

/**
 * jsdom window with layout stubs (jsdom has no layout): rects come from `data-rect="x,y,w,h"`,
 * hit-testing is a rect lookup, innerText mirrors textContent.
 * @param {string} html
 * @param {string} url
 * @returns {object|null} window, or null when jsdom (repo root node_modules) is absent.
 */
function makeJsdomWindow(html, url) {
  let JSDOM
  try { ({ JSDOM } = require('jsdom')) } catch { return null }
  const w = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' }).window
  w.TextEncoder = TextEncoder
  w.innerWidth = 1280
  w.innerHeight = 720
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent } })
  w.Element.prototype.getBoundingClientRect = function rect() {
    const raw = this.getAttribute && this.getAttribute('data-rect')
    const [x, y, width, height] = (raw || '0,0,0,0').split(',').map(Number)
    return { left: x, top: y, right: x + width, bottom: y + height, x, y, width, height }
  }
  w.Element.prototype.scrollIntoView = function noop() {}
  w.document.elementFromPoint = (x, y) => [...w.document.querySelectorAll('[data-rect]')].find((el) => {
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }) || null
  return w
}

module.exports = { createRunner, main, makeJsdomWindow }
