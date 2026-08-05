/**
 * Electron entry point for the preview-side experiments.
 *
 * Why Electron: the preview half of M2 and all of M3 need a REAL browser —
 * canvas 2D with a genuine rasterizer and a genuine WebGL context. The repo's
 * unit tests run in jsdom, where `drawImage` is a stub and WebGL is absent, so
 * they can only assert that the compositor takes the right branch, never that
 * the branch draws the right pixels. Electron is already vendored for the
 * desktop build (`desktop/node_modules/electron`), so this needs no new
 * dependency and runs the same Chromium the shipped app does.
 *
 * The window is never shown; frames come from `compositor.captureFrame()`,
 * which is the same hook the app exposes.
 *
 * Usage:
 *   electron.exe <this dir> --job=<job.json> --out=<result.json>
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function readArg(name, fallback) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const jobPath = readArg('job');
const outPath = readArg('out');
if (!jobPath || !outPath) {
  console.error('usage: electron . --job=<job.json> --out=<result.json>');
  app.exit(2);
}

// Hardware acceleration is left ON. A machine that falls back to a software
// rasterizer would quietly change every M3 number, so the renderer reports the
// GL renderer string it actually got rather than the harness assuming one.
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let finished = false;

function finish(payload, code) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  app.exit(code);
}

app.whenReady().then(() => {
  // A hidden window is fine for frame capture (renderFrame is called directly),
  // but Chromium throttles requestAnimationFrame to roughly 1Hz while a window
  // is hidden or occluded. The performance run therefore takes a real, visible,
  // always-on-top window — otherwise M3 would measure the throttle, not the
  // compositor.
  const mode = JSON.parse(fs.readFileSync(jobPath, 'utf8')).mode;
  const visible = mode === 'perf';
  const win = new BrowserWindow({
    show: visible,
    alwaysOnTop: visible,
    width: 1280,
    height: 720,
    webPreferences: {
      // The harness requires the transpiled shipping kernel straight off disk;
      // it loads no remote content, so node integration is safe here and keeps
      // the module loading identical to how the golden generator does it.
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      offscreen: false,
    },
  });

  ipcMain.on('harness-progress', (_event, message) => {
    console.log(`[renderer] ${message}`);
  });
  ipcMain.on('harness-done', (_event, payload) => finish(payload, 0));
  ipcMain.on('harness-error', (_event, payload) => {
    console.error(`[renderer] FATAL ${payload && payload.message}`);
    finish({ ok: false, error: payload }, 1);
  });

  win.webContents.on('console-message', (_e, _level, message) => {
    console.log(`[console] ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    finish({ ok: false, error: { message: `render process gone: ${details.reason}` } }, 1);
  });

  win.loadFile(path.join(__dirname, 'index.html'), {
    query: { job: jobPath },
  });
});

app.on('window-all-closed', () => finish({ ok: false, error: { message: 'window closed early' } }, 1));
