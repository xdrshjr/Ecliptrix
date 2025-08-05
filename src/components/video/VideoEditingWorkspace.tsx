'use client';

import React, { useState, useCallback } from 'react';
import MarkdownEditor from '@uiw/react-markdown-editor';
import '@uiw/react-markdown-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';
import { VideoTaskContent } from '@/types';

interface VideoEditingWorkspaceProps {
  content?: VideoTaskContent;
  onContentChange?: (content: VideoTaskContent) => void;
}

const VideoEditingWorkspace: React.FC<VideoEditingWorkspaceProps> = ({
  content,
  onContentChange,
}) => {
  const [markdownContent, setMarkdownContent] = useState<string>(
    content?.markdownContent || '# Video Editing Project\n\nStart writing your video script or notes here...'
  );

  const handleMarkdownChange = useCallback((value?: string) => {
    const newContent = value || '';
    setMarkdownContent(newContent);
    
    if (onContentChange) {
      onContentChange({
        markdownContent: newContent,
        rightPanelContent: content?.rightPanelContent,
      });
    }

    console.log('Video Editing: Markdown content updated', {
      contentLength: newContent.length,
      timestamp: new Date().toISOString(),
    });
  }, [content?.rightPanelContent, onContentChange]);

  // 组件加载时记录日志
  React.useEffect(() => {
    console.log('VideoEditingWorkspace: 组件已加载', {
      hasContent: !!content,
      markdownLength: markdownContent.length,
    });
  }, []);

  return (
    <div className="flex h-full bg-white">
      {/* 左侧面板 - Markdown编辑器 */}
      <div className="flex-1 border-r border-gray-200 h-full">
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 flex items-center">
              <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Script & Notes Editor
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Write your video script, notes, or planning content using Markdown
            </p>
          </div>
          <div className="flex-1 overflow-hidden">
            <MarkdownEditor
              value={markdownContent}
              onChange={handleMarkdownChange}
              height="calc(100vh - 200px)"
              enablePreview={true}
              visibleEditor={true}
              toolbars={[
                'bold',
                'italic',
                'header',
                'strike',
                'underline',
                'quote',
                'olist',
                'ulist',
                'todo',
                'link',
                'image',
                'code',
                'codeBlock',
              ]}
              toolbarsMode={[
                'preview',
                'fullscreen',
              ]}
              previewProps={{
                style: {
                  backgroundColor: '#fafafa',
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* 右侧面板 - 预留空白区域 */}
      <div className="flex-1">
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 flex items-center">
              <svg className="w-4 h-4 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Video Tools
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Video editing tools and preview will be available here
            </p>
          </div>
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center max-w-sm mx-auto px-6">
              <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Video Editing Tools
              </h3>
              <p className="text-gray-600 text-sm">
                This panel is reserved for future video editing features. 
                You can use the left panel to write scripts and plan your video content.
              </p>
              <div className="mt-4 px-4 py-2 bg-blue-100 text-blue-800 text-xs rounded-lg">
                Coming Soon: Timeline, Effects, Export Options
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoEditingWorkspace; 
 