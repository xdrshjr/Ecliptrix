'use strict'

const path = require('path')
const { BrowserWindow, shell } = require('electron')

const ASSETS_DIR = path.join(__dirname, '..', 'assets')

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  splash.loadFile(path.join(ASSETS_DIR, 'splash.html'))
  return splash
}

function setSplashStatus(splash, text) {
  if (!splash || splash.isDestroyed()) return
  // splash.html defines window.setStatus; JSON.stringify guards the quoting.
  splash.webContents
    .executeJavaScript(`window.setStatus(${JSON.stringify(text)})`)
    .catch(() => {})
}

/**
 * Main application window pointed at the local Next.js server. Same-origin
 * URLs stay inside the window; everything else opens in the system browser.
 */
function createMainWindow({ url, bounds, onBoundsChange, version, logsPath }) {
  const win = new BrowserWindow({
    width: (bounds && bounds.width) || 1440,
    height: (bounds && bounds.height) || 900,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    // Frameless: drop the native title bar/border so the renderer draws its own
    // (spec §2.3a). thickFrame defaults to true, so Windows keeps the hidden
    // WS_THICKFRAME and edge-resize still works.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Read-only metadata for the preload bridge — keeps IPC surface at zero.
      additionalArguments: [
        `--ecliptrix-version=${version}`,
        `--ecliptrix-logs-path=${logsPath}`,
      ],
    },
  })

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://127.0.0.1:') || target.startsWith('http://localhost:')) {
      return { action: 'allow' }
    }
    shell.openExternal(target)
    return { action: 'deny' }
  })

  win.on('close', () => {
    if (onBoundsChange && !win.isMaximized() && !win.isMinimized()) {
      onBoundsChange(win.getBounds())
    }
  })

  // Push maximize-state changes to the renderer so the self-drawn title bar can
  // swap its maximize/restore icon (spec §2.3a).
  const emitMax = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:maximize-changed', win.isMaximized())
    }
  }
  win.on('maximize', emitMax)
  win.on('unmaximize', emitMax)

  win.once('ready-to-show', () => win.show())
  win.loadURL(url)
  return win
}

/** Startup-failure page with the failing service name and logs path. */
function showErrorWindow({ serviceName, logsPath, detail }) {
  const win = new BrowserWindow({
    width: 600,
    height: 420,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.loadFile(path.join(ASSETS_DIR, 'error.html'), {
    query: {
      service: serviceName || '',
      logs: logsPath || '',
      detail: detail || '',
    },
  })
  return win
}

module.exports = { createSplashWindow, setSplashStatus, createMainWindow, showErrorWindow }
