'use client';

import React, { useEffect } from 'react';
import { UseAIImageGenerationReturn } from '../../types';
import { VideoEditingLogger } from '../../utils';

interface AIImageGenerationModalProps extends UseAIImageGenerationReturn {}

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

  const handleAddAllToMaterials = () => {
    if (generatedImages.length > 0) {
      logger.userAction('添加所有生成图片到素材库', 'addAllButton', {
        imagesCount: generatedImages.length
      });
      handleAddToMaterials(generatedImages);
    }
  };

  const handleAddSingleToMaterials = (imageUrl: string, index: number) => {
    logger.userAction('添加单张图片到素材库', 'addSingleButton', {
      imageIndex: index
    });
    handleAddToMaterials([imageUrl]);
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[90vw] h-[85vh] max-w-7xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">AI生图</h2>
            {generationStatus !== 'idle' && (
              <span className={`px-2 py-1 text-xs rounded-full ${
                generationStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                generationStatus === 'running' ? 'bg-blue-100 text-blue-800' :
                generationStatus === 'completed' ? 'bg-green-100 text-green-800' :
                'bg-red-100 text-red-800'
              }`}>
                {generationStatus === 'pending' ? '队列中' :
                 generationStatus === 'running' ? '生成中' :
                 generationStatus === 'completed' ? '已完成' :
                 '失败'}
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="关闭"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 主内容区域 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧参数设置面板 */}
          <div className="w-1/2 border-r border-gray-200 p-4 overflow-y-auto">
            <div className="space-y-6">
              {/* 提示词设置 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  正向提示词 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={positivePrompt}
                  onChange={(e) => setPositivePrompt(e.target.value)}
                  placeholder="描述你想要生成的图片，例如：A beautiful landscape with mountains and rivers, digital art style"
                  className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  disabled={isGenerating}
                />
                <div className="text-xs text-gray-500 mt-1">
                  {positivePrompt.length}/5000 字符
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  反向提示词
                </label>
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="描述你不希望出现在图片中的内容"
                  className="w-full h-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  disabled={isGenerating}
                />
                <div className="text-xs text-gray-500 mt-1">
                  {negativePrompt.length}/2000 字符
                </div>
              </div>

              {/* 图片尺寸 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  图片尺寸
                </label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {commonDimensions.map((dim) => (
                    <button
                      key={dim.label}
                      onClick={() => {
                        setWidth(dim.width);
                        setHeight(dim.height);
                      }}
                      className={`px-3 py-2 text-sm border rounded-md transition-colors ${
                        width === dim.width && height === dim.height
                          ? 'bg-purple-50 border-purple-300 text-purple-700'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      disabled={isGenerating}
                    >
                      {dim.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">宽度</label>
                    <input
                      type="number"
                      value={width}
                      onChange={(e) => setWidth(Math.max(64, Math.min(2048, parseInt(e.target.value) || 1024)))}
                      min="64"
                      max="2048"
                      step="8"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                      disabled={isGenerating}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">高度</label>
                    <input
                      type="number"
                      value={height}
                      onChange={(e) => setHeight(Math.max(64, Math.min(2048, parseInt(e.target.value) || 1024)))}
                      min="64"
                      max="2048"
                      step="8"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                      disabled={isGenerating}
                    />
                  </div>
                </div>
              </div>

              {/* 高级参数 */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-700">高级参数</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      采样步数: {steps}
                    </label>
                    <input
                      type="range"
                      value={steps}
                      onChange={(e) => setSteps(parseInt(e.target.value))}
                      min="1"
                      max="100"
                      className="w-full"
                      disabled={isGenerating}
                    />
                    <div className="text-xs text-gray-500">推荐: 20-50</div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      CFG Scale: {cfg.toFixed(1)}
                    </label>
                    <input
                      type="range"
                      value={cfg}
                      onChange={(e) => setCfg(parseFloat(e.target.value))}
                      min="0.1"
                      max="20"
                      step="0.1"
                      className="w-full"
                      disabled={isGenerating}
                    />
                    <div className="text-xs text-gray-500">推荐: 1.0-7.0</div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      引导强度: {guidance.toFixed(1)}
                    </label>
                    <input
                      type="range"
                      value={guidance}
                      onChange={(e) => setGuidance(parseFloat(e.target.value))}
                      min="0.1"
                      max="20"
                      step="0.1"
                      className="w-full"
                      disabled={isGenerating}
                    />
                    <div className="text-xs text-gray-500">推荐: 3.0-7.0</div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">随机种子</label>
                    <div className="flex space-x-1">
                      <input
                        type="number"
                        value={seed || ''}
                        onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="随机"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                        disabled={isGenerating}
                      />
                      <button
                        onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
                        className="px-2 py-1 text-xs bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
                        disabled={isGenerating}
                        title="随机种子"
                      >
                        🎲
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">模型</label>
                  <select
                    value={checkpoint}
                    onChange={(e) => setCheckpoint(e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                    disabled={isGenerating}
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
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <div className="flex">
                    <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <p className="text-sm text-red-800">{generationError}</p>
                      <button
                        onClick={clearError}
                        className="text-xs text-red-600 hover:text-red-800 mt-1"
                      >
                        清除错误
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 生成按钮 */}
              <div>
                <button
                  onClick={handleGenerateClick}
                  disabled={isGenerating || !positivePrompt.trim()}
                  className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {isGenerating ? (
                    <div className="flex items-center justify-center space-x-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>生成中... {generationProgress > 0 && `${generationProgress}%`}</span>
                    </div>
                  ) : (
                    '生成图片'
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 右侧结果展示面板 */}
          <div className="w-1/2 p-4 overflow-y-auto">
            <div className="h-full">
              {generatedImages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
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
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">
                      生成结果 ({generatedImages.length}张)
                    </h3>
                    <button
                      onClick={handleAddAllToMaterials}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
                    >
                      添加全部到素材库
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {generatedImages.map((imageUrl, index) => (
                      <div key={index} className="relative bg-gray-100 rounded-lg overflow-hidden group">
                        <img
                          src={imageUrl}
                          alt={`AI生成图片 ${index + 1}`}
                          className="w-full h-48 object-cover"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity space-x-2">
                            <button
                              onClick={() => handleAddSingleToMaterials(imageUrl, index)}
                              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                              title="添加到素材库"
                            >
                              添加
                            </button>
                            <a
                              href={imageUrl}
                              download={`ai-generated-image-${index + 1}.png`}
                              className="inline-block px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                              title="下载图片"
                            >
                              下载
                            </a>
                          </div>
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
    </div>
  );
};

export default AIImageGenerationModal; 