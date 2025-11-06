'use client';

import React, { useMemo, useState } from 'react';
import { WorkflowExecutionState } from '@/types';
import ExecutionProcessPanel from '@/components/workflow/ExecutionProcessPanel';
import MarkdownRenderer from './MarkdownRenderer';
import { copyToClipboard, showCopyFeedback } from '@/lib/clipboard';

interface WorkflowExecutionMessageProps {
  workflowName: string;
  executionState?: WorkflowExecutionState;
  finalResult?: string;
  isComplete: boolean;
  onNavigateToVideoEditing?: (materials: any[]) => void;
  onConvertToScript?: (content: string) => void;
}

/**
 * Workflow Execution Message Component
 * 
 * Displays workflow execution progress in chat interface
 * Uses the same ExecutionProcessPanel as Workflows task for consistency
 * Apple light design style matching WorkflowChatInterface
 */
const WorkflowExecutionMessage: React.FC<WorkflowExecutionMessageProps> = ({
  workflowName,
  executionState,
  finalResult,
  isComplete,
  onNavigateToVideoEditing,
  onConvertToScript,
}) => {
  const [isCopying, setIsCopying] = useState(false);
  const [showCopySuccess, setShowCopySuccess] = useState(false);

  console.log('[WorkflowExecutionMessage] Rendering:', {
    workflowName,
    hasExecutionState: !!executionState,
    finalResult: finalResult?.substring(0, 100),
    isComplete,
    hasConvertToScriptCallback: !!onConvertToScript,
    timestamp: new Date().toISOString()
  });

  // Build node names mapping from logs
  const nodeNames = useMemo(() => {
    if (!executionState) return {};
    
    const names: Record<string, string> = {};
    Object.entries(executionState.nodeStates).forEach(([nodeId, state]) => {
      const log = executionState.logs.find(l => l.nodeId === nodeId);
      names[nodeId] = log?.nodeName || nodeId;
    });
    return names;
  }, [executionState]);

  // Build execution order from logs
  const executionOrder = useMemo(() => {
    if (!executionState) return [];
    
    const order: string[] = [];
    const visited = new Set<string>();

    executionState.logs.forEach(log => {
      if (log.nodeId && !visited.has(log.nodeId) && log.message.includes('Executing node')) {
        order.push(log.nodeId);
        visited.add(log.nodeId);
      }
    });

    return order;
  }, [executionState]);

  // Check if Video Export node was executed and extract materials
  const videoExportMaterials = useMemo(() => {
    if (!executionState || !isComplete) return null;

    // Find Video Export node execution
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

    console.log('[WorkflowExecutionMessage] Video Export detected:', {
      nodeId: videoExportLog.nodeId,
      materialsCount: nodeState.output.materials.length,
      materials: nodeState.output.materials
    });

    return nodeState.output.materials;
  }, [executionState, isComplete]);

  // Handle navigation to Video Editing
  const handleNavigateToVideoEditing = () => {
    if (videoExportMaterials && onNavigateToVideoEditing) {
      console.log('[WorkflowExecutionMessage] Navigating to Video Editing with materials:', {
        materialsCount: videoExportMaterials.length
      });
      onNavigateToVideoEditing(videoExportMaterials);
    }
  };

  // Handle copy final result
  const handleCopyFinalResult = async () => {
    if (!finalResult) return;
    
    setIsCopying(true);
    
    try {
      const result = await copyToClipboard(finalResult);
      showCopyFeedback(result.success, result.error);
      
      if (result.success) {
        setShowCopySuccess(true);
        setTimeout(() => setShowCopySuccess(false), 2000);
        console.log('[WorkflowExecutionMessage] 最终结果复制成功', {
          contentLength: finalResult.length,
          timestamp: new Date().toISOString()
        });
      } else {
        console.error('[WorkflowExecutionMessage] 复制失败:', result.error);
      }
    } catch (error) {
      console.error('[WorkflowExecutionMessage] 复制错误:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCopying(false);
    }
  };

  // Handle convert to script
  const handleConvertToScript = () => {
    if (!finalResult) return;
    
    console.log('[WorkflowExecutionMessage] 用户点击转换视频脚本按钮', {
      workflowName,
      contentLength: finalResult.length,
      timestamp: new Date().toISOString()
    });
    
    if (onConvertToScript) {
      onConvertToScript(finalResult);
    }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] w-full space-y-3">
        {/* Execution Process Panel - Shows node execution details */}
        {executionState && executionOrder.length > 0 && (
          <ExecutionProcessPanel
            nodeStates={executionState.nodeStates}
            executionOrder={executionOrder}
            nodeNames={nodeNames}
            isCompleted={isComplete}
          />
        )}

        {/* Final Result Section - Displayed when workflow completes */}
        {finalResult && isComplete && (
          <div className="rounded-2xl overflow-hidden bg-white border-2 border-green-200 shadow-lg relative">
            {/* Final Result Header */}
            <div className="px-5 py-3 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 bg-green-500 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-sm font-semibold text-green-900">最终结果</span>
                  <span className="text-xs text-green-600">· {workflowName}</span>
                </div>
                
                {/* 按钮组 - 右侧 */}
                <div className="flex items-center space-x-1">
                  {/* 复制按钮 */}
                  <button
                    onClick={handleCopyFinalResult}
                    disabled={isCopying}
                    className="w-7 h-7 rounded-full shadow-md transition-all duration-200 flex items-center justify-center bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-800 border-2 border-gray-200 cursor-pointer hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={showCopySuccess ? '已复制!' : '复制最终结果'}
                    aria-label="复制最终结果"
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

                  {/* 转换视频脚本按钮 */}
                  {onConvertToScript && (
                    <button
                      onClick={handleConvertToScript}
                      className="w-7 h-7 rounded-full shadow-md transition-all duration-200 flex items-center justify-center bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white border-2 border-white cursor-pointer hover:scale-110"
                      title="转换视频脚本"
                      aria-label="将最终结果转换为视频脚本"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* Final Result Content */}
            <div className="px-5 py-4 bg-white">
              <div className="text-sm text-gray-800 leading-relaxed">
                <MarkdownRenderer content={finalResult} isUser={false} />
              </div>
              
              {/* Export Clip Button - Show when Video Export node was executed */}
              {videoExportMaterials && videoExportMaterials.length > 0 && onNavigateToVideoEditing && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={handleNavigateToVideoEditing}
                    className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium shadow-md hover:shadow-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 transform hover:scale-[1.02] flex items-center justify-center space-x-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>导出剪辑 ({videoExportMaterials.length} 个视频素材)</span>
                  </button>
                  <p className="text-xs text-gray-500 text-center mt-2">
                    点击将视频素材导入到 Video Editing 任务的素材管理面板
                  </p>
                </div>
              )}
            </div>
            
            {/* Timestamp */}
            {executionState?.endTime && (
              <div className="px-5 py-2 bg-gray-50 border-t border-gray-100">
                <div className="text-xs text-gray-500">
                  {executionState.endTime.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Execution Progress Indicator - Shows during execution */}
        {!isComplete && executionState?.isRunning && (
          <div className="px-5 py-3 bg-blue-50 border border-blue-200 rounded-2xl shadow-sm">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-blue-700 font-medium">工作流执行中...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowExecutionMessage;


