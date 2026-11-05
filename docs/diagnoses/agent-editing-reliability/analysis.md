# AI 剪辑可靠性诊断：约克夏 30 秒任务

日期：2026-11-05。诊断基线：
`dbe6812cb2a74cea91e7ca4cfba1e9adc484beae`。

本报告包含 Subtask #0 的定位与分析，以及 Subtask #1 的证据复核与评审。
两个节点均没有修改业务代码、没有提交 Git。最终实施边界以文末评审结论为准。
主要结论是：本次故障涉及时间线状态维护、错误分类与分支控制、
交付验收三个相互叠加的问题，不能归结为提示词不够详细。
推荐方案 B：修复已复现的数据和错误契约，再调整工作流及完成条件。

## 1. 问题描述

用户输入“剪辑一个介绍约克夏的视频，30S”，助手规划了旁白、画面、
BGM、字幕和导出。执行过程反复发生下载拒绝、生成失败、字幕冲突，
首次运行触发五次失败熔断。继续后虽然形成了时间线，却以 30.6 秒
代替 30 秒，BGM 未完成、没有渲染或导出，仍将计划标记为 6/6，
并使用“已形成成片”“可直接导出”等过度确定的表述。

证据来源是用户提供的执行记录，不是本轮重新调用外部服务所得。
下文的“原始记录”指：
`.agentmesh/task-tge-271a1e9b-696c-4e0b-b274-52f2ea2e4250/.task-prompt-agent-79519cef-0d20-4af6-a050-8092f7f7efc2.md`。
评审时发现原报告引用的 `84a616da…` 节点文件已不存在，故改引当前任务文件
中的同一份执行记录；下表及正文日志行号均已按现存文件重新核对。

| 现象 | 原始记录行号 | 本轮结论 |
|---|---:|---|
| 三次生成视频均为外层 500、内层 Ark 400、端点关闭或暂不可用 | 170、174、178 | 上游故障已见于日志；本地错误降维、缺少分支失败记忆已定位 |
| “连续 5 次工具调用失败”终止 | 188 | 全局熔断存在；出口策略拒绝也被计数，已离线复现 |
| 裁短后 `totalDuration=39.775` 持续不变 | 351、368、435、624 | Agent 状态缺陷已复现；实际 UI Store 另有重算，不能推断必然黑尾 |
| `subtitle_cues_overlap` | 321、322 | 正常输入校验；缺失原始 cues，不能认定误报 |
| `build_credits` 返回 `tool_not_loaded` | 374、375 | 受工具加载协议保护；修复建议没有携带加载步骤 |
| 发现第三镜其实是大型浅色犬 | 525、530 | 主体核验发生太晚，导致已上轨后返工 |
| 审阅把帧号/时间码描述为源画面烧录文字 | 533、543、583 | 联系表自行叠字，但视觉提示未交代来源 |
| 30.6 秒、没有 BGM，计划全部完成 | 645–655、678、684 | 目标时长和承诺项目未进入确定性验收 |
| 明确承认没有导出与 `inspect_export` | 687 | 当前 Agent 无专用导出工具，不能宣告导出完成 |

用户明确要求的是主题和 30 秒。BGM、导出是助手工作计划承诺；
应记录其降级或未完成状态，不应把它们描述为用户另行明确要求的细节。

### 1.1 旧黑板结论已过时

任务文件开头 F-1～F-3 是 earlier run 的音色诊断，不能当作本轮根因。
当前基线已包含提交 `ac9eed68`（Agent 配音使用工程默认音色）：

- 前端传入 `defaultVoiceId`：
  `src/components/video/hooks/useAgentExecution.ts:606`。
- 路由读取并注入：
  `src/app/api/video-editing-agent/chat/route.ts:350`、`:588`。
- 单段/批量配音使用相同解析函数：
  `src/lib/video-editing-agent/tools/generateTts.ts:45`，
  `src/lib/video-editing-agent/tools/batchGenerateTts.ts:47`。
- 缺省值已是男声，且显式指定优先于工程默认：
  `src/lib/video-editing-agent/voiceDefaults.ts:17`、`:34`。

本轮已执行默认音色及错误传播测试。没有证据要求重新实现旧修复，
也没有历史音频文件可供验证整段视频是否实际使用了同一音色。

## 2. 复现步骤

### 2.1 可直接运行的离线最小复现

前提：当前仓库的 npm 依赖已安装。本工作区已有 `node_modules`。
干净检出环境可先按 README 安装依赖。本诊断不要求供应商凭据、
不启动桌面应用、不调用收费生成接口。

