'use strict'

// inputEvents.js — trusted input via CDP `Input.*` (spec §4.2.5). Synthetic DOM events
// (`el.click()`) are untrusted and many sites ignore them; CDP-dispatched events are the
// same as real hardware input. The key list is a whitelist: the model cannot send
// arbitrary shortcuts (Ctrl+…) through `browser_act press`.

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
}
const MAX_FILL_CHARS = 512
const MAX_WHEEL_DELTA = 1440

/** @param {string} key @returns {boolean} */
const isAllowedKey = (key) => Object.prototype.hasOwnProperty.call(KEYS, key)

/**
 * Move, press and release the primary button at (x, y).
 * @param {(method: string, params: object) => Promise<unknown>} send CDP sender for the tab.
 */
async function clickAt(send, x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

const hoverAt = (send, x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })

/** @param {string} key One of KEYS. */
async function pressKey(send, key) {
  const def = KEYS[key]
  const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk }
  await send('Input.dispatchKeyEvent', { type: def.text ? 'keyDown' : 'rawKeyDown', ...base, ...(def.text ? { text: def.text } : {}) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

/** @param {number} deltaY Clamped to ±1440. */
function wheel(send, x, y, deltaY) {
  const clamped = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, Math.round(deltaY)))
  return send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: clamped })
}

const insertText = (send, text) => send('Input.insertText', { text })

module.exports = { clickAt, hoverAt, pressKey, wheel, insertText, isAllowedKey, KEYS, MAX_FILL_CHARS, MAX_WHEEL_DELTA }
