/**
 * `qualityLint.ts` 的 16 条规则表驱动测试。
 *
 * 证据：docs/plans/agent-visual-review/spec.md §10.1
 *   - AC-04：每条规则至少 1 正例 + 1 反例；`missing_material` 正例必须是 blocker
 *   - AC-05：`check_timeline` 不发任何网络请求（fetch 被 stub 成抛错仍通过）
 *   - AC-27：空时间线（无视频 item）必须报 `timeline_empty` blocker 且 ok:false
 *   - AC-30：阈值只来自本文件的 `LINT_DEFAULTS`，不读设置/网络
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  CameraMotion, MaterialItem, TimelineItem, TimelineState, Track,
} from '@/types';
import type { TimelineLintReport } from '@/types/agentVision';
import {
  LINT_DEFAULTS, LINT_RULE_CODES, defaultTargetResolution, lintTimeline,
} from '../tools/qualityLint';
import { createCheckTimelineTool } from '../tools/qualityTool';
import type { ToolContext, AgentOperation } from '../types';

// --- fixtures --------------------------------------------------------------

function material(id: string, extra: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id, name: id, type: 'video', format: 'mp4', size: 0,
    url: `https://local.test/${id}.mp4`, createdAt: new Date(0), ...extra,
  };
}

function videoTrack(
  id: string, items: TimelineItem[], extra: Partial<Track> = {},
): Track {
  return {
    id, name: id, type: 'video', height: 80, isLocked: false, isMuted: false,
    isVisible: true, volume: 100, order: 0, items, ...extra,
  };
}

function audioTrack(
  id: string, items: TimelineItem[], extra: Partial<Track> = {},
): Track {
  return { ...videoTrack(id, items, extra), type: 'audio', height: 60 };
}

function subtitleTrack(
  id: string, items: TimelineItem[], extra: Partial<Track> = {},
): Track {
  return { ...videoTrack(id, items, extra), type: 'subtitle' };
}

function clip(
  id: string, startTime: number, duration: number, trackId: string,
  extra: Partial<TimelineItem> = {},
): TimelineItem {
  return {
    id, name: id, type: 'video', startTime, duration, trackId,
    color: '#000000', volume: 1, ...extra,
  };
}

function endOf(tracks: readonly Track[]): number {
  let end = 0;
  for (const track of tracks) {
    for (const item of track.items) end = Math.max(end, item.startTime + item.duration);
  }
  return end;
}

function timelineState(
  tracks: Track[], totalDuration: number,
): TimelineState {
  return {
    currentTime: 0, totalDuration, zoomLevel: 1, selectedItems: [], tracks,
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1,
    scrollLeft: 0,
  };
}

/** 干净时间线：5 秒视频 + 5 秒音频，素材齐、无重叠、无空洞。 */
function fixture(): { tracks: Track[]; materials: MaterialItem[] } {
  return {
    tracks: [
      videoTrack('v1', [clip('v-clip', 0, 5, 'v1', { materialId: 'm_v' })]),
      audioTrack('a1', [clip('a-clip', 0, 5, 'a1',
        { type: 'audio', materialId: 'm_a' })]),
    ],
    materials: [
      material('m_v', { width: 1920, height: 1080, duration: 5 }),
      material('m_a', { type: 'audio', format: 'mp3', duration: 5 }),
    ],
  };
}

interface RunOptions {
  tracks?: Track[];
  materials?: MaterialItem[];
  totalDuration?: number;
  includeNotes?: boolean;
  width?: number;
  height?: number;
}

function run(options: RunOptions = {}): TimelineLintReport {
  const base = fixture();
  const tracks = options.tracks ?? base.tracks;
  return lintTimeline({
    timelineState: timelineState(tracks, options.totalDuration ?? endOf(tracks)),
    materials: options.materials ?? base.materials,
    targetWidth: options.width ?? 1920,
    targetHeight: options.height ?? 1080,
    includeNotes: options.includeNotes ?? true,
  });
}

