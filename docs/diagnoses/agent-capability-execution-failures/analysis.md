# Agent 能力执行失败诊断

诊断及评审日期：2026-11-20。范围：任务图 Subtask #0「问题定位与分析」及 Subtask #1「分析报告评审与修复」。基准提交：`16599d90405ac0c293563eb87abc192664af35d6`，分析对象为执行时的磁盘工作区。

工作区开始时已有 SkillRouter、网络环境、设置界面等未提交修改。本节点保留这些修改，只新增本目录的报告、离线复现脚本与结果；未修改业务代码，未执行 Git 提交。

上述交付范围指定位节点；本次评审仅修改本 `analysis.md`，未修改业务实现、复现脚本或已有结果文件，未执行 Git 提交。评审补证、限制及唯一推荐方案见第 7 节和末尾「评审结论」。

## 1. 问题描述

用户希望 Agent 完成「新闻口播稿 → 写入解说脚本 → 下载素材 → 广东口音配音及 BGM → 60 秒剪辑」。日志反映了多个不同层次的问题，不能用一个供应商故障解释全部现象。

| 编号 | 日志现象 | 本次定位结论 | 优先级 |
|---|---|---|---|
| F-01 | 脚本扩写 HTTP 401；部分脚本调用 HTTP 500 | 扩写端点绕过数据库/SkillRouter 模型解析，固定使用环境变量和 OpenAI 协议 | P1 |
| F-02 | `Expanded 0/1` 后面板仍出现文案，随后配音文本校验失败 | 缺少纯脚本读写工具；扩写全失败仍写回；普通文本首行变成标题；同轮段落快照未更新 | P1 |
| F-03 | `No content received from LLM` / `Internal server error` | 共享流客户端丢弃流内错误，脚本路由掩盖传输异常；已确定错误处理缺陷，原现场上游响应仍待补证 | P1 |
| F-04 | 下载连续超时，随后「连续 5 次工具调用失败」及大量 `cancelled` | 不同下载的 transient 失败共用全局计数，达到 5 次中止整轮；取消是后续结果 | P1 |
| F-05 | 下载失败建议增大 `timeout_ms` | 下载工具与后端下载函数都没有该参数，建议无法执行 | P2 |
| F-06 | 音色参数无效、粤语失败后普通话成功，Agent 看不到可用音色 | 段落校验能在请求前拒绝错误输入；目录未通过 Agent 工具暴露；能力不可用与音色不可用的回退边界需要保持区别 | P1 |
| F-07 | 两个 Freesound 文件均 `robots_unavailable`，BGM 缺失 | unavailable 按 origin 缓存拒绝；现有错误码不足以断言源站 5xx。评审另发现 401/403 的 disallowed 缓存命中会漏拒绝，不能概括所有缓存状态都保守拒绝 | 现场诊断 P2；缓存漏拒绝 P1 |
| F-08 | 仅写文案也显示 `timeline_empty` 阻断 | 导出检查本身正确，交付检查缺少任务阶段边界；YOLO 结束规则无条件要求时间线无 blocker | P2 |

日志摘录（来源为用户提供的本轮 Agent 执行记录；新闻正文不参与软件诊断）：

```text
00:58 Script generation failed (HTTP 500): {"error":"Internal server error"}
00:58 Script generation failed (HTTP 500): {"error":"No content received from LLM"}
00:58 Expanded 0/1 scene(s) ... HTTP 401: {"error":"LLM API error: 401"}
01:01 upstream_timeout / retryable:true / sticky:false
01:01 Error: 连续 5 次工具调用失败，已停止。请查看失败步骤的具体原因。
01:02–01:07 TTS_INVALID_REQUEST / 错误来源：助手请求 / 实际尝试次数：0
01:07 TTS_PROVIDER_ERROR / provider_code:capability_unavailable / HTTP 503
01:07 robots_unavailable / failure_class:policy / retryable:false / sticky:true
```

## 2. 复现步骤

### 2.1 可复制的离线复现

前置条件：已有项目 npm 依赖及后端 requirements 环境。本次实际环境为 Node `v22.18.0`、Python `3.11.7`、Vitest `4.1.5`。命令从仓库根目录执行，不需要启动桌面应用、配置真实密钥、请求公网或支付供应商调用费用。

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
npx vitest run --config docs/diagnoses/agent-capability-execution-failures/repro/vitest.config.ts --reporter=verbose --reporter=json --outputFile=docs/diagnoses/agent-capability-execution-failures/repro/results.json
```

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
python docs/diagnoses/agent-capability-execution-failures/repro/backend_repro.py
```

结果：前端/工具层 **15/15** 用例通过；后端 **3/3** 断言通过，退出码均为 0。结果分别保存在 [repro/results.json](repro/results.json) 与 [repro/backend-results.json](repro/backend-results.json)。这些是**修复前行为的诊断断言**；绿色代表故障得到复现，不能作为修复已完成的证据。后续实现应将对应断言改为预期正确行为，并移入正式测试目录。

复现脚本直接导入实际路由、工具、事件订阅及规则引擎，仅替换 HTTP 返回和 Agent 事件输入；没有替换被诊断的业务实现。Python 脚本调用真实 `SafeHttpClient.check_robots()` 和错误映射函数，使用内存 HTTP 替身。后端模块导入会产生常规初始化日志。

**评审限定证据强度**：D3 只检查工具登记的 operation 和服务端快照，没有挂载 React 面板、执行 `AgentEventRouter` 或重新打开项目；D8/D9 直接注入五个不同 toolCallId 的结束事件，事件不含 URL，也未执行真实下载队列；D11 只调用空时间线规则引擎，没有注入任务意图或运行 YOLO。它们分别证明「失败仍登记写入」「分类后的全局计数」「空工程导出不可用」，完整 UI/网络/调度因果须结合第 3、7 节的调用链，不能声称这些用例已完成端到端验证。D4 的替身未设置 SSE Content-Type，仅证明当前解析器能读该格式，不能充当响应头校验的对照。

