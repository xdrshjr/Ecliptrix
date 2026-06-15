# 桌面端「解说直接生成」报「模型未返回任何内容，请重试」—— 缺陷定位与分析

> 多轮迭代任务 · 第 3 轮 · 子任务「问题定位与分析」产出。
> **本节只做定位与分析，不写修复代码、不提交。**
>
> 本轮现象（用户报告）：第 1、2 轮的修复打包后，桌面端**仍然不行**；
> 在「解说脚本 → AI 生成 → 解说直接生成」右侧对话发送需求后，界面提示：
> **「模型未返回任何内容，请重试」**。

---

## TL;DR（先给结论）

本轮是**两个独立缺陷叠加**造成的，且与前两轮的根因**完全不同**：

1. **真因（触发）—— 打包桌面端实际使用的是一把无效的 LLM API Key**。
   桌面端向 DashScope（阿里云百炼）`/chat/completions` 发出的请求被上游以
   **HTTP 401 `invalid_api_key`（"Incorrect API key provided"）** 拒绝。
   日志逐条坐实（含今天 2026-06-15T13:37 的最新一次）。
   - `npm run dev` 用的是**仓库根 `.env`** 里那把**有效**的 `sk-62…` key（35 位，DashScope 标准 `sk-` 格式）→ 正常。
   - **打包桌面端**用的是 **`userData/.env`** 里那把**无效**的 `102d0…` key（49 位、无 `sk-` 前缀）→ 401。
   - 这把无效 key 是打包脚本 `prepare-env.js` **有意**地用后端 `.env` 的 `LLM_*` 覆盖根 `.env` 后烘焙进安装包的（详见 3.3）。

2. **症状失真（代码缺陷）—— 上游 401 被前端静默吞掉，化为无信息量的"模型未返回任何内容"**。
   `/api/chat` 路由其实**已经**把上游错误以 `data: {error, message}` 形式下发到流里，
   但前端 `useNarrationChat`（以及 `ChatInterface` / `useStoryboardChat`）**只读取
   `content` / `reasoning` 字段**，对既无 `content` 又无 `reasoning` 的数据块一律
   `continue` 跳过 —— 于是这条 401 错误**从未抵达 UI**。流正常 `[DONE]` 结束、HTTP 状态为
   200、未抛异常，最终落到第 2 轮新加的「空结果守卫」分支 `formatEmptyResult()` ⇒
   **「模型未返回任何内容，请重试」**。

> **为什么这与前两轮判若两事**：第 1 轮修的是「左侧不流式」，第 2 轮修的是「凭证完全缺失返回
> 503」。本轮的 key **存在但无效**（既不会触发 503，也不是 reasoning-only），是一条全新的
> 失败路径。而「模型未返回任何内容」这句话本身正是第 2 轮（提交 `705d488` / `5ea20e9`）新加的
> 守卫文案 —— 它现在出现在包里，恰恰证明**包是新的、不是过期快照**，问题另有其因。

> 处理建议（详见第六、七节）：
> - **F1（必做·运维/构建）**：纠正打包桌面端使用的 LLM key（要么把后端 `.env` 的 `LLM_API_KEY`
>   换成有效的 `sk-` key 重新打包，要么在应用内「设置 → 模型设置」填入有效 key 并打通 resolve 鉴权）。
> - **F2（必做·代码）**：让 `/api/chat` 的上游错误**真正传达到 UI** —— 前端解析 `data:{error}`
>   并显示「改写失败：…（401 invalid_api_key）」，而不是吞成「模型未返回任何内容」。
> - 二者缺一不可：F1 让功能恢复可用，F2 让**下一次**任何上游错误都不再"假装无事发生"，
>   避免再花一整轮去猜「为什么没输出」。

---

## 一、问题描述

在视频编辑器「解说脚本」面板点「AI 生成 → 解说直接生成」，进入两步弹窗第 1 步（compose，
左=文案 textarea / 右=AI 对话）。在右侧输入需求并发送后：

- **现象**：左侧文案区无任何文字；右侧 assistant 气泡最终显示 **「模型未返回任何内容，请重试」**。
- **限定条件（关键）**：该现象**只在打包后的桌面客户端**（运行 `Ecliptrix.exe`，前端为冻结的
  Next.js standalone，地址 `http://127.0.0.1:18320`）出现；在 `npm run dev`（`http://localhost:3000`）
  下**一切正常**，左侧会逐块流式出现文案。

---

## 二、复现步骤

### 2.1 复现「桌面端失败」（用户路径）

环境：打包后的桌面客户端（`desktop/release/win-unpacked/Ecliptrix.exe`），主进程会拉起
后端（:18321）+ 前端 standalone（:18320）。

1. 启动 `Ecliptrix.exe`，登录（默认 admin）。
2. 打开任一视频项目 → 「解说脚本」面板 →「AI 生成」→「解说直接生成」。
3. 右侧对话输入任意需求（如「约克夏小狗介绍」），点「发送」。
4. **观察**：左侧 textarea 全程空白；右侧气泡最终显示「模型未返回任何内容，请重试」。
5. **查日志**坐实：打开 `%APPDATA%\ecliptrix-desktop\logs\frontend.log`，可见每次发送都打出：
   ```
   [Chat API] Calling LLM API (api_type=openai) base=https://dashscope.aliyuncs.com/compatible-mode/v1
   [Chat API] 开始初始化流式传输连接
   [Chat API] 已发送流建立信号
   [Chat API] LLM upstream error: 401 - {"error":{"message":"Incorrect API key provided...","code":"invalid_api_key"},...}
   [Chat API] Response failed: LLM upstream error: 401
   ```

