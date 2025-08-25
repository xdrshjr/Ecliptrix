'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { TimelineItem, SubtitleStyle, SubtitleStylePreset, SubtitleFontFamily, SubtitlePosition } from '@/types';
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

// Predefined subtitle style presets
const SUBTITLE_STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'default',
    name: '默认样式',
    style: {
      fontFamily: 'default',
      fontSize: 24,
      fontColor: '#FFFFFF',
      position: 'bottom'
      // 注意：没有backgroundColor，表示无背景
    }
  },
  {
    id: 'classic',
    name: '经典样式',
    style: {
      fontFamily: 'default',
      fontSize: 24,
      fontColor: '#FFFFFF',
      backgroundColor: '#000000',
      position: 'bottom'
    }
  },
  {
    id: 'modern',
    name: '现代样式',
    style: {
      fontFamily: 'sans-serif',
      fontSize: 28,
      fontColor: '#FFFFFF',
      position: 'bottom'
    }
  },
  {
    id: 'elegant',
    name: '优雅样式',
    style: {
      fontFamily: 'serif',
      fontSize: 26,
      fontColor: '#F0F0F0',
      backgroundColor: '#1A1A1A',
      position: 'center'
    }
  },
  {
    id: 'tech',
    name: '科技样式',
    style: {
      fontFamily: 'monospace',
      fontSize: 22,
      fontColor: '#00FF00',
      backgroundColor: '#000000',
      position: 'top'
    }
  }
];

// Font family options
const FONT_FAMILY_OPTIONS: { value: SubtitleFontFamily; label: string }[] = [
  { value: 'default', label: '默认字体' },
  { value: 'serif', label: '衬线字体 (Serif)' },
  { value: 'sans-serif', label: '无衬线字体 (Sans-serif)' },
  { value: 'monospace', label: '等宽字体 (Monospace)' }
];

