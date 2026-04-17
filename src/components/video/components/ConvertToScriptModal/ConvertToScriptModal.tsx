'use client';

import React, { useState, useEffect, useMemo } from 'react';
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

  // 所有视频素材（必须在 hooks 之前计算）
  const allVideoMaterials = materials.filter(material => material.type === 'video');
  const videoMaterials = allVideoMaterials;
  const hasVideoMaterials = allVideoMaterials.length > 0;

  // 预计算每个视频的分析状态，避免重复调用 getAnalysisResult
  const analyzedStatusMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (!getAnalysisResult) return map;
    allVideoMaterials.forEach(m => {
      const result = getAnalysisResult(m.url || '');
      map.set(m.id, !!(result && result.success && result.frame_analyses && result.frame_analyses.length > 0));
    });
    return map;
  }, [allVideoMaterials, getAnalysisResult]);

  if (!isVisible) return null;

  const isVideoAnalyzed = (videoId: string): boolean => {
    return analyzedStatusMap.get(videoId) ?? false;
  };

  const analyzedVideoCount = Array.from(analyzedStatusMap.values()).filter(Boolean).length;

  // 计算选中的未分析视频数量
  const selectedUnanalyzedCount = enableVideoUnderstanding
    ? Array.from(selectedVideos).filter(id => {
        const video = videoMaterials.find(v => v.id === id);
        return video && !isVideoAnalyzed(video.id);
      }).length
    : 0;

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

  const handleSelectAll = () => {
    const allIds = new Set(videoMaterials.map(v => v.id));
    setSelectedVideos(allIds);
    logger.userAction('全选视频', 'selectAll', { totalSelected: allIds.size });
  };

  const handleDeselectAll = () => {
    setSelectedVideos(new Set());
    logger.userAction('取消全选视频', 'deselectAll', {});
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
        className={`bg-card rounded-md border border-border ${hasVideoMaterials ? 'max-w-6xl' : 'max-w-2xl'} w-full max-h-[90vh] flex flex-col transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border bg-primary/10 flex-shrink-0 rounded-t-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h3 id="modal-title" className="text-xl font-semibold text-foreground">
                  {t.convertToScript.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t.convertToScript.subtitle}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isGenerating}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - 参数设置 */}
          <div className={`${hasVideoMaterials ? 'w-1/2 border-r border-border' : 'w-full'} p-6 overflow-y-auto`}>
            <h4 className="text-md font-semibold text-foreground mb-4 flex items-center">
              <svg className="w-5 h-5 text-muted-foreground mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {t.convertToScript.parameterSettings}
            </h4>

            <div className="space-y-6">
              {/* Language Selection */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">{t.convertToScript.scriptLanguage}</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'chinese', label: t.convertToScript.chinese },
                    { value: 'english', label: t.convertToScript.english },
                    { value: 'mixed', label: t.convertToScript.mixed }
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
                  {t.convertToScript.segmentCount} {parameters.segmentCount}
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
                  <span>3{t.convertToScript.segments}</span>
                  <span>10{t.convertToScript.segments}</span>
                </div>
              </div>

              {/* Analysis Depth */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">{t.convertToScript.analysisDepth}</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'basic', label: t.convertToScript.basic, desc: t.convertToScript.quickGen },
                    { value: 'detailed', label: t.convertToScript.detailed, desc: t.convertToScript.balancedQuality },
                    { value: 'comprehensive', label: t.convertToScript.comprehensive, desc: t.convertToScript.deepAnalysis }
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
                <label className="block text-sm font-medium text-foreground">{t.convertToScript.additionalOptions}</label>
                
                <div className="space-y-3">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={parameters.includeVisualElements}
                      onChange={(e) => setParameters({ ...parameters, includeVisualElements: e.target.checked })}
                      className="w-4 h-4 text-primary bg-muted border-border rounded focus:ring-primary focus:ring-2"
                    />
                    <div>
                      <div className="text-sm font-medium text-foreground">{t.convertToScript.includeVisual}</div>
                      <div className="text-xs text-muted-foreground">{t.convertToScript.visualDesc}</div>
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
                      <div className="text-sm font-medium text-foreground">{t.convertToScript.includeAudio}</div>
                      <div className="text-xs text-muted-foreground">{t.convertToScript.audioDesc}</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - 视频理解（仅在有视频素材时显示） */}
          {hasVideoMaterials && (
            <div className="w-1/2 p-6 overflow-y-auto bg-muted">
              {/* 视频理解标题和开关 */}
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-md font-semibold text-foreground flex items-center">
                  <svg className="w-5 h-5 text-muted-foreground mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {t.convertToScript.videoUnderstanding}
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
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                    enableVideoUnderstanding ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-card transition-transform duration-200 ${
                      enableVideoUnderstanding ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 说明文本 */}
              <div className="text-sm text-muted-foreground mb-4">
                <p>
                  {enableVideoUnderstanding
                    ? t.convertToScript.enabledDesc
                    : t.convertToScript.disabledDesc}
                </p>
              </div>

              {/* 分析模式选择器 - 仅当启用视频理解且有未分析视频时显示 */}
              {enableVideoUnderstanding && allVideoMaterials.length - analyzedVideoCount > 0 && (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-muted-foreground mb-2">{t.convertToScript.analysisMode}</label>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setAnalysisMode('quick')}
                      className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all duration-200 ${
                        analysisMode === 'quick'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:border-border'
                      }`}
                    >
                      <div className="font-medium">{t.convertToScript.quickAnalysis}</div>
                      <div className="text-[10px] opacity-75 mt-0.5">{t.convertToScript.coverOnly}</div>
                    </button>
                    <button
                      onClick={() => setAnalysisMode('professional')}
                      className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all duration-200 ${
                        analysisMode === 'professional'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:border-border'
                      }`}
                    >
                      <div className="font-medium">{t.convertToScript.proAnalysis}</div>
                      <div className="text-[10px] opacity-75 mt-0.5">{t.convertToScript.multiFrame}</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Video Selection Grid */}
              {enableVideoUnderstanding && (
                <div>
                  {/* 显示视频素材信息 */}
                  <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded-md">
                    <div className="flex items-start space-x-2">
                      <svg className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-sm">
                        <p className="text-primary font-medium">
                          {t.convertToScript.selectVideoDesc}
                        </p>
                        <p className="text-primary mt-1">
                          {t.convertToScript.videoStatsPrefix}<span className="font-semibold">{allVideoMaterials.length}</span>{t.convertToScript.videoStatsTotal}
                          <span className="font-semibold">{analyzedVideoCount}</span>{t.convertToScript.videoStatsAnalyzed}
                          <span className="font-semibold">{allVideoMaterials.length - analyzedVideoCount}</span>{t.convertToScript.videoStatsPending}
                        </p>
                        {selectedUnanalyzedCount > 0 && (
                          <p className="text-amber-600 text-xs mt-1">
                            {t.convertToScript.selectedUnanalyzedPrefix}{selectedUnanalyzedCount}{t.convertToScript.selectedUnanalyzed}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {videoMaterials.length === 0 ? (
                    <div className="text-center py-12 bg-card rounded-md border-2 border-dashed border-border">
                      <svg className="mx-auto h-12 w-12 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p className="text-muted-foreground text-sm">{t.convertToScript.noVideos}</p>
                      <p className="text-muted-foreground text-xs mt-1">{t.convertToScript.pleaseUpload}</p>
                    </div>
                  ) : (
                    <>
                      {/* 全选/取消全选栏 */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-muted-foreground">
                          {t.convertToScript.selectedCountPrefix}<span className="font-semibold">{selectedVideos.size}</span> / {videoMaterials.length}{t.convertToScript.selectedCount}
                        </span>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={handleSelectAll}
                            className="text-xs text-primary hover:text-primary/80 font-medium"
                          >
                            {t.convertToScript.selectAll}
                          </button>
                          <span className="text-muted-foreground">|</span>
                          <button
                            onClick={handleDeselectAll}
                            className="text-xs text-muted-foreground hover:text-foreground font-medium"
                          >
                            {t.convertToScript.deselectAll}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
                        {videoMaterials.map((video) => {
                          const analyzed = isVideoAnalyzed(video.id);
                          return (
                            <div
                              key={video.id}
                              className={`relative group cursor-pointer rounded-md border-2 transition-all duration-200 bg-card ${
                                selectedVideos.has(video.id)
                                  ? 'border-primary bg-primary/10'
                                  : 'border-border hover:border-border'
                              }`}
                              onClick={() => handleVideoSelect(video.id)}
                            >
                              <div className="aspect-video bg-muted rounded-t-md overflow-hidden relative">
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
                                {/* 状态标签 */}
                                <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  analyzed
                                    ? 'bg-primary/10 text-primary'
                                    : 'bg-muted text-muted-foreground'
                                }`}>
                                  {analyzed ? t.convertToScript.analyzed : t.convertToScript.pending}
                                </span>
                              </div>

                              <div className="p-3">
                                <p className="text-sm font-medium text-foreground truncate">{video.name}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {video.duration ? `${Math.round(video.duration)}s` : t.convertToScript.unknownDuration}
                                </p>
                              </div>

                              {selectedVideos.has(video.id) && (
                                <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                                  <svg className="w-4 h-4 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Chat Content Preview */}
              {!enableVideoUnderstanding && (
                <div className="bg-card rounded-md border border-border p-4">
                  <h5 className="text-sm font-medium text-foreground mb-2">{t.convertToScript.chatPreview}</h5>
                  <div className="text-sm text-muted-foreground max-h-64 overflow-y-auto p-3 bg-muted rounded-md border border-border">
                    {chatContent}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-muted border-t border-border flex items-center justify-between flex-shrink-0 rounded-b-md">
          <div className="text-sm text-muted-foreground">
            {enableVideoUnderstanding && selectedVideos.size > 0
              ? `${t.convertToScript.footerWithVideo.replace('{count}', String(selectedVideos.size))}${selectedUnanalyzedCount > 0 ? t.convertToScript.footerWithAnalysis.replace('{count}', String(selectedUnanalyzedCount)) : ''}`
              : t.convertToScript.footerNoVideo}
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={handleClose}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              {t.common.cancel}
            </button>
            
            <button
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
              className="px-6 py-2 text-sm font-medium text-primary-foreground bg-primary border border-transparent rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-2"
            >
              {isGenerating && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              <span>{isGenerating ? t.convertToScript.generating : t.convertToScript.startGenerate}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConvertToScriptModal;

