# Master Plan: Agent Tool Robustness Fix

## Overview

修复 Video Editing 功能中 Agent 工具执行的稳健性问题。当前 Agent 通过 SSE 流与 LLM 交互并调用工具（如 TTS 生成语音），但工具执行存在多种失败模式。用户在脚本面板中直接点击生成语音是成功的，说明后端 TTS 服务正常，问题出在 Agent 工具调用链路上。

## Goals

1. **修复 Agent TTS 工具失败问题** — 确保 Agent 调用 `generate_tts` 和 `batch_generate_tts` 工具能正常工作
2. **提升所有 Agent 工具的稳健性** — 统一错误处理、增加超时控制、增加重试机制
3. **验证所有 Agent 工具正常** — 通过测试确认 14 个 API 工具全部可用

## Success Criteria

1. Agent 调用 `generate_tts` 和 `batch_generate_tts` 工具能成功返回音频素材，与脚本面板直接点击的结果一致
2. 所有 14 个 API 调用工具均设置了合理的 `fetch` 超时（`AbortSignal.timeout`）
3. 所有 14 个 API 调用工具均使用共享的 `toolFetch` 函数，统一错误处理和重试逻辑
4. 工具执行超过 30 秒时，SSE 连接保持存活（心跳保活机制正常工作）
5. `apiHelper.test.ts` 单元测试覆盖超时、重试、错误格式化场景
6. 集成测试确认所有 14 个工具可用（至少在 mock 后端下通过）

## Scope

### In Scope

- Agent TTS 工具（`generateTts.ts`、`batchGenerateTts.ts`）的 bug 修复
- 所有 14 个 API 调用工具的稳健性审计与修复
- SSE 心跳超时与长耗时工具的兼容性
- 工具错误处理标准化
- 工具层面的超时控制
- 自动化测试验证

### Out of Scope

- 后端 TTS/搜索/AI 服务本身的修复（已确认正常）
- 前端 UI 组件的修改
- Agent LLM 提示词优化
- 新工具开发

## Architecture Analysis

### 当前调用链路

```
用户消息 → 前端 useAgentExecution
  → SSEStreamManager POST /api/video-editing-agent/chat
    → Next.js API Route (server-side)
      → @mariozechner/pi-agent-core Agent 运行
        → Agent 决定调用工具（如 generate_tts）
          → 工具内部 fetch(apiUrl(context, '/api/tts/convert'))
            → Next.js TTS API Route
              → fetch(BACKEND_URL/api/tts/convert)
                → FastAPI 后端 TTS 服务
```

### 已发现问题

#### P0: TTS 工具失败

1. **SSE 心跳超时冲突**: SSEStreamManager 的默认心跳超时为 30 秒。当 Agent 执行 TTS 工具时，工具内部的 `fetch` 调用可能需要数秒到数十秒，期间不会产生任何 SSE 数据。如果超过心跳超时，SSE 连接会被客户端断开，导致整个 Agent 执行失败。
   - `tool_execution_start` 事件在工具开始时发出 → 心跳重置
   - 工具内部 fetch 等待后端响应 → **无 SSE 数据输出**
   - 如果 fetch 耗时 > 30 秒 → 心跳超时 → 连接断开
   - 注意：服务端 Agent 超时（`AGENT_TIMEOUT = 600_000ms` = 10 分钟，在 `tool_execution_start` 和 `tool_execution_end` 时重置），但 **SSE 客户端的心跳超时不会被服务端的 tool activity 重置**，因为工具执行期间服务端不发送任何 SSE 数据

2. **服务端自调用问题**: Agent 运行在 Next.js API Route 内，工具通过 `fetch` 调用同一个 Next.js 服务器的其他 API 路由（如 `/api/tts/convert`）。在单线程或低并发环境下，这种"自己调用自己"可能导致请求阻塞或超时。**注意**：Next.js 在开发模式下是多线程的（每个请求独立处理），生产模式下也支持并发请求，因此这主要是低并发或高负载场景下的潜在风险，非当前 TTS 失败的主因。本期不单独解决，通过 D1（超时）和 D2（重试）缓解。

3. **缺少工具级别超时**: `generateTts.ts` 中的 `fetch` 调用没有设置超时（`AbortSignal.timeout`），如果后端响应慢，工具会无限等待。

#### P1: 全工具共性问题

4. **14 个 API 工具中 11 个没有 fetch 超时** — 只有 search_video、search_image、search_audio 设置了 15 秒超时
5. **无重试机制** — 所有工具在网络瞬断或临时错误时都会直接失败
6. **错误处理不一致** — 部分工具吞没错误（如 `generateAiImage` 的 fire-and-forget）
7. **响应数据缺乏防御性解析** — 假设响应结构正确，缺少 null 检查