### 2.2 对照「dev 正常」（确认环境差异，而非代码退化）

环境：`npm run dev`（:3000）+ 桌面外壳 attach（main.log 显示 "dev mode — attaching to http://localhost:3000"）。

1. 同样走「解说直接生成」发送需求。
2. **观察**：左侧逐块流式出现文案，正常。
3. **查日志**坐实：`desktop/logs/frontend.log`（dev 会话）里同一路由打出：
   ```
   [Chat API] Calling LLM API (api_type=openai) base=https://dashscope.aliyuncs.com/compatible-mode/v1
   [Chat API] 已发送第 1 个数据块 (间隔 ...ms, content:1)
   ...
   [Chat API] 流式传输完成，总计 25 个数据块，耗时 4868ms
   [Chat API] Response completed successfully
   POST /api/chat 200
   ```

> 同一套代码、同一个 endpoint、同一个 model、同一个 `api_type=openai`，**唯一差别是 API Key**：
> dev 用的有效，打包用的无效。这就把根因锁死在「环境/凭证」而非「流式代码退化」。

### 2.3 最小复现（脱离 UI，直接验证「错误被吞」这条代码缺陷）

向运行中的桌面前端发一个会触发上游 401 的请求，观察响应体里**确实带着** `data:{"error":...}`
但 UI 却显示"无内容"：

```bash
curl -N -X POST http://127.0.0.1:18320/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"测试"}]}'
```
预期看到（节选）：
```
: stream-start

data: {"error":"LLM upstream error: 401","message":"{\"error\":{\"message\":\"Incorrect API key provided...\",\"code\":\"invalid_api_key\"}...}"}

data: [DONE]
```
即：**错误信息明明在流里**，但 `useNarrationChat` 把它丢了（见 3.2）。

---

## 三、根因分析（含证据）

### 3.1 失败链路全貌（从点击到"模型未返回任何内容"）

1. 前端发送 → `useNarrationChat.sendMessage()` `POST /api/chat`，body 为对话历史
   （`src/components/video/hooks/useNarrationChat.ts:161`）。
2. `/api/chat` 路由 `getConfig()` 先尝试后端 `GET /api/model-settings/resolve/chat`，
   **不带任何鉴权头**（`src/app/api/chat/route.ts:51-57`），失败则回退环境变量
   （`route.ts:75-85`）。
3. 该 resolve 端点是**整个路由级 `require_admin` 鉴权**的
   （`backend-services/basic-service/app/routers/model_settings_router.py:36-40`），
   无 token 直接 **401**（`app/dependencies/auth.py:82-90`）⇒ 前端 `res.ok` 为假
   ⇒ **永远走环境变量回退**。
4. 环境变量回退取到 `process.env.LLM_API_KEY` = `userData/.env` 里的 `102d0…`（49 位，无效）。
   key **非空**，因此不触发第 2 轮的 `LlmNotConfiguredError`（不会 503），照常发起上游调用
   （`route.ts:76-85`）。
5. `streamLlmChat → streamOpenAI` 用 `Authorization: Bearer 102d0…` POST DashScope
   `/chat/completions`，上游返回 **401**，于是 `yield { kind:'error', status:401, message }`
   （`src/lib/llm/streamLlmChat.ts:104-108`）。
6. `/api/chat` 路由捕获到 error 事件 → `upstreamError` 置位 → break → 向流里
   `enqueue` 一条 `data: {error:"LLM upstream error: 401", message:…}` + `data: [DONE]`
   并 `controller.close()`（`route.ts:153-186`）。注意：HTTP 响应早已以 **200** 提交
   （`route.ts:202`），上游错误只能塞在流体里。
7. 前端解析这条错误数据块时，`parsed.content`、`parsed.reasoning` 均为 `undefined`
   ⇒ `chunk=""`、`reasoningChunk=""` ⇒ `if (chunk.length===0 && reasoningChunk.length===0) continue;`
   ⇒ **错误被静默丢弃**（`src/components/video/hooks/useNarrationChat.ts:199-201`）。
8. 流以 `[DONE]` 正常结束、`resp.ok` 为真、未抛异常 ⇒ `accumulated=""`、
   `accumulatedReasoning=""`、`wasAborted=false`、`errorMessage=null`
   ⇒ 收尾分支落到 `formatEmptyResult()` ⇒ **「模型未返回任何内容，请重试」**
   （`useNarrationChat.ts:235-259`，其中 `:256-258` 为全空分支、`:75-76` 为该文案）。

### 3.2 缺陷 B（代码）：上游错误被前端 SSE 解析器静默吞掉

`/api/chat` 路由把上游错误规规矩矩地下发到了流里：

