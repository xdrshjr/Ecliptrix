'use strict'

// pageScripts/snapshot.js — page-side snapshot + image scripts (spec §4.2.5).
//
// These functions are serialised with `Function.prototype.toString()` and run INSIDE
// the page's isolated world `ecx`, so each must be fully self-contained (no closure
// over this module) — which is why the helpers are nested and the functions run
// longer than the usual 50-line budget. The isolated world has its own JS prototypes,
// so the page cannot tamper with the natives used here or read `__ecx` (R-13).
// Layout/rect code is injected-stubbed in jsdom tests (jsdom has no layout).

/**
 * Build the element list + body text, and register refs in `globalThis.__ecx`.
 * @param {{ version: number, maxElements: number, maxBytes: number, fullBytes: number, budgetMs: number }} opts
 */
function snapshotPage(opts) {
  const startedAt = Date.now()
  const root = globalThis
  const state = (root.__ecx = root.__ecx || {})
  state.version = opts.version
  state.items = []
  const ROLE_SELECTOR = ['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
    'checkbox', 'radio', 'switch', 'combobox', 'searchbox', 'textbox', 'slider'].map((r) => `[role="${r}"]`).join(',')
  const SELECTOR = `a[href],button,input:not([type=hidden]),select,textarea,summary,${ROLE_SELECTOR},` +
    '[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"]),[onclick]'
  const SENSITIVE_NAME = /pass(word)?|pwd|card|cvv|cvc|otp|验证码|密码|银行卡/i
  let framesUnsupported = 0
  let overBudget = false

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  function labelText(el) {
    const ids = el.getAttribute('aria-labelledby')
    if (ids) {
      const t = ids.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' ')
      if (clean(t)) return clean(t)
    }
    if (el.labels && el.labels.length) return clean(el.labels[0].textContent)
    const wrap = el.closest && el.closest('label')
    return wrap ? clean(wrap.textContent) : ''
  }
  function nameOf(el) {
    const raw = clean(el.getAttribute('aria-label')) || labelText(el) || clean(el.getAttribute('placeholder')) ||
      clean(el.getAttribute('title')) || clean(el.getAttribute('alt')) || clean(el.innerText || el.textContent) ||
      (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) ? clean(el.value) : '')
    return raw.slice(0, 80)
  }
  function roleOf(el) {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'search') return 'searchbox'
      if (type === 'range') return 'slider'
      return /^(button|submit|reset|image)$/.test(type) ? 'button' : 'textbox'
    }
    return el.isContentEditable ? 'textbox' : 'generic'
  }
  function hrefPath(el) {
    try { return el.href ? new URL(el.href).pathname : '' } catch { return '' }
  }
  function fpOf(el) {
    return [el.tagName.toLowerCase(), roleOf(el), nameOf(el), el.type || '', hrefPath(el)].join('|')
  }
  function isSensitive(el) {
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase()
    return (el.type || '').toLowerCase() === 'password' || /cc-|one-time-code|current-password|new-password/.test(auto) ||
      SENSITIVE_NAME.test(`${el.name || ''} ${el.id || ''} ${labelText(el)}`)
  }
  function visible(el, rect) {
    if (rect.width < 4 || rect.height < 4) return false
    if (el.closest && el.closest('[inert]')) return false
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true
  }
  function collect(scope, out) {
    for (const el of scope.querySelectorAll(SELECTOR)) out.push(el)
    for (const host of scope.querySelectorAll('*')) {
      if (host.shadowRoot) collect(host.shadowRoot, out)
      if (host.tagName === 'IFRAME') {
        let inner = null
        try { inner = host.contentDocument } catch { inner = null }
        if (inner) collect(inner, out); else framesUnsupported += 1
      }
      if (Date.now() - startedAt > opts.budgetMs) { overBudget = true; break }
    }
    return out
  }

  const vh = root.innerHeight || 0
  const candidates = []
  for (const el of collect(document, [])) {
    const rect = el.getBoundingClientRect()
    if (visible(el, rect)) candidates.push({ el, rect, inView: rect.bottom > 0 && rect.top < vh })
  }
  const ordered = [...candidates.filter((c) => c.inView), ...candidates.filter((c) => !c.inView)]
  const elements = ordered.slice(0, opts.maxElements).map((c, i) => {
    const ref = `e${i + 1}`
    state.items[i] = { ref, el: new WeakRef(c.el), fp: fpOf(c.el) }
    const item = { ref, role: roleOf(c.el), name: nameOf(c.el), in_viewport: c.inView }
    if (c.el.tagName === 'A' && c.el.href) item.href = c.el.href.slice(0, 200)
    if (c.el.type && c.el.tagName === 'INPUT') item.type = c.el.type
    if (c.el.disabled) item.state = { disabled: true }
    if (isSensitive(c.el)) item.sensitive = true
    return item
  })
  state.fpOf = fpOf
  state.nameOf = nameOf
  state.roleOf = roleOf
  state.isSensitive = isSensitive

  const main = document.querySelector('main,article,[role=main]') || document.body
  const full = clean((main && main.innerText) || (document.body && document.body.innerText) || '')
  const fullCapped = full.slice(0, opts.fullBytes)
  const enc = new TextEncoder()
  let text = fullCapped
  while (enc.encode(text).length > opts.maxBytes) text = text.slice(0, Math.floor(text.length * 0.9))
  return {
    url: location.href, title: document.title || '', text, full_text: fullCapped,
    truncated: text.length < full.length || candidates.length > elements.length || overBudget,
    more_below: candidates.length > elements.length, elements, frames_unsupported: framesUnsupported,
    viewport: { w: root.innerWidth, h: vh, scroll_y: Math.round(root.scrollY || 0), scroll_h: document.documentElement.scrollHeight },
  }
}

