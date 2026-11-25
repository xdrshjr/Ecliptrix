'use strict'

// profiles.js — browser "users" (spec §4.2.2, §7). One Electron partition per profile
// (`persist:wb-<id>`), metadata in userData/browser-workspace/profiles.json.
//
// Why Agent consent lives here (R1-4): the backend settings store has no auth, so a
// shell-capable agent could PUT any flag there. The main process owns the file and
// is the only thing that can write `agentConsentAt`.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_PROFILES = 5
const MAX_NAME = 24
const DEFAULT_ID = 'default'
const PALETTE = ['#3ECF8E', '#D97757', '#6C8EEF', '#E5B567', '#B07CC6', '#4DB6AC', '#E57373', '#90A4AE']
const ID_PATTERN = /^(?:default|[0-9a-f]{8})$/

/** @param {string} id @returns {string} Electron partition name. */
function partitionFor(id) {
  return `persist:wb-${id}`
}

/**
 * @param {string} raw
 * @returns {string|null} Normalised name or null when invalid.
 */
function normalizeName(raw) {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const length = [...name].length
  return length >= 1 && length <= MAX_NAME ? name : null
}

/**
 * Atomic JSON write (tmp + rename) so a crash never leaves half a file.
 * @param {string} file
 * @param {object} value
 */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * @param {object} deps
 * @param {string} deps.dir userData/browser-workspace
 * @param {() => number} [deps.now]
 * @param {() => string} [deps.randomHex] 8 lowercase hex chars.
 * @param {(partition: string) => Promise<void>} [deps.clearSession] Wipes cookies/storage/cache.
 * @param {() => void} [deps.onChange]
 */
function createProfiles(deps) {
  const now = deps.now || Date.now
  const randomHex = deps.randomHex || (() => crypto.randomBytes(4).toString('hex'))
  const file = path.join(deps.dir, 'profiles.json')
  let data = load()

  function fresh() {
    const t = now()
    return {
      v: 1, activeProfileId: DEFAULT_ID,
      profiles: [{ id: DEFAULT_ID, name: '默认', color: PALETTE[0], createdAt: t, lastUsedAt: t, agentConsentAt: null }],
    }
  }

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const profiles = (parsed.profiles || []).filter((p) => p && ID_PATTERN.test(p.id) && normalizeName(p.name))
        .slice(0, MAX_PROFILES)
        .map((p) => ({ ...p, agentConsentAt: Number.isFinite(p.agentConsentAt) ? p.agentConsentAt : null }))
      if (!profiles.some((p) => p.id === DEFAULT_ID)) return fresh()
      const active = profiles.some((p) => p.id === parsed.activeProfileId) ? parsed.activeProfileId : DEFAULT_ID
      return { v: 1, activeProfileId: active, profiles }
    } catch {
      return fresh()
    }
  }

  function save() {
    writeJsonAtomic(file, data)
    if (deps.onChange) deps.onChange()
  }

  const find = (id) => data.profiles.find((p) => p.id === id)
  const fail = (code) => ({ ok: false, code })

  return {
    partitionFor,
    list: () => data.profiles.map((p) => ({ ...p })),
    get: (id) => (find(id) ? { ...find(id) } : null),
    activeId: () => data.activeProfileId,
    active: () => ({ ...find(data.activeProfileId) }),

    create(rawName) {
      const name = normalizeName(rawName)
      if (!name) return fail('invalid_name')
      if (data.profiles.length >= MAX_PROFILES) return fail('profile_limit')
      if (data.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) return fail('duplicate_name')
      let id = randomHex()
      while (find(id)) id = randomHex()
      const t = now()
      data.profiles.push({
        id, name, color: PALETTE[data.profiles.length % PALETTE.length], createdAt: t, lastUsedAt: t, agentConsentAt: null,
      })
      save()
      return { ok: true, id }
    },

    rename(id, rawName) {
      const profile = find(id)
      const name = normalizeName(rawName)
      if (!profile) return fail('not_found')
      if (!name) return fail('invalid_name')
      if (data.profiles.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
        return fail('duplicate_name')
      }
      profile.name = name
      save()
      return { ok: true }
    },

    switchTo(id) {
      const profile = find(id)
      if (!profile) return fail('not_found')
      data.activeProfileId = id
      profile.lastUsedAt = now()
      save()
      return { ok: true }
    },

    /** Agent consent for ONE profile (spec §4.2.2). */
    setConsent(id) {
      const profile = find(id)
      if (!profile) return fail('not_found')
      profile.agentConsentAt = now()
      save()
      return { ok: true }
    },

    revokeConsent(id) {
      const profile = find(id)
      if (!profile) return fail('not_found')
      profile.agentConsentAt = null
      save()
      return { ok: true }
    },

    /** Wipe browsing data and drop consent (the profile itself stays). */
    async clearData(id) {
      const profile = find(id)
      if (!profile) return fail('not_found')
      if (deps.clearSession) await deps.clearSession(partitionFor(id))
      profile.agentConsentAt = null
      save()
      return { ok: true }
    },

    async remove(id) {
      const profile = find(id)
      if (!profile) return fail('not_found')
      if (id === DEFAULT_ID) return fail('cannot_remove_default')
      if (deps.clearSession) await deps.clearSession(partitionFor(id))
      data.profiles = data.profiles.filter((p) => p.id !== id)
      if (data.activeProfileId === id) data.activeProfileId = DEFAULT_ID
      save()
      return { ok: true }
    },
  }
}

module.exports = { createProfiles, partitionFor, normalizeName, writeJsonAtomic, MAX_PROFILES, DEFAULT_ID }