// Position options
const POSITION_OPTIONS: { value: SubtitlePosition; label: string }[] = [
  { value: 'top', label: '顶部居中' },
  { value: 'upper-3/4', label: '上3/4高度' },
  { value: 'center', label: '居中' },
  { value: 'lower-3/4', label: '下3/4高度' },
  { value: 'bottom', label: '底部' }
];

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
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [currentStyle, setCurrentStyle] = useState<SubtitleStyle>(SUBTITLE_STYLE_PRESETS[0].style);

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
      
      // Initialize subtitles with default style if not present
      const initializedSubtitles = subtitles.map(subtitle => ({
        ...subtitle,
        subtitleStyle: subtitle.subtitleStyle || SUBTITLE_STYLE_PRESETS[0].style
      }));
      
      setEditedSubtitles(initializedSubtitles);
      setHasChanges(false);
      
      // Set first subtitle as selected if available
      if (initializedSubtitles.length > 0) {
        setSelectedSubtitleId(initializedSubtitles[0].id);
        setCurrentStyle(initializedSubtitles[0].subtitleStyle || SUBTITLE_STYLE_PRESETS[0].style);
      }
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

  // Handle subtitle selection
  const handleSubtitleSelect = useCallback((subtitleId: string) => {
    setSelectedSubtitleId(subtitleId);
    const selectedSubtitle = editedSubtitles.find(s => s.id === subtitleId);
    if (selectedSubtitle?.subtitleStyle) {
      setCurrentStyle(selectedSubtitle.subtitleStyle);
    }
  }, [editedSubtitles]);

  // Handle style preset selection
  const handlePresetSelect = useCallback((preset: SubtitleStylePreset) => {
    logger.info('应用字幕样式预设', {
      presetId: preset.id,
      presetName: preset.name,
      selectedSubtitleId,
      timestamp: new Date().toISOString()
    });

    setCurrentStyle(preset.style);
    
    if (selectedSubtitleId) {
      // Apply to selected subtitle
      setEditedSubtitles(prev => 
        prev.map(subtitle => 
          subtitle.id === selectedSubtitleId 
            ? { ...subtitle, subtitleStyle: preset.style }
            : subtitle
        )
      );
    } else {
      // Apply to all subtitles
      setEditedSubtitles(prev => 
        prev.map(subtitle => ({ ...subtitle, subtitleStyle: preset.style }))
      );
    }
    setHasChanges(true);
  }, [selectedSubtitleId]);

  // Handle individual style property changes
  const handleStyleChange = useCallback((property: keyof SubtitleStyle, value: any) => {
    logger.info('字幕样式属性修改', {
      property,
      value,
      selectedSubtitleId,
      timestamp: new Date().toISOString()
    });

    const newStyle = { ...currentStyle, [property]: value };
    setCurrentStyle(newStyle);
    
    if (selectedSubtitleId) {
      // Apply to selected subtitle
      setEditedSubtitles(prev => 
        prev.map(subtitle => 
          subtitle.id === selectedSubtitleId 
            ? { ...subtitle, subtitleStyle: newStyle }
            : subtitle
        )
      );
    } else {
      // Apply to all subtitles
      setEditedSubtitles(prev => 
        prev.map(subtitle => ({ ...subtitle, subtitleStyle: newStyle }))
      );
    }
    setHasChanges(true);
  }, [currentStyle, selectedSubtitleId]);

  // Apply current style to all subtitles
  const handleApplyToAll = useCallback(() => {
    logger.info('应用样式到所有字幕', {
      styleApplied: currentStyle,
      subtitleCount: editedSubtitles.length,
      timestamp: new Date().toISOString()
    });

    setEditedSubtitles(prev => 
      prev.map(subtitle => ({ ...subtitle, subtitleStyle: currentStyle }))
    );
    setHasChanges(true);
  }, [currentStyle, editedSubtitles.length]);

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
      <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">字幕编辑与样式设置</h2>
              <p className="text-sm text-gray-600 mt-1">左侧设置样式，右侧编辑内容</p>
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

        {/* Main Content - Left-Right Layout */}
        <div className="flex-1 flex overflow-hidden">
          {editedSubtitles.length === 0 ? (
            // No subtitles message
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">暂无字幕</h3>
                <p className="text-gray-500">请先在时间轴上添加字幕后再进行编辑</p>
              </div>
            </div>
          ) : (
            <>
              {/* Left Panel - Style Settings */}
              <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">样式设置</h3>
                  <p className="text-sm text-gray-600">
                    {selectedSubtitleId ? '当前编辑单个字幕' : '当前编辑所有字幕'}
                  </p>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  {/* Style Presets */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">预设样式</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {SUBTITLE_STYLE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => handlePresetSelect(preset)}
                          className="p-3 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                        >
                          <div className="text-sm font-medium text-gray-900">{preset.name}</div>
                          <div 
                            className="text-xs mt-1 px-2 py-1 rounded"
                            style={{
                              color: preset.style.fontColor,
                              backgroundColor: preset.style.backgroundColor || 'transparent',
                              fontFamily: preset.style.fontFamily === 'default' ? 'inherit' : preset.style.fontFamily,
                              fontSize: '10px'
                            }}
                          >
                            示例文字
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Family */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">字体类型</label>
                    <select
                      value={currentStyle.fontFamily}
                      onChange={(e) => handleStyleChange('fontFamily', e.target.value as SubtitleFontFamily)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {FONT_FAMILY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Font Size */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      字体大小: {currentStyle.fontSize}px
                    </label>
                    <input
                      type="range"
                      min="8"
                      max="72"
                      value={currentStyle.fontSize}
                      onChange={(e) => handleStyleChange('fontSize', parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>8px</span>
                      <span>72px</span>
                    </div>
                  </div>

                  {/* Font Color */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">字体颜色</label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="color"
                        value={currentStyle.fontColor}
                        onChange={(e) => handleStyleChange('fontColor', e.target.value)}
                        className="w-12 h-8 border border-gray-300 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={currentStyle.fontColor}
                        onChange={(e) => handleStyleChange('fontColor', e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                        placeholder="#FFFFFF"
                      />
                    </div>
                  </div>

                  {/* Background Color */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">背景颜色</label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={!!currentStyle.backgroundColor}
                        onChange={(e) => handleStyleChange('backgroundColor', e.target.checked ? '#000000' : undefined)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600">启用背景</span>
                    </div>
                    {currentStyle.backgroundColor && (
                      <div className="flex items-center space-x-3 mt-2">
                        <input
                          type="color"
                          value={currentStyle.backgroundColor}
                          onChange={(e) => handleStyleChange('backgroundColor', e.target.value)}
                          className="w-12 h-8 border border-gray-300 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={currentStyle.backgroundColor}
                          onChange={(e) => handleStyleChange('backgroundColor', e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                          placeholder="#000000"
                        />
                      </div>
                    )}
                  </div>

                  {/* Position */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">字幕位置</label>
                    <select
                      value={currentStyle.position}
                      onChange={(e) => handleStyleChange('position', e.target.value as SubtitlePosition)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-700 hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 transition-colors"
                    >
                      {POSITION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Preview */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">样式预览</label>
                    <div className="bg-black rounded-lg p-4 flex items-center justify-center min-h-[80px]">
                      <div
                        style={{
                          color: currentStyle.fontColor,
                          backgroundColor: currentStyle.backgroundColor || 'transparent',
                          fontFamily: currentStyle.fontFamily === 'default' ? 'inherit' : currentStyle.fontFamily,
                          fontSize: `${Math.max(12, currentStyle.fontSize * 0.6)}px`,
                          padding: currentStyle.backgroundColor ? '4px 8px' : '0',
                          borderRadius: currentStyle.backgroundColor ? '4px' : '0'
                        }}
                      >
                        这是字幕预览文字
                      </div>
                    </div>
                  </div>

                  {/* Apply to All Button */}
                  <div className="pt-4 border-t border-gray-200">
                    <button
                      onClick={handleApplyToAll}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      应用到所有字幕
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Panel - Content Editing */}
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">字幕内容编辑</h3>
                  <p className="text-sm text-gray-600 mt-1">点击字幕片段进行编辑</p>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="space-y-4">
                    {editedSubtitles
                      .sort((a, b) => a.startTime - b.startTime)
                      .map((subtitle, index) => (
                        <div 
                          key={subtitle.id} 
                          className={`rounded-xl p-4 border transition-colors cursor-pointer ${
                            selectedSubtitleId === subtitle.id
                              ? 'bg-blue-50 border-blue-300'
                              : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                          }`}
                          onClick={() => handleSubtitleSelect(subtitle.id)}
                        >
                          <div className="flex items-start space-x-4">
                            {/* Subtitle number */}
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                              selectedSubtitleId === subtitle.id
                                ? 'bg-blue-100 text-blue-600'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {index + 1}
                            </div>
                            
                            {/* Subtitle content */}
                            <div className="flex-1 space-y-3">
                              {/* Time info */}
                              <div className="flex items-center space-x-4 text-sm text-gray-500">
                                <div className="flex items-center space-x-1">
                                  <span className="font-medium">开始:</span>
                                  <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                                    {formatTime(subtitle.startTime)}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-1">
                                  <span className="font-medium">时长:</span>
                                  <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                                    {formatTime(subtitle.duration)}
                                  </span>
                                </div>
                              </div>
                              
                              {/* Text editor */}
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  字幕文本
                                </label>
                                <textarea
                                  value={subtitle.text || ''}
                                  onChange={(e) => handleSubtitleChange(subtitle.id, e.target.value)}
                                  placeholder="输入字幕文本..."
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-colors"
                                  rows={2}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>

                              {/* Style preview for this subtitle */}
                              {subtitle.subtitleStyle && (
                                <div className="bg-black rounded p-2 flex items-center justify-center">
                                  <div
                                    style={{
                                      color: subtitle.subtitleStyle.fontColor,
                                      backgroundColor: subtitle.subtitleStyle.backgroundColor || 'transparent',
                                      fontFamily: subtitle.subtitleStyle.fontFamily === 'default' ? 'inherit' : subtitle.subtitleStyle.fontFamily,
                                      fontSize: `${Math.max(10, subtitle.subtitleStyle.fontSize * 0.4)}px`,
                                      padding: subtitle.subtitleStyle.backgroundColor ? '2px 4px' : '0',
                                      borderRadius: subtitle.subtitleStyle.backgroundColor ? '2px' : '0'
                                    }}
                                  >
                                    {subtitle.text || '字幕预览'}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </>
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
                取消
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
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubtitleEditModal;