# 取证链接、探针与运行期接线点核验记录

> 对应 `spec.md` §3.6 / §3.9 / §7.3。本文件分两节：§A 由后端实现者（核验链接与探针）填写；§B 由前端实现者填写（运行期「去配置」接线点清单）。

## A. 链接与探针核验

**方法与局限（如实）**：2026-11-01，在开发机上用 `curl -L -A "Mozilla/5.0"`（无浏览器、无登录态、经本机代理）逐个请求。它只能证明「主机可达、路径没有 404、重定向去了哪里」，**不能**证明落地页就是创建 Key 的页面——控制台类页面几乎都在登录墙或反爬挑战之后。所以下表的「结论」分三档：**可达**（HTTP 2xx/3xx 且落地合理）、**可达·受保护**（返回 401/403 的反爬挑战或登录跳转，主机与路径存在但无法无头确认内容）、**已改**（发现规范主机变了，注册表已更新）。**仍需真人在打包版里点一遍**（§7.3 第 2 步）。

### A.1 取证链接

| 对象 | URL（注册表中的值） | 结果（2026-11-01） | 结论 / 处理 |
|------|--------------------|--------------------|-------------|
| tavily 控制台 / 文档 | `https://app.tavily.com/home`、`https://docs.tavily.com/` | 200 / 200 | 可达 |
| pexels 控制台 / 文档 | `https://www.pexels.com/api/`、`…/api/documentation/` | 403（Cloudflare 反爬，20 s 内可连通） | 可达·受保护；`/api/` 是 Pexels 官方 API 申请页的惯用路径 |
| unsplash 控制台 / 文档 | `https://unsplash.com/oauth/applications`、`https://unsplash.com/documentation` | 401（Anubis 反爬挑战）/ 200 | 可达·受保护（控制台）；文档 200 |
| freesound 申请 / 文档 | `https://freesound.org/apiv2/apply/`、`…/docs/api/authentication.html` | 200，申请页跳 `/home/login/?next=/apiv2/apply/` / 200 | 可达（需登录后回到申请页） |
| ark 控制台 / 开通管理 | `https://console.volcengine.com/ark/region:ark+cn-beijing/apikey`、`…/openManagement` | 200 / 200（SPA 外壳，未登录时由前端跳转登录） | 可达·受保护；落地内容需登录后确认 |
| ark 文档 | `https://docs.volcengine.com/docs/82379` | 302 → `/docs/ark?lang=zh`（原 `www.volcengine.com/docs/82379` 为 301 → 该主机） | **已改**：注册表与主机白名单由 `www.volcengine.com` 换成 `docs.volcengine.com` |
| 火山语音 控制台 | `https://console.volcengine.com/speech/app` | 200，未登录跳 `signin.volcengine.com/auth/login?redirectURI=…speech/app` | 可达（登录后回到语音应用页）；ASR 需在此新建「流式语音识别」应用，TTS 需在新版控制台建 API Key——**两者页面不同，见下「待真人确认」** |
| 火山语音 文档 | `https://docs.volcengine.com/docs/6561`、`…/6561/1167802` | 302 → `/docs/doubao-voice?lang=zh`、`/docs/doubao-voice/sound-replication-ord-erin-gand-usage-guide?lang=zh` | **已改**（同上换主机）；声音复刻下单说明页可达 |
| deepseek | `https://platform.deepseek.com/api_keys` | 403（反爬挑战） | 可达·受保护 |
| alibaba（百炼） | `https://bailian.console.aliyun.com/?tab=model#/api-key` | 根路径 200；`#/api-key` 为前端路由，无头不可验 | 可达·受保护 |
| zhipu / glm_coding | `https://open.bigmodel.cn/usercenter/apikeys` | 200 | 可达 |
| openai / codex | `https://platform.openai.com/api-keys` | 403（Cloudflare 挑战） | 可达·受保护 |
| anthropic / claude_coding | `https://platform.claude.com/settings/keys` | 200（原 `console.anthropic.com/settings/keys` 为 301 → 此处） | **已改**：注册表与白名单由 `console.anthropic.com` 换成 `platform.claude.com` |
| google | `https://aistudio.google.com/apikey` | 200，未登录跳 Google 账号登录 | 可达（登录后回到 Key 页） |
| kimi_coding | `https://www.kimi.com/code` | 200 | 可达（Kimi Code 产品页，与 `kimi_coding` 预置服务商一致） |

