'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { VideoEditingLogger } from '../../utils';
import { useNotification } from '@/contexts/NotificationContext';

interface ImagePreviewModalProps {
  isOpen: boolean;
  imageUrl: string;
  imageName?: string;
  onClose: () => void;
  onAddToMaterials: (imageUrl: string) => void;
  taskId: string;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  isOpen,
  imageUrl,
  imageName = 'AI生成图片',
  onClose,
  onAddToMaterials,
  taskId
}) => {
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  const logger = new VideoEditingLogger({
    taskId,
    component: 'ImagePreviewModal'
  });
  
  const { showSuccess } = useNotification();

  // 重置状态当弹窗打开时
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setIsDragging(false);
      
      logger.info('图片预览弹窗打开', {
        imageUrl: imageUrl.substring(0, 100),
        imageName
      });
    }
  }, [isOpen, imageUrl, imageName, logger]);

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleResetZoom();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev * 1.2, 5));
    logger.info('图片缩放放大', { newScale: scale * 1.2 });
  }, [scale, logger]);

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(prev / 1.2, 0.1));
    logger.info('图片缩放缩小', { newScale: scale / 1.2 });
  }, [scale, logger]);

  const handleResetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    logger.info('重置图片缩放和位置');
  }, [logger]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  }, [scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, scale, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.1, Math.min(5, prev * delta)));
  }, []);

  const handleAddToMaterials = useCallback(() => {
    logger.userAction('点击添加到素材按钮', 'addToMaterials', {
      imageUrl: imageUrl.substring(0, 100),
      imageName
    });
    
    onAddToMaterials(imageUrl);
    showSuccess('已添加到素材管理', 3000);
    
    logger.info('图片已添加到素材管理', {
      imageUrl: imageUrl.substring(0, 100),
      imageName
    });
  }, [imageUrl, imageName, onAddToMaterials, showSuccess, logger]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      {/* 工具栏 */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-4 bg-black bg-opacity-60 backdrop-blur-sm rounded-lg px-4 py-2 z-10">
        <span className="text-white text-sm font-medium">{imageName}</span>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleZoomOut}
            className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
            title="缩小 (-)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-white text-sm min-w-16 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
            title="放大 (+)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={handleResetZoom}
            className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
            title="重置 (0)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* 右上角按钮区域 */}
      <div className="absolute top-4 right-4 flex items-center space-x-2 z-10">
        {/* 添加到素材按钮 */}
        <button
          onClick={handleAddToMaterials}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-lg"
          title="添加到素材管理"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-sm font-medium">添加到素材</span>
        </button>
        
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="p-3 text-white hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
          title="关闭 (ESC)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 图片容器 */}
      <div 
        className="relative w-full h-full overflow-hidden cursor-move select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        <img
          src={imageUrl}
          alt={imageName}
          className="absolute top-1/2 left-1/2 max-w-none pointer-events-none"
          style={{
            transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out'
          }}
          draggable={false}
        />
      </div>

      {/* 快捷键提示 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-60 backdrop-blur-sm rounded-lg px-4 py-2">
        <div className="text-white text-xs text-center space-y-1">
          <div>快捷键: <span className="font-semibold">+/-</span> 缩放 | <span className="font-semibold">0</span> 重置 | <span className="font-semibold">ESC</span> 关闭</div>
          <div>鼠标: <span className="font-semibold">滚轮</span> 缩放 | <span className="font-semibold">拖拽</span> 移动图片</div>
        </div>
      </div>
    </div>
  );
};

export default ImagePreviewModal; 