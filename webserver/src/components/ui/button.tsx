import { cn } from '@/lib/cn'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Button.
 *
 * Height/typography match the console reference: 36px, 13px text, 6px radius.
 * A loading button keeps its width and blocks a second submit — double submits
 * are the most common source of duplicate users in an admin console.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110 active:brightness-95 border border-transparent',
  secondary:
    'bg-transparent text-[var(--foreground)] border border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
  ghost:
    'bg-transparent text-[var(--muted)] border border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]',
  danger:
    'bg-[var(--danger)] text-white border border-transparent hover:brightness-110 active:brightness-95',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-3.5 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm font-medium',
        'transition-colors duration-100 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}
