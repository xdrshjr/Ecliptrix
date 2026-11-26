// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Type, validateToolArguments } from '@mariozechner/pi-ai';
import { createBrowserTools } from '../browserTools';
import type { ToolContext } from '../../types';

/**
 * agent-browser-workspace spec §4.4.1 / R2-5: the new browser schemas must be a
 * strict SUPERSET of the pre-workspace ones. The four baseline schemas are kept
 * inline (copied from the tree before the change) so the guarantee cannot rot
 * together with the code it protects.
 */
const session_id = Type.String({ format: 'uuid' });
const snapshot_version = Type.Integer({ minimum: 1 });
const element_ref = Type.String({ minLength: 1, maxLength: 64 });
const BASELINE_ACT = Type.Union([
  Type.Object({ session_id, snapshot_version, action: Type.Literal('click'), element_ref }, { additionalProperties: false }),
  Type.Object({ session_id, snapshot_version, action: Type.Literal('fill'), element_ref,
    text: Type.String({ maxLength: 256 }) }, { additionalProperties: false }),
  Type.Object({ session_id, snapshot_version, action: Type.Literal('press'), element_ref,
    key: Type.Literal('Enter') }, { additionalProperties: false }),
  Type.Object({ session_id, snapshot_version, action: Type.Literal('scroll'),
    delta_y: Type.Integer({ minimum: -1440, maximum: 1440 }) }, { additionalProperties: false }),
], { type: 'object' });
const BASELINE = {
  browser_open: Type.Object({ url: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
  browser_read: Type.Object({ session_id, max_bytes: Type.Optional(Type.Integer({ minimum: 500, maximum: 8000 })),
    screenshot: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  browser_act: BASELINE_ACT,
  browser_close: Type.Object({ session_id }, { additionalProperties: false }),
} as const;

const SID = '123e4567-e89b-42d3-a456-426614174000';
const LEGACY_CALLS: Record<keyof typeof BASELINE, Record<string, unknown>[]> = {
  browser_open: [{ url: 'https://example.com/news' }],
  browser_read: [{ session_id: SID }, { session_id: SID, max_bytes: 4000, screenshot: true }],
  browser_act: [
    { session_id: SID, snapshot_version: 3, action: 'click', element_ref: 'e1' },
    { session_id: SID, snapshot_version: 3, action: 'fill', element_ref: 'e2', text: 'cats' },
    { session_id: SID, snapshot_version: 3, action: 'press', element_ref: 'e2', key: 'Enter' },
    { session_id: SID, snapshot_version: 3, action: 'scroll', delta_y: 600 },
  ],
  browser_close: [{ session_id: SID }],
};

function context(autonomy?: 'yolo'): ToolContext {
  return { timelineState: {} as never, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => ({ applied: true as const }),
    recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 }, autonomy };
}

function validate(name: string, args: Record<string, unknown>): boolean {
  const tool = createBrowserTools(context()).find(item => item.name === name)!;
  try {
    validateToolArguments(tool as never, { type: 'toolCall', id: 'x', name, arguments: args } as never);
    return true;
  } catch { return false; }
}

describe('browser tool schemas (strict superset of the baseline)', () => {
  it('keeps every legacy call valid', () => {
    for (const [name, calls] of Object.entries(LEGACY_CALLS)) {
      for (const args of calls) expect(validate(name, args), `${name} ${JSON.stringify(args)}`).toBe(true);
    }
  });

  it('exposes the four legacy names plus the save and hand-off tools', () => {
    const names = createBrowserTools(context()).map(tool => tool.name);
    // `browser_save_image` sits BEFORE the YOLO early return (it never waits on a
    // human), so it precedes `browser_request_user` in the interactive list.
    expect(names).toEqual(['browser_open', 'browser_read', 'browser_act', 'browser_close',
      'browser_save_image', 'browser_request_user']);
    expect(Object.keys(BASELINE).every(name => names.includes(name))).toBe(true);
  });

  it('accepts the new workspace actions and optional fields', () => {
    expect(validate('browser_open', { url: 'https://a.com', new_tab: true })).toBe(true);
    expect(validate('browser_read', { session_id: SID, elements_max: 120 })).toBe(true);
    const base = { session_id: SID, snapshot_version: 2 };
    for (const args of [
      { ...base, action: 'press', key: 'Escape' },
      { ...base, action: 'press', element_ref: 'e3', key: 'Tab' },
      { ...base, action: 'fill', element_ref: 'e2', text: 'x'.repeat(512) },
      { ...base, action: 'select', element_ref: 'e4', option_text: 'Option' },
      { ...base, action: 'hover', element_ref: 'e4' },
      { session_id: SID, action: 'back' },
      { session_id: SID, action: 'forward' },
      { session_id: SID, action: 'reload' },
      { session_id: SID, action: 'wait', until_text: 'Done', timeout_ms: 5000 },
      { session_id: SID, action: 'wait', ms: 1000 },
    ]) expect(validate('browser_act', args), JSON.stringify(args)).toBe(true);
  });

  it('keeps additionalProperties:false and the numeric bounds', () => {
    expect(validate('browser_open', { url: 'https://a.com', extra: 1 })).toBe(false);
    expect(validate('browser_read', { session_id: SID, elements_max: 10 })).toBe(false);
    expect(validate('browser_act', { session_id: SID, snapshot_version: 1, action: 'scroll',
      delta_y: 5000 })).toBe(false);
    expect(validate('browser_act', { session_id: SID, snapshot_version: 1, action: 'click',
      element_ref: 'e1', stray: true })).toBe(false);
    expect(validate('browser_act', { session_id: SID, snapshot_version: 1, action: 'fill',
      element_ref: 'e1', text: 'x'.repeat(513) })).toBe(false);
    expect(validate('browser_act', { session_id: SID, snapshot_version: 1, action: 'press',
      key: 'F13' })).toBe(false);
  });

  it('validates browser_request_user input', () => {
    expect(validate('browser_request_user', { reason: 'log in to Zhihu', kind: 'login' })).toBe(true);
    expect(validate('browser_request_user', { reason: 'x', kind: 'captcha', timeout_s: 120,
      handoff_id: SID })).toBe(true);
    expect(validate('browser_request_user', { reason: '', kind: 'login' })).toBe(false);
    expect(validate('browser_request_user', { reason: 'x', kind: 'payment' })).toBe(false);
    expect(validate('browser_request_user', { reason: 'x', kind: 'login', timeout_s: 5 })).toBe(false);
  });

  it('removes browser_request_user in YOLO, like ask_user (AC-A6)', () => {
    const names = createBrowserTools(context('yolo')).map(tool => tool.name);
    expect(names).not.toContain('browser_request_user');
    expect(names).toContain('browser_open');
  });
});
