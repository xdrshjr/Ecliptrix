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
  
  // 脚本生成相关状态
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);

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

  // 新增：布局变化监控和性能追踪
  useEffect(() => {
    const layoutObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const { target, contentRect } = entry;
        const className = target.className;
        
        // 记录关键面板的尺寸变化
        if (className.includes('video-editing-preview-panel')) {
          console.log('[VideoEditingInterface] 视频预览面板尺寸变化', {
            taskId,
            panelType: 'preview-panel',
            dimensions: {
              width: contentRect.width,
              height: contentRect.height
            },
            timestamp: new Date().toISOString()
          });
        } else if (className.includes('video-editing-materials-panel')) {
          console.log('[VideoEditingInterface] 素材管理面板尺寸变化', {
            taskId,
            panelType: 'materials-panel',
            dimensions: {
              width: contentRect.width,
              height: contentRect.height
            },
            timestamp: new Date().toISOString()
          });
        } else if (className.includes('video-editing-composition-panel')) {
          console.log('[VideoEditingInterface] 视频合成播放面板尺寸变化', {
            taskId,
            panelType: 'composition-panel',
            dimensions: {
              width: contentRect.width,
              height: contentRect.height
            },
            timestamp: new Date().toISOString()
          });
        } else if (className.includes('video-editing-preview-lower')) {
          console.log('[VideoEditingInterface] 下方容器尺寸变化', {
            taskId,
            panelType: 'preview-lower',
            dimensions: {
              width: contentRect.width,
              height: contentRect.height
            },
            timestamp: new Date().toISOString()
          });
        }
      });
    });

    // 监控所有新增的面板
    const previewPanel = document.querySelector('.video-editing-preview-panel');
    const materialsPanel = document.querySelector('.video-editing-materials-panel');
    const compositionPanel = document.querySelector('.video-editing-composition-panel');
    const lowerPanel = document.querySelector('.video-editing-preview-lower');

    if (previewPanel) layoutObserver.observe(previewPanel);
    if (materialsPanel) layoutObserver.observe(materialsPanel);
    if (compositionPanel) layoutObserver.observe(compositionPanel);
    if (lowerPanel) layoutObserver.observe(lowerPanel);

    console.log('[VideoEditingInterface] 布局监控器已启动', {
      taskId,
      monitoredPanels: {
        previewPanel: !!previewPanel,
        materialsPanel: !!materialsPanel,
        compositionPanel: !!compositionPanel,
        lowerPanel: !!lowerPanel
      },
      timestamp: new Date().toISOString()
    });

    return () => {
      layoutObserver.disconnect();
      console.log('[VideoEditingInterface] 布局监控器已清理', {
        taskId,
        timestamp: new Date().toISOString()
      });
    };
  }, [taskId]);

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

  // 处理脚本生成
  const handleGenerateScript = useCallback(async () => {
    if (!markdownValue.trim() || isGeneratingScript) {
      console.log('[VideoEditingInterface] 脚本生成被跳过', {
        markdownEmpty: !markdownValue.trim(),
        isGenerating: isGeneratingScript,
        taskId,
        timestamp: new Date().toISOString()
      });
      return;
    }

    setIsGeneratingScript(true);
    console.log('[VideoEditingInterface] 开始生成脚本', {
      taskId,
      markdownLength: markdownValue.length,
      timestamp: new Date().toISOString()
    });

    try {
      const response = await fetch('/api/video-script-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          markdownContent: markdownValue,
          taskId: taskId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('[VideoEditingInterface] 脚本生成成功', {
        taskId,
        segmentCount: result.metadata?.segmentCount,
        totalSentences: result.metadata?.totalSentences,
        timestamp: new Date().toISOString()
      });

      if (result.success && result.segments) {
        // 更新content，添加生成的脚本片段
        const updatedContent: VideoEditingTaskContent = {
          markdownContent: markdownValue,
          lastModified: new Date(),
          scriptSegments: result.segments,
        };

        onUpdateContent(updatedContent);
        console.log('[VideoEditingInterface] 脚本内容已更新到任务中', {
          taskId,
          segmentCount: result.segments.length,
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error('Invalid response format from script generation API');
      }

    } catch (error) {
      console.error('[VideoEditingInterface] 脚本生成失败', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });

      alert(`脚本生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsGeneratingScript(false);
      console.log('[VideoEditingInterface] 脚本生成流程结束', {
        taskId,
        timestamp: new Date().toISOString()
      });
    }
  }, [markdownValue, taskId, isGeneratingScript, onUpdateContent]);

  // 处理脚本片段更新
  const handleUpdateSegments = useCallback((updatedSegments: ScriptSegment[]) => {
    console.log('[VideoEditingInterface] 更新脚本片段', {
      taskId,
      segmentCount: updatedSegments.length,
      totalSentences: updatedSegments.reduce((sum, segment) => sum + segment.sentences.length, 0),
      timestamp: new Date().toISOString()
    });

    const updatedContent: VideoEditingTaskContent = {
      markdownContent: markdownValue,
      lastModified: new Date(),
      scriptSegments: updatedSegments,
    };

    onUpdateContent(updatedContent);
  }, [markdownValue, taskId, onUpdateContent]);

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

  // 新增：记录新布局结构的初始化信息
  console.log('[VideoEditingInterface] 初始化新布局结构', {
    taskId,
    layoutVersion: '2.0',
    previewPanelStructure: {
      upperContainer: {
        height: '70%',
        leftPanel: '素材管理 - 50%宽度',
        rightPanel: '视频合成播放 - 50%宽度'
      },
      lowerContainer: {
        height: '30%',
        content: '时间轴和工具栏'
      }
    },
    panelConfiguration: {
      leftPanel: {
        width: '25%宽度',
        components: 'MD编辑器和AI助手',
        newFeatures: '新增项目文档编辑标题头部'
      },
      rightPanel: {
        totalWidth: '75%宽度',
        scriptPanel: '20%宽度',
        previewPanel: '80%宽度 - 新的上下分割布局'
      }
    },
    initTimestamp: new Date().toISOString(),
    headerAlignment: {
      leftPanel: 'markdown-panel-header - 项目文档编辑',
      middlePanel: 'script-panel-header - 文本脚本',
      rightUpperLeft: 'materials-panel-header - 素材管理',
      rightUpperRight: 'composition-panel-header - 视频合成播放',
      allPanelsAligned: true,
      headerHeight: '60px (16px padding + border)'
    }
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 视频编辑工作区 - 左右布局 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧面板 - MD编辑器 */}
        <div className="video-editing-left-panel flex flex-col">
          {/* MD编辑器区域 */}
          <div className="video-editing-markdown-section">
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
              onGenerateScript={handleGenerateScript}
              isGenerating={isGeneratingScript}
              onUpdateSegments={handleUpdateSegments}
            />
          </div>
          
          {/* 视频预览区域 - 占右侧面板的80%宽度，新的上下分割布局 */}
          <div className="video-editing-preview-panel flex flex-col">
            {/* 上方容器 - 70%高度，左右分割 */}
            <div className="video-editing-preview-upper flex">
              {/* 素材管理面板 - 左侧50% */}
              <div className="video-editing-materials-panel border-r border-gray-200">
                <div className="materials-panel-header">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">素材管理</h3>
                  </div>
                </div>
                <div className="materials-panel-content">
                  <div className="space-y-3">
                    <div className="text-center text-gray-500 py-8">
                      <div className="w-12 h-12 bg-gray-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 011 1v1a1 1 0 01-1 1h-1v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7H3a1 1 0 01-1-1V5a1 1 0 011-1h4z" />
                        </svg>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">素材库</p>
                      <p className="text-xs text-gray-500">视频、音频、图片素材将在此管理</p>
                      <div className="mt-4 space-y-2 text-xs text-gray-400">
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                          <span>拖拽上传</span>
                        </div>
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                          <span>素材预览</span>
                        </div>
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                          <span>分类管理</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 视频合成播放面板 - 右侧50% */}
              <div className="video-editing-composition-panel">
                <div className="composition-panel-header">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-1a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">视频合成播放</h3>
                  </div>
                </div>
                <div className="composition-panel-content">
                  <div className="text-center text-gray-500">
                    <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h4 className="text-base font-medium text-gray-900 mb-2">视频预览播放器</h4>
                    <p className="text-sm text-gray-600 mb-4">
                      实时预览合成后的视频效果
                    </p>
                    <div className="space-y-2 text-xs text-gray-500">
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                        <span>实时预览</span>
                      </div>
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                        <span>播放控制</span>
                      </div>
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                        <span>质量设置</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 下方容器 - 30%高度 */}
            <div className="video-editing-preview-lower border-t border-gray-200">
              <div className="preview-lower-content">
                <div className="flex items-center space-x-2 mb-4">
                  <div className="w-6 h-6 bg-purple-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">时间轴和工具栏</h3>
                </div>
                <div className="text-center text-gray-500 py-6">
                  <div className="w-12 h-12 bg-gray-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">编辑时间轴</p>
                  <p className="text-xs text-gray-500">拖拽编辑、剪切、特效等工具将在此显示</p>
                  <div className="mt-4 grid grid-cols-3 gap-4 text-xs text-gray-400">
                    <div className="flex flex-col items-center space-y-1">
                      <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                      <span>时间轴编辑</span>
                    </div>
                    <div className="flex flex-col items-center space-y-1">
                      <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                      <span>特效库</span>
                    </div>
                    <div className="flex flex-col items-center space-y-1">
                      <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
                      <span>导出选项</span>
                    </div>
                  </div>
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