在 PowerShell 中逐行执行：

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/agent-editing-reliability/repro.config.ts --reporter verbose --no-color
```

文件：[repro.test.ts](./repro.test.ts)、[repro.config.ts](./repro.config.ts)。
所有网络请求默认被测试桩拒绝；需要外部响应的用例只替换 `fetch`。
时间线计算、Agent 本地状态、浏览器 OperationApplier、lint 和导出规划
均调用真实实现。测试用素材路径只用于计算，不读取实际媒体字节。

**断言当前缺陷，所以 9 项通过代表复现成立，不代表问题已修复。**
修复节点应将对应断言改成正确行为，并补充边界用例。

| 用例 | 操作 | 实际结果 | 修复后的目标/对照意义 |
|---|---|---|---|
| R1 | 独立运行浏览器 OperationApplier，将单片段从 39.775 裁短为 30 秒 | clip=30，totalDuration=39.775，lint 警告但 `ok=true` | 聚合更新；导出规划已返回 30、黑尾 0；此用例未挂载 UI Store |
| R2 | Agent 裁短，再删除最后片段 | 删除后空轨仍为 39.775 秒 | 更新为 30，再更新为 0 |
| R3 | 空时间线首次添加 10 秒片段，无需重排 | Agent 总时长为 0，OperationApplier 输出为 10 | 两端内容时长保持一致 |
| R4 | 分别向两种工具送入 5 次同样的策略拒绝 | `download_url` 熔断，`download_web_media` 不熔断 | 策略拒绝统一计入分支控制，不误伤独立剪辑 |
| R5 | 对同一不可用生成端点调用三次 | 三次请求全部发出，结构化分类被丢弃 | 保留原因，限定该端点的后续尝试 |
| R6 | `download_failed` 为 transient/可重试 | `retryable=true` 与“不要重试”同时返回 | 给出一致且有预算的下一步 |
| R7 | 空时间线将“导出成片”步骤设 completed | 接受完成；计划不再有待办；注册表只有 inspect_export | 编辑交付状态必须有对应证据 |
| R8 | 搜索返回一条远端音频 | size=0，结果没有 materialized 状态 | 明示候选与本地可用素材的区别 |
| R9 | 提交 0–3 秒、2–5 秒两条字幕 | 原子拒绝、不写入任何字幕 | 正常保护行为，应保留 |

本轮输出保存在 [repro-output.txt](./repro-output.txt)：
`Test Files 1 passed (1)`、`Tests 9 passed (9)`，退出码 0。
R4 会输出预期的熔断 stderr；PowerShell 5 将其包装为
`NativeCommandError`，不代表 Vitest 失败，文件末尾和进程退出码为准。

### 2.2 原场景的手动复现路径

1. 启动已配置的开发桌面应用：在仓库根目录运行
   `npm --prefix desktop run dev`。新建剪辑工程，保持素材库、时间线为空。
2. 在 AI 剪辑助手输入“剪辑一个介绍约克夏的视频，30S”。记录
   `update_plan`、`generate_video_script`、TTS 返回时长、素材搜索结果。
3. 检查下载失败是否保留 URL 对应的状态和拒绝原因；同一生成端点失败后，
   观察是否仍对其提交后续镜头。**不要为了复现更改真实凭据或出口策略**；
   确定性失败注入使用 R4–R6。
4. 首次终止后输入日志中的继续语句：
   “继续：把计划里剩下的步骤自己做完，不要提问；只报告结果与假设。”
5. 在时间线较长时裁短末尾片段，再调用 `get_timeline` 和 `check_timeline`。
   比较片段终点与 `totalDuration`。R1–R3 可不依赖 LLM 稳定复现此步骤。
6. 检查最终画面时长是否精确满足 30 秒、主体是否已核验、BGM 是否真实落轨，
   以及是否存在本项目本次导出的实际完成回执；不能以 6/6 或 0 blocker 代替。

本轮没有跑真实端到端生成/下载/渲染。外部 403、robots 结果及供应商
端点状态会随环境变化，原始记录又省略了部分参数，因此不保证整段历史
对话按相同工具顺序再次出现。上面的离线用例用于隔离本地可确定的缺陷。

## 3. 根因分析（含证据）

### 3.1 P1：总时长仅增长，且 Agent 与浏览器更新条件不同

浏览器 `OperationApplier` 在成功应用普通剪辑操作后执行：

```typescript
state.totalDuration = Math.max(computeTimelineEnd(state), state.totalDuration);
```

位置：`src/lib/video-editing-agent/OperationApplier.ts:575`。
重排入口在同文件 `:243` 也使用相同写法。因此一旦增至 39.775，
单独经过这个组件的缩短、删除无法使该数值下降；不能把这一点推广为
整个界面的所有编辑入口都不重算（见下方 Store 反例）。

**实际执行链已复核：** `agent.ts:98–110` 的 `updateTimeline` 先在服务端
副本上执行操作，再记录到 operations；`:552–559` 随 `tool_result` 发给客户端。
`AgentEventRouter.ts:243–261` 将单项/批量操作交给 OperationApplier，
`src/components/video/hooks/useAgentExecution.ts:325–335` 接回 React 状态与
外部同步通知。`get_timeline` 则直接返回本轮 `context.timelineState` 的
聚合值（`tools/getTimeline.ts:70–77`），并不回读客户端 Store。

Agent 端的 `applyOperationLocally` 修改片段后只调用重排：
`src/lib/video-editing-agent/agent.ts:645`、`:690`、`:712`。
重排函数只在片段位置发生变化时更新时长，而且也是取历史最大值：
`src/lib/video-editing-agent/reconcile.ts:248`、`:249`、`:290`、`:291`。
无重排的新增、裁短或删除连聚合更新都不会发生。R3 证明这不仅是
“旧时长不下降”，还会造成首次添加片段后两端时长不一致。

字幕写入同样保留历史最大值：
`src/lib/video-editing-agent/subtitleClips.ts:341`。
反例是撤销恢复路径会直接重算：
`src/lib/video-editing-agent/trackPatch.ts:230`。
这说明编辑、字幕、撤销对同一字段采用了不一致的规则。

**遗漏的反例与影响收窄：** 实际 TimelinePanel 收到 Agent 外部更新后调用
`replaceTimelineAction`（`src/components/video/timeline/TimelinePanel.tsx:482–504`）；
后者从条目重算 totalDuration 并约束播放头
（`timeline/store/actions/replaceTimeline.ts:83–104`，同属上述组件目录）。
`timeline/domain/aggregates/TimelineAggregate.ts:602–604` 已按全轨末端计算，
仅为正数 Duration 值对象保留空轨 `0.001s` 下限。因此 R1 证明的是
OperationApplier 输出缺陷，R2/R3 证明的是 Agent 副本缺陷；不是 UI Store
始终维持 39.775 秒的端到端证明。服务端在 `agent.ts:84–85` 深拷贝请求
快照，本轮没有客户端回写通道，Store 的重算不能修复随后工具看到的旧值。
历史日志也没有完整状态快照，不能还原 39.775 最初由哪一次操作产生。

`totalDuration` 的内容聚合语义已有 `trackPatch.ts:321–333` 和上述 domain
实现共同支持，不需为本修复新增“画布长度”字段。纯数据的空轨末端为 0，
domain 的 0.001 是表示边界，应在验收中归一化，不要直接破坏值对象约束。

自检只报告 warning：`src/lib/video-editing-agent/tools/qualityLint.ts:466`；
`ok` 仅由 blocker 数量决定：同文件 `:552`。
因此日志中的“0 blocker”与残留时长警告可以同时成立，并不等于状态一致。
另外该规则拿**全轨**聚合对比**视频轨**终点；音频/字幕确实更长时，也会
报告同一个码。修复时应将“缓存与全轨末端不同”与“非视频轨超长”分开，
不能把所有 duration_mismatch 都定为缓存漂移，或一律升级成 blocker。

**影响边界：**实际导出使用
`src/components/video/hooks/videoExportItems.ts:329` 的 `planVideoExport`，
通过 `computeRenderEnd(spans)` 获取终点；
`src/components/video/hooks/useVideoExport.ts:165` 将其作为 `total_duration`。
R1 实测导出规划仍是 30 秒、黑尾 0。不能写成“该 bug 必然导出 39.78 秒”，
也不能以此保证历史工程绝无黑尾——本轮没有渲染历史工程。
聚合状态错误仍会误导 Agent 自检、报时和后续操作判断。

### 3.2 P1：固定长度目标没有验收，提示词反而要求额外延长视频

`src/lib/video-editing-agent/systemPrompt.ts:718` 写明：

> 视频轨道应比音频轨道略长 1-2 秒，避免导出时出现黑屏或音频超出视频范围。

但原始记录 `:678` 正是以“视频略长于音频”为理由将 30 秒改为 30.6 秒。
视频末端覆盖音频末端与必须额外延长 1–2 秒是不同约束。固定长度任务
需要在 30 秒预算内安排旁白、结尾和字幕，不应默认延长总长。

当前 `check_timeline` 入参只有画幅和是否返回 note：
`src/lib/video-editing-agent/tools/qualityTool.ts:31`。
`duration_mismatch` 比较的是缓存总时长与视频轨终点，
**不比较用户要求的 30 秒**。
`inspect_export` 也发送当前视频轨长度作为对照：
`src/lib/video-editing-agent/tools/exportInspectTool.ts:71`，
不是最初目标长度。因此把错误的 30.6 秒状态导出，也不能靠现有检查
证明满足 30 秒需求。

`explainer-video` 流程只在脚本阶段使用 `duration_target`，旁白完成后
没有明确的按真实音频时长重新预算步骤：
`backend-services/basic-service/app/services/agent_skills/builtin/explainer-video/SKILL.md:10`。
日志中 25.73 秒旁白触发 audio_gap 后，通过追加旁白使音频变成约 30.4 秒，
再延长视频到 30.6 秒，正体现出局部修警告覆盖了原始长度目标。

评审补证：原始记录 `:426` 为“no audio between 25.73s and 30.00s”；
`qualityLint.ts:331–350` 仅扫描独立音频轨，并把 `generate_tts` 作为建议。
它不测实际声音，也没有把视频内嵌音频计入，不能据此断定成片必定静音，
更不能强迫新增一段旁白。`qualityLint.ts:525–526` 又要求修完所有 warnings，
与技能末步“再修提醒项”一起造成消警告压力。应保留诊断信息，但允许在
固定时长内说明合法留白/有原声等处理，不为消除软提醒增加总长。

### 3.3 P1：生成错误失去结构，失败端点未被隔离

链路证据如下：

1. `backend-services/basic-service/app/services/ark_video_service.py:462`
   读取真实上游状态；`:479` 抛出携带 Ark 状态的 `httpx.HTTPStatusError`。
2. `backend-services/basic-service/app/routers/ark_video_router.py:39`
   将非 ValueError 异常统一包成 HTTP 500。
3. 全局 FastAPI 异常处理将该异常包装为 `HTTP_500`，其 details 中的
   status_code 也是外层 500（`backend-services/basic-service/app/main.py:459–490`）；
   Ark 的 400 已只存在于 message 字符串。前端两条生成路由均调用
   `createPassthroughRoute`（`src/app/api/ark-video/generate/route.ts:3`、
   `src/app/api/ark-image/generate/route.ts:3`），代理对 JSON 保留状态与正文
   （`src/lib/api/server/backend-proxy.ts:28–30`）。这排除了“BFF 主动将 400
   改成 500”的替代解释。后端应直接输出结构化错误信封；只在 HTTPException
   的 detail 里放新字段会继续被通用处理器嵌套，前后端必须一起核对契约。
4. `src/lib/video-editing-agent/tools/generateAiVideo.ts:74` 将非 2xx
   响应转为 `{success:false,error:字符串}`，只保留正文前 200 字符。
   `src/lib/video-editing-agent/tools/generateAiImage.ts:88` 同样处理。
5. 工具不保留结构化 `error_code`、`retryable`、上游状态、供应商请求号，
   也不记住该能力在本轮已失败。R5 注入结构化响应后确认分类仍被丢弃，
   三次调用发出三次请求。

R5 注入的 `provider_unavailable` 是**测试构造的信封**，不是历史后端已返回
该码的证据；它验证前端即使得到分类也会丢弃。历史日志与上述后端代码
才是实际错误来源的证据。R5 也没有运行模型，只证明连续调用没有执行拦截。

`src/lib/video-editing-agent/tools/apiHelper.ts:113` 对 HTTP 错误立即返回，
只对网络 TypeError 做一次重试。所以日志的三个生成任务不能归因于
底层 fetch 自动重试 HTTP 500；它们是更上层重复调用未被约束。

修复边界还包括两点：第一，`apiHelper.ts:49–50、124–128` 默认会重试
网络 TypeError，生成工具提交 POST 时未关闭它；无法确认提交是否被接收
的断线不能当作安全的生成重试，应禁用这类自动重提交，或先有可靠幂等回执。
第二，工具虽有 `model` 参数，后端 `ArkVideoGenerateRequest` 没有该字段，
且 `ark_video_service.py:443` 实际使用固定 `ARK_MODEL`。能力键必须来自
**后端实际端点/模型**，不能因模型随意换一个未生效的 model 参数就解禁。
本轮不扩展为模型选择器或供应商队列重构。

日志只证明当时 Ark 返回“端点关闭或暂不可用”。不能进一步断言
一定是欠费、无权限、模型下线，或宣称当前仍不可用；图像请求的
400 也缺少足够正文，不能直接判为与视频相同原因。
配置检查 `require_configured('ark')` 只能确认配置存在，不能证明
远端模型可用。建议保留上游结构后再决定具体恢复动作。

### 3.4 P1：出口拒绝被当成普通失败，且重试提示自相矛盾

熔断入口：`src/lib/video-editing-agent/agent.ts:527`。
它仅对 `isResearchTool` 且分类为 configuration/blocked/cancelled/
policy/validation 的失败豁免；`isResearchTool` 的正则在
`src/lib/video-editing-agent/researchEventSanitizer.ts:3`，
不包含 `download_url`、`http_request`、`diagnose_url`。

故同样的 `robots_disallowed + policy + retryable=false`，
研究工具不增加计数，通用出口工具却增加全局计数，累计五次中止整个 Agent。
R4 已复现。字幕 guard 的正常拒绝已有豁免，这是可复用的既有模式。
但不能简单豁免所有失败：真正的异常、网络故障仍需有界终止。

本轮不能从截断日志和 UI 展示顺序精确还原首次熔断的全部五个事件。
只确认触发机制及通用出口缺失的分类处理；日志中随后出现搜索成功，
也不足以证明计数器一定计算错误。

R4 直接向真实事件订阅器送入合成失败事件，没有运行历史模型回合；它证明
名称相关的分类差异，不能断言这五个历史事件全是下载拒绝。
`agent.ts:543–549` 明确规定：真正成功会清零，预期拒绝既不增加也不清零。
统一分类应保留这个次序，并区分 Host 的 `user_input`
（`agent_host_models.py:48`）与研究域的 `validation`，不只复制名字白名单。
`hostToolAdapter.ts:146–156` 已有每轮出口预算，`tools/index.ts:522` 已有
80 次执行门槛；它们都不是“按 URL/能力记忆失败”。应补窄作用域预算并
保留这些上限，而不是再造一个覆盖所有工具的新全局调度器。

下载失败信息还经过两次降维：

- `backend-services/basic-service/app/services/agent_host/egress.py:290`
  将所有非 200 合并为 `download_failed`，原始状态只放在 message。
- `backend-services/basic-service/app/models/agent_host_models.py:64`
  将该错误分类为 transient；路由
  `backend-services/basic-service/app/routers/agent_host_router.py:80`
  由分类推导 `retryable=true`，未区分确定性的 404 与暂时性 5xx。
- `src/lib/video-editing-agent/tools/hostToolAdapter.ts:296` 只传错误码和
  details 给 `hostFailure`，未传 envelope.message，因而还会丢失上游状态。
- 同文件 `:100` 的默认 next_step 是“不要重试”，`:124` 保留
  `retryable=true`，形成 R6 所验证的矛盾。

原始 403、robots 拒绝可能是正确的出口策略执行，并非需要被绕过的 bug。
需要修正的是可诊断性、分支降级和一致的重试预算，不应默认关闭 robots
或通过无限换域名、猜 URL、换 shell 重试同一被拒目标。

### 3.5 P1：计划完成与实际交付没有关联，导出能力边界未说清

`src/lib/video-editing-agent/tools/planTool.ts:119` 的描述要求最后一次调用
把每步标 completed；`:132` 起只归一化输入并保存计划，不检查产物。
`src/lib/video-editing-agent/promptParts.ts:63` 又要求“全部步骤 completed
才算结束”，`:64` 只要求无 blocker、无重叠、视频轨最长。

因此模型可以删掉 BGM 承诺、缩小步骤含义、标记 6/6，而没有任何机制
保留未履行的要求。R7 甚至在空时间线上接受“导出成片已完成”。
`src/lib/video-editing-agent/yoloAutonomy.ts:35` 仅用计划状态判断剩余工作；
计划全 completed 就不会因实际未交付而触发后续自动续跑。

这里不是“计划没有 blocked 状态”：`src/types/agentToolkit.ts:10` 已支持
blocked。缺陷在完成指令与证据缺失。`yoloAutonomy.ts:35–57` 将 blocked
也视为 open，但只在上一轮正常结束、同一会话且续跑次数小于 1 时继续；
所以不能把第一次熔断后的用户继续，直接解释为自动续跑缺陷。修复后
“只剩无可执行动作的 blocked”应正常停止汇报，避免被新的完成门槛拉入空转。

跨轮状态也有明确缺口：`agent.ts:116–118` 每请求清空 turnState，历史计划
只注入系统提示（`:178`）；`planScan.ts:24–55` 只恢复 title/status/note 等
旧字段。只给 update_plan 入参增加目标或在 turnState 塞能力黑名单，都不能
实现跨“继续”保留。最小做法是扩展现有工具结果信封及其恢复逻辑，按
项目/会话/本次任务区分，并从实际成功生效的计划和实际失败结果恢复；不能
从失败调用 params 或助手自然语言宣称恢复权威状态。

此外，当前注册表只有 `inspect_export`，没有专用导出工具；
`src/lib/video-editing-agent/types.ts:43` 明确写明这一能力边界。
`src/components/video/hooks/useVideoExport.ts:112` 注释及后续实现说明
导出回执来自编辑器导出链路。通用 `bash`/HTTP 能力并不等价于一个
具备项目绑定、预检、取消和完成回执的剪辑导出工具。

结论：当前应准确报告“时间线已编辑，未导出”，不能把 `inspect_export`
当导出动作，也不能仅凭计划状态声称“成片完成”。若产品目标要求全自动
生成文件，需单独实现受现有导出状态机约束的工具桥接，不能仅增加一句
“最后必须导出”的提示词。

### 3.6 P2：素材候选、主体核验和审阅图来源的语义不完整

**下载就绪状态不一致。** 视频搜索已经返回 `materialized` 与下一步提示：
`src/lib/video-editing-agent/tools/searchVideo.ts:185`。
音频搜索仍创建 size=0 的远端条目（
`src/lib/video-editing-agent/tools/searchAudio.ts:48`），
描述直接建议 add_to_track（`:74`），成功结果缺少就绪标记（`:144` 起）。
R8 证明“搜索到音乐”并不等于“已拥有可用 BGM”。
这里应沿用视频候选契约，而不是另造一套下载成功判断。

边界补证：`tools/addToTrack.ts:90–96` 的 metadata-only 拒绝仅覆盖 image，
不覆盖 audio/video。因此不要把“视频搜索有 materialized 标志”等同于已有
全媒体下载守卫；也不要本轮把所有远端音视频一律封禁。应补音频候选提示，
并以实际下载回执/可用源判定本任务已完成的 BGM。历史本地媒体可能缺 size，
不能用一个新布尔值取代实际源、下载状态和既有远端媒体兼容路径。

**主体审阅太晚。** explainer 流程从检索直接进入上轨（SKILL.md `:12`、`:13`），
没有在确定素材之前抽帧核对主题。日志中的
`small dog grooming brush long hair` 是宽泛查询，不能保证命中约克夏。
第三镜已上轨后才被发现为大型浅色犬。此处证据支持工作流缺口，
不支持断言搜索 API 错误地标注了犬种。

**联系表标注污染审阅结论。**
`backend-services/basic-service/app/services/agent_vision/contact_sheet.py:106`
会在联系表的各格左上角绘制 `#序号 + 时间码`。
`backend-services/basic-service/app/routers/agent_vision_router.py:440`
构建联系表，`:474` 把它和用户原问题发送给视觉客户端。
`backend-services/basic-service/app/services/agent_vision/vision_client.py:39`
的系统提示及 `:126` 的问题模板没有说明这是工具叠加的定位文字。

