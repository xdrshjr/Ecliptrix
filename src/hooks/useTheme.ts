'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ThemeControls {
  /** Whether the dark theme is currently active. */
  isDark: boolean;
  /** Toggle between the dark and light themes, persisting the choice. */
  toggleTheme: () => void;
}

/**
 * Dark/light theme toggle, extracted from the inline hook in `Header` so the
 * shared `HeaderActions` cluster can own a single copy (spec §2.1).
 *
 * Reads the initial value off the `<html>` `dark` class (set by the early boot
 * script before hydration) and writes both `ecliptrix-theme` and
 * `ecliptrix-theme-pref` on toggle, alongside the `dark`/`light` class and
 * `colorScheme` — key names and effects are unchanged from the original.
 */
export function useTheme(): ThemeControls {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const html = document.documentElement;
    setIsDark(html.classList.contains('dark'));
  }, []);

  const toggleTheme = useCallback(() => {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
      html.classList.replace('dark', 'light');
      html.style.colorScheme = 'light';
      localStorage.setItem('ecliptrix-theme', 'light');
      localStorage.setItem('ecliptrix-theme-pref', 'light');
      setIsDark(false);
    } else {
      html.classList.replace('light', 'dark');
      html.style.colorScheme = 'dark';
      localStorage.setItem('ecliptrix-theme', 'dark');
      localStorage.setItem('ecliptrix-theme-pref', 'dark');
      setIsDark(true);
    }
  }, []);

  return { isDark, toggleTheme };
}
