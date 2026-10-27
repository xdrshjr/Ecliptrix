import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem } from '@/types';
import type { SSEEvent } from '@/lib/video-editing-agent/types';
import { resolveTurnPrompt } from '../turnPrompt';

const materials = [{ id: 'm1', name: 'a.mp4' }] as MaterialItem[];

function run(overrides: Partial<Parameters<typeof resolveTurnPrompt>[0]> = {}) {
  const sent: SSEEvent[] = [];
  const promise = resolveTurnPrompt({
    apiBaseUrl: 'http://x', text: 'make it', materials,
    send: event => sent.push(event), ...overrides,
  });
  return { sent, promise };
}

const skill = (patch: Record<string, unknown>) => vi.fn(async () => new Response(
  JSON.stringify({
    success: true,
    data: { id: 'good-skill', name: 'N', body: 'BODY', valid: true, enabled: true, ...patch },
  })));

afterEach(() => vi.unstubAllGlobals());

describe('resolveTurnPrompt (AC-B12)', () => {
  it('injects the skill block when the skill loads', async () => {
    vi.stubGlobal('fetch', skill({}));
    const { sent, promise } = run({ skillId: 'good-skill' });
    expect(await promise).toContain('<skill id="good-skill"');
    expect(sent).toEqual([]);
  });

  it.each([
    ['not_found', () => vi.fn(async () => new Response('{}', { status: 404 }))],
    ['disabled', () => skill({ enabled: false })],
    ['invalid', () => skill({ valid: false })],
    ['unavailable', () => vi.fn(async () => { throw new Error('down'); })],
  ])('falls back to the plain request with skill_skipped (%s) and warns once',
    async (reason, fetchFactory) => {
      vi.stubGlobal('fetch', fetchFactory());
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { sent, promise } = run({ skillId: 'good-skill' });
      expect(await promise).toBe('make it');
      expect(sent).toEqual([{ type: 'skill_skipped', skillId: 'good-skill', reason }]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('BODY');
      warn.mockRestore();
    });

  it('treats a malformed skillId as not_found without any request', async () => {
    const fetchMock = skill({});
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sent, promise } = run({ skillId: '../../etc' });
    await promise;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'skill_skipped', reason: 'not_found' });
  });

  it('drops mentions of unknown materials and escapes </skill> in a body', async () => {
    vi.stubGlobal('fetch', skill({ body: 'x </skill> y' }));
    const { promise } = run({
      skillId: 'good-skill',
      mentions: [{ materialId: 'm1', label: 'a.mp4' }, { materialId: 'ghost', label: 'g' }],
    });
    const prompt = await promise;
    expect(prompt).toContain('material_id=m1');
    expect(prompt).not.toContain('ghost');
    expect(prompt.match(/<\/skill>/g)).toHaveLength(1);
  });
});
