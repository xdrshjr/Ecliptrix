/**
 * @vitest-environment node
 *
 * VideoEditingInterface global Space-key dispatcher — spec.md §6.2
 * (timeline-playhead-resume-playback).
 *
 * Source-level regex assertions following the project convention
 * (tsconfig jsx: "preserve" disables JSX mounts under Vitest).
 *
 * What we verify:
 *  - The keydown handler delegates "who owns Space" to shouldGlobalSpaceTogglePlayback
 *    (text inputs and modal dialogs keep it; focused clips/buttons do not).
 *  - The handler returns early when the ref is null (no exception path).
 *  - The handler dispatches via ref.isPlaying() — calling pauseFromTimeline() when playing,
 *    seekAndPlayFromTimeline(timelineCurrentTimeRef.current) when paused.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoEditingInterface.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('VideoEditingInterface — global Space key dispatcher', () => {
  // Isolate the keydown effect block so assertions are scoped to it.
  const handler = (() => {
    const start = src.indexOf('// 全局键盘事件处理 - 空格键播放/暂停功能');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('// Mobile warning dialog close handler', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  it('returns early for non-Space keys', () => {
    expect(handler).toMatch(/event\.code\s*!==\s*'Space'/);
  });

  it('delegates Space ownership to shouldGlobalSpaceTogglePlayback', () => {
    // The text-input / modal exclusion lives in the shared pure helper, which
    // deliberately ignores defaultPrevented and focused buttons (RV-04).
    expect(handler).toMatch(
      /event\.code\s*!==\s*'Space'\s*\|\|\s*!shouldGlobalSpaceTogglePlayback\(event\)/,
    );
    expect(handler).not.toMatch(/event\.defaultPrevented/);
  });

  it('returns when ref is null without throwing', () => {
    expect(handler).toMatch(/if\s*\(!ref\)\s*return;/);
  });

  it('calls event.preventDefault() to avoid page scroll', () => {
    expect(handler).toMatch(/event\.preventDefault\(\)/);
  });

  it('asks the panel for its play state via ref.isPlaying() (R1)', () => {
    expect(handler).toMatch(/typeof\s+ref\.isPlaying\s*===\s*'function'\s*\?\s*ref\.isPlaying\(\)/);
  });

  it('dispatches to pauseFromTimeline when playing', () => {
    expect(handler).toMatch(/if\s*\(isPlayingNow\)\s*\{[\s\S]+?ref\.pauseFromTimeline\(\)/);
  });

  it('dispatches to seekAndPlayFromTimeline(timelineCurrentTimeRef.current) when paused', () => {
    expect(handler).toMatch(/ref\.seekAndPlayFromTimeline\(\s*timelineCurrentTimeRef\.current\s*\)/);
  });

  it('does not call the deprecated handlePlayPauseFromTimeline from the dispatcher', () => {
    expect(handler).not.toMatch(/handlePlayPauseFromTimeline/);
  });
});

describe('VideoEditingInterface — v3 follow-up fix (timeline-playhead-resume-v3)', () => {
  it('declares the playbackDrivenTimeUpdateRef seeded with Number.NEGATIVE_INFINITY', () => {
    expect(src).toMatch(
      /const\s+playbackDrivenTimeUpdateRef\s*=\s*useRef<number>\(\s*Number\.NEGATIVE_INFINITY\s*\)/,
    );
  });

  it('handleVideoTimeUpdate stamps the ref BEFORE calling setTimelineCurrentTime', () => {
    const start = src.indexOf('const handleVideoTimeUpdate = useCallback');
    expect(start).toBeGreaterThan(-1);
    // Slice through the end of the useCallback definition.
    const end = src.indexOf('}, []);', start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    const stampIdx = body.indexOf('playbackDrivenTimeUpdateRef.current = currentTime');
    const setStateIdx = body.indexOf('setTimelineCurrentTime(currentTime)');
    expect(stampIdx).toBeGreaterThan(-1);
    expect(setStateIdx).toBeGreaterThan(-1);
    expect(stampIdx).toBeLessThan(setStateIdx);
  });

  it('handleTimelineTimeChange contains the 0.05 s playback-echo gate before forwarding the seek', () => {
    const start = src.indexOf('const handleTimelineTimeChange = useCallback');
    expect(start).toBeGreaterThan(-1);
    // Slice through the closing dep-list comment + parenthesis line.
    const end = src.indexOf('// 处理时间轴状态变化', start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);

    expect(body).toMatch(
      /Math\.abs\(\s*time\s*-\s*(?:lastPlaybackDrivenTime|playbackDrivenTimeUpdateRef\.current)\s*\)\s*<\s*0\.05/,
    );
    // The return for the playback-echo branch must appear before the
    // composition / preview seek dispatches.
    const returnIdx = body.indexOf('return;');
    const compositionSeekIdx = body.indexOf('timelineComposition.handleCompositionSeek(time)');
    const previewSeekIdx = body.indexOf('videoPlayback.handleTimeSeek(time)');
    expect(returnIdx).toBeGreaterThan(-1);
    expect(compositionSeekIdx).toBeGreaterThan(-1);
    expect(previewSeekIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeLessThan(compositionSeekIdx);
    expect(returnIdx).toBeLessThan(previewSeekIdx);
  });

  it('Space-key handler resets playbackDrivenTimeUpdateRef before invoking play/pause', () => {
    const start = src.indexOf('// 全局键盘事件处理 - 空格键播放/暂停功能');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('// Mobile warning dialog close handler', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);

    const resetIdx = block.indexOf('playbackDrivenTimeUpdateRef.current = Number.NEGATIVE_INFINITY');
    const pauseIdx = block.indexOf('ref.pauseFromTimeline()');
    const playIdx = block.indexOf('ref.seekAndPlayFromTimeline(');
    expect(resetIdx).toBeGreaterThan(-1);
    expect(pauseIdx).toBeGreaterThan(-1);
    expect(playIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeLessThan(pauseIdx);
    expect(resetIdx).toBeLessThan(playIdx);
  });
});
