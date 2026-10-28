# 启动自检 + 分步配置向导（First-Run Setup Wizard）— 设计文档

> Feature: `first-run-setup-wizard`
> Version: **v2**（已吸收设计评审 P0/P1 修订；v1 为方案设计节点产出）
> Date: 2026-10-28
> 上游: `desktop-config-free-startup`（已落地：单步 `SetupGuideDialog` + `GET /api/config/llm-status`，只覆盖「对话模型」）、`desktop-only-refactor`（无登录、单用户）

## 评审记录（Design Review，v1 → v2）

评审方式：逐节对照 `CLAUDE.md` 与代码（`config_router.py`、`model_settings_service.py`、`web_search_service.py`、`web_research_router.py`、`ModelSettingsPanel.tsx`、`ui/Modal.tsx`、`TitleBarActions.tsx`、`page.tsx`、`config.py`）。结论：整体架构（后端统一判定 + 共用写路径 + 只填缺口）可行且尺寸合适；发现 1 个 P0、7 个 P1（均已在正文修订，位置见「处置」列）、5 个 P2（记录，不阻塞）。

| ID | 级别 | 维度 | 问题（已核实的证据） | 处置 |
|----|------|------|----------------------|------|
| RV-01 | **P0** | 可行性 | **vision 状态判定在「干净安装」下会误判为 `invalid`**。`_resolve_staged_config` 的 env 组判据是 `any(group[:3])`；`vl_llm_model` 默认值 `"qwen-vl-plus"`（`config.py:348`、`:891`）非空，而 url/key 为空 → 组内「有项但不全」→ 抛 `configuration_invalid`。现有仅对 `fast_llm` 有同类特判（`model_settings_service.py:745`），`vl_llm` 没有。后果：①v1 §7.2 的断言「仅 DB chat → vision=inherited」会失败；②用户取消勾选 vision 就永远 `invalid` → 每次启动都弹窗，违背 D7；③运行期视觉审阅同样拿不到 chat 回落（既存缺陷）。注：本评审通过读代码确认，尚未在干净环境实跑（本机 `.env` 已设置 VL_LLM_API_URL），故要求 B0 先写失败测试复现。 | 新增 §3.1.1「前置修复 B0」；§9 增加 Step 0；§7.2 增加用例 |
| RV-02 | P1 | 完整性 | `fetch-models` 失败**不带 HTTP 状态码**：返回 `{success:false, message:"Error: <上游前 200 字符>"}`（`_fetch_models_from_api`），v1 §3.4/§3.7 按 401/403 区分「Key 无效」无法实现；且它只发 `Authorization: Bearer`，anthropic 格式服务商的 `/models` 失败不代表 Key 错 | §3.4 Step 1、§3.7 改为「消息模式匹配 + 保守兜底」：仅明确匹配才报 Key 无效，其余一律「无法验证 → 允许手动填写模型名继续」；Key 的最终校验落在 chat 保存（F5） |
| RV-03 | P1 | 完整性 | v1 请求体 `{api_url, api_key}` 缺 `provider_type`；后端靠 `provider_type` 才会命中 `_get_default_models_for_type`（无 `/models` 端点的服务商直接返回预置模型） | §3.4/§5.4 负载补 `provider_type` |
| RV-04 | P1 | 完整性 / 稳健 | **孤儿服务商**：用户在模型步 chat 失败后「返回修改 Key」，v1 会再走一次 `POST providers`，产生重复/残留服务商（R6 只说「预选已保存」，没解决同一次向导内的重复创建） | §3.4 Step 1：状态已有 `providerId` 时一律走 `PUT /providers/{id}`（`__KEEP__` 约定与设置页一致）；§5.4、§7.2 同步 |
| RV-05 | P1 | 一致性 | D9「手动重开向导」被标 P2「可裁剪」，但 R3（打包 `.env` 带失效 Key 的既往 401 事故）把它当作唯一缓解；而手动模式「允许更换」与 D4「不覆盖」未界定 | D9 升级为 **P1 最小实现**并界定手动模式语义（已配置行默认只读，显式点「更换」才可写）；§4.2、§9 同步 |
| RV-06 | P1 | 一致性 | v1 §5.1 称「`/api/config/` 已在 auth middleware allowlist，无需改中间件」——项目已无登录与鉴权（`CLAUDE.md` No auth），过期陈述会误导实现者 | §5.1 改写；`llm-status` docstring 里的同类说法在改动该文件时顺带订正 |
| RV-07 | P1 | 一致性 | 事件派发点计数错误：`ModelSettingsPanel` 里「删除分配」与「重置分配」是**同一个** `handleResetAssignment`（`:619`），实际需补 2 处（`handleDeleteProvider`、`handleResetAssignment`），不是 3 处；且只能在 `data.success` 之后派发 | §3.5、§4.2 订正 |
| RV-08 | P1 | 一致性 | `ui/Modal` 的 Esc 无拦截参数，只会调用 `onClose`；v1 的「有未提交输入先二次确认」必须在向导的 `onClose` 内实现，未写明。`TitleBarActions.tsx:138` 注释提到旧的 SetupGuideDialog，旧弹窗删除后过期 | §3.6 明确实现位置；§4.2 增加 `TitleBarActions.tsx` 仅改注释 |
| RV-09 | P2 | 完整性 | `web_search` 判定调用私有方法 `WebSearchService._api_keys()`，且需与 `search()` 的归一化（strip / 去重 / 取前 3）同口径，否则「状态 ready 但搜索时 0 个可用 key」 | 增公开 `usable_keys()` 并让 `search()` 复用（已并入 §3.1.1 与 §4.2） |
| RV-10 | P2 | 完整性 | 后端 `CredentialsRequest` 允许最多 5 个 Key，`search()` 只用前 3 个；向导限 3 个需注明是有意为之 | §3.4 Step 3 加注 |
| RV-11 | P2 | 稳健 | opt-out 存 `localStorage`，端口漂移即丢（F10/R11 已评估为安全方向）；更稳的做法是落 `system_settings`，但需新键与读写接口，超出本轮 | 保持 v1 决策，列后续备忘 |
| RV-12 | P2 | 右置尺寸 | 模型步「为单项指定其它模型」高级覆写属锦上添花，增加 reducer 与测试面 | 标注**可后置** |
| RV-13 | P2 | 完整性 | 保存 `fast/video_cut/vision` 槽位时服务端不做连通性测试（仅 chat 有，F5），错误模型名要到运行期才暴露 | 接受；完成页文案只写「已配置」，不写「已验证」 |

---

## 0. 现状勘察（已对照代码核实，后续设计以此为前提）

