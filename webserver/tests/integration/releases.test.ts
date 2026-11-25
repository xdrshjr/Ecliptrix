import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import * as authService from '@/server/services/authService'
import * as userService from '@/server/services/userService'
import * as releaseService from '@/server/services/releaseService'
import * as settingsService from '@/server/services/settingsService'
import * as auditService from '@/server/services/auditService'
import { uploadRelease } from '@/server/services/releaseUpload'
import { usersRepo } from '../setup/repos'

import { GET as latestRoute } from '@/app/api/v1/releases/latest/route'
import { GET as downloadRoute, HEAD as downloadHead } from '@/app/api/v1/downloads/[channel]/[platform]/route'
import { GET as adminListRoute, POST as adminUploadRoute } from '@/app/api/v1/admin/releases/route'
import { PATCH as adminPatchRoute } from '@/app/api/v1/admin/releases/[id]/route'

/**
 * The client release catalogue, end to end.
 *
 * Every case runs against a real migrated SQLite database and a real artifact
 * directory: the parts worth testing here are exactly the ones a mock would hide —
 * the unique index that stops a duplicate version, the `.part` → `rename`
 * sequence, the pointer row that decides what `/download` serves, and the HTTP
 * Range behaviour a download manager depends on.
 */

const ADMIN = 'http://127.0.0.1:8787'
const OWNER_EMAIL = 'owner@example.com'
const OWNER_PASSWORD = 'owner-password-123'

let harness: TestHarness
let releasesDir: string
let ownerId: string
let ownerToken: string
let memberToken: string
let ipCounter = 1

/** Deterministic bytes, big enough for every range case. */
function payload(size = 4096, seed = 7): Buffer {
  const buffer = Buffer.alloc(size)
  for (let index = 0; index < size; index += 1) buffer[index] = (index + seed) % 251
  return buffer
}

function streamOf(buffer: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from([buffer])) as ReadableStream<Uint8Array>
}

const ACTOR: auditService.AuditContext = {
  actorUserId: null,
  actorLabel: 'vitest',
  ip: '127.0.0.1',
  requestId: 'req-release',
}

async function upload(
  version: string,
  options: { bytes?: Buffer; fileName?: string; platform?: string; arch?: string } = {},
) {
  return uploadRelease(
    {
      version,
      platform: options.platform ?? 'win',
      arch: options.arch ?? 'x64',
      fileName: options.fileName ?? `Ecliptrix-Setup-${version}.exe`,
      notes: `notes for ${version}`,
    },
    streamOf(options.bytes ?? payload()),
    ACTOR,
  )
}

async function signIn(email: string, password: string): Promise<string> {
  ipCounter += 1
  const result = await authService.login({
    identifier: email,
    password,
    client: 'desktop',
    device: { name: 'vitest', platform: 'win32', appVersion: '1.0.1' },
    ip: `10.20.0.${ipCounter}`,
    userAgent: 'vitest',
    requestId: `login-${email}-${ipCounter}`,
  })
  return result.tokens.accessToken
}

function downloadRequest(path: string, token: string | null, headers: Record<string, string> = {}): Request {
  const all: Record<string, string> = { ...headers }
  if (token) all.authorization = `Bearer ${token}`
  return new Request(`${ADMIN}${path}`, { method: 'GET', headers: all })
}

/** Call the download handler the way the router does, params included. */
function getDownload(
  path: string,
  token: string | null,
  headers: Record<string, string> = {},
): Promise<Response> {
  // Parsed as a URL so `?release=<id>` (the "previous builds" link) survives into
  // the request while the params stay clean.
  const url = new URL(`${ADMIN}${path}`)
  const [channel, platform] = url.pathname.split('/').slice(-2) as [string, string]
  return downloadRoute(downloadRequest(path, token, headers), {
    params: Promise.resolve({ channel, platform }),
  })
}

