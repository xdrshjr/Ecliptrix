interface CopyShortcutOwnershipInput {
  selection?: Pick<Selection, 'isCollapsed' | 'toString'> | null;
  selectedItems: readonly unknown[];
}

export function shouldTimelineHandleCopyShortcut({
  selection,
  selectedItems,
}: CopyShortcutOwnershipInput): boolean {
  if (selection && !selection.isCollapsed && selection.toString().length > 0) {
    return false;
  }

  return selectedItems.length > 0;
}
