# 首启向导 · 全能力覆盖与取证链接（Setup Wizard — Full Capability Coverage）— 设计文档

> Feature: `setup-wizard-full-capability-coverage`
> Version: **v2**（第 2 轮；v1 为方案设计节点产出，v2 为评审修订：下方《评审记录》RV2-01…14，P0/P1 已回写正文，正文中以 **【v2】** 标记修订处）
> Date: 2026-11-01
> 上游: `docs/plans/first-run-setup-wizard/spec.md`（v2，已落地 `6fc956ea`；本文简称 **R1 spec**）。凡与 R1 spec 冲突之处以本文为准，冲突清单见 §10。

---

## 评审记录（Review Notes · v1 → v2）

> 评审方式：逐节对照代码与 `CLAUDE.md`，对 v1 的关键论断逐条抽样核实（读了 `config.py`、`tts_service.py`、`audio_transcription_service.py`、`voice_clone_service.py`、`video_search_service.py`、`audio_search_service.py`、`research_run_router.py`、`researchUiOrigin.ts`、`backend-proxy.ts`、`wizardSteps.ts`、`useSetupWizard.ts`、`setupOptOut.ts`、`setup_status_service.py`、`modelHints.ts`、`secret-shape.js`、两份 env 模板、相关既有测试）。严重度：**P0** = 按原文实现则核心路径必然不通或破坏既有保证；**P1** = 按原文实现会产生确定的回归/错误实现/不可测；**P2** = 打磨项。

| ID | 严重度 | 维度 | 问题（v1） | 证据 | 处理 |
|----|--------|------|------------|------|------|
| RV2-01 | **P0** | 可行性 | BFF 路由写成「透传」，但后端写接口调 `validate_ui_origin(write=True)`，**缺 `Origin` 头即 403**。通用 `backend-proxy.ts` 默认**不转发 `Origin`**（仅 `forwardHeaders` 指定的头）；现有先例用 `protectedSettingsWrite(path, method, always)`（`forwardHeaders:['Origin']` + 前置 `researchOriginAllowed`），且该助手的 `method` 类型只有 `'POST'｜'PUT'`，**不支持 `DELETE`**。照 v1 实现，7 个集成的保存/清除/测试在 Electron 与 dev 下**全部 403**，整个特性不可用；R9 只说「403 时显示来源被拒绝」，没发现这是必现而非偶发 | `research_run_router.py:53-62`、`researchUiOrigin.ts:6-39`、`backend-proxy.ts` 无 Origin 转发 | 已修：§3.5 新增「BFF 契约」，§4.1/4.2 增 `protectedSettingsWrite` 支持 `DELETE`，§7.2 增 BFF 路由测试，AC2-17 |
| RV2-02 | P1 | 一致性 | §3.3 把 `api_key/appid/access_token` 改成**只读 `@property`**，并声称「外部引用与既有测试继续可用」。事实：4 个既有测试文件共 8 处**直接给服务实例赋值**（`test_audio_transcription_service.py:94-95`、`test_sentence_tts_error_details.py:41,181`、`test_tts_error_details.py:23,381`、`test_tts_router.py:540,551`）。无 setter 的 property 赋值抛 `AttributeError`；G14 只数出 2 个文件，漏算。另：若 `__init__` 里保留 `self.api_key = …` 赋值，会命中 setter 并把「构造期快照」悄悄带回来 | grep `tests/` | 已修：§3.3 改为带「覆盖值」setter 的描述符 `credential_property`；§0 增 G15；§7.2 回归门加入这 4 个文件；`__init__` 中的赋值必须删除 |
| RV2-03 | P1 | 一致性 | §3.2 要求共享判据覆盖 `secret-shape.js` 的**全部**形态（含 `^sk-test`、未锚定的 `/EXAMPLE/`、`xxxxxxxx` 子串）。该列表的语义是「打包扫描时哪些值可以放行」，不是「这是不是用户真密钥」。同一个 `is_usable_secret`/`isPlaceholderKey` 还被**模型服务商**与 Tavily 的 Key 判定复用（`config_router.py:65`、`useProviderStep.ts:170`、`useSearchStep.ts:43`、`SecretInput.tsx:41`）。加宽后：R1 的 `SetupWizard.test.tsx:31`（`SECRET='sk-test-secret-123'`）会被 `keyPlaceholder` 拒绝而变红，违反 AC2-15；真实 Key 若含子串 `EXAMPLE` 也会被误拒 | `secret-shape.js:60-70`、`modelHints.ts:25`、上述测试 | 已修：§3.2 判据收窄为「整串锚定」的 7 条，明确**不收录** `^sk-test`、未锚定 `EXAMPLE`、`xxxxxxxx` 子串；§7.2 一致性测试改用同一份收窄后的样例表，并把 `sk-test-…` 列为「必须判为可用」的反例 |
| RV2-04 | P1 | 完整性 | §3.3 迁移表漏了声音克隆的**两处残留直读**：`voice_clone_service.py:225`（`settings.volcano_voice_clone_tts_resource_id`）与 `:48`（`speaker_id_prefix`）。前者是注册表里用户可选的 `tts_resource_id` 字段——用户在卡片里选了 `seed-icl-1.0-concurr`，运行期仍读 env 默认值，**保存不生效**。同时守卫测试的模式 `settings.volcano_` 会把非凭证的 `speaker_id_prefix` 一并判红，或迫使人去放宽模式 | `voice_clone_service.py:46-48,225` | 已修：§3.3 补两行；§3.3 守卫改为**逐字段名枚举**而非前缀匹配，`speaker_id_prefix` 显式列入非凭证白名单 |
| RV2-05 | P1 | 完整性（可测性） | v1 没有定义解析器的**测试接缝**。env 基线取自模块级 `settings` 单例与 `os.getenv`，而 R1 的 `test_setup_status.py` 是用 `SimpleNamespace` stub `get_settings`（该 stub **没有** `ark_api_key/pexels_api_keys/volcano_*` 属性）并把 DB 工厂绑到 `model_settings_module.async_session_factory`。结果：①基线读取会 `AttributeError` 或读到开发机真实 `.env`，AC2-1「14 项无 ready」在开发者机器上不确定（违反 CLAUDE.md「测试不得依赖共享环境状态」）；②新服务拿 DB 会话的方式未定，无法给 `test_integration_credentials.py` 注入内存库 | `test_setup_status.py:30-75` | 已修：§3.2 增「测试接缝」：基线经单一可替换入口 `_baseline_reader`（缺属性一律视为空），DB 经模块级 `async_session_factory`；`tests/conftest.py` 加 autouse 夹具把基线置空、把缓存清空 |
| RV2-06 | P1 | 可行性 | §3.5 的 TTS 探针「复用 `TTSClient` 合成 1 个字 + 10 秒总超时」不成立：`TTSClient.synthesize_speech` 是**同步 `requests.post(timeout=30)`**，放进 async 路由会阻塞事件循环，且 `asyncio.wait_for` 取消不了线程内的同步调用，10 秒超时形同虚设；`MOCK_MODE`（`settings.tts_mock_mode`）下它**不联网也返回成功**，探针会伪造 `ok`，违反 §3.5 自己的「不得伪造 ok」。失败码也需要从 `TTSServiceError.code` 映射到 `outcome` | `tts_service.py:33,58-122` | 已修：§3.5 探针规则：同步探针一律 `asyncio.to_thread`；`TTSClient` 增可选 `timeout` 形参（默认 30，不改既有调用）；`MOCK_MODE` 下直接 `unverifiable`；给出错误码→`outcome` 映射 |
| RV2-07 | P2 | 一致性 | §3.1 说 ASR 的 env 基线「已含回落 `VOLCANO_TTS_APPID`」，§3.8 与 R7 却写「应用内三张语音卡片互相独立：ASR 卡片留空即未配置，不会因 TTS 填了什么而显示为已配置（env 基线层对老 `.env` 的回落保留，见 §3.1「回落口径」）」，自相矛盾。真实代码（`config.py:908-932`）里 ASR 与声音克隆都回落到 TTS 旧字段 | `config.py:908-932` | 已修：统一口径——**应用内存储层不做回落**（卡片里 ASR/克隆各自独立，留空即未配置）；**env 基线层保留回落**以兼容老 `.env`，且来源徽标显示「环境变量」 |
| RV2-08 | P2 | 完整性 | `secret_list`（Pexels/Unsplash）的 PUT 是整体替换，而密钥从不回显——用户想「再加一个 Key」必须把旧的重输一遍，且不知道会替换 | §3.2 patch 语义 | 已修：§3.7 卡片规则：显示「已配置 N 个」，输入框留空=不变，非空=**整体替换**并在框下明示 |
| RV2-09 | P2 | 完整性 | ARK 探针（列任务只读接口）只能证明 **Key 有效**，证明不了模型已开通；v1 把 `ok` 一律渲染成「连接正常」，会让用户以为 Seedream/Seedance 可用（G11 第③条正是这个坑） | §3.5、G11 | 已修：§3.5/§3.7：ARK 的 `ok` 文案为「Key 有效；还需确认已开通对应模型」并常驻 `activationUrl` 链接；AC2-12 同步 |
| RV2-10 | P2 | 适度 | §3.5 把 `validate_ui_origin` 搬到 `app/security/ui_origin.py`，理由「避免路由 import 路由」。但仓库已有 3 个路由（`agent_toolkit_router`、`agent_vision_router`、`system_settings_router`）用函数内惰性导入的先例；搬迁对本特性无收益，只增加 diff 与回归面 | grep | 已修：删除搬迁，沿用惰性导入先例；§4.1/4.2 相应删行 |
| RV2-11 | P2 | 完整性（发布） | R1 老用户升级路径没有显式验收：已完成 R1 向导的用户升级后，8 个新 extended 能力是 `missing` 且未 opt-out，向导会再次弹出。行为本身符合需求（「所有能力都要配置」），但应当是**可预期且不重复已完成的步骤** | `wizardSteps.ts` 的缺口派生 | 已修：新增 AC2-16（模型已就绪时只出现 overview + 新分组步骤 + done）与对应单测 |
| RV2-12 | P2 | 完整性 | `credentialLinks.test.ts` 要求「覆盖后端 10 个预置服务商」，但前端测试拿不到后端的预置列表（CI 无后端） | `model_settings_service.py:44-72` | 已修：契约夹具增 `providerPresetIds`，后端测试断言与 `model_settings_service.PROVIDERS` 一致，前端测试读夹具 |
| RV2-13 | P2 | 完整性 | §3.9「接线点实现时 grep 补全」没有产物约束，容易漏。另外有的服务在未配置时**静默返回 `None`/空列表**（如 `audio_search_service._make_api_request`），路由不会知道是「没配置」而不是「没结果」 | `audio_search_service.py:44-47` | 已修：§3.9：路由层在调用服务**前**用 `is_usable` 预检并返回 `credential_not_configured`；接线点清单落档到 `link-audit.md` §B，每个接线点一条测试 |
| RV2-14 | 说明 | — | **核实无误的论断**（无需修改）：G1、G3（两份 env 模板均为 `your_*_here`，仅后端 `env.template` 的 4 个 `VOLCANO_TTS_*` 字段〔API_KEY/APPID/ACCESS_TOKEN/SECRET_KEY〕无 `_here`）、G4、G6、G9（`window.js:125-131` 仅有 `setWindowOpenHandler`）、G10、G11 的 ASR 头（`X-Api-App-Key`/`X-Api-Access-Key`）、G12（`RUNNING_HUB_API_KEY` 全仓只出现在两份模板）、G13（Pexels 日志片段、Freesound `token=` 查询串）、ARK 读取点总数 10 处（但 v1 §3.3 表格只列出 9 个行号，漏了 `ark_video_service.py:534`，已补）、10 个预置服务商 id、主机白名单覆盖表中全部 URL、前端端口默认固定 18320（opt-out 的 localStorage 在重启后可保留）。**仍无法核实**（延续 v1 声明）：全部取证链接与探针端点的线上有效性。 | — | 无需修改 |

**评审总评**：方向正确——勘察抓住了「脱敏安装包 + 凭证只能写 `.env`」这个真问题，据此引入专用表 + 单一解析器是对的取舍，没有过度设计（`system_settings` 复用方案确有泄露与播种问题）。v1 的缺陷集中在**与现有代码接缝处的假设**：BFF 的 Origin 契约（P0）、property 与既有测试、判据加宽的副作用、两处漏迁读取点、测试接缝、探针对同步客户端的假设。以上均已在正文修订。

---

## 0. 现状勘察（已对照代码核实；后续设计以此为前提）

