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
 *  - The keydown handler returns early when target is an input / textarea / contentEditable.
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

  it('treats INPUT / TEXTAREA / contentEditable as a blocklist', () => {
    expect(handler).toMatch(/target\.tagName\s*===\s*'INPUT'/);
    expect(handler).toMatch(/target\.tagName\s*===\s*'TEXTAREA'/);
    expect(handler).toMatch(/target\.contentEditable\s*===\s*'true'/);
    expect(handler).toMatch(/target\.closest\('input, textarea, \[contenteditable="true"\]'\)/);
  });

  it('returns when ref is null without throwing', () => {
    // The early-return must reference both isInInputField and !ref.
    expect(handler).toMatch(/isInInputField\s*\|\|\s*!ref/);
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
