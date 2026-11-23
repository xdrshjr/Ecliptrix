/**
 * The relay path of the setup wizard (SkillRouter spec §7.2): source step,
 * router step gating, model slots, "set up by hand", and the guarantee that the
 * manual path and the pre-router wizard are untouched.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTENDED_CAPABILITIES, type CapabilityId, type CapabilityStatus } from '@/lib/api/setupStatus';
import { translations } from '@/lib/i18n';
import { cleanInstall, listBody } from '@/components/integrations/__tests__/fixtures';
import SetupWizard from '../SetupWizard';
import SetupWizardHost from '../SetupWizardHost';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/http-client')>()),
  http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

const copy = translations.en.setupWizard;
const router = translations.en.skillrouter;
const KEY = 'ar-test-key-123456';
const ALL: CapabilityId[] = [
  'chat', 'fast', 'video_cut', 'vision', 'research', 'web_search',
  'tts', 'asr', 'voice_clone', 'ai_image', 'ai_video',
  'video_library', 'image_library', 'audio_library',
];

function matrix(
  state: (id: CapabilityId) => CapabilityStatus['state'],
  source: CapabilityStatus['source'] = 'none',
): CapabilityStatus[] {
  return ALL.map((id) => ({
    id,
    tier: EXTENDED_CAPABILITIES.includes(id) ? 'extended' : 'core',
    state: state(id),
    source,
  }));
}

const ALL_MISSING = matrix(() => 'missing');

interface RouterServer {
  modeState: 'unset' | 'manual' | 'router';
  keyConfigured: boolean;
}

function wireStatus(server: RouterServer) {
  return {
    success: true,
    data: {
      mode: server.modeState === 'router' ? 'router' : 'manual',
      modeState: server.modeState,
      baseUrl: 'https://www.skillrouter.net',
      keyConfigured: server.keyConfigured,
      keyHint: server.keyConfigured ? 'ar-…****3456' : null,
      enabled: true,
      manualCapabilities: [],
      slotModels: {},
      defaults: { chat: 'relay-chat', fast: 'relay-fast' },
      lastVerified: null,
      revision: 'r1',
    },
  };
}

function installBackend(server: RouterServer) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/skillrouter') return wireStatus(server);
    if (url.startsWith('/api/skillrouter/catalog')) {
      return {
        success: true,
        data: {
          models: [
            { id: 'relay-chat', label: 'Relay Chat', protocol: 'openai' },
            { id: 'relay-fast', label: 'Relay Fast', protocol: 'anthropic' },
          ],
          capabilities: [],
          defaults: { chat: 'relay-chat', fast: 'relay-fast' },
          stale: false,
          fetchedAt: 1,
        },
      };
    }
    if (url === '/api/integrations') return listBody(cleanInstall());
    return { providers: [] };
  });
  api.put.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === '/api/skillrouter') {
      if (body.mode) server.modeState = body.mode as RouterServer['modeState'];
      if (body.apiKey) server.keyConfigured = true;
      return wireStatus(server);
    }
    return { success: true };
  });
  api.post.mockImplementation(async (url: string) => {
    if (url === '/api/skillrouter/verify') {
      return {
        success: true,
        data: { outcome: 'ok', latencyMs: 12, capabilities: [], coverage: { routed: [], manualOnly: [] } },
      };
    }
    return { success: true };
  });
}

function renderWizard(props: Partial<React.ComponentProps<typeof SetupWizard>> = {}) {
  const onClose = vi.fn();
  render(
    <SetupWizard
      mode="auto"
      capabilities={ALL_MISSING}
      optOuts={[]}
      onClose={onClose}
      onOpenSettings={vi.fn()}
      sourceMode="unset"
      {...props}
    />,
  );
  return onClose;
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const START = new RegExp(`^(${copy.start}|${copy.resume})$`);
const heading = (name: string) => screen.findByRole('heading', { name });
const putsTo = (url: string) => api.put.mock.calls.filter((call) => call[0] === url);

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('source step', () => {
  it('opens after the overview on a first install, with the relay preselected', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    const group = screen.getByRole('radiogroup');
    expect(within(group).getByRole('radio', { name: new RegExp(router.chooser.router.title) }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('moves focus to the step heading', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    renderWizard();
    click(START);
    const title = await heading(copy.sourceStep.title);
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('arrow keys flip the choice and the stepper previews the manual branch', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    const nav = screen.getAllByRole('navigation')[0];
    expect(within(nav).getByText(copy.stepRouter)).toBeInTheDocument();
    const relay = screen.getByRole('radio', { name: new RegExp(router.chooser.router.title) });
    fireEvent.keyDown(relay, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: new RegExp(router.chooser.manual.title) }))
      .toHaveAttribute('aria-checked', 'true');
    expect(within(nav).getByText(copy.stepProvider)).toBeInTheDocument();
    expect(within(nav).queryByText(copy.stepRouter)).toBeNull();
  });

  it('manual: saves the explicit mode once, deletes nothing, and continues to the provider step', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(router.chooser.manual.title) }));
    click(copy.next);
    await heading(copy.providerTitle);
    expect(putsTo('/api/skillrouter')).toEqual([['/api/skillrouter', { mode: 'manual' }, expect.anything()]]);
    expect(api.del).not.toHaveBeenCalled();
  });

  it('manual: a failed save stays on the step and says so', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    api.put.mockRejectedValueOnce(new Error('boom'));
    renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(router.chooser.manual.title) }));
    click(copy.next);
    expect(await screen.findByText(copy.sourceStep.saveFailed)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: copy.providerTitle })).toBeNull();
  });
});

describe('router path', () => {
  async function reachRouterStep() {
    renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    click(copy.next);
    await heading(copy.routerStep.title);
  }

  it('choosing the relay writes nothing until the key is saved', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    await reachRouterStep();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('cannot continue before the key is verified or saved', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    await reachRouterStep();
    expect(screen.queryByRole('button', { name: router.connect.saveAndUse })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.routerStep.continueConnected })).toBeNull();
    expect(screen.getByText(copy.routerStep.needsKey)).toBeInTheDocument();
  });

  it('walks source → router → models → set up by hand → done', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    const onClose = renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    click(copy.next);
    await heading(copy.routerStep.title);

    fireEvent.change(await screen.findByLabelText(router.connect.keyLabel), { target: { value: KEY } });
    click(router.connect.verify);
    await screen.findByText(/12 ms/);
    click(router.connect.saveAndUse);

    await heading(copy.routerModelsStep.title);
    expect(putsTo('/api/skillrouter')[0][1]).toEqual({ mode: 'router', apiKey: KEY });
    await screen.findByDisplayValue(/Relay Chat/).catch(() => undefined);
    click(copy.next);

    await heading(copy.manualOnlyStep.title);
    expect(screen.getByText(copy.cap.web_search.name)).toBeInTheDocument();
    click(copy.manualOnlyStep.skipAll);

    await heading(copy.donePartialTitle);
    click(copy.finishPartial);
    expect(onClose).toHaveBeenCalledWith('finished');
    expect(JSON.parse(window.localStorage.getItem('ecliptrix-setup-optouts') ?? '[]'))
      .toEqual(expect.arrayContaining(['web_search', 'asr', 'voice_clone']));
  });

  it('an unsaved key counts as a draft: closing asks first, an empty field closes at once', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    const onClose = renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    click(copy.next);
    await heading(copy.routerStep.title);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('later');
    onClose.mockClear();

    fireEvent.change(await screen.findByLabelText(router.connect.keyLabel), { target: { value: KEY } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText(copy.discardPrompt)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('going back from the key step drops its draft flag', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    const onClose = renderWizard();
    click(START);
    await heading(copy.sourceStep.title);
    click(copy.next);
    await heading(copy.routerStep.title);
    fireEvent.change(await screen.findByLabelText(router.connect.keyLabel), { target: { value: KEY } });
    click(copy.back);
    await heading(copy.sourceStep.title);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('later');
  });

  it('an already saved active key may be kept without typing', async () => {
    installBackend({ modeState: 'router', keyConfigured: true });
    renderWizard({ sourceMode: 'router', capabilities: matrix((id) => (id === 'tts' ? 'invalid' : 'ready'), 'router') });
    click(START);
    await heading(copy.routerStep.title);
    click(copy.routerStep.continueConnected);
    await heading(copy.routerModelsStep.title);
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('unavailable capability', () => {
  it('shows a gap and hands the capability to the user\'s own configuration', async () => {
    installBackend({ modeState: 'router', keyConfigured: true });
    api.get.mockImplementation(async (url: string) =>
      url === '/api/skillrouter'
        ? { ...wireStatus({ modeState: 'router', keyConfigured: true }) }
        : { providers: [] });
    const caps = matrix((id) => (id === 'ai_image' ? 'unavailable' : 'ready'), 'router');
    const events: Array<{ focus?: string }> = [];
    const onOpen = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('ecliptrix-open-setup-wizard', onOpen);
    renderWizard({ sourceMode: 'router', capabilities: caps });
    expect(screen.getAllByText(copy.state.unavailable).length).toBeGreaterThan(0);
    expect(screen.getAllByText(copy.state.readyRouter).length).toBeGreaterThan(0);
    click(new RegExp(copy.routedByRouter.useOwn));
    await waitFor(() => expect(putsTo('/api/skillrouter')).toHaveLength(1));
    expect(putsTo('/api/skillrouter')[0][1]).toEqual({ manualCapabilities: ['ai_image'] });
    await waitFor(() => expect(events).toEqual([{ focus: 'ark_image' }]));
    window.removeEventListener('ecliptrix-open-setup-wizard', onOpen);
  });
});

describe('compatibility', () => {
  it('without a source mode the wizard is the pre-router one (no source step)', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    renderWizard({ sourceMode: undefined });
    click(START);
    await heading(copy.providerTitle);
    expect(screen.queryByText(copy.stepSource)).toBeNull();
  });

  it('a manual install with gaps is never asked for a source', async () => {
    installBackend({ modeState: 'manual', keyConfigured: false });
    renderWizard({ sourceMode: 'manual' });
    click(START);
    await heading(copy.providerTitle);
  });

  it('a settings re-run on manual mode offers the source step first', async () => {
    installBackend({ modeState: 'manual', keyConfigured: false });
    renderWizard({ mode: 'manual', sourceMode: 'manual', capabilities: matrix(() => 'ready') });
    click(START);
    await heading(copy.sourceStep.title);
    expect(screen.getByRole('radio', { name: new RegExp(router.chooser.manual.title) }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('opens on the router step when asked to configure the relay', async () => {
    installBackend({ modeState: 'manual', keyConfigured: false });
    renderWizard({ mode: 'manual', sourceMode: 'manual', focus: 'skillrouter', capabilities: matrix(() => 'ready') });
    await heading(copy.routerStep.title);
  });
});

describe('SetupWizardHost', () => {
  const renderHost = () =>
    render(
      <SetupWizardHost
        mode="auto"
        capabilities={ALL_MISSING}
        optOuts={[]}
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

  it('reads the saved source before opening', async () => {
    installBackend({ modeState: 'unset', keyConfigured: false });
    renderHost();
    fireEvent.click(await screen.findByRole('button', { name: START }));
    await heading(copy.sourceStep.title);
  });

  it('falls back to the manual wizard when the status cannot be read', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    renderHost();
    fireEvent.click(await screen.findByRole('button', { name: START }));
    await heading(copy.providerTitle);
  });
});
