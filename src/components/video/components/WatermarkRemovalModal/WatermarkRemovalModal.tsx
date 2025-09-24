'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';

// 水印区域数据结构
export interface WatermarkArea {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// 水印去除响应数据结构
export interface WatermarkRemovalResponse {
  success: boolean;
  message: string;
  task_id: string;
  original_video_url: string;
  processed_video_url?: string;
  watermark_area?: WatermarkArea;
  processing_time?: number;
  video_duration?: number;
  total_frames?: number;
  inpaint_method?: string;
  error_code?: string;
  details?: string;
}

interface WatermarkRemovalModalProps {
  isOpen: boolean;
  material: MaterialItem | null;
  onClose: () => void;
  onWatermarkRemoved?: (processedVideoUrl: string, originalMaterial: MaterialItem) => void;
  taskId: string;
}

const WatermarkRemovalModal: React.FC<WatermarkRemovalModalProps> = ({
  isOpen,
  material,
  onClose,
  onWatermarkRemoved,
  taskId
}) => {
  // 视频播放控制状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  
  // 水印选择状态
  const [isSelecting, setIsSelecting] = useState(false);
  const [watermarkArea, setWatermarkArea] = useState<WatermarkArea | null>(null);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<string>('');
  
  // 设置选项
  const [inpaintMethod, setInpaintMethod] = useState<'telea' | 'ns'>('telea');
  const [inpaintRadius, setInpaintRadius] = useState(5);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const logger = new VideoEditingLogger({
    taskId,
    component: 'WatermarkRemovalModal'
  });
  
  const { showSuccess, showError } = useNotification();
  const { t } = useLocale();

  // 重置状态当弹窗打开时
  useEffect(() => {
    if (isOpen && material) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setWatermarkArea(null);
      setSelectionStart(null);
      setIsSelecting(false);
      setIsProcessing(false);
      setProcessingProgress('');
      setInpaintMethod('telea');
      setInpaintRadius(5);
      
      logger.info('水印去除弹窗打开', {
        materialId: material.id,
        materialName: material.name,
        materialUrl: material.url.substring(0, 100)
      });
    }
  }, [isOpen, material?.id]);

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        if (isProcessing) return; // 处理中不允许关闭
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (!isProcessing) {
          handlePlayPause();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isProcessing]);

  // 视频加载完成
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      const videoDuration = videoRef.current.duration;
      setDuration(videoDuration);
      
      logger.info('视频加载完成', {
        duration: videoDuration,
        materialId: material?.id
      });
    }
  }, [material?.id, logger]);

  // 时间更新
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  // 播放/暂停控制
  const handlePlayPause = useCallback(() => {
    if (videoRef.current && !isProcessing) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, isProcessing]);

  // 跳转到指定时间
  const seekTo = useCallback((time: number) => {
    if (videoRef.current && !isProcessing) {
      videoRef.current.currentTime = Math.max(0, Math.min(time, duration));
    }
  }, [duration, isProcessing]);

  // 计算视频在容器中的实际显示区域
  const getVideoDisplayArea = useCallback(() => {
    if (!containerRef.current || !videoRef.current) return null;
    
    const container = containerRef.current.getBoundingClientRect();
    const video = videoRef.current;
    
    // 视频原始尺寸
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    if (videoWidth === 0 || videoHeight === 0) return null;
    
    // 容器尺寸
    const containerWidth = container.width;
    const containerHeight = container.height;
    
    // 计算视频在容器中的显示尺寸（保持宽高比）
    const videoAspectRatio = videoWidth / videoHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let displayWidth, displayHeight, offsetX, offsetY;
    
    if (videoAspectRatio > containerAspectRatio) {
      // 视频更宽，会有上下黑边
      displayWidth = containerWidth;
      displayHeight = containerWidth / videoAspectRatio;
      offsetX = 0;
      offsetY = (containerHeight - displayHeight) / 2;
    } else {
      // 视频更高，会有左右黑边
      displayWidth = containerHeight * videoAspectRatio;
      displayHeight = containerHeight;
      offsetX = (containerWidth - displayWidth) / 2;
      offsetY = 0;
    }
    
    return {
      displayWidth,
      displayHeight,
      offsetX,
      offsetY,
      containerLeft: container.left,
      containerTop: container.top,
      videoWidth,
      videoHeight
    };
  }, []);

  // 处理鼠标按下事件（开始选择水印区域）
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isProcessing || !containerRef.current || !videoRef.current) return;
    
    const displayArea = getVideoDisplayArea();
    if (!displayArea) return;
    
    // 计算鼠标相对于视频显示区域的坐标
    const mouseX = e.clientX - displayArea.containerLeft - displayArea.offsetX;
    const mouseY = e.clientY - displayArea.containerTop - displayArea.offsetY;
    
    // 检查是否在视频显示区域内
    if (mouseX < 0 || mouseX > displayArea.displayWidth || 
        mouseY < 0 || mouseY > displayArea.displayHeight) {
      return; // 点击在黑边区域，忽略
    }
    
    // 将显示坐标转换为视频原始坐标
    const x = (mouseX / displayArea.displayWidth) * displayArea.videoWidth;
    const y = (mouseY / displayArea.displayHeight) * displayArea.videoHeight;
    
    setSelectionStart({ x, y });
    setIsSelecting(true);
    setWatermarkArea(null);
    
    logger.info('开始选择水印区域', { 
      x, 
      y,
      displayArea: {
        displayWidth: displayArea.displayWidth,
        displayHeight: displayArea.displayHeight,
        offsetX: displayArea.offsetX,
        offsetY: displayArea.offsetY
      }
    });
  }, [isProcessing, logger, getVideoDisplayArea]);

  // 处理鼠标移动事件（更新选择区域）
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelecting || !selectionStart || !containerRef.current || !videoRef.current) return;
    
    const displayArea = getVideoDisplayArea();
    if (!displayArea) return;
    
    // 计算鼠标相对于视频显示区域的坐标
    const mouseX = e.clientX - displayArea.containerLeft - displayArea.offsetX;
    const mouseY = e.clientY - displayArea.containerTop - displayArea.offsetY;
    
    // 限制坐标在视频显示区域内
    const clampedMouseX = Math.max(0, Math.min(mouseX, displayArea.displayWidth));
    const clampedMouseY = Math.max(0, Math.min(mouseY, displayArea.displayHeight));
    
    // 将显示坐标转换为视频原始坐标
    const x = (clampedMouseX / displayArea.displayWidth) * displayArea.videoWidth;
    const y = (clampedMouseY / displayArea.displayHeight) * displayArea.videoHeight;
    
    // 确保选择区域的坐标正确（左上角到右下角）
    const x1 = Math.min(selectionStart.x, x);
    const y1 = Math.min(selectionStart.y, y);
    const x2 = Math.max(selectionStart.x, x);
    const y2 = Math.max(selectionStart.y, y);
    
    setWatermarkArea({ x1, y1, x2, y2 });
  }, [isSelecting, selectionStart, getVideoDisplayArea]);

  // 处理鼠标松开事件（完成选择）
  const handleMouseUp = useCallback(() => {
    if (isSelecting) {
      setIsSelecting(false);
      setSelectionStart(null);
      
      if (watermarkArea) {
        logger.info('水印区域选择完成', watermarkArea);
      }
    }
  }, [isSelecting, watermarkArea, logger]);

  // 清除选择区域
  const clearSelection = useCallback(() => {
    setWatermarkArea(null);
    setSelectionStart(null);
    setIsSelecting(false);
    
    logger.info('清除水印区域选择');
  }, [logger]);

  // 处理水印去除
  const handleRemoveWatermark = useCallback(async () => {
    if (!material || !watermarkArea || isProcessing) return;
    
    setIsProcessing(true);
    setProcessingProgress('正在准备处理...');
    
    // 获取视频显示信息用于日志记录
    const displayArea = getVideoDisplayArea();
    
    logger.info('开始水印去除处理', {
      materialId: material.id,
      watermarkArea,
      inpaintMethod,
      inpaintRadius,
      videoDisplayInfo: displayArea ? {
        videoOriginalSize: `${displayArea.videoWidth}x${displayArea.videoHeight}`,
        displaySize: `${Math.round(displayArea.displayWidth)}x${Math.round(displayArea.displayHeight)}`,
        offset: `${Math.round(displayArea.offsetX)},${Math.round(displayArea.offsetY)}`
      } : null
    });
    
    try {
      const requestData = {
        task_id: `${taskId}_watermark_${Date.now()}`,
        video_url: material.url,
        watermark_area: {
          x1: Math.round(watermarkArea.x1),
          y1: Math.round(watermarkArea.y1),
          x2: Math.round(watermarkArea.x2),
          y2: Math.round(watermarkArea.y2)
        },
        inpaint_method: inpaintMethod,
        inpaint_radius: inpaintRadius,
        custom_filename: `${material.name.replace(/\.[^/.]+$/, '')}_no_watermark.mp4`
      };
      
      logger.info('发送水印去除请求', requestData);
      setProcessingProgress('正在处理视频...');
      
      const response = await fetch('/api/video/watermark-removal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });
      
      const result: WatermarkRemovalResponse = await response.json();
      
      if (result.success && result.processed_video_url) {
        logger.info('水印去除成功', {
          processedVideoUrl: result.processed_video_url,
          processingTime: result.processing_time
        });
        
        showSuccess(`水印去除成功！处理时间: ${result.processing_time?.toFixed(1)}秒`);
        
        // 调用回调函数更新素材
        if (onWatermarkRemoved) {
          onWatermarkRemoved(result.processed_video_url, material);
        }
        
        // 关闭弹窗
        onClose();
      } else {
        throw new Error(result.message || '水印去除失败');
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      logger.error('水印去除失败', { error: errorMessage });
      showError(`水印去除失败: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
      setProcessingProgress('');
    }
  }, [material, watermarkArea, inpaintMethod, inpaintRadius, taskId, logger, showSuccess, showError, onWatermarkRemoved, onClose]);

  // 渲染选择区域覆盖层
  const renderSelectionOverlay = () => {
    if (!watermarkArea || !containerRef.current || !videoRef.current) return null;
    
    const displayArea = getVideoDisplayArea();
    if (!displayArea) return null;
    
    // 将视频坐标转换为显示坐标
    const displayX1 = (watermarkArea.x1 / displayArea.videoWidth) * displayArea.displayWidth + displayArea.offsetX;
    const displayY1 = (watermarkArea.y1 / displayArea.videoHeight) * displayArea.displayHeight + displayArea.offsetY;
    const displayX2 = (watermarkArea.x2 / displayArea.videoWidth) * displayArea.displayWidth + displayArea.offsetX;
    const displayY2 = (watermarkArea.y2 / displayArea.videoHeight) * displayArea.displayHeight + displayArea.offsetY;
    
    const width = displayX2 - displayX1;
    const height = displayY2 - displayY1;
    
    return (
      <div
        className="absolute border-2 border-red-500 bg-red-500 bg-opacity-20 pointer-events-none"
        style={{
          left: displayX1,
          top: displayY1,
          width: width,
          height: height,
        }}
      >
        <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 rounded">
          水印区域
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[200] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-full max-h-[95vh] flex flex-col overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">去除水印</h2>
              <p className="text-sm text-gray-500">{material?.name}</p>
            </div>
          </div>
          
          {!isProcessing && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="关闭"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 主要内容区域 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：视频播放区域 */}
          <div className="flex-1 flex flex-col bg-black relative">
            {/* 视频容器 */}
            <div 
              ref={containerRef}
              className="flex-1 relative flex items-center justify-center cursor-crosshair"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {material && (
                <video
                  ref={videoRef}
                  src={material.url}
                  className="max-w-full max-h-full object-contain"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => setIsPlaying(false)}
                  controls={false}
                  style={{ pointerEvents: isProcessing ? 'none' : 'auto' }}
                />
              )}
              
              {/* 选择区域覆盖层 */}
              {renderSelectionOverlay()}
              
              {/* 处理进度覆盖层 */}
              {isProcessing && (
                <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
                  <div className="text-center text-white">
                    <div className="animate-spin w-8 h-8 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
                    <p className="text-lg font-medium">{processingProgress}</p>
                    <p className="text-sm text-gray-300 mt-2">请勿关闭窗口，处理中...</p>
                  </div>
                </div>
              )}
            </div>

            {/* 视频控制栏 - 始终显示，但在处理时禁用交互 */}
            <div className="bg-gray-900 p-4 text-white">
              <div className="flex items-center space-x-4">
                {/* 播放/暂停按钮 */}
                <button
                  onClick={handlePlayPause}
                  disabled={isProcessing}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    isProcessing 
                      ? 'bg-white bg-opacity-10 cursor-not-allowed opacity-50' 
                      : 'bg-white bg-opacity-20 hover:bg-opacity-30'
                  }`}
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                {/* 进度条 */}
                <div className="flex-1">
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    value={currentTime}
                    onChange={(e) => seekTo(parseFloat(e.target.value))}
                    disabled={isProcessing}
                    className={`w-full h-2 rounded-lg appearance-none transition-opacity ${
                      isProcessing 
                        ? 'bg-gray-700 cursor-not-allowed opacity-50' 
                        : 'bg-gray-600 cursor-pointer'
                    }`}
                  />
                </div>

                {/* 时间显示 */}
                <div className={`text-sm font-mono transition-opacity ${
                  isProcessing ? 'opacity-50' : 'opacity-100'
                }`}>
                  {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} / {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
                </div>
              </div>
            </div>
          </div>

          {/* 右侧：控制面板 */}
          <div className="w-80 bg-gray-50 border-l border-gray-200 flex flex-col">
            <div className="p-6 space-y-6">
              {/* 选择指导 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 text-blue-600 mt-0.5">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-blue-900 mb-1">如何使用</h3>
                    <p className="text-sm text-blue-700">
                      在视频上点击并拖拽选择水印区域，然后点击"开始去除水印"按钮。
                    </p>
                  </div>
                </div>
              </div>

              {/* 水印区域信息 */}
              {watermarkArea && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-900">选中的水印区域</h3>
                    <button
                      onClick={clearSelection}
                      className="text-sm text-red-600 hover:text-red-700 transition-colors"
                      disabled={isProcessing}
                    >
                      清除
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">起始:</span>
                      <span className="ml-1 font-mono">({Math.round(watermarkArea.x1)}, {Math.round(watermarkArea.y1)})</span>
                    </div>
                    <div>
                      <span className="text-gray-500">结束:</span>
                      <span className="ml-1 font-mono">({Math.round(watermarkArea.x2)}, {Math.round(watermarkArea.y2)})</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-500">大小:</span>
                      <span className="ml-1 font-mono">{Math.round(watermarkArea.x2 - watermarkArea.x1)} × {Math.round(watermarkArea.y2 - watermarkArea.y1)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 处理设置 */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-sm font-medium text-gray-900 mb-4">处理设置</h3>
                
                {/* 修复方法 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">修复方法</label>
                  <select
                    value={inpaintMethod}
                    onChange={(e) => setInpaintMethod(e.target.value as 'telea' | 'ns')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isProcessing}
                  >
                    <option value="telea">TELEA (推荐)</option>
                    <option value="ns">Navier-Stokes</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    TELEA适合大多数情况，Navier-Stokes适合流体纹理
                  </p>
                </div>

                {/* 修复半径 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    修复半径: {inpaintRadius}px
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={inpaintRadius}
                    onChange={(e) => setInpaintRadius(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    disabled={isProcessing}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>1px</span>
                    <span>20px</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    较大的半径可以处理更大的水印，但可能影响细节
                  </p>
                </div>
              </div>
            </div>

            {/* 底部按钮区域 */}
            <div className="mt-auto p-6 border-t border-gray-200 space-y-3">
              <button
                onClick={handleRemoveWatermark}
                disabled={!watermarkArea || isProcessing}
                className={`w-full px-4 py-3 rounded-lg font-medium transition-colors ${
                  watermarkArea && !isProcessing
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isProcessing ? '处理中...' : '开始去除水印'}
              </button>
              
              {!isProcessing && (
                <button
                  onClick={onClose}
                  className="w-full px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WatermarkRemovalModal; 