'use client';

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { VideoEditingTaskContent, ScriptSegment, MaterialItem, MaterialType } from '@/types';
import ScriptPanel from './ScriptPanel';
import { TimelinePanel } from './timeline';
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
  
  // 素材管理相关状态
  const [selectedMaterialType, setSelectedMaterialType] = useState<MaterialType | 'all'>('all');
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // 视频播放相关状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(45); // 当前播放时间（秒）
  const [volume, setVolume] = useState(0.8); // 音量 (0-1)
  const [playbackRate, setPlaybackRate] = useState(1.0); // 播放速度
  const [previewQuality, setPreviewQuality] = useState<'low' | 'medium' | 'high' | 'original'>('high');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // 视频搜索相关状态
  const [isVideoSearchModalOpen, setIsVideoSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOrientation, setSearchOrientation] = useState<'landscape' | 'portrait' | 'mixed'>('mixed');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedSearchResults, setSelectedSearchResults] = useState<Set<number>>(new Set());

  // 素材库状态 - 开始时为空，用户可以通过搜索添加视频
  const [materials, setMaterials] = useState<MaterialItem[]>([]);

  // Mock数据 - 视频预览信息
  const mockVideoPreview = {
    title: '产品演示视频 v2.1',
    duration: 150, // 2分30秒
    resolution: { width: 1920, height: 1080 },
    frameRate: 30,
    format: 'MP4',
    fileSize: 45.6, // MB
    codec: 'H.264',
    bitrate: '4.2 Mbps',
    thumbnailUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMyMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIxODAiIGZpbGw9IiMxMTE4MjciLz48Y2lyY2xlIGN4PSIxNjAiIGN5PSI5MCIgcj0iMzAiIGZpbGw9IiM2MzY2ZjEiLz48cGF0aCBkPSJNMTUwIDc1TDE3NSA5MEwxNTAgMTA1Vjc1WiIgZmlsbD0id2hpdGUiLz48L3N2Zz4='
  };

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
    videoPreview: {
      title: mockVideoPreview.title,
      duration: mockVideoPreview.duration,
      resolution: `${mockVideoPreview.resolution.width}×${mockVideoPreview.resolution.height}`,
      format: mockVideoPreview.format,
      isPlaying,
      currentTime,
      volume,
      playbackRate,
      previewQuality
    },
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

  // 视频播放控制事件处理函数
  const handlePlayPause = useCallback(() => {
    console.log('[VideoEditingInterface] 播放/暂停切换', {
      taskId,
      previousState: isPlaying ? 'playing' : 'paused',
      newState: !isPlaying ? 'playing' : 'paused',
      currentTime,
      timestamp: new Date().toISOString()
    });
    setIsPlaying(!isPlaying);
  }, [taskId, isPlaying, currentTime]);

  const handleTimeSeek = useCallback((newTime: number) => {
    console.log('[VideoEditingInterface] 视频时间跳转', {
      taskId,
      previousTime: currentTime,
      newTime,
      duration: mockVideoPreview.duration,
      timestamp: new Date().toISOString()
    });
    setCurrentTime(Math.max(0, Math.min(newTime, mockVideoPreview.duration)));
  }, [taskId, currentTime, mockVideoPreview.duration]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    console.log('[VideoEditingInterface] 音量调节', {
      taskId,
      previousVolume: volume,
      newVolume,
      timestamp: new Date().toISOString()
    });
    setVolume(Math.max(0, Math.min(1, newVolume)));
  }, [taskId, volume]);

  const handlePlaybackRateChange = useCallback((rate: number) => {
    console.log('[VideoEditingInterface] 播放速度变更', {
      taskId,
      previousRate: playbackRate,
      newRate: rate,
      timestamp: new Date().toISOString()
    });
    setPlaybackRate(rate);
  }, [taskId, playbackRate]);

  const handleQualityChange = useCallback((quality: 'low' | 'medium' | 'high' | 'original') => {
    console.log('[VideoEditingInterface] 预览质量变更', {
      taskId,
      previousQuality: previewQuality,
      newQuality: quality,
      timestamp: new Date().toISOString()
    });
    setPreviewQuality(quality);
  }, [taskId, previewQuality]);

  const handleFullscreenToggle = useCallback(() => {
    console.log('[VideoEditingInterface] 全屏模式切换', {
      taskId,
      previousState: isFullscreen ? 'fullscreen' : 'normal',
      newState: !isFullscreen ? 'fullscreen' : 'normal',
      timestamp: new Date().toISOString()
    });
    setIsFullscreen(!isFullscreen);
  }, [taskId, isFullscreen]);

  // 格式化时间显示
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // 模拟视频播放时间更新
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    if (isPlaying) {
      console.log('[VideoEditingInterface] 开始视频播放模拟', {
        taskId,
        startTime: currentTime,
        playbackRate,
        timestamp: new Date().toISOString()
      });
      
      intervalId = setInterval(() => {
        setCurrentTime(prevTime => {
          const newTime = prevTime + playbackRate;
          if (newTime >= mockVideoPreview.duration) {
            console.log('[VideoEditingInterface] 视频播放结束', {
              taskId,
              finalTime: mockVideoPreview.duration,
              timestamp: new Date().toISOString()
            });
            setIsPlaying(false);
            return mockVideoPreview.duration;
          }
          return newTime;
        });
      }, 1000);
    } else {
      console.log('[VideoEditingInterface] 视频播放暂停', {
        taskId,
        pausedAt: currentTime,
        timestamp: new Date().toISOString()
      });
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isPlaying, playbackRate, taskId, mockVideoPreview.duration]);

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // 只在视频播放面板获得焦点时响应快捷键
      const target = event.target as HTMLElement;
      if (target.closest('.video-editing-composition-panel')) {
        switch (event.code) {
          case 'Space':
            event.preventDefault();
            handlePlayPause();
            console.log('[VideoEditingInterface] 键盘快捷键 - 空格键播放/暂停', {
              taskId,
              action: isPlaying ? 'pause' : 'play',
              timestamp: new Date().toISOString()
            });
            break;
          case 'ArrowLeft':
            event.preventDefault();
            handleTimeSeek(Math.max(0, currentTime - 10));
            console.log('[VideoEditingInterface] 键盘快捷键 - 左箭头后退10秒', {
              taskId,
              previousTime: currentTime,
              newTime: Math.max(0, currentTime - 10),
              timestamp: new Date().toISOString()
            });
            break;
          case 'ArrowRight':
            event.preventDefault();
            handleTimeSeek(Math.min(mockVideoPreview.duration, currentTime + 10));
            console.log('[VideoEditingInterface] 键盘快捷键 - 右箭头前进10秒', {
              taskId,
              previousTime: currentTime,
              newTime: Math.min(mockVideoPreview.duration, currentTime + 10),
              timestamp: new Date().toISOString()
            });
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [taskId, isPlaying, currentTime, handlePlayPause, handleTimeSeek, mockVideoPreview.duration]);

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

  // 素材管理事件处理函数
  
  // 处理素材类型筛选
  const handleMaterialTypeFilter = useCallback((type: MaterialType | 'all') => {
    console.log('[VideoEditingInterface] 素材类型筛选', {
      taskId,
      previousType: selectedMaterialType,
      newType: type,
      timestamp: new Date().toISOString()
    });
    
    setSelectedMaterialType(type);
    
    // 清除当前选中的素材（因为筛选后可能不可见）
    setSelectedMaterials(new Set());
  }, [taskId, selectedMaterialType]);

  // 处理素材选择/取消选择
  const handleMaterialSelect = useCallback((materialId: string, isSelected: boolean) => {
    console.log('[VideoEditingInterface] 素材选择变更', {
      taskId,
      materialId,
      isSelected,
      previousSelectionCount: selectedMaterials.size,
      timestamp: new Date().toISOString()
    });

    const newSelection = new Set(selectedMaterials);
    if (isSelected) {
      newSelection.add(materialId);
    } else {
      newSelection.delete(materialId);
    }
    
    setSelectedMaterials(newSelection);
    
    console.log('[VideoEditingInterface] 素材选择状态更新', {
      taskId,
      newSelectionCount: newSelection.size,
      selectedIds: Array.from(newSelection),
      timestamp: new Date().toISOString()
    });
  }, [taskId, selectedMaterials]);

  // 处理全选/取消全选
  const handleSelectAll = useCallback(() => {
    const filteredMaterials = selectedMaterialType === 'all' 
      ? materials 
      : materials.filter((material: MaterialItem) => material.type === selectedMaterialType);
    
    const isAllSelected = filteredMaterials.every(material => selectedMaterials.has(material.id));
    
    console.log('[VideoEditingInterface] 全选操作', {
      taskId,
      isAllSelected,
      filteredCount: filteredMaterials.length,
      previousSelectionCount: selectedMaterials.size,
      timestamp: new Date().toISOString()
    });

    if (isAllSelected) {
      // 取消选择当前筛选的所有素材
      const newSelection = new Set(selectedMaterials);
      filteredMaterials.forEach(material => newSelection.delete(material.id));
      setSelectedMaterials(newSelection);
    } else {
      // 选择当前筛选的所有素材
      const newSelection = new Set(selectedMaterials);
      filteredMaterials.forEach(material => newSelection.add(material.id));
      setSelectedMaterials(newSelection);
    }
  }, [taskId, selectedMaterialType, selectedMaterials, materials]);

  // 处理视频搜索
  const handleVideoSearch = useCallback(() => {
    console.log('[VideoEditingInterface] 打开视频搜索模态框', {
      taskId,
      timestamp: new Date().toISOString()
    });
    setIsVideoSearchModalOpen(true);
  }, [taskId]);

  // 处理视频搜索提交
  const handleVideoSearchSubmit = useCallback(async () => {
    if (!searchQuery.trim()) {
      alert('请输入搜索关键词');
      return;
    }

    console.log('[VideoEditingInterface] 开始视频搜索', {
      taskId,
      query: searchQuery,
      orientation: searchOrientation,
      timestamp: new Date().toISOString()
    });

    setIsSearching(true);
    setSearchResults([]);

    try {
      const response = await fetch('/api/video-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: searchQuery,
          max_videos: 20,
          orientation: searchOrientation,
        }),
      });

      const data = await response.json();

      console.log('[VideoEditingInterface] 视频搜索结果', {
        taskId,
        success: data.success,
        totalFound: data.total_found,
        videosCount: data.videos?.length || 0,
        timestamp: new Date().toISOString()
      });

      if (data.success && data.videos) {
        setSearchResults(data.videos);
      } else {
        alert(data.message || '搜索失败，请稍后重试');
      }
    } catch (error) {
      console.error('[VideoEditingInterface] 视频搜索错误', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      alert('搜索失败，请检查网络连接');
    } finally {
      setIsSearching(false);
    }
  }, [taskId, searchQuery, searchOrientation]);

  // 处理搜索结果选择
  const handleSearchResultSelect = useCallback((videoId: number, isSelected: boolean) => {
    const newSelection = new Set(selectedSearchResults);
    if (isSelected) {
      newSelection.add(videoId);
    } else {
      newSelection.delete(videoId);
    }
    setSelectedSearchResults(newSelection);

    console.log('[VideoEditingInterface] 搜索结果选择', {
      taskId,
      videoId,
      isSelected,
      totalSelected: newSelection.size,
      timestamp: new Date().toISOString()
    });
  }, [taskId, selectedSearchResults]);

  // 处理添加选中的搜索结果到素材库
  const handleAddSelectedVideos = useCallback(() => {
    const selectedVideos = searchResults.filter(video => selectedSearchResults.has(video.id));
    
    console.log('[VideoEditingInterface] 添加选中视频到素材库', {
      taskId,
      selectedCount: selectedVideos.length,
      videoIds: selectedVideos.map(v => v.id),
      timestamp: new Date().toISOString()
    });

    if (selectedVideos.length === 0) {
      alert('请先选择要添加的视频');
      return;
    }

    // 将搜索结果转换为MaterialItem格式
    const newMaterials: MaterialItem[] = selectedVideos.map(video => ({
      id: `pexels-${video.id}`,
      name: video.title,
      type: 'video' as MaterialType,
      format: 'mp4',
      size: 0, // PEXELS API不提供文件大小信息
      duration: video.duration || 0,
      width: video.width,
      height: video.height,
      thumbnailUrl: video.thumbnail,
      url: video.video_url,
      createdAt: new Date(),
      tags: ['PEXELS', '在线素材', video.author],
      description: `来自PEXELS的视频素材，作者：${video.author}`
    }));

    // 检查是否有重复的素材
    const existingIds = new Set(materials.map(m => m.id));
    const uniqueNewMaterials = newMaterials.filter(material => !existingIds.has(material.id));

    if (uniqueNewMaterials.length === 0) {
      alert('选中的视频已经存在于素材库中');
      return;
    }

    // 添加新素材到材料库
    setMaterials(prevMaterials => [...prevMaterials, ...uniqueNewMaterials]);

    console.log('[VideoEditingInterface] 视频素材添加完成', {
      taskId,
      addedCount: uniqueNewMaterials.length,
      skippedCount: selectedVideos.length - uniqueNewMaterials.length,
      newMaterialIds: uniqueNewMaterials.map(m => m.id),
      timestamp: new Date().toISOString()
    });

    // 显示成功消息
    const message = uniqueNewMaterials.length === selectedVideos.length 
      ? `成功添加 ${uniqueNewMaterials.length} 个视频到素材库`
      : `成功添加 ${uniqueNewMaterials.length} 个视频到素材库，${selectedVideos.length - uniqueNewMaterials.length} 个视频已存在`;
    
    alert(message);
    
    // 重置状态
    setSelectedSearchResults(new Set());
    setIsVideoSearchModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [taskId, searchResults, selectedSearchResults, materials]);

  // 关闭视频搜索模态框
  const handleCloseVideoSearchModal = useCallback(() => {
    setIsVideoSearchModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedSearchResults(new Set());
    
    console.log('[VideoEditingInterface] 关闭视频搜索模态框', {
      taskId,
      timestamp: new Date().toISOString()
    });
  }, [taskId]);

  // 处理素材播放/预览
  const handleMaterialPlay = useCallback((material: MaterialItem) => {
    console.log('[VideoEditingInterface] 素材播放/预览', {
      taskId,
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      materialFormat: material.format,
      materialSize: material.size,
      timestamp: new Date().toISOString()
    });

    // Mock播放功能 - 显示提示
    const actionText = material.type === 'image' ? '预览' : '播放';
    alert(`${actionText}素材: ${material.name}\n类型: ${material.type}\n格式: ${material.format}\n大小: ${(material.size / 1024 / 1024).toFixed(2)}MB`);
  }, [taskId]);

  // 处理素材下载
  const handleMaterialDownload = useCallback((material: MaterialItem) => {
    console.log('[VideoEditingInterface] 素材下载', {
      taskId,
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      materialUrl: material.url,
      timestamp: new Date().toISOString()
    });

    // Mock下载功能 - 显示提示
    alert(`下载素材: ${material.name}\nURL: ${material.url}\n大小: ${(material.size / 1024 / 1024).toFixed(2)}MB`);
  }, [taskId]);

  // 处理素材删除
  const handleMaterialDelete = useCallback((materialIds: string[]) => {
    console.log('[VideoEditingInterface] 素材删除', {
      taskId,
      materialIds,
      deleteCount: materialIds.length,
      timestamp: new Date().toISOString()
    });

    const materialNames = materialIds.map(id => {
      const material = materials.find((m: MaterialItem) => m.id === id);
      return material ? material.name : id;
    });

    const confirmDelete = confirm(`确认删除以下素材吗？\n${materialNames.join('\n')}`);
    
    if (confirmDelete) {
      // Mock删除功能 - 清除选中状态
      const newSelection = new Set(selectedMaterials);
      materialIds.forEach(id => newSelection.delete(id));
      setSelectedMaterials(newSelection);
      
      console.log('[VideoEditingInterface] 素材删除确认', {
        taskId,
        deletedIds: materialIds,
        remainingSelectionCount: newSelection.size,
        timestamp: new Date().toISOString()
      });
      
      alert(`已删除 ${materialIds.length} 个素材`);
    } else {
      console.log('[VideoEditingInterface] 素材删除取消', {
        taskId,
        timestamp: new Date().toISOString()
      });
    }
  }, [taskId, selectedMaterials, materials]);

  // 处理素材上传
  const handleMaterialUpload = useCallback(() => {
    console.log('[VideoEditingInterface] 素材上传触发', {
      taskId,
      timestamp: new Date().toISOString()
    });

    if (isUploading) {
      console.log('[VideoEditingInterface] 上传正在进行中，忽略新的上传请求', {
        taskId,
        currentProgress: uploadProgress,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Mock上传功能 - 模拟文件选择和上传过程
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/*,audio/*,image/*';
    
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement)?.files;
      if (!files || files.length === 0) return;

      console.log('[VideoEditingInterface] 开始模拟上传', {
        taskId,
        fileCount: files.length,
        fileNames: Array.from(files).map(f => f.name),
        timestamp: new Date().toISOString()
      });

      setIsUploading(true);
      setUploadProgress(0);

      // 模拟上传进度
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          const newProgress = prev + Math.random() * 20;
          if (newProgress >= 100) {
            clearInterval(progressInterval);
            setIsUploading(false);
            setUploadProgress(0);
            
            console.log('[VideoEditingInterface] 模拟上传完成', {
              taskId,
              fileCount: files.length,
              timestamp: new Date().toISOString()
            });
            
            alert(`成功上传 ${files.length} 个文件`);
            return 100;
          }
          return newProgress;
        });
      }, 200);
    };

    input.click();
  }, [taskId, isUploading, uploadProgress]);

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
        rightPanel: '视频合成播放 - 50%宽度',
        videoPlayer: {
          isPlaying,
          currentTime,
          duration: mockVideoPreview.duration,
          volume,
          playbackRate,
          previewQuality
        }
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900">素材管理</h3>
                    </div>
                    <button
                      onClick={handleMaterialUpload}
                      disabled={isUploading}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="上传素材"
                    >
                      {isUploading ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>{uploadProgress.toFixed(0)}%</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <span>上传</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="materials-panel-content">
                  {/* 素材类型筛选标签 */}
                  <div className="flex space-x-1 mb-4 p-1 bg-gray-100 rounded-lg">
                    {(['all', 'video', 'audio', 'image'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleMaterialTypeFilter(type)}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          selectedMaterialType === type
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {type === 'all' ? '全部' : 
                         type === 'video' ? '视频' :
                         type === 'audio' ? '音频' : '图片'}
                      </button>
                    ))}
                  </div>

                  {/* 素材网格 */}
                  <div className="mb-4">
                    {(() => {
                      const filteredMaterials = materials.filter((material: MaterialItem) => selectedMaterialType === 'all' || material.type === selectedMaterialType);
                      
                      if (filteredMaterials.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-12 px-4">
                            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无素材</h3>
                                                         <p className="text-sm text-gray-500 text-center mb-6 max-w-sm">
                               {materials.length === 0 
                                 ? "素材库为空，点击下方「搜索视频」按钮来添加高质量的视频素材"
                                 : `当前没有${selectedMaterialType === 'video' ? '视频' : selectedMaterialType === 'audio' ? '音频' : selectedMaterialType === 'image' ? '图片' : ''}素材`
                               }
                             </p>
                            {materials.length === 0 && (
                              <button
                                onClick={handleVideoSearch}
                                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                <span>搜索视频</span>
                              </button>
                            )}
                          </div>
                        );
                      }
                      
                      return (
                        <div className="grid grid-cols-2 gap-3">
                          {filteredMaterials.map((material) => {
                        const isSelected = selectedMaterials.has(material.id);
                        const formatSize = (bytes: number) => {
                          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
                          return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
                        };
                        
                        const getTypeIcon = (type: MaterialType) => {
                          switch (type) {
                            case 'video':
                              return (
                                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              );
                            case 'audio':
                              return (
                                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M9 12h1m4 0h1m-6 4h1m4 0h1m6-1a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              );
                            case 'image':
                              return (
                                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              );
                          }
                        };

                        return (
                          <div
                            key={material.id}
                            className={`relative bg-white border rounded-lg p-3 hover:shadow-md transition-all cursor-pointer ${
                              isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                            }`}
                            onClick={() => handleMaterialSelect(material.id, !isSelected)}
                          >
                            {/* 选择指示器 */}
                            <div className="absolute top-2 left-2">
                              <div className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center ${
                                isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                              }`}>
                                {isSelected && (
                                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                            </div>

                            {/* 缩略图 */}
                            <div className="w-full h-16 bg-gray-100 rounded mb-2 flex items-center justify-center overflow-hidden">
                              {material.thumbnailUrl ? (
                                <img 
                                  src={material.thumbnailUrl} 
                                  alt={material.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                getTypeIcon(material.type)
                              )}
                            </div>

                            {/* 素材信息 */}
                            <div className="space-y-1">
                              <div className="flex items-center space-x-1">
                                {getTypeIcon(material.type)}
                                <h4 className="text-xs font-medium text-gray-900 truncate">{material.name}</h4>
                              </div>
                              <p className="text-xs text-gray-500">{formatSize(material.size)}</p>
                              {material.duration && (
                                <p className="text-xs text-gray-500">{material.duration}s</p>
                              )}
                            </div>

                            {/* 操作按钮 */}
                            <div className="flex space-x-1 mt-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMaterialPlay(material);
                                }}
                                className="flex-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded transition-colors"
                                title={material.type === 'image' ? '预览' : '播放'}
                              >
                                {material.type === 'image' ? (
                                  <svg className="w-3 h-3 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                ) : (
                                  <svg className="w-3 h-3 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-1a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                )}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMaterialDownload(material);
                                }}
                                className="flex-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded transition-colors"
                                title="下载"
                              >
                                <svg className="w-3 h-3 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 底部操作栏 */}
                  <div className="border-t pt-3 mt-auto">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={handleVideoSearch}
                          className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                          title="搜索在线视频"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>搜索视频</span>
                        </button>
                        <button
                          onClick={handleSelectAll}
                          className="flex items-center space-x-1 text-gray-600 hover:text-gray-900"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>全选</span>
                        </button>
                        {selectedMaterials.size > 0 && (
                          <button
                            onClick={() => handleMaterialDelete(Array.from(selectedMaterials))}
                            className="flex items-center space-x-1 text-red-600 hover:text-red-700"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>删除选中</span>
                          </button>
                        )}
                      </div>
                      <div className="text-gray-500">
                        {materials.filter((m: MaterialItem) => selectedMaterialType === 'all' || m.type === selectedMaterialType).length}个素材 
                        ({(materials
                          .filter((m: MaterialItem) => selectedMaterialType === 'all' || m.type === selectedMaterialType)
                          .reduce((sum: number, m: MaterialItem) => sum + m.size, 0) / 1024 / 1024).toFixed(1)}MB)
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 视频合成播放面板 - 右侧50% */}
              <div 
                className="video-editing-composition-panel"
                tabIndex={0}
                aria-label="视频合成播放面板"
              >
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
                  {/* 视频播放器容器 */}
                  <div className="video-player-container">
                    {/* 视频预览窗口 - 16:9比例 */}
                    <div className="video-preview-window">
                      <img 
                        src={mockVideoPreview.thumbnailUrl}
                        alt="视频预览帧"
                        className="w-full h-full object-cover rounded-lg"
                      />
                      {/* 播放状态覆盖层 */}
                      <div className="video-overlay">
                        <button
                          onClick={handlePlayPause}
                          className="play-pause-btn"
                          title={isPlaying ? '暂停' : '播放'}
                        >
                          {isPlaying ? (
                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                            </svg>
                          ) : (
                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          )}
                        </button>
                        {/* 加载指示器 */}
                        {isPlaying && (
                          <div className="loading-indicator">
                            <div className="loading-spinner"></div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 播放控制栏 */}
                    <div className="video-controls">
                      {/* 进度条 */}
                      <div className="progress-container">
                        <div className="progress-bar">
                          <div 
                            className="progress-filled"
                            style={{ width: `${(currentTime / mockVideoPreview.duration) * 100}%` }}
                          ></div>
                          <input
                            type="range"
                            min="0"
                            max={mockVideoPreview.duration}
                            value={currentTime}
                            onChange={(e) => handleTimeSeek(Number(e.target.value))}
                            className="progress-slider"
                          />
                        </div>
                      </div>

                      {/* 控制按钮组 */}
                      <div className="controls-row">
                        {/* 左侧：播放按钮和时间 */}
                        <div className="controls-left">
                          <button
                            onClick={handlePlayPause}
                            className="control-btn play-btn"
                            title={isPlaying ? '暂停' : '播放'}
                          >
                            {isPlaying ? (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            )}
                          </button>
                          <span className="time-display">
                            {formatTime(currentTime)} / {formatTime(mockVideoPreview.duration)}
                          </span>
                        </div>

                        {/* 右侧：音量、速度、全屏 */}
                        <div className="controls-right">
                          {/* 播放速度 */}
                          <div className="speed-control">
                            <select
                              value={playbackRate}
                              onChange={(e) => handlePlaybackRateChange(Number(e.target.value))}
                              className="speed-select"
                            >
                              <option value={0.5}>0.5x</option>
                              <option value={1.0}>1.0x</option>
                              <option value={1.25}>1.25x</option>
                              <option value={1.5}>1.5x</option>
                              <option value={2.0}>2.0x</option>
                            </select>
                          </div>

                          {/* 音量控制 */}
                          <div 
                            className="volume-control"
                            onMouseEnter={() => setShowVolumeSlider(true)}
                            onMouseLeave={() => setShowVolumeSlider(false)}
                          >
                            <button className="control-btn volume-btn" title="音量">
                              {volume === 0 ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                </svg>
                              ) : volume < 0.5 ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                </svg>
                              )}
                            </button>
                            {showVolumeSlider && (
                              <div className="volume-slider-container">
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.1"
                                  value={volume}
                                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                                  className="volume-slider"
                                />
                              </div>
                            )}
                          </div>

                          {/* 全屏按钮 */}
                          <button
                            onClick={handleFullscreenToggle}
                            className="control-btn fullscreen-btn"
                            title="全屏"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 视频信息面板 */}
                    <div className="video-info-panel">
                      <div className="info-row">
                        <div className="info-item">
                          <span className="info-label">分辨率:</span>
                          <span className="info-value">{mockVideoPreview.resolution.width}×{mockVideoPreview.resolution.height}</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">帧率:</span>
                          <span className="info-value">{mockVideoPreview.frameRate}fps</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">格式:</span>
                          <span className="info-value">{mockVideoPreview.format}</span>
                        </div>
                      </div>
                      <div className="info-row">
                        <div className="info-item">
                          <span className="info-label">编码:</span>
                          <span className="info-value">{mockVideoPreview.codec}</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">码率:</span>
                          <span className="info-value">{mockVideoPreview.bitrate}</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">大小:</span>
                          <span className="info-value">{mockVideoPreview.fileSize}MB</span>
                        </div>
                      </div>
                      <div className="quality-control">
                        <span className="info-label">预览质量:</span>
                        <select
                          value={previewQuality}
                          onChange={(e) => handleQualityChange(e.target.value as any)}
                          className="quality-select"
                        >
                          <option value="low">低画质 (360p)</option>
                          <option value="medium">标清 (720p)</option>
                          <option value="high">高清 (1080p)</option>
                          <option value="original">原画质</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 下方容器 - 30%高度 */}
            <div className="video-editing-preview-lower border-t border-gray-200">
              <TimelinePanel className="h-full" />
            </div>
          </div>
        </div>
      </div>

      {/* 视频搜索模态框 */}
    {isVideoSearchModalOpen && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-5/6 flex flex-col">
          {/* 模态框头部 */}
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">搜索在线视频</h2>
            </div>
            <button
              onClick={handleCloseVideoSearchModal}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 搜索控制区 */}
          <div className="p-6 border-b bg-gray-50">
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="输入搜索关键词，如：自然风景、商务办公、人物肖像..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVideoSearchSubmit()}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  disabled={isSearching}
                />
              </div>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700">方向:</label>
                <select
                  value={searchOrientation}
                  onChange={(e) => setSearchOrientation(e.target.value as 'landscape' | 'portrait' | 'mixed')}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  disabled={isSearching}
                >
                  <option value="mixed">混合</option>
                  <option value="landscape">横屏</option>
                  <option value="portrait">竖屏</option>
                </select>
              </div>
              <button
                onClick={handleVideoSearchSubmit}
                disabled={isSearching || !searchQuery.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
              >
                {isSearching ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>搜索中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span>搜索</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 搜索结果区域 */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {searchResults.length > 0 && (
              <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  找到 {searchResults.length} 个视频，已选择 {selectedSearchResults.size} 个
                </div>
                <button
                  onClick={handleAddSelectedVideos}
                  disabled={selectedSearchResults.size === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>添加选中视频 ({selectedSearchResults.size})</span>
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
              {isSearching ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <svg className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-gray-600">正在搜索视频...</p>
                  </div>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {searchResults.map((video) => {
                    const isSelected = selectedSearchResults.has(video.id);
                    return (
                      <div
                        key={video.id}
                        className={`relative bg-white border rounded-lg overflow-hidden hover:shadow-lg transition-all cursor-pointer ${
                          isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}
                        onClick={() => handleSearchResultSelect(video.id, !isSelected)}
                      >
                        {/* 选择指示器 */}
                        <div className="absolute top-2 left-2 z-10">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'
                          }`}>
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </div>

                        {/* 视频缩略图 */}
                        <div className="aspect-video bg-gray-100 relative overflow-hidden">
                          {video.thumbnail ? (
                            <img 
                              src={video.thumbnail} 
                              alt={video.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                          
                          {/* 播放按钮覆盖层 */}
                          <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 flex items-center justify-center transition-all">
                            <svg className="w-12 h-12 text-white opacity-0 hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                            </svg>
                          </div>
                        </div>

                        {/* 视频信息 */}
                        <div className="p-3">
                          <h4 className="text-sm font-medium text-gray-900 truncate mb-1">{video.title}</h4>
                          <p className="text-xs text-gray-500 mb-2">作者: {video.author}</p>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{video.width} × {video.height}</span>
                            {video.duration && (
                              <span>{Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, '0')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="text-gray-500 text-lg mb-2">输入关键词开始搜索</p>
                    <p className="text-gray-400 text-sm">搜索高质量的免费视频素材</p>
                  </div>
                </div>
              )}
            </div>
                     </div>
         </div>
       </div>
     )}
    </div>
  );
};

export default VideoEditingInterface; 