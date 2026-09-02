'use client';

import React, { useState, useMemo } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

export interface VoiceItem {
  value: string;
  label: string;
  category: string;
  gender: 'male' | 'female';
  language: string;
  description: string;
}

interface VoiceListEditorProps {
  voices: VoiceItem[];
  onChange: (voices: VoiceItem[]) => void;
}

const CATEGORIES = [
  '通用场景',
  '趣味方言',
  '角色扮演',
  '播报解说',
  '有声阅读',
];

const GENDERS: Array<'male' | 'female'> = ['male', 'female'];

const LANGUAGES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'zh-TW'];

const emptyVoice: VoiceItem = {
  value: '',
  label: '',
  category: '通用场景',
  gender: 'male',
  language: 'zh-CN',
  description: '',
};

const VoiceListEditor: React.FC<VoiceListEditorProps> = ({ voices, onChange }) => {
  const { t } = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterGender, setFilterGender] = useState<string>('all');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [editingVoice, setEditingVoice] = useState<VoiceItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // Filter voices
  const filteredVoices = useMemo(() => {
    return voices.filter((voice) => {
      const matchesSearch =
        !searchQuery ||
        voice.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        voice.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
        voice.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = filterCategory === 'all' || voice.category === filterCategory;
      const matchesGender = filterGender === 'all' || voice.gender === filterGender;
      return matchesSearch && matchesCategory && matchesGender;
    });
  }, [voices, searchQuery, filterCategory, filterGender]);

  // Group by category
  const groupedVoices = useMemo(() => {
    const groups: Record<string, { voice: VoiceItem; originalIndex: number }[]> = {};
    filteredVoices.forEach((voice) => {
      const cat = voice.category || '通用场景';
      if (!groups[cat]) groups[cat] = [];
      const originalIndex = voices.indexOf(voice);
      groups[cat].push({ voice, originalIndex });
    });
    return groups;
  }, [filteredVoices, voices]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleDelete = (index: number) => {
    const updated = [...voices];
    updated.splice(index, 1);
    onChange(updated);
  };

  const handleEdit = (voice: VoiceItem, index: number) => {
    setEditingVoice({ ...voice });
    setEditingIndex(index);
    setIsAddingNew(false);
  };

  const handleAdd = () => {
    setEditingVoice({ ...emptyVoice });
    setEditingIndex(null);
    setIsAddingNew(true);
  };

  const handleSaveEdit = () => {
    if (!editingVoice) return;
    if (!editingVoice.value.trim() || !editingVoice.label.trim()) return;

    const updated = [...voices];
    if (isAddingNew) {
      updated.push(editingVoice);
    } else if (editingIndex !== null) {
      updated[editingIndex] = editingVoice;
    }
    onChange(updated);
    setEditingVoice(null);
    setEditingIndex(null);
    setIsAddingNew(false);
  };

  const handleCancelEdit = () => {
    setEditingVoice(null);
    setEditingIndex(null);
    setIsAddingNew(false);
  };

  const categoryLabel = (cat: string): string => {
    // Voice categories from YAML/DB are already Chinese strings.
    // The i18n labels provide the English equivalents for non-Chinese locales.
    const labels: Record<string, string> = {
      '通用场景': t.adminSettings.voiceCatGeneral,
      '趣味方言': t.adminSettings.voiceCatDialect,
      '角色扮演': t.adminSettings.voiceCatRoleplay,
      '播报解说': t.adminSettings.voiceCatNarration,
      '有声阅读': t.adminSettings.voiceCatAudiobook,
    };
    return labels[cat] || cat;
  };

  return (
    <div className="space-y-3">
      {/* Search and filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.adminSettings.voiceSearch}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">{t.adminSettings.voiceAllCategories}</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{categoryLabel(cat)}</option>
          ))}
        </select>
        <select
          value={filterGender}
          onChange={(e) => setFilterGender(e.target.value)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">{t.adminSettings.voiceAllGenders}</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>{g === 'male' ? t.adminSettings.voiceMale : t.adminSettings.voiceFemale}</option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + {t.adminSettings.voiceAdd}
        </button>
      </div>

      {/* Voices count */}
      <div className="text-xs text-muted-foreground">
        {t.adminSettings.voiceTotal}: {filteredVoices.length} / {voices.length}
      </div>

      {/* Edit / Add form */}
      {editingVoice && (
        <div className="bg-accent/50 border border-border rounded-md p-4 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            {isAddingNew ? t.adminSettings.voiceAdd : t.adminSettings.voiceEdit}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t.adminSettings.voiceValue}</label>
              <input
                type="text"
                value={editingVoice.value}
                onChange={(e) => setEditingVoice({ ...editingVoice, value: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="e.g. zh_female_shuangkuai"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t.adminSettings.voiceLabel}</label>
              <input
                type="text"
                value={editingVoice.label}
                onChange={(e) => setEditingVoice({ ...editingVoice, label: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t.adminSettings.voiceCategory}</label>
              <select
                value={editingVoice.category}
                onChange={(e) => setEditingVoice({ ...editingVoice, category: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{categoryLabel(cat)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t.adminSettings.voiceGender}</label>
              <select
                value={editingVoice.gender}
                onChange={(e) => setEditingVoice({ ...editingVoice, gender: e.target.value as 'male' | 'female' })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{g === 'male' ? t.adminSettings.voiceMale : t.adminSettings.voiceFemale}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t.adminSettings.voiceLanguage}</label>
              <select
                value={editingVoice.language}
                onChange={(e) => setEditingVoice({ ...editingVoice, language: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t.adminSettings.voiceDescription}</label>
              <input
                type="text"
                value={editingVoice.description}
                onChange={(e) => setEditingVoice({ ...editingVoice, description: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveEdit}
              disabled={!editingVoice.value.trim() || !editingVoice.label.trim()}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {t.adminSettings.save}
            </button>
            <button
              onClick={handleCancelEdit}
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              {t.adminSettings.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Grouped voice list */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {Object.keys(groupedVoices).sort().map((cat) => (
          <div key={cat} className="border border-border rounded-md overflow-hidden">
            <button
              onClick={() => toggleCategory(cat)}
              className="w-full flex items-center justify-between px-4 py-2 bg-accent/30 hover:bg-accent/50 transition-colors"
            >
              <span className="text-sm font-medium text-foreground">
                {categoryLabel(cat)} ({groupedVoices[cat].length})
              </span>
              <svg
                className={`w-4 h-4 text-muted-foreground transition-transform ${
                  collapsedCategories.has(cat) ? '' : 'rotate-180'
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {!collapsedCategories.has(cat) && (
              <div className="divide-y divide-border">
                {groupedVoices[cat].map(({ voice, originalIndex }) => (
                  <div
                    key={`${voice.value}-${originalIndex}`}
                    className="flex items-center justify-between px-4 py-2 hover:bg-accent/20 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{voice.label}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          voice.gender === 'male'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                        }`}>
                          {voice.gender === 'male' ? t.adminSettings.voiceMale : t.adminSettings.voiceFemale}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{voice.language}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {voice.value} {voice.description ? `- ${voice.description}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      <button
                        onClick={() => handleEdit(voice, originalIndex)}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        title={t.adminSettings.voiceEdit}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(originalIndex)}
                        className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                        title={t.adminSettings.voiceDelete}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {Object.keys(groupedVoices).length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">
            {t.adminSettings.voiceNoResults}
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceListEditor;
