'use client';

import React, { useCallback } from 'react';
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
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const formatTimestamp = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-30 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">AI视频解析结果</h2>
              <p className="text-sm text-gray-500 mt-0.5">智能分析视频内容</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
            title="关闭"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
          {analysisResult ? (
            analysisResult.success ? (
              <div className="p-6">
                {/* Video Info */}
                <div className="bg-gray-50 rounded-xl p-4 mb-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">视频时长</span>
                      <p className="font-medium text-gray-900">{analysisResult.video_duration.toFixed(1)}秒</p>
                    </div>
                    <div>
                      <span className="text-gray-500">提取帧数</span>
                      <p className="font-medium text-gray-900">{analysisResult.total_frames_extracted}帧</p>
                    </div>
                    <div>
                      <span className="text-gray-500">处理时间</span>
                      <p className="font-medium text-gray-900">{analysisResult.processing_time.toFixed(1)}秒</p>
                    </div>
                    <div>
                      <span className="text-gray-500">分析时间</span>
                      <p className="font-medium text-gray-900">{new Date(analysisResult.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>

                {/* Frame Analysis Results */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">逐帧分析结果</h3>
                  {analysisResult.frame_analyses.map((frame: FrameAnalysis, index: number) => (
                    <div key={index} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                      <div className="flex items-start space-x-4">
                        {/* Frame Info */}
                        <div className="flex-shrink-0">
                          <div className="w-16 h-16 bg-blue-50 rounded-lg flex flex-col items-center justify-center">
                            <span className="text-xs text-blue-600 font-medium">第{frame.frame_number + 1}帧</span>
                            <span className="text-xs text-blue-500">{formatTimestamp(frame.timestamp)}</span>
                          </div>
                        </div>
                        
                        {/* Analysis Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800">
                              {formatTimestamp(frame.timestamp)}
                            </span>
                            <span className="text-xs text-gray-500">时间点</span>
                          </div>
                          <p className="text-gray-800 leading-relaxed text-sm">{frame.analysis}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                {analysisResult.message && (
                  <div className="mt-6 p-4 bg-blue-50 rounded-xl">
                    <div className="flex items-start space-x-3">
                      <div className="w-5 h-5 text-blue-600 mt-0.5">
                        <svg fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-blue-900">分析总结</h4>
                        <p className="text-sm text-blue-800 mt-1">{analysisResult.message}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Error State */
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">解析失败</h3>
                <p className="text-gray-600 mb-4">{analysisResult.message || '视频解析过程中出现错误'}</p>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                >
                  关闭
                </button>
              </div>
            )
          ) : (
            /* Loading State */
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">正在加载解析结果</h3>
              <p className="text-gray-600">请稍候...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {analysisResult?.success && (
          <div className="border-t border-gray-100 p-4 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">
                {videoUrl && (
                  <span>视频: {videoUrl.length > 50 ? `${videoUrl.substring(0, 50)}...` : videoUrl}</span>
                )}
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
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