# Review Summary: google-reviewer-02

## Meta
- **Agent:** google-reviewer-02
- **Role:** REVIEWER (Senior Google Core Engineering Team)
- **Task:** TODO 04: Frontend Integration
- **Phase:** 3
- **Timestamp:** 2026-04-02T07:00:00+08:00
- **Verdict:** PASS WITH FIXES

## Files Reviewed
- `ProcessingProgress.tsx` (NEW)
- `MinimizedProgressIndicator.tsx` (NEW)
- `SilenceRemovalTab.tsx` (MODIFIED)
- `VideoProcessingModal.tsx` (MODIFIED)
- `index.ts` (MODIFIED)
- `MaterialsPanel.tsx` (MODIFIED)
- `WatermarkRemovalModal.tsx` (REFERENCE)

## Issues Found and Fixed

### Issue 1 (Critical): Polling instability due to inline callback references

**Location:** `ProcessingProgress.tsx` lines 75-117

**Problem:** `pollStatus` had `onComplete` and `onError` in its `useCallback` dependency array. These callbacks were passed as inline arrow functions from `SilenceRemovalTab` (lines 586-594), creating new function references on every render. This caused `pollStatus` to be recreated on every render, which caused the polling `useEffect` to re-run on every render. Each re-run:
1. Reset `startTimeRef.current = Date.now()` -- the 30-minute timeout could never trigger
2. Reset `hasCompletedRef.current = false` -- risked double completion callbacks
3. Cleared and recreated the interval -- polling never reached 1.5s intervals

**Fix:** Stored `onComplete` and `onError` in refs (`onCompleteRef`, `onErrorRef`) updated via separate `useEffect`s. Removed them from `pollStatus`'s dependency array. `pollStatus` now only depends on `taskId` and `clearPolling` (both stable). The polling `useEffect` runs once per `taskId` change as intended.

### Issue 2 (Critical): Minimize/restore cycle destroyed SilenceRemovalTab state

**Location:** `VideoProcessingModal.tsx` line 99

**Problem:** `if (!isOpen) return null` caused the entire component tree to unmount when the modal closed (including during minimize). When the user clicked the minimized indicator to restore, `SilenceRemovalTab` remounted fresh at `phase = 'select'` with no `processingTaskId`. The user lost all context of the ongoing processing task and could not see the progress or results.

**Fix:** Changed from conditional rendering (`return null`) to CSS visibility (`className="hidden"`). Added a `hasEverOpened` guard so the component tree is not mounted until first open, avoiding unnecessary initialization. Once opened, the subtree stays mounted across hide/show cycles, preserving all state. Added `isVisible` prop to `ProcessingProgress` so it can resume polling when the modal becomes visible again after a minimize/restore cycle.

### Issue 3 (Medium): Close during processing did not auto-minimize (spec requirement)

**Location:** `VideoProcessingModal.tsx` backdrop click and X button

**Problem:** Spec Section 8 requires: "Close during processing should prompt and auto-minimize to floating indicator." The original code simply called `onClose()` on backdrop click and X button, silently discarding the processing state. The dev acknowledged this gap in their summary.

**Fix:** Added `handleProcessingStateChange` callback from `SilenceRemovalTab` to `VideoProcessingModal` that tracks whether processing is active and the associated taskId/videoName. Replaced `onClose` with `handleClose` that checks `processingInfoRef`: if processing is active and `onMinimize` is available, it triggers minimize (floating indicator) before closing the modal. Added `onProcessingStateChange` prop to `SilenceRemovalTab` with a `useEffect` that fires when `phase`/`processingTaskId` change.

## What Passed Review (no issues)

- **MinimizedProgressIndicator.tsx**: Clean implementation. `onTaskUpdate` from MaterialsPanel is stable (wrapped in `useCallback`), so `pollStatus` dependencies are stable. Polling correctly stops on terminal states. UI displays correct colors/text for completed/failed/processing states.

- **MaterialsPanel.tsx integration**: `handleSilenceRemoved` correctly follows the `handleWatermarkRemoved` pattern (same-ID replacement, metadata with all required fields). `handleVideoProcessingMinimize`, `handleRestoreFromMinimized`, `handleMinimizedTaskUpdate` are all correctly wrapped in `useCallback`. The "视频处理" button is correctly positioned in the bottom button area alongside AI视频/AI图片 buttons.

- **SilenceRemovalTab.tsx phase machine**: Select -> Configure -> Preview -> Processing -> Completed flow is correct. API calls correctly convert ms to seconds. Completed state shows stats card. Failed state allows return to preview. Cancel during processing returns to preview phase.

- **index.ts exports**: All new types and components are correctly exported.

- **Spec compliance**: 1.5s polling interval, 30-minute timeout, 3-retry network error handling, minimize to floating indicator, same-ID material replacement with full metadata (isSilenceRemoved, originalVideoUrl, silenceRemovedAt, removedSegments, timeSaved, source).

## TypeScript Verification

`npx tsc --noEmit` passes with zero errors in all modified/new files (only pre-existing 16 errors in `trimming.test.ts`).

## Remaining Notes

- The estimated remaining time calculation in `ProcessingProgress` (lines 184-187) uses `Date.now() - startTimeRef.current` computed at render time. This value is only recalculated on re-render, not on a timer. It will update each time a poll response triggers a state change (every 1.5s), which is frequent enough for a reasonable UX.

- The `handleMaterialUpdate` legacy path in `VideoProcessingModal` (lines 70-85) constructs a minimal `SilenceRemoveResult` with `removed_count: 0` and `time_saved: 0`. This path is only reached if `SilenceRemovalTab` calls `onMaterialUpdate` directly (which it does not in the current code). It's dead code but harmless.
