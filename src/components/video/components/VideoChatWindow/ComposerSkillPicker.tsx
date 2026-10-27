'use client';

import React, { useMemo } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { SkillSummary } from '@/types/agentSkills';
import { matchesQuery } from './composerTriggers';
import ComposerPicker, { type PickerItem } from './ComposerPicker';

/**
 * `/` 技能选择器：只列出启用且有效的技能，依赖不满足的行置灰但仍可选
 * （选择后由芯片与 `use_skill` 的 `note` 说明降级路径）。
 */

export type SkillListStatus = 'loading' | 'ready' | 'error';

export interface ComposerSkillPickerProps {
  id: string;
  query: string;
  skills: readonly SkillSummary[];
  status: SkillListStatus;
  activeIndex: number;
  /** 当前不可用的能力（`requires` 命中即置灰）。 */
  unavailable?: ReadonlySet<string>;
  onSelect: (skill: SkillSummary) => void;
  onHover: (index: number) => void;
}

/** 选择器当前可见的技能（过滤后）；父组件用同一函数做键盘导航，避免两份判定。 */
export function visibleSkills(
  skills: readonly SkillSummary[], query: string,
): SkillSummary[] {
  return skills.filter(skill => skill.enabled && skill.valid && !skill.shadowed
    && matchesQuery(query, skill.id, skill.name, skill.description));
}

const ComposerSkillPicker: React.FC<ComposerSkillPickerProps> = ({
  id, query, skills, status, activeIndex, unavailable, onSelect, onHover,
}) => {
  const { t } = useLocale();
  const copy = t.agentCollab;
  const visible = useMemo(() => visibleSkills(skills, query), [skills, query]);
  const items: PickerItem[] = visible.map((skill) => {
    const missing = skill.requires.filter(requirement => unavailable?.has(requirement));
    return {
      id: skill.id,
      primary: skill.name,
      secondary: skill.description,
      badge: skill.builtin ? copy.skillBuiltinBadge : copy.skillMineBadge,
      note: missing.length ? copy.skillNeeds.replace('{what}', missing.join(', ')) : undefined,
      dimmed: missing.length > 0,
    };
  });
  const emptyText = status === 'error' ? copy.skillLoadFailed
    : status === 'loading' ? '…'
      : skills.length === 0 ? copy.skillEmpty : copy.skillNoMatch;
  return (
    <ComposerPicker
      id={id}
      label={copy.skillPickerLabel}
      items={items}
      activeIndex={activeIndex}
      onSelect={index => onSelect(visible[index])}
      onHover={onHover}
      emptyText={emptyText}
    />
  );
};

export default ComposerSkillPicker;
