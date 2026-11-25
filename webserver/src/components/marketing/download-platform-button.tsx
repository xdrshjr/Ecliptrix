import Link from 'next/link'
import { Download } from 'lucide-react'
import { translator, type Locale } from '@/lib/i18n'

/**
 * One platform's download affordance.
 *
 * Signed out it is a link to the sign-in page carrying `next=/download`, not a
 * disabled button: the requirement is "sign in, then download", and both shipped
 * clients prove a browser session is always obtainable (the 426 gate only applies
 * to `client === 'desktop'`). A dead button here would recreate the dead end this
 * whole feature exists to remove.
 *
 * Signed in it is a plain anchor to the byte endpoint, so the browser's own
 * download manager handles the transfer and its resume support.
 */
export function DownloadPlatformButton({
  locale,
  href,
  signedIn,
  fileName,
}: {
  locale: Locale
  href: string
  signedIn: boolean
  fileName: string
}) {
  const tt = translator(locale)

  if (!signedIn) {
    return (
      <Link
        href="/login?next=%2Fdownload"
        className="inline-flex h-9 items-center gap-2 rounded-sm bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110"
      >
        {tt('download.loginRequired')}
      </Link>
    )
  }

  return (
    <a
      href={href}
      download={fileName}
      className="inline-flex h-9 items-center gap-2 rounded-sm bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110"
    >
      <Download size={14} />
      {tt('download.action')}
    </a>
  )
}
