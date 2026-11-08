import { describe, expect, it } from 'vitest';
import { translations } from '@/lib/i18n';

/**
 * 登录闸门文案的 en / zh 对称性
 * （docs/plans/desktop-account-login-gate/spec.md §8.2 / AC-27）。
 *
 * `Translations` 接口与 `Record<string, Translations>` 已由 `tsc` 保证形状一致；
 * 这条用例补的是「两语言字典运行期真的同形」——多一个键或少一个键都会红。
 */

/** Leaf paths of a nested dictionary, e.g. `error.invalidCredentials`. */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe('i18n：登录闸门文案', () => {
  it('declares exactly the same auth keys in every locale', () => {
    const locales = Object.keys(translations);
    expect(locales.length).toBeGreaterThanOrEqual(2);
    const reference = leafPaths(translations.en.auth).sort();
    for (const locale of locales) {
      expect(leafPaths(translations[locale].auth).sort(), `locale ${locale} vs en`).toEqual(
        reference
      );
    }
    // §8.2 lists 65 keys; the implementation adds the copy the design's §2.8
    // requirements need (see spec.md 「实施过程发现的方案缺陷」 D-12).
    expect(reference.length).toBeGreaterThanOrEqual(80);
  });

  it('has no empty auth strings', () => {
    for (const locale of Object.values(translations)) {
      for (const path of leafPaths(locale.auth)) {
        const value = path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], locale.auth);
        expect(typeof value, path).toBe('string');
        expect((value as string).trim().length, path).toBeGreaterThan(0);
      }
    }
  });
});
