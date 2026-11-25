'use strict'

// contextMenu.js — native right-click menu for page views (spec §4.6.3 页面右键菜单).
// Why main-process: the page owns the native view, so the renderer never sees the event.
// "Save to library" only EMITS a request (R2-2): the renderer calls the backend through
// the BFF and reuses the existing material-library ingest, so there is one ingest path.

/**
 * @param {object} params Electron context-menu params (subset).
 * @param {{ tab: object, handlers: object }} ctx handlers: back, forward, reload, openInNewTab(url),
 *   copyText(text), copyImage(x, y), saveResource({ url, kind }), selectAll()
 * @returns {object[]} Menu template (Electron MenuItemConstructorOptions[]).
 */
function buildMenuTemplate(params, { tab, handlers }) {
  const items = []
  const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }) }
  if (params.linkURL) {
    items.push({ label: '在新标签页打开链接', click: () => handlers.openInNewTab(params.linkURL) })
    items.push({ label: '复制链接地址', click: () => handlers.copyText(params.linkURL) })
    sep()
  }
  if (params.mediaType === 'image' && params.srcURL) {
    items.push({ label: '保存到素材库', click: () => handlers.saveResource({ url: params.srcURL, kind: 'image' }) })
    items.push({ label: '复制图片', click: () => handlers.copyImage(params.x, params.y) })
    items.push({ label: '复制图片地址', click: () => handlers.copyText(params.srcURL) })
    sep()
  } else if ((params.mediaType === 'video' || params.mediaType === 'audio') && params.srcURL && !params.srcURL.startsWith('blob:')) {
    items.push({ label: '保存到素材库', click: () => handlers.saveResource({ url: params.srcURL, kind: 'media' }) })
    sep()
  }
  if (params.selectionText) items.push({ label: '复制', role: 'copy' })
  if (params.isEditable) items.push({ label: '粘贴', role: 'paste' })
  items.push({ label: '全选', click: () => handlers.selectAll() })
  sep()
  items.push({ label: '后退', enabled: Boolean(tab.canGoBack), click: handlers.back })
  items.push({ label: '前进', enabled: Boolean(tab.canGoForward), click: handlers.forward })
  items.push({ label: '刷新', click: handlers.reload })
  return items
}

/**
 * @param {object} wc WebContents.
 * @param {{ Menu: object, tab: object, getWin: () => object, handlers: object }} deps
 */
function attachContextMenu(wc, deps) {
  wc.on('context-menu', (_event, params) => {
    const template = buildMenuTemplate(params, { tab: deps.tab, handlers: deps.handlers })
    deps.Menu.buildFromTemplate(template).popup({ window: deps.getWin() || undefined })
  })
}

module.exports = { buildMenuTemplate, attachContextMenu }
