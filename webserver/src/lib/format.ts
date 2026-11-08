import type { Locale } from '@/lib/i18n'

/**
 * Formatting helpers.
 *
 * Hand-rolled instead of pulling in a date library: three functions, no locale
 * data to load, and `Intl` already ships with Node and the browser.
 */

/**
 * "3 分钟前" / "3 minutes ago" — the console's default time rendering.
 *
 * Call this only on the client (see `components/shell/relative-time.tsx`): it
 * reads `Date.now()`, so rendering it on the server produces different text on
 * the server and the first client pass, which is a hydration mismatch (spec R-17).
 */
export function relativeTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const diffSeconds = Math.round((then - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  const thresholds: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ]

  let value = diffSeconds
  for (const [unit, size] of thresholds) {
    if (Math.abs(value) < size) return formatter.format(Math.round(value), unit)
    value /= size
  }
  return formatter.format(Math.round(value), 'year')
}

/**
 * Absolute timestamp for tooltips and the audit table.
 *
 * `timeZone` defaults to the runtime's, which is what a tooltip wants. Pass an
 * explicit zone for anything rendered on both the server and the client, where
 * the two runtimes may not agree on the zone.
 */
export function absoluteTime(
  iso: string | null | undefined,
  locale: Locale,
  timeZone?: string,
): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return '—'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(parsed)
}

/** 1234567 → "1,234,567" */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value)
}

/** Compact date for chart axes: 2026-10-08 → 10-08 */
export function shortDate(iso: string): string {
  return iso.slice(5)
}
