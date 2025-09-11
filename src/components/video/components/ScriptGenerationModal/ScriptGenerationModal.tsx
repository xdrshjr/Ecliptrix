'use client';

import React, { useState, useCallback } from 'react';
import { ScriptGenerationConfig } from '@/types';
import { VideoEditingLogger } from '../../utils';

interface ScriptGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: ScriptGenerationConfig) => void;
  taskId: string;
}

const ScriptGenerationModal: React.FC<ScriptGenerationModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  taskId
}) => {
  // 配置状态
  const [config, setConfig] = useState<ScriptGenerationConfig>({
    language: 'chinese',
    consistency: 'moderate',
    segmentCount: 5,
    customRequirements: ''
  });

  const logger = new VideoEditingLogger({
    taskId,
    component: 'ScriptGenerationModal'
  });

  // 处理配置变更
  const handleLanguageChange = useCallback((language: ScriptGenerationConfig['language']) => {
    logger.info('用户修改脚本语言设置', { 
      previousLanguage: config.language,
      newLanguage: language,
      timestamp: new Date().toISOString()
    });
    setConfig(prev => ({ ...prev, language }));
  }, [config.language, logger]);

  const handleConsistencyChange = useCallback((consistency: ScriptGenerationConfig['consistency']) => {
    logger.info('用户修改保持程度设置', { 
      previousConsistency: config.consistency,
      newConsistency: consistency,
      timestamp: new Date().toISOString()
    });
    setConfig(prev => ({ ...prev, consistency }));
  }, [config.consistency, logger]);

  const handleSegmentCountChange = useCallback((segmentCount: number) => {
    logger.info('用户修改段落数设置', { 
      previousCount: config.segmentCount,
      newCount: segmentCount,
      timestamp: new Date().toISOString()
    });
    setConfig(prev => ({ ...prev, segmentCount }));
  }, [config.segmentCount, logger]);

  const handleCustomRequirementsChange = useCallback((customRequirements: string) => {
    setConfig(prev => ({ ...prev, customRequirements }));
  }, []);

  // 处理生成脚本
  const handleGenerate = useCallback(() => {
    logger.userAction('确认生成脚本', 'scriptGeneration', {
      config: {
        language: config.language,
        consistency: config.consistency,
        segmentCount: config.segmentCount,
        hasCustomRequirements: !!config.customRequirements?.trim(),
        customRequirementsLength: config.customRequirements?.length || 0
      },
      timestamp: new Date().toISOString()
    });

    onGenerate(config);
  }, [config, onGenerate, logger]);

  // 处理关闭
  const handleClose = useCallback(() => {
    logger.info('用户关闭脚本生成配置弹窗', {
      finalConfig: config,
      timestamp: new Date().toISOString()
    });
    onClose();
  }, [config, onClose, logger]);

  if (!isOpen) return null;

  return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">生成脚本配置</h2>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-200 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区域 */}
        <div className="p-6 space-y-6">
          {/* 语言选择 */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">脚本语言</label>
            <div className="space-y-2">
              {[
                { value: 'chinese', label: '中文', description: '生成中文视频脚本' },
                { value: 'english', label: '英语', description: '生成英文视频脚本' },
                { value: 'mixed', label: '中英混杂', description: '根据内容智能选择语言' }
              ].map((option) => (
                <label key={option.value} className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="language"
                    value={option.value}
                    checked={config.language === option.value}
                    onChange={() => handleLanguageChange(option.value as ScriptGenerationConfig['language'])}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{option.label}</div>
                    <div className="text-xs text-gray-500">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 保持程度 */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">原文保持程度</label>
            <div className="space-y-2">
              {[
                { value: 'high', label: '高度一致', description: '尽可能保持原文表达方式' },
                { value: 'moderate', label: '略微修改', description: '适度调整以适合视频表达' },
                { value: 'low', label: '大幅修改', description: '大幅优化以提升视频效果' }
              ].map((option) => (
                <label key={option.value} className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="consistency"
                    value={option.value}
                    checked={config.consistency === option.value}
                    onChange={() => handleConsistencyChange(option.value as ScriptGenerationConfig['consistency'])}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{option.label}</div>
                    <div className="text-xs text-gray-500">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 段落数量 */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              生成段落数：{config.segmentCount}
            </label>
            <div className="flex items-center space-x-4">
              <span className="text-xs text-gray-500">1</span>
              <input
                type="range"
                min="1"
                max="10"
                value={config.segmentCount}
                onChange={(e) => handleSegmentCountChange(parseInt(e.target.value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              />
              <span className="text-xs text-gray-500">10</span>
            </div>
            <div className="text-xs text-gray-500">
              建议根据内容长度选择适当的段落数量
            </div>
          </div>

          {/* 自定义要求 */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              自定义要求 <span className="text-gray-400">(可选)</span>
            </label>
            <textarea
              value={config.customRequirements}
              onChange={(e) => handleCustomRequirementsChange(e.target.value)}
              placeholder="请描述您对脚本的特殊要求，例如：风格、语调、重点等..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              rows={3}
              maxLength={500}
            />
            <div className="text-xs text-gray-400 text-right">
              {(config.customRequirements || '').length}/500
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-100 bg-gray-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleGenerate}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>开始生成</span>
          </button>
        </div>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      `}</style>
    </div>
  );
};

export default ScriptGenerationModal; 