/**
 * Image candidates (spec §4.2.5 "图片脚本"): img/currentSrc, picture srcset best, og/twitter, big backgrounds.
 * @param {{ limit: number }} opts
 */
function collectImages(opts) {
  const vh = globalThis.innerHeight || 0
  const seen = new Map()
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return '' } }
  function add(url, extra) {
    if (!url) return
    const kind = /^(data|blob):/i.test(url) ? 'inline' : 'url'
    if (kind === 'url' && !/^https?:/i.test(url)) return
    const prev = seen.get(url)
    const entry = { image_url: url, kind, alt: '', natural_w: 0, natural_h: 0, rendered_w: 0, rendered_h: 0, in_viewport: false,
      is_og: false, via_srcset_best: false, ...(prev || {}), ...extra }
    seen.set(url, entry)
  }
  function bestSrcset(srcset) {
    let best = null
    for (const part of String(srcset || '').split(',')) {
      const [u, d] = part.trim().split(/\s+/)
      const weight = d ? parseFloat(d) : 1
      if (u && (!best || weight > best.weight)) best = { u: abs(u), weight }
    }
    return best && best.u
  }
  for (const img of document.images) {
    const r = img.getBoundingClientRect()
    add(img.currentSrc || img.src, { alt: (img.alt || '').slice(0, 120), natural_w: img.naturalWidth, natural_h: img.naturalHeight,
      rendered_w: Math.round(r.width), rendered_h: Math.round(r.height), in_viewport: r.bottom > 0 && r.top < vh })
  }
  for (const source of document.querySelectorAll('picture source[srcset]')) {
    add(bestSrcset(source.getAttribute('srcset')), { via_srcset_best: true })
  }
  for (const meta of document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')) {
    add(abs(meta.getAttribute('content')), { is_og: true })
  }
  for (const el of document.querySelectorAll('[style*="background"]')) {
    const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage || '')
    const r = el.getBoundingClientRect()
    if (m && r.width * r.height > 10000) {
      add(abs(m[1]), { rendered_w: Math.round(r.width), rendered_h: Math.round(r.height), in_viewport: r.bottom > 0 && r.top < vh })
    }
  }
  const area = (e) => Math.max(e.natural_w * e.natural_h, e.rendered_w * e.rendered_h)
  return [...seen.values()].sort((a, b) => area(b) - area(a)).slice(0, opts.limit)
}

module.exports = { snapshotPage, collectImages }