| # | 事实 | 出处 | 对设计的影响 |
|---|------|------|--------------|
| F1 | 应用已无登录/用户体系，单一本地 owner。需求原文里的「登录以后」是历史说法 | `CLAUDE.md`「No auth」 | 向导**不做任何登录/权限门控**，窗口起来、`hydrated` 后即可检测 |
| F2 | 已有首启引导，但**只检测一项**（CHAT 凭证），且只是「三步说明 + 跳转设置」，不带用户真正填写 | `SetupGuideDialog.tsx`、`useLlmConfigStatus.ts`、`config_router.py:53` | 本方案把它升级为**多能力、可就地完成配置**的向导，并取代旧弹窗 |
| F3 | 应用内可配置的凭证只有两类：①模型服务商 + 6 个功能槽位（`chat/fast/video_cut/vision/coding/research`，表 `model_providers` + `model_assignments`）；②网络搜索 Tavily key（`system_settings.web_research.tavily_api_keys`）。TTS(火山)/Pexels/Unsplash/ARK/Freesound 只能走 `.env`，设置页里没有入口 | `model_settings_router.py`、`web_research_router.py:84`、`config.py`（`VOLCANO_TTS_API_KEY` 等） | 「能力」的范围 = 凡设置页里**能配**的；env-only 凭证列为非目标并预留扩展位（见 §2.2、§8） |
| F4 | 各槽位解析规则不同：`chat/fast/video_cut/coding` 走 `get_effective_config`（**DB 分配优先，缺省回退 env**，且 `fast` 的回退是 env 的 `FAST_LLM_*→LLM_*`，**不会回退到 DB 里的 chat 分配**）；`vision`、`research` 走 `_resolve_staged_config` 成组回落（vision→chat→fast；research→fast→chat） | `model_settings_service.py:598-760` | ①只在 DB 配好 chat 而不配 fast/video_cut，这两项运行时拿到空 key → 向导必须**一并写入**这些槽位；②vision/research 允许「继承」，状态需区分 `ready` 与 `inherited` |
| F5 | `save_assignment` 对 **CHAT** 会先做一次真实连通性测试，失败抛 `ValueError`→HTTP 400 | `model_settings_service.py:302-337` | 保存对话模型天然就是「连通性校验」；向导需把 400 的 `detail` 就地展示，且必须**先存 chat 再存其余** |
| F6 | `coding` 槽位在前端/后端运行期代码中**没有任何消费方**（仅设置面板可分配） | 全仓 grep `resolve/coding`、`ModelFunctionType.CODING`（仅 service 自身） | 不纳入启动闸门，仅在设置页保留 |
| F7 | 保存后会派发 `ecliptrix-llm-config-updated`，首页据此刷新；但**仅**在 provider 保存/assignment 保存时派发，删除 provider/assignment、保存 Tavily key 时不派发 | `ModelSettingsPanel.tsx:423,603` | 需补齐派发点，否则设置页改动后状态/徽标滞后 |
| F8 | 现有 UI 基建：`ui/Modal`（焦点圈定、Esc、焦点交还）、`createPassthroughRoute`（BFF 透传）、`http` 封装、`LocaleContext`（zh/en）、Tailwind 语义色（`bg-card/text-foreground/primary`）、成功色用 `green-*`、提醒色用 `amber-500` | 各文件 | 复用，不造轮子 |
| F9 | 超阈值存量文件：`ModelSettingsPanel.tsx` 1569 行、`model_settings_service.py` 824 行、`i18n.ts` 11298 行 | `wc -l` | 新代码一律拆小文件；对存量文件只做**极小**改动（≤12 行），不借机重构 |
| F11 | `vl_llm_model` 默认 `"qwen-vl-plus"`、url/key 默认空；`_resolve_staged_config` 对 env 组用 `any(group[:3])` 判「是否配置」，只有 `fast_llm` 有默认模型特判 | `config.py:348,891`、`model_settings_service.py:739-760` | 干净安装下 vision 解析抛 `configuration_invalid`（RV-01）→ 需前置修复 B0（§3.1.1） |
| F12 | `fetch-models` 失败返回 `success:false + message` 文本、无状态码；只发 Bearer；`provider_type` 命中预置模型表时直接返回模型 | `model_settings_service.py:373-433` | 错误分类只能基于消息文本；请求需带 `provider_type`（RV-02/03） |
| F10 | 桌面端端口为「首选端口+探测」（`desktop/main/ports.js`），`useTasks` 已依赖 `localStorage` 持久化 | `ports.js`、`useTasks.ts:98` | 「用户选择不使用某能力」可存 `localStorage`；端口漂移最坏结果是弹窗重新出现（安全方向） |

---

## 1. Overview

Ecliptrix 的 AI 能力（对话/Agent、快速模型、AI 混剪、视觉审阅、研究、联网搜索）都依赖用户自己的 API 凭证，这些凭证目前只能在「设置」里逐页配置。首次使用的用户并不知道这件事：软件能打开、能剪辑，但一碰 AI 功能就报 401 / `provider_not_configured`。上一轮已经加了一个只检测「对话模型」的提示弹窗，但它只是「告诉你去设置」，没有带用户真正完成配置，也没有覆盖其它能力。

本方案把它升级成一个**启动自检 + 分步配置向导**：每次启动（窗口 `hydrated` 之后）后端对「每项能力」做一次零秘密的就绪度判定；只要有任何一项能力一个有效配置都没有，就弹出向导。向导按「欢迎总览 → 连接模型服务 → 选择模型 → 联网搜索 → 完成」分步，只展示**当前缺失**的步骤，用户在弹窗里就能填 Key、验证、选模型、一键把同一服务商铺到所有缺失槽位，并看到每一项的实时状态。全部配置完成后，后续启动检测通过，不再弹出，应用直接使用这些配置。

「设置中的信息要与向导设置的信息正确对应」通过**结构性手段**保证，而不是靠文案约定：向导与设置页共用同一条写路径（同样的 BFF 路由 → 同样的后端服务 → 同样的 `model_providers / model_assignments / system_settings` 行），向导不持有任何影子副本；启动检测与设置页「当前生效配置」用同一个解析器（`get_effective_config` / `resolve_*_config`）；任何一侧写入后统一派发事件，另一侧重新读取。向导**绝不覆盖用户已有配置**，只填补缺口。

---

## 2. 目标、非目标与关键决策

### 2.1 目标

1. 每次启动检测每项能力是否「至少有一个可用配置」，有缺口则弹出向导（需求原文）。
2. 向导分步引导、就地完成配置（Key 输入、连通性校验、模型选择、批量分配、搜索 Key），不要求用户跑去设置页。
3. 向导写入的数据与设置页读到的数据严格一致（同表同字段），且可在设置页里继续修改。
4. 设计达到「Anthropic 级」：克制、温和、信息密度恰当、全键盘可操作、无障碍、深浅色、动效可关闭。
5. 稳健：任一接口失败都有明确的、可重试的、不丢用户输入的降级路径；Key 不落盘、不进日志。

### 2.2 非目标

- 不新增 TTS/素材库/ARK 等 env-only 凭证的应用内存储（F3）。能力注册表预留 `kind: 'env_only'` 扩展位，但本轮不实现（理由：`TTSService` 在单例构造时读取 `settings.volcano_tts_api_key`，热更新需要另行设计）。
- 不重做 `ModelSettingsPanel`，不迁移它的逻辑；不改变凭证表结构。
- 不做登录/账号体系（F1）。
- 不在启动时对已配置的 Key 做在线有效性探测（会拖慢启动、泄漏流量、且离线时误报）。状态以「配置完整」为准；有效性在保存时（CHAT 自带连通性测试）与设置页「测试连接」里验证。

### 2.3 关键决策

