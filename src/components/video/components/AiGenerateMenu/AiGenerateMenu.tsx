'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from '../SegmentCard/icons';
import { useLocale } from '@/contexts/LocaleContext';

interface AiGenerateMenuProps {
  onSelectNarrationDirect: () => void;
  onSelectVideoUnderstanding: () => void;
  disabled?: boolean;
  /** 复用原 isGenerating 在触发按钮上显示 spinner。 */
  isBusy?: boolean;
  /** 触发按钮文案，默认取 t.workbench.script.generateDraft（「生成初稿」，spec §3.5.1）。 */
  label?: string;
  /** 选中「统一转换所有语音」时调用；传入则在菜单尾部追加该项。 */
  onConvertAllSpeech?: () => void;
  /** 无片段时禁用「统一转换所有语音」项。 */
  convertAllSpeechDisabled?: boolean;
  /** 批量转换进行中：该项显示 spinner 并禁用。 */
  isConvertingAllSpeech?: boolean;
  /** 「批量补齐缺失内容…」：先显示作用范围再生成（spec R2 §3.12）；传入才显示。 */
  onBatchFill?: () => void;
}

interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
}

interface AiGenerateMenuItem {
  key: string;
  title: string;
  desc: string;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
}

/**
 * 「AI 生成」触发按钮 + 向下弹出的双入口下拉菜单。
 *
 * 菜单基于触发按钮 getBoundingClientRect 以 fixed/portal 渲染到 body 层
 * （spec 决议 R5：tab 内容区存在 overflow-hidden 祖先，纯 absolute 会被裁剪）。
 * 键盘可达：↑/↓ 移动、Enter 触发、Esc 关闭并还焦；外部点击 / 失焦关闭。
 */
export const AiGenerateMenu: React.FC<AiGenerateMenuProps> = ({
  onSelectNarrationDirect,
  onSelectVideoUnderstanding,
  disabled = false,
  isBusy = false,
  label,
  onConvertAllSpeech,
  convertAllSpeechDisabled = false,
  isConvertingAllSpeech = false,
  onBatchFill,
}) => {
  const { t } = useLocale();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const buttonLabel = label ?? t.workbench.script.generateDraft;

  const items: AiGenerateMenuItem[] = [
    {
      key: 'narration-direct',
      title: t.narrationDirectScript.modeNarrationDirect,
      desc: t.narrationDirectScript.modeNarrationDirectDesc,
      onSelect: onSelectNarrationDirect,
    },
    {
      key: 'video-understanding',
      title: t.narrationDirectScript.modeVideoUnderstanding,
      desc: t.narrationDirectScript.modeVideoUnderstandingDesc,
      onSelect: onSelectVideoUnderstanding,
    },
    ...(onConvertAllSpeech
      ? [
          {
            key: 'convert-all-speech',
            title: t.scriptPanel.actions.convertAllSpeech,
            desc: t.scriptPanel.actions.convertAllSpeechDesc,
            onSelect: onConvertAllSpeech,
            disabled: convertAllSpeechDisabled,
            busy: isConvertingAllSpeech,
          },
        ]
      : []),
    ...(onBatchFill
      ? [
          {
            key: 'batch-fill',
            title: t.workbench.segmentCommands.batchFill,
            desc: t.workbench.segmentCommands.batchFillDesc,
            onSelect: onBatchFill,
            disabled: convertAllSpeechDisabled,
            busy: isConvertingAllSpeech,
          },
        ]
      : []),
  ];

  const computePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
  }, []);

  const closeMenu = useCallback((returnFocus = false) => {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    computePosition();
    setActiveIndex(0);
    setIsOpen(true);
  }, [disabled, computePosition]);

  const toggleOpen = useCallback(() => {
    if (isOpen) closeMenu();
    else openMenu();
  }, [isOpen, closeMenu, openMenu]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      // 禁用 / 忙碌项：不关闭、不触发（防止 Enter/点击误触发批量转换）。
      if (item.disabled || item.busy) return;
      closeMenu();
      item.onSelect();
    },
    // items rebuilt each render from stable callbacks; closeMenu stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      closeMenu,
      onSelectNarrationDirect,
      onSelectVideoUnderstanding,
      onConvertAllSpeech,
      convertAllSpeechDisabled,
      isConvertingAllSpeech,
      onBatchFill,
    ],
  );

  // 打开后聚焦首项；保持菜单跟随按钮位置（滚动/缩放时重算）。
  useLayoutEffect(() => {
    if (!isOpen) return;
    itemRefs.current[0]?.focus();
    const onReposition = () => computePosition();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [isOpen, computePosition]);

  // 外部点击 / Esc 关闭。
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, closeMenu]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (activeIndex + 1) % items.length;
        setActiveIndex(next);
        itemRefs.current[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = (activeIndex - 1 + items.length) % items.length;
        setActiveIndex(next);
        itemRefs.current[next]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(0);
        itemRefs.current[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = items.length - 1;
        setActiveIndex(last);
        itemRefs.current[last]?.focus();
      }
    },
    [activeIndex, items.length],
  );

  // 焦点移出菜单且未落在触发按钮上时关闭（失焦关闭）。
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const nextTarget = e.relatedTarget as Node | null;
      if (nextTarget && (menuRef.current?.contains(nextTarget) || triggerRef.current?.contains(nextTarget))) {
        return;
      }
      closeMenu();
    },
    [closeMenu],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled || isBusy}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="ws-btn ws-btn--outline-primary ws-btn--sm"
        title={buttonLabel}
      >
        {isBusy ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span>{buttonLabel}</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen &&
        position &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={buttonLabel}
            onKeyDown={handleMenuKeyDown}
            onBlur={handleBlur}
            style={{ position: 'fixed', top: position.top, left: position.left, minWidth: Math.max(position.minWidth, 240) }}
            className="z-[9999] w-60 max-w-[90vw] rounded-md border border-border bg-card p-1 shadow-lg ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95"
          >
            {items.map((item, index) => {
              const itemDisabled = Boolean(item.disabled || item.busy);
              return (
                <React.Fragment key={item.key}>
                  {/* 「批处理动作」与上方「生成脚本」两项之间的视觉分组分隔线；不进入键盘焦点序列。 */}
                  {item.key === 'convert-all-speech' && (
                    <div className="my-1 h-px bg-border" role="separator" />
                  )}
                  <button
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={itemDisabled || undefined}
                    onClick={() => selectItem(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors ${
                      activeIndex === index ? 'bg-primary/10' : 'hover:bg-accent'
                    }${itemDisabled ? ' opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="flex w-full items-center gap-1.5 text-sm font-medium text-foreground">
                      {item.busy && (
                        <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      <span>{item.title}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{item.desc}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
};

export default AiGenerateMenu;