| # | 事实 | 出处 | 对设计的影响 |
|---|------|------|--------------|
| G1 | 向导与 `capability-status` 目前只覆盖 6 项：`chat/fast/video_cut/vision/research/web_search`。TTS、字幕识别(ASR)、声音克隆、AI 图片(Seedream)、AI 视频(Seedance)、Pexels 视频库、Unsplash 图片库、Freesound 音效库**完全不在范围内** | `setup_status_service.py`、`setupStatus.ts` | 本轮新增 8 项能力，共 14 项 |
| G2 | 这 8 项能力的凭证**只能写在 `.env`**，应用里没有任何入口：`VOLCANO_TTS_API_KEY`、`VOLCANO_ASR_APPID/ACCESS_TOKEN`、`VOLCANO_VOICE_CLONE_APP_KEY/ACCESS_KEY`、`ARK_API_KEY`、`PEXELS_API_KEY`、`UNSPLASH_ACCESS_KEYS`、`FREESOUND_API_KEY`。R1 spec 的 F3/§2.2 把它们列为非目标，理由是「TTSService 单例构造时读凭证，热更新要另行设计」 | `config.py:387-510`、`env.template`、R1 §2.2 | **本轮必须推翻该非目标**：没有应用内存储，向导就只能「提示用户去改文件」 |
| G3 | **公开安装包的 `.env` 已被脱敏**：`prepare-env.js` 默认把所有密钥形值换成 `your_<key>_here` 占位符（提交 `dca783aa`）。即干净安装后，上述 8 项全是占位符，普通用户既找不到也不应去手改 `userData/.env` | `desktop/scripts/prepare-env.js:136-185`、`env.template.desktop:56-74` | 向导是这些凭证的**唯一**合理录入入口；该场景必须作为验收主线 |
| G4 | **运行期服务把占位符当作「已配置」**：`TTSService.validate_config` 只判 `not api_key.strip()`；`AudioTranscriptionService._missing_credentials` 只判空；`VoiceCloneService`、`VideoSearchService(settings.pexels_api_keys)`、`ARK` 各处同理。占位符非空 → 通过自检 → 到上游才报 401 | `tts_service.py:327`、`audio_transcription_service.py:254`、`voice_clone_service.py:110`、`ark_video_service.py:332` | 判定必须统一过一个「占位符感知」的解析器；否则向导说「待配置」而功能说「已配置」（R1 §R1 风险的同类漂移） |
| G5 | R1 的占位符正则 `^your_.*_here$`（`setup_status_service.PLACEHOLDER_PATTERN`、前端 `isPlaceholderKey`）窄于桌面脱敏脚本的判据（`secret-shape.js` 的 `PLACEHOLDER_PATTERNS`：`^your_[a-z0-9_]*$`、`xxx`、`<…>`、`change-me`…）。**`env.template`（后端模板）里 `VOLCANO_TTS_API_KEY=your_volcano_tts_api_key` 不以 `_here` 结尾**，会被 R1 判据误当成真 Key | `setup_status_service.py:31`、`modelHints.ts:25`、`secret-shape.js:60-70`、`env.template:114` | 统一为一个共享判据并加一致性测试（§3.2） |
| G6 | 各服务读取凭证的时机不一：`TTSService/AudioTranscriptionService/VoiceCloneService/VideoSearchService` 在**构造时**快照 `settings.*`；`ImageSearchService/AudioSearchService` 构造时读 `os.getenv`；`ark_*`/`storyboard`/`video_cover_v2` **每次调用**读 `settings.ark_api_key`。模块级单例在 import 时创建 | `tts_service.py:861`、`video_router.py:58`、`image_router.py:18`、`audio_router.py:26` | 要做到「配置完马上可用、不重启」，所有读取点必须改成**调用时**读取同一个解析器（§3.3） |
| G7 | 项目已有的「热更新」惯用法是把 `system_settings` 回写到 `settings` 单例（`_apply_setting_to_config`）。Tavily Key 用的是 `system_settings.web_research.tavily_api_keys` + 在通用 `/api/system-settings` 路由里**专门打补丁脱敏**（`system_settings_router.py:102,208,260,307`）；且 `update_setting` 对未播种的键抛 `Setting not found` | `system_settings_service.py:385`、`system_settings_router.py` | 不把新凭证塞进 `system_settings`（通用路由会泄露 + 需 YAML 播种）。改用**专用凭证表 + 专用路由** |
| G8 | 凭证存储先例：`model_providers.api_key` 是 `Text` 明文列（SQLite，在 userData），`__KEEP__` 哨兵表示「不改」；审计表 `settings_audit_log` **不记录值**，只记 action/category/key | `db_models.py:23-37,324`、`model_settings_service.py:160-179` | 新表与之同等级别（明文本机、不进审计/日志）；加密列为后续（§9 R4） |
| G9 | Electron 对外链接：`setWindowOpenHandler` 对非 `127.0.0.1/localhost` 的 URL 调 `shell.openExternal`；**没有 `will-navigate` 拦截**，所以没有 `target="_blank"` 的 `<a>` 会把整个应用窗口导航走 | `desktop/main/window.js:125-131` | 所有取证链接必须经统一组件渲染，强制 `target="_blank" rel="noopener noreferrer"`，且 URL 只来自代码内静态注册表（不接受后端/用户输入） |
| G10 | 向导里**唯一**一个取证链接是 Tavily 的硬编码常量 `TAVILY_KEYS_URL`（`SearchStep.tsx:16`）。模型服务商步骤没有「去哪拿 Key」；`ProviderInfo` 没有 URL 字段 | `SearchStep.tsx`、`ProviderStep.tsx`、`model_settings_models.py:24` | 新建统一的链接注册表，覆盖 10 个预置服务商 + 8 个集成（§3.6） |
| G11 | 凭证之间有**非显然的耦合**：①字幕识别用的是火山「流式语音识别」应用的 **APP ID + Access Token**（旧版控制台），**不是**语音合成的 V3 API Key；二者需分别获取。②`ARK_API_KEY` 同时驱动 AI 图片(Seedream)、AI 视频(Seedance)、分镜、封面生成。③AI 图片/视频还需在方舟控制台**开通对应模型**，Key 有效 ≠ 能生成。④声音克隆的 speaker_id 需在控制台**购买**，不是 Key 的一部分 | `config.py:405-500`、`audio_transcription_service.py:402-411`、`ark_*`、`voice_clone_service.py:117-122` | 卡片文案必须把这些讲清楚，否则用户填对了 Key 仍然失败 |
| G12 | `RUNNING_HUB_API_KEY` 出现在 `env.template`/`env.template.desktop`，但 `app/` 内**无任何消费方**；`AGENT_LLM_API_XX_*` 仅被旧 `llm_service` 使用，前端不引用；`coding` 槽位无消费方（R1 F6） | `grep` 全仓 | 三者列为「已审计、不纳入」，避免向导要求配置一个不存在的能力 |
| G13 | 小问题（顺手修）：Pexels 在 debug 日志里输出 Key 的前 10 + 后 5 个字符（`video_search_service.py:37`）；Freesound 把 Key 放在 URL 查询串 `token=` 里（`audio_search_service.py:55`），`raise_for_status()` 的异常消息含完整 URL 并被 `logger.error` 记录 | 同左 | 迁移到解析器时一并改为 header 认证 + 不记录 Key 片段 |
| G14 | 8 个现有后端测试用 `monkeypatch`/`patch` 改 `settings.ark_api_key`、`settings.pexels_api_keys`；其中 `test_ark_video_modes_unit.py`、`test_video_search.py` 是 `patch("<service>.settings")` 形式，迁移后补丁目标失效 | `tests/` grep | 迁移时同步改这两个文件的补丁目标；其余 6 个直接给共享 `settings` 对象打属性补丁的仍然有效（解析器的 env 基线读同一对象） |
| G15 **【v2·RV2-02】** 另有 **4 个既有测试文件、8 处**直接给服务**实例属性赋值**来模拟「已配置/未配置」：`test_audio_transcription_service.py:94-95`（`svc.appid/access_token`）、`test_sentence_tts_error_details.py:41,181`、`test_tts_error_details.py:23,381`、`test_tts_router.py:540,551`（`service.api_key`） | `tests/` grep | 属性不能是只读 property：必须是带**覆盖值 setter** 的描述符（§3.3），这 4 个文件无需改动即可保持绿 |
| G16 **【v2·RV2-05】** R1 的 `test_setup_status.py` 用 `SimpleNamespace` stub `get_settings`（无任何 `ark_*/pexels_*/volcano_*` 属性），DB 工厂绑在 `model_settings_module.async_session_factory` | `test_setup_status.py:30-75` | 解析器的基线读取与 DB 会话获取必须各有一个可替换接缝（§3.2「测试接缝」） |
| G17 **【v2·RV2-01】** BFF 通用 `backend-proxy.ts` 默认不转发 `Origin`；后端写接口的 `validate_ui_origin(write=True)` 缺 `Origin` 即 403；现有先例 `protectedSettingsWrite`（`researchUiOrigin.ts`）转发 `Origin` 并前置校验，但 `method` 类型只支持 `POST｜PUT` | `researchUiOrigin.ts:6-39`、`research_run_router.py:53-62` | 新 BFF 路由按 §3.5「BFF 契约」实现，并把 `protectedSettingsWrite` 扩到 `DELETE` |

---

## 1. Overview

第 1 轮把「启动自检 + 分步向导」做到了模型服务和联网搜索两类凭证。本轮要求把**所有**需要外部凭证的能力都纳入引导——TTS、AI 图片/视频生成、字幕识别、Freesound，以及用户没想到的声音克隆、Pexels、Unsplash——并且在每一步给出**可点击的取证链接**，让用户一步跳到对应控制台拿 Key。

难点不在「多画几个表单」。勘察（G2/G3/G6）表明：这些凭证目前**根本没有应用内的存储与读取路径**，而公开安装包的 `.env` 又是全占位符。所以本轮是一个**纵向**改动：①后端新增一个集成凭证存储与「占位符感知」解析器，作为运行期与状态判定的**唯一**读取点；②把 10 处运行期读取改为调用时读取，使配置立即生效、无需重启；③`capability-status` 从 6 项扩到 14 项；④前端向导新增「语音 / AI 生成 / 素材库」三个分组步骤，复用一个通用卡片组件，同一个组件也用于新增的设置页「服务与素材库」，从结构上保证向导与设置一致；⑤引入统一的取证链接注册表，覆盖 10 个模型服务商与 8 个集成；⑥补一条运行期出口：功能因未配置而失败时给出「去配置」入口，使「暂不使用」是安全的。

交互原则与 R1 一致：每一步只讲一件事；已配置的不覆盖（手动模式需显式「更换」）；可选能力必须显式「配置」或「暂不使用」之一，**不允许被悄悄略过**（满足「所有能力都要要求配置」），但也不让用户被无休止的弹窗绑架（分组跳过、一键跳过全部可选项、会话级「稍后」）。

---

## 2. 目标、非目标与关键决策

### 2.1 目标

1. 向导与 `capability-status` 覆盖所有需要外部凭证的能力（共 14 项），逐项给出就绪状态。
2. 每个凭证输入处都有「获取凭证」链接（含 10 个模型服务商、Tavily 与 7 个新集成），并给出必要的文档链接与易错点说明（G11）。
3. 凭证写入应用内存储，**保存后立即生效**，运行期与状态判定使用同一解析器；占位符一律视为未配置（G4/G5）。
4. 设置页提供同一套卡片的常驻入口，向导写入的内容在设置页**逐字段对应**可见、可改、可清除。
5. 对「连接是否可用」尽可能给出真实验证，且验证**不泄露 Key、不产生显著费用**；做不到的明确标注「无法免费验证」，不假装验证过。
6. 干净安装（脱敏 `.env`）下端到端可用：用户只靠向导即可把 TTS/字幕/AI 生成/素材库配起来并立刻使用。

### 2.2 非目标

- **不**对存储做加密（与 `model_providers.api_key` 同级，G8）；Electron `safeStorage` 加密列为后续（§9 R4）。
- **不**迁移/改动 Tavily 的存储（仍是 `system_settings.web_research.tavily_api_keys` + 既有 `/api/web-research/*`）；它只在注册表中以「适配器」身份出现，向导里的 `SearchStep` 保留，仅替换其取证链接组件（§3.6）。
- **不**改动模型服务商 / 槽位的数据结构与写路径（R1 已定）。
- **不**纳入：`RUNNING_HUB_API_KEY`（无消费方）、`AGENT_LLM_API_XX_*`（旧链路）、`coding` 槽位、`YOUTUBE_PROXY`（网络设置而非凭证，设置页已有 YouTube 面板，且仅 env 可配——作为后续独立项记录，不在本轮扩大范围）。
- **不**在启动时对已配置的凭证做在线探测（R1 §2.2 不变）；连通性检查只在用户点「保存并测试」时发生。
- **不**把取证链接做成后端下发（链接是展示层数据，随语言/地区调整；放前端静态注册表，G9/G10）。

### 2.3 关键决策

| ID | 决策 | 理由 / 取舍 |
|----|------|-------------|
| E1 | 新增**专用表** `integration_credentials` + 专用服务/路由，不复用 `system_settings` | G7：通用路由会泄露明文且需 YAML 播种；专用路由可保证「任何读接口都不返回密钥」 |
| E2 | **单一解析器** `integration_credentials`（同步读缓存）同时服务运行期与状态判定；运行期服务不得再直接读 `settings.<x>_api_key` / `os.getenv("<X>_API_KEY")`，加守卫测试强制 | R1 的核心原则「判定与运行时同一解析器」延伸到新能力；G4/G6 |
| E3 | 解析优先级：**应用内配置 > 环境变量/`.env` > 字段默认值**；占位符与空值视为「该层不存在」，继续落到下一层 | 保持老用户 `.env` 行为不变（向后兼容）；干净安装下 `.env` 全是占位符自然落空 |
| E4 | 「清除」= 删除应用内配置 → 回退 `.env`；不做「用空值覆盖 env」（与 Tavily 的 `[]` 语义不同，更简单可解释） | 避免第二套「显式清空」状态；UI 上用「来源」徽标讲清楚 |
| E5 | 能力与集成分两层：**能力**(capability) 是用户看到的状态单元（14 项），**集成**(integration) 是凭证单元（一份表单）。`ark` 一份凭证服务 `ai_image`+`ai_video` 两项能力 | 用户不该为同一个 Key 填两次；状态仍可按能力单独呈现 |
| E6 | 新增 8 项能力**全部为 `extended` 档**；`core` 档仍只有 R1 的 4 个模型槽位。`extended` 能力的唯一豁免方式是**显式「暂不使用」**（localStorage opt-out，沿用 R1 D7） | 不能让没有火山账号的用户每次启动都被强制配置；同时满足「所有能力都要求配置」——无法静默略过 |
| E7 | 向导新增 3 个分组步骤：`voice`（语音：TTS / 字幕识别 / 声音克隆）、`generation`（AI 生成：图片+视频，同一 Key）、`media`（素材库：Pexels / Unsplash / Freesound）；`search` 步骤沿用。步骤按需出现（与 R1 一致） | 一屏一件事；分组按用户心智（我要配语音）而非按厂商控制台 |
| E8 | 分组步骤内用**手风琴卡片**：每个集成一行摘要（名称 / 用途 / 状态胶囊），同一时刻只展开一张，默认展开首个缺口 | 3 张完整表单叠在 720px 弹窗里过长；渐进披露更克制 |
| E9 | 总览页新增「**只配置模型，其余以后再说**」：一键为所有未配置的 `extended` 能力写 opt-out，并**重新派生**步骤（这是 R1 IM-02「步骤冻结」的唯一受控例外，因为它是用户显式的结构性操作而非刷新副作用） | 14 项能力的弹窗疲劳（§9 R5）；用户可以随时在设置页或运行期入口找回 |
| E10 | 运行期出口：未配置导致功能失败时，前端展示「去配置」，派发 `ecliptrix-open-setup-wizard`（带 `focus` 集成 id），`page.tsx` 以 manual 模式打开向导并定位到该集成 | 让「暂不使用」安全可逆；G2 之后用户才有路可走 |
| E11 | 连通性验证分四级声明在注册表里：`free`(Pexels/Unsplash/Freesound/ARK 用只读接口) / `handshake`(ASR 仅握手) / `billed_minimal`(TTS 合成 1 个字，需用户点击即同意) / `none`(声音克隆，无法免费验证) | 诚实：不能验证的不装作验证（延续 R1 RV-13 的口径） |
| E12 | 取证链接是**前端静态注册表**，渲染走唯一组件 `GetCredentialLink`；只允许 `https:` 且主机在白名单内 | G9：避免窗口被导航走、避免外部输入变成 `openExternal` 目标 |

---

## 3. Technical design

### 3.1 集成注册表（后端，字段定义的唯一真相源）

