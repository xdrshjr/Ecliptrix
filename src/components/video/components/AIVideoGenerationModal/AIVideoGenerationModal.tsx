'use client';

import React, { useState, useEffect } from 'react';
import { UseAIVideoGenerationReturn, VideoInfo } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';

interface AIVideoGenerationModalProps extends UseAIVideoGenerationReturn {
  taskId: string;
}

// 苹果风格滑块样式
const sliderStyles = `
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
  
  .slider-thumb::-webkit-slider-thumb:active {
    background: #1d4ed8;
    transform: scale(0.95);
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
  
  .slider-thumb::-moz-range-thumb:hover {
    background: #2563eb;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15), 0 0 0 2px rgba(59, 130, 246, 0.3);
    transform: scale(1.1);
  }
  
  .slider-thumb:disabled::-webkit-slider-thumb {
    background: #d1d5db;
    cursor: not-allowed;
    transform: none;
  }
  
  .slider-thumb:disabled::-moz-range-thumb {
    background: #d1d5db;
    cursor: not-allowed;
    transform: none;
  }
`;

const AIVideoGenerationModal: React.FC<AIVideoGenerationModalProps> = ({
  isModalOpen,
  isGenerating,
  generationProgress,
  generatedVideos,
  generationError,
  generationStatus,
  
  // 参数
  positivePrompt,
  negativePrompt,
  width,
  height,
  durationSeconds,
  steps,
  seed,
  enableLora,
  aspectRatio,
  
  // 方法
  closeModal,
  handleGenerate,
  handleAddToMaterials,
  handleAddSingleToMaterials,
  setPositivePrompt,
  setNegativePrompt,
  setWidth,
  setHeight,
  setDurationSeconds,
  setSteps,
  setSeed,
  setEnableLora,
  setAspectRatio,
  clearError,
  
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'AIVideoGenerationModal'
  });

  // Toast通知
  const { showSuccess, showError } = useNotification();

  // 视频预览状态
  const [previewVideo, setPreviewVideo] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    if (isModalOpen) {
      logger.info('AI视频生成弹窗打开', {
        generationStatus,
        generatedVideosCount: generatedVideos.length,
        isGenerating
      });
    }
  }, [isModalOpen, generationStatus, generatedVideos.length, isGenerating, logger]);

  if (!isModalOpen) return null;

  const handleClose = () => {
    logger.userAction('关闭AI视频生成弹窗', 'closeButton', {
      generationStatus,
      generatedVideosCount: generatedVideos.length,
      wasGenerating: isGenerating
    });
    closeModal();
  };

  const handleGenerateClick = () => {
    logger.userAction('点击生成视频按钮', 'generateButton', {
      positivePrompt: positivePrompt.substring(0, 50),
      duration: durationSeconds,
      aspectRatio: aspectRatio || 'custom',
      enableLora
    });
    handleGenerate();
  };

  const handleAddToMaterialsClick = () => {
    logger.userAction('添加所有AI视频到素材库', 'addAllToMaterials', {
      videosCount: generatedVideos.length
    });
    const success = handleAddToMaterials();
    if (success) {
      showSuccess('AI视频已添加到素材库');
    } else {
      showError('添加AI视频到素材库失败，请稍后重试');
    }
  };

  const handleAddSingleVideo = (video: VideoInfo) => {
    logger.userAction('添加单个AI视频到素材库', 'addSingleToMaterials', {
      videoFilename: video.filename
    });
    const success = handleAddSingleToMaterials(video);
    if (success) {
      showSuccess(`视频 ${video.filename} 已添加到素材库`);
    } else {
      showError('添加视频到素材库失败，请稍后重试');
    }
  };

  const handleAspectRatioChange = (ratio: string) => {
    if (ratio === 'custom') {
      setAspectRatio(null);
    } else {
      const aspectRatioValue = ratio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
      setAspectRatio(aspectRatioValue);
      
      // 自动调整宽高
      switch (aspectRatioValue) {
        case '16:9':
          setWidth(800);
          setHeight(448);
          break;
        case '9:16':
          setWidth(448);
          setHeight(800);
          break;
        case '1:1':
          setWidth(640);
          setHeight(640);
          break;
        case '4:3':
          setWidth(640);
          setHeight(480);
          break;
        case '3:4':
          setWidth(480);
          setHeight(640);
          break;
        case '21:9':
          setWidth(896);
          setHeight(384);
          break;
      }
    }
  };

  return (
    <>
      <style>{sliderStyles}</style>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-full max-h-[90vh] flex overflow-hidden">
          
          {/* 左侧参数设置面板 */}
          <div className="w-[30%] flex flex-col border-r border-gray-200">
            
            {/* 头部 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-blue-50">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-800">AI视频生成</h2>
                  <p className="text-sm text-gray-500">创建精美的AI视频</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 参数设置区域 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* 提示词设置 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center space-x-2">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>提示词设置</span>
                </h3>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    正向提示词 *
                  </label>
                  <textarea
                    value={positivePrompt}
                    onChange={(e) => setPositivePrompt(e.target.value)}
                    placeholder="描述您想要生成的视频内容..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none transition-all duration-200"
                    rows={4}
                    disabled={isGenerating}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    负向提示词
                  </label>
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="您不希望在视频中出现的内容..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none transition-all duration-200"
                    rows={2}
                    disabled={isGenerating}
                  />
                </div>
              </div>

              {/* 尺寸设置 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center space-x-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  <span>尺寸设置</span>
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    宽高比预设
                  </label>
                  <select
                    value={aspectRatio || 'custom'}
                    onChange={(e) => handleAspectRatioChange(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                    disabled={isGenerating}
                  >
                    <option value="custom">自定义</option>
                    <option value="16:9">16:9 (横屏)</option>
                    <option value="9:16">9:16 (竖屏)</option>
                    <option value="1:1">1:1 (方形)</option>
                    <option value="4:3">4:3 (传统)</option>
                    <option value="3:4">3:4 (竖屏传统)</option>
                    <option value="21:9">21:9 (超宽屏)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      宽度
                    </label>
                    <input
                      type="number"
                      value={width}
                      onChange={(e) => setWidth(Math.max(64, Math.min(2048, parseInt(e.target.value) || 600)))}
                      min="64"
                      max="2048"
                      step="8"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      disabled={isGenerating}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      高度
                    </label>
                    <input
                      type="number"
                      value={height}
                      onChange={(e) => setHeight(Math.max(64, Math.min(2048, parseInt(e.target.value) || 800)))}
                      min="64"
                      max="2048"
                      step="8"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      disabled={isGenerating}
                    />
                  </div>
                </div>
              </div>

              {/* 高级参数 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center space-x-2">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                  </svg>
                  <span>高级参数</span>
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    视频时长 (秒): {durationSeconds}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="30"
                    step="1"
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(parseInt(e.target.value))}
                    className="slider-thumb w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    disabled={isGenerating}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>1秒</span>
                    <span>30秒</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    采样步数: {steps}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={steps}
                    onChange={(e) => setSteps(parseInt(e.target.value))}
                    className="slider-thumb w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    disabled={isGenerating}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>1</span>
                    <span>100</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    随机种子 (可选)
                  </label>
                  <input
                    type="number"
                    value={seed || ''}
                    onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="留空为随机"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                    disabled={isGenerating}
                  />
                </div>

                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="enableLora"
                    checked={enableLora}
                    onChange={(e) => setEnableLora(e.target.checked)}
                    className="w-5 h-5 text-green-600 bg-gray-100 border-gray-300 rounded focus:ring-green-500 focus:ring-2"
                    disabled={isGenerating}
                  />
                  <label htmlFor="enableLora" className="text-sm font-medium text-gray-700">
                    启用 LoRA 增强质量
                  </label>
                </div>
              </div>

              {/* 错误提示 */}
              {generationError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start space-x-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm text-red-700">{generationError}</p>
                    <button
                      onClick={clearError}
                      className="text-xs text-red-600 hover:text-red-700 mt-1"
                    >
                      清除错误
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 底部生成按钮 */}
            <div className="border-t border-gray-100 p-6 bg-white/80 backdrop-blur-sm rounded-bl-lg">
              <button
                onClick={handleGenerateClick}
                disabled={isGenerating || !positivePrompt.trim()}
                className="w-full bg-gradient-to-r from-purple-500 to-blue-600 text-white py-4 px-6 rounded-xl hover:from-purple-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-semibold shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/30 disabled:shadow-none"
              >
                {isGenerating ? (
                  <div className="flex items-center justify-center space-x-3">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>生成中... {generationProgress > 0 && `${generationProgress.toFixed(0)}%`}</span>
                  </div>
                ) : (
                  '生成视频'
                )}
              </button>
            </div>
          </div>

          {/* 右侧结果展示面板 */}
          <div className="w-[70%] flex flex-col overflow-hidden">
            
            {/* 结果区域头部 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center space-x-3">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-800">生成结果</h3>
                <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm font-medium">
                  {generatedVideos.length} 个视频
                </span>
              </div>
              
              {generatedVideos.length > 0 && (
                <button
                  onClick={handleAddToMaterialsClick}
                  className="flex items-center space-x-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>全部添加到素材库</span>
                </button>
              )}
            </div>

            {/* 结果展示区域 */}
            <div className="flex-1 overflow-y-auto p-6">
              {isGenerating && generationStatus !== 'completed' ? (
                <div className="flex flex-col items-center justify-center h-full space-y-6">
                  <div className="w-32 h-32 border-8 border-gray-200 border-t-purple-500 rounded-full animate-spin"></div>
                  <div className="text-center">
                    <h4 className="text-xl font-semibold text-gray-800 mb-2">正在生成视频...</h4>
                    <p className="text-gray-600 mb-4">请耐心等待，这可能需要几分钟时间</p>
                    {generationProgress > 0 && (
                      <div className="w-64 bg-gray-200 rounded-full h-3 mx-auto">
                        <div 
                          className="bg-gradient-to-r from-purple-500 to-blue-600 h-3 rounded-full transition-all duration-300"
                          style={{ width: `${generationProgress}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                </div>
              ) : generatedVideos.length > 0 ? (
                <div className="grid grid-cols-2 gap-6">
                  {generatedVideos.map((video, index) => (
                    <div key={index} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      <div className="aspect-video bg-gray-100 flex items-center justify-center">
                        <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="p-4">
                        <h5 className="font-semibold text-gray-800 mb-2 truncate">{video.filename}</h5>
                        <div className="text-sm text-gray-600 space-y-1">
                          {video.size_bytes && (
                            <p>大小: {(video.size_bytes / 1024 / 1024).toFixed(2)} MB</p>
                          )}
                          {video.duration && (
                            <p>时长: {video.duration.toFixed(1)} 秒</p>
                          )}
                        </div>
                        <div className="flex space-x-2 mt-4">
                          <button
                            onClick={() => handleAddSingleVideo(video)}
                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded-lg text-sm transition-colors"
                          >
                            添加到素材库
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <svg className="w-24 h-24 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <h4 className="text-lg font-medium mb-2">还没有生成的视频</h4>
                  <p className="text-center">在左侧设置参数并点击"生成视频"开始创作</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 视频预览Modal */}
        {previewVideo && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-60 p-4">
            <div className="bg-white rounded-xl max-w-4xl max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-semibold">{previewVideo.name}</h3>
                <button
                  onClick={() => setPreviewVideo(null)}
                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4">
                <video
                  src={previewVideo.url}
                  controls
                  className="w-full max-h-96 rounded-lg"
                  autoPlay
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default AIVideoGenerationModal;