import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import modalSource from '../Modal.tsx?raw';
import {
  compileComponent,
  reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  labelledBy: string;
  children?: React.ReactNode;
};

let Modal: React.FC<ModalProps>;

beforeAll(() => {
  Modal = compileComponent<ModalProps>(modalSource, reactModules());
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function modalWith(onClose: () => void) {
  return React.createElement(
    Modal,
    { isOpen: true, onClose, labelledBy: 'title' },
    React.createElement('h2', { id: 'title' }, 'Camera motion'),
    React.createElement('input', { 'aria-label': 'Intensity' }),
  );
}

describe('Modal focus and close handling', () => {
  it('re-rendering with a new onClose keeps focus in the focused field', () => {
    // The opener behind the dialog is focusable, as the clip or toolbar
    // button that opened the camera-motion panel is.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(modalWith(vi.fn()));
    const field = screen.getByLabelText('Intensity');
    field.focus();
    view.rerender(modalWith(vi.fn()));
    expect(document.activeElement).toBe(field);
  });

  it('Escape invokes the latest onClose', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(modalWith(first));
    view.rerender(modalWith(latest));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect({ first: first.mock.calls.length, latest: latest.mock.calls.length }).toEqual({ first: 0, latest: 1 });
  });

  it('the default modal root sits on the z-modal layer', () => {
    render(modalWith(vi.fn()));
    const rootClasses = screen.getByRole('dialog').parentElement!.className.split(/\s+/);
    expect({ modalLayer: rootClasses.includes('z-modal'), legacyLayer: rootClasses.includes('z-50') })
      .toEqual({ modalLayer: true, legacyLayer: false });
  });

  it('a key a nested dialog already handled does not close the modal', () => {
    const onClose = vi.fn();
    render(modalWith(onClose));
    const field = screen.getByLabelText('Intensity');
    field.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