新增 `app/services/integration_registry.py`：`FieldSpec`、`IntegrationSpec` 两个 frozen dataclass 与 `REGISTRY`。`FieldSpec` 声明：`name`、`kind`(`secret` | `secret_list` | `text` | `choice`)、`required`、`default`、`choices`、`max_items`、`baseline`（**【v2·RV2-05】** 一个 `BaselineRef(settings_attr=…, env_var=…)` 声明，而非闭包；由 `integration_credentials_service._baseline_reader` 在调用时统一惰性读取，缺属性视为空，见 §3.2「测试接缝」）。下表「env 基线」列里写的 `settings.xxx` 即 `settings_attr`。

| 集成 id | 展示名 | 字段（`name`:`kind`，env 基线） | 服务的能力 | 验证级别 | 取证对象 |
|---------|--------|--------------------------------|------------|----------|----------|
| `volcano_tts` | 火山引擎 · 语音合成 | `api_key`:secret*（`settings.volcano_tts_api_key`）；`resource_id`:choice，默认 `seed-tts-2.0`，选项 `seed-tts-2.0 / seed-tts-1.0 / seed-tts-1.0-concurr`（`settings.volcano_tts_resource_id`） | `tts` | `billed_minimal` | 新版控制台 API Key |
| `volcano_asr` | 火山引擎 · 语音识别（字幕） | `appid`:text*（env 基线 `settings.volcano_asr_appid`，**env 层**已含回落 `VOLCANO_TTS_APPID`，见下「回落口径」）；`access_token`:secret*（`settings.volcano_asr_access_token`，同理）；`resource_id`:choice，默认 `volc.bigasr.sauc.duration`，选项 4 个（见 `config.py:459-470`） | `asr` | `handshake` | 旧版控制台「流式语音识别」应用的 APP ID + Access Token |
| `volcano_voice_clone` | 火山引擎 · 声音复刻 | `app_key`:text*（`settings.volcano_voice_clone_app_key`）；`access_key`:secret*（`…_access_key`）；`tts_resource_id`:choice，默认 `seed-icl-1.0`，选项 `seed-icl-1.0 / seed-icl-1.0-concurr` | `voice_clone` | `none` | 同上 + 需另购 speaker_id |
| `ark` | 火山方舟（Seedream / Seedance） | `api_key`:secret*（`settings.ark_api_key`） | `ai_image`, `ai_video` | `free`（列任务只读接口） | 方舟 API Key + 模型开通 |
| `pexels` | Pexels（视频素材） | `api_keys`:secret_list*，最多 5（`settings.pexels_api_keys`） | `video_library` | `free` | Pexels API |
| `unsplash` | Unsplash（图片素材） | `access_keys`:secret_list*，最多 5（`os.getenv("UNSPLASH_ACCESS_KEYS")` 逗号拆分） | `image_library` | `free` | Unsplash 应用 Access Key |
| `freesound` | Freesound（音效素材） | `api_key`:secret*（`os.getenv("FREESOUND_API_KEY")`） | `audio_library` | `free` | Freesound API 申请 |
| `tavily`（适配器，不入凭证表） | Tavily（联网搜索） | 存储沿用 `system_settings.web_research.tavily_api_keys` | `web_search` | 既有 `test-connection` | Tavily |

`*` = `required`。`appid`/`app_key` 是标识符而非密钥，`kind=text`：读接口可回显，便于用户核对输入；其余 secret 一律不回显（连末 4 位都不给，延续 R1 零秘密契约）。

**【v2·RV2-07】回落口径（统一 §3.1/§3.8/R7 的表述）**：`config.py:908-932` 里 ASR 与声音克隆的 env 默认值会回落到 `VOLCANO_TTS_APPID/ACCESS_TOKEN`。本设计**只保留 env 基线层的这条回落**（兼容老 `.env`，来源徽标显示「环境变量」）；**应用内存储层不做任何跨集成回落**——向导/设置页里 TTS、ASR、声音克隆三张卡片互相独立，ASR 卡片留空就是「未配置」，不会因为 TTS 填了什么而显示为已配置。干净安装下 env 回落的是占位符，自然落空。

**能力表**（共 14 项）：R1 的 6 项 + `tts`、`asr`、`voice_clone`、`ai_image`、`ai_video`、`video_library`、`image_library`、`audio_library`。新增 8 项均 `tier=extended`。

**契约夹具**：后端把注册表的 `{integration → fields(name, kind, required, choices), capabilities, verify_level}` 序列化为 `src/lib/api/__fixtures__/integrations-schema.json`（受版本控制）。后端测试断言「当前注册表序列化结果 == 夹具」，前端测试断言「夹具里每个集成/字段在 i18n、链接注册表、分组表中都有对应项」。字段增删时两边测试同时变红，防止漂移（§7）。**【v2·RV2-12】** 夹具同时携带 `providerPresetIds`（后端 `model_settings_service.PROVIDERS` 的 10 个 id），后端测试断言与 `model_settings_service.PROVIDERS` 一致；前端 `credentialLinks.test.ts` 读夹具来断言「每个预置服务商 id 都有链接条目」——CI 无后端也能做契约检查。运行期遇到夹具之外的新服务商 id 时，`GetCredentialLink` 降级为无链接的提示句，不报错。

### 3.2 凭证存储与解析器

**表** `integration_credentials`（`db_models.py` 新增 ORM，纯增量，由 `create_all` 建表，无迁移、无 DDL 破坏——遵守 CLAUDE.md）：

```
integration_id  VARCHAR(40) PRIMARY KEY
fields          JSON        NOT NULL   -- {"api_key": "...", "resource_id": "seed-tts-2.0"}；secret_list 为 JSON 数组
created_at / updated_at  DateTime(timezone=True)
```
不加 `user_id`（与 `model_providers`/`system_settings` 一致，属全局应用配置）。旧版本应用打开新库：忽略未知表，向下兼容。

**服务** `app/services/integration_credentials_service.py`，模块级单例 `integration_credentials`：

```python
class IntegrationCredentialsService:
    async def load_all(self) -> None            # 启动时灌缓存；失败置 self.load_failed=True 并 logger.exception，不抛
    def value(self, integration_id, field) -> str            # 同步读缓存；无可用值返回 ""
    def values(self, integration_id, field) -> list[str]     # secret_list；去空白、去重、去占位符
    def resolve(self, integration_id) -> ResolvedIntegration # 每字段 {value, source∈database|environment|default|none}
    def is_usable(self, integration_id) -> bool              # 所有 required 字段均可用
    async def save(self, integration_id, patch) -> ResolvedIntegration
    async def clear(self, integration_id) -> ResolvedIntegration
```

- **读路径是纯同步、无 I/O**：缓存 `dict[str, dict]`，写入时**整体替换**该集成的条目（copy-on-write），所以 TTS 的工作线程可以无锁读取。
- **解析顺序**（逐字段）：缓存里的值 → 基线（`_baseline_reader`）→ `default`。每一层都先过 `is_usable_secret`（非空且非占位符）才算「存在」。
- **写路径**：每集成一把 `asyncio.Lock` 做读-改-写；先校验再写库、**库写成功后才**替换缓存，保证「失败不留半成品」。`patch` 语义：省略字段=不变；`""`/`null`=清除该字段；字段全清则删行。审计写 `settings_audit_log`（`setting_type='integration'`，`key=integration_id`，仅 action，**不含字段值**）。日志只记字段名。
- **服务端边界校验（单点）**：`secret`/`secret_list` 元素去首尾空白后长度 8–512、不含空白与控制字符、非占位符；`text` 匹配 `^[A-Za-z0-9_-]{1,64}$`；`choice` 必须在选项内；`secret_list` 超过 `max_items` → 422；未知字段 → 422。错误体只含 `error_code`（`credential_placeholder | credential_malformed | unknown_field | too_many_values | invalid_choice`）与字段名，**不回显值**。

**共享判据** `app/services/secret_values.py`：`is_usable_secret(value)` 与 `PLACEHOLDER_PATTERNS`。**【v2·RV2-03】收窄为 7 条「整串锚定」的形态**（全部 `re.IGNORECASE`，对 `strip()` 后的整串匹配）：

1. `^your_.*_here$`（R1 原判据，保留以向后兼容）
2. `^your_[a-z0-9_]*$`（补上 `env.template` 里 `your_volcano_tts_api_key` 这类**无 `_here`** 的形态，G5）
3. `^x+$`
4. `^<.+>$`
5. `^(change|replace)[_-]?me$`
6. `^(test|example|dummy|fake|sample|placeholder|todo|none|null)$`（整串等于这些词）
7. `^0+$`

**明确不收录** `secret-shape.js` 里的 `^sk-test`、未锚定的 `/EXAMPLE/`、`xxxxxxxx` 子串：那份列表回答的是「打包扫描时哪些值可以放行」，而本判据回答的是「这是不是用户真实可用的凭证」。后者同时被模型服务商与 Tavily 的 Key 判定复用，收录这几条会让 R1 的 `SetupWizard.test.tsx`（`SECRET='sk-test-secret-123'`）被 `keyPlaceholder` 拒绝而变红，也会误拒含子串 `EXAMPLE` 的真实 Key（违反 AC2-15）。`secret_values.py` 顶部注释写明与 `secret-shape.js` 的对应关系与**有意的差集**。`setup_status_service.PLACEHOLDER_PATTERN` / `is_usable_secret` 改为从此处导入（保留原名重导出，不破坏 R1 测试）。前端 `isPlaceholderKey` 同步为同一组 7 条。**一致性测试**：同一份样例表（≥14 条）同时喂给 Python 与 TS 实现，结果必须一致（G5）；表中必须含「判为占位符」的 `your_volcano_tts_api_key`、`your_llm_api_key_here`、`<your-key>`、`change-me`，以及「判为可用」的反例 `sk-test-secret-123`、`sk-secret-chat-key-123`、含 `EXAMPLE` 子串的长串。

**【v2·RV2-05】测试接缝（解析器必须可在不依赖开发机环境的情况下被测）**：

- **基线读取单点**：`FieldSpec.baseline` 不直接引用 `settings.x`，而是声明「属性名/环境变量名」，由模块级 `_baseline_reader(spec_field) -> str | list[str]` 统一读取：先 `getattr(app.config.settings, attr, "")`（**缺属性一律视为空**，不抛 `AttributeError`，因此 R1 那种 `SimpleNamespace` stub 不会炸），需要 env 的字段（Unsplash/Freesound）再读 `os.environ`。测试通过 `monkeypatch.setattr(integration_credentials_service, "_baseline_reader", …)` 整体替换。
- **DB 会话单点**：服务通过模块级名字 `async_session_factory`（与 `model_settings_service` 同名同用法）取会话，测试直接绑内存库工厂，写法与 `test_setup_status.py` 一致。
- **自动隔离**：`tests/conftest.py` 新增 `autouse` 夹具，**中和真实来源而不替换读取器**：用 `monkeypatch` 把注册表涉及的 `settings` 凭证属性置空（字符串→`""`、列表→`[]`）、`delenv` 掉 `UNSPLASH_ACCESS_KEYS/FREESOUND_API_KEY` 等 env 名，并清空 `integration_credentials` 缓存与 `load_failed`。不替换 `_baseline_reader` 的原因：6 个既有测试靠给共享 `settings` 对象打属性补丁来模拟已配置（G14），autouse 先于它们执行、后者的补丁叠在其上，因此仍然有效；若把读取器置恒空，这 6 个测试会全部失效。这样 AC2-1「14 项无 `ready`」在任何开发者机器（含有真实 `.env` 的）上都确定。
- `choice` 字段的默认值来自 `FieldSpec.default`（代码内常量），不经过基线读取。

**启动**：`main.py` lifespan 在数据库初始化之后调用 `await integration_credentials.load_all()`（独立 try/except，失败只记 `exception`）。`load_failed` 为真时，集成类能力在 `capability-status` 里返回 `indeterminate`（前端 fail-open 不弹窗），避免「库里明明有 Key 却因读取失败弹出向导」。

### 3.3 运行期读取点迁移（实现「保存即生效」）

原则：每处改动**最小**——把构造期快照/`settings.*` 直读换成对解析器的调用时读取；公开属性名保留，使外部引用（`image_router.py:140`、`video_router.py:515`、`audio_router.py:557`）与既有测试继续可用。

**【v2·RV2-02】属性实现方式：带「覆盖值」的描述符，而不是只读 `@property`。** 在 `integration_credentials_service.py` 导出 `credential_property(integration_id, field)`（Python 描述符）：

- **getter**：若实例上存在显式覆盖值（`instance.__dict__["_cred_override_<field>"]`）则返回它（包括 `""`，用于「模拟未配置」）；否则返回 `integration_credentials.value(...)` / `.values(...)`（调用时读取，保存即生效）。
- **setter**：把值存为该实例的覆盖值。这是**既有测试的合法接缝**（G15：4 个文件 8 处 `service.api_key = …`/`svc.appid = …`），生产代码不调用 setter。
- **`__init__` 内必须删除** `self.api_key = settings.…` 这类赋值——否则它会命中 setter，把「构造期快照」以覆盖值的形式悄悄带回来（这正是本次要消灭的缺陷）。`test_integration_hot_reload.py` 增一条断言：新建实例后不存在任何 `_cred_override_*` 键。
- 描述符自带 `__doc__`，说明「覆盖值仅供测试」；覆盖值**不进日志**。

