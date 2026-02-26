# Bug Diagnosis: duplicate-audio-added-to-timeline

**Date:** 2026-02-27
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

Materials Management 中只显示了一个语音，但点击「添加到音频轨道」时，重复的多个语音素材被加入轨道。

## Root Cause

`src/components/video/timeline/TimelinePanel.tsx:703` — `useEffect` 依赖了 `handleAddMaterialsToTimeline` 回调，而该回调会因 timeline 状态更新而重建，导致 effect 在同一个 `materialsToAdd` 请求未清除前重复触发。

**依赖链：**
```
addToHistory(deps: [historyIndex, history.length])
  → handleMaterialDrop(deps: [addToHistory])
    → handleAddMaterialsToTimeline(deps: [handleMaterialDrop])
      → useEffect(deps: [materialsToAdd, handleAddMaterialsToTimeline]) ← 问题所在
```

**触发链：**
1. 用户点击「添加」→ `materialsToAdd` 变化 → effect 第一次触发 → 素材正常添加
2. `handleMaterialDrop` 内部调用 `addToHistory` → `setHistory` + `setHistoryIndex`
3. `historyIndex`/`history.length` 变化 → `addToHistory` 重建 → `handleMaterialDrop` 重建 → `handleAddMaterialsToTimeline` 重建
4. effect 因 `handleAddMaterialsToTimeline` 引用变化再次触发
5. 此时 `materialsToAdd` 尚未被 100ms timeout 清除 → 素材被重复添加

## Fix Applied

**Files modified:**
- `src/components/video/timeline/TimelinePanel.tsx:702` — 在 useEffect 前添加 `lastProcessedMaterialsTimestampRef`，用 timestamp 标识每个唯一请求，保证同一请求只处理一次

**Changes:**
```tsx
// Before
React.useEffect(() => {
  if (materialsToAdd && materialsToAdd.materials.length > 0) {
    handleAddMaterialsToTimeline(...);
  }
}, [materialsToAdd, handleAddMaterialsToTimeline]);

// After
const lastProcessedMaterialsTimestampRef = React.useRef<number | undefined>(undefined);
React.useEffect(() => {
  if (!materialsToAdd || materialsToAdd.materials.length === 0) return;
  if (materialsToAdd.timestamp === lastProcessedMaterialsTimestampRef.current) return; // 去重

  lastProcessedMaterialsTimestampRef.current = materialsToAdd.timestamp;
  handleAddMaterialsToTimeline(...);
}, [materialsToAdd, handleAddMaterialsToTimeline]);
```

## Verification

需手动验证：
1. 在 Materials Management 中只有一个语音素材
2. 点击「添加到音频轨道」
3. 确认轨道中只添加了一个素材（之前会添加 3-5 个重复的）

## Notes

- 根本问题是 React hooks 的经典陷阱：effect 的依赖项中包含了会因 effect 执行副作用而重建的回调
- 修复方式使用 ref 幂等保护，不影响正常的多次添加操作（每次点击会产生新的 timestamp）
- `materialsToAdd` 的两个清除机制（100ms 和 1000ms timeout）均无需修改，保持原有逻辑不变
