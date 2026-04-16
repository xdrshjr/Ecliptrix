import { describe, it, expect } from 'vitest';
import { uniqueName } from '../mentionUtils';
import type { MentionedImage } from '@/types';

function m(name: string): MentionedImage {
  return { id: name, name, url: `/${name}.png`, source: null };
}

describe('uniqueName', () => {
  it('returns the base name when not present', () => {
    expect(uniqueName('photo', [])).toBe('photo');
    expect(uniqueName('photo', [m('other')])).toBe('photo');
  });

  it('appends _2 on first collision', () => {
    expect(uniqueName('photo', [m('photo')])).toBe('photo_2');
  });

  it('appends _3 when _2 also taken', () => {
    expect(uniqueName('photo', [m('photo'), m('photo_2')])).toBe('photo_3');
  });

  it('handles gaps and still returns smallest free suffix', () => {
    // base exists, _2 exists, _3 missing → _3
    expect(uniqueName('a', [m('a'), m('a_2'), m('a_4')])).toBe('a_3');
  });
});
