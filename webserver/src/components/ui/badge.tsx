import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

/** Badge — role and status pills use the same low-saturation treatment. */

type Tone = 'neutral' | 'accent' | 'danger' | 'warning' | 'info' | 'purple'

const TONES: Record<Tone, string> = {
  neutral: 'border-[var(--border-strong)] text-[var(--muted)]',
  accent: 'border-[var(--accent)]/40 text-[var(--accent)]',
  danger: 'border-[var(--danger)]/40 text-[var(--danger)]',
  warning: 'border-[var(--warning)]/40 text-[var(--warning)]',
  info: 'border-[var(--info)]/40 text-[var(--info)]',
  purple: 'border-purple-400/40 text-purple-300',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

const ROLE_TONES: Record<string, Tone> = {
  owner: 'purple',
  admin: 'accent',
  support: 'info',
  member: 'neutral',
}

export function RoleBadge({ roleKey, name }: { roleKey: string; name: string }) {
  return <Badge tone={ROLE_TONES[roleKey] ?? 'neutral'}>{name}</Badge>
}

const STATUS_TONES: Record<string, Tone> = {
  active: 'accent',
  suspended: 'danger',
  pending: 'warning',
  deleted: 'neutral',
}

const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  suspended: '已停用',
  pending: '待激活',
  deleted: '已删除',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</Badge>
}
