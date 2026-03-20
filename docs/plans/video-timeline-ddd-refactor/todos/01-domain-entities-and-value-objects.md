# TODO 01: Domain 实体与值对象

**对应 Spec:** `specs/01-domain-entities-and-value-objects.md`

## Dependencies

- `depends_on: []` — 无前置依赖，基础模块
- `blocks: [02, 03, 04, 06]` — 几乎所有后续模块依赖此模块的类型和实体
- `parallel_group: A` — 可与安装依赖并行

## Tasks

- [ ] 创建目录结构 `src/components/video/timeline/domain/{entities,value-objects,aggregates}`
- [ ] 创建 `domain/types.ts` — 定义 Domain 层所有共享类型（TrackData, TimelineItemData, TimelineData, TimelineSnapshot, MaterialData 接口）
- [ ] 实现 `value-objects/TimePosition.ts` — 时间位置值对象，包含 create/zero/fromPixels/add/subtract/toPixels/equals 方法
- [ ] 实现 `value-objects/Duration.ts` — 时长值对象，包含 create/default/fromRange/add/subtract/multiply 方法
- [ ] 实现 `value-objects/Volume.ts` — 音量值对象，包含 create/fromPercentage/default/muted/multiply/toPercentage 方法
- [ ] 实现 `value-objects/ZoomLevel.ts` — 缩放级别值对象，包含 create/default/zoomIn/zoomOut/toPixelsPerSecond 方法，常量 PIXELS_PER_SECOND_BASE=50
- [ ] 实现 `value-objects/TrackType.ts` — TrackType 联合类型 + TrackTypeUtils 静态方法（isCompatibleWith, canAcceptMaterial），从 Track.tsx 提取兼容性规则
- [ ] 实现 `entities/TimelineItem.ts` — 实体类，包含 create/moveTo/resize/updateVolume/overlaps/endTime/clone/toPlainObject/fromPlainObject
- [ ] 实现 `entities/Track.ts` — 实体类，包含 addItem/removeItem/findItem/canAcceptMaterial/toggleLock/toggleMute/getNextAvailablePosition/toPlainObject/fromPlainObject，封装锁定保护不变量
- [ ] 实现 `aggregates/TimelineAggregate.ts` — 聚合根，封装 addItemToTrack/removeItemFromTrack/moveItem/resizeItem/轨道操作/snapshot/restore/toPlainObject/fromPlainObject，维护 totalDuration 不变量
- [ ] 创建 `domain/index.ts` — 公共导出文件
