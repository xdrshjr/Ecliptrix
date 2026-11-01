/**
 * The voice / generation / media wizard steps (spec §3.7, AC2-1, 2, 7, 8, 16):
 * one-open accordion, honest footer wording, opt-outs, "only set up models",
 * and the runtime "go configure" entry that opens on a given card.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTENDED_CAPABILITIES, type CapabilityId, type CapabilityStatus } from '@/lib/api/setupStatus';
import { translations } from '@/lib/i18n';
import { cleanInstall, listBody, wireIntegration } from '@/components/integrations/__tests__/fixtures';
import SetupWizard from '../SetupWizard';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.setupWizard;
const text = translations.en.integrations;
const OPTOUT_KEY = 'ecliptrix-setup-optouts';

const MODEL_IDS: CapabilityId[] = ['chat', 'fast', 'video_cut', 'vision', 'research', 'web_search'];
const NEW_IDS: CapabilityId[] = EXTENDED_CAPABILITIES.filter((id) => !MODEL_IDS.includes(id));

/** Models ready (the upgrading user); every new capability missing unless listed. */
function upgradedCapabilities(ready: CapabilityId[] = []): CapabilityStatus[] {
  return [...MODEL_IDS, ...NEW_IDS].map((id) => ({
    id,
    tier: EXTENDED_CAPABILITIES.includes(id) ? 'extended' : 'core',
    state: MODEL_IDS.includes(id) || ready.includes(id) ? 'ready' : 'missing',
    source: 'none',
  }));
}

function installBackend(list = cleanInstall()) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/integrations') return listBody(list);
    return { providers: [] };
  });
}

