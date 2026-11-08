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

/**
 * Landing page.
 *
 * Nine blocks in a fixed order (spec §2.8): navbar (layout), hero, features,
 * showcase, permissions, pricing, FAQ, download CTA, footer (layout).
 */
export const metadata: Metadata = {
  title: 'Ecliptrix — AI 视频创作平台',
  description:
    'Ecliptrix 把脚本、配音、多轨时间线与 AI 生成放进同一个工作台，并提供完整的账号与权限管理。',
}

export default async function LandingPage() {
  const locale = await resolveLocale()
  const tt = translator(locale)

  return (
    <>
      <Hero tt={tt} />
      <FeatureGrid tt={tt} />
      <Showcase tt={tt} />
      <PermissionsSection tt={tt} />
      <PricingCards tt={tt} />
      <Faq tt={tt} />
      <DownloadCta tt={tt} />
    </>
  )
}
