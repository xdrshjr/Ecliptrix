import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import AgentToolkitSettingsPanel from '../AgentToolkitSettingsPanel';
import {
  CREW_MEMORY_DEFAULTS, crewMemoryFrom, crewMemoryPayload, hasCrewMemoryRangeError,
} from '../agentCrewMemorySettings';

const copy = translations.en.agentSettings;
const SAVE_LABEL = translations.en.adminSettings.save;

const settingsApi = vi.hoisted(() => ({
  getCategorySettings: vi.fn(),
  updateCategorySettings: vi.fn(),
}));
vi.mock('@/lib/api/systemSettings', () => settingsApi);
vi.mock('@/lib/api/agentToolkit', () => ({
  fetchAgentToolkitCapabilities: vi.fn().mockResolvedValue(null),
  fetchWorkspaceListing: vi.fn().mockResolvedValue({
    files: [], documents: [], totalFiles: 0, totalBytes: 0, quotaBytes: 0, truncated: false }),
  fetchMemories: vi.fn().mockResolvedValue({ count: 0, entries: [] }),
  workspaceDownloadUrl: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
  deleteMemory: vi.fn(),
  clearProjectMemories: vi.fn(),
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const stored = (extra: Record<string, unknown> = {}) => ({
  success: true,
  category: 'agent_toolkit',
  settings: Object.entries({ enabled: true, ...extra }).map(([key, value]) => ({ key, value })),
});

beforeEach(() => {
  settingsApi.getCategorySettings.mockReset().mockResolvedValue(stored());
  settingsApi.updateCategorySettings.mockReset().mockResolvedValue({ success: true, message: 'ok' });
});

describe('crew / memory settings model', () => {
  it('falls back to the defaults for missing or invalid values', () => {
    expect(crewMemoryFrom({})).toEqual(CREW_MEMORY_DEFAULTS);
    expect(crewMemoryFrom({ crew_enabled: 'yes', crew_max_parallel: Number.NaN, auto_compact_ratio: '0.8' }))
      .toEqual(CREW_MEMORY_DEFAULTS);
  });

  it('reads valid stored values', () => {
    expect(crewMemoryFrom({ crew_enabled: false, crew_max_parallel: 2, auto_compact_ratio: 0.85 }))
      .toMatchObject({ crew_enabled: false, crew_max_parallel: 2, auto_compact_ratio: 0.85 });
  });

  it('submits only the keys that changed', () => {
    const next = { ...CREW_MEMORY_DEFAULTS, auto_compact: false, crew_member_timeout_s: 120 };

    expect(crewMemoryPayload(next, CREW_MEMORY_DEFAULTS))
      .toEqual({ auto_compact: false, crew_member_timeout_s: 120 });
    expect(crewMemoryPayload(CREW_MEMORY_DEFAULTS, CREW_MEMORY_DEFAULTS)).toEqual({});
  });

  it.each([
    [{ crew_max_parallel: 4 }, true], [{ crew_max_parallel: 0 }, true],
    [{ crew_member_timeout_s: 29 }, true], [{ crew_member_timeout_s: 181 }, true],
    [{ auto_compact_ratio: 0.55 }, true], [{ auto_compact_ratio: 0.95 }, true],
    [{ auto_compact_ratio: Number.NaN }, true],
    [{ crew_max_parallel: 1, crew_member_timeout_s: 30, auto_compact_ratio: 0.6 }, false],
    [{ crew_max_parallel: 3, crew_member_timeout_s: 180, auto_compact_ratio: 0.9 }, false],
  ])('range check of %j is %s', (patch, invalid) => {
    expect(hasCrewMemoryRangeError({ ...CREW_MEMORY_DEFAULTS, ...patch })).toBe(invalid);
  });
});

describe('Agent capabilities panel — research crew and conversation memory', () => {
  it('shows both groups with the stored values', async () => {
    settingsApi.getCategorySettings.mockResolvedValue(
      stored({ crew_enabled: false, crew_max_parallel: 2, crew_member_timeout_s: 120, auto_compact_ratio: 0.8 }));

    render(<AgentToolkitSettingsPanel />);

    expect(await screen.findByRole('heading', { name: copy.crew.title })).toBeTruthy();
    expect(screen.getByRole('heading', { name: copy.memory.title })).toBeTruthy();
    expect(screen.getByRole('switch', { name: copy.crew.enabled }).getAttribute('aria-checked')).toBe('false');
    expect((screen.getByLabelText(copy.crew.maxParallel) as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText(copy.crew.memberTimeout) as HTMLInputElement).value).toBe('120');
    expect((screen.getByLabelText(copy.memory.autoCompactRatio) as HTMLInputElement).value).toBe('0.8');
  });

  it('uses the factory defaults when the server has no value yet', async () => {
    render(<AgentToolkitSettingsPanel />);

    expect((await screen.findByLabelText(copy.crew.maxParallel) as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText(copy.crew.memberTimeout) as HTMLInputElement).value).toBe('90');
    expect(screen.getByRole('switch', { name: copy.memory.autoCompact }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText(copy.memory.autoCompactRatio) as HTMLInputElement).value).toBe('0.75');
    expect((screen.getByRole('button', { name: SAVE_LABEL }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves a changed ratio and switch under the agent_toolkit category, and nothing else', async () => {
    render(<AgentToolkitSettingsPanel />);
    const ratio = await screen.findByLabelText(copy.memory.autoCompactRatio);
    fireEvent.change(ratio, { target: { value: '0.85' } });
    fireEvent.blur(ratio);
    fireEvent.click(screen.getByRole('switch', { name: copy.crew.enabled }));

    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));

    await waitFor(() => expect(settingsApi.updateCategorySettings).toHaveBeenCalledWith(
      'agent_toolkit', { auto_compact_ratio: 0.85, crew_enabled: false }));
  });

  it('clamps an out-of-range entry into range instead of saving it', async () => {
    settingsApi.getCategorySettings.mockResolvedValue(stored({ crew_max_parallel: 2 }));
    render(<AgentToolkitSettingsPanel />);
    const parallel = await screen.findByLabelText(copy.crew.maxParallel);

    fireEvent.change(parallel, { target: { value: '9' } });
    fireEvent.blur(parallel);
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));

    await waitFor(() => expect(settingsApi.updateCategorySettings).toHaveBeenCalledWith(
      'agent_toolkit', { crew_max_parallel: 3 }));
  });

  it('a value outside the range that arrives from the server blocks saving until fixed', async () => {
    settingsApi.getCategorySettings.mockResolvedValue(stored({ auto_compact_ratio: 0.2, plan_max_steps: 5 }));
    render(<AgentToolkitSettingsPanel />);
    await screen.findByLabelText(copy.memory.autoCompactRatio);

    fireEvent.click(screen.getByRole('switch', { name: copy.memory.autoCompact }));

    expect((screen.getByRole('button', { name: SAVE_LABEL }) as HTMLButtonElement).disabled).toBe(true);
  });
});