日志多次出现“burned into each panel”“烧录时间码”，与该缺口一致。
代码能够证明工具添加了标签、提示未说明来源，但没有原始媒体帧，
不能断言源视频一定无时间码。应先比对无标签原帧，再判断源画面问题。
也不能把视觉模型抽检表述为“人工复验”。

### 3.7 P2：授权状态 unknown 被说成源网页未声明，credits 被误当修复

`backend-services/basic-service/app/services/agent_host/egress.py:352`
直接调用 `source_record(page_url)`，随后将 `source_page_verified=False`。
`backend-services/basic-service/app/services/web_research/provenance.py:31`
创建记录时默认 `license_status='unknown'`，此路径没有读取页面授权声明。

但 `src/lib/video-editing-agent/tools/qualityLint.ts:456` 的警告文本直接说
“The source page stated no licence”。证据只支持“当前记录未取得授权信息”，
不能推出已经核查过来源页且网页没有声明。

同一规则把 `build_credits` 标为 suggested_tool（`:461`），UI 因而显示
“用 build_credits 修复”。该工具只生成清单并返回 unknown 数量：
`src/lib/video-editing-agent/tools/creditsTool.ts:103`、`:124`；
它不补齐或核验授权，所以日志中运行后同一警告仍存在是可预期的。
UI 标签确实来自 `QualityReportCard.tsx:142–150`
（路径 `src/components/video/components/VideoChatWindow/`）；按钮只是预填
消息，不会自动执行清单工具，不能把未加载错误归因为 UI 绕过工具协议。