function codes(report: TimelineLintReport): string[] {
  return report.issues.map(issue => issue.code);
}

function only(code: string, report: TimelineLintReport) {
  return report.issues.filter(issue => issue.code === code);
}

// --- 报告形状与常量（AC-19 / AC-30） --------------------------------------

describe('report shape and thresholds', () => {
  it('pins LINT_DEFAULTS (AC-30: no settings, no network)', () => {
    expect(LINT_DEFAULTS).toEqual({
      maxIssues: 20,
      subtitleMaxLines: 3,
      gapSeconds: 0.5,
      overlapEpsilon: 1e-6,
      durationTolerance: 0.05,
    });
  });

  it('lists exactly the 16 rule codes in §4.10 order', () => {
    expect(LINT_RULE_CODES).toEqual([
      'missing_material', 'clip_bounds', 'item_overlap', 'subtitle_overflow',
      'subtitle_overlap', 'subtitle_style_drift', 'track_hidden', 'audio_gap',
      'volume_out_of_range', 'upscale_blur', 'static_image_too_long',
      'timeline_gap', 'cover_not_applied', 'duration_mismatch', 'timeline_empty',
      'web_material_license_unknown',
    ]);
  });

  it('maps every aspect ratio to its export resolution', () => {
    expect(defaultTargetResolution('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(defaultTargetResolution('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(defaultTargetResolution('4:3')).toEqual({ width: 1440, height: 1080 });
    expect(defaultTargetResolution('1:1')).toEqual({ width: 1080, height: 1080 });
    // 2560x1080 是导出侧 OUTPUT_SIZE_BY_ASPECT 的值（自检不得自己另写一张表）。
    expect(defaultTargetResolution('21:9')).toEqual({ width: 2560, height: 1080 });
  });

  it('reports a clean timeline as ok with all 16 checks listed', () => {
    const report = run();
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.checked_rules).toEqual([...LINT_RULE_CODES]);
    expect(report.next_step).toContain('All 16 checks passed');
  });

  it('sorts blockers before warnings before notes', () => {
    const report = run({
      tracks: [
        videoTrack('v1', [
          clip('bad', -1, 5, 'v1', { materialId: 'gone' }),
          clip('ok', 5, 5, 'v1', { materialId: 'm_v' }),
        ], { isVisible: false }),
      ],
      materials: [material('m_v', { width: 640 })],
    });
    const order = report.issues.map(issue => issue.severity);
    const rank = { blocker: 0, warning: 1, note: 2 } as const;
    const sorted = [...order].sort((a, b) => rank[a] - rank[b]);
    expect(order).toEqual(sorted);
  });

  it('caps issues at maxIssues and counts the rest as truncated', () => {
    const items = Array.from({ length: 26 }, (_, index) =>
      clip(`c${index}`, index * 2, 2, 'v1', { materialId: `gone-${index}`, url: '' }));
    const report = run({ tracks: [videoTrack('v1', items)], materials: [] });
    expect(report.issues).toHaveLength(LINT_DEFAULTS.maxIssues);
    expect(report.truncated).toBe(report.blockers + report.warnings
      + (report.notes) - LINT_DEFAULTS.maxIssues);
  });

  it('hides notes by default but still counts them', () => {
    const tracks = [
      ...fixture().tracks,
      subtitleTrack('s1', [clip('s-clip', 0, 2, 's1', { type: 'subtitle', text: '你好' })]),
    ];
    const quiet = run({ tracks, includeNotes: false });
    expect(codes(quiet)).not.toContain('subtitle_style_drift');
    expect(quiet.notes).toBeGreaterThan(0);
    expect(quiet.next_step).toContain('include_notes=true');
    const loud = run({ tracks });
    expect(codes(loud)).toContain('subtitle_style_drift');
  });

  it('only ever suggests tools that exist', () => {
    const allowed = new Set(['list_materials', 'add_to_track', 'delete_clip',
      'trim_clip', 'move_clip', 'resize_clip', 'auto_fix_overlaps',
      'generate_tts', 'apply_video_cover']);
    const report = run({
      tracks: [
        videoTrack('v1', [
          clip('a', 0, 5, 'v1', { materialId: 'gone' }),
          clip('b', 3, 5, 'v1', { materialId: 'm_v' }),
          clip('img', 9, 10, 'v1', { originalMaterialType: 'image' }),
        ]),
      ],
      materials: [material('m_v', { width: 640 })],
      totalDuration: 30,
    });
    for (const issue of report.issues) {
      if (!issue.suggested_tool) continue;
      expect(allowed.has(issue.suggested_tool)).toBe(true);
    }
  });
});

// --- 规则 1：missing_material ---------------------------------------------

describe('rule 1 — missing_material', () => {
  it('blocks a video clip whose material vanished and has no URL fallback', () => {
    const report = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 5, 'v1', { materialId: 'gone' })])],
      materials: [],
    });
    const [issue] = only('missing_material', report);
    expect(issue.severity).toBe('blocker');
    expect(issue.suggested_tool).toBe('list_materials');
    expect(issue.message).toContain('gone');
    expect(report.ok).toBe(false);
  });

  it('stays quiet when the material or a URL snapshot still exists', () => {
    const withMaterial = run();
    expect(codes(withMaterial)).not.toContain('missing_material');
    const withUrl = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 5, 'v1',
        { materialId: 'gone', url: 'https://local.test/x.mp4' })])],
      materials: [],
    });
    expect(codes(withUrl)).not.toContain('missing_material');
  });

  it('downgrades a missing audio material to a warning', () => {
    const report = run({
      tracks: [audioTrack('a1', [clip('a', 0, 5, 'a1',
        { type: 'audio', materialId: 'gone' })])],
      materials: [],
    });
    const [issue] = only('missing_material', report);
    expect(issue.severity).toBe('warning');
  });
});