| 文件 | 现状 | 改为 |
|------|------|------|
| `tts_service.py:246-247` (`TTSService.__init__`) | `self.api_key = settings.volcano_tts_api_key`；`resource_id` 同 | 删除两行赋值；类上声明 `api_key = credential_property("volcano_tts","api_key")`、`resource_id = credential_property("volcano_tts","resource_id")`。`validate_config`、`TTSClient(self.api_key, self.resource_id)`（`:393`）、批量路径 `(self.api_key, text)`（`:370`）自动随之生效。`__init__` 里 `'configured': bool(self.api_key)` 日志保留 |
| `audio_transcription_service.py:187-189` | 构造期快照 `appid/access_token/resource_id`；`_missing_credentials` 返回环境变量名 | 删除三行赋值，类上声明三个 `credential_property`；`_missing_credentials` 返回的**名字保持不变**（前端/日志既有文案不破坏），判定改走 `is_usable`；构造期三条 `logger.warning` 降为 `info`，不再暗示「必须设环境变量」 |
| `voice_clone_service.py:46-47` | 快照 `app_key/access_key` | 删除赋值，类上声明 `credential_property`；`train_voice` 的未配置异常文案改为指向「设置 → 服务与素材库」，同时带稳定错误码（§3.4 末） |
| `voice_clone_service.py:225` **【v2·RV2-04】** | `settings.volcano_voice_clone_tts_resource_id or "seed-icl-1.0"` 直读 | 改为 `integration_credentials.value("volcano_voice_clone","tts_resource_id")`（默认值由 `FieldSpec.default` 提供）——否则用户在卡片里选的 `seed-icl-1.0-concurr` **保存了也不生效** |
| `voice_clone_service.py:48` **【v2·RV2-04】** | `speaker_id_prefix = settings.volcano_voice_clone_speaker_id_prefix` | **不迁移**：它不是凭证。登记为守卫测试的显式白名单项，并在代码旁注释「非凭证，保留读 settings」 |
| `video_search_service.py:20` | `self.api_keys = settings.pexels_api_keys` | property → `values("pexels","api_keys")`；删除 `:37` 的 Key 片段 debug 日志（G13） |
| `image_search_service.py:29` | 构造期 `os.getenv` | property → `values("unsplash","access_keys")`；`current_key_index` 取值时对长度取模，防止配置变短后越界 |
| `audio_search_service.py:29,55` | 构造期 `os.getenv`；Key 放 URL `token=` | property → `value("freesound","api_key")`；改为请求头 `Authorization: Token <key>`，URL 与异常消息中不再含 Key（G13） |
| `ark_image_service.py:128,339,438`、`ark_video_service.py:332,449,530,534`、`storyboard_service.py:510,762`、`video_cover_v2_service.py:252`（共 10 处；`:534` 为 v1 漏列） | 每次调用读 `settings.ark_api_key` | 统一换成 `integration_credentials.value("ark","api_key")`（封装为 `ark_api_key()` 一个小函数放 `integration_credentials_service`，避免 10 处重复字符串） |

**不再读 `settings.<x>_api_key`**：`config.py` 的对应字段保留，作为解析器的 env 基线来源（`BaselineRef(settings_attr="ark_api_key")`），因此既有「给共享 `settings` 对象打属性补丁」的测试（`ark_image_service.settings` 与 `app.config.settings` 是同一对象）依旧有效；只有 `patch("<service>.settings")` 整体替换的两个测试文件（G14）需改补丁目标；直接给服务实例属性赋值的 4 个测试文件（G15）靠描述符的覆盖值 setter 保持绿，无需改动。

**守卫测试** `tests/test_no_direct_credential_reads.py`：**【v2·RV2-04】按字段名枚举而非前缀匹配**——模式表由注册表自动生成（每个 `BaselineRef` 的 `settings_attr` 与 `env_var`，即 `settings.ark_api_key`、`settings.volcano_tts_api_key`、`settings.volcano_tts_resource_id`、`settings.volcano_asr_appid/access_token/resource_id`、`settings.volcano_voice_clone_app_key/access_key/tts_resource_id`、`settings.pexels_api_keys`、`os.getenv("FREESOUND_API_KEY"`、`UNSPLASH_ACCESS_KEYS`……）。扫描 `app/services/**/*.py` 与 `app/routers/*.py`（排除 `config.py`、`integration_registry.py`、`integration_credentials_service.py`），出现任一模式即红；显式白名单仅 `volcano_voice_clone_speaker_id_prefix`（非凭证）。由注册表生成模式表意味着：将来新增集成字段后忘了迁移读取点会直接红，而不必有人记得去改守卫。

### 3.4 状态判定（`capability-status` 扩展）

`setup_status_service` 新增 `_integration_slot(capability_id, integration_id)`：

- 所有 `required` 字段可用 → `ready`；`source` 取 `database`（任一必填字段来自应用内配置）否则 `environment`。
- 全部必填字段都不可用 → `missing`。
- 部分可用（如字幕识别填了 APP ID 没填 Token）→ `invalid`（UI 文案「配置不完整」）。
- 解析器 `load_failed` → `indeterminate`。
- `choice` 字段的默认值**不算**「已填」，避免「只有默认 resource_id」被判成 `invalid`。

`CapabilityId` Literal 与前端 `CapabilityId` 同步扩展为 14 项；`_TIERS` 表中 8 个新 id 标 `extended`；`web_search`、`research` 逻辑不动。响应仍**零秘密**（契约测试对新增 8 项同样强制）。`missing_core` 不受影响。

**未配置的稳定错误码**（供 E10 使用）：新增 `app/services/credential_errors.py`：`class CredentialNotConfigured(Exception)` 带 `integration_id`；各服务在「未配置」分支改抛/返回它，路由层沿用各自既有的信封，仅**追加** `error_code="credential_not_configured"` 与 `details.integration_id`，原 `message` 不变（不破坏现有断言）。涉及：TTS（现有 `TTS_CONFIG_MISSING` 保留并追加 `integration_id`）、ASR（`ASR_NOT_CONFIGURED` 同）、声音克隆、ARK 图/视频/分镜/封面、Pexels/Unsplash/Freesound 三个搜索路由。

### 3.5 集成接口与连通性探针

新路由 `app/routers/integrations_router.py`（前缀 `/api/integrations`，`main.py` 注册）：

- `GET /api/integrations` — 全部集成的**公开状态**（见 §5.1），无任何密钥。
- `PUT /api/integrations/{id}` — 写入/部分更新（§3.2 patch 语义）。
- `DELETE /api/integrations/{id}` — 清除应用内配置，回退 `.env`。
- `POST /api/integrations/{id}/test` — 对**已保存**的配置做连通性检查（先保存后测试，与 Tavily 流程一致，避免在请求体里再传一次密钥）。

写类接口（PUT/DELETE/POST test）统一调用来源校验 `validate_ui_origin(request, write=True)`。**【v2·RV2-10】不搬迁该函数**：沿用 `agent_toolkit_router` / `agent_vision_router` / `system_settings_router` 已有的「函数内惰性导入 `from .research_run_router import validate_ui_origin`」先例，并把 `WebResearchError` 翻译为本域的 `ErrorResponse`（`origin_forbidden` → 403、`json_required` → 415）。搬迁对本特性无收益，只增加 diff 与回归面。

**【v2·RV2-01 · P0】BFF 契约（v1 遗漏，照原文实现将导致全部写操作 403）**：

后端的 `validate_ui_origin(write=True)` 要求请求带 `Origin` 且 `Content-Type: application/json`。BFF（Next.js 路由）到后端是服务端 `fetch`，**通用 `backend-proxy.ts` 默认不转发 `Origin`**。因此：

| BFF 路由 | 实现 | 说明 |
|----------|------|------|
| `GET /api/integrations` | `createPassthroughRoute('/api/integrations')` | 只读，无需 Origin |
| `PUT /api/integrations/[id]` | `protectedSettingsWrite(builder, 'PUT', true)` | `always=true` → 前置 `researchOriginAllowed(request, true)`，并 `forwardHeaders:['Origin']` |
| `DELETE /api/integrations/[id]` | `protectedSettingsWrite(builder, 'DELETE', true)` | 需把该助手的 `method` 联合类型从 `'POST' \| 'PUT'` 扩为含 `'DELETE'`（分派到 `proxy.DELETE`，已存在） |
| `POST /api/integrations/[id]/test` | `protectedSettingsWrite(builder, 'POST', true)` | 同上 |

- `[id]` 动态段在 BFF 层用 `^[a-z_]{1,32}$` 白名单校验后再拼后端路径（防路径注入）；非法 → 404。
- 前端客户端 `integrations.ts` 的写请求必须带 `Content-Type: application/json`（`http-client` 默认如此，测试里断言）；浏览器会自动带 `Origin`。
- `researchOriginAllowed` 已处理「dev 服务器非 3000 端口」的回落（用请求自身 origin），所以 R9 的 dev 模式风险由现有函数覆盖；后端侧 `validate_ui_origin` 的白名单在未设 `RESEARCH_RENDERER_ORIGIN` 时只认 `localhost:3000/127.0.0.1:3000`——**非 3000 端口的 dev 服务器若未注入该变量，写接口会被后端拒绝**（`system_settings` 的 web_research 写入是同一既有行为，本特性不改，记入 §9 R9；未在代码里核实各 dev 启动脚本是否注入该变量）。
- 测试（§7.2）：BFF 路由测试断言 ①无 `Origin` 的写请求被 BFF 拒绝 403；②合法 `Origin` 时后端收到的请求头含 `Origin`；③`DELETE` 同样转发。

**探针**放在 `app/services/integration_probes.py`，每个探针返回封闭枚举 `outcome ∈ ok | invalid_credentials | not_entitled | rate_limited | unreachable | upstream_error | unverifiable`，**只用本地白名单文案映射，不回显上游响应体**；全局一把 `asyncio.Lock` + 每集成 5 秒节流 + 10 秒总超时 + 不重试（沿用 `web_research_router.test_connection` 的形态）；目标主机固定写死，不接受任何用户提供的 URL（无 SSRF 面）；Key 只放请求头，不进 URL、不进日志（`caplog` 测试断言）。

**【v2·RV2-06】探针执行规则**：
- 探针里**凡是同步 I/O（`requests`、`TTSClient`）一律 `await asyncio.to_thread(...)`**，不得在事件循环里直接调用；`httpx`/`websockets` 探针用原生 async。
- 「10 秒总超时」必须由**被调用方自身的超时**保证（`asyncio.wait_for` 取消不了线程内的同步调用）：`TTSClient.__init__` 增加可选形参 `timeout: float = 30`（既有调用方不传即不变），`requests.post(..., timeout=self.timeout)`；TTS 探针传 `timeout=10`。
- **`MOCK_MODE`（`settings.tts_mock_mode`）为真时 TTS 探针直接返回 `unverifiable`**——该模式下 `synthesize_speech` 不联网也返回成功，若照常调用会伪造 `ok`。
- TTS 探针的**发音人必须与所选 `resource_id` 匹配**：`seed-tts-2.0` 用 `TTSClient` 默认的 2.0 音色（`zh_female_qingxinnvsheng_uranus_bigtts`），`seed-tts-1.0` / `seed-tts-1.0-concurr` 用 `app/models/tts_models.py` 里的 1.0 音色枚举（如 `ZH_FEMALE_LINJIANVHAI_MOON_BIGTTS`；实现时从枚举取值，不手写字符串）。否则一个**完全有效**的 1.0 配置会被默认的 2.0 音色判成 `TTS_VOICE_UNAVAILABLE` → 误报 `not_entitled`。
- **`TTSServiceError.code` → `outcome` 映射**：`TTS_AUTH_FAILED` → `invalid_credentials`；`TTS_PERMISSION_DENIED` / `TTS_VOICE_UNAVAILABLE` / `TTS_QUOTA_EXHAUSTED` / `TTS_INSUFFICIENT_BALANCE` → `not_entitled`（文案区分「未授权」与「额度/余额不足」）；`TTS_RATE_LIMITED` → `rate_limited`；`TTS_TIMEOUT` / `TTS_NETWORK_ERROR` → `unreachable`；其余（`TTS_PROVIDER_ERROR`、`TTS_INVALID_RESPONSE`、`TTS_INVALID_REQUEST`、`TTS_UNKNOWN_ERROR`、`TTS_LOCAL_IO_ERROR`）→ `upstream_error`。映射表放 `integration_probes.py`，用例逐码覆盖。
- 临时文件用 `tempfile.TemporaryDirectory()` 的上下文管理器，保证任何分支都不残留。

| 集成 | 探针 | 判定 |
|------|------|------|
| `pexels` | `GET https://api.pexels.com/videos/search?query=nature&per_page=1`，头 `Authorization: <key>`；多 Key 逐个试，任一 200 即 `ok` | 200 ok；401/403 invalid；429 rate_limited |
| `unsplash` | `GET https://api.unsplash.com/search/photos?query=nature&per_page=1`，头 `Authorization: Client-ID <key>` | 同上 |
| `freesound` | `GET https://freesound.org/apiv2/search/text/?query=rain&page_size=1`，头 `Authorization: Token <key>` | 同上 |
| `ark` | `GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_size=1`，头 `Authorization: Bearer <key>`（只读列表，不创建任务、不计费） | 200 ok（**仅证明 Key 有效，不证明模型已开通**，见下）；401 invalid；403 且消息提示未开通 → `not_entitled`（UI 引导去「开通管理」） |
| `volcano_asr` | 以 `_build_headers()` 的同一组头建立 WebSocket 握手，握手成功即关闭，**不发送音频** | 握手 101 ok；401/403 invalid；资源未授权 `not_entitled`。握手需 `websockets.connect(open_timeout=10)`；鉴权也可能在首帧后才返回错误帧——此类情形实测无法区分时降级 `unverifiable` |
| `volcano_tts` | 复用 `TTSClient`（`asyncio.to_thread` + `timeout=10`，发音人随 `resource_id` 选取，`MOCK_MODE` 下 `unverifiable`，见上「探针执行规则」）合成 **1 个字**到临时目录并立即删除。UI 在按钮旁明示「将合成 1 个字，几乎不计费」，点击即同意 | 成功 ok；其余按 `TTSServiceError.code` 映射表 |
| `volcano_voice_clone` | 无免费验证接口 → 直接返回 `unverifiable`，UI 文案「已保存；首次训练声音时校验」 | — |

> **实现注意（诚实声明）**：以上探针端点来自对现有调用代码与公开文档的推断，**本设计节点没有真实 Key，未在线验证**。实现节点须用真实 Key 逐个验证；若某探针端点不可用，降级为 `unverifiable`（保存生效、不测试），**不得**伪造 `ok`。验证结论记入 `link-audit.md`（§3.6）。

**【v2·RV2-09】ARK 的 `ok` 语义**：列任务接口不会因模型未开通而失败，所以 `ok` 只代表「Key 有效」。前端对 `ark` 的 `ok` 展示文案「Key 有效；还需确认已开通 Seedream / Seedance 模型」，并**常驻**一条指向 `activationUrl`（开通管理）的链接；只有真实提交过一次生成任务才能证明可用，本设计不为此自动创建任务（会计费）。

### 3.6 取证链接注册表（前端）

新增 `src/lib/credentialLinks.ts`：

```ts
export interface CredentialLink {
  consoleUrl: string;          // 直达「创建/查看 Key」的页面
  docsUrl?: string;            // 教程 / 官方文档
  activationUrl?: string;      // 额外必须的开通步骤（ARK 模型开通）
}
export const INTEGRATION_LINKS: Record<IntegrationId | 'tavily', CredentialLink>;
export const PROVIDER_LINKS: Record<string, CredentialLink>;   // 键 = 后端 ProviderInfo.id
export function safeExternalUrl(raw: string): string | null;    // 仅 https + 主机白名单，否则 null
```

