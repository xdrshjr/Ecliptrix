'use client';

import React from 'react';
import { Task, VideoEditingTaskContent, WorkflowTaskContent, ChatTaskContent } from '@/types';
import VideoEditingInterface from './video/VideoEditingInterface';
import WorkflowInterface from './workflow/WorkflowInterface';
import ChatInterface from './chat/ChatInterface';
import { useLocale } from '@/contexts/LocaleContext';

interface ContainerProps {
  activeTask: Task | null;
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => void;
  onChatModalStateChange?: (isOpen: boolean) => void;
  tasks?: Task[];
  tabs?: any[];
  onSelectTab?: (tabId: string) => void;
}

const Container: React.FC<ContainerProps> = ({ activeTask, onUpdateTask, onChatModalStateChange, tasks, tabs, onSelectTab }) => {
  const { t } = useLocale();

  const handleUpdateVideoEditingContent = (content: VideoEditingTaskContent) => {
    if (activeTask && onUpdateTask) {
      onUpdateTask(activeTask.id, { 
        content,
        updatedAt: new Date(),
        status: 'active' as const,
      });
    }
  };

  const handleUpdateWorkflowContent = (content: WorkflowTaskContent) => {
    if (activeTask && onUpdateTask) {
      onUpdateTask(activeTask.id, { 
        content,
        updatedAt: new Date(),
        status: 'active' as const,
      });
    }
  };

  const handleUpdateChatContent = (content: ChatTaskContent) => {
    if (activeTask && onUpdateTask) {
      onUpdateTask(activeTask.id, { 
        content,
        updatedAt: new Date(),
        status: 'active' as const,
      });
    }
  };

  // 处理从Workflow导航到Video Editing (timeline data)
  const handleNavigateToVideoEditing = (timelineData: any) => {
    console.log('[Container] Navigating to Video Editing with timeline data:', {
      hasTimelineData: !!timelineData,
      tracksCount: timelineData?.tracks?.length || 0,
      timestamp: new Date().toISOString()
    });

    if (!tasks || !tabs || !onSelectTab || !onUpdateTask) {
      console.warn('[Container] Missing required props for navigation:', {
        hasTasks: !!tasks,
        hasTabs: !!tabs,
        hasOnSelectTab: !!onSelectTab,
        hasOnUpdateTask: !!onUpdateTask
      });
      return;
    }

    // 1. 查找Video Editing任务
    const videoTask = tasks.find(t => t.type === 'video');
    
    if (!videoTask) {
      console.error('[Container] No Video Editing task found');
      return;
    }

    console.log('[Container] Found Video Editing task:', {
      taskId: videoTask.id,
      taskTitle: videoTask.title
    });

    // 2. 更新Video Editing任务的content，添加待导入的时间轴数据
    const currentContent = videoTask.content as VideoEditingTaskContent | null;
    const updatedContent: VideoEditingTaskContent = {
      markdownContent: currentContent?.markdownContent || '',
      lastModified: new Date(),
      scriptSegments: currentContent?.scriptSegments || [],
      materials: currentContent?.materials || [],
      pendingTimelineData: timelineData
    };

    onUpdateTask(videoTask.id, {
      content: updatedContent
    });

    console.log('[Container] Updated Video Editing task with pending timeline data');

    // 3. 切换到Video Editing标签页
    const videoTab = tabs.find(t => t.taskId === videoTask.id);
    if (videoTab) {
      onSelectTab(videoTab.id);
      console.log('[Container] Switched to Video Editing tab:', {
        tabId: videoTab.id,
        tabTitle: videoTab.title
      });
    } else {
      console.error('[Container] No tab found for Video Editing task');
    }
  };

  // 处理从Chat/Workflow导航到Video Editing (materials from Video Export node)
  const handleNavigateToVideoEditingWithMaterials = (materials: any[]) => {
    console.log('[Container] Navigating to Video Editing with materials from Video Export:', {
      materialsCount: materials.length,
      timestamp: new Date().toISOString()
    });

    if (!tasks || !tabs || !onSelectTab || !onUpdateTask) {
      console.warn('[Container] Missing required props for navigation:', {
        hasTasks: !!tasks,
        hasTabs: !!tabs,
        hasOnSelectTab: !!onSelectTab,
        hasOnUpdateTask: !!onUpdateTask
      });
      return;
    }

    // 1. 查找Video Editing任务
    const videoTask = tasks.find(t => t.type === 'video');
    
    if (!videoTask) {
      console.error('[Container] No Video Editing task found');
      return;
    }

    console.log('[Container] Found Video Editing task:', {
      taskId: videoTask.id,
      taskTitle: videoTask.title
    });

    // 2. 设置待导入的素材（不直接合并，等任务加载完成后再导入）
    const currentContent = videoTask.content as VideoEditingTaskContent | null;
    const updatedContent: VideoEditingTaskContent = {
      markdownContent: currentContent?.markdownContent || '',
      lastModified: new Date(),
      scriptSegments: currentContent?.scriptSegments || [],
      materials: currentContent?.materials || [],
      pendingTimelineData: currentContent?.pendingTimelineData,
      pendingMaterials: materials  // 设置待导入的素材
    };

    onUpdateTask(videoTask.id, {
      content: updatedContent
    });

    console.log('[Container] Set pending materials for Video Editing task:', {
      pendingMaterialsCount: materials.length
    });

    // 3. 切换到Video Editing标签页（任务加载完成后会自动导入素材）
    const videoTab = tabs.find(t => t.taskId === videoTask.id);
    if (videoTab) {
      onSelectTab(videoTab.id);
      console.log('[Container] Switched to Video Editing tab:', {
        tabId: videoTab.id,
        tabTitle: videoTab.title
      });
    } else {
      console.error('[Container] No tab found for Video Editing task');
    }
  };

  if (!activeTask) {    
    return (
      <div className="flex-1 bg-background flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-24 h-24 bg-primary rounded-md mx-auto mb-6 flex items-center justify-center">
            <svg className="w-12 h-12 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-3">
            {t.welcome.title}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t.welcome.description}
          </p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-muted rounded-md p-4">
              <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="font-medium text-foreground mb-1">{t.tasks.aiChat}</h3>
              <p className="text-muted-foreground">{t.welcome.aiChatDesc}</p>
            </div>
            <div className="bg-muted rounded-md p-4">
              <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 002 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-medium text-foreground mb-1">{t.tasks.videoEditing}</h3>
              <p className="text-muted-foreground">{t.welcome.videoEditingDesc}</p>
            </div>
            <div className="bg-muted rounded-md p-4">
              <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                </svg>
              </div>
              <h3 className="font-medium text-foreground mb-1">{t.tasks.workflow}</h3>
              <p className="text-muted-foreground">{t.welcome.workflowDesc}</p>
            </div>
            <div className="bg-muted rounded-md p-4">
              <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="font-medium text-foreground mb-1">{t.tasks.brainstorming}</h3>
              <p className="text-muted-foreground">{t.welcome.brainstormingDesc}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Handle video editing task type
  if (activeTask.type === 'video') {    
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <VideoEditingInterface
          taskId={activeTask.id}
          content={activeTask.content as VideoEditingTaskContent | null}
          onUpdateContent={handleUpdateVideoEditingContent}
        />
      </div>
    );
  }

  // Handle workflow task type
  if (activeTask.type === 'workflow') {    
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <WorkflowInterface
          taskId={activeTask.id}
          content={activeTask.content as WorkflowTaskContent | null}
          onUpdateContent={handleUpdateWorkflowContent}
          onNavigateToVideoEditing={handleNavigateToVideoEditing}
        />
      </div>
    );
  }

  // Handle chat task type
  if (activeTask.type === 'chat') {    
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <ChatInterface
          taskId={activeTask.id}
          content={activeTask.content as ChatTaskContent | null}
          onUpdateContent={handleUpdateChatContent}
          onModalStateChange={onChatModalStateChange}
          onNavigateToVideoEditing={handleNavigateToVideoEditingWithMaterials}
        />
      </div>
    );
  }

  // Handle other task types (existing functionality)
  return (
    <div className="flex-1 bg-background p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-foreground">{activeTask.title}</h1>
            <span className="px-2 py-1 bg-primary/10 text-primary text-xs font-medium rounded-md">
              {activeTask.status}
            </span>
          </div>
          <p className="text-muted-foreground">
            Created {activeTask.createdAt.toLocaleDateString()} • Last updated {activeTask.updatedAt.toLocaleDateString()}
          </p>
        </div>

        <div className="bg-muted rounded-md p-8 text-center">
          <div className="w-16 h-16 bg-accent rounded-md mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t.taskContent.willBeImplemented}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            {t.taskContent.workspaceDescription.replace('{type}', activeTask.type)}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Container;