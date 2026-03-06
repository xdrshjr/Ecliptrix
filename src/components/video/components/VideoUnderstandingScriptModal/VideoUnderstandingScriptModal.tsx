'use client';

import React, { useState, useEffect } from 'react';
import { MaterialItem, ScriptSegment } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { 
  VideoUnderstandingScriptMode, 
  ScriptGenerationParameters 
} from '../../types/videoEditingTypes';

interface VideoUnderstandingScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  materials: MaterialItem[];
  taskId: string;
  onGenerateScript: (
    selectedVideos: MaterialItem[], 
    referenceText: string, 
    parameters: ScriptGenerationParameters,
    mode: VideoUnderstandingScriptMode
  ) => void;
  isGenerating?: boolean;
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

  // Step management - now includes mode selection as step 1
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4; // 增加一步：模式选择

  // Step 1: Mode Selection
  const [selectedMode, setSelectedMode] = useState<'quick' | 'professional'>('quick');
  const [frameInterval, setFrameInterval] = useState<number>(5);

  // Step 2: Video Selection
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());

  // Step 3: Reference Text
  const [referenceText, setReferenceText] = useState('');

  // Step 4: Parameters
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
      setSelectedMode('quick');
      setFrameInterval(5);
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
      hasReferenceText: referenceText.length > 0,
      selectedMode
    });
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!isGenerating && e.target === e.currentTarget) {
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
        selectedVideoCount: selectedVideos.size,
        selectedMode
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

    const mode: VideoUnderstandingScriptMode = {
      type: selectedMode,
      ...(selectedMode === 'professional' && { frameInterval }),
    };

    logger.userAction('开始生成脚本', 'generateScript', {
      selectedVideoCount: selectedVideoItems.length,
      referenceTextLength: referenceText.length,
      parameters,
      mode
    });

    onGenerateScript(selectedVideoItems, referenceText, parameters, mode);
  };

  const handleFrameIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(1, Math.min(30, parseInt(e.target.value) || 5));
    setFrameInterval(value);
  };

  const canProceedFromStep1 = true; // Mode selection is always valid
  const canProceedFromStep2 = selectedVideos.size > 0;
  const canProceedFromStep3 = true; // Reference text is optional
  const canGenerate = selectedVideos.size > 0;

  const getStepTitle = (step: number) => {
    switch (step) {
      case 1: return '选择生成模式';
      case 2: return '选择视频';
      case 3: return '参考文本';
      case 4: return '生成参数';
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
                  ? 'bg-primary/100 text-white'
                  : isCompleted
                  ? 'bg-green-500 text-white'
                  : 'bg-accent text-muted-foreground'
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
                  stepNumber < currentStep ? 'bg-green-500' : 'bg-accent'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  // Step 1: Mode Selection
  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground mb-2">选择生成模式</h3>
        <p className="text-sm text-muted-foreground">
          选择最适合您需求的脚本生成方式
        </p>
      </div>

      <div className="space-y-4">
        {/* 快速生成选项 */}
        <div 
          className={`relative p-4 rounded-md border-2 cursor-pointer transition-all duration-200 ${
            selectedMode === 'quick' 
              ? 'border-primary bg-primary/10' 
              : 'border-border hover:border-border hover:bg-muted'
          }`}
          onClick={() => setSelectedMode('quick')}
        >
          <div className="flex items-start space-x-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
              selectedMode === 'quick' ? 'border-primary bg-primary/100' : 'border-border'
            }`}>
              {selectedMode === 'quick' && (
                <div className="w-2 h-2 rounded-full bg-card"></div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h4 className="font-semibold text-foreground">快速生成</h4>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                每个视频提取1帧进行AI分析，快速生成脚本内容。适合预览效果或对精度要求不高的场景。
              </p>
              <div className="mt-2 flex items-center space-x-1 text-xs text-muted-foreground">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <span>处理速度快</span>
                <span>•</span>
                <span>资源消耗低</span>
              </div>
            </div>
          </div>
        </div>

        {/* 专业（慢速）生成选项 */}
        <div 
          className={`relative p-4 rounded-md border-2 cursor-pointer transition-all duration-200 ${
            selectedMode === 'professional' 
              ? 'border-primary bg-primary/10' 
              : 'border-border hover:border-border hover:bg-muted'
          }`}
          onClick={() => setSelectedMode('professional')}
        >
          <div className="flex items-start space-x-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
              selectedMode === 'professional' ? 'border-primary bg-primary/100' : 'border-border'
            }`}>
              {selectedMode === 'professional' && (
                <div className="w-2 h-2 rounded-full bg-card"></div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <h4 className="font-semibold text-foreground">专业（慢速）生成</h4>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                按指定时间间隔提取多帧进行深度AI分析，生成高质量脚本内容。适合专业制作或对效果要求较高的场景。
              </p>
              
              {/* 帧间隔设置 */}
              {selectedMode === 'professional' && (
                <div className="bg-card rounded-md p-3 border border-border">
                  <label className="block text-sm font-medium text-foreground mb-2">
                    视频解析帧间隔（秒）
                  </label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={frameInterval}
                      onChange={handleFrameIntervalChange}
                      className="flex-1 px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                      placeholder="5"
                    />
                    <span className="text-sm text-muted-foreground">秒</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    间隔越小，分析越详细，但处理时间越长（推荐：3-10秒）
                  </p>
                </div>
              )}
              
              <div className="mt-2 flex items-center space-x-1 text-xs text-muted-foreground">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <span>分析精度高</span>
                <span>•</span>
                <span>效果更佳</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Step 2: Video Selection (原来的Step 1)
  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground mb-2">选择要分析的视频</h3>
        <p className="text-sm text-muted-foreground">
          从素材库中选择一个或多个视频，AI将分析视频内容并生成对应的脚本
        </p>
      </div>

      {videoMaterials.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-muted-foreground text-sm">暂无可用的视频素材</p>
          <p className="text-muted-foreground text-xs mt-1">请先上传或搜索视频素材</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto">
          {videoMaterials.map((video) => (
            <div
              key={video.id}
              className={`relative group cursor-pointer rounded-md border-2 transition-all duration-200 ${
                selectedVideos.has(video.id)
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-border'
              }`}
              onClick={() => handleVideoSelect(video.id)}
            >
              <div className="aspect-video bg-muted rounded-t-lg overflow-hidden">
                {video.thumbnailUrl ? (
                  <img
                    src={video.thumbnailUrl}
                    alt={video.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              
              <div className="p-3">
                <p className="text-sm font-medium text-foreground truncate">{video.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {video.duration ? `${Math.round(video.duration)}s` : '未知时长'}
                  {video.size && ` • ${(video.size / (1024 * 1024)).toFixed(1)}MB`}
                </p>
              </div>

              {selectedVideos.has(video.id) && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-primary/100 rounded-full flex items-center justify-center">
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
        <div className="bg-primary/10 rounded-md p-3">
          <p className="text-sm text-primary">
            已选择 {selectedVideos.size} 个视频 • 将使用 <span className="font-semibold">{selectedMode === 'quick' ? '快速生成' : '专业（慢速）生成'}</span> 模式
          </p>
        </div>
      )}
    </div>
  );

  // Step 3: Reference Text (原来的Step 2)
  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground mb-2">添加参考文本</h3>
        <p className="text-sm text-muted-foreground">
          提供参考文本可以帮助AI更好地理解您的需求，生成更符合预期的脚本内容（可选）
        </p>
      </div>

      <div className="space-y-4">
        <textarea
          value={referenceText}
          onChange={(e) => setReferenceText(e.target.value)}
          placeholder="请输入参考文本，例如：视频的主题、风格要求、目标受众等..."
          className="w-full h-32 px-4 py-3 border border-border rounded-md resize-none focus:ring-2 focus:ring-primary focus:border-primary transition-all duration-200"
          maxLength={1000}
        />
        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <span>参考文本将帮助AI更好地理解视频内容的上下文</span>
          <span>{referenceText.length}/1000</span>
        </div>
      </div>

      <div className="bg-muted rounded-md p-4">
        <h4 className="text-sm font-medium text-foreground mb-2">已选择的视频：</h4>
        <div className="space-y-2">
          {selectedVideoItems.map((video) => (
            <div key={video.id} className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-accent rounded flex items-center justify-center">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-sm text-foreground truncate">{video.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Step 4: Parameters (原来的Step 3)
  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground mb-2">配置生成参数</h3>
        <p className="text-sm text-muted-foreground">
          调整以下参数来控制脚本生成的方式和质量
        </p>
      </div>

      <div className="space-y-6">
        {/* Language Selection */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-3">脚本语言</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'chinese', label: '中文' },
              { value: 'english', label: '英文' },
              { value: 'mixed', label: '中英混合' }
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setParameters({ ...parameters, language: option.value as any })}
                className={`px-4 py-2 rounded-md border text-sm font-medium transition-all duration-200 ${
                  parameters.language === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-foreground hover:border-border'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Segment Count */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-3">
            脚本段落数量: {parameters.segmentCount}
          </label>
          <input
            type="range"
            min="3"
            max="10"
            value={parameters.segmentCount}
            onChange={(e) => setParameters({ ...parameters, segmentCount: parseInt(e.target.value) })}
            className="w-full h-2 bg-accent rounded-md appearance-none cursor-pointer slider-thumb"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>3段</span>
            <span>10段</span>
          </div>
        </div>

        {/* Analysis Depth */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-3">分析深度</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'basic', label: '基础', desc: '快速生成' },
              { value: 'detailed', label: '详细', desc: '平衡质量' },
              { value: 'comprehensive', label: '全面', desc: '深度分析' }
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setParameters({ ...parameters, analysisDepth: option.value as any })}
                className={`px-4 py-3 rounded-md border text-sm transition-all duration-200 ${
                  parameters.analysisDepth === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-foreground hover:border-border'
                }`}
              >
                <div className="font-medium">{option.label}</div>
                <div className="text-xs opacity-75">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Additional Options */}
        <div className="space-y-4">
          <label className="block text-sm font-medium text-foreground">附加选项</label>
          
          <div className="space-y-3">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={parameters.includeVisualElements}
                onChange={(e) => setParameters({ ...parameters, includeVisualElements: e.target.checked })}
                className="w-4 h-4 text-primary bg-muted border-border rounded focus:ring-primary focus:ring-2"
              />
              <div>
                <div className="text-sm font-medium text-foreground">包含视觉元素分析</div>
                <div className="text-xs text-muted-foreground">分析视频中的场景、物体、人物等视觉信息</div>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={parameters.includeAudioAnalysis}
                onChange={(e) => setParameters({ ...parameters, includeAudioAnalysis: e.target.checked })}
                className="w-4 h-4 text-primary bg-muted border-border rounded focus:ring-primary focus:ring-2"
              />
              <div>
                <div className="text-sm font-medium text-foreground">包含音频分析</div>
                <div className="text-xs text-muted-foreground">分析视频中的语音、音乐、音效等音频信息</div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );

  const getCurrentStepComponent = () => {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      default: return null;
    }
  };

  const getNextButtonText = () => {
    if (currentStep === totalSteps) {
      return isGenerating ? '生成中...' : '开始生成脚本';
    }
    return '下一步';
  };

  const canProceedToNext = () => {
    switch (currentStep) {
      case 1: return canProceedFromStep1;
      case 2: return canProceedFromStep2;
      case 3: return canProceedFromStep3;
      case 4: return canGenerate;
      default: return false;
    }
  };

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-all duration-300 ${
        isAnimating ? 'bg-black bg-opacity-40' : 'bg-black bg-opacity-0'
      }`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        className={`bg-card rounded-md border border-border max-w-2xl w-full max-h-[90vh] overflow-hidden transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border bg-gradient-to-r from-purple-50 to-primary/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6" />
                </svg>
              </div>
              <div>
                <h3 id="modal-title" className="text-xl font-semibold text-foreground">
                  视频理解生成脚本
                </h3>
                <p className="text-sm text-muted-foreground">
                  步骤 {currentStep}/{totalSteps}: {getStepTitle(currentStep)}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isGenerating}
              className="w-8 h-8 rounded-full bg-muted hover:bg-accent flex items-center justify-center transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="px-6 py-4 bg-muted">
          {renderStepIndicator()}
        </div>

        {/* Content */}
        <div className="px-6 py-6 overflow-y-auto max-h-96">
          {getCurrentStepComponent()}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-muted border-t border-border">
          <div className="flex items-center justify-between">
            <button
              onClick={handlePrevStep}
              disabled={currentStep === 1 || isGenerating}
              className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              上一步
            </button>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={isGenerating}
                className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                取消
              </button>
              
              <button
                onClick={currentStep === totalSteps ? handleGenerate : handleNextStep}
                disabled={!canProceedToNext() || isGenerating}
                className="px-6 py-2 text-sm font-medium text-white bg-primary border border-transparent rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-2"
              >
                {isGenerating && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                <span>{getNextButtonText()}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoUnderstandingScriptModal; 