| ID | 决策 | 理由 / 取舍 |
|----|------|-------------|
| D1 | 就绪度判定由**后端**统一给出（新增 `GET /api/config/capability-status`），前端只渲染 | 解析规则（F4）复杂且会变，放前端会与运行时漂移；同一函数同时服务弹窗与设置页徽标 |
| D2 | 能力分两档：**核心**（`chat`、`fast`、`video_cut`、`vision`）不可被用户永久忽略；**扩展**（`research`、`web_search`）可「不使用」。`coding` 不入闸 | 核心项缺失会让主流程直接报错；扩展项是可选增强，且 `research` 本身会继承 fast/chat。「不使用」避免永远弹窗的骚扰，同时仍满足「有缺口就弹」——被用户明确选择过的不算缺口 |
| D3 | 状态四值：`ready`（有自己的配置）/ `inherited`（按产品既有回落规则借用了别的槽位，视为满足）/ `missing` / `invalid`（成组配置残缺，等同缺失但文案不同）；另有 `indeterminate`（解析器自身异常，前端 fail-open 不弹） | 与运行时语义逐字一致（F4）；`inherited` 不打扰用户，但 vision 仍给一条「建议指定支持图片的模型」的提示 |
| D4 | 向导写入采用**「只填缺口，不覆盖」**：已 `ready` 的槽位只展示、不改；用户想改去设置页（总览页给直达入口） | 防止向导把用户精心配置的内容冲掉 |
| D5 | 「全部用同一模型」为默认，单项可展开覆写；`vision` 行默认同主模型但给出「需支持图像输入」提示与启发式徽标 | 90% 用户只有一个服务商；批量铺开解决 F4-① |
| D6 | 保存顺序：先 `chat`（触发服务端连通性校验），成功后其余槽位并发写入；单项失败只标红该行并允许重试，不回滚已成功项 | F5；部分成功是可接受的中间态，下次启动自然续做 |
| D7 | 「稍后再说」仅本会话有效（`sessionStorage`，沿用现状）；下次启动仍弹。「不使用此能力」跨启动有效（`localStorage`），可在设置页撤销 | 需求「每次开启都检测」；扩展项允许显式放弃 |
| D8 | 保留 `/api/config/llm-status`（标注 deprecated，附原测试）；删除 `useLlmConfigStatus` 与 `SetupGuideDialog`，由 `useSetupStatus` 与 `SetupWizard` 取代 | 避免两套并行；端点保留一个版本做回滚缓冲，无外部消费者 |
| D9 | 向导可从「设置 → 通用」手动重新打开（**P1 最小实现**，RV-05）；手动模式展示全部能力，已配置行默认只读，点「更换」才可写，写路径与自动模式相同 | 解决「环境变量让状态恒为 ready，但 Key 其实已失效」时用户无处重配的问题（见 §8 R3）；「更换」是用户显式动作，因此不违反 D4 |

---

## 3. Technical design

### 3.1 能力注册表与就绪度规则（后端）

新增 `app/services/setup_status_service.py`，内含一张注册表，每项能力声明 id、档位、解析方式：

| id | 档位 | 就绪判定（调用既有解析器，**不复制规则**） | `ready` 与 `inherited` 的区分 |
|----|------|------------------------------------------|-------------------------------|
| `chat` | core | `get_effective_config(CHAT)` 的 url/key/model 均非空且 key 非占位值 | `source` 为 database/environment 均为 `ready` |
| `fast` | core | `get_effective_config(FAST)` 同上 | 同上（F4：不借 DB chat） |
| `video_cut` | core | `get_effective_config(VIDEO_CUT)` 同上 | 同上 |
| `vision` | core | `resolve_vision_config()` 成功 | 命中 `VISION` 阶段 → `ready`；命中 chat/fast 阶段 → `inherited` |
| `research` | extended | `resolve_research_config()` 成功 | 命中 `RESEARCH` 阶段 → `ready`；命中 fast/chat → `inherited` |
| `web_search` | extended | `WebSearchService._api_keys()` 去空白、去占位值后非空 | `ready` / `missing`（DB 中显式存 `[]` 表示用户清空 → `missing`；`None` 继承 env，env 为空 → `missing`） |

「命中哪一阶段」需要 `model_settings_service` 暴露阶段信息：把 `_resolve_staged_config` 的主体拆为 `_pick_stage(stages) -> (stage_function_type, ResolvedConfigResponse)`，原方法只取 `[1]`，行为零变化；新增公开薄封装 `resolve_stage_origin(stages)`（共 ≤12 行改动，F9）。`WebResearchError("configuration_invalid")` 映射为 `invalid`，`provider_not_configured` 映射为 `missing`，其它异常映射为 `indeterminate` 并 `logger.exception`。

**3.1.1 前置修复 B0（RV-01，必须先于注册表落地）**：在 `_resolve_staged_config` 中为 `vl_llm` 增加与现有 `fast_llm` 特判同形的守卫——当 `prefix == "vl_llm"`、url 与 key 均为空、且环境变量 `VL_LLM_MODEL` 未显式设置时，把 env 组视为未配置（`environment = None`），使 vision 按其文档化语义回落到 chat → fast。先写失败测试（§7.2「vision 默认模型」用例）复现，再改；改动 ≤6 行，属行为修复而非重构。触发条件只取「url/key 皆空且未显式设模型」，不扩大到已有 `VL_LLM_*` 配置的用户。

`web_search` 的判定通过新增的公开方法 `WebSearchService.usable_keys()`（strip → 去重 → 取前 3，`search()` 同步复用，行为不变）完成，不直接调用私有 `_api_keys()`（RV-09）。

占位值判定复用 `config_router._PLACEHOLDER_PATTERN`（`^your_.*_here$`），抽到 `setup_status_service` 里导出，`config_router` 改为引用同一常量，避免两份正则。

返回体**零秘密**：只含 id、档位、状态、来源（database/environment/inherited/none）、可展示的模型名与服务商显示名；严禁 api_key / api_url。

### 3.2 前端状态机：`useSetupStatus`

```
mount(hydrated) ─► fetch /api/config/capability-status
   ├ 成功 ─► capabilities[]  ─► needsSetup = core 有 missing/invalid
   │                              或 extended 有 missing/invalid 且未被用户 opt-out
   ├ 失败 ─► 退避重试 1s / 2s / 4s（共 3 次，应对后端冷启动竞态）─► 仍失败 → 'unknown'（fail-open，不弹，仅日志）
   └ 事件 'ecliptrix-llm-config-updated' / 设置页关闭 ─► 静默重取（不回到 loading，避免闪烁）
status: 'loading' | 'complete' | 'needs-setup' | 'unknown'
```

页面层（`page.tsx`）：`showWizard = status==='needs-setup' && !sessionDismissed && !isSettingsOpen`；标题栏设置齿轮的琥珀色提醒点沿用（`showSettingsAttention = status==='needs-setup'`）。

### 3.3 向导步骤派生（纯函数，可单测）

`deriveWizardSteps(capabilities, optOuts, savedProviders)` 返回有序步骤列表，只包含当前需要的：

1. `overview`：始终第一步（总览清单 + 预计耗时「约 2 分钟」）。
2. `provider`：存在 `missing/invalid` 的**模型类**能力才出现。若库里已有已保存的服务商，则默认选中最近一个并显示「使用已保存的 X」，同时提供「添加新的服务商」。
3. `models`：同上条件；`provider` 完成后进入。
4. `search`：`web_search` 为 `missing` 且未 opt-out 才出现。
5. `done`：始终最后一步（逐项状态汇总 + 进入应用）。

例：用户只缺联网搜索 → 步骤为 `overview → search → done`，步进器只显示 3 点。再次启动时若仅剩一项，总览页直接把主按钮写成「继续配置」并预选第一个缺口。

### 3.4 各步骤的交互与数据流

**Step 0 总览（overview）**
- 左栏（≥720px 宽时）为纵向步进器：每步一个圆点 + 标题，已完成显示对勾，当前步高亮；窄窗口折叠成顶部「第 2 步 / 共 4 步」+ 细进度条。
- 右栏标题「先把 AI 能力接通」，副文案一句话说明「只需你自己的 API Key；Key 只保存在本机」。下面是**能力清单**：每行 = 图标 + 能力名 + 一句话用途 + 状态胶囊（`已配置` 绿 / `沿用对话模型` 灰 / `待配置` 琥珀 / `配置不完整` 红）。已配置行有「在设置中查看」文字链接。
- 底部：次按钮「稍后再说」（会话级）、主按钮「开始配置」（`autoFocus`）。