| 用例 | 输入/故障注入 | 当前实际结果 |
|---|---|---|
| D1 | 模型解析接口可返回有效配置，清空测试进程的环境密钥 | 扩写返回 500，`fetch` 调用次数为 0 |
| D2 | 环境声明 `api_type=anthropic`，模拟 401 | 扩写仍访问 `/chat/completions`，不访问模型解析端点 |
| D3 | 无标题的两行文案；扩写 API 全部返回 401 | `success:false`，同时记录 `set_script`；第一行成为标题；原段落快照不变 |
| D4 | 模型解析成功，返回完整 Anthropic SSE | 对照：生成接口 200，得到一段脚本 |
| D5 | HTTP 200 返回正常非流式 JSON | 生成接口 500：`No content received from LLM` |
| D6 | HTTP 200 SSE 中返回 `type:error` / rate limit | 原因丢弃，生成接口变成空内容 500 |
| D7 | 解析成功后，上游 `fetch` 抛网络异常 | 生成接口 500：`Internal server error`，缺少可操作类别 |
| D8 | 注入五个不同调用 ID 的 `download_url` transient 超时事件 | 第五个结果后调用整轮 `agent.abort()`，发出 `tool_failures`；不单独证明 URL 身份及真实下载队列行为 |
| D9 | 五个下载返回 policy 拒绝 | 对照：不会触发全局五次熔断 |
| D10 | 下载返回 `upstream_timeout` | 工具 schema 无 `timeout_ms`，返回建议却要求增大该值 |
| D11 | 调用导出规则检查空时间线 | `ok:false`，`timeline_empty` 为 blocker；任务意图未参与该用例 |
| D12 | 猜测的段 ID；或对正确段 ID 把标题拼到旁白前 | 均在 HTTP 前返回 `TTS_INVALID_REQUEST`，`attempts:0` |
| D13 | 粤语请求收到 `TTS_PROVIDER_ERROR/capability_unavailable` | 只请求一次，不触发工具的音色自动回退 |
| D14 | 完整脚本 JSON 的 SSE 后紧接 `type:error` | 流内错误被忽略，接口仍返回 200 / `success:true` |
| D15 | 模型解析返回明确的 `503/models_unavailable`，环境中有旧配置 | 静默调用旧环境端点；模拟上游 401 得到 401 |
| P1 | robots 第一次返回 503，同 origin 请求两个文件 | 两次均拒绝，只抓一次 robots |
| P2 | robots 抓取抛 `upstream_timeout` | 同样对外变成 `robots_unavailable` |
| P3 | 将 `RouterError(capability_unavailable,503)` 映射为 TTS 结果 | 得到 `TTS_PROVIDER_ERROR`，并非 `TTS_VOICE_UNAVAILABLE` |

### 2.2 交互流程复现与现场补证

在隔离项目及测试配置中按以下顺序操作，保留每个工具的完整 JSON，而不是只复制折叠后的提示。实际供应商结果会受账号权限、CDN、代理及模型协议影响；确定性的故障条件由 2.1 注入。

1. 启动 `desktop/` 的开发应用，选择通过设置或 SkillRouter 配置的模型；测试环境不依赖 `LLM_API_KEY/OPENAI_API_KEY`。确认普通 Agent 对话正常。
2. 新建空视频工程，输入「介绍今日 AI 热点新闻 TOP5 的抖音口播文案，先只写文案」。记录是否调用时间线检查并显示空时间线阻断。
3. 输入「写到解说脚本中」。若进入扩写路径，在没有环境密钥时观察 500；有失效旧环境密钥时可出现 401。记录脚本修改前后全文、段 ID、正文与旁白。
4. 使用离线上游替身提供五个不同媒体下载超时结果，观察第五个失败后整轮停止、剩余工具取消。真实 CDN 的超时不是稳定前置条件，应优先运行 D8。
5. 输入「剪辑一个 1 分钟的视频，广东口音，要有背景音乐」。保留 TTS 的 `segment_id/text/voice_type`、`attempts`、原始结构化错误，以及两个 BGM 地址的 origin 与 robots 诊断结果。
6. 最后检查实际工程：旁白语言、BGM 音轨、素材文件非零字节、时间线/导出回执分别验收。`check_timeline` 无 blocker 不能证明广东口音和 BGM 已达成。

需要补取的原现场证据：脚本生成上游的响应 Content-Type、脱敏 SSE 错误/终止事件、请求 ID及服务端堆栈；`/resolve/chat` 的状态、配置来源和 `api_type`（隐藏密钥）；robots 原始失败阶段与状态；音色目录的 `stale`。本节点未访问线上 SkillRouter、未运行安装包 UI，也未声称复现了供应商当时的实时状态。

## 3. 根因分析与证据

### F-01：扩写走了另一条配置链；生成端也存在解析失败后静默回退

`src/app/api/ai-video-script-expand/route.ts:3` 的 `getConfig()` 只读 `process.env`，`route.ts:115` 固定访问 `/chat/completions`，`route.ts:145` 固定读取 `choices[0].message.content`。它不获取设置面板保存的模型，也不分派 Anthropic 协议。

```typescript
// src/app/api/ai-video-script-expand/route.ts:4
const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
// src/app/api/ai-video-script-expand/route.ts:115
const response = await fetch(`${config.apiUrl}/chat/completions`, { /* ... */ });
```

对照路径：`src/app/api/ai-video-script-generation/route.ts:36` 查询 `/api/model-settings/resolve/chat` 并读取 `api_type`；`backend-services/basic-service/app/services/skillrouter/llm_overlay.py:101` 的 `resolve()` 为 router 模式返回网关地址、模型和协议。因此「主 Agent 能对话」与「扩写 401/500」可以同时成立。D1、D2 确认了故障条件。

此外，生成端 `src/app/api/ai-video-script-generation/route.ts:51` 只对一种 `MODEL_NOT_CONFIGURED` 错误暂存消息，随后在 `route.ts:61` 继续尝试环境配置；解析接口的网关拒绝也会走这条回退。D15 确认明确的网关配置失败可以变成旧端点 401。扩写应复用统一解析，但不能直接复制这项静默回退缺陷。

**确定性边界**：扩写的配置/协议绕行已经证实。原日志没有记录该次环境密钥和解析配置，不能判定现场 401 究竟由失效密钥还是错误协议最终触发；两者均在现有实现中可达。

### F-02：把「保存已有文案」委托给生成工具，失败与写入不原子

`src/lib/video-editing-agent/tools/index.ts:456` 的脚本分类只注册生成、扩写、理解视频脚本，没有独立的脚本写入/回读工具。日志中 Agent 为「原稿进入面板」选择生成、扩写路径，因而承担了额外 LLM 请求和没有必要的 401/500 依赖；工具缺口可以解释这个选择，但不证明模型只有这一种可能行为。

`src/lib/video-editing-agent/tools/expandVideoScript.ts:42` 对无标题文本的 split 仍返回一项；`expandVideoScript.ts:46` 把首行设为标题，`:47` 只把剩余行设为正文。因此 `:52` 的「无标题则整段作为正文」回退对普通非空文本不起作用。开场钩子进入标题后，TTS 严格按正文取词就会遗漏它。

更关键的是扩写失败处理：`:128` 等分支将原正文塞回结果，`:165` **无条件**记录 `set_script`，到 `:183` 才用 `successCount > 0` 决定失败。服务端 `src/lib/video-editing-agent/agent.ts:573` 仅在 `event.isError` 为真时丢弃 operation，没有因结构化 `success:false` 自动丢弃；客户端 `src/lib/video-editing-agent/AgentEventRouter.ts:280` 标记失败后，仍在 `:315` 的 operation 分支应用脚本。最终 `AgentEventRouter.ts:580` 调用 `store.setScriptContent()`。

