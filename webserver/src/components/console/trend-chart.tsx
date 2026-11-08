import { formatNumber, shortDate } from '@/lib/format'
import { translator, type Locale } from '@/lib/i18n'
import type { TrendPoint } from '@/server/services/metricsService'

/**
 * Zero-dependency trend chart.
 *
 * Inline SVG rather than a chart library: the console has no bundling budget for a
 * charting package, and "two small series over 30 days" needs ~40 lines of maths.
 * `role="img"` + `aria-label` keeps it meaningful to a screen reader, and the
 * `<title>` inside gives each bar its own tooltip.
 *
 * Rendered on the server (no hooks, no state): a chart that only appears after
 * hydration is a chart that flickers on every navigation.
 */
export function TrendChart({
  locale,
  title,
  points,
  tone = 'accent',
}: {
  locale: Locale
  title: string
  points: TrendPoint[]
  tone?: 'accent' | 'info'
}) {
  const tt = translator(locale)
  // The window comes from the payload, not from a constant: `/admin?days=30`
  // announced "last 14 days" to a screen reader, which is the one place a chart is
  // its own label.
  const rangeLabel =
    points.length === 14
      ? tt('admin.overview.range14')
      : points.length === 30
        ? tt('admin.overview.range30')
        : tt('admin.overview.rangeDays', { count: points.length })
  const peak = Math.max(1, ...points.map((point) => point.count))
  const total = points.reduce((sum, point) => sum + point.count, 0)
  const barClass = tone === 'accent' ? 'fill-[var(--accent)]/70' : 'fill-[var(--info)]/70'
  const width = 320
  const height = 96
  const gap = 2
  const barWidth = points.length > 0 ? Math.max(1, width / points.length - gap) : 1

  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="mono text-xs text-[var(--muted)]">{formatNumber(total, locale)}</span>
      </header>
      <svg
        className="mt-3 w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}: ${rangeLabel}`}
      >
        {points.map((point, index) => {
          const barHeight = Math.max(2, (point.count / peak) * (height - 4))
          return (
            <rect
              key={point.date}
              x={index * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              className={barClass}
              rx={1}
            >
              <title>{`${point.date}: ${point.count}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-[var(--muted)]">
        <span className="mono">{points[0] ? shortDate(points[0].date) : ''}</span>
        <span className="mono">{points.at(-1) ? shortDate(points.at(-1)!.date) : ''}</span>
      </div>
    </section>
  )
}
