'use client';

import React, { useState } from 'react';
import { ScriptSegment, ScriptSentence } from '@/types';

interface ScriptPanelProps {
  segments: ScriptSegment[];
  className?: string;
  onGenerateScript?: () => void;
  isGenerating?: boolean;
  onUpdateSegments?: (segments: ScriptSegment[]) => void;
}

const ScriptPanel: React.FC<ScriptPanelProps> = ({ 
  segments, 
  className = '',
  onGenerateScript,
  isGenerating = false,
  onUpdateSegments
}) => {
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  console.log('[ScriptPanel] 渲染脚本面板', {
    segmentsCount: segments.length,
    totalSentences: segments.reduce((sum, segment) => sum + segment.sentences.length, 0),
    isGenerating,
    hasGenerateCallback: !!onGenerateScript,
    hasUpdateCallback: !!onUpdateSegments,
    editingSentenceId,
    layoutVersion: '2.1 - 标题样式已更新，边距已优化',
    headerStyle: '新增图标和统一样式',
    paddingOptimization: {
      contentArea: '从p-4减少到p-2 (16px -> 8px)',
      scriptSegments: '从p-4减少到p-3 (16px -> 12px)',
      segmentSpacing: '从space-y-4减少到space-y-3',
      emptyState: '从p-6减少到p-4 (24px -> 16px)'
    },
    timestamp: new Date().toISOString()
  });

  const handleStartEdit = (sentence: ScriptSentence) => {
    console.log('[ScriptPanel] 开始编辑句子', {
      sentenceId: sentence.id,
      originalText: sentence.text,
      timestamp: new Date().toISOString()
    });
    setEditingSentenceId(sentence.id);
    setEditingText(sentence.text);
  };

  const handleCancelEdit = () => {
    console.log('[ScriptPanel] 取消编辑句子', {
      sentenceId: editingSentenceId,
      timestamp: new Date().toISOString()
    });
    setEditingSentenceId(null);
    setEditingText('');
  };

  const handleSaveEdit = () => {
    if (!editingSentenceId || !onUpdateSegments) {
      console.warn('[ScriptPanel] 无法保存编辑：缺少必要参数', {
        editingSentenceId,
        hasUpdateCallback: !!onUpdateSegments,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const trimmedText = editingText.trim();
    if (!trimmedText) {
      console.warn('[ScriptPanel] 无法保存编辑：文本为空', {
        sentenceId: editingSentenceId,
        timestamp: new Date().toISOString()
      });
      return;
    }

    console.log('[ScriptPanel] 保存句子编辑', {
      sentenceId: editingSentenceId,
      newText: trimmedText,
      timestamp: new Date().toISOString()
    });

    // 更新segments数据
    const updatedSegments = segments.map(segment => ({
      ...segment,
      sentences: segment.sentences.map(sentence => 
        sentence.id === editingSentenceId 
          ? { ...sentence, text: trimmedText }
          : sentence
      )
    }));

    onUpdateSegments(updatedSegments);
    setEditingSentenceId(null);
    setEditingText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleGenerateScript = () => {
    if (onGenerateScript && !isGenerating) {
      console.log('[ScriptPanel] 用户点击获取脚本按钮', {
        timestamp: new Date().toISOString()
      });
      onGenerateScript();
    }
  };

  if (segments.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="script-panel-header">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-orange-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">文本脚本</h3>
            </div>
            {onGenerateScript && (
              <button
                onClick={handleGenerateScript}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-1"
              >
                {isGenerating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <span>获取脚本</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-gray-500">
            <div className="w-12 h-12 bg-gray-100 rounded-lg mx-auto mb-3 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">暂无脚本内容</p>
            <p className="text-xs text-gray-500 mt-1">
              {onGenerateScript ? '点击"获取脚本"按钮根据左侧内容生成脚本' : '文本脚本将显示在这里'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 标题栏 - 与其他面板保持一致的样式 */}
      <div className="script-panel-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-orange-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">文本脚本</h3>
          </div>
          {onGenerateScript && (
            <button
              onClick={handleGenerateScript}
              disabled={isGenerating}
              className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-1"
            >
              {isGenerating ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>生成中...</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>重新生成</span>
                </>
              )}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {segments.length} 个片段 · {segments.reduce((sum, segment) => sum + segment.sentences.length, 0)} 句话
        </p>
      </div>

      {/* 脚本内容区域 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {segments.map((segment, segmentIndex) => (
          <div 
            key={segment.id} 
            className="script-segment bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow duration-200"
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
                  className="script-sentence relative"
                >
                  {/* 时间标签 - 贴附在文本块右上角外边 */}
                  {(sentence.startTime !== undefined || sentence.endTime !== undefined) && (
                    <div className="absolute -top-2 -right-2 z-10 bg-blue-100 text-blue-700 text-xs font-mono px-2 py-1 rounded-full border border-blue-200 shadow-sm">
                      {sentence.startTime !== undefined && sentence.endTime !== undefined 
                        ? `${sentence.startTime}s-${sentence.endTime}s`
                        : sentence.startTime !== undefined 
                        ? `${sentence.startTime}s`
                        : `${sentence.endTime}s`
                      }
                    </div>
                  )}
                  
                  {/* 句子内容块 */}
                  {editingSentenceId === sentence.id ? (
                    // 编辑模式
                    <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-lg">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full text-sm text-gray-700 leading-relaxed bg-transparent border-none outline-none resize-none"
                        rows={Math.max(2, Math.ceil(editingText.length / 50))}
                        autoFocus
                        placeholder="输入句子内容..."
                      />
                      <div className="flex items-center justify-end space-x-2 mt-2 pt-2 border-t border-blue-200">
                        <button
                          onClick={handleCancelEdit}
                          className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 transition-colors"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          disabled={!editingText.trim()}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    // 显示模式
                    <div 
                      className="group flex items-start p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors duration-150 cursor-pointer"
                      onClick={() => onUpdateSegments && handleStartEdit(sentence)}
                    >
                      <p className="flex-1 text-sm text-gray-700 leading-relaxed">
                        {sentence.text}
                      </p>
                      {onUpdateSegments && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-2">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </div>
                      )}
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