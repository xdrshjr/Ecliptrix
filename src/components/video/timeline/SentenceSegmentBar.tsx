'use client';

import React, { useMemo, useState } from 'react';
import { AudioSentenceSegment, SentenceTimingInfo } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { formatTimelineTime } from './timeFormat';
import { projectSentencesOntoClip } from './lib/sentenceWindow';

interface SentenceSegmentBarProps {
  sentenceSegments: AudioSentenceSegment;
  width: number; // 时间轴项目的总宽度（像素）
  height: number; // 时间轴项目的高度（像素）
  duration: number; // 片段时长（秒）
  /**
   * 片段在源音频中的入点（秒）。句子时间是源音频上的绝对时间，切分 / 裁剪后
   * 片段只显示 [clipStart, clipStart + duration] 这一段。
   */
  clipStart?: number;
}

// 交替的句子颜色
const SENTENCE_COLORS = [
  { normal: '#3B82F6', hover: '#2563EB' }, // blue-500, blue-600
  { normal: '#10B981', hover: '#059669' }, // emerald-500, emerald-600
  { normal: '#F59E0B', hover: '#D97706' }, // amber-500, amber-600
  { normal: '#EF4444', hover: '#DC2626' }, // red-500, red-600
  { normal: '#8B5CF6', hover: '#7C3AED' }, // violet-500, violet-600
  { normal: '#06B6D4', hover: '#0891B2' }, // cyan-500, cyan-600
];

type SentenceSegmentCopy = ReturnType<typeof useLocale>['t']['timeline']['sentenceSegment'];

/**
 * 句子悬停说明（原生 title）：全文 + 起止时间 + 时长。句段色块与波形模式下的
 * 句子命中层（SentenceHitLayer）共用，保证两种视图提示一致。
 */
export function buildSentenceTooltip(
  sentence: SentenceTimingInfo,
  copy: SentenceSegmentCopy,
): string {
  const startLabel = formatTimelineTime(sentence.start_time, { showMs: true });
  const endLabel = formatTimelineTime(sentence.end_time, { showMs: true });
  const durLabel = `${sentence.duration.toFixed(1)}${copy.durationUnit}`;
  return `${sentence.text}\n\n${copy.timeLabel}${startLabel} - ${endLabel} (${durLabel})`;
}

/** 可见宽度不足时不画序号，避免数字挤出色块。 */
const MIN_LABEL_WIDTH_PX = 30;

const SentenceSegmentBar: React.FC<SentenceSegmentBarProps> = ({
  sentenceSegments,
  width,
  height,
  duration,
  clipStart = 0,
}) => {
  const { t } = useLocale();
  const [hoveredSentence, setHoveredSentence] = useState<string | null>(null);

  const blocks = useMemo(
    () => projectSentencesOntoClip(sentenceSegments?.sentences ?? [], clipStart, duration),
    [sentenceSegments, clipStart, duration],
  );

  if (blocks.length === 0) {
    return null;
  }

  // 悬停说明只走原生 title：自绘卡片会被时间轴滚动容器裁掉，且与 title 重复。
  const getSentenceTooltip = (sentence: SentenceTimingInfo): string =>
    buildSentenceTooltip(sentence, t.timeline.sentenceSegment);

  return (
    <div className="absolute inset-0 flex">
      {blocks.map(({ sentence, leftPct, widthPct }, index) => {
        const isHovered = hoveredSentence === sentence.sentence_id;
        const colorPair = SENTENCE_COLORS[index % SENTENCE_COLORS.length];

        return (
          <div
            key={sentence.sentence_id}
            className="relative"
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              height: '100%',
              backgroundColor: isHovered ? colorPair.hover : colorPair.normal,
              opacity: isHovered ? 0.9 : 0.7,
              transition: 'all 0.2s ease-in-out',
              cursor: 'pointer',
              borderRight: index < blocks.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'
            }}
            onMouseEnter={() => setHoveredSentence(sentence.sentence_id)}
            onMouseLeave={() => setHoveredSentence(null)}
            title={getSentenceTooltip(sentence)}
          >
            {/* 句子编号指示器（仅在可见宽度足够时显示） */}
            {(width * widthPct) / 100 > MIN_LABEL_WIDTH_PX && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className="text-xs font-medium text-white"
                  style={{
                    fontSize: Math.min(10, height * 0.3),
                    opacity: 0.8
                  }}
                >
                  {sentence.order}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SentenceSegmentBar;
