import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { SkillSummary } from '@/types/agentSkills';
import ComposerSkillPicker from '../ComposerSkillPicker';
import { buildComposerCommands, visibleCommands } from '../composerCommands';
import { useComposer, type UseComposerParams } from '../useComposer';

const skills: SkillSummary[] = [{
  id: 'explainer-video', name: 'Explainer', description: 'narrated video', version: 1, tools: [],
  requires: [], builtin: true, enabled: true, valid: true, shadowed: false, problem: null,
  body_chars: 10, updated_at: '',
}];
vi.mock('@/lib/api/agentSkills', () => ({ listSkills: vi.fn(async () => skills) }));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.agentContext;
const commands = buildComposerCommands(copy);

function key(init: { key: string }) {
  const preventDefault = vi.fn();
  return {
    event: {
      key: init.key, shiftKey: false, altKey: false, nativeEvent: { isComposing: false },
      currentTarget: { selectionStart: 0 }, preventDefault,
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>,
    preventDefault,
  };
}
const change = (value: string) =>
  ({ target: { value, selectionStart: value.length } }) as unknown as React.ChangeEvent<HTMLTextAreaElement>;

function setup(patch: Partial<UseComposerParams> = {}) {
  const onCommand = vi.fn();
  const params: UseComposerParams = {
    agentMode: true, agentIsExecuting: false, isFinishing: false, isLoading: false,
    steering: undefined, draftRestore: null, materials: [], messages: [], draftScope: null,
    onSendMessage: vi.fn(async () => undefined), onCancel: vi.fn(), commands, onCommand, ...patch,
  };
  const hook = renderHook((props: UseComposerParams) => useComposer(props), { initialProps: params });
  return { ...hook, params, onCommand };
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(cleanup);

describe('visibleCommands', () => {
  it('matches by id and by name, case-insensitively', () => {
    expect(visibleCommands(commands, 'COMP').map(c => c.id)).toEqual(['compact']);
    expect(visibleCommands(commands, 'conver').map(c => c.id)).toEqual(['compact']);
    expect(visibleCommands(commands, 'zzz')).toEqual([]);
  });
});

describe('ComposerSkillPicker with commands', () => {
  const base = { id: 'pick', query: '', activeIndex: 0, onSelect: vi.fn(), onHover: vi.fn() };

  it('lists commands after the skills under their own heading', () => {
    render(<ComposerSkillPicker {...base} status="ready" skills={skills} commands={commands} />);

    const options = screen.getAllByRole('option');

    expect(options.map(o => o.textContent)).toEqual([
      expect.stringContaining('Explainer'), expect.stringContaining('Compact conversation'),
    ]);
    expect(options[1].textContent).toContain('/compact');
    expect(screen.getByText(copy.commandGroup)).toBeTruthy();
  });

  it('selecting the command row calls onSelectCommand, not onSelect', () => {
    const onSelect = vi.fn();
    const onSelectCommand = vi.fn();
    render(<ComposerSkillPicker {...base} onSelect={onSelect} onSelectCommand={onSelectCommand}
      status="ready" skills={skills} commands={commands} />);

    fireEvent.mouseDown(screen.getAllByRole('option')[1]);

    expect(onSelectCommand).toHaveBeenCalledWith(commands[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('with only a command matching, it is the only row', () => {
    render(<ComposerSkillPicker {...base} query="compact" status="ready" skills={skills} commands={commands} />);

    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('shows no command group when none are supplied', () => {
    render(<ComposerSkillPicker {...base} status="ready" skills={skills} />);

    expect(screen.queryByText(copy.commandGroup)).toBeNull();
  });
});

describe('useComposer: /compact', () => {
  it('opens the menu on "/" and arrow-down + Enter runs the command, clearing the input', () => {
    const { result, onCommand } = setup();
    act(() => result.current.handleChange(change('/compact')));
    expect(result.current.pickerOpen).toBe(true);

    // no skill matches "compact", so the command is the first row
    const { event, preventDefault } = key({ key: 'Enter' });
    act(() => result.current.handleKeyDown(event));

    expect(onCommand).toHaveBeenCalledWith(commands[0]);
    expect(result.current.text).toBe('');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('keyboard parity: a command sits after the skills in the arrow-key order', async () => {
    const { result, onCommand } = setup();
    act(() => result.current.handleChange(change('/')));
    await act(async () => { await Promise.resolve(); });

    act(() => result.current.handleKeyDown(key({ key: 'ArrowDown' }).event));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.handleKeyDown(key({ key: 'Enter' }).event));

    expect(onCommand).toHaveBeenCalledWith(commands[0]);
  });

  it('Escape closes the menu without running anything', () => {
    const { result, onCommand } = setup();
    act(() => result.current.handleChange(change('/compact')));

    act(() => result.current.handleKeyDown(key({ key: 'Escape' }).event));

    expect(result.current.pickerOpen).toBe(false);
    expect(onCommand).not.toHaveBeenCalled();
    expect(result.current.text).toBe('/compact');
  });

  it('keeps other text the user typed on earlier lines', () => {
    const { result, onCommand } = setup();
    act(() => result.current.handleChange(change('keep this\n/compact')));

    act(() => result.current.selectCommand(commands[0]));

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(result.current.text).toBe('keep this\n');
  });

  it('offers no commands while the agent runs (the menu is closed then)', () => {
    const { result, onCommand } = setup({ agentIsExecuting: true, steering: undefined });
    act(() => result.current.handleChange(change('/compact')));

    expect(result.current.pickerOpen).toBe(false);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('without commands, Enter on an unmatched "/word" sends it as a normal message, as before', () => {
    const { result, params } = setup({ commands: undefined, onCommand: undefined });
    act(() => result.current.handleChange(change('/compact')));

    act(() => result.current.handleKeyDown(key({ key: 'Enter' }).event));

    expect(params.onSendMessage).toHaveBeenCalledWith('/compact');
  });
});
