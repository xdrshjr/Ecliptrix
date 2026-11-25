/**
 * Version comparison for the server.
 *
 * The implementation lives in `@/lib/releases` because the console form needs the
 * same ordering, and duplicating it would let "too old" mean two different things
 * in two places. This module exists so server code keeps importing a server path
 * and no service reaches into a UI module by accident.
 */

export {
  compareVersions,
  isVersionOutdated,
  parseVersion,
} from '@/lib/releases'

/** True when `value` is an orderable dotted version. */
export function isComparableVersion(value: string): boolean {
  return /^\d+(\.\d+){1,3}$/.test(value.trim().replace(/^v/i, ''))
}
