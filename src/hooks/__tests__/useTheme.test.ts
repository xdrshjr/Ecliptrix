/**
 * Tests for `useTheme` (desktop-header-into-titlebar §6).
 *
 * The hook was extracted from `Header` so the shared `HeaderActions` cluster
 * owns a single copy. These cover the two behaviours the spec calls out:
 * reading the initial dark state off the `<html>` `dark` class, and toggling —
 * which must flip the `dark`/`light` class and write both persisted keys
 * (`ecliptrix-theme` / `ecliptrix-theme-pref`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../useTheme';

beforeEach(() => {
  const html = document.documentElement;
  html.classList.remove('dark', 'light');
  localStorage.clear();
});

describe('useTheme', () => {
  it('reads the initial dark state from the <html> class', () => {
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(true);
  });

  it('reads a non-dark <html> as light', () => {
    document.documentElement.classList.add('light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
  });

  it('toggles dark → light, flipping the class and both persisted keys', () => {
    const html = document.documentElement;
    html.classList.add('dark');
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(html.classList.contains('light')).toBe(true);
    expect(html.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('ecliptrix-theme')).toBe('light');
    expect(localStorage.getItem('ecliptrix-theme-pref')).toBe('light');
    expect(result.current.isDark).toBe(false);
  });

  it('toggles light → dark, flipping the class and both persisted keys', () => {
    const html = document.documentElement;
    html.classList.add('light');
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(html.classList.contains('dark')).toBe(true);
    expect(html.classList.contains('light')).toBe(false);
    expect(localStorage.getItem('ecliptrix-theme')).toBe('dark');
    expect(localStorage.getItem('ecliptrix-theme-pref')).toBe('dark');
    expect(result.current.isDark).toBe(true);
  });
});
