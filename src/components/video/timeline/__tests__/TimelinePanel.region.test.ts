/**
 * @vitest-environment node
 *
 * Source-level (TimelinePanel imports most of the editor, so it is not
 * rendered here): the panel root is a labelled landmark that stays
 * click-focusable for shortcuts but is not an unlabelled Tab stop.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'TimelinePanel.tsx'), 'utf-8');

describe('TimelinePanel root', () => {
  it('the timeline panel is a labelled region outside the Tab order', () => {
    const root = src.match(/<div\s+className=\{`timeline-panel[^>]*>/)?.[0] ?? '';
    expect({
      outsideTabOrder: /tabIndex=\{-1\}/.test(root),
      region: /role="region"/.test(root),
      labelled: /aria-label=\{t\.timeline\.panelAriaLabel\}/.test(root),
    }).toEqual({ outsideTabOrder: true, region: true, labelled: true });
  });
});
