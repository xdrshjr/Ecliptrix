'use client'

import { useEffect, useState } from 'react'
import type { Locale } from '@/lib/i18n'
import { absoluteTime, relativeTime } from '@/lib/format'

/**
 * "3 分钟前" / "3 minutes ago", computed only after mount.
 *
 * Spec R-17 forbids formatting relative time during server rendering: the server
 * renders the first HTML, the browser hydrates it a moment later, and
 * `relativeTime()` reads `Date.now()` — so any timestamp that crosses a minute
 * boundary in between makes the two passes disagree. React then logs a hydration
 * mismatch and the text visibly flickers.
 *
 * The first paint therefore shows an absolute UTC timestamp, which is identical
 * on both sides by construction, and the relative form replaces it once mounted.
 * `dateTime`/`title` keep the machine-readable value for assistive tech and hover.
 */
export function RelativeTime({
  iso,
  locale,
  className,
}: {
  iso: string | null | undefined
  locale: Locale
  className?: string
}) {
  const [text, setText] = useState(() => absoluteTime(iso, locale, 'UTC'))

  useEffect(() => {
    setText(relativeTime(iso, locale))
  }, [iso, locale])

  return (
    <time dateTime={iso ?? undefined} title={absoluteTime(iso, locale)} className={className}>
      {text}
    </time>
  )
}
