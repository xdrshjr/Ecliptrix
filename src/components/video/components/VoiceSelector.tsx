'use client';

import React, { useState, useEffect, useId, useMemo } from 'react';
import { VoiceType, getVoiceTypes } from '@/lib/api/tts';
import { useLocale } from '@/contexts/LocaleContext';
import { VideoEditingLogger } from '../utils/logger';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceChange: (voiceId: string) => void;
  className?: string;
}

type GenderFilter = 'all' | 'male' | 'female';

const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  selectedVoiceId,
  onVoiceChange,
  className = ''
}) => {
  const { t, locale } = useLocale();
  const [voiceTypes, setVoiceTypes] = useState<Record<string, VoiceType>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');

  const listboxId = useId();

  const logger = useMemo(
    () => new VideoEditingLogger({ taskId: 'global', component: 'VoiceSelector' }),
    [],
  );

  useEffect(() => {
    loadVoiceTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // iter5: Escape closes the dropdown for keyboard users.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const loadVoiceTypes = async () => {
    try {
      setIsLoading(true);
      setError(null);

      logger.debug('加载音色列表');

      const response = await getVoiceTypes(locale);
      if (response.success) {
        setVoiceTypes(response.data);
        logger.debug('音色列表加载成功', {
          count: Object.keys(response.data).length,
          categories: Array.from(new Set(Object.values(response.data).map(v => v.category))),
        });
      } else {
        throw new Error(response.message || '获取音色列表失败');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '未知错误';
      logger.error('加载音色列表失败', err instanceof Error ? err : new Error(errorMsg), { error: errorMsg });
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceSelect = (voiceId: string) => {
    logger.debug('用户选择音色', {
      previousVoice: selectedVoiceId,
      newVoice: voiceId,
      newVoiceName: voiceTypes[voiceId]?.name,
      timestamp: new Date().toISOString(),
    });

    onVoiceChange(voiceId);
    setIsOpen(false);
  };

  const selectedVoice = voiceTypes[selectedVoiceId];
  const voiceList = useMemo(() => Object.values(voiceTypes), [voiceTypes]);

  // iter5: search + gender filter
  const filteredVoices = useMemo(() => {
    const kw = searchTerm.trim().toLowerCase();
    return voiceList.filter(v => {
      const matchKw = !kw
        || v.name.toLowerCase().includes(kw)
        || (v.description ?? '').toLowerCase().includes(kw)
        || (v.category ?? '').toLowerCase().includes(kw);
      const matchGender =
        genderFilter === 'all' ||
        (v.gender ?? '').toLowerCase() === genderFilter;
      return matchKw && matchGender;
    });
  }, [voiceList, searchTerm, genderFilter]);

  const voicesByCategory = useMemo(() =>
    filteredVoices.reduce((acc, voice) => {
      const category = voice.category || '其他';
      (acc[category] ??= []).push(voice);
      return acc;
    }, {} as Record<string, VoiceType[]>),
  [filteredVoices]);

  const getCategoryDisplayName = (category: string): string => {
    return t.scriptPanel.voiceSelector.categories[category as keyof typeof t.scriptPanel.voiceSelector.categories] || category;
  };

  const categoryOrder = ['通用场景', '趣味方言', '角色扮演', '播报解说', '有声阅读'];
  const sortedCategories = Object.keys(voicesByCategory).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  const getCategoryColor = (category: string) => {
    const colors = {
      '通用场景': 'bg-blue-500',
      '趣味方言': 'bg-chart-2',
      '角色扮演': 'bg-chart-3',
      '播报解说': 'bg-chart-4',
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

  const totalVisible = filteredVoices.length;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center space-x-2 px-3 py-2 bg-card border border-border rounded-md hover:border-border transition-colors w-full text-left"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
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
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t.scriptPanel.voiceSelector.voiceType}
          className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-md z-50 max-h-80 overflow-y-auto"
        >
          {/* iter5: search + gender filter */}
          <div
            className="sticky top-0 bg-card border-b border-border p-2 flex flex-col gap-2"
            // Filter UI is not part of the listbox semantics
            role="presentation"
          >
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t.scriptPanel.voiceSelector.searchPlaceholder}
              aria-label={t.scriptPanel.voiceSelector.searchPlaceholder}
              className="w-full border border-border rounded px-2 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
            <div className="flex gap-1" role="radiogroup" aria-label={t.scriptPanel.voiceSelector.voiceType}>
              {([
                ['all', t.scriptPanel.voiceSelector.genderAll],
                ['male', t.scriptPanel.voiceSelector.genderMale],
                ['female', t.scriptPanel.voiceSelector.genderFemale],
              ] as Array<[GenderFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={genderFilter === value}
                  onClick={() => setGenderFilter(value)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    genderFilter === value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {totalVisible === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {voiceList.length === 0
                ? t.scriptPanel.voiceSelector.noVoicesAvailable
                : t.scriptPanel.voiceSelector.noVoicesMatched}
            </div>
          )}

          {sortedCategories.map((category, categoryIndex) => (
            <div key={category} role="group" aria-label={getCategoryDisplayName(category)} className={`p-2 ${categoryIndex > 0 ? 'border-t border-border' : ''}`}>
              <div className="text-xs font-medium text-muted-foreground px-2 py-1 flex items-center">
                <div className={`w-3 h-3 rounded-full ${getCategoryColor(category)} mr-2`} aria-hidden="true"></div>
                {getCategoryDisplayName(category)}
                <span className="ml-1 text-muted-foreground">({voicesByCategory[category].length})</span>
              </div>
              {voicesByCategory[category].map((voice) => (
                <button
                  key={voice.id}
                  role="option"
                  aria-selected={selectedVoiceId === voice.id}
                  onClick={() => handleVoiceSelect(voice.id)}
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors ${
                    selectedVoiceId === voice.id ? 'bg-primary/10 text-primary' : 'text-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{voice.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{voice.description}</div>
                    </div>
                    {selectedVoiceId === voice.id && (
                      <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default VoiceSelector;
