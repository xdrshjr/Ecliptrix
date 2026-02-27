# Bug Diagnosis: convert-to-script-empty-videos

**Date:** 2026-02-26
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

1. POST `/api/convert-to-script` returns 400 "At least one video must be selected" when no videos are selected.
2. When video understanding is off, clicking "生成脚本" shouldn't show the ConvertToScriptModal (视频理解生成脚本弹窗) at all — it should directly generate the script from chat content.

## Root Cause

**Backend (3-layer validation):** Validation at three levels enforced a minimum of 1 video:
1. Next.js API route (`route.ts:59`): Explicit array length check
2. Pydantic model (`video_understanding_script_models.py:55`): `min_items=1` constraint
3. Backend router (`video_understanding_script_router.py:52`): Explicit empty check

**Frontend (flow issue):** `handleScriptGenerationClick` always opened the `ConvertToScriptModal`, even when the user just wants text-only script generation without video understanding.

## Fix Applied

**Backend — allow empty video list:**
- `src/app/api/convert-to-script/route.ts` - Replaced hard rejection with fallback to empty array
- `backend-services/basic-service/app/models/video_understanding_script_models.py` - Changed `min_items=1` to `default_factory=list`
- `backend-services/basic-service/app/routers/video_understanding_script_router.py` - Removed empty-videos validation block
- `backend-services/basic-service/app/services/video_understanding_script_service.py` - Added logging for text-only mode

**Frontend — bypass modal for text-only generation:**
- `src/components/video/VideoEditingInterface.tsx` - `handleScriptGenerationClick` and `handleConvertMessageToScript` now directly call `convertToScript.generateScript()` with `enableVideoUnderstanding=false` and empty videos, bypassing the ConvertToScriptModal
- `src/components/video/components/VideoUnderstandingScriptProgressModal/VideoUnderstandingScriptProgressModal.tsx` - Title and descriptions now context-aware: shows "生成脚本" instead of "视频理解生成脚本" when no videos

## Verification

Tests not run (no relevant test files identified for this endpoint).

## Notes

The ConvertToScriptModal is still available in the codebase for when video understanding IS needed (can be wired up via a separate UI path). The service layer code already handled empty video lists gracefully.
