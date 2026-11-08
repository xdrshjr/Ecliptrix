import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { Navbar } from '@/components/marketing/navbar'
import { Footer } from '@/components/marketing/footer'

/** Landing shell: navbar + content + footer. */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale()
  const tt = translator(locale)
  const session = await currentSession()
  const consoleHref = session && can(session, 'users.read') ? '/admin' : '/account'

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar locale={locale} signedIn={Boolean(session)} consoleHref={consoleHref} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer tt={tt} />
    </div>
  )
}
