'use client';

import React, { useState, useRef, useEffect } from 'react';
import { WorkflowExecutionState } from '@/types';
import ExecutionProcessPanel from './ExecutionProcessPanel';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';

export interface WorkflowChatMessage {
  id: string;
  type: 'user' | 'execution-process' | 'final-result';
  content: string;
  timestamp: Date;
  executionSessionId?: string; // 用于关联同一次执行的消息
  // 行动按钮（用于AI Video Generate等需要跳转的场景）
  actionButton?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'success' | 'info';
  };
  // AI Video Generate生成的时间轴数据
  timelineData?: any;
}

interface WorkflowChatInterfaceProps {
  executionState: WorkflowExecutionState;
  onRunWorkflow: (userInput?: string | null) => void;
  onAbortWorkflow: () => void;
  messages: WorkflowChatMessage[];
  onMessagesChange: (messages: WorkflowChatMessage[]) => void;
  onClearChatHistory: () => void;
  onClearContext: () => void;
  onNavigateToVideoEditing?: (timelineData: any) => void;
}

/**
 * Workflow Chat Interface Component (Optimized)
 * Provides a ChatGPT-like interface with node-by-node execution visualization
 * Features:
 * 1. Node execution cards showing status, timing, input/output
 * 2. Auto-collapse execution process after completion
 * 3. Expandable execution details
 * 4. Final result prominently displayed
 * Apple light theme: clean, elegant, minimalist design
 */
