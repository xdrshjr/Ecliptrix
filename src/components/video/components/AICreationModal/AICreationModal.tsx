'use client';

import React from 'react';
import { UseAICreationReturn } from '../../hooks/useAICreation';
import { WorkflowInfo, WorkflowNodeInfo } from '../../services/workflowService';
import { VideoEditingLogger } from '../../utils';
import { MaterialItem } from '@/types';

interface AICreationModalProps extends UseAICreationReturn {
  addMaterial: (material: MaterialItem) => boolean;
}

const AICreationModal: React.FC<AICreationModalProps> = ({
  isModalOpen,
  closeModal,
  workflows,
  selectedWorkflow,
  isLoadingWorkflows,
  workflowsError,
  isParameterMode,
  parameters,
  validationErrors,
  handleWorkflowSelect,
  handleBackToWorkflows,
  setParameter,
  handleStartCreation,
  isExecuting,
  executionResult,
  executionError,
  taskId,
  addMaterial
}) => {
  const logger = new VideoEditingLogger({ taskId, component: 'AICreationModal' });

  if (!isModalOpen) return null;

  /**
   * Render parameter input based on UI configuration or field type
   */
  const renderParameterInput = (nodeInfo: WorkflowNodeInfo) => {
    const value = parameters[nodeInfo.nodeId] ?? nodeInfo.fieldValue;
    const uiConfig = nodeInfo.uiConfig;
    
    // Use UI config if available, otherwise fall back to field name
    const inputType = uiConfig?.inputType || 
      (nodeInfo.fieldName === 'text' || nodeInfo.fieldName === 'prompt' ? 'textarea' :
       nodeInfo.fieldName === 'select' ? 'select' :
       nodeInfo.fieldName === 'value' || nodeInfo.fieldName === 'number' ? 'number' : 'text');

    const placeholder = uiConfig?.placeholder || nodeInfo.description;
    const validation = uiConfig?.validation;

    // Common input classes
    const inputClasses = "w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

    switch (inputType) {
      case 'textarea':
        return (
          <div className="space-y-2">
            <textarea
              value={value || ''}
              onChange={(e) => setParameter(nodeInfo.nodeId, e.target.value)}
              placeholder={placeholder}
              className={`${inputClasses} resize-none`}
              rows={4}
              required={validation?.required}
              minLength={validation?.minLength}
              maxLength={validation?.maxLength}
            />
            {uiConfig?.helpText && (
              <p className="text-sm text-gray-500">{uiConfig.helpText}</p>
            )}
          </div>
        );

      case 'select':
        const options = uiConfig?.options || [];
        
        // Fallback to legacy options if no UI config
        if (options.length === 0 && nodeInfo.fieldName === 'select') {
          let fallbackOptions: { value: any; label: string }[] = [];
          
          if (nodeInfo.description.includes('比例') || nodeInfo.description.includes('ratio')) {
            fallbackOptions = [
              { value: '1', label: '1:1 (正方形)' },
              { value: '2', label: '4:3 (标准)' },
              { value: '3', label: '16:9 (宽屏)' },
              { value: '4', label: '9:16 (竖屏)' },
              { value: '5', label: '3:4 (竖向标准)' }
            ];
          } else if (nodeInfo.description.includes('版本') || nodeInfo.description.includes('质量')) {
            fallbackOptions = [
              { value: '1', label: '极速版' },
              { value: '2', label: '高清版' },
              { value: '3', label: '超清版' }
            ];
          } else if (nodeInfo.description.includes('输入方式')) {
            fallbackOptions = [
              { value: '1', label: '简单输入' },
              { value: '2', label: '详细输入' },
              { value: '3', label: '专业输入' },
              { value: '4', label: '自定义输入' }
            ];
          } else {
            fallbackOptions = [
              { value: '1', label: '选项 1' },
              { value: '2', label: '选项 2' },
              { value: '3', label: '选项 3' }
            ];
          }
          
          return (
            <div className="space-y-2">
              <select
                value={value || ''}
                onChange={(e) => setParameter(nodeInfo.nodeId, e.target.value)}
                className={`${inputClasses} bg-white`}
                required={validation?.required}
              >
                {fallbackOptions.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
              {uiConfig?.helpText && (
                <p className="text-sm text-gray-500">{uiConfig.helpText}</p>
              )}
            </div>
          );
        }

        return (
          <div className="space-y-2">
            <select
              value={value || ''}
              onChange={(e) => setParameter(nodeInfo.nodeId, e.target.value)}
              className={`${inputClasses} bg-white`}
              required={validation?.required}
            >
              {options.map((option) => (
                <option 
                  key={String(option.value)} 
                  value={String(option.value)}
                  title={option.description}
                >
                  {option.label}
                </option>
              ))}
            </select>
            {uiConfig?.helpText && (
              <p className="text-sm text-gray-500">{uiConfig.helpText}</p>
            )}
          </div>
        );

      case 'number':
        return (
          <div className="space-y-2">
            <input
              type="number"
              value={value || ''}
              onChange={(e) => setParameter(nodeInfo.nodeId, e.target.value ? Number(e.target.value) : null)}
              placeholder={placeholder}
              className={inputClasses}
              min={validation?.min ?? (nodeInfo.fieldName === 'value' ? 1 : undefined)}
              max={validation?.max ?? (nodeInfo.fieldName === 'value' ? 60 : undefined)}
              step={validation?.step ?? 1}
              required={validation?.required}
            />
            {uiConfig?.helpText && (
              <p className="text-sm text-gray-500">{uiConfig.helpText}</p>
            )}
          </div>
        );

      case 'text':
      default:
        return (
          <div className="space-y-2">
            <input
              type="text"
              value={value || ''}
              onChange={(e) => setParameter(nodeInfo.nodeId, e.target.value)}
              placeholder={placeholder}
              className={inputClasses}
              required={validation?.required}
              minLength={validation?.minLength}
              maxLength={validation?.maxLength}
              pattern={validation?.pattern}
            />
            {uiConfig?.helpText && (
              <p className="text-sm text-gray-500">{uiConfig.helpText}</p>
            )}
          </div>
        );
    }
  };

  /**
   * Render workflows list
   */
  const renderWorkflowsList = () => {
    if (isLoadingWorkflows) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-lg font-medium">加载创作工作流中...</p>
          <p className="text-sm text-gray-400 mt-1">正在获取可用的创作任务</p>
        </div>
      );
    }

    if (workflowsError) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
          <div className="text-6xl mb-4">⚠️</div>
          <p className="text-lg font-medium text-red-600">加载失败</p>
          <p className="text-sm text-gray-400 mt-1">{workflowsError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            重新加载
          </button>
        </div>
      );
    }

    if (workflows.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
          <div className="text-6xl mb-4">🚧</div>
          <p className="text-lg font-medium">暂无可用工作流</p>
          <p className="text-sm text-gray-400 mt-1">请稍后再试或联系管理员</p>
        </div>
      );
    }

    return (
      <div className="space-y-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          选择创作工作流
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((workflow) => (
            <div
              key={workflow.workflowId}
              onClick={() => handleWorkflowSelect(workflow)}
              className="flex flex-col p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all duration-200 bg-white"
            >
              {/* Workflow thumbnail */}
              <div className="w-full h-32 bg-gray-100 rounded-lg overflow-hidden mb-3">
                <img
                  src={workflow.icon}
                  alt={workflow.showNameCh}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDMwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxyZWN0IHg9IjEyNSIgeT0iODAiIHdpZHRoPSI1MCIgaGVpZ2h0PSI0MCIgZmlsbD0iIzlDQTNBRiIvPgo8L3N2Zz4K';
                  }}
                />
              </div>
              
              {/* Workflow info */}
              <div className="flex-1">
                <h4 className="text-sm font-medium text-gray-900 mb-1">{workflow.showNameCh}</h4>
                <p className="text-xs text-gray-500 mb-2 line-clamp-2">{workflow.description}</p>
                <div className="flex items-center justify-between">
                  <span className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                    {workflow.workflowType}
                  </span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /**
   * Render parameter input panel
   */
  const renderParameterPanel = () => {
    if (!selectedWorkflow) return null;

    return (
      <div className="p-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBackToWorkflows}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{selectedWorkflow.showNameCh}</h3>
              <p className="text-sm text-gray-500">{selectedWorkflow.description}</p>
            </div>
          </div>
        </div>

        {/* Parameter form */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6">
            {selectedWorkflow.nodeInfoList.map((nodeInfo) => (
              <div key={nodeInfo.nodeId} className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  {nodeInfo.description}
                  <span className="text-red-500 ml-1">*</span>
                </label>
                {renderParameterInput(nodeInfo)}
              </div>
            ))}
          </div>

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex">
                <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-red-800">请修正以下问题：</h4>
                  <ul className="mt-1 text-sm text-red-700 list-disc list-inside">
                    {validationErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Execution error */}
          {executionError && (
            <div className={`mt-4 p-3 rounded-lg ${
              executionError.includes('当前有用户正在生成内容') || executionError.includes('稍后再试')
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex">
                {executionError.includes('当前有用户正在生成内容') || executionError.includes('稍后再试') ? (
                  // Queue full warning icon
                  <svg className="w-5 h-5 text-amber-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                ) : (
                  // Regular error icon
                  <svg className="w-5 h-5 text-red-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <div>
                  <h4 className={`text-sm font-medium ${
                    executionError.includes('当前有用户正在生成内容') || executionError.includes('稍后再试')
                      ? 'text-amber-800'
                      : 'text-red-800'
                  }`}>
                    {executionError.includes('当前有用户正在生成内容') || executionError.includes('稍后再试')
                      ? '系统繁忙'
                      : '执行失败'
                    }
                  </h4>
                  <p className={`mt-1 text-sm ${
                    executionError.includes('当前有用户正在生成内容') || executionError.includes('稍后再试')
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}>
                    {executionError}
                  </p>
                  {(executionError.includes('当前有用户正在生成内容') || executionError.includes('稍后再试')) && (
                    <div className="mt-2 text-xs text-amber-600">
                      <p>💡 建议：</p>
                      <ul className="mt-1 list-disc list-inside space-y-1">
                        <li>等待 2-3 分钟后重新尝试</li>
                        <li>可以先准备其他素材或编辑文案</li>
                        <li>系统会自动处理排队任务</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Execution success */}
          {executionResult && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex">
                <svg className="w-5 h-5 text-green-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-green-800">创作任务已启动</h4>
                  <p className="mt-1 text-sm text-green-700">{executionResult.message}</p>
                  {executionResult.taskId && (
                    <p className="mt-1 text-xs text-green-600">任务ID: {executionResult.taskId}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom buttons */}
        <div className="flex items-center justify-end space-x-3 pt-6 border-t border-gray-200 mt-6">
          <button
            onClick={handleBackToWorkflows}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            返回
          </button>
          <button
            onClick={() => handleStartCreation(addMaterial)}
            disabled={isExecuting}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
          >
            {isExecuting && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            <span>{isExecuting ? '创作中...' : '开始创作'}</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[90vw] h-[85vh] max-w-6xl flex overflow-hidden">
        {/* Header */}
        <div className="w-full flex flex-col">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">AI创作</h2>
            <button
              onClick={closeModal}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {isParameterMode ? renderParameterPanel() : renderWorkflowsList()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AICreationModal;