**Step 1 连接模型服务（provider）**
- 服务商以「分组卡片网格」呈现（国内 / 国际，数据来自 `GET /api/model-settings/providers`），选中即回填默认 API 地址与 `api_format`（与设置页 `ProviderFormState` 同一逻辑）；末尾有「自定义（OpenAI 兼容）」。
- 表单只有两个必填项：**API Key**（`type=password`、`autocomplete="off"`、显隐切换、粘贴自动 trim、校验 `^your_.*_here$`）与（自定义/可改时）**API 地址**；服务商显示名默认取 `known.name`，折叠在「高级」里可改。
- 主按钮「验证并继续」：调用 `POST /api/model-settings/fetch-models`（临时凭证，不落库；负载含 `provider_type`，RV-03）。
  - 成功（含模型列表）→ **向导状态尚无 `providerId`**：创建服务商 `POST /api/model-settings/providers`（字段与设置页**逐字段一致**：`name / provider_type / api_url / api_key / api_format`），把返回的 `provider.id` 存进向导状态；**已有 `providerId`**（用户从模型步返回修改）：改走 `PUT /api/model-settings/providers/{id}`，Key 未改传 `'__KEEP__'`、改了传新值（与设置页一致），**绝不再次创建**，避免孤儿服务商（RV-04）。落库后立即从组件状态中**清除明文 Key**。
  - 失败 → 就地错误（见 §3.7 矩阵），**不创建/不更新**服务商，不丢已输入内容。`fetch-models` 无状态码（F12），分类规则：消息明确含 `401`/`403`/`unauthorized`/`invalid` → 「Key 无效或无权限」；明确的连接类异常 → 「无法连接」；**其余一律视为「无法验证」**，提示「该服务商未提供模型列表或暂时无法验证」并允许手动填写模型名继续（Key 的最终校验在 chat 保存，F5）。
  - 服务商没有 `/models`（命中预置模型表，或属于「无法验证」）→ 允许继续，下一步改为手动输入模型名。
- 重名（后端 400 `already exists`）→ 自动加后缀 ` 2` 重试一次，仍失败再报错。

**Step 2 选择模型（models）**
- 顶部「主模型」选择器：可搜索下拉（来自 `fetch-models` / `default_models`，也可切换为手动输入）。
- 其下是「同一服务商用于」清单，勾选框默认全选**当前缺失**的槽位：快速模型（`fast`）、AI 混剪（`video_cut`）、视觉审阅（`vision`，缺失时）；`research` 若是 `inherited` 不出现在默认清单，在「高级 · 为单项指定其它模型」里可展开覆写。每行显示槽位名 + 默认温度（`chat/fast/video_cut/vision 0.7`、`research 0.2`、`coding 1.0` 与设置页默认一致，不暴露给用户）。
- `vision` 行常驻提示：「需要支持图片输入的模型」；若模型名匹配启发式 `/(vl|vision|4o|gemini|claude|glm-4v|qwen.*vl)/i` 则显示「可能支持图片」徽标，否则显示琥珀色提醒但**不阻止**。
- 「为单项指定其它模型」高级覆写属可后置能力（RV-12），首版核心路径不依赖它。
- 主按钮「保存并继续」执行 D6 序列：`PUT /api/model-settings/assignments`（`chat` 先行；`max_tokens: 128000` 与设置页一致）→ 其余并发（并发度 3）。保存期间整个步骤进入 `aria-busy`，按钮显示进度「正在验证对话模型…」。
- 结果呈现：成功行出现对勾；失败行显示该行错误 + 「重试」；`chat` 失败则阻断后续，错误文案展示服务端 `detail`（含「CHAT model connection test failed: …」），并提供「返回修改 Key / 换个模型」。

**Step 3 联网搜索（search）**
- 说明一句话 + 「获取 Key」外链（Tavily，使用 `shell.openExternal`/`<a target="_blank" rel="noopener noreferrer">`，沿用项目现有外链方式）。
- 输入框支持粘贴多个 Key（换行/逗号分隔，最多 3 个，与后端 `[:3]` 一致，超出给提示）。
- 主按钮「保存并测试」：`PUT /api/web-research/credentials` → `POST /api/web-research/test-connection`；`reachable:false` 时展示 `resolveResearchStatus` 已有的文案映射（复用 `webResearchStatus.ts`，不新造错误文案），并给「仍然保存并继续」。
- 注：后端 `CredentialsRequest` 最多接受 5 个，而 `search()` 只取前 3 个；向导限 3 个是有意为之，勿「对齐」到 5（RV-10）。
- 次按钮「暂不使用联网搜索」→ 写入 opt-out（D7），步骤视为完成。

**Step 4 完成（done）**
- 大标题「准备就绪」，下方复用总览清单（此时应全部为 绿/灰）；对每项展示实际生效的模型名与来源徽标（`数据库`/`环境变量`/`沿用`）。
- 主按钮「开始创作」关闭向导并触发状态静默重取；次链接「在设置中调整」→ `onGoToSettings('model')`。
- 若仍有未完成项（用户点了「稍后」或部分失败）→ 主按钮改为「先进入应用」，并提示「剩余 N 项可随时在设置中补全」。

### 3.5 「设置 ↔ 向导」一致性保证

1. **同一写路径**：向导新增 `src/lib/api/modelSettings.ts`（`listKnownProviders / listSavedProviders / fetchModels / createProvider / saveAssignment / testConnection`），端点与负载与 `ModelSettingsPanel` 内联调用逐字段一致；Tavily 复用既有 `saveResearchCredentials / testResearchConnection`。不新建任何后端写接口。
2. **同一读路径**：向导总览/完成页展示的状态来自 `capability-status`，其内部就是设置页「高级」Tab 用的 `resolve/{fn}` 解析器，不存在第二套判定。
3. **事件闭环**：新增 `src/lib/setupEvents.ts` 导出 `notifySetupConfigUpdated()`（事件名保持 `ecliptrix-llm-config-updated`，零迁移）。派发点：向导每次写成功；`ModelSettingsPanel` 现有 2 处 + 补 2 处（`handleDeleteProvider`、`handleResetAssignment`；「删除分配」与「重置分配」是同一函数，RV-07），一律只在 `data.success` 之后派发；`WebResearchSettingsPanel` 保存/清除凭证后。`useSetupStatus` 收到即静默重取。
4. **设置页状态徽标（P2）**：`SettingsSidebar` 的「模型设置」「联网搜索」项根据同一 hook 显示琥珀色小点 + 无障碍文本「待配置」，让用户在设置里一眼看到与向导同口径的缺口。
5. **回归测试钉住对应关系**（§7 AC-9/10）：向导保存后，用同一 mock 后端状态渲染 `ModelSettingsPanel`，断言服务商名、`provider_type`、各槽位模型名一致。

### 3.6 视觉与交互规范（Anthropic 风格）