所以日志里的「0/1 扩写，但面板已有内容」可以由应用代码直接解释，并非写入成功回执。全失败还可能覆盖用户当前脚本，应该由工具显式控制是否有合法的部分提交，不能用通用「失败就丢所有操作」破坏其他部分成功工具。

**补齐实际面板链路**：`src/stores/slices/scriptSlice.ts:65` 的 `setScriptContent()` 只更新临时 store；`src/components/video/VideoEditingInterface.tsx:746` 的 effect 随后在 `:754` 调用 `parseAgentScriptToSegments()`，在 `:783` 把解析结果交给 `onUpdateContent()`。解析函数 `:139` 再次将首行当标题，`:142` 只把余行生成句子，`:145` 使用按序号构造的 `agent-segment-${i}`，不保留原稳定 ID 或独立旁白。因此该故障路径不仅有服务端扩写解析问题，客户端旧文本路径还会重建身份；仅修改扩写解析器不足以保证段落关联。结构化对照路径在 `VideoEditingInterface.tsx:696` 保留 `id/narrationText`，并由 `:734` 发布。以上是静态可达链，原现场是否成功持久化仍须保存/重开回执证明。

D3 同时证实扩写没有同步 `context.scriptSegments`。对照 `src/lib/video-editing-agent/tools/generateVideoScript.ts:131` 会写入稳定 ID 的同轮快照，并用 `set_script_with_narration` 区分画面和旁白。扩写返回的 `content_preview` 在 `expandVideoScript.ts:186` 最多 200 字；它无法证明日志所述的 392 字全文已经被保存、回读及持久化。

### F-03：共享流解析器忽略流内错误；生成接口把不同异常合成 500

`src/lib/llm/streamLlmChat.ts:104` 和 `:182` 仅在 HTTP 非 2xx 时产出错误事件；OpenAI 分支 `:138` 只读 `choices[].delta`，Anthropic 分支 `:219` 只处理文本/思考增量与 `message_stop`。两者没有将 HTTP 200 流中的 error envelope 转为错误事件，也没有根据 Content-Type 识别 JSON 响应。

下游 `src/app/api/ai-video-script-generation/route.ts:314` 将积累内容为空转为 `500/No content received from LLM`；`:360` 的 catch 将网络异常变成 `500/Internal server error`。D4 的正常 SSE 可以通过，D5/D6/D7 分别复现上述三个失败条件。D14 还证明内容先到齐、错误后到时可以误报成功。

这里证实的是**错误吞并与契约判断缺口**。现场的那次空内容也可能是模型只返回思考、上游返回空增量等情况；没有实际响应体，无法进一步唯一归因。可读取的 aragon-router `src/app/api/v1/chat/completions/route.ts` 将请求交给 relay，未在入口强制改成非流式；没有证据可以认定「网关一定不支持 SSE」。

**评审补证**：两种分支均在 `src/lib/llm/streamLlmChat.ts:120`、`:201` 收到 EOF 时直接结束，未校验已见到终止事件，残余 buffer 也没有独立的错误判定。生成路由在 `src/app/api/ai-video-script-generation/route.ts:329` 仅解析积累的 JSON，因此「正文恰好构成 JSON 后连接提前结束」也可能成功；不能只增加 error-envelope 判断就认为截断流已覆盖。本次内存探针确认 OpenAI 正常 SSE 产出 content、流内 error 单独出现时产出空事件、正文后的 error 被忽略；无换行的截断尾帧产出空事件，有完整增量而无终止帧则仍产出 content。后两者是异常流边界观察，不把不完整 SSE 当成必须接受的有效响应，也不据此断言现场发生过截断。

### F-04：可重试读取的失败域扩大成整轮中断

`src/lib/video-editing-agent/agent.ts:340` 将阈值设为 5；`:587` 排除 configuration、blocked、cancelled、policy、validation、user_input 等类别，但**不排除 transient**。`:601` 使用同一个 `consecutiveFailures`，不区分工具调用、地址、主机或独立步骤；`:640` 直接 `agent.abort()`。

日志中某次成功下载之后连续出现多个不同地址的 `upstream_timeout`，随后全局停止，再出现剩余下载 `cancelled`，与该链路一致。D8 用真实订阅函数确认第五个注入的暂时性失败事件中断整轮；多个 URL 的事实来自现场日志，而非该用例。D9 确认 robots policy 拒绝本身不会增加该计数；`agent.ts:604` 同时表明此类拒绝也不会清零，只有真正成功才重置。不能通过把 robots 错误改为成功或删除熔断解决此问题。

**已有恢复机制不能重复实现**：`src/lib/video-editing-agent/tools/hostToolAdapter.ts:328` 已按操作路径、origin、规范化 pathname 建立分支；`:438` 防止同分支并发探测，`:446` 限制最多两次实际尝试并遵守 Retry-After，`:388` 保存失败和恢复记录。该层允许模型在条件满足时重试，不自动重放请求。`:165` 另有默认 60 次的每轮出口预算，且预算先于分支缓存检查扣减（`:435`）。因此应修复这些局部失败与全局熔断的衔接，复用现有计数和缓存，而不是再套一层重试。`egress_budget_exceeded` 当前也被归为 transient（`:170`），必须纳入同一失败域审查，防止预算用尽反而取消纯剪辑。

**待补证**：每次媒体传输为什么超时。`backend-services/basic-service/app/services/web_research/safe_http_client.py:412` 使用 `connect=5,sock_read=10`，媒体总预算则为 180 秒；这是可能影响弱网络的独立预算，不是原现场原因已经确定的证据。

### F-05：超时恢复建议与工具参数不匹配

`src/lib/video-editing-agent/tools/hostToolAdapter.ts:68` 的统一建议为：

```text
Retry once with a longer timeout_ms or a narrower command.
```

但 `src/lib/video-editing-agent/tools/egressTools.ts:105` 的 `download_url` 参数没有 `timeout_ms`，并且禁止额外参数；`backend-services/basic-service/app/services/agent_host/egress.py:265` 的下载函数也没有该参数，`:282` 按 kind 选择固定预算。D10 确认不一致。

实际预算为媒体后端 180 秒、BFF/工具 190 秒（`egress.py:39`，`src/app/api/agent-host/[...path]/route.ts:47`，`hostToolAdapter.ts:31`），本链路不是默认 30 秒 BFF 提前截止。优先修正动作建议，不能仅抬高一个前端常量就宣称下载问题解决。

### F-06：TTS 的输入保护正常生效，目录发现和脚本同步不足

`src/lib/video-editing-agent/tools/ttsResponse.ts:14` 的 `prepareSegmentVoice()` 查找稳定段 ID，并比较完整旁白；`:67` 创建 `attempts:0` 的客户端错误。D12 证实猜 ID 或拼入标题会在 HTTP 前失败。对照 `src/lib/video-editing-agent/editorContextPrompt.ts:38` 明确要求使用完整 `narrationText`、禁止猜测 ID，所以不能通过放松逐字校验修复脚本数据链问题。

