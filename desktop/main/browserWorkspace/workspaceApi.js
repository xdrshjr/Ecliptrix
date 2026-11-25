'use strict'

// workspaceApi.js — the user-side operations behind the `browser:*` IPC channels
// (spec §6.1). Kept apart from index.js so the facade stays an assembly file. Every
// method returns `{ ok:true, … }` or `{ ok:false, code }` — never throws for expected
// failures. Profile switching is refused while the Agent drives (`profile_busy`).

const { buildCookieUrl } = require('./cookiePersister')

const MAX_LOGIN_SITES = 50

/** @param {string} domain @returns {string} */
const hostOfCookie = (domain) => String(domain || '').replace(/^\./, '').toLowerCase()

/**
 * @param {object} d tabs, profiles, control, approvals, viewHost, stateStore, getSession(partition),
 *   checkUrl, consentOnce (Set), onProfileChanged(), sendToRenderer(channel, payload)
 */
function createWorkspaceApi(d) {
  const { tabs, profiles, control, approvals, viewHost } = d
  const fail = (code) => ({ ok: false, code })
  const busy = () => control.holder() === 'agent' || control.inflight() > 0

  async function cookiesOf(profileId) {
    return d.getSession(profiles.partitionFor(profileId)).cookies.get({})
  }

  async function countLoginSites(profileId) {
    return new Set((await cookiesOf(profileId)).map((c) => hostOfCookie(c.domain))).size
  }

  async function switchProfile(id) {
    if (!profiles.get(id)) return fail('not_found')
    if (id === profiles.activeId()) return { ok: true }
    if (busy()) return fail('profile_busy')
    approvals.cancelAll()
    profiles.switchTo(id)
    tabs.mountProfile(id)
    d.onProfileChanged()
    return { ok: true }
  }

  return {
    countLoginSites,

    openTab({ url, background } = {}) {
      let target = ''
      if (url) {
        const verdict = d.checkUrl(url, 'user')
        if (!verdict.ok) return fail(verdict.code)
        target = verdict.url
      }
      const res = tabs.open({ url: target, owner: 'user', activate: !background })
      return res.ok ? { ok: true, tabId: res.tab.id } : fail(res.code)
    },
    closeTab: (id) => (tabs.close(id) ? { ok: true } : fail('not_found')),
    activateTab: (id) => (tabs.setActive(id) ? { ok: true } : fail('not_found')),
    reorderTabs: (ids) => { tabs.reorder(ids); return { ok: true } },
    navigate(id, input) {
      const tab = tabs.get(id)
      if (!tab) return fail('not_found')
      return tabs.navigate(tab, input, 'user')
    },
    back: (id) => history(id, 'goBack'),
    forward: (id) => history(id, 'goForward'),
    reload(id) {
      const tab = tabs.get(id)
      if (!tab || !tab.wc || tab.wc.isDestroyed()) return fail('not_found')
      tab.crashed = false
      tab.wc.reload()
      return { ok: true }
    },
    stop(id) {
      const tab = tabs.get(id)
      if (tab && tab.wc && !tab.wc.isDestroyed()) tab.wc.stop()
      return { ok: true }
    },

    /** `null` = Dock closed / animating: view hidden. A rect = Dock open at that CSS-px box. */
    setBounds(rect) { viewHost.setDock({ rect, visible: rect !== null }); return { ok: true } },
    /** Renderer froze a still frame because a DOM overlay covers the viewport. */
    setVisible(visible) { viewHost.setOccluded(!visible); return { ok: true } },
    async captureFrozen() {
      const dataUrl = await viewHost.captureFrozen().catch(() => null)
      return dataUrl ? { ok: true, dataUrl } : fail('capture_failed')
    },

    profilesList: async () => ({ ok: true, profiles: d.stateStore.getState().profiles }),
    profileCreate: (name) => profiles.create(name),
    profileRename: (id, name) => profiles.rename(id, name),
    profileSwitch: switchProfile,
    async profileClear(id) {
      if (id === profiles.activeId() && busy()) return fail('profile_busy')
      const res = await profiles.clearData(id)
      d.onProfileChanged()
      return res
    },
    async profileRemove(id) {
      if (id === profiles.activeId()) {
        const moved = await switchProfile('default')
        if (!moved.ok) return moved
      }
      const res = await profiles.remove(id)
      d.consentOnce.forEach((key) => { if (key.endsWith(`|${id}`)) d.consentOnce.delete(key) })
      d.onProfileChanged()
      return res
    },

    async loginSites() {
      const counts = new Map()
      for (const cookie of await cookiesOf(profiles.activeId())) {
        const host = hostOfCookie(cookie.domain)
        counts.set(host, (counts.get(host) || 0) + 1)
      }
      const sites = [...counts].map(([host, cookies]) => ({ host, cookies })).sort((a, b) => b.cookies - a.cookies).slice(0, MAX_LOGIN_SITES)
      return { ok: true, sites }
    },
    async removeSite(host) {
      const target = hostOfCookie(host)
      const ses = d.getSession(profiles.partitionFor(profiles.activeId()))
      for (const cookie of await ses.cookies.get({})) {
        const h = hostOfCookie(cookie.domain)
        if (h === target || h.endsWith(`.${target}`)) await ses.cookies.remove(buildCookieUrl(cookie), cookie.name).catch(() => {})
      }
      d.onProfileChanged()
      return { ok: true }
    },

    takeOver() { control.takeOver(); return { ok: true } },
    returnControl() { control.returnControl(); return { ok: true } },
    resolveApproval(id, decision) {
      const res = approvals.resolve(id, decision)
      return res.ok ? { ok: true } : fail(res.code)
    },
    shareUrl(id) {
      const tab = tabs.get(id)
      return tab && /^https?:/i.test(tab.url) ? { ok: true, url: tab.url } : fail('no_url')
    },
    revokeConsent(profileId) {
      const res = profiles.revokeConsent(profileId)
      d.consentOnce.forEach((key) => { if (key.endsWith(`|${profileId}`)) d.consentOnce.delete(key) })
      return res
    },
  }

  function history(id, method) {
    const tab = tabs.get(id)
    if (!tab || !tab.wc || tab.wc.isDestroyed()) return fail('not_found')
    const nav = tab.wc.navigationHistory
    if (method === 'goBack' ? nav.canGoBack() : nav.canGoForward()) nav[method]()
    return { ok: true }
  }
}

module.exports = { createWorkspaceApi, hostOfCookie, MAX_LOGIN_SITES }