// --- 规则 2：clip_bounds --------------------------------------------------

describe('rule 2 — clip_bounds', () => {
  it('blocks a clip that starts before zero', () => {
    const report = run({
      tracks: [videoTrack('v1', [clip('v-clip', -1, 5, 'v1', { materialId: 'm_v' })])],
    });
    expect(only('clip_bounds', report)[0].severity).toBe('blocker');
    expect(report.ok).toBe(false);
  });

  it('blocks a clip with no duration and an empty source range', () => {
    const zero = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 0, 'v1', { materialId: 'm_v' })])],
    });
    expect(codes(zero)).toContain('clip_bounds');
    const emptyRange = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 5, 'v1',
        { materialId: 'm_v', clipStart: 2, clipEnd: 2 })])],
    });
    expect(codes(emptyRange)).toContain('clip_bounds');
  });

  it('accepts the clipStart = clipEnd = 0 still-image whitelist', () => {
    const report = run({
      tracks: [videoTrack('v1', [clip('img', 0, 3, 'v1',
        { originalMaterialType: 'image', clipStart: 0, clipEnd: 0 })])],
    });
    expect(codes(report)).not.toContain('clip_bounds');
  });
});

// --- 规则 3：item_overlap -------------------------------------------------

describe('rule 3 — item_overlap', () => {
  it('warns about two overlapping clips and names auto_fix_overlaps', () => {
    const report = run({
      tracks: [videoTrack('v1', [
        clip('a', 0, 5, 'v1', { materialId: 'm_v' }),
        clip('b', 3, 5, 'v1', { materialId: 'm_v' }),
      ])],
      materials: [material('m_v')],
    });
    const [issue] = only('item_overlap', report);
    expect(issue.severity).toBe('warning');
    expect(issue.suggested_tool).toBe('auto_fix_overlaps');
    expect(issue.target?.at_seconds).toBe(3);
  });

  it('does not flag touching clips', () => {
    const report = run({
      tracks: [videoTrack('v1', [
        clip('a', 0, 5, 'v1', { materialId: 'm_v' }),
        clip('b', 5, 5, 'v1', { materialId: 'm_v' }),
      ])],
      materials: [material('m_v')],
    });
    expect(codes(report)).not.toContain('item_overlap');
  });
});

