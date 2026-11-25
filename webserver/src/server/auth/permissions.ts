/**
 * Permission catalogue — the single server-side source of truth.
 *
 * Keys are `resource.action`. A role holds either the wildcard `*` (owner) or
 * an explicit set; `resource.*` is supported for future fine-grained splits.
 * The front-end reads labels from `src/lib/permissionsCatalog.ts`, which is
 * generated from this file's shape by the i18n test (key-set equality), so a
 * new permission cannot be added in one place only.
 */

export const PERMISSION_GROUPS = {
  users: ['users.read', 'users.write', 'users.delete'],
  roles: ['roles.read', 'roles.write'],
  sessions: ['sessions.revoke'],
  invites: ['invites.read', 'invites.write'],
  audit: ['audit.read'],
  settings: ['settings.read', 'settings.write'],
  // The client release catalogue (`/admin/releases`): one place where an
  // administrator uploads installers and moves the "current version" pointer.
  releases: ['releases.read', 'releases.write'],
} as const

export type PermissionGroupKey = keyof typeof PERMISSION_GROUPS

export const ALL_PERMISSIONS: readonly string[] = Object.values(PERMISSION_GROUPS).flat()

const PERMISSION_SET = new Set(ALL_PERMISSIONS)

/** Group that a permission belongs to, for console rendering. */
export function groupOf(permission: string): PermissionGroupKey | undefined {
  return (Object.keys(PERMISSION_GROUPS) as PermissionGroupKey[]).find((group) =>
    (PERMISSION_GROUPS[group] as readonly string[]).includes(permission),
  )
}

/** True when `permission` is a key this build knows about. */
export function isKnownPermission(permission: string): boolean {
  return permission === '*' || PERMISSION_SET.has(permission)
}

/**
 * Does a held permission set satisfy `need`?
 *
 * `*` satisfies everything; `users.*` satisfies `users.read`. An empty set
 * satisfies nothing — self-service endpoints (`/me/*`) intentionally require no
 * permission at all, they only require a session.
 */
export function hasPermission(held: readonly string[], need: string): boolean {
  if (held.includes('*')) return true
  if (held.includes(need)) return true
  const dot = need.indexOf('.')
  if (dot > 0) {
    const wildcard = `${need.slice(0, dot)}.*`
    if (held.includes(wildcard)) return true
  }
  return false
}

/** Stable ordering so the console's matrix does not jump between renders. */
export function sortPermissions(permissions: readonly string[]): string[] {
  const order = new Map(ALL_PERMISSIONS.map((permission, index) => [permission, index]))
  return [...permissions].sort((a, b) => {
    if (a === '*') return -1
    if (b === '*') return 1
    return (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER)
  })
}

export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'support', 'member'] as const

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number]

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, readonly string[]> = {
  owner: ['*'],
  admin: [
    'users.read',
    'users.write',
    'users.delete',
    'roles.read',
    'invites.read',
    'invites.write',
    'audit.read',
    'settings.read',
    'sessions.revoke',
    'releases.read',
    'releases.write',
  ],
  // Support can see what is published (they answer "which version do I install?"),
  // but publishing is an administrator action.
  support: ['users.read', 'sessions.revoke', 'audit.read', 'releases.read'],
  member: [],
}

export const SYSTEM_ROLE_NAMES: Record<SystemRoleKey, { name: string; description: string }> = {
  owner: { name: '超级管理员', description: '拥有全部权限，且不受任何 API 变更保护之外的操作影响' },
  admin: { name: '管理员', description: '管理用户、邀请码与审计日志' },
  support: { name: '客服', description: '只读查看用户、撤销会话、查看审计' },
  member: { name: '普通用户', description: '仅可访问自己的账号中心' },
}
