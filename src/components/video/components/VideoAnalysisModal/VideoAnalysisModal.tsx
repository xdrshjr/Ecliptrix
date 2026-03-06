'use client';

import React, { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VideoAnalysisResponse, FrameAnalysis } from '../../services/videoAnalysisService';

interface VideoAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisResult: VideoAnalysisResponse | null;
  videoUrl?: string;
}

const VideoAnalysisModal: React.FC<VideoAnalysisModalProps> = ({
  isOpen,
  onClose,
  analysisResult,
  videoUrl
}) => {


  const formatTimestamp = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  // 日志记录
  const logModalAction = useCallback((action: string, details?: any) => {
    console.log(`[VideoAnalysisModal] ${action}`, {
      timestamp: new Date().toISOString(),
      videoUrl,
      hasAnalysisResult: !!analysisResult,
      analysisSuccess: analysisResult?.success,
      framesCount: analysisResult?.frame_analyses?.length,
      ...details
    });
  }, [videoUrl, analysisResult]);

  // 记录弹窗打开/关闭
  React.useEffect(() => {
    if (isOpen) {
      logModalAction('弹窗打开', {
        modalType: 'AI视频解析结果',
        loadingState: !analysisResult ? 'loading' : analysisResult.success ? 'success' : 'error'
      });
    }
  }, [isOpen, logModalAction]);

  const handleClose = useCallback(() => {
    logModalAction('用户关闭弹窗', { closeMethod: 'button' });
    onClose();
  }, [onClose, logModalAction]);

  const handleBackdropClose = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      logModalAction('用户关闭弹窗', { closeMethod: 'backdrop' });
      onClose();
    }
  }, [onClose, logModalAction]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] p-4"
      onClick={handleBackdropClose}
    >
      <div className="bg-card rounded-md max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">AI视频解析结果</h2>
              <p className="text-sm text-muted-foreground mt-0.5">智能分析视频内容</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-muted hover:bg-accent flex items-center justify-center transition-colors"
            title="关闭"
          >
            <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - 使用flex-1确保占用剩余空间 */}
        <div className="flex-1 overflow-y-auto">
          {analysisResult ? (
            analysisResult.success ? (
              <div className="p-6">
                {/* Video Info */}
                <div className="bg-muted rounded-md p-4 mb-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">视频时长</span>
                      <p className="font-medium text-foreground">{analysisResult.video_duration.toFixed(1)}秒</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">提取帧数</span>
                      <p className="font-medium text-foreground">{analysisResult.total_frames_extracted}帧</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">处理时间</span>
                      <p className="font-medium text-foreground">{analysisResult.processing_time.toFixed(1)}秒</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">分析时间</span>
                      <p className="font-medium text-foreground">{new Date(analysisResult.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>

                {/* Frame Analysis Results */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-foreground mb-4">逐帧分析结果</h3>
                  {analysisResult.frame_analyses.map((frame: FrameAnalysis, index: number) => (
                    <div key={index} className="bg-card border border-border rounded-md p-5 transition-colors">
                      <div className="flex items-start space-x-4">
                        {/* Frame Info */}
                        <div className="flex-shrink-0">
                          <div className="w-16 h-16 bg-primary/10 rounded-md flex flex-col items-center justify-center">
                            <span className="text-xs text-primary font-medium">第{frame.frame_number + 1}帧</span>
                            <span className="text-xs text-primary">{formatTimestamp(frame.timestamp)}</span>
                          </div>
                        </div>
                        
                        {/* Analysis Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800">
                              {formatTimestamp(frame.timestamp)}
                            </span>
                            <span className="text-xs text-muted-foreground">时间点</span>
                          </div>
                          {/* 使用ReactMarkdown渲染分析内容 */}
                          <div className="prose prose-sm max-w-none text-foreground">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                // 自定义组件样式
                                p: ({children}) => <p className="mb-2 leading-relaxed">{children}</p>,
                                h1: ({children}) => <h1 className="text-lg font-semibold mb-2 text-foreground">{children}</h1>,
                                h2: ({children}) => <h2 className="text-base font-semibold mb-2 text-foreground">{children}</h2>,
                                h3: ({children}) => <h3 className="text-sm font-semibold mb-1 text-foreground">{children}</h3>,
                                ul: ({children}) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                ol: ({children}) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                li: ({children}) => <li className="text-sm">{children}</li>,
                                strong: ({children}) => <strong className="font-semibold text-foreground">{children}</strong>,
                                em: ({children}) => <em className="italic text-muted-foreground">{children}</em>,
                                code: ({children}) => <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
                                blockquote: ({children}) => <blockquote className="border-l-4 border-border pl-3 py-1 bg-primary/10 text-sm">{children}</blockquote>
                              }}
                            >
                              {frame.analysis}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                {analysisResult.message && (
                  <div className="mt-6 p-4 bg-primary/10 rounded-md">
                    <div className="flex items-start space-x-3">
                      <div className="w-5 h-5 text-primary mt-0.5">
                        <svg fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-primary">分析总结</h4>
                        <div className="text-sm text-primary mt-1">
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({children}) => <p className="mb-1">{children}</p>,
                              strong: ({children}) => <strong className="font-semibold">{children}</strong>,
                              em: ({children}) => <em className="italic">{children}</em>
                            }}
                          >
                            {analysisResult.message}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Error State */
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">解析失败</h3>
                <p className="text-muted-foreground mb-4">{analysisResult.message || '视频解析过程中出现错误'}</p>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-muted hover:bg-accent text-foreground rounded-md transition-colors"
                >
                  关闭
                </button>
              </div>
            )
          ) : (
            /* Loading State */
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">正在加载解析结果</h3>
              <p className="text-muted-foreground">请稍候...</p>
            </div>
          )}
        </div>

        {/* Footer - 使用flex-shrink-0确保始终可见 */}
        {analysisResult?.success && (
          <div className="border-t border-border p-4 bg-muted flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {videoUrl && (
                  <span>视频: {videoUrl.length > 50 ? `${videoUrl.substring(0, 50)}...` : videoUrl}</span>
                )}
              </div>
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-md transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoAnalysisModal;