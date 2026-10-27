import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { SkillSummary } from '@/types/agentSkills';
import ComposerSkillPicker, { visibleSkills } from '../ComposerSkillPicker';
import ComposerMentionPicker from '../ComposerMentionPicker';
import { pickerOptionId } from '../ComposerPicker';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.agentCollab;

function skill(id: string, patch: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id, name: `Name ${id}`, description: `desc ${id}`, version: 1, tools: [], requires: [],
    builtin: true, enabled: true, valid: true, shadowed: false, problem: null,
    body_chars: 1, updated_at: '', ...patch,
  };
}

afterEach(cleanup);

describe('visibleSkills', () => {
  it('lists only enabled, valid, non-shadowed skills and filters by id/name/description', () => {
    const list = [
      skill('alpha-one'), skill('beta-two', { enabled: false }), skill('gamma-three', { valid: false }),
      skill('delta-four', { shadowed: true }), skill('news-digest', { description: 'Weekly NEWS' }),
    ];
    expect(visibleSkills(list, '').map(item => item.id)).toEqual(['alpha-one', 'news-digest']);
    expect(visibleSkills(list, 'news').map(item => item.id)).toEqual(['news-digest']);
  });
});

describe('ComposerSkillPicker', () => {
  const base = { id: 'pick', query: '', activeIndex: 1, onSelect: vi.fn(), onHover: vi.fn() };

  it('is a listbox of options with the active one marked, ids matching aria-activedescendant', () => {
    render(<ComposerSkillPicker {...base} status="ready"
      skills={[skill('alpha-one'), skill('beta-two', { builtin: false })]} />);
    const listbox = screen.getByRole('listbox', { name: copy.skillPickerLabel });
    const options = screen.getAllByRole('option');
    expect(listbox.id).toBe('pick');
    expect(options).toHaveLength(2);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(options[1].id).toBe(pickerOptionId('pick', 1));
    expect(options[0].textContent).toContain(copy.skillBuiltinBadge);
    expect(options[1].textContent).toContain(copy.skillMineBadge);
  });

  it('dims a skill whose capability is unavailable but still lets it be chosen', () => {
    const onSelect = vi.fn();
    render(<ComposerSkillPicker {...base} onSelect={onSelect} status="ready"
      skills={[skill('news-digest', { requires: ['web'] })]} unavailable={new Set(['web'])} />);
    const option = screen.getByRole('option');
    expect(option.textContent).toContain('Needs: web');
    fireEvent.mouseDown(option);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects on mouse down without stealing focus', () => {
    render(<ComposerSkillPicker {...base} status="ready" skills={[skill('alpha-one')]} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole('option'));
    expect(notPrevented).toBe(false);
  });

  it.each([
    ['error', [], copy.skillLoadFailed],
    ['ready', [], copy.skillEmpty],
    ['ready', [skill('alpha-one')], copy.skillNoMatch],
  ] as const)('shows a status message for %s / %i skills', (status, skills, text) => {
    render(<ComposerSkillPicker {...base} status={status} skills={skills} query="zzz" />);
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('ComposerMentionPicker', () => {
  it('lists at most 8 matching materials with type, duration and size', () => {
    const materials = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, name: `clip-${i}.mp4`, type: 'video' as const, format: 'mp4', size: 0,
      url: '/x', createdAt: new Date(0), duration: 4.5, width: 1920, height: 1080,
    }));
    render(<ComposerMentionPicker id="mention" query="clip" materials={materials}
      activeIndex={0} onSelect={vi.fn()} onHover={vi.fn()} />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(8);
    expect(options[0].textContent).toContain('video · 4.5s · 1920×1080');
  });

  it('says so when the project has no materials', () => {
    render(<ComposerMentionPicker id="mention" query="" materials={[]}
      activeIndex={0} onSelect={vi.fn()} onHover={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe(copy.mentionEmpty);
  });
});
