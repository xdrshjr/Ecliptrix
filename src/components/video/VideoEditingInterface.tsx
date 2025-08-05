'use client';

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { VideoEditingTaskContent } from '@/types';
import '../../styles/video-editing.css';

// 动态导入MD编辑器以避免SSR问题
const MDEditor = dynamic(
  () => import('@uiw/react-md-editor').then((mod) => mod.default),
  { ssr: false }
);

interface VideoEditingInterfaceProps {
  taskId: string;
  content: VideoEditingTaskContent | null;
  onUpdateContent: (content: VideoEditingTaskContent) => void;
}

const VideoEditingInterface: React.FC<VideoEditingInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
}) => {
  const [markdownValue, setMarkdownValue] = useState<string>(
    content?.markdownContent || '# Video Editing Project\n\nStart editing your video project documentation here...\n\n## Notes\n- Add your project notes\n- Document your editing workflow\n- Track your progress\n\n## Resources\n- List your video assets\n- Note important timestamps\n- Reference materials'
  );

  console.log('[VideoEditingInterface] 组件初始化', {
    taskId,
    hasContent: !!content,
    markdownLength: markdownValue.length,
    timestamp: new Date().toISOString()
  });

  // 处理markdown内容变化
  const handleMarkdownChange = useCallback((value: string = '') => {
    console.log('[VideoEditingInterface] Markdown内容变化', {
      taskId,
      previousLength: markdownValue.length,
      newLength: value.length,
      timestamp: new Date().toISOString()
    });

    setMarkdownValue(value);
    
    // 更新任务内容
    const updatedContent: VideoEditingTaskContent = {
      markdownContent: value,
      lastModified: new Date(),
    };
    
    onUpdateContent(updatedContent);
    
    console.log('[VideoEditingInterface] 任务内容已更新', {
      taskId,
      contentLength: value.length,
      lastModified: updatedContent.lastModified.toISOString()
    });
  }, [taskId, markdownValue.length, onUpdateContent]);

  // 当外部content变化时同步本地状态
  useEffect(() => {
    if (content?.markdownContent !== undefined && content.markdownContent !== markdownValue) {
      console.log('[VideoEditingInterface] 同步外部内容变化', {
        taskId,
        externalContentLength: content.markdownContent.length,
        localContentLength: markdownValue.length,
        timestamp: new Date().toISOString()
      });
      setMarkdownValue(content.markdownContent);
    }
  }, [content, markdownValue, taskId]);

  console.log('[VideoEditingInterface] 渲染界面', {
    taskId,
    markdownLength: markdownValue.length,
    renderTimestamp: new Date().toISOString()
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 视频编辑工作区 - 左右布局 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧面板 - MD编辑器 */}
        <div className="video-editing-left-panel flex flex-col">
          {/* MD编辑器区域 */}
          <div className="video-editing-markdown-section">
            <div className="video-editing-markdown-container">
              <MDEditor
                value={markdownValue}
                onChange={handleMarkdownChange}
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
          
          {/* AI助手区域 - 预留给未来功能 */}
          <div className="video-editing-ai-assistant-section flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <div className="w-12 h-12 bg-gray-200 rounded-xl mx-auto mb-3 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <p className="text-sm font-medium">AI Assistant</p>
              <p className="text-xs text-gray-400">Coming Soon</p>
            </div>
          </div>
        </div>

        {/* 右侧面板 - 预留给未来功能 */}
        <div className="video-editing-right-panel flex items-center justify-center bg-white border-l border-gray-200">
          <div className="text-center text-gray-500 max-w-sm mx-auto px-6">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Video Preview</h3>
            <p className="text-gray-600 mb-4">
              Video preview and editing tools will be available here in future updates.
            </p>
            <div className="space-y-2 text-sm text-gray-500">
              <div className="flex items-center justify-center space-x-2">
                <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                <span>Timeline Editor</span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                <span>Effects Library</span>
              </div>
              <div className="flex items-center justify-center space-x-2">
                <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                <span>Export Options</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoEditingInterface; 