const WorkflowChatInterface: React.FC<WorkflowChatInterfaceProps> = ({
  executionState,
  onRunWorkflow,
  onAbortWorkflow,
  messages,
  onMessagesChange,
  onClearChatHistory,
  onClearContext,
  onNavigateToVideoEditing,
}) => {
  const { showConfirm } = useNotification();
  const { t, locale } = useLocale();
  const [inputValue, setInputValue] = useState('');
  const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  console.log('[WorkflowChatInterface] Rendering optimized chat interface:', {
    messagesCount: messages.length,
    isRunning: executionState.isRunning,
    currentExecutionId,
    timestamp: new Date().toISOString()
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Auto-resize textarea based on content and focus state
  useEffect(() => {
    if (inputRef.current) {
      if (isInputFocused) {
        // When focused, expand based on content
        inputRef.current.style.height = 'auto';
        const newHeight = Math.min(Math.max(inputRef.current.scrollHeight, 48), 200); // Min 48px, Max 200px
        inputRef.current.style.height = `${newHeight}px`;
        
        console.log('[WorkflowChatInterface] Textarea expanded (focused):', {
          scrollHeight: inputRef.current.scrollHeight,
          newHeight,
          contentLength: inputValue.length
        });
      } else {
        // When not focused, collapse to minimum height
        inputRef.current.style.height = '48px';
        
        console.log('[WorkflowChatInterface] Textarea collapsed (not focused)');
      }
    }
  }, [inputValue, isInputFocused]);

  // Handle execution state changes
  useEffect(() => {
    console.log('[WorkflowChatInterface] Execution state changed:', {
      isRunning: executionState.isRunning,
      logsCount: executionState.logs.length,
      currentExecutionId,
      hasStartTime: !!executionState.startTime,
      hasEndTime: !!executionState.endTime,
    });

    // 检测工作流开始
    if (executionState.isRunning && executionState.startTime && !currentExecutionId) {
      const newExecutionId = `exec-${executionState.startTime.getTime()}`;
      setCurrentExecutionId(newExecutionId);
      
      console.log('[WorkflowChatInterface] Workflow execution started:', {
        executionId: newExecutionId,
      });
    }

    // 检测工作流完成
    if (!executionState.isRunning && executionState.endTime && currentExecutionId) {
      console.log('[WorkflowChatInterface] Workflow execution completed:', {
        executionId: currentExecutionId,
        logs: executionState.logs.length,
      });

      // 查找最终结果
      const finalResultLog = executionState.logs.find(
        log => log.level === 'success' && log.message.includes('Workflow execution completed')
      );

      const finalOutput = finalResultLog?.details?.output;

      console.log('[WorkflowChatInterface] Final result found:', {
        hasFinalResultLog: !!finalResultLog,
        hasFinalOutput: !!finalOutput,
        outputType: typeof finalOutput,
      });

      // 添加最终结果消息
      if (finalOutput) {
        // 检查是否已经添加了这次执行的最终结果
        const existingFinalResult = messages.find(
          m => m.type === 'final-result' && m.executionSessionId === currentExecutionId
        );

        if (!existingFinalResult) {
          // 检查是否有AI Video Generate节点执行成功
          const aiVideoGenerateLog = executionState.logs.find(
            log => log.level === 'success' && log.message.includes('AI Video Generate completed successfully')
          );
          
          // 查找AI Video Generate节点的输出数据
          let timelineData: any = null;
          if (aiVideoGenerateLog && aiVideoGenerateLog.nodeId) {
            const nodeState = executionState.nodeStates[aiVideoGenerateLog.nodeId];
            if (nodeState?.output?.timelineData) {
              timelineData = nodeState.output.timelineData;
              console.log('[WorkflowChatInterface] AI Video Generate timeline data found:', {
                nodeId: aiVideoGenerateLog.nodeId,
                hasTimelineData: !!timelineData,
                tracksCount: timelineData?.tracks?.length || 0,
              });
            }
          }

          const finalResultMessage: WorkflowChatMessage = {
            id: `final-${currentExecutionId}`,
            type: 'final-result',
            content: formatOutput(finalOutput),
            timestamp: new Date(),
            executionSessionId: currentExecutionId,
            timelineData: timelineData,
            actionButton: timelineData && onNavigateToVideoEditing ? {
              label: t.workflowChat.goToVideoResult,
              variant: 'success' as const,
              onClick: () => {
                console.log('[WorkflowChatInterface] Navigating to Video Editing with timeline data');
                onNavigateToVideoEditing(timelineData);
              }
            } : undefined,
          };

          console.log('[WorkflowChatInterface] Adding final result message', {
            hasTimelineData: !!timelineData,
            hasActionButton: !!finalResultMessage.actionButton,
          });
          onMessagesChange([...messages, finalResultMessage]);
        } else {
          console.log('[WorkflowChatInterface] Final result already added');
        }
      }

      // 重置执行ID
      setCurrentExecutionId(null);
    }
  }, [executionState.isRunning, executionState.startTime, executionState.endTime, executionState.logs, executionState.nodeStates, currentExecutionId, messages, onMessagesChange, onNavigateToVideoEditing]);

  // Format output data for display
  const formatOutput = (output: any): string => {
    if (!output) return '';
    
    if (typeof output === 'string') {
      return output;
    }
    
    if (output.text) {
      return output.text;
    }
    
    if (output.llmResponse) {
      return output.llmResponse;
    }
    
    if (output.finalResult) {
      return formatOutput(output.finalResult);
    }
    
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  };

  // Handle send message (trigger workflow execution)
  const handleSendMessage = () => {
    if (!inputValue.trim() || executionState.isRunning) {
      console.log('[WorkflowChatInterface] Cannot send message:', {
        hasInput: !!inputValue.trim(),
        isRunning: executionState.isRunning
      });
      return;
    }

    console.log('[WorkflowChatInterface] User message sent:', {
      message: inputValue,
      messageLength: inputValue.trim().length,
      timestamp: new Date().toISOString()
    });

    // Save the user input before clearing
    const userInputText = inputValue.trim();

    // Add user message to chat
    const userMessage: WorkflowChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: userInputText,
      timestamp: new Date(),
    };

    onMessagesChange([...messages, userMessage]);
    setInputValue('');
    
    // Reset textarea height to minimum after sending
    if (inputRef.current) {
      inputRef.current.style.height = '48px';
      console.log('[WorkflowChatInterface] Textarea height reset to minimum after sending');
    }

    // Trigger workflow execution with user input
    console.log('[WorkflowChatInterface] Triggering workflow execution with user input:', {
      inputLength: userInputText.length
    });
    onRunWorkflow(userInputText);
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Handle clear chat history button click
  const handleClearChatHistoryClick = () => {
    console.log('[WorkflowChatInterface] Clear chat history button clicked:', {
      currentMessagesCount: messages.length,
      timestamp: new Date().toISOString()
    });
    
    if (messages.length === 0) {
      console.log('[WorkflowChatInterface] No messages to clear');
      return;
    }
    
    // Confirm before clearing
    showConfirm(t.workflowChat.clearChatConfirm, () => {
      console.log('[WorkflowChatInterface] User confirmed clearing chat history');
      onClearChatHistory();
    });
  };

  // Handle clear context button click
  const handleClearContextClick = () => {
    console.log('[WorkflowChatInterface] Clear context button clicked:', {
      timestamp: new Date().toISOString()
    });
    
    // Confirm before clearing
    showConfirm(t.workflowChat.clearContextConfirm, () => {
      console.log('[WorkflowChatInterface] User confirmed clearing context');
      onClearContext();
    });
  };

  // 构建节点名称映射
  const nodeNames = React.useMemo(() => {
    const names: Record<string, string> = {};
    Object.entries(executionState.nodeStates).forEach(([nodeId, state]) => {
      // 从日志中查找节点名称
      const log = executionState.logs.find(l => l.nodeId === nodeId);
      names[nodeId] = log?.nodeName || nodeId;
    });
    return names;
  }, [executionState.nodeStates, executionState.logs]);

  // 构建节点执行顺序
  const executionOrder = React.useMemo(() => {
    const order: string[] = [];
    const visited = new Set<string>();

    executionState.logs.forEach(log => {
      if (log.nodeId && !visited.has(log.nodeId) && log.message.includes('Executing node')) {
        order.push(log.nodeId);
        visited.add(log.nodeId);
      }
    });

    return order;
  }, [executionState.logs]);

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Chat Header - Apple style */}
      <div className="px-6 py-4 bg-card border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{t.workflowChat.title}</h2>
              <p className="text-xs text-muted-foreground">{t.workflowChat.subtitle}</p>
            </div>
          </div>
          
          {executionState.isRunning && (
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded-full">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
              <span className="text-sm text-primary font-medium">{t.workflowChat.running}</span>
            </div>
          )}
        </div>
      </div>

      {/* Messages Area - Scrollable */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && !executionState.isRunning ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 bg-secondary rounded-md mx-auto mb-4 flex items-center justify-center">
                <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {t.workflowChat.startConversation}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t.workflowChat.startConversationDesc}
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => {
              // 用户消息
              if (message.type === 'user') {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[70%] rounded-md px-5 py-3 bg-primary text-primary-foreground">
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">
                        {message.content}
                      </div>
                      <div className="text-xs mt-2 text-primary-foreground/80 opacity-90">
                        {new Date(message.timestamp).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              // 执行过程面板 - 在最终结果之前显示，与对应的用户消息关联
              if (message.type === 'final-result') {
                return (
                  <React.Fragment key={message.id}>
                    {/* 执行过程面板 - 显示在最终结果上方 */}
                    {message.executionSessionId && executionOrder.length > 0 && (
                      <div className="flex justify-start mb-4">
                        <div className="max-w-[85%] w-full">
                          <ExecutionProcessPanel
                            nodeStates={executionState.nodeStates}
                            executionOrder={executionOrder}
                            nodeNames={nodeNames}
                            isCompleted={!executionState.isRunning && !!executionState.endTime}
                          />
                        </div>
                      </div>
                    )}

            {/* 最终结果消息 */}
            <div className="flex justify-start">
              <div className="max-w-[85%] w-full">
                <div className="rounded-md overflow-hidden bg-card border-2 border-green-500/30">
                  {/* 最终结果标题 */}
                  <div className="px-5 py-3 bg-green-500/10 border-b border-green-500/30">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-green-500 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <span className="text-sm font-semibold text-foreground">{t.workflowChat.finalResult}</span>
                    </div>
                  </div>
                  
                  {/* 最终结果内容 */}
                  <div className="px-5 py-4 bg-card">
                    <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </div>
                    
                    {/* 行动按钮 - 用于AI Video Generate等需要跳转的场景 */}
                    {message.actionButton && (
                      <div className="mt-4">
                        <button
                          onClick={message.actionButton.onClick}
                          className={`
                            px-6 py-3 rounded-md font-medium text-primary-foreground
                            transition-colors duration-200
                            flex items-center space-x-2
                            ${message.actionButton.variant === 'success'
                              ? 'bg-green-500 hover:bg-green-600'
                              : message.actionButton.variant === 'info'
                              ? 'bg-primary hover:bg-[var(--primary-hover)]'
                              : 'bg-primary hover:bg-[var(--primary-hover)]'
                            }
                          `}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          <span>{message.actionButton.label}</span>
                        </button>
                      </div>
                    )}
                    
                    {/* Video Export Button - Check if Video Export node was executed */}
                    {(() => {
                      // Find Video Export node execution in execution state
                      const videoExportLog = executionState.logs.find(
                        log => log.level === 'success' && 
                               log.message.includes('Successfully exported') && 
                               log.message.includes('video(s) to materials')
                      );
                      
                      if (!videoExportLog || !videoExportLog.nodeId) return null;
                      
                      // Get the node state which contains the materials data
                      const nodeState = executionState.nodeStates[videoExportLog.nodeId];
                      if (!nodeState?.output?.materials || !Array.isArray(nodeState.output.materials)) {
                        return null;
                      }
                      
                      const materials = nodeState.output.materials;
                      
                      return (
                        <div className="mt-4 pt-4 border-t border-border">
                          <button
                            onClick={() => {
                              console.log('[WorkflowChatInterface] Navigating to Video Editing with materials:', {
                                materialsCount: materials.length
                              });
                              if (onNavigateToVideoEditing) {
                                onNavigateToVideoEditing(materials);
                              }
                            }}
                            className="w-full px-6 py-3 bg-primary hover:bg-[var(--primary-hover)] text-primary-foreground rounded-md font-medium transition-colors duration-200 flex items-center justify-center space-x-2"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>{t.workflowChat.exportMaterials.replace('{count}', String(materials.length))}</span>
                          </button>
                          <p className="text-xs text-muted-foreground text-center mt-2">
                            {t.workflowChat.exportMaterialsHint}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                          
                          {/* 时间戳 */}
                          <div className="px-5 py-2 bg-muted border-t border-border">
                            <div className="text-xs text-muted-foreground">
                              {new Date(message.timestamp).toLocaleTimeString(locale, {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              }

              return null;
            })}

            {/* 执行过程面板 - 仅在执行中且没有最终结果时显示 */}
            {executionState.isRunning && executionOrder.length > 0 && (
              <div className="flex justify-start">
                <div className="max-w-[85%] w-full">
                  <ExecutionProcessPanel
                    nodeStates={executionState.nodeStates}
                    executionOrder={executionOrder}
                    nodeNames={nodeNames}
                    isCompleted={false}
                  />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area - Fixed at bottom, Apple style */}
      <div className="px-6 py-4 bg-card border-t border-border">
        {/* Action Buttons Row - Aligned with chat input */}
        <div className="flex items-center justify-start space-x-2 mb-3">
          <button
            onClick={handleClearChatHistoryClick}
            disabled={executionState.isRunning || messages.length === 0}
            className="px-4 py-2 bg-card border border-border text-foreground rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2 text-sm font-medium"
            title={t.workflowChat.clearChat}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>{t.workflowChat.clearChat}</span>
          </button>
          
          <button
            onClick={handleClearContextClick}
            disabled={executionState.isRunning}
            className="px-4 py-2 bg-card border border-border text-foreground rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2 text-sm font-medium"
            title={t.workflowChat.clearContextTooltip}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{t.workflowChat.clearContext}</span>
          </button>
        </div>

        {/* Input and Send Button Row */}
        <div className="flex items-start space-x-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setIsInputFocused(true);
                console.log('[WorkflowChatInterface] Input focused, textarea will expand with content');
              }}
              onBlur={() => {
                setIsInputFocused(false);
                console.log('[WorkflowChatInterface] Input blurred, textarea will collapse to minimum');
              }}
              placeholder={t.workflowChat.inputPlaceholder}
              className="w-full px-4 py-3 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none text-sm transition-colors"
              rows={1}
              style={{
                minHeight: '48px',
                maxHeight: '200px',
              }}
              disabled={executionState.isRunning}
            />
          </div>
          
          {!executionState.isRunning ? (
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || executionState.isRunning}
              className="px-6 py-3 bg-primary hover:bg-[var(--primary-hover)] text-primary-foreground rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2 font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              <span>{t.workflowChat.send}</span>
            </button>
          ) : (
            <button
              onClick={onAbortWorkflow}
              className="px-6 py-3 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md transition-colors flex items-center space-x-2 font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              <span>{t.workflowChat.stop}</span>
            </button>
          )}
        </div>
        
        <div className="mt-2 text-xs text-muted-foreground text-center">
          {executionState.isRunning ? t.workflowChat.workflowExecuting : t.workflowChat.inputHint}
        </div>
      </div>
    </div>
  );
};

export default WorkflowChatInterface;

