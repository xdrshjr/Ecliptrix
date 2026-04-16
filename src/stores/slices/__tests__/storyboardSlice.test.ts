import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createStoryboardSlice, StoryboardSlice } from '../storyboardSlice';
import type { StoryboardPack } from '@/types';

const samplePack: StoryboardPack = {
  packId: 'p1',
  prompt: 'demo',
  gridSize: '2x1',
  frameCount: 2,
  createdAt: '2026-04-15T00:00:00Z',
  originalImageUrl: '',
  frames: [
    { index: 0, filename: 'a.png', url: 'a', row: 0, col: 0 },
    { index: 1, filename: 'b.png', url: 'b', row: 0, col: 0 },
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStore(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createStore<StoryboardSlice>()((set: any, get: any, api: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (createStoryboardSlice as any)(set, get, api),
  );
}

describe('storyboardSlice updatePackFrame', () => {
  it('updates the targeted frame only', () => {
    const store = makeStore();
    store.getState().setStoryboardPacks([samplePack]);
    store.getState().updatePackFrame('p1', 1, { script: 'hello', shotId: 's1' });
    const p = store.getState().storyboardPacks[0];
    expect(p.frames[0].script).toBeUndefined();
    expect(p.frames[1].script).toBe('hello');
    expect(p.frames[1].shotId).toBe('s1');
  });

  it('is idempotent', () => {
    const store = makeStore();
    store.getState().setStoryboardPacks([samplePack]);
    store.getState().updatePackFrame('p1', 0, { script: 'x' });
    const before = store.getState().storyboardPacks;
    store.getState().updatePackFrame('p1', 0, { script: 'x' });
    const after = store.getState().storyboardPacks;
    expect(after[0].frames[0].script).toBe('x');
    // Idempotent in value (object identity may differ each call — only value matters)
    expect(after[0].frames[0]).toEqual(before[0].frames[0]);
  });

  it('no-ops for unknown pack', () => {
    const store = makeStore();
    store.getState().setStoryboardPacks([samplePack]);
    store.getState().updatePackFrame('zzz', 0, { script: 'x' });
    expect(store.getState().storyboardPacks[0].frames[0].script).toBeUndefined();
  });
});
