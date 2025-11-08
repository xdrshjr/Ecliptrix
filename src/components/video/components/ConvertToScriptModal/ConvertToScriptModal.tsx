'use client';

import React, { useState, useEffect } from 'react';
import { MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useLocale } from '@/contexts/LocaleContext';
import { ScriptGenerationParameters } from '../../types/videoEditingTypes';
import { VideoAnalysisResponse } from '../../services/videoAnalysisService';

interface ConvertToScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  materials: MaterialItem[];
  taskId: string;
  chatContent: string; // 聊天对话内容
  onGenerateScript: (
    chatContent: string,
    selectedVideos: MaterialItem[],
    parameters: ScriptGenerationParameters,
    enableVideoUnderstanding: boolean,
    analysisMode: 'quick' | 'professional'
  ) => void;
  isGenerating?: boolean;
  getAnalysisResult?: (videoUrl: string) => VideoAnalysisResponse | null; // 获取视频分析结果
}

const ConvertToScriptModal: React.FC<ConvertToScriptModalProps> = ({
  isOpen,
  onClose,
  materials,
  taskId,
  chatContent,
  onGenerateScript,
  isGenerating = false,
  getAnalysisResult
}) => {
  const { t } = useLocale();
  const logger = new VideoEditingLogger({
    taskId,
    component: 'ConvertToScriptModal'
  });

  // Modal animation state
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // 视频理解开关
  const [enableVideoUnderstanding, setEnableVideoUnderstanding] = useState(false);

  // 视频分析模式：快速分析 或 专业分析
  const [analysisMode, setAnalysisMode] = useState<'quick' | 'professional'>('quick');

  // 视频选择
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());

  // 脚本生成参数
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
      setEnableVideoUnderstanding(false);
      setAnalysisMode('quick'); // 默认快速分析
      setSelectedVideos(new Set());
      setParameters({
        language: 'chinese',
        segmentCount: 5,
        analysisDepth: 'detailed',
        includeVisualElements: true,
        includeAudioAnalysis: true
      });

      const totalVideoCount = materials.filter(m => m.type === 'video').length;
      const analyzedCount = getAnalysisResult 
        ? materials.filter(m => {
            if (m.type !== 'video' || !m.url) return false;
            const result = getAnalysisResult(m.url);
            return result && result.success && result.frame_analyses && result.frame_analyses.length > 0;
          }).length
        : 0;
      
      logger.info('转换视频脚本弹窗打开', {
        chatContentLength: chatContent.length,
        totalVideoCount,
        analyzedVideoCount: analyzedCount,
        totalMaterials: materials.length,
        hasAnalysisFunction: !!getAnalysisResult
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isVisible) return null;

  // 根据是否启用视频理解，过滤视频素材
  const allVideoMaterials = materials.filter(material => material.type === 'video');
  
  // 如果启用了视频理解，只显示已经分析过的视频
  const videoMaterials = enableVideoUnderstanding && getAnalysisResult
    ? allVideoMaterials.filter(material => {
        const analysisResult = getAnalysisResult(material.url || '');
        const hasValidAnalysis = analysisResult && 
                                analysisResult.success && 
                                analysisResult.frame_analyses && 
                                analysisResult.frame_analyses.length > 0;
        
        if (hasValidAnalysis) {
          logger.debug(`视频已分析: ${material.name}`, {
            videoId: material.id,
            framesCount: analysisResult.frame_analyses.length
          });
        }
        
        return hasValidAnalysis;
      })
    : allVideoMaterials;
  
  const analyzedVideoCount = enableVideoUnderstanding && getAnalysisResult
    ? allVideoMaterials.filter(material => {
        const analysisResult = getAnalysisResult(material.url || '');
        return analysisResult && 
               analysisResult.success && 
               analysisResult.frame_analyses && 
               analysisResult.frame_analyses.length > 0;
      }).length
    : 0;
  
  const selectedVideoItems = Array.from(selectedVideos)
    .map(id => videoMaterials.find(v => v.id === id))
    .filter(Boolean) as MaterialItem[];

  const handleClose = () => {
    logger.userAction('关闭转换视频脚本弹窗', 'closeButton', {
      selectedVideoCount: selectedVideos.size,
      videoUnderstandingEnabled: enableVideoUnderstanding
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

  const handleGenerate = () => {
    const selectedVideoItems = Array.from(selectedVideos)
      .map(id => videoMaterials.find(v => v.id === id))
      .filter(Boolean) as MaterialItem[];

    logger.userAction('开始生成脚本', 'generateScript', {
      chatContentLength: chatContent.length,
      selectedVideoCount: selectedVideoItems.length,
      videoUnderstandingEnabled: enableVideoUnderstanding,
      analysisMode: enableVideoUnderstanding ? analysisMode : undefined,
      parameters
    });

    onGenerateScript(chatContent, selectedVideoItems, parameters, enableVideoUnderstanding, analysisMode);
  };

  const canGenerate = enableVideoUnderstanding ? selectedVideos.size > 0 : true;

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
        className={`bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-6xl w-full max-h-[90vh] flex flex-col transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-purple-50 flex-shrink-0 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h3 id="modal-title" className="text-xl font-semibold text-gray-900">
                  转换视频脚本
                </h3>
                <p className="text-sm text-gray-600">
                  将对话内容转换为视频脚本
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isGenerating}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content - Left-Right Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - 参数设置 */}
          <div className="w-1/2 p-6 border-r border-gray-200 overflow-y-auto">
            <h4 className="text-md font-semibold text-gray-800 mb-4 flex items-center">
              <svg className="w-5 h-5 text-gray-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              参数设置
            </h4>

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
                      className={`px-4 py-3 rounded-lg border text-sm transition-all duration-200 ${
                        parameters.analysisDepth === option.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
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
                <label className="block text-sm font-medium text-gray-700">附加选项</label>
                
                <div className="space-y-3">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={parameters.includeVisualElements}
                      onChange={(e) => setParameters({ ...parameters, includeVisualElements: e.target.checked })}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">包含视觉元素分析</div>
                      <div className="text-xs text-gray-500">分析视频中的场景、物体、人物等视觉信息</div>
                    </div>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={parameters.includeAudioAnalysis}
                      onChange={(e) => setParameters({ ...parameters, includeAudioAnalysis: e.target.checked })}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">包含音频分析</div>
                      <div className="text-xs text-gray-500">分析视频中的语音、音乐、音效等音频信息</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - 视频理解 */}
          <div className="w-1/2 p-6 overflow-y-auto bg-gray-50">
            {/* 视频理解标题和开关 */}
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-md font-semibold text-gray-800 flex items-center">
                <svg className="w-5 h-5 text-gray-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                视频理解
              </h4>
              
              {/* Toggle Switch */}
              <button
                onClick={() => {
                  setEnableVideoUnderstanding(!enableVideoUnderstanding);
                  if (enableVideoUnderstanding) {
                    setSelectedVideos(new Set()); // 关闭时清除选择
                  }
                  logger.userAction('切换视频理解开关', 'toggleVideoUnderstanding', {
                    newState: !enableVideoUnderstanding
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  enableVideoUnderstanding ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                    enableVideoUnderstanding ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 说明文本 */}
            <div className="text-sm text-gray-600 mb-6">
              <p>
                {enableVideoUnderstanding 
                  ? '已启用视频理解，将使用已解析视频的分析结果来生成脚本' 
                  : '视频理解已关闭，将仅根据对话内容生成脚本'}
              </p>
            </div>

            {/* Video Selection Grid */}
            {enableVideoUnderstanding && (
              <div>
                {/* 显示已分析视频信息 */}
                {getAnalysisResult && (
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-start space-x-2">
                      <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-sm">
                        <p className="text-blue-800 font-medium">
                          显示已解析的视频素材
                        </p>
                        <p className="text-blue-700 mt-1">
                          当前共 <span className="font-semibold">{analyzedVideoCount}</span> 个已解析视频 
                          {allVideoMaterials.length > analyzedVideoCount && (
                            <span className="text-blue-600">
                              （总共 {allVideoMaterials.length} 个视频）
                            </span>
                          )}
                        </p>
                        {allVideoMaterials.length > analyzedVideoCount && (
                          <p className="text-blue-600 text-xs mt-1">
                            💡 提示：其他未解析的视频需要先在素材面板中进行 AI 视频解析
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                {videoMaterials.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
                    <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500 text-sm">
                      {getAnalysisResult && allVideoMaterials.length > 0 
                        ? '暂无已解析的视频素材'
                        : '暂无可用的视频素材'}
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      {getAnalysisResult && allVideoMaterials.length > 0 
                        ? '请先在素材面板中对视频进行 AI 视频解析'
                        : '请先上传或搜索视频素材'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
                      {videoMaterials.map((video) => (
                        <div
                          key={video.id}
                          className={`relative group cursor-pointer rounded-lg border-2 transition-all duration-200 bg-white ${
                            selectedVideos.has(video.id)
                              ? 'border-blue-500 bg-blue-50 shadow-md'
                              : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
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
                            </p>
                          </div>

                          {selectedVideos.has(video.id) && (
                            <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center shadow-lg">
                              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {selectedVideos.size > 0 && (
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                        <p className="text-sm text-blue-800">
                          已选择 <span className="font-semibold">{selectedVideos.size}</span> 个视频
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Chat Content Preview */}
            {!enableVideoUnderstanding && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h5 className="text-sm font-medium text-gray-700 mb-2">对话内容预览：</h5>
                <div className="text-sm text-gray-600 max-h-64 overflow-y-auto p-3 bg-gray-50 rounded border border-gray-200">
                  {chatContent}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-shrink-0 rounded-b-2xl">
          <div className="text-sm text-gray-600">
            {enableVideoUnderstanding && selectedVideos.size > 0 
              ? `将使用 ${selectedVideos.size} 个已解析视频生成脚本` 
              : '将根据对话内容生成脚本'}
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={handleClose}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              取消
            </button>
            
            <button
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-2"
            >
              {isGenerating && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              <span>{isGenerating ? '生成中...' : '开始生成'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConvertToScriptModal;

