/**
 * W2 / W3 — drive the PACKAGED application through §8's seven steps over CDP.
 *
 * DoD#8 has been open for two rounds. Iteration 1 left it, Iteration 2 wrote
 * `dodEightClosed: false` and marked five steps `not-run-here`, both times for
 * the same reason: "a GUI cannot be driven honestly from here". E0-c disproved
 * that this round — `Ecliptrix.exe --remote-debugging-port=<n>` is consumed by
 * Chromium (the main process filters nothing), `/json/list` yields a page
 * target, and `Runtime.evaluate` and `Page.captureScreenshot` both work against
 * it, with no new dependency (Node >= 22.4 ships a global `WebSocket`).
 *
 * What this driver will and will not claim:
 *
 *  * every step records `automated` / `failed` / `not-run-here` with the reason,
 *    a screenshot, and — on failure — a DOM snapshot, so a gap is reviewable
 *    offline instead of being an adjective (§7.1 risk 3);
 *  * a step that cannot be performed is NEVER substituted with an equivalent
 *    measured outside the package (L-Q6). Q2/Q4 measure the same physics on the
 *    development box; that is not this;
 *  * `dodEightClosed` is true only if all seven steps are `automated` AND the
 *    W3 pixel comparison ran. Anything else prints `DoD#8 NOT closed` (L-Q12).
 *
 * File import deserves its own note. The app opens its picker by creating a
 * detached `<input type=file>` and calling `.click()` on it, which is a native
 * dialog no automation can answer. The driver installs a click interceptor that
 * captures that element instead of letting it open the dialog, then hands it
 * files through CDP's `DOM.setFileInputFiles`, which fires the same `change` the
 * user's selection would. The app's own `processFileUpload` runs for real; the
 * only thing replaced is the OS dialog.
 *
 * Usage:
 *   node cdp_walkthrough.mjs <out.json> --media <mediaDir> --shots <shotDir>
 *                            [--unpacked <dir>] [--port <n>]
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const REPO_ROOT = path.resolve(HERE, '../../../..')
const DEFAULT_UNPACKED = path.join(REPO_ROOT, 'desktop', 'release', 'win-unpacked')
const STARTUP_TIMEOUT_MS = 180_000
const CDP_TIMEOUT_MS = 60_000

/** Both locales — the packaged app may launch in either. */
const LABEL = {
  // A clean userData has no model credential, so the packaged app opens on the
  // projects page behind the first-run setup guide. Dismissing it and creating a
  // project ARE step 2; measured from the step-1 screenshot of the first run.
  setupLater: ['Maybe later', '稍后再说'],
  newProject: ['New project', '新建项目'],
  createProject: ['Create', '创建'],
  upload: ['Import Materials', '导入素材'],
  addToTimeline: ['Add to timeline', '添加到轨道中'],
  motionAdd: ['Add camera motion...', '添加运镜…', 'Edit camera motion...', '编辑运镜…'],
  apply: ['Apply', '应用'],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argValue = (name, fallback = null) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET', timeout: 10_000 }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '<timeout>' }) })
    req.on('error', (e) => resolve({ status: 0, body: `<error: ${e.message}>` }))
    req.end()
  })
}

function readPorts(userDataDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userDataDir, 'desktop-config.json'), 'utf-8'))
    return { frontend: cfg.frontendPort || 18320, backend: cfg.backendPort || 18321 }
  } catch {
    return { frontend: 18320, backend: 18321 }
  }
}