// --- 规则 4：subtitle_overflow --------------------------------------------

describe('rule 4 — subtitle_overflow', () => {
  it('warns when a long subtitle needs more than 3 lines', () => {
    const report = run({
      tracks: [
        ...fixture().tracks,
        subtitleTrack('s1', [clip('s-clip', 0, 5, 's1',
          { type: 'subtitle', text: '字'.repeat(400) })]),
      ],
    });
    const [issue] = only('subtitle_overflow', report);
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('needs 6 lines');
    expect(issue.message).toContain('font size 24');
  });

  it('accepts a subtitle that fits on one line', () => {
    const report = run({
      tracks: [
        ...fixture().tracks,
        subtitleTrack('s1', [clip('s-clip', 0, 5, 's1',
          { type: 'subtitle', text: '你好世界',
            subtitleStyle: { fontFamily: 'default', fontSize: 24,
              fontColor: '#ffffff', position: 'bottom' } })]),
      ],
    });
    expect(codes(report)).not.toContain('subtitle_overflow');
  });
});

// --- 规则 5：subtitle_overlap ---------------------------------------------

describe('rule 5 — subtitle_overlap', () => {
  it('warns when two subtitles overlap on the same track', () => {
    const report = run({
      tracks: [
        ...fixture().tracks,
        subtitleTrack('s1', [
          clip('s1a', 0, 3, 's1', { type: 'subtitle', text: 'a' }),
          clip('s1b', 2, 3, 's1', { type: 'subtitle', text: 'b' }),
        ]),
      ],
    });
    const [issue] = only('subtitle_overlap', report);
    expect(issue.severity).toBe('warning');
    expect(issue.suggested_tool).toBe('move_clip');
  });

  it('does not flag back-to-back subtitles', () => {
    const report = run({
      tracks: [
        ...fixture().tracks,
        subtitleTrack('s1', [
          clip('s1a', 0, 2, 's1', { type: 'subtitle', text: 'a' }),
          clip('s1b', 2, 2, 's1', { type: 'subtitle', text: 'b' }),
        ]),
      ],
    });
    expect(codes(report)).not.toContain('subtitle_overlap');
  });
});

// --- 规则 6：subtitle_style_drift -----------------------------------------

describe('rule 6 — subtitle_style_drift', () => {
  it('notes a subtitle without a style and keeps it non-blocking', () => {
    const report = run({
      tracks: [
        ...fixture().tracks,
        subtitleTrack('s1', [clip('s-clip', 0, 2, 's1',
          { type: 'subtitle', text: 'hi' })]),
      ],
    });
    const [issue] = only('subtitle_style_drift', report);
    expect(issue.severity).toBe('note');
    expect(issue.message).toContain('24px');
    expect(report.ok).toBe(true);
  });

  it('says nothing when the style is set', () => {
    const report = run({
      tracks: [
        ...fixture().tracks,
        subtitleTrack('s1', [clip('s-clip', 0, 2, 's1',
          { type: 'subtitle', text: 'hi',
            subtitleStyle: { fontFamily: 'default', fontSize: 30,
              fontColor: '#ffffff', position: 'bottom' } })]),
      ],
    });
    expect(codes(report)).not.toContain('subtitle_style_drift');
  });
});

// --- 规则 7：track_hidden -------------------------------------------------