## Design Decisions

### D1: 增加工具级别超时

为所有 API 工具的 `fetch` 调用添加 `AbortSignal.timeout()`。超时时间根据工具类型分级：
- **快速操作（15s）**：`search_video`、`search_image`、`search_audio`（已有，保持不变）
- **标准操作（60s）**：`generate_tts`、`batch_generate_tts`、`generate_video_script`、`expand_video_script`、`understand_video_script`、`describe_storyboard`
- **长耗时操作（120s）**：`generate_ai_image`、`generate_ai_video`、`image_to_video`、`generate_storyboard`、`batch_storyboard_video`

### D2: 创建共享的 fetch 工具函数

提取公共的 `toolFetch` 函数，统一处理：超时、重试（仅在网络错误/5xx 时重试 1 次，业务错误不重试）、错误格式化、响应 JSON 解析与防御性检查。扩展已有的 `apiHelper.ts`（当前仅包含 `apiUrl` 辅助函数）。

### D3: 增加 SSE 心跳保活机制

在 Agent API Route（`chat/route.ts`）中，当工具正在执行时，定期（每 10-15 秒）发送 SSE 心跳注释（`: heartbeat\n\n`），防止客户端误判超时。SSE 规范中以 `:` 开头的行为注释，`SSEStreamManager.parseSSEBuffer` 会跳过它们，但 `reader.read()` 收到原始字节时会触发 `resetHeartbeat()`，从而保持连接存活。

同时将 `SSEStreamManager` 的默认心跳超时从 30 秒提升到 90 秒，作为双重保障——即使心跳注释被代理/CDN 拦截，也能容忍大部分工具的正常执行时间。

### D4: 响应数据防御性解析

为工具的响应处理添加可选链（`?.`）和默认值，避免 undefined 访问导致异常。

## Dependencies

- `@mariozechner/pi-agent-core` — Agent 框架，工具定义接口
- Next.js API Routes — 工具内部 fetch 的目标
- FastAPI 后端 — TTS、搜索、AI 服务

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| 心跳保活注释被某些代理/CDN 拦截 | SSE 连接仍可能超时 | 同时增加 SSEStreamManager 的心跳超时到 90 秒 |
| 重试导致重复操作 | TTS 生成两次 | 只在网络错误时重试，不在业务错误时重试 |
| 工具超时时间设置不当 | 正常请求被提前中断 | 根据实际 P95 延迟设置，预留较大余量 |

## File Index

### 核心修改文件

| File | Purpose |
|------|---------|
| `src/lib/video-editing-agent/tools/apiHelper.ts` | 扩展已有文件（当前仅含 `apiUrl`），新增共享 `toolFetch` 函数（超时、重试、错误处理） |
| `src/lib/video-editing-agent/tools/generateTts.ts` | TTS 工具修复 |
| `src/lib/video-editing-agent/tools/batchGenerateTts.ts` | 批量 TTS 工具修复 |
| `src/app/api/video-editing-agent/chat/route.ts` | SSE 心跳保活机制 |
| `src/lib/video-editing-agent/SSEStreamManager.ts` | 默认心跳超时从 30s 调整为 90s（D3） |

### 需要更新的工具文件

| File | Tool Name |
|------|-----------|
| `src/lib/video-editing-agent/tools/searchVideo.ts` | search_video |
| `src/lib/video-editing-agent/tools/searchImage.ts` | search_image |
| `src/lib/video-editing-agent/tools/searchAudio.ts` | search_audio |
| `src/lib/video-editing-agent/tools/generateAiImage.ts` | generate_ai_image |
| `src/lib/video-editing-agent/tools/generateAiVideo.ts` | generate_ai_video |
| `src/lib/video-editing-agent/tools/imageToVideo.ts` | image_to_video |
| `src/lib/video-editing-agent/tools/generateVideoScript.ts` | generate_video_script |
| `src/lib/video-editing-agent/tools/expandVideoScript.ts` | expand_video_script |
| `src/lib/video-editing-agent/tools/understandVideoScript.ts` | understand_video_script |
| `src/lib/video-editing-agent/tools/generateStoryboard.ts` | generate_storyboard |
| `src/lib/video-editing-agent/tools/describeStoryboard.ts` | describe_storyboard |
| `src/lib/video-editing-agent/tools/batchStoryboardVideo.ts` | batch_storyboard_video |

### 测试文件（新建）

| File | Purpose |
|------|---------|
| `src/lib/video-editing-agent/__tests__/apiHelper.test.ts` | toolFetch 单元测试 |
| `src/lib/video-editing-agent/__tests__/tools.integration.test.ts` | 工具集成测试 |

## Execution Plan

详细的任务分解、依赖关系和执行顺序见 [task-orchestration.md](./task-orchestration.md)。
