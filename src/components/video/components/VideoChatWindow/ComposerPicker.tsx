'use client';

import React, { useEffect, useRef } from 'react';

/**
 * 输入框上方的浮层列表（`/` 技能、`@` 素材共用的展示层）。
 *
 * 焦点始终留在 textarea：列表项用 `onMouseDown.preventDefault` 选择，键盘由
 * 输入框的 `aria-activedescendant` 驱动，因此读屏器与 IME 都不受打断。
 */

export interface PickerItem {
  id: string;
  primary: string;
  secondary?: string;
  /** 右侧小标，如「内置」「我的」。 */
  badge?: string;
  /** 次要提示（如依赖不满足的原因），不阻止选择。 */
  note?: string;
  dimmed?: boolean;
}

export interface ComposerPickerProps {
  /** `listbox` 的 DOM id；选项 id 为 `${id}-${index}`。 */
  id: string;
  label: string;
  items: readonly PickerItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  /** 无选项时显示的文字（空态/加载失败/无匹配）。 */
  emptyText: string;
  emptyAction?: React.ReactNode;
}

export function pickerOptionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

const ComposerPicker: React.FC<ComposerPickerProps> = ({
  id, label, items, activeIndex, onSelect, onHover, emptyText, emptyAction,
}) => {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
      data-testid="composer-picker"
    >
      {items.length === 0 ? (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {emptyText}
          {emptyAction ? <span className="ml-1">{emptyAction}</span> : null}
        </p>
      ) : (
        <ul id={id} role="listbox" aria-label={label} className="py-1">
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={item.id}
                id={pickerOptionId(id, index)}
                ref={active ? activeRef : undefined}
                role="option"
                aria-selected={active}
                onMouseDown={(event) => { event.preventDefault(); onSelect(index); }}
                onMouseEnter={() => onHover(index)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                  active ? 'bg-accent text-accent-foreground' : ''
                } ${item.dimmed ? 'opacity-60' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.primary}</span>
                  {item.secondary ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.secondary}
                    </span>
                  ) : null}
                  {item.note ? (
                    <span className="block truncate text-xs text-amber-700 dark:text-amber-300">
                      {item.note}
                    </span>
                  ) : null}
                </span>
                {item.badge ? (
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {item.badge}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ComposerPicker;
