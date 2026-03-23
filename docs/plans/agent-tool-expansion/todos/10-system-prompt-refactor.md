# TODO 10: System Prompt 重构

**Spec**: `specs/10-system-prompt-refactor.md`

## Dependencies
- **depends_on**: [01, 09] (需要 ToolRegistry 类别摘要 + 所有工具类型确定)
- **blocks**: [11]
- **parallel_group**: E

## Tasks

- [ ] 重写 `systemPrompt.ts` 中的 `buildSystemPrompt()`
  - [ ] 接收 ToolRegistry 的 categorySummaries 参数
  - [ ] 新 L0 模板: Role + Rules + Tool Directory + Project + Workflow Guide
  - [ ] Token 预算控制 < 600 tokens
- [ ] 更新 `formatToolOverview()` → 改为树形目录格式
  - [ ] "始终可用"工具列表
  - [ ] "高级类别"摘要列表
- [ ] 新增 `formatExploreToolsResult()` — explore_tools 返回的详细描述格式
  - [ ] 每个工具: 名称 + 描述 + 参数 + 示例
  - [ ] 类别级 usage_hints
- [ ] 添加智能上轨指引到系统提示
- [ ] 添加操作指南/决策树到系统提示
- [ ] 清理废弃的 `formatTimelineSummary()` 和 `formatMaterialsSummary()` 函数
- [ ] Token 计数验证（使用 tiktoken 或手工估算）
