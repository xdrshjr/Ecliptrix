'use strict'

// viewHost.js — owns the native WebContentsViews (spec §4.2.3).
//
// Native views always paint ABOVE the renderer's DOM, so visibility is a computed
// property, not a flag scattered across callers: `computeLayout` (pure, unit-tested)
// maps {dock rect, occlusion, locked, which tab is agent-busy} → per-view
// {visible, bounds}. Key rule (R1-3): a view with a running Agent command is NEVER
// hidden or zero-sized — when the user cannot see it, it is PARKED.
//
// Parking, MEASURED in Electron 33 (scripts/browser-workspace-parking-spike.js; the spec's
// original "x=-32000" idea is WRONG for WebContentsView): a view entirely outside the window
// reports innerWidth=0 / visibilityState=hidden and rAF stops. A view that intersects the
// window by even 1 px keeps its full size, stays "visible" and keeps ticking — also while the
// main window is minimised. So parked views sit with their top-left at the window's last
// content pixel (1x1 px visible in the corner, under the window edge).

const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

/**
 * @param {object} input
 * @param {{ tabId: string, agentBusy: boolean }[]} input.views Existing live views.
 * @param {string|null} input.activeTabId
 * @param {{x:number,y:number,width:number,height:number}|null} input.dockRect CSS px from the renderer.
 * @param {boolean} input.dockVisible Dock open & not animating.
 * @param {boolean} input.occluded A DOM overlay is on top of the viewport (renderer froze a still frame).
 * @param {boolean} input.locked Identity gate not passed.
 * @param {number} input.zoom Renderer zoom factor.
 * @param {{width:number,height:number}|null} input.contentBounds Window content size, device-independent.
 * @param {{width:number,height:number}} input.lastViewport
 * @returns {Map<string, {visible: boolean, bounds: object|null}>}
 */
function computeLayout(input) {
  const out = new Map()
  const { lastViewport } = input
  const rect = input.dockRect
  const onScreen = !input.locked && input.dockVisible && rect && rect.width > 0 && rect.height > 0
  for (const view of input.views) {
    const isActive = view.tabId === input.activeTabId
    if (input.locked) {
      out.set(view.tabId, { visible: false, bounds: null })
    } else if (isActive && onScreen && !input.occluded) {
      out.set(view.tabId, { visible: true, bounds: scaleAndClip(rect, input.zoom, input.contentBounds) })
    } else if (view.agentBusy) {
      const c = input.contentBounds
      out.set(view.tabId, {
        visible: true,
        bounds: { x: c ? Math.max(0, c.width - 1) : 0, y: c ? Math.max(0, c.height - 1) : 0, width: lastViewport.width, height: lastViewport.height },
      })
    } else {
      out.set(view.tabId, { visible: false, bounds: null })
    }
  }
  return out
}

/** CSS px → integer window px, intersected with the content area (spec §4.2.3 边界同步). */
function scaleAndClip(rect, zoom, content) {
  const z = zoom || 1
  let x = Math.round(rect.x * z)
  let y = Math.round(rect.y * z)
  let w = Math.round(rect.width * z)
  let h = Math.round(rect.height * z)
  if (content) {
    const right = Math.min(x + w, content.width)
    const bottom = Math.min(y + h, content.height)
    x = Math.max(0, x)
    y = Math.max(0, y)
    w = Math.max(0, right - x)
    h = Math.max(0, bottom - y)
  }
  return { x, y, width: w, height: h }
}

/**
 * @param {object} deps
 * @param {Function} deps.WebContentsView Electron class.
 * @param {() => object|null} deps.getWin Main BrowserWindow.
 * @param {object} [deps.logger]
 */
