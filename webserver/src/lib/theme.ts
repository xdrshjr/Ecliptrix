/**
 * Theme persistence.
 *
 * One storage key, one class vocabulary (`dark` / `light` on `<html>`), and one
 * boot script. The script and the toggle must agree on all three or a user sees
 * a flash of the wrong theme on every navigation — the reason the script exists
 * separately from the toggle is that it has to run before React.
 */

export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'ecs-theme'
export const THEME_CLASSES: readonly Theme[] = ['dark', 'light']
export const DEFAULT_THEME: Theme = 'dark'

/**
 * Inline first-paint script.
 *
 * Kept as a string because it is injected with `dangerouslySetInnerHTML` in the
 * document head: anything that has not executed before the body renders is too
 * late to prevent the flash.
 */
export const THEME_BOOT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : (prefersLight ? 'light' : 'dark');
    var root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    root.style.colorScheme = theme;
  } catch (error) {
    document.documentElement.classList.add('dark');
  }
})();
`

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

/** Stored preference, or null when the user never chose one. */
export function readStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    // Private mode / disabled storage: fall back to the system preference.
    return null
  }
}

/** Theme currently painted on `<html>`; `DEFAULT_THEME` when nothing is set. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME
  const classes = document.documentElement.classList
  if (classes.contains('light')) return 'light'
  if (classes.contains('dark')) return 'dark'
  return DEFAULT_THEME
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

/**
 * Paint a theme and remember it.
 *
 * The class swap happens before the storage write so a quota error cannot leave
 * the page on the old theme after the user asked for the new one.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove(...THEME_CLASSES)
  root.classList.add(theme)
  root.style.colorScheme = theme
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The visual change stands for this session; only persistence is lost.
  }
}
