'use client';

import React from 'react';
import { Task, ChatTaskContent, VideoTaskContent } from '@/types';
import ChatInterface from './chat/ChatInterface';
import VideoEditingInterface from './video/VideoEditingInterface';

interface ContainerProps {
  activeTask: Task | null;
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => void;
}

const Container: React.FC<ContainerProps> = ({ activeTask, onUpdateTask }) => {
  const handleUpdateChatContent = (content: ChatTaskContent) => {
    if (activeTask && onUpdateTask) {
      onUpdateTask(activeTask.id, { 
        content,
        updatedAt: new Date(),
        status: 'active' as const,
      });
      console.log(`Updated chat content for task: ${activeTask.id}`);
    }
  };

  const handleUpdateVideoContent = (content: VideoTaskContent) => {
    if (activeTask && onUpdateTask) {
      onUpdateTask(activeTask.id, {
        content,
        updatedAt: new Date(),
        status: 'active' as const,
      });
      console.log(`Updated video editing content for task: ${activeTask.id} - markdown length: ${content.markdownContent.length}`);
    }
  };

  if (!activeTask) {
    return (
      <div className="flex-1 bg-white flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl mx-auto mb-6 flex items-center justify-center">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-3">
            Welcome to Ecliptrix
          </h2>
          <p className="text-gray-600 mb-6">
            Where light and shadow collide to create extraordinary content. 
            Start by creating a new task to begin your creative journey.
          </p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 mb-1">Content Creation</h3>
              <p className="text-gray-600">Generate engaging social media content</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 mb-1">Video Editing</h3>
              <p className="text-gray-600">Automatic video mixing and editing</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 mb-1">Voice Synthesis</h3>
              <p className="text-gray-600">AI-powered speech generation</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 mb-1">Brainstorming</h3>
              <p className="text-gray-600">Creative ideation and inspiration</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 mb-1">AI Chat</h3>
              <p className="text-gray-600">Intelligent conversation and assistance</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Handle chat task type
  if (activeTask.type === 'chat') {
    // 聊天任务界面渲染
    
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <ChatInterface
          taskId={activeTask.id}
          content={activeTask.content as ChatTaskContent | null}
          onUpdateContent={handleUpdateChatContent}
        />
      </div>
    );
  }

  // Handle video editing task type
  if (activeTask.type === 'video') {
    // 视频编辑任务界面渲染
    console.log(`Rendering video editing interface for task: ${activeTask.id}`);
    
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <VideoEditingInterface
          taskId={activeTask.id}
          content={activeTask.content as VideoTaskContent | null}
          onUpdateContent={handleUpdateVideoContent}
        />
      </div>
    );
  }

  // Handle other task types (existing functionality)
  return (
    <div className="flex-1 bg-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center space-x-3 mb-2">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">{activeTask.title}</h1>
            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
              {activeTask.status}
            </span>
          </div>
          <p className="text-gray-600">
            Created {activeTask.createdAt.toLocaleDateString()} • Last updated {activeTask.updatedAt.toLocaleDateString()}
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-8 text-center">
          <div className="w-16 h-16 bg-gray-200 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Task content will be implemented here
          </h3>
          <p className="text-gray-600 max-w-md mx-auto">
            This is where the {activeTask.type} workspace will be displayed. 
            The specific functionality for each task type will be implemented in future iterations.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Container;