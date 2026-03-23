# Spec 11: 集成测试 (Integration Testing)

## 1. 概述

端到端验证所有新工具与现有系统的集成。覆盖工具注册、事件路由、状态同步、异步任务处理等关键路径。

## 2. 测试范围

### 2.1 工具注册系统测试

| 测试用例 | 验证点 |
|---------|--------|
| ToolRegistry 初始化 | 所有类别正确注册，始终可用工具完整 |
| explore_tools 加载类别 | 返回正确的工具 schema，工具在当前 turn 可用 |
| explore_tools 无效类别 | 返回错误信息，不崩溃 |
| 多类别加载 | 一个 turn 内加载多个类别，全部可用 |
| Tool 总数一致性 | 注册表中的工具数与实际工具文件数一致 |

### 2.2 搜索工具测试

| 测试用例 | 验证点 |
|---------|--------|
| search_video 正常搜索 | 返回结果 + 结果注入 materialStore |
| search_image 中文关键词 | 自动翻译 + 搜索成功 |
| search_audio 无结果 | 返回空数组，不报错 |
| 搜索结果 → add_to_track | 搜索到的素材可直接添加到时间线 |

### 2.3 AI 生成工具测试

| 测试用例 | 验证点 |
|---------|--------|
| generate_ai_image 启动 | 返回 taskId + asyncTaskStore 中有记录 |
| generate_ai_video 启动 | 返回 taskId + 异步任务开始轮询 |
| 任务完成后自动入库 | materialStore 中出现新素材 |
| 任务失败处理 | asyncTaskStore 中状态更新为 failed |
| 并发限制 | 超过 3 个并发任务时拒绝 |

### 2.4 脚本/分镜工具测试

| 测试用例 | 验证点 |
|---------|--------|
| generate_video_script | scriptStore.scriptContent 更新 |
| 脚本面板响应 | 生成中显示进度，完成后显示内容 |
| generate_storyboard | storyboardStore 更新 |
| 分镜 → 批量视频 → 组合 | 完整链路验证 |

### 2.5 事件路由测试

| 测试用例 | 验证点 |
|---------|--------|
| 新 operation 类型路由 | 每种新 operation 正确路由到对应 store |
| 未知 operation 类型 | 不崩溃，log warning |
| Undo material operation | 撤销添加/删除操作 |
| Undo script operation | 脚本内容恢复 |

### 2.6 Zustand Store 测试

| 测试用例 | 验证点 |
|---------|--------|
| materialSlice CRUD | 添加、批量添加、删除、更新操作正确 |
| asyncTaskSlice 生命周期 | pending → processing → completed/failed |
| scriptSlice 流式更新 | appendScriptContent 累积正确 |
| Store 非 React 环境访问 | getState() 在 AgentEventRouter 中可用 |

### 2.7 System Prompt 测试

| 测试用例 | 验证点 |
|---------|--------|
| L0 token 预算 | System prompt 总 tokens < 600 |
| 格式正确性 | 所有类别和工具在提示中列出 |
| explore_tools 返回格式 | 返回的工具描述清晰，包含参数和示例 |

## 3. 测试方法

### 3.1 单元测试

- ToolRegistry 的类别管理和工具查询
- 每个工具 handler 的输入验证和输出格式
- Zustand store 的 action 和 state 变化
- AgentEventRouter 的 operation 路由

### 3.2 集成测试

- 工具调用 → SSE 事件 → Store 更新 的完整链路
- 异步任务启动 → 轮询 → 完成 → 入库的完整链路
- explore_tools → 加载工具 → 调用工具的完整链路

### 3.3 手动测试场景

复合任务端到端验证：
1. "帮我搜索一些海洋相关的视频素材" — 验证搜索 + 入库
2. "生成一张宇宙星空的图片" — 验证 AI 生成 + 异步 + 入库
3. "写一个关于美食的30秒视频脚本" — 验证脚本生成 + 面板更新
4. "帮我做一个完整的旅行短视频" — 验证多工具编排

## 4. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/__tests__/ToolRegistry.test.ts` | 新建 | 工具注册表测试 |
| `src/lib/video-editing-agent/__tests__/tools/*.test.ts` | 新建 | 各工具单元测试 |
| `src/stores/__tests__/*.test.ts` | 新建 | Zustand store 测试 |
| `src/lib/video-editing-agent/__tests__/AgentEventRouter.test.ts` | 新建/修改 | 事件路由扩展测试 |