- **容器**：`ui/Modal`，宽 `min(720px, 94vw)`，高度自适应、最大 `88vh` 内部滚动；`closeOnBackdrop={false}`（防止误触丢失刚粘贴的 Key），Esc = 「稍后再说」（若有未提交输入则先二次确认：行内确认条而非嵌套弹窗）。圆角 `rounded-2xl`，`border-border`，阴影克制（沿用 `shadow-2xl` 仅弹窗层），背景遮罩 `bg-black/50 backdrop-blur-sm`（与现状一致）。
- **色彩**：全部走语义 token（`bg-card / text-foreground / text-muted-foreground / primary / border`），深浅色自动适配；状态色沿用项目现有约定——成功 `green-600/400`、提醒 `amber-500`、错误 `text-destructive`；**不引入新色板、不用大面积渐变**（去掉旧弹窗的渐变图标圆）。
- **排版**：标题 `text-xl font-semibold`，副文案 `text-sm text-muted-foreground leading-relaxed`；一屏只讲一件事，每步 ≤ 1 个主操作；大留白（内边距 `p-8`，区块间距 `space-y-6`）。
- **动效**：步骤切换 150ms 淡入 + 8px 位移；保存中使用小型 spinner；全部带 `motion-reduce:transition-none motion-reduce:animate-none`。
- **反馈**：所有异步按钮点击后立即禁用并换成进行态文案；结果用 `role="status"`（成功/进行）与 `role="alert"`（错误）的 `aria-live` 区域；错误紧贴相关字段，描述「发生了什么 + 下一步做什么」，不展示堆栈。
- **Esc 实现位置**：`ui/Modal` 的 Esc 无拦截参数，只会调用 `onClose`（RV-08）；「有未提交输入先行内确认」由向导自己的 `onClose` 处理——有草稿时只置位确认条状态、**不**真正关闭，再次 Esc 或点「放弃」才触发 `onClose('later')`。
- **键盘与焦点**：进入每步焦点落在该步首个输入（总览落在主按钮）；`Enter` 提交当前步；`Shift+Tab` 反向；步进器圆点为按钮，仅可回到**已完成**的步骤（不允许跳到后面）；关闭后焦点归还（`Modal` 已实现）。
- **响应式**：窗口宽 < 640px 时步进器折叠为顶部进度条，服务商网格降为 2 列；Electron 最小窗口宽度下无横向滚动。
- **文案**：中英双语，句子短、动词开头（「验证并继续」「保存并测试」），避免术语堆砌；Key 相关处统一提示「仅保存在本机」。

### 3.7 失败处理矩阵

| 场景 | 行为 |
|------|------|
| 状态接口超时/5xx/网络错 | 退避重试 3 次 → `unknown`，**不弹窗**、不阻塞应用；日志 `console.warn` 一次 |
| `fetch-models` 返回 401/403 | 字段级错误「Key 无效或无权限」，停留当前步 |
| `fetch-models` 网络不可达/超时 | 错误「无法连接到服务商，请检查网络或 API 地址」+「重试」；同时给「跳过验证，手动填写模型名」 |
| 服务商不支持 `/models` | 切换为手动输入模型名，提示「该服务商未提供模型列表」 |
| 创建服务商重名 | 自动加后缀重试一次 |
| 向导内返回修改 Key / 服务商（已有 `providerId`） | 走 `PUT`，不重复创建（RV-04） |
| `chat` 分配 400（连通性测试失败） | 展示服务端 `detail`；阻断其余槽位；提供「返回上一步」 |
| 其余槽位某项失败 | 仅该行报错并可单独重试；已成功项保留 |
| Tavily 保存成功但测试失败 | 展示映射文案 + 「仍然保存并继续」/「重新输入」 |
| 向导中途关闭/崩溃 | 已创建的服务商/已保存的分配均已落库；下次启动重新计算缺口，自动续做（`provider` 步骤预选已保存服务商） |
| `localStorage/sessionStorage` 抛错 | 全部 `try/catch`，降级为「每次提醒」/「不记忆 opt-out」 |

---

## 4. File / module change plan

### 4.1 新增

| 文件 | 意图 |
|------|------|
| `backend-services/basic-service/app/services/setup_status_service.py` | 能力注册表 + `compute_capability_status()`，复用既有解析器；导出占位值正则 |
| `backend-services/basic-service/app/models/setup_status_models.py` | `CapabilityStatusItem / CapabilityStatusResponse`（Pydantic，零秘密） |
| `backend-services/basic-service/tests/test_setup_status.py` | 状态矩阵、零秘密契约、异常→indeterminate、占位值 |
| `src/app/api/config/capability-status/route.ts` | BFF 透传 `GET /api/config/capability-status` |
| `src/lib/api/modelSettings.ts` | 模型服务商/分配/拉取模型/测试连接的类型化客户端（与设置页同端点同负载） |
| `src/lib/setupEvents.ts` | `SETUP_CONFIG_UPDATED_EVENT` 常量 + `notifySetupConfigUpdated()` |
| `src/lib/setupOptOut.ts` | opt-out 的 `localStorage` 读写（带 try/catch，仅 extended 档有效） |
| `src/hooks/useSetupStatus.ts` | 状态机 hook（§3.2），含退避重试与静默重取 |
| `src/components/Onboarding/SetupWizard.tsx` | 向导壳：`Modal` + 步进器 + 导航 + 会话级关闭确认（≤250 行） |
| `src/components/Onboarding/wizard/wizardSteps.ts` | `deriveWizardSteps` 纯函数 + 类型 |
| `src/components/Onboarding/wizard/useSetupWizard.ts` | 向导 reducer/动作（选择服务商、保存、重试），无 UI |
| `src/components/Onboarding/wizard/WizardStepper.tsx` | 纵向/折叠步进器（按钮语义、`aria-current="step"`） |
| `src/components/Onboarding/wizard/CapabilityChecklist.tsx` | 能力清单 + 状态胶囊（总览与完成页共用） |
| `src/components/Onboarding/wizard/ProviderStep.tsx` | Step 1：服务商网格 + Key 表单 + 验证 |
| `src/components/Onboarding/wizard/ModelsStep.tsx` | Step 2：主模型选择 + 批量槽位 + 保存结果行 |
| `src/components/Onboarding/wizard/SearchStep.tsx` | Step 3：Tavily Key + 测试/跳过 |
| `src/components/Onboarding/wizard/DoneStep.tsx` | Step 4：汇总 |
| `src/components/Onboarding/wizard/SecretInput.tsx` | 密码输入（显隐、trim、占位值校验、无障碍标签） |
| `src/components/Onboarding/wizard/modelHints.ts` | 视觉模型启发式、各槽位默认温度表 |
| `src/components/Onboarding/__tests__/SetupWizard.test.tsx`、`wizard/__tests__/*.test.ts(x)` | 见 §7 |
| `src/hooks/__tests__/useSetupStatus.test.ts` | 见 §7 |

### 4.2 修改

| 文件 | 意图 |
|------|------|
| `backend-services/basic-service/app/routers/config_router.py` | 新增 `GET /capability-status`；`/llm-status` 标注 deprecated；占位值正则改为引用 service 常量 |
| `backend-services/basic-service/app/services/model_settings_service.py` | ①前置修复 B0：`vl_llm` 默认模型守卫（≤6 行，RV-01）；②拆出 `_pick_stage` + 公开 `resolve_stage_origin`（≤12 行，行为不变）。该文件 824 行属存量超阈，两处合计 ≤18 行，不借机重构 |
| `src/app/page.tsx` | 换用 `useSetupStatus` + `SetupWizard`；`onGoToSettings(item)` 支持多目标；保留会话级 dismiss |
| `src/components/settings/ModelSettingsPanel.tsx` | 用 `notifySetupConfigUpdated()` 替换 2 处内联派发，并在 `handleDeleteProvider` / `handleResetAssignment` 成功后补 2 处（≤12 行；存量 1569 行，不重构） |
| `src/components/settings/WebResearchSettingsPanel.tsx` | 保存/清除凭证成功后 `notifySetupConfigUpdated()` |
| `src/components/settings/SettingsSidebar.tsx`（P2） | 对「模型设置」「联网搜索」显示待配置小点（可选 prop `attention`） |
| `src/components/settings/GeneralSettingsPanel.tsx` + `SettingsPage.tsx`（**P1**，D9） | 「重新运行设置向导」按钮及回调透传 |
| `src/components/shell/TitleBarActions.tsx` | 仅订正第 138 行注释（不再提 SetupGuideDialog），不改逻辑（RV-08） |
| `backend-services/basic-service/app/services/web_research/web_search_service.py` | 增 `usable_keys()` 并让 `search()` 复用（≤6 行，行为不变，RV-09） |
| `src/lib/i18n.ts` | 新增 `setupWizard` 命名空间（接口 + en + zh 三处）；旧 `setupGuide` 中仍被 `ModelQuickStartCard` 使用的键保留 |
| `CLAUDE.md`（Shell 小节一行） | 记录「首启向导」入口与事件名 |

