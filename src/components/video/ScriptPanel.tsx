'use client';

import React from 'react';
import { ScriptSegment } from '@/types';

interface ScriptPanelProps {
  segments: ScriptSegment[];
  className?: string;
}

const ScriptPanel: React.FC<ScriptPanelProps> = ({ 
  segments, 
  className = '' 
}) => {
  console.log('[ScriptPanel] 渲染脚本面板', {
    segmentsCount: segments.length,
    totalSentences: segments.reduce((sum, segment) => sum + segment.sentences.length, 0),
    timestamp: new Date().toISOString()
  });

  if (segments.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">文本脚本</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center text-gray-500">
            <div className="w-12 h-12 bg-gray-100 rounded-lg mx-auto mb-3 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">暂无脚本内容</p>
            <p className="text-xs text-gray-500 mt-1">文本脚本将显示在这里</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 标题栏 */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">文本脚本</h3>
        <p className="text-xs text-gray-500 mt-1">
          {segments.length} 个片段 · {segments.reduce((sum, segment) => sum + segment.sentences.length, 0)} 句话
        </p>
      </div>

      {/* 脚本内容区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {segments.map((segment, segmentIndex) => (
          <div 
            key={segment.id} 
            className="script-segment bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow duration-200"
          >
            {/* 片段标题 */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-800 flex items-center">
                <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold flex items-center justify-center mr-2">
                  {segmentIndex + 1}
                </span>
                {segment.title}
              </h4>
              {segment.duration && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                  {segment.duration}s
                </span>
              )}
            </div>

            {/* 句子列表 */}
            <div className="space-y-2">
              {segment.sentences.map((sentence, sentenceIndex) => (
                <div 
                  key={sentence.id}
                  className="script-sentence flex items-start space-x-3 p-2 rounded hover:bg-gray-50 transition-colors duration-150"
                >
                  <span className="flex-shrink-0 w-5 h-5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium flex items-center justify-center mt-0.5">
                    {sentenceIndex + 1}
                  </span>
                  <p className="flex-1 text-sm text-gray-700 leading-relaxed">
                    {sentence.text}
                  </p>
                  {(sentence.startTime !== undefined || sentence.endTime !== undefined) && (
                    <div className="flex-shrink-0 text-xs text-gray-400 font-mono">
                      {sentence.startTime !== undefined && sentence.endTime !== undefined 
                        ? `${sentence.startTime}s-${sentence.endTime}s`
                        : sentence.startTime !== undefined 
                        ? `${sentence.startTime}s`
                        : `${sentence.endTime}s`
                      }
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScriptPanel; 