'use strict'

// pageScripts/article.js — main-content extraction (spec agent-browser-article-reading §4.2).
// Serialised with `Function.prototype.toString()` into the page's isolated world `ecx`, so it
// must be fully self-contained (E14). Boilerplate is removed from a CLONE, so a visible tab
// never changes shape because the Agent read it; nothing here reads rects, only text.

/**
 * Extract the article body as structured blocks plus publication metadata.
 * @param {{ blocks_from?: number, blocks_max?: number, max_blocks?: number,
 *   max_chars?: number, max_block_chars?: number, max_ms?: number }} opts
 * @returns {{ ok: true, article: object }|{ ok: false, code: string, details: object }}
 */
function extractArticle(opts) {
  const startedAt = Date.now()
  const cfg = opts || {}
  const maxMs = Number(cfg.max_ms) || 1500
  const from = Math.max(0, Math.min(399, Number(cfg.blocks_from) || 0))
  const winMax = Math.max(1, Math.min(40, Number(cfg.blocks_max) || 12))
  const maxBlocks = Math.max(1, Math.min(400, Number(cfg.max_blocks) || 400))
  const maxChars = Math.max(500, Number(cfg.max_chars) || 24000)
  const maxBlockChars = Math.max(80, Number(cfg.max_block_chars) || 2000)
  const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
  const clean = (value) => String(value == null ? '' : value).replace(CTRL, ' ').replace(/\s+/g, ' ').trim()
  const textOf = (el) => clean(el.innerText != null ? el.innerText : el.textContent)
  const late = () => Date.now() - startedAt > maxMs
  const timedOut = () => ({ ok: false, code: 'page_script_timeout', details: { reason: 'max_ms', max_ms: maxMs } })
  const sumText = (nodes) => [...nodes].reduce((total, node) => total + textOf(node).length, 0)

  // Only exact duplicates are dropped: nested candidates stay in the running so the density
  // score picks the innermost body, not the wrapper that carries the nav links.
  const CANDIDATES = 'article, main, [role=main], [itemprop=articleBody], .post, .article, ' +
    '.entry-content, #content, .content'
  const scored = []
  for (const el of document.querySelectorAll(CANDIDATES)) {
    if (scored.some((c) => c.el === el)) continue
    const text = textOf(el)
    if (text.length < 200) continue
    const links = sumText(el.querySelectorAll('a'))
    const score = text.length / (1 + links + sumText(el.querySelectorAll('button')))
    scored.push({ el, text, score, links })
  }
  // A link farm ("40 headlines in a <ul>") is a section index, not an article: refuse it
  // instead of handing the model a list of headlines dressed up as a body (§8.1).
  if (scored.length && scored[0].links * 2 > scored[0].text.length) {
    return { ok: false, code: 'article_not_found', details: { weak: false, reason: 'link_density' } }
  }
  // No candidate at all leaves the body as the only option; that is worth flagging so the
  // model cites a `weak` extraction more conservatively.
  let weak = !scored.length
  let container = document.body
  if (scored.length) {
    scored.sort((a, b) => (b.score - a.score) || (b.text.length - a.text.length))
    container = scored[0].el
  }
  if (!container) return { ok: false, code: 'article_not_found', details: { weak, reason: 'no_body' } }

  // 3. Boilerplate removal on a clone. `[class*="share"]` can hit `shareholder`; P2-2 accepts
  // that and caps the removals instead of growing an ever-longer deny list.
  const clone = container.cloneNode(true)
  const STRIP = 'nav, aside, footer, header, [role=navigation], [role=complementary], ' +
    '[role=banner], [role=contentinfo], [class*="share"], [class*="social"], ' +
    '[class*="related"], [class*="recommend"], [class*="comment"], [class*="cookie"], ' +
    '[class*="consent"], [class*="newsletter"], [class*="subscribe"], [id*=comment], form'
  let stripped = 0
  for (const node of clone.querySelectorAll(STRIP)) {
    if (stripped >= 200 || !node.parentNode) break
    node.parentNode.removeChild(node)
    stripped += 1
  }
  // 4. Structural blocks. An ancestor already taken suppresses its nested descendants, so
  // `<li><p>…</p></li>` yields one block instead of two copies of the same sentence.
  const KIND = { H1: 'h', H2: 'h', H3: 'h', P: 'p', LI: 'li', BLOCKQUOTE: 'quote', PRE: 'pre' }
  const LEVEL = { H1: 1, H2: 2, H3: 3 }
  const blocks = [], taken = []
  for (const el of clone.querySelectorAll('h1,h2,h3,p,li,blockquote,pre')) {
    if (late()) return timedOut()
    if (taken.some((parent) => parent.contains(el))) continue
    const text = textOf(el).slice(0, maxBlockChars)
    if (text.length < 2) continue
    const block = { kind: KIND[el.tagName] || 'p', text }
    if (LEVEL[el.tagName]) block.level = LEVEL[el.tagName]
    blocks.push(block)
    taken.push(el)
  }
  if (!blocks.length) return { ok: false, code: 'article_not_found', details: { weak, reason: 'no_blocks' } }

  // 5. Metadata is page-global, not container-scoped (JSON-LD lives in <head>). Broken
  // JSON-LD is extremely common, so a parse failure is skipped, never thrown.
  const ld = { published: '', author: '', headline: '' }
  const authorName = (value) => {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return authorName(value[0])
    return typeof value === 'object' ? String(value.name || '') : ''
  }
  const visit = (node, depth) => {
    if (!node || depth > 4) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    if (!ld.published && typeof node.datePublished === 'string') ld.published = node.datePublished
    if (!ld.published && typeof node.dateCreated === 'string') ld.published = node.dateCreated
    if (!ld.headline && typeof node.headline === 'string') ld.headline = node.headline
    if (!ld.author && node.author) ld.author = authorName(node.author)
    for (const key of ['@graph', 'mainEntity', 'itemListElement']) visit(node[key], depth + 1)
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(script.textContent || ''), 0) } catch { /* 坏 JSON-LD：静默跳过 */ }
  }
  const meta = (selector) => {
    const el = document.querySelector(selector)
    return el ? clean(el.getAttribute('content') || el.getAttribute('datetime') || '') : ''
  }
  // Canonical ISO only: an unparseable or absurd year is dropped rather than guessed, because
  // this string becomes a citation in the user's script (AC-A3 / AC-A4).
  const isoOrNull = (value) => {
    const ms = clean(value).slice(0, 64)
    const stamp = ms ? Date.parse(ms) : NaN
    if (!Number.isFinite(stamp)) return null
    const year = new Date(stamp).getUTCFullYear()
    return year < 1990 || year > 2100 ? null : new Date(stamp).toISOString()
  }
  const publishedAt = isoOrNull(ld.published || meta('meta[property="article:published_time"]') ||
    meta('meta[name="pubdate"]') || meta('meta[itemprop="datePublished"]') || meta('time[datetime]'))
  const byline = clean(ld.author || meta('meta[name="author"]') ||
    ((document.querySelector('[rel=author]') || {}).textContent) ||
    ((document.querySelector('[itemprop=author] [itemprop=name]') || {}).textContent)).slice(0, 120)
  let canonical = ''
  const canonicalEl = document.querySelector('link[rel=canonical]')
  if (canonicalEl) {
    try {
      const url = new URL(canonicalEl.getAttribute('href') || '', location.href)
      if (/^https?:$/.test(url.protocol)) canonical = url.href.slice(0, 512)
    } catch { canonical = '' }
  }
  const heading = clone.querySelector('h1')
  const title = clean(meta('meta[property="og:title"]') || ld.headline || document.title ||
    (heading ? textOf(heading) : '')).slice(0, 200)
  const site = clean(meta('meta[property="og:site_name"]') || location.hostname).slice(0, 120)

  // 6. Window over the full list: `total_blocks` / `char_count` describe the WHOLE page, so
  // the model can tell how much is left; only `blocks` is windowed.
  const total = blocks.length
  const charCount = blocks.reduce((sum, block) => sum + block.text.length, 0)
  const cap = Math.min(total, maxBlocks)
  const windowBlocks = []
  let used = 0, windowTruncated = false
  for (const block of blocks.slice(from, cap)) {
    if (windowBlocks.length >= winMax) break
    if (windowBlocks.length && used + block.text.length > maxChars) {
      windowTruncated = true
      break
    }
    windowBlocks.push(block)
    used += block.text.length
  }
  const nextFrom = from + windowBlocks.length
  return { ok: true, article: {
    title, byline: byline || null, published_at: publishedAt, canonical_url: canonical || null,
    site, blocks: windowBlocks, total_blocks: total, char_count: charCount, weak, stripped,
    blocks_overflow: total > maxBlocks,
    window: { from, count: windowBlocks.length, next_from: nextFrom < cap ? nextFrom : null,
      window_truncated: windowTruncated },
  } }
}

module.exports = { extractArticle }
