/**
 * @vitest-environment node
 *
 * Timeline playhead resume playback — spec.md §6.2 (timeline-playhead-resume-playback).
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components — same pattern as
 * exportButton.test.tsx in this folder.
 *
 * What we verify:
 *  - VideoPlayerPanelRef exposes seekAndPlayFromTimeline / pauseFromTimeline / isPlaying.
 *  - The seek+play primitive (commitSeekThenPlay) awaits the `seeked` event before play().
 *  - The bootstrap effect defers `currentTime` writes into a canplay listener when src changes.
 *  - The drag-time prop-driven side-effect is gated on paused + not seeking + epsilon.
 *  - The deprecated handlePlayPauseFromTimeline is kept as a thin wrapper.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoPlayerPanel.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('VideoPlayerPanel — timeline-playhead-resume-playback', () => {
  it('extends VideoPlayerPanelRef with seekAndPlayFromTimeline / pauseFromTimeline / isPlaying', () => {
    expect(src).toMatch(/seekAndPlayFromTimeline:\s*\(timelineTime:\s*number\)\s*=>\s*Promise<void>/);
    expect(src).toMatch(/pauseFromTimeline:\s*\(\)\s*=>\s*Promise<void>/);
    expect(src).toMatch(/isPlaying:\s*\(\)\s*=>\s*boolean/);
  });

  it('keeps handleCompositionSeek `source` parameter required and unchanged (R2)', () => {
    expect(src).toMatch(
      /handleCompositionSeek:\s*\(compositionTime:\s*number,\s*targetSequence:\s*VideoSequenceItem,\s*videoTime:\s*number,\s*source:\s*'timeline'\s*\|\s*'player'\)\s*=>\s*Promise<void>/,
    );
  });

  it('defines commitSeekThenPlay that awaits `seeked` before play()', () => {
    // Helper must register a seeked listener, then write currentTime, then await before play().
    expect(src).toMatch(/const\s+commitSeekThenPlay\s*=/);
    // seeked listener registration
    expect(src).toMatch(/video\.addEventListener\('seeked'/);
    // Resolves on either seeked or the safety timeout, then play()
    expect(src).toMatch(/await\s+video\.play\(\)/);
  });

  it('commitSeekThenPlay short-circuits when already at target (avoid 200 ms latency)', () => {
    expect(src).toMatch(/alreadyAtTarget\s*=\s*Math\.abs\(video\.currentTime\s*-\s*targetTime\)\s*<\s*0\.01/);
  });

  it('exposes seekAndPlayFromTimeline / pauseFromTimeline / isPlaying via useImperativeHandle', () => {
    const block = src.match(/useImperativeHandle\s*\(\s*ref\s*,[\s\S]+?\)\s*,/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/seekAndPlayFromTimeline/);
    expect(block![0]).toMatch(/pauseFromTimeline/);
    expect(block![0]).toMatch(/isPlaying:\s*isPlayingForRef/);
    expect(block![0]).toMatch(/handleCompositionSeek/);
  });

  it('seekAndPlayFromTimeline reads target sequence from timeline time and maps via mapTimelineTimeToVideoTime', () => {
    const region = src.split('const seekAndPlayFromTimeline')[1] || '';
    expect(region).toMatch(/findSequenceAtCompositionTime\(/);
    expect(region).toMatch(/mapTimelineTimeToVideoTime\(/);
    expect(region).toMatch(/commitSeekThenPlay/);
  });

  it('cross-source seek runs commitSeekThenPlay INSIDE the canplay handler (R4)', () => {
    // Verifies the seek+play chains *after* canplay rather than racing it.
    const region = src.split('const seekAndPlayFromTimeline')[1] || '';
    expect(region).toMatch(
      /addEventListener\('canplay',[\s\S]+?commitSeekThenPlay\(/,
    );
  });

  it('bootstrap effect defers currentTime into a canplay listener when src changes (R3)', () => {
    // The bootstrap region contains a srcChanged branch that registers a
    // canplay-once listener and writes currentTime inside it.
    expect(src).toMatch(/const\s+srcChanged\s*=/);
    expect(src).toMatch(/handleBootstrapCanPlay/);
    expect(src).toMatch(/addEventListener\('canplay',\s*handleBootstrapCanPlay,\s*\{\s*once:\s*true\s*\}\)/);
  });

  it('bootstrap effect honours non-zero currentTimelineTime instead of clipStart (R3)', () => {
    expect(src).toMatch(/const\s+timelineHint\s*=\s*currentTimelineTime\s*\?\?\s*0/);
    expect(src).toMatch(/timelineHint\s*<=\s*0/);
    expect(src).toMatch(/desiredCompositionTime\s*=\s*timelineHint\s*>\s*0\s*\?\s*timelineHint\s*:\s*0/);
  });

  it('drag-time side-effect is gated on paused + not seeking + epsilon (R5)', () => {
    const region = src.match(/dragSeekThrottleRef[\s\S]+?\}\s*,\s*\[currentTimelineTime/);
    expect(region).not.toBeNull();
    const r = region![0];
    expect(r).toMatch(/isCompositionPlayingRef\.current/);
    expect(r).toMatch(/isSeekingRef\.current/);
    expect(r).toMatch(/Math\.abs\(v\.currentTime\s*-\s*mapped\)\s*<=\s*0\.05/);
    // 50ms trailing throttle
    expect(r).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]+?\}\s*,\s*50\s*\)/);
  });

  it('isPlaying() reads from a ref so closures stay fresh', () => {
    expect(src).toMatch(/isPlayingForRefRef\s*=\s*useRef/);
    expect(src).toMatch(
      /isPlayingForRefRef\.current\s*=\s*playbackMode\s*===\s*'composition'\s*\?\s*isCompositionPlaying\s*:\s*isPlaying/,
    );
  });

  it('handlePlayPauseFromTimeline becomes a thin wrapper that dispatches via isPlayingForRefRef', () => {
    const region = src.split('const handlePlayPauseFromTimeline')[1] || '';
    expect(region).toMatch(/isPlayingForRefRef\.current/);
    expect(region).toMatch(/pauseFromTimeline\(\)/);
    expect(region).toMatch(/seekAndPlayFromTimeline\(timelineTime\)/);
  });

  it('pauseFromTimeline does not call commitSeekThenPlay or mutate currentTime', () => {
    const region = src.split('const pauseFromTimeline')[1]?.split('const seekAndPlayFromTimeline')[0] || '';
    expect(region).toMatch(/currentVideo\.pause\(\)/);
    expect(region).not.toMatch(/commitSeekThenPlay/);
    expect(region).not.toMatch(/\.currentTime\s*=/);
  });
});