**待真人确认（已知不确定点）**：①Pexels / Unsplash / OpenAI / DeepSeek 因反爬无法无头确认落地页；②`console.volcengine.com/speech/app` 同时承载「新版 API Key」与「旧版流式识别应用 APP ID/Token」时是否在同一入口（本机只确认到登录跳转，没有火山账号）；③火山文档站对数字 ID 路径都是 302 到可读 slug，行为稳定，但 slug 可能随改版变化，数字 ID 仍是更稳的写法；④链接 404 时的回落：`GetCredentialLink` 只渲染白名单内的 https 链接，页面失效不会破坏应用，改注册表即可。

### A.2 连通性探针（`app/services/integration_probes.py`）

**核验方式（2026-11-01，真实上游、真机网络）**：起一个指向临时 SQLite 的真实后端进程（`uvicorn` + 测试用 cv2 桩），经 HTTP 调 `POST /api/integrations/{id}/test`，分别用 ① 随手编的**假 Key** 和 ② 回落到开发机 `.env` 里**已有的真实 Key**（应用内存储清空，走环境变量层）各测一次。真实 Key 只在后端进程内读取，没有打印、没有写入任何文件。TTS 探针真实合成了 1 个字（计费可忽略）。

| 集成 | 假 Key | 开发机 `.env` 真实 Key | 结论 |
|------|--------|-------------------------|------|
| pexels | `invalid_credentials`（~2 s） | `ok` | 端点与分类**已核实** |
| unsplash | `invalid_credentials` | `ok` | **已核实** |
| freesound | `invalid_credentials` | 探针一次 `unreachable`（10 s 超时，同机直接 `requests` 重试 200）；`Authorization: Token` **头认证实测 200，与原 `?token=` 查询串结果一致（count 相同）** | 头认证改动**已核实可用**；那次超时判为网络瞬时抖动（代理链路），未复现 |
| ark | `invalid_credentials`（401） | `ok` | 列任务端点存在且按预期区分有效/无效 Key；`ok` 仍**只代表 Key 有效**，未验证模型开通；403 → `not_entitled` 的分类未触发过，仍是推断 |
| volcano_tts | `invalid_credentials` | `ok`（真实合成 1 字） | **已核实**；`not_entitled` 各码只有单测映射，未在线触发 |
| volcano_asr | `invalid_credentials`：HTTP 401，体 `load grant: requested grant not found in SaaS storage` | **HTTP 403，体 `[resource_id=…] requested resource not granted`**——凭证被接受但该应用**未开通所选 ASR 资源** | **鉴权发生在握手阶段（已核实）**。这一发现推翻了 spec 里「握手 401/403 → invalid_credentials」的简化：403 + `not granted` 必须归 `not_entitled`，否则会把「凭证对、只是没开通流式识别」的用户误导去重填 Token。已改（`_classify_asr_rejection`，带单测）。握手**成功**路径（101）本机没有已开通 ASR 的凭证，**仍未实测** |
| volcano_voice_clone | 恒 `unverifiable` | — | 设计如此 |

另：资源 ID 填错时握手返回 400 `resourceId … is not allowed`，归 `upstream_error`（卡片里 resource 是下拉框，正常不会出现）。

### A.3 其他核实结论

- **`RESEARCH_RENDERER_ORIGIN` 注入**（评审未核实项①）：`desktop/main/backendService.js:48` 与 `frontendService.js:29` 都注入 `http://127.0.0.1:${frontendPort}`，`backendService.test.js` 有断言；打包版与 `desktop npm run dev` 的写接口来源校验因此一致。纯浏览器 `npm run dev`（3000 端口）走后端默认白名单 `localhost:3000/127.0.0.1:3000`；非 3000 端口的纯浏览器 dev 服务器仍会被后端拒绝，属既有行为，未改。

## B. 运行期接线点清单

机制（前端实现，2026-11-01）：