### 4.3 删除

| 文件 | 原因 |
|------|------|
| `src/components/Onboarding/SetupGuideDialog.tsx` 及其 `__tests__/SetupGuideDialog.test.tsx` | 被 `SetupWizard` 取代（D8） |
| `src/hooks/useLlmConfigStatus.ts` 及其测试 | 被 `useSetupStatus` 取代；`/llm-status` 端点与后端测试保留一个版本 |

---

## 5. Interface design

### 5.1 `GET /api/config/capability-status`（项目无登录与鉴权中间件，路由不带任何鉴权依赖，与 `llm-status` 一致，RV-06；后端仅绑定 127.0.0.1）

```json
{
  "success": true,
  "data": {
    "capabilities": [
      { "id": "chat",       "tier": "core",     "state": "ready",     "source": "database",    "provider_name": "DeepSeek", "model_name": "deepseek-chat" },
      { "id": "fast",       "tier": "core",     "state": "missing",   "source": "none" },
      { "id": "video_cut",  "tier": "core",     "state": "missing",   "source": "none" },
      { "id": "vision",     "tier": "core",     "state": "inherited", "source": "inherited",   "inherited_from": "chat", "model_name": "deepseek-chat" },
      { "id": "research",   "tier": "extended", "state": "inherited", "source": "inherited",   "inherited_from": "chat" },
      { "id": "web_search", "tier": "extended", "state": "missing",   "source": "none" }
    ],
    "missing_core": ["fast", "video_cut"]
  }
}
```

- `state ∈ ready | inherited | missing | invalid | indeterminate`；`source ∈ database | environment | inherited | none`；`tier ∈ core | extended`。
- 解析器整体异常 → `{"success": false, "data": {"capabilities": []}}`（HTTP 200，与 `llm-status` 的 R4 语义对齐，前端映射 `unknown`）。单项异常仅该项为 `indeterminate`。
- **契约红线**：响应不得出现 `api_key`、`api_url`、密钥片段（测试强制）。

### 5.2 前端类型（`src/types/setup.ts` 或并入 `src/lib/api/setupStatus.ts`）

```ts
export type CapabilityId = 'chat' | 'fast' | 'video_cut' | 'vision' | 'research' | 'web_search';
export type CapabilityState = 'ready' | 'inherited' | 'missing' | 'invalid' | 'indeterminate';
export interface CapabilityStatus {
  id: CapabilityId; tier: 'core' | 'extended'; state: CapabilityState;
  source: 'database' | 'environment' | 'inherited' | 'none';
  providerName?: string; modelName?: string; inheritedFrom?: CapabilityId;
}
export type SetupStatus = 'loading' | 'complete' | 'needs-setup' | 'unknown';
export function useSetupStatus(): {
  status: SetupStatus; capabilities: CapabilityStatus[]; refresh: () => void;
};
```

### 5.3 组件接口

```ts
interface SetupWizardProps {
  open: boolean;
  mode: 'auto' | 'manual';               // manual：设置页手动打开，展示全部能力
  capabilities: CapabilityStatus[];
  onClose: (reason: 'finished' | 'later') => void;  // later → 会话级 dismiss
  onOpenSettings: (item: SettingsMenuItem) => void;
}
```

### 5.4 复用的既有 HTTP 接口（不新增写接口）

| 动作 | 方法与路径（BFF 同名） | 负载要点 |
|------|----------------------|----------|
| 已知服务商 | `GET /api/model-settings/providers` | — |
| 已保存服务商 | `GET /api/model-settings/providers/saved` | Key 已脱敏 |
| 拉取模型（临时） | `POST /api/model-settings/fetch-models` | `{api_url, api_key, provider_type}`（失败无状态码，见 F12） |
| 创建服务商 | `POST /api/model-settings/providers` | `{name, provider_type, api_url, api_key, api_format}` |
| 更新服务商 | `PUT /api/model-settings/providers/{id}` | 同上；Key 未改传 `'__KEEP__'`（向导内回退重填时使用，RV-04） |
| 分配模型 | `PUT /api/model-settings/assignments` | `{function_type, provider_id, model_name, temperature, max_tokens:128000}` |
| 保存搜索 Key | `PUT /api/web-research/credentials` | `{tavily_api_keys: string[]}` |
| 测试搜索 | `POST /api/web-research/test-connection` | `{}` |

### 5.5 事件与存储键

| 名称 | 类型 | 说明 |
|------|------|------|
| `ecliptrix-llm-config-updated` | `window` 事件 | 任一处写入配置成功后派发，`useSetupStatus` 静默重取 |
| `ecliptrix-setup-guide-dismissed` | `sessionStorage` | 沿用现键，值 `'1'` |
| `ecliptrix-setup-optouts` | `localStorage` | JSON 数组，如 `["web_search"]`；读到 core 档 id 一律忽略 |

### 5.6 i18n 键（`setupWizard`，中英同构）

`title, subtitle, privacyNote, stepOverview, stepProvider, stepModels, stepSearch, stepDone, stepCounter, start, resume, later, back, next, saveContinue, verifyContinue, saveTest, skipSearch, finish, finishPartial, openSettings, rerun`；能力名/用途 `cap.{chat,fast,video_cut,vision,research,web_search}.{name,desc}`；状态 `state.{ready,inherited,missing,invalid}`；来源 `source.{database,environment,inherited}`；字段 `apiKey, apiKeyPlaceholder, apiUrl, providerName, advanced, mainModel, manualModel, useSameForAll, visionHint, visionLikely`；错误 `err.{keyInvalid,unreachable,noModelList,chatFailed,slotFailed,searchUnreachable,duplicateName,generic}`；`retry, skipVerify`。

---

## 6. Data model

**无新增表、无 schema 变更**（遵守 CLAUDE.md「不做破坏性 DDL」）。读写的既有数据：

| 存储 | 写入者 | 内容 |
|------|--------|------|
| `model_providers`（SQLite） | 向导 / 设置页 | `name, provider_type, api_url, api_key, api_format` |
| `model_assignments` | 向导 / 设置页 | `function_type, provider_id, model_name, temperature, max_tokens`（`function_type` 唯一） |
| `system_settings.web_research.tavily_api_keys` | 向导 / 设置页 | `list[str]`；`[]`=用户清空；`null`=继承 env |
| `sessionStorage['ecliptrix-setup-guide-dismissed']` | 页面 | 会话级「稍后」 |
| `localStorage['ecliptrix-setup-optouts']` | 向导 / 设置页（撤销） | 扩展档能力 id 列表 |

内存态（向导 reducer）：`{ stepIndex, selectedKnownId, apiUrl, apiFormat, displayName, apiKeyDraft(提交后清空), fetchedModels[], providerId, mainModel, slotPlan: Record<fn, {enabled, model}>, slotResult: Record<fn, 'idle'|'saving'|'ok'|'error'>, searchKeysDraft }`。明文 Key 仅存在于 `apiKeyDraft/searchKeysDraft`，提交成功或离开步骤即清除，**绝不写入任何 storage、绝不 `console.log`**。

---

## 7. Testing & acceptance criteria

### 7.1 验收标准