```ts
// src/app/api/chat/route.ts:176
if (upstreamError) {
  console.error(`[Chat API] LLM upstream error: ${upstreamError.status} - ${upstreamError.message}`)
  // :179
  controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ error: `LLM upstream error: ${upstreamError.status}`, message: upstreamError.message })}\n\n`,
    ),
  )
  controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
  controller.close()
  return
}
```

但前端解析器只认 `content` / `reasoning`，对错误数据块直接跳过：

```ts
// src/components/video/hooks/useNarrationChat.ts:198
const parsed = JSON.parse(data)
const chunk = typeof parsed.content === 'string' ? parsed.content : ''
const reasoningChunk = typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
// :201  —— 错误数据块（只有 error/message 字段）在这里被 continue 掉
if (chunk.length === 0 && reasoningChunk.length === 0) continue;
```

收尾时因 `accumulated` / `accumulatedReasoning` 皆空，落到「全空 = 模型什么都没返回」分支：

```ts
// src/components/video/hooks/useNarrationChat.ts:253
} else if (accumulatedReasoning.trim()) {
  summary = formatReasoningOnly();      // 仅 reasoning
} else {
  // :257 正文与思考皆空：模型什么都没返回。
  summary = formatEmptyResult();        // ⇒ "模型未返回任何内容，请重试"
}
```

**同样的吞错问题存在于另外两个消费者**，可见这是 SSE 契约层面的系统性缺口，而非单点笔误：
- `src/components/chat/ChatInterface.tsx:386`（`if (parsed.content) { … }`，无 `else`/无 error 分支）；
- `src/components/video/hooks/useStoryboardChat.ts:225-227`（同样只取 `content`/`reasoning`，
  空块 `continue`）。

> 结论（缺陷 B）：上游任何错误（401/404/429/5xx…）在这三处都会被吞成"无内容/解析失败"，
> 真因永不抵达用户与日志面板。这正是本问题**连查三轮都没指向 401** 的直接原因。

### 3.3 缺陷 A（真因）：打包桌面端使用的 LLM Key 无效（401 invalid_api_key）

**日志直证（打包桌面端，`%APPDATA%\ecliptrix-desktop\logs\frontend.log`）** —— 每一次
`/api/chat` 调用都以 401 收场，覆盖 06-14 ~ 06-15 多次会话，含**今天最新一次 13:37**：

```
535  [Chat API] 已发送流建立信号
537  [Chat API] LLM upstream error: 401 - {"error":{"message":"Incorrect API key provided. For details, see:
       https://help.aliyun.com/zh/model-studio/error-code#apikey-error","type":"invalid_request_error",
       "param":null,"code":"invalid_api_key"},"request_id":"cdf55f48-..."}
538  [Chat API] 2026-06-15T13:37:13.375Z - Response failed: LLM upstream error: 401
```
（同样的 401 还出现在该文件 305/316/377/396/407/435/447/515/549 等多处。）

**main.log 证实这是真正的"打包模式"而非 dev attach**：

```
// %APPDATA%\ecliptrix-desktop\logs\main.log
[2026-06-15T13:34:37] [INFO] [main] Ecliptrix 1.0.0 starting (userData=...\ecliptrix-desktop)
...                    [frontend] starting: ...\win-unpacked\Ecliptrix.exe ...\resources\frontend\server.js
...                    [frontend] healthy at http://127.0.0.1:18320/
...                    [main] main window finished load (http://127.0.0.1:18320)
```

**Key 来源比对（仅打印前缀/长度/SHA8，绝不外泄完整密钥）**：

| 来源 | LLM_API_KEY | 谁在用 | 是否有效 |
|---|---|---|---|
| 仓库根 `M:/takoAI/Ecliptrix/.env` | `sk-62…` 长度 **35** · sha8 `f9abae28` | `npm run dev`（Next 读 `.env`） | ✅ 有效（DashScope 标准 `sk-` 格式） |
| 后端 `backend-services/basic-service/.env` | `102d0…` 长度 **49** · sha8 `544ebc1f` | 打包合并源 | ❌ 无效（无 `sk-` 前缀） |
| **`%APPDATA%\ecliptrix-desktop\.env`** | `102d0…` 长度 **49** · sha8 `544ebc1f` | **打包前端的环境变量回退** | ❌ 无效 |
| **`desktop/build/env.template.desktop`**（烘焙进安装包） | `102d0…` 长度 **49** · sha8 `544ebc1f` | 首次启动复制到 userData/.env | ❌ 无效 |

三处打包链路（后端 `.env` = 安装包模板 = userData/.env）**SHA8 完全一致**，且与 dev 用的有效
key **不同**。

**为什么打包链路烘焙的是后端那把无效 key？** 打包脚本**有意**让后端 `.env` 覆盖根 `.env` 的
`LLM_*`：

```js
// desktop/scripts/prepare-env.js:41
// Backend .env is the source of truth for shared keys (LLM_*, LOG_LEVEL) ...
// :54
function mergeEnv(rootEnv, backendEnv) {
  const merged = { ...rootEnv }
  for (const [key, value] of Object.entries(backendEnv)) {
    const backendIsEmpty = String(value).trim() === ''
    const rootHasValue = merged[key] !== undefined && String(merged[key]).trim() !== ''
    if (backendIsEmpty && rootHasValue) continue   // 后端空才保留根值
    merged[key] = value                            // :60 否则后端值覆盖根值 → 写进 102d0…
  }
  ...
}
```

由于后端 `.env` 的 `LLM_API_KEY=102d0…` **非空**，它覆盖了根 `.env` 的有效 `sk-62…`，被
`prepare-env` 写进 `build/env.template.desktop`，首次启动再被复制到 `userData/.env`：

```js
// desktop/main/config.js:33  —— 仅当 .env 缺失时复制模板；升级永不覆盖
const envPath = path.join(userDataPath, '.env')
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(envTemplatePath, envPath)
}
```

最后由主进程把 `userData/.env` 透传给前端 standalone：

```js
// desktop/main/frontendService.js:21
env: { ...process.env, ...userEnv, ELECTRON_RUN_AS_NODE:'1', NODE_ENV:'production',
       PORT:..., HOSTNAME:'127.0.0.1', BACKEND_URL:`http://127.0.0.1:${backendPort}` },
