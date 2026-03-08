# TODO 04: API Route

> 对应 Spec: `specs/04-api-route.md`

## API Route 文件

- [ ] 创建 `src/app/api/video-editing-agent/chat/route.ts`
- [ ] 实现 POST handler
  - [ ] 解析请求体（messages, timelineState, materials）
  - [ ] 读取 LLM 环境变量（LLM_API_URL, LLM_API_KEY, LLM_MODEL）
  - [ ] 缺少配置时返回 500 错误

## SSE 流式响应

- [ ] 创建 ReadableStream + TextEncoder
- [ ] 设置正确的 SSE 响应头（Content-Type, Cache-Control, Connection）
- [ ] 实现 `send(data)` 辅助函数（JSON → SSE 格式编码）
- [ ] 流结束时发送 `[DONE]` 标志并关闭 controller

## Agent 生命周期管理

- [ ] 在 route handler 中调用 `createVideoEditingAgent(config)`
- [ ] 订阅 Agent 事件并转发到 SSE 流
- [ ] 调用 `agent.prompt(userMessage)` 启动 Agent
- [ ] 正确处理 Agent 完成（agent_end）

## 本地时间线状态更新

- [ ] 实现 `applyOperationLocally(timelineState, operation)` 函数
  - [ ] 处理 add_clip — 向轨道 items 添加新片段
  - [ ] 处理 trim_clip — 更新 clipStart/clipEnd/duration
  - [ ] 处理 delete_clip — 从轨道 items 中移除
  - [ ] 处理 move_clip — 跨轨道移动
  - [ ] 处理 resize_clip — 更新 duration
- [ ] 确保后续工具调用看到更新后的状态

## 超时处理

- [ ] 设置 120 秒超时
- [ ] 使用 Promise.race 实现超时终止
- [ ] 超时时发送 error 事件

## 错误处理

- [ ] 捕获 LLM 连接错误
- [ ] 捕获工具执行错误
- [ ] 捕获未预期错误
- [ ] 所有错误通过 SSE error 事件发送给前端
- [ ] 服务端日志记录错误详情

## 文件结构创建

- [ ] 创建 `src/lib/video-editing-agent/` 目录结构
- [ ] 创建 `agent.ts`、`types.ts`、`systemPrompt.ts`、`messageConverter.ts`
- [ ] 创建 `tools/` 子目录及所有工具文件
- [ ] 确保所有模块正确导入导出
