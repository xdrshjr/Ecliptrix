'use client';

import React, { useEffect, useState } from 'react';
import { UseAIImageGenerationReturn } from '../../types';
import { VideoEditingLogger } from '../../utils';
import { PromptOptimizationService } from '../../services';
import { useNotification } from '@/contexts/NotificationContext';
import ImagePreviewModal from '../ImagePreviewModal';

interface AIImageGenerationModalProps extends UseAIImageGenerationReturn {}

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

const AIImageGenerationModal: React.FC<AIImageGenerationModalProps> = ({
  isModalOpen,
  isGenerating,
  generationProgress,
  generatedImages,
  generationError,
  generationStatus,
  
  // 参数
  positivePrompt,
  negativePrompt,
  width,
  height,
  steps,
  seed,
  cfg,
  guidance,
  checkpoint,
  
  // 方法
  closeModal,
  handleGenerate,
  handleAddToMaterials,
  handleAddSingleToMaterials,
  setPositivePrompt,
  setNegativePrompt,
  setWidth,
  setHeight,
  setSteps,
  setSeed,
  setCfg,
  setGuidance,
  setCheckpoint,
  clearError,
  
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'AIImageGenerationModal'
  });

  // Toast通知
  const { showSuccess, showError } = useNotification();

  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  
  // 提示词优化状态
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [promptOptimizationService] = useState(() => new PromptOptimizationService(taskId));

  useEffect(() => {
    if (isModalOpen) {
      logger.info('AI生图弹窗打开', {
        generationStatus,
        generatedImagesCount: generatedImages.length,
        isGenerating
      });
    }
  }, [isModalOpen, generationStatus, generatedImages.length, isGenerating, logger]);

  if (!isModalOpen) return null;

  const handleClose = () => {
    logger.userAction('关闭AI生图弹窗', 'closeButton', {
      generationStatus,
      generatedImagesCount: generatedImages.length,
      wasGenerating: isGenerating
    });
    closeModal();
  };

  const handleGenerateClick = () => {
    logger.userAction('点击生成图片按钮', 'generateButton', {
      positivePromptLength: positivePrompt.length,
      negativePromptLength: negativePrompt.length,
      dimensions: `${width}x${height}`,
      steps,
      cfg,
      guidance
    });
    handleGenerate();
  };

  const handleAddAllToMaterials = async () => {
    if (generatedImages.length > 0) {
      logger.userAction('添加所有生成图片到素材库', 'addAllButton', {
        imagesCount: generatedImages.length
      });
      
      const success = await handleAddToMaterials(generatedImages);
      
      // 显示Toast通知
      if (success) {
        showSuccess(`已成功添加 ${generatedImages.length} 张图片到素材库！`);
      } else {
        showError('添加图片到素材库失败，请稍后重试');
      }
    }
  };

  const handleAddSingleImageToMaterials = async (imageUrl: string, index: number) => {
    logger.userAction('添加单张图片到素材库', 'addSingleButton', {
      imageIndex: index
    });
    
    const success = await handleAddToMaterials([imageUrl]);
    
    // 显示Toast通知
    if (success) {
      showSuccess('图片已成功添加到素材库！');
    } else {
      showError('添加图片到素材库失败，请稍后重试');
    }
  };

  // 处理图片点击预览
  const handleImageClick = (imageUrl: string, index: number) => {
    logger.userAction('点击图片进行预览', 'imagePreview', {
      imageIndex: index
    });
    setPreviewImage({
      url: imageUrl,
      name: `AI生成图片 ${index + 1}`
    });
  };

  // 关闭预览
  const handleClosePreview = () => {
    logger.info('关闭图片预览');
    setPreviewImage(null);
  };

  // 从预览弹窗添加到素材
  const handleAddFromPreview = async (imageUrl: string) => {
    try {
      const success = await handleAddSingleToMaterials(imageUrl);
      if (success) {
        showSuccess('图片已成功添加到素材库！');
      } else {
        showError('添加图片到素材库失败，请稍后重试');
        logger.error('从预览弹窗添加图片到素材库失败', new Error('添加图片失败'));
      }
    } catch (error) {
      showError('添加图片时发生错误，请稍后重试');
      logger.error('从预览弹窗添加图片异常', error as Error);
    }
  };

  // 处理AI提示词优化
  const handleOptimizePrompts = async () => {
    if (!positivePrompt.trim()) {
      setOptimizationError('请先输入正向提示词');
      logger.warn('AI提示词优化失败：正向提示词为空');
      return;
    }

    setIsOptimizing(true);
    setOptimizationError(null);

    try {
      logger.userAction('点击AI辅助生成按钮', 'optimizeButton', {
        positivePromptLength: positivePrompt.length,
        negativePromptLength: negativePrompt.length,
        hasNegativePrompt: !!negativePrompt.trim()
      });

      const optimizedPrompts = await promptOptimizationService.optimizePrompts({
        positivePrompt,
        negativePrompt
      });

      // 验证优化结果
      if (!promptOptimizationService.validateOptimizedPrompts(optimizedPrompts)) {
        throw new Error('优化结果验证失败');
      }

      // 更新提示词
      setPositivePrompt(optimizedPrompts.positivePrompt);
      setNegativePrompt(optimizedPrompts.negativePrompt);

      logger.userAction('AI提示词优化成功', 'optimizeSuccess', {
        originalPositiveLength: positivePrompt.length,
        originalNegativeLength: negativePrompt.length,
        optimizedPositiveLength: optimizedPrompts.positivePrompt.length,
        optimizedNegativeLength: optimizedPrompts.negativePrompt.length,
        improvementRatio: {
          positive: (optimizedPrompts.positivePrompt.length / positivePrompt.length).toFixed(2),
          negative: negativePrompt ? (optimizedPrompts.negativePrompt.length / negativePrompt.length).toFixed(2) : 'N/A'
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '优化失败';
      setOptimizationError(errorMessage);
      
      logger.error('AI提示词优化失败', error as Error, {
        originalPositiveLength: positivePrompt.length,
        originalNegativeLength: negativePrompt.length,
        errorMessage
      });
    } finally {
      setIsOptimizing(false);
    }
  };

  // 清除优化错误
  const handleClearOptimizationError = () => {
    setOptimizationError(null);
    logger.info('清除提示词优化错误信息');
  };

  const commonDimensions = [
    { label: '1:1 正方形', width: 1024, height: 1024 },
    { label: '16:9 横屏', width: 1024, height: 576 },
    { label: '9:16 竖屏', width: 576, height: 1024 },
    { label: '4:3 传统', width: 1024, height: 768 },
    { label: '3:4 竖版', width: 768, height: 1024 }
  ];

  const commonCheckpoints = [
    'flux1-dev-fp8.safetensors',
    'flux1-schnell-fp8.safetensors'
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sliderStyles }} />
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[90vw] h-[85vh] max-w-7xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-white/80 backdrop-blur-sm rounded-t-lg">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">AI生图</h2>
              <p className="text-sm text-gray-500">智能图片生成</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-3 hover:bg-gray-100 rounded-xl transition-all duration-200 group"
            title="关闭"
          >
            <svg className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 主内容区域 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧参数设置面板 */}
          <div className="w-[30%] border-r border-gray-100 flex flex-col bg-gray-50/30">
            {/* 参数设置区域 - 可滚动 */}
            <div className="flex-1 p-6 overflow-y-auto overflow-x-hidden">
              <div className="space-y-8">
                {/* 提示词设置 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-gray-800">
                      正向提示词 <span className="text-red-400">*</span>
                    </label>
                    <button
                      onClick={handleOptimizePrompts}
                      disabled={isGenerating || isOptimizing || !positivePrompt.trim()}
                      className="px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md disabled:shadow-none flex items-center space-x-1"
                      title="AI辅助生成优化提示词"
                    >
                      {isOptimizing ? (
                        <>
                          <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>优化中</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span>AI辅助生成</span>
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    value={positivePrompt}
                    onChange={(e) => setPositivePrompt(e.target.value)}
                    placeholder="描述你想要生成的图片，例如：A beautiful landscape with mountains and rivers, digital art style"
                    className="w-full h-24 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none text-sm transition-all duration-200 shadow-sm"
                    disabled={isGenerating || isOptimizing}
                  />
                  <div className="text-xs text-gray-500 mt-2 text-right">
                    {positivePrompt.length}/5000 字符
                  </div>
                </div>

                {/* 优化错误信息 */}
                {optimizationError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="flex items-start">
                      <svg className="w-5 h-5 text-red-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-red-800 break-words">提示词优化失败: {optimizationError}</p>
                        <button
                          onClick={handleClearOptimizationError}
                          className="text-xs text-red-600 hover:text-red-800 mt-2 font-medium"
                        >
                          清除错误
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-3">
                    反向提示词
                  </label>
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="描述你不希望出现在图片中的内容"
                    className="w-full h-20 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none text-sm transition-all duration-200 shadow-sm"
                    disabled={isGenerating || isOptimizing}
                  />
                  <div className="text-xs text-gray-500 mt-2 text-right">
                    {negativePrompt.length}/2000 字符
                  </div>
                </div>

                {/* 图片尺寸 */}
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-3">
                    图片尺寸
                  </label>
                  <div className="space-y-4">
                    {/* 预设尺寸下拉框 */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-2">预设尺寸</label>
                      <select
                        value={`${width}x${height}`}
                        onChange={(e) => {
                          const [w, h] = e.target.value.split('x').map(Number);
                          setWidth(w);
                          setHeight(h);
                        }}
                        className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all duration-200 shadow-sm appearance-none cursor-pointer"
                        disabled={isGenerating || isOptimizing}
                      >
                        {commonDimensions.map((dim) => (
                          <option key={dim.label} value={`${dim.width}x${dim.height}`}>
                            {dim.label} ({dim.width}×{dim.height})
                          </option>
                        ))}
                        <option value="custom">自定义尺寸</option>
                      </select>
                    </div>
                    
                    {/* 自定义尺寸输入 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-2">宽度</label>
                        <input
                          type="number"
                          value={width}
                          onChange={(e) => setWidth(Math.max(64, Math.min(2048, parseInt(e.target.value) || 1024)))}
                          min="64"
                          max="2048"
                          step="8"
                          className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all duration-200 shadow-sm"
                          disabled={isGenerating || isOptimizing}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-2">高度</label>
                        <input
                          type="number"
                          value={height}
                          onChange={(e) => setHeight(Math.max(64, Math.min(2048, parseInt(e.target.value) || 1024)))}
                          min="64"
                          max="2048"
                          step="8"
                          className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all duration-200 shadow-sm"
                          disabled={isGenerating || isOptimizing}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 高级参数 */}
                <div className="space-y-6">
                  <h3 className="text-sm font-semibold text-gray-800">高级参数</h3>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-3">
                        采样步数: <span className="font-semibold text-gray-800">{steps}</span>
                      </label>
                      <input
                        type="range"
                        value={steps}
                        onChange={(e) => setSteps(parseInt(e.target.value))}
                        min="1"
                        max="100"
                        className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer slider-thumb disabled:opacity-50"
                        disabled={isGenerating || isOptimizing}
                        style={{
                          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(steps - 1) / 99 * 100}%, #e5e7eb ${(steps - 1) / 99 * 100}%, #e5e7eb 100%)`
                        }}
                      />
                      <div className="text-xs text-gray-500 mt-1">推荐: 20-50</div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-3">
                        CFG Scale: <span className="font-semibold text-gray-800">{cfg.toFixed(1)}</span>
                      </label>
                      <input
                        type="range"
                        value={cfg}
                        onChange={(e) => setCfg(parseFloat(e.target.value))}
                        min="0.1"
                        max="20"
                        step="0.1"
                        className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer slider-thumb disabled:opacity-50"
                        disabled={isGenerating || isOptimizing}
                        style={{
                          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(cfg - 0.1) / 19.9 * 100}%, #e5e7eb ${(cfg - 0.1) / 19.9 * 100}%, #e5e7eb 100%)`
                        }}
                      />
                      <div className="text-xs text-gray-500 mt-1">推荐: 1.0-7.0</div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-3">
                        引导强度: <span className="font-semibold text-gray-800">{guidance.toFixed(1)}</span>
                      </label>
                      <input
                        type="range"
                        value={guidance}
                        onChange={(e) => setGuidance(parseFloat(e.target.value))}
                        min="0.1"
                        max="20"
                        step="0.1"
                        className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer slider-thumb disabled:opacity-50"
                        disabled={isGenerating || isOptimizing}
                        style={{
                          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(guidance - 0.1) / 19.9 * 100}%, #e5e7eb ${(guidance - 0.1) / 19.9 * 100}%, #e5e7eb 100%)`
                        }}
                      />
                      <div className="text-xs text-gray-500 mt-1">推荐: 3.0-7.0</div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-3">随机种子</label>
                      <div className="flex space-x-2">
                        <input
                          type="number"
                          value={seed || ''}
                          onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : null)}
                          placeholder="随机"
                          className="flex-1 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all duration-200 shadow-sm"
                          disabled={isGenerating || isOptimizing}
                        />
                        <button
                          onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
                          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shadow-sm disabled:opacity-50"
                          disabled={isGenerating || isOptimizing}
                          title="随机种子"
                        >
                          🎲
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-3">模型</label>
                    <select
                      value={checkpoint}
                      onChange={(e) => setCheckpoint(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all duration-200 shadow-sm appearance-none cursor-pointer"
                      disabled={isGenerating || isOptimizing}
                    >
                      {commonCheckpoints.map((cp) => (
                        <option key={cp} value={cp}>
                          {cp.replace('.safetensors', '')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 错误信息 */}
                {generationError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="flex items-start">
                      <svg className="w-5 h-5 text-red-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-red-800 break-words">{generationError}</p>
                        <button
                          onClick={clearError}
                          className="text-xs text-red-600 hover:text-red-800 mt-2 font-medium"
                        >
                          清除错误
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 生成按钮 - 固定在左侧面板底部 */}
            <div className="border-t border-gray-100 p-6 bg-white/80 backdrop-blur-sm rounded-bl-lg">
              <button
                onClick={handleGenerateClick}
                disabled={isGenerating || isOptimizing || !positivePrompt.trim()}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-4 px-6 rounded-xl hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-semibold shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 disabled:shadow-none"
              >
                {isGenerating ? (
                  <div className="flex items-center justify-center space-x-3">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>生成中... {generationProgress > 0 && `${generationProgress}%`}</span>
                  </div>
                ) : (
                  '生成图片'
                )}
              </button>
            </div>
          </div>

          {/* 右侧结果展示面板 */}
          <div className="w-[70%] flex flex-col overflow-hidden">
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-white/80 backdrop-blur-sm rounded-tr-lg">
              {generatedImages.length > 0 ? (
                <>
                  <h3 className="text-lg font-medium text-gray-900">
                    生成结果 ({generatedImages.length}张)
                  </h3>
                  <button
                    onClick={handleAddAllToMaterials}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
                  >
                    添加全部到素材库
                  </button>
                </>
              ) : (
                <h3 className="text-lg font-medium text-gray-900">生成结果</h3>
              )}
            </div>

            {/* 内容区域 - 支持滚动 */}
            <div className="flex-1 overflow-y-auto rounded-br-lg">
              {generatedImages.length === 0 ? (
                <div className="h-full flex items-center justify-center p-8">
                  <div className="text-center">
                    <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                      <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">等待生成结果</h3>
                    <p className="text-gray-500 text-sm">
                      填写左侧参数并点击"生成图片"按钮开始AI生图
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4">
                  {/* 网格布局 - 支持滚动查看所有图片 */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {generatedImages.map((imageUrl, index) => (
                      <div 
                        key={`${imageUrl}-${index}`} 
                        className="relative bg-gray-100 rounded-lg overflow-hidden group cursor-pointer hover:shadow-lg transition-all duration-200"
                        onClick={() => handleImageClick(imageUrl, index)}
                      >
                        <img
                          src={imageUrl}
                          alt={`AI生成图片 ${index + 1}`}
                          className="w-full aspect-square object-cover"
                        />
                        
                        {/* 悬停操作层 */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end justify-center">
                          <div className="w-full p-3 flex justify-center space-x-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddSingleImageToMaterials(imageUrl, index);
                              }}
                              className="group/btn flex items-center justify-center w-9 h-9 bg-white/90 hover:bg-white text-gray-700 hover:text-blue-600 rounded-lg shadow-lg hover:shadow-xl backdrop-blur-sm transition-all duration-200 transform hover:scale-105"
                              title="添加到素材库"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>
                            </button>
                            <a
                              href={imageUrl}
                              download={`ai-generated-image-${index + 1}.png`}
                              onClick={(e) => e.stopPropagation()}
                              className="group/btn flex items-center justify-center w-9 h-9 bg-white/90 hover:bg-white text-gray-700 hover:text-green-600 rounded-lg shadow-lg hover:shadow-xl backdrop-blur-sm transition-all duration-200 transform hover:scale-105"
                              title="下载图片"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </a>
                          </div>
                        </div>

                        {/* 图片序号 */}
                        <div className="absolute top-3 left-3 bg-white/90 text-gray-700 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-lg backdrop-blur-sm">
                          #{index + 1}
                        </div>

                        {/* 点击预览提示 */}
                        <div className="absolute top-3 right-3 bg-white/90 text-gray-700 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-y-1 group-hover:translate-y-0">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 图片预览弹窗 */}
      {previewImage && (
        <ImagePreviewModal
          isOpen={!!previewImage}
          imageUrl={previewImage.url}
          imageName={previewImage.name}
          onClose={handleClosePreview}
          onAddToMaterials={handleAddFromPreview}
          taskId={taskId}
        />
      )}
    </div>
    </>
  );
};

export default AIImageGenerationModal; 