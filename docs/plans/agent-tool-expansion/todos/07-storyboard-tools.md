# TODO 07: 分镜工具

**Spec**: `specs/07-storyboard-tools.md`

## Dependencies
- **depends_on**: [01, 02, 06] (需要 ToolRegistry + storyboardStore + scriptStore 已实现以读取脚本)
- **blocks**: [09, 11]
- **parallel_group**: C

## Tasks

- [ ] 实现 `tools/generateStoryboard.ts` — generate_storyboard 工具
  - [ ] 参数 schema (script, topic, scene_count, aspect_ratio)
  - [ ] Handler: 如果 script 为空则从 scriptStore.scriptContent 读取
  - [ ] POST /api/storyboard/generate
  - [ ] 更新 storyboardStore: setStoryboards + setActiveStoryboard
  - [ ] 返回分镜摘要
- [ ] 实现 `tools/describeStoryboard.ts` — describe_storyboard 工具
  - [ ] 参数 schema (storyboard_id, style)
  - [ ] Handler: POST /api/storyboard/describe
  - [ ] 更新 storyboardStore 中各场景的 description
- [ ] 实现 `tools/batchStoryboardVideo.ts` — batch_storyboard_video 工具
  - [ ] 参数 schema (storyboard_id, model)
  - [ ] Handler: POST /api/storyboard/batch-video
  - [ ] 创建 AsyncTask → asyncTaskStore
  - [ ] 返回 taskId
- [ ] 实现 `tools/composeStoryboard.ts` — compose_storyboard 工具
  - [ ] 参数 schema (storyboard_id, include_transitions)
  - [ ] Handler: 从 storyboardStore 获取场景视频 → 逐个 add_to_track
  - [ ] 或调用 /api/storyboard/compose
  - [ ] 返回组合结果
- [ ] 在 `categories.ts` 中注册 storyboard_tools 类别
- [ ] AsyncTaskPoller 中添加 storyboard_video 任务类型
  - [ ] 完成后: materialStore.addMaterial + storyboardStore.updateStoryboard