function renderWizard(props: Partial<React.ComponentProps<typeof SetupWizard>> = {}) {
  const onClose = vi.fn();
  render(
    <SetupWizard
      mode="auto"
      capabilities={upgradedCapabilities()}
      optOuts={[]}
      onClose={onClose}
      onOpenSettings={vi.fn()}
      {...props}
    />,
  );
  return onClose;
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const START = new RegExp(`^(${copy.start}|${copy.resume})$`);

/** The accordion toggle of a row (the only button there with aria-expanded). */
function rowToggle(name: string): HTMLElement {
  const toggle = screen
    .getAllByRole('button')
    .find((button) => button.hasAttribute('aria-expanded') && button.textContent?.includes(name));
  if (!toggle) throw new Error(`no accordion row for ${name}`);
  return toggle;
}
const optOuts = (): string[] => JSON.parse(window.localStorage.getItem(OPTOUT_KEY) ?? '[]');

async function openVoiceStep() {
  click(START);
  await screen.findByRole('heading', { name: copy.group.voice.title });
  await waitFor(() =>
    expect(rowToggle(text.volcano_tts.name)).toHaveAttribute('aria-expanded', 'true'));
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  installBackend();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('overview of a clean install', () => {
  it('groups all 14 capabilities and skips provider/models for an upgrading user (AC2-16)', () => {
    renderWizard();
    for (const title of ['models', 'voice', 'generation', 'media'] as const) {
      expect(screen.getByRole('heading', { name: copy.group[title].title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(14);
    const stepper = within(screen.getByRole('navigation'));
    expect(stepper.queryByText(copy.stepProvider)).toBeNull();
    expect(stepper.getByText(copy.stepVoice)).toBeInTheDocument();
    expect(stepper.getByText(copy.stepGeneration)).toBeInTheDocument();
    expect(stepper.getByText(copy.stepMedia)).toBeInTheDocument();
  });
});

describe('accordion', () => {
  it('opens the first gap and keeps exactly one card open', async () => {
    renderWizard();
    await openVoiceStep();
    const tts = rowToggle(text.volcano_tts.name);
    const asr = rowToggle(text.volcano_asr.name);
    await waitFor(() => expect(tts).toHaveAttribute('aria-expanded', 'true'));
    expect(asr).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('region')).toHaveLength(1);

    fireEvent.click(asr);
    expect(asr).toHaveAttribute('aria-expanded', 'true');
    expect(tts).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByLabelText(text.field.appId)).toBeInTheDocument();
  });

  it('links each opened card to its console', async () => {
    renderWizard();
    await openVoiceStep();
    expect(screen.getByRole('link', { name: new RegExp(text.link.getKey) })).toHaveAttribute('target', '_blank');
  });
});

describe('footer wording and opt-outs', () => {
  it('says "finish later" while items are unresolved and "Continue" once all are decided', async () => {
    renderWizard();
    await openVoiceStep();
    expect(screen.getByRole('button', { name: text.action.continueLater })).toBeInTheDocument();
    click(text.action.skipGroup);
    expect(await screen.findByRole('button', { name: text.action.continueNext })).toBeInTheDocument();
    expect(optOuts().sort()).toEqual(['asr', 'tts', 'voice_clone']);
    expect(screen.queryByRole('button', { name: text.action.skipGroup })).toBeNull();
  });

  it('"Not using" on Ark mutes both AI image and AI video (AC2-7)', async () => {
    renderWizard({ capabilities: upgradedCapabilities(['tts', 'asr', 'voice_clone']) });
    click(START);
    await screen.findByRole('heading', { name: copy.group.generation.title });
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${text.action.skip} ${text.ark.name}`) }));
    expect(optOuts().sort()).toEqual(['ai_image', 'ai_video']);
    expect(screen.getByText(copy.state.optedOut)).toBeInTheDocument();
  });

  it('lets an opted-out item be turned back on', async () => {
    window.localStorage.setItem(OPTOUT_KEY, '["ai_image","ai_video"]');
    renderWizard({
      capabilities: upgradedCapabilities(['tts', 'asr', 'voice_clone']),
      optOuts: ['ai_image', 'ai_video'],
    });
    click(START);
    // Generation is opted out, so the first step shown is media.
    await screen.findByRole('heading', { name: copy.group.media.title });
    expect(screen.queryByRole('heading', { name: copy.group.generation.title })).toBeNull();
  });
});

describe('"only set up models, the rest later" (E9)', () => {
  it('mutes every open optional gap and jumps straight to the done page', async () => {
    renderWizard();
    click(text.action.skipOptional);
    expect(await screen.findByText(copy.doneTitle)).toBeInTheDocument();
    expect(optOuts().sort()).toEqual([...NEW_IDS].sort());
    click(copy.finish);
  });

  it('keeps the model steps when models are missing', async () => {
    const caps = upgradedCapabilities().map((item) =>
      item.id === 'chat' ? { ...item, state: 'missing' as const } : item);
    renderWizard({ capabilities: caps });
    click(text.action.skipOptional);
    expect(await screen.findByText(copy.providerTitle)).toBeInTheDocument();
    const stepper = within(screen.getByRole('navigation'));
    expect(stepper.queryByText(copy.stepVoice)).toBeNull();
  });

  it('is offered only while an optional gap remains', () => {
    renderWizard({ capabilities: upgradedCapabilities(NEW_IDS) });
    expect(screen.queryByRole('button', { name: text.action.skipOptional })).toBeNull();
  });
});

describe('runtime "go configure" entry', () => {
  it('opens a manual wizard on the requested integration with its card expanded', async () => {
    renderWizard({
      mode: 'manual',
      focus: 'pexels',
      capabilities: upgradedCapabilities(),
    });
    await screen.findByRole('heading', { name: copy.group.media.title });
    await waitFor(() => expect(rowToggle(text.pexels.name)).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByLabelText(text.field.apiKeys)).toBeInTheDocument();
  });
});

describe('saving from the wizard', () => {
  it('flips the row to configured and offers a plain Continue', async () => {
    const caps = upgradedCapabilities(['tts', 'asr', 'voice_clone', 'ai_image', 'ai_video', 'video_library', 'image_library']);
    const afterSave = cleanInstall().map((item) =>
      item.id === 'freesound' ? wireIntegration('freesound', { usable: true, source: 'database' }) : item);
    let saved = false;
    api.get.mockImplementation(async (url: string) =>
      url === '/api/integrations' ? listBody(saved ? afterSave : cleanInstall()) : { providers: [] });
    api.put.mockImplementation(async () => {
      saved = true;
      return { success: true, data: afterSave.find((item) => item.id === 'freesound') };
    });
    api.post.mockResolvedValue({ success: true, data: { outcome: 'ok', verify_level: 'free' } });

    renderWizard({ capabilities: caps });
    click(START);
    await screen.findByRole('heading', { name: copy.group.media.title });
    await waitFor(() => rowToggle(text.freesound.name));
    fireEvent.click(rowToggle(text.freesound.name));
    fireEvent.change(await screen.findByLabelText(text.field.apiKey), {
      target: { value: 'freesound-key-0123456789' },
    });
    click(text.action.saveTest);

    expect(await screen.findByText(text.test.ok)).toBeInTheDocument();
    expect(await screen.findByText(copy.state.ready)).toBeInTheDocument();
    expect(api.put.mock.calls[0][0]).toBe('/api/integrations/freesound');
    // Pexels and Unsplash were not touched, so they still count as open.
    expect(screen.getByRole('button', { name: text.action.continueLater })).toBeInTheDocument();
  });

  it('shows a retry when the list cannot be loaded', async () => {
    api.get.mockRejectedValue(new Error('down'));
    renderWizard();
    click(START);
    expect(await screen.findByRole('alert')).toHaveTextContent(text.panel.loadFailed);
  });
});

describe('Esc guard', () => {
  it('asks before discarding a half-typed credential in a group card', async () => {
    const onClose = renderWizard();
    await openVoiceStep();
    fireEvent.change(screen.getByLabelText(text.field.apiKey), { target: { value: 'typed-but-unsaved-1234' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText(copy.discardPrompt)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