另外，`build_credits` 需要按需加载。
`src/lib/video-editing-agent/registry/ToolActivationState.ts:52` 默认只加载
类别前四个工具，`:84` 和 `:90` 要求工具已被下一次模型响应实际提供。
`src/lib/video-editing-agent/tools/index.ts:518` 拒绝未加载执行。
因此修复建议应明确完整动作：
`explore_tools({category:'material_tools',tool_names:['build_credits']})`，
**下一次模型响应**再调用清单工具；“曾探索过该类别”不足以保证它已激活。
现有拒绝保护应保留。

### 3.8 尚不能确认的外部问题

- `robots_unavailable` 的具体 DNS、代理、站点可达性原因：缺少完整请求
  及 `diagnose_url` 分层输出，不能只凭错误码定位。
- 某个下载 URL 为何 404、BGM 下载为何失败：工具参数和上游响应不完整；
  不应根据标题猜测 CDN 文件名。修复后应保留脱敏 URL、上游状态、请求号。
- 视觉 `model_failed`：可能是拒绝、协议或模型服务问题；缺少完整返回，
  无法确定是否模型不支持视觉。
- 字幕冲突的具体两条 cue：缺少参数，仅能复现并确认保护机制正常。
- 最终文件是否黑屏、静音、主体全部正确：没有导出文件，也没有本轮渲染。

