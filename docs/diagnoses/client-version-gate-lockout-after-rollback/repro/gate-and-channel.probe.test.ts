/**
 * TEMPORARY probe — not part of the suite. Proves the three suspected defects in
 * the client release catalogue. It asserts the CURRENT (broken) behaviour so a
 * green run is the evidence; it is deleted after the evidence is captured.
 *
 *   cd webserver && npx vitest run tests/integration/zz-probe-client-release-gaps.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs'
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
import {
  GET as downloadRoute,
  HEAD as downloadHeadRoute,
} from '@/app/api/v1/downloads/[channel]/[platform]/route'

const ADMIN = 'http://127.0.0.1:8787'
const OWNER_EMAIL = 'owner@example.com'
const OWNER_PASSWORD = 'owner-password-123'

let harness: TestHarness
let releasesDir: string
let ownerId: string
let ownerToken: string
let memberToken: string
let ipCounter = 1

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
  actorLabel: 'probe',
  ip: '127.0.0.1',
  requestId: 'req-probe',
}

async function upload(version: string, bytes = payload()) {
  return uploadRelease(
    {
      version,
      platform: 'win',
      arch: 'x64',
      fileName: `Ecliptrix-Setup-${version}.exe`,
      notes: `notes for ${version}`,
    },
    streamOf(bytes),
    ACTOR,
  )
}

async function signIn(email: string, password: string, clientVersion = '1.0.1'): Promise<string> {
  ipCounter += 1
  const result = await authService.login({
    identifier: email,
    password,
    client: 'desktop',
    device: { name: 'probe', platform: 'win32', appVersion: clientVersion },
    ip: `10.30.0.${ipCounter}`,
    userAgent: 'probe',
    requestId: `login-${email}-${ipCounter}`,
    clientVersion,
  })
  return result.tokens.accessToken
}

function getDownload(path: string, token: string | null, headers: Record<string, string> = {}) {
  const url = new URL(`${ADMIN}${path}`)
  const [channel, platform] = url.pathname.split('/').slice(-2) as [string, string]
  const all: Record<string, string> = { ...headers }
  if (token) all.authorization = `Bearer ${token}`
  return downloadRoute(new Request(url.toString(), { method: 'GET', headers: all }), {
    params: Promise.resolve({ channel, platform }),
  })
}

beforeEach(async () => {
  releasesDir = mkdtempSync(join(tmpdir(), 'probe-releases-'))
  harness = await createHarness({ RELEASES_DIR: releasesDir })
  resetAll()
  ipCounter = 1
  const owner = usersRepo.findByEmailOrUsername(getDb(), OWNER_EMAIL, 'owner')
  if (!owner) throw new Error('seed owner missing')
  ownerId = owner.id
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
  memberToken = await signIn('member@example.com', 'quiet river stone meadow', '1.0.1')
})

afterEach(() => {
  harness.teardown()
  rmSync(releasesDir, { recursive: true, force: true })
})

describe('probe 1: gate armed above the version the channel actually serves', () => {
  it('bricks the fleet after a rollback or a retract, and the download page cannot release it', async () => {
    const older = await upload('1.0.2')
    releaseService.publishRelease(older.id, ACTOR)
    settingsService.patch({ 'client.minVersion': '1.0.2' }, ownerId)

    const newer = await upload('1.0.3')
    releaseService.publishRelease(newer.id, ACTOR)
    // The operator arms the gate at the new build. C10 allows it: 1.0.3 IS served.
    settingsService.patch({ 'client.minVersion': '1.0.3' }, ownerId)

    // Emergency: 1.0.3 turns out to be broken, so the operator rolls back — the
    // documented remedy. Nothing clamps the stored gate.
    releaseService.rollbackRelease(older.id, ACTOR)

    const served = releaseService.latestPublishedVersion()
    const gate = settingsService.getString('client.minVersion').trim()
    console.log(`[probe1] served=${served} gate=${gate}`)

    // The fleet is now refused BEFORE the password is checked …
    await expect(
      authService.login({
        identifier: 'member@example.com',
        password: 'quiet river stone meadow',
        client: 'desktop',
        device: { name: 'probe', platform: 'win32', appVersion: '1.0.2' },
        ip: '10.30.9.9',
        userAgent: 'probe',
        requestId: 'probe1-login',
        clientVersion: '1.0.2',
      }),
    ).rejects.toMatchObject({ code: 'client_outdated' })

    // … while the only build the 426 body can send them to is 1.0.2, which is the
    // build they already have. Reinstalling it cannot clear the gate.
    const latest = await latestRoute(new Request(`${ADMIN}/api/v1/releases/latest`))
    const body = (await latest.json()) as { data: { release: { version: string }; downloadUrl: string } }
    console.log(`[probe1] download page offers=${body.data.release.version} url=${body.data.downloadUrl}`)
    expect(body.data.release.version).toBe('1.0.2')
    expect(served).toBe('1.0.2')
    expect(gate).toBe('1.0.3')
  })

  it('does the same when the bad build is retracted instead of rolled back', async () => {
    const older = await upload('1.0.2')
    releaseService.publishRelease(older.id, ACTOR)
    const newer = await upload('1.0.3')
    releaseService.publishRelease(newer.id, ACTOR)
    settingsService.patch({ 'client.minVersion': '1.0.3' }, ownerId)

    releaseService.retractRelease(newer.id, ACTOR)

    // 1.0.2 is republished by hand (the operator is thorough) …
    releaseService.publishRelease(older.id, ACTOR)
    // … and the gate still demands the withdrawn build.
    const gate = settingsService.getString('client.minVersion').trim()
    console.log(`[probe2] retract+republish: served=${releaseService.latestPublishedVersion()} gate=${gate}`)
    expect(releaseService.latestPublishedVersion()).toBe('1.0.2')
    expect(gate).toBe('1.0.3')
    await expect(
      authService.login({
        identifier: 'member@example.com',
        password: 'quiet river stone meadow',
        client: 'desktop',
        device: { name: 'probe', platform: 'win32', appVersion: '1.0.2' },
        ip: '10.30.9.8',
        userAgent: 'probe',
        requestId: 'probe2-login',
        clientVersion: '1.0.2',
      }),
    ).rejects.toMatchObject({ code: 'client_outdated' })
  })
})

describe('probe 3: beta-only builds are visible and downloadable on the public page', () => {
  it('lists a beta-only build in the public history and serves its bytes through the stable URL', async () => {
    const stable = await upload('1.0.2', payload(2048, 3))
    releaseService.publishRelease(stable.id, ACTOR)
    const beta = await upload('2.0.0', payload(1024, 9))
    releaseService.publishRelease(beta.id, ACTOR, 'beta')

    // The public "current" answer is correctly the stable build …
    expect(releaseService.latestPublished('stable')?.version).toBe('1.0.2')
    // … but the public history contains the beta build …
    const history = releaseService.history(20)
    console.log(`[probe3] public history versions=${history.map((row) => row.version).join(',')}`)
    expect(history.map((row) => row.version)).toContain('2.0.0')

    // … and its bytes are served from the STABLE url, because `?release=` never
    // checks the channel the named build was published on.
    const response = await getDownload(
      `/api/v1/downloads/stable/win?release=${encodeURIComponent(beta.id)}`,
      memberToken,
    )
    console.log(`[probe3] GET /api/v1/downloads/stable/win?release=<beta 2.0.0> → ${response.status}`)
    expect(response.status).toBe(200)
    expect((await response.arrayBuffer()).byteLength).toBe(1024)
  })
})

describe('probe 4: the download counter counts requests, not downloads', () => {
  it('counts a resumed download as three downloads', async () => {
    const release = await upload('1.0.2')
    releaseService.publishRelease(release.id, ACTOR)
    const read = (row: string) => (getDb().prepare(row).get(release.id) as { downloads: number }).downloads

    const full = await getDownload('/api/v1/downloads/stable/win', memberToken)
    await full.arrayBuffer()
    const afterFull = read('SELECT downloads FROM client_releases WHERE id = ?')

    // A browser or a download manager that resumes issues more requests for the
    // same transfer; each one increments.
    await getDownload('/api/v1/downloads/stable/win', memberToken, { range: 'bytes=0-1023' })
    await getDownload('/api/v1/downloads/stable/win', memberToken, { range: 'bytes=1024-' })
    const afterResume = read('SELECT downloads FROM client_releases WHERE id = ?')

    console.log(`[probe4] after one 200: ${afterFull}, after the same transfer resumed twice: ${afterResume}`)
    expect(afterFull).toBe(1)
    expect(afterResume).toBe(3)
  })

  it('does not count a HEAD probe, so the number is not even "requests"', async () => {
    const release = await upload('1.0.2')
    releaseService.publishRelease(release.id, ACTOR)
    const head = await downloadHeadRoute(
      new Request(`${ADMIN}/api/v1/downloads/stable/win`, {
        method: 'HEAD',
        headers: { authorization: `Bearer ${memberToken}` },
      }),
      { params: Promise.resolve({ channel: 'stable', platform: 'win' }) },
    )
    const downloads = (
      getDb().prepare('SELECT downloads FROM client_releases WHERE id = ?').get(release.id) as {
        downloads: number
      }
    ).downloads
    console.log(`[probe4b] HEAD → ${head.status}, downloads=${downloads}`)
    expect(downloads).toBe(0)
  })
})

describe('probe 5: retracting the current build empties the page while an older build is publishable', () => {
  it('leaves the channel with no pointer even though an older published build exists', async () => {
    const older = await upload('1.0.2')
    releaseService.publishRelease(older.id, ACTOR)
    const newer = await upload('1.0.3')
    releaseService.publishRelease(newer.id, ACTOR)

    releaseService.retractRelease(newer.id, ACTOR)

    const current = releaseService.latestPublished('stable')
    const latest = await latestRoute(new Request(`${ADMIN}/api/v1/releases/latest`))
    const body = (await latest.json()) as { data: { release: unknown } }
    console.log(`[probe5] latestPublished=${current === null ? 'null' : current.version} apiRelease=${String(body.data.release)}`)
    expect(current).toBeNull()
    expect(body.data.release).toBeNull()
    // The withdrawn build was the newest; 1.0.2 is still published and servable,
    // but the page reports "no release has been published yet".
    expect(releaseService.history().filter((row) => row.status === 'published').map((row) => row.version)).toEqual([
      '1.0.2',
    ])
  })
})
