import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import SettingsSidebar from '../SettingsSidebar';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));

describe('SettingsSidebar AI source entry', () => {
  it('is the first item of the AI configuration group and opens the skillrouter panel', () => {
    const onSelectItem = vi.fn();
    render(<SettingsSidebar activeItem="general" onSelectItem={onSelectItem} />);
    const group = screen.getByRole('navigation', { name: translations['zh-CN'].adminSettings.groupAi });
    const first = within(group).getAllByRole('button')[0];
    expect(first.textContent).toContain('能力来源');
    fireEvent.click(first);
    expect(onSelectItem).toHaveBeenCalledWith('skillrouter');
  });
});
