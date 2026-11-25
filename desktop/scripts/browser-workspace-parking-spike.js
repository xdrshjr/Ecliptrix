'use strict'

// Measures where an Agent page view can be "parked" so Chromium keeps a real viewport and keeps
// painting while the user cannot see it (spec R1-3 / §8.3 ⑨). Run: npx electron scripts/browser-workspace-parking-spike.js
// Prints innerWidth×innerHeight and rAF ticks per strategy, with the main window normal and minimised.

const { app, BrowserWindow, BaseWindow, WebContentsView } = require('electron')

app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PAGE = 'data:text/html,<body><script>var f=0;(function t(){f++;requestAnimationFrame(t)})()</script>park</body>'

async function measure(view) {
  const wc = view.webContents
  const probe = '({w:innerWidth,h:innerHeight,vis:document.visibilityState,f:window.f})'
  const a = await wc.executeJavaScript(probe)
  await sleep(500)
  const b = await wc.executeJavaScript(probe)
  return `${b.w}x${b.h} vis=${b.vis} rafTicks=${b.f - a.f}`
}

async function main() {
  await app.whenReady()
  const win = new BrowserWindow({ width: 1280, height: 800, show: true })
  await win.loadURL('about:blank')
  const mk = async () => {
    const view = new WebContentsView({ webPreferences: { backgroundThrottling: false, sandbox: true } })
    await view.webContents.loadURL(PAGE)
    return view
  }
  const strategies = {
    'A main window, x=-32000': async () => { const v = await mk(); win.contentView.addChildView(v); v.setBounds({ x: -32000, y: 0, width: 1280, height: 720 }); v.setVisible(true); return v },
    'B main window, bottom-right corner (mostly clipped)': async () => { const v = await mk(); win.contentView.addChildView(v); const [cw, ch] = win.getContentSize(); v.setBounds({ x: cw - 1, y: ch - 1, width: 1280, height: 720 }); v.setVisible(true); return v },
    'C main window, setVisible(false)': async () => { const v = await mk(); win.contentView.addChildView(v); v.setBounds({ x: 0, y: 0, width: 1280, height: 720 }); v.setVisible(false); return v },
    'D parking BaseWindow show:true at -32000': async () => {
      const park = new BaseWindow({ x: -32000, y: -32000, width: 1280, height: 720, show: true, frame: false, skipTaskbar: true, focusable: false })
      const v = await mk(); park.contentView.addChildView(v); v.setBounds({ x: 0, y: 0, width: 1280, height: 720 }); v.setVisible(true); v.park = park; return v
    },
    'E parking BaseWindow show:false': async () => {
      const park = new BaseWindow({ x: -32000, y: -32000, width: 1280, height: 720, show: false, frame: false, skipTaskbar: true })
      const v = await mk(); park.contentView.addChildView(v); v.setBounds({ x: 0, y: 0, width: 1280, height: 720 }); v.setVisible(true); v.park = park; return v
    },
  }
  const views = {}
  for (const [name, build] of Object.entries(strategies)) views[name] = await build()
  for (const state of ['main window normal', 'main window minimised']) {
    if (state.endsWith('minimised')) { win.minimize(); await sleep(800) }
    for (const [name, view] of Object.entries(views)) console.log(`${state.padEnd(24)} | ${name.padEnd(54)} | ${await measure(view)}`)
  }
  app.exit(0)
}

main().catch((e) => { console.error(e); app.exit(2) })
setTimeout(() => app.exit(3), 60_000).unref()
