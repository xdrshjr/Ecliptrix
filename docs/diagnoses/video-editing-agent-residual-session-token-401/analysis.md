# 诊断报告：AI 剪辑助手每条消息都返回「服务端发生错误」(HTTP 401 Missing session token)

- **Bug slug**: `video-editing-agent-residual-session-token-401`
- **分支**: `feat/remove-user-system`
- **节点**: Subtask #0 — 问题定位与分析（本节点不写修复代码）
- **诊断日期**: 2026-06-23

---

## 1. 问题描述 (Problem description)

桌面端「AI 剪辑助手」(AI 剪辑助手 / Video Editing Agent) 中，用户在 Agent 模式下向 AI 发送任意消息后，AI 立即回复固定错误，**Agent 完全无法执行任何剪辑动作**。

截图中的现象（`paste-1782222610449.png`）：

- 顶部错误浮层（toast）：
  ```
  Agent error: HTTP 401:
  {"success":false,"message":"未提供认证凭证","error_code":"UNAUTHORIZED","error_details":{"reason":"Missing session token"}}
  ```
- 每一条用户消息（"剪辑一个30S的视频…"、"撒地方撒地方撒地方"、"sdfsdfsdf"）下方的 AI 回复都是：
  ```
  Error: 服务端发生错误，请稍后重试。
  ```
- 底部红色 "Execution Error" 卡片：`服务端发生错误，请稍后重试。` + `Cancel` 按钮。

**关键特征**：错误是**确定性、即时**触发的（不是偶发、不是超时），与用户输入内容无关，且 Agent 开关已打开。这指向「请求在到达 LLM/工具执行之前就被同一处逻辑拒绝」。

---

## 2. 复现步骤 (Reproduction steps)

> 以下步骤在 `feat/remove-user-system` 分支上 100% 复现。

### 前置条件
- 切到 `feat/remove-user-system` 分支（用户/登录/鉴权系统已被移除）。
- 前端 `npm run dev`（:3000），后端 `uvicorn app.main:app --reload --port 8000`（或桌面端打包后的同等进程）。
- 后端 `.env` 中 `LLM_*` 或 model_settings 中已配置一个可用模型（保证「鉴权之外」一切就绪）。

### 操作
1. 打开视频编辑器页面，右侧打开「AI 剪辑助手」面板。
2. 确认右下角 `Agent` 开关为开启（蓝色）。
3. 在输入框输入任意文本，例如 `剪辑一个30S的视频，介绍约克夏小狗`，回车发送。

### 预期 vs 实际
- **预期**：Agent 进入 thinking → 调用工具 → 在时间线上产生剪辑动作。
- **实际**：立即出现顶部 `Agent error: HTTP 401: {"...","reason":"Missing session token"}`，AI 气泡显示 `Error: 服务端发生错误，请稍后重试。`，底部出现 "Execution Error" 卡片。

### 等价的最小复现（命令行，绕过 UI）
直接对前端 BFF 路由发一个不带任何鉴权头的 POST，即可复现 401：

```bash
curl -i -X POST http://127.0.0.1:3000/api/video-editing-agent/chat \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
```

返回：

```
HTTP/1.1 401 Unauthorized
{"success":false,"message":"未提供认证凭证","error_code":"UNAUTHORIZED","error_details":{"reason":"Missing session token"}}
```

这与截图中的 JSON **逐字节一致**，证明命中的就是该路由的 token 守卫。

---

## 3. 根因分析 (Root cause analysis)

### 3.1 错误字符串的唯一来源

错误 JSON `{"success":false,"message":"未提供认证凭证","error_code":"UNAUTHORIZED","error_details":{"reason":"Missing session token"}}` 在全仓库只有一个产生点：

