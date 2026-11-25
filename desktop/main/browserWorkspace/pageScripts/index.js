'use strict'

// pageScripts/index.js — turns the page-side functions into evaluable expressions.

const snapshot = require('./snapshot')
const act = require('./act')
const overlay = require('./overlay')
const sentinel = require('./sentinel')

/**
 * Serialise a self-contained function plus JSON args into an expression for
 * Runtime.evaluate / jsdom `window.eval`.
 * @param {Function} fn
 * @param {unknown} [arg]
 * @returns {string}
 */
function buildCall(fn, arg) {
  return `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
}

module.exports = { buildCall, ...snapshot, ...act, ...overlay, ...sentinel }