describe('rule 7 — track_hidden', () => {
  it('blocks a hidden video track and a muted audio track that hold clips', () => {
    const base = fixture();
    const hidden = run({
      tracks: [videoTrack('v1', base.tracks[0].items, { isVisible: false }),
        base.tracks[1]],
    });
    expect(only('track_hidden', hidden)[0].severity).toBe('blocker');
    expect(hidden.ok).toBe(false);
    const muted = run({
      tracks: [base.tracks[0], audioTrack('a1', base.tracks[1].items,
        { isMuted: true })],
    });
    expect(codes(muted)).toContain('track_hidden');
  });

  it('blocks an audio track hidden via isVisible (export filters on both)', () => {
    // CompositionAdapter.extractAudioTracks 的过滤是 `!isVisible || isMuted`：
    // 只查 isMuted 会把"没静音但被隐藏"的音频轨判成通过，成片里却整轨消失。
    const base = fixture();
    const hiddenAudio = run({
      tracks: [base.tracks[0], audioTrack('a1', base.tracks[1].items,
        { isVisible: false })],
    });
    expect(codes(hiddenAudio)).toContain('track_hidden');
  });

  it('ignores an empty hidden track', () => {
    const base = fixture();
    const report = run({
      tracks: [base.tracks[0], base.tracks[1],
        videoTrack('v2', [], { isVisible: false })],
    });
    expect(codes(report)).not.toContain('track_hidden');
  });
});

// --- 规则 8：audio_gap ----------------------------------------------------

describe('rule 8 — audio_gap', () => {
  it('warns about an uncovered stretch longer than 2s', () => {
    const report = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 10, 'v1',
        { materialId: 'm_v' })]),
      audioTrack('a1', [clip('a-clip', 0, 3, 'a1',
        { type: 'audio', materialId: 'm_a' })])],
      materials: [material('m_v'), material('m_a', { type: 'audio' })],
    });
    const issues = only('audio_gap', report);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].suggested_tool).toBe('generate_tts');
    expect(issues[0].message).toContain('3.00s');
  });

  it('warns when every audio clip is muted by volume', () => {
    const report = run({
      tracks: [
        fixture().tracks[0],
        audioTrack('a1', [clip('a-clip', 0, 5, 'a1',
          { type: 'audio', materialId: 'm_a', volume: 0 })]),
      ],
    });
    expect(codes(report)).toContain('audio_gap');
    expect(report.issues.find(issue => issue.code === 'audio_gap')?.severity)
      .toBe('warning');
  });

  it('accepts full audio coverage', () => {
    expect(codes(run())).not.toContain('audio_gap');
  });
});

// --- 规则 9：volume_out_of_range -----------------------------------------

describe('rule 9 — volume_out_of_range', () => {
  it('warns above track volume 150 and above item volume 1', () => {
    const base = fixture();
    const loudTrack = run({
      tracks: [base.tracks[0],
        audioTrack('a1', base.tracks[1].items, { volume: 180 })],
    });
    expect(only('volume_out_of_range', loudTrack)[0].severity).toBe('warning');
    const loudClip = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 5, 'v1',
        { materialId: 'm_v', volume: 1.5 })]), base.tracks[1]],
    });
    expect(codes(loudClip)).toContain('volume_out_of_range');
  });

  it('accepts the default levels', () => {
    expect(codes(run())).not.toContain('volume_out_of_range');
  });
});

// --- 规则 10：upscale_blur ------------------------------------------------

describe('rule 10 — upscale_blur', () => {
  it('notes a material narrower than 75% of the target width', () => {
    const report = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 5, 'v1',
        { materialId: 'm_v' })])],
      materials: [material('m_v', { width: 640 }), material('m_a')],
    });
    const [issue] = only('upscale_blur', report);
    expect(issue.severity).toBe('note');
    expect(issue.message).toContain('640px');
    expect(issue.message).toContain('1920px');
  });

  it('skips materials at target size or without a width', () => {
    const big = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 5, 'v1',
        { materialId: 'm_v' })])],
      materials: [material('m_v', { width: 1920 }), material('m_a')],
    });
    expect(codes(big)).not.toContain('upscale_blur');
    const unknown = run({
      tracks: [videoTrack('v1', [clip('v-clip', 0, 5, 'v1',
        { materialId: 'm_v' })])],
      materials: [material('m_v'), material('m_a')],
    });
    expect(codes(unknown)).not.toContain('upscale_blur');
  });
});

