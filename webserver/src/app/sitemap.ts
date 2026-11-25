import type { MetadataRoute } from 'next'

/** Sitemap: public marketing routes only — the console is not indexable. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:8787'
  const now = new Date()
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/download`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
