'use strict'

// viewShortcuts.js — app-level shortcuts while keyboard focus is INSIDE a native page
// view (spec §4.2.3 焦点, §4.6.1). The renderer's keydown handlers never see those keys
// because the page view owns focus, so the main process catches them in
// `before-input-event` and forwards an action name.

/**
 * @param {{ type: string, key: string, control?: boolean, meta?: boolean, alt?: boolean, shift?: boolean }} input
 * @returns {string|null} Action name or null when the key is the page's own.
 */
function matchShortcut(input) {
  if (input.type !== 'keyDown') return null
  const mod = Boolean(input.control || input.meta)
  const key = String(input.key || '').toLowerCase()
  if (mod && !input.alt) {
    if (key === 'l') return 'focus-address'
    if (key === 't') return 'new-tab'
    if (key === 'w') return 'close-tab'
    if (key === 'r') return 'reload'
    if (key === 'tab') return input.shift ? 'prev-tab' : 'next-tab'
  }
  // Ctrl+Alt+B, not bare Alt+B: a lone Alt toggles the auto-hidden menu bar (renderer chose the same, RV-18).
  if (mod && input.alt && key === 'b') return 'toggle-dock'
  if (!mod && input.alt) {
    if (key === 'arrowleft') return 'back'
    if (key === 'arrowright') return 'forward'
  }
  return key === 'f5' && !mod && !input.alt ? 'reload' : null
}

/**
 * @param {object} wc Electron WebContents of a page view.
 * @param {(action: string) => void} onAction
 */
function attachShortcuts(wc, onAction) {
  wc.on('before-input-event', (event, input) => {
    const action = matchShortcut(input)
    if (!action) return
    event.preventDefault()
    onAction(action)
  })
}

module.exports = { matchShortcut, attachShortcuts }
