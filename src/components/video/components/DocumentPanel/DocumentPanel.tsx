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
}

const DocumentPanel: React.FC<DocumentPanelProps> = ({
  markdownValue,
  handleMarkdownChange,
  taskId,
  className = ''
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

  return (
    <div className={`video-editing-markdown-section ${className}`}>
      {/* MD编辑器标题头部 */}
      <div className="markdown-panel-header">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">项目文档编辑</h3>
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