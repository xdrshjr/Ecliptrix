import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import cameraModalSource from '../CameraMotionModal.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import modalSource from '../../../../ui/Modal.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import dialogSource from '../../../../ui/ConfirmationDialog.tsx?raw';
import * as camera from '@/components/video/playback/camera';
import * as focusTrap from '@/components/ui/focusTrap';
import * as keyframeStripGeometry from '../keyframeStripGeometry';
import * as stageInteraction from '../stageInteraction';
import * as presetLabels from '../presetLabels';
import * as panelPresence from '../panelPresence';
import { getTranslations } from '@/lib/i18n';
import {
  compileComponent,
  compileComponentModule,
  localeContextModule,
  reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';

/**
 * UI3-07: closing the camera-motion panel with unapplied edits asks in-app.
 * The panel is compiled from source (tsconfig keeps JSX `preserve`); only the
 * WebGL stage and editing sub-panels are stubbed — a preset card is the
 * smallest real edit that makes the draft dirty.
 */
type CameraMotionModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onApply: () => void;
  clipName: string;
  clipDuration: number;
  targetItemIds: string[];
};

const labels = getTranslations('en').timeline.cameraMotion;
let CameraMotionModal: React.FC<CameraMotionModalProps>;

function PresetGridStub({ onSelect }: { onSelect: (presetId: string) => void }) {
  return React.createElement('button', { type: 'button', onClick: () => onSelect('push-in') }, 'Push in');
}

beforeAll(() => {
  const base = { ...reactModules(), ...localeContextModule() };
  const modalModule = compileComponentModule(modalSource, base);
  const dialogModule = compileComponentModule(dialogSource, { ...base, './focusTrap': focusTrap });
  CameraMotionModal = compileComponent<CameraMotionModalProps>(cameraModalSource, {
    ...base,
    '@/components/ui/Modal': modalModule,
    '@/components/ui/ConfirmationDialog': dialogModule,
    '@/components/video/playback/camera': camera,
    './PresetGrid': PresetGridStub,
    './MotionPreviewStage': ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    './ParameterControls': () => null,
    './KeyframeStrip': () => null,
    './StageOverlay': () => null,
    './keyframeStripGeometry': keyframeStripGeometry,
    './stageInteraction': stageInteraction,
    './presetLabels': presetLabels,
    './panelPresence': panelPresence,
  });
});

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('CameraMotionModal — discarding edits', () => {
  it('discarding edits asks with an in-app dialog, not the native confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();
    render(React.createElement(CameraMotionModal, {
      isOpen: true, onClose, onApply: vi.fn(), clipName: 'Clip', clipDuration: 5, targetItemIds: ['c1'],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Push in' }));
    const footerCancel = screen.getAllByRole('button', { name: labels.cancel }).slice(-1)[0];
    fireEvent.click(footerCancel);
    const askedInApp = screen.queryByText(labels.discardTitle) !== null;
    const closedBeforeAnswer = onClose.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: labels.discardAction }));
    expect({
      askedInApp,
      closedBeforeAnswer,
      nativeConfirm: confirmSpy.mock.calls.length,
      closedAfterDiscard: onClose.mock.calls.length,
    }).toEqual({ askedInApp: true, closedBeforeAnswer: 0, nativeConfirm: 0, closedAfterDiscard: 1 });
  });

  it('keeping the edits closes only the confirmation', () => {
    const onClose = vi.fn();
    render(React.createElement(CameraMotionModal, {
      isOpen: true, onClose, onApply: vi.fn(), clipName: 'Clip', clipDuration: 5, targetItemIds: ['c1'],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Push in' }));
    fireEvent.click(screen.getAllByRole('button', { name: labels.cancel }).slice(-1)[0]);
    fireEvent.keyDown(screen.getByRole('button', { name: labels.discardAction }), { key: 'Escape' });
    expect({ closed: onClose.mock.calls.length, panelOpen: screen.queryAllByRole('dialog').length > 0 })
      .toEqual({ closed: 0, panelOpen: true });
  });
});
