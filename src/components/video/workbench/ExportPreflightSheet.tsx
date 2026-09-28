'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DismissibleExportAdvisory } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { trapTabKey } from '@/components/ui/focusTrap';
import type { CoverExportCheck } from '../hooks/videoExportItems';
import type { ExportAdvisory } from '../hooks/exportAdvisories';

export interface ExportPreflightSheetProps {
  advisories: readonly ExportAdvisory[];
  coverCheck?: CoverExportCheck | null;
  coverDraftChanged?: boolean;
  onApplyCoverDraft?: () => Promise<void>;
  onExportAnyway(): void;
  onClose(): void;
  /** "Review": select the segment the advisory is about. */
  onReviewSegment(segmentId: string): void;
  onOpenCanvas(): void;
  onDismiss(code: DismissibleExportAdvisory): void;
}

type Copy = ReturnType<typeof useLocale>['t'];

export function advisoryText(advisory: ExportAdvisory, t: Copy): string {
  const copy = t.workbench.preflight;
  const list = advisory.segmentOrdinals.join(t.workbench.segmentCommands.listSeparator);
  const count = String(advisory.segmentOrdinals.length);
  switch (advisory.code) {
    case 'voice-pending': return copy.voicePending.replace('{count}', count).replace('{list}', list);
    case 'voice-stale': return copy.voiceStale.replace('{count}', count).replace('{list}', list);
    case 'subtitle-none': return copy.subtitleNone;
    case 'letterbox': return copy.letterbox;
    default: return t.videoExport.blackTailNotice.replace('{seconds}', (advisory.seconds ?? 0).toFixed(1));
  }
}

/**
 * 导出前检查（spec R2 §3.11）：阻断项仍由导出计划直接拒绝；这里只列出不阻止导出的
 * 提示，用户可「仍然导出」或返回编辑。固定在右上角导出按钮下方。
 */
const ExportPreflightSheet: React.FC<ExportPreflightSheetProps> = (props) => {
  const { advisories, onExportAnyway, onClose, onReviewSegment, onOpenCanvas, onDismiss } = props;
  const { t } = useLocale();
  const copy = t.workbench.preflight;
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<DismissibleExportAdvisory>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(false);

  const applyDraft = async () => {
    if (applying || !props.onApplyCoverDraft) return;
    setApplying(true); setApplyError(false);
    try { await props.onApplyCoverDraft(); onClose(); }
    catch { setApplyError(true); }
    finally { setApplying(false); }
  };

  // Focus goes back to the export button (or whatever opened the sheet).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const exportAnyway = () => {
    dismissed.forEach((code) => onDismiss(code));
    onExportAnyway();
  };
  const toggleDismiss = (code: DismissibleExportAdvisory) => setDismissed((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    return next;
  });

  const root = typeof document === 'undefined' ? null
    : (document.querySelector('.editor-workbench') as HTMLElement | null) ?? document.body;
  if (!root) return null;
  return createPortal(
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="ws-preflight"
      data-testid="export-preflight-sheet"
      onKeyDown={(event) => {
        if (event.key === 'Tab') trapTabKey(event, sheetRef.current);
        else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        event.stopPropagation();
      }}
    >
      <h2 id={titleId} className="ws-preflight__title">{copy.title}</h2>
      <p className="ws-preflight__note">{copy.severityNote}</p>
      <div className="ws-preflight__note">
        {props.coverCheck?.status === 'error' ? t.coverStudio.exportInvalid
          : props.coverCheck?.status === 'hidden' ? t.coverStudio.exportHidden
          : props.coverCheck?.status === 'ready' ? (
            <div>
              <img src={props.coverCheck.item.thumbnailUrl} alt="" width={96} />
              {props.coverCheck.mode && <span>{t.coverStudio[props.coverCheck.mode]} · </span>}
              <span>{t.coverStudio.appliedVersion} {props.coverCheck.requiredCover.revision_id.slice(0, 8)} · {props.coverCheck.item.duration.toFixed(2)}s</span>
            </div>
          ) : t.coverStudio.noCover}
      </div>
      {props.coverDraftChanged && (
        <div className="ws-preflight__note">
          <p>{t.coverStudio.updated}</p>
          {props.onApplyCoverDraft && <button type="button" className="ws-btn ws-btn--ghost"
            disabled={applying} onClick={() => void applyDraft()}>{applying ? t.coverStudio.applying : t.coverStudio.apply}</button>}
          {applyError && <p role="alert">{t.coverStudio.exportInvalid}</p>}
        </div>
      )}
      <ul className="ws-preflight__list">
        {advisories.map((advisory) => (
          <li key={advisory.code} className="ws-preflight__item" data-code={advisory.code}>
            <span className="ws-preflight__text">{advisoryText(advisory, t)}</span>
            {advisory.segmentId && (
              <button type="button" className="ws-btn ws-btn--sm ws-btn--ghost"
                onClick={() => onReviewSegment(advisory.segmentId!)}>
                {copy.goHandle}
              </button>
            )}
            {advisory.code === 'letterbox' && (
              <button type="button" className="ws-btn ws-btn--sm ws-btn--ghost" onClick={onOpenCanvas}>
                {copy.openCanvas}
              </button>
            )}
            {advisory.dismissible && (
              <label className="ws-preflight__dismiss">
                <input type="checkbox"
                  checked={dismissed.has(advisory.code as DismissibleExportAdvisory)}
                  onChange={() => toggleDismiss(advisory.code as DismissibleExportAdvisory)} />
                <span>{copy.dontRemind}</span>
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="ws-preflight__footer">
        <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose}>{copy.back}</button>
        <button type="button" className="ws-btn ws-btn--primary" onClick={exportAnyway} disabled={applying || props.coverCheck?.status === 'error'} data-autofocus>
          {props.coverCheck?.status === 'hidden' ? t.coverStudio.exportVisible : props.coverCheck?.status === 'ready' ? t.coverStudio.exportCurrent : copy.exportAnyway}
        </button>
      </div>
    </div>,
    root,
  );
};

export default ExportPreflightSheet;
