import Link from 'next/link'
import {
  AudioLines,
  Clapperboard,
  FolderOpen,
  Image as ImageIcon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { Translator } from '@/lib/i18n'

/** Feature grid — six cards, one array, no copy repeated in the component. */
export function FeatureGrid({ tt }: { tt: Translator }) {
  const features = [
    { icon: Sparkles, title: tt('features.ai.title'), desc: tt('features.ai.desc') },
    { icon: Clapperboard, title: tt('features.timeline.title'), desc: tt('features.timeline.desc') },
    { icon: AudioLines, title: tt('features.tts.title'), desc: tt('features.tts.desc') },
    { icon: FolderOpen, title: tt('features.material.title'), desc: tt('features.material.desc') },
    { icon: ImageIcon, title: tt('features.cover.title'), desc: tt('features.cover.desc') },
    { icon: ShieldCheck, title: tt('features.account.title'), desc: tt('features.account.desc') },
  ]

  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-20">
      <header className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          {tt('features.title')}
        </h2>
        <p className="mt-3 text-sm text-[var(--muted)]">{tt('features.subtitle')}</p>
      </header>

      <ul className="mt-10 grid gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <li key={feature.title} className="group bg-[var(--surface)] p-6 transition-colors hover:bg-[var(--surface-2)]">
            <feature.icon size={20} className="text-[var(--accent)]" strokeWidth={1.6} />
            <h3 className="mt-4 text-sm font-medium">{feature.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{feature.desc}</p>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-[var(--muted)]">
        <Link href="/register" className="text-[var(--info)] hover:underline">
          {tt('pricing.cta')}
        </Link>
      </p>
    </section>
  )
}
