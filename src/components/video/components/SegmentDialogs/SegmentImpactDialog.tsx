'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SegmentDialogShell, { ImpactLines } from './SegmentDialogShell';

export interface SegmentImpactDialogProps {
  title: string;
  /** Leading explanation (why, or what will happen). */
  message?: string;
  lines: readonly string[];
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
}

/**
 * 通用「作用范围」确认框（spec R2 §3.5 全部应用 / §3.8 重排降级）：先写明会改动
 * 什么、不会改动什么，再由用户确认。
 */
const SegmentImpactDialog: React.FC<SegmentImpactDialogProps> = (props) => {
  const { title, message, lines, confirmLabel, onConfirm, onClose } = props;
  const { t } = useLocale();
  return (
    <SegmentDialogShell
      title={title}
      onClose={onClose}
      testId="segment-impact-dialog"
      footer={(
        <>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose} data-autofocus>
            {t.workbench.segmentCommands.cancel}
          </button>
          <button type="button" className="ws-btn ws-btn--primary" onClick={onConfirm}>{confirmLabel}</button>
        </>
      )}
    >
      {message && <p className="ws-dialog__message">{message}</p>}
      <ImpactLines lines={lines} />
    </SegmentDialogShell>
  );
};

export default SegmentImpactDialog;
