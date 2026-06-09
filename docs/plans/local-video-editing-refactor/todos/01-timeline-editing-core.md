# TODO 01 — 剪辑核心 + 多轨道 + clip 语义契约

> 对应 spec：[`specs/01-timeline-editing-core.md`](../specs/01-timeline-editing-core.md)

## Dependencies

- `depends_on: []` — 地基，无前置。
- `blocks: [02, 05, 06]` — clip 语义契约喂给 02 预览、05 导出；split/audioDetached/INV 影响 06 持久化。
- `parallel_group: A` — 与 03、04 同属第一批（不同领域：时间轴域 / 缩略图 / 波形，互不依赖）。
- 理由：02 的合成器与 05 的导出都必须调用本 TODO 产出的 `ClipTimeMapping` 契约与精确 clip 区间；
  06 需保存 split 产物、`audioDetached`、转场/opacity 字段并对旧数据按 INV 规整。

## Tasks（按实现顺序）

### 契约与时间映射
- [ ] 写失败用例 `ClipTimeMapping.test.ts`：映射往返、clip 偏移、epsilon 边界
- [ ] 新建 `domain/services/ClipTimeMapping.ts`：`mapTimelineTimeToSourceTime` / `mapSourceTimeToTimelineTime` + `TIME_EPSILON=0.001`
- [ ] 确立 INV-1..INV-5 为强约束（文档化在代码注释）

### split（分割）
- [ ] 写失败用例 `SplitService.test.ts`：切点、左右无缝衔接、端点/界外 no-op、INV 校验
- [ ] `HistoryService.ts`：`TimelineAction['type']` 补 `'SPLIT_ITEM'`、`'DETACH_AUDIO'`（先行，过 type-check）
- [ ] 新建 `domain/services/SplitService.ts`：`splitItemAtTime(track, itemId, tCut)` 一拆二
- [ ] `TimelineAggregate.ts`：暴露 `splitItemAtTime` 入口
- [ ] 写失败用例 `store/actions/__tests__/splitItem.test.ts`：编排 + 历史 + undo/redo 往返
- [ ] 新建 `store/actions/splitItem.ts`：`splitAction(get, tCut, scope)`（record→split→autoOrganize→capture，多选/播放头）
- [ ] `selectionSlice.ts`：`activeTool='cut'` 接线触发 split
- [ ] `TimelineToolbar.tsx`：放开 cut 工具/分割按钮（调整 comingSoon 测试）
- [ ] `TimelineItem.tsx`：cut 工具下点击切分交互（像素→时间 / 播放头时间）

### resize 强约束 INV-3
- [ ] 更新既有 resize 测试以反映"trim 即裁剪源区间"
- [ ] `domain/entities/TimelineItem.ts` + `store/actions/resizeItem.ts`：resize 后保证 `duration == clipEnd - clipStart`

### audio detach（音画分离）
- [ ] 写失败用例 `store/actions/__tests__/detachAudio.test.ts`：编排 + 标志 + undo
- [ ] `TimelineItem.ts`：新增 `audioDetached?: boolean`；`src/types/index.ts` 同步可选字段
- [ ] `TimelineAggregate.detachAudio(itemId)`（复用 TrackSelectionService；纯 domain，含音轨判定在 action）
- [ ] 新建 `store/actions/detachAudio.ts`：`detachAudioAction`（先用 live material 判定含音轨且未分离→record→detach→autoOrganize→capture）
- [ ] `TimelineItem.tsx`：detach 入口（右键/菜单）

### 多轨道回归 & 序列透传
- [ ] 回归：跨轨移动类型兼容、autoOrganize 紧排视频/音频跳过 subtitle/locked
- [ ] `CompositionAdapter.ts`：序列透传 `audioDetached`（不改 URL 选择）

### 验收
- [ ] `npm run type-check` 通过
- [ ] 上述 vitest 全绿
- [ ] 桌面走查：拖入 → trim → 播放头 split → 跨轨移动 → 音画分离 → 撤销/重做