// --- 规则 11：static_image_too_long --------------------------------------

const STILL_KEYFRAME = {
  scale: 1, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0,
};

const SLOW_PUSH: CameraMotion = {
  version: 1, mode: '2d', presetId: 'custom', intensity: 0.2,
  easing: 'linear', start: STILL_KEYFRAME, end: STILL_KEYFRAME,
};

describe('rule 11 — static_image_too_long', () => {
  it('notes a still held past 8s and suggests no tool (none exists)', () => {
    const report = run({
      tracks: [videoTrack('v1', [
        clip('img', 0, 10, 'v1', { originalMaterialType: 'image' }),
      ]), audioTrack('a1', [clip('a', 0, 10, 'a1', { type: 'audio' })])],
    });
    const [issue] = only('static_image_too_long', report);
    expect(issue.severity).toBe('note');
    expect(issue.suggested_tool).toBeNull();
    expect(issue.message).toContain('camera-motion panel');
  });

  it('accepts a short still or one with camera motion', () => {
    const short = run({
      tracks: [videoTrack('v1', [clip('img', 0, 5, 'v1',
        { originalMaterialType: 'image' })])],
    });
    expect(codes(short)).not.toContain('static_image_too_long');
    const moving = run({
      tracks: [videoTrack('v1', [clip('img', 0, 10, 'v1',
        { originalMaterialType: 'image', cameraMotion: SLOW_PUSH })])],
    });
    expect(codes(moving)).not.toContain('static_image_too_long');
  });
});

// --- 规则 12：timeline_gap -----------------------------------------------

describe('rule 12 — timeline_gap', () => {
  it('notes a hole longer than 0.5s on the main picture track', () => {
    const report = run({
      tracks: [videoTrack('v1', [
        clip('a', 0, 2, 'v1', { materialId: 'm_v' }),
        clip('b', 5, 2, 'v1', { materialId: 'm_v' }),
      ])],
      materials: [material('m_v')],
    });
    const [issue] = only('timeline_gap', report);
    expect(issue.severity).toBe('note');
    expect(issue.suggested_tool).toBe('move_clip');
    expect(issue.message).toContain('3.00s');
  });

  it('accepts clips that butt up against each other', () => {
    const report = run({
      tracks: [videoTrack('v1', [
        clip('a', 0, 2, 'v1', { materialId: 'm_v' }),
        clip('b', 2, 3, 'v1', { materialId: 'm_v' }),
      ])],
      materials: [material('m_v')],
    });
    expect(codes(report)).not.toContain('timeline_gap');
  });
});

// --- 规则 13：cover_not_applied ------------------------------------------

describe('rule 13 — cover_not_applied', () => {
  it('notes a flagged project whose cover clip is missing', () => {
    const base = fixture();
    const coverState = {
      ...timelineState(base.tracks, 5), coverSchemaVersion: 2 as const,
    };
    const report = lintTimeline({
      timelineState: coverState,
      materials: base.materials, targetWidth: 1920, targetHeight: 1080,
      includeNotes: true,
    });
    const [issue] = only('cover_not_applied', report);
    expect(issue.severity).toBe('note');
    expect(issue.suggested_tool).toBe('apply_video_cover');
  });

  it('stays quiet without the flag or with a cover clip on the timeline', () => {
    expect(codes(run())).not.toContain('cover_not_applied');
    const base = fixture();
    const coverClip = clip('v-clip', 0, 5, 'v1',
      { materialId: 'm_v', metadata: { role: 'video-cover' as const } });
    const coveredTracks = [videoTrack('v1', [coverClip]), base.tracks[1]];
    const coveredState = {
      ...timelineState(coveredTracks, 5), coverSchemaVersion: 2 as const,
    };
    const withFlag = lintTimeline({
      timelineState: coveredState,
      materials: base.materials,
      targetWidth: 1920,
      targetHeight: 1080,
    });
    expect(codes(withFlag)).not.toContain('cover_not_applied');
  });
});