- **行内按钮** `ConfigureCta`（`src/components/integrations/ConfigureCta.tsx`）：有 JSX 可挂按钮的错误展示处直接渲染；点击派发 `ecliptrix-open-setup-wizard`（`detail.focus` = 集成 id），`page.tsx` 以 manual 模式打开向导并定位到该卡片。
- **全局提示** `reportCredentialMissing(error)`（`src/lib/credentialMissing.ts`）+ `CredentialMissingListener`（挂在 `page.tsx`）：只有「抛出的错误」而无处挂按钮的位置（服务层 / hook / toast）调用它；`error` 为 HTTP 409 `credential_not_configured`（读 `error_details.integration_id`），或旧信封 `TTS_CONFIG_MISSING` → `volcano_tts`、`ASR_NOT_CONFIGURED` → `volcano_asr` 时，弹出带「去配置」按钮的确认 toast（同一集成 4 秒内不重复）。非凭证错误返回 `false`，调用方原有的失败路径不变。
- 判定只看错误码与 `integration_id`（`notConfiguredIntegration`），不匹配英文消息。

| # | 位置（文件:行） | 集成 id | 触发条件 | 已接线 | 测试 |
|---|-----------------|---------|----------|--------|------|
| 1 | `src/components/video/components/VideoChatWindow/timeline/ToolStep.tsx:286`（`ConfigureCta`） | `volcano_tts` | Agent 工具 `generate_tts` / `batch_generate_tts` 失败且 `error_code === 'TTS_CONFIG_MISSING'` | 是（行内按钮） | `ToolStep.ttsError.test.tsx`：出现「去配置」并以 `volcano_tts` 调用；其他 TTS 错误不出现 |
| 2 | `src/components/video/ScriptPanel.tsx:464`（`reportCredentialMissing`） | `volcano_asr` | 字幕识别抛出 `ASR_NOT_CONFIGURED` / `credential_not_configured` | 是（全局提示） | 间接：`ConfigureCta.test.tsx`（别名映射 + 监听器）；ScriptPanel 本体未单测（体量过大，未新增） |
| 3 | `src/components/video/services/audioSearchService.ts:126` | `freesound` | 音效搜索返回 409 | 是（全局提示） | `credentialMissingWiring.test.ts` |
| 4 | `src/components/video/services/imageSearchService.ts:79` | `unsplash` | 图片搜索返回 409 | 是（全局提示） | `credentialMissingWiring.test.ts` |
| 5 | `src/components/video/services/videoSearchService.ts:190` | `pexels` | 视频搜索返回 409 | 是（全局提示） | `credentialMissingWiring.test.ts` |
| 6 | `src/components/video/hooks/materialManagement/useMaterialGeneration.ts:100` | `ark` | AI 视频：创建 Ark 任务 409 | 是（全局提示） | 间接：`ConfigureCta.test.tsx`；hook 本体未单测 |
| 7 | `src/components/video/hooks/materialManagement/useMaterialGeneration.ts:326` | `ark` | AI 图片生成 409（错误继续向上抛给弹窗） | 是（全局提示） | 同上 |
| 8 | `src/components/video/hooks/materialManagement/useMaterialGeneration.ts:343` | `ark` | 分镜生成 409 | 是（全局提示） | 同上 |
| 9 | `src/components/video/hooks/useAIVideoScriptGeneration.ts:235`、`:340` | `ark` | AI 视频脚本逐段生成：创建 Ark 任务 409（首帧模式 / 其余模式） | 是（全局提示） | 同上 |
| 10 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:2343` | `volcano_voice_clone` | AI 音频合成（声音克隆）409 | 是（全局提示） | 同上 |

**未接线（如实记录）**

| 位置 | 集成 id | 原因 |
|------|---------|------|
| `src/components/video/hooks/useAgentExecution.ts`（Agent 对话里的 TTS 文字提示） | `volcano_tts` | 该处只产出纯文本摘要；同一失败已在 #1 的工具步骤卡片里带按钮展示，重复加按钮需改动文本管线 |
| 逐句 TTS（`lib/api/tts.ts` → `SentenceTTSResult` 的脚本面板展示） | `volcano_tts` | 失败信息经多层 props 传到片段卡片，接入需要跨 5 个以上文件的类型改动，超出「不做大重构」的约束；后续可改为在 `lib/api/tts.ts` 的失败分支调用 `reportCredentialMissing` |
| `src/components/video/hooks/useStoryboardScriptGeneration.ts`（只轮询已有任务） | `ark` | 创建任务发生在 #6/#9 已接线的路径上，轮询阶段不会出现「未配置」 |
