# TODO 07: 集成验证与测试

**对应 Spec:** `specs/07-integration-and-testing.md`

## Dependencies

- `depends_on: [01, 02, 03, 04, 05, 06]` — 需要所有模块就绪
- `blocks: []` — 最终步骤
- `parallel_group: E` — Phase 5，最后执行

## Tasks

### 测试编写

- [ ] 创建测试目录 `src/components/video/timeline/__tests__/{domain,store}`
- [ ] 创建测试工具 `__tests__/test-utils/` — createTestStore, createTestTimeline, createTestMaterial 辅助函数
- [ ] 编写值对象单元测试 — TimePosition.test.ts, Duration.test.ts, Volume.test.ts, ZoomLevel.test.ts
- [ ] 编写实体单元测试 — TimelineItem.test.ts, Track.test.ts（含兼容性规则、锁定保护）
- [ ] 编写聚合根单元测试 — TimelineAggregate.test.ts（含 totalDuration 不变量、snapshot/restore）
- [ ] 编写领域服务单元测试 — TrackSelectionService.test.ts, ItemPlacementService.test.ts, DragCalculationService.test.ts, HistoryService.test.ts
- [ ] 编写状态机单元测试 — dragMachine.test.ts（状态流转、guards、actions）
- [ ] 编写 Store 集成测试 — timelineSlice.test.ts, historySlice.test.ts, selectionSlice.test.ts, dragSlice.test.ts
- [ ] 编写跨 slice 集成测试 — actions.test.ts（addItem+undo, moveItem+undo, 多步操作+连续undo/redo）

### 清理与验证

- [ ] 删除旧的内联业务逻辑（TimelinePanel 中已迁移的 handle* 函数）
- [ ] 删除不再使用的 callback props 类型定义
- [ ] 废弃/删除旧文件: services/timelineExportService.ts, services/VideoCache.ts
- [ ] 简化 hooks/useTimelineComposition.ts — 序列提取逻辑移到 CompositionAdapter，hook 改为从 store 读取
- [ ] 简化 hooks/useTimelineExport.ts — 导出逻辑移到 TimelineRepository
- [ ] 运行 `npm run type-check` — 确认无 TypeScript 类型错误
- [ ] 运行 `npm run build` — 确认生产构建通过
- [ ] 运行 `npm run lint` — 确认无新的 lint 错误
- [ ] 执行功能验证清单（Spec 07 第 5 节的所有 checkbox）
- [ ] 更新 timeline/index.ts 公共导出