```

> 占位符不是原因：`envCheck.loadUserEnv` 会剥离 `your_*_here` 占位值
> （`desktop/main/envCheck.js:52-64`）。但 `102d0…` **不是**占位符，是一把真实但无效/不匹配
> DashScope 的 key（疑似把别的服务的 key 误填进了后端 `.env` 的 `LLM_API_KEY`），因此被照常
> 注入并发往上游，换来 401 —— 这也正是注释里担心的「not configured → 401 at call time」
> （envCheck.js:57-59）。

### 3.4 为什么 dev 正常、打包失败（环境差异收敛）

- **dev**：`npm run dev` 由 Next.js 读**仓库根 `.env`** → `process.env.LLM_API_KEY=sk-62…`（有效）。
  resolve 端点要么后端没起、要么 401（无鉴权），统统回退到这把有效 env key → 200，流式正常。
- **打包**：前端 standalone 的 env 来自 `userData/.env`（=后端 key `102d0…`，无效）；resolve 端点
  因 `require_admin` 对无 token 调用返回 401 → 同样回退到这把无效 env key → DashScope 401。

无论 resolve 走通与否，打包侧拿到的都是 `102d0…`（后端 `.env` 与 userData/.env 同源），所以
**打包必 401**；dev 侧只有根 `.env` 这把有效 key，所以**必正常**。

---

## 四、影响面

| 维度 | 说明 |
|---|---|
| 直接受影响功能 | 打包桌面端**所有走 `/api/chat` 直连 LLM 的功能**：解说直接生成、AI 助手对话；并连带 `prompt-polish`、`translate-search-query`（同一把无效 key，日志同样 401，见 frontend.log:62/245/416/463）。 |
| 受影响用户 | **所有使用当前安装包的桌面用户**，且其 `userData/.env`/后端 `.env` 携带这把无效 `102d0…` key、又未在应用内改成有效 key 者。 |
| 缺陷 B（吞错）的额外影响面 | 即使将来换上有效 key，只要上游因任何原因报错（限流 429、模型名错 404、欠费 403、网关 5xx），**三个 SSE 消费者**都会把它吞成「无内容 / 解析失败」，继续误导排查。范围：`useNarrationChat`、`ChatInterface`（主聊天）、`useStoryboardChat`（分镜聊天）。 |
| 不受影响 | `npm run dev`（用有效根 key）；不经 `/api/chat`、改走后端鉴权代理的其它 LLM 功能（如 video-editing-agent 经后端解析时）；左侧流式主路径代码本身（第 1 轮已修，无退化）。 |
| 数据/导出 | 无数据损坏；纯属"功能不可用 + 报错文案误导"。 |

---

## 五、候选修复方案对比

| 方案 | 做法 | 针对 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **F1-a（推荐·构建）** | 把**后端 `backend-services/basic-service/.env` 的 `LLM_API_KEY`** 改成有效的 DashScope `sk-` key（与根 `.env` 一致），重跑 `prepare-env` 并重新打包；首次安装用户会自动拿到有效模板。 | 缺陷 A | 无源码改动（构建/运维） | 低 | 小 |
| **F1-b（推荐·用户侧即时止血）** | 在应用内「设置 → 模型设置」为 chat 功能填入有效 key（写入后端 DB）；**前提**是让 `/api/chat` 的 resolve 调用带上 session token（见 F3），否则 DB 配置取不到。或直接手改 `%APPDATA%\ecliptrix-desktop\.env` 的 `LLM_API_KEY` 为有效值后重启。 | 缺陷 A | 低 | 低 | 极小 |
| **F2（推荐·必做·代码）** | 让前端把 `data:{error,message}` **真正显示出来**：`useNarrationChat` 解析到 `parsed.error`/`parsed.message` 时置 `errorMessage`，收尾走「改写失败：…」分支（而非空结果守卫）。同步修 `ChatInterface`、`useStoryboardChat`。**严禁**把 error 文本写入左侧 draft。 | 缺陷 B | 低（集中在 SSE 解析与收尾分支） | 低 | 小～中 |
| F3（建议·叠加） | 让 `/api/chat` 的 `getConfig()` 在调用 `/api/model-settings/resolve/chat` 时**透传调用方的 session token**（Cookie/Authorization），使「设置 → 模型设置」里配的 key 真正生效（当前因 `require_admin` + 无 token 永远回退 env）。 | 让 F1-b 可行 | 中（涉及鉴权头透传，需评估安全边界） | 中 | 中 |
| F4（否决） | 让 resolve 端点对 chat 解析放开 `require_admin`。 | — | 低 | **高**：该端点会回吐含明文 api_key 的配置，去鉴权等于泄露凭证。**否决**。 |

> F1 与 F2 **不互斥、且都应做**：F1 让功能在当前包/用户机上恢复可用（解决"为什么 401"）；
> F2 让错误从此可见、可操作（解决"为什么看不出是 401"）。只做 F1 不做 F2，下次任何上游错误仍会
> 把人带回"模型未返回任何内容"的死胡同；只做 F2 不做 F1，用户会看到清晰的「401 invalid_api_key」
> 但功能仍不可用。

---

## 六、推荐方案与理由

**推荐：F1（纠正打包/用户侧的 LLM key）+ F2（前端如实呈现上游错误）双管齐下，二者皆为必做。**

1. **F1 是恢复可用的唯一途径**：日志已证打包端发往 DashScope 的 key 无效（401 invalid_api_key），
   这无法靠任何前端改动救回。最干净的做法是 **F1-a**：把后端 `.env` 的 `LLM_API_KEY` 换成与根
   `.env` 一致的有效 `sk-` key 后重新打包（因为 `prepare-env.js` 以后端 `.env` 为 `LLM_*` 的事实
   来源）。若需立刻在现有安装上止血，用 **F1-b** 手改 `userData/.env` 或经设置页配置（配合 F3）。

2. **F2 是本轮最该落地的代码修复**：缺陷 B 把一条本可一眼定位的 401 吞成了无信息量的提示，直接
   导致问题"打包后仍不行"被反复误判。修复点明确、风险低 —— 在 `useNarrationChat` 的 SSE 循环里
   识别 `parsed.error`/`parsed.message` 并置 `errorMessage`，使收尾落到既有的「改写失败：…」分支
   （`useNarrationChat.ts:249-250`），让用户直接看到「改写失败：LLM upstream error: 401 …
   invalid_api_key」。务必：**不把 error 文本注入左侧 draft**（守住"reasoning/错误绝不进左侧"
   边界）；并对 `ChatInterface`、`useStoryboardChat` 做同样处理以堵住系统性缺口。

3. **F3 作为让"应用内配置 key"真正生效的前置**：当前 `/api/chat` 对 resolve 的调用不带 token，
   被 `require_admin` 挡回，导致设置页配的 key 永远不被 chat 采用、只能吃 env。若产品希望"用户在
   设置页改 key 即生效"，需补 token 透传（注意安全边界，勿削弱 resolve 的鉴权）。

> 交接子任务（评审 / 实现）：
> - 评审请优先复核「打包端发往 DashScope 的 key 确为无效（401）」与「错误数据块确被
>   `useNarrationChat.ts:201` 吞掉」两条主链。
> - 实现侧落 **F2**（前端如实显示上游错误，三个消费者一致处理；不污染左侧 draft），并推动 **F1**
>   （换有效 key 重打包）；**不得**回滚第 1/2 轮既有修复、**不得**去鉴权 resolve 端点（F4 已否决）。
> - 改完按第二节复现步骤回归：① 故意用无效 key → UI 应显示「改写失败：…401…」而非"无内容"；
>   ② 换有效 key → 左侧正常流式。

---

## 七、关键证据索引（file:line / 日志行号）

**代码（均对当前 HEAD）**
- `src/components/video/hooks/useNarrationChat.ts:198-201` — SSE 只取 `content`/`reasoning`，空块 `continue`，**吞掉 `data:{error}`**（缺陷 B 核心）。
- `src/components/video/hooks/useNarrationChat.ts:235-259` — 收尾四态；`:256-258` 全空分支 → `formatEmptyResult()`；`:75-76` 即「模型未返回任何内容，请重试」文案。
- `src/app/api/chat/route.ts:153-186` — 上游 error 被捕获并以 `data:{error,message}` + `[DONE]` 下发；`:202` HTTP 早已以 200 提交（故前端 `resp.ok` 恒真）。
- `src/app/api/chat/route.ts:48-86` — `getConfig()`：先无鉴权调 `/api/model-settings/resolve/chat`，失败回退 env；`:81-83` key 非空即不报 503。
- `src/lib/llm/streamLlmChat.ts:104-108` — `streamOpenAI`：上游 `!response.ok`（401）→ `yield {kind:'error', status, message}`。
- `src/components/chat/ChatInterface.tsx:386` 与 `src/components/video/hooks/useStoryboardChat.ts:225-227` — 同样只认 `content`/`reasoning`，同样吞错（缺陷 B 的系统性面）。
- `backend-services/basic-service/app/routers/model_settings_router.py:36-40`、`:192-200` — resolve 端点路由级 `require_admin`。
- `backend-services/basic-service/app/dependencies/auth.py:82-90` — 无 token → 401（故 chat 无鉴权调用必回退 env）。
- `desktop/scripts/prepare-env.js:41`、`:54-60` — 打包时**后端 `.env` 覆盖根 `.env` 的 `LLM_*`**，把无效 key 写进安装包模板（缺陷 A 来源）。
- `desktop/main/config.js:33-37` — userData/.env 仅"缺失时复制"，升级不覆盖（无效 key 会长期驻留）。
- `desktop/main/frontendService.js:21-29` — 把 `userData/.env`（`userEnv`）透传给前端 standalone。
- `desktop/main/envCheck.js:52-64` — 仅剥离 `your_*_here` 占位符；`102d0…` 非占位符，照常注入（`:57-59` 注释预言了"401 at call time"）。

**日志（用户实机，2026-06-14 ~ 06-15）**
- 打包端 `%APPDATA%\ecliptrix-desktop\logs\frontend.log:537-538`（今天 13:37 最新）、305/316/377/396/407/435/447/515/549 — 每次 `/api/chat` 均 `LLM upstream error: 401 … invalid_api_key`。
- 打包端 `…\logs\main.log:144-148` — 打包模式拉起 `Ecliptrix.exe …\resources\frontend\server.js`、窗口加载 `http://127.0.0.1:18320`（非 dev attach）。
- dev 端 `desktop/logs/frontend.log:633-650`、`715-736`、`823-869` — 同路由 `content` 数据块、`流式传输完成`、`POST /api/chat 200`（有效 key）。

