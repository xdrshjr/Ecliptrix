/**
 * @vitest-environment node
 *
 * TimelinePanel — lock guards on long-running and programmatic edits.
 *
 * Source-level, like the sibling TimelineItem tests: `jsx: "preserve"` keeps
 * Vitest from compiling the panel, and it has no render-test precedent. The
 * decisions themselves live in pure helpers with their own unit tests
 * (`lib/subtitleReplacement`, `lib/trackForMaterial`); these assertions pin
 * that the panel actually consults them at the points that matter.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelSrc = readFileSync(resolve(__dirname, '..', 'TimelinePanel.tsx'), 'utf-8');

function handleAddSubtitleBody(): string {
  const start = panelSrc.indexOf('const handleAddSubtitle = useCallback(');
  const end = panelSrc.indexOf('// JSON import handler', start);
  return panelSrc.slice(start, end);
}

describe('TimelinePanel subtitle replacement commit guard', () => {
  it('re-checks the agent edit lock before transcribing and before writing the result', () => {
    const body = handleAddSubtitleBody();
    const beforeRequest = body.indexOf('setExtractingSubtitles(true)');
    const writeResult = body.indexOf('replaceTimelineAction(');
    const checks: number[] = [];
    const callPattern = /resolveCommitTrack\(\)/g;
    for (let match = callPattern.exec(body); match !== null; match = callPattern.exec(body)) {
      checks.push(match.index);
    }

    expect(body).toMatch(/externalEditLock:\s*fresh\.externalEditLock/);
    expect(checks.some(index => index < beforeRequest)).toBe(true);
    expect(checks.some(index => index > beforeRequest && index < writeResult)).toBe(true);
  });
});

describe('TimelinePanel automatic track choice', () => {
  it('drops and programmatic adds share findTrackForMaterial and warn when all targets are locked', () => {
    expect(panelSrc.match(/findTrackForMaterial\(/g)).toHaveLength(2);
    // The per-material-type compatibility rule is no longer inlined twice.
    expect(panelSrc).not.toMatch(/material\.type === 'image'\) return/);
    expect(panelSrc.match(/reason === 'all-locked'/g)).toHaveLength(2);
  });
});
