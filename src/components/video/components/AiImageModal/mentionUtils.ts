import type { MentionedImage } from '@/types';

/**
 * Ensure the returned name is not present in `existing`, appending `_2`, `_3`, ...
 * so that `@[name]` tags stay unique across the prompt's mention map.
 */
export function uniqueName(baseName: string, existing: MentionedImage[]): string {
  const names = new Set(existing.map(i => i.name));
  if (!names.has(baseName)) return baseName;
  let n = 2;
  while (names.has(`${baseName}_${n}`)) n += 1;
  return `${baseName}_${n}`;
}