| AC | 描述 |
|----|------|
| AC-1 | 零配置启动：窗口 `hydrated` 后弹出向导，总览列出 6 项能力，核心项为「待配置」 |
| AC-2 | 每次启动都检测：任一核心能力 `missing/invalid`，或扩展能力缺失且未 opt-out → 弹出；全部满足 → 不弹 |
| AC-3 | 仅缺 `web_search` 时步骤为 总览→搜索→完成；仅缺模型时无搜索步 |
| AC-4 | 填入有效 Key → 「验证并继续」后服务商落库；失败则不落库、输入保留、错误就地可读 |
| AC-5 | 选主模型并保存：`chat` 先存且经服务端连通性校验；`fast/video_cut/vision` 被写入；完成页全部为已配置 |
| AC-6 | 向导不覆盖已 `ready` 的槽位（对比保存前后该槽位 provider/model 不变） |
| AC-7 | `chat` 保存失败时展示服务端 detail，其余槽位**不**被写入；其余槽位单项失败可单独重试 |
| AC-8 | 向导完成后重启应用：不再弹出，且 `ModelSettingsPanel` 显示的服务商/槽位与向导所选一致 |
| AC-9 | 在设置页删除某槽位分配 → 事件触发 → 状态更新；下次启动重新弹出缺口 |
| AC-10 | 「稍后再说」/Esc 本会话不再弹出，重启后仍弹出；「暂不使用联网搜索」跨重启生效且可在设置撤销；核心项无法被永久忽略 |
| AC-11 | 状态接口失败：不弹窗、不白屏、不阻塞；后端冷启动 ≤4s 的竞态由重试吸收 |
| AC-12 | 响应体与日志中无 API Key；Key 不出现在 storage；刷新页面后输入框不回填 |
| AC-13 | 无障碍：全程键盘可完成；焦点圈定与归还；错误区 `role="alert"`；步进器 `aria-current`；对比度 AA；`prefers-reduced-motion` 下无动画 |
| AC-14 | 中英文切换后向导文案完整，无硬编码字符串、无溢出 |
| AC-15 | 深色/浅色主题下视觉一致，无硬编码颜色 |

### 7.2 自动化测试

**后端（pytest，SQLite 内存库，沿用 `test_config_llm_status.py` 的 fixture 模式）** — `tests/test_setup_status.py`：
- 全空环境 → 6 项均 `missing`，`missing_core` 含 4 项；
- 仅 DB 配 chat → `chat=ready`，`fast/video_cut=missing`，`vision/research=inherited`（钉住 F4）；
- 配 chat+fast+video_cut → 无核心缺口；
- 仅 env 配 `LLM_*` → 各项 `source=environment`，`fast/video_cut` 经 env 回落为 `ready`；
- **vision 默认模型（RV-01，先红后绿）**：env 无 `VL_LLM_*`、DB 无 vision 分配、DB 有 chat → `vision=inherited(from chat)`，而不是 `invalid`；`VL_LLM_API_URL` 有而 key 空且显式设了 `VL_LLM_MODEL` → 仍为 `invalid`；
- 占位值 key → `missing`；`VL_LLM_API_URL` 有而 key 空 → `invalid`；
- `web_search`：DB `[]` 且 env 有 key → `missing`（用户清空优先）；DB `null` + env 有 key → `ready`；
- `usable_keys()`：空白/重复/超过 3 个的归一化与 `search()` 使用的集合一致；
- 单项解析器抛异常 → 该项 `indeterminate`，整体仍 `success:true`；整体异常 → `success:false`；
- **零秘密契约**：把测试用的 key/url 序列化进断言，响应 JSON 字符串里不得出现；
- `llm-status` 旧端点行为不变（保留原测试）。

**前端（Vitest + Testing Library，不引入新框架）**：
- `wizardSteps.test.ts`：步骤派生矩阵（含 manual 模式、opt-out、已保存服务商）；
- `useSetupStatus.test.ts`：四态映射、退避重试序列（fake timers）、事件触发静默重取（不回到 loading）、opt-out 仅对 extended 生效、storage 抛错降级；
- `SetupWizard.test.tsx`：⓪向导内「返回修改 Key」只发 `PUT providers/{id}`、不再 `POST`（RV-04）；①总览→服务商→模型→完成的 happy path（mock `fetch` 并断言**请求负载**与设置页一致）；②验证失败停留且不创建；③chat 400 阻断其余；④单项失败重试；⑤Esc/「稍后」/关闭确认；⑥键盘导航与焦点；⑦Key 提交后输入清空、storage 中无 Key；
- `SecretInput.test.tsx`：显隐、trim、占位值报错；
- **对应关系回归** `settingsCorrespondence.test.tsx`：同一份 mock 后端状态先走向导保存，再渲染 `ModelSettingsPanel`，断言名称/类型/槽位模型一致（AC-8 的自动化版本）；
- `ModelSettingsPanel`/`WebResearchSettingsPanel` 现有测试保持绿，补「删除/清除后派发事件」断言。

**质量门**：`npm run type-check`、`npm run lint`（差分判据：新增文件 0 error）、`npm run test`、`pytest tests/test_setup_status.py tests/test_config_llm_status.py`；新增文件均 ≤800 行、函数 ≤50 行。

### 7.3 桌面端手工走查（强制）

打包版（`npm run build:dir`）分别在：①全新 userData（无 `.env` 凭证）；②仅有 env 的 `LLM_*`；③已通过向导配置后重启；④断网；⑤深色主题 + 英文；⑥窗口缩至最小宽度——逐项走 AC-1…AC-15。使用至少一个真实服务商 Key 完成端到端一次对话 + 一次联网搜索。

---

## 8. Risks & mitigations

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 状态判定与运行时解析漂移，向导说「已配置」而功能仍 401 | 判定全部委托既有解析器（D1）；后端测试钉住 F4 的回落语义；每新增能力必须在注册表中指定其运行时解析函数 |
| R2 | 仅配 chat 时 fast/video_cut 为空（F4-①），用户以为配好了 | 向导默认勾选并写入所有缺失槽位；测试钉住「仅 DB chat → fast/video_cut 为 missing」 |
| R3 | 打包产物的 `.env` 带失效 Key（既往事故：packaged 后端 `.env` 覆盖根 `.env`，导致 401），状态恒为 `ready(source=environment)`，向导永不出现 | 启动检测不做在线探测（§2.2）；完成页/总览明确标出 `环境变量` 来源；提供设置页手动「重新运行设置向导」（D9），向导保存后 DB 分配优先于 env，即可覆盖失效 env。根因（打包 env 清理）属独立问题，不在本轮 |
| R4 | 弹窗骚扰：用户故意不用某能力 | 扩展档 opt-out + 会话级「稍后」；核心档不可永久忽略（它们缺失会让主流程报错） |
| R5 | 用户在向导里粘贴 Key 后误触关闭而丢失 | 禁用遮罩点击关闭；Esc 在有未提交输入时先行内确认 |
| R6 | 保存中途失败留下半成品（服务商已建、分配未全） | 设计接受部分成功（D6）；状态按行展示；下次启动自动续做；provider 步骤预选已保存服务商，避免重复创建 |
| R7 | 后端冷启动竞态导致首次状态请求失败，误判 `unknown` 而错过引导 | 3 次退避重试（1/2/4s）；失败仍 fail-open；设置页关闭与事件也会重取 |
| R8 | Key 泄漏（日志、storage、错误提示、状态接口） | 明文仅在内存草稿；提交后清除；状态接口契约测试；错误展示只用服务端 `detail` 与本地白名单文案，不回显请求体 |
| R9 | 存量大文件继续膨胀（F9） | 对 `ModelSettingsPanel`/`model_settings_service` 只做 ≤12 行改动；新逻辑全部放新文件 |
| R10 | `i18n.ts` 已 1.1 万行，再加一个命名空间 | 沿用项目「单文件」约定（CLAUDE.md），命名空间集中、键名同构；不在本轮拆分 i18n |
| R11 | `localStorage` 随端口漂移丢失 opt-out | 最坏结果是扩展项弹窗重现，可再次「不使用」；已在 F10 评估 |
| R12 | vision 启发式误判 | 仅作提示徽标，不阻止保存；真实可用性由设置页「测试连接」与运行期错误反馈 |

