'use client';

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { VideoEditingTaskContent, ScriptSegment } from '@/types';
import ScriptPanel from './ScriptPanel';
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
  const defaultContent = '# Video Editing Project\n\nStart editing your video project documentation here...\n\n## Notes\n- Add your project notes\n- Document your editing workflow\n- Track your progress\n\n## Resources\n- List your video assets\n- Note important timestamps\n- Reference materials';
  
  const [markdownValue, setMarkdownValue] = useState<string>(
    content?.markdownContent || defaultContent
  );
  
  // AI助手相关状态
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Mock数据 - 文本脚本片段
  const mockScriptSegments: ScriptSegment[] = [
    {
      id: 'segment-1',
      title: '开场介绍',
      duration: 15,
      sentences: [
        {
          id: 'sentence-1-1',
          text: '大家好，欢迎来到今天的视频教程。',
          startTime: 0,
          endTime: 3
        },
        {
          id: 'sentence-1-2',
          text: '今天我们要学习如何使用这个强大的视频编辑工具。',
          startTime: 3,
          endTime: 8
        },
        {
          id: 'sentence-1-3',
          text: '这个工具可以帮助我们快速创建专业级的视频内容。',
          startTime: 8,
          endTime: 15
        }
      ]
    },
    {
      id: 'segment-2',
      title: '功能演示',
      duration: 25,
      sentences: [
        {
          id: 'sentence-2-1',
          text: '首先，我们来看看界面的基本布局。',
          startTime: 15,
          endTime: 20
        },
        {
          id: 'sentence-2-2',
          text: '左侧是我们的项目文档编辑区域，可以记录项目相关信息。',
          startTime: 20,
          endTime: 27
        },
        {
          id: 'sentence-2-3',
          text: '右侧是视频预览和脚本显示区域。',
          startTime: 27,
          endTime: 32
        },
        {
          id: 'sentence-2-4',
          text: '这样的布局设计让我们能够同时处理文档和视频内容。',
          startTime: 32,
          endTime: 40
        }
      ]
    },
    {
      id: 'segment-3',
      title: '实际操作',
      duration: 30,
      sentences: [
        {
          id: 'sentence-3-1',
          text: '现在让我们开始实际操作演示。',
          startTime: 40,
          endTime: 45
        },
        {
          id: 'sentence-3-2',
          text: '我们可以在左侧编辑器中输入项目相关的文档内容。',
          startTime: 45,
          endTime: 52
        },
        {
          id: 'sentence-3-3',
          text: '同时，右侧的脚本面板会显示对应的文本内容。',
          startTime: 52,
          endTime: 58
        },
        {
          id: 'sentence-3-4',
          text: '这种设计让内容创作变得更加高效和直观。',
          startTime: 58,
          endTime: 65
        },
        {
          id: 'sentence-3-5',
          text: '每个脚本片段都对应着视频中的一个具体段落。',
          startTime: 65,
          endTime: 70
        }
      ]
    }
  ];

  console.log('[VideoEditingInterface] 组件初始化', {
    taskId,
    hasContent: !!content,
    markdownLength: markdownValue.length,
    scriptSegmentsCount: content?.scriptSegments?.length || mockScriptSegments.length,
    totalScriptSentences: (content?.scriptSegments || mockScriptSegments).reduce((sum, segment) => sum + segment.sentences.length, 0),
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

  // 处理AI助手消息发送
  const handleSendMessage = useCallback(async (message: string) => {
    if (!message.trim() || isLoading) return;

    console.log('[VideoEditingInterface] 发送AI助手消息', {
      taskId,
      messageLength: message.length,
      currentContentLength: markdownValue.length,
      timestamp: new Date().toISOString()
    });

    setIsLoading(true);
    
    try {
      // 调用视频编辑聊天API
      const response = await fetch('/api/video-editing-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message.trim(),
          currentContent: markdownValue,
          taskId: taskId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log('[VideoEditingInterface] 开始接收AI助手流式响应', {
        taskId,
        timestamp: new Date().toISOString()
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';
      let originalContent = markdownValue;
      
      // 如果当前内容是默认placeholder内容，则清除它
      if (originalContent === defaultContent) {
        console.log('[VideoEditingInterface] 清除默认placeholder内容', {
          taskId,
          timestamp: new Date().toISOString()
        });
        originalContent = '';
      }
      
      // 在原内容末尾添加AI回复的分隔符
      const aiResponsePrefix = originalContent ? `\n\n## AI Assistant Response\n\n` : `## AI Assistant Response\n\n`;
      let updatedContent = originalContent + aiResponsePrefix;
      
      // 立即更新MD编辑器显示前缀
      setMarkdownValue(updatedContent);
      handleMarkdownChange(updatedContent);
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log('[VideoEditingInterface] AI助手响应完成', {
                taskId,
                totalResponseLength: accumulatedContent.length,
                timestamp: new Date().toISOString()
              });
              break;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulatedContent += parsed.content;
                
                // 实时更新MD编辑器内容
                const newContent = originalContent + aiResponsePrefix + accumulatedContent;
                setMarkdownValue(newContent);
                handleMarkdownChange(newContent);
                
                // 定期记录流式更新进度
                if (accumulatedContent.length % 50 === 0) {
                  console.log('[VideoEditingInterface] AI流式响应进度', {
                    taskId,
                    accumulatedLength: accumulatedContent.length,
                    timestamp: new Date().toISOString()
                  });
                }
              }
            } catch (e) {
              console.error('[VideoEditingInterface] 解析AI响应数据错误:', e);
            }
          }
        }
      }

      console.log('[VideoEditingInterface] AI助手对话完成', {
        taskId,
        finalResponseLength: accumulatedContent.length,
        finalContentLength: (originalContent + aiResponsePrefix + accumulatedContent).length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('[VideoEditingInterface] AI助手请求错误:', error);
      
      // 错误时显示错误信息
      const errorMessage = `\n\n## AI Assistant Error\n\nSorry, I encountered an error while processing your request. Please try again.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
      const errorContent = markdownValue + errorMessage;
      setMarkdownValue(errorContent);
      handleMarkdownChange(errorContent);
      
    } finally {
      setIsLoading(false);
    }
  }, [taskId, markdownValue, handleMarkdownChange, isLoading]);

  // 处理输入框提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isLoading) {
      console.log('[VideoEditingInterface] 提交AI助手消息', {
        taskId,
        messageLength: inputMessage.trim().length,
        timestamp: new Date().toISOString()
      });
      handleSendMessage(inputMessage.trim());
      setInputMessage('');
    }
  };

  // 处理输入框回车键
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  console.log('[VideoEditingInterface] 渲染界面', {
    taskId,
    markdownLength: markdownValue.length,
    scriptSegmentsCount: content?.scriptSegments?.length || mockScriptSegments.length,
    usingMockData: !content?.scriptSegments,
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
          
          {/* AI助手区域 - 对话输入界面 */}
          <div className="video-editing-ai-assistant-section flex flex-col bg-gray-50 border-t border-gray-200">
            {/* 输入区域 */}
            <div className="flex flex-col p-4">
              {/* AI Assistant标题 */}
              <div className="mb-3">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-5 h-5 bg-blue-100 rounded-md flex items-center justify-center">
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-medium text-gray-900">AI Assistant</h3>
                  {isLoading && (
                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Processing...</span>
                    </div>
                  )}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="flex items-end space-x-3">
                <div className="flex-1 relative">
                  <textarea
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask me anything about video editing, content creation, or project planning..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                    rows={2}
                    disabled={isLoading}
                    style={{ minHeight: '60px', maxHeight: '80px' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!inputMessage.trim() || isLoading}
                  className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg px-4 py-2 transition-colors flex items-center justify-center min-w-[60px] h-[60px]"
                >
                  {isLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* 右侧面板 - Video Preview 区域，内部分为左右布局 */}
        <div className="video-editing-right-panel flex bg-white border-l border-gray-200">
          {/* 脚本面板 - 占右侧面板的20%宽度 */}
          <div className="video-editing-script-panel bg-gray-50 border-r border-gray-200">
            <ScriptPanel 
              segments={content?.scriptSegments || mockScriptSegments} 
              className="h-full"
            />
          </div>
          
          {/* 视频预览区域 - 占右侧面板的80%宽度 */}
          <div className="video-editing-preview-panel flex items-center justify-center">
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
    </div>
  );
};

export default VideoEditingInterface; 