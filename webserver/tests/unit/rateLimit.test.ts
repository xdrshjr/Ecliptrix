import { beforeEach, describe, expect, it } from 'vitest'
import { hit, peek, reset, resetAll, LIMITS, MINUTE } from '@/server/auth/rateLimit'

describe('sliding window limiter', () => {
  beforeEach(() => resetAll())

  it('allows exactly the budget, then refuses', () => {
    const results = Array.from({ length: 6 }, () => hit('test', 'ip-1', 5, MINUTE))
    expect(results.slice(0, 5).every((result) => result.allowed)).toBe(true)
    expect(results[5]?.allowed).toBe(false)
    expect(results[5]?.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('scopes buckets by key', () => {
    for (let index = 0; index < 5; index += 1) hit('test', 'ip-a', 5, MINUTE)
    expect(hit('test', 'ip-a', 5, MINUTE).allowed).toBe(false)
    expect(hit('test', 'ip-b', 5, MINUTE).allowed).toBe(true)
  })

  it('reports the remaining budget without consuming any', () => {
    hit('test', 'ip-c', 3, MINUTE)
    expect(peek('test', 'ip-c', 3, MINUTE).remaining).toBe(2)
    expect(peek('test', 'ip-c', 3, MINUTE).remaining).toBe(2)
  })

  it('forgets a key on reset', () => {
    for (let index = 0; index < 5; index += 1) hit('test', 'ip-d', 5, MINUTE)
    reset('test', 'ip-d')
    expect(hit('test', 'ip-d', 5, MINUTE).allowed).toBe(true)
  })

  it('treats a different window as a different bucket', () => {
    for (let index = 0; index < 3; index += 1) hit('test', 'ip-e', 3, MINUTE)
    expect(hit('test', 'ip-e', 3, MINUTE * 2).allowed).toBe(true)
  })

  it('publishes the documented budgets', () => {
    expect(LIMITS.loginIdentifier.limit).toBeGreaterThan(5)
    expect(LIMITS.registerIp.limit).toBe(10)
    expect(LIMITS.resetIp.limit).toBe(3)
    expect(LIMITS.adminWrite.limit).toBe(120)
  })

  it('keeps the identifier budget above the lockout threshold', () => {
    // 423 account_locked must remain reachable: if the limiter fired at or below the
    // lockout threshold, callers would only ever see 429.
    expect(LIMITS.loginIdentifier.limit).toBeGreaterThan(5)
  })
})
