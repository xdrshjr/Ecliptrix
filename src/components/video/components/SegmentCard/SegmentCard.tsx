'use client';

import React, { useEffect, useRef } from 'react';
import { ArrowLeftRight, Clock, ImageIcon, Play, RefreshCw, Square } from './icons';
import type { ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import MaterialThumbnail from '../MaterialsPanel/MaterialThumbnail';
import type { SegmentIndexEntry, SegmentStatus } from '../../lib/segments/segmentLinks';
import SegmentStatusChips from './SegmentStatusChips';
import SegmentMoreMenu from './SegmentMoreMenu';
import type { SegmentMenuItem } from './SegmentMoreMenu';

/** Clicks on these never select the card (spec §3.4.3). */
const INTERACTIVE_SELECTOR =
  'button,a,input,textarea,select,[contenteditable="true"],[role="menu"]';
const EDITABLE_SELECTOR = 'input,textarea,select,[contenteditable="true"]';
const FOCUSABLE_SELECTOR =
  'button:not(:disabled),textarea,input,select,[href],[tabindex]:not([tabindex="-1"])';

export interface SegmentCardActions {
  onSelect(): void;
  onToggleExpanded(): void;
  onExpand(): void;
  onCollapse(): void;
  onNavigate(delta: 1 | -1): void;
  onAudition(): void;
  onReplaceVisual(): void;
  onUpdateVoice(): void;
  registerHeader(element: HTMLButtonElement | null): void;
  registerCard(element: HTMLElement | null): void;
}

export interface SegmentCardState {
  isSelected: boolean;
  isExpanded: boolean;
  isPlaying: boolean;
  isAuditioning: boolean;
  /** Placeholder script (RV-21): no chips, no audition. */
  isPlaceholder: boolean;
  isHeaderTabStop: boolean;
  canAudition: boolean;
  /** Why "更换画面" is disabled, or null when it is enabled. */
  replaceVisualBlockReason: string | null;
  isVoiceBusy: boolean;
}

export interface SegmentCardProps {
  segment: ScriptSegment;
  index: SegmentIndexEntry;
  /** Null for the placeholder script. */
  status: SegmentStatus | null;
  durationSeconds: number | null;
  state: SegmentCardState;
  actions: SegmentCardActions;
  menuItems: SegmentMenuItem[];
  /** Expanded body: ScriptPanel's narration editor / sentences / carousel. */
  renderExpanded(): React.ReactNode;
}

function narrationPreview(segment: ScriptSegment): string {
  if (segment.narrationText) return segment.narrationText;
  return segment.sentences.map((sentence) => sentence.text).join('');
}

function focusFirstEditorControl(body: HTMLElement | null): void {
  if (!body) return;
  const narration = body.querySelector<HTMLElement>(
    '[data-narration-editor] textarea, [data-narration-editor] button',
  );
  (narration ?? body.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
}

const SegmentThumbnail: React.FC<{
  segment: ScriptSegment;
  onReplaceVisual(): void;
  blockReason: string | null;
}> = ({ segment, onReplaceVisual, blockReason }) => {
  const { t } = useLocale();
  const first = segment.videos?.[0];
  if (first) {
    return (
      <div className="segment-card__thumb">
        <MaterialThumbnail material={first} />
      </div>
    );
  }
  const copy = t.workbench.segmentCard;
  return (
    <button
      type="button"
      className="segment-card__thumb segment-card__thumb--empty"
      onClick={onReplaceVisual}
      disabled={blockReason !== null}
      title={blockReason ?? copy.replaceVisual}
      aria-label={`${copy.noVisual} · ${copy.replaceVisual}`}
    >
      <ImageIcon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{copy.noVisual}</span>
    </button>
  );
};

const SegmentCardHeader: React.FC<SegmentCardProps & { bodyId: string; onEnter(): void }> = (props) => {
  const { t } = useLocale();
  const { segment, index, durationSeconds, state, actions, bodyId, onEnter } = props;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      actions.onNavigate(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    } else if (event.key === 'Escape' && state.isExpanded) {
      event.preventDefault();
      event.stopPropagation();
      actions.onCollapse();
    }
  };
  return (
    <div className="segment-card__head">
      <button
        ref={actions.registerHeader}
        type="button"
        className="segment-card__header"
        aria-expanded={state.isExpanded}
        aria-controls={state.isExpanded ? bodyId : undefined}
        aria-current={state.isSelected ? 'true' : undefined}
        tabIndex={state.isHeaderTabStop ? 0 : -1}
        onClick={actions.onToggleExpanded}
        onKeyDown={handleKeyDown}
      >
        <span className="ws-badge-ordinal">{index.badge}</span>
        <span className="segment-card__title">{segment.title || index.label}</span>
      </button>
      {state.isPlaying && (
        <span className="ws-chip ws-chip--primary" data-testid="segment-now-playing">
          <Play size={12} strokeWidth={1.75} aria-hidden="true" />
          {t.workbench.segmentCard.nowPlaying}
        </span>
      )}
      {durationSeconds !== null && (
        <span className="segment-card__duration ws-tabular">
          <Clock size={12} strokeWidth={1.75} aria-hidden="true" />
          {t.workbench.segmentCard.duration.replace('{value}', durationSeconds.toFixed(1))}
        </span>
      )}
    </div>
  );
};

const SegmentCardActionsRow: React.FC<SegmentCardProps> = ({ status, state, actions, menuItems }) => {
  const { t } = useLocale();
  const copy = t.workbench.segmentCard;
  const auditionLabel = state.isAuditioning ? copy.stopAudition : copy.audition;
  return (
    <div className="segment-card__actions">
      {status?.voice === 'stale' && (
        <button
          type="button"
          className="ws-btn ws-btn--outline-primary"
          onClick={actions.onUpdateVoice}
          disabled={state.isVoiceBusy}
        >
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          {copy.updateVoice}
        </button>
      )}
      {!state.isPlaceholder && (
        <button
          type="button"
          className="ws-btn"
          onClick={actions.onAudition}
          disabled={!state.canAudition}
          aria-pressed={state.isAuditioning}
          title={state.canAudition ? auditionLabel : copy.auditionUnavailable}
        >
          {state.isAuditioning
            ? <Square size={16} strokeWidth={1.75} aria-hidden="true" />
            : <Play size={16} strokeWidth={1.75} aria-hidden="true" />}
          {auditionLabel}
        </button>
      )}
      <button
        type="button"
        className="ws-btn"
        onClick={actions.onReplaceVisual}
        disabled={state.replaceVisualBlockReason !== null}
        title={state.replaceVisualBlockReason ?? copy.replaceVisual}
      >
        <ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden="true" />
        {copy.replaceVisual}
      </button>
      <SegmentMoreMenu items={menuItems} label={copy.more} />
    </div>
  );
};

/**
 * 段落卡（spec §3.5.2 / §5.3）。未选中为紧凑态，选中后展开 ScriptPanel 传入的
 * 编辑主体。卡头是真正的 `<button>`（list / listitem 结构，RV-07）；点卡片空白处
 * 选中，点按钮 / 输入框 / 菜单不选中。
 */
const SegmentCard: React.FC<SegmentCardProps> = (props) => {
  const { segment, status, state, actions, renderExpanded } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusEditorOnExpandRef = useRef(false);
  const bodyId = `segment-card-body-${segment.id}`;

  useEffect(() => {
    if (!state.isExpanded || !focusEditorOnExpandRef.current) return;
    focusEditorOnExpandRef.current = false;
    focusFirstEditorControl(bodyRef.current);
  }, [state.isExpanded]);

  const handleEnter = () => {
    if (state.isExpanded) {
      focusFirstEditorControl(bodyRef.current);
      return;
    }
    focusEditorOnExpandRef.current = true;
    actions.onExpand();
  };

  const handleRootClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    actions.onSelect();
  };

  const handleBodyKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const target = event.target as Element;
    if (target.closest(EDITABLE_SELECTOR) || target.closest('[role="menu"]')) return;
    event.stopPropagation();
    actions.onCollapse();
  };

  const showPreview = !state.isExpanded || !segment.narrationText;
  return (
    <div
      ref={actions.registerCard}
      role="listitem"
      className="ws-card segment-card"
      data-selected={state.isSelected ? 'true' : undefined}
      data-segment-id={segment.id}
      onClick={handleRootClick}
    >
      <SegmentCardHeader {...props} bodyId={bodyId} onEnter={handleEnter} />
      {showPreview && (
        <div className="segment-card__preview">
          <SegmentThumbnail
            segment={segment}
            onReplaceVisual={actions.onReplaceVisual}
            blockReason={state.replaceVisualBlockReason}
          />
          <p className="segment-card__narration">{narrationPreview(segment)}</p>
        </div>
      )}
      {!state.isPlaceholder && status && (
        <div className="segment-card__chips">
          <SegmentStatusChips status={status} />
        </div>
      )}
      <SegmentCardActionsRow {...props} />
      {state.isExpanded && (
        <div
          id={bodyId}
          ref={bodyRef}
          className="segment-card__body"
          onKeyDown={handleBodyKeyDown}
        >
          {renderExpanded()}
        </div>
      )}
    </div>
  );
};

export default SegmentCard;
