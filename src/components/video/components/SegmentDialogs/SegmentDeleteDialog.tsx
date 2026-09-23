'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SegmentDialogShell, { ImpactLines } from './SegmentDialogShell';

export interface SegmentDeleteDialogProps {
  ordinal: number;
  title: string;
  /** Clips that would leave the timeline, per lane; empty → no checkbox. */
  removedItems: readonly { trackName: string; count: number }[];
  /** Gap / locked-lane lines shown while the checkbox is ticked. */
  removalLines: readonly string[];
  /** The agent holds the edit lock: only the narration can go (RV2-07). */
  isEditLocked: boolean;
  onConfirm(removeTimelineItems: boolean): void;
  onClose(): void;
}

/**
 * 删除段落确认（spec R2 §3.7）：写明会移除哪些关联片段、素材库文件保留、
 * 可以一次撤销；Agent 编辑时间轴期间复选框置灰，只删解说。
 */
const SegmentDeleteDialog: React.FC<SegmentDeleteDialogProps> = (props) => {
  const { ordinal, title, removedItems, removalLines, isEditLocked, onConfirm, onClose } = props;
  const { t } = useLocale();
  const copy = t.workbench.segmentCommands;
  const hasItems = removedItems.length > 0;
  const [removeItems, setRemoveItems] = useState(hasItems && !isEditLocked);
  const itemsSummary = removedItems
    .map(({ trackName, count }) => copy.deleteItemCount.replace('{name}', trackName).replace('{count}', String(count)))
    .join(copy.listSeparator);
  return (
    <SegmentDialogShell
      title={copy.deleteTitle}
      tone="danger"
      onClose={onClose}
      testId="segment-delete-dialog"
      footer={(
        <>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose} data-autofocus>
            {copy.cancel}
          </button>
          <button
            type="button"
            className="ws-btn ws-btn--danger"
            onClick={() => onConfirm(removeItems && !isEditLocked)}
          >
            {copy.deleteConfirm}
          </button>
        </>
      )}
    >
      <p className="ws-dialog__message">
        {copy.deleteBody.replace('{index}', String(ordinal)).replace('{title}', title)}
      </p>
      {hasItems && (
        <label className="ws-dialog__check" data-disabled={isEditLocked || undefined}>
          <input
            type="checkbox"
            checked={removeItems && !isEditLocked}
            disabled={isEditLocked}
            onChange={(event) => setRemoveItems(event.target.checked)}
          />
          <span>{copy.deleteRemoveItems.replace('{items}', itemsSummary)}</span>
        </label>
      )}
      {hasItems && isEditLocked && <p className="ws-dialog__note" data-tone="warn">{copy.deleteLockedAgent}</p>}
      {hasItems && removeItems && !isEditLocked && <ImpactLines lines={removalLines} />}
      <p className="ws-dialog__note">{copy.deleteKeepNote}</p>
    </SegmentDialogShell>
  );
};

export default SegmentDeleteDialog;
