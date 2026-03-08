# TODO 02: 工具定义

> 对应 Spec: `specs/02-tools-definition.md`

## 工具基础设施

- [ ] 创建 `src/lib/video-editing-agent/tools/` 目录
- [ ] 创建 `src/lib/video-editing-agent/tools/index.ts` — 导出 `buildVideoEditingTools(context)`
- [ ] 实现辅助函数：`findMaterial`、`findTrack`、`findClip`、`getDefaultTrackForType`、`getTrackEndTime`

## 只读工具

- [ ] 实现 `getTimeline.ts` — get_timeline 工具
  - [ ] 遍历所有 tracks 和 items，关联 material 信息
  - [ ] 返回结构化的时间线状态
- [ ] 实现 `searchMaterials.ts` — search_materials 工具
  - [ ] 支持 query 关键词模糊匹配
  - [ ] 支持可选的 type 过滤（video/image/audio/subtitle）

## 写入工具

- [ ] 实现 `addToTrack.ts` — add_to_track 工具
  - [ ] 验证 materialId 存在
  - [ ] 自动选择轨道（按素材类型）或使用指定 trackId
  - [ ] 自动计算 startTime（默认放在轨道末尾）
  - [ ] 检查轨道是否锁定
  - [ ] 生成 add_clip 操作指令

- [ ] 实现 `trimClip.ts` — trim_clip 工具
  - [ ] 验证 clipId 存在
  - [ ] 验证 clipStart/clipEnd 范围合法性
  - [ ] 生成 trim_clip 操作指令

- [ ] 实现 `deleteClip.ts` — delete_clip 工具
  - [ ] 验证 clipId 存在
  - [ ] 生成 delete_clip 操作指令

- [ ] 实现 `moveClip.ts` — move_clip 工具
  - [ ] 验证 clipId 存在
  - [ ] 验证 newStartTime >= 0
  - [ ] 支持跨轨道移动（可选 newTrackId）
  - [ ] 检查目标轨道是否锁定
  - [ ] 生成 move_clip 操作指令

- [ ] 实现 `resizeClip.ts` — resize_clip 工具
  - [ ] 验证 clipId 存在
  - [ ] 验证 newDuration > 0
  - [ ] 生成 resize_clip 操作指令

## TypeBox Schema

- [ ] 为每个工具定义 TypeBox 参数 schema
- [ ] 确保 description 字段（英文）清晰描述参数含义
- [ ] 使用 Type.Optional 标记可选参数