**Key 比对**（脱敏）：根 `.env` `sk-62…/len35/f9abae28`（有效，dev） vs 后端 `.env`＝安装包模板＝userData/.env `102d0…/len49/544ebc1f`（无效，打包）。

---

## 八、与前两轮的关系（避免重复定位）

- 第 1 轮根因「左侧不流式」已由 `bb53f3f` 修复（`onStreamDraft` 增量回写），本轮**未退化**、不是同一问题。
- 第 2 轮新增「凭证完全缺失 → 503 可操作文案」（`5dfaacf`）与「reasoning-only/全空守卫」（`705d488`/`5ea20e9`）。
  本轮的「模型未返回任何内容」**正是** `705d488` 新加的全空守卫文案 —— 它的出现证明**包是新的**
  （已含第 2 轮修复），从而**排除**了"过期 standalone 快照（旧 R-A）"这一旧假说。
- 本轮真因是**前两轮都未触及的**两点：① 打包端 LLM 凭证在上游被 401 拒绝；② 上游错误被前端 SSE
  解析器静默吞掉。二者叠加，才表现为"打包后仍不行 + 提示模型未返回任何内容"。

---

## 九、评审补充证据与修正（评审节点 / Subtask #1 补全）

> 本节由「分析报告评审」节点追加。已**逐条复核**第七节的 11 处 `file:line` 代码引用与全部日志行号，
> 结论：**代码引用与日志引用全部属实、行号精确**（含 `useNarrationChat.ts:198-201` 的吞错、
> `route.ts:176-186` 的 error 下发、`frontend.log:537-538` 今天 13:37 的 401）。在此基础上，
> 评审**实测了运行时实际加载的 `userData/.env`**，对「缺陷 A」的根因表述做**一处实质性精修**，
> 并补全两条原报告遗漏的边界证据。