**渲染唯一入口** `GetCredentialLink`（`src/components/integrations/GetCredentialLink.tsx`）：输出 `<a href target="_blank" rel="noopener noreferrer">`，文案「获取 Key ↗」，可访问名称追加「（在系统浏览器中打开）」；`safeExternalUrl` 返回 `null` 时**不渲染链接**而渲染纯文本说明（宁缺毋滥）。旁边一个「复制链接」图标按钮作为无法打开浏览器时的兜底（P2）。组件内不接受 `href` 属性，只接受注册表 id，从结构上杜绝外部输入进入 `openExternal`（G9）。

**链接清单**（`把握度`：`repo` = 仓库内已出现；`官方域名` = 厂商官方域名下的惯用路径；**均须在实现节点人工核验并写入 `docs/plans/setup-wizard-full-capability-coverage/link-audit.md`，含日期**；核验失败则回落到该厂商的稳定首页 / 文档根）：

| id | consoleUrl（候选） | docsUrl（候选） | 把握度 |
|----|--------------------|-----------------|--------|
| `tavily` | `https://app.tavily.com/home` | `https://docs.tavily.com/` | repo / 官方域名 |
| `pexels` | `https://www.pexels.com/api/` | `https://www.pexels.com/api/documentation/` | 官方域名 |
| `unsplash` | `https://unsplash.com/oauth/applications` | `https://unsplash.com/documentation` | 官方域名 |
| `freesound` | `https://freesound.org/apiv2/apply/` | `https://freesound.org/docs/api/authentication.html` | 官方域名 |
| `ark` | `https://console.volcengine.com/ark/region:ark+cn-beijing/apikey` | `https://www.volcengine.com/docs/82379`；`activationUrl`: `https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement` | 官方域名，**需核验** |
| `volcano_tts` | `https://console.volcengine.com/speech/app` | `https://www.volcengine.com/docs/6561` | repo（docs/6561 出现在 `voice_clone_service.py`）/ **需核验** |
| `volcano_asr` | 同 `volcano_tts`（同一控制台，需新建「流式语音识别」应用） | 同上 | **需核验** |
| `volcano_voice_clone` | 同上 | `https://www.volcengine.com/docs/6561/1167802`（repo 已出现，声音复刻下单） | repo |
| `deepseek` | `https://platform.deepseek.com/api_keys` | — | 官方域名 |
| `alibaba` | `https://bailian.console.aliyun.com/?tab=model#/api-key` | — | 官方域名，**需核验** |
| `zhipu` / `glm_coding` | `https://open.bigmodel.cn/usercenter/apikeys` | — | 官方域名 |
| `openai` / `codex` | `https://platform.openai.com/api-keys` | — | 官方域名 |
| `anthropic` / `claude_coding` | `https://console.anthropic.com/settings/keys` | — | 官方域名（可能重定向） |
| `google` | `https://aistudio.google.com/apikey` | — | 官方域名 |
| `kimi_coding` | `https://www.kimi.com/code` | — | 官方域名，**需核验** |
| 自定义（OpenAI 兼容） | 无链接；显示一句「请在你的服务商控制台获取 API Key」 | — | — |

主机白名单即上表所有主机（`app.tavily.com`、`docs.tavily.com`、`www.pexels.com`、`unsplash.com`、`freesound.org`、`console.volcengine.com`、`www.volcengine.com`、`platform.deepseek.com`、`bailian.console.aliyun.com`、`open.bigmodel.cn`、`platform.openai.com`、`console.anthropic.com`、`aistudio.google.com`、`www.kimi.com`）。**测试只校验形态（https、白名单、非空、每个集成/服务商 id 都有条目），不做联网存活检测**（CI 无网络，且链接失效不应阻断构建）。

### 3.7 前端：向导扩展

**步骤派生**（`wizardSteps.ts`）：`WizardStepId` 增 `'voice' | 'generation' | 'media'`；新增静态分组表 `integrationGroups.ts`：

```
voice:      [volcano_tts, volcano_asr, volcano_voice_clone]
generation: [ark]
media:      [pexels, unsplash, freesound]
search:     [tavily]                      // 沿用 SearchStep
```
`deriveWizardSteps` 顺序固定为 `overview → provider → models → voice → generation → media → search → done`；某分组仅当其任一能力 `needsAction`（或 manual 模式）才出现。`needsAction` 与 `isGap` 逻辑不变。`OPT_OUT_CAPABILITIES`（`setupOptOut.ts`）扩为全部 `extended` id（含 8 个新 id 与 `research`、`web_search`）；`core` 仍被忽略。

**总览页**：`CapabilityChecklist` 改为**按分组渲染**（模型 / 语音 / AI 生成 / 素材库 / 搜索，分组小标题 + 紧凑行），14 行不再是一长串。新增次按钮「只配置模型，其余以后再说」（E9）：`skipOptional()` → 为全部未配置的 `extended` 能力 `addOptOut`，用更新后的 opt-out **重新派生** `steps`（`useSetupWizard` 持有本地 `optOuts` 状态，初值取自 props）；若没有模型缺口则直接进入完成页。预计时长文案改为「模型约 2 分钟；其余为可选，随时可补」。

**分组步骤** `IntegrationGroupStep`（`wizard/`）：

```
┌ 标题：语音与字幕          副文案：合成配音、生成字幕、克隆声音所需的凭证
│ ▸ 语音合成（TTS）         [待配置]            [配置] [暂不使用]
│ ▾ 字幕识别（ASR）         [待配置]
│    …IntegrationCard 展开表单…
│ ▸ 声音克隆                [已选择不使用]      [启用]
└ [返回]                                 [本组全部暂不使用]  [稍后配置并继续 | 继续]
```
- 摘要行 = 名称 + 一句用途 + 状态胶囊（沿用 `CapabilityChecklist` 的 `Tone`）；同一时刻仅展开一张，默认展开首个缺口；`aria-expanded` / `aria-controls` 完整。
- 底部主按钮文案取决于本组是否仍有未解决项：全部解决 → 主按钮「继续」；仍有未解决 → 弱化为「稍后配置并继续」（诚实：未解决项下次启动仍会提示，与 R1「稍后」语义一致）。
- 「本组全部暂不使用」对本组所有未解决能力写 opt-out。
- manual 模式下已配置卡片默认只读，显示来源徽标与「更换」按钮（R1 D9 语义）。

**通用卡片** `IntegrationCard`（`src/components/integrations/`，向导与设置页**共用**）：

- 字段由 `GET /api/integrations` 的 schema 渲染：`secret` → 既有 `SecretInput`（显隐、trim、占位符行内报错）；`secret_list` → 多行 `textarea`（换行/逗号分隔，超限提示）。**【v2·RV2-08】** 因为密钥从不回显，且 `PUT` 对列表是**整体替换**：卡片在输入框上方显示「已配置 N 个」（取自读接口的 `count`），输入框留空=保持不变，非空=**替换全部现有 Key**，并在框下用一句话明示（「想增加一个 Key？请把已有的也一并填上」）；清除走独立的「清除」按钮；`text` → 普通输入（`inputMode`、`autocomplete="off"`）；`choice` → 原生 `<select>`，每项带一行说明（TTS 的三档计费、ASR 的四档）。
- 卡片头部固定三行信息：**用途**（它开启哪些能力）、**去哪拿**（`GetCredentialLink` + 文档链接）、**易错点**（G11 的四条，按集成各一条，见 §3.8）。
- 主按钮「保存并测试」：`PUT` →（`verify_level != none`）→ `POST test`。结果以 `role="status"`/`role="alert"` 呈现：`ok` 绿色「连接正常」（`ark` 例外，见 §3.5 RV2-09：「Key 有效；还需确认已开通模型」+ 常驻开通链接）；`unverifiable`「已保存；此服务无法免费验证，首次使用时校验」；失败类给出本地文案 + 「重新输入」/「仍然保存并继续」（Key 已落库，与 R1 `SearchStep` 一致）。提交成功后**立即清空**内存中的明文草稿，不写任何 storage、不 `console.log`。
- 「暂不使用」：对该集成服务的**全部**能力写 opt-out（`ark` 同时关 `ai_image`、`ai_video`）。保存成功则对其能力 `removeOptOut`（R1 IM-10 同款）。
- 每次写入成功后调用既有 `notifySetupConfigUpdated()`。

**模型服务商步骤补链接**：`ProviderStep` 在 API Key 字段下方用 `GetCredentialLink`，`id` 取当前选中预置服务商的 `ProviderInfo.id`；选「自定义」时显示无链接的提示句。`SearchStep` 的硬编码 `TAVILY_KEYS_URL` 换成 `GetCredentialLink id="tavily"`，其余不动（保留 R1 全部测试）。

**完成页**：`DoneStep` 汇总改为按分组；仍有未解决项时主按钮「先进入应用」（R1 既有逻辑）并提示剩余 N 项。

### 3.8 各集成的卡片文案要点（i18n 须逐条落地）

| 集成 | 必须讲清的事（G11） |
|------|-------------------|
| `volcano_tts` | 需要「豆包语音」新版控制台的 **API Key**（不是 APP ID/Token）；资源 ID 决定可用音色：2.0 音色用 `seed-tts-2.0`，1.0 音色用 `seed-tts-1.0`；选错会合成失败 |
| `volcano_asr` | 字幕识别用的是**另一个应用**——「流式语音识别」应用的 **APP ID + Access Token**，与语音合成的 API Key 不通用；同一 APP ID 的 TTS 与 ASR 授权相互独立（`config.py:432-434`）；留空时不再静默借用 TTS 的旧版字段 |
| `volcano_voice_clone` | 凭证之外还需在控制台**另购 speaker_id**（给文档链接）；本项无法免费验证 |
| `ark` | 一个 Key 同时开启 **AI 图片（Seedream）与 AI 视频（Seedance）**，也驱动分镜与封面生成；Key 创建后还必须在「开通管理」里开通对应模型（`activationUrl`），否则会报未授权 |
| `pexels` / `unsplash` | 免费额度与限流提示；支持多个 Key 轮换（最多 5 个） |
| `freesound` | 免费申请；仅用于搜索与试听，下载原始高品质音频需 OAuth（本应用只用预览） |

### 3.9 运行期出口（E10）

- `setupEvents.ts` 新增 `openSetupWizard(focus?: IntegrationId)`：派发 `ecliptrix-open-setup-wizard`（`detail.focus`）。
- `page.tsx` 监听该事件 → `setWizardMode('manual')` 并保存 `wizardFocus`；`useSetupWizard` 在 manual 模式下若有 `focus`，把 `stepIndex` 初始化到包含该集成的分组步骤，并默认展开对应卡片。
- 新增小组件 `ConfigureCta`（`src/components/integrations/`）：接收 `integrationId`，渲染「去配置」按钮并调用 `openSetupWizard`。接线点（已知，实现时 grep 补全）：`src/lib/ttsErrors.ts`（`TTS_CONFIG_MISSING`）、`audioTranscription` 错误展示（`ASR_NOT_CONFIGURED`）、`arkImage.ts` / `arkVideo.ts` 的错误展示、`useAudioSearch.ts` / `useImageSearch.ts` / `videoSearchService.ts` 的未配置提示、声音克隆面板。判定依据是后端追加的 `error_code === 'credential_not_configured'` 与 `details.integration_id`（§3.4），不再靠匹配英文消息。

**【v2·RV2-13】后端预检与接线清单**：
- 有的服务在未配置时**静默返回 `None`/空结果**（如 `audio_search_service._make_api_request` 在无 Key 时返回 `None`，上层会被渲染成「没有搜索结果」），路由层感知不到「没配置」。因此三个搜索路由、ARK 图/视频/分镜/封面路由、TTS/ASR/声音克隆路由，**在调用服务之前**用 `integration_credentials.is_usable(<id>)` 预检，未配置直接返回 `credential_not_configured`；服务内部不再负责这个判定。
- 「接线点（grep 补全）」落成产物：`link-audit.md` §B 列出每一个展示未配置错误的前端位置（文件:行 → 集成 id → 是否已接 `ConfigureCta`），每个接线点有一条组件测试（出现 `credential_not_configured` 时渲染「去配置」且点击派发正确的 `focus`）。清单缺项视为 AC2-10 未达成。

### 3.10 设置页「服务与素材库」

- `SettingsMenuItem` 增 `'integrations'`，`SettingsSidebar` 在 AI 分组加入口（标签「服务与素材库」），`settingsAttentionItems` 在有集成类缺口时加琥珀点；`SettingsPage` 增 `case 'integrations'`。
- `IntegrationsSettingsPanel`：按分组列出 7 个集成，每个就是常驻展开的 `IntegrationCard`（always-editable 模式）：来源徽标（应用内 / 环境变量 / 未配置）、「保存并测试」、「清除并回退 .env」、已选择不使用时的「重新启用提醒」（P2）。Tavily 一行只放跳转到「联网搜索」面板的链接。
- 写入后同样 `notifySetupConfigUpdated()`，`useSetupStatus` 静默重取，徽标即时更新。

### 3.11 一致性保证（延续 R1 §3.5）

1. **同一写路径**：向导与设置页都经 `src/lib/api/integrations.ts` → BFF → 同一后端服务，向导不持有影子副本。
2. **同一读路径**：状态来自 `capability-status`，其判定函数与运行期调用同一个 `integration_credentials`（E2）。
3. **同一组件**：向导分组步骤与设置面板都渲染 `IntegrationCard`。
4. **事件闭环**：写入成功即 `notifySetupConfigUpdated()`；运行期出口通过 `ecliptrix-open-setup-wizard` 回到同一向导。
5. **结构性守卫**：`test_no_direct_credential_reads.py`（§3.3）+ 契约夹具（§3.1）+ 占位符一致性测试（§3.2）。

### 3.12 失败处理矩阵（增量）

| 场景 | 行为 |
|------|------|
| `PUT` 校验失败（占位符/过短/超限/非法选项） | 字段级错误（本地文案，不回显值），保持表单内容，不落库 |
| `PUT` 成功但 `test` 失败 | 配置保持已保存，显示失败原因 + 「重新输入」/「仍然保存并继续」；状态因「配置完整」已转 `ready`（R1 口径：状态≠已验证） |
| 探针限流（5s 节流/锁占用） | 返回 `rate_limited`-类提示「请稍后再试」，不报错 |
| 探针端点不可用（`unreachable`/`upstream_error`） | 文案「暂时无法验证，可先保存并稍后在设置里测试」，可继续 |
| 数据库写失败 | 500 + `integration_save_failed`，缓存不变，前端保留草稿 |
| 启动读取凭证表失败 | 集成类能力 `indeterminate`，向导不弹（fail-open）；日志 `exception` |
| 链接不安全/缺失 | `GetCredentialLink` 降级为纯文本说明，不渲染 `<a>` |
| 用户已有 `.env` 真实 Key | 状态 `ready`、来源「环境变量」；向导不打扰；手动模式可「更换」写入应用内配置（应用内优先） |
| 两处同时保存同一集成 | 每集成一把锁，后者覆盖前者；缓存整体替换，不出现半个条目 |

