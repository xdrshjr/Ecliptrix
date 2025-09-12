'use client';

import React, { useState } from 'react';
import { AudioSentenceSegment, SentenceTimingInfo } from '@/types';

interface SentenceSegmentBarProps {
  sentenceSegments: AudioSentenceSegment;
  width: number; // 时间轴项目的总宽度（像素）
  height: number; // 时间轴项目的高度（像素）
  duration: number; // 音频总时长（秒）
}

const SentenceSegmentBar: React.FC<SentenceSegmentBarProps> = ({
  sentenceSegments,
  width,
  height,
  duration
}) => {
  const [hoveredSentence, setHoveredSentence] = useState<string | null>(null);

  // 如果没有句子数据，返回空
  if (!sentenceSegments || !sentenceSegments.sentences || sentenceSegments.sentences.length === 0) {
    return null;
  }

  const { sentences } = sentenceSegments;

  // 生成句子颜色（使用交替的颜色方案）
  const getSentenceColor = (index: number, isHovered: boolean): string => {
    const colors = [
      { normal: '#3B82F6', hover: '#2563EB' }, // blue-500, blue-600
      { normal: '#10B981', hover: '#059669' }, // emerald-500, emerald-600
      { normal: '#F59E0B', hover: '#D97706' }, // amber-500, amber-600
      { normal: '#EF4444', hover: '#DC2626' }, // red-500, red-600
      { normal: '#8B5CF6', hover: '#7C3AED' }, // violet-500, violet-600
      { normal: '#06B6D4', hover: '#0891B2' }, // cyan-500, cyan-600
    ];
    
    const colorPair = colors[index % colors.length];
    return isHovered ? colorPair.hover : colorPair.normal;
  };

  // 计算句子在时间轴上的位置和宽度
  const calculateSentencePosition = (sentence: SentenceTimingInfo) => {
    const startPercent = (sentence.start_time / duration) * 100;
    const widthPercent = (sentence.duration / duration) * 100;
    
    return {
      left: `${startPercent}%`,
      width: `${widthPercent}%`
    };
  };

  // 生成句子工具提示内容
  const getSentenceTooltip = (sentence: SentenceTimingInfo): string => {
    const startTime = sentence.start_time.toFixed(1);
    const endTime = sentence.end_time.toFixed(1);
    const duration = sentence.duration.toFixed(1);
    
    return `${sentence.text}\n\n时间: ${startTime}s - ${endTime}s (${duration}s)`;
  };

  return (
    <div className="absolute inset-0 flex">
      {sentences.map((sentence, index) => {
        const position = calculateSentencePosition(sentence);
        const isHovered = hoveredSentence === sentence.sentence_id;
        const color = getSentenceColor(index, isHovered);
        
        return (
          <div
            key={sentence.sentence_id}
            className="relative group"
            style={{
              position: 'absolute',
              left: position.left,
              width: position.width,
              height: '100%',
              backgroundColor: color,
              opacity: isHovered ? 0.9 : 0.7,
              transition: 'all 0.2s ease-in-out',
              cursor: 'pointer',
              borderRight: index < sentences.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'
            }}
            onMouseEnter={() => setHoveredSentence(sentence.sentence_id)}
            onMouseLeave={() => setHoveredSentence(null)}
            title={getSentenceTooltip(sentence)}
          >
            {/* 句子编号指示器（仅在宽度足够时显示） */}
            {width * (sentence.duration / duration) > 30 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span 
                  className="text-xs font-medium text-white drop-shadow-sm"
                  style={{
                    fontSize: Math.min(10, height * 0.3),
                    opacity: 0.8
                  }}
                >
                  {sentence.order}
                </span>
              </div>
            )}
            
            {/* 悬停时的详细信息提示 */}
            {isHovered && (
              <div 
                className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 
                           bg-gray-900 text-white text-xs rounded-md px-2 py-1 shadow-lg
                           whitespace-nowrap pointer-events-none max-w-xs"
                style={{ 
                  minWidth: '120px',
                  maxWidth: '300px'
                }}
              >
                <div className="font-medium mb-1">
                  句子 {sentence.order}
                </div>
                <div className="text-gray-300 mb-1">
                  {sentence.start_time.toFixed(1)}s - {sentence.end_time.toFixed(1)}s 
                  ({sentence.duration.toFixed(1)}s)
                </div>
                <div className="text-gray-100 text-wrap break-words">
                  {sentence.text.length > 50 
                    ? `${sentence.text.substring(0, 50)}...` 
                    : sentence.text
                  }
                </div>
                
                {/* 箭头指示器 */}
                <div 
                  className="absolute top-full left-1/2 transform -translate-x-1/2 
                             border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SentenceSegmentBar;