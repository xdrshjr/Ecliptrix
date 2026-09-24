'use client';

/**
 * EditorWorkbench — pure layout shell of the segment-centric editor (spec
 * §3.1): top bar, script | preview | materials·properties, a resizable
 * timeline (whose bottom bar carries the panel toggles) and the floating
 * assistant slot. It owns no business
 * state; `layout` (useWorkbenchLayout) decides sizes and visibility.
 */

import React, { useEffect } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import PanelSplitter from './PanelSplitter';
import {
  LEFT_MAX, LEFT_MIN, RIGHT_MAX, RIGHT_MIN, SPLITTER_SIZE, TIMELINE_MIN, UPPER_MIN,
  presetSizeFor, timelineMaxFor,
} from './layoutPrefs';
import type { UseWorkbenchLayoutReturn } from './useWorkbenchLayout';

export interface EditorWorkbenchProps {
  topBar: React.ReactNode;
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  timeline: React.ReactNode;
  /** Floating assistant (FAB + panel), positioned inside `.ws-main`. */
  assistant: React.ReactNode;
  layout: UseWorkbenchLayoutReturn;
  /** `inert` + lock overlay while the agent owns the timeline (S9). */
  isTimelineLocked: boolean;
}

export const WORKBENCH_REGION_IDS = {
  left: 'ws-region-script',
  center: 'ws-region-preview',
  right: 'ws-region-side',
  timeline: 'ws-region-timeline',
} as const;

/** Auto-collapsed panels open as overlays; Esc / outside click closes them. */
function useOverlayDismiss(layout: UseWorkbenchLayoutReturn): void {
  const { overlayOpen, closeOverlays, mainRef } = layout;
  const anyOpen = overlayOpen.left || overlayOpen.right;
  useEffect(() => {
    if (!anyOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || target.closest('[data-overlay="true"], .ws-footer-tools')) return;
      if (mainRef.current?.contains(target)) closeOverlays();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (event.key !== 'Escape' || !target?.closest('[data-overlay="true"]')) return;
      event.stopPropagation();
      closeOverlays();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anyOpen, closeOverlays, mainRef]);
}

function sideAttrs(layout: UseWorkbenchLayoutReturn, side: 'left' | 'right') {
  const overlay = layout.autoCollapsed[side] && layout.overlayOpen[side];
  return {
    'data-collapsed': layout.visible[side] ? undefined : 'true',
    'data-overlay': overlay ? 'true' : undefined,
  };
}

const EditorWorkbench: React.FC<EditorWorkbenchProps> = ({
  topBar, left, center, right, timeline, assistant, layout, isTimelineLocked,
}) => {
  const { t } = useLocale();
  const regions = t.workbench.regions;
  useOverlayDismiss(layout);
  const leftDocked = layout.visible.left && !layout.autoCollapsed.left;
  const rightDocked = layout.visible.right && !layout.autoCollapsed.right;
  const timelineMax = Math.max(
    TIMELINE_MIN,
    Math.min(timelineMaxFor(layout.mainHeight), layout.mainHeight - UPPER_MIN - SPLITTER_SIZE),
  );

  return (
    <div ref={layout.rootRef} className="editor-workbench">
      {topBar}
      <div className="ws-body">
        <div ref={layout.mainRef} className="ws-main">
          <div className="ws-upper">
            <section id={WORKBENCH_REGION_IDS.left} className="ws-region ws-left"
              aria-label={regions.script} {...sideAttrs(layout, 'left')}>
              {left}
            </section>
            {leftDocked && (
              <PanelSplitter id="left" orientation="vertical" direction={1}
                value={layout.resolved.leftWidth} min={LEFT_MIN} max={LEFT_MAX}
                onPreview={(px) => layout.previewSize('left', px)}
                onCommit={(px) => layout.setSize('left', px)}
                onReset={() => layout.setSize('left', presetSizeFor(layout.layout, 'left'))}
                ariaLabel={t.workbench.layout.splitterLeft} controlsId={WORKBENCH_REGION_IDS.left} />
            )}
            <section id={WORKBENCH_REGION_IDS.center} className="ws-region ws-center"
              aria-label={regions.preview}>
              {center}
            </section>
            {rightDocked && (
              <PanelSplitter id="right" orientation="vertical" direction={-1}
                value={layout.resolved.rightWidth} min={RIGHT_MIN} max={RIGHT_MAX}
                onPreview={(px) => layout.previewSize('right', px)}
                onCommit={(px) => layout.setSize('right', px)}
                onReset={() => layout.setSize('right', presetSizeFor(layout.layout, 'right'))}
                ariaLabel={t.workbench.layout.splitterRight} controlsId={WORKBENCH_REGION_IDS.right} />
            )}
            <section id={WORKBENCH_REGION_IDS.right} className="ws-region ws-right"
              aria-label={regions.side} {...sideAttrs(layout, 'right')}>
              {right}
            </section>
          </div>
          <PanelSplitter id="timeline" orientation="horizontal" direction={-1}
            value={layout.resolved.timelineHeight} min={TIMELINE_MIN} max={timelineMax}
            onPreview={(px) => layout.previewSize('timeline', px)}
            onCommit={(px) => layout.setSize('timeline', px)}
            onReset={() => layout.setSize('timeline', presetSizeFor(layout.layout, 'timeline'))}
            ariaLabel={t.workbench.layout.splitterTimeline} controlsId={WORKBENCH_REGION_IDS.timeline} />
          {/* S9：Agent 执行期间 inert 一次性移除时间轴区域的指针与 Tab 路径；
              文档级快捷键（空格播放、导出）不受影响 */}
          <section id={WORKBENCH_REGION_IDS.timeline} className="ws-timeline"
            aria-label={regions.timeline} inert={isTimelineLocked ? true : undefined}>
            {isTimelineLocked && <div className="agent-timeline-lock-overlay" />}
            {timeline}
          </section>
          {assistant}
          <div className="ws-too-narrow" role="status">{t.workbench.layout.tooNarrow}</div>
        </div>
      </div>
    </div>
  );
};

export default EditorWorkbench;
