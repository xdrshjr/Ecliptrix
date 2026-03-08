# TODO 01: Agent 引擎

> 对应 Spec: `specs/01-agent-engine.md`

## 依赖安装

- [ ] 安装 `@mariozechner/pi-agent-core` 和 `@mariozechner/pi-ai`
- [ ] 验证 `@sinclair/typebox` 是否作为依赖自动安装
- [ ] 验证 pi-agent-core 在 Next.js API Route（Node.js 环境）中可正常运行

## Agent 创建模块

- [ ] 创建 `src/lib/video-editing-agent/agent.ts`
- [ ] 实现 `createVideoEditingAgent(config)` 函数
- [ ] 使用 pi-ai 的 `getModel()` 配置 OpenAI 兼容模型（读取 `LLM_API_URL`、`LLM_API_KEY`、`LLM_MODEL`）
- [ ] 实现 Agent 初始化：systemPrompt、model、tools、messages

## System Prompt

- [ ] 创建 `src/lib/video-editing-agent/systemPrompt.ts`
- [ ] 实现 `buildSystemPrompt(timelineState)` 函数
- [ ] 编写英文 system prompt（角色定义 + 工具使用规则 + 时间线摘要注入）
- [ ] 实现 `formatTimelineSummary(timelineState)` 生成精简摘要

## 消息格式转换

- [ ] 创建 `src/lib/video-editing-agent/messageConverter.ts`
- [ ] 实现 `convertToAgentMessages(chatMessages)` — ChatMessage[] → AgentMessage[]
- [ ] 处理 Agent 消息中的 toolCalls 和 toolResult 还原
- [ ] 实现 `convertToAppMessage(agentEvent, toolCalls)` — Agent 事件 → ChatMessage

## 事件处理

- [ ] 实现 `handleAgentEvent(event, send)` 函数
- [ ] 映射所有 pi-agent-core 事件到 SSE 事件类型
- [ ] 处理 text_delta、tool_call、tool_result、agent_end 等事件
- [ ] 实现 SSE 编码（`data: JSON\n\n` 格式）

## 类型定义

- [ ] 创建 `src/lib/video-editing-agent/types.ts`
- [ ] 定义 ToolContext 接口
- [ ] 定义 SSE 事件类型联合类型
- [ ] 定义 TimelineOperation 类型