## 4. 影响面

| 范围 | 受影响行为 | 边界 |
|---|---|---|
| Agent 时间线编辑及浏览器应用 | 裁短、删除、首次新增后的时长与后续自检不一致 | 编辑几何正确不代表聚合字段正确；现有导出终点另行计算 |
| 严格时长解说视频 | 逐次修复音频/画面警告时超出用户长度 | 30 秒只是复现值，其他固定长度同样受影响 |
| 生成与通用下载 | 不可用端点重复提交、信息丢失、策略拒绝导致整轮终止 | 外部供应商拒绝本身未被证明是本项目错误 |
| YOLO 与普通多步任务 | 计划完成掩盖缺失产物、目标被悄悄缩减 | YOLO 的不提问不等于可以改变明确约束 |
| BGM、素材筛选 | 候选被当作可用素材，主体错配上轨后返工 | 有素材 ID 不代表有本地字节，也不代表主体已审阅 |
| 视觉审阅与来源清单 | 工具标注被当成源画面问题；unknown 被过度解释 | 不应削弱真实水印检测或把未知授权自动变成已许可 |

## 5. 候选修复方案（对比）

| 方案 | 改动内容 | 侵入性 | 风险 | 工作量 | 能解决/不能解决 |
|---|---|---|---|---|---|
| A：只调整提示词与 explainer 流程 | 明确 30 秒优先、先下载审阅、失败换分支、未导出如实汇报 | 低 | 仍依赖模型执行；状态和错误契约继续矛盾 | 小 | 可减少低效调用，不能修复 R1–R6 的实现缺陷 |
| **B：针对根因修工具，并补工作流验收** | 统一时长聚合、保留错误结构与分支预算、目标验收、候选状态、可信完成报告、修正审阅与授权措辞 | 中；集中在 Agent/相关适配器 | 需保持既有撤销、锁轨、历史项目和工具加载语义 | 中 | 覆盖已确认缺陷；真实外部不可用仍应准确降级；不假装已实现自动导出 |
| C：完整自动制片执行器 | 在 B 上新增持久化任务状态机、依赖调度、导出工具、轮询/取消及成品验收 | 高 | 涉及客户端/服务端项目状态、并发、恢复和副作用幂等 | 大 | 可实现从请求到文件的一体化交付，超出本次最小修复范围 |

## 6. 推荐修复：方案 B

优先修可重复证明的状态和契约错误，再收紧工作流。
方案 A 无法纠正真实代码缺陷；方案 C 适合后续明确的自动导出需求，
不应作为本次修复全部问题的前置条件。

### 6.1 最小实施顺序与验收

1. **统一时间线状态更新。** 每次有效 add/move/resize/trim/delete/
   subtitle/repack 后，按实际片段末端重新计算聚合，不与旧值取最大。
   服务端和浏览器复用现有 `trackPatch.computeTimelineEnd`，撤销保持同一
   内容语义；不再新增第四套算法。评审已确认它是内容聚合，无需增加画布
   状态或重写 TimelineAggregate。保留 domain 空轨的 0.001 表示边界，以及
   Store 缩短时夹取播放头的行为。保留导出对隐藏/静音轨道
   的渲染筛选规则，不机械地用全轨聚合替换现有 `renderEnd`。
   验收 R1/R2/R3 的正确值，覆盖删除至空、缩短/延长、字幕替换、撤销和锁轨。

2. **统一失败契约与有界恢复。** 生成、下载保留脱敏后的上游状态、
   error_code、failure_class、retryable、sticky、下一步及可用请求号。
   配置/参数/确定性 4xx 与暂时性故障分开；不要将所有 400 判为配置问题，
   也不要将所有 500 判为临时故障。对已知端点不可用建立本轮能力记录，
   以供应商+实际端点+实际模型为粒度，不能仅换 prompt 或未生效的 model
   参数就重复提交；不把视频端点
   失败无依据地扩展到独立的图片端点。跨“继续”请求也应从明确的失败记录
   恢复，在同一任务链内有界保留；设置改变、过期或用户明确重试后才允许
   一次探测，新任务不能继承过期禁用。读取/下载最多一次有依据的暂时性
   重试；非幂等生成 POST 未确认受理状态时禁止自动重提交。
   策略拒绝应停止对应分支、允许独立编辑继续；保留全局上限和真实异常熔断。
   按真实错误信封的语义分类，兼容 user_input/validation，避免继续使用
   仅匹配研究工具名称的豁免；未知异常仍计数。保留原有出口/执行总预算。

3. **保存明确目标并校验交付状态。** 对编辑任务保存规范化目标时长，
   及来源用户消息标识，在计划更新/继续请求中保留；只有用户明确的新要求
   能改目标，模型不能通过修改步骤标题或不传参数悄悄清除目标。
   `check_timeline`/最终验收区分缓存漂移、真实渲染时长、用户目标三个值，
   时长容差按帧率定义（例如 30fps 下不超过一帧），不要用 0.6 秒当浮点噪声。
   旁白生成后按真实音频时长重新分配镜头和字幕；固定目标内调整脚本、
   语速或合法留白，不能为满足“略长”而扩大目标。
   对编辑交付步骤使用结构化证据，而非根据自然语言标题猜完成条件。
   保持 `update_plan` 对一般研究/文字任务可用，避免通用工具全面耦合视频。
   已完成编辑、生成排队、待导出、已导出、已检查应明确区分；未履行的
   BGM/导出保留已有 blocked 状态和未完成说明。仅剩不可执行的 blocked 时
   停止自动续跑。当前无专用导出工具时如实交接编辑器，不能从历史导出 ID
   推断本次编辑已导出。状态复用现有工具结果与 planScan，不新增任务数据库。

4. **补素材工作流。** 搜索结果统一标示 candidate/materialized；搜索成功
   不能当作下载完成，本任务采用的外部候选要有实际下载回执。候选仍可留在
   库中供选择；不在本轮全局禁止旧工程的远端音视频，也不以缺失 size
   判定旧素材失效。优先使用搜索返回的真实链接，不猜 URL。
   主体要求明确的任务，在正式上轨前按候选抽帧确认；“小型长毛犬”不自动
   等价于“已确认纯种约克夏”。BGM 失败后只尝试有限替代来源，无法获取时
   明确记录纯旁白降级，不悄悄从原计划删除音乐。

5. **修正审阅和清单语义。** 联系表携带工具生成的标签说明/区域信息，
   视觉提示仅排除已知人工标注，必要时提供无标签原帧复核；不能笼统忽略
   所有时间码或角落文字。授权措辞改为“未核验/未记录”，保留
   `source_page_verified`；清单是证据整理，不是授权验证。
   lint 的建议区分“修复”和“辅助调查”，按需工具同时给出明确加载动作。
   原来用于联系表的缓存键只含图像、问题模板、模式和模型
   （`agent_vision_router.py:454–457`）；新增标签说明必须参与模板/版本，
   否则旧的“烧录文字”判断可能继续命中缓存。普通单图审阅不添加标签豁免。

