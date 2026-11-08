'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { translator, type Locale } from '@/lib/i18n'

/**
 * Destructive confirmation.
 *
 * Deleting a user, revoking an invite and kicking a device all use this. When
 * `requireTypedValue` is set the primary button stays disabled until the operator
 * retypes the target's name: a click-through dialog is one mis-click away from an
 * irreversible action, typing is not.
 */
export interface ConfirmDialogProps {
  locale: Locale
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  /** Text the operator must retype exactly; omit for a plain yes/no. */
  requireTypedValue?: string
  typedValueLabel?: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  locale,
  open,
  title,
  description,
  confirmLabel,
  requireTypedValue,
  typedValueLabel,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const tt = translator(locale)
  const [typed, setTyped] = useState('')

  const close = () => {
    setTyped('')
    onClose()
  }

  const blocked = Boolean(requireTypedValue) && typed !== requireTypedValue

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {tt('common.cancel')}
          </Button>
          <Button variant="danger" loading={busy} disabled={blocked} onClick={onConfirm}>
            {confirmLabel ?? tt('common.delete')}
          </Button>
        </>
      }
    >
      {requireTypedValue ? (
        <Field label={typedValueLabel ?? tt('common.name')} htmlFor="confirm-typed" required>
          <Input
            id="confirm-typed"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={requireTypedValue}
            className="mono"
          />
        </Field>
      ) : (
        <p className="text-sm text-[var(--muted)]">{description}</p>
      )}
    </Dialog>
  )
}
