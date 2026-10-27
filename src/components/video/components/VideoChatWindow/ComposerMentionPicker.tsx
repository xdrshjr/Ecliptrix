'use client';

import React, { useMemo } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { MaterialItem } from '@/types';
import { matchesQuery } from './composerTriggers';
import ComposerPicker, { type PickerItem } from './ComposerPicker';

/** `@` 素材引用选择器：名称 + 类型 + 时长/尺寸，最多可见 8 条。 */

const MAX_VISIBLE = 8;

export interface ComposerMentionPickerProps {
  id: string;
  query: string;
  materials: readonly MaterialItem[];
  activeIndex: number;
  onSelect: (material: MaterialItem) => void;
  onHover: (index: number) => void;
}

/** 过滤后可见的素材；父组件用同一函数做键盘导航。 */
export function visibleMaterials(
  materials: readonly MaterialItem[], query: string,
): MaterialItem[] {
  return materials.filter(material => matchesQuery(query, material.name))
    .slice(0, MAX_VISIBLE);
}

function describeMaterial(material: MaterialItem): string {
  const parts: string[] = [material.type];
  if (material.duration) parts.push(`${material.duration.toFixed(1)}s`);
  if (material.width && material.height) parts.push(`${material.width}×${material.height}`);
  return parts.join(' · ');
}

const ComposerMentionPicker: React.FC<ComposerMentionPickerProps> = ({
  id, query, materials, activeIndex, onSelect, onHover,
}) => {
  const { t } = useLocale();
  const visible = useMemo(() => visibleMaterials(materials, query), [materials, query]);
  const items: PickerItem[] = visible.map(material => ({
    id: material.id, primary: material.name, secondary: describeMaterial(material),
  }));
  return (
    <ComposerPicker
      id={id}
      label={t.agentCollab.mentionPickerLabel}
      items={items}
      activeIndex={activeIndex}
      onSelect={index => onSelect(visible[index])}
      onHover={onHover}
      emptyText={t.agentCollab.mentionEmpty}
    />
  );
};

export default ComposerMentionPicker;
