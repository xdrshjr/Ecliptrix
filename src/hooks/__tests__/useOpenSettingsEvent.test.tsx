import * as React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOpenSettingsEvent } from '../useOpenSettingsEvent';
import { openSettings } from '@/lib/setupEvents';

afterEach(cleanup);

function Host({ onOpen }: { onOpen: (item: string) => void }) {
  useOpenSettingsEvent(onOpen);
  return null;
}

describe('useOpenSettingsEvent', () => {
  it('opens_the_requested_settings_item_and_defaults_to_general', () => {
    const onOpen = vi.fn();
    render(<Host onOpen={onOpen} />);
    act(() => openSettings('browser'));
    act(() => openSettings());
    expect(onOpen.mock.calls).toEqual([['browser'], ['general']]);
  });

  it('always_calls_the_latest_callback_and_stops_listening_on_unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = render(<Host onOpen={first} />);
    rerender(<Host onOpen={second} />);
    act(() => openSettings('browser'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('browser');
    unmount();
    act(() => openSettings('browser'));
    expect(second).toHaveBeenCalledTimes(1);
  });
});
