import { describe, expect, it } from 'vitest';
import type { MaterialItem, TimelineItem, TimelineState, Track } from '@/types';
import type { WebMaterialProvenance } from '@/types/webResearch';
import { LINT_RULE_CODES, lintTimeline } from '../tools/qualityLint';

/**
 * 规则 16 `web_material_license_unknown`（spec §3.5 / AC-D1、AC-D3）：
 * 授权不明的网络素材上了轨 → 1 条聚合 warning；声明了授权或是本地素材 → 无；
 * 它是 warning，所以不会让报告 `ok:false`（不阻断导出）。
 */

const CODE = 'web_material_license_unknown';

function provenance(status: 'unknown' | 'declared'): WebMaterialProvenance {
  return {
    source_page_url: 'https://example.com/page', final_url: 'https://example.com/page',
    title: 'Page', license_status: status, retrieved_at: '2026-10-27T00:00:00Z',
    sha256: 'abc',
  };
}

function webMaterial(id: string, status?: 'unknown' | 'declared'): MaterialItem {
  return {
    id, name: `${id}.mp4`, type: 'video', format: 'mp4', size: 0, url: `/m/${id}.mp4`,
    createdAt: new Date(0), width: 1920, height: 1080, duration: 5,
    metadata: { source: 'web', ...(status ? { provenance: provenance(status) } : {}) },
  };
}

function localMaterial(id: string): MaterialItem {
  return {
    id, name: `${id}.mp4`, type: 'video', format: 'mp4', size: 0, url: `/m/${id}.mp4`,
    createdAt: new Date(0), width: 1920, height: 1080, duration: 5,
  };
}

function item(id: string, materialId: string, startTime: number): TimelineItem {
  return {
    id, name: id, type: 'video', startTime, duration: 5, trackId: 'v1',
    color: '#000', volume: 1, materialId,
  };
}

function lint(materials: MaterialItem[]) {
  const items = materials.map((material, index) => item(`c${index}`, material.id, index * 5));
  const track: Track = {
    id: 'v1', name: 'v1', type: 'video', height: 80, isLocked: false, isMuted: false,
    isVisible: true, volume: 100, order: 0, items,
  };
  const state: TimelineState = {
    currentTime: 0, totalDuration: items.length * 5, zoomLevel: 1, selectedItems: [],
    tracks: [track], playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1,
    scrollLeft: 0,
  };
  return lintTimeline({
    timelineState: state, materials, targetWidth: 1920, targetHeight: 1080,
    includeNotes: true,
  });
}

describe('rule 16: web_material_license_unknown', () => {
  it('is the 16th checked rule', () => {
    expect(LINT_RULE_CODES).toHaveLength(16);
    expect(LINT_RULE_CODES[15]).toBe(CODE);
  });

  it('aggregates unknown-licence web materials into ONE warning, without blocking', () => {
    const report = lint([webMaterial('w1', 'unknown'), webMaterial('w2'), localMaterial('l1')]);
    const issues = report.issues.filter(issue => issue.code === CODE);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].suggested_tool).toBe('build_credits');
    expect(issues[0].message).toContain('2 web material');
    expect(report.ok).toBe(true);
    expect(report.checked_rules).toContain(CODE);
  });

  it('stays quiet when every web material declares a licence', () => {
    const report = lint([webMaterial('w1', 'declared'), webMaterial('w2', 'declared')]);
    expect(report.issues.filter(issue => issue.code === CODE)).toEqual([]);
  });

  it('ignores local materials', () => {
    expect(lint([localMaterial('l1'), localMaterial('l2')]).issues
      .filter(issue => issue.code === CODE)).toEqual([]);
  });

  it('lists at most five names and the remainder count', () => {
    const many = Array.from({ length: 8 }, (_, index) => webMaterial(`w${index}`, 'unknown'));
    const [issue] = lint(many).issues.filter(entry => entry.code === CODE);
    expect(issue.message).toContain('8 web material');
    expect(issue.message).toContain('and 3 more');
    expect(issue.message).not.toContain('w7.mp4');
  });
});
