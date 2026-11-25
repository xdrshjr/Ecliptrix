import Link from 'next/link'
import type { Metadata } from 'next'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { absoluteTime } from '@/lib/format'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import * as releaseService from '@/server/services/releaseService'
import { DEFAULT_RELEASE_CHANNEL, formatBytes, platformLabel, releaseDownloadPath } from '@/lib/releases'
import { CopyChecksum } from '@/components/marketing/copy-checksum'
import { DownloadPlatformButton } from '@/components/marketing/download-platform-button'

/**
 * `/download` — the page the desktop app's "update required" screen opens.
 *
 * This route did not exist until now, which is what turned a version gate into a
 * dead end: the shipped clients open `{origin}/download` and got a 404 (analysis
 * D1). Two invariants follow from that history:
 *
 *  1. **It must never 404 and never 500.** With nothing published it renders an
 *     empty state, and a signed-out visitor gets a sign-in panel rather than a
 *     redirect — the 426 path proves a browser session can always be obtained,
 *     so "sign in here" is a real remedy, while a redirect would loop back.
 *  2. **It renders live data.** `dynamic = 'force-dynamic'` is not tuning: the
 *     landing shell is otherwise statically prerendered at build time, so a
 *     publish or rollback would silently show yesterday's version until the next
 *     deploy (analysis R-7).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '下载桌面端 — Ecliptrix',
  description: '下载 Ecliptrix 桌面端安装包，查看版本、大小与 SHA-256 校验和。',
}

const PRIMARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-sm bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110'

export default async function DownloadPage() {
  const locale = await resolveLocale()
  const tt = translator(locale)
  const session = await currentSession()
  const latest = releaseService.latestPublished()
  const history = releaseService.history(20)
  const canPublish = session ? can(session, 'releases.write') : false
  const loginHref = '/login?next=%2Fdownload'
  const channel = latest?.channel ?? DEFAULT_RELEASE_CHANNEL
  // History covers every platform and every channel's past; the per-row download
  // link is only offered for a build that is still published AND is of a platform
  // this page can address.
  const downloadBase = (platform: string, releaseId: string) =>
    `${releaseDownloadPath(channel, platform)}?release=${encodeURIComponent(releaseId)}`

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">{tt('download.title')}</h1>
        <p className="mt-3 max-w-prose text-sm leading-6 text-[var(--muted)]">
          {tt('download.subtitle')}
        </p>
      </header>

      {!session ? (
        <div className="mt-8 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-4">
          <p className="text-sm text-[var(--foreground)]">{tt('download.loginRequired')}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{tt('download.loginHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={loginHref} className={PRIMARY_LINK}>
              {tt('nav.signIn')}
            </Link>
            <Link
              href="/register"
              className="inline-flex h-10 items-center rounded-sm border border-[var(--border-strong)] px-5 text-sm transition-colors hover:bg-[var(--surface-2)]"
            >
              {tt('nav.signUp')}
            </Link>
          </div>
        </div>
      ) : null}

      {latest === null ? (
        <section className="mt-10 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-10">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">{tt('download.empty.title')}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{tt('download.empty.desc')}</p>
          {canPublish ? (
            <Link href="/admin/releases" className="mt-5 inline-flex text-sm text-[var(--accent)] hover:brightness-110">
              {tt('download.empty.admin')} →
            </Link>
          ) : (
            <p className="mt-5 text-xs text-[var(--muted)]">{tt('download.empty.user')}</p>
          )}
        </section>
      ) : (
        <section className="mt-10 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-6 py-5">
            <p className="text-2xs uppercase tracking-wider text-[var(--muted)]">
              {tt('download.current')}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-semibold tracking-[-0.01em]">{latest.version}</span>
              <span className="text-xs text-[var(--muted)]">
                {tt('download.publishedAt')} {latest.publishedAt ? absoluteTime(latest.publishedAt, locale) : '—'}
              </span>
            </div>
          </div>

          <ul className="divide-y divide-[var(--border)]">
            {latest.platforms.map((release) => (
              <li key={`${release.platform}-${release.arch}`} className="px-6 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {platformLabel(release.platform)} · {release.arch}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {formatBytes(release.byteSize)} · {release.fileName}
                    </p>
                  </div>
                  <DownloadPlatformButton
                    locale={locale}
                    href={release.downloadPath}
                    signedIn={Boolean(session)}
                    fileName={release.fileName}
                  />
                </div>
                {/*
                  The checksum belongs to THIS row. It used to be printed once,
                  from `platforms[0]`, under a heading that read as "the" checksum
                  — the moment a second platform is published that single number
                  would verify the wrong file.
                */}
                <div className="mt-3">
                  <p className="text-2xs uppercase tracking-wider text-[var(--muted)]">
                    {tt('download.checksum')}
                  </p>
                  <div className="mt-1.5">
                    <CopyChecksum sha256={release.sha256} locale={locale} />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="border-t border-[var(--border)] px-6 py-5">
            <p className="text-xs leading-5 text-[var(--muted)]">{tt('download.checksum.hint')}</p>
          </div>

          {latest.notes ? (
            <div className="border-t border-[var(--border)] px-6 py-5">
              <p className="text-2xs uppercase tracking-wider text-[var(--muted)]">
                {tt('download.notes')}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--muted)]">
                {latest.notes}
              </p>
            </div>
          ) : null}
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--muted)]">
          {tt('download.history')}
        </h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">{tt('download.history.empty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {[
                    tt('download.version'),
                    tt('download.platform'),
                    tt('download.publishedAt'),
                    tt('download.size'),
                    tt('common.status'),
                    tt('common.actions'),
                  ].map((header, index) => (
                    <th
                      key={header}
                      scope="col"
                      className={`px-3 py-2.5 text-xs font-medium text-[var(--muted)] ${
                        index === 5 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((release) => (
                  <tr key={release.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="mono px-3 py-2.5 text-xs">{release.version}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {platformLabel(release.platform)} · {release.arch}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                      {release.publishedAt ? absoluteTime(release.publishedAt, locale) : '—'}
                    </td>
                    <td className="mono px-3 py-2.5 text-xs text-[var(--muted)]">
                      {formatBytes(release.byteSize)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {release.status === 'published' ? (
                        <span className="text-[var(--accent)]">{tt('download.state.published')}</span>
                      ) : (
                        <span className="text-[var(--muted)]">{tt('download.state.retracted')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {/*
                        The section is titled "previous releases" and its subtitle
                        promises they can be fetched again, so every published row
                        carries a real link. A withdrawn build is not offered
                        here — publishing is what makes a build servable, and the
                        console is one click away.
                      */}
                      {release.status === 'published' ? (
                        <Link
                          href={session ? downloadBase(release.platform, release.id) : loginHref}
                          className="text-xs text-[var(--accent)] hover:brightness-110"
                        >
                          {tt('download.action')}
                        </Link>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">{tt('download.unavailable')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-12 text-xs text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--foreground)]">
          ← {tt('common.back')}
        </Link>
      </p>
    </div>
  )
}