### 9.1 实测复核（评审现场取证，全部脱敏）

**(A) 代码引用复核 —— 全部命中当前 HEAD**

| 引用 | 复核结果 |
|---|---|
| `useNarrationChat.ts:199-201`（只取 `content`/`reasoning`，空块 `continue`） | ✅ 属实，且 `:218 onStreamDraft` 仅在 `chunk` 非空时触发 → error 块天然不会污染左侧 draft |
| `useNarrationChat.ts:249-250`/`:256-258`（收尾四态：error→「改写失败：」/ 全空→`formatEmptyResult`） | ✅ 属实，`errorMessage` 在 `:158` 以闭包内 `let` 声明，循环内置位即可命中 `:249` 分支 |
| `route.ts:176-186`（error 以 `data:{error,message}`+`[DONE]` 下发）、`:202`（HTTP 早以 200 提交） | ✅ 属实 |
| `route.ts:58-69`（resolve 成功才用 DB 配置）、`:75-85`（回退 env，key 非空即不报 503） | ✅ 属实 |
| `streamLlmChat.ts:104-108`（`!response.ok`→`yield {kind:'error',status,message}`） | ✅ 属实（openai/anthropic 两路一致：`:104-108` / `:182-186`） |
| `ChatInterface.tsx:386`（`if (parsed.content)` 无 error 分支）、`useStoryboardChat.ts:225-227` | ✅ 属实（系统性缺口确为三处） |
| `prepare-env.js:54-61`（后端值覆盖根值）、`config.js:33-37`、`frontendService.js:21-29`、`envCheck.js:52-64` | ✅ 属实 |

**(B) 运行时实际配置取证 —— 这是原报告未直接读取、却最关键的一份证据**

读取打包桌面端**实际加载**的 `%APPDATA%\ecliptrix-desktop\.env`（脱敏：前缀/长度/SHA8）：