### 6.2 建议的提示词与技能改写要点

以下是供修复节点采用的中文措辞方向，本节点没有修改实际提示文件：

> 用户明确给定时长时，把它作为最终验收目标。使用 TTS 返回的真实时长安排
> 镜头与字幕；视频覆盖音频即可，不为额外留尾扩大目标。先确认素材已下载，
> 主体匹配，再上轨。工具失败后依据错误类别和预算处理；同一不可用端点不要
> 仅更换提示词继续调用。未完成的项目保留未完成状态。时间线完成不代表导出
> 完成；没有本次导出成功回执，就明确报告“已编辑、未导出”。

`explainer-video` 的步骤应补为：确认目标和可用能力 → 脚本 → 旁白实测与
时长预算 → 素材下载和主体审阅 → 视频/音频/字幕/BGM → 目标与时间线验收 →
根据实际能力执行或交接导出 → 有产物才做成品检查。
YOLO 允许自行选默认值和有限降级，但不能覆盖明确的时长要求；真实阻塞时
诚实报告未完成，不要求模型把 blocked 强行改成 completed。

### 6.3 修复节点必须保留的保护

- 字幕冲突原子拒绝，不能以静默覆盖/自动吞字消除错误。
- 按需工具必须在下一响应才可调用；不要删除 `tool_not_loaded` 检查。
- 不编造素材、输出文件、许可证、视觉观察或导出成功。
- 不为绕过熔断而无限增加预算，也不默认放松出口安全策略。
- 不重新引入旧音色默认值，不覆盖本工作区已有的桌面脚本修改。

## 7. 定位节点（Subtask #0）的验证与交接记录

已读取 README.md、CLAUDE.md 和项目索引，核对了 Agent → 工具 →
本地 API → 后端供应商/出口的调用边界，以及浏览器时间线和导出规划。
只新增本目录的诊断报告、离线复现用例、独立配置及输出记录。

| 验证 | 结果 | 证据 |
|---|---|---|
| 本轮最小复现 | 1 文件、9 项通过，退出码 0；缺陷被验证 | `repro-output.txt` |
| 现有针对性基线 | 11 文件、169 项通过，退出码 0 | `baseline-output.txt` |
| 旧默认音色问题 | 端到端字段链路存在，相关测试通过 | 上述基线中的 3 组音色测试 |
| 实际供应商调用、真实渲染、完整构建 | 未执行；诊断范围不声称其通过 | 不依赖真实凭据或付费生成 |

基线命令及全部测试文件名保存在
[baseline-output.txt](./baseline-output.txt) 第一行，可直接复制重跑。
覆盖时长、字幕、工具加载、出口错误、音色和导出，不需要全量构建来证明
本次纯诊断交付。现有测试通过但 R1–R8 仍能成立，说明覆盖中缺少相应验收。

定位节点提出的方案 B 已由下方评审补充实施边界与验收要求。
本报告明确不把历史服务故障、真实媒体质量或自动导出实现标为已解决。

## 评审结论

**唯一推荐：采用本报告修订后的方案 B——修复现有状态/错误契约，增加
编辑任务的轻量目标与完成验收，并同步修正提示词和素材流程。** 原报告
核心根因成立，但直接照原版实施仍有边界空缺；上述补证和以下约束已补齐，
可据此进入修复节点。本节点仅评审分析，不表示业务缺陷已经修复。

### 证据审定

| 审定项 | 结论及证据强度 |
|---|---|
| 时长残留与两端不一致 | R1–R3 和实际事件链均支持。修正原结论：OperationApplier 输出与 Agent 副本有缺陷，UI Store 另有归一化；历史起始 39.775 的来源未确定，也无证据证明必有导出黑尾。 |
| 30 秒被放宽为 30.6 秒 | 日志 `:426、:647、:678`，systemPrompt 强制留尾和缺少目标验收共同支持；不能只改浮点容差，也不能强制把所有音频警告消掉。 |
| 生成重复调用和错误降维 | 后端服务 → router → main 异常处理 → BFF → 工具链闭合；R5 仅验证工具丢字段和无拦截。端点关闭的商业/权限原因没有证据，不作为修复假设。 |
| 出口拒绝影响全局熔断 | R4/R6 支持名称差异及提示矛盾；不能从日志展示顺序还原全部计数。保留成功清零、预期拒绝不清零及独立分支预算。 |
| 虚报完成 | R7 证明 update_plan 可无证据全完成；既有 blocked 状态、YOLO 一次续跑限制和无专用导出工具是边界，不能再引入重复状态机或伪造导出能力。 |
| 素材/视觉/授权语义 | R8、工具提示、联系表绘字和 provenance 创建路径支持；没有原帧/许可页面证据，不能断言犬种、源片有无时间码或真实许可证。 |
| 正常保护与旧问题 | R9 是正确拒绝；按需加载、锁轨、静图保护保留。旧音色修复已有链路与上一节点基线，不重复实施。 |

### 为什么选择 B，以及必须收窄的范围

A 只改文案，无法改变历史最大值、错误字段丢失、全局计数和无证据完成；
即使模型完全服从提示，也会读到错误状态。C 增加持久化执行器和自动导出，
会把本次修复扩成项目状态、任务恢复和渲染副作用改造，且不能恢复外部服务。
B 是覆盖已确认问题的最小闭环：修改已有写入/适配边界，并复用现有计划结果、
历史恢复、导出规划和失败预算。它不是只改一个文件，但每组变更都有对应
复现或直接执行路径证据。

以下为修复节点的明确实现边界：

1. **时长单一语义。** 重算放在成功编辑与重排之后；拒绝/取消操作保持状态
   不变。批量编辑、字幕替换、删除最后项、撤销重做必须经过同一聚合语义。
   保持锁轨、串行应用、播放头约束和 Store 历史机制；不能为了同步聚合而
   回写整份旧快照、覆盖用户当前轨道可见性/静音状态。已打开的旧工程也要
   在 Agent 请求快照或既有归一化边界得到正确派生值，不能必须再编辑一次
   才消除残留。全轨内容末端、可渲染末端、用户目标分别命名并比较。
2. **错误信封和恢复共用事实。** 区分代理状态、本地状态、供应商状态，
   保留受控错误码、脱敏说明和两类请求号；不把 Authorization、签名 URL
   查询串或任意上游 HTML 原样注入历史。404 停止原地址，429/暂时性读取
   故障尊重等待窗口与预算；认证/配置问题等待配置改变；端点不可用只封禁
   对应能力，未知错误不伪装为 policy。取消立即结束，迟到结果不更新素材
   或状态。对同一能力的并发首次探测须原子占用探测名额；首次结果未知时
   不连发同端点试探，成功后正常镜头请求仍可执行，不合并不同用户镜头。
3. **跨轮目标与分支记录最小扩展。** 在现有工具结果信封增加可选、带任务
   身份的编辑目标/承诺/失败事实，并同步类型、planScan/历史恢复及提示。
   新请求初始化恢复的是同项目、同会话、同任务的有效记录；模型上下文
   压缩或省略参数不能抹掉明确的 30 秒。用户显式改变时长或开始新任务才
   替换目标。恢复以已执行工具结果为准，不能重放操作来重建状态；不新增
   持久化作业服务、全局静态黑名单，也不靠任意工具名/标题猜任务种类。