音色发现确实有缺口：`src/lib/video-editing-agent/tools/generateTts.ts:24` 提示 `explore_tools("tts_tools")` 查看音色，但 `tools/index.ts:449` 实际只注册生成和批量生成两项工具。`tools/exploreTools.ts:54` 查询工具描述，不获取动态音色目录。`src/lib/video-editing-agent/promptParts.ts:200` 确实有 10 个常用音色的静态表，不能说 Agent 完全看不到任何音色；该表没有粤语条目，也不能证明网关账号支持哪些音色。激活工具的分支 `exploreTools.ts:71` 仅返回工具摘要，旧分支 `:103` 才附带含静态表的 usage hints。真实目录接口存在于 `src/app/api/tts/voice-types/route.ts:4`，后端 `backend-services/basic-service/app/routers/tts_router.py:224` 已按路由模式返回网关目录及 `stale`，Agent 没有相应查询工具。

错误回退也必须区分层级：`backend-services/basic-service/app/services/skillrouter/tts_adapter.py:67` 把 `capability_unavailable` 映为 `TTS_PROVIDER_ERROR`；`generateTts.ts:87` 只为 `TTS_VOICE_UNAVAILABLE` 自动回退。D13/P3 确认收到前一种错误不会自动回退。日志中的后续普通话成功，最多说明 Agent 另发默认音色请求成功，不能证明同一次工具请求执行了自动回退。

能力级错误不应一律改为音色级错误：服务停用、账号无权限或服务端不可用都不保证换音色可恢复。目录也不保证音色实时可用；`stale:true` 必须呈现为未验证候选。对用户明确指定的广东口音，普通话只能作为标明未满足要求的降级成果，不能算完成该要求。

### F-07：robots 失败按主机缓存，错误来源信息不足

`backend-services/basic-service/app/services/web_research/safe_http_client.py:434` 按 origin 检查 robots；`:439` 读取缓存，`:444` 对缓存的 unavailable 继续拒绝。当前 `:39` 的 TTL 为 3600 秒，故同进程中换同一 CDN 的文件路径不能恢复。P1 验证两个文件只触发一次 robots 抓取。

同时 `safe_http_client.py:450` 会把部分 robots 抓取异常转换为 `robots_unavailable`，`:463` 对真实 HTTP 5xx 也给出同一码。P2 用上游超时复现相同结果。因此用户日志中的 `local_status:503` 是本地策略错误状态，不能直接推断「一定是源站 5xx，也一定不是本地网络设置」。`diagnose_url` 若只返回相同错误码，也没有增加这项证据。

unavailable 分支的保守拒绝符合现有设计。应用可以补充脱敏失败阶段、原始状态/类别与缓存过期时间，使 Agent 停止在同 origin 上寻找另一个文件；需要其他来源或本地用户素材时继续独立步骤，保留 BGM 未完成。`robots_disallowed` 还可能是路径级规则，不能简单把所有拒绝都升级为整站封禁。

**评审发现 F-07a（P1）：disallowed 缓存命中漏拒绝。** `safe_http_client.py:458` 遇到 robots HTTP 401/403 会缓存 `state='disallowed', parser=None` 并拒绝首次请求。但 `:439` 命中缓存后只处理 unavailable，`:468` 又只检查 ready，故 disallowed 命中会直接返回。实际下载入口 `backend-services/basic-service/app/services/agent_host/egress.py:282` 构造默认 `document=True` 的 `FetchPolicy`，经 `safe_http_client.py:374` 调用此检查，因此是媒体下载可达的策略缺口。评审用真实 `SafeHttpClient.fetch()`、内存 transport 连续请求同源两个文件：robots 401 和 403 均得到 `[robots_disallowed, target:200]`，第二个目标实际进入 transport；robots 503 对照为两次 unavailable、仅一次 robots 请求。此缺口不能解释原日志的 unavailable，但推翻了「所有缓存拒绝都安全」的泛化结论。下一节点应补上缓存 disallowed 的拒绝分支，保留 ready 状态的逐路径规则、TTL 和原有 unavailable 行为；不调整 robots 开关来解决。

关于其他音频现象：`No audio found` 在 `src/lib/video-editing-agent/tools/searchAudio.ts:131` 是合法空结果；日志中的 `502/BACKEND_UNREACHABLE` 来源于 BFF 到本地后端的连接失败分类（`src/lib/api/server/backend-proxy.ts:169`）。缺少对应时间段的进程日志，不能认定 Freesound 无结果、供应商故障和本地进程不可达有同一个根因。当前工具将失败结果主要压为消息字符串，也会妨碍 Agent 分辨下一步。

### F-08：导出可用性与当前任务交付混用

`src/lib/video-editing-agent/tools/qualityLint.ts:483` 的 `lintEmpty()` 对没有画面的工程返回 blocker，这是正确的导出约束。`src/lib/video-editing-agent/tools/qualityTool.ts:69` 返回的是 `{success:true,...report}`，检查完成与导出可用性本来就是两个状态。

问题出在使用范围：`src/lib/video-editing-agent/promptParts.ts:64` 的 YOLO 结束规则无条件要求 `check_timeline` 无 blocker。D11 只证明空工程被检查时必然得到 blocker；日志中仅文案轮次确实出现该卡片，但没有记录 YOLO 是否开启，不能据此唯一归因于 YOLO。显示链也没有任务阶段信息：`src/components/video/components/VideoChatWindow/QualityReportCard.tsx:201` 直接读取 blockers 并在 `:225` 着色，`turnSummary.ts:87` 直接取本轮最后一次检查。最小修复应先限定调用和提示范围，并在非编辑任务仍主动检查时说明「导出就绪情况」；不要求为此重建整套任务状态机。不能删除空时间线规则，也不能为了消除提示向仅文案工程添加无关片段。

## 4. 影响面

| 功能/用户 | 影响 | 边界 |
|---|---|---|
| 通过设置、SkillRouter 或 Anthropic 协议配置模型的用户 | 对话可用而扩写失败，模型解析错误还可能意外走旧环境配置 | 手动 OpenAI 环境配置齐全时扩写可能正常 |
| 将已有稿件写入面板、失败后继续操作的用户 | 无谓重新生成，失败时覆盖脚本，开场钩子与旁白分离，同轮段落关联滞后 | 正常生成工具已有结构化段落写入路径可复用 |
| 使用共享 `streamLlmChat` 的聊天、脚本、关键词等路由 | HTTP 200 流内错误丢失，空内容原因不清；部分内容可能被误认成功 | 修共享层时必须回归 OpenAI 与 Anthropic 两种正常流 |
| 弱网络/同批多媒体下载 | 单项下载超时扩散成整轮取消，已有素材之后的剪辑无法继续 | policy 拒绝已不计入该全局熔断 |
| 指定粤语或其他风格音色的用户 | 猜测 ID、无目录发现；降级后的音色不满足原需求 | 不保证网关账号已开通指定音色，目录也可能 stale |
| Freesound 同源 robots 失败的项目 | 一个主机不可用时 BGM 文件全被拒绝；同源轮换浪费步骤 | 保留现有出口/robots 策略 |
| 只写文案、只搜集素材的用户 | 被导出阶段 blocker 干扰，可能被诱导执行额外剪辑 | 真正导出仍须严格检查空时间线及素材有效性 |

