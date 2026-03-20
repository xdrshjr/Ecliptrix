# TODO 06: Infrastructure 层适配器

**对应 Spec:** `specs/06-infrastructure-adapters.md`

## Dependencies

- `depends_on: [01]` — 依赖 Domain 类型定义
- `blocks: [07]` — 集成测试需要适配器就绪
- `parallel_group: B` — 可与 TODO 02, 03 并行（在 01 完成后）

## Tasks

- [ ] 创建目录 `src/components/video/timeline/infrastructure/`
- [ ] 定义端口接口 `domain/ports.ts` — ITimelineRepository, IVideoCachePort, ICompositionPort 接口定义
- [ ] 实现 `TimelineRepository.ts` — 从 timelineExportService.ts 和 TimelinePanel.tsx 提取导出/导入逻辑：exportToJSON, exportViaBackend, importFromJSON, validateExportData
- [ ] 实现 `VideoCacheAdapter.ts` — 从 VideoCache.ts 迁移逻辑：preloadVideo, getCacheState, evict, clearAll, getVideoElement
- [ ] 实现 `CompositionAdapter.ts` — 从 useTimelineComposition.ts 提取序列提取逻辑：extractVideoSequences（URL选择/volume计算/缓存状态）, extractAudioSequences, buildCompositionRequest
- [ ] 创建 `infrastructure/errors.ts` — TimelineExportError, TimelineImportError, VideoCacheError
- [ ] 创建 `infrastructure/index.ts` 公共导出