---

## 4. File / module change plan

### 4.1 新增

| 文件 | 意图 |
|------|------|
| `backend-services/basic-service/app/services/secret_values.py` | 共享占位符/可用密钥判据 `is_usable_secret`（G5） |
| `…/app/services/integration_registry.py` | `FieldSpec` / `IntegrationSpec` / `REGISTRY`、能力→集成映射、夹具序列化 |
| `…/app/services/integration_credentials_service.py` | 凭证缓存 + 解析器 + 校验 + 保存/清除；导出 `integration_credentials`、`ark_api_key()` |
| `…/app/services/integration_probes.py` | 各集成连通性探针与 `outcome` 分类 |
| `…/app/services/credential_errors.py` | `CredentialNotConfigured` 与稳定错误码常量 |
| `…/app/models/integration_models.py` | 请求/响应 Pydantic 模型（零秘密） |
| `…/app/routers/integrations_router.py` | `GET/PUT/DELETE /api/integrations…`、`POST …/test` |
| `…/tests/test_integration_credentials.py` | 解析优先级、占位符、校验矩阵、持久化、零秘密、回退 env |
| `…/tests/test_integration_probes.py` | 探针分类（`httpx.MockTransport`）、Key 不入日志/URL |
| `…/tests/test_integration_hot_reload.py` | 每个迁移服务「写入后无需重启即可见」 |
| `…/tests/test_no_direct_credential_reads.py` | 守卫测试（§3.3） |
| `…/tests/test_integrations_contract.py` | 注册表 ⇄ 夹具（含 `providerPresetIds`）、占位符样例表 |
| `src/app/api/integrations/__tests__/route.test.ts` | **【v2·RV2-01】** BFF：无 `Origin` 的写请求 403、合法 `Origin` 被转发（含 `DELETE`）、`[id]` 白名单 |
| `src/lib/api/__fixtures__/integrations-schema.json` | 前后端共享契约夹具 |
| `src/lib/api/integrations.ts` | 类型化客户端（list/save/clear/test）；写请求带 `Content-Type: application/json` |
| `src/lib/credentialLinks.ts` | 取证链接注册表 + `safeExternalUrl`（§3.6） |
| `src/app/api/integrations/route.ts`、`[id]/route.ts`、`[id]/test/route.ts` | BFF 透传（动态段用 builder 形式） |
| `src/components/integrations/GetCredentialLink.tsx` | 唯一的外链渲染入口 |
| `src/components/integrations/IntegrationCard.tsx` + `IntegrationField.tsx` + `useIntegrationCard.ts` | 通用卡片（向导/设置共用） |
| `src/components/integrations/ConfigureCta.tsx` | 运行期「去配置」按钮 |
| `src/components/Onboarding/wizard/IntegrationGroupStep.tsx` | 分组手风琴步骤 |
| `src/components/Onboarding/wizard/integrationGroups.ts` | 分组表、能力→集成→分组映射（纯数据，可单测） |
| `src/components/settings/IntegrationsSettingsPanel.tsx` | 设置页「服务与素材库」 |
| `docs/plans/setup-wizard-full-capability-coverage/link-audit.md` | 链接与探针核验记录（实现节点填写，含日期与结论） |
| 对应测试：`credentialLinks.test.ts`、`GetCredentialLink.test.tsx`、`IntegrationCard.test.tsx`、`IntegrationGroupStep.test.tsx`、`IntegrationsSettingsPanel.test.tsx`、`ConfigureCta.test.tsx`、`integrationsContract.test.ts` | 见 §7 |

### 4.2 修改

| 文件 | 意图 |
|------|------|
| `…/app/models/db_models.py` | 新增 `IntegrationCredential` ORM（纯增量，不动现有表） |
| `…/app/main.py` | 注册 `integrations_router`；lifespan 中 `integration_credentials.load_all()` |
| `…/app/services/setup_status_service.py` | 新增 8 项能力探针；占位符判据改从 `secret_values` 导入；`load_failed → indeterminate` |
| `src/lib/server/researchUiOrigin.ts` | **【v2·RV2-01】** `protectedSettingsWrite` 的 `method` 联合类型加入 `'DELETE'` |
| `…/app/models/setup_status_models.py` | `CapabilityId` 扩为 14 项 |
| `…/app/routers/config_router.py` | 占位符常量改引用共享模块（R1 已有引用点） |
| `…/app/services/tts_service.py` | `api_key`/`resource_id` 改为 `credential_property` 描述符（删除 `__init__` 内赋值）；`TTSClient` 增可选 `timeout`（默认 30）；未配置分支追加 `integration_id` |
| `…/app/services/audio_transcription_service.py` | 三个字段改 `credential_property`（删除 `__init__` 内赋值）；`_missing_credentials` 走 `is_usable`；日志降级 |
| `…/app/services/voice_clone_service.py` | `app_key/access_key` 改 `credential_property`；**`:225` 的 `tts_resource_id` 直读改走解析器**（`speaker_id_prefix` 不动）；未配置文案 + 错误码 |
| `…/app/services/video_search_service.py` / `image_search_service.py` / `audio_search_service.py` | `api_keys`/`api_key` 改 `credential_property`；去除 Key 片段日志；Freesound 改 header 认证 |
| `…/app/services/ark_image_service.py`、`ark_video_service.py`、`storyboard_service.py`、`video_cover_v2_service.py` | 10 处 `settings.ark_api_key`（含 v1 漏列的 `ark_video_service.py:534`）→ `ark_api_key()` |
| `…/app/routers/image_router.py`、`audio_router.py`、`video_router.py` | **调用服务前**用 `is_usable` 预检；未配置分支追加 `error_code` / `integration_id`（`message` 不变）。覆盖 TTS/ASR/声音克隆/ARK/分镜/封面/三类搜索路由 |
| `…/tests/conftest.py` | **【v2·RV2-05】** `autouse` 夹具：中和注册表涉及的 `settings` 凭证属性与 env 名、清空解析器缓存 |
| `…/tests/test_ark_video_modes_unit.py`、`tests/test_video_search.py` | 补丁目标改为解析器 / 基线（G14） |
| `…/env.template`、`desktop/scripts/env.template.desktop` | 注释补一行「也可在应用内『设置 → 服务与素材库』配置，应用内优先」；`your_volcano_tts_api_key` 等统一补 `_here`；删除无消费方的 `RUNNING_HUB_API_KEY`（G12，若 `verify-no-bundled-secrets` 门禁不受影响） |
| `src/lib/api/setupStatus.ts` | `CapabilityId` 扩为 14 项 |
| `src/components/Onboarding/wizard/wizardSteps.ts` | 新分组步骤派生、`settingsAttentionItems` 加 `'integrations'` |
| `…/wizard/useSetupWizard.ts` | 本地 `optOuts` 状态、`skipOptional()`、`focus` 定位 |
| `…/wizard/OverviewStep.tsx`、`CapabilityChecklist.tsx`、`DoneStep.tsx` | 分组渲染；「只配置模型」按钮 |
| `…/wizard/ProviderStep.tsx`、`SearchStep.tsx` | 接入 `GetCredentialLink` |
| `…/wizard/modelHints.ts` | `isPlaceholderKey` 与后端同一组 **7 条整串锚定**判据（G5；**不含** `^sk-test`/`EXAMPLE`，RV2-03） |
| `src/components/Onboarding/SetupWizard.tsx` | 渲染 3 个新步骤；接收 `focus` |
| `src/lib/setupOptOut.ts`、`src/lib/setupEvents.ts` | opt-out 范围扩到全部 extended；新增 `openSetupWizard` |
| `src/app/page.tsx` | 监听 `ecliptrix-open-setup-wizard`；向导传 `focus` |
| `src/components/settings/SettingsSidebar.tsx`、`SettingsPage.tsx` | 新增 `integrations` 菜单项与面板 |
| `src/lib/ttsErrors.ts` 等错误展示点 | 接入 `ConfigureCta`（§3.9 列表） |
| `src/lib/i18n.ts` | 新增 `integrations` 命名空间；`setupWizard.cap.*` 加 8 项；分组/步骤/链接文案（接口 + en + zh 三处） |
| `CLAUDE.md` | 更新 Shell/向导小节（14 项、extended 档扩展）；Key Conventions 加「外部凭证只经 `integration_credentials`」 |

### 4.3 删除

无（R1 的 `SetupGuideDialog` 等已删）。

---

## 5. Interface design

### 5.1 `GET /api/integrations`

```json
{
  "success": true,
  "data": {
    "integrations": [
      {
        "id": "volcano_asr",
        "capabilities": ["asr"],
        "verify_level": "handshake",
        "usable": false,
        "source": "none",
        "fields": [
          { "name": "appid",        "kind": "text",   "required": true,  "configured": false, "source": "none" },
          { "name": "access_token", "kind": "secret", "required": true,  "configured": false, "source": "none" },
          { "name": "resource_id",  "kind": "choice", "required": false, "configured": true,  "source": "default",
            "value": "volc.bigasr.sauc.duration",
            "choices": ["volc.bigasr.sauc.duration","volc.bigasr.sauc.concurrent","volc.seedasr.sauc.duration","volc.seedasr.sauc.concurrent"] }
        ]
      }
    ],
    "load_failed": false
  }
}
```
`source ∈ database | environment | default | none`。`value` 只对 `text`/`choice` 字段出现；`secret`/`secret_list` 只有 `configured` 与（列表的）`count`。**契约红线**：任何响应、日志、审计中不得出现密钥原文或片段（测试用唯一金丝雀字符串断言）。

### 5.2 `PUT /api/integrations/{id}`

请求：`{"fields": {"appid": "1234567890", "access_token": "…"}}`；省略=不变，`""`/`null`=清除该字段。返回同 §5.1 的单个集成对象。错误：`422 {"success": false, "error_code": "credential_placeholder", "error_details": {"field": "access_token"}}`（其余码见 §3.2）。需 `Origin` + `application/json`（`validate_ui_origin(write=True)`）。

### 5.3 `DELETE /api/integrations/{id}` 与 `POST /api/integrations/{id}/test`

`DELETE` 返回清除后的集成对象（回退到 env 基线的状态）。`test` 返回：

```json
{ "success": true, "data": { "outcome": "ok", "verify_level": "free", "elapsed_ms": 412 } }
```
`outcome` 见 §3.5 枚举；`success` 表示请求本身被处理，不表示凭证有效。

### 5.4 `GET /api/config/capability-status`（扩展）

新增 8 个条目，字段不变。例：`{"id":"ai_image","tier":"extended","state":"missing","source":"none"}`、`{"id":"asr","tier":"extended","state":"invalid","source":"none"}`（只填了 APP ID）。仍零秘密。

### 5.5 前端类型与事件

```ts
export type CapabilityId =
  | 'chat' | 'fast' | 'video_cut' | 'vision' | 'research' | 'web_search'
  | 'tts' | 'asr' | 'voice_clone' | 'ai_image' | 'ai_video'
  | 'video_library' | 'image_library' | 'audio_library';
export type IntegrationId =
  | 'volcano_tts' | 'volcano_asr' | 'volcano_voice_clone'
  | 'ark' | 'pexels' | 'unsplash' | 'freesound';
export type WizardStepId =
  | 'overview' | 'provider' | 'models' | 'voice' | 'generation' | 'media' | 'search' | 'done';
export function openSetupWizard(focus?: IntegrationId): void; // 派发 ecliptrix-open-setup-wizard
```

| 名称 | 类型 | 说明 |
|------|------|------|
| `ecliptrix-llm-config-updated` | `window` 事件 | 沿用，所有写入成功后派发 |
| `ecliptrix-open-setup-wizard` | `window` 事件 | 新增；`detail: { focus?: IntegrationId }` |
| `ecliptrix-setup-optouts` | `localStorage` | 沿用键；现可含 8 个新 id |

### 5.6 i18n 键（中英同构）

`integrations.{volcano_tts,volcano_asr,volcano_voice_clone,ark,pexels,unsplash,freesound}.{name,desc,pitfall}`；字段 `integrations.field.{apiKey,appId,accessToken,accessKey,appKey,resourceId,apiKeys}` 与 `integrations.choice.*`（资源 ID 各选项说明）；动作 `getKey, openDocs, copyLink, activateModels, saveTest, clear, useEnvFallback, skipGroup, skipOptional, continueLater, change, reenable`；测试结果 `integrations.test.{ok,invalid_credentials,not_entitled,rate_limited,unreachable,upstream_error,unverifiable}`；错误 `integrations.err.{placeholder,malformed,tooMany,invalidChoice,saveFailed}`；`setupWizard.cap.{tts,asr,voice_clone,ai_image,ai_video,video_library,image_library,audio_library}.{name,desc}`、`setupWizard.group.{models,voice,generation,media,search}`、`setupWizard.step{Voice,Generation,Media}`、`integrations.cta.configure`。

---

## 6. Data model

**唯一变更**：新增表 `integration_credentials`（§3.2），纯增量，`create_all` 建表；不做任何 DROP/ALTER（CLAUDE.md 红线），旧版本应用忽略此表。

| 存储 | 写入者 | 内容 |
|------|--------|------|
| `integration_credentials`（SQLite） | 向导 / 设置页 | `integration_id` → `{字段名: 值}`；secret_list 为数组 |
| `settings_audit_log` | 凭证服务 | `setting_type='integration'`，仅 action（create/update/delete），不含值 |
| `localStorage['ecliptrix-setup-optouts']` | 向导 / 设置页 | extended 能力 id 数组，现含 8 个新 id |
| 进程内缓存 | 凭证服务 | `dict[integration_id, dict]`，整体替换式更新 |

内存草稿（卡片）：`{ [fieldName]: string }`，提交成功或离开步骤即清空；**绝不**进入 storage / 日志。

---

## 7. Testing & acceptance criteria

### 7.1 验收标准