两个错误提示连续出现不等于发生两次上游请求：同一结果可以在摘要和详细结果中重复展示。本节点未把日志展示重复计为额外重试次数。字幕估时精度、新闻事实核验、最终导出效果均没有足够执行证据，保持为本次范围之外的验收项。

## 5. 候选修复方案

工作量为相对估计，供后续评审确定范围；不包含供应商开通、真实 CDN 恢复或安装包完整联调。

| 方案 | 内容 | 侵入程度 | 风险/代价 | 预估工作量 |
|---|---|---|---|---|
| A：沿现有边界补齐契约（推荐，按本次评审收敛） | 统一脚本模型解析/协议；明确上游错误；增加原稿读写和段落同步；复用既有下载分支预算并隔离局部失败；暴露音色目录；修正 robots 拒绝缓存；限定阶段性验收 | 中，集中在已有路由、操作和适配边界，按问题拆分 | 共享流客户端、脚本身份/撤销、熔断分类需重点回归；不新增统一编排层 | 原定位估计约 3–5 人日；补证后的边界测试与桌面联调需实现节点重新估算 |
| B：先做脚本止血 | 仅修扩写配置/协议、全失败禁止写回、增加原稿写入入口 | 小，脚本路径为主 | 能解决显著 401/误写，下载熔断、流内错误、音色发现、阶段误报仍保留，不能满足全部稳健性诉求 | 小，约 1–2 人日 |
| C：全面重建能力调用层 | 将全部前端直连 LLM 路由、媒体搜索/下载和 Agent 错误处理移到统一后端编排 | 大，跨 Next/FastAPI/桌面配置及全部能力 | 迁移面广、协议/鉴权/超时回归风险高，当前证据不足以要求重建现有架构 | 大，至少 1–2 周，需另行设计 |

## 6. 推荐修复与理由

推荐 **A**。已有模型解析、结构化脚本操作、音色目录、出口错误分类都可以复用；当前缺陷主要发生在这些边界没有接齐的地方。按以下顺序实施，可先保护用户文案，再缩小失败扩散范围。

1. **原稿写入和扩写先分开。** 提供无需 LLM 的脚本写入/查询工具，使用 `set_script_with_narration` 保留完整原文、钩子和旁白，返回稳定段 ID、内容哈希并同步同轮 `scriptSegments`。回读应明确是服务端快照还是客户端已应用内容，未收到保存证据不宣称已持久化。扩写全失败不发布修改；部分成功保留失败段的原内容、身份和旁白，显式报告 `expanded_count/failed_count`。长请求应用前校验所属工程、取消状态和基线哈希，冲突时不覆盖新稿。撤销须恢复消费前的真实工程内容，不能只记录可能已 reset 的临时 store。复用既有同步/保存路径，不另建存储或通用回执服务。
2. **统一配置与传输错误契约。** 扩写与生成共用数据库/SkillRouter 解析和正确 `api_type`；解析明确失败应保留原因，不静默改用旧环境。仅保留项目已有且可判定的旧手动模式兼容分支，不凭后端不可达推定允许回退。共享客户端识别 HTTP 错误、两种 SSE 内错误及不完整流；返回 JSON 时明确标为协议不符，本轮不增加没有现场依据的非流式自动兼容。保留取消、超时、鉴权、限流、空输出的类别，脱敏并贯通工具结果。传递截止时间和取消信号，流读取结束/取消时清理 reader，禁止无界等待或对鉴权失败循环重试。
3. **限定读取恢复的失败域。** 复用 `hostToolAdapter` 的分支并发保护、最多两次尝试、Retry-After 和出口预算，仅将已分类的媒体读取失败/分支终止从全局故障中隔离，使独立编辑继续；不把所有工具的 transient 一概豁免。保留未知异常、重复编辑失败和全局模型/工具/时长预算的保护，不能通过大量不同 URL 无限运行。恢复建议按动作生成，下载超时优先建议较小素材、诊断网络或改源；本轮不新增 `timeout_ms` 参数，不抬高固定超时预算。请求信号、取消后禁止入库及幂等调用 ID 保持一致。
4. **让 Agent 看见真实能力。** 增加音色目录查询，返回语言、风格、目录 stale 及可用性边界，选择有证据的音色 ID。保持 ID/全文校验；遇到拒绝应返回可操作原因。只有明确音色不可用时才按既定规则回退一次，能力级停用不推断为单音色故障。回执返回请求音色、实际音色和降级标记；普通话成果必须保留广东口音要求未完成。
5. **补齐 robots 诊断及交付阶段。** 先修 F-07a 的缓存 disallowed 漏拒绝，保留 unavailable 的失败关闭、ready 的路径检查和 TTL；补充脱敏获取失败阶段/缓存信息。只对有 origin 级证据的 unavailable 抑制同轮无效轮换，不把路径拒绝泛化到整站。文案/素材收集阶段验收脚本及素材回执；编辑阶段检查时间线；导出阶段继续严格执行空时间线检查。优先调整既有提示及检查展示的语境，不新增通用阶段引擎。BGM、口音、60 秒和导出回执分别表达，不以 `blockers=0` 代表全部需求完成。

后续代码节点的最低验收：

| 验收 | 需要证明的正确行为 |
|---|---|
| AC-01 | 仅设置内有模型的扩写成功；OpenAI/Anthropic 分别使用正确端点；解析拒绝不走旧端点 |
| AC-02 | 原稿写入零 LLM 调用，全文/钩子/稳定 ID 保留；同轮可生成正确关联配音；读回/保存有回执 |
| AC-03 | 扩写全失败不修改面板；部分成功有明确定义且可撤销 |
| AC-04 | 正常两种 SSE 仍成功；流内错误、网络异常、空输出、协议不符均分类；中途 error 不宣告成功 |
| AC-05 | 五个不同下载暂时失败后可继续使用已有素材编辑；相同分支有重试上限；失控/预算仍能终止 |
| AC-06 | 下载恢复建议能由该工具实际执行，超时/取消边界一致；已有 policy 拒绝保持拒绝 |
| AC-07 | Agent 可查询音色及 stale；输入不匹配可按真实段落恢复；能力错误不盲目换音色；明确报告口音降级 |
| AC-08 | 同源 robots unavailable 不反复换文件；能区分抓取失败阶段，不把本地 503 说成源站 5xx |
| AC-09 | 仅文案不被要求修复空时间线；实际导出空时间线依旧阻断；BGM、口音、60 秒及导出回执独立验收 |
| AC-10（评审新增） | robots 401/403 的首次及缓存命中均拒绝且不请求目标媒体；503 unavailable 维持拒绝；ready 的路径允许/拒绝、TTL 过期重新抓取及同源并发检查保持正确 |
| AC-11（评审新增） | 扩写/原稿写入在同工程并发编辑、切工程、取消、重复结果/重连时不覆盖新稿、不重复应用；结构化操作消费并 reset 后撤销仍还原真实旧稿；空输入/纯空白明确拒绝，不抹除已有稿件 |
| AC-12（评审新增） | 相同下载分支最多两次实际 HTTP 尝试，同分支并发不重复发起；缓存返回不计作新的网络失败；出口预算耗尽仅阻断出口；五个独立读取失败仍能编辑，未知故障的全局熔断仍有效 |

