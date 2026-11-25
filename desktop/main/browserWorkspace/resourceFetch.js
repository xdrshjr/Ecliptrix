'use strict'

// resourceFetch.js — fetch an image/media resource THROUGH a tab's session (spec §6.2).
//
// Why not let the backend download it:防盗链 / login-gated images only work with the
// tab's cookies and a matching Referer. Bytes come back to the backend, which still runs
// its own magic-number / size / dimension checks before anything enters the library.
// Every redirect hop is re-checked with the same URL guard as navigation.

const { WorkspaceError } = require('./approvalGate')
const scripts = require('./pageScripts')

const MAX_HOPS = 5
const FETCH_TIMEOUT_MS = 30_000
const KIND_PREFIXES = { image: ['image/'], media: ['image/', 'video/', 'audio/'] }

function acceptable(kind, contentType) {
  const type = String(contentType || '').toLowerCase()
  return (KIND_PREFIXES[kind] || []).some((p) => type.startsWith(p))
}

/** Page-side reader for blob: URLs (runs in the isolated world; returns base64). */
async function readBlobInPage(arg) {
  const response = await fetch(arg.url)
  const blob = await response.blob()
  if (blob.size > arg.maxBytes) return { tooLarge: true }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { base64: btoa(binary), type: blob.type }
}

/**
 * @param {object} deps
 * @param {object} deps.net Electron `net`.
 * @param {(partition: string) => object} deps.sessionFor Electron session for the partition.
 * @param {object} deps.tabs
 * @param {object} deps.profiles
 * @param {object} deps.cdp
 * @param {(url: string, actor: 'user'|'agent') => { ok: boolean, url?: string, code?: string }} deps.checkUrl
 */
function createResourceFetcher(deps) {
  function readDataUrl(url, kind, maxBytes) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
    if (!match) throw new WorkspaceError('invalid_argument', { field: 'url' })
    const type = match[1] || 'text/plain'
    if (!acceptable(kind, type)) throw new WorkspaceError('resource_not_image', { content_type: type })
    const body = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]))
    if (body.length > maxBytes) throw new WorkspaceError('resource_too_large')
    return { status: 200, headers: { 'content-type': type, 'x-final-url': 'data:' }, body }
  }

  async function readBlob(tab, url, kind, maxBytes) {
    await deps.cdp.ensure(tab.id, tab.wc)
    const res = await deps.cdp.evalIsolated(tab.id, scripts.buildCall(readBlobInPage, { url, maxBytes }), { timeoutMs: 15_000 })
    if (res.tooLarge) throw new WorkspaceError('resource_too_large')
    if (!acceptable(kind, res.type)) throw new WorkspaceError('resource_not_image', { content_type: res.type })
    return { status: 200, headers: { 'content-type': res.type, 'x-final-url': 'blob:' }, body: Buffer.from(res.base64, 'base64') }
  }

  function download(tab, url, kind, maxBytes, signal) {
    const actor = tab.owner === 'agent' ? 'agent' : 'user'
    const session = deps.sessionFor(deps.profiles.partitionFor(deps.tabs.profileId()))
    return new Promise((resolve, reject) => {
      let hops = 0
      let request = null
      const fail = (err) => { try { request && request.abort() } catch { /* already finished */ } reject(err) }
      const timer = setTimeout(() => fail(new WorkspaceError('upstream_timeout')), FETCH_TIMEOUT_MS)
      const done = (fn, value) => { clearTimeout(timer); fn(value) }
      if (signal) signal.addEventListener('abort', () => fail(new WorkspaceError('command_cancelled')))

      const start = (target) => {
        request = deps.net.request({ url: target, session, method: 'GET', redirect: 'manual', useSessionCookies: true })
        if (tab.url) request.setHeader('Referer', tab.url)
        request.on('redirect', (_status, _method, redirectUrl) => {
          hops += 1
          const verdict = deps.checkUrl(redirectUrl, actor)
          if (hops > MAX_HOPS || !verdict.ok) { fail(new WorkspaceError(verdict.code || 'navigation_blocked')); return }
          request.followRedirect()
        })
        request.on('error', (err) => done(reject, new WorkspaceError('upstream_error', { message: String(err.message).slice(0, 120) })))
        request.on('response', (response) => {
          const type = String(response.headers['content-type'] || '').split(';')[0].trim()
          if (response.statusCode >= 400) { fail(new WorkspaceError('upstream_error', { status: response.statusCode })); return }
          if (!acceptable(kind, type)) { fail(new WorkspaceError('resource_not_image', { content_type: type })); return }
          const chunks = []
          let size = 0
          response.on('data', (chunk) => {
            size += chunk.length
            if (size > maxBytes) { fail(new WorkspaceError('resource_too_large')); return }
            chunks.push(chunk)
          })
          response.on('end', () => done(resolve, { status: 200, headers: { 'content-type': type, 'x-final-url': target }, body: Buffer.concat(chunks) }))
          response.on('error', () => fail(new WorkspaceError('upstream_error')))
        })
        request.end()
      }
      start(url)
    })
  }

  /**
   * @param {{ tab_id: string, url: string, kind: 'image'|'media', max_bytes?: number }} body
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ status: number, headers: object, body: Buffer }>}
   * @throws {WorkspaceError}
   */
  async function fetchResource(body, signal) {
    const tab = deps.tabs.get(body.tab_id)
    if (!tab) throw new WorkspaceError('browser_session_lost')
    const kind = body.kind === 'media' ? 'media' : 'image'
    const maxBytes = Math.min(Math.max(1, Number(body.max_bytes) || 20 * 1024 * 1024), 50 * 1024 * 1024)
    const url = String(body.url || '')
    if (url.startsWith('data:')) return readDataUrl(url, kind, maxBytes)
    if (url.startsWith('blob:')) return readBlob(tab, url, kind, maxBytes)
    const verdict = deps.checkUrl(url, tab.owner === 'agent' ? 'agent' : 'user')
    if (!verdict.ok) throw new WorkspaceError(verdict.code)
    return download(tab, verdict.url, kind, maxBytes, signal)
  }

  return { fetchResource }
}

module.exports = { createResourceFetcher, acceptable }
