'use client';

/**
 * AgentAutonomySection — 设置中心「自动化与交互」小节
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.9.5 / 评审 P1-3）。
 *
 * 为什么走 `autonomyStore` 而不是宿主面板的批量保存：设置中心与剪辑台工具栏
 * 写的是同一个键，只有共用同一个模块级快照，"改一边另一边立刻同步"才成立
 * （AC-C9）。因此本小节**即时保存**（只发改动键 `{settings:{yolo_mode}}`），
 * 失败时 store 自动回滚并把错误交给这里提示。
 *
 * 独立成文件是为了守住宿主 `AgentToolkitSettingsPanel.tsx` 的 818 行基线
 * （净增必须为 0，AC-E3）——先例是上一轮抽出的 `AgentCrewMemorySections.tsx`。
 *
 * @module settings/components/AgentAutonomySection
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { SwitchField } from './SettingsFieldHelpers';
import { useAgentYoloMode } from '@/components/video/hooks/useAgentYoloMode';
import SettingsSectionCard from './SettingsSectionCard';

export default function AgentAutonomySection() {
  const { t } = useLocale();
  const copy = t.agentSettings.autonomy;
  const [failed, setFailed] = React.useState(false);
  const { yolo, yoloReady, yoloSaving, toggleYolo } = useAgentYoloMode({
    onSaveFailed: () => setFailed(true),
  });

  return (
    <SettingsSectionCard title={copy.title} description={copy.description}>
      <SwitchField
        label={copy.title}
        checked={yolo}
        onChange={(next) => {
          if (!yoloReady || yoloSaving) return;
          setFailed(false);
          void toggleYolo(next);
        }}
      />
      {!yoloReady || yoloSaving ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t.videoChatWindow.yoloTitleLoading}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          {copy.saveFailed}
        </p>
      ) : null}
    </SettingsSectionCard>
  );
}
