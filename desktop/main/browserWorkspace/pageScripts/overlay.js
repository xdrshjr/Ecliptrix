'use strict'

// pageScripts/overlay.js — the Agent's visible hand inside the page (spec §4.2.5, U5/U7).
// A closed shadow root on one fixed host: cursor, target highlight, label bubble. The page's
// own nodes are never touched, pointer-events stay off, and the host removes itself after
// 8 s without commands. Reduced motion → 120 ms highlight flash instead of a glide.

/**
 * Move the agent cursor to a point and flash the target.
 * @param {{ x: number, y: number, rect?: {x:number,y:number,w:number,h:number}, label?: string, reduced?: boolean }} op
 */
function showAgentCursor(op) {
  const root = globalThis
  let ctx = root.__ecxOverlay
  if (!ctx || !ctx.host.isConnected) {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'closed' })
    shadow.innerHTML = '<style>' +
      '.c{position:absolute;left:0;top:0;width:18px;height:18px;transition:transform .28s ease-out;will-change:transform}' +
      '.h{position:absolute;border:2px solid #D97757;border-radius:6px;box-shadow:0 0 0 3px rgba(217,119,87,.18);' +
      'opacity:0;transition:opacity .12s}' +
      '.l{position:absolute;max-width:260px;padding:2px 8px;border-radius:6px;background:#D97757;color:#fff;' +
      'font:600 11px/18px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .12s}' +
      '</style><svg class="c" viewBox="0 0 18 18"><path d="M2 1l12 7-5.2 1.4L7 15z" fill="#D97757" stroke="#fff" stroke-width="1.2"/></svg>' +
      '<div class="h"></div><div class="l"></div>'
    ctx = { host, shadow, cursor: shadow.querySelector('.c'), box: shadow.querySelector('.h'), label: shadow.querySelector('.l'), timer: 0 }
    root.__ecxOverlay = ctx
    document.documentElement.appendChild(host)
  }
  const reduced = op.reduced !== undefined ? op.reduced : Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)
  ctx.cursor.style.transition = reduced ? 'none' : 'transform 280ms ease-out'
  ctx.cursor.style.transform = `translate(${Math.round(op.x)}px,${Math.round(op.y)}px)`
  if (op.rect) {
    Object.assign(ctx.box.style, { left: `${op.rect.x}px`, top: `${op.rect.y}px`, width: `${op.rect.w}px`, height: `${op.rect.h}px`, opacity: '1' })
    Object.assign(ctx.label.style, { left: `${op.rect.x}px`, top: `${Math.max(0, op.rect.y - 24)}px`, opacity: op.label ? '1' : '0' })
    ctx.label.textContent = String(op.label || '').slice(0, 40)
  }
  clearTimeout(ctx.timer)
  ctx.timer = setTimeout(() => { ctx.host.remove(); root.__ecxOverlay = null }, 8000)
  return true
}

/** Remove the overlay immediately (control released / user took over). */
function hideAgentOverlay() {
  const ctx = globalThis.__ecxOverlay
  if (ctx) { clearTimeout(ctx.timer); ctx.host.remove(); globalThis.__ecxOverlay = null }
  return true
}

module.exports = { showAgentCursor, hideAgentOverlay }
