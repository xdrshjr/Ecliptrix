/**
 * Defensive date formatting helpers.
 *
 * Persisted state (localStorage) often loses Date typing across `JSON.parse`,
 * leaving callers with strings or numbers. These helpers normalize any
 * Date | string | number | null | undefined input, returning a safe fallback
 * string when the value cannot be parsed instead of throwing on
 * `(undefined).toLocaleDateString()`.
 */
export const toDate = (
  v: Date | string | number | null | undefined,
): Date | null => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

export const formatDate = (
  v: Date | string | number | null | undefined,
  locales?: string | string[],
  options?: Intl.DateTimeFormatOptions,
  fallback = '',
): string => {
  const d = toDate(v);
  return d ? d.toLocaleDateString(locales, options) : fallback;
};

export const formatTime = (
  v: Date | string | number | null | undefined,
  locales?: string | string[],
  options?: Intl.DateTimeFormatOptions,
  fallback = '',
): string => {
  const d = toDate(v);
  return d ? d.toLocaleTimeString(locales, options) : fallback;
};
