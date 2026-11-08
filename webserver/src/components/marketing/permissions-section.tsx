import Link from 'next/link'
import { Check } from 'lucide-react'
import type { Translator } from '@/lib/i18n'
import { cn } from '@/lib/cn'
import { SYSTEM_ROLE_PERMISSIONS, ALL_PERMISSIONS } from '@/server/auth/permissions'

/**
 * Marketing rendering of the real RBAC matrix.
 *
 * The numbers come from `SYSTEM_ROLE_PERMISSIONS`, not from hand-written copy, so
 * the landing page cannot claim a capability the server does not grant.
 */
export function PermissionsSection({ tt }: { tt: Translator }) {
  const roles = ['owner', 'admin', 'support', 'member'] as const

  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <header className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          {tt('permissions.title')}
        </h2>
        <p className="mt-3 text-sm text-[var(--muted)]">{tt('permissions.subtitle')}</p>
      </header>

      <div className="mt-10 overflow-x-auto rounded-md border border-[var(--border)]">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{tt('admin.roles.matrix')}</caption>
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
              <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                {tt('common.name')}
              </th>
              {roles.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="px-4 py-2.5 text-center text-xs font-medium capitalize text-[var(--muted)]"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PERMISSIONS.map((permission) => (
              <tr key={permission} className="border-b border-[var(--border)] last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal text-[var(--muted)]">
                  <span className="mono text-xs">{permission}</span>
                </th>
                {roles.map((role) => {
                  const held = SYSTEM_ROLE_PERMISSIONS[role]
                  const granted = held.includes('*') || held.includes(permission)
                  return (
                    <td key={role} className="px-4 py-2 text-center">
                      {granted ? (
                        <Check
                          size={14}
                          className={cn('mx-auto', role === 'owner' ? 'text-[var(--accent)]' : 'text-[var(--info)]')}
                          aria-label="granted"
                        />
                      ) : (
                        <span className="text-[var(--border-strong)]" aria-label="not granted">
                          ·
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-[var(--muted)]">
        <Link href="/register" className="text-[var(--info)] hover:underline">
          {tt('pricing.cta')}
        </Link>
      </p>
    </section>
  )
}
