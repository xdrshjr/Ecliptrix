'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { TimelineItem, SubtitleStyle, SubtitleStylePreset, SubtitleFontFamily, SubtitlePosition } from '@/types';
import { VideoEditingLogger } from '../../utils';
import { SupportedLocale } from '@/lib/i18n';
import { useLocale } from '@/contexts/LocaleContext';

interface SubtitleEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (subtitles: TimelineItem[]) => void;
  subtitles: TimelineItem[];
  taskId: string;
  locale?: SupportedLocale; // 保持向后兼容性，但context优先
}

// Predefined subtitle style presets
const SUBTITLE_STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'default',
    name: '默认样式',
    style: {
      fontFamily: 'default',
      fontSize: 60,
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
      fontSize: 60,
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
      fontSize: 60,
      fontColor: '#FFFFFF',
      position: 'bottom'
    }
  },
  {
    id: 'elegant',
    name: '优雅样式',
    style: {
      fontFamily: 'serif',
      fontSize: 60,
      fontColor: '#F0F0F0',
      backgroundColor: '#1A1A1A',
      position: 'bottom'
    }
  },
  {
    id: 'tech',
    name: '科技样式',
    style: {
      fontFamily: 'monospace',
      fontSize: 60,
      fontColor: '#00FF00',
      backgroundColor: '#000000',
      position: 'bottom'
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
  locale // 保持向后兼容性，但不再使用
}) => {
  const [editedSubtitles, setEditedSubtitles] = useState<TimelineItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [currentStyle, setCurrentStyle] = useState<SubtitleStyle>(SUBTITLE_STYLE_PRESETS[0].style);
  
  // 使用 ref 跟踪模态框初始化状态和上次的字幕ID列表
  const isInitializedRef = useRef(false);
  const lastSubtitleIdsRef = useRef<string[]>([]);
  const preservedStyleRef = useRef<SubtitleStyle | null>(null);

  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'SubtitleEditModal'
  }), [taskId]);

  const { t } = useLocale();

  // 处理模态框打开和关闭
  useEffect(() => {
    if (isOpen && !isInitializedRef.current) {
      // 模态框首次打开时的初始化
      logger.info('字幕编辑模态框首次打开', {
        subtitleCount: subtitles.length,
        subtitleIds: subtitles.map(s => s.id),
        defaultStyle: SUBTITLE_STYLE_PRESETS[0].style,
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
      
      // 记录字幕ID列表和初始化状态
      lastSubtitleIdsRef.current = subtitles.map(s => s.id);
      isInitializedRef.current = true;
      
    } else if (!isOpen && isInitializedRef.current) {
      // 模态框关闭时重置状态
      logger.info('字幕编辑模态框关闭，重置状态', {
        timestamp: new Date().toISOString()
      });
      
      isInitializedRef.current = false;
      lastSubtitleIdsRef.current = [];
      preservedStyleRef.current = null;
    }
  }, [isOpen]);

  // 处理字幕内容变化（仅在模态框已初始化时）
  useEffect(() => {
    if (!isOpen || !isInitializedRef.current) return;
    
    const currentSubtitleIds = subtitles.map(s => s.id);
    const lastSubtitleIds = lastSubtitleIdsRef.current;
    
    // 检查字幕ID是否发生了实质性变化
    const idsChanged = currentSubtitleIds.length !== lastSubtitleIds.length || 
                       currentSubtitleIds.some((id, index) => id !== lastSubtitleIds[index]);
    
    if (idsChanged) {
      logger.info('字幕内容发生变化，更新编辑状态', {
        oldIds: lastSubtitleIds,
        newIds: currentSubtitleIds,
        preservedStyle: preservedStyleRef.current,
        timestamp: new Date().toISOString()
      });
      
      // 保存当前样式以便在更新后恢复
      preservedStyleRef.current = currentStyle;
      
      // 更新字幕内容，保持已有的样式设置
      const updatedSubtitles = subtitles.map(subtitle => ({
        ...subtitle,
        subtitleStyle: subtitle.subtitleStyle || preservedStyleRef.current || SUBTITLE_STYLE_PRESETS[0].style
      }));
      
      setEditedSubtitles(updatedSubtitles);
      
      // 尝试保持当前选中的字幕，如果不存在则选择第一个
      if (selectedSubtitleId && currentSubtitleIds.includes(selectedSubtitleId)) {
        const selectedSubtitle = updatedSubtitles.find(s => s.id === selectedSubtitleId);
        if (selectedSubtitle?.subtitleStyle) {
          setCurrentStyle(selectedSubtitle.subtitleStyle);
        }
      } else if (updatedSubtitles.length > 0) {
        setSelectedSubtitleId(updatedSubtitles[0].id);
        setCurrentStyle(updatedSubtitles[0].subtitleStyle || preservedStyleRef.current || SUBTITLE_STYLE_PRESETS[0].style);
      }
      
      // 更新记录的ID列表
      lastSubtitleIdsRef.current = currentSubtitleIds;
    }
  }, [subtitles, isOpen, selectedSubtitleId, currentStyle]);

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
  }, [logger]);

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
  }, [editedSubtitles, hasChanges, onSave, onClose, logger]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    logger.info('取消字幕编辑', {
      hasChanges,
      timestamp: new Date().toISOString()
    });

    onClose();
  }, [hasChanges, onClose, logger]);

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
      previousStyle: currentStyle,
      newStyle: preset.style,
      timestamp: new Date().toISOString()
    });

    // 保存样式到 ref 以便在更新时保持
    preservedStyleRef.current = preset.style;
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
  }, [selectedSubtitleId, logger]);

  // Handle individual style property changes
  const handleStyleChange = useCallback((property: keyof SubtitleStyle, value: any) => {
    const newStyle = { ...currentStyle, [property]: value };
    
    logger.info('字幕样式属性修改', {
      property,
      oldValue: currentStyle[property],
      newValue: value,
      selectedSubtitleId,
      previousStyle: currentStyle,
      newStyle: newStyle,
      timestamp: new Date().toISOString()
    });

    // 保存样式到 ref 以便在更新时保持
    preservedStyleRef.current = newStyle;
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
  }, [currentStyle, selectedSubtitleId, logger]);

  // Apply current style to all subtitles
  const handleApplyToAll = useCallback(() => {
    logger.info('应用样式到所有字幕', {
      styleApplied: currentStyle,
      subtitleCount: editedSubtitles.length,
      buttonLocation: 'fixed-bottom-panel',
      timestamp: new Date().toISOString()
    });

    setEditedSubtitles(prev => 
      prev.map(subtitle => ({ ...subtitle, subtitleStyle: currentStyle }))
    );
    setHasChanges(true);
  }, [currentStyle, editedSubtitles.length, logger]);

  // Format time display
  const formatTime = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }, []);

  if (!isOpen) return null;

  return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
      <div className="bg-card rounded-md border border-border max-w-7xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-muted px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">字幕编辑与样式设置</h2>
              <p className="text-sm text-muted-foreground mt-1">左侧设置样式，右侧编辑内容</p>
            </div>
            <button
              onClick={handleCancel}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
              aria-label="关闭"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <svg className="w-16 h-16 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
                <h3 className="text-lg font-medium text-foreground mb-2">暂无字幕</h3>
                <p className="text-muted-foreground">请先在时间轴上添加字幕后再进行编辑</p>
              </div>
            </div>
          ) : (
            <>
              {/* Left Panel - Style Settings */}
              <div className="w-80 bg-muted border-r border-border flex flex-col">
                <div className="p-4 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground mb-2">样式设置</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedSubtitleId ? '当前编辑单个字幕' : '当前编辑所有字幕'}
                  </p>
                </div>
                
                {/* Scrollable content area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  {/* Style Presets */}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-3">预设样式</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {SUBTITLE_STYLE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => handlePresetSelect(preset)}
                          className="p-3 text-left border border-border rounded-md hover:border-primary/30 hover:bg-primary/10 transition-colors"
                        >
                          <div className="text-sm font-medium text-foreground">{preset.name}</div>
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
                    <label className="block text-sm font-semibold text-foreground mb-2">字体类型</label>
                    <select
                      value={currentStyle.fontFamily}
                      onChange={(e) => handleStyleChange('fontFamily', e.target.value as SubtitleFontFamily)}
                      className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary"
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
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      字体大小: {currentStyle.fontSize}px
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="120"
                      value={currentStyle.fontSize}
                      onChange={(e) => handleStyleChange('fontSize', parseInt(e.target.value))}
                      className="w-full h-2 bg-accent rounded-md appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>10px</span>
                      <span>120px</span>
                    </div>
                  </div>

                  {/* Font Color */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">字体颜色</label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="color"
                        value={currentStyle.fontColor}
                        onChange={(e) => handleStyleChange('fontColor', e.target.value)}
                        className="w-12 h-8 border border-border rounded-md cursor-pointer"
                      />
                      <input
                        type="text"
                        value={currentStyle.fontColor}
                        onChange={(e) => handleStyleChange('fontColor', e.target.value)}
                        className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary font-mono text-sm"
                        placeholder="#FFFFFF"
                      />
                    </div>
                  </div>

                  {/* Background Color */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">背景颜色</label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={!!currentStyle.backgroundColor}
                        onChange={(e) => handleStyleChange('backgroundColor', e.target.checked ? '#000000' : undefined)}
                        className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
                      />
                      <span className="text-sm text-muted-foreground">启用背景</span>
                    </div>
                    {currentStyle.backgroundColor && (
                      <div className="flex items-center space-x-3 mt-2">
                        <input
                          type="color"
                          value={currentStyle.backgroundColor}
                          onChange={(e) => handleStyleChange('backgroundColor', e.target.value)}
                          className="w-12 h-8 border border-border rounded-md cursor-pointer"
                        />
                        <input
                          type="text"
                          value={currentStyle.backgroundColor}
                          onChange={(e) => handleStyleChange('backgroundColor', e.target.value)}
                          className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary font-mono text-sm"
                          placeholder="#000000"
                        />
                      </div>
                    )}
                  </div>

                  {/* Position */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-2">字幕位置</label>
                    <select
                      value={currentStyle.position}
                      onChange={(e) => handleStyleChange('position', e.target.value as SubtitlePosition)}
                      className="w-full px-3 py-2 text-sm border border-border rounded-md bg-card text-foreground hover:border-border focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
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
                    <label className="block text-sm font-semibold text-foreground mb-2">样式预览</label>
                    <div className="bg-black rounded-md p-4 flex items-center justify-center min-h-[80px]">
                      <div
                        style={{
                          color: currentStyle.fontColor,
                          backgroundColor: currentStyle.backgroundColor || 'transparent',
                          fontFamily: currentStyle.fontFamily === 'default' ? 'inherit' : currentStyle.fontFamily,
                          fontSize: `${Math.max(12, Math.min(36, currentStyle.fontSize * 0.4))}px`,
                          padding: currentStyle.backgroundColor ? '4px 8px' : '0',
                          borderRadius: currentStyle.backgroundColor ? '4px' : '0'
                        }}
                      >
                        这是字幕预览文字
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fixed Apply to All Button at bottom */}
                <div className="p-4 border-t border-border bg-muted flex-shrink-0">
                  <button
                    onClick={handleApplyToAll}
                    className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
                  >
                    应用到所有字幕
                  </button>
                </div>
              </div>

              {/* Right Panel - Content Editing */}
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground">字幕内容编辑</h3>
                  <p className="text-sm text-muted-foreground mt-1">点击字幕片段进行编辑</p>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="space-y-4">
                    {editedSubtitles
                      .sort((a, b) => a.startTime - b.startTime)
                      .map((subtitle, index) => (
                        <div 
                          key={subtitle.id} 
                          className={`rounded-md p-4 border transition-colors cursor-pointer ${
                            selectedSubtitleId === subtitle.id
                              ? 'bg-primary/10 border-primary/30'
                              : 'bg-muted border-border hover:border-border'
                          }`}
                          onClick={() => handleSubtitleSelect(subtitle.id)}
                        >
                          <div className="flex items-start space-x-4">
                            {/* Subtitle number */}
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                              selectedSubtitleId === subtitle.id
                                ? 'bg-primary/10 text-primary'
                                : 'bg-muted text-muted-foreground'
                            }`}>
                              {index + 1}
                            </div>
                            
                            {/* Subtitle content */}
                            <div className="flex-1 space-y-3">
                              {/* Time info */}
                              <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                                <div className="flex items-center space-x-1">
                                  <span className="font-medium">开始:</span>
                                  <span className="font-mono bg-muted px-2 py-1 rounded-md">
                                    {formatTime(subtitle.startTime)}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-1">
                                  <span className="font-medium">时长:</span>
                                  <span className="font-mono bg-muted px-2 py-1 rounded-md">
                                    {formatTime(subtitle.duration)}
                                  </span>
                                </div>
                              </div>
                              
                              {/* Text editor */}
                              <div>
                                <label className="block text-sm font-medium text-foreground mb-2">
                                  字幕文本
                                </label>
                                <textarea
                                  value={subtitle.text || ''}
                                  onChange={(e) => handleSubtitleChange(subtitle.id, e.target.value)}
                                  placeholder="输入字幕文本..."
                                  className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary resize-none transition-colors text-foreground"
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
                                      fontSize: `${Math.max(10, Math.min(24, subtitle.subtitleStyle.fontSize * 0.3))}px`,
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
        <div className="bg-muted px-6 py-4 border-t border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {editedSubtitles.length > 0 && (
                <span>共 {editedSubtitles.length} 个字幕片段</span>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  hasChanges
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted-foreground/30 text-muted-foreground cursor-not-allowed'
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