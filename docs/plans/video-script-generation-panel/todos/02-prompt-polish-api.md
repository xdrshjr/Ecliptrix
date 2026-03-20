# TODO 02: 提示词润色 API

**对应规格**: specs/02-prompt-polish-api.md

## Dependencies

- `depends_on: []` — 无前置依赖
- `blocks: [04]` — Hook 需要调用此 API
- `parallel_group: A` — 可与 TODO 01 并行

## 任务清单

- [ ] 创建 `src/app/api/prompt-polish/route.ts` API 路由
- [ ] 实现请求体验证（prompt 必填、长度限制）
- [ ] 编写 system prompt：视频脚本提示词优化专家角色
- [ ] 实现 targetType 差异化指导（ai-video vs normal）
- [ ] 实现 user prompt 组装：合并原始提示词 + 可选对话上下文 + 可选视频分析上下文
- [ ] 实现对话消息截断策略（最多 20 条、每条 500 字、总计 5000 字）
- [ ] 调用 LLM API（使用 LLM_API_URL / LLM_API_KEY，temperature=0.7，max_tokens=1000）
- [ ] 实现错误处理：参数错误 400、LLM 失败 500
- [ ] 在 `src/lib/api/` 中添加 `polishPrompt` 客户端函数
