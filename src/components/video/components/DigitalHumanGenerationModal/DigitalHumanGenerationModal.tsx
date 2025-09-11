'use client';

import React, { useState, useRef } from 'react';
import { UseDigitalHumanGenerationReturn, VideoInfo } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';

interface DigitalHumanGenerationModalProps extends UseDigitalHumanGenerationReturn {
  taskId: string;
}

const DigitalHumanGenerationModal: React.FC<DigitalHumanGenerationModalProps> = ({
  isModalOpen,
  isGenerating,
  generationProgress,
  generatedVideos,
  generationError,
  generationStatus,
  
  // Upload state
  isUploadingVideo,
  isUploadingAudio,
  videoUploadProgress,
  audioUploadProgress,
  uploadError,
  uploadedVideoFilename,
  uploadedAudioFilename,
  
  // 参数
  positivePrompt,
  negativePrompt,
  width,
  height,
  steps,
  seed,
  cfg,
  shift,
  referenceVideoFile,
  audioFile,
  
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
  setShift,
  setReferenceVideoFile,
  setAudioFile,
  clearError,
  clearUploadError,
  
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'DigitalHumanGenerationModal'
  });

  const { showSuccess, showError } = useNotification();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // 预览状态
  const [previewVideo, setPreviewVideo] = useState<{ url: string; name: string } | null>(null);

  if (!isModalOpen) return null;

  const handleClose = () => {
    logger.userAction('关闭数字人生成弹窗', 'closeButton', {
      generationStatus,
      generatedVideosCount: generatedVideos.length,
      wasGenerating: isGenerating
    });
    closeModal();
  };

  const handleGenerateClick = () => {
    logger.userAction('点击生成数字人按钮', 'generateButton', {
      positivePrompt: positivePrompt.substring(0, 50),
      hasReferenceVideo: !!referenceVideoFile,
      hasAudio: !!audioFile
    });
    handleGenerate();
  };

  const handleVideoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      logger.info('选择参考视频文件', { fileName: file.name, fileSize: file.size });
      setReferenceVideoFile(file);
    }
  };

  const handleAudioFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      logger.info('选择音频文件', { fileName: file.name, fileSize: file.size });
      setAudioFile(file);
    }
  };

  const handleAddToMaterialsClick = () => {
    logger.userAction('添加所有数字人视频到素材库', 'addAllToMaterials', {
      videosCount: generatedVideos.length
    });
    const success = handleAddToMaterials();
    if (success) {
      showSuccess('数字人视频已添加到素材库');
    } else {
      showError('添加数字人视频到素材库失败，请稍后重试');
    }
  };

  const handleAddSingleVideo = (video: VideoInfo) => {
    logger.userAction('添加单个数字人视频到素材库', 'addSingleToMaterials', {
      filename: video.filename
    });
    const success = handleAddSingleToMaterials(video);
    if (success) {
      showSuccess('数字人视频已添加到素材库');
    } else {
      showError('添加数字人视频到素材库失败，请稍后重试');
    }
  };

  const commonDimensions = [
    { label: '16:9 横屏', width: 832, height: 480 },
    { label: '9:16 竖屏', width: 480, height: 832 },
    { label: '1:1 正方形', width: 640, height: 640 },
    { label: '4:3 传统', width: 640, height: 480 }
  ];

  return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
      <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-white/80 backdrop-blur-sm rounded-t-lg">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/25">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">数字人生成</h2>
              <p className="text-sm text-gray-500">AI数字人视频生成</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={isGenerating}
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 主要内容区域 - 单列布局 */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* 文件上传区域 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">文件上传</h3>
              
              {/* 参考视频上传 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  参考视频 *
                </label>
                <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                  uploadedVideoFilename ? 'border-green-300 bg-green-50' : 
                  isUploadingVideo ? 'border-blue-300 bg-blue-50' :
                  'border-gray-300 hover:border-purple-400'
                }`}>
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleVideoFileChange}
                    className="hidden"
                    disabled={isUploadingVideo}
                  />
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={isUploadingVideo}
                    className={`font-medium ${
                      uploadedVideoFilename ? 'text-green-600' :
                      isUploadingVideo ? 'text-blue-600' :
                      'text-purple-600 hover:text-purple-700'
                    }`}
                  >
                    {isUploadingVideo ? '上传中...' :
                     uploadedVideoFilename ? '✓ 上传完成' :
                     referenceVideoFile ? referenceVideoFile.name : '点击上传参考视频'}
                  </button>
                  {isUploadingVideo && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                          style={{ width: `${videoUploadProgress}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-blue-600 mt-1">{Math.round(videoUploadProgress)}%</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    支持 MP4, AVI, MOV 等格式
                  </p>
                </div>
              </div>

              {/* 音频上传 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  音频文件 *
                </label>
                <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                  uploadedAudioFilename ? 'border-green-300 bg-green-50' : 
                  isUploadingAudio ? 'border-blue-300 bg-blue-50' :
                  'border-gray-300 hover:border-purple-400'
                }`}>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioFileChange}
                    className="hidden"
                    disabled={isUploadingAudio}
                  />
                  <button
                    type="button"
                    onClick={() => audioInputRef.current?.click()}
                    disabled={isUploadingAudio}
                    className={`font-medium ${
                      uploadedAudioFilename ? 'text-green-600' :
                      isUploadingAudio ? 'text-blue-600' :
                      'text-purple-600 hover:text-purple-700'
                    }`}
                  >
                    {isUploadingAudio ? '上传中...' :
                     uploadedAudioFilename ? '✓ 上传完成' :
                     audioFile ? audioFile.name : '点击上传音频文件'}
                  </button>
                  {isUploadingAudio && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                          style={{ width: `${audioUploadProgress}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-blue-600 mt-1">{Math.round(audioUploadProgress)}%</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    支持 MP3, WAV 等格式，将用于唇形同步
                  </p>
                </div>
              </div>
            </div>

            {/* 提示词 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">提示词设置</h3>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  正向提示词 *
                </label>
                <textarea
                  value={positivePrompt}
                  onChange={(e) => setPositivePrompt(e.target.value)}
                  placeholder="描述您想要的数字人视频效果，例如：A professional woman speaking confidently"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  rows={3}
                  disabled={isGenerating}
                />
              </div>
            </div>

            {/* 尺寸设置 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">视频尺寸</h3>
              
              <div className="grid grid-cols-2 gap-2">
                {commonDimensions.map((dim) => (
                  <button
                    key={dim.label}
                    onClick={() => {
                      setWidth(dim.width);
                      setHeight(dim.height);
                    }}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      width === dim.width && height === dim.height
                        ? 'bg-purple-100 border-purple-300 text-purple-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                    disabled={isGenerating}
                  >
                    {dim.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">宽度</label>
                  <input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Math.max(64, parseInt(e.target.value) || 832))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    min="64"
                    max="2048"
                    step="8"
                    disabled={isGenerating}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">高度</label>
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Math.max(64, parseInt(e.target.value) || 480))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    min="64"
                    max="2048"
                    step="8"
                    disabled={isGenerating}
                  />
                </div>
              </div>
            </div>

            {/* 错误提示 */}
            {(generationError || uploadError) && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-red-400 mt-0.5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm text-red-700">{generationError || uploadError}</p>
                    <button
                      onClick={generationError ? clearError : clearUploadError}
                      className="text-sm text-red-600 hover:text-red-700 underline mt-1"
                    >
                      清除错误
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部生成按钮 */}
        <div className="p-6 border-t border-gray-100">
          <button
            onClick={handleGenerateClick}
            disabled={isGenerating || !positivePrompt.trim() || !uploadedVideoFilename || !uploadedAudioFilename || isUploadingVideo || isUploadingAudio}
            className="w-full bg-gradient-to-r from-purple-500 to-purple-600 text-white py-3 px-6 rounded-lg font-medium hover:from-purple-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-purple-500/25"
          >
            {isGenerating ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>生成中... {Math.round(generationProgress * 100)}%</span>
              </div>
            ) : isUploadingVideo || isUploadingAudio ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>文件上传中，请等待...</span>
              </div>
            ) : (
              '生成数字人视频'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DigitalHumanGenerationModal; 