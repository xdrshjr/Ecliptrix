import { NextResponse } from 'next/server'
import { withContext, readSearch } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import * as userService from '@/server/services/userService'
import * as auditService from '@/server/services/auditService'
import { userExportQuerySchema } from '@/server/validation/schemas'

/**
 * `GET /api/v1/admin/users/export` — the filtered user list as CSV.
 *
 * Same attachment convention as `/me/export`: `new NextResponse`, explicit headers,
 * no envelope. Two specifics:
 *
 *  - the payload starts with a UTF-8 BOM. Without it Excel reads a Chinese display
 *    name as mojibake, and "the export is broken" is the report you get;
 *  - the 20000-row cap is expressed as a header (`X-Export-Truncated: 1`) rather
 *    than a silent cut, so the console can tell the operator to narrow the filter.
 */
export const dynamic = 'force-dynamic'

const MAX_ROWS = 20_000

const HEADER = [
  'email',
  'username',
  'display_name',
  'role',
  'status',
  'plan_tag',
  'email_verified',
  'created_at',
  'last_login_at',
  'active_sessions',
]

/** RFC 4180: quote when the value contains a comma, a quote or a newline. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export const GET = withContext(async ({ request, context, searchParams }) => {
  const auth = requireAdminRead(request, context, 'users.read')

  // Schema-validated: `?status=activ` used to export every account, which is the
  // worst possible failure mode for a file the operator then treats as filtered.
  const query = readSearch(searchParams, userExportQuerySchema)

  const result = userService.listForExport(
    {
      query: query.query,
      status: query.status,
      roleKey: query.role,
      plan: query.plan,
    },
    MAX_ROWS,
  )

  const truncated = result.truncated
  const lines = [HEADER.join(',')]
  for (const row of result.rows) {
    lines.push(
      [
        cell(row.email),
        cell(row.username),
        cell(row.display_name),
        cell(row.role_key),
        cell(row.status),
        cell(row.plan_tag),
        cell(row.email_verified_at !== null ? 'yes' : 'no'),
        cell(new Date(row.created_at).toISOString()),
        cell(row.last_login_at ? new Date(row.last_login_at).toISOString() : ''),
        cell(row.sessions_active),
      ].join(','),
    )
  }

  auditService.record(auth.audit, {
    action: 'admin.users_exported',
    targetType: 'user',
    metadata: {
      rows: result.rows.length,
      truncated,
      filters: {
        query: Boolean(query.query),
        status: query.status ?? '',
        role: query.role ?? '',
        plan: query.plan ?? '',
      },
    },
  })

  // BOM first: see the doc comment.
  const body = `\uFEFF${lines.join('\r\n')}\r\n`
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const response = new NextResponse(body, { status: 200 })
  response.headers.set('Content-Type', 'text/csv; charset=utf-8')
  response.headers.set('Content-Disposition', `attachment; filename="ecliptrix-users-${stamp}.csv"`)
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  if (truncated) response.headers.set('X-Export-Truncated', '1')
  return response
})