```
LLM_API_KEY  = 102d0… / len 49 / sha8 544ebc1f      ← 智谱 BigModel 形态的 key（id.secret，非 sk-）
LLM_API_URL  = https://dashscope.aliyuncs.com/compatible-mode/v1   ← 阿里云 DashScope 端点
LLM_MODEL    = qwen3-next-80b-a3b-instruct           ← DashScope 模型
LLM_API_TYPE = openai
FAST_LLM_API_KEY = 102d0… / 544ebc1f   FAST_LLM_API_URL = …dashscope…compatible-mode/v1
```

与之对照（同样脱敏）：

| 来源 | LLM_API_KEY | LLM_API_URL | LLM_MODEL | TYPE |
|---|---|---|---|---|
| 仓库根 `.env`（dev 用） | `sk-62…/35/f9abae28` | dashscope compatible-mode | qwen3-next-80b | openai |
| **运行时 `userData/.env`（打包实跑）** | **`102d0…/49/544ebc1f`** | **dashscope compatible-mode** | **qwen3** | **openai** |
| **当前仓库后端 `.env`** | `102d0…/49/544ebc1f` | **open.bigmodel.cn/api/anthropic** | **glm-5-turbo** | **anthropic** |
| 当前 `desktop/build/env.template.desktop` | `102d0…/49/544ebc1f` | **open.bigmodel.cn/api/anthropic** | glm-5-turbo | anthropic |
| 占位符模板 `desktop/scripts/env.template.desktop` | `your_…/21`（占位） | dashscope compatible-mode | qwen3 | openai |

**日志佐证运行时确实用的是上面这套 dashscope/openai/qwen3 配置**（即走了 env 回退、resolve 未命中 DB）：
- `frontend.log:534/546` — `Calling LLM API (api_type=openai) base=https://dashscope.aliyuncs.com/compatible-mode/v1`
- `frontend.log:540` — `[Chat API] Model: qwen3-next-80b-a3b-instruct`
- `frontend.log:537/549` — 401，错误域名 `help.aliyun.com/zh/model-studio`（**DashScope** 的报错，非智谱）

### 9.2 对「缺陷 A」根因表述的修正：不是"key 无效"，而是"**跨服务商 key/端点错配**"

原报告判定 `102d0…` 为"无效（无 `sk-` 前缀）"。**评审修正**：`sk-` 只是 DashScope 的 key 约定；
`102d0…` 是**智谱 BigModel** 的 key 形态（`id.secret`）。其被 401 的真实机理是 **错配**——

> 运行时把**智谱的 key（`102d0…`）发到了 DashScope 的 OpenAI 兼容端点 + qwen3 模型**上，
> DashScope 自然以 `invalid_api_key`（"Incorrect API key provided"，`help.aliyun.com/model-studio`）拒绝。

这把"无效"二字解释得更精确，也直接影响修复判断（见 9.3）：**换个端点/类型就可能让同一把 key 生效**。

### 9.3 原报告遗漏的两条边界证据（评审补全，关系到修复是否真的有效）

**遗漏一：当前仓库后端 `.env` 已被改成与智谱 key 自洽的 `bigmodel/anthropic/glm-5-turbo`。**
因此 `prepare-env.js` 以后端 `.env` 为 `LLM_*` 事实来源**重新打包**所产出的 `build/env.template.desktop`
**已不再是** dashscope+`102d0…` 的错配组合，而是 `open.bigmodel.cn/api/anthropic` + `102d0…` + `glm-5-turbo`
（见 9.1 表）。换言之：**原报告 3.4「打包必 401」的推断，对"用当前仓库重新打包后的新包"已不再成立**——
新包会改走智谱 Anthropic 端点。这意味着 F1-a 的"换有效 `sk-` key"描述需要修正为「**令 key 与端点/类型
匹配**」：要么保持智谱（`bigmodel/anthropic/glm-5-turbo` + 有效智谱 key），要么整组切回 DashScope
（`dashscope/openai/qwen3` + 有效 `sk-` key）；**严禁再出现 dashscope 端点配智谱 key 这类错配**。
（落地前必须由实现节点**实跑一次**该端点鉴权，确认 `102d0…@bigmodel` 真能 200——本节点无法在不外泄
密钥的前提下代为验证。）

**遗漏二：既有用户机上的错配 `userData/.env` 不会被自愈，"重打包+重装"对老用户无效。**
- `config.js:34` 仅在 `.env` **缺失**时复制模板（`if (!fs.existsSync(envPath))`），重装覆盖不动既有 `userData/.env`；
- `envCheck.js:91-119` 的 `backfillUserEnv` **只回填仍是占位符的值**（`:106 if (!PLACEHOLDER_PATTERN.test(currentValue)) return line`）；
  而 `102d0…` 与 `dashscope` URL **都不是占位符**，故自愈逻辑**整条跳过**，错配会**长期驻留**。

> 结论：要让**已安装用户**恢复，必须**主动重置那份 `userData/.env`**（删除 `%APPDATA%\ecliptrix-desktop\.env`
> 让其按新模板重新复制，或在「设置 → 模型设置」改、或手改该文件），单靠重打包/重装救不回老用户。
> 这条边界是原报告影响面里"又未在应用内改成有效 key 者"一句**背后的机制**，评审予以显式化。

