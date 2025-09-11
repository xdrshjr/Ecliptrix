'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { UseDocumentStateReturn } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';
import { useLocale } from '@/contexts/LocaleContext';

// 动态导入MD编辑器以避免SSR问题
const MDEditor = dynamic(
  () => import('@uiw/react-md-editor').then((mod) => mod.default),
  { ssr: false }
);

interface DocumentPanelProps {
  markdownValue: string;
  handleMarkdownChange: (value: string) => void;
  taskId: string;
  className?: string;
  onCreativeBrainstormingClick?: () => void;
  onPolishClick?: () => void;
  onGenerateScriptClick?: () => void;
  isGeneratingScript?: boolean;
}

const DocumentPanel: React.FC<DocumentPanelProps> = ({
  markdownValue,
  handleMarkdownChange,
  taskId,
  className = '',
  onCreativeBrainstormingClick,
  onPolishClick,
  onGenerateScriptClick,
  isGeneratingScript = false
}) => {
  const { t } = useLocale();
  const logger = new VideoEditingLogger({
    taskId,
    component: 'DocumentPanel'
  });

  useEffect(() => {
    logger.info('组件初始化', {
      markdownLength: markdownValue.length,
      hasContent: markdownValue.length > 0
    });
  }, []);

  const handleEditorChange = (value: string = '') => {
    logger.info('文档内容变更', {
      previousLength: markdownValue.length,
      newLength: value.length,
      contentDelta: value.length - markdownValue.length
    });
    
    handleMarkdownChange(value);
  };

  const handleCreativeBrainstormingClick = () => {
    logger.info('用户点击创意构思按钮', {
      currentContentLength: markdownValue.length,
      timestamp: new Date().toISOString()
    });
    
    onCreativeBrainstormingClick?.();
  };

  const handlePolishClick = () => {
    logger.info('用户点击智能润色按钮', {
      currentContentLength: markdownValue.length,
      timestamp: new Date().toISOString()
    });
    
    onPolishClick?.();
  };

  const handleGenerateScriptClick = () => {
    logger.info('用户点击生成脚本按钮', {
      currentContentLength: markdownValue.length,
      isGeneratingScript,
      timestamp: new Date().toISOString()
    });
    
    onGenerateScriptClick?.();
  };

  return (
    <div className={`video-editing-markdown-section ${className}`}>
      {/* MD编辑器标题头部 */}
      <div className="markdown-panel-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">{t.documentPanel.title}</h3>
          </div>
          
          {/* 功能按钮组 - 仅图标显示 */}
          <div className="flex items-center space-x-1">
            {/* 创意构思按钮 */}
            <button
              onClick={handleCreativeBrainstormingClick}
              className="flex items-center justify-center w-8 h-8 bg-gradient-to-r from-purple-50 to-blue-50 
                       hover:from-purple-100 hover:to-blue-100 border border-purple-200 rounded-lg 
                       transition-all duration-200 group"
              title={t.documentPanel.creativeBrainstorming}
              aria-label={t.documentPanel.creativeBrainstormingAriaLabel}
            >
              <svg className="w-4 h-4 text-purple-600 group-hover:text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </button>

            {/* 智能润色按钮 */}
            {onPolishClick && (
              <button
                onClick={handlePolishClick}
                className="flex items-center justify-center w-8 h-8 text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 hover:border-purple-300 transition-all duration-200 group"
                title="智能润色当前文档内容"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            
            {/* 生成脚本按钮 */}
            {onGenerateScriptClick && (
              <button
                onClick={handleGenerateScriptClick}
                disabled={isGeneratingScript}
                className="flex items-center justify-center w-8 h-8 text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 group"
                title={isGeneratingScript ? "脚本生成中..." : "根据当前文档内容生成视频脚本"}
              >
                {isGeneratingScript ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="video-editing-markdown-container">
        <MDEditor
          value={markdownValue}
          onChange={handleEditorChange}
          className="video-editing-markdown-editor"
          data-color-mode="light"
          visibleDragbar={false}
          textareaProps={{
            placeholder: t.documentPanel.placeholder,
            style: {
              fontSize: 14,
              lineHeight: 1.6,
            }
          }}
          preview="edit"
          hideToolbar={false}
          height="100%"
        />
      </div>
    </div>
  );
};

export default DocumentPanel; 