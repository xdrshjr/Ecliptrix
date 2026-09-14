/**
 * @vitest-environment node
 *
 * AG2-04: the chat route and OperationApplier start from one default
 * timeline; two diverging copies left a turn begun from no timeline with
 * nothing to undo against.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDefaultAgentTimelineState } from '../defaultTimeline';

const ROUTE = resolve(__dirname, '..', '..', '..', 'app', 'api', 'video-editing-agent', 'chat', 'route.ts');
const APPLIER = resolve(__dirname, '..', 'OperationApplier.ts');

describe('default agent timeline', () => {
  it('route and applier share one default timeline', () => {
    const usage = [ROUTE, APPLIER].map((file) => {
      const source = readFileSync(file, 'utf-8');
      return {
        ownLiteral: source.includes("'subtitle-track-1'"),
        sharedFactory: source.includes('createDefaultAgentTimelineState()'),
      };
    });

    expect(usage).toEqual([
      { ownLiteral: false, sharedFactory: true },
      { ownLiteral: false, sharedFactory: true },
    ]);
  });

  it('every call returns an independent timeline', () => {
    const first = createDefaultAgentTimelineState();
    first.tracks[0].items.push({
      id: 'x', name: 'x', type: 'video', startTime: 0, duration: 1, trackId: first.tracks[0].id, color: '#000',
    });

    expect(createDefaultAgentTimelineState().tracks[0].items).toEqual([]);
  });
});
