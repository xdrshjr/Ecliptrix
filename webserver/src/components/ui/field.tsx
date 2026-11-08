import { cn } from '@/lib/cn'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

/**
 * Form primitives.
 *
 * Field errors render inline under the control, never as a toast: a toast tells
 * the user something went wrong, the inline message tells them which field and
 * why. `aria-describedby` wiring is in `Field`, so no caller has to remember it.
 */

const CONTROL =
  'w-full rounded-sm border bg-[var(--surface-2)] px-3 text-sm text-[var(--foreground)] ' +
  'placeholder:text-[var(--muted)] transition-colors duration-100 ' +
  'focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/60 focus:border-[var(--border-strong)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

export interface FieldProps {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}

export function Field({ label, htmlFor, error, hint, required, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--foreground)]">
        {label}
        {required ? <span className="ml-1 text-[var(--danger)]">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-[var(--muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        'h-9',
        invalid ? 'border-[var(--danger)]' : 'border-[var(--border)]',
        className,
      )}
      {...rest}
    />
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export function Textarea({ className, invalid, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        'min-h-[80px] py-2 leading-6',
        invalid ? 'border-[var(--danger)]' : 'border-[var(--border)]',
        className,
      )}
      {...rest}
    />
  )
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export function Select({ className, invalid, children, ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        'h-9 appearance-none pr-8',
        invalid ? 'border-[var(--danger)]' : 'border-[var(--border)]',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Checkbox({
  id,
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface-2)] accent-[var(--accent)]"
        {...rest}
      />
      <label htmlFor={id} className="text-sm text-[var(--foreground)]">
        {label}
      </label>
    </div>
  )
}
