'use client';

import React, { useState, useEffect } from 'react';
import { VoiceType, getVoiceTypes } from '@/lib/api/tts';
import { useLocale } from '@/contexts/LocaleContext';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceChange: (voiceId: string) => void;
  className?: string;
}

const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  selectedVoiceId,
  onVoiceChange,
  className = ''
}) => {
  // 获取国际化翻译
  const { t, locale } = useLocale();
  const [voiceTypes, setVoiceTypes] = useState<Record<string, VoiceType>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    loadVoiceTypes();
  }, [locale]);

  const loadVoiceTypes = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('[VoiceSelector] 加载音色列表');
      
      const response = await getVoiceTypes(locale);
      if (response.success) {
        setVoiceTypes(response.data);
        console.log('[VoiceSelector] 音色列表加载成功', {
          count: Object.keys(response.data).length,
          categories: Array.from(new Set(Object.values(response.data).map(v => v.category))),
          voicesByCategory: Object.values(response.data).reduce((acc, voice) => {
            acc[voice.category] = (acc[voice.category] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        });
      } else {
        throw new Error(response.message || '获取音色列表失败');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '未知错误';
      console.error('[VoiceSelector] 加载音色列表失败', { error: errorMsg });
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceSelect = (voiceId: string) => {
    console.log('[VoiceSelector] 用户选择音色', {
      previousVoice: selectedVoiceId,
      previousVoiceName: voiceTypes[selectedVoiceId]?.name,
      previousCategory: voiceTypes[selectedVoiceId]?.category,
      newVoice: voiceId,
      newVoiceName: voiceTypes[voiceId]?.name,
      newCategory: voiceTypes[voiceId]?.category,
      gender: voiceTypes[voiceId]?.gender,
      timestamp: new Date().toISOString()
    });
    
    onVoiceChange(voiceId);
    setIsOpen(false);
  };

  const selectedVoice = voiceTypes[selectedVoiceId];
  const voiceList = Object.values(voiceTypes);

  // 按分类分组音色
  const voicesByCategory = voiceList.reduce((acc, voice) => {
    const category = voice.category || '其他';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(voice);
    return acc;
  }, {} as Record<string, VoiceType[]>);

  // 获取国际化的分类名称
  const getCategoryDisplayName = (category: string): string => {
    return t.scriptPanel.voiceSelector.categories[category as keyof typeof t.scriptPanel.voiceSelector.categories] || category;
  };

  // 分类排序（确保通用场景在前）
  const categoryOrder = ['通用场景', '趣味方言', '角色扮演', '播报解说', '有声阅读'];
  const sortedCategories = Object.keys(voicesByCategory).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  // 分类对应的图标颜色
  const getCategoryColor = (category: string) => {
    const colors = {
      '通用场景': 'bg-blue-500',
      '趣味方言': 'bg-green-500',
      '角色扮演': 'bg-purple-500',
      '播报解说': 'bg-orange-500',
      '有声阅读': 'bg-indigo-500'
    };
    return colors[category as keyof typeof colors] || 'bg-muted-foreground';
  };

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="w-4 h-4 bg-accent rounded-full animate-pulse"></div>
        <span className="text-xs text-muted-foreground">{t.scriptPanel.voiceSelector.loadingVoices}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="w-4 h-4 bg-red-100 rounded-full flex items-center justify-center">
          <svg className="w-2 h-2 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="text-xs text-destructive">{t.scriptPanel.voiceSelector.loadFailed}</span>
        <button
          onClick={loadVoiceTypes}
          className="text-xs text-primary hover:text-primary underline"
        >
          {t.scriptPanel.voiceSelector.retryLoad}
        </button>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* 当前选中的音色显示 */}
      <button
        onClick={() => {
          const newIsOpen = !isOpen;
          console.log('[VoiceSelector] 音色选择面板状态变化', {
            isOpen: newIsOpen,
            currentVoice: selectedVoiceId,
            currentVoiceName: voiceTypes[selectedVoiceId]?.name,
            currentCategory: voiceTypes[selectedVoiceId]?.category,
            timestamp: new Date().toISOString()
          });
          setIsOpen(newIsOpen);
        }}
        className="flex items-center space-x-2 px-3 py-2 bg-card border border-border rounded-md hover:border-border transition-colors duration-200 w-full text-left"
      >
        <div className="flex items-center space-x-2 flex-1">
          <div className={`w-3 h-3 rounded-full ${
            selectedVoice ? getCategoryColor(selectedVoice.category) : 'bg-muted-foreground'
          }`}></div>
          <span className="text-sm font-medium text-foreground">
            {selectedVoice?.name || t.scriptPanel.voiceSelector.selectVoice}
          </span>
          {selectedVoice && (
            <span className="text-xs text-muted-foreground">
              ({getCategoryDisplayName(selectedVoice.category)})
            </span>
          )}
        </div>
        <svg 
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
            isOpen ? 'transform rotate-180' : ''
          }`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉菜单 - 按分类显示 */}
      {isOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-md z-50 max-h-80 overflow-y-auto">
          {sortedCategories.map((category, categoryIndex) => (
            <div key={category} className={`p-2 ${categoryIndex > 0 ? 'border-t border-border' : ''}`}>
              <div className="text-xs font-medium text-muted-foreground px-2 py-1 flex items-center">
                <div className={`w-3 h-3 rounded-full ${getCategoryColor(category)} mr-2`}></div>
                {getCategoryDisplayName(category)}
                <span className="ml-1 text-muted-foreground">({voicesByCategory[category].length})</span>
              </div>
              {voicesByCategory[category].map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => handleVoiceSelect(voice.id)}
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors duration-150 ${
                    selectedVoiceId === voice.id ? 'bg-primary/10 text-primary' : 'text-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{voice.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{voice.description}</div>
                    </div>
                    {selectedVoiceId === voice.id && (
                      <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))}

          {voiceList.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {t.scriptPanel.voiceSelector.noVoicesAvailable}
            </div>
          )}
        </div>
      )}

      {/* 点击外部关闭下拉菜单 */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default VoiceSelector; 