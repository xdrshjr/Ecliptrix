# TODO 02: 中心化状态管理 (Zustand Store)

**Spec**: `specs/02-zustand-store.md`

## Dependencies
- **depends_on**: [] (无依赖，基础设施)
- **blocks**: [03, 04, 05, 06, 07, 08, 09] (所有工具和事件系统依赖 store)
- **parallel_group**: A

## Tasks

- [x] 安装 zustand 依赖 — `npm install zustand` (already present in package.json v5.0.12)
- [x] 创建 `src/stores/` 目录结构
- [x] 实现 `slices/materialSlice.ts`
  - [x] State: materials, selectedMaterialId, filterType
  - [x] Actions: addMaterial, addMaterials, removeMaterial, updateMaterial, setSelectedMaterial, setFilterType
- [x] 实现 `slices/scriptSlice.ts`
  - [x] State: scriptContent, scriptType, isGenerating, generationProgress
  - [x] Actions: setScriptContent, setScriptType, appendScriptContent, setGenerating, setGenerationProgress, resetScript
- [x] 实现 `slices/storyboardSlice.ts`
  - [x] State: storyboards, activeStoryboardId, storyboardPacks, isGenerating
  - [x] Actions: setStoryboards, addStoryboard, updateStoryboard, removeStoryboard, setActiveStoryboard, setStoryboardPacks, addStoryboardPack, updateStoryboardPack
- [x] 实现 `slices/timelineSlice.ts`
  - [x] State: timelineState, externalUpdateId
  - [x] Actions: setTimelineState, triggerUpdate
- [x] 实现 `slices/asyncTaskSlice.ts`
  - [x] State: tasks (Record<string, AsyncTask> for O(1) lookup)
  - [x] Actions: addTask, updateTask, removeTask, getActiveTasks, getTasksByType
  - [x] 过期任务清理逻辑（>30min）
- [x] 实现 `videoEditingStore.ts` — 组合所有 slice
- [x] 实现 `index.ts` — 导出 store + convenience hooks
- [x] 验证非 React 环境下 getState() 可用性 (store created with `create()`, getState() is available)
