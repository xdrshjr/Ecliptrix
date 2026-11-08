import type { PageMeta } from '@/server/db/types'

/**
 * Query-string pagination. Defaults are part of the API contract: 20 per page,
 * 100 hard ceiling. A caller asking for more gets the ceiling, not an error —
 * the console's page-size selector offers exactly 10/20/50/100.
 */

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export interface PageRequest {
  page: number
  pageSize: number
  offset: number
}

function toPositiveInt(raw: string | null, fallback: number, max?: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return fallback
  return max ? Math.min(parsed, max) : parsed
}

export function parsePage(searchParams: URLSearchParams): PageRequest {
  const page = toPositiveInt(searchParams.get('page'), 1)
  const pageSize = toPositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

export function buildPageMeta(total: number, request: PageRequest): PageMeta {
  return {
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / request.pageSize)),
  }
}

/**
 * Sort ordering from an untrusted string.
 *
 * Only whitelisted `column` / `-column` values are accepted; anything else falls
 * back to the default. Interpolating a caller-supplied ORDER BY is the classic
 * SQL injection hole in a repository that otherwise uses prepared statements.
 */
export function parseSort<TColumn extends string>(
  raw: string | null,
  allowed: readonly TColumn[],
  fallback: string,
): { column: TColumn; direction: 'ASC' | 'DESC' } {
  const value = (raw ?? fallback).trim()
  const descending = value.startsWith('-')
  const column = (descending ? value.slice(1) : value) as TColumn
  if (!allowed.includes(column)) {
    const fallbackDescending = fallback.startsWith('-')
    return {
      column: (fallbackDescending ? fallback.slice(1) : fallback) as TColumn,
      direction: fallbackDescending ? 'DESC' : 'ASC',
    }
  }
  return { column, direction: descending ? 'DESC' : 'ASC' }
}
