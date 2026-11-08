import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  groupOf,
  hasPermission,
  isKnownPermission,
  sortPermissions,
} from '@/server/auth/permissions'

describe('hasPermission', () => {
  it('grants everything to the wildcard holder', () => {
    expect(hasPermission(['*'], 'users.delete')).toBe(true)
    expect(hasPermission(['*'], 'anything.at.all')).toBe(true)
  })

  it('grants an exact match', () => {
    expect(hasPermission(['users.read'], 'users.read')).toBe(true)
    expect(hasPermission(['users.read'], 'users.write')).toBe(false)
  })

  it('supports resource wildcards', () => {
    expect(hasPermission(['users.*'], 'users.read')).toBe(true)
    expect(hasPermission(['users.*'], 'roles.read')).toBe(false)
  })

  it('denies everything for an empty set', () => {
    expect(hasPermission([], 'users.read')).toBe(false)
  })
})

describe('catalogue', () => {
  it('knows every declared permission and rejects unknown ones', () => {
    for (const permission of ALL_PERMISSIONS) expect(isKnownPermission(permission)).toBe(true)
    expect(isKnownPermission('users.destroy')).toBe(false)
    expect(isKnownPermission('*')).toBe(true)
  })

  it('maps every permission to exactly one group', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(groupOf(permission)).toBeTypeOf('string')
    }
  })
})

describe('system roles', () => {
  it('covers the four documented roles', () => {
    expect([...SYSTEM_ROLE_KEYS]).toEqual(['owner', 'admin', 'support', 'member'])
  })

  it('gives the owner the wildcard and the member nothing extra', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner).toEqual(['*'])
    expect(SYSTEM_ROLE_PERMISSIONS.member).toEqual([])
  })

  it('never grants the admin role roles.write or settings.write', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin).not.toContain('roles.write')
    expect(SYSTEM_ROLE_PERMISSIONS.admin).not.toContain('settings.write')
  })

  it('keeps support read-only apart from session revocation', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.support).toContain('users.read')
    expect(SYSTEM_ROLE_PERMISSIONS.support).not.toContain('users.write')
    expect(SYSTEM_ROLE_PERMISSIONS.support).toContain('sessions.revoke')
  })

  it('sorts permissions stably and puts the wildcard first', () => {
    const sorted = sortPermissions(['settings.write', '*', 'users.read'])
    expect(sorted[0]).toBe('*')
    expect(sorted).toEqual(sortPermissions(sorted))
  })
})
