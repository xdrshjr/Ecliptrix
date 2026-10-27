'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { SteerNote } from '@/types/agentSteering';

/**
 * 回合时间线里的「运行中补充」小节点：用户在 Agent 执行途中补充的要求，
 * 出现在它被送达的那一步之后，读者能看懂后续步骤为什么变了。
 *
 * 样式是 `UserMessageNode` 的缩小版（右对齐气泡）。文本一律走文本节点，不用
 * `dangerouslySetInnerHTML`。
 */

export interface SteerNoteNodeProps {
  note: SteerNote;
}

const SteerNoteNode: React.FC<SteerNoteNodeProps> = ({ note }) => {
  const { t } = useLocale();
  return (
    <div
      className="flex justify-end px-2 py-1.5"
      data-testid="steer-note-node"
    >
      <div className="max-w-[85%] rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
          {t.agentCollab.steerNoteLabel}
        </span>
        <span className="block whitespace-pre-wrap break-words text-foreground">
          {note.text}
        </span>
      </div>
    </div>
  );
};

export default SteerNoteNode;