/** ELECTRON_RUN_AS_NODE turns Ecliptrix.exe into a bare Node binary. */
function childEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/** A CDP session over the page target. */
class Session {
  constructor(socket) {
    this.socket = socket
    this.pending = new Map()
    this.nextId = 1
    socket.addEventListener('message', (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      const slot = this.pending.get(msg.id)
      if (slot) { this.pending.delete(msg.id); slot(msg) }
    })
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ error: { message: `timeout on ${method}` } })
      }, CDP_TIMEOUT_MS)
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluate an expression and return its value (or throw the page's error). */
  async evaluate(expression, awaitPromise = false) {
    const res = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    })
    if (res.error) throw new Error(`${res.error.message}: ${expression.slice(0, 120)}`)
    const details = res.result?.exceptionDetails
    if (details) throw new Error(`page threw: ${details.text} ${details.exception?.description ?? ''}`)
    return res.result?.result?.value
  }

  /** Evaluate and keep the remote handle (needed by DOM.setFileInputFiles). */
  async handle(expression) {
    const res = await this.send('Runtime.evaluate', { expression })
    return res.result?.result?.objectId ?? null
  }

  async screenshot(target, clip = null) {
    const params = clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' }
    const shot = await this.send('Page.captureScreenshot', params)
    const b64 = shot?.result?.data
    if (!b64) return null
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, Buffer.from(b64, 'base64'))
    return target
  }

  async domSnapshot(target) {
    const doc = await this.send('DOM.getDocument', { depth: -1, pierce: true })
    const root = doc?.result?.root?.nodeId
    if (!root) return null
    const html = await this.send('DOM.getOuterHTML', { nodeId: root })
    const text = html?.result?.outerHTML
    if (!text) return null
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text, 'utf-8')
    return target
  }
}

/** Find an element by any of several titles/labels/texts. Returns a JS path. */
function finderExpression(labels) {
  const list = JSON.stringify(labels)
  return `(() => {
    const labels = ${list};
    // Interactive elements first: a text match can otherwise land on a wrapper
    // DIV that merely CONTAINS the label (measured — attempt 7 clicked a DIV and
    // the context menu never fired its handler).
    const tiers = [
      Array.from(document.querySelectorAll('[role="menuitem"],button')),
      Array.from(document.querySelectorAll('[title],[aria-label]')),
    ];
    for (const nodes of tiers) {
      for (const label of labels) {
        const hit = nodes.find((n) =>
          n.getAttribute('title') === label ||
          n.getAttribute('aria-label') === label ||
          (n.textContent || '').trim() === label);
        if (hit) return hit;
      }
    }
    return null;
  })()`
}

async function clickByLabel(session, labels) {
  const expression = `(() => {
    const el = ${finderExpression(labels)};
    if (!el) return { ok: false, reason: 'not found' };
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    return { ok: true, tag: el.tagName, title: el.getAttribute('title') };
  })()`
  return session.evaluate(expression)
}

/** Right-click the first timeline clip of a given kind, opening its context menu. */
async function contextMenuOnClip(session, index) {
  const expression = `(() => {
    const clips = Array.from(document.querySelectorAll('[data-clip-id]'));
    const el = clips[${index}];
    if (!el) return { ok: false, reason: 'no timeline clip at index ${index}', clips: clips.length };
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('contextmenu', opts));
    return { ok: true, clips: clips.length, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  })()`
  return session.evaluate(expression)
}