### 9.4 候选修复的边界 / 回归复核

- **F2（代码）边界检查**：在 `useNarrationChat` SSE 循环里于 `:201 continue` **之前**识别
  `typeof parsed.error === 'string'`（及 `parsed.message`）→ 置 `errorMessage` 并 `break`/`continue`。
  - 错误路径：error 块无 `content`/`reasoning`，故 `:218 onStreamDraft` 不触发 → **天然不污染左侧 draft**（满足"reasoning/错误绝不进左侧"边界）。✅
  - 收尾：`errorMessage` 命中 `:249` 的「改写失败：」分支，**优先级高于** `rewritten`/全空分支。✅
  - 并发/中止：与既有 `wasAborted`（`AbortError`→`:247` 取消分支）互不冲突；先发生者为准。✅
  - 部分流后报错（先若干 content 再 error）：已流式写入左侧的部分文案保留、右侧显示「改写失败」——可接受且符合直觉。
  - 回归面：仅新增"识别 error 块"一条分支，正常 `content`/`reasoning` 流路径零改动 → **回归风险低**。✅
  - 三消费者一致：`ChatInterface.tsx:386` 增 `else if (parsed.error)`、`useStoryboardChat.ts:227` 同 `useNarrationChat` 处理。
- **F4（去鉴权 resolve）维持否决**：`model_settings_router.py:36-40` 路由级 `require_admin` 守的是会回吐**明文 api_key** 的高危端点，去鉴权=泄露凭证。✅ 否决正确。
- **F3（resolve 透传 token）定位为可选增强**：当前 `route.ts:51-57` 不带鉴权头 → 必走 env 回退（9.1 日志已证运行时用的就是 env 值）。仅当产品要"设置页改 key 即生效"才需要，**非本轮最小修复必需项**。
- **不建议**让 `config.js`/`backfillUserEnv` 强制用模板覆盖既有 `LLM_*`：会践踏用户在设置页/手工填入的 key，**引入新回归**，故排除出最小修复。

---

## 十、评审结论（Review Verdict）

**最终推荐的单一修复（本轮代码节点 Subtask #2 的唯一代码交付物）：**

> **F2 —— 让 `/api/chat` 的上游错误如实抵达 UI：在三个 SSE 消费者（首要 `useNarrationChat`，
> 并同步 `ChatInterface`、`useStoryboardChat`）中识别 `data:{error,message}` 错误块，置 `errorMessage`，
> 使收尾落到既有的「改写失败：…」分支，显示如「改写失败：LLM upstream error: 401 … invalid_api_key」；
> 严禁把 error 文本写入左侧 draft。**

**为什么是它（理由）：**

1. **它是唯一在仓库内、可由代码节点掌控、且最小化的修复。** 缺陷 B（吞错）经评审实测确认：错误信息
   **明明已在流里**（`route.ts:176-186`），却被 `useNarrationChat.ts:201` 静默丢弃，最终错落到全空守卫
   文案。F2 只新增"识别 error 块"一条分支，正常流路径零改动，回归风险低（见 9.4），且直接消灭了
   用户看到的误导性「模型未返回任何内容」——把它换成可操作的真因「401 invalid_api_key」。
2. **它根治"连查三轮都没指向 401"的元问题。** 只要错误可见，任何上游故障（401/403/404/429/5xx）都不再
   伪装成"无内容"，避免下一轮再花整轮去猜。
3. **缺陷 A 的修复主体已落在仓库/运维侧、不属于本代码节点的最小改动范畴。** 评审实测发现：当前仓库后端
   `.env` 已改为与智谱 key 自洽的 `bigmodel/anthropic/glm-5-turbo`（9.3 遗漏一），其本质是
   "**令 key 与端点/类型匹配**"的**配置**修正，而非源码改动。

**但务必同时执行的非代码前置（否则复现仍"不行"，无法通过 Subtask #2 的回归验收）：**

- **P1（配置/运维 · 必做）**：确保打包所用 `LLM_*` 是**自洽的一组**（端点 / 类型 / 模型 / key 同属一个
  服务商），并**实跑一次该端点鉴权确认返回 200**；**重置既有 `userData/.env`**（删除
  `%APPDATA%\ecliptrix-desktop\.env` 令其按新模板重新复制，或经设置页 / 手改）——因 `config.js:34`
  仅缺失时复制、`backfillUserEnv` 只回填占位符，错配的旧值不会自愈（9.3 遗漏二）。

**验收（按第二节复现回归）：**
1. 故意保留错配/无效凭证 → UI 应显示「**改写失败：…401…invalid_api_key**」**而非**「模型未返回任何内容」（验证 F2）。
2. 修正为自洽且有效的凭证并重置 `userData/.env` → 左侧**正常逐块流式**输出解说（验证 P1 + 全链路）。

**红线（交接给实现节点）：** 不得回滚第 1/2 轮既有修复；不得去鉴权 resolve 端点（F4 已否决）；
不得让错误文本进入左侧 draft；不得强制用模板覆盖用户既填的 `LLM_*`（避免新回归）。
