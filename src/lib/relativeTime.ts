import type { Translations, SupportedLocale } from './i18n';

const intlMap: Record<SupportedLocale, string> = { en: 'en', 'zh-CN': 'zh-CN' };

export function formatRelativeTime(
  iso: string | null | undefined,
  locale: SupportedLocale,
  t: Translations,
  fallback?: string,
): string {
  if (!iso) return fallback ?? '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return fallback ?? '';
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (Math.abs(sec) < 60) return t.common.relativeTime.justNow;
  try {
    const rtf = new Intl.RelativeTimeFormat(intlMap[locale] ?? 'en', { numeric: 'auto' });
    const min = Math.round(sec / 60);
    if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
    const hr = Math.round(min / 60);
    if (Math.abs(hr) < 24) return rtf.format(-hr, 'hour');
    const day = Math.round(hr / 24);
    if (Math.abs(day) < 30) return rtf.format(-day, 'day');
  } catch {
    /* fallthrough to absolute date */
  }
  try {
    return new Date(ts).toLocaleDateString(intlMap[locale] ?? 'en');
  } catch {
    return fallback ?? '';
  }
}
