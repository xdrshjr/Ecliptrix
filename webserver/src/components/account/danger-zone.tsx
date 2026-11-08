'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ApiError } from '@/lib/api/client'
import { meApi } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Danger zone.
 *
 * The only action here files an intent: the account keeps working until an
 * administrator acts on the audit entry. Making that explicit in the copy is the
 * point — a user who thinks their data is already gone stops caring about it.
 */
export function DangerZone({ locale }: { locale: Locale }) {
  const tt = translator(locale)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await meApi.requestDeletion()
      toast.success(tt('account.danger.requested'))
      setOpen(false)
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="danger-heading"
      className="mt-6 rounded-md border border-[var(--danger)]/35 bg-[var(--danger)]/5 p-5"
    >
      <h2 id="danger-heading" className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle size={14} className="text-[var(--danger)]" />
        {tt('account.danger.title')}
      </h2>
      <p className="mt-2 text-xs text-[var(--muted)]">{tt('account.danger.desc')}</p>
      <div className="mt-3">
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          {tt('account.danger.delete')}
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={tt('account.danger.delete')}
        description={tt('account.danger.desc')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tt('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={submit}>
              {tt('account.danger.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--muted)]">{tt('account.danger.desc')}</p>
      </Dialog>
    </section>
  )
}
