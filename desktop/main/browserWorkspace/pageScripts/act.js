'use strict'

// pageScripts/act.js — page-side action helpers (spec §4.2.5). Serialised and run in the
// isolated world `ecx`; they reuse `globalThis.__ecx` created by snapshotPage, so a
// navigation (new world) makes every ref stale by construction.
//
// R1-3: no step may depend on requestAnimationFrame — hidden / occluded views pause it.
// Frame waits are `Promise.race([rAF, setTimeout(50)])`.

/**
 * Resolve a ref, scroll it into view, hit-test it and describe it.
 * @param {{ ref: string, expectVersion: number, intent: 'click'|'fill'|'hover'|'focus' }} op
 * @returns {Promise<object>} `{ ok:true, x, y, name, role, risk }` or `{ ok:false, code, details? }`.
 */
async function prepareTarget(op) {
  const ecx = globalThis.__ecx
  if (!ecx || ecx.version !== op.expectVersion) return { ok: false, code: 'stale_snapshot' }
  const item = ecx.items.find((i) => i.ref === op.ref)
  if (!item) return { ok: false, code: 'element_not_found' }
  const el = item.el.deref()
  if (!el || !el.isConnected) return { ok: false, code: 'stale_ref' }
  if (ecx.fpOf(el) !== item.fp) return { ok: false, code: 'stale_ref' }
  if (op.intent === 'fill' && ecx.isSensitive(el)) return { ok: false, code: 'sensitive_field' }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  await new Promise((resolve) => { requestAnimationFrame(resolve); setTimeout(resolve, 50) })
  const rect = el.getBoundingClientRect()
  const x = Math.round(rect.left + rect.width / 2)
  const y = Math.round(rect.top + rect.height / 2)
  if (rect.width < 1 || rect.height < 1 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
    return { ok: false, code: 'element_obscured', details: { reason: 'outside_viewport' } }
  }
  let hit = document.elementFromPoint(x, y)
  while (hit && hit.shadowRoot && hit.shadowRoot.elementFromPoint) {
    const inner = hit.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === hit) break
    hit = inner
  }
  const lab = hit && hit.closest ? hit.closest('label') : null
  const okHit = hit && (hit === el || el.contains(hit) || hit.contains(el) || (lab && lab.control === el))
  if (!okHit) {
    const by = hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''} "${String(hit.innerText || '').slice(0, 40).trim()}"` : 'unknown'
    return { ok: false, code: 'element_obscured', details: { obscured_by: by } }
  }
  if (op.intent === 'fill' || op.intent === 'focus') {
    el.focus()
    if (op.intent === 'fill') {
      if (typeof el.select === 'function') el.select()
      else getSelection().selectAllChildren(el)
    }
  }
  const form = el.form || (el.closest && el.closest('form'))
  return {
    ok: true, x, y, name: ecx.nameOf(el), role: ecx.roleOf(el),
    rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
    risk: {
      name: ecx.nameOf(el), href: el.href || '', formAction: form ? form.action || '' : '',
      formMethod: form ? form.method || '' : '',
    },
  }
}

/**
 * Info about the focused element, to classify an Enter key press.
 * @returns {{ name: string, inForm: boolean, formMethod: string, formAction: string, sensitive: boolean }}
 */
function describeFocus() {
  const el = document.activeElement
  const ecx = globalThis.__ecx
  if (!el || el === document.body) return { name: '', inForm: false, formMethod: '', formAction: '', sensitive: false }
  const form = el.form || (el.closest && el.closest('form'))
  return {
    name: ecx && ecx.nameOf ? ecx.nameOf(el) : '', inForm: Boolean(form), formMethod: form ? form.method || '' : '',
    formAction: form ? form.action || '' : '', sensitive: Boolean(ecx && ecx.isSensitive && ecx.isSensitive(el)),
  }
}

/**
 * Set a `<select>` by visible option text or value and fire input/change.
 * @param {{ ref: string, expectVersion: number, option_text?: string, value?: string }} op
 */
function selectOption(op) {
  const ecx = globalThis.__ecx
  if (!ecx || ecx.version !== op.expectVersion) return { ok: false, code: 'stale_snapshot' }
  const item = ecx.items.find((i) => i.ref === op.ref)
  const el = item && item.el.deref()
  if (!el || !el.isConnected) return { ok: false, code: item ? 'stale_ref' : 'element_not_found' }
  if (el.tagName !== 'SELECT') return { ok: false, code: 'element_not_found', details: { reason: 'not_a_select' } }
  const option = [...el.options].find((o) => (op.value !== undefined && o.value === op.value) ||
    (op.option_text !== undefined && o.text.trim() === op.option_text))
  if (!option) return { ok: false, code: 'element_not_found', details: { reason: 'option_not_found' } }
  el.value = option.value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, name: ecx.nameOf(el) }
}

/**
 * Fallback when a wheel event produced no scroll (parked / throttled compositor, measured in the
 * spike): scroll the document directly, instantly.
 * @param {{ dy: number }} op
 */
function scrollByAmount(op) {
  scrollBy({ top: op.dy, left: 0, behavior: 'instant' })
  return true
}

/** @returns {{ scroll_y: number, scroll_h: number, viewport_h: number }} */
function readScroll() {
  return { scroll_y: Math.round(scrollY), scroll_h: document.documentElement.scrollHeight, viewport_h: innerHeight }
}

/**
 * Condition wait (spec §4.2.5): text appears / disappears, or a plain delay. Polls at 200 ms.
 * @param {{ ms?: number, until_text?: string, until_gone_text?: string, timeout_ms?: number }} op
 * @returns {Promise<{ matched: boolean }>} timeout is `matched:false`, never an error.
 */
async function waitCondition(op) {
  if (op.ms) { await new Promise((r) => setTimeout(r, Math.min(op.ms, 5000))); return { matched: true } }
  const deadline = Date.now() + Math.min(op.timeout_ms || 5000, 15000)
  const present = (t) => (document.body ? document.body.innerText : '').includes(t)
  while (Date.now() < deadline) {
    if (op.until_text && present(op.until_text)) return { matched: true }
    if (op.until_gone_text && !present(op.until_gone_text)) return { matched: true }
    await new Promise((r) => setTimeout(r, 200))
  }
  return { matched: false }
}

/**
 * Resolve once the DOM has been mutation-quiet for `quietMs` (or `maxMs` elapsed).
 * @param {{ quietMs: number, maxMs: number }} op
 * @returns {Promise<boolean>} true when quiet was reached.
 */
function waitDomQuiet(op) {
  return new Promise((resolve) => {
    let quietTimer
    const finish = (ok) => { observer.disconnect(); clearTimeout(quietTimer); clearTimeout(maxTimer); resolve(ok) }
    const arm = () => { clearTimeout(quietTimer); quietTimer = setTimeout(() => finish(true), op.quietMs) }
    const observer = new MutationObserver(arm)
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    const maxTimer = setTimeout(() => finish(false), op.maxMs)
    arm()
  })
}

module.exports = { prepareTarget, describeFocus, selectOption, scrollByAmount, readScroll, waitCondition, waitDomQuiet }