4. **完成门槛只约束结构化编辑任务。** 对明确编辑目标，提交全完成状态前
   确定性检查目标时长、当前时间线和已承诺的媒体/导出证据；检查失败时
   返回可操作原因，保留未完成项及 blocked，不把成功的检查调用当成目标
   已达成。通用文字/研究计划不应因为空视频时间线被拒绝。R7 的修复测试
   因而应增加明确的编辑目标，另保留通用计划可完成的对照。仅有旧
   lastCompositionId、排队 taskId、检查 `ok=true` 或模型自述都不算本次
   导出证据；文件完成状态必须绑定本项目及当前编辑版本。没有桥接能力时
   最终交付语义是“编辑完成/部分完成，未导出”，导出步骤保留 blocked。
5. **提示与轻量语义修正必须一起落地。** 去掉固定额外留尾要求及“最终
   每步必须 completed”指令；改为目标内旁白预算、下载回执、上轨前主体
   抽检、有界替代 BGM、真实未完成说明。保留字幕原子校验与工具激活门槛。
   授权 unknown 只描述未取得证据，credits 仅作为来源整理；联系表标签
   在提示与缓存版本中明确来源，不能全局忽略角落文字/水印。

### 修复验收矩阵

这些是下一节点必须执行的验收，不是本评审已经通过的修复测试。

| 边界/风险 | 必须证明的行为 |
|---|---|
| 几何与实际 UI 同步 | 39.775→30、首次 10 秒、删除到空、移动/重排、字幕替换及批量更新均一致；覆盖真实 Store 接收链，不只测孤立 setter。空轨逻辑为 0、domain 下限保持兼容；锁轨/无效/取消不写入。 |
| 撤销、重复事件与用户状态 | 撤销/重做恢复正确聚合且不增多历史记录；SSE 重复交付按既有幂等语义处理；保留用户可见性/静音、播放头不落在内容之外。 |
| 三种时长与输入 | 全轨中音频/字幕比视频长时，不误报为缓存漂移；隐藏/静音轨依既有 render 规则。固定 30 秒下 30.6 必不通过；实际导出帧率确定后在帧边界比较；无目标旧任务不新增时长 blocker；拒绝非有限/非正目标。 |
| 错误与有界调用 | 视频端点关闭后后续同能力不发网络请求，图片等独立能力可用；覆盖并发探测、继续、新任务、配置更新/过期和用户明确重试。404、429、503、非 JSON、缺字段、取消有一致错误与下一步；非幂等 POST 断线不盲目重发。 |
| 计数器 | 预期 policy/configuration 拒绝不累加也不清空已有异常计数；成功清零；五次真正异常仍终止；分支/出口/执行预算耗尽不得靠改 prompt 或 URL 拼写重置。 |
| 完成、降级和历史 | 明确编辑目标下空时间线/超长/无导出回执不能全完成；BGM 缺失保留 blocked；只剩 blocked 停止空续跑。修改标题、省略新字段、继续、历史压缩不能删除承诺；通用研究计划保持原行为。 |
| 素材与审阅 | 音频零命中/远端候选/实际下载分别返回准确状态；旧本地媒体缺 size 不误杀。先核主题再上轨；带工具标签与无标签帧、真实水印、旧缓存和已核验/未核验授权有对照；清单生成不改变授权事实。 |

### 本次评审实际验证

复核基线仍为 `dbe6812cb2a74cea91e7ca4cfba1e9adc484beae`。
本次只将评审内容写入 analysis.md，未改动前节点的用例/输出记录和业务代码。
以下命令已实际运行，测试缓存关闭，输出直接核对；没有另写日志文件。

```powershell
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/agent-editing-reliability/repro.config.ts --reporter verbose --no-color --cache=false
node node_modules/vitest/vitest.mjs run src/components/video/timeline/store/actions/__tests__/replaceTimeline.test.ts src/components/video/timeline/store/actions/__tests__/replaceTimeline.viewFlags.test.ts src/lib/video-editing-agent/__tests__/planTools.test.ts src/lib/video-editing-agent/__tests__/yoloAutonomy.test.ts src/lib/video-editing-agent/__tests__/qualityLint.test.ts src/lib/video-editing-agent/tools/__tests__/egressTools.test.ts --maxWorkers 2 --no-color --cache=false
```

第一条：1 文件、9 项通过，退出码 0，证明缺陷和反例仍可复现；第二条：
6 文件、87 项通过，退出码 0，核实 Store/计划/续跑/静态自检/出口的现有
契约。两组共 96 项，不能解释为修复通过。上一节点 169 项基线保留原记录，
没有冒充本节点重跑。未访问真实供应商、未渲染历史工程、未执行完整构建。

## 实施过程中发现的方案缺陷

本节为 Subtask #2 的实施补充；不改写上文诊断/评审时的历史结果。

- **锁轨的服务端边界缺失。** 原方案要求保留锁轨，但原 Agent 本地应用入口仅做目标/几何校验，直接调用可修改锁轨而浏览器拒绝。将浏览器已有的锁轨定位函数移至现有 operationGuards 模块复用；先确认失败断言，再修复服务端拒绝。无效/取消操作不触发聚合写入。
- **完成拒绝也会产生有效计划事实。** 完成验收将缺证据步骤降为 blocked 后，工具信封是失败；若仍只恢复 completed/success=true 记录，继续时会丢掉阻塞状态和新增承诺。采用明确的 plan_applied + delivery_incomplete 信封恢复，普通失败、取消和未执行参数仍不当作已生效计划。
- **候选标记须进入素材本身。** 只在搜索返回文案写 candidate，无法让上轨/最终验收区分本任务新候选与旧工程远端素材。搜索新增 metadata.candidate/materialized，在结构化编辑目标下拒绝明确未下载候选；不以缺 size 拒绝旧素材。下载成功写入实际素材回执。
- **联系表说明不能塞进可截断问题。** 视觉客户端会把问题截至 300 字，附加说明可能丢失。用现有客户端新增可选内部 annotations 参数独立传递精确标记文本/矩形，并纳入缓存模板。原帧复核同时修正为指定 material_id 时不被旧 lastCompositionId 覆盖。
- **同步图片生成不能只返回排队。** 实施复核发现图片 API 已同步返回 images，但工具忽略产物、仅建 ai_image pending，而现有轮询跳过该类型。为兑现方案 B 的独立图片降级能力和准确状态，只在已有生成工具成功分支按真实响应入库，不新增队列/导出能力。
- **错误事实须适配现有压缩。** 既有净化器会删除名为 key 的字段，能力和下载分支标识使用 capability/branchId；先恢复同任务、同配置且未过期的执行事实，再做模型上下文压缩。成功配置保存产生非敏感版本标记，不读写凭据。

上述纠正均落在已有文件、已有工具适配边界内，未引入依赖或持久化作业服务。

## 修复实施与验证（Subtask #2）

