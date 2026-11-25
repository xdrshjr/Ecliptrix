'use strict'

// pageScripts/sentinel.js — user-input sentinel (spec §4.2.5, §4.5.2).
// Registered with Page.addScriptToEvaluateOnNewDocument({ worldName: 'ecx' }) plus
// Runtime.addBinding('__ecxUser'). Capture-phase listeners call the binding for TRUSTED
// events only; the main process ignores calls that land while an agent command runs
// (CDP-dispatched input is trusted too, hence the `agentActing` flag + 150 ms tail).

/** Names shared with cdpEngine so both sides agree. */
const BINDING_NAME = '__ecxUser'
const WORLD_NAME = 'ecx'

/**
 * @returns {string} Self-contained script source (an IIFE string, not a function value).
 */
function sentinelSource() {
  return `(() => {
    if (globalThis.__ecxSentinel) return;
    globalThis.__ecxSentinel = true;
    const ping = (e) => { if (e.isTrusted && typeof globalThis.${BINDING_NAME} === 'function') globalThis.${BINDING_NAME}('1'); };
    for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, ping, { capture: true, passive: true });
  })();`
}

module.exports = { sentinelSource, BINDING_NAME, WORLD_NAME }
