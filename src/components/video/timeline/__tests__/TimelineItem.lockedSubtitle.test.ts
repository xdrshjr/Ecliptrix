/**
 * @vitest-environment node
 *
 * TimelineItem — subtitle inline editing on a locked track.
 *
 * The commit goes through `updateSubtitleTextAction`, which refuses locked
 * tracks, so opening the inline editor there would silently discard whatever
 * the user types. Source-level for the same `jsx: "preserve"` reason as the
 * sibling TimelineItem tests.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'TimelineItem.tsx'), 'utf-8');

describe('TimelineItem subtitle double-click', () => {
  it('does not open the inline editor on a locked track', () => {
    const start = src.indexOf('const handleDoubleClick');
    const block = src.slice(start, src.indexOf('const canDetachAudio', start));
    expect(block).toMatch(
      /if \(item\.type === 'subtitle'\) \{[\s\S]*?if \(isTrackLocked\) return;[\s\S]*?setEditingSubtitle\(item\.id\)/,
    );
  });
});