| AC | 描述 |
|----|------|
| AC2-1 | **脱敏安装包主线**：全新 userData + 脱敏 `.env`（全是 `your_*_here`）→ `capability-status` 14 项里**无任何 `ready`**；向导弹出，总览按 5 组列出 14 项 |
| AC2-2 | 向导依次出现 `provider/models/voice/generation/media/search` 步骤（按缺口），每个集成都有「获取 Key」链接；点击在**系统浏览器**打开，应用窗口不被导航 |
| AC2-3 | 在向导里为 TTS、字幕识别、ARK、Pexels、Unsplash、Freesound 各填一次凭证 → 保存后**不重启**即可：合成一句话、生成字幕、AI 图片/视频任务能提交、三类素材搜索有结果 |
| AC2-4 | 同一份凭证在设置页「服务与素材库」中逐字段对应显示（来源=应用内；密钥不回显；text/choice 字段回显），可修改、可「清除并回退 .env」 |
| AC2-5 | 占位符（含 `your_volcano_tts_api_key` 无 `_here`）不被接受：保存时行内报错；作为 env 值时状态为 `missing`；**反例**：`sk-test-secret-123` 这类真实形态的 Key 不被误判为占位符（RV2-03） |
| AC2-6 | 字幕识别只填 APP ID → 状态 `invalid`（配置不完整）；补全后 `ready` |
| AC2-7 | `ark` 一次配置使 `ai_image` 与 `ai_video` 同时转 `ready`；「暂不使用」同时为两项写 opt-out |
| AC2-8 | 分组底部按钮：本组仍有未解决项时为「稍后配置并继续」，全部解决后为「继续」；「本组全部暂不使用」「只配置模型，其余以后再说」生效且重新派生步骤 |
| AC2-9 | 老用户已有真实 `.env` Key：状态 `ready`/来源「环境变量」，**不弹窗**；手动模式「更换」写入后应用内配置优先生效 |
| AC2-10 | 运行期：未配置时调用 TTS/字幕/ARK/三类搜索，界面出现「去配置」，点击以 manual 模式打开向导并定位到对应集成卡片 |
| AC2-11 | 零秘密：`GET/PUT/DELETE/test` 与 `capability-status` 响应、后端日志、审计表、浏览器 storage 中均无密钥原文或片段；Freesound/Pexels 日志与 URL 不再含 Key |
| AC2-12 | 连通性：`free`/`handshake` 级探针对有效 Key 返回 `ok`、对无效 Key 返回 `invalid_credentials`；`volcano_voice_clone` 明示「无法免费验证」；`ark` 的 `ok` 文案为「Key 有效；还需确认已开通模型」并常驻开通链接（RV2-09）；`MOCK_MODE` 下 TTS 探针为 `unverifiable` 而非 `ok`（RV2-06）；探针不可用时降级而非伪造成功（结论记入 `link-audit.md`） |
| AC2-13 | 启动读取凭证表失败 → 向导**不弹**（fail-open），应用可用 |
| AC2-14 | 中英文完整、深浅色、`prefers-reduced-motion`、全程键盘可操作、手风琴 ARIA 正确（继承 R1 AC-13…15） |
| AC2-15 | R1 全部验收项（AC-1…AC-15）与既有测试保持绿（仅 §4.2 列出的两个补丁目标改动；直接给服务实例属性赋值的 4 个测试文件〔G15〕无需改动） |
| AC2-16 **【v2·RV2-11】** | **R1 老用户升级**：已在 R1 向导里完成模型配置的用户升级后首次启动，向导以 auto 模式出现，步骤仅为 `overview` + 有缺口的新分组步骤（voice/generation/media）+ `done`，**不出现** `provider`/`models`；总览里模型各行显示「已就绪」；「只配置模型，其余以后再说」一键写入 opt-out 后不再弹出 |
| AC2-17 **【v2·RV2-01】** | **BFF 写路径**：在 Electron 打包版与 dev（3000 端口）下，7 个集成的保存 / 清除 / 测试均成功（不是 403）；用无 `Origin` 的 `curl` 直打 BFF 写接口得 403；`DELETE` 路由同样转发 `Origin` |

### 7.2 自动化测试

**后端（pytest，SQLite 内存库，沿用 `test_setup_status.py` 夹具风格）**
- `test_integration_credentials.py`：优先级「库 > env > 默认」；占位符/空值逐层落空；ASR 基线回落 `VOLCANO_TTS_*`；`patch` 语义（省略/清除/全清删行）；校验矩阵（占位符、过短、含空白/换行、超限、未知字段、非法选项）；`load_all` 后持久；删除回退 env；并发保存不产生半条目；**零秘密**（金丝雀字符串不得出现在任何响应/`caplog`/审计行）。
- `test_setup_status.py`（扩）：脱敏安装包场景 14 项全 `missing`；仅填 `appid` → `invalid`；`ark` → 两项同转 `ready`；env 真实 Key → `ready/source=environment`；`load_failed` → `indeterminate`；零秘密契约覆盖新增 8 项；`your_volcano_tts_api_key` 回归。
- `test_integration_probes.py`：`httpx.MockTransport` 覆盖 200/401/403/429/超时/5xx 的分类；Key 只在请求头、不在 URL/日志；节流与单飞锁；`volcano_voice_clone` 恒为 `unverifiable`；TTS 探针不留临时文件。
- `test_integration_hot_reload.py`：**【v2·RV2-02】** 新建实例后断言不存在任何 `_cred_override_*` 键；覆盖值 setter 对 `service.api_key = ''` 这类既有写法仍然生效；不重建服务实例，调用 `save()` 后立刻让 `TTSService.validate_config`、`AudioTranscriptionService._missing_credentials`、`VoiceCloneService`、`VideoSearchService/ImageSearchService/AudioSearchService` 的 key 读取、`ark_api_key()` 反映新值（**真实路径，不 mock 解析器**，符合 CLAUDE.md「高风险路径不 mock」）。
- `test_no_direct_credential_reads.py`（模式表由注册表自动生成，白名单仅 `speaker_id_prefix`，RV2-04）、`test_integrations_contract.py`（注册表 ⇄ 夹具含 `providerPresetIds`；占位符样例表含 `sk-test-…` 反例，RV2-03）。
- **【v2·RV2-06】** `test_integration_probes.py` 增：TTS 探针在 `asyncio.to_thread` 中执行（事件循环不被阻塞——用并发心跳协程断言）、`MOCK_MODE` 下为 `unverifiable`、`TTSServiceError.code` 逐码映射、发音人随 `resource_id` 选取（1.0 配置不会被判 `not_entitled`）、临时目录无残留。
- **【v2·RV2-05】** 解析器测试覆盖：基线缺属性不抛错（`SimpleNamespace` stub）、autouse 隔离后在带真实 `.env` 的机器上结果不变。
- 既有套件：`test_config_llm_status.py`、`test_setup_status.py`（R1 部分）、8 个触及 `settings.*_key` 的测试文件保持绿（除 G14 两个改补丁目标），**以及 G15 的 4 个文件**（`test_audio_transcription_service.py`、`test_sentence_tts_error_details.py`、`test_tts_error_details.py`、`test_tts_router.py`，不改一行）。启动 DDL 断言（无 `DROP`）继续成立。

**前端（Vitest + Testing Library）**
- `credentialLinks.test.ts`：所有 URL 为 `https:`、主机在白名单；夹具里每个集成 id、夹具 `providerPresetIds` 的 10 个预置服务商 id 都有条目（RV2-12）；`safeExternalUrl` 拒绝 `http:`/`javascript:`/`file:`/未知主机。
- `GetCredentialLink.test.tsx`：渲染 `target="_blank"` 且 `rel="noopener noreferrer"`；可访问名称含「在系统浏览器中打开」；不安全 URL 时无 `<a>`。
- `wizardSteps.test.ts`（扩）：分组步骤派生矩阵（clean install / 仅缺媒体库 / opt-out / manual / `skipOptional` 重新派生 / `focus` 定位）。
- `IntegrationCard.test.tsx`：字段按 schema 渲染；保存→测试 happy path 与**请求负载**；成功后草稿清空且 storage 无 Key；占位符行内报错；测试失败仍保持已保存；`unverifiable` 路径；「暂不使用」对 `ark` 写两个 opt-out；键盘与焦点。
- `IntegrationGroupStep.test.tsx`：手风琴同时仅展开一张、默认展开首个缺口、底部按钮文案随未解决项变化、本组全部暂不使用。
- `IntegrationsSettingsPanel.test.tsx` + 扩展 `settingsCorrespondence`：向导保存后面板逐字段一致；清除后状态回落。
- `ProviderStep.test.tsx`（扩）：每个预置服务商都渲染对应取证链接；自定义无链接。
- `ConfigureCta.test.tsx`：派发 `ecliptrix-open-setup-wizard`（带 `focus`），`page` 以 manual 模式打开并定位。
- `integrationsContract.test.ts`：夹具里每个集成/字段在 i18n（en+zh）、链接表、分组表都有对应项；`isPlaceholderKey` 与后端同一份样例表一致（含 `sk-test-secret-123` 判为可用的反例，RV2-03）。
- **【v2】** `SetupWizard.test.tsx`（R1，`SECRET='sk-test-secret-123'`）原样保持绿；`wizardSteps.test.ts` 增 AC2-16 的矩阵（模型已就绪 + 新能力缺口 → 步骤集合）；`IntegrationCard.test.tsx` 增 `secret_list`「已配置 N 个 / 留空不变 / 非空整体替换」用例（RV2-08）与 `ark` 的 `ok` 文案用例（RV2-09）。
- 既有：`useSetupStatus`（扩 14 项与新 opt-out）、`ModelSettingsPanel`/`WebResearchSettingsPanel`、themeTokens（新增组件不得用 `hsl(var(--x))`，参见 R1 IM-09）保持绿。

**质量门**：`npm run type-check`、`npm run lint`（差分判据：新增/修改文件 0 error）、`npm run test`、`pytest tests/ -k "integration or setup_status or config_llm or ark or video_search or no_direct or tts or audio_transcription or voice_clone or audio_search or image_search"`；新增文件 ≤800 行、函数 ≤50 行（单步表单类组件的既有豁免写明理由，参见 `SearchStep`）。

### 7.3 桌面端手工走查（强制，沿用 R1 §7.3 并增补）

1. `npm run build:dir`，全新 userData、脱敏 `.env`：核对 AC2-1/2。
2. 逐个取证链接点击：确认在系统浏览器打开、落到正确页面，**记录进 `link-audit.md`**（日期、页面标题、是否需要登录、失败时的回落）。
3. 用真实 Key 完成 AC2-3 的 6 项「立即可用」；逐个探针与真实服务对照（AC2-12），不可用的写明降级。
4. 老用户路径（`.env` 有真实 Key）AC2-9；断网时点「保存并测试」；英文 + 深色 + 最小窗口宽度。

---

## 8. 实施顺序（供下游节点拆分）

0. **共享判据**：`secret_values.py` + 前后端一致性测试；`setup_status_service` 改引用。先写失败测试（`your_volcano_tts_api_key`）。
1. **存储与解析器**：ORM、`integration_registry`、`integration_credentials_service`（含校验）、`test_integration_credentials.py`、契约夹具。
2. **迁移读取点**（先实现 `credential_property` 描述符与 autouse 隔离夹具；再写 `test_integration_hot_reload.py` 为红，再逐服务改绿；**每迁一个服务就立刻跑 G15 的 4 个既有测试文件**）：TTS → ASR → 声音克隆 → 三个搜索 → ARK 十处；顺手修 G13；同步 G14 两个测试文件；加守卫测试。
3. **状态与接口**：`capability-status` 扩 14 项；`integrations_router`（含 BFF 三个路由与 `protectedSettingsWrite` 扩 `DELETE`）、探针（含 `TTSClient.timeout`）；`credential_not_configured` 错误码追加。
4. **前端基础**：`credentialLinks`、`integrations.ts` 客户端与 BFF、`GetCredentialLink`、`setupStatus`/`setupOptOut`/`setupEvents` 扩展。
5. **卡片与向导**：`IntegrationCard` → `integrationGroups` → `IntegrationGroupStep` → `wizardSteps/useSetupWizard/OverviewStep/CapabilityChecklist/DoneStep`；`ProviderStep`/`SearchStep` 接链接；i18n 中英文案同步落地。
6. **设置页与运行期出口**：`IntegrationsSettingsPanel` + 侧栏；`ConfigureCta` 与各错误展示点；`page.tsx` 监听。
7. **文档与收尾**：`env.template*` 注释与占位符统一；`CLAUDE.md`；`link-audit.md`。
8. **验证**：质量门全绿；桌面端走查 §7.3。

优先级：步骤 0–5 为 **P0**；6 为 **P1**（缺它「暂不使用」不可逆，建议同批交付）；「复制链接」按钮、「重新启用提醒」、ASR/克隆凭证「复用同一应用」便捷按钮为 **P2**。

---

## 9. Risks & mitigations

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 读取点迁移引入回归（构造期快照改为属性） | 每处改动最小且保留公开属性名；**属性用带覆盖值 setter 的描述符，不用只读 property（RV2-02）**；`test_integration_hot_reload.py` 走真实路径；既有 8 + 4 个测试文件复跑；守卫测试按注册表生成模式、防止回潮 |
| R2 | 连通性探针端点未在线验证，可能不可用或误判；TTS 探针会计费 | 设计显式声明未验证（§3.5）；实现节点用真实 Key 核验并记入 `link-audit.md`；不可用一律降级 `unverifiable`，禁止伪造 `ok`；TTS 仅合成 1 字且需用户点击同意并有明示文案 |
| R3 | 取证链接失效 / 路径错误（控制台经常改版） | 注册表集中、白名单校验、渲染降级为文本；核验日期落档；失效时回落厂商首页或文档根；不做联网存活测试以免 CI 脆弱 |
| R4 | 凭证明文落在本机 SQLite | 与 `model_providers.api_key` 同级（G8）；不进日志/审计/响应；userData 目录权限由 OS 保护；后续用 Electron `safeStorage` 加密列并做一次性迁移（独立项） |
| R5 | 14 项能力造成弹窗疲劳 | extended 档可显式不使用；分组「全部暂不使用」+ 总览「只配置模型」；会话级「稍后」；运行期「去配置」使跳过可逆 |
| R6 | 占位符判据在 Python/TS/桌面脚本三处漂移（G5）；反向地，过宽的判据会误拒真实 Key | 同一样例表驱动前后端一致性测试（含「必须判为可用」的反例）；`secret_values.py` 注释写明与 `secret-shape.js` 的对应关系**及有意的差集**（RV2-03） |
| R7 | ASR/TTS 凭证混淆（G11） | 卡片「易错点」文案强制落地（§3.8）；应用内存储层不做跨集成回落，三张语音卡片互相独立；env 基线层回落仍保留以兼容老用户（口径见 §3.1，RV2-07） |
| R8 | 应用内配置与 `.env` 并存造成困惑 | 来源徽标；「清除并回退 .env」；手动模式「更换」需显式点击；E3 的优先级写进卡片说明 |
| R9 | `validate_ui_origin` 在浏览器开发模式（端口 3000）与 Electron（注入 `RESEARCH_RENDERER_ORIGIN`）下行为不同，写接口可能 403 | 沿用既有函数不改语义；**BFF 必须转发 `Origin` 并前置校验（§3.5 BFF 契约，RV2-01，AC2-17）**；两种模式各一条手工用例；403 时前端显示本地化「来源被拒绝」而非泛化失败；非 3000 端口 dev 服务器是否注入 `RESEARCH_RENDERER_ORIGIN` 待实现时核实 |
| R10 | `i18n.ts` 已 1.1 万行，再加命名空间 | 沿用项目「单文件」约定（CLAUDE.md），集中命名空间、键同构；不在本轮拆分 |
| R11 | SQLite 并发写 / 锁等待 | 每集成互斥锁 + 先写库后换缓存；失败不留半成品；500 带稳定错误码 |
| R12 | 向导与 `capability-status` 对 `invalid` 的口径在新集成上不一致 | 判定函数唯一（`_integration_slot`）；前端只渲染不推断；契约夹具 + 测试覆盖 |
| R13 | 存量大文件继续膨胀（R1 F9） | 对 `ModelSettingsPanel`/`model_settings_service` 零改动；所有新逻辑落新文件；`setup_status_service` 增量控制在 ≤ +80 行 |
| R14 | **【v2】** 探针依赖同步客户端 / 模拟模式（TTS）导致阻塞或伪造成功 | `asyncio.to_thread` + 客户端自身超时 + `MOCK_MODE` 下 `unverifiable`（RV2-06） |
| R15 | **【v2】** 单测依赖开发机 `.env`/`settings` 导致 AC2-1 不确定 | 基线读取单点 + autouse 中和真实来源（RV2-05） |

