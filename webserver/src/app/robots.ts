import type { MetadataRoute } from 'next'
import { NOINDEX_PREFIXES } from '@/server/auth/publicSurface'

/**
 * robots.txt: keep the console out of search results entirely.
 *
 * The account/console prefixes come from `publicSurface.NOINDEX_PREFIXES`, the
 * same list `middleware.ts` turns into `X-Robots-Tag` — one source, so the crawl
 * rules and the response header cannot disagree (review R-V3-04).
 *
 * `/api/` is listed here and nowhere else: it is a crawl rule, not a noindex
 * header, because an API response is never rendered as a page.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:8787'
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/legal/'],
        disallow: [
          ...NOINDEX_PREFIXES,
          '/api/',
          '/login',
          '/register',
          '/reset-password',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