`src/app/api/video-editing-agent/chat/route.ts:300`
```ts
// Read auth from header first, fall back to body (belt-and-suspenders ...)
const incomingAuthToken = readIncomingAuth(request) ?? bodyToken;

if (!incomingAuthToken) {                                   // ← 302
  console.error('[VideoEditingAgent] No auth token found — returning 401 immediately. ...');
  return NextResponse.json(
    { success: false, message: '未提供认证凭证', error_code: 'UNAUTHORIZED',
      error_details: { reason: 'Missing session token' } },
    { status: 401 },                                        // ← 307
  );
}
```

即：**只要请求里既没有 `Authorization`/`x-session-token` 头，也没有 body 里的 `sessionToken`，路由就在调用 LLM/构造 Agent 之前直接 401。**

### 3.2 客户端不再发送任何 token（用户系统已被移除）

本分支 `feat/remove-user-system` 已整体删除用户/登录/鉴权系统，因此前端**没有任何 token 可发**：

- `src/contexts/` 现在只剩 `LocaleContext.tsx`、`NotificationContext.tsx`（外加 `__tests__`）——**`AuthContext` 已被删除**（CLAUDE.md 里记录的旧结构含 `AuthContext`）。
- 全仓库再没有任何代码向 `localStorage` 写入 `ecliptrix-session-token`（grep 仅命中 `useTheme.ts` 的 `ecliptrix-theme`、`LocaleContext.tsx` 的 `ecliptrix-locale`，以及 `storage/files/[...path]/route.ts` 里的一句注释）。
- 调用方 `useAgentExecution.ts` 发起请求时，**body 里没有 `sessionToken`，也没有传任何 `headers`**：

  `src/components/video/hooks/useAgentExecution.ts:276`
  ```ts
  startExecution({
    url: '/api/video-editing-agent/chat',
    body: {
      messages: messagesWithUser,
      timelineState: currentTL,
      materials: materialsRef.current,
      projectId,                 // ← 没有 sessionToken
    },
    // ← 没有 headers
    ...
  });
  ```

- 底层 `SSEStreamManager` 只会带上 `Content-Type` + 调用方传入的 `headers`（此处为空）：

  `src/lib/video-editing-agent/SSEStreamManager.ts:257`
  ```ts
  const { url, body, headers } = this.config;
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,                  // ← 空
  };
  ...
  const response = await fetch(url, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body), ... });
  if (!response.ok) {            // ← 401
    const errorText = await response.text().catch(() => '');
    const err = new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);  // "HTTP 401: {...}"
    ...
  }
  ```

因此 `readIncomingAuth(request)`(header) 与 `bodyToken`(body) **必然都为 `undefined`**，`incomingAuthToken` 为假值，路由在 `route.ts:302` 命中守卫并 401。

### 3.3 401 → 用户可见文案 "服务端发生错误，请稍后重试。"

`SSEStreamManager` 抛出 `HTTP 401: {...}` 后，`errorRecovery.classifyError` 把任何 `httpStatus >= 400` 归类为 `SERVER_ERROR`：

`src/lib/video-editing-agent/errorRecovery.ts:147`
```ts
// ---- 2. HTTP status ----
if (httpStatus !== undefined && httpStatus >= 400) {
  return buildStreamError(StreamErrorType.SERVER_ERROR, rawMessage, httpStatus, context);
}
```

而 `SERVER_ERROR` 的用户文案正是截图里的那句：

`src/lib/video-editing-agent/errorRecovery.ts:102`
```ts
[StreamErrorType.SERVER_ERROR]: '服务端发生错误，请稍后重试。',
```

同时顶部 toast `Agent error: HTTP 401: {...}` 来自 `useAgentExecution.ts` 的 `onError` 回调（`onNotification('error', 'Agent error: ${error.message}')`，`error.message` 即 `HTTP 401: {...}`）。两条文案与截图完全对应，证据链闭合。

> 附注：因为 401 属于 4xx，`errorRecovery` 判定其**不可重试**（`resolveRecoverable`：4xx → `false`），所以不会自动重试，每条消息都是「一次性立刻失败」，与截图「连续三条都立即失败」的现象一致。

### 3.4 为什么这个 token 守卫如今是「纯残留」(residual)

