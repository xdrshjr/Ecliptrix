'use client'

import { cn } from '@/lib/cn'
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Toasts.
 *
 * A ~60-line store instead of a dependency: the console needs four tones, a
 * stacking list and `role="alert"` for failures. Field errors stay inline — this
 * is for outcomes ("user deleted"), never for "this field is wrong".
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

type Listener = (toasts: Toast[]) => void

let seq = 0
let toasts: Toast[] = []
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener([...toasts])
}

export function pushToast(tone: ToastTone, message: string): void {
  const id = ++seq
  toasts = [...toasts, { id, tone, message }]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((toast) => toast.id !== id)
    emit()
  }, 4000)
}

export const toast = {
  success: (message: string) => pushToast('success', message),
  error: (message: string) => pushToast('error', message),
  warning: (message: string) => pushToast('warning', message),
  info: (message: string) => pushToast('info', message),
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: TriangleAlert,
  info: Info,
} as const

const TONES: Record<ToastTone, string> = {
  success: 'border-[var(--accent)]/40 text-[var(--accent)]',
  error: 'border-[var(--danger)]/40 text-[var(--danger)]',
  warning: 'border-[var(--warning)]/40 text-[var(--warning)]',
  info: 'border-[var(--info)]/40 text-[var(--info)]',
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])

  useEffect(() => {
    const listener: Listener = (next) => setItems(next)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
    >
      {items.map((item) => {
        const Icon = ICONS[item.tone]
        return (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-md border bg-[var(--surface)] px-3.5 py-3',
              'text-sm shadow-[0_8px_30px_rgba(0,0,0,0.35)] animate-fade-in',
              TONES[item.tone],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <p className="text-[var(--foreground)]">{item.message}</p>
          </div>
        )
      })}
    </div>
  )
}
