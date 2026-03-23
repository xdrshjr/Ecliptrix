# TODO 03: 搜索工具

**Spec**: `specs/03-search-tools.md`

## Dependencies
- **depends_on**: [01, 02] (需要 ToolRegistry 注册 + materialStore 入库)
- **blocks**: [09, 11]
- **parallel_group**: B

## Tasks

- [ ] 实现 `tools/searchVideo.ts` — search_video 工具
  - [ ] 工具参数 schema 定义 (query, count, orientation, min/max_duration)
  - [ ] Handler: 调用 /api/video-search
  - [ ] 中文关键词自动翻译（调用 /api/translate-search-query）
  - [ ] 响应映射为 MaterialItem[] 格式
  - [ ] 注入 materialStore.addMaterials()
  - [ ] 返回摘要给 Agent
- [ ] 实现 `tools/searchImage.ts` — search_image 工具
  - [ ] Handler: 调用 /api/image-search
  - [ ] Unsplash 响应映射为 MaterialItem[]
  - [ ] 注入 materialStore
- [ ] 实现 `tools/searchAudio.ts` — search_audio 工具
  - [ ] Handler: 调用 /api/audio-search
  - [ ] Freesound 响应映射为 MaterialItem[]
  - [ ] 注入 materialStore
- [ ] 在 `categories.ts` 中注册 search_tools 类别
  - [ ] 工具引用绑定
  - [ ] usage_hints 编写
- [ ] 错误处理: API key 缺失、网络超时、无结果场景
