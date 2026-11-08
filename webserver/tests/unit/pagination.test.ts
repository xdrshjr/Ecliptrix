import { describe, expect, it } from 'vitest'
import { buildPageMeta, parsePage, parseSort } from '@/server/http/pagination'
import { MAX_PAGE_SIZE } from '@/server/http/pagination'

describe('parsePage', () => {
  it('defaults to page 1 with 20 rows', () => {
    expect(parsePage(new URLSearchParams())).toEqual({ page: 1, pageSize: 20, offset: 0 })
  })

  it('computes the offset from page and size', () => {
    expect(parsePage(new URLSearchParams('page=3&pageSize=10'))).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
    })
  })

  it('clamps the page size to the documented ceiling', () => {
    expect(parsePage(new URLSearchParams('pageSize=1000')).pageSize).toBe(MAX_PAGE_SIZE)
  })

  it('ignores nonsense values instead of throwing', () => {
    expect(parsePage(new URLSearchParams('page=-5&pageSize=abc')).page).toBe(1)
  })
})

describe('buildPageMeta', () => {
  it('rounds total pages up and never reports zero pages', () => {
    const page = { page: 1, pageSize: 20, offset: 0 }
    expect(buildPageMeta(0, page).totalPages).toBe(1)
    expect(buildPageMeta(21, page).totalPages).toBe(2)
    expect(buildPageMeta(128, page).totalPages).toBe(7)
  })
})

describe('parseSort', () => {
  const allowed = ['created_at', 'last_login_at', 'email'] as const

  it('reads a descending marker', () => {
    expect(parseSort('-email', allowed, '-created_at')).toEqual({
      column: 'email',
      direction: 'DESC',
    })
  })

  it('falls back when the column is not whitelisted (SQL injection guard)', () => {
    expect(parseSort('email; DROP TABLE users', allowed, '-created_at')).toEqual({
      column: 'created_at',
      direction: 'DESC',
    })
  })

  it('honours the fallback direction', () => {
    expect(parseSort(null, allowed, 'email').direction).toBe('ASC')
  })
})