---

## 9. 实施顺序（供下游节点拆分任务）

0. **前置修复 B0（RV-01）**：先写 vision 默认模型失败测试，再改 `_resolve_staged_config`；确认既有 `tests/test_model_settings_*` 仍绿。
1. **后端**：`setup_status_service` + 模型 + `model_settings_service` 小拆分 + 路由 + `test_setup_status.py`（先写失败测试，再实现）。
2. **前端基础**：`modelSettings.ts`、`setupEvents.ts`、`setupOptOut.ts`、`useSetupStatus` + 测试；BFF 路由；补齐事件派发点。
3. **向导**：`wizardSteps` → `useSetupWizard` → 各步骤组件 → `SetupWizard` 壳；i18n 中英文案同步落地。
4. **接线**：`page.tsx` 替换旧弹窗/旧 hook，删除旧文件；`CLAUDE.md` 一行说明。
5. **P1 收尾**：设置页「重新运行设置向导」按钮（D9）。**P2**：设置侧边栏待配置点；模型步高级单项覆写（RV-12）。
6. **验证**：type-check / lint 差分 / vitest / pytest；桌面端手工走查 §7.3。

---

## 评审结论

**有条件通过**（v2）。架构方向、尺寸和与现有约定的一致性均成立：后端统一判定、与设置页共用写路径、只填缺口不覆盖、无 schema 变更、新代码全部落新文件。v1 中的 1 个 P0 与 7 个 P1 已在正文修订（见顶部「评审记录」RV-01…08；RV-09…13 为 P2 记录项，不阻塞）。进入开发的条件：

1. **先做 B0（RV-01）**：vision 默认模型守卫 + 先红后绿的测试必须在 `setup_status_service` 之前合入；否则「干净安装→配 chat→vision 仍 invalid」会让向导循环弹出。
2. 向导内回退重填 Key 必须走 `PUT providers/{id}`，并有测试钉住（RV-04）。
3. `fetch-models` 的错误分类采用「保守兜底」规则，不得假设存在 HTTP 状态码（RV-02）。
4. D9 的「重新运行设置向导」按钮为 P1 交付物，不得裁剪（RV-05）。
5. 完成页与总览文案对 `fast/video_cut/vision` 只写「已配置」，不得写「已验证」（RV-13）。

---

## 实施过程发现的方案缺陷

实施节点（开发）对照 v2 落地时发现的偏差与缺口。均已按下述「处理」落地，无静默偏离；需要评审/验收关注的放在前面。

| ID | 级别 | 问题 | 处理 |
|----|------|------|------|
| IM-01 | P1 | §3.2 的 `showWizard = status==='needs-setup' && …` 会在向导**自己的首次写入**之后（状态翻为 `complete`）把向导卸载，完成页和后续步骤被直接抽走 | `page.tsx` 用 `wizardMode`（`auto`/`manual`/`null`）做「开启后锁存」：自动条件满足时置 `auto`，只有 `onClose` 才清空；向导壳仅在激活时挂载，每次打开都是干净状态 |
| IM-02 | P1 | §3.3 只说步骤「派生」，未说明**冻结**。实测若随实时状态重算，保存 chat 后 `chat` 行立即从槽位清单消失、步进器点数缩水 | `useSetupWizard` 在打开时一次性派生 `steps` 与 `slots`（`useState` 初始化器）并冻结；完成页/总览仍读实时状态 |
| IM-03 | P1 | 自动模式下「完成」时仍有缺口（用户走『先进入应用』）若不记会话级 dismiss，页面的自动开启 effect 会立刻重开向导（死循环） | 自动模式的**任意**退出（含 `finished`）都写会话级 dismiss；手动重开（D9）从不写，以免抑制下次自动提示 |
| IM-04 | P2 | `useModelsStep` 最初用 effect 给主模型填默认值，渲染到模型步的那一帧主模型为空、保存按钮禁用（单测复现：4 个用例连锁失败） | 改为派生值 `typedModel ?? models[0] ?? ''`；`models` 变化时清空手填值 |
| IM-05 | P2 | §3.3 签名 `deriveWizardSteps(capabilities, optOuts, savedProviders)` 里的 `savedProviders` 并不影响步骤列表（只影响 provider 步的默认选中） | 实现为 `(capabilities, optOuts, mode)`；已保存服务商的预选放在 `useProviderStep`（选最近一个已保存的） |
| IM-06 | P2 | §3.4 把 `fetch-models` 的 key 无效判据写成含 `invalid`；裸 `invalid` 会把「invalid request/model」误判为 Key 错 | 判据收紧为 `401/403`、`unauthorized`、`forbidden`、`authentication`、`invalid api key`、`incorrect api key`；其余走保守兜底（unverified）。`Request timed out…` / `Failed:…` 归为 unreachable。单测钉住 |
| IM-07 | P2 | `ResolvedConfigResponse` 不含服务商显示名，§5.1 示例里的 `provider_name` 无处可取 | `setup_status_service` 按 `provider_type` 反查已知服务商显示名；自定义服务商不返回该字段（前端不依赖它） |
| IM-08 | P2 | §3.4 模型步写的「可搜索下拉 + 切换手动输入」需要两套控件 | 用 `<input list>` + `<datalist>` 一个控件同时满足搜索与手填，无需模式开关；服务商不给模型列表时直接提示手填 |
| IM-09 | P2 | 项目有 `themeTokens` 测试禁止 `hsl(var(--x))` 包装（颜色 token 已是完整颜色值），首版复选框用了 `accent-[hsl(var(--primary))]` 被全量测试拦下 | 改用 `accent-primary` |
| IM-10 | P2 | 手动重开向导后在搜索步保存了 Key，若此前存在 `web_search` 的 opt-out，会留下与事实相反的「不使用」标记 | `useSearchStep` 保存成功后调用 `removeOptOut('web_search')` |

**RV-12 未实现（按 spec 允许后置）**：模型步「为单项指定其它模型」高级覆写。核心路径一个主模型 + 勾选槽位已覆盖；后续要做时只需在 `useModelsStep` 的 `enabled` 旁加一个 `modelOverride` 映射。

**未做 / 未验证（如实记录）**：
- §7.3 桌面端打包走查（AC-1…AC-15 逐项、真实服务商 Key 的端到端一次对话 + 一次联网搜索）**未执行**；本节点没有打包与真实 Key。深浅色、英文、最小窗口宽度的**视觉**效果也只做了代码层面保证（语义 token、`motion-reduce`、`sm:` 响应式），未在真实窗口里看过。
- 全量 vitest 末次运行 4581 项中 3 项失败，均不在本次改动范围：`VideoEditorContainer.recoveryBackup`（源码正则遇到 CRLF 文件）、`toolkitTools`（36 秒超时）、`themeTokens`（本次引入后已修复，IM-09）。前两项未改动相关文件，未在干净检出上复跑做基线对比。
- 本机 `import app.main` 会撞已知的 cv2 环境问题（见记忆「isolated cv2 via PYTHONPATH」），故没有起完整应用做端点冒烟；`capability-status` 路由经 `config_router`（`main.py:679` 已 `include_router`）注册，由 `TestClient` 挂同一 router 的 pytest 覆盖。

