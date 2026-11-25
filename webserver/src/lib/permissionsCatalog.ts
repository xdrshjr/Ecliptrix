import { t, type Locale } from '@/lib/i18n'

/**
 * Front-end permission catalogue — the only place a console component learns
 * which permissions exist and how they group.
 *
 * The key list mirrors `src/server/auth/permissions.ts`. The two are held
 * together by `tests/unit/catalog.test.ts`, which fails if either side gains a
 * key the other does not know: a permission that exists only on the server can
 * never be granted from the matrix, and one that exists only here is a checkbox
 * that silently does nothing.
 *
 * Labels live in the i18n dictionaries under `permissions.<key>` and
 * `permissions.group.<group>`, so no UI file hard-codes permission copy.
 */

export const PERMISSION_GROUPS = {
  users: ['users.read', 'users.write', 'users.delete'],
  roles: ['roles.read', 'roles.write'],
  sessions: ['sessions.revoke'],
  invites: ['invites.read', 'invites.write'],
  audit: ['audit.read'],
  settings: ['settings.read', 'settings.write'],
  releases: ['releases.read', 'releases.write'],
} as const

export type PermissionGroupKey = keyof typeof PERMISSION_GROUPS

export const PERMISSION_GROUP_KEYS = Object.keys(PERMISSION_GROUPS) as PermissionGroupKey[]

export const ALL_PERMISSIONS: readonly string[] = Object.values(PERMISSION_GROUPS).flat()

export interface PermissionRow {
  key: string
  label: string
}

export interface PermissionGroup {
  key: PermissionGroupKey | 'other'
  label: string
  permissions: PermissionRow[]
}

/** Label of one permission, falling back to the key so a raw id is never hidden. */
export function permissionLabel(permission: string, locale: Locale): string {
  const key = `permissions.${permission}`
  const label = t(key, locale)
  return label === key ? permission : label
}

/** Label of one group. */
export function groupLabel(group: PermissionGroupKey, locale: Locale): string {
  return t(`permissions.group.${group}`, locale)
}

/**
 * The whole matrix as grouped rows, in catalogue order.
 *
 * Permissions the server reports but this build does not know about are
 * appended under `other` rather than dropped: an older console must still show
 * a permission an operator just saw in the API response.
 */
export function groupedPermissions(locale: Locale, extra: readonly string[] = []): PermissionGroup[] {
  const known = new Set(ALL_PERMISSIONS)
  const groups: PermissionGroup[] = PERMISSION_GROUP_KEYS.map((group) => ({
    key: group,
    label: groupLabel(group, locale),
    permissions: PERMISSION_GROUPS[group].map((permission) => ({
      key: permission,
      label: permissionLabel(permission, locale),
    })),
  }))

  const unknown = extra.filter((permission) => !known.has(permission))
  if (unknown.length > 0) {
    groups.push({
      key: 'other',
      label: t('permissions.group.other', locale),
      permissions: [...new Set(unknown)].map((permission) => ({
        key: permission,
        label: permissionLabel(permission, locale),
      })),
    })
  }
  return groups
}
