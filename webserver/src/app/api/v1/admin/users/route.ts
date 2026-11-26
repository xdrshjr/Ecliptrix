import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite } from '@/server/auth/guards'
import { parsePage, parseSort, buildPageMeta } from '@/server/http/pagination'
import { createUserSchema } from '@/server/validation/schemas'
import { toAdminUserDto } from '@/server/http/dto'
import * as userService from '@/server/services/userService'
import * as roleService from '@/server/services/roleService'
import * as authorityService from '@/server/services/authorityService'
import { USER_SORT_COLUMNS } from '@/server/db/repositories/usersRepo'
import type { UserStatus } from '@/server/db/types'

/**
 * `/api/v1/admin/users`
 *
 * GET: server-side filtered, sorted and paginated list.
 * POST: create a user, optionally with a generated one-time password.
 */
export const dynamic = 'force-dynamic'

const STATUSES: UserStatus[] = ['active', 'suspended', 'pending', 'deleted']

function parseStatus(raw: string | null): UserStatus | undefined {
  return STATUSES.find((status) => status === raw)
}

function parseDate(raw: string | null): number | undefined {
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const GET = withContext(async ({ request, context, searchParams }) => {
  const auth = requireAdminRead(request, context, 'users.read')
  const page = parsePage(searchParams)
  const sort = parseSort(searchParams.get('sort'), USER_SORT_COLUMNS, '-created_at')

  const result = userService.listUsers({
    query: searchParams.get('query') ?? undefined,
    status: parseStatus(searchParams.get('status')),
    roleKey: searchParams.get('role') ?? undefined,
    plan: searchParams.get('plan') ?? undefined,
    createdFrom: parseDate(searchParams.get('createdFrom')),
    createdTo: parseDate(searchParams.get('createdTo')),
    sort,
    page,
  })

  return ok({
    items: result.rows.map(toAdminUserDto),
    page: buildPageMeta(result.total, page),
    // AC-21: the console's role dropdown needs to know what THIS caller may hand
    // out, and why the rest is unavailable. Omitting the unreachable entries
    // silently is what makes an administrator think the console is broken; each
    // entry therefore carries `grantable` plus a machine-readable reason.
    //
    // This is UX, not a boundary — `createUser` / `updateUser` re-check the same
    // invariants on submit (spec §3.4.2 INV-2/INV-3).
    grantableRoles: roleService.listRoles().map((role) => {
      const grantable = authorityService.canGrantRole(auth.user.id, role)
      return {
        id: role.id,
        key: role.key,
        name: role.name,
        rank: role.rank,
        grantable,
        reason: grantable
          ? null
          : role.key === 'owner'
            ? ('owner_reserved' as const)
            : ('admin_allocation_reserved' as const),
      }
    }),
  })
})

export const POST = withContext(async ({ request, context }) => {
  const auth = requireAdminWrite(request, context, 'users.write')

  const input = await readJson(request, createUserSchema)
  const created = await userService.createUser(
    {
      email: input.email,
      username: input.username,
      displayName: input.displayName,
      password: input.password,
      roleId: input.roleId,
      roleKey: input.roleKey,
      status: input.status,
      planTag: input.planTag,
      note: input.note,
      mustChangePassword: input.mustChangePassword,
    },
    auth.audit,
  )

  return ok(
    {
      user: toAdminUserDto(userService.getUserDetail(created.user.id)),
      temporaryPassword: created.temporaryPassword,
    },
    {
      status: 201,
      message: created.temporaryPassword ? '已生成一次性口令，请立即转交用户' : undefined,
    },
  )
})