---

## 10. 与 R1 spec 的衔接：被推翻/修订的条目

| R1 条目 | 本轮处理 |
|---------|----------|
| F3「TTS/Pexels/Unsplash/ARK/Freesound 只能走 `.env`」 | **推翻**：新增应用内存储（E1）；`.env` 降为后备基线（E3） |
| §2.2 非目标「不新增 env-only 凭证的应用内存储」及理由（热更新需另行设计） | **推翻**：热更新方案即 §3.3（调用时读取同一解析器） |
| §2.3 D2 能力两档（core 4 项、extended 2 项） | **扩展**：extended 增至 10 项；core 不变（E6） |
| IM-02 步骤冻结 | **保留**，仅 `skipOptional()` 为受控例外（E9） |
| `OPT_OUT_CAPABILITIES = [research, web_search]` | 扩为全部 extended id |
| 占位符判据 `^your_.*_here$` | **【v2】** 扩为 7 条整串锚定判据（补 `^your_[a-z0-9_]*$` 等，G5）；**有意不照搬** `secret-shape.js` 全表（`^sk-test`、未锚定 `EXAMPLE`、`xxxxxxxx` 子串不收录，RV2-03） |
| RV-13「状态≠已验证」口径 | **延续**：探针分级并如实标注 `unverifiable`（E11） |
| R1 的 `isPlaceholderKey`/`is_usable_secret` 复用于模型服务商与 Tavily Key | **【v2】** 收窄后的 7 条判据是 R1 判据的**超集但仍整串锚定**，R1 全部既有用例保持绿（RV2-03） |
| §7.3 桌面端走查（仍未执行） | **仍为强制项**；本轮增补链接核验与真实 Key 探针核验（§7.3） |

**未决 / 如实记录**：①所有取证链接与探针端点未在线验证（本节点无网络核验手段，搜索结果仅得第三方资料），已按「需核验」标注并要求实现节点落档；②未评估 TTS/ASR 在真实账号下 `not_entitled` 的上游返回形态，分类规则以实现时的实测为准；③R1 遗留的桌面端走查（AC-1…AC-15）至今未执行，本轮并入同一次走查。

---

## 评审结论（Review Verdict）

**结论：有条件通过（v2）。**

**统计**：共 13 条问题 + 1 条核实说明——**P0 × 1**（RV2-01）、**P1 × 5**（RV2-02…06）、**P2 × 7**（RV2-07…13）。P0 与 P1 已全部回写正文（以 **【v2】** 标注），P2 也已在正文处理；**无未解决的 P0 / P1**。设计的总体取舍（专用凭证表 + 单一占位符感知解析器 + 14 项能力分档 + 统一取证链接注册表 + 向导与设置页共用 `IntegrationCard`）经核对代码后成立，规模与目标匹配，无需砍减范围。

**通过的前提条件（实现节点必须满足，否则不得合入）**：

1. **BFF 契约先行（RV2-01）**：集成写路径必须经 `protectedSettingsWrite(…, true)` 转发 `Origin`，并先把该助手扩到 `DELETE`；AC2-17 在 Electron 打包版与 dev 各验证一次。这是唯一会让整个特性「保存即 403」的缺陷。
2. **既有测试零改动保持绿（RV2-02/03/04）**：属性用带覆盖值 setter 的描述符；G15 的 4 个测试文件与 R1 的 `SetupWizard.test.tsx` 不改一行；占位符判据按收窄后的 7 条实现，且样例表含 `sk-test-…` 反例。迁移每个服务后立即跑这些文件。
3. **先接缝后实现（RV2-05）**：`_baseline_reader`、`async_session_factory`、autouse 隔离夹具在写任何解析器逻辑之前就位；AC2-1 必须在带真实 `.env` 的开发机上也稳定通过。
4. **探针诚实（RV2-06/09）**：TTS 探针走线程 + 自带超时 + `MOCK_MODE` 降级 + 发音人随资源 ID；ARK 的 `ok` 只说「Key 有效」。任何探针端点用真实 Key 验证失败，一律降级为 `unverifiable`，不得伪造 `ok`。
5. **取证链接与探针端点的线上核验（延续 v1 声明）**：所有 URL 与探针端点本轮评审同样**无法在线核实**（评审只读代码与文档，未联网、未运行任何测试）；实现节点须逐个人工核验并把日期、页面标题、是否需登录、回落写入 `link-audit.md`（§A 链接与探针，§B 运行期接线点清单）。
6. **桌面端手工走查（R1 遗留 + 本轮增补）**：`npm run build:dir` 的 §7.3 走查仍是强制验收项，不可由自动化测试替代。

**评审未能核实、需实现时确认的事项**：①各 dev 启动脚本是否注入 `RESEARCH_RENDERER_ORIGIN`（决定非 3000 端口 dev 服务器的写接口能否通过后端来源校验，RV2-01 注记）；②ASR 握手探针在鉴权失败时是 HTTP 握手阶段拒绝还是首帧后返回错误帧（不确定时按规格降级 `unverifiable`）；③ARK 列任务接口对「未开通模型」的 Key 的实际返回；④本评审未执行任何测试，所有「现有测试不受影响」的判断来自读代码与 grep。

---

## 实施过程发现的方案缺陷

> 记录实现阶段（第 2 轮 · 代码开发节点）对照代码与实跑结果发现的、v2 方案与现实不符之处。均已按「修正后的做法」落地，未静默偏离；每条注明证据。

| ID | 位置 | 方案原文 | 实际情况（证据） | 修正后的做法 |
|----|------|----------|------------------|--------------|
| IM2-01 | §3.5 BFF 契约 / §5.2 | 写请求「带 `Content-Type: application/json`」仅按 PUT 的 JSON 体描述 | 后端 `validate_ui_origin(write=True)` 对**无体的 DELETE 与 `POST /test`** 同样要求 JSON 内容类型，缺失返回 **415**（实测 `tests/test_integration_credentials.py::test_delete_without_a_json_content_type_is_rejected`）；BFF 侧 `researchOriginAllowed(write=true)` 缺内容类型则 403 | 前端客户端对 DELETE / test 也必须发 `Content-Type: application/json`（`{}` 体）；已书面告知前端实现，后端加了回归测试 |
| IM2-02 | §3.5 错误码映射 | `TTSServiceError.code` | 真实属性名是 **`error_code`**（`tts_errors.py:36`） | 映射表按 `error_code` 实现，逐码用例覆盖 13 个码 |
| IM2-03 | §3.12 / AC2-11（零秘密） | 日志「只记字段名」 | `aiosqlite` 在 DEBUG 级别会把 SQL **绑定参数（含明文 Key）** 写进日志（pytest `caplog` 实测命中金丝雀）；`LOG_LEVEL=DEBUG` 时 `model_providers` 的 Key 同样会落日志。SQLAlchemy 的异常消息同样内嵌参数 | `app/logger.py` 把 `aiosqlite` 与 `sqlalchemy.engine` 日志级别钉在 WARNING；凭证服务对 DB 异常只记**异常类型名**，对外抛 `IntegrationSaveFailed`（`from None`，不带原异常链） |
| IM2-04 | §3.3 / G15 / AC2-15 | 「4 个既有测试文件无需改动」「R1 全部既有测试保持绿，仅改两个补丁目标」 | 实际需要改动的既有测试共 **5 个文件、各 1–2 处**：①`test_audio_transcription_service.py::test_init_with_empty_creds_does_not_raise` 断言 `resource_id == ""`——`resource_id` 是 choice 字段，解析器恒回落到代码默认值，不可能为空；②`test_tts_router.py::test_convert_text_to_speech_empty_text` 与③`test_batch_tts.py`（2 个用例）靠**开发机真实 `.env` 里的 Key** 才能越过 `validate_config`——autouse 隔离（RV2-05）暴露了这一隐性环境依赖，违反 CLAUDE.md「测试不得依赖共享环境状态」；④`test_setup_status.py::test_clean_install_reports_every_capability_missing` 的 `== 6` 按 AC2-1 应为 14；⑤G14 的两个补丁目标文件 | ①改断言为默认值并注明原因；②③在用例/自动夹具里显式配置一个 Key（改 `settings`，不依赖 `.env`）；④改为 14；⑤按方案改。全部为测试夹具层面的最小改动，生产语义不变 |
| IM2-05 | §3.3 `credential_property` | 描述符 setter 作为「既有测试的合法接缝」 | 对描述符属性使用 `monkeypatch.setattr(service, "api_key", …)` 会在**还原时再调用 setter**，把旧值以覆盖值形式永久留在实例上，污染后续测试（单例 `tts_service` 尤其危险） | 在 `credential_property` 文档与 `test_integration_hot_reload.py` 中写明：新测试**一律改 `settings`/解析器**而不是给服务属性打补丁；既有的 `service.api_key = ''` 直接赋值写法（实例均为新建）不受影响 |
| IM2-06 | §3.4 稳定错误码 | 「路由层沿用各自既有的信封，仅追加 error_code」 | 各路由信封不一（`HTTPException`/`TTSErrorResponse`/`ErrorResponse`），逐路由追加会触碰大量调用路径；且多处路由的 `except Exception → 500` 会吞掉自定义异常 | 统一做法：`credential_errors.require_configured()` 在 **`try` 之外**、调用服务之前执行，应用级 handler 返回 **HTTP 409** 的 `ErrorResponse`（`error_code=credential_not_configured`，`error_details.integration_id`）。TTS / ASR 保留各自既有的 `TTS_CONFIG_MISSING` / `ASR_NOT_CONFIGURED` 信封，前端把这两个码视为 `volcano_tts` / `volcano_asr` 的别名 |
| IM2-07 | §3.2 choice 字段基线 | 「choice 字段默认值不算已填」 | `config.py` 对 `VOLCANO_TTS_RESOURCE_ID` 等恒有默认值，`settings.*` 永远非空，会把「环境基线 = 代码默认」误报成「环境变量」来源 | choice 的 env 值仅在**与代码默认不同**且在选项内时才计为 `environment`，否则来源记 `default` |
| IM2-08 | §3.6 链接清单 | 候选 URL 原样采用 | 实测（`curl -L`，2026-11-01）：`www.volcengine.com/docs/*` **301 → `docs.volcengine.com/docs/*`**；`console.anthropic.com/settings/keys` **301 → `platform.claude.com/settings/keys`**。详见 `link-audit.md` §A | 链接注册表与白名单改用规范主机（见 `link-audit.md`）；旧主机保留在白名单之外 |
| IM2-09 | §8 步骤 2 / G14 | 受影响的既有测试仅 G14/G15 | 全量后端回归（本机）另有 **44 个既有失败/错误**（`test_database`/`test_main`〔缺 `client` 夹具〕/`test_material_router`/`test_media_proxy`/`test_voice_config`/`test_video_search` 的 API 用例〔路由前缀 404〕等），在干净 `HEAD` 的临时 worktree 上**逐项复现，集合完全相同**，与本特性无关；`.baseline-check` 为既有 worktree，未触碰 | 不处理；在交付说明里列出以免误判为回归 |
| IM2-10 | §3.5 探针表 `volcano_asr` | 「握手 101 ok；401/403 invalid；资源未授权 `not_entitled`」，并说明不确定鉴权发生在握手还是首帧后 | 真机实测（`link-audit.md` §A.2）：**鉴权发生在握手阶段**；错误凭证 → 401 `load grant: requested grant not found`；**凭证正确但应用未开通所选识别资源 → 403 `requested resource not granted`**（开发机 `.env` 的凭证正是此情形）。若 403 一律判 `invalid_credentials`，会让「凭证对、只是没开通流式识别」的用户去重填 Token | `integration_probes._classify_asr_rejection` 读握手响应体（仅内部判断、不回显）：403 且含 `resource`+`not granted` → `not_entitled`，其余按状态码；两种真实响应体各有单测 |
| IM2-11 | §3.7 / §3.9（前端实现与方案的差异，来自前端实现的自述，已复核测试） | ①manual 模式下所有分组步骤都出现；②`skipOptional` 仅重新派生；③分组行状态取自 `capabilities` prop；④未配置出口仅 `ConfigureCta` | ①manual 模式只显示 `capability-status` 里**列出了其能力**的分组（真实后端恒返回 14 项，行为等同方案；否则 R1 的 6 项夹具 `wizardLogic.test.ts` 变红）；②`skipOptional` 把分组与 search 步骤关掉后重新派生，manual 模式同样适用；③分组行状态取自 `GET /api/integrations`（prop 在保存后有一拍滞后）；④没有 JSX 可挂按钮的位置（服务层 / hook / toast）新增 `reportCredentialMissing()` + `CredentialMissingListener`（弹确认 toast，同集成 4 秒内不重复），`ConfigureCta` 只用于 `ToolStep`；字幕识别错误原先存进 `subtitleErrors` 从未渲染，所以必须走 toast | 均已落地并有测试；未接线的 3 处（Agent 对话纯文本摘要、逐句 TTS 展示、故事板只轮询阶段）及原因见 `link-audit.md` §B |
| IM2-12 | §3.3 / §3.5 / §5.2 | `DELETE`、`POST …/test` 的 BFF 路径沿用「透传」 | `http.del` 默认**不发** `Content-Type`；BFF `researchOriginAllowed(write=true)` 会 403，后端 `validate_ui_origin` 会 415（IM2-01 的前端侧） | 前端客户端对 DELETE / test 显式带 `Content-Type: application/json`（`{}` 体），各有测试 |