已按方案 B 实施以下变更：

1. Agent 请求快照、成功编辑、字幕替换和重排复用 `trackPatch.computeTimelineEnd`；浏览器与服务端同步收缩内容时长，空轨为 0。真实 Store 保留其 0.001 边界、撤销重做、播放头夹取及用户视图状态。
2. 生成与下载使用脱敏结构化错误、按能力/地址的有界失败记录与原子探测；实际模型/端点与任务身份决定恢复范围，配置变更、到期或用户本次明确重试才允许探测。关闭非幂等生成自动重提交，取消后不写入迟到结果。
3. 从明确用户消息保存目标时长/来源，计划使用结构化交付类型保存承诺，完成前核对当前素材、可渲染时长及画面覆盖。30.6 秒不能通过 30 秒目标；音频超出画面不再误称缓存漂移。BGM/导出缺证据保留 blocked，只有 blocked 时不自动续跑；一般文字计划维持原行为。
4. 搜索、新候选上轨、素材列表和最终验收使用同一候选/已落盘事实。联系表标注与视觉缓存明确区分工具标签和源画面；授权未知仅说明未取得证据，清单工具只作辅助调查。
5. 提示词及解说技能改为按 TTS 实测分配固定预算、先下载核主题、有限替代 BGM、按实际状态交付。原字幕原子拒绝、按需加载、全局执行预算、旧音色修复均保留。

离线复现命令已手动重跑；`repro.test.ts` 的 R1–R8 改为正确行为断言，保留 R9，并增加真实 Store 接收链、字幕替换/撤销、锁轨/取消、旧快照、异常计数和跨轮恢复对照。最新详细输出见 `repro-output.txt`，16 项通过、退出码 0。

验证范围与限制：未调用真实供应商、未运行收费生成、未渲染历史视频，不能宣称历史外部服务故障已恢复。目标识别支持明确数字秒/分钟的中英文表述，不声称覆盖任意自然语言；无当前项目/编辑版本绑定的导出桥接，所以计划仍如实交接编辑器。下载分支保守合并同路径不同查询参数，以防签名/拼写变化重置预算，可能要求换用独立地址。未新增依赖或文件，未执行 `git commit`；开始前已有的三处桌面文件修改及桌面测试新文件保持原样。

### 最终验证记录

以下为全部修复落盘后的实际结果，各命令退出码均为 0：

| 检查 | 结果 |
|---|---|
| 独立复现配置，verbose、cache=false | 1 文件、16 项通过，最新输出已写入 repro-output.txt |
| 全部 Agent 前端测试，加真实 Store/导出规划回归 | 99 文件、1010 项通过 |
| 后端出口、凭据检查、联系表、视觉路由和视觉客户端 | 6 文件、116 项通过 |
| TypeScript `tsc --noEmit --incremental false` | 通过 |
| Next.js 最终生产构建 | 通过，包括类型检查、89 页静态生成及构建跟踪 |
| `git diff --check` | 通过 |

可复用命令（后端命令在 `backend-services/basic-service` 执行）：

```powershell
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/agent-editing-reliability/repro.config.ts --reporter verbose --no-color --cache=false
node node_modules/vitest/vitest.mjs run src/lib/video-editing-agent src/components/video/timeline/store/actions/__tests__/replaceTimeline.test.ts src/components/video/timeline/store/actions/__tests__/replaceTimeline.viewFlags.test.ts src/components/video/hooks/__tests__/videoExportItems.test.ts --maxWorkers 4 --no-color --cache=false
python -m pytest tests/test_agent_host_egress.py tests/test_agent_host_router.py tests/test_credential_prechecks.py tests/test_agent_vision_contact_sheet.py tests/test_agent_vision_router.py tests/test_agent_vision_vision_client.py -q --disable-warnings
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build
git diff --check
```

后端存在现有 Pydantic/Pillow 等弃用提示及 Windows 子进程析构警告（29 条），均未导致失败。构建提示 Browserslist 数据较旧；未为本修复更新依赖。生产构建按项目既有配置跳过 ESLint，不将其称为 lint 通过。

## Final code review (Subtask #3)

Reviewed the working-tree changes against the recommended, narrowed option B.
The duration changes repair the shared aggregation boundary, and the error,
history and delivery checks enforce their contracts in code. Existing subtitle
atomicity, tool activation, locked tracks, default voice selection, Store history
and rendering rules remain covered by the regression suite.

The final review found and fixed these additional defects:

- A ten-minute cache expiry could end a longer `Retry-After` wait early.
  Generation and egress failure records now survive the whole wait, including
  continuation. HTTP-date waits are retained in generation errors and parsed in
  legacy raw egress responses.
- URL-wide failure caching also blocked legitimate argument corrections. One
  download-kind correction, or HEAD-to-GET correction after HTTP 405, now shares
  the existing two-attempt budget. Changing unrelated arguments does not clear
  it; HTTP 403/404 and policy refusals remain blocked.
- Timestamp, scene-duration and text-only requests could become whole-film
  duration targets. Target parsing now requires a production request and rejects
  these cases. A negated duration change cannot overwrite the saved target.
- Requests for a cover or subtitle track could reset the task identity and
  discard delivery commitments. Task boundaries now distinguish these follow-up
  edits from explicit new tasks and new whole-video requests.
- Undownloaded-material refusals lacked the shared error envelope, so repeated
  expected refusals could trip the global circuit breaker. They now preserve
  the genuine failure count without incrementing or resetting it.
- Generated local images carry an actual local-file receipt but no file size.
  The still-image guard now accepts that receipt with a valid storage key, so
  image-to-video conversion works without inventing a byte count. Unmaterialized
  candidates remain rejected.

Each additional behavioral defect was reproduced by a failing test before its
fix. Independent review rechecked the recovery and plan changes, plus the
candidate-refusal and generated-image fixes. No new dependency or external
service was introduced. The existing desktop changes are unrelated and excluded
from this commit; diagnostic tests and evidence in this directory are included.

Final verification after all source changes (all exit codes 0):

| Check | Result |
|---|---|
| Diagnosis regression command above, cache disabled | 16 tests passed |
| Agent, Store, export, chat-route and execution-hook suites | 103 files, 1,076 tests passed |
| Six backend suites listed above | 117 tests passed; 29 existing warnings |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed |
| `node node_modules/next/dist/bin/next build` | Passed, including type checking, 89 static pages and build traces |
| `python scripts/scan-secrets.py` | Passed for tracked files |
| `git diff --check` | Passed |

The final frontend command extends the implementation node's command with
`src/app/api/video-editing-agent/chat/__tests__`,
`src/components/video/hooks/__tests__/useAgentExecution.yolo.test.ts` and
`src/components/video/hooks/__tests__/useAgentExecution.ordering.test.ts`.
The earlier baseline/reproduction output files retain their original timestamps;
the table above records this node's fresh runs.

The build still skips ESLint under the existing project configuration and reports
outdated Browserslist data. No live provider requests, paid generation or video
rendering were performed. These checks do not establish that the external
providers in the historical conversation have recovered. Export still requires
the existing editor handoff and is never reported complete without evidence.
