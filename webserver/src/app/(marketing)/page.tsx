import type { Metadata } from 'next'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { Hero } from '@/components/marketing/hero'
import { FeatureGrid } from '@/components/marketing/feature-grid'
import { Showcase } from '@/components/marketing/showcase'
import { PermissionsSection } from '@/components/marketing/permissions-section'
import { PricingCards } from '@/components/marketing/pricing-cards'
import { Faq } from '@/components/marketing/faq'
import { DownloadCta } from '@/components/marketing/download-cta'
import * as releaseService from '@/server/services/releaseService'

/**
 * Landing page.
 *
 * Nine blocks in a fixed order (spec §2.8): navbar (layout), hero, features,
 * showcase, permissions, pricing, FAQ, download CTA, footer (layout).
 *
 * `force-dynamic` is a correctness requirement, not tuning: the download block
 * renders the platforms that actually have a published installer, and a
 * statically prerendered page would freeze the platform list and the version at
 * build time — "the administrator published a build and the website never
 * changed" (analysis R-7).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ecliptrix — AI 视频创作平台',
  description:
    'Ecliptrix 把脚本、配音、多轨时间线与 AI 生成放进同一个工作台，并提供完整的账号与权限管理。',
}

export default async function LandingPage() {
  const locale = await resolveLocale()
  const tt = translator(locale)
  const latest = releaseService.latestPublished()
  const platforms = latest?.platforms.map((release) => release.platform) ?? []

  return (
    <>
      <Hero tt={tt} hasDownload={platforms.length > 0} />
      <FeatureGrid tt={tt} />
      <Showcase tt={tt} />
      <PermissionsSection tt={tt} />
      <PricingCards tt={tt} />
      <Faq tt={tt} />
      <DownloadCta tt={tt} platforms={platforms} version={latest?.version ?? null} />
    </>
  )
}
