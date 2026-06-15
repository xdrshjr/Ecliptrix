# 「解说直接生成」/api/chat 在 dev 正常、打包桌面端不正常 —— 缺陷定位与分析

> 子任务 #0「问题定位与分析」产出。**本节只做定位与分析，不写修复代码、不提交。**
>
> 本轮用户需求（第 2 轮）：
> 「没修改好。看起来在 desktop 中 `npm run dev` 时，对应『解说直接生成』的 `http://localhost:3000/api/chat`
> 就是正常的；但打包为桌面端、运行 exe 启动以后，这个就不正常了。」

---

## TL;DR（先给结论）

- 用户把范围精确地缩到了 `/api/chat`：**dev 正常、打包桌面端不正常**。
- 上一轮（`narration-direct-left-panel-not-streaming`）的两大真因里：
  - **R-A（过期 standalone 快照）已被消除** —— 当前 `desktop/release/win-unpacked` 的前端 bundle 是**今天（2026-06-15 01:49）刚打的全新构建**，已包含 `bb53f3f` / 705d488 / 5ea20e9 全部修复（见证据 §3.1）。
  - **R-B（模型只产 reasoning）** 与本轮「dev 正常但打包不正常」的对比**无关** —— 模型输出与跑 dev 还是跑 exe 无关，不会"只在打包时"发作。
- 因此本轮真因落在**一条纯环境差异**上：**`/api/chat` 在桌面端解析不到 LLM 凭证 → 抛错 → 返回 HTTP 500 → 左侧无文案、右侧气泡显示「改写失败：Chat request failed: 500」**。
- 我用**打包产物里的真实 `server.js`** 现场复现并取证（§2）：
  - **无凭证**时 `/api/chat` 返回 **HTTP 500 `{"error":"Internal server error"}`**，服务端日志 `尚未配置 AI 模型凭证…`；
  - **有凭证**（env 回退指向本地 mock LLM）时 `/api/chat` 返回 **HTTP 200 `text/event-stream` 且逐块流式**（chunk 间隔 ~400ms，与 mock 完全一致）。
  - → **打包构建的流式管道本身完全正常，唯一卡点是凭证解析。**
- 凭证差异的来源（§3）：dev 的后端读 `backend-services/basic-service/.env`（含**真实** `LLM_API_KEY`），所以 dev 不配置也能用；打包桌面端的前端 bundle **被剥掉所有 `.env*`**、注入的 `userData/.env` 里 `LLM_API_KEY` 是占位符且**占位符在注入前被剔除**、后端 DB 又是全新空库 —— 三条凭证来源在全新安装上**同时为空**。
- 附带还暴露一处**真实代码缺陷**：`/api/chat` 把本可操作的「尚未配置 AI 模型凭证,请前往 设置 → 模型设置」错误，被外层 `catch` 吞成无信息量的 `HTTP 500 Internal server error`（route.ts:201-208），用户只看到「改写失败：Chat request failed: 500」，**完全没有指向正确的解决动作**。

---

## 一、问题描述

在视频编辑「解说脚本」面板点「AI 生成 → 解说直接生成」，第 1 步（compose）右侧对话框输入需求并发送后，前端会向 `/api/chat`（相对地址，按页面源解析）POST 一段消息并消费其 SSE 流，把正文逐块写进左侧 textarea（`useNarrationChat` → `onStreamDraft` → `setDraftTextState`）。

- **dev（`npm run dev`）**：页面源是 `http://localhost:3000`，命中 `next dev` 起的 `/api/chat`，**正常流式**，左侧逐块出文案。
- **打包桌面端（运行 exe）**：页面源是 `http://127.0.0.1:<frontendPort>`（默认 18320），命中打包冻结的 **standalone `server.js`** 起的 `/api/chat`，**不正常** —— 左侧无任何文案，右侧助手气泡收尾为「改写失败：Chat request failed: 500」。

用户的关键观察「**同一个 `/api/chat`，dev 正常、打包不正常**」，把问题锁死在「**dev 与 standalone 两套运行环境的差异**」上，而非前端组件接线或模型输出。

---

## 二、复现步骤（含现场取证，可复制粘贴）

> 取证方式：**不依赖重新打包**，直接运行打包产物里的真实前端 server，最大程度还原「运行 exe」时 `/api/chat` 的行为。环境：Windows + Node v22.18.0；前端 bundle 路径
> `desktop/release/win-unpacked/resources/frontend/`（其 `.next/BUILD_ID = ES-qfCr-OCfECLXmLIspQ`，构建于 2026-06-15 01:49）。

