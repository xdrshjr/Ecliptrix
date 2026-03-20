# Bug Diagnosis: chat-stuck-generating-indicator

**Date:** 2026-03-05
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

Video Editing 界面最左侧的聊天面板，AI回复完内容后，偶发出现底部一直显示"生成中"旋转动画的情况。

## Root Cause

发现两个相关 bug：

### Bug 1: `isChatLoading` 被持久化到 `uiState`
- `isChatLoading` 在 `VideoEditingInterface.tsx:161` 从 `content?.uiState?.isChatLoading` 初始化
- 如果组件在 HTTP 请求进行中被重新挂载（如切换标签页），`isChatLoading` 以 `true` 初始化
- 此时没有活跃请求调用 `setIsChatLoading(false)`，导致发送按钮永远显示加载动画

### Bug 2: 消息的 `isStreaming: true` 被持久化
- 流式传输期间，消息通过 `updateConversationMessages` 以 `isStreaming: true` 持久化到 `content.conversations`
- 组件重新挂载时，`MessageBubble` 读取到 `isStreaming: true`，显示"生成中"
- 没有清理逻辑在挂载时重置这些标志

## Fix Applied

**Files modified:**
- `src/components/video/VideoEditingInterface.tsx:161-163` - `isChatLoading` 始终初始化为 `false`
- `src/components/video/VideoEditingInterface.tsx:206` - 持久化时始终写入 `isChatLoading: false`
- `src/components/video/VideoEditingInterface.tsx:223-224` - 从 hasStateChanged 检查中移除 `isChatLoading`
- `src/components/video/VideoEditingInterface.tsx:258-261` - 从 useEffect 依赖数组中移除 `isChatLoading`
- `src/components/video/VideoEditingInterface.tsx:266-292` - 新增 mount cleanup effect，清理残留的 `isStreaming` 状态

**Changes:**
1. `isChatLoading` 不再从持久化状态恢复，始终初始化为 `false`（瞬态运行时状态）
2. 持久化时固定写入 `isChatLoading: false`，防止脏数据残留
3. 新增组件挂载时的 cleanup effect：检测并重置所有消息的 `isStreaming` 为 `false`

## Verification

- TypeScript 类型检查通过（`npx tsc --noEmit` 无新增错误）

## Notes

- `isChatLoading` 是瞬态运行时状态（代表一个活跃的 HTTP 请求），不应被持久化/恢复
- `isStreaming` 同理，在组件挂载时不可能有活跃的流，所以需要清理
- 此修复不影响正常的流式传输行为，只影响组件重新挂载时的初始状态