本节点已提供可运行复现和代码证据。原现场上游空内容、CDN 超时、后端短暂不可达及粤语授权的最终外部成因保留为待补证，不影响对已确认的应用缺陷实施上述修复。

## 7. 评审记录与补充验证

评审方式：逐项读取实际路由、工具、服务端事件订阅、客户端 operation 分发、store 和 React 同步路径；独立重跑原诊断，并用内存 transport/HTTP 替身补充反例。没有访问公网、真实账号或安装包，没有将供应商状态推断为事实。

### 7.1 根因与方案审计

| 审计项 | 证据结论、反例及对方案的约束 |
|---|---|
| F-01 配置 | 扩写绕行与生成静默回退成立，D1/D2/D15 可复现。手动 OpenAI 环境完整时可能正常，不能声称扩写一律失败。共用小型解析函数即可，不应顺带迁移全部前端路由。解析拒绝、畸形响应、连接失败、仅手动模式都须有明确分支，不能照搬生成端当前回退。 |
| F-02 写入 | 失败仍登记 operation 及同轮快照滞后成立；本次补足 UI 文本解析重建身份的链路。全失败禁写应放在脚本工具，不能全局丢弃 `success:false` 的所有合法部分成果。扩写定位是视觉描述（`src/app/api/ai-video-script-expand/route.ts:71`），不得把新画面文案覆盖已有 `narrationText`。 |
| F-03 流契约 | HTTP 200 内的 error 会被两种解析分支吞掉，正常 Anthropic 对照及新增 OpenAI 对照成立；不是网关必然不支持流的证据。最低改动是错误/协议/完成状态的识别和清理，不扩展自动协议探测；回归调用者的正常正文、思考、取消及截断。 |
| F-04/F-05 下载 | 全局阈值扩散成立；原方案忽略了现有分支恢复、预算和并发互斥。只修局部失败与全局计数的衔接及不可能执行的建议；不增加第二层 retry、不删除总保护、不调大超时掩盖失败。 |
| F-06 音色 | 请求前严格校验和 capability/voice 错误区别成立；不能将正常保护当缺陷删除。新增查询应注册进实际 `tts_tools` 的按需激活路径，转发已有目录并限制输出大小；目录非实时权限证明，语言缺失或推断值也不能证明广东口音。 |
| F-07 robots | unavailable 缓存及本地 503 归因边界成立；补入 F-07a 的真实 fetch 反例，纠正“所有拒绝缓存都保持拒绝”的假设。先补缓存 disallowed 分支，再增加诊断；同源并发不能因重复抓取或状态覆盖而放行拒绝。 |
| F-08 阶段 | 空时间线导出检查正确；误导来自检查用途和呈现语境。未证明现场开启 YOLO，不将 D11 扩大成自动行为测试；限定结束指令与卡片语境即可，保留真实导出 blocker。 |

**脚本并发、撤销与回执的额外证据**：`src/lib/video-editing-agent/AgentEventRouter.ts:149` 已有工程有效性保护，但 `:540` 的段落过滤只核对素材/上轨关联，不对整稿 `set_script*` 校验版本。`src/lib/video-editing-agent/agent.ts:127` 的操作登记已检查全轮取消，应复用而非另造取消开关；扩写循环还需在取消后停止后续段请求，不能将 AbortError 当普通段失败继续。`src/lib/video-editing-agent/OperationApplier.ts:386`、`:398` 的撤销记录读取临时 store，`:495`、`:499` 也只还原它；而 `VideoEditingInterface.tsx:740`、`:790` 消费后会 reset。故“已有 undoable 标记”不能证明旧工程可恢复。`src/components/video/hooks/useAgentExecution.ts:724` 仅在发起一轮时传脚本快照，`VideoEditingInterface.tsx:2001` 已有优先读取尚未消费的结构化数据的机制，新读写工具应接入这一链路；仅返回新哈希不等于在应用时执行过冲突校验。以上并发/撤销项为静态风险及实现验收条件，本次没有声称已在安装包复现。

**音色与重试回归边界**：`src/lib/video-editing-agent/tools/generateTts.ts:64` 已回显实际音色，`:87` 已限制仅 `TTS_VOICE_UNAVAILABLE` 触发一次回退，不应重写整套 TTS 重试。只补请求音色/实际音色/降级语义及动态目录入口；`backend-services/basic-service/app/services/skillrouter/tts_adapter.py:249` 在语言缺失时使用默认值，`:267` 在无目录时回静态表并置 stale，Agent 必须保留这些来源限制。付费生成受理不明时禁止用读取重试策略重发。

### 7.2 本次实际验证及结果

1. 执行 `npx vitest run --config docs/diagnoses/agent-capability-execution-failures/repro/vitest.config.ts --reporter=dot --no-cache`：1 个文件、15 个用例通过，退出码 0。没有重写 `repro/results.json`。
2. 通过 `runpy.run_path(..., run_name='review_only')` 加载已有 `backend_repro.py` 并执行原 `main()`，仅将目标 `backend-results.json` 的 `Path.write_text` 替换为内存写入：原 P1/P2/P3 全部通过，退出码 0，未改写已有结果。
3. OpenAI 内存探针直接读取 `streamLlmChat.ts`，以项目 TypeScript 编译器转译后导入实际函数，HTTP 替身显式设置 `text/event-stream`。五种观测分别为：正常增量及 DONE → 一个 content；独立 error → 空事件；正文后 error → 仅 content；无换行截断 → 空事件；有增量无终止帧 → 仅 content。所有诊断断言通过。结合 D6/D14 及源代码确认两种协议的风险；没有用替身实现替代被测解析器。
4. robots 补充探针执行下列命令，退出码 0；代码和结果保留在本文中，未另建复现文件。实际调用 `SafeHttpClient.fetch()`，仅底层 transport 为内存替身，不访问网络。

