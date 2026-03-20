# TODO 03: 生成流程 — API 扩展

**对应规格**: specs/03-generation-flow.md

## Dependencies

- `depends_on: [01]` — 需要 UI 组件提供输入源数据
- `blocks: [04]` — Hook 需要调用扩展后的 API
- `parallel_group: B`

## 任务清单

- [ ] 扩展 `/api/ai-video-script-generation/route.ts`：chatMessages 改为可选，新增 customPrompt、videoAnalysisContext、selectedVideos 参数
- [ ] 修改 ai-video-script-generation 的 prompt 组装逻辑：合并 customPrompt 和 videoAnalysisContext
- [ ] 扩展 `/api/video-understanding-script/route.ts`：新增 chatMessages 和 customPrompt 参数
- [ ] 实现 video-understanding-script 的 referenceText 合并逻辑（对话+提示词拼入 referenceText）
- [ ] 扩展 `/api/video-script-generation/route.ts`：markdownContent 改为可选，新增 customPrompt 参数
- [ ] 实现 video-script-generation 的 markdownContent 自动组装（从 chatMessages + customPrompt）
- [ ] 添加输入验证：至少有一个有效输入源
- [ ] 实现对话消息截断策略（最多 50 条、每条 1000 字）
- [ ] 验证扩展后的 API 向后兼容（现有调用方不受影响）
