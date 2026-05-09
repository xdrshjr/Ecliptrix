/**
 * Tiny dev-only logger.
 *
 * Behavior:
 *   - In development (NODE_ENV !== 'production'): always logs.
 *   - In production: silent unless the user opts in at runtime via
 *     `window.__ECLIPTRIX_DEBUG__ = true` (set from devtools when field
 *     debugging is needed — no redeploy required).
 *
 * Use this in place of `console.log` for chat / workflow render-path logs.
 * Keep `console.error` and `console.warn` for unexpected failures.
 */
declare global {
  interface Window {
    __ECLIPTRIX_DEBUG__?: boolean;
  }
}

const isProd = process.env.NODE_ENV === 'production';

const enabled = (): boolean => {
  if (!isProd) return true;
  if (typeof window === 'undefined') return false;
  return window.__ECLIPTRIX_DEBUG__ === true;
};

export const dlog = (...args: unknown[]): void => {
  if (enabled()) console.log(...args);
};

export const dwarn = (...args: unknown[]): void => {
  if (enabled()) console.warn(...args);
};