```powershell
@'
import asyncio, sys
sys.path.insert(0, 'backend-services/basic-service')
from app.services.web_research.safe_http_client import SafeHttpClient, FetchPolicy, RequestSpec, HttpResult
from app.models.web_research_models import WebResearchError

async def main():
    for status in (401, 403, 503):
        requested = []
        async def transport(policy, request):
            requested.append(request.url)
            code = status if request.url.endswith('/robots.txt') else 200
            return HttpResult(request.url, code, {}, b'fixture')
        client = SafeHttpClient(transport=transport, proxy_settings={'proxy_mode': 'direct'})
        outcomes = []
        for name in ('one.mp3', 'two.mp3'):
            try:
                result = await client.fetch(FetchPolicy(), RequestSpec('https://review.invalid/' + name))
                outcomes.append('target:' + str(result.status))
            except WebResearchError as error:
                outcomes.append(error.error_code)
        expected = ['robots_disallowed', 'target:200'] if status in (401, 403) else ['robots_unavailable'] * 2
        assert outcomes == expected, outcomes
        assert len(requested) == (2 if status in (401, 403) else 1), requested
        print(status, outcomes, requested)
asyncio.run(main())
'@ | python -X utf8 -B -
```

```text
robots 401: [robots_disallowed, target:200]; 请求 robots.txt 和第二个媒体
robots 403: [robots_disallowed, target:200]; 请求 robots.txt 和第二个媒体
robots 503: [robots_unavailable, robots_unavailable]; 仅请求一次 robots.txt
```

这些验证证明当前缺陷和证据边界，不是修复后的验收。安装包交互、项目保存重开、真实音色授权、CDN 状态和最终导出均未验证，下一节点不得把这些待验证项写成已通过。

## 评审结论

**结论：分析报告经上述修订可作为实现依据；唯一推荐方案为 A（本次评审收敛版）。** 按第 6 节五项顺序实施，并以 AC-01～AC-12 验收。先保护原稿/段落身份并统一脚本配置与错误契约，再修正下载失败域、补动态音色目录，最后补齐 robots 拒绝缓存和交付语境；F-07a 的 P1 缓存漏拒绝应在本轮一并修复。

理由：已确认的缺陷都能落在现有解析端点、共享流客户端、结构化脚本 operation、下载分支预算、音色目录和 robots 状态分支内；修复不需要新的编排服务、第二套脚本存储或重试机制。方案 B 遗留本次已证实的流内错误、全局取消和缓存漏拒绝，无法覆盖用户的可靠性诉求；方案 C 的迁移范围与当前证据不相称。第 6 节已明确排除无依据的非流式自动兼容、新增下载超时参数、普遍放宽 transient 熔断和通用任务阶段引擎，以限制回归面。

实施完成的门槛是正确行为及边界用例通过，而不是本报告的故障诊断断言继续为绿。不得为达成验收放松 TTS 全文/稳定 ID 校验、绕过 SkillRouter 解析失败或 robots、把普通话当广东口音、把无 BGM 当需求完成。现场上游/CDN/授权的外部成因仍有证据缺口，但不妨碍修复本报告已用真实代码与离线探针确认的应用缺陷。本节点仅完成分析评审，没有实施业务修复或执行 Git 提交。

## 实施过程发现的方案缺陷

以下为 Subtask #2 在 2026-11-20 的实施补充；前文定位、评审及修复前结果仍作为历史证据保留。

1. **记录脚本撤销数据仍不足以让用户撤销。** 实际 `useAgentExecution.undoSingleOperation()` 调用的 `OperationApplier.undoOperation()` 只接受时间线记录；响应节点也只展示时间线撤销。若只修正 `undoNonTimelineOperation()` 的旧稿来源，真实入口仍不可用。已让同一单步入口识别本次结构化脚本记录，并给客户端实际应用的脚本步骤显示独立撤销按钮；只包含工具的脚本轮次也产生响应节点。没有伪造时间线修改标记，没有扩展“撤销所有时间线操作”的语义。撤销仍校验工程归属和应用后状态，拒绝覆盖后续编辑，刷新后无内存撤销记录时不显示按钮。
2. **origin 诊断值经过既有脱敏后可能多一个尾斜杠。** 直接将字符串作为缓存键不能稳定抑制同源轮换。现统一使用 `new URL(value).origin`，并仅接纳带 `robots_scope=origin` 证据的 `robots_unavailable`；ready 状态的逐路径拒绝不会扩展为全站拒绝。复用现有恢复记录，不增加第二套重试机制。

## 8. 方案 A 实施记录

本节点没有执行 `git commit`、添加依赖、变更下载超时参数或放宽 robots/TTS 校验。开始时已有的 SkillRouter、网络设置、桌面构建等未提交修改均保留。本次新增文件仅为方案明确需要的小型脚本配置解析器、原稿读写工具及正式回归测试。

### 8.1 最终行为

- **脚本写入与扩写分离**：`set_video_script` 零 LLM 调用，保留完整原稿和开场钩子；`get_video_script` 返回全文、稳定段 ID 和内容哈希，明确标记 `source=server_snapshot`、`persisted=false`。生成、扩写及原稿写入共享结构化发布，同步同轮 `scriptSegments`。扩写全失败不发布操作，部分成功保留失败段及独立旁白；鉴权或限流拒绝不逐段重复请求。客户端通过既有 `onUpdateContent` 路径同步工程，校验真实基线、工程归属和取消状态，重复结果不重放；撤销直接恢复真实工程旧稿。
- **模型与流错误契约统一**：生成与扩写共用后端模型解析，沿用后端已有的 DB/SkillRouter/手动环境兼容选择；解析拒绝、畸形响应或不可达均不会改用前端旧密钥。共享流客户端保持两种正常协议及思考输出，识别 HTTP/SSE 错误、非流式 JSON、截断、空输出、网络异常、取消与截止时间；清理 reader，工具结果只透出稳定分类，不回显供应商正文或密钥。
- **下载失败只终止相应读取分支**：复用已有并发互斥、两次尝试、Retry-After、幂等调用 ID、出口预算和取消后禁止入库。仅豁免已分类读取失败及缓存重放；未知异常仍参与全局熔断。缓存命中不消耗新网络预算。下载建议改为较小素材、诊断、改源或使用已有素材，不再要求不存在的 `timeout_ms`。
- **音色能力可发现**：`list_tts_voices` 注册于实际按需 `tts_tools`，限制结果数量，返回语言、风格、`stale` 及“目录不证明实时授权”的边界。单段配音回执区分请求音色、实际音色及降级；批次逐项回显音色。仍仅在明确 `TTS_VOICE_UNAVAILABLE` 时沿既有规则回退一次，能力级故障不推断为音色故障。段落校验失败建议读取真实脚本后修正，不取消全文校验。
- **robots 与交付语境**：缓存 disallowed、unavailable 均拒绝；同源首次并发共享一次 robots 获取，ready 逐路径校验及 TTL 保留。脱敏诊断区分抓取失败阶段、原始错误码、HTTP 状态与缓存命中，获取超时不会被描述成源站 503。检查卡片明确为导出就绪情况；仅文案/素材收集按相应回执验收，实际导出仍阻断空时间线。BGM、口音、时长和导出完成分别报告。

### 8.2 验收对应关系

