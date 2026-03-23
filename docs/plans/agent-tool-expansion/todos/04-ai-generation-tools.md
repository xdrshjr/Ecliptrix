# TODO 04: AI 生成工具

**Spec**: `specs/04-ai-generation-tools.md`

## Dependencies
- **depends_on**: [01, 02] (需要 ToolRegistry + asyncTaskStore + materialStore)
- **blocks**: [09, 11]
- **parallel_group**: B

## Tasks

- [ ] 实现 `tools/generateAiImage.ts` — generate_ai_image 工具
  - [ ] 参数 schema (prompt, width, height, count, style)
  - [ ] Handler: POST /api/ark-image/generate
  - [ ] 创建 AsyncTask 注入 asyncTaskStore
  - [ ] 返回 taskId 给 Agent
- [ ] 实现 `tools/generateAiVideo.ts` — generate_ai_video 工具
  - [ ] 参数 schema (prompt, duration, aspect_ratio, model)
  - [ ] Handler: POST /api/ark-video/generate
  - [ ] 创建 AsyncTask + autoAddToTimeline metadata
  - [ ] 返回 taskId
- [ ] 实现 `tools/imageToVideo.ts` — image_to_video 工具
  - [ ] 参数 schema (material_id, prompt, duration)
  - [ ] Handler: 从 materialStore 获取图片 URL → POST /api/video/image-to-video
  - [ ] 创建 AsyncTask
- [ ] 实现 `AsyncTaskPoller.tsx` 前端轮询组件
  - [ ] 挂载在 VideoEditingInterface 层级
  - [ ] 订阅 asyncTaskStore 中的活跃任务
  - [ ] 按任务类型配置轮询间隔 (ai_video: 5s, ai_image: 3s)
  - [ ] 任务完成时: 结果转 MaterialItem → materialStore.addMaterial()
  - [ ] 任务完成时: 触发通知 UI
  - [ ] 任务失败/超时处理
  - [ ] 并发限制检查（最多 3 个 AI 生成任务）
- [ ] 在 `categories.ts` 中注册 ai_gen_tools 类别
- [ ] 智能上轨逻辑: 根据 autoAddToTimeline metadata 自动调用 add_to_track
