import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSlots, type SlotStatus } from '../slotSave';

const api = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));

function sentSlots(): string[] {
  return api.put.mock.calls.map((call) => (call[1] as { function_type: string }).function_type);
}

describe('saveSlots', () => {
  const report = vi.fn<(slot: string, status: SlotStatus, message?: string) => void>();

  beforeEach(() => {
    api.put.mockReset();
    report.mockReset();
  });

  it('saves chat first, then the rest', async () => {
    api.put.mockResolvedValue({ success: true });
    const result = await saveSlots(
      [
        { slot: 'fast', model: 'm' },
        { slot: 'chat', model: 'm' },
        { slot: 'video_cut', model: 'm' },
      ],
      'p1',
      report,
    );
    expect(sentSlots()[0]).toBe('chat');
    expect(sentSlots().sort()).toEqual(['chat', 'fast', 'video_cut']);
    expect(result).toEqual({ blockedByChat: false, failed: [] });
  });

  it('sends the same payload shape the settings page sends', async () => {
    api.put.mockResolvedValue({ success: true });
    await saveSlots([{ slot: 'research', model: 'm' }], 'p1', report);
    expect(api.put).toHaveBeenCalledWith('/api/model-settings/assignments', {
      function_type: 'research',
      provider_id: 'p1',
      model_name: 'm',
      temperature: 0.2,
      max_tokens: 128000,
    });
  });

  it('writes nothing else when chat fails (connectivity test)', async () => {
    api.put.mockRejectedValue(new Error('CHAT model connection test failed: 401'));
    const result = await saveSlots(
      [
        { slot: 'chat', model: 'm' },
        { slot: 'fast', model: 'm' },
      ],
      'p1',
      report,
    );
    expect(sentSlots()).toEqual(['chat']);
    expect(result.blockedByChat).toBe(true);
    expect(report).toHaveBeenCalledWith('chat', 'error', expect.stringContaining('401'));
  });

  it('keeps successes when a non-chat slot fails and reports only that slot', async () => {
    api.put.mockImplementation(async (_url: string, body: { function_type: string }) => {
      if (body.function_type === 'vision') throw new Error('vision down');
      return { success: true };
    });
    const result = await saveSlots(
      [
        { slot: 'chat', model: 'm' },
        { slot: 'fast', model: 'm' },
        { slot: 'vision', model: 'm' },
      ],
      'p1',
      report,
    );
    expect(result).toEqual({ blockedByChat: false, failed: ['vision'] });
    expect(report).toHaveBeenCalledWith('fast', 'ok');
  });

  it('never runs more than three slots at once', async () => {
    let inFlight = 0;
    let peak = 0;
    api.put.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { success: true };
    });
    const slots = ['fast', 'video_cut', 'vision', 'research'] as const;
    await saveSlots(slots.map((slot) => ({ slot, model: 'm' })), 'p1', report);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
