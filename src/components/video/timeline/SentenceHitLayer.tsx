'use client';

import React, { useMemo } from 'react';
import type { AudioSentenceSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { projectSentencesOntoClip } from './lib/sentenceWindow';
import { buildSentenceTooltip } from './SentenceSegmentBar';

interface SentenceHitLayerProps {
  sentenceSegments: AudioSentenceSegment;
  /** 片段时长（秒）。 */
  duration: number;
  /** 片段在源音频中的入点（秒）。 */
  clipStart?: number;
}

/**
 * 波形模式下的句子命中层（editor-shell-ui-consolidation W6）：透明块覆盖在
 * 波形上，句子边界画 1px 细线，每块带原生 title（句子全文 + 起止时间），
 * 让默认的波形视图不丢句段模式的悬停提示。
 *
 * 不拦截片段交互：不 stopPropagation、不 preventDefault，指针事件照常冒泡到
 * 片段容器，拖拽 / 裁剪 / 选中都不受影响。
 */
const SentenceHitLayer: React.FC<SentenceHitLayerProps> = ({
  sentenceSegments,
  duration,
  clipStart = 0,
}) => {
  const { t } = useLocale();
  const blocks = useMemo(
    () => projectSentencesOntoClip(sentenceSegments?.sentences ?? [], clipStart, duration),
    [sentenceSegments, clipStart, duration],
  );
  if (blocks.length === 0) return null;

  return (
    <div className="absolute inset-0" data-testid="sentence-hit-layer">
      {blocks.map(({ sentence, leftPct, widthPct }, index) => (
        <div
          key={sentence.sentence_id}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            borderRight: index < blocks.length - 1
              ? '1px solid rgba(255, 255, 255, 0.35)'
              : 'none',
          }}
          title={buildSentenceTooltip(sentence, t.timeline.sentenceSegment)}
        />
      ))}
    </div>
  );
};

export default SentenceHitLayer;
