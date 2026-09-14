/**
 * @vitest-environment node
 *
 * N-12: while the agent edits, VideoEditingInterface marks the timeline
 * section `inert`. Dialogs rendered inside that subtree freeze (Cancel, ×,
 * Escape dead) and their backdrop lets clicks through, so the panel portals
 * them to <body>. Source-level: TimelinePanel imports most of the editor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'TimelinePanel.tsx'), 'utf-8');

describe('TimelinePanel dialogs', () => {
  it('subtitle, camera-motion and replace-confirm dialogs render outside the timeline section', () => {
    const portalled = src.match(/createPortal\(\s*<>([\s\S]*?)<\/>\s*,\s*portalHost\s*,?\s*\)/)?.[1] ?? '';
    expect({
      cameraMotion: portalled.includes('<CameraMotionModal'),
      subtitleEdit: portalled.includes('<SubtitleEditModal'),
      replaceConfirm: portalled.includes('<ConfirmationDialog'),
      hostIsBody: /setPortalHost\(document\.body\)/.test(src),
    }).toEqual({ cameraMotion: true, subtitleEdit: true, replaceConfirm: true, hostIsBody: true });
  });
});
