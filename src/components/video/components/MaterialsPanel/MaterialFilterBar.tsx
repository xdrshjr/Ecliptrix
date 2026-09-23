'use client';

/**
 * MaterialFilterBar — top of the materials page (spec §3.7.1):
 *
 *   [🔍 搜索素材（名称）      ] [⊕ 添加 ▾] [⋯]      ← `actions` slot
 *   [全部][视频][音频][图片][素材包]
 *   （素材包时）[分镜包][人物包][场景包][帧包]
 *
 * The search box keeps its own draft and reports it after a 200ms debounce;
 * Esc clears at once. Categories are plain presentational state — the panel
 * maps them back to the original `selectedMaterialType` values.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { MaterialIcon } from './materialIcons';
import {
  PACK_MATERIAL_FILTERS,
  PRIMARY_MATERIAL_FILTERS,
  type PackMaterialFilter,
  type PrimaryMaterialFilter,
} from './materialFilter';

export const SEARCH_DEBOUNCE_MS = 200;

interface MaterialFilterBarProps {
  primary: PrimaryMaterialFilter;
  pack: PackMaterialFilter;
  /** Committed (debounced) query; an external clear resets the draft too. */
  query: string;
  onPrimaryChange(primary: PrimaryMaterialFilter): void;
  onPackChange(pack: PackMaterialFilter): void;
  onQueryChange(query: string): void;
  /** Header buttons to the right of the search box. */
  actions?: React.ReactNode;
}

function useDebouncedQuery(query: string, onQueryChange: (q: string) => void) {
  const [draft, setDraft] = useState(query);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Parent cleared the search (e.g. 「清除搜索」) → mirror it in the input.
    setDraft((current) => (query === '' ? '' : current));
  }, [query]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const change = (value: string) => {
    setDraft(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onQueryChange(value), SEARCH_DEBOUNCE_MS);
  };
  const clear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setDraft('');
    onQueryChange('');
  };
  return { draft, change, clear };
}

const MaterialFilterBar: React.FC<MaterialFilterBarProps> = ({
  primary, pack, query, onPrimaryChange, onPackChange, onQueryChange, actions,
}) => {
  const { t } = useLocale();
  const m = t.workbench.materials;
  const p = t.materialsPanel;
  const { draft, change, clear } = useDebouncedQuery(query, onQueryChange);

  const primaryLabels: Record<PrimaryMaterialFilter, string> = {
    all: m.filterAll, video: m.filterVideo, audio: m.filterAudio,
    image: m.filterImage, packs: m.filterPacks,
  };
  const packLabels: Record<PackMaterialFilter, string> = {
    storyboard_pack: p.storyboardPack,
    character_pack: p.filterCharacterPack ?? p.characterPack ?? 'Character',
    scene_pack: p.filterScenePack ?? p.scenePack ?? 'Scene',
    frame_pack: p.filterFramePack ?? p.framePack ?? '帧包',
  };

  return (
    <div className="ws-materials-filters">
      <div className="ws-materials-search-row">
        <label className="ws-materials-search">
          <MaterialIcon name="search" className="ws-materials-search-icon" />
          <input
            type="search"
            className="ws-input"
            value={draft}
            placeholder={m.searchPlaceholder}
            aria-label={m.searchLabel}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || draft === '') return;
              event.preventDefault();
              event.stopPropagation();
              clear();
            }}
          />
          {draft !== '' && (
            <button
              type="button"
              className="ws-icon-btn ws-materials-search-clear"
              aria-label={m.clearSearch}
              title={m.clearSearch}
              onClick={clear}
            >
              <MaterialIcon name="close" size={14} />
            </button>
          )}
        </label>
        {actions}
      </div>
      <div className="ws-segmented ws-materials-primary" role="tablist" aria-label={m.categories}>
        {PRIMARY_MATERIAL_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            data-material-filter={value}
            aria-selected={primary === value}
            onClick={() => onPrimaryChange(value)}
          >
            {primaryLabels[value]}
          </button>
        ))}
      </div>
      {primary === 'packs' && (
        <div className="ws-materials-packs" role="radiogroup" aria-label={m.packKinds}>
          {PACK_MATERIAL_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              data-material-type={value}
              aria-checked={pack === value}
              className={`ws-chip ws-materials-pack-chip${pack === value ? ' ws-chip--primary' : ''}`}
              onClick={() => onPackChange(value)}
            >
              {packLabels[value]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MaterialFilterBar;