// --- 规则 14：duration_mismatch ------------------------------------------

describe('rule 14 — duration_mismatch', () => {
  it('warns when totalDuration is off by more than 0.05s', () => {
    const report = run({ totalDuration: 9 });
    const [issue] = only('duration_mismatch', report);
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('4.00s');
  });

  it('accepts a drift inside the tolerance', () => {
    expect(codes(run({ totalDuration: 5.02 }))).not.toContain('duration_mismatch');
  });
});

// --- 规则 15：timeline_empty（AC-27） ------------------------------------

describe('rule 15 — timeline_empty', () => {
  it('blocks a timeline with no video clip at all (AC-27: no false green)', () => {
    const report = run({
      tracks: [audioTrack('a1', [clip('a', 0, 5, 'a1', { type: 'audio' })])],
    });
    const [issue] = only('timeline_empty', report);
    expect(issue.severity).toBe('blocker');
    expect(issue.suggested_tool).toBe('add_to_track');
    expect(report.ok).toBe(false);
  });

  it('blocks an empty timeline', () => {
    const report = run({ tracks: [videoTrack('v1', [])] });
    expect(codes(report)).toContain('timeline_empty');
    expect(report.ok).toBe(false);
  });

  it('blocks clips that exist while totalDuration stayed zero', () => {
    const report = run({ totalDuration: 0 });
    expect(codes(report)).toContain('timeline_empty');
    expect(report.ok).toBe(false);
  });

  it('does not fire on a populated timeline', () => {
    expect(codes(run())).not.toContain('timeline_empty');
  });
});

// --- 工具层（AC-05 / AC-30） ---------------------------------------------

function toolContext(overrides: Partial<TimelineState> = {}): ToolContext {
  const base = fixture();
  return {
    timelineState: { ...timelineState(base.tracks, 5), ...overrides },
    materials: base.materials,
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map<string, AgentOperation>(),
    updateTimeline: () => undefined,
    recordOperation: () => undefined,
    turnState: {},
  };
}

describe('check_timeline tool', () => {
  it('is a resident workflow tool with a compact description', () => {
    const tool = createCheckTimelineTool(toolContext());
    expect(tool.name).toBe('check_timeline');
    expect(tool.label).toBe('Check Timeline');
    expect(new TextEncoder().encode(tool.description).length)
      .toBeLessThanOrEqual(180);
    expect(tool.description).toContain('no network');
    expect(tool.description).toContain('before export');
  });

  it('runs the lint without a single network call (AC-05)', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network is not allowed in check_timeline');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const tool = createCheckTimelineTool(toolContext());
      const out = await tool.execute('call-1', { aspect_ratio: '9:16' });
      const details = out.details as { ok: boolean; checked_rules: string[] };
      expect(details.ok).toBe(true);
      expect(details.checked_rules).toHaveLength(16);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('checks the requested aspect ratio and hides notes by default', async () => {
    const tool = createCheckTimelineTool(toolContext());
    const out = await tool.execute('call-2', { aspect_ratio: '9:16' });
    const details = out.details as { ok: boolean; notes: number;
      issues: Array<{ code: string }> };
    // A 1920px-wide source on a 1080px frame is not an upscale.
    expect(details.issues.map(issue => issue.code)).not.toContain('upscale_blur');
    expect(details.notes).toBe(0);
  });
});