| 验收 | 已执行的本地证据 |
|---|---|
| AC-01、AC-04 | 正式 `capabilityFailures.test.ts`：仅设置内有模型的两种协议扩写、解析拒绝不回退、流内正文后错误、JSON 协议错误、正常正文/思考、截断及网络/取消/超时/空输出分类；已有关键词和旁白转画面路由回归 |
| AC-02、AC-03 | 原稿零网络、完整钩子及稳定 ID、读回快照、空白拒绝、全失败不写回、部分失败保留独立旁白及音色；既有 `scriptSegmentAssociation.test.tsx` 的真实面板、配音、JSON 关联回归 |
| AC-05、AC-06、AC-12 | 五次独立读取超时不触发整轮取消，未知异常仍触发；同分支并发只请求一次、最多两次实际尝试，缓存不新增预算；已有 `egressTools` 的重试窗口、预算、取消和入库回归 |
| AC-07 | 目录工具注册、stale 与权限边界；请求/实际音色及降级回执；既有 TTS 默认音色、严格文本校验、能力错误不回退及部分批次结果回归 |
| AC-08、AC-10 | 真实 `SafeHttpClient.fetch` 的 401/403/503 首次及缓存拒绝、并发只抓取一次、ready 路径规则、TTL 重新获取；超时诊断不含虚构源站 HTTP 状态；前端同源 unavailable 抑制 |
| AC-09 | 阶段提示与导出范围回执；空工程仍有 `timeline_empty` blocker，既有质量规则与 YOLO 提示契约回归 |
| AC-11 | 扩写期间取消/编辑拒绝迟到结果；取消后不请求后续段；应用基线冲突、工程切换后撤销拒绝、重复结果不重放；临时 store reset 后通过真实 `undoOperation` 恢复旧稿；界面脚本撤销按钮及无文字轮次节点回归 |

### 8.3 复现重跑与验证边界

修复前 `repro/results.json` 和 `repro/backend-results.json` 未覆盖。按第 2.1 节要求将正确行为断言放入正式测试目录，原 `repro/failures.test.ts` 保留为导入入口，故修复后继续使用同一复现命令即可验证正确行为，而非要求旧故障继续出现。

- 重跑 `npx vitest run --config docs/diagnoses/agent-capability-execution-failures/repro/vitest.config.ts --reporter=dot --no-cache`：26 个正确行为用例通过。
- 原 Python `backend_repro.py` 的 `main()` 以 `runpy` 载入执行，仅拦截结果文件写盘：3 个原有边界断言通过，历史结果未改写。
- 核心、TTS、出口、流调用者、质量规则等 15 个测试文件：209 例通过；实际 Hook/面板 3 个文件：35 例通过。后补脚本撤销入口与既有时间线撤销回归组 4 个文件：50 例通过；最终实际 Hook、面板、撤销菜单及禁用保护组 6 个文件：50 例通过。各组有重叠，不相加作为唯一用例总数。
- 后端 `test_research_safe_http.py`、`test_agent_host_egress.py`、`test_egress_policy.py`：76 例通过（含现有依赖弃用警告）。
- 本次修改文件 ESLint：0 errors；已有界面和类型文件保留原有 warnings。项目使用 `.eslintrc`，执行时设 `ESLINT_USE_FLAT_CONFIG=false`，未修改 lint 配置。
- 最终生产源码 TypeScript 检查通过：`Production TypeScript diagnostics: 0`（按现有 tsconfig 创建 TypeScript program，排除测试和诊断文件、`incremental=false`、`noEmit=true`）；全量 `tsc --noEmit --incremental false` 仍被开始时已有的 `src/components/skillrouter/__tests__/SkillRouterSettingsPanel.test.tsx:145` 夹具缺少 `stale` 阻塞，此处未越界修复。没有宣称全量类型检查或生产安装包构建通过。
- 实际启动 Next 开发服务于隔离端口 13058：两个修改后的 API 路由编译成功，空请求返回预期 400；应用首页编译后 `GET /` 返回 200。没有调用真实付费模型或修改既有后端进程。

真实供应商音色权限、CDN 当前状态、安装包端完整交互、实际项目保存后重开及最终视频导出未执行。本次证据支持已确认应用缺陷的本地修复和边界回归，不证明原现场外部服务已恢复，也不将服务端快照当作持久化回执。

## 9. 最终代码评审与补充修复

Subtask #3 对照 F-01～F-08、AC-01～AC-12 审阅实际差异，复核配置解析、脚本发布/撤销、下载失败域、音色回执和 robots 状态边界。评审发现并直接修复三项新增问题：

1. **robots 并发读取不应依赖 LRU 仍保留该项。** 257 个 origin 并发完成 robots 获取时，早完成项可能在等待者恢复前被 256 项缓存淘汰，导致 `KeyError`。新增允许、401 拒绝、503 不可用三种回归，先确认全部失败；随后让共享加载任务直接返回规则条目，缓存只负责复用，不再作为等待者的结果容器。缓存上限、失败关闭及路径规则均保留。
2. **模型解析响应正文读取期间也须保留取消/截止类别。** 原实现将正文读取异常折叠为解析失败。新增真实 `Response/ReadableStream` 回归，先确认两例误报 `MODEL_RESOLUTION_FAILED/502`；修复后分别返回 `LLM_CANCELLED/499` 和 `LLM_TIMEOUT/504`，不请求备用端点。
3. **批量配音失败没有实际生成音色。** 失败项原来同成功项一起附带 `actual_voice_type` 和 `degraded=false`。新增能力不可用回归确认误报后，失败项仅保留请求音色；实际音色及降级标记仅在确有音频成果的成功项返回。

本节点重新执行的验证：

- 17 个前端正式测试文件，271 例通过：覆盖上述补充回归、原稿/扩写、真实脚本面板与关联、TTS、出口预算/并发、质量检查、共享流调用者、实际执行 Hook 和撤销菜单。
- 原诊断 Vitest 入口转发正式正确行为回归，27 例通过，未覆盖历史诊断 JSON；该组与前述测试有重叠，不累加。
- 后端 `test_research_safe_http.py`、`test_agent_host_egress.py`、`test_egress_policy.py`，79 例通过，26 条既有依赖警告。
- 生产源码 TypeScript 检查 0 错误；全量检查仍仅报告既有 `SkillRouterSettingsPanel.test.tsx:145` 缺少 `stale` 的夹具错误，未修改该无关工作。
- 本次前端修改文件 ESLint 为 0 errors、33 warnings；警告位于已有大型界面、Hook 和类型文件。`git diff --check` 通过。

提交范围限定为本报告、复现证据及上述故障的实现/回归文件。已有 SkillRouter 设置、网络环境、引导向导、API 客户端和桌面构建修改保留在工作区；`src/lib/i18n.ts` 仅选取三个新增工具名称的类型及中英文条目。构建输出、运行时任务文件和临时诊断目录不纳入提交。

结论：上述三项问题已有先失败再通过的回归证据，评审后未发现本次修复范围内尚未处理的阻断项。第 8.3 节的真实供应商、安装包、保存重开和最终导出验证边界仍然适用。
