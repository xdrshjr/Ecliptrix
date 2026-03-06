import React from 'react';
import { VideoCacheState } from '../hooks/useVideoCache';

interface VideoCacheIndicatorProps {
  cacheState: VideoCacheState;
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * 视频缓存状态指示器
 * 显示视频预加载的当前状态
 */
const VideoCacheIndicator: React.FC<VideoCacheIndicatorProps> = ({
  cacheState,
  className = '',
  showText = false,
  size = 'sm'
}) => {
  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4', 
    lg: 'w-5 h-5'
  };

  const getIndicatorContent = () => {
    switch (cacheState) {
      case 'loading':
        return {
          icon: (
            <svg className={`${sizeClasses[size]} animate-spin text-primary`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ),
          text: '预加载中...',
          bgColor: 'bg-primary/10',
          textColor: 'text-primary'
        };
      
      case 'loaded':
        return {
          icon: (
            <svg className={`${sizeClasses[size]} text-green-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          text: '已缓存',
          bgColor: 'bg-green-50',
          textColor: 'text-green-700'
        };
      
      case 'error':
        return {
          icon: (
            <svg className={`${sizeClasses[size]} text-red-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          text: '加载失败',
          bgColor: 'bg-destructive/10',
          textColor: 'text-destructive'
        };
      
      case 'not-found':
      default:
        return {
          icon: (
            <svg className={`${sizeClasses[size]} text-muted-foreground`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0" />
            </svg>
          ),
          text: '未缓存',
          bgColor: 'bg-muted',
          textColor: 'text-muted-foreground'
        };
    }
  };

  const { icon, text, bgColor, textColor } = getIndicatorContent();

  if (showText) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${bgColor} ${textColor} ${className}`}>
        {icon}
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center ${className}`} title={text}>
      {icon}
    </div>
  );
};

export default VideoCacheIndicator; 