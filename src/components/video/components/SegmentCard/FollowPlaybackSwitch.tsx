'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';

/**
 * 左栏标题栏「跟随播放」开关（spec §3.5.1）。只写焦点仓库；持久化由
 * useWorkbenchLayout 负责（RV-12），这里不碰 localStorage。
 */
const FollowPlaybackSwitch: React.FC = () => {
  const { t } = useLocale();
  const followPlayback = useEditorFocusStore((state) => state.followPlayback);
  const setFollowPlayback = useEditorFocusStore((state) => state.setFollowPlayback);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={followPlayback}
      className="ws-switch"
      onClick={() => setFollowPlayback(!followPlayback)}
    >
      <span className="ws-switch-track" aria-hidden="true" />
      <span>{t.workbench.script.followPlayback}</span>
    </button>
  );
};

export default FollowPlaybackSwitch;
