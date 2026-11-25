/**
 * Provider wiring: state mirror, Ctrl+Alt+B, gate lock, right-click save (R2-2).
 */
import * as React from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installBridge, makeState, makeStore, removeBridge, renderWithProviders,
} from '@/components/browser/__tests__/testUtils';
import { useBrowserWorkspace } from '../BrowserWorkspaceContext';

const saved = vi.hoisted(() => ({
  saveBrowserResource: vi.fn(), addMaterial: vi.fn(),
  material: { id: 'm1', local_url: '/api/storage/files/cached_materials/web/m1.jpg' },
}));
vi.mock('@/lib/api/browserBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/browserBridge')>()),
  saveBrowserResource: saved.saveBrowserResource,
}));
vi.mock('@/lib/video-editing-agent/tools/webToolAdapter', () => ({
  localMaterial: (input: unknown) => ({ mapped: input }),
}));
vi.mock('@/stores/videoEditingStore', () => ({
  useVideoEditingStore: { getState: () => ({ addMaterial: saved.addMaterial }) },
}));

afterEach(() => { cleanup(); removeBridge(); vi.clearAllMocks(); });

function Probe() {
  const snapshot = useBrowserWorkspace();
  return <p data-testid="probe">{String(snapshot.dockOpen)}|{snapshot.workspace?.activeProfileId ?? 'none'}</p>;
}
const probe = () => screen.getByTestId('probe').textContent;
const press = (patch: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, {
  code: 'KeyB', ctrlKey: true, altKey: true, ...patch,
});

describe('BrowserWorkspaceProvider', () => {
  it('mirrors_the_bridge_state_and_later_pushes', async () => {
    const bridge = installBridge(makeState({ activeProfileId: 'a' }));
    renderWithProviders(<Probe />, makeStore(null));
    await waitFor(() => expect(probe()).toBe('false|a'));
    act(() => bridge.emitState(makeState({ activeProfileId: 'b' })));
    expect(probe()).toBe('false|b');
  });

  it('ctrl_alt_b_toggles_the_dock_only_when_a_bridge_exists', () => {
    installBridge();
    const store = makeStore();
    renderWithProviders(<Probe />, store);
    press();
    expect(store.getSnapshot().dockOpen).toBe(true);
    press();
    expect(store.getSnapshot().dockOpen).toBe(false);
    press({ ctrlKey: false });
    expect(store.getSnapshot().dockOpen).toBe(false);
  });

  it('the_shortcut_is_inert_in_a_plain_browser', () => {
    removeBridge();
    const store = makeStore(null, { hasBridge: false });
    renderWithProviders(<Probe />, store);
    press();
    expect(store.getSnapshot().dockOpen).toBe(false);
  });

  it('closes_the_dock_when_the_identity_gate_locks_the_app', async () => {
    installBridge();
    const store = makeStore(makeState(), { open: true });
    renderWithProviders(<Probe />, store);
    act(() => store.setWorkspace(makeState({ locked: true })));
    await waitFor(() => expect(store.getSnapshot().dockOpen).toBe(false));
  });

  it('right_click_save_goes_through_the_bff_then_the_media_library', async () => {
    const bridge = installBridge();
    saved.saveBrowserResource.mockResolvedValue(saved.material);
    renderWithProviders(<Probe />, makeStore());
    const listener = (bridge.onSaveResourceRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    await act(async () => {
      listener({ tabId: 't1', url: 'https://cdn.example/a.jpg', kind: 'image' });
    });
    await waitFor(() => expect(saved.addMaterial).toHaveBeenCalledWith({ mapped: saved.material }));
    expect(saved.saveBrowserResource).toHaveBeenCalledWith(
      { tabId: 't1', url: 'https://cdn.example/a.jpg', kind: 'image' });
    expect(await screen.findByText('Saved to the media library')).toBeTruthy();
  });

  it('a_failed_save_is_reported_and_adds_nothing', async () => {
    const bridge = installBridge();
    saved.saveBrowserResource.mockRejectedValue(new Error('resource_not_image'));
    renderWithProviders(<Probe />, makeStore());
    const listener = (bridge.onSaveResourceRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    await act(async () => { listener({ tabId: 't1', url: 'https://x.test/a', kind: 'image' }); });
    expect(await screen.findByText('Save failed: resource_not_image')).toBeTruthy();
    expect(saved.addMaterial).not.toHaveBeenCalled();
  });
});
