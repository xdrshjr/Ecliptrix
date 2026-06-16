# 桌面端聊天报「LLM upstream error: 401 invalid_api_key」—— 缺陷定位与分析

> 子任务「问题定位与分析」(Subtask #0) 产出。**本节只做定位与分析，不写修复代码、不提交。**
>
> 本轮现象（用户报告）：项目打包为桌面端后，聊天功能不可用，聊天接口持续报错；
> 而在桌面端目录下 `npm run dev` 时聊天正常。用户称**已在桌面端应用内正确设置了聊天模型的 API 凭证**，
> 但仍无法聊天。界面报错：
>
> ```
> 对话失败：LLM upstream error: 401（{"error":{"message":"Incorrect API key provided. For details,
> see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error","type":"invalid_request_error",
> "param":null,"code":"invalid_api_key"},"request_id":"33b66c4f-8306-9e0d-bd6f-a6142acc01c0"}）
> ```

---

## TL;DR（先给结论）

打包桌面端聊天 401 的根因是**两层叠加**，且与同目录下既有报告
`docs/diagnoses/narration-direct-desktop-empty-llm-401/` 的「错误被吞」缺陷**不同**（那个缺陷已修复，
所以本轮用户能**直接看到** 401 文案）：

1. **真因 A（凭证错配）—— 打包端实际使用的 `LLM_*` 是一组「跨服务商错配」**。
   运行时 `%APPDATA%\ecliptrix-desktop\.env`（即打包前端的环境变量来源）里：
   把一把**智谱 BigModel 形态**的 key（`102d06…`，49 位、非 `sk-`）配到了
   **阿里云 DashScope** 的 OpenAI 兼容端点 + `qwen3` 模型上。DashScope 自然以
   `invalid_api_key`（"Incorrect API key provided"，`help.aliyun.com/model-studio`）拒绝 → **401**。
   `npm run dev` 走的是**仓库根 `.env`** 里那把与 DashScope 匹配的有效 `sk-62…` key → 正常。

2. **真因 B（用户的「应用内设置」对聊天根本不生效）—— `/api/chat` 解析凭证时不透传鉴权，恒回退环境变量**。
   `/api/chat` 的 `getConfig()` 调用后端 `/api/model-settings/resolve/chat` 解析凭证时**不带任何
   session token**（`src/app/api/chat/route.ts:51-57`）；而该端点是**路由级 `require_admin`**
   （`model_settings_router.py:36-40`），无 token 直接 **401** → `res.ok` 为假 → **永远回退到
   `process.env.LLM_API_KEY`**（=上面那把错配的 env key）。
   因此用户在「设置 → 模型设置」里配置的 key（写入后端 DB）**从未被聊天采用**，聊天恒吃错配的 env key → 401。

> 这正是「**用户明明在应用内设置了凭证，却仍 401**」的机理：聊天的凭证解析路径**绕过了** DB 配置。
> 日志直证：运行时聊天用的 model/base/type（`qwen3` / dashscope / openai）**与 env 完全一致**、
> 而**不是**后端 `.env` / DB 里的值（`glm-5-turbo` / bigmodel / anthropic）——说明走的是 **env 回退**，DB 被绕过。

> 处理方向（详见第五、六节）：
> - **F-A（推荐·代码）**：让 `/api/chat` 的 resolve 调用**透传调用方 session token**，使「设置→模型设置」里配的 key 真正生效。
> - **F-B（必做·配置/构建）**：把打包所用 `LLM_*` 修成**自洽一组**（key/端点/类型/模型同属一个服务商）并**实跑鉴权确认 200**；同时**重置既有用户机的 `userData/.env`**（错配旧值不会自愈）。
> - 二者关系：F-A 让用户「应用内改 key 即生效」这条产品承诺成立；F-B 让**未在应用内配置的用户**走的 env 回退也不再天然 401。二者皆做才能彻底关闭这条失败路径。

---

## 一、问题描述

- **现象**：打包后的桌面客户端（运行 `Ecliptrix.exe`，前端为冻结的 Next.js standalone，监听
  `http://127.0.0.1:18320`）中，发起任意聊天（主聊天 `ChatInterface`）后，assistant 气泡显示
  **「对话失败：LLM upstream error: 401（…invalid_api_key…）」**。
- **限定条件（关键）**：仅在**打包桌面端**出现；`npm run dev`（`http://localhost:3000`）下聊天**正常**。
- **用户已做的操作**：在应用内「设置 → 模型设置」**已设置聊天模型的 API 凭证**，但仍 401。
- **与既有报告的区别**：同目录 `narration-direct-desktop-empty-llm-401` 报告的缺陷是「上游错误被前端 SSE
  解析器吞掉，化为『模型未返回任何内容』」。本轮报错文案是**真实的 401 内容**（来自
  `ChatInterface.tsx:430` 的「对话失败：」分支），说明那条吞错缺陷**已被修复**、错误已能如实抵达 UI；
  本轮要解决的是**为什么仍然 401**。

---

## 二、复现步骤

### 2.1 复现「桌面端失败」（用户路径）

环境：打包后的桌面客户端（`Ecliptrix.exe`，主进程拉起后端 :18321 + 前端 standalone :18320）。

1. 启动 `Ecliptrix.exe`，等待静默登录（默认 admin）。
2. 打开主聊天界面（Agent dock / Chat），输入任意问题（如「你好」），发送。
3. **观察**：assistant 气泡显示「对话失败：LLM upstream error: 401（{"error":{"message":"Incorrect API
   key provided…","code":"invalid_api_key"}…}）」。
4. **查日志坐实**：打开 `%APPDATA%\ecliptrix-desktop\logs\frontend.log`，可见（本机实测，今日 2026-06-16）：
   ```
   1798: [Chat API] Model: qwen3-next-80b-a3b-instruct
   1801: [Chat API] Calling LLM API (api_type=openai) base=https://dashscope.aliyuncs.com/compatible-mode/v1
   1804: [Chat API] LLM upstream error: 401 - {"error":{"message":"Incorrect API key provided...
         code":"invalid_api_key"},...}
   1805: [Chat API] 2026-06-16T07:11:49.963Z - Response failed: LLM upstream error: 401
   ```
   （07:11:49 / 07:12:38 / 07:12:44 连续三次复现，见 frontend.log:1798-1823。）

### 2.2 对照「dev 正常」（确认是环境/凭证差异，而非代码退化）

环境：`npm run dev`（:3000）。

1. 同样发起聊天。
2. **观察**：assistant 正常流式输出回答。
3. **机理**：dev 由 Next.js 读**仓库根 `.env`**，`process.env.LLM_API_KEY=sk-62…`（与 DashScope 匹配、有效）。

> 同一套代码、同一路由、同一 endpoint/model/type，唯一差别是 **API Key 与端点是否匹配**：dev 用有效匹配的，
> 打包用错配的。根因锁定在「环境/凭证」而非「聊天代码退化」。

### 2.3 最小复现（脱离 UI，直接打到运行中的桌面前端）

向运行中的桌面前端发一个聊天请求，直接观察上游 401：

```bash
curl -N -X POST http://127.0.0.1:18320/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"测试"}]}'
```

预期（节选）——错误如实出现在流里（这正是 `ChatInterface` 现在能显示「对话失败：401」的来源）：

```
: stream-start

data: {"error":"LLM upstream error: 401","message":"{\"error\":{\"message\":\"Incorrect API key provided...\",\"code\":\"invalid_api_key\"}...}"}

data: [DONE]
```

### 2.4 验证「DB 配置被绕过」（最小复现真因 B）

证明聊天没有走 DB、而是走了 env 回退：

1. 在「设置 → 模型设置」给「聊天 (chat)」分配一个**与 env 不同**的 model（例如 `glm-5-turbo`）。
2. 发起聊天，查 `frontend.log` 的 `[Chat API] Model: …` 行。
3. **观察**：该行仍打印 **env 里的** `qwen3-next-80b-a3b-instruct`，**不是** DB 里的 `glm-5-turbo`
   → 证明 `/api/chat` 根本没用 DB 配置（resolve 被 401 挡回，回退 env）。本机日志 frontend.log:1798/1807/1816
   一致打印 `qwen3-next-80b-a3b-instruct`，即为此佐证。

---

## 三、根因分析（含证据）

### 3.1 失败链路全貌（从点击到 401）

1. 前端 `ChatInterface.sendMessage()` 通过 `http.stream('/api/chat', …)` 发送（`ChatInterface.tsx:350`）。
   `http.stream` 默认 `requireAuth:true`，会从 localStorage 读 session token 并给请求加
   `Authorization: Bearer <token>`（`src/lib/api/http-client.ts:619-625`、`:643-645`）。
   **故 `/api/chat` 入站请求是带着用户 token 的。**
2. `/api/chat` 的 `getConfig()` 去后端解析凭证：`fetch(backendConfig.joinPath('/api/model-settings/resolve/chat'))`
   **只带 `Content-Type`、不带任何鉴权头**（`src/app/api/chat/route.ts:48-57`；该函数甚至**不接收 `request`
   参数**，无从拿到入站 token）。
3. 后端 `/api/model-settings/resolve/{function_type}` 所在路由是**路由级 `require_admin`**
   （`backend-services/basic-service/app/routers/model_settings_router.py:36-40`、`:194-199`）。
   无 token → `get_current_user` 直接抛 **401**（`app/dependencies/auth.py:81-92`）。
4. 因此 `res.ok` 恒为假（甚至走 `catch`），`getConfig()` **永远回退环境变量**
   （`route.ts:75-85`）：`apiKey = process.env.LLM_API_KEY`、`apiUrl = process.env.LLM_API_URL`、
   `model = process.env.LLM_MODEL`、`apiType = process.env.LLM_API_TYPE`。
5. 打包端这些 env 来自 `userData/.env`（见 3.3），是**错配组合**：智谱 key `102d06…` + DashScope 端点 + `qwen3`。
   key 非空 → 不触发 `LlmNotConfiguredError`（不报 503），照常发起上游调用（`route.ts:81-85`）。
6. `streamLlmChat → streamOpenAI` 用 `Authorization: Bearer 102d06…` POST DashScope `/chat/completions`，
   上游返回 **401**，`yield {kind:'error', status:401, message}`（`src/lib/llm/streamLlmChat.ts`）。
7. `/api/chat` 捕获 error → 以 `data:{error,message}` + `[DONE]` 下发到流里（`route.ts:176-186`，HTTP 早以 200 提交于 `:202`）。
8. `ChatInterface` 解析到 `parsed.error` → 置 `streamError` → 收尾显示
   **「对话失败：LLM upstream error: 401（…）」**（`src/components/chat/ChatInterface.tsx:389-396`、`:429-431`）。
   ——这一步与既有报告里「被吞掉」的旧行为相反，证明吞错缺陷已修，错误现已可见。

### 3.2 真因 A（凭证错配）：打包端 `LLM_*` 是跨服务商错配 → DashScope 401

**运行时实际加载的 `%APPDATA%\ecliptrix-desktop\.env`（脱敏：前缀/长度/SHA8；本机实测）**：

```
LLM_API_KEY       = 102d06… / len 49 / sha8 544ebc1f     ← 智谱 BigModel 形态(id.secret，非 sk-)
LLM_API_URL       = https://dashscope.aliyuncs.com/compatible-mode/v1   ← 阿里云 DashScope 端点
LLM_MODEL         = qwen3-next-80b-a3b-instruct          ← DashScope 模型
LLM_API_TYPE      = openai
FAST_LLM_API_KEY  = 102d06… / len 49 / sha8 544ebc1f     FAST_LLM_API_URL = …dashscope…compatible-mode/v1
```

**各来源 `LLM_*` 比对（脱敏）**：

| 来源 | LLM_API_KEY | LLM_API_URL | LLM_MODEL | TYPE | 谁在用 | 是否自洽/有效 |
|---|---|---|---|---|---|---|
| 仓库根 `.env` | `sk-62…/35/f9abae28` | dashscope compatible-mode | qwen3-next-80b | (openai) | `npm run dev` | ✅ key 与端点匹配，有效 |
| **运行时 `userData/.env`** | **`102d06…/49/544ebc1f`** | **dashscope compatible-mode** | **qwen3-next-80b** | **openai** | **打包前端 env 回退** | ❌ **错配**(智谱 key→DashScope)→401 |
| 后端 `basic-service/.env` | `102d06…/49/544ebc1f` | open.bigmodel.cn/api/anthropic | glm-5-turbo | anthropic | 打包合并源 / 后端运行时 | ⚠️ 自洽(智谱)，但需实跑确认有效 |
| `desktop/build/env.template.desktop` | `102d06…/49/544ebc1f` | open.bigmodel.cn/api/anthropic | glm-5-turbo | anthropic | 烘焙进新安装包，首启复制 | ⚠️ 自洽(智谱)，待实测 |
| `desktop/scripts/env.template.desktop`(占位) | `your_…/21`(占位) | dashscope compatible-mode | qwen3 | openai | 零配置构建回退 | — 占位符 |

**关键观察**：
- 运行时 `userData/.env` 仍是**老的 dashscope+智谱 key 错配**（与当前后端 `.env`/build 模板的
  `bigmodel/anthropic/glm` 已不一致）——说明它是**早期打包**复制下来后**从未更新**。
- `502... help.aliyun.com/zh/model-studio` 是 **DashScope** 的报错域名（不是智谱），与 `LLM_API_URL` 指向
  DashScope 一致：**把智谱 key 发到了 DashScope**，必 `invalid_api_key`。

**日志佐证运行时确实用的就是这套 env（即走了 env 回退、resolve 未命中 DB）**：
- `frontend.log:1801/1810/1819` — `Calling LLM API (api_type=openai) base=https://dashscope.aliyuncs.com/compatible-mode/v1`
- `frontend.log:1798/1807/1816` — `[Chat API] Model: qwen3-next-80b-a3b-instruct`（= env 值，非 DB 值）
- `frontend.log:1804/1813/1822` — 401，错误域名 `help.aliyun.com/zh/model-studio`（DashScope）

### 3.3 打包链路：错配 key 如何被烘焙进安装包，且为何不自愈

- **打包脚本以后端 `.env` 为 `LLM_*` 事实来源、覆盖根 `.env`**：`mergeEnv` 中只要后端值非空就覆盖根值
  （`desktop/scripts/prepare-env.js:54-61`），写进 `build/env.template.desktop`。
- **首次启动复制模板到 userData/.env**：`config.js:33-37` —— 仅当 `.env` **缺失**时 `copyFileSync`；
  升级/重装**永不覆盖**既有 `userData/.env`。
- **主进程把 userData/.env 透传给前端 standalone**：`frontendService.js:21-29`
  （`env: { ...process.env, ...userEnv, … }`），所以 `/api/chat` 的 `process.env.LLM_*` = userData/.env 的值。
- **错配旧值不会自愈**：`envCheck.js` 的 `loadUserEnv` 只剥离 `your_*` 占位符（`:52-64`、
  `PLACEHOLDER_PATTERN` `:14`）；`backfillUserEnv` **只回填仍是占位符的值**（`:106 if (!PLACEHOLDER_PATTERN.test(currentValue)) return line`）。
  而 `102d06…` 与 `dashscope` URL **都不是占位符** → 自愈逻辑整条跳过，错配长期驻留。
  ⇒ **重打包 / 重装救不回老用户**；必须主动重置那份 `userData/.env`。

### 3.4 真因 B（凭证解析绕过 DB）：`/api/chat` 不透传 token，用户的「应用内设置」对聊天不生效

- 对比：**走 BFF 代理的 model-settings 请求会透传鉴权**——`createPassthroughRoute` →
  `buildForwardedHeaders` 总是转发 `Authorization` 与 `x-session-token`
  （`src/lib/api/server/backend-proxy.ts:139-146`）。因此「设置 → 模型设置」的增删改查（保存 provider /
  assignment 到 DB）能通过 admin 鉴权、**用户确实能存进 DB**。
- 但 **`/api/chat` 是显式标注的 `SWEEP-EXCEPTION` 逃生通道**（`route.ts:6-21`），**不走** `createPassthroughRoute`；
  它自己 `fetch` 后端 resolve 时**不带 token**（`route.ts:51-57`）→ 被 `require_admin` 401 挡回 → 回退 env。
- 结果：**保存能（带 token，走代理）、解析不能（不带 token，自己 fetch）** 的不对称，使得用户在 DB 里配的聊天
  key **永远不被 `/api/chat` 采用**。这就是「应用内已设置凭证、聊天仍 401」的直接代码机理。
- 入站请求其实**带着可用 token**（3.1 第 1 点），`getConfig()` 只要把它转发出去即可让 DB 配置生效——这正是 F-A 的可行性依据。

### 3.5 为什么 dev 正常、打包失败（环境差异收敛）

- **dev**：`process.env.LLM_*` 来自仓库根 `.env`（`sk-62…` + dashscope + qwen3，三者匹配、有效）。
  resolve 同样被 401 挡回（require_admin），但回退到的这把根 env key 是**有效匹配**的 → 200，正常。
- **打包**：`process.env.LLM_*` 来自 `userData/.env`（智谱 key + dashscope + qwen3，**错配**）。
  resolve 同样回退 env → 但这把 env key 错配 → DashScope 401。

> 无论 resolve 是否走通，打包侧都回退到 `userData/.env` 的错配 key，所以**打包必 401**；dev 侧回退到根
> `.env` 的有效 key，所以**正常**。差异 100% 落在「env 回退取到的 key 是否与端点匹配/有效」。

---

## 四、影响面

| 维度 | 说明 |
|---|---|
| 直接受影响功能 | 打包桌面端**所有走 `/api/chat` 直连 LLM 的功能**（主聊天 `ChatInterface`、解说直接生成 `useNarrationChat`、分镜聊天 `useStoryboardChat`），均吃同一把错配 env key → 401。 |
| 连带受影响（同一把错配 key 的其它直连 LLM 路由） | `prompt-polish`、`script-keywords-generation`（本机 frontend.log:1757-1795 同样 401 invalid_api_key，都打 dashscope 端点）、`translate-search-query` 等。这些路由直接读 `process.env.(FAST_)LLM_*`，同样命中错配。 |
| 受影响用户 | **所有 `userData/.env` 携带这把错配 `102d06…`+dashscope 组合、又未真正改成有效匹配凭证的桌面用户**。因不自愈（3.3），老用户重装无效。 |
| 真因 B 的独立影响面 | 即使将来 env 修对，只要产品希望「用户在设置页改 key 即生效」，当前 `/api/chat` 不透传 token 会让该承诺**对聊天恒不成立**（永远吃 env，无视 DB）。范围：`/api/chat` 一条路由（及其三个前端消费者）。 |
| 不受影响 | `npm run dev`（用有效根 key）；走后端鉴权代理解析的其它 LLM 功能（如经后端 service 解析的视频编辑 agent）。 |
| 数据/导出 | 无数据损坏；纯属「功能不可用」。错误文案本轮已可读（吞错缺陷已修），不再误导。 |

---

## 五、候选修复方案对比

| 方案 | 做法 | 针对 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **F-A（推荐·代码）** | 让 `/api/chat` 的 `getConfig()` **接收入站 `request` 并透传其鉴权头**（`Authorization` / `X-Session-Token` / `ecliptrix-session-token` cookie）到 `/api/model-settings/resolve/chat`，使「设置→模型设置」里配的 chat key 真正被采用。无 token 时优雅降级回 env（保持现状）。 | 真因 B | 低（仅 `route.ts` 的 `getConfig` 签名 + 一处 fetch 头） | 低（正常流路径零改动；resolved key 仅服务端使用，不回传浏览器，无新泄露） | 小 |
| **F-B（必做·配置/构建）** | 把打包所用 `LLM_*` 修成**自洽一组**（key/端点/类型/模型同属一个服务商）并**实跑鉴权确认 200**：要么整组切回 DashScope（`dashscope/openai/qwen3` + 有效 `sk-` key），要么保持智谱（`bigmodel/anthropic/glm-5-turbo` + 有效智谱 key）。同时**重置既有用户机的 `userData/.env`**（删 `%APPDATA%\ecliptrix-desktop\.env` 令其按新模板重新复制，或经设置页/手改）。 | 真因 A | 无源码改动（构建/运维） | 中（需实跑确认 key 有效；勿再出现 dashscope 端点配智谱 key） | 小～中 |
| F-C（用户侧即时止血） | 手改 `%APPDATA%\ecliptrix-desktop\.env` 的 `LLM_*`/`FAST_LLM_*` 为有效自洽组合后重启；或（在 F-A 落地后）经「设置→模型设置」配置。 | 真因 A | 低 | 低 | 极小 |
| F-D（否决） | 让 resolve 端点对 chat 解析放开 `require_admin`。 | 真因 B | 低 | **高**：该端点会回吐含**明文 api_key** 的配置，去鉴权 = 凭证泄露。**否决**。 | — |

> F-A 与 F-B **不互斥、互补**：F-A 让「用户应用内配置即生效」成立（解决「设置了却没用」）；
> F-B 让**未配置 DB 的用户**走的 env 回退也是有效的（解决「为什么 401」）。只做 F-B 不做 F-A，用户在设置页
> 改的 key 对聊天仍无效、只能改 env；只做 F-A 不做 F-B，没在设置页配置的用户仍吃错配 env → 401。

---

## 六、推荐方案与理由

**推荐：F-A（`/api/chat` 透传 session token，让 DB 配置生效）+ F-B（修正打包 `LLM_*` 自洽并重置用户机 env）双管齐下；F-A 为本轮的核心代码交付物，F-B 为必做的配置/运维前置。**

1. **F-A 是直接回应「用户已在应用内设置凭证却仍 401」的最小代码修复。**
   证据链已坐实：入站 `/api/chat` 请求带着可用 token（`http-client.ts:643-645`），却被 `getConfig()`
   丢弃（`route.ts:51-57`）；而走代理的 model-settings 保存路径**会**透传 token
   （`backend-proxy.ts:139-146`），形成「能存不能读」的不对称。把入站鉴权头转发到 resolve 调用即可让
   DB 里的 chat 配置生效，正常流路径零改动、风险低，且不引入凭证回传浏览器的新泄露。
   - 实现要点：`getConfig(request)` 从 `request.headers` 取 `authorization` / `x-session-token`，
     并把 `ecliptrix-session-token` cookie 也作为兜底（与后端 `_extract_token` 的三种取法对齐，
     见 `auth.py:24-52`）；取不到则维持现有 env 回退（向后兼容、dev 不退化）。

2. **F-B 是恢复「未配置 DB 的默认可用性」的唯一途径，且必须实跑验证。**
   日志已证打包端发往 DashScope 的 key 错配（401 invalid_api_key），这无法靠前端改动救回。
   注意当前仓库后端 `.env`/build 模板已是 `bigmodel/anthropic/glm-5-turbo` + 智谱 key 的**自洽组合**，
   故「用当前仓库重打的新包」首启复制到 userData 的是自洽组合——但**该智谱 key 是否真有效需实现/运维节点
   实跑一次该端点鉴权确认 200**（本节点无法在不外泄密钥的前提下代验）。**严禁再出现 dashscope 端点配智谱
   key 这类错配。** 同时**既有用户机的错配 `userData/.env` 不会自愈**（3.3），必须主动重置。

3. **F-D（去鉴权 resolve）维持否决**：`model_settings_router.py:36-40` 的路由级 `require_admin` 守的是会
   回吐明文 api_key 的高危端点，去鉴权等于泄露凭证。

> 交接子任务（评审 / 实现）：
> - 评审请优先复核两条主链：① `/api/chat` 的 resolve 调用确实**不带 token**、被 `require_admin` 401、恒回退 env
>   （`route.ts:51-57` + `model_settings_router.py:36-40` + 日志 model=qwen3 与 env 一致）；
>   ② 运行时 `userData/.env` 确为**跨服务商错配**（智谱 key→DashScope）。
> - 实现侧落 **F-A**（`getConfig` 透传鉴权头；无 token 优雅降级；不削弱 resolve 鉴权、不去鉴权），
>   并推动 **F-B**（修正/实跑打包 `LLM_*` + 重置用户机 env）。
> - 回归（按第二节）：① 在设置页给 chat 配一个**有效**且与 env **不同**的 model → 发送后 `frontend.log` 的
>   `[Chat API] Model:` 应打印 **DB 配置的 model**、聊天正常（验证 F-A 生效、DB 不再被绕过）；
>   ② 清空 DB chat 配置、把 env 修成有效自洽组合并重置 userData/.env → 聊天正常（验证 F-B）。

---

## 七、关键证据索引（file:line / 日志行号）

**代码（均对当前 HEAD）**
- `src/components/chat/ChatInterface.tsx:350` — 聊天经 `http.stream('/api/chat', …)` 发送（默认带鉴权）。
- `src/components/chat/ChatInterface.tsx:389-396`、`:429-431` — 识别 `data:{error}` 错误块 → 收尾显示「对话失败：…」（吞错缺陷已修，401 可见）。
- `src/lib/api/http-client.ts:619-625`、`:643-645` — `stream()` 默认 `requireAuth:true`，给请求加 `Authorization: Bearer <token>`（故入站 `/api/chat` 带 token）。
- `src/app/api/chat/route.ts:48-57` — `getConfig()` 调 `/api/model-settings/resolve/chat` **只带 `Content-Type`、不带鉴权头**，且不接收 `request`（真因 B 核心）。
- `src/app/api/chat/route.ts:75-85` — 失败回退 env：`process.env.LLM_API_KEY/URL/MODEL/API_TYPE`；key 非空即不报 503。
- `src/app/api/chat/route.ts:176-186`、`:202` — 上游 error 以 `data:{error,message}`+`[DONE]` 下发；HTTP 早以 200 提交。
- `src/lib/api/server/backend-proxy.ts:139-146` — BFF 代理**总是转发** `Authorization` / `x-session-token`（对照：model-settings 保存路径能鉴权，故 DB 能写入）。
- `backend-services/basic-service/app/routers/model_settings_router.py:36-40`、`:194-199` — resolve 端点路由级 `require_admin`。
- `backend-services/basic-service/app/dependencies/auth.py:24-52`（token 三种取法）、`:81-92`（无 token → 401）。
- `desktop/scripts/prepare-env.js:54-61` — 打包时后端 `.env` 覆盖根 `.env` 的 `LLM_*`，烘焙进安装包模板。
- `desktop/main/config.js:33-37` — userData/.env 仅「缺失时复制」，升级/重装不覆盖（错配长期驻留）。
- `desktop/main/frontendService.js:21-29` — 把 userData/.env（`userEnv`）透传给前端 standalone（即 `/api/chat` 的 `process.env` 来源）。
- `desktop/main/envCheck.js:52-64`（loadUserEnv 仅剥占位符）、`:91-119`（backfillUserEnv 仅回填占位符 → `102d06…`/dashscope 非占位符，不自愈）。

**日志（本机实测，`%APPDATA%\ecliptrix-desktop\logs\frontend.log`，2026-06-16）**
- `:1798/1807/1816` — `[Chat API] Model: qwen3-next-80b-a3b-instruct`（= env 值，**非** DB/后端 glm 值 → 证明走 env 回退）。
- `:1801/1810/1819` — `Calling LLM API (api_type=openai) base=https://dashscope.aliyuncs.com/compatible-mode/v1`。
- `:1804/1813/1822` — `LLM upstream error: 401 … invalid_api_key … help.aliyun.com/zh/model-studio`（DashScope 报错）。
- `:1805/1814/1823` — `Response failed: LLM upstream error: 401`（07:11:49 / 07:12:38 / 07:12:44）。
- `:1757-1795` — `Script Keywords Generation` / `Prompt Polish` 同样 401 invalid_api_key（连带影响面）。

**Key/端点比对（脱敏）**
- 仓库根 `.env`：`sk-62…/35/f9abae28` + dashscope + qwen3（**有效匹配**，dev）。
- 运行时 `userData/.env`：`102d06…/49/544ebc1f` + **dashscope** + qwen3 + openai（**错配**，打包）→ 401。
- 后端 `.env` / build 模板：`102d06…/49/544ebc1f` + **bigmodel/anthropic** + glm-5-turbo（自洽智谱，待实跑确认有效）。

---

## 八、与既有报告的关系（避免重复定位）

- 既有报告 `docs/diagnoses/narration-direct-desktop-empty-llm-401/analysis.md` 的核心代码缺陷是「上游错误被
  SSE 解析器吞掉 → 化为『模型未返回任何内容』」（缺陷 B / F2）。**本轮该缺陷已修复**：`ChatInterface.tsx:389-396`
  已识别 `data:{error}` 并显示「对话失败：…401…」，错误已可见。
- 那份报告的「真因 A（凭证错配）」与本轮**同源**（同一把 `102d06…`/sha8 `544ebc1f`，同样 dashscope 端点错配），
  但**仍未修复**：运行时 `userData/.env` 至今是 dashscope+智谱 key 的老错配（不自愈）。
- 本轮**新增并坐实**的角度（那份报告仅作为「可选增强 F3」提及、未列为主因）：**`/api/chat` 不透传 token →
  `require_admin` 401 → 恒回退 env，使用户的「应用内设置凭证」对聊天根本不生效**（真因 B）。这正是本轮用户
  描述「**已设置凭证却仍 401**」的直接机理，故本轮把它**升格为推荐的核心代码修复 F-A**。

---

## 九、评审补充证据（Reviewer 独立复核，2026-06-16）

> 本节由「分析报告评审与修复」(Subtask #1) 追加。评审节点**未依赖前一节点的「本机实测」转述**，而是**亲自重新读取
> 运行时文件与数据库**，对两条根因主链逐条复核。结论：证据链成立，且**新增一条决定性证据把 F-A 从「推荐」升格为
> 「对用户报告场景必要且充分」**。所有密钥仅以 前缀/长度/SHA8 形式呈现（脱敏）。

### 9.1 真因 A（凭证错配）— 评审亲读运行时 `userData/.env`，与原文逐项吻合

直接读取 `%APPDATA%\ecliptrix-desktop\.env`（评审机，2026-06-16）并脱敏比对：

```
LLM_API_KEY  = 102d06… / len 49 / sha8 544ebc1f   ← 非 sk-（智谱 BigModel 形态）
LLM_API_URL  = https://dashscope.aliyuncs.com/compatible-mode/v1   ← 阿里云 DashScope 端点
LLM_MODEL    = qwen3-next-80b-a3b-instruct
LLM_API_TYPE = openai
FAST_LLM_API_KEY = 102d06… / len 49 / sha8 544ebc1f   FAST_LLM_API_URL = …dashscope…/compatible-mode/v1
```

- 长度 49、SHA8 `544ebc1f`、前缀 `102d06`、**非 `sk-`**——与第三节 §3.2 表格中「运行时 `userData/.env`」一行
  **完全一致**。智谱形态 key 打到 DashScope 端点 = `invalid_api_key` 的必然结果。**真因 A 经评审独立证实。**

### 9.2 401 日志 — 用户报错的 `request_id` 在日志中精确命中（决定性时间线证据）

`grep` 运行时 `%APPDATA%\ecliptrix-desktop\logs\frontend.log`（评审机）：

- `invalid_api_key` 与 `help.aliyun.com/zh/model-studio` 各 **192 次**——持续性失败，非偶发。
- 失败三元组成对出现：`:1798/1807/1816 Model: qwen3-next-80b-a3b-instruct`（= env 值，**非** DB 值）→
  `:1801/1810/1819 base=…dashscope…/compatible-mode/v1` → `:1804/1813/1822 LLM upstream error: 401 invalid_api_key`
  （另有更早一组 `:639/642/645`）。
- **关键**：`frontend.log:1822` 的上游响应体里 `"request_id":"33b66c4f-8306-9e0d-bd6f-a6142acc01c0"`
  **与用户工单粘贴的报错 `request_id` 逐字符相同**。这把「用户看到的那一次失败」与「走 env 回退、打 DashScope、
  用 qwen3」的日志**钉死在同一条记录上**——不存在「另一个失败源」的替代解释。

### 9.3 真因 B 的决定性补强 — DB 里**确实存在**一条有效的 `chat` 分配，却被绕过

读取运行时 `%APPDATA%\ecliptrix-desktop\data\ecliptrix.db`（脱敏）：

| 表 | 内容 |
|---|---|
| `model_assignments` | `chat → deepseek-v4-pro → provider 285c0f5d…`；`fast → qwen3.6-35b-a3b → 285c0f5d…`；`video_cut/vision/coding → kimi provider` |
| `model_providers` | `285c0f5d… = {provider_type: alibaba, api_url: …dashscope…/compatible-mode/v1, api_key: sk-62… / len 35 / sha8 f9abae28}` |

- 用户**确实在「设置 → 模型设置」完成了 chat 分配**：聊天指向一个 **DashScope provider**，其 key 为
  **`sk-62… / len 35 / sha8 f9abae28`**——**与仓库根 `.env`（dev 用、有效）那把 key 的 SHA8 完全相同**
  （评审同时实测根 `.env`：`LLM_API_KEY = sk-62… / len 35 / sha8 f9abae28`）。
- **即：用户在应用内配置的 chat key，正是 dev 下能正常工作的同一把有效 key**；聊天之所以仍 401，**唯一原因**是
  真因 B 使 `/api/chat` 从不读这条 DB 分配（无 token → resolve 被 `require_admin` 401 → 回退到 env 的错配
  `102d06…`）。
- **推论（升格 F-A）**：对**本轮用户报告的具体场景**，F-A（透传 token 让 resolve 命中 DB）**既必要又充分**——
  resolve 一旦带 token 返回 `source="database"`，聊天就会改用 `deepseek-v4-pro @ dashscope` + 有效 `sk-62…`
  key（`model_settings_service.py:613-632` 直接回吐 `***REMOVED***` 明文）→ **200，聊天恢复**。
  F-B 对**这位用户**并非修复其报障的必要条件（其 DB 配置本就有效），而是面向「**未在应用内配置 DB 的用户**」的
  默认可用性兜底（见 §9.5）。

### 9.4 真因 B 的鉴权链复核 — 401 的发生**与 `AUTH_ENFORCE_DEFAULT_DENY` 取值无关**（更稳）

评审通读 `app/middleware/auth_middleware.py` 后修正/夯实一处机理（原文 §3.1 只点到 `get_current_user` 401，未展开
中间件分支，补全如下，使「无 token → resolve 401」对**任何配置**都成立）：

- `/api/model-settings/resolve/chat` **不在中间件 allowlist**（`auth_middleware.py:58-100/130-144`，exact 与 prefix 均不含），也**非** `HARD_PROTECT_PATHS`。
- 中间件 enforce 闸：`enforce = settings.auth_enforce_default_deny OR _is_hard_protected(path)`（`:240-241`）。
  - **若 `auth_enforce_default_deny` 为默认 `False`**：无 token 时中间件**放行**且**不设 `request.state.user`**
    （`:244-250`）→ 路由级 `Depends(require_admin)` 走 `get_current_user` 慢路径 → 无 token → **401**
    （`auth.py:77-92`、`:158-183`）。
  - **若该开关为 `True`**：中间件在 `:251-260` 直接 **401**。
  - **两种取值殊途同归 → resolve 必 401 → `route.ts:58` 的 `res.ok` 为假 → env 回退**。原文结论不受该 flag 影响，**更稳**。
- 对照组成立：BFF 代理保存路径 `backend-proxy.ts:139-146` **总是转发** `Authorization`/`x-session-token`，故
  「设置→模型设置」的**写**能过 admin 鉴权（DB 里确有 §9.3 的分配为证）；而 `/api/chat` 的 `getConfig()`
  （`route.ts:48-57`，函数签名**不接 `request`**）**不带 token** 的**读**被挡回——「**能存不能读**」的不对称经评审证实。
- 入站可用 token 确实存在：`ChatInterface.tsx:350` 走 `http.stream('/api/chat')`（默认 `requireAuth:true`，
  `http-client.ts:616/620-625/643-644` 加 `Authorization: Bearer <token>`）→ **F-A 的「转发入站 token」在工程上可行**。

### 9.5 对候选修复的评审性审查（边界、最小性、回归）

- **F-A 的最小性**：聊天的上游补全来自第三方 LLM、并非后端，故无法套用 `createPassthroughRoute`；把 token 转发进
  `getConfig` 内那一次 resolve `fetch` 是**改动面最小**的修法（仅 `route.ts` 的 `getConfig` 签名 + 一处 header）。
  「把整段 LLM 流式迁回后端」可消除转发但属大重构，非最小，**不取**。
- **F-A 的边界**：① **无 token**（真未登录）→ 维持 env 回退（向后兼容）；② **token 有效但非 admin** → resolve 403
  → 同样回退 env（桌面静默登录为 root/admin，命中正常路径；此为 resolve 端点既有的 admin-only 设计，非 F-A 引入）；
  ③ **token 有效且 DB 有 chat 分配**（本用户）→ 命中 DB，聊天恢复；④ **token 有效但 DB 无 chat 分配** → resolve
  回退到**后端进程 env**（桌面端后端同样吃 `userData/.env`，见 `backendService.js:30-32`）→ 若该 env 仍错配则仍
  401，需 F-B 兜底。建议实现取 token 时与后端 `_extract_token` 三法对齐（`Authorization` / `X-Session-Token` /
  `ecliptrix-session-token` cookie，`auth.py:24-52`）。
- **F-A 的回归风险（需在验收中显式覆盖，原文「dev 不退化」措辞需修正）**：F-A 会让**已登录会话**（dev 与打包**都**带
  token）的聊天**改由后端 resolve 决定配置**，而非沿用前端 `process.env`。即 dev 也会从「前端根 `.env` 回退」切到
  「后端 resolve（DB 优先，无则后端 env）」。故**原文 §3.5 / §六.1 的「dev 不退化」只在『无 token』前提下成立**，
  应改述为「**无 token 才回退 env；有 token 则统一走 resolve**」。验收必须确认：(a) 打包端聊天**实际命中 DB 的
  `deepseek-v4-pro`** 且 200；(b) dev 端 resolve 命中的配置（其 DB 分配或后端 `.env`）**有效**、聊天不退化。
- **F-D 维持否决（评审复核属实）**：`resolve_config` 在路由级 `require_admin` 之下回吐**明文** `api_key`
  （`model_settings_service.py:626` DB 分支、`:677` env 分支均 `api_key=` 明文）；去鉴权 = 明文凭证泄露。**否决成立。**
- **连带面**：`prompt-polish` / `script-keywords-generation` / `translate-search-query` 等直读 `process.env.(FAST_)LLM_*`、
  **不经 resolve**，F-A 不覆盖它们；它们恢复**只能靠 F-B**（修正 `userData/.env` 的 `(FAST_)LLM_*`）。这也说明
  F-B 并非可省——只是对「聊天」这一报障点而言，F-A 才是直接命中根因的修复。

---

## 评审结论（Review Verdict）

**最终推荐的单一修复：F-A —— 让 `/api/chat` 的 `getConfig()` 接收入站 `request` 并把其鉴权头
（`Authorization` / `X-Session-Token` / `ecliptrix-session-token` cookie）透传到
`/api/model-settings/resolve/chat`，使「设置 → 模型设置」里配置的 chat 凭证真正被采用；取不到 token 时维持现有
env 回退。F-A 作为本轮唯一的核心代码交付物。**

**理由（证据已闭合）**：

1. **F-A 对用户报告的场景「必要且充分」，已被评审独立坐实（§9.3）。** 运行时 DB 里**确有**一条 `chat` 分配，指向
   DashScope provider，其 key（`sk-62… / sha8 f9abae28`）**与 dev 正常工作的有效 key 逐位相同**。用户的「应用内
   设置」是**完整且有效**的；聊天仍 401 的**唯一原因**是 `/api/chat` 不透传 token → resolve 被 `require_admin`
   401（**与 `AUTH_ENFORCE_DEFAULT_DENY` 无关**，§9.4）→ 恒回退到 env 的错配 `102d06…` key。F-A 一旦让 resolve
   带 token 命中 DB，聊天即改用那把有效 key（`model_settings_service.py:613-632` 回吐明文 key）→ **200，恢复**。

2. **时间线无歧义（§9.2）。** 用户工单的 `request_id 33b66c4f-…` 精确命中 `frontend.log:1822`，且该次失败日志的
   `Model=qwen3`（env 值，非 DB 的 `deepseek-v4-pro`）+ `base=dashscope` + `invalid_api_key` 三者自洽——证明用户
   亲历的那一次失败**就是** env 回退路径，排除其它失败源。

3. **F-A 是最小且低风险的修法（§9.5）。** 仅改 `route.ts` 一函数签名 + 一处转发 header；resolved key 仅在
   Next 服务端使用、不回传浏览器，无新泄露；不削弱 resolve 鉴权（区别于被否决的 F-D，其会泄露明文 key）。

**对实现/验收节点的硬性约束**：

- **改动面**：只动 `src/app/api/chat/route.ts`（`getConfig(request)` 透传鉴权头）。**不改** resolve 端点鉴权、
  **不去鉴权**（F-D 永久否决）。token 取法与 `auth.py:24-52` 三法对齐；无 token 优雅回退 env。
- **必做回归（对应 §9.5 回归风险）**：
  1. 打包端发起聊天 → `frontend.log` 的 `[Chat API] Model:` 应打印 **`deepseek-v4-pro`（DB 值）而非 `qwen3`（env 值）**，且聊天 200 正常——即可证 F-A 生效、DB 不再被绕过；
  2. dev 端聊天仍正常（确认其 resolve 命中的 DB/后端 env 配置有效，无「有 token 后改走 resolve」导致的退化）。
- **F-B 的定位（不纳入本轮核心代码交付，但需在交接中点明）**：F-B 仅面向「**未在应用内配置 DB 的用户**」的 env
  回退兜底，以及 `prompt-polish` / `script-keywords` 等**不经 resolve** 的直读 env 路由（这些 F-A 不覆盖）。对**本轮
  报障用户**而言其 DB 配置本就有效，F-B 非其修复的必要条件。若团队要一并关闭默认 env 失败路径，再按 §五 F-B 修正
  打包 `LLM_*` 自洽并**实跑鉴权确认 200**、重置存量用户机 `userData/.env`（错配不自愈，`envCheck.js:91-119`）。

> 一句话定论：**本轮聊天 401 的根因是 `/api/chat` 解析凭证时丢弃了入站 session token（真因 B），令用户在 DB 里
> 配好的有效 chat key 被无视、恒回退到 `userData/.env` 的跨服务商错配 key（真因 A）。修复就落一处——F-A 透传 token
> 让 DB 配置生效；F-B 为可选的默认可用性兜底，不属本轮核心交付。**
