import type { Metadata } from 'next'
import './globals.css'
import { Inter } from 'next/font/google'
import { resolveLocale } from '@/lib/locale'
import { t } from '@/lib/i18n'
import { ThemeScript } from '@/components/shell/theme-script'
import { Toaster } from '@/components/shell/toaster'

/**
 * Absolute origin for metadata, taken from `PUBLIC_BASE_URL`.
 *
 * A module-level `metadata` export cannot await the config loader, and importing
 * it would run the zod validation at build time — when the build machine
 * legitimately has no database and no secrets. Reading the one variable directly,
 * with a safe fallback, keeps `next build` working while still producing correct
 * absolute OG URLs in production.
 */
function publicBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL
  if (raw && /^https?:\/\//.test(raw)) return raw
  return 'http://127.0.0.1:8787'
}

/**
 * Root layout.
 *
 * `dark` on `<html>` is written by the inline script before paint (no flash);
 * the server renders the dark class as the default so the first frame matches
 * the reference console even with JS disabled.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  // Absolute URLs for the OG image and canonical links. Without it Next falls
  // back to the build machine's origin (http://localhost:<port>) and every shared
  // link previews as a localhost URL — the one piece of metadata a landing page
  // cannot get wrong.
  metadataBase: new URL(publicBaseUrl()),
  title: {
    default: 'Ecliptrix — 光影交汇之处',
    template: '%s · Ecliptrix',
  },
  description:
    'Ecliptrix 账号中心与桌面端用户管理：登录、注册、账号资料、角色与权限分配、审计日志。',
  applicationName: 'Ecliptrix',
  openGraph: {
    type: 'website',
    siteName: 'Ecliptrix',
    title: 'Ecliptrix — 光影交汇之处',
    description: 'AI 视频创作工具的账号中心：登录、注册、账号与权限管理。',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Page renders are the other entry point into the Node runtime: boot here so a
  // direct visit to `/admin` works without an API call having happened first.
  const { ensureBooted } = await import('@/server/boot')
  await ensureBooted()

  const locale = await resolveLocale()
  return (
    <html lang={locale} className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-[var(--background)] antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-[var(--surface)] focus:px-3 focus:py-2 focus:text-sm"
        >
          {t('common.search', locale)}
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