该守卫是旧鉴权时代的产物（见路由顶部注释与 git 历史 `5390d94 [fix] pass sessionToken in request body as fallback for Agent tool auth`、`7e7611a ... auth forwarding`）。但用户系统移除后，**它守护的下游都已不再需要 token**：

1. `getConfig()` 调用的后端 `GET /api/model-settings/resolve/chat` **已无任何鉴权依赖**：
   `backend-services/basic-service/app/routers/model_settings_router.py:190`
   ```python
   @router.get("/resolve/{function_type}", response_model=ResolvedConfigResponse)
   async def resolve_config(function_type: ModelFunctionType):   # ← 无 Depends(鉴权)
   ```
2. 后端**已无 `SessionAuthMiddleware`**：
   `backend-services/basic-service/app/main.py:255`
   ```python
   # Single-user local app: there is no SessionAuthMiddleware. With no
   # ``request.state.user`` ever set, ``RateLimitMiddleware`` degrades to per-IP ...
   ```
3. Agent 工具的 `toolFetch` **完全容忍 `authToken` 为空**——没有 token 时只打印一条 warning 并以「未鉴权」方式继续，而后端本就不鉴权，故工具调用也不会 401：
   `src/lib/video-editing-agent/tools/apiHelper.ts:106`
   ```ts
   if (context.authToken && !('Authorization' in headers) && !('authorization' in headers)) {
     headers['Authorization'] = context.authToken.startsWith('Bearer ') ? context.authToken : `Bearer ${context.authToken}`;
   }
   if (!context.authToken) {
     console.warn(`[toolFetch] No authToken in context for ${path} — request will be unauthenticated`);
   }
   ```

**结论（根因）**：`src/app/api/video-editing-agent/chat/route.ts:302-308` 的**强制 session-token 守卫**是用户系统移除后遗留的死代码。它要求一个在本分支上永远不可能存在的 token，导致 AI 剪辑助手的**每一次** Agent 请求在真正执行前即被自身 401 拒绝。下游（model-settings 解析、后端中间件、Agent 工具）均已不需要该 token，因此该守卫纯属误伤。

---

## 4. 影响面 (Impact surface)

| 维度 | 说明 |
|---|---|
| 受影响功能 | 「AI 剪辑助手」的 **Agent 模式**（`/api/video-editing-agent/chat`）——AI 自动剪辑、调用时间线工具的全部能力 |
| 受影响用户 | `feat/remove-user-system` 分支 / 桌面端的**所有用户（100%）**，无一例外 |
| 触发条件 | 确定性：只要在 Agent 模式发送任意消息即触发，与输入内容无关 |
| 严重程度 | 高 — 该功能完全不可用（每条消息即时失败、不可自动重试） |
| 不受影响 | 非 Agent 的普通聊天/解说等不经过此路由的链路；时间线手动编辑、预览、导出等本地能力不受影响 |
| 数据安全 | 无数据损坏风险，纯功能阻断 |

---

## 5. 候选修复方案 (Candidate fixes)

> 本节点不写修复代码，仅给出方案对比，供 Subtask #1/#2 选用。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 是否对齐「单用户本地化」方向 |
|---|---|---|---|---|---|
| **A（推荐）** 删除路由内的强制 token 守卫 | 删去 `route.ts:302-308` 的 `if (!incomingAuthToken) { return 401 }`；保留 `incomingAuthToken` 的读取并继续把它（可能为 `undefined`）原样透传给 `getConfig()` / `createVideoEditingAgent({ authToken })`（两者已容忍 `undefined`） | 极低（单文件、删 ~7 行） | 极低（下游全部已容忍空 token，后端无鉴权中间件，工具 `toolFetch` 自带空 token 分支） | ~5 分钟 | 是，正是用户系统移除的应有收尾 |
| **B** 客户端伪造一个占位 token | 在 `useAgentExecution.ts` 或 `SSEStreamManager` 始终塞一个常量 token 让守卫通过 | 中（改在错误的层，留下无意义鉴权语义） | 中（治标不治本，后端根本忽略该 token；未来易误导维护者以为仍有鉴权） | ~10 分钟 | 否，与「移除用户系统」相悖 |
| **C** 重新引入鉴权（中间件/单用户 token） | 后端恢复 `SessionAuthMiddleware`，前端重建 token 下发 | 高 | 高（与本分支目标直接冲突，回退已删功能） | 大 | 否 |