### 2.1 真实环境复现（终端用户视角）

1. 安装并运行打包好的 `Ecliptrix-Setup-1.0.0.exe`（**全新安装，未在 设置 → 模型设置 配置任何模型，也未手动改 `%APPDATA%/Ecliptrix/.env`**）。
2. 进入视频编辑 →「解说脚本」面板 →「AI 生成」→「解说直接生成」，停在第 1 步。
3. 右侧输入「写一段 30 秒咖啡品牌解说」并发送。
4. **观察**：左侧 textarea 全程空白；片刻后右侧气泡变成「改写失败：Chat request failed: 500」 → **复现**。
5. 对照：在 `desktop` 目录 `npm run dev`（dev 后端读 `backend-services/basic-service/.env` 里的真实 `LLM_API_KEY`），同样操作 → 左侧逐块出文案 → **正常**。

### 2.2 现场最小复现（隔离 `/api/chat`，给出硬证据）

**场景 A —— 无凭证（还原全新安装的打包后端）**：

```bash
cd "M:/takoAI/Ecliptrix/desktop/release/win-unpacked/resources/frontend"
# 用打包产物里真实的 standalone server，后端指向不可达地址、且不给 LLM_API_KEY
PORT=18399 HOSTNAME=127.0.0.1 NODE_ENV=production BACKEND_URL=http://127.0.0.1:9 node server.js
# 另一个终端 POST /api/chat（脚本见本目录 repro/probe.js）：
node docs/diagnoses/narration-direct-chat-fails-packaged-desktop/repro/probe.js 18399
```

实测输出（**关键证据**）：

```
[probe] HTTP 500 content-type=application/json
[probe] +26374ms chunk: "{\"error\":\"Internal server error\"}"
# server 端日志：
[Chat API] Failed to fetch model settings from backend, falling back to env vars
[Chat API] Unexpected error: Error: 尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置 (AI model not configured — open Settings → Model Settings)
    at x (...\.next\server\app\api\chat\route.js:1:1932)
[Chat API] ... Response failed: Error: 尚未配置 AI 模型凭证...
```

→ 打包后的 `/api/chat`，**无凭证即 500**；用户侧表现为「改写失败：Chat request failed: 500」。
（旁证：对不可达后端的 resolve fetch **无超时**，本次干等 ~26s 才回退，见 §3.5 的次要缺陷。）

**场景 B —— 有凭证（env 回退指向本地 mock LLM，验证流式是否正常）**：

```bash
# 启动一个 OpenAI 兼容 mock：每 400ms 吐一块 content，最后 [DONE]（脚本见本目录 repro/mock-llm.js）
node docs/diagnoses/narration-direct-chat-fails-packaged-desktop/repro/mock-llm.js          # :8899
cd "M:/takoAI/Ecliptrix/desktop/release/win-unpacked/resources/frontend"
PORT=18398 HOSTNAME=127.0.0.1 NODE_ENV=production BACKEND_URL=http://127.0.0.1:9 \
  LLM_API_URL=http://127.0.0.1:8899 LLM_API_KEY=sk-test LLM_MODEL=mock-model LLM_API_TYPE=openai \
  node server.js
node docs/diagnoses/narration-direct-chat-fails-packaged-desktop/repro/probe.js 18398
```

实测输出（**关键证据**）：

```
[probe] HTTP 200 content-type=text/event-stream
[probe] content-encoding=(none) transfer-encoding=chunked
[probe] +88ms   chunk: ": stream-start\n\n"
[probe] +106ms  chunk: "data: {\"content\":\"你好\"}\n\n"
[probe] +517ms  chunk: "data: {\"content\":\"，这是\"}\n\n"
[probe] +923ms  chunk: "data: {\"content\":\"逐块解说。\"}\n\n"
[probe] +1337ms chunk: "data: [DONE]\n\n"
```

→ **打包构建里 `/api/chat` 的流式管道完全正常**：chunk 间隔 ~400ms 与 mock 一致（**不是**末尾一次性吐出 → 无缓冲）、`content-encoding` 为空（SSE 未被 `compress:true` 压缩缓冲）。**唯一变量是凭证：有则 200 流式，无则 500。**

---

## 三、根因分析（含证据）

### 3.1 先证伪「过期快照（R-A）」：当前桌面 bundle 是全新构建，已含全部修复

