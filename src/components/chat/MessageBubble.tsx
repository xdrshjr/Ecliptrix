'use client';

import React, { useState } from 'react';
import { ChatMessage } from '@/types';
import MarkdownRenderer from './MarkdownRenderer';
import WorkflowExecutionMessage from './WorkflowExecutionMessage';
import { copyToClipboard, showCopyFeedback } from '@/lib/clipboard';

interface MessageBubbleProps {
  message: ChatMessage;
  onNavigateToVideoEditing?: (materials: any[]) => void;
  onConvertToScript?: (content: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onNavigateToVideoEditing, onConvertToScript }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const isUser = message.role === 'user';
  const isWorkflowExecution = !!message.workflowExecution;
  const isIntentDetection = message.metadata?.type === 'intent_detection';
  const isIntentResult = message.metadata?.type === 'intent_result';
  
  // 只在流式传输时记录日志
  if (message.isStreaming) {
    console.log('[MessageBubble] 流式消息更新', { 
      messageId: message.id, 
      contentLength: message.content.length,
      isIntentDetection,
      isIntentResult
    });
  }

  const handleCopyMessage = async () => {
    setIsCopying(true);
    
    try {
      const result = await copyToClipboard(message.content);
      showCopyFeedback(result.success, result.error);
      
      if (result.success) {
        setShowCopySuccess(true);
        setTimeout(() => setShowCopySuccess(false), 2000);
      } else {
        console.error('[MessageBubble] 复制失败:', result.error);
      }
    } catch (error) {
      console.error('[MessageBubble] 复制错误:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCopying(false);
    }
  };

  const handleConvertToScript = () => {
    console.log('[MessageBubble] 用户点击转换视频脚本按钮', {
      messageId: message.id,
      contentLength: message.content.length,
      timestamp: new Date().toISOString()
    });
    
    if (onConvertToScript) {
      onConvertToScript(message.content);
    }
  };
  
  // 意图检测状态消息 - 显示正在分析
  if (isIntentDetection) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[95%] animate-fadeIn">
          <div className="bg-primary/10 rounded-md px-5 py-4 border border-primary/30">
            <div className="flex items-center space-x-2.5 mb-2">
              <div className="flex space-x-1.5">
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
              </div>
              <span className="text-sm font-semibold text-foreground">正在分析意图</span>
            </div>
            <p className="text-xs text-primary leading-relaxed">检测您的问题是否需要调用工作流...</p>
          </div>
        </div>
      </div>
    );
  }
  
  // 意图检测结果消息 - 显示是否需要调用工作流
  if (isIntentResult && message.metadata?.intention) {
    const intention = message.metadata.intention;
    const shouldCallWorkflow = intention.should_call_workflow;
    
    if (shouldCallWorkflow) {
      return (
        <div className="flex justify-start">
          <div className="max-w-[95%] animate-fadeIn">
            <div className="bg-green-500/10 rounded-md px-5 py-4 border border-green-500/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-sm font-semibold text-foreground">
                    将调用工作流: {intention.workflow_name}
                  </span>
                </div>
                <span className="text-xs text-green-500 bg-green-500/20 px-2.5 py-1 rounded-full font-medium">
                  {Math.round((intention.confidence || 0) * 100)}%
                </span>
              </div>
              <p className="text-xs text-green-500 leading-relaxed">{intention.reasoning}</p>
            </div>
          </div>
        </div>
      );
    } else {
      // 不需要调用工作流 - 使用更低调的样式
      return (
        <div className="flex justify-start">
          <div className="max-w-[95%] animate-fadeIn opacity-75">
            <div className="bg-muted rounded-md px-5 py-3 border border-border">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium">普通对话</span> · {intention.reasoning}
              </p>
            </div>
          </div>
        </div>
      );
    }
  }
  
  // If this is a workflow execution message, use the special component
  if (isWorkflowExecution && message.workflowExecution) {
    return (
      <WorkflowExecutionMessage
        workflowName={message.workflowExecution.workflowName}
        executionState={message.workflowExecution.executionState}
        finalResult={message.content}
        isComplete={!message.isStreaming}
        onNavigateToVideoEditing={onNavigateToVideoEditing}
        onConvertToScript={onConvertToScript}
      />
    );
  }
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start`}>
        {/* Message Content */}
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div 
            className={`relative px-5 py-3 rounded-md max-w-full group transition-colors ${
              isUser
                ? 'bg-primary text-primary-foreground rounded-br-sm'
                : 'bg-card border border-border text-foreground rounded-bl-sm'
            }`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* 按钮组 - 小标签样式，一直显示在右上角 */}
            <div className="absolute -top-2 -right-2 flex items-center space-x-1">
              {/* 复制按钮 */}
              <button
                onClick={handleCopyMessage}
                disabled={isCopying || message.isStreaming}
                className={`w-7 h-7 rounded-full transition-colors duration-200 flex items-center justify-center ${
                  isUser
                    ? 'bg-primary text-primary-foreground border-2 border-card'
                    : 'bg-card hover:bg-accent text-muted-foreground hover:text-foreground border-2 border-border'
                } ${isCopying ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                title={showCopySuccess ? '已复制!' : '复制消息'}
                aria-label="复制消息内容"
              >
                {showCopySuccess ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : isCopying ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>

              {/* 转换视频脚本按钮 - 仅在非用户消息且有回调时显示 */}
              {!isUser && onConvertToScript && (
                <button
                  onClick={handleConvertToScript}
                  disabled={message.isStreaming}
                  className="w-7 h-7 rounded-full transition-colors duration-200 flex items-center justify-center bg-primary hover:bg-[var(--primary-hover)] text-primary-foreground border-2 border-card cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="转换视频脚本"
                  aria-label="将此消息内容转换为视频脚本"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              )}
            </div>

            {/* 消息内容 - 使用Markdown渲染 */}
            <div className="text-sm leading-relaxed">
              <MarkdownRenderer 
                content={message.content} 
                isUser={isUser}
              />
              {message.isStreaming && (
                <span className="inline-block w-2 h-4 bg-current opacity-75 animate-pulse ml-1" />
              )}
            </div>
          </div>
          
          {/* Timestamp */}
          <div className={`mt-1.5 text-xs text-muted-foreground flex items-center space-x-2 ${isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`}>
            <span>
              {message.timestamp.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </span>
            {message.isStreaming && (
              <div className="flex items-center space-x-1 text-primary">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-xs font-medium">生成中</span>
              </div>
            )}
            {showCopySuccess && (
              <span className="text-green-500 text-xs font-medium">✓ 已复制</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble; 