---

## 6. 推荐方案 (Recommended fix)

**采用方案 A：删除 `src/app/api/video-editing-agent/chat/route.ts:302-308` 的强制 session-token 守卫。**

具体建议（交由 Subtask #2 落码）：

- 删除该 `if (!incomingAuthToken) { ... return 401 }` 整块。
- 保留 `const incomingAuthToken = readIncomingAuth(request) ?? bodyToken;`，并继续把它原样传给 `getConfig(incomingAuthToken)` 与 `createVideoEditingAgent({ ..., authToken: incomingAuthToken })`——当为 `undefined` 时：
  - `getConfig(undefined)` 不带鉴权头请求后端 `resolve/chat`（后端已无鉴权，正常返回配置；异常时仍回退 env，逻辑不变）；
  - `toolFetch` 走 `apiHelper.ts:112` 的「无 token 即未鉴权继续」分支，后端无中间件不会 401。
- 这样既保留对「将来万一仍带 token」的向后兼容（带了就透传），又不再因「没带 token」而误杀。

**理由**：

1. **直击根因**：唯一阻断点就是这段守卫，删除即恢复功能；其余链路（LLM 解析、Agent 构造、工具调用、后端）在无 token 时均已验证可正常工作（§3.4 证据）。
2. **最小破坏面**：单文件、删除少量行、不新增依赖、不改 UI、不改后端、不改类型契约（`AgentChatRequest.sessionToken` 字段保留为可选即可，无需删除）。
3. **方向一致**：与 `feat/remove-user-system`「单用户本地应用、无鉴权」目标完全吻合，是该重构遗漏的收尾项（对照 `main.py:255`、`model_settings_router.py:191` 后端早已无鉴权）。
4. **风险可控**：4xx 误判带来的「不可重试 + 即时失败」现象会随守卫移除而消失；无回归引入新鉴权语义。

### 建议的验证（修复后）
1. 重跑 §2 的 `curl` 最小复现：应返回 `200` + `text/event-stream`（不再 401）。
2. UI 中在 Agent 模式发送 `剪辑一个30S的视频，介绍约克夏小狗`：应进入 thinking 并开始调用工具，不再出现 "服务端发生错误"。
3. 检查服务端日志不再出现 `[VideoEditingAgent] No auth token found — returning 401 immediately`。

---

## 附录：关键证据索引 (Evidence index)

- 401 唯一产生点：`src/app/api/video-editing-agent/chat/route.ts:300-308`
- 客户端不带 token：`src/components/video/hooks/useAgentExecution.ts:276-283`
- 底层 fetch 只带 Content-Type + 抛出 `HTTP 401`：`src/lib/video-editing-agent/SSEStreamManager.ts:257-282`
- 401 → "服务端发生错误，请稍后重试。"：`src/lib/video-editing-agent/errorRecovery.ts:147-149`、`:102`
- AuthContext 已删除（仅剩 Locale/Notification）：`src/contexts/`
- 后端无 SessionAuthMiddleware：`backend-services/basic-service/app/main.py:255`
- 后端 `resolve/chat` 无鉴权依赖：`backend-services/basic-service/app/routers/model_settings_router.py:190-191`
- 工具层容忍空 authToken：`src/lib/video-editing-agent/tools/apiHelper.ts:106-114`

---

## 7. 评审补充证据 (Reviewer-added evidence)

> 本节由评审节点（Subtask #1）补入，用于把原报告中「下游已容忍 `undefined`」这一关键论断从「文字断言」升级为「类型/代码级证据」，并排除若干潜在反例。证据已逐条核对当前 `feat/remove-user-system` 工作区源码。

