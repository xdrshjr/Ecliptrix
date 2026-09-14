import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getInputModality, installInputModalityTracking } from '../inputModality';

let dispose: () => void = () => {};

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  dispose = installInputModalityTracking(document);
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
});

afterEach(() => {
  dispose();
  document.body.innerHTML = '';
});

describe('input modality tracking', () => {
  it('Tab switches to keyboard modality and a pointer press switches back', () => {
    const host = mount('<button>Cut</button>');
    const button = host.querySelector('button')!;
    press(button, 'Tab');
    const afterTab = getInputModality();
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect([afterTab, getInputModality()]).toEqual(['keyboard', 'pointer']);
  });

  it('arrow keys outside a composite widget keep pointer modality', () => {
    const host = mount('<button>Delete</button>');
    press(host.querySelector('button')!, 'ArrowRight');
    expect(getInputModality()).toBe('pointer');
  });

  it('arrow keys inside a composite widget switch to keyboard modality', () => {
    const host = mount('<div role="menu"><button role="menuitem">Undo 1</button></div>');
    press(host.querySelector('button')!, 'ArrowDown');
    expect(getInputModality()).toBe('keyboard');
  });

  it('Space never changes the modality', () => {
    const host = mount('<button>Play</button>');
    press(host.querySelector('button')!, ' ');
    expect(getInputModality()).toBe('pointer');
  });
});
