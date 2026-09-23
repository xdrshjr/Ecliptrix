'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mic } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import VoiceSelector from '../VoiceSelector';

interface DefaultVoiceBarProps {
  selectedVoiceId: string;
  onVoiceChange(voiceId: string): void;
  /** TTS in progress: the voice cannot change (same rule as before the move). */
  disabled: boolean;
}

interface PopoverPosition {
  left: number;
  bottom: number;
  width: number;
}

const POPOVER_WIDTH = 360;
const VIEWPORT_MARGIN = 8;

/**
 * 左栏底栏「全片默认音色：{名称}　[更换]」（spec §3.5.1）。
 *
 * 原 VoiceSelector 始终挂载（在隐藏的 Popover 里），因此音色列表的加载时机与
 * 以前一致，底栏也能在打开 Popover 之前显示当前音色名。Popover 用 fixed 定位，
 * 避免被 `.ws-region` 的 overflow 裁剪。
 */
const DefaultVoiceBar: React.FC<DefaultVoiceBarProps> = ({ selectedVoiceId, onVoiceChange, disabled }) => {
  const { t } = useLocale();
  const copy = t.workbench.script;
  const barRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [voiceMeta, setVoiceMeta] = useState<{ id: string; name: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = rect.left + VIEWPORT_MARGIN;
    setPosition({
      left,
      bottom: window.innerHeight - rect.top + 4,
      width: Math.min(POPOVER_WIDTH, window.innerWidth - left - VIEWPORT_MARGIN),
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, close]);

  // A name reported for an earlier voice must not label an unresolved new id.
  const voiceName = voiceMeta?.id === selectedVoiceId ? voiceMeta.name : null;

  const handleVoiceChange = (voiceId: string) => {
    onVoiceChange(voiceId);
    close(true);
  };

  return (
    <div ref={barRef} className="script-voice-bar">
      <Mic size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span className="script-voice-bar__label">
        {copy.defaultVoice}：<span className="script-voice-bar__name">{voiceName ?? copy.defaultVoiceUnset}</span>
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="ws-btn ws-btn--ghost ws-btn--sm"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        disabled={disabled}
        title={disabled ? copy.changeVoiceDisabled : copy.changeVoice}
        onClick={() => (isOpen ? close(false) : setIsOpen(true))}
      >
        {copy.changeVoice}
      </button>
      <div
        ref={popoverRef}
        role="dialog"
        aria-label={copy.defaultVoice}
        hidden={!isOpen}
        className="script-voice-popover"
        style={position ? { left: position.left, bottom: position.bottom, width: position.width } : undefined}
      >
        <VoiceSelector
          selectedVoiceId={selectedVoiceId}
          onVoiceChange={handleVoiceChange}
          onVoiceMetaChange={setVoiceMeta}
        />
      </div>
    </div>
  );
};

export default DefaultVoiceBar;