### 7.1 删除守卫后 `incomingAuthToken: string | undefined` 仍能编译（Fix A 不会引入类型回归）

这是 Fix A 唯一可能翻车的点：删掉 `route.ts:302-308` 的 `if (!incomingAuthToken)` 之后，`incomingAuthToken` 的静态类型从被守卫收窄后的 `string` 退回为 `string | undefined`，随后流入两个调用点。逐一核验其形参签名，**两处都显式接受 `undefined`，无需任何额外改动**：

1. `getConfig` 形参本就是 `string | undefined`，且内部用 `if (authToken)` 守护是否注入鉴权头：
   `src/app/api/video-editing-agent/chat/route.ts:178`
   ```ts
   const getConfig = async (authToken: string | undefined): Promise<AgentResolvedConfig> => {
     ...
     if (authToken) {                          // ← undefined 时直接跳过，不带鉴权头
       headers['Authorization'] = `Bearer ${authToken}`;
       headers['x-session-token'] = authToken;
     }
   ```
2. `createVideoEditingAgent({ authToken })` 的选项字段是**可选**的：
   `src/lib/video-editing-agent/types.ts:232`
   ```ts
   authToken?: string;   // CreateVideoEditingAgentOptions（含 conversationHistory/apiBaseUrl/authToken?/projectId?）
   ```
   它进一步落到 `ToolContext.authToken?: string`（`types.ts:25`），同样可选，最终被 `apiHelper.ts:112` 的「无 token 即未鉴权继续」分支消费。
3. `AgentChatRequest.sessionToken?: string`（`types.ts:179`）本就可选，**无需删除该字段**，向后兼容「将来万一仍带 token」的场景，与报告 §6 建议一致。

**结论**：Fix A 是「纯删除」即可通过 `tsc --noEmit`，不需要顺带修改任何类型或调用点。这把 §6「两者已容忍 undefined」由断言坐实为证据。

### 7.2 排除反例：401 不可能来自其它产生点

- **无 Next.js 全局中间件**：仓库不存在 `src/middleware.ts`/`src/middleware.js`（Glob 命中为空），因此不存在某个 edge middleware 抢先 401 的可能；唯一产生该 JSON 的源码点仍是 `route.ts:305`（全仓 grep `未提供认证凭证` 在源码中唯一命中，其余命中均为 `docs/diagnoses/**` 文档）。
- **后端 `resolve/chat` 不会返回 401**：未配置模型时它返回结构化 **503**（`model_settings_router.py:195-198` docstring 明言「a structured 503 … instead of a downstream opaque 401」），有配置时返回 200。即便 `getConfig` 真的打到后端，也产生不出截图里的 401 JSON。故 401 只能是前端路由守卫，§3.1 的「字节级一致」判断成立。

### 7.3 验证时的边界提醒（交付给 Subtask #2/#3）

删除守卫后，请求会继续走到 `getConfig()`。**若运行环境既无 model_settings 配置、`.env` 也无 `LLM_API_KEY`**，`getConfig` 末尾会抛 `API key not configured`（`route.ts:218-220`），被外层 catch 成 **500**，经 `errorRecovery` 仍归类为 `SERVER_ERROR`，UI 文案与本 bug **完全相同**（「服务端发生错误」）。这是一个独立的「未配置模型」问题，**不是本 bug 未修复**。因此复现/验证（§2、§6 验证步骤）必须满足前置条件「已配置一个可用模型」，否则验证者可能因二阶失败误判 Fix A 无效。建议验证时优先看服务端日志：守卫已删则不应再出现 `[VideoEditingAgent] No auth token found — returning 401 immediately`。

### 7.4 «不可重试» 论断的代码佐证（坐实 §3.3 附注）

`errorRecovery` 明确把 4xx 判为不可恢复，故 401 不会自动重试，每条消息都是「一次性立刻失败」，与截图三条连续即时失败一致：
`src/lib/video-editing-agent/errorRecovery.ts:227`
```ts
// 4xx → client error, not recoverable; 5xx → server error, retryable
```
（`resolveRecoverable` 在 `errorRecovery.ts:221`，由 `canRetry` 在 `:261` 经 `if (!error.recoverable) return false;` 消费。）

