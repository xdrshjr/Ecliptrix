import type { MetadataRoute } from 'next'

/** robots.txt: keep the console out of search results entirely. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:8787'
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/legal/'],
        disallow: ['/admin', '/account', '/api/', '/login', '/register', '/reset-password'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