```
desktop/release/win-unpacked/resources/frontend/.next/BUILD_ID = ES-qfCr-OCfECLXmLIspQ
.next/server/app/api/chat/route.js                 修改时间 2026-06-15 01:49（今天）
.next/server/app/api/chat/                         路由存在、已编译
```

构建时间晚于 `bb53f3f`(06-14)/705d488/5ea20e9，故 R-A 不再适用。**dev 与打包跑的是同一份业务代码**，差别只在「运行环境与凭证来源」。

### 3.2 真因：桌面端三条 LLM 凭证来源在全新安装上同时为空

`/api/chat` 解析凭证的顺序（先问后端 resolve，失败再回退环境变量）：

```ts
// src/app/api/chat/route.ts:35-44   先问后端
const res = await fetch(backendConfig.joinPath('/api/model-settings/resolve/chat'), {...})
if (res.ok) {
  const data = await res.json()
  if (data.success && data.api_key) { return { apiUrl: data.api_url, apiKey: data.api_key, ... } }
}
// src/app/api/chat/route.ts:60-69   再回退环境变量
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY
if (!apiKey) {
  throw new Error('尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置 ...')   // ← 场景 A 命中这里
}
```

后端 `resolve/chat` 的取值同样是「**DB 指派 → 否则后端自身环境变量**」：

```py
# backend-services/basic-service/app/services/model_settings_service.py:574-601
if assignment and assignment.provider:           # ① DB 里有 ModelAssignment（用户在 设置→模型设置 配过）
    return ResolvedConfigResponse(api_key=***REMOVED***, ...)
settings = get_settings()                          # ② 否则回退后端环境变量
env_map = { ModelFunctionType.CHAT: (settings.llm_api_url, settings.llm_api_key, ...) }  # = LLM_API_URL / LLM_API_KEY
```

于是三条来源在桌面端的真实状态：

| 凭证来源 | dev（`npm run dev`） | 打包桌面端（全新安装） |
|---|---|---|
| **后端 DB 指派**（`ModelAssignment`） | 看开发机是否配过，通常配过 | **空**（`userData/data/*.db` 是全新空库，无指派） |
| **后端环境变量** `LLM_API_KEY` | **有真实值** ← 读 `backend-services/basic-service/.env`（实测 `LLM_API_KEY=<存在>`、`LLM_API_URL=https://open.bigmodel.cn/api/anthropic`） | **空** ← 注入的是 `userData/.env`，占位符被剔除（见 3.3） |
| **前端环境变量** `LLM_API_KEY`（route.ts 回退） | next dev 会自动加载仓库根 `.env*`（本机虽无 `.env.local`，但 dev 路径走的是后端 resolve，已命中上一行） | **空** ← bundle 里 `.env*` 被剥离 + 注入的 `userEnv` 占位符已剔除 |

**dev 之所以"不配置也能用"，是因为开发机的后端 `.env` 自带真实 `LLM_API_KEY`**（场景 B 证明：只要这一条非空，`/api/chat` 立刻 200 流式）。打包桌面端把这条来源换成了「占位符 + 空 DB」，于是三条同时为空 → 抛错 → 500。

### 3.3 桌面端为何凭证全空：打包/注入链路的两处「有意剥离」

**(1) 前端 standalone bundle 主动剥掉所有 `.env*`**（不让开发者密钥随包外泄）：

```js
// desktop/scripts/prepare-frontend.js:59-64
for (const name of fs.readdirSync(destDir)) {
  if (name === '.env' || name.startsWith('.env.')) {
    fs.rmSync(path.join(destDir, name), { force: true })   // stripped .env from bundle (secrets must not ship)
  }
}
```

→ 桌面端 `server.js` 启动时**没有任何 `.env` 可读**，`process.env` 只剩主进程注入的那些。

**(2) 主进程注入 `userData/.env` 时，占位符值被整体剔除**：

```js
// desktop/main/envCheck.js:14         占位符模式
const PLACEHOLDER_PATTERN = /^your_[a-z0-9_]*$/i
// desktop/main/envCheck.js:52-63      loadUserEnv：占位符不进子进程
for (const [key, value] of Object.entries(raw)) {
  if (PLACEHOLDER_PATTERN.test(String(value).trim())) continue   // ← LLM_API_KEY=your_llm_api_key_here 被丢弃
  env[key] = value
}
```

而首启复制进 `userData/.env` 的模板里，`LLM_API_KEY` 正是占位符：

```bash
# desktop/scripts/env.template.desktop:23
LLM_API_KEY=your_llm_api_key_here       # ← 占位符，被 loadUserEnv 剔除
```