function createViewHost(deps) {
  /** @type {Map<string, { view: object, wc: object, agentBusy: boolean, attached: boolean }>} */
  const views = new Map()
  const model = {
    activeTabId: null, dockRect: null, dockVisible: false, occluded: false, locked: false,
    lastViewport: { ...DEFAULT_VIEWPORT },
  }

  function contentSize() {
    const win = deps.getWin()
    if (!win || win.isDestroyed()) return null
    const [width, height] = win.getContentSize()
    const zoom = win.webContents.getZoomFactor() || 1
    return { width, height, zoom }
  }

  /** Re-apply the computed layout to every view. Cheap; callers invoke it freely. */
  function reconcile() {
    const win = deps.getWin()
    if (!win || win.isDestroyed()) return
    const size = contentSize()
    const layout = computeLayout({
      views: [...views].map(([tabId, v]) => ({ tabId, agentBusy: v.agentBusy })),
      ...model, zoom: size.zoom, contentBounds: { width: size.width, height: size.height },
    })
    for (const [tabId, entry] of views) {
      const verdict = layout.get(tabId)
      if (verdict.visible && !entry.attached && !model.locked) {
        win.contentView.addChildView(entry.view)
        entry.attached = true
      }
      if (verdict.bounds) entry.view.setBounds(verdict.bounds)
      entry.view.setVisible(verdict.visible)
      if (model.locked && entry.attached) {
        win.contentView.removeChildView(entry.view)
        entry.attached = false
      }
    }
  }

  return {
    computeLayout,
    reconcile,
    model,
    /**
     * Create a view; `webPreferences` follow spec §4.2.3 (no preload, sandboxed, isolated).
     * @returns {{ view: object, wc: object }}
     */
    create(tabId, { partition, owner }) {
      const view = new deps.WebContentsView({
        webPreferences: {
          partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
          spellcheck: true, backgroundThrottling: owner === 'user',
        },
      })
      view.setVisible(false)
      const entry = { view, wc: view.webContents, agentBusy: false, attached: false }
      views.set(tabId, entry)
      if (owner === 'agent') entry.wc.setAudioMuted(true)
      return { view, wc: entry.wc }
    },
    has: (tabId) => views.has(tabId),
    /** Diagnostics (spike / smoke): what the native view really looks like right now. */
    debugInfo(tabId) {
      const entry = views.get(tabId)
      return entry ? { attached: entry.attached, agentBusy: entry.agentBusy, bounds: entry.view.getBounds(), model: { ...model } } : null
    },
    /** True when the user can actually see this view (the Agent cursor is only drawn then). */
    isOnScreen(tabId) {
      const size = contentSize()
      if (!size || !views.has(tabId)) return false
      const verdict = computeLayout({
        views: [{ tabId, agentBusy: false }], ...model, zoom: size.zoom, contentBounds: size,
      }).get(tabId)
      return Boolean(verdict && verdict.visible)
    },
    webContents: (tabId) => (views.get(tabId) ? views.get(tabId).wc : null),
    destroy(tabId) {
      const entry = views.get(tabId)
      if (!entry) return
      const win = deps.getWin()
      if (entry.attached && win && !win.isDestroyed()) win.contentView.removeChildView(entry.view)
      views.delete(tabId)
      if (!entry.wc.isDestroyed()) entry.wc.close()
      reconcile()
    },
    setActive(tabId) { model.activeTabId = tabId; reconcile() },
    setDock({ rect, visible }) {
      if (rect !== undefined) {
        model.dockRect = rect
        if (rect && rect.width > 0 && rect.height > 0) model.lastViewport = { width: Math.round(rect.width), height: Math.round(rect.height) }
      }
      if (visible !== undefined) model.dockVisible = visible
      reconcile()
    },
    setOccluded(occluded) { model.occluded = occluded; reconcile() },
    setLocked(locked) { model.locked = locked; reconcile() },
    /** Keep a view paintable while an Agent command runs (R1-3). */
    setAgentBusy(tabId, busy) {
      const entry = views.get(tabId)
      if (entry) { entry.agentBusy = busy; reconcile() }
    },
    /** Hide everything and forget bounds: renderer reload / crash recovery (§4.2.3). */
    resetForRendererReload() {
      model.dockRect = null
      model.dockVisible = false
      model.occluded = false
      reconcile()
    },
    /** @returns {Promise<string|null>} JPEG data URL of the active view (≤300 KB) for occlusion freezes. */
    async captureFrozen() {
      const entry = views.get(model.activeTabId)
      if (!entry || entry.wc.isDestroyed()) return null
      let image = await entry.wc.capturePage()
      let quality = 70
      let jpeg = image.toJPEG(quality)
      while (jpeg.length > 300 * 1024 && quality > 30) {
        const { width } = image.getSize()
        image = image.resize({ width: Math.round(width * 0.8) })
        quality -= 10
        jpeg = image.toJPEG(quality)
      }
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`
    },
    destroyAll() { for (const id of [...views.keys()]) this.destroy(id) },
  }
}

module.exports = { createViewHost, computeLayout, scaleAndClip, DEFAULT_VIEWPORT }
