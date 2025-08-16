'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { TimelineItem } from '@/types';
import { VideoEditingLogger } from '../../utils';
import { getTranslations, SupportedLocale, defaultLocale } from '../../../../lib/i18n';

interface SubtitleEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (subtitles: TimelineItem[]) => void;
  subtitles: TimelineItem[];
  taskId: string;
  locale?: SupportedLocale;
}

const SubtitleEditModal: React.FC<SubtitleEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  subtitles,
  taskId,
  locale = defaultLocale
}) => {
  const [editedSubtitles, setEditedSubtitles] = useState<TimelineItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'SubtitleEditModal'
  }), [taskId]);

  const t = getTranslations(locale);

  // Initialize edited subtitles when modal opens or subtitles change
  useEffect(() => {
    if (isOpen) {
      logger.info('字幕编辑模态框打开', {
        subtitleCount: subtitles.length,
        subtitleIds: subtitles.map(s => s.id),
        timestamp: new Date().toISOString()
      });
      
      setEditedSubtitles([...subtitles]);
      setHasChanges(false);
    }
  }, [isOpen, subtitles]); // 移除 logger 依赖

  // Handle subtitle text change
  const handleSubtitleChange = useCallback((subtitleId: string, newText: string) => {
    logger.info('字幕文本修改', {
      subtitleId,
      newTextLength: newText.length,
      timestamp: new Date().toISOString()
    });

    setEditedSubtitles(prev => 
      prev.map(subtitle => 
        subtitle.id === subtitleId 
          ? { 
              ...subtitle, 
              text: newText,
              name: `字幕: ${newText.substring(0, 20)}${newText.length > 20 ? '...' : ''}`
            }
          : subtitle
      )
    );
    setHasChanges(true);
  }, []); // 移除 logger 依赖

  // Handle save
  const handleSave = useCallback(() => {
    logger.info('保存字幕编辑', {
      subtitleCount: editedSubtitles.length,
      hasChanges,
      timestamp: new Date().toISOString()
    });

    if (hasChanges) {
      onSave(editedSubtitles);
    }
    onClose();
  }, [editedSubtitles, hasChanges, onSave, onClose]); // 移除 logger 依赖

  // Handle cancel
  const handleCancel = useCallback(() => {
    logger.info('取消字幕编辑', {
      hasChanges,
      timestamp: new Date().toISOString()
    });

    onClose();
  }, [hasChanges, onClose]); // 移除 logger 依赖

  // Format time display
  const formatTime = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{t.subtitleEditModal.title}</h2>
              <p className="text-sm text-gray-600 mt-1">{t.subtitleEditModal.subtitle}</p>
            </div>
            <button
              onClick={handleCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-full hover:bg-gray-100"
              aria-label="关闭"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {editedSubtitles.length === 0 ? (
            // No subtitles message
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">{t.subtitleEditModal.noSubtitles}</h3>
                <p className="text-gray-500">请先在时间轴上添加字幕后再进行编辑</p>
              </div>
            </div>
          ) : (
            // Subtitle list
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {editedSubtitles
                  .sort((a, b) => a.startTime - b.startTime)
                  .map((subtitle, index) => (
                    <div key={subtitle.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="flex items-start space-x-4">
                        {/* Subtitle number */}
                        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-medium">
                          {index + 1}
                        </div>
                        
                        {/* Subtitle content */}
                        <div className="flex-1 space-y-3">
                          {/* Time info */}
                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <div className="flex items-center space-x-1">
                              <span className="font-medium">{t.subtitleEditModal.startTime}:</span>
                              <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                                {formatTime(subtitle.startTime)}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <span className="font-medium">{t.subtitleEditModal.duration}:</span>
                              <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                                {formatTime(subtitle.duration)}
                              </span>
                            </div>
                          </div>
                          
                          {/* Text editor */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              {t.subtitleEditModal.subtitleText}
                            </label>
                            <textarea
                              value={subtitle.text || ''}
                              onChange={(e) => handleSubtitleChange(subtitle.id, e.target.value)}
                              placeholder={t.subtitleEditModal.placeholder}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-colors"
                              rows={2}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {editedSubtitles.length > 0 && (
                <span>共 {editedSubtitles.length} 个字幕片段</span>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                {t.subtitleEditModal.cancel}
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  hasChanges
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {t.subtitleEditModal.save}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubtitleEditModal;