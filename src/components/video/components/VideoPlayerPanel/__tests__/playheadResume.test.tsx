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

  it('cross-source seek runs commitSeekThenPlay AFTER assignSequenceSrc resolves (R4)', () => {
    // After the video-reentry-play-no-source-fix, the explicit canplay listener
    // here was replaced with `await assignSequenceSrc(...)` which internally
    // races loadedmetadata / canplay / error / timeout. The semantic guarantee
    // (seek+play happens after the load completes) is preserved.
    const region = src.split('const seekAndPlayFromTimeline')[1] || '';
    expect(region).toMatch(
      /await\s+assignSequenceSrc\([\s\S]+?commitSeekThenPlay\(/,
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

describe('VideoPlayerPanel — v3 follow-up fix (timeline-playhead-resume-v3)', () => {
  // Slice handleCompositionSeek's body (between its useCallback opener and its
  // closing `}, [...])` dep-list). The closing is recognised by the next
  // top-level identifier definition (`const handleTimeSeekClick`).
  const compositionSeekBody = (() => {
    const start = src.indexOf('const handleCompositionSeek = useCallback');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('const handleTimeSeekClick', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  const seekAndPlayBody = (() => {
    const start = src.indexOf('const seekAndPlayFromTimeline = useCallback');
    expect(start).toBeGreaterThan(-1);
    // Closes before the isPlayingForRefRef declaration.
    const end = src.indexOf('const isPlayingForRefRef', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  const pauseBody = (() => {
    const start = src.indexOf('const pauseFromTimeline = useCallback');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('const seekAndPlayFromTimeline', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  it('seekAndPlayFromTimeline writes isCompositionPlayingRef.current = true synchronously (R3)', () => {
    expect(seekAndPlayBody).toMatch(/isCompositionPlayingRef\.current\s*=\s*true/);
    // The synchronous ref write must be present alongside setIsCompositionPlaying(true).
    expect(seekAndPlayBody).toMatch(/setIsCompositionPlaying\(true\)/);
  });

  it('pauseFromTimeline writes isCompositionPlayingRef.current = false synchronously (R3)', () => {
    expect(pauseBody).toMatch(/isCompositionPlayingRef\.current\s*=\s*false/);
    expect(pauseBody).toMatch(/setIsCompositionPlaying\(false\)/);
  });

  it('handleCompositionSeek contains the v3 timeline-echo short-circuit (R7)', () => {
    // Match the conditional with source === 'timeline' AND isCompositionPlayingRef.current
    // AND Math.abs(...currentTime - mappedVideoTime) < 0.1, plus an early return.
    expect(compositionSeekBody).toMatch(
      /source\s*===\s*'timeline'[\s\S]+?isCompositionPlayingRef\.current[\s\S]+?Math\.abs\(\s*videoRef\.current\.currentTime\s*-\s*mappedVideoTime\s*\)\s*<\s*0\.1/,
    );
    // And the branch ends with `return;`.
    expect(compositionSeekBody).toMatch(
      /Math\.abs\(\s*videoRef\.current\.currentTime\s*-\s*mappedVideoTime\s*\)\s*<\s*0\.1[\s\S]+?return;/,
    );
  });

  it('every wasPlayingBefore initialization inside handleCompositionSeek reads from the ref', () => {
    // Every wasPlayingBefore = <X> assignment must read isCompositionPlayingRef.current,
    // not the bare isCompositionPlaying state.
    const initRegex = /wasPlayingBefore\s*=\s*([A-Za-z_$][\w$.]*)/g;
    const rhsSeen: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = initRegex.exec(compositionSeekBody)) !== null) {
      rhsSeen.push(match[1]);
    }
    expect(rhsSeen.length).toBeGreaterThan(0);
    for (const rhs of rhsSeen) {
      expect(rhs).toMatch(/^isCompositionPlayingRef\.current$/);
    }
    // Defence: no bare `isCompositionPlaying` read inside the function body
    // for either wasPlayingBefore or the logger's wasPlayingBefore field.
    expect(compositionSeekBody).not.toMatch(/wasPlayingBefore\s*=\s*isCompositionPlaying\b/);
    expect(compositionSeekBody).not.toMatch(/wasPlayingBefore:\s*isCompositionPlaying\b/);
  });

  it('handleCompositionSeek dep-list omits isCompositionPlaying and compositionCurrentTime (R5)', () => {
    // Walk every `}, [ ... ]);` closure inside the body and use the last one
    // (the useCallback dep-list). Tolerant of trailing comments / whitespace.
    const depRegex = /\}\s*,\s*\[([^\]]+)\]\s*\)\s*;/g;
    let lastDeps: string | null = null;
    let match: RegExpExecArray | null;
    while ((match = depRegex.exec(compositionSeekBody)) !== null) {
      lastDeps = match[1];
    }
    expect(lastDeps).not.toBeNull();
    const deps = lastDeps as string;
    // Bare identifier should not appear (whitespace / comma bounded).
    expect(deps).not.toMatch(/(^|[\s,])isCompositionPlaying([\s,]|$)/);
    expect(deps).not.toMatch(/(^|[\s,])compositionCurrentTime([\s,]|$)/);
  });

  it('logged previousCompositionTime reads from the ref, not the closure state', () => {
    expect(compositionSeekBody).toMatch(
      /previousCompositionTime:\s*compositionCurrentTimeRef\.current\.toFixed\(2\)/,
    );
    expect(compositionSeekBody).not.toMatch(
      /previousCompositionTime:\s*compositionCurrentTime\.toFixed\(2\)/,
    );
  });
});