---

## 评审结论 (Review Verdict)

**最终推荐修复：方案 A —— 删除 `src/app/api/video-editing-agent/chat/route.ts:302-308` 的强制 session-token 守卫（`if (!incomingAuthToken) { ...return 401 }` 整块），保留 `const incomingAuthToken = readIncomingAuth(request) ?? bodyToken;` 并原样把（可能为 `undefined` 的）`incomingAuthToken` 透传给 `getConfig()` 与 `createVideoEditingAgent({ authToken })`。**

**根因证据链评定：成立（airtight）。**
- 症状的两处用户可见文案（顶部 `Agent error: HTTP 401: {...}`、气泡/卡片 `服务端发生错误，请稍后重试。`）已分别追溯到 `useAgentExecution.ts:271/307` 的 toast 与 `errorRecovery.ts:102/147-149` 的 4xx→`SERVER_ERROR` 映射，逐条核对无误。
- 401 的唯一源码产生点为 `route.ts:305`（全仓唯一），且已排除 Next.js 全局中间件（无 `src/middleware.ts`）与后端（`resolve/chat` 不配置时返回 503 而非 401）两类反例（§7.2）。客户端在本分支确实不携带任何 token（`useAgentExecution.ts:276-283` body 无 `sessionToken`、无 `headers`；`SSEStreamManager.ts:257-263` 仅带 `Content-Type`），守卫必然命中。
- 守卫确为「残留死代码」：其守护的下游（`model-settings/resolve` 无 `Depends` 鉴权、后端无 `SessionAuthMiddleware`、`toolFetch` 容忍空 token）在无 token 时均已验证可正常工作。

**为何 A 是「能解决问题的最小改动」而非多做功**：
- A 直击唯一阻断点（§3.1 守卫），删除即恢复；无须新增/修改类型、UI、后端或依赖。
- §7.1 已类型级证明：删除后 `string | undefined` 流入 `getConfig`(形参即 `string | undefined`) 与 `createVideoEditingAgent`(`authToken?: string`) **不产生任何 `tsc` 错误**，是「纯删除」即可通过编译，无需连带改动 —— 这是「最小」的硬证据。
- 方案 B（伪造占位 token）改在错误的层、留下误导性的「假鉴权」语义，且后端根本忽略该 token，治标不治本；方案 C（重新引入鉴权）与 `feat/remove-user-system` 目标直接冲突。二者都比 A 做得更多且引入新风险，均否决。

**回归风险评估：低且可控。**
- 不引入新鉴权语义；保留 `sessionToken?`/`authToken?` 可选字段，向后兼容「将来仍带 token」的情形。
- 唯一需向落码节点强调的边界（§7.3）：验证必须在「已配置可用模型」的前提下进行，否则 `getConfig` 抛 `API key not configured`→500→同样的 `SERVER_ERROR` 文案，属独立的「未配置」问题，勿误判为 Fix A 失效。建议以服务端日志中 `No auth token found — returning 401 immediately` 是否消失作为守卫已删的确证。

**交付给 Subtask #2 的落码清单（单文件、删 ~7 行）**：
1. 删除 `src/app/api/video-editing-agent/chat/route.ts:302-308` 的 `if (!incomingAuthToken) { ... return 401 }` 整块。
2. 保留第 300 行 `const incomingAuthToken = readIncomingAuth(request) ?? bodyToken;` 及其后对 `getConfig(incomingAuthToken)`、`createVideoEditingAgent({ ..., authToken: incomingAuthToken })` 的调用，不做其它改动。
3. 验证：§2 的 `curl` 应返回 `200 + text/event-stream`；UI Agent 模式发送消息应进入 thinking 并调用工具；服务端日志不再出现上述 401 行（前提：已配置可用模型）。
