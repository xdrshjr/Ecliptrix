import { afterEach, describe, expect, it, vi } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { fetchCapabilityStatus, isGap, type CapabilityStatus } from '../setupStatus';

afterEach(() => vi.restoreAllMocks());

function respond(capabilities: unknown[]) {
  vi.spyOn(httpModule.http, 'get').mockResolvedValue({
    success: true,
    data: { capabilities },
  } as never);
}

const wire = (overrides: Record<string, unknown>) => ({
  id: 'chat',
  tier: 'core',
  state: 'ready',
  ...overrides,
});

describe('fetchCapabilityStatus forward compatibility', () => {
  it('keeps the relay source and the unavailable state', async () => {
    respond([wire({ state: 'unavailable', source: 'router', provider_name: 'SkillRouter' })]);
    const [item] = await fetchCapabilityStatus();
    expect(item.state).toBe('unavailable');
    expect(item.source).toBe('router');
    expect(item.providerName).toBe('SkillRouter');
  });

  it('degrades an unknown state to indeterminate instead of throwing', async () => {
    respond([wire({ state: 'quantum' })]);
    const [item] = await fetchCapabilityStatus();
    expect(item.state).toBe('indeterminate');
    expect(isGap(item)).toBe(false);
  });

  it('degrades an unknown source to none and defaults a missing one', async () => {
    respond([wire({ source: 'satellite' }), wire({ id: 'fast' })]);
    const items = await fetchCapabilityStatus();
    expect(items.map((item) => item.source)).toEqual(['none', 'none']);
  });
});

describe('isGap', () => {
  const make = (state: CapabilityStatus['state']): CapabilityStatus => ({
    id: 'tts',
    tier: 'extended',
    state,
    source: 'none',
  });

  it.each(['missing', 'invalid', 'unavailable'] as const)('treats %s as a gap', (state) => {
    expect(isGap(make(state))).toBe(true);
  });

  it.each(['ready', 'inherited', 'indeterminate'] as const)('does not treat %s as a gap', (state) => {
    expect(isGap(make(state))).toBe(false);
  });
});
