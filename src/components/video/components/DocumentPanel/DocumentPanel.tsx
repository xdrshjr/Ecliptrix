'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { UseDocumentStateReturn } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

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
}

const DocumentPanel: React.FC<DocumentPanelProps> = ({
  markdownValue,
  handleMarkdownChange,
  taskId,
  className = '',
  onCreativeBrainstormingClick
}) => {
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
            <h3 className="text-sm font-semibold text-gray-900">项目文档编辑</h3>
          </div>
          
          {/* 创意构思按钮 */}
          <button
            onClick={handleCreativeBrainstormingClick}
            className="flex items-center space-x-2 px-3 py-1.5 bg-gradient-to-r from-purple-50 to-blue-50 
                     hover:from-purple-100 hover:to-blue-100 border border-purple-200 rounded-lg 
                     transition-all duration-200 group"
            aria-label="开启创意构思"
          >
            <svg className="w-4 h-4 text-purple-600 group-hover:text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="text-sm font-medium text-purple-700 group-hover:text-purple-800">创意构思</span>
          </button>
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
            placeholder: 'Start writing your video project documentation...',
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