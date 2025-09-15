'use client';

import React, { useState, useEffect } from 'react';
import { MaterialItem, ScriptSegment } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

interface VideoUnderstandingScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  materials: MaterialItem[];
  taskId: string;
  onGenerateScript: (selectedVideos: MaterialItem[], referenceText: string, parameters: ScriptGenerationParameters) => void;
  isGenerating?: boolean;
}

interface ScriptGenerationParameters {
  language: 'chinese' | 'english' | 'mixed';
  segmentCount: number;
  analysisDepth: 'basic' | 'detailed' | 'comprehensive';
  includeVisualElements: boolean;
  includeAudioAnalysis: boolean;
}

const VideoUnderstandingScriptModal: React.FC<VideoUnderstandingScriptModalProps> = ({
  isOpen,
  onClose,
  materials,
  taskId,
  onGenerateScript,
  isGenerating = false
}) => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoUnderstandingScriptModal'
  });

  // Modal animation state
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Step management
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;

  // Step 1: Video Selection
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());

  // Step 2: Reference Text
  const [referenceText, setReferenceText] = useState('');

  // Step 3: Parameters
  const [parameters, setParameters] = useState<ScriptGenerationParameters>({
    language: 'chinese',
    segmentCount: 5,
    analysisDepth: 'detailed',
    includeVisualElements: true,
    includeAudioAnalysis: true
  });

  // Animation effects
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
      setTimeout(() => setIsVisible(false), 200);
    }
  }, [isOpen]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setSelectedVideos(new Set());
      setReferenceText('');
      setParameters({
        language: 'chinese',
        segmentCount: 5,
        analysisDepth: 'detailed',
        includeVisualElements: true,
        includeAudioAnalysis: true
      });

      logger.info('视频理解生成脚本弹窗打开', {
        availableVideoCount: materials.filter(m => m.type === 'video').length,
        totalMaterials: materials.length
      });
    }
  }, [isOpen]);

  if (!isVisible) return null;

  const videoMaterials = materials.filter(material => material.type === 'video');
  const selectedVideoItems = Array.from(selectedVideos)
    .map(id => videoMaterials.find(v => v.id === id))
    .filter(Boolean) as MaterialItem[];

  const handleClose = () => {
    logger.userAction('关闭视频理解生成脚本弹窗', 'closeButton', {
      currentStep,
      selectedVideoCount: selectedVideos.size,
      hasReferenceText: referenceText.length > 0
    });
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!isGenerating) {
      handleClose();
    }
  };

  const handleVideoSelect = (videoId: string) => {
    const newSelection = new Set(selectedVideos);
    if (newSelection.has(videoId)) {
      newSelection.delete(videoId);
    } else {
      newSelection.add(videoId);
    }
    setSelectedVideos(newSelection);

    logger.userAction('选择/取消选择视频', 'videoSelection', {
      videoId,
      action: newSelection.has(videoId) ? 'select' : 'deselect',
      totalSelected: newSelection.size
    });
  };

  const handleNextStep = () => {
    if (currentStep < totalSteps) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      
      logger.userAction('进入下一步', 'stepNavigation', {
        fromStep: currentStep,
        toStep: nextStep,
        selectedVideoCount: selectedVideos.size
      });
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 1) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      
      logger.userAction('返回上一步', 'stepNavigation', {
        fromStep: currentStep,
        toStep: prevStep
      });
    }
  };

  const handleGenerate = () => {
    const selectedVideoItems = Array.from(selectedVideos)
      .map(id => videoMaterials.find(v => v.id === id))
      .filter(Boolean) as MaterialItem[];

    logger.userAction('开始生成脚本', 'generateScript', {
      selectedVideoCount: selectedVideoItems.length,
      referenceTextLength: referenceText.length,
      parameters
    });

    onGenerateScript(selectedVideoItems, referenceText, parameters);
  };

  const canProceedToStep2 = selectedVideos.size > 0;
  const canProceedToStep3 = true; // Reference text is optional
  const canGenerate = selectedVideos.size > 0;

  const getStepTitle = (step: number) => {
    switch (step) {
      case 1: return '选择视频';
      case 2: return '参考文本';
      case 3: return '生成参数';
      default: return '';
    }
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center mb-8">
      {Array.from({ length: totalSteps }, (_, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;
        
        return (
          <React.Fragment key={stepNumber}>
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-blue-500 text-white'
                  : isCompleted
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {isCompleted ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                stepNumber
              )}
            </div>
            {stepNumber < totalSteps && (
              <div
                className={`w-12 h-0.5 mx-2 transition-colors duration-200 ${
                  stepNumber < currentStep ? 'bg-green-500' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">选择要分析的视频</h3>
        <p className="text-sm text-gray-600">
          从素材库中选择一个或多个视频，AI将分析视频内容并生成对应的脚本
        </p>
      </div>

      {videoMaterials.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-500 text-sm">暂无可用的视频素材</p>
          <p className="text-gray-400 text-xs mt-1">请先上传或搜索视频素材</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto">
          {videoMaterials.map((video) => (
            <div
              key={video.id}
              className={`relative group cursor-pointer rounded-lg border-2 transition-all duration-200 ${
                selectedVideos.has(video.id)
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
              onClick={() => handleVideoSelect(video.id)}
            >
              <div className="aspect-video bg-gray-100 rounded-t-lg overflow-hidden">
                {video.thumbnailUrl ? (
                  <img
                    src={video.thumbnailUrl}
                    alt={video.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              
              <div className="p-3">
                <p className="text-sm font-medium text-gray-900 truncate">{video.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {video.duration ? `${Math.round(video.duration)}s` : '未知时长'}
                  {video.size && ` • ${(video.size / (1024 * 1024)).toFixed(1)}MB`}
                </p>
              </div>

              {selectedVideos.has(video.id) && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedVideos.size > 0 && (
        <div className="bg-blue-50 rounded-lg p-3">
          <p className="text-sm text-blue-800">
            已选择 {selectedVideos.size} 个视频
          </p>
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">添加参考文本</h3>
        <p className="text-sm text-gray-600">
          提供参考文本可以帮助AI更好地理解您的需求，生成更符合预期的脚本内容（可选）
        </p>
      </div>

      <div className="space-y-4">
        <textarea
          value={referenceText}
          onChange={(e) => setReferenceText(e.target.value)}
          placeholder="请输入参考文本，例如：视频的主题、风格要求、目标受众等..."
          className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
          maxLength={1000}
        />
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>参考文本将帮助AI更好地理解视频内容的上下文</span>
          <span>{referenceText.length}/1000</span>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-2">已选择的视频：</h4>
        <div className="space-y-2">
          {selectedVideoItems.map((video) => (
            <div key={video.id} className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-sm text-gray-700 truncate">{video.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">配置生成参数</h3>
        <p className="text-sm text-gray-600">
          调整以下参数来控制脚本生成的方式和质量
        </p>
      </div>

      <div className="space-y-6">
        {/* Language Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">脚本语言</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'chinese', label: '中文' },
              { value: 'english', label: '英文' },
              { value: 'mixed', label: '中英混合' }
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setParameters({ ...parameters, language: option.value as any })}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
                  parameters.language === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Segment Count */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            脚本段落数量: {parameters.segmentCount}
          </label>
          <input
            type="range"
            min="3"
            max="10"
            value={parameters.segmentCount}
            onChange={(e) => setParameters({ ...parameters, segmentCount: parseInt(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>3段</span>
            <span>10段</span>
          </div>
        </div>

        {/* Analysis Depth */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">分析深度</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'basic', label: '基础', desc: '快速生成' },
              { value: 'detailed', label: '详细', desc: '平衡质量' },
              { value: 'comprehensive', label: '全面', desc: '深度分析' }
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setParameters({ ...parameters, analysisDepth: option.value as any })}
                className={`px-3 py-3 rounded-lg border text-left transition-all duration-200 ${
                  parameters.analysisDepth === option.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 bg-white hover:border-gray-400'
                }`}
              >
                <div className="text-sm font-medium text-gray-900">{option.label}</div>
                <div className="text-xs text-gray-500">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Additional Options */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">附加选项</label>
          
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={parameters.includeVisualElements}
              onChange={(e) => setParameters({ ...parameters, includeVisualElements: e.target.checked })}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
            />
            <div>
              <span className="text-sm text-gray-900">包含视觉元素描述</span>
              <p className="text-xs text-gray-500">分析画面内容、场景、人物等视觉信息</p>
            </div>
          </label>

          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={parameters.includeAudioAnalysis}
              onChange={(e) => setParameters({ ...parameters, includeAudioAnalysis: e.target.checked })}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
            />
            <div>
              <span className="text-sm text-gray-900">包含音频分析</span>
              <p className="text-xs text-gray-500">分析背景音乐、音效、语音等音频信息</p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      default: return null;
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-all duration-300 ${
        isAnimating ? 'bg-black bg-opacity-40' : 'bg-black bg-opacity-0'
      }`}
      onClick={handleBackdropClick}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl max-h-[90vh] overflow-hidden transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">视频理解生成脚本</h2>
              <p className="text-sm text-gray-500 mt-1">{getStepTitle(currentStep)}</p>
            </div>
            <button
              onClick={handleClose}
              disabled={isGenerating}
              className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          {renderStepIndicator()}
          {renderCurrentStep()}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-between">
            <button
              onClick={handlePrevStep}
              disabled={currentStep === 1 || isGenerating}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一步
            </button>

            <div className="flex space-x-3">
              {currentStep < totalSteps ? (
                <button
                  onClick={handleNextStep}
                  disabled={
                    isGenerating ||
                    (currentStep === 1 && !canProceedToStep2) ||
                    (currentStep === 2 && !canProceedToStep3)
                  }
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一步
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !canGenerate}
                  className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isGenerating && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  <span>{isGenerating ? '生成中...' : '开始生成'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .slider-thumb::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(59, 130, 246, 0.2);
          transition: all 0.2s ease;
        }
        
        .slider-thumb::-webkit-slider-thumb:hover {
          background: #2563eb;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15), 0 0 0 2px rgba(59, 130, 246, 0.3);
          transform: scale(1.1);
        }
        
        .slider-thumb::-moz-range-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(59, 130, 246, 0.2);
          transition: all 0.2s ease;
        }
      `}</style>
    </div>
  );
};

export default VideoUnderstandingScriptModal; 