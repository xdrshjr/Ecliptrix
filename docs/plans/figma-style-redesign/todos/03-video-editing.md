# TODO 03 - 视频编辑界面改造

> 对应 Spec: `specs/03-video-editing.md`

## video-editing.css 硬编码颜色替换
- [x] 替换所有 `#ffffff` 为 `var(--card)`
- [x] 替换所有 `#f8fafc` 为 `var(--muted)`
- [x] 替换所有 `#e5e7eb` 为 `var(--border)`
- [x] 替换所有 `#f1f5f9` 为 `var(--muted)`
- [x] 替换所有 `#f3f4f6` 为 `var(--accent)`
- [x] 替换所有 `#374151` 为 `var(--foreground)`
- [x] 替换所有 `#6b7280` 为 `var(--muted-foreground)`
- [x] 替换所有 `#111827` 为 `var(--foreground)`
- [x] 替换所有 `#3b82f6` 为 `var(--primary)`
- [x] 替换所有 `#2563eb` 为 `var(--primary)`
- [x] 替换所有 `#ef4444` 为 `var(--destructive)`
- [x] 替换低透明度 `rgba(0,0,0,...)` 为 `var(--border)` 或 `var(--accent)`
- [x] 替换滚动条 thumb 颜色为 `hsl(var(--muted-foreground) / 0.4)` 和 `0.6`

## video-editing.css 视觉效果清理
- [x] 移除 `.script-segment:hover` 的 `translateY(-1px)`，改为仅背景色变化
- [x] 更新 `.script-sentence:hover` 背景为 `var(--accent)`
- [x] 更新 `.markdown-panel-header` 背景为 `var(--card)`，边框为 `var(--border)`
- [x] 更新 `.script-panel-header` 同上

## VideoEditingInterface.tsx
- [x] 替换 5 处硬编码颜色为语义类名

## ScriptPanel.tsx (36 处)
- [x] 替换所有 `bg-white` 为 `bg-card`
- [x] 替换所有 `bg-gray-*` 为 `bg-muted` 或 `bg-accent`
- [x] 替换所有 `text-gray-*` 为 `text-foreground` 或 `text-muted-foreground`
- [x] 替换所有 `border-gray-*` 为 `border-border`
- [x] 替换所有 `text-blue-*` 为 `text-primary`
- [x] 替换所有 `bg-blue-*` 为 `bg-primary` 或 `bg-primary/10`
- [x] 替换 `rounded-lg`/`rounded-xl` 为 `rounded-md`
- [x] 移除装饰性 `shadow-*`

## Timeline 组件
- [x] `TimelinePanel.tsx` — 1 处替换
- [x] `TimelineRuler.tsx` — 16 处替换（刻度线、文字、播放头颜色）
- [x] `TimelineItem.tsx` — 13 处替换（项目背景、选中态、文字）
- [x] `TimelineToolbar.tsx` — 8 处替换（按钮、活跃态）
- [x] `Track.tsx` — 20 处替换（轨道背景、hover、选中、分割线）
- [x] `TrackContainer.tsx` — 17 处替换（容器背景、分割线）
- [x] `VolumeSlider.tsx` — 5 处替换（轨道、滑块颜色）
- [x] `SentenceSegmentBar.tsx` — 5 处替换

## 功能面板
- [x] `DocumentPanel.tsx` — 1 处替换
- [x] `AIAssistantPanel.tsx` — 4 处替换
- [x] `MaterialsPanel.tsx` — 66 处替换（最多，需逐一处理）
- [x] `VideoPlayerPanel` — 检查并替换硬编码颜色
- [x] `VideoCacheIndicator.tsx` — 3 处替换

## Modal 组件（按硬编码数量从多到少）
- [x] `ConvertToScriptModal.tsx` — 54 处
- [x] `AiVideoModal.tsx` — 46 处
- [x] `SubtitleEditModal.tsx` — 46 处
- [x] `AudioSearchModal.tsx` — 39 处
- [x] `ContentPolishModal.tsx` — 35 处
- [x] `MyMaterialsModal.tsx` — 31 处
- [x] `ImageSearchModal.tsx` — 30 处
- [x] `AiImageModal.tsx` — 26 处
- [x] `AIMixingModeSelectionModal.tsx` — 25 处
- [x] `BatchAnalysisModeSelectionModal.tsx` — 25 处
- [x] `AIVideoScriptTab.tsx` — 15 处
- [x] `ImagePickerSlot.tsx` — 12 处
- [x] `MediaPreviewModal.tsx` — 11 处
- [x] `AudioPlayer.tsx` — 6 处
- [x] `AIMixingProgressModal.tsx` — 6 处
- [x] `CreativeBrainstormingModal.tsx` — 5 处

## 追加完成的文件（原 TODO 未列出）
- [x] `VideoSearchModal.tsx` — 82 处
- [x] `VideoUnderstandingScriptModal.tsx` — 73 处
- [x] `VideoCutModal.tsx` — 50 处
- [x] `WorkflowConfigModal.tsx` — 47 处
- [x] `VideoAnalysisModal.tsx` — 36 处
- [x] `WatermarkRemovalModal.tsx` — 35 处
- [x] `VoiceSelector.tsx` — 16 处
- [x] `VideoChatWindow.tsx` — 18 处
- [x] `VideoUnderstandingScriptProgressModal.tsx` — 14 处
- [x] `ScriptGenerationProgressModal.tsx` — 7 处
- [x] `VideoExportProgressModal.tsx` — 7 处
- [x] `ChatInterface.tsx` — 13 处
- [x] `ConfigurationPanel.tsx` — 15 处
- [x] `ExpertMessage.tsx` — 10 处
- [x] `UserInput.tsx` — 8 处

## 通用替换规则（所有文件适用）
- [x] `bg-white` → `bg-card`
- [x] `bg-gray-50/100` → `bg-muted`
- [x] `bg-gray-200` → `bg-accent`
- [x] `text-gray-900/800/700` → `text-foreground`
- [x] `text-gray-600/500/400/300` → `text-muted-foreground`
- [x] `border-gray-*` → `border-border`
- [x] `hover:bg-gray-*` → `hover:bg-accent`
- [x] `text-blue-*` → `text-primary`
- [x] `bg-blue-*` → `bg-primary` 或 `bg-primary/10`
- [x] `text-red-*` → `text-destructive`
- [x] `shadow-sm/md` → 移除
- [x] `backdrop-blur*` → 移除
- [x] `rounded-lg/xl/2xl` → `rounded-md`

## 验证
- [x] Production build 通过（`npm run build` 无错误）
- [ ] 视频编辑界面整体在深色模式下显示正常
- [ ] 时间轴拖拽、缩放功能正常
- [ ] 所有 Modal 打开/关闭正常
- [ ] 脚本面板编辑交互正常
- [ ] 素材面板上传、搜索正常
- [ ] 检查亮色模式切换后显示正常