async function main() {
  const outPath = process.argv[2]
  const mediaDir = argValue('--media')
  const shotDir = argValue('--shots', path.join(os.tmpdir(), 'walkthrough-shots'))
  const unpackedDir = path.resolve(argValue('--unpacked', DEFAULT_UNPACKED))
  const port = Number(argValue('--port', '19333'))
  if (!outPath || !mediaDir) throw new Error('usage: node cdp_walkthrough.mjs <out.json> --media <dir> [--shots <dir>]')

  const exePath = path.join(unpackedDir, 'Ecliptrix.exe')
  if (!fs.existsSync(exePath)) throw new Error(`Ecliptrix.exe not found at ${exePath}`)

  const lines = []
  const log = (m) => { const s = `${new Date().toISOString()} ${m}`; lines.push(s); console.log(s) }
  const steps = []
  const record = (n, title, status, detail) => {
    steps.push({ step: n, title, status, ...detail })
    log(`step${n} [${status}] ${title}${detail.reason ? ` — ${detail.reason}` : ''}`)
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-w2-'))
  fs.writeFileSync(path.join(userDataDir, '.env'), '# walkthrough: zero-config userData\n')
  const child = spawn(exePath, [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`], {
    stdio: 'ignore', env: childEnv(),
  })
  let exited = false
  child.on('exit', () => { exited = true })
  let session = null
  let w3 = { ran: false, reason: 'walkthrough did not reach step 7' }

  try {
    // --- step 1: launch, services healthy, page target attached ------------
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    let ports = readPorts(userDataDir)
    let healthy = false
    while (Date.now() < deadline && !healthy && !exited) {
      ports = readPorts(userDataDir)
      const backend = await httpGet(`http://127.0.0.1:${ports.backend}/api/health`)
      const frontend = await httpGet(`http://127.0.0.1:${ports.frontend}/`)
      healthy = backend.status === 200 && frontend.status === 200
      if (!healthy) await sleep(2000)
    }
    // A page target can appear before the window has finished loading, and an
    // evaluate against a renderer still booting simply never answers (measured:
    // the first attempt at this driver timed out here). The main process logs
    // the moment the window is up; wait for it exactly as smoke-test does.
    const mainLog = path.join(userDataDir, 'logs', 'main.log')
    const windowDeadline = Date.now() + 120_000
    let windowLoaded = false
    while (!windowLoaded && Date.now() < windowDeadline) {
      try { windowLoaded = /main window finished load/.test(fs.readFileSync(mainLog, 'utf-8')) } catch { windowLoaded = false }
      if (!windowLoaded) await sleep(1000)
    }
    log(`main window finished load: ${windowLoaded}`)

    let pageTarget = null
    const listDeadline = Date.now() + 60_000
    while (Date.now() < listDeadline && !pageTarget) {
      const list = await httpGet(`http://127.0.0.1:${port}/json/list`)
      try {
        pageTarget = JSON.parse(list.body).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null
      } catch { pageTarget = null }
      if (!pageTarget) await sleep(1500)
    }
    if (!healthy || !pageTarget) {
      record(1, 'launch + services healthy + page target', 'failed', {
        reason: `healthy=${healthy} pageTarget=${!!pageTarget}`, ports,
      })
      throw new Error('cannot proceed without a page target')
    }
    const socket = new WebSocket(pageTarget.webSocketDebuggerUrl)
    const opened = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), CDP_TIMEOUT_MS)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(true) }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); resolve(false) }, { once: true })
    })
    if (!opened) {
      record(1, 'launch + services healthy + page target', 'failed', { reason: 'WebSocket upgrade rejected' })
      throw new Error('no CDP session')
    }
    session = new Session(socket)
    await session.send('Runtime.enable')
    await session.send('Page.enable')
    await session.send('DOM.enable')
    // The editor mounts asynchronously after hydration; poll rather than guess.
    let title = null
    for (let attempt = 0; attempt < 6 && title === null; attempt += 1) {
      await sleep(5000)
      try {
        title = await session.evaluate('document.title')
      } catch (error) {
        log(`evaluate attempt ${attempt + 1} failed: ${error.message}`)
      }
    }
    if (title === null) throw new Error('Runtime.evaluate never answered on the page target')
    record(1, 'launch + services healthy + page target attached', 'automated', {
      ports, documentTitle: title,
      screenshot: await session.screenshot(path.join(shotDir, 'step1-launched.png')),
    })

    // --- step 2: project + media import -----------------------------------
    const dismissed = await clickByLabel(session, LABEL.setupLater)
    await sleep(1500)
    const projectDialog = await clickByLabel(session, LABEL.newProject)
    await sleep(2500)
    // The New-project dialog wants a name; React controls the input, so the
    // value goes in through the native setter and an `input` event, which is
    // what a keystroke produces.
    const named = await session.evaluate(`(() => {
      // Scope to the DIALOG. A page-wide 'first text input' lands in the project
      // SEARCH box — measured: attempt 4 typed the name into the filter and the
      // Create button stayed inert because the real field was still empty.
      const create = Array.from(document.querySelectorAll('button')).find(
        (b) => ['Create', '创建'].includes((b.textContent || '').trim()));
      if (!create) return { ok: false, reason: 'no Create button' };
      let scope = create;
      for (let i = 0; i < 8 && scope && !scope.querySelector('input'); i += 1) scope = scope.parentElement;
      const field = scope && scope.querySelector('input');
      if (!field) return { ok: false, reason: 'no text field inside the dialog' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(field, 'Camera motion walkthrough');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: field.value };
    })()`)
    await sleep(500)
    const created = await clickByLabel(session, LABEL.createProject)
    await sleep(8000)
    log(
      `setup dismissed=${JSON.stringify(dismissed)} newProject=${JSON.stringify(projectDialog)} ` +
      `named=${JSON.stringify(named)} create=${JSON.stringify(created)}`,
    )
    await session.screenshot(path.join(shotDir, 'step2a-project.png'))

    let editorReady = await session.evaluate(`(() => ({
      timeline: !!document.querySelector('.timeline-toolbar'),
      canvas: document.querySelectorAll('canvas').length,
      uploadButton: !!${finderExpression(LABEL.upload)},
    }))()`)
    log(`editor probe: ${JSON.stringify(editorReady)}`)
    if (!editorReady.uploadButton) {
      // The project chooser may need a second confirmation; give the workspace
      // a longer mount window before declaring the step blocked.
      await sleep(10_000)
      editorReady = await session.evaluate(`(() => ({
        timeline: !!document.querySelector('.timeline-toolbar'),
        canvas: document.querySelectorAll('canvas').length,
        uploadButton: !!${finderExpression(LABEL.upload)},
      }))()`)
      log(`editor probe (retry): ${JSON.stringify(editorReady)}`)
    }

    let imported = { ok: false, reason: 'not attempted' }
    if (editorReady.uploadButton) {
      // Intercept the picker: the app creates a DETACHED input and clicks it,
      // which would open a native dialog no automation can answer.
      await session.evaluate(`(() => {
        window.__harnessInputs = [];
        const original = HTMLElement.prototype.click;
        HTMLElement.prototype.click = function patched() {
          if (this.tagName === 'INPUT' && this.type === 'file') {
            window.__harnessInputs.push(this);
            document.body.appendChild(this);
            return;
          }
          return original.apply(this, arguments);
        };
        return true;
      })()`)
      await clickByLabel(session, LABEL.upload)
      await sleep(500)
      const captured = await session.evaluate('(window.__harnessInputs || []).length')
      if (captured > 0) {
        const objectId = await session.handle('window.__harnessInputs[window.__harnessInputs.length - 1]')
        const files = fs.readdirSync(mediaDir).map((name) => path.join(mediaDir, name))
        const set = await session.send('DOM.setFileInputFiles', { files, objectId })
        imported = { ok: !set.error, reason: set.error?.message ?? null, files }
        await sleep(15_000) // the real upload + analysis path runs here
      } else {
        imported = { ok: false, reason: 'the app never created a file input for this click' }
      }
    }
    const materials = await session.evaluate(
      `document.querySelectorAll('[title="${LABEL.addToTimeline[0]}"],[title="${LABEL.addToTimeline[1]}"]').length`,
    )
    record(2, 'create project + import media', imported.ok && materials > 0 ? 'automated' : 'failed', {
      reason: imported.ok ? (materials > 0 ? null : 'materials never appeared in the panel') : imported.reason,
      editorReady, importedFiles: imported.files ?? [], materialsInPanel: materials,
      screenshot: await session.screenshot(path.join(shotDir, 'step2-imported.png')),
      domSnapshot: materials > 0 ? null : await session.domSnapshot(path.join(shotDir, 'step2-dom.html')),
    })
    if (!(imported.ok && materials > 0)) throw new Error('media import did not complete')

    // Put every material on the timeline.
    await session.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll(
        '[title="${LABEL.addToTimeline[0]}"],[title="${LABEL.addToTimeline[1]}"]'));
      buttons.forEach((b) => b.click());
      return buttons.length;
    })()`)
    await sleep(4000)
    const clips = await session.evaluate("document.querySelectorAll('[data-clip-id]').length")
    log(`timeline clips after add: ${clips}`)

    // --- step 3: open the camera-motion panel ------------------------------
    const menu = await contextMenuOnClip(session, 0)
    await sleep(600)
    const opened3 = menu.ok ? await clickByLabel(session, LABEL.motionAdd) : { ok: false, reason: menu.reason }
    await sleep(1200)
    const panel = await session.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="camera-motion-title"]');
      if (!dialog) return { visible: false };
      return {
        visible: true,
        presets: dialog.querySelectorAll('button').length,
        hasCanvas: dialog.querySelectorAll('canvas').length,
      };
    })()`)
    record(3, 'open the camera-motion panel from the clip context menu',
      panel.visible ? 'automated' : 'failed', {
        reason: panel.visible ? null : `menu=${JSON.stringify(menu)} click=${JSON.stringify(opened3)}`,
        timelineClips: clips, panel,
        screenshot: await session.screenshot(path.join(shotDir, 'step3-panel.png')),
        domSnapshot: panel.visible ? null : await session.domSnapshot(path.join(shotDir, 'step3-dom.html')),
      })
    if (!panel.visible) throw new Error('camera-motion panel did not open')

    // --- steps 4-7 are only reachable once 3 works -------------------------
    const applied = await clickByLabel(session, LABEL.apply)
    await sleep(1500)
    const badge = await session.evaluate(
      "document.querySelectorAll('[data-clip-id] [data-motion-badge], [data-clip-id]').length",
    )
    record(4, 'apply a preset to the clip', applied.ok ? 'automated' : 'failed', {
      reason: applied.ok ? null : applied.reason, badge,
      screenshot: await session.screenshot(path.join(shotDir, 'step4-applied.png')),
    })

    // Steps 5-7 are NOT IMPLEMENTED in this driver. Saying so plainly matters:
    // the reason recorded here used to read "reached only if step 4 is
    // automated", which is false in the only run that matters — step 4 IS
    // automated and these still did not run. A gap explained by a condition that
    // is satisfied reads like an environment problem when it is missing work, and
    // that is the difference between an honest not-run-here (L-Q6) and an alibi.
    record(5, 'apply 2D and 3D motion to the still and confirm the canvas moves',
      'not-run-here', {
        reason:
          'NOT IMPLEMENTED in this driver. Not blocked by step 4, which is automated. '
          + 'Needs: select the still clip on the timeline, apply ken-burns and a 3D '
          + 'preset to it, then assert consecutive canvas frames differ in the '
          + 'direction the preset implies.',
      })
    record(6, 'capture canvas frames during the move', 'not-run-here', {
      reason: 'NOT IMPLEMENTED — needs step 5 to put the canvas in motion first.',
    })
    record(7, 'export and play back', 'not-run-here', {
      reason: 'NOT IMPLEMENTED — needs step 6\'s canvas frames to compare the export against.',
    })
  } catch (error) {
    log(`walkthrough stopped: ${error.message}`)
    for (let n = steps.length + 1; n <= 7; n += 1) {
      record(n, `step ${n}`, 'not-run-here', { reason: `blocked by an earlier failure: ${error.message}` })
    }
  } finally {
    if (session) {
      try { session.socket.close() } catch { /* already closing */ }
    }
    if (!exited) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      await sleep(3000)
    }
  }

  const automated = steps.filter((s) => s.status === 'automated').length
  const payload = {
    metric: 'W2/W3',
    exePath,
    port,
    steps,
    automatedSteps: automated,
    totalSteps: 7,
    w3: w3,
    dodEightClosed: automated === 7 && w3.ran === true,
    dodEightStatus: automated === 7 && w3.ran
      ? 'CLOSED — all seven steps automated in the packaged app and the pixel comparison ran'
      : `NOT CLOSED — ${automated}/7 steps automated; the rest are recorded as not-run-here with reasons`,
    log: lines,
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  log(`walkthrough: ${automated}/7 automated -> ${outPath}`)
  process.exit(automated === 7 ? 0 : 1)
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exit(2)
})
