import { describe, expect, it } from 'vitest'
import { DICTIONARY_KEYS, LOCALES, errorMessage, isLocale, t, translator } from '@/lib/i18n'

/** i18n parity: a key present in one locale and missing in the other is a bug. */
describe('dictionaries', () => {
  it('declares exactly two locales', () => {
    expect([...LOCALES]).toEqual(['zh-CN', 'en-US'])
  })

  it('has an identical key set in both locales', () => {
    const zh = Object.keys(DICTIONARY_KEYS['zh-CN']).sort()
    const en = Object.keys(DICTIONARY_KEYS['en-US']).sort()
    expect(en).toEqual(zh)
  })

  it('has no empty values', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARY_KEYS[locale])) {
        expect(value.length, `${locale}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('namespaces every key', () => {
    for (const key of Object.keys(DICTIONARY_KEYS['zh-CN'])) {
      expect(key).toMatch(/^[a-zA-Z]+\.[a-zA-Z0-9_.]+$/)
    }
  })
})

describe('t()', () => {
  it('returns the copy for a known key in both locales', () => {
    expect(t('nav.signIn', 'zh-CN')).toBe('登录')
    expect(t('nav.signIn', 'en-US')).toBe('Sign in')
  })

  it('interpolates named variables', () => {
    expect(t('admin.users.bulk', 'zh-CN', { count: 3 })).toBe('已选中 3 位')
    expect(t('admin.users.bulkApplied', 'en-US', { count: 7 })).toBe('Applied to 7 users')
  })

  it('falls back to the key itself for an unknown key', () => {
    expect(t('does.not.exist', 'en-US')).toBe('does.not.exist')
  })

  it('binds a locale through the translator helper', () => {
    const tt = translator('en-US')
    expect(tt('nav.console')).toBe('Console')
  })

  it('recognises valid locale codes only', () => {
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('en-US')).toBe(true)
    expect(isLocale('fr-FR')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
})

describe('errorMessage', () => {
  it('maps a known error code to copy', () => {
    expect(errorMessage('invalid_credentials', 'zh-CN')).toBe('邮箱或口令不正确')
  })

  it('falls back to a generic message for an unknown code', () => {
    expect(errorMessage('some_new_code', 'zh-CN')).toBe('操作失败，请稍后重试')
  })
})