注意 `backfillUserEnv`（envCheck.js:91-119）只会把占位符回填成「**模板里有真实值**」的键；模板里 `LLM_API_KEY` 自己就是占位符，故**不会被回填**（template 侧 `PLACEHOLDER_PATTERN` 命中即跳过，:113）。

这两条注入进前端：

```js
// desktop/main/frontendService.js:21-29
env: { ...process.env, ...userEnv,   // userEnv 已剔除占位符 → 不含 LLM_API_KEY
       ELECTRON_RUN_AS_NODE:'1', NODE_ENV:'production', PORT:..., HOSTNAME:'127.0.0.1',
       BACKEND_URL:`http://127.0.0.1:${backendPort}` }
```

**结论**：全新安装的桌面端，前端 `process.env.LLM_API_KEY` 与后端 `settings.llm_api_key` **都为空**，后端 DB 也无指派 → `/api/chat` 必 500。这正是「dev 正常、打包不正常」的根因。

### 3.4 次生代码缺陷：可操作错误被吞成无信息量的 500

即便凭证缺失是**设计内**（不随包发 LLM key），`/api/chat` 当前的报错方式也是真实缺陷 —— 它**生成了**指向解法的中文提示，却被外层 `catch` 吞掉：

```ts
// src/app/api/chat/route.ts:96-109   getConfig() 在外层 try 内被调用
const config = await getConfig()      // ← 抛 "尚未配置 AI 模型凭证,请前往 设置 → 模型设置 ..."
// src/app/api/chat/route.ts:201-208   外层 catch 把它压成通用 500
} catch (error) {
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })   // ← 可操作信息丢失
}
```

前端拿到 500 后只能给出无指向的提示：

```ts
// src/components/video/hooks/useNarrationChat.ts:167-169
if (!resp.ok || !resp.body) { throw new Error(`Chat request failed: ${resp.status}`) }
// src/components/video/hooks/useNarrationChat.ts:236-238
} else if (errorMessage) { summary = `${isZh ? '改写失败：' : 'Rewrite failed: '}${errorMessage}` }
// → 右侧气泡：「改写失败：Chat request failed: 500」，左侧空白
```

用户因此**完全看不到「请前往 设置 → 模型设置 完成配置」**，只能盯着「500」不知所措 —— 这放大了"打包不正常"的体感。

### 3.5 旁证/次要缺陷：后端 resolve fetch 无超时

```ts
// src/app/api/chat/route.ts:35     无 AbortSignal/timeout
const res = await fetch(backendConfig.joinPath('/api/model-settings/resolve/chat'), { method:'GET', ... })
```

场景 A 中对不可达后端干等 ~26s 才回退（`+26374ms`）。真实打包环境后端可达，故一般很快；但后端慢启动/不健康时，第 1 步会长时间"像卡死"，与"无反应"体感叠加。属健壮性缺陷，非本轮主因。

### 3.6【评审补充·子任务 #1】补全证据链：凭证全空时后端仍启动、resolve 仍返回 200，校正"真实桌面分支"

> 评审复核根因时发现两处证据缺口，补齐后证据链闭合。

**(1) 排除关键反证——"后端必填 LLM key、缺失则起不来"是过期描述。** `CLAUDE.md` 旧注称 `llm_api_key`/`llm_api_url` 必填、无默认、缺失则 app 无法启动；若属实，桌面端后端将根本不启动，根因链需改写。实测代码证伪：`get_settings()` 对二者都给了空串兜底，后端在凭证全空时**照常启动**：

```py
# backend-services/basic-service/app/config.py:1042-1043
llm_api_key=os.getenv("LLM_API_KEY", ""),   # 缺省 ""，并非必填
llm_api_url=os.getenv("LLM_API_URL", ""),
```

与 `desktop/main/envCheck.js:5-8` 注释「Round 3: these keys are no longer a startup gate — the backend only logs a warning when they are empty」一致。→ 桌面端后端**会起来**，故 `/api/chat` 的 resolve fetch 在真实环境是**可达**的（区别于 §2.2 场景 A 的人为不可达）。

**(2) resolve 端点在凭证全空时返回 HTTP 200 + success=True + api_key=""**（而非 4xx/5xx）——这正是 `route.ts:42-44` 的 `if (data.success && data.api_key)` 因 `api_key` 为空而落空、从而 fall-through 到 env 回退的前提：

```py
# backend-services/basic-service/app/routers/model_settings_router.py:192-200
@router.get("/resolve/{function_type}") ...
    config = await model_settings_service.get_effective_config(function_type)
    return config                       # 正常路径返回 200（仅内部异常才 raise 500）
