import { THEME_BOOT_SCRIPT } from '@/lib/theme'

/**
 * First-paint theme script.
 *
 * Runs before React hydrates so the correct theme is on `<html>` in the very
 * first frame. Without it, a light-mode user sees a dark flash on every
 * navigation — the single most noticeable polish defect in a themed console.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
}
