# TODO 01: 渐进式上下文系统

**对应 Spec:** `specs/01-progressive-context-system.md`

## Dependencies

- `depends_on: []` — 无前置依赖，可最先开始
- `blocks: [04]` — Agent 执行引擎重构依赖新的系统提示结构
- `parallel_group: A` — 可与 TODO 02 并行

**依赖说明:** 本模块修改系统提示和上下文注入方式，Agent 执行引擎（TODO 04）需要在新的上下文结构上工作，因此 04 必须在 01 完成后开始。

## Tasks

- [ ] 1.1 创建 `formatCompactSummary()` 函数，替代 `formatTimelineSummary()` + `formatMaterialsSummary()`
  - 输入: TimelineState, Material[]
  - 输出: 统计摘要字符串（轨道数+片段数/素材类型统计/总时长）
  - 确保任何项目规模下摘要不超过 100 tokens

- [ ] 1.2 创建 `formatToolOverview()` 函数
  - 每个工具一行：名称 + 一句话描述
  - 不包含参数 schema（参数由 function calling 的 tools 字段提供）

- [ ] 1.3 重构 `buildSystemPrompt()` 函数
  - 使用 L0 模板：角色说明 + 工具概览 + 项目摘要 + 操作指南
  - 删除旧的详细格式化函数调用
  - 确保系统提示总长度 < 500 tokens

- [ ] 1.4 审查工具 schema definitions
  - 确保每个工具的 `description` 字段足够清晰
  - 确保参数的 `description` 能让 Agent 正确使用
  - 检查 get_timeline 和 search_materials 的返回值格式是否包含足够信息

- [ ] 1.5 调整 `agent.ts` 中的 `createVideoEditingAgent()`
  - 使用新的 `buildSystemPrompt()` 调用
  - 确保对话历史正确传递（Agent 从历史中获取之前的工具调用结果）

- [ ] 1.6 端到端测试
  - 测试简单指令（"裁剪第一个视频5秒"）— Agent 应直接操作
  - 测试需要查询的指令（"告诉我现在有哪些素材"）— Agent 应调用 get_timeline/search_materials
  - 测试模糊指令（"帮我改一下视频"）— Agent 应主动获取详细信息
  - 对比优化前后的 token 消耗
