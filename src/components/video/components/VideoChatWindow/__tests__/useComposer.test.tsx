import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem } from '@/types';
import type { SkillSummary } from '@/types/agentSkills';
import { useComposer, type UseComposerParams } from '../useComposer';

const skills: SkillSummary[] = [
  { id: 'explainer-video', name: 'Explainer', description: 'narrated video', version: 1, tools: [],
    requires: [], builtin: true, enabled: true, valid: true, shadowed: false, problem: null,
    body_chars: 10, updated_at: '' },
  { id: 'final-qc', name: 'Final QC', description: 'check before export', version: 1, tools: [],
    requires: [], builtin: true, enabled: true, valid: true, shadowed: false, problem: null,
    body_chars: 10, updated_at: '' },
];

vi.mock('@/lib/api/agentSkills', () => ({ listSkills: vi.fn(async () => skills) }));

const material = (id: string, name: string): MaterialItem => ({
  id, name, type: 'video', format: 'mp4', size: 0, url: '/x', createdAt: new Date(0),
});

function key(init: Partial<{
  key: string; shiftKey: boolean; altKey: boolean; isComposing: boolean; selectionStart: number;
}>) {
  const preventDefault = vi.fn();
  const event = {
    key: init.key ?? 'Enter', shiftKey: init.shiftKey ?? false, altKey: init.altKey ?? false,
    nativeEvent: { isComposing: init.isComposing ?? false },
    currentTarget: { selectionStart: init.selectionStart ?? 0 },
    preventDefault,
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
  return { event, preventDefault };
}

function change(value: string) {
  return { target: { value, selectionStart: value.length } } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
}

function setup(overrides: Partial<UseComposerParams> = {}) {
  const params: UseComposerParams = {
    agentMode: true, agentIsExecuting: false, isFinishing: false, isLoading: false,
    steering: undefined, draftRestore: null, materials: [], messages: [], draftScope: null,
    onSendMessage: vi.fn(async () => undefined), onCancel: vi.fn(), ...overrides,
  };
  const hook = renderHook((props: UseComposerParams) => useComposer(props), { initialProps: params });
  return { ...hook, params };
}

const steeringStub = () => ({
  notes: [], queued: [], runId: 'run', submit: vi.fn(() => 'accepted' as const),
  cancelNote: vi.fn(), promoteToStop: vi.fn(), startTurn: vi.fn(), onRunStarted: vi.fn(),
  onRestart: vi.fn(), onSteerApplied: vi.fn(), onSteerDropped: vi.fn(), onTurnEnd: vi.fn(),
});

beforeEach(() => { window.localStorage.clear(); });
afterEach(cleanup);

describe('idle: Enter sends exactly like before (AC-A1)', () => {
  it('sends the trimmed text once and clears the box', () => {
    const { result, params } = setup();
    act(() => result.current.handleChange(change('  make a video  ')));
    const { event, preventDefault } = key({});
    act(() => result.current.handleKeyDown(event));
    expect(preventDefault).toHaveBeenCalled();
    expect(params.onSendMessage).toHaveBeenCalledWith('make a video');
    expect(result.current.text).toBe('');
  });

  it('Shift+Enter does not send', () => {
    const { result, params } = setup();
    act(() => result.current.handleChange(change('line')));
    act(() => result.current.handleKeyDown(key({ shiftKey: true }).event));
    expect(params.onSendMessage).not.toHaveBeenCalled();
  });

  it('ignores Enter while an IME composition is active (AC-B9)', () => {
    const { result, params } = setup();
    act(() => result.current.handleChange(change('にほん')));
    const { event, preventDefault } = key({ isComposing: true });
    act(() => result.current.handleKeyDown(event));
    expect(params.onSendMessage).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('Alt+Enter is a plain send when nothing is running', () => {
    const { result, params } = setup();
    act(() => result.current.handleChange(change('go')));
    act(() => result.current.handleKeyDown(key({ altKey: true }).event));
    expect(params.onSendMessage).toHaveBeenCalledWith('go');
  });
});

describe('running (AC-A1, AC-A6)', () => {
  it('Enter steers and Alt+Enter queues, keeping the text when the queue is full', () => {
    const steering = steeringStub();
    const { result } = setup({ agentIsExecuting: true, steering });
    act(() => result.current.handleChange(change('turn vertical')));
    act(() => result.current.handleKeyDown(key({}).event));
    expect(steering.submit).toHaveBeenLastCalledWith('turn vertical', 'steer');
    expect(result.current.text).toBe('');

    act(() => result.current.handleChange(change('later')));
    act(() => result.current.handleKeyDown(key({ altKey: true }).event));
    expect(steering.submit).toHaveBeenLastCalledWith('later', 'queue');

    steering.submit.mockReturnValueOnce('full' as never);
    act(() => result.current.handleChange(change('overflow')));
    act(() => result.current.handleKeyDown(key({}).event));
    expect(result.current.text).toBe('overflow');
  });

  it('queues instead of steering once the stream is finishing', () => {
    const steering = steeringStub();
    const { result } = setup({ agentIsExecuting: true, isFinishing: true, steering });
    act(() => result.current.handleChange(change('x')));
    act(() => result.current.handleKeyDown(key({}).event));
    expect(steering.submit).toHaveBeenCalledWith('x', 'queue');
  });

  it('without a steering layer the input stays locked while the agent runs', () => {
    const { result } = setup({ agentIsExecuting: true });
    expect(result.current.disabled).toBe(true);
    expect(setup({ agentIsExecuting: true, steering: steeringStub() }).result.current.disabled).toBe(false);
  });

  it('Esc needs two presses to stop (AC-C4); the first only shows the hint', () => {
    vi.useFakeTimers();
    const { result, params } = setup({ agentIsExecuting: true, steering: steeringStub() });
    act(() => result.current.handleKeyDown(key({ key: 'Escape' }).event));
    expect(result.current.escArmed).toBe(true);
    expect(params.onCancel).not.toHaveBeenCalled();
    act(() => result.current.handleKeyDown(key({ key: 'Escape' }).event));
    expect(params.onCancel).toHaveBeenCalledTimes(1);
    expect(result.current.escArmed).toBe(false);
    vi.useRealTimers();
  });

  it('the Esc hint expires after 1.5 s', () => {
    vi.useFakeTimers();
    const { result, params } = setup({ agentIsExecuting: true, steering: steeringStub() });
    act(() => result.current.handleKeyDown(key({ key: 'Escape' }).event));
    act(() => { vi.advanceTimersByTime(1_600); });
    expect(result.current.escArmed).toBe(false);
    act(() => result.current.handleKeyDown(key({ key: 'Escape' }).event));
    expect(params.onCancel).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('skill picker (AC-B9)', () => {
  it('opens on "/", filters, navigates with arrows, selects with Enter and sends skillId', async () => {
    const { result, params } = setup();
    act(() => result.current.handleChange(change('/')));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.pickerOpen).toBe(true);
    expect(result.current.pickerKind).toBe('skill');

    act(() => result.current.handleKeyDown(key({ key: 'ArrowDown' }).event));
    expect(result.current.activeIndex).toBe(1);
    const { preventDefault } = key({ key: 'Enter' });
    act(() => result.current.handleKeyDown(key({ key: 'Enter' }).event));
    expect(preventDefault).not.toBe(undefined);
    expect(result.current.skill).toEqual({ id: 'final-qc', name: 'Final QC' });
    expect(result.current.text).toBe('');
    expect(params.onSendMessage).not.toHaveBeenCalled();

    act(() => result.current.handleChange(change('check it')));
    act(() => result.current.handleKeyDown(key({}).event));
    expect(params.onSendMessage).toHaveBeenCalledWith('check it', { skillId: 'final-qc' });
    expect(result.current.skill).toBeNull();
  });

  it('Esc closes the picker without clearing the text or stopping the run', async () => {
    const { result, params } = setup();
    act(() => result.current.handleChange(change('/ex')));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.pickerOpen).toBe(true);
    act(() => result.current.handleKeyDown(key({ key: 'Escape' }).event));
    expect(result.current.pickerOpen).toBe(false);
    expect(result.current.text).toBe('/ex');
    expect(params.onCancel).not.toHaveBeenCalled();
  });

  it('does not open while the agent is running (a skill is a turn-start concept)', () => {
    const { result } = setup({ agentIsExecuting: true, steering: steeringStub() });
    act(() => result.current.handleChange(change('/')));
    expect(result.current.pickerOpen).toBe(false);
  });

  it('does not open outside agent mode', () => {
    const { result } = setup({ agentMode: false });
    act(() => result.current.handleChange(change('/')));
    expect(result.current.pickerOpen).toBe(false);
  });
});

describe('@ mentions (AC-C6)', () => {
  it('inserts @name, sends only the mentions still in the text', () => {
    const { result, params } = setup({ materials: [material('m1', 'a.mp4'), material('m2', 'b.mp4')] });
    act(() => result.current.handleChange(change('cut @a')));
    expect(result.current.pickerKind).toBe('mention');
    act(() => result.current.handleKeyDown(key({ key: 'Enter' }).event));
    expect(result.current.text).toBe('cut @a.mp4 ');

    act(() => result.current.handleChange(change('cut @a.mp4 and @b')));
    act(() => result.current.handleKeyDown(key({ key: 'Tab' }).event));
    expect(result.current.text).toBe('cut @a.mp4 and @b.mp4 ');

    act(() => result.current.handleChange(change('cut @a.mp4 now')));
    act(() => result.current.handleKeyDown(key({}).event));
    expect(params.onSendMessage).toHaveBeenCalledWith('cut @a.mp4 now',
      { mentions: [{ materialId: 'm1', label: 'a.mp4' }] });
  });
});

describe('history (↑)', () => {
  it('recalls the previous message when the box is empty, and ↓ goes back', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'older', timestamp: new Date(0) },
      { id: '2', role: 'user' as const, content: 'newer', timestamp: new Date(0) },
    ];
    const { result } = setup({ messages });
    const up = key({ key: 'ArrowUp' });
    act(() => result.current.handleKeyDown(up.event));
    expect(up.preventDefault).toHaveBeenCalled();
    expect(result.current.text).toBe('newer');
    act(() => result.current.handleKeyDown(key({ key: 'ArrowDown' }).event));
    expect(result.current.text).toBe('');
  });
});

describe('draft restore from the steering layer', () => {
  it('appends restored text to what the user already typed and never loses it', () => {
    const { result, rerender, params } = setup();
    act(() => result.current.handleChange(change('typing')));
    rerender({ ...params, draftRestore: { text: 'queued note', nonce: 1 } });
    expect(result.current.text).toBe('typing\n\nqueued note');
    rerender({ ...params, draftRestore: { text: 'queued note', nonce: 1 } });
    expect(result.current.text).toBe('typing\n\nqueued note');
  });
});