beforeEach(async () => {
  releasesDir = mkdtempSync(join(tmpdir(), 'ws-releases-'))
  harness = await createHarness({ RELEASES_DIR: releasesDir })
  resetAll()
  ipCounter = 1

  const owner = usersRepo.findByEmailOrUsername(getDb(), OWNER_EMAIL, 'owner')
  if (!owner) throw new Error('seed owner missing')
  ownerId = owner.id
  ownerToken = await signIn(OWNER_EMAIL, OWNER_PASSWORD)

  await userService.createUser(
    {
      email: 'member@example.com',
      username: 'member',
      password: 'quiet river stone meadow',
      status: 'active',
      planTag: 'free',
      note: '',
      mustChangePassword: false,
      roleKey: 'member',
    },
    { actorUserId: ownerId, actorLabel: OWNER_EMAIL, ip: '127.0.0.1', requestId: 'req-rbac' },
  )
  memberToken = await signIn('member@example.com', 'quiet river stone meadow')
})

afterEach(() => {
  harness.teardown()
  rmSync(releasesDir, { recursive: true, force: true })
})

describe('upload', () => {
  it('stores a content-addressed file and a draft row', async () => {
    const bytes = payload(2048)
    const release = await upload('1.0.2', { bytes })

    expect(release.status).toBe('draft')
    expect(release.byteSize).toBe(2048)
    expect(release.sha256).toHaveLength(64)

    const row = getDb()
      .prepare('SELECT storage_key, status, byte_size FROM client_releases WHERE id = ?')
      .get(release.id) as { storage_key: string; status: string; byte_size: number }
    // Content-addressed: the extension is kept, the uploaded name is not used.
    expect(row.storage_key).toBe(`1.0.2/win/${release.sha256}.exe`)
    expect(statSync(join(releasesDir, row.storage_key)).size).toBe(2048)
    expect(row.byte_size).toBe(row.byte_size)
  })

  it('rejects a duplicate version without overwriting the shipped file', async () => {
    const first = await upload('1.0.3', { bytes: payload(1024, 1) })
    // Different bytes, same version+platform+arch: must be a conflict, and the
    // original artifact must still be the one on disk.
    await expect(upload('1.0.3', { bytes: payload(2048, 2) })).rejects.toMatchObject({
      code: 'conflict',
    })

    const rows = getDb().prepare('SELECT COUNT(*) AS count FROM client_releases').get() as {
      count: number
    }
    expect(rows.count).toBe(1)
    const row = getDb()
      .prepare('SELECT storage_key FROM client_releases WHERE id = ?')
      .get(first.id) as { storage_key: string }
    expect(statSync(join(releasesDir, row.storage_key)).size).toBe(1024)
    expect(readdirSync(join(releasesDir, '.incoming'))).toEqual([])
  })

  it('refuses an empty body and leaves no row or temporary file behind', async () => {
    await expect(
      uploadRelease(
        { version: '1.0.4', platform: 'win', arch: 'x64', fileName: 'Ecliptrix-Setup.exe' },
        streamOf(Buffer.alloc(0)),
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    const rows = getDb().prepare('SELECT COUNT(*) AS count FROM client_releases').get() as {
      count: number
    }
    expect(rows.count).toBe(0)
    expect(readdirSync(join(releasesDir, '.incoming'))).toEqual([])
  })

  it('verifies a declared checksum and refuses a mismatch', async () => {
    const bytes = payload(512)
    await expect(
      uploadRelease(
        {
          version: '1.0.5',
          platform: 'win',
          arch: 'x64',
          fileName: 'Ecliptrix-Setup-1.0.5.exe',
          declaredSha256: 'f'.repeat(64),
        },
        streamOf(bytes),
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('strips a traversal-shaped file name before it reaches the disk path', async () => {
    const release = await upload('1.0.6', { fileName: '../../Ecliptrix-Setup.exe' })
    // The displayed name is the basename; the storage key never contains the
    // caller's path at all.
    expect(release.fileName).toBe('Ecliptrix-Setup.exe')
    const row = getDb()
      .prepare('SELECT storage_key FROM client_releases WHERE id = ?')
      .get(release.id) as { storage_key: string }
    expect(row.storage_key.startsWith('1.0.6/win/')).toBe(true)
    expect(row.storage_key).not.toContain('..')

    // Defence in depth: a name the platform cannot install is refused outright
    // rather than stored and served.
    await expect(upload('1.0.7', { fileName: '../../config.ts' })).rejects.toMatchObject({
      code: 'validation_failed',
    })
  })
})

describe('publish, rollback and retract', () => {
  it('publishes, then serves the new version from the public endpoint', async () => {
    const release = await upload('1.0.2')
    releaseService.publishRelease(release.id, ACTOR)

    const response = await latestRoute(new Request(`${ADMIN}/api/v1/releases/latest`))
    const body = (await response.json()) as {
      data: { release: { version: string; platforms: { platform: string; downloadPath: string; sha256: string }[] } }
    }
    expect(response.status).toBe(200)
    expect(body.data.release.version).toBe('1.0.2')
    expect(body.data.release.platforms.map((entry) => entry.platform)).toEqual(['win'])
    expect(body.data.release.platforms[0]?.downloadPath).toBe('/api/v1/downloads/stable/win')
  })

  it('rolls the pointer back and keeps the newer build in the history', async () => {
    const older = await upload('1.0.1')
    releaseService.publishRelease(older.id, ACTOR)
    const newer = await upload('1.0.2')
    releaseService.publishRelease(newer.id, ACTOR)

    expect(releaseService.latestPublished()?.version).toBe('1.0.2')

    releaseService.rollbackRelease(older.id, ACTOR)
    expect(releaseService.latestPublished()?.version).toBe('1.0.1')

    // Nothing was deleted: the build we rolled back from is still downloadable and
    // still listed, which is what makes the rollback reversible.
    const history = releaseService.history()
    expect(history.map((row) => row.version).sort()).toEqual(['1.0.1', '1.0.2'])
    expect(history.find((row) => row.version === '1.0.2')?.status).toBe('published')
  })

  it('refuses a rollback to a build that is not published', async () => {
    const older = await upload('1.0.1')
    // Never published: rolling "back" onto a draft would silently publish it, so
    // the operator has to publish it explicitly and let the audit log say so.
    expect(() => releaseService.rollbackRelease(older.id, ACTOR)).toThrowError(
      expect.objectContaining({ code: 'conflict' }),
    )
  })

  it('refuses a rollback that would move the pointer FORWARD', async () => {
    const older = await upload('1.0.1')
    releaseService.publishRelease(older.id, ACTOR)
    const newer = await upload('1.0.2')
    releaseService.publishRelease(newer.id, ACTOR)
    // Point back at 1.0.1 first, so 1.0.2 is now "newer than current".
    releaseService.rollbackRelease(older.id, ACTOR)

    expect(() => releaseService.rollbackRelease(newer.id, ACTOR)).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )
    // …and the pointer did not move.
    expect(releaseService.latestPublished()?.version).toBe('1.0.1')
  })

  it('clears the pointer when the current build is retracted and keeps the file', async () => {
    const release = await upload('1.0.2')
    releaseService.publishRelease(release.id, ACTOR)

    releaseService.retractRelease(release.id, ACTOR)

    expect(releaseService.latestPublished()).toBeNull()
    const row = getDb()
      .prepare('SELECT status, storage_key FROM client_releases WHERE id = ?')
      .get(release.id) as { status: string; storage_key: string }
    expect(row.status).toBe('retracted')
    expect(statSync(join(releasesDir, row.storage_key)).isFile()).toBe(true)

    // The retracted build is still listed for users who already installed it.
    expect(releaseService.history().map((entry) => entry.status)).toEqual(['retracted'])
  })

  it('writes an audit row with the before/after pointer for a publish', async () => {
    const first = await upload('1.0.1')
    releaseService.publishRelease(first.id, ACTOR)
    const second = await upload('1.0.2')
    releaseService.publishRelease(second.id, ACTOR)

    const rows = getDb()
      .prepare("SELECT metadata FROM audit_events WHERE action = 'releases.publish' ORDER BY created_at")
      .all() as { metadata: string }[]
    expect(rows).toHaveLength(2)
    const last = JSON.parse(rows[1]?.metadata ?? '{}') as {
      beforeReleaseId: string | null
      afterReleaseId: string
    }
    expect(last.beforeReleaseId).toBe(first.id)
    expect(last.afterReleaseId).toBe(second.id)
  })

  it('lets a rolled-back-to build be published again, which is what makes the rollback reversible', async () => {
    // The console offers exactly this action for a published, non-current, newer
    // build. It used to be unreachable: the row only got a "roll back" button,
    // which the service refuses for a forward move — so "publish 1.0.3, roll back
    // to 1.0.2" stranded 1.0.3 until someone used the CLI.
    const older = await upload('1.0.1')
    releaseService.publishRelease(older.id, ACTOR)
    const newer = await upload('1.0.2')
    releaseService.publishRelease(newer.id, ACTOR)
    releaseService.rollbackRelease(older.id, ACTOR)

    expect(releaseService.latestPublished()?.version).toBe('1.0.1')
    releaseService.publishRelease(newer.id, ACTOR)
    expect(releaseService.latestPublished()?.version).toBe('1.0.2')
  })
})

describe('client.minVersion guard (C10)', () => {
  it('refuses a non-empty gate while nothing is published', () => {
    expect(() => settingsService.patch({ 'client.minVersion': '1.0.0' }, ownerId)).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )
  })

  it('measures the gate against what the STABLE channel serves, not against every published row', async () => {
    // A beta-only build is not downloadable from `/download`, so arming the gate at
    // it would lock the fleet out with nothing to install — the original defect,
    // reintroduced through the permission check meant to prevent it.
    const beta = await upload('1.0.2')
    releaseService.publishRelease(beta.id, ACTOR, 'beta')

    expect(releaseService.latestPublishedVersion()).toBeNull()
    expect(releaseService.latestPublishedVersion('beta')).toBe('1.0.2')
    expect(() => settingsService.patch({ 'client.minVersion': '1.0.2' }, ownerId)).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )

    // Promoting it to stable makes the same value acceptable.
    releaseService.publishRelease(beta.id, ACTOR, 'stable')
    expect(
      settingsService.patch({ 'client.minVersion': '1.0.2' }, ownerId).changed,
    ).toHaveProperty('client.minVersion')
  })

  it('does not validate an UNCHANGED gate, so an unrelated settings save still works', async () => {
    // The console posts the whole settings object. A deployment that armed the gate
    // before this feature existed has a value that fails the new rule; re-validating
    // it would make every unrelated edit ("change the login attempt limit") fail,
    // which is a lockout invented by the fix for a lockout.
    getDb()
      .prepare("UPDATE app_settings SET value = ? WHERE key = 'client.minVersion'")
      .run(JSON.stringify('9.9.9'))

    const result = settingsService.patch(
      { 'client.minVersion': '9.9.9', 'security.loginMaxAttempts': 7 },
      ownerId,
    )
    expect(result.changed).toHaveProperty('security.loginMaxAttempts')
    expect(result.changed).not.toHaveProperty('client.minVersion')

    // Changing it is still refused.
    expect(() => settingsService.patch({ 'client.minVersion': '9.9.10' }, ownerId)).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )
  })

  it('refuses a gate above the newest published build', async () => {
    const release = await upload('1.0.2')
    releaseService.publishRelease(release.id, ACTOR)

    expect(() => settingsService.patch({ 'client.minVersion': '1.0.3' }, ownerId)).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )
    // Equal or lower is allowed, and so is clearing it.
    expect(settingsService.patch({ 'client.minVersion': '1.0.2' }, ownerId).changed).toHaveProperty(
      'client.minVersion',
    )
    expect(settingsService.patch({ 'client.minVersion': '' }, ownerId).changed).toHaveProperty(
      'client.minVersion',
    )
  })

  it('adds the download page to the 426 body', async () => {
    const release = await upload('1.0.2')
    releaseService.publishRelease(release.id, ACTOR)
    // `settingsService.patch` now refuses 9.9.9 (> the newest published build), so
    // the row is written directly: that reproduces a deployment which armed the
    // gate before this build existed, i.e. exactly the population that used to be
    // locked onto a 404. It must still receive a usable address.
    getDb()
      .prepare("UPDATE app_settings SET value = ? WHERE key = 'client.minVersion'")
      .run(JSON.stringify('9.9.9'))

    await expect(
      authService.login({
        identifier: 'member@example.com',
        password: 'quiet river stone meadow',
        client: 'desktop',
        clientVersion: '1.0.1',
        device: { name: 'old', platform: 'win32', appVersion: '1.0.1', deviceKey: 'olddevicekey1' },
        ip: '10.30.0.1',
        userAgent: 'vitest',
        requestId: 'req-426',
      }),
    ).rejects.toMatchObject({
      code: 'client_outdated',
      status: 426,
      details: { minVersion: '9.9.9', downloadUrl: `${harness.config.publicBaseUrl}/download` },
    })
  })

  it('exempts browser clients from the gate', async () => {
    getDb()
      .prepare("UPDATE app_settings SET value = ? WHERE key = 'client.minVersion'")
      .run(JSON.stringify('99.0.0'))

    await expect(
      authService.login({
        identifier: 'member@example.com',
        password: 'quiet river stone meadow',
        client: 'web',
        device: { name: '', platform: '', appVersion: '' },
        ip: '10.30.0.2',
        userAgent: 'vitest',
        requestId: 'req-web',
      }),
    ).resolves.toBeTruthy()
  })
})

describe('download endpoint', () => {
  async function publishedRelease(bytes = payload()) {
    const release = await upload('1.0.2', { bytes })
    releaseService.publishRelease(release.id, ACTOR)
    return release
  }

  it('answers 401 without a session', async () => {
    await publishedRelease()
    const response = await getDownload('/api/v1/downloads/stable/win', null)
    expect(response.status).toBe(401)
  })

  it('serves the whole file with the checksum as its ETag', async () => {
    const release = await publishedRelease()
    const response = await getDownload('/api/v1/downloads/stable/win', memberToken)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('4096')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('etag')).toBe(`"${release.sha256}"`)
    expect(response.headers.get('content-disposition')).toContain('attachment')
    // An authenticated artifact must never be stored by a shared cache.
    expect(response.headers.get('cache-control')).toContain('private')
    expect(Buffer.from(await response.arrayBuffer()).length).toBe(4096)
  })

  it('serves a prefix range as 206 with the slice length', async () => {
    await publishedRelease()
    const response = await getDownload('/api/v1/downloads/stable/win', memberToken, {
      range: 'bytes=0-1023',
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-1023/4096')
    expect(response.headers.get('content-length')).toBe('1024')
  })

  it('serves a suffix range', async () => {
    await publishedRelease()
    const response = await getDownload('/api/v1/downloads/stable/win', memberToken, {
      range: 'bytes=-500',
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 3596-4095/4096')
    expect(response.headers.get('content-length')).toBe('500')
  })

  it('serves an open-ended range to the last byte', async () => {
    await publishedRelease()
    const response = await getDownload('/api/v1/downloads/stable/win', memberToken, {
      range: 'bytes=4000-',
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 4000-4095/4096')
  })

  it('answers 416 with the star Content-Range when the range is beyond the file', async () => {
    await publishedRelease()
    const response = await getDownload('/api/v1/downloads/stable/win', memberToken, {
      range: 'bytes=99999-',
    })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */4096')
  })

  it('answers 304 when the ETag matches', async () => {
    const release = await publishedRelease()
    const response = await getDownload('/api/v1/downloads/stable/win', memberToken, {
      'if-none-match': `"${release.sha256}"`,
    })
    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
  })

  it('answers HEAD with the same headers and no body', async () => {
    await publishedRelease()
    const [channel, platform] = ['stable', 'win'] as const
    const response = await downloadHead(
      new Request(`${ADMIN}/api/v1/downloads/${channel}/${platform}`, {
        method: 'HEAD',
        headers: { authorization: `Bearer ${memberToken}` },
      }),
      { params: Promise.resolve({ channel, platform }) },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('4096')
    expect(await response.text()).toBe('')
  })

  it('counts a download and answers 404 when nothing is published', async () => {
    const empty = await getDownload('/api/v1/downloads/stable/win', memberToken)
    expect(empty.status).toBe(404)

    const release = await publishedRelease()
    await getDownload('/api/v1/downloads/stable/win', memberToken)
    const row = getDb()
      .prepare('SELECT downloads FROM client_releases WHERE id = ?')
      .get(release.id) as { downloads: number }
    expect(row.downloads).toBe(1)
  })

  it('answers 404 for an unknown channel', async () => {
    await publishedRelease()
    const response = await getDownload('/api/v1/downloads/nightly/win', memberToken)
    expect(response.status).toBe(404)
  })

  it('serves a previous build through ?release=, so the history list is not a dead promise', async () => {
    const older = await upload('1.0.1', { bytes: payload(2048, 3) })
    releaseService.publishRelease(older.id, ACTOR)
    const newer = await upload('1.0.2', { bytes: payload(1024, 11) })
    releaseService.publishRelease(newer.id, ACTOR)

    // The pointer serves the newer build…
    const current = await getDownload('/api/v1/downloads/stable/win', memberToken)
    expect(current.headers.get('etag')).toBe(`"${newer.sha256}"`)

    // …and the named one serves the older build, with its own checksum.
    const pinned = await getDownload(
      `/api/v1/downloads/stable/win?release=${older.id}`,
      memberToken,
    )
    expect(pinned.status).toBe(200)
    expect(pinned.headers.get('etag')).toBe(`"${older.sha256}"`)
    expect(Buffer.from(await pinned.arrayBuffer()).length).toBe(2048)
  })

  it('refuses ?release= for a build that is a draft, retracted, or another platform', async () => {
    const published = await upload('1.0.1')
    releaseService.publishRelease(published.id, ACTOR)
    const draft = await upload('1.0.2')
    const retracted = await upload('1.0.3')
    releaseService.publishRelease(retracted.id, ACTOR)
    releaseService.retractRelease(retracted.id, ACTOR)

    for (const id of [draft.id, retracted.id, 'does-not-exist']) {
      const response = await getDownload(`/api/v1/downloads/stable/win?release=${id}`, memberToken)
      expect(response.status, `release ${id}`).toBe(404)
    }
  })
})

describe('console endpoints', () => {
  it('refuses a member and allows an owner', async () => {
    const denied = await adminListRoute(
      new Request(`${ADMIN}/api/v1/admin/releases`, {
        headers: { authorization: `Bearer ${memberToken}` },
      }),
    )
    expect(denied.status).toBe(403)

    const allowed = await adminListRoute(
      new Request(`${ADMIN}/api/v1/admin/releases`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    )
    expect(allowed.status).toBe(200)
    const body = (await allowed.json()) as {
      data: { platforms: { id: string }[]; channels: string[]; counts: { draft: number } }
    }
    expect(body.data.platforms.map((entry) => entry.id)).toEqual(['win'])
    expect(body.data.channels).toContain('stable')
  })

  it('streams an upload through the route and refuses a member', async () => {
    const bytes = payload(1024)
    const query = 'version=1.0.9&platform=win&arch=x64&fileName=Ecliptrix-Setup-1.0.9.exe'

    const denied = await adminUploadRoute(
      new Request(`${ADMIN}/api/v1/admin/releases?${query}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/octet-stream' },
        // A `Buffer` is not part of `BodyInit` in this lib target; the handler reads
        // `request.body` as a stream either way.
        body: new Uint8Array(bytes),
      }),
    )
    expect(denied.status).toBe(403)

    const created = await adminUploadRoute(
      new Request(`${ADMIN}/api/v1/admin/releases?${query}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(bytes),
      }),
    )
    expect(created.status).toBe(201)
    const body = (await created.json()) as { data: { release: { id: string; status: string } } }
    expect(body.data.release.status).toBe('draft')

    const patched = await adminPatchRoute(
      new Request(`${ADMIN}/api/v1/admin/releases/${body.data.release.id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      }),
      { params: Promise.resolve({ id: body.data.release.id }) },
    )
    expect(patched.status).toBe(200)
    expect(releaseService.latestPublished()?.version).toBe('1.0.9')
  })
})