# backend-services/basic-service/app/services/model_settings_service.py:634-643
return ResolvedConfigResponse(success=True, source="environment", api_key=api_key, ...)
#                              ↑ success 恒真    ↑ api_key = 空 env → "" / None（falsy）
```

**(3) 校正"真实桌面端"的精确执行分支。** §2.2 场景 A 用**不可达**后端取证，命中的是 `route.ts:55-57` 的 `catch`（日志「falling back to env vars」）；而**真实打包桌面端后端可达**，命中的是 `route.ts:42-44` 的「resolve 成功但 key 空」fall-through。两条分支**收敛到同一抛错点**：

| 步骤 | 真实打包桌面端（后端可达、凭证空） | §2.2 场景 A 取证（后端人为不可达） |
|---|---|---|
| resolve fetch | 成功，`res.ok === true` | 抛网络错 |
| route.ts:42-44 | `data.success` 真但 `data.api_key` 为空 → 条件假 → **跳过 DB 命中** | — |
| route.ts:55-57 | （不触发 catch） | `catch` → 打印「falling back to env vars」 |
| env 回退（:60-64） | `process.env.LLM_API_KEY` 为空 | 同左 |
| route.ts:65-68 | **抛「尚未配置 AI 模型凭证…」** | 同左 |
| route.ts:201-208 | 外层 catch → **HTTP 500** | 同左 |

→ 场景 A 的硬证据（`500` + 服务端 `尚未配置…` 日志）证明了**终态**；真实桌面端只是**上游分支不同**（resolve 成功但 key 空的 fall-through，而非网络 catch），最终在 route.ts:65-68 抛错、route.ts:201-208 吞成 500 处与场景 A **完全汇合**。**根因与终态判定无误，证据链闭合。**

---

## 四、影响面

| 维度 | 说明 |
|---|---|
| **直接受影响功能** | 「解说脚本」→「AI 生成」→「解说直接生成」第 1 步对话改写（`/api/chat`）。 |
| **同源连带** | 所有**直连 `/api/chat`** 的前端功能在桌面端同样依赖该凭证链路（如普通聊天 `ChatInterface`）；任何走 `resolve/chat` 的 LLM 功能在"全新安装且未配置模型"时一并失效。 |
| **受影响用户** | **全新安装、且未在 设置→模型设置 配置模型、也未手填 `userData/.env` 真实 LLM_API_KEY 的桌面用户** → 第 1 步必 500。 |
| **不受影响** | dev 运行（后端 `.env` 自带真实 key）；已在 设置→模型设置 配过模型的桌面用户（写入 `userData` DB 的 `ModelAssignment` 跨重启持久，resolve 直接命中 DB → 正常，场景 B 已证"有凭证即流式"）；手动把 `userData/.env` 的 `LLM_API_KEY` 改成真实值的用户。 |
| **数据/导出** | 仅影响第 1 步能否拿到文案；拿到后第 2 步拆句/导出不受此缺陷影响。 |

---

## 五、候选修复方案对比

> 真因是"桌面端无凭证"（设计上不随包发 LLM key），因此修复分两层：**A 让失败可操作**（最小代码改动，必做）、**B/C 让用户更容易拿到凭证**（产品/引导层）。

| 方案 | 做法 | 针对 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **A（推荐·首选，代码侧）** | 修 route.ts：把 `getConfig()` 抛出的「未配置凭证」错误**作为可识别的结构化响应**返回（如 `400/503` + `{ error_code:'LLM_NOT_CONFIGURED', message:'尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置' }`），不再被吞成通用 500；前端 `useNarrationChat` 收尾时优先展示该 `message`（而非 `Chat request failed: 500`），并可在面板内给「打开模型设置」入口。 | 3.4（吞错） | 低（route.ts 错误分支 + hook 收尾分支） | 低 | 小 |
| **B（推荐·叠加，引导层）** | 在「解说直接生成」第 1 步（或全局首启）检测 `resolve/chat` 无凭证时，弹出/内嵌**模型设置引导**（index.js 既有"in-app setup guide"机制，envCheck 也已上报 `missing`）。把"打包后第一次用 AI 必须先配模型"显式化。 | 真因（无凭证） | 中（需接 UI 引导） | 低 | 中 |
| **C（产品决策，非代码节点决定）** | 随包内置一把**可用的默认 LLM 凭证**（类似模板已为 `VOLCANO_TTS_RESOURCE_ID` / ROOT 内置默认值的做法），让开箱即用。 | 真因（无凭证） | 低（改模板/注入） | **高**：公网分发真实 API key 有**泄露 + 成本滥用**风险；与 prepare-frontend「secrets must not ship」原则冲突。 | 小 |
| **D（叠加，健壮性）** | 给 route.ts:35 的后端 resolve fetch 加超时（如 5s）+ AbortSignal，避免后端不健康时第 1 步长时间"卡死"（§3.5）。 | 3.5（无超时） | 低 | 低 | 极小 |
| E（否决） | 在桌面端"回填"占位符为某个假/示例 key 以绕过 `!apiKey` 判断。 | — | 低 | **高**：会把"未配置→清晰报错"变成"调用时 401/乱码"，更难排查；违背 envCheck"占位符绝不注入"的设计。 | 小 |

---

## 六、推荐方案与理由

1. **首选 A（代码侧最小修复，必做）**：本轮唯一**确定该落地的代码改动**。当前 `/api/chat` 已经生成了精准的「请前往 设置 → 模型设置」提示，却被 `route.ts:201-208` 吞成 `500 Internal server error`，用户只看到「改写失败：Chat request failed: 500」。把它改为**可识别的结构化错误并在前端如实呈现**，能立刻把"打包后莫名其妙失败"变成"明确告诉你去配模型"，从根上消除"不正常"的困惑，且**不触碰已验证正常的流式主路径**（场景 B），回归风险极低。

2. **叠加 B（首启/首次用 AI 的模型设置引导）**：真正让用户"拿到凭证"。桌面端按设计不随包发 LLM key，所以"配置一次"是必经步骤；把它从"用户自己摸索"变成"被引导完成"，才是体验闭环。属 UI/产品改动，建议与 A 一起排期。

3. **叠加 D（resolve fetch 加超时）**：顺手堵掉 §3.5 的"后端不健康时第 1 步卡死"，改动极小。

4. **C 交产品决策、E 维持否决**：C（内置默认 key）能"开箱即用"但有真实的密钥泄露/成本风险，需产品权衡，非代码节点单方决定；E 会把清晰报错退化成更隐蔽的运行期失败，明确否决。

> 交接子任务 #1（评审）/ #2（实现）：
> - 评审请确认"全新安装的桌面端三条凭证来源是否确实同时为空"（可按 §2.2 场景 A 复跑，或核 `userData/.env` + `userData/data/*.db` 是否无指派）；
> - 实现侧若只允许一处代码改动，落 **A**：`src/app/api/chat/route.ts` 错误分支返回结构化「未配置」错误（区分于真正的 500），`src/components/video/hooks/useNarrationChat.ts` 收尾分支优先展示该 message；**不得**把占位符当真实 key 注入（守住 envCheck 边界），**不得**回滚 `bb53f3f`/705d488/5ea20e9，**不得**随包发真实 LLM key；
> - 改完按 §2.2 两个场景各回归一次（无凭证→可操作提示；有凭证→200 流式）。

---

## 七、关键证据索引（file:line，均对当前 HEAD / 当前打包产物）

- **打包构建为全新**：`desktop/release/win-unpacked/resources/frontend/.next/BUILD_ID`、`.../app/api/chat/route.js`（mtime 2026-06-15 01:49）→ 证伪 R-A。
- **现场复现（硬证据）**：§2.2 场景 A `HTTP 500 {"error":"Internal server error"}` + 服务端 `尚未配置 AI 模型凭证…`；场景 B `HTTP 200 text/event-stream`、chunk 间隔 ~400ms、`content-encoding=(none)` → 打包流式管道正常、唯一变量是凭证。
- `src/app/api/chat/route.ts:35-44` — 先问后端 `resolve/chat`，仅当 `data.success && data.api_key` 才用。
- `src/app/api/chat/route.ts:60-69` — env 回退；`!apiKey` 时抛「尚未配置 AI 模型凭证…」。
- `src/app/api/chat/route.ts:201-208` — 外层 `catch` 把该错误吞成通用 `500 Internal server error`（§3.4 缺陷）。
- `src/app/api/chat/route.ts:35` — 后端 resolve fetch **无超时**（§3.5 次要缺陷，场景 A 干等 ~26s）。
- `backend-services/basic-service/app/services/model_settings_service.py:574-601` — resolve = DB 指派 → 否则后端 env（`settings.llm_api_url/llm_api_key`）。
- `backend-services/basic-service/.env`（实测含真实 `LLM_API_KEY`、`LLM_API_URL=https://open.bigmodel.cn/api/anthropic`）— **dev 的凭证来源**。
- `desktop/scripts/prepare-frontend.js:59-64` — 前端 bundle 剥离所有 `.env*`。
- `desktop/main/envCheck.js:14`、`:52-63`、`:113` — 占位符模式 + `loadUserEnv` 剔除占位符 + `backfillUserEnv` 对"模板侧也是占位符"的键不回填。
- `desktop/scripts/env.template.desktop:23` — `LLM_API_KEY=your_llm_api_key_here`（占位符）。
- `desktop/main/frontendService.js:21-29` — 注入 `...userEnv`（已剔除占位符）+ `BACKEND_URL`，故前端 `process.env.LLM_API_KEY` 为空。
- `src/components/video/hooks/useNarrationChat.ts:167-169`、`:236-238` — 500 → 「改写失败：Chat request failed: 500」（用户实际看到的文案）。
- 历史对照：`docs/diagnoses/narration-direct-left-panel-not-streaming/analysis.md`（上一轮 R-A/R-B/R-C 定位；本轮 R-A 已消除、聚焦 R-C 的环境实证）。

### 复现辅助脚本（随本报告附在 `repro/` 子目录）

- `repro/mock-llm.js` — OpenAI 兼容 SSE mock（:8899，每 400ms 一块 content，末尾 `[DONE]`）。
- `repro/probe.js` — 向指定端口 POST `/api/chat` 并对每块到达打时间戳，用于区分"流式"与"缓冲"。

---

## 评审结论（子任务 #1 评审）

> 评审人：Anthropic 工程团队资深评审（子任务 #1）。已对 §一~§七 逐条复核源码引用、复现方法与候选方案；补充证据见 §3.6。结论：**根因成立、证据链闭合，最终推荐方案 A**。

### 一、根因复核 —— 通过（airtight）

逐条核对引用，全部与当前 HEAD 源码一致；关键事实独立验证如下：

1. **桌面端三条凭证来源在全新安装上确实同时为空**，且该状态是**设计内**（不随包发密钥），证据完整：
   - 前端 bundle 被剥 `.env*`（`prepare-frontend.js:59-64`，已核对）；
   - 主进程注入 `userData/.env` 时占位符被剔除（`envCheck.js:14/52-63`），模板侧 `LLM_API_KEY` 自身即占位符故 `backfillUserEnv` 不回填（`envCheck.js:106-113` + `env.template.desktop:23`，已核对）；
   - 后端 DB 为全新空库 → 无 `ModelAssignment`（`model_settings_service.py:564-593` 命中失败 → 走 env 回退，已核对）。
2. **"后端必填 LLM key、否则起不来"这一可能推翻根因的反证已被排除**：`config.py:1042-1043` 对 `llm_api_key/url` 给空串兜底，后端凭证空照常启动（CLAUDE.md 旧注已过期）。见 §3.6(1)。
3. **失败终态成立且唯一变量是凭证**：§2.2 场景 A（无凭证→500 + 服务端 `尚未配置…`）/ 场景 B（有凭证→200 `text/event-stream`、chunk 间隔 ~400ms、`content-encoding=(none)`）两次硬证据，证伪"缓冲/过期快照（R-A）/ 只产 reasoning（R-B）"等替代解释；repro 脚本（`probe.js` 逐块打时间戳、`mock-llm.js` 400ms 间隔）方法学正确。
4. **真实桌面端的执行分支已校正**（§3.6(3)）：真实环境后端**可达**，命中 `route.ts:42-44`「resolve 返回 200/success=True 但 api_key 空」的 fall-through；§2.2 场景 A 因人为不可达命中 `route.ts:55-57` catch。两分支在 `route.ts:65-68` 抛错、`route.ts:201-208` 吞成 500 处**完全汇合**——这是评审补全的最后一环，使证据链由"复现等价"升级为"真实路径精确闭合"。

**一句话根因**：全新安装的桌面端三条 LLM 凭证来源同时为空（设计内）→ `/api/chat` 的 `getConfig()` 在 `route.ts:65-68` 抛「尚未配置 AI 模型凭证…」→ 被外层 `catch`（`route.ts:201-208`）吞成无信息量的 `HTTP 500` → 前端 `useNarrationChat.ts:167-169/237-238` 只能显示「改写失败：Chat request failed: 500」、左侧空白。dev 之所以正常仅因开发机后端 `.env` 自带真实 key（场景 B 已证"有凭证即流式"）。

### 二、候选方案复核

- **A（结构化可操作错误，代码侧最小修复）—— 采纳为唯一推荐。** 抛错点（`getConfig()`）在**流开始之前**（`route.ts:109`，早于 `route.ts:115` 的 `ReadableStream`），故把它改成结构化非-500 响应**不触碰已验证正常的流式主路径**（场景 B），回归面极小。它与"上游 LLM 运行期错误"（`route.ts:139-173`，流内 200 + error data 块）是**两条独立分支**，互不干扰。
- **D（resolve fetch 加超时）—— 可作为同 PR 顺手硬化，但非"修复本 bug"所必需。** 仅治 §3.5 的"后端不健康时卡死"，与本轮主诉（打包后报错不可操作）正交；列为可选，不进入"单一推荐"。
- **B（首启/首次用 AI 的模型设置引导）—— 体验闭环，列为后续 UI 节点，本轮不做。** 它才能让用户真正"拿到凭证"，但属较大 UI 改动，超出"改动尽量小"的实现节点（子任务 #2）范围。
- **C（随包内置默认 key）—— 维持否决。** 公网分发真实 key 有泄露 + 成本滥用风险，且与 `prepare-frontend`「secrets must not ship」、`envCheck`「占位符绝不注入」的既有安全边界直接冲突。
- **E（占位符当假 key 注入绕过 `!apiKey`）—— 维持否决。** 会把"未配置→清晰报错"退化成"调用时 401/乱码"，更难排查。

### 三、最终推荐修复（单一）—— 方案 A

**在 `src/app/api/chat/route.ts` 让"未配置凭证"成为可识别的结构化错误，并在 `src/components/video/hooks/useNarrationChat.ts` 如实呈现其 message。**

实现契约（交子任务 #2）：

1. **后端路由 `route.ts`**：让 `getConfig()` 的"未配置"错误**可被外层 catch 区分**（推荐自定义错误并带稳定标识，如 `error.code === 'LLM_NOT_CONFIGURED'`；**不要**用错误中文串做模糊匹配——脆弱）。在 `route.ts:201-208` 外层 catch 中，对该类错误返回**非-500 的结构化响应**（建议 `HTTP 503` + `{ success:false, error_code:'LLM_NOT_CONFIGURED', message:'尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置' }`），其余未知错误仍返回原 `500 Internal server error`（保持现有契约不破坏）。
2. **前端 hook `useNarrationChat.ts`**：在 `:167-169` 的 `!resp.ok` 分支，先尝试读响应体 JSON 并取 `message`/`error`（需 `try/catch` 守卫：响应体可能非 JSON 或为空，失败时回退到旧的 `Chat request failed: ${resp.status}`），把它作为 `errorMessage` 透传到 `:237-238` 的收尾摘要——用户即可看到「改写失败：尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置」而非「…：500」。
3. **回归验收**（沿用 §2.2 两场景）：无凭证 → 返回结构化 503、前端显示可操作中文提示（**不再是裸 500**）；有凭证 → 仍 `200 text/event-stream` 逐块流式（主路径零回归）。
4. **守住边界**（与分析一致）：**不得**把占位符当真实 key 注入、**不得**随包发真实 LLM key、**不得**回滚 `bb53f3f`/`705d488`/`5ea20e9`。

**为什么是 A 而非"让它直接能用"**：桌面端"全新安装无凭证→LLM 失败"是**设计内的安全取舍**（C/E 已否决），不存在"无密钥也能跑通"的合法代码修复；因此本轮代码节点的正确目标，是把"打包后莫名其妙 500"变成"明确告诉用户去 设置 → 模型设置 配置"——这正是 A，且它是把**当前已生成、却被吞掉的精准提示**如实暴露出来的最小改动。功能层面的真正闭环（自动引导用户配置）是 B，建议作为后续 UI 节点单独排期。

> 范围提示（交付参考，不属本轮强制）：`/api/chat` 另有 3 个消费者——`src/components/chat/ChatInterface.tsx`、`src/components/video/hooks/useStoryboardChat.ts`、`src/components/video/utils/narrationSplit.ts`——它们同样会因这条凭证链路在全新桌面端遭遇相同的"吞成 500"。`route.ts` 侧的 A 修复对四者**一并生效**；前端"读 body message"的呈现改动，本轮只需覆盖本 bug 所在的 `useNarrationChat.ts`，其余三处可作为一致性跟进，不阻塞本轮验收。
