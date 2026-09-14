/**
 * @vitest-environment node
 *
 * VideoEditingInterface clip-cut wiring (DS3-04). Source-level assertions
 * following the project convention (tsconfig jsx: "preserve" keeps the editor
 * from mounting under Vitest); the notice rules themselves are unit-tested in
 * lib/__tests__/clipCutNotices.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'VideoEditingInterface.tsx'), 'utf-8');

const handler = (() => {
  const start = src.indexOf('const handleExportClips = useCallback(');
  const end = src.indexOf('// 处理视频AI解析', start);
  return start >= 0 && end > start ? src.slice(start, end) : '';
})();

describe('VideoEditingInterface — clip cut outcome', () => {
  it('a cut that produced no clip is not reported with the backend success text', () => {
    // The endpoint answers success: true with "Successfully cut and saved 0
    // video clips" when every clip failed; that must not become the reason.
    expect({
      describesOutcome: /describeClipCutOutcome\(clipCutMessages,\s*\{\s*requestSucceeded:\s*cutResponse\.success,/
        .test(handler),
      formatsBackendMessageAsReason: /failed\.replace\('\{message\}',\s*cutResponse\.message\)/.test(handler),
    }).toEqual({ describesOutcome: true, formatsBackendMessageAsReason: false });
  });

  it('every placeholder left without a cut result is discarded', () => {
    expect(handler).toMatch(/discardPendingMaterials\(unmatched\.map\(entry\s*=>\s*entry\.material\.id\)\)/);
  });
});
