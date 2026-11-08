/**
 * Repository re-exports for tests.
 *
 * Tests import repositories through this module rather than deep paths so a file
 * rename is a one-line change and the test suite documents which repositories it
 * actually depends on.
 */
export * as usersRepo from '@/server/db/repositories/usersRepo'
export * as rolesRepo from '@/server/db/repositories/rolesRepo'
export * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
export * as auditRepo from '@/server/db/repositories/auditRepo'
export * as invitesRepo from '@/server/db/repositories/invitesRepo'
export * as loginAttemptsRepo from '@/server/db/repositories/loginAttemptsRepo'
export * as settingsRepo from '@/server/db/repositories/settingsRepo'
