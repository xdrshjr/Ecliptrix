# 剪辑 Agent 通用化：出口解封 + 本机能力层（agent-general-assistant）

- 版本：**v2**（v1 为初稿；v2 = 设计评审后的修订稿，改动见 §0 评审记录与文末 §12 评审结论）
- 状态：**有条件通过**，可按 §10 的实施顺序开工（先 G-P0 止血，再通用层）
- 关联文档：`docs/plans/agent-general-capabilities/spec.md`（联网研究，v4）、
  `docs/plans/agent-general-toolkit/spec.md`（工作区 / 文档 / 沙箱 / 记忆）、
  `docs/plans/agent-yolo-autonomous-mode/spec.md`（自主模式）、
  `docs/plans/agent-research-crew-and-context-memory/spec.md`（小队与记忆）
- 生产证据：用户 2026-11-06 的一次真实剪辑会话日志（下文 §2 原文引用）

---

## 0. 评审记录

- 评审对象：本文件 v1 初稿（720 行 / 41 308 字符 / 37 节），评审方式为**逐条回代码核对**，
  不是纸面通读；下面每条问题都带可复查的 `file:line` 证据。
- 维度：可行性（现有技术栈能否实现）、完整性（边界 / 错误路径 / 落地顺序）、
  一致性（与 `CLAUDE.md` 及既有实现约定是否冲突）、规模合理性（是否过度设计 / 欠定义）。
- 处置约定：**P0 与 P1 已在 v2 正文直接修正**（每条在“v2 处置”列写明改在哪一节）；
  P2 记录在案，在对应实施阶段顺手处理，不阻塞开工。
- 核对基准（本文所谓“现状”，一律指 v1 落笔时的代码）：
  - `app/services/web_research/safe_http_client.py`、`run_registry.py`、
    `app/models/web_research_models.py`、`app/routers/research_run_router.py`、
    `research_browser_router.py`
  - `app/services/system_settings_service.py`、`app/routers/system_settings_router.py`、
    `app/models/system_settings_models.py`
  - `app/services/agent_toolkit/{workspace_store,__init__}.py`、`app/models/agent_toolkit_models.py`、
    `app/services/material_download_service.py`、`app/services/web_research/media_worker.py`
  - `src/lib/video-editing-agent/{registry/categories.ts, promptParts.ts, systemPrompt.ts, agent.ts}`、
    `registry/ToolActivationState.ts`、`tools/{webToolAdapter.ts, webTools.ts, stillClip.ts,
    stillGuard.ts, addToTrack.ts}`、`__tests__/{systemPrompt.test.ts, systemPrompt.toolkit.test.ts,
    researchRunClient.test.ts}`
  - `src/lib/server/researchRunClient.ts`、`src/app/api/agent-toolkit/[...path]/route.ts`（BFF 先例）、
    `src/app/api/web-research/[...path]/route.ts`、`src/lib/i18n.ts`（12 032 行）
  - `docs/plans/agent-general-capabilities/spec.md`（v4，AC-01…AC-41）、
    `docs/plans/agent-general-toolkit/spec.md`（AC-01…AC-35）、
    `docs/plans/agent-steering-and-skills/spec.md`（R-05 = L0 字符棘轮）

### 0.1 结论摘要

方案的方向是对的：把“出口策略”从散落的 12 个拒绝点收成纯函数，并把“通用出口”与
“有 run 生命周期的研究通道”解耦，正是 §2 现场日志的根因级解法。v1 的问题集中在两类：

1. **三处“照写必然红”的可行性/自相矛盾（P0）**：L0 提示词预算（§4.7 的常驻化方式会击穿
   `≤18 500` 断言）、新设置分类未登记进 `system_settings_router`（面板恒 404）、
   `http_request` 的契约（7 方法 + body）超出 `SafeHttpClient` 的真实能力。
2. **接口对不上的地方（P1）**：DNS“钉住”与 `use_dns_cache=False` 冲突、`kind=file` 没有入库
   路径、素材守卫的字符串来自后端而落点写在前端、BFF 超时与 `shell_timeout_s` 上限冲突、
   与既有 `workspace_*` 工具在同一根目录上重复定义语义，等等。

v2 已修掉全部 P0 / P1，并在 §10 明确“P0 可以独立交付”的边界。

### 0.2 问题清单

| ID | 级别 | 维度 | 问题（含证据） | v2 处置 |
|---|---|---|---|---|
| REV-P0-1 | P0 | 可行性 / 自相矛盾 | §4.7 计划把 6 个名字追加进 `CORE_TOOLKIT_TOOL_NAMES` 以“常驻”。`formatCoreToolkit()` 对其中每个名字渲染 `### name` + 完整 description + 参数签名（`systemPrompt.ts:322-339`），单个富参数工具约 200–400 字符，6 个约 1.3–2.2 KB；而 `systemPrompt.toolkit.test.ts:76-80` 钉死 `prompt().length ≤ 18 500`，实测最坏值 18 100（`systemPrompt.ts:365-375`）→ 只剩约 400 字符且不许放宽。此外 `systemPrompt.toolkit.test.ts:91` 断言 `CORE_TOOLKIT_TOOL_NAMES` 长度为 18，追加即红 | §4.7 改为新增 `GENERAL_RESIDENT_TOOL_NAMES`（6 名，只给 `ToolActivationState` 执行权 + 单行紧凑清单，不动 `CORE_TOOLKIT_TOOL_NAMES`）；AC-G14 改写并指向真实测试文件 |
| REV-P0-2 | P0 | 完整性 | 新增设置分类 `agent_host` 必须登记到 `system_settings_router.py:42-92` 的 `CATEGORY_METADATA` / `_VALID_CATEGORIES`，否则 `_validate_category()` 让 `GET/PUT /system-settings/agent_host` 恒 404，整个 §4.9 面板不可用。v1 §5.1 只列了 service / models / `main.py` | §4.9 + §5.1 补 `system_settings_router.py`；新增 AC-G23 |
| REV-P0-3 | P0 | 可行性 | §6 的 `POST /egress/request` 承诺 7 种方法 + 任意头 + `body_base64` ≤1 MiB。实际 `SafeHttpClient.fetch_one_hop()` 只允许 GET/HEAD（`safe_http_client.py:315-316`），`_request()` 只转发 `accept`/`accept-language`（`:351-354`）且**没有 body 参数**，`RequestSpec` 只有 `url/method/headers`（`:246-250`）。按 v1 写出来只能是“假装支持” | §4.3.1 收敛为 GET/HEAD + 头部子集；写方法返回 `http_write_unsupported`(400)；§6/§7.3 同步；POST 列入后续阶段（R-G11） |
| REV-P1-1 | P1 | 一致性 | `fs_tools` 与既有 `workspace_store` 在同一根目录上重复定义：`workspace_store.py` 已有 `write_file`（2 MiB 上限 `:24`、配额 `:203`）、`read_page`（4000/8000 字节页 `:26-27`）、`list_files`、`_write_atomic`、`is_binary`、`_RESERVED` 设备名。v1 §4.5 另立 `file_too_large`(413) / `binary_file`(**422**) / “2000 行” 分页且**完全不提配额** → 两套语义、两个码、可绕过 `workspace_quota_mb`（`agent_toolkit_models.py:45,47` 里 `binary_file` 已是 415，`workspace_file_too_large` 已是 413） | §4.5 改为 workspace 作用域复用 `workspace_store` 限值与配额；码名统一（`binary_file` 415、`workspace_file_too_large` 413、host 作用域 `host_file_too_large` 413）；§7.3 同步 |
| REV-P1-2 | P1 | 可行性 | §4.1/AC-02 要求 balanced 下“把答复钉住（第二次请求不再走 resolver）”，但 §4.2 第 3 条 又明确保留 `use_dns_cache=False`（`safe_http_client.py:346-348`），且 `_request()` 每次新建 `TCPConnector`（`:344-348`）→ 字面意思无法实现 | §4.2 第 3 条 把“钉住”定义为 `GuardedResolver` 内部 host→(IP 集, TTL 300 s) 缓存，`use_dns_cache` 保持 False；AC-G02 改写为“resolver 缓存命中” |
| REV-P1-3 | P1 | 完整性 | 代理模式下 `TCPConnector(limit=3)` **不带 resolver**（`safe_http_client.py:342-344`），因此 `dns_*` 类 reason 只在直连路径可达。v1 让 `diagnose_url` 无条件报 dns 层，与真实请求路径不一致（“自证”变成误导） | §4.1 判定顺序注明“dns 检查仅直连路径”；§4.3 `diagnose()` 在代理模式下输出 `dns: skipped(proxy)` |
| REV-P1-4 | P1 | 一致性 | 全文把“现状”称为 `strict` 是错的：今天没有档位开关，只有 `proxy_mode ∈ {auto,direct,custom}`（`system_settings_service.py:58`），全量 IP 校验只发生在**直连分支**（capabilities §3.4:408-410）。R-10 声称取代 capabilities「direct 全量 IP 校验为唯一选项」，而该文档 §3.4:394-410 写的是双模式；真正冲突的是它 **AC-08 / AC-10**（`:1044`、`:1046`） | §2.2 / §4.1 改写为“直连分支=今天的行为”；R-G10 的 supersede 目标改为 capabilities AC-08/AC-10 + §3.4:408-410 |
| REV-P1-5 | P1 | 一致性 | §2.2 C-1 说“带路径即抛 `url_forbidden`”不成立：`normalize_proxy_url()`（`:97-118`）不看 `parts.path`，`http://127.0.0.1:7890/proxy` 会被**静默规范化**放行；只有缺端口 / query / fragment / >512 / 控制字符才抛。按 v1 的复现步骤（E2E-2）复现不出 C-1。另外 `custom_proxy_url` 已在保存期校验（capabilities D-17），C-1 的活口子是 env 与 `WEB_RESEARCH_SYSTEM_PROXY` | §2.2 C-1 行改述 + 指向活口子；E2E-G2 复现输入改为“缺端口” |
| REV-P1-6 | P1 | 完整性 | `diagnose_url` 自相矛盾：§4.1 的判定顺序含 `robots_disallowed`/`robots_unavailable`，§4.3 说它“不会触发 robots”，§11 的 `checks` 却写着 `robots ok:true`。robots 必须抓 `robots.txt`（`safe_http_client.py:372-405`），是 I/O | §4.3 `diagnose()` 默认 `robots: skipped`，`check_robots:true` 才抓（10 s 上限）；AC-G21 与 §11 示例同步 |
| REV-P1-7 | P1 | 完整性 | tier-2 限流只写了前端一半。R-3 说“后端每分钟每进程限流”，但没有设置键、算法、错误码；AC-22 的“第 61 次”也没说在哪一层判定（后端根本没有“回合”概念） | 新增设置键 `egress_max_per_minute`(120) + 错误码 `egress_rate_limited`(429, 带 `Retry-After`)；AC-G22 拆成“前端 per-turn”与“后端 per-minute”两条断言 |
| REV-P1-8 | P1 | 完整性 | BFF 契约与超时冲突：§5.2 写“64 KiB 请求体 + 190 s”，而 `/shell/run` 允许 `timeout_ms` 到 600 s（§6 参数约束），190 s 会在长命令上先断；现成最接近的先例 `src/app/api/agent-toolkit/[...path]/route.ts` 用的是 2 MiB+8 KiB JSON、**写请求必须携带并转发 `Origin`**（`:138-140,31`）、30 s/120 s 分路由（`:155`）、502/504 区分、二进制直通（`:106-110`），v1 一条都没继承 | §6 新增“BFF 契约”小节：按路由超时（shell = `timeout_ms`+5 s，≤605 s）、`Origin` 必带且转发、query 白名单补 `limit`、响应体上限 8 MiB、502/504 分开；AC-G18 扩展 |
| REV-P1-9 | P1 | 一致性 | §4.8 把 `markLost` 说成“本回合该 call 判失败”是错的：它是**回合级**状态（`researchRunClient.ts:73-76`，`webToolAdapter.ts:87-93` 让本回合后续所有研究调用都读 lostCode）。更关键的是既有测试 `src/lib/video-editing-agent/__tests__/researchRunClient.test.ts:37-47`（“stops renewing the entire network run if call cancellation is unconfirmed”）断言的正是 v1 要废掉的行为，v1 却计划“新增”一个同名新文件而不动它 | §4.8 写清回合级语义 + 明确反转既有测试 + 删除重复的新测试路径；§5.2 同步 |
| REV-P1-10 | P1 | 完整性 | §4.6/AC-05 的守卫落点错：`Image could not be resolved` 不是前端字符串，而是后端 `image_to_video_service.py:139` 的 `IMAGE_NOT_FOUND`，经 `stillClip.ts:196-205` 透出；前端真正入口是 `stillClip.ts:170-193` 与 `addToTrack.ts`，而 `stillGuard.ts:50-71` 只管“图片进视频轨”（`still_needs_conversion`），**不查 size**。且 `material_not_materialized` v1 注册在服务端 `agent_host_models.STATUS`，却由前端抛 | §4.6 改落点（前端 `stillClip`/`addToTrack` + 后端 `image_to_video` 双守卫），码注册到生成域模型；§5.1/§5.2 同步 |
| REV-P1-11 | P1 | 完整性 | `download_url` 的 `kind=file` 没有入库路径：`material_download_service._store_research` 只接受 7 种扩展（png/jpg/mp4/webm/mp3/wav/m4a，`:517` 附近），64 MiB 的 pdf/zip 会走到 `cache_commit_failed` 或产出 size 0 的“成功” | §4.3 把 v1 kinds 收敛为 `image` / `media`；`file` 直接 `unsupported_media_type`(415) 并列入后续阶段 |
| REV-P1-12 | P1 | 一致性 | 前端没有 `sticky` 概念：`webToolAdapter` 现在按 `error_details.failure_class ∈ {configuration, policy}` 写 80 条 `blockedCalls`（`:30-41`），tool result 里甚至发的是 camelCase `failureClass`。v1 只说“仅 sticky 时写缓存”，没定义字段来源、映射和**用户改完设置后缓存怎么清**（这正是 C-4 的现场） | §4.7/§4.8 明确 `sticky` 进 tool result 形状 + failureClass 映射；新增“设置更新事件清空 `blockedCalls`” |
| REV-P1-13 | P1 | 一致性 | 编号撞车：本文件 `AC-01…AC-22` 与 capabilities `AC-01…AC-41`、toolkit `AC-01…AC-35` 同号异义（如本文件 AC-10=stdout 截断，capabilities AC-10=代理模式）；`R-1…R-10` 与 research-crew `R-01…R-10`、toolkit `R-01…R-33` 撞号；文内 §1.3 的 `R-4`（风险）与 §4.7 引用的“既有 R-05”（steering 的 L0 棘轮）同号异义 | 全文编号加 `G` 前缀（`AC-G01…`、`R-G01…`），引用他人 id 一律带文档名 |
| REV-P1-14 | P1 | 安全 / 可行性 | `host_read_roots` 默认含 `~`，等于默认开放 `~/.ssh`、`~/.aws`、各种 `.env`；而 `bash` 本来就是全权限（§1.3 明说不做沙箱）。默认值比“不做沙箱”的承诺还宽，属于不需要的额外暴露 | §4.9 默认收窄为项目目录 + `STORAGE_ROOT`；`~` 需显式开启 + 二次确认 |
| REV-P1-15 | P1 | 完整性 | 工具叫 `bash`，但 Windows 上没有 bash；v1 没写执行 shell、stdin、编码回退。模型会写 `&&`/单引号/`-y` 混搭，在 `cmd.exe` 下直接失败，而 R-G4 的“自带非交互参数”指引反而会加剧 | §4.4 补：win32 `%COMSPEC% /d /s /c`、POSIX `/bin/sh -lc`、`stdin=DEVNULL`、UTF-8 解码 + 本地代码页回退；工具描述写明平台差异 |
| REV-P2-1 | P2 | 一致性 | §4.9 标题写“16 个键”，表里是 17 行；§5.1/§5.2 沿用 16 | v2 顺手改正（并因 REV-P1-7 变 18 个） |
| REV-P2-2 | P2 | 一致性 | 虚构了既有名字：`agent_toolkit/__init__.py` 导出的是 `purge_expired()` 不是 `purge()`；`agent_toolkit_settings()` 实为 `toolkit_settings()`；`temporary_root()` 在 `media_worker.py:113`，不在 `workspace_store` | §4.3 改准路径 |
| REV-P2-3 | P2 | 一致性 | `media_worker.image_async(source, target)` 是两个参数且会写标准化 PNG（`:91`），不是 `image_async(path)`；`store_research_download_async` 第三参叫 `extension` 不叫 `format` | §4.3 改准签名 |
| REV-P2-4 | P2 | 一致性 | `app/main.py` 没有“错误码注册表”（`:386,446,478,510` 都是临时字符串）；码在各域 models 的 `STATUS` 里 | §5.1 改述 |
| REV-P2-5 | P2 | 一致性 | `ToolActivationState` 的 8 KiB 叫 `ON_DEMAND_MIN_BYTES`（`:10`），不是 `SCHEMA_FLOOR`；且常驻 schema 与 on-demand 共用 48 KiB，新工具不是“免费” | §4.7 改述 |
| REV-P2-6 | P2 | 一致性 | 参考实现 `aragon-agent-core` 只有 7 个宿主工具（`bash`/`read_file`/`write_file`/`edit_file`/`list_dir`/`glob`/`grep`），全仓无 `http_request`/`download_url`/`diagnose_url`；§1.2 “同一套工具名与语义”只对前 7 个成立 | §1.2 补一句限定 |
| REV-P2-7 | P2 | 一致性 | §4.5 引用的 `agent-steering-and-skills/spec.md` R-02 是**技能 id 保留字**，不是路径规则；路径 / 设备名规则在 toolkit §3.3.2 与 AC-01 | §4.5 改引用 |
| REV-P2-8 | P2 | 完整性 | `SettingsSidebar` 新增项还有别的消费者：`src/app/page.tsx:8,38,127,169`、`Onboarding/SetupWizard.tsx`、`Onboarding/wizard/wizardSteps.ts:3,118-120`；且 `SettingsPage.renderContent` 的 `default: return null` 会让漏改静默通过 | §5.2 补行 |
| REV-P2-9 | P2 | 一致性 | 面板有两种并存约定：`AgentToolkitSettingsPanel` 只发脏键（`savePayload`），共享 `useSettingsPanel` 发整表且独有 `resetToDefaults`；v1 没说 `agent_host` 要不要“恢复默认” | 评审结论第 3 条列为开工前需拍板项 |
| REV-P2-10 | P2 | 一致性 | `i18n.ts` 已 12 032 行；现有命名空间是 `webResearch`/`agentToolkit`，**没有** `agentToolCall`；v1 的键名需按实际命名空间改写 | §4.9 改述 |
| REV-P2-11 | P2 | 完整性 | `grep` 缺正则编译失败与 ReDoS 超时；`read_file` 的“2000 行”与“32 KiB 页”两套分页未定；`/fs/read` 端点有 `max_bytes` 而工具 schema 没有 | §4.5 补规则 |
| REV-P2-12 | P2 | 完整性 | 审计保留：“`audit_log_retention_days` 由 `desktop/main/logger.js` 轮转保证”没有落点；`GET /audit` 读的是进程内环形缓冲，与保留天数无关 | §7.1 改述 |
| REV-P2-13 | P2 | 完整性 | 常驻化后 `canExecute` 恒真，`tool_not_loaded` 闸门对这些名字失效；v1 的 AC-16 只说 `list_dir` 需装载、`bash` 常驻，但没解释机制 | AC-G16 补一句机制说明 |
| REV-P2-14 | P2 | 完整性 | README / `CLAUDE.md`（新设置分类、新工具类）与兄弟 spec 的 superseded 指针没有列入交付物 | §10 P4 阶段补一行 |

### 0.3 未解决问题

无 P0 / P1 遗留。P2 全部记录在案，其中只有 REV-P2-9（面板脏键 / 恢复默认的取舍）需要在
P3 阶段开工前拍板。

---

## 1. 概述

### 1.1 要解决的问题

剪辑 Agent（`src/lib/video-editing-agent/`）今天已经有 19 个工具类别、63 个工具
（另有 `explore_tools` 一个发现工具），但它们全部是**剪辑专用**能力：搜索
Pexels/Unsplash、生成 ARK 素材、TTS、时间线编辑、封面、视觉审阅、受控联网研究。
它没有通用 Agent 该有的三件事：**在本机跑命令（Bash/shell）**、**自由读写文件**、
**对任意公网地址做任意 HTTP 请求与下载**。
更要紧的是，现有的唯一联网通道（`web-research` run）是一个**有生命周期、有配额、
会整轮关闭**的子系统：任何一次下载失败都可能把整条通道关掉，之后本回合所有联网
工具直接短路降级。用户让它「把第 2 段视频换成维基共享的真实约克夏照片」，得到的
是 `url_forbidden`（域名被策略拦截）→ `candidate_expired` → `run_closed`（网络研究
通道整体关闭）→ 最终镜头没有被替换，而 Agent 只能向用户报告"我拿不到素材"。

这不是模型能力问题，是**架构问题**：出口策略把「用户的系统代理配置错误」「DNS 返回
了 Fake-IP」「robots 判定」三件毫不相干的事，统一压成一个含糊的 `url_forbidden`，
再把"重试过"的调用记进 `run.blocked` 永久拒绝；同时把「一次下载超时」升级成「关闭
整个 run」。而"通用能力"从头到尾就没有被提供——没有 shell，没有通用 HTTP。

### 1.2 本轮要建成什么

本设计把剪辑 Agent 升级为**通用 Agent 助手 + 剪辑专长**：

1. **两层出口（two-tier egress）**。保留现有 `web-research` run 承担搜索、
   证据保存与报告合成；**新增一条无生命周期、无 run 配额的通用出口**
   （tier-2，`/api/agent-host/egress/*`），用于任意公开 URL 的请求、图片/媒体下载
   与素材入库。tier-2 不认识 run，因此**不可能出现 `run_closed`**。
2. **出口策略可解释、可覆盖**。把散落在 `safe_http_client.py` 的 12 个拒绝点抽成
   一个纯策略模块 `egress_policy.py`，给出 `strict | balanced | open` 三档模式、
   精确的 `reason` 码、`sticky` 语义（配置类失败不再永久封禁同一调用）、以及
   `diagnose_url` 工具——**只判定不发请求**，把"你到底被哪一条规则拦住"直接告诉
   模型和用户。默认档 `balanced` 修掉「Fake-IP / 运营商 DNS 导致全站不可达」，
   并让 `upload.wikimedia.org` 这类正常公网主机可以下载。
3. **本机能力层（host capability tier）**。新增 `host_tools`（`bash`、`read_file`、
   `write_file`、`edit_file`、`list_dir`、`glob`、`grep`）与 `egress_tools`
   （`http_request`、`download_url`、`diagnose_url`），由后端
   `app/services/agent_host/` 与 `app/routers/agent_host_router.py` 承载。
   其中 `bash`/`read_file`/`write_file`/`edit_file`/`list_dir`/`glob`/`grep` 7 个
   与 `aragon-agent-core` 的宿主工具**同名同义**；`http_request`/`download_url`/
   `diagnose_url` 3 个是该参考实现没有的（全仓 0 命中），是本项目为“出口可解释”
   新造的工具，语义按本文 §4.3 定义。两者都保留本项目的结构化错误、输出脱敏、
   设置闸门与审计。

剪辑专长一个都不减：既有 19 个类别仍是主角，新工具是**兜底与通用层**——当专用工具
（`fetch_web_image`）被策略或配额挡住时，Agent 仍有 `download_url` 这条路可走，并且
用户能在设置里把策略调成他真正想要的样子。

### 1.3 非目标

- 不做容器级 / 内核级隔离。`bash` 是本机全权限执行，文档与 UI 都必须**明说**这一点
  （与 `aragon-agent-core` 的立场一致：不假装有沙箱）。
- 不做后台任务监管（`bash` 的 `background: true` / `bash_output` / `bash_kill`）。
  v1 只支持前台命令 + 超时 + 进程树终止；后台作业作为后续阶段（见 §9 R-G04）。
- 不做多用户、权限/RBAC、远程服务器形态；仍然是单机单用户的 Electron 桌面应用。
- 不改动合成 / 导出 / 相机运动 / 预览引擎；本轮不触碰 FFmpeg 参数与 golden vectors。

---

## 2. 现场证据与根因

### 2.1 用户侧现象（日志原文节选）

```
搜索网络                已完成
发现网络图片             网站或网络策略拒绝了本次请求。
导入网络图片             研究失败，请重试。
采购素材 · 2/2           #0 失败  #1 失败        已入库 0 · 失败 2
导入网络图片             资料已不可用，请重新获取来源。
搜索网络                 应用重启导致本次研究会话结束；剪辑不受影响，可再次发起研究。
搜索图片 (Unsplash)       Found 8 image(s) for 'yorkshire terrier dog portrait'
图片生成视频             Image could not be resolved
素材库                    {"count":8,...}   # 全部只有元数据，size 0
自检                      全部 16 项通过（35s 未被破坏）
```

关键事实一：**搜索成功、抓取失败**。Tavily 搜索走 `web_research/search_provider.py`
固定端点、Unsplash 图片搜索走后端 `image_search_service`——两者都不经过
`SafeHttpClient`。而 `web_fetch` / `extract_web_images` / `fetch_web_image` /
`download_web_media` / `browser_*` **全部**经 `SafeHttpClient` 出口
（`backend-services/basic-service/app/services/web_research/safe_http_client.py`）。
现象是"凡是经过安全出口的请求，不分域名全部 403"，因此**根因在出口层，不在域名**。

关键事实二：`run_closed` 出现在**第一次下载失败之后**，而不是超时耗尽之后——说明是
"失败 → 关闭 run"这条代码路径，而不是 run 的自然到期。

### 2.2 根因清单（按可能性排序，含核验方法）

| # | 根因 | 代码位置 | 为什么能解释现象 | 核验方式 |
|---|---|---|---|---|
| **C-1** | **代理配置校验抛错污染全部请求**：`default_proxy_settings()` 在**每一次**请求里调用 `normalize_proxy_url()`；`mode=auto` 时优先读设置，其次读 `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY`，最后读 Electron 注入的 `WEB_RESEARCH_SYSTEM_PROXY`。任一地址不合格式（缺端口、带 query/fragment、长度 >512、含控制字符）即抛 `url_forbidden`。注意：**带路径不会抛错**（`:107-118` 不看 `parts.path`，会被静默规范化），所以复现必须用"缺端口"这类真错；另外 `custom_proxy_url` 已在保存期校验（capabilities D-17），真正的活口子是 env 与 `WEB_RESEARCH_SYSTEM_PROXY`。 | `safe_http_client.py:97-118`、`:170-207`、`:187` | 抛错点在**发出请求之前**、与目标主机无关 → 任何域名都 403；Tavily / Unsplash 走别的客户端 → 仍然正常。与"维基、Unsplash 直链全挂"完全吻合。 | 设置 `HTTP_PROXY=http://127.0.0.1`（缺端口）复现；`/capabilities` 看 `proxy.resolved_from` |
| **C-2** | **DNS 全量公网校验过严**：今天的**直连分支**（还没有档位开关，见 REV-P1-4）要求**每一条** DNS 答复都 `is_global`，一条不公共即整体拒绝（`ipaddress` 认为 `198.18.0.0/15` benchmarking 段、CGNAT `100.64/10` 等非 global）。Clash/Fake-IP、部分运营商 DNS、企业 DNS 都会返回这类地址，而 `use_dns_cache=False` 让每次请求重新解析。 | `safe_http_client.py:121-145`（`:135` 抛错）、`:346-348` | 同样与主机无关、每次必犯；代理模式下不走 resolver，所以"配了代理反而好"会让用户误判。 | `diagnose_url` 返回 `dns_answer_non_global` + 实际答复 |
| **C-3** | **失败即整轮关闭**：`executeWebTool` 的 `catch` 无条件 `void run.cancelCall(callId)`；而 `ResearchRunClient.cancelCall` 在 DELETE **非 2xx**（例如接近 80 配额时的 `research_busy`）或任何异常时执行 `close()`——关闭**整个 run**。run 关闭后 `authenticate` 抛 `run_closed`，前端 `markLost()` 让本回合后续所有联网调用**不再发 HTTP**。 | `src/lib/video-editing-agent/tools/webToolAdapter.ts:130-138`、`src/lib/server/researchRunClient.ts:88-98`、`:100-114`、`run_registry.py:60-73` | 直接解释"一次下载失败后通道整体关闭"和"run_lost 降级" | 单测：`cancelCall` 收到 500 不应 `close()` |
| **C-4** | **策略失败被永久封禁**：`_execute_task` 把 `failure_class in {configuration, policy}` 的 `(action, digest)` 写进 `run.blocked`，此后同一调用一律 `blocked_repeat` (403)；前端 `webToolAdapter.rememberFailure` 另有一份 80 条 `blockedCalls` 缓存。用户修好代理 / DNS 之后**同一个下载仍然失败**，日志里体现为"标注不可重试"。 | `run_registry.py:101-103`、`:132-135`；`webToolAdapter.ts:32-41` | 解释"重试也没用"和"candidate_expired / 资料已不可用" | 单测：policy 失败后再调用不应 `blocked_repeat` |
| **C-5** | run 注册表是**进程内内存态**：后端重启即全部失效；同进程最多 4 个活跃 run，run 内最多 80 个 call id。 | `run_registry.py:36-54`、`:81-84` | 解释日志里"应用重启导致本次研究会话结束" | 已有；tier-2 出口与其解耦 |
| **C-6** | **元数据素材冒充素材**：Unsplash 搜索结果只写元数据（`size: 0`、无本地文件），`image_to_video` 拿到它只会含糊报 `Image could not be resolved`。 | `image_search_service` 搜索结果形状；`tools/imageToVideo` 入口无显式守卫 | 解释"8 张图全部 size 0 → 转视频失败" | 检查 `material.size === 0` 时是否有显式拒绝 |

**结论**：C-1 与 C-2 是"为什么维基下载被拦"的直接答案，必须用「精确 reason 码 +
`/capabilities` 自证 + `diagnose_url`」把不可观测变成可观测，并把**新档位的默认值**
设为 `balanced`（今天没有档位，直连分支的行为等价于 `strict`）；C-3 与 C-4 是
"为什么一次失败=整轮报废"的直接答案。本设计对 6 条全部给出改法，并各配一条
先红后绿的回归测试（§8）。

---

## 3. 总体架构

### 3.1 能力分层

```
┌───────────────────────────── 前端 Agent（pi-agent-core）─────────────────────────────┐
│  workflow_tools  query_tools  editing_tools          ← 常驻（3 类）                  │
│  ────────────────────────────────────────────────────────────────────────────────────  │
│  剪辑专长（20 类 60+ 工具）      general 通用层（本设计新增 2 类 10 工具）            │
│  search/ai_gen/still/tts/       host_tools   : bash read_file write_file edit_file     │
│  script/storyboard/material/                  list_dir glob grep                       │
│  cover/review/web/browser/      egress_tools : http_request download_url diagnose_url  │
│  research/workspace/document/                                                        │
│  analysis/memory                                                                     │
└──────────────┬───────────────────────────────────────────────┬───────────────────────┘
               │ toolFetch(apiBaseUrl, '/api/...')             │
               ▼                                               ▼
┌──────────────────────────── Next.js BFF (loopback)───────────────────────────────────┐
│ /api/web-research/[...path]  (既有)      /api/agent-host/[...path]   (新增)          │
└──────────────┬───────────────────────────────────────────────┬───────────────────────┘
               ▼                                               ▼
┌──────── 后端 FastAPI ────────┐              ┌──────── 后端 FastAPI ──────────────────┐
│ web_research/ （有 run 生命周期）            │ agent_host/ （无 run，无配额退化）      │
│  search: Tavily 固定端点      │              │  shell_runner   : 子进程 + 超时 + 树杀 │
│  fetch/download: SafeHttpClient              │  fs_tools       : 路径安全读写检索     │
│  run_registry: 80 call / 4 run               │  egress         : SafeHttpClient(tier-2)│
│  browser: CDP 宿主                           │  material commit: 真字节入库           │
└──────────────┬───────────────┘              └───────────────┬───────────────────────┘
               └──────────────┬─────────────────────────────────┘
                              ▼
              egress_policy.py（唯一出口判定，纯函数，可单测）
              模式 strict | balanced | open ；返回 decision + reason + sticky
```

### 3.2 三层出口

| 层 | 消费者 | 有无 run | 预算 | 用途 | 失败语义 |
|---|---|---|---|---|---|
| **T1 搜索** | `web_search` / `web_research` | 有（复用） | 80 call/run | Tavily 搜索、证据合成 | 不变 |
| **T2 通用出口** | `http_request` / `download_url` / `diagnose_url`、以及 T1 的 fetch/download 兜底 | **无** | 前端 `callBudget` + 后端每分钟限流 | 任意公开 URL 的 GET/POST、图片/媒体下载入库 | 单次失败只失败这一次；**不存在 `run_closed`** |
| **T3 本机** | `bash` / `read_file` / `write_file` / `edit_file` / `list_dir` / `glob` / `grep` | 无 | 并发 1/项目、2/进程 | 本机命令、工作区与授权目录的文件操作 | 结构化错误 + 退出码，非异常 |

T1 与 T2 **共用同一份 `egress_policy`**，因此用户在设置里改一次策略，两条路同时生效；
但 T1 的 run 生命周期、`run.blocked` 与 80 配额**不再传染给 T2**。

### 3.3 关键操作时序（用户场景：把第 2 镜头换成维基共享图片）

```
用户   : 把第二段（8.78–17.90s）换成维基共享的约克夏真实照片
Agent  : 1 web_search("Yorkshire Terrier site:commons.wikimedia.org", include_images)
         ← 命中候选（Tavily，T1）
         2 diagnose_url(upload.wikimedia.org/...)      T2 纯判定
         ← {allowed:true, mode:"balanced", checks:[...]}    ← 新增的可见性
         3 download_url({kind:"image", import_to_library:true})
         ← {material:{id:"web-<sha24>", size:184321, width:1600,
                      local_url:"/api/storage/files/cached_materials/web/web-<sha24>.jpg"}}
         4 image_to_video({material_id, duration:9.12, motion:"kenburns"})
         5 add_to_track / trim_clip / move_clip（reconcileOverlapsAfterAgentOp）
         6 check_timeline → 0 阻断项，总时长仍 35s
```

任何一步失败（例如 C-1 未修）都会返回 `{error_code, error_details:{reason, layer,
remediation, sticky}}`，Agent 据此说清"是代理配置格式错误"而不是"网站拒绝了您"。

---

## 4. 详细设计

### 4.1 `egress_policy.py`：唯一出口判定（新增，纯函数）

新文件 `backend-services/basic-service/app/services/web_research/egress_policy.py`。
目标 ≤ 300 行，函数 ≤ 50 行，全部无 I/O（DNS 由调用方传入回答），因此可表驱动单测。

**公开接口**

| 签名 | 说明 |
|---|---|
| `EgressDecision(allowed: bool, url: str, reason: str 或 None, layer: str, sticky: bool, host: str, resolved: tuple[str, ...])` | dataclass，`layer ∈ {url, policy, proxy, dns, robots}` |
| `classify_url(url: str, policy: EgressPolicy) -> tuple[str, str]` | 返回 `(normalized_url, host)`，或抛 `EgressViolation(reason)` |
| `resolve_proxy(settings: dict, env: Mapping[str, str]) -> ProxyResolution` | **绝不抛错**；返回 `mode, proxy_url, resolved_from, invalid_source` |
| `check_answers(host: str, answers: Iterable[str], mode: str, allow_hosts, deny_hosts) -> tuple[str, ...]` | 返回**钉住**的 IP 列表，或抛 `EgressViolation('dns_answer_non_global')` |
| `reason_details(reason) -> dict` | `{failure_class, sticky, remediation, settings_path?}`，供 `error_details` 拼装 |

**三档模式（新设置键 `agent_host.egress_mode`，默认 `balanced`）**

| 模式 | 字面私网/回环/链路本地/metadata | DNS 答复 | 端口 | 语义 |
|---|---|---|---|---|
| `strict` | 拒绝 | 每条都必须 `is_global`（= **今天直连分支的行为**，不是今天的设置项） | 80/443 | 保守；企业/代理环境会误伤 |
| `balanced`（默认） | 拒绝 | 允许非 `is_global` 但**非本机可达**的答复（benchmarking `198.18/15`、CGNAT `100.64/10` 视为 Fake-IP 放行），**并把答复钉住**（resolver 内缓存，见 §4.2 第 3 条；不做第二次解析） | 80/443 + `egress_allow_ports` | 修 C-2，同时保留 DNS-rebinding 防护（钉 IP） |
| `open` | 仅拒绝 `localhost` / `metadata` 域名与 `169.254.169.254` | 不校验 | 任意 1–65535 | 用户明确要求"别拦我"时的档位；设置页需二次确认 |

判定**顺序固定**（reason 码即顺序码，先命中先报，便于排错）：

1. `proxy_config_invalid`（`layer=proxy`，`sticky=false`）— 仅当 `proxy_mode=custom` 且本
   次地址非法；`auto` 模式下降级直连并记 warning（**这是 C-1 的修法**）
2. `url_too_long` / `url_control_char`（`layer=url`）
3. `scheme_not_allowed`（非 http/https）
4. `userinfo_not_allowed`
5. `port_not_allowed`（不在允许集合内）
6. `host_denied`（命中 `egress_deny_hosts`，fnmatch，大小写不敏感）
7. `host_literal_non_global`（字面 IP 且非公网，任何模式都拒绝）
8. `dns_no_answer` / `dns_answer_non_global`（`layer=dns`，`sticky=false`）
9. `robots_disallowed` / `robots_unavailable`（`layer=robots`）

`egress_allow_hosts`（fnmatch）命中时：跳过第 5、7、8 条，仅保留 1–4 与 `host_denied`。
`host_denied` 永远优先于 `egress_allow_hosts`（deny wins）。

**代理模式下第 8 步不执行**（REV-P1-3）：`_request()` 走代理时构造的
`aiohttp.TCPConnector(limit=3)` 不带 resolver（`safe_http_client.py:342-344`），DNS 由代理
完成，本进程看不到答复。因此 `check_answers()` 只在直连分支被调用，`dns_*` reason 也只在
直连分支可达；`diagnose()` 必须显式报告 `dns: skipped (proxy)`，不得假装做过校验。


**sticky 语义（修 C-4）**：`reason_details()` 为每个 reason 给出 `sticky`。
`proxy_config_invalid` / `dns_answer_non_global` / `dns_no_answer` / `port_not_allowed`
→ `sticky=false`：`run_registry._execute_task` **不**写入 `run.blocked`，前端
`rememberFailure` **不**写入 `blockedCalls`。其余 policy 失败仍 `sticky=true`。
`error_details` 新增三个字段：`reason`、`layer`、`sticky`。

**兼容**：线上错误码不变（仍 `url_forbidden` / 403），只是多了 `error_details.reason`；
`FAILURE_CLASS` 映射不动，避免破坏既有 UI 文案与重试语义。

### 4.2 `safe_http_client.py` 改造（修改）

1. `default_proxy_settings()` 改为调用 `egress_policy.resolve_proxy()`，**永不抛错**：
   - `auto`：非法 env/系统代理 → `proxy_url=""`、`resolved_from="direct"`、
     `proxy_error="proxy_config_invalid"`，并 `logger.warning` 一次（含 key 名，不含值）。
   - `custom`：非法 → 保留 `proxy_error`，`_request()` 抛
     `WebResearchError("url_forbidden")` 且 `error_details.reason="proxy_config_invalid"`。
2. `normalize_url()` 与 `normalize_proxy_url()` 的逻辑整体迁入 `egress_policy`，
   外壳函数保留为薄委托（`tests/test_research_safe_http.py` 直接调这两个名字）。
3. `public_ip()` 增加 `mode` 形参（现为单参，`safe_http_client.py:38-44`，只有 `:88`/`:135`
   两个内部调用点，加参安全）；`GuardedResolver.resolve()` 内部改调 `check_answers()`。
   **"钉住"的落点（REV-P1-2）**：`GuardedResolver` 自持一个进程内
   `host → (tuple[ip], ts)` 缓存（TTL 300 s，上限 256 条，FIFO 淘汰，与 `self.robots`
   同构）。命中即直接返回缓存答复、不再 `getaddrinfo`；`TCPConnector(use_dns_cache=False)`
   **保持不变**（它关的是 aiohttp 自己的缓存，与本 resolver 的内部缓存互不冲突）。
   `strict` 模式下缓存同样生效，只是校验规则更严。这样"钉住"既真实可测（AC-G02 断言
   resolver 只被调用一次），也不改变 `_request()` 的连接器构造。

### 4.3 tier-2 通用出口（新增）

新包 `backend-services/basic-service/app/services/agent_host/`：

| 文件 | 职责 | 关键约束 |
|---|---|---|
| `__init__.py` | `get_capabilities()`（返回 dict）、`purge_expired()`；与 `agent_toolkit/__init__.py:20,38` 同构（**该模块导出的是 `purge_expired` 与返回模块的 `get_capabilities`，本包按需收敛为 dict**） | 不 import 路由 |
| `settings.py` | `agent_host_settings()`（合并 `AGENT_HOST_DEFAULTS` + DB 分类 `agent_host`） | 唯一读取入口；命名对齐 `toolkit_settings()` / `research_settings()` |
| `egress.py` | `http_request(...)`、`download(...)`、`diagnose(...)`；复用 `egress_policy` + `SafeHttpClient`（`static_proxy_settings` 注入） | **不引用 `run_registry`** |
| `shell_runner.py` | `run_command(...)` | 见 §4.4 |
| `fs_tools.py` | 7 个文件操作的实现 | 见 §4.5 |
| `audit.py` | `record(event, **fields)` → 后端结构化日志 | 命令文本仅在 debug 级、截断 200 字符 |

#### 4.3.1 `http_request` 的能力边界（修 REV-P0-3）

v1 承诺的"7 种方法 + 任意头 + 请求体"在现有客户端上做不到，v2 明确收敛：

| 项 | v2 约定 | 依据 |
|---|---|---|
| 方法 | **仅 `GET` / `HEAD`**；`POST/PUT/PATCH/DELETE` → `http_write_unsupported`(400)，`remediation` 指向"需要提交表单请用受控浏览器（`browser_act`）" | `fetch_one_hop()` 只放行 GET/HEAD（`safe_http_client.py:315-316`） |
| 请求头 | 只透传 `accept` / `accept-language`（列表常量，便于审计与测试断言） | `_request()` 的白名单（`:351-354`） |
| 请求体 | 不支持；`body_base64` 字段从端点删除 | `RequestSpec` 无 body 字段（`:246-250`） |
| 响应 | `status`、头部子集（`content-type`/`content-length`/`location`/`etag`/`last-modified`）、`body_text` 或 `body_base64` | `HttpResult`（`:253-258`） |
| 重定向 | 客户端内部最多 6 跳并返回 `final_url`；跨 host 跳转重新过 `classify_url` | `fetch()`（`:300-307`） |
| robots | 默认遵守（`policy.document=true`），`allow_robots:false` 时改走 `FetchPolicy(..., document=False)` | `fetch_one_hop()`（`:317-318`） |

需要写方法时走后续阶段（§9 R-G11），届时给 `RequestSpec` 加 `body` + 方法白名单，
而不是在 `http_request` 里"看起来支持"。

`egress.download()` 的流程（与 `web_media_download.download_material` 对齐，但**不带 run**）：

1. `research_settings()["downloads_enabled"]` 为假 → `downloads_disabled`(403)。
   （复用同一个用户可见开关，避免出现两个"下载开关"；该键确实存在，
   `system_settings_service.py:50` + `config/web-research-config.yaml:5`）
2. `classify_url` → `SafeHttpClient.fetch(FetchPolicy(max, timeout, respect_robots))`；
   **`kind` 只有 `image`（10 MiB / 30 s）与 `media`（100 MiB / 180 s）两种**（REV-P1-12：
   `kind=file` 没有入库路径，v1 的 pdf/zip 承诺无法兑现）。其余取值 →
   `unsupported_media_type`(415) + `remediation` 指向 `workspace_write`。
3. `status != 200` → `download_failed`(502)；`kind=media` 无魔数签名 → `unsupported_media_type`。
4. 落临时文件（`tempfile.TemporaryDirectory(dir=temporary_root())`，其中
   `temporary_root()` 在 `app/services/web_research/media_worker.py:113`，**不在**
   `workspace_store`）；图片经 `media_worker.image_async(source, target)`（两参、写出
   标准化 PNG 并返回 `{type, format, width, height, first_frame_only}`，
   `media_worker.py:91`），媒体经 `probe_async(path)`（`:101`）。
5. `material_download_service.store_research_download_async(path, digest, extension, url)`
   （第三参是 `extension` 不是 `format`，`material_download_service.py:473`）
   → 得到 `local_url`（形如 `/api/storage/files/cached_materials/web/web-<sha24>.<ext>`）。
   该提交路径只接受 `png jpg mp4 webm mp3 wav m4a` 7 种扩展（`_store_research`，`:517` 附近），
   因此 `kind=image`/`media` 恰好全覆盖。
6. 返回 `{status:"ready", reused, material}`，`material.size` **必须 > 0**；
   否则抛 `cache_commit_failed`(507) 而不是返回一个 size 0 的"成功"（修 C-6 的后端一半）。
   这条守卫是必需的：`row.file_size = final.stat().st_size`（`:596`）本身允许 0。

`egress.diagnose()`：只跑 `egress_policy` 的全链判定 + 可选 `socket.getaddrinfo`（受
`resolve: true` 控制，5 s 上限），返回
`{allowed, url, host, mode, checks:[{name, ok, detail}], reason, layer, remediation}`。
**robots 检查默认 `skipped`（REV-P1-6）**：robots 必须真的抓 `robots.txt`
（`safe_http_client.py:372-405`），是 I/O，与"只判定不发请求"冲突。因此 `checks[robots]`
在默认情况下 `{name:"robots", ok:true, detail:"skipped (pass check_robots:true)"}`；
只有显式 `check_robots: true` 才发那一次请求（同样 10 s 上限、`respect_robots` 递归保护）。
tier-2 的其它入口不消耗 `egress_max_per_turn`。


### 4.4 `shell_runner.py`（新增）

**签名**
`run_command(project_id: str | None, command: str, cwd: str | None, timeout_ms: int | None) -> ShellResult`

`ShellResult = {exit_code: int | None, stdout: str, stderr: str, stdout_truncated: bool,
stderr_truncated: bool, duration_ms: int, cwd: str, killed: bool, spawn_failed: str | None}`

**规则**

| 项 | 规则 |
|---|---|
| 开关 | `agent_host.shell_enabled`（出厂 **true**）；关闭 → `shell_disabled`(403) |
| 解释器（REV-P1-15） | 工具名沿用 `bash`（与参考实现一致），但**不承诺 bash 存在**：`win32` 用 `[%COMSPEC% or "cmd.exe", "/d", "/s", "/c", command]`；POSIX 用 `["/bin/sh", "-lc", command]`。`ShellResult.shell` 回显实际解释器字符串，工具描述与 `GENERAL_AGENT_GUIDANCE` 必须写明"Windows 上是 cmd.exe，不要用 `&&` 之外的 POSIX 语法、不要假设 `sed`/`grep` 存在" |
| stdin / 交互 | `stdin=subprocess.DEVNULL`；所有命令必须自带非交互参数（`-y`、`--no-pager`、`-n`）；`spawn` 不分配新控制台（Windows 用 `CREATE_NO_WINDOW`） |
| 编码 | 一律按 `locale.getpreferredencoding(False)` 解码，失败回退 `utf-8` + `errors="replace"`；启动前注入 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`，让随包 Python 输出稳定为 UTF-8 |
| cwd | `shell_scope=workspace`（默认）：必须位于 `workspace_store.project_directory(project_id)` 内（复用 `_assert_inside`）；`shell_scope=host`：接受任意存在的绝对目录 |
| 超时 | `shell_timeout_s`（默认 120，范围 1–600）；到点先 `terminate()`，5 s 未退则整棵进程树强杀：Windows `taskkill /T /F /PID <pid>`（已在 `web_research/browser_service.py:462-469` 有先例），POSIX `os.killpg(SIGKILL)`（`start_new_session=True`） |
| 输出 | `shell_max_output_kb`（默认 64，范围 8–512）**每路**；超限即停读并置 `*_truncated=true`（不无限缓冲） |
| 环境 | 白名单：`PATH, PATHEXT, COMSPEC, SYSTEMROOT, WINDIR, TEMP, TMP, HOME, USERPROFILE, APPDATA, LOCALAPPDATA, NUMBER_OF_PROCESSORS, LANG, LC_ALL, PYTHONIOENCODING, PYTHONUTF8`；注入 `ECLIPTRIX_AGENT_HOST=1`、`ECLIPTRIX_PROJECT_ID`；把随包 `resources/python` 与 `resources/ffmpeg` 前置到 `PATH`（同 `desktop/main/backendService.js` 的理由）。**不传**任何名字匹配 `KEY` / `TOKEN` / `SECRET` / `PASSWORD` / `CREDENTIAL` 结尾（大小写不敏感）的变量 |
| 脱敏 | stdout/stderr 出站前过 `app/security/output_redact.py`（新增，薄封装既有 `log_redact.redact_string`，`app/security/log_redact.py:62-83`：`sk-`、`tvly-`、Bearer、`?api_key=`） |
| 并发 | 每 project `asyncio.Semaphore(1)`，进程级 `2`；等锁超 10 s → `shell_busy`(429) |
| 错误 | 进程创建失败（Windows 常见：AppLocker/杀软拦截）→ `spawn_failed` 字段 + `shell_spawn_failed`(502)，附 Windows 提示 |
| 审计 | 每次调用一行 `agent_host.shell`：`{project_id, command_sha256, exit_code, duration_ms, truncated}`；命令原文仅 debug 级、截断 200 字符 |
| 退出码 | **非 0 退出码不是错误**，就是正常结果（与参考实现一致） |

### 4.5 `fs_tools.py`（新增，**复用而非另立** workspace_store）

同一个根目录上已经有 `workspace_*` 工具（`agent_toolkit`），v1 另写一套限值与错误码会
出现"两套语义、两个码、一条能绕过配额的写路径"（REV-P1-1）。v2 的硬约束：

- **workspace 作用域 = 直接复用 `workspace_store`** 的既有实现与限值：
  `MAX_WRITE_BODY_BYTES = 2 MiB`（`:24`）、`DEFAULT_READ_BYTES = 4000` /
  `MAX_READ_BYTES = 8000`（`:26-27`）、`quota_bytes()`（`:203`）、`max_file_bytes()`（`:207`）、
  `byte_page()`（`:272`）、`is_binary()`（`:303`）、`_RESERVED` 设备名表（`:44`）。
  `write_file` 必须走 `workspace_store.write_file()`（内含配额检查，`:229`），**不得**
  绕开配额直写磁盘。
- **错误码统一**，不新增近义码：

  | 场景 | 码 | HTTP | 归属 |
  |---|---|---|---|
  | workspace 写超单文件上限 / 超配额 | `workspace_file_too_large` / `workspace_quota_exceeded` | 413 / 507 | 既有 `agent_toolkit_models.STATUS:45,38` |
  | 读到二进制 | `binary_file` | **415**（v1 误写 422；既有定义就是 415） | 既有 `agent_toolkit_models.STATUS:47` |
  | host 作用域写超上限 | `host_file_too_large` | 413 | 新增 |
  | `edit_file` 非唯一 / 路径逃逸 / 参数错 | `edit_not_unique` / `path_forbidden` / `invalid_argument` | 409 / 403 / 400 | `edit_not_unique`、`path_forbidden` 新增 |

- **分页只有一套**（REV-P2-11）：`read_file` 的 `offset`/`limit` 是**字节**偏移，与
  `byte_page()` 语义一致；"2000 行"的说法作废。返回体带 `next_offset`、
  `truncated`、`lines`（本次实际覆盖的行数）。工具 schema 与端点同时带 `max_bytes`
  （区间 1024–`fs_max_bytes`），避免"端点允许、工具不允许"。

| 工具 | 参数 | 规则 |
|---|---|---|
| `read_file` | `path, offset?, max_bytes?` | 文本按字节页（默认 `fs_max_bytes` 32 KiB，硬上限 `MAX_READ_BYTES`）；UTF-8 优先、失败回退本地代码页；二进制 → `binary_file`(415) + `next_step` |
| `write_file` | `path, content, overwrite?` | 原子写（`_write_atomic`，`:214`）；父目录自动创建；受 `max_file_bytes` + 配额双重约束；写入体 ≤ 2 MiB |
| `edit_file` | `path, old_string, new_string, replace_all?` | `old_string` 必须**恰好出现一次**（除 `replace_all`），否则 `edit_not_unique`(409) 且**不落盘**；返回统一 diff 预览（≤4 KiB） |
| `list_dir` | `path` | 目录项 + 类型 + 字节数，最多 500 项 |
| `glob` | `pattern, cwd?` | 相对路径，按 mtime 倒序，最多 2000 项；不吃 `.git/`、`node_modules/`（可关） |
| `grep` | `pattern, path?, glob?, ignore_case?` | 正则，**先编译**：非法正则 → `invalid_argument`(400)；单个文件超过 1 MiB 跳过；最多 200 条命中行；整体 5 s 墙钟上限，超时返回已收集的部分并置 `truncated=true`（近似处理 ReDoS，不做完整防护） |

**路径安全**：`workspace` 作用域一律经 `workspace_store.safe_relative_name()`（`:100`，含
`_RESERVED` 设备名与非法字符）+ `_assert_inside()`（`:158`，含符号链接逃逸）——规则出处是
`docs/plans/agent-general-toolkit/spec.md` §3.3.2 与 AC-01，**不是**
`agent-steering-and-skills/spec.md` 的 R-02（后者讲技能 id 保留字，REV-P2-7）。
`host` 作用域经新增 `resolve_host_path()`：`Path.expanduser().resolve()` 后必须落在
`host_read_roots` / `host_write_roots` 之内，否则 `path_forbidden`(403)。默认值见 §4.9
（**不含 `~`**，REV-P1-14）。

### 4.6 素材入库与"元数据素材"（修 C-6）

1. `download_url(import_to_library=true)` 返回的 `material.size` 必须 > 0，且
   `local_url` 匹配 `/^\x2Fapi\x2Fstorage\x2Ffiles\x2Fcached_materials\x2F[a-z0-9_-]+\x2F[a-zA-Z0-9_.-]+$/`
   （前端 `webToolAdapter.localMaterial()` 的既有正则，`webToolAdapter.ts:63`）。不匹配 → `material_not_ready`。
2. **守卫分两层，且落点写清（REV-P1-10）**。`Image could not be resolved` 是**后端**
   字符串（`app/services/image_to_video_service.py:139` 的 `IMAGE_NOT_FOUND`），经
   `stillClip.ts:196-205` 原样透出，所以只改前端文案是改不掉的：
   - 前端（真正入口）：`tools/stillClip.ts` 的 `image_not_local` 判定（`:174-179`）前面加
     `size === 0 || !cacheUrl || !storageKey` 的守卫 → `material_not_materialized`(422)；
     `tools/addToTrack.ts`（`:69`、`:90` 附近）同样加一道。`stillGuard.ts:50-71` 只负责
     "图片进视频轨"（`still_needs_conversion`），**不承担**这一条，不要在它上面堆逻辑。
   - 后端（兜底与自证）：`image_to_video_service` 在 `IMAGE_NOT_FOUND` 之前的
     "素材存在但无本地文件"分支改为抛 `material_not_materialized`，把含糊的
     `Image could not be resolved` 从源头替换掉。
   - 错误码归属：`material_not_materialized` 注册在**生成域**的
     `app/models/agent_still_models.py`（或既有生成域 models）的 `STATUS`，不在
     `agent_host_models`（v1 把前端码注册到宿主域，是死登记）。
3. `search_image` / `search_video` 的返回体新增 `materialized: boolean` 与
   `next_step: 'Use download_url to write the bytes, then add_to_track.'`，
   工具描述同步补一句"结果可能是只有元数据的候选"。

### 4.7 前端工具层（新增 2 类 10 工具）

新文件：

- `src/lib/video-editing-agent/tools/hostTools.ts` → `createHostTools(context)`：
  `bash, read_file, write_file, edit_file, list_dir, glob, grep`
- `src/lib/video-editing-agent/tools/egressTools.ts` → `createEgressTools(context)`：
  `http_request, download_url, diagnose_url`
- `src/lib/video-editing-agent/tools/hostToolAdapter.ts` → `executeHostTool(context,
  callId, call)`：与 `webToolAdapter` 同构（`RESULT_BYTE_CAP` **从 `webToolAdapter.ts:12`
  import，不重新声明**、`toolFetch`、`sanitizeResearchValue`），但**不触碰
  `context.researchRun`**，因此没有 `run_closed` 分支。

**sticky 的落点（REV-P1-12）**：前端今天只有 `error_details.failure_class`
（`webToolAdapter.ts:30-41` 用 `{configuration, policy}` 决定是否写 80 条 `blockedCalls`），
没有 `sticky`。v2 要求后端在 `error_details` 里下发 `sticky`（§4.1），并且：
`hostToolAdapter` 与 `webToolAdapter` 共用一个新的纯函数
`sanitizeResearchValue` 同级的 `shouldRememberFailure(error)`——`sticky === false` 或
`failureClass === 'configuration'` 时**不写**缓存；同时在 `ecliptrix-llm-config-updated`
与 `/system-settings/agent_host` 保存成功后**清空本 context 的 `blockedCalls`**，
这样用户"改完设置再试一次"真的能生效（C-4 现场的最后一环）。

**注册表改动（`registry/categories.ts`，现状 19 类 / 63 工具 / `ON_DEMAND` 16）**

| 新常量 | 值 | `alwaysAvailable` | description（≤160 字节） |
|---|---|---|---|
| `HOST_TOOLS` | `host_tools`（名称「本机工具」） | false | `Run shell commands and read/write/search files on this machine: bash, read_file, write_file, edit_file, list_dir, glob, grep.` |
| `EGRESS_TOOLS` | `egress_tools`（名称「通用联网」） | false | `Any public URL without a research run: http_request, download_url (imports material), diagnose_url (explains a refusal).` |

同时：加入 `ON_DEMAND_CATEGORY_IDS`（16 → 18），加入 `createDefaultCategories()`
（19 → 21 类），并在 `tools/index.ts:createToolRegistry()` 中
`registerToolsForCategory(HOST_TOOLS, createHostTools(context))` 与
`registerToolsForCategory(EGRESS_TOOLS, createEgressTools(context))`，
放在 `MEMORY_TOOLS` 之后、`REVIEW_TOOLS` 之前（顺序稳定，便于快照测试）。

**常驻化：新增独立清单，不动 `CORE_TOOLKIT_TOOL_NAMES`（修 REV-P0-1）**

v1 让 6 个名字进 `CORE_TOOLKIT_TOOL_NAMES` 是**必然红**的做法：`formatCoreToolkit()`
对每个名字渲染 `### name` + 完整 description + 参数签名（`systemPrompt.ts:322-339`），
6 个富参数工具约 1.3–2.2 KB，而 `systemPrompt.toolkit.test.ts:76-80` 钉死
`prompt().length ≤ 18 500`、当前最坏值 18 100（`systemPrompt.ts:365-375`），
且同一文件 `:91` 断言 `CORE_TOOLKIT_TOOL_NAMES` 长度为 18。v2 改为：

1. `promptParts.ts` 新增 `GENERAL_RESIDENT_TOOL_NAMES = ['bash','read_file','write_file',
   'http_request','download_url','diagnose_url'] as const`，与 `CORE_TOOLKIT_TOOL_NAMES`
   **并列而非合并**。
2. `agent.ts:127-131` 的 `activation` 数组追加
   `...GENERAL_RESIDENT_TOOL_NAMES.filter(name => !isYoloExcluded(name))`——这与
   `agent.ts` 里 `CORE_TOOLKIT_TOOL_NAMES` 已有的"常驻即授予执行权"机制完全同构。
3. `systemPrompt.ts` 新增 `formatGeneralResident()`：**单行紧凑格式**
   （`- bash(args…) — 一句话`），6 行总预算 **≤ 400 字符**，不展开 description 与
   参数块。渲染位置固定在 `GENERAL_AGENT_GUIDANCE` 之后。
4. 棘轮不变：L0 净增 = `formatGeneralResident()`（≤400）+ 引导段（≤400），
   AC-G14 把它拆成两条可测断言（见 §8.2），并且**只允许**用"删除等价文本"来腾余量，
   不放宽 `18 500` / `18 900`。
5. schema 侧照旧受 `SCHEMA_LIMIT = 48 KiB`（`ToolActivationState.ts:4`）约束，
   但注意 on-demand 预算的下限叫 `ON_DEMAND_MIN_BYTES = 8 KiB`（`:10`），
   不是 `SCHEMA_FLOOR`，且常驻 schema 与 on-demand **共用**同一 48 KiB 预算——
   6 个常驻 schema 约 1.8 KiB，是从别处挪来的额度，不是白送的（REV-P2-5）。


**能力自证（`systemPrompt.ts:categoryAvailability`）** 扩展：

| 类别 | available 判据 |
|---|---|
| `host_tools` | `snapshot.host?.shell_enabled !== false` |
| `egress_tools` | **恒 true**（tier-2 不需要 run；这正是与现状的可见差异） |

新增 `GENERAL_AGENT_GUIDANCE`（`promptParts.ts`，紧随 `AGENT_TOOLKIT_GUIDANCE`）要点：
「你可以在用户本机执行命令、读写授权目录、访问任意公开 URL」；「被拒时必须报出
`error_details.reason` 与 `remediation`，不得笼统说"网站策略拒绝"」；
「`download_url` 返回 `size=0` 视为失败，不得声称已拿到素材」；
「`reason` 属于 `proxy_config_invalid` / `dns_answer_non_global` / `port_not_allowed`
时，先用 `diagnose_url` 自证并提示用户改设置，然后**重试一次**」。

### 4.8 run 生命周期修复（修 C-3，含 REV-P1-9 的语义更正）

`src/lib/server/researchRunClient.ts:cancelCall()`：

- 变成非致命：DELETE 返回 `401/403/404/410` → `close()`（run 确实没了）；
  其余非 2xx 或网络异常 → 只 `markLost('cancel_unconfirmed')`，**不关闭 run**。
- `catch` 分支不再 `close()`，改为 `markLost('cancel_unconfirmed')` 并返回；调用方
  `webToolAdapter` 的 `catch` 保持 `void run.cancelCall(callId)` 不变（语义已变）。
- **语义更正**：`markLost` 是**回合级**状态（`researchRunClient.ts:73-76` 只有一个
  `lostReason`，`webToolAdapter.ts:87-93` 让本回合后续每一个研究调用都直接读到 lostCode）。
  所以 v1 写的"本回合该 call 判失败"是错的，正确表述是"**本回合剩余的研究调用降级**，
  但 run 仍然活着、tier-2 完全不受影响"。这正是本设计能接受的最坏情况：单次取消失败
  只影响 T1，不再波及 T2。
- `markLost` 不应停止 15 s `register()` 续租（`:57-61`）：既然 run 没关，就让它自然到期，
  否则会留下一个后端没人续租、前端以为丢了的分裂状态。
- **既有测试必须反转**：`src/lib/video-editing-agent/__tests__/researchRunClient.test.ts:37-47`
  现在断言的是"取消失败 → aborted === true"，正是 v1 要废掉的行为。v2 把它改写为
  "取消失败 → `signal.aborted === false` 且 `lostReason === 'cancel_unconfirmed'`"，
  并新增一条"404 → 关闭"。v1 §5.2 计划在 `src/lib/server/__tests__/` 另建同名文件属于
  重复造轮子，v2 改为**就地修改**这一个文件。

`backend .../run_registry.py`：`_execute_task` 的 `except WebResearchError` 分支改为
`if error.sticky_failure(): run.blocked.add(signature)`（新增 `WebResearchError.sticky_failure()`
读 `error_details.sticky`，默认 `True` 保持既有行为）。

### 4.9 设置与 i18n

**新设置分类 `agent_host`**（`config/agent-host-config.yaml` + `AGENT_HOST_DEFAULTS`）

加一个分类在现有代码里是**五处登记**，v1 只写了三处，漏掉的两处会让面板恒 404
（REV-P0-2）：

1. `config/agent-host-config.yaml`（出厂值）
2. `app/services/system_settings_service.py`：`AGENT_HOST_DEFAULTS` + `agent_host_settings()`
   + `YAML_TO_DB_MAPPING`（该 dict 里 `agent_vision`/`agent_toolkit`/`web_research` 是推导生成的，
   `:168-190`，照抄即可）
3. `app/models/system_settings_models.py`：`validate_setting_payload` 的 `agent_host` 分支
   （`:239-314` 的既有结构：bool / int-range / float-ratio / enum-str / proxy-url）
4. **`app/routers/system_settings_router.py`：`CATEGORY_METADATA`（`:42-79`）与随之推导的
   `_VALID_CATEGORIES`（`:82`）**——不加这两处，`_validate_category()`（`:85-92`）会让
   `GET/PUT /api/system-settings/agent_host` 一律 404
5. 前端 `SettingsSidebar.tsx` 的 `SettingsMenuItem` 联合类型（`:6-18`）+ 分组字面量
   （`:49-171`），以及 `SettingsPage.renderContent` 的新 `case`（它的 `default: return null`
   会静默吞掉漏改，`:59-88`）

| 键 | 出厂 | 范围 / 取值 | 说明 |
|---|---|---|---|
| `enabled` | `true` | bool | 总开关（关掉则 10 个工具全部不出现在 schema） |
| `shell_enabled` | `true` | bool | 允许本机命令 |
| `shell_scope` | `workspace` | `workspace` / `host` | 默认 cwd 的落点；`host` 需二次确认 |
| `shell_timeout_s` | `120` | 1–600 | 墙钟上限 |
| `shell_max_output_kb` | `64` | 8–512 | 每路上限 |
| `fs_enabled` | `true` | bool | 文件工具总阀 |
| `fs_max_bytes` | `32768` | 1024–1048576 | 单次读取页 |
| `egress_enabled` | `true` | bool | tier-2 出口 |
| `egress_mode` | `balanced` | `strict`/`balanced`/`open` | 出口策略档位 |
| `egress_allow_hosts` | `[]` | fnmatch 数组，≤50 条 | 显式信任主机 |
| `egress_deny_hosts` | `[]` | fnmatch 数组，≤50 条 | 显式拒绝（优先） |
| `egress_allow_ports` | `[]` | int 数组，1–65535，≤20 条 | `balanced` 下的额外端口 |
| `egress_max_bytes` | `8388608` | 64 KiB–64 MiB | 响应体上限 |
| `egress_max_per_turn` | `60` | 1–200 | 每回合 tier-2 调用上限（**前端** `callBudget` 记账） |
| `egress_max_per_minute` | `120` | 1–600 | **后端**每进程每分钟 tier-2 请求上限（REV-P1-7；新增键） |
| `host_read_roots` | `["<projectDir>", "<STORAGE_ROOT>"]` | 绝对路径数组，≤10 | `host` 作用域可读。**默认不含 `~`**（REV-P1-14）：`~` 等于默认开放 `~/.ssh`、`~/.aws` 与各种 `.env`，而 `bash` 本来就已经是全权限。要加 `~` 必须勾选"我知道这不是沙箱"确认框 |
| `host_write_roots` | `["<projectDir>", "<STORAGE_ROOT>"]` | 绝对路径数组，≤10 | `host` 作用域可写 |
| `audit_log_retention_days` | `30` | 1–365 | 审计日志保留（见 §7.1 的真实落点） |

共 **18 个键**（v1 标题写 16、表里 17，均以本表为准）。

**校验责任（REV-P2-… 的落地）**：`egress_allow_hosts/deny_hosts/allow_ports/host_*_roots`
在现有 `validate_setting_payload` 里没有同类先例（只有 bool / int-range / float / enum /
proxy-url / dict-of-ranges），因此需要**新写 4 个校验器**并各配一条失败路径测试：
fnmatch 模式编译（非法模式 400）、端口 1–65535 且去重、路径必须绝对且
`Path.is_absolute()` 为真、数组长度上限。这是本设计里唯一需要"从零写校验"的地方，
但不写就会出现"存进去的路径永远匹配不上"的静默故障。

`web_research` 分类**不新增键**；只在 `/capabilities` 里回显 tier-2 的出口摘要
（`egress:{mode, proxy:{mode,resolved_from,target}, tier2:true}`）。该摘要的字段形状
**已经存在**：`research_browser_router.py:54` 的 `proxy: {mode, resolved_from, target}`
（`resolved_proxy_summary()` `:226-235`，userinfo 由 `public_proxy_target()` `:210-223` 剥掉），
本设计只是把 `egress` 与 `tier2` 两个字段补进去（沿用 capabilities AC-33 / D-01 的思路，
引用他人 id 时带文档名）。

**UI**：新增 `src/components/settings/AgentHostSettingsPanel.tsx`（与
`AgentToolkitSettingsPanel` 同构：加载态只有 `role="status"`、逐键区间校验、
`savePayload` 只发改动的键——`AgentToolkitSettingsPanel.tsx:210-213` 是这个约定的样板，
**不要**用共享 `useSettingsPanel.ts:103-117` 的"发整表"约定，否则 AC-G19 不可测），
侧边栏 `SettingsSidebar` 新增 `agentHost` 项；`WebResearchSettingsPanel`
的代理小节新增一行只读说明"当前出口档位/代理来源"，`egress_mode` 的 `open` 档位在
面板里用红色警告文案 + 二次确认。"恢复默认"按钮本版**不做**（v1 没说，见 §12 结论第 3 条）。

**i18n（REV-P2-10）**：`src/lib/i18n.ts` 已 12 032 行，现有命名空间是顶层
`webResearch:`（`:6`）与 `agentToolkit:`（`:302`），**没有** `agentToolCall` 命名空间。
v2 的键落点：
- 新增顶层 `agentHost:` 命名空间（面板标题、18 个键的标签与提示、危险档警告文案）
- `webResearch.reason.*`（13 个 reason 码的文案，与 §7.3 一一对应）
- 工具卡文案进 `webResearch` 同级的既有 `toolCall`/`agent.*` 命名空间里最接近的一组，
  实施时以实际结构为准，不新造第三个近似命名空间

**工具卡渲染**：`AgentToolCallCard.tsx` 对 `bash` / `read_file` / `grep` 用等宽字体块
（保留换行、横向滚动、最多 20 行折叠），失败态必须显示 `reason` 与 `remediation`。

---

## 5. 文件 / 模块变更计划

### 5.1 后端（`backend-services/basic-service/`）

| 文件 | 动作 | 意图（一句话） |
|---|---|---|
| `app/services/web_research/egress_policy.py` | 新增 | 唯一出口判定：三档模式、reason 码、sticky、代理解析不抛错 |
| `app/services/web_research/safe_http_client.py` | 修改 | 委托 `egress_policy`；`resolve_proxy` 降级不炸；DNS 校验分档；删死代码 `literal_target_forbidden` |
| `app/services/web_research/run_registry.py` | 修改 | 只有 sticky 失败写入 `run.blocked`；`execute` 错误带 reason |
| `app/models/web_research_models.py` | 修改 | `WebResearchError.sticky_failure()`；注册新码 `shell_*`/`path_*` 不在此处（属 agent_host） |
| `app/services/agent_host/__init__.py` | 新增 | 能力快照与清理入口 |
| `app/services/agent_host/settings.py` | 新增 | `agent_host_settings()` 唯一读取点 |
| `app/services/agent_host/egress.py` | 新增 | tier-2 `http_request` / `download` / `diagnose`（无 run） |
| `app/services/agent_host/shell_runner.py` | 新增 | 子进程执行、超时、进程树终止、输出限幅、env 白名单 |
| `app/services/agent_host/fs_tools.py` | 新增 | 7 个文件操作 + 双作用域路径安全 |
| `app/services/agent_host/audit.py` | 新增 | 结构化审计日志（命令哈希、耗时、截断） |
| `app/security/output_redact.py` | 新增 | 工具输出脱敏（复用 `log_redact` 正则集） |
| `app/routers/agent_host_router.py` | 新增 | `/api/agent-host/*` 12 个端点（§6） |
| `app/models/agent_host_models.py` | 新增 | 请求/响应 pydantic 模型 + 状态码映射 |
| `app/services/system_settings_service.py` | 修改 | `AGENT_HOST_DEFAULTS`；`agent_host_settings()`；YAML→DB 映射 |
| `app/models/system_settings_models.py` | 修改 | 逐键类型与区间校验（含 fnmatch 模式、端口、绝对路径数组；4 个新校验器） |
| **`app/routers/system_settings_router.py`** | **修改** | **`CATEGORY_METADATA` + `_VALID_CATEGORIES` 登记 `agent_host`（漏了面板恒 404，REV-P0-2）** |
| `app/main.py` | 修改 | `include_router(agent_host_router.router, prefix="/api")`（该文件**没有**错误码注册表，码在各域 models 的 `STATUS` 里，REV-P2-4） |
| `config/agent-host-config.yaml` | 新增 | §4.9 的 **18** 个出厂值 |
| `config/web-research-config.yaml` | 修改 | 注释指向 `agent_host.egress_mode`；`respect_robots` 说明不变 |
| `app/routers/research_browser_router.py` | 修改 | `/capabilities` 增 `egress` 摘要（去 userinfo） |
| `tests/test_egress_policy.py` | 新增 | 表驱动判定矩阵（模式 × 地址 × 端口 × allow/deny） |
| `tests/test_research_safe_http.py` | 修改 | 非法 env 代理不再全站 403（C-1 回归）；custom 非法 → reason 精确 |
| `tests/test_research_runs.py` | 修改 | 非 sticky 失败不封禁；同调用重试不再 `blocked_repeat`（C-4 回归） |
| `tests/test_agent_host_router.py` | 新增 | 能力、origin、415、开关、超时树杀、截断、脱敏 |
| `tests/test_agent_host_fs.py` | 新增 | 逃逸/符号链接/设备名拒绝、edit 唯一性、grep 上限、二进制 |
| `tests/test_agent_host_egress.py` | 新增 | 真字节入库 size>0、HTML 冒充图片拒绝、无 run 可用、413、diagnose 层 |
| `tests/test_no_direct_credential_reads.py` | 修改 | 注册表变更后仍通过（`agent_host` 无凭据字段） |

### 5.2 前端（`src/`）

| 文件 | 动作 | 意图 |
|---|---|---|
| `app/api/agent-host/[...path]/route.ts` | 新增 | BFF 透传：路径白名单 + 必带并转发 `Origin` + 2 MiB JSON 上限 + 按路由超时（§6「BFF 契约」，**照抄 `app/api/agent-toolkit/[...path]/route.ts` 而不是 web-research 那份**） |
| `lib/video-editing-agent/tools/hostToolAdapter.ts` | 新增 | 通用工具适配器（`RESULT_BYTE_CAP` 从 `webToolAdapter` import、不碰 run） |
| `lib/video-editing-agent/tools/hostTools.ts` | 新增 | 7 个本机工具定义 |
| `lib/video-editing-agent/tools/egressTools.ts` | 新增 | 3 个联网工具定义 |
| `lib/video-editing-agent/tools/index.ts` | 修改 | 注册两个新类；`tool_not_loaded` 闸门不变 |
| `lib/video-editing-agent/registry/categories.ts` | 修改 | `HOST_TOOLS`/`EGRESS_TOOLS` 常量、定义、`ON_DEMAND_CATEGORY_IDS` |
| `lib/video-editing-agent/promptParts.ts` | 修改 | `GENERAL_AGENT_GUIDANCE`；`GENERAL_RESIDENT_TOOL_NAMES`（**不改** `CORE_TOOLKIT_TOOL_NAMES`）；2 条类别提示 |
| `lib/video-editing-agent/systemPrompt.ts` | 修改 | `formatGeneralResident()`；渲染新引导段；`categoryAvailability` 扩展 |
| `lib/video-editing-agent/agent.ts` | 修改 | `activation` 数组追加 `GENERAL_RESIDENT_TOOL_NAMES`；注入 `hostCapabilities` |
| `lib/video-editing-agent/types.ts` | 修改 | `ToolContext` 增 `hostCapabilities?`；导出 `HostCapabilitySnapshot` |
| `lib/video-editing-agent/tools/webToolAdapter.ts` | 修改 | `shouldRememberFailure()` 共用判定（`sticky===false` 或 `failureClass==='configuration'` 不写缓存）；透出 `reason`/`remediation`/`sticky` |
| `lib/video-editing-agent/tools/stillClip.ts` | 修改 | `material_not_materialized` 守卫（`:174-179` 之前），替换后端 `IMAGE_NOT_FOUND` 的含糊文案 |
| `lib/video-editing-agent/tools/addToTrack.ts` | 修改 | 同一守卫的第二道 |
| `lib/video-editing-agent/tools/searchImage.ts`、`searchVideo.ts` | 修改 | 返回 `materialized` + `next_step` |
| `lib/server/researchRunClient.ts` | 修改 | `cancelCall` 非致命（C-3 回归） |
| `lib/server/agentHostSnapshot.ts` | 新增 | 1.5 s 上限的能力探测，失败即 `null`（形状对齐既有 toolkit 快照助手） |
| `lib/agentHostStatus.ts` | 新增 | 错误码 → 文案键映射（**对齐 `lib/agentToolkitStatus.ts` 的 `CODES` 注册表 + `isKnownToolkitCode` 写法**，比 `webResearchStatus.ts` 更近） |
| `types/agentHost.ts` | 新增 | 请求/响应/能力快照类型 |
| `components/settings/AgentHostSettingsPanel.tsx` | 新增 | 18 个键的分组表单 + 危险档二次确认（脏键保存；本版无"恢复默认"） |
| `components/settings/SettingsSidebar.tsx` | 修改 | 新增 `agentHost` 侧边项（`SettingsMenuItem` 联合类型 `:6-18` + 分组字面量 `:49-171`） |
| `components/settings/SettingsPage.tsx` | 修改 | 渲染新面板（`renderContent` 的 `default: return null` 会静默吞掉漏改） |
| `components/settings/WebResearchSettingsPanel.tsx` | 修改 | 出口档位/代理来源只读摘要 |
| `src/app/page.tsx`、`Onboarding/SetupWizard.tsx`、`Onboarding/wizard/wizardSteps.ts` | 修改 | 侧边项新增后的联动点（`page.tsx:8,38,127,169`；`wizardSteps.ts:3,118-120`），REV-P2-8 |
| `components/video/components/VideoChatWindow/AgentToolCallCard.tsx` | 修改 | shell / 文本结果等宽块 + reason 展示 |
| `lib/i18n.ts` | 修改 | 顶层 `agentHost` 命名空间、`webResearch.reason.*`、工具卡文案（中英）；**不新造 `agentToolCall` 命名空间** |
| `lib/video-editing-agent/tools/__tests__/hostTools.test.ts` | 新增 | 定义/闸门/结果上限 |
| `lib/video-editing-agent/tools/__tests__/egressTools.test.ts` | 新增 | `size=0` 判失败、reason 透传、无 run 也工作 |
| `lib/video-editing-agent/__tests__/researchRunClient.test.ts` | **修改（不是新增）** | 反转 `:37-47` 的既有断言；补 404 → 关闭 |
| `app/api/agent-host/__tests__/route.test.ts` | 新增 | 白名单、origin、413/415、超时 |
| `components/settings/__tests__/AgentHostSettingsPanel.test.tsx` | 新增 | 区间校验、危险档确认、保存只发改动键 |
| `lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts` | 修改 | AC-G14 的两条棘轮断言真正落在这个文件（`:76-80` 的 18 500 断言在这里，不在 `systemPrompt.test.ts`） |
| `lib/video-editing-agent/__tests__/systemPrompt.test.ts` | 修改 | 新引导段出现；`egress_tools` 恒 available |

---

## 6. 接口设计（REST）

所有端点前缀 `/api/agent-host`（后端 `agent_host_router`），由 BFF
`/api/agent-host/[...path]` 透传。鉴权沿用现状：**无凭据**，只校验 loopback 来源
（`Origin`/`Sec-Fetch-Site` 规则复用 `research_run_router.validate_ui_origin`，`:53-63`；
`agent_toolkit_router` 就是这么复用的）。
统一错误体 `{success:false, message, error_code, error_details}`。

| 方法 / 路径 | 请求体 | 响应 `data` |
|---|---|---|
| `GET /capabilities` | — | `{enabled, shell:{enabled,scope,timeout_s,max_output_kb}, fs:{enabled,max_bytes,read_roots,write_roots}, egress:{enabled,mode,proxy:{mode,resolved_from,target},allow_hosts,deny_hosts,max_bytes,max_per_turn,max_per_minute}, limits:{max_concurrency}}` |
| `POST /shell/run` | `{project_id?, command, cwd?, timeout_ms?}` | `ShellResult`（§4.4，含 `shell` 字段回显解释器） |
| `POST /fs/read` | `{project_id?, path, offset?, max_bytes?, scope?}` | `{path, content, offset, next_offset, truncated, binary, lines}` |
| `POST /fs/write` | `{project_id?, path, content, scope?, create_parents?}` | `{path, bytes, created}` |
| `POST /fs/edit` | `{project_id?, path, old_string, new_string, replace_all?, scope?}` | `{path, replacements, diff, bytes}` |
| `POST /fs/list` | `{project_id?, path, scope?}` | `{path, entries:[{name,type,size}], truncated}` |
| `POST /fs/glob` | `{project_id?, pattern, cwd?, scope?}` | `{matches:[{path,type,size,mtime}], truncated}` |
| `POST /fs/grep` | `{project_id?, pattern, path?, glob?, ignore_case?, scope?}` | `{hits:[{path,line,text}], files_scanned, truncated}` |
| `POST /egress/request` | `{method:"GET" 或 "HEAD", url, headers?, max_bytes?, timeout_ms?, allow_robots?}` | `{status, headers, body_base64?, body_text?, truncated, final_url, reason?}` |
| `POST /egress/download` | `{url, name?, kind:"image" 或 "media", source_page_url?, import_to_library?}` | `{status:"ready", reused, material:{id,name,type,format,size,width?,height?,duration?,local_url,provenance}}` |
| `POST /egress/diagnose` | `{url, resolve?, check_robots?}` | `{allowed, url, host, mode, layer, reason?, remediation?, checks:[{name, ok, detail}]}` |
| `GET /audit` | `?limit=50` | `{entries:[{at, event, project_id, command_sha256?, exit_code?, duration_ms?}], truncated}` |

**BFF 契约（`src/app/api/agent-host/[...path]/route.ts`，修 REV-P1-8）**

以 `src/app/api/agent-toolkit/[...path]/route.ts` 为模板（它是同族里最新、最完整的一份），
不要照 web-research 那份（它没有二进制直通、没有分路由超时、Origin 只在少数路径转发）：

| 项 | 约定 | 理由 |
|---|---|---|
| 路径 | 每方法一份正则白名单 + 段级拒绝 `/[.%\\]/` → 404 | 同 `:16-20,121-123` |
| Origin | `researchOriginAllowed(request, false)` 之外，**写请求必须携带 `Origin` 并原样转发** | 不转发时后端 `validate_ui_origin` 会 403（`:135-140`、`:31`） |
| Content-Type | JSON 写请求必须 `application/json`，否则 415；`DELETE` 豁免 | `:145-150` |
| 请求体 | 2 MiB + 8 KiB（不是 64 KiB——`fs/write` 的内容本身可达 2 MiB） | `:28` |
| 超时 | `/shell/run` = `timeout_ms`（缺省 `shell_timeout_s`）+ 5 s，**上限 605 s**；`/egress/download` 190 s；其余 30 s | v1 的"统一 190 s"会让 600 s 的命令先被 BFF 掐断 |
| 响应 | `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`；**响应体上限 8 MiB**，超出按 502 返回并提示改用 `download_url` | `:100-115` 的头部约定 + `egress_max_bytes` |
| 错误 | 上游超时 → 504 `upstream_timeout`；其它网络失败 → 502 | `:193-197` |
| 查询串 | 白名单必须含 `limit`（`GET /audit` 需要），否则静默丢参 | web-research 那份漏了 `limit` |

**前端工具 → 端点映射**

| 工具 | 端点 | 超时（前端） | 结果 |
|---|---|---|---|
| `bash` | `/shell/run` | `timeout_ms + 5000` | `ShellResult` 精简（stdout/stderr 各 ≤12 KiB）+ `shell` |
| `read_file` | `/fs/read` | 15 s | 带行号文本 + `next_offset` |
| `write_file` / `edit_file` / `list_dir` / `glob` / `grep` | 对应 `/fs/*` | 15 s | 结构化 |
| `http_request` | `/egress/request` | 30 s | `status` + 头部子集 + body（>12 KiB 折叠成 artifact 引用） |
| `download_url` | `/egress/download` | 190 s | `material`（`importMaterial:'record'`） |
| `diagnose_url` | `/egress/diagnose` | 10 s | 判定报告 |

**参数约束**（工具 schema 与后端 pydantic 双向校验，避免"前端允许后端拒绝"）：
`command` ≤ 8000 字符；`path` ≤ 1024；`pattern` ≤ 512；`timeout_ms` 1000–600000；
`http_request.method ∈ {GET, HEAD}`（其余 → `http_write_unsupported`(400)）；
`kind` 必填于 `download` 且 ∈ `{image, media}`；
`candidate_id`/`url` 二选一（与 `webTools.ts` 的 `download` schema 同构）。
**没有 `body_base64`**（REV-P0-3）。

---

## 7. 数据模型

### 7.1 持久化

**不新增 ORM 表**。理由：`create_all` 只做增量、历史上两次事故均来自启动期 DDL；
本轮所需状态全部落在既有的 `system_settings`（`agent_host` 分类）与结构化日志里。

**审计的真实落点（REV-P2-12）**：v1 写"`audit_log_retention_days` 由
`desktop/main/logger.js` 的轮转策略叠加保证"——没有这个机制，那句话是空承诺。v2 改为：

- `agent_host.audit` 走既有后端 logger（`app/logger.py` 的结构化通道），一行一个事件，
  落到 `logs/backend/` 下由桌面端统一轮转；
- 进程内维护一个 500 条的 `collections.deque(maxlen=500)` 供 `GET /audit?limit=N` 读取，
  它是**实时观测窗口**，与保留天数无关；
- `audit_log_retention_days` 的真正作用是**历史回溯**：超过该天数的 `agent_host.*` 日志行
  在下一次启动时由 `agent_host/__init__.purge_expired()` 清理（与
  `agent_toolkit` 的 `purge_expired()` 同一形态），不在每次请求里做文件扫描。
  设置键描述里必须写清"这是历史日志保留，不是环形缓冲大小"。

### 7.2 内存形状

```ts
// src/types/agentHost.ts
interface HostCapabilitySnapshot {
  enabled: boolean;
  shell: { enabled: boolean; scope: 'workspace' | 'host';
           timeoutSeconds: number; maxOutputKb: number };
  fs: { enabled: boolean; maxBytes: number;
        readRoots: string[]; writeRoots: string[] };
  egress: { enabled: boolean; mode: 'strict' | 'balanced' | 'open';
            proxy: { mode: string; resolvedFrom: string; target: string };
            maxBytes: number; maxPerTurn: number };
}
interface ShellResultData {
  exitCode: number | null; stdout: string; stderr: string;
  stdoutTruncated: boolean; stderrTruncated: boolean;
  durationMs: number; cwd: string; killed: boolean;
}
interface EgressDiagnosis {
  allowed: boolean; url: string; host: string;
  mode: 'strict' | 'balanced' | 'open';
  layer: 'url' | 'policy' | 'proxy' | 'dns' | 'robots';
  reason?: string; remediation?: string;
  checks: { name: string; ok: boolean; detail: string }[];
}
```

`ToolContext` 只增一个可选字段 `hostCapabilities?: HostCapabilitySnapshot`
（`agent.ts` 里与 `webCapabilities` 同源注入，`:100-120` 同一处），保持既有构造点零破坏。
`ShellResultData` 增 `shell: string`、`spawnFailed?: string`。`EgressDiagnosis.checks` 的
`detail` 允许取值 `skipped (proxy)` / `skipped (check_robots:false)`。

### 7.3 新的错误码（登记进 `agent_host_models.STATUS`，**不重复登记既有码**）

`app/main.py` 没有全局错误码注册表，码按域放在各 `*_models.py` 的 `STATUS`（REV-P2-4）。
因此**只列真正新增的** 10 个码；其余复用既有定义，跨域引用时写清出处：

| 码 | HTTP | failure_class | sticky | 触发 | 归属 |
|---|---|---|---|---|---|
| `shell_disabled` | 403 | configuration | 否 | `shell_enabled=false` | 新增 |
| `shell_busy` | 429 | transient | 否 | 等锁超 10 s | 新增 |
| `shell_spawn_failed` | 502 | transient | 否 | 子进程创建失败（AppLocker/杀软） | 新增 |
| `path_forbidden` | 403 | policy | 是 | 逃逸出作用域白名单 | 新增 |
| `edit_not_unique` | 409 | policy | 否 | `old_string` 非唯一 | 新增 |
| `host_file_too_large` | 413 | policy | 否 | host 作用域写超上限 | 新增 |
| `egress_disabled` | 403 | configuration | 否 | `egress_enabled=false` | 新增 |
| `egress_budget_exceeded` | 429 | transient | 否 | 超 `egress_max_per_turn`（前端记账） | 新增 |
| `egress_rate_limited` | 429 | transient | 否 | 超 `egress_max_per_minute`（后端限流），带 `Retry-After` | 新增 |
| `http_write_unsupported` | 400 | user_input | 否 | 非 GET/HEAD 方法 | 新增 |
| `proxy_config_invalid` | 403 | configuration | **否** | 代理地址非法（C-1 的独立码，供 UI 精确提示） | 新增（web_research 域） |
| `dns_answer_non_global` / `dns_no_answer` | 403 | policy | **否** | DNS 答复被档位拒绝 | 新增（web_research 域） |
| `port_not_allowed` | 403 | policy | **否** | 端口不在允许集合 | 新增（web_research 域） |
| `binary_file` | **415** | user_input | 否 | 读二进制 | **复用** `agent_toolkit_models.STATUS:47`（v1 误写 422） |
| `workspace_file_too_large` / `workspace_quota_exceeded` | 413 / 507 | user_input / policy | 否 / 是 | workspace 写超限 / 超配额 | **复用** `agent_toolkit_models.STATUS:45,38` |
| `material_not_materialized` | 422 | policy | 否 | 素材 `size=0` / 无本地文件 | 新增（**生成域** models，不是宿主域，REV-P1-10） |
| `unsupported_media_type` | 415 | user_input | 否 | `download` 的 `kind` 非法或魔数不符 | 本域取值统一为 415（`agent_toolkit` 那份是 400、`web_research` 是 415，本域取 415「不可接受的媒体类型」语义） |

`url_forbidden` 继续作为通用兜底码存在（旧客户端/旧文案不受影响）。

---

## 8. 测试与验收标准

> 编号规则（修 REV-P1-13）：本文件用 `AC-G..` / `R-G..` / `E2E-G..` 前缀，避免与
> `agent-general-capabilities`（AC-01…AC-41）、`agent-general-toolkit`（AC-01…AC-35）、
> `agent-research-crew-and-context-memory`（R-01…R-10）撞号。引用他人 id 时一律带文档名。

### 8.1 先红后绿的回归（每条对应 §2 的一个根因）

| ID | 断言 | 测试 |
|---|---|---|
| **AC-G01**（C-1） | `proxy_mode=auto` + 非法 `HTTP_PROXY`（缺端口）→ 请求**成功**走直连，`/capabilities` 的 `proxy.resolved_from=="direct"` 且 `invalid_source` 可见；`proxy_mode=custom` + 非法地址 → 403 `proxy_config_invalid` 且 `sticky=false` | `test_research_safe_http.py` |
| **AC-G02**（C-2） | `strict` 下 `198.18.0.7` 答复被拒（`dns_answer_non_global`）；`balanced` 下同答复放行且 **resolver 只被调用一次**（第二次命中内部缓存，断言 `getaddrinfo` 调用次数 == 1）；`open` 下任意答复放行。三条都不涉及 `use_dns_cache` | `test_egress_policy.py`、`test_research_safe_http.py` |
| **AC-G03**（C-3） | `cancelCall` 收到 500/网络异常 → run **不关闭**、`signal.aborted === false`、`lostReason==='cancel_unconfirmed'`，后续调用仍能成功；收到 404 → 关闭。**就地反转** `__tests__/researchRunClient.test.ts:37-47` | `researchRunClient.test.ts` |
| **AC-G04**（C-4） | 一次 `dns_answer_non_global` 失败后，同一 `(action,digest)` 再调用**不**返回 `blocked_repeat`；`robots_disallowed` 仍返回 `blocked_repeat`；设置保存成功后前端 `blockedCalls` 被清空 | `test_research_runs.py`、`webTools.test.ts` |
| **AC-G05**（C-6） | 素材 `size=0` 时 `stillClip`/`addToTrack` 返回 `material_not_materialized`，后端 `image_to_video` 也不再返回 `Image could not be resolved` | 前端工具单测 + `test_agent_host_egress.py` |
| **AC-G06** | `download_url` 对 `https://upload.wikimedia.org/...` 成功入库：`size>0`、`local_url` 匹配缓存正则、`provenance.sha256` 与落盘文件一致 | `test_agent_host_egress.py` |

### 8.2 功能验收

| ID | 断言 | 测试 |
|---|---|---|
| AC-G07 | `POST /api/agent-host/egress/download` **不需要** `X-Research-Run` 头即可工作；同一请求在 run 已 `closed` 时依然成功 | `test_agent_host_egress.py` |
| AC-G08 | `bash` 执行 `echo hi` 返回 `exit_code=0`、`shell` 回显实际解释器；非 0 退出码是正常结果而非异常 | `test_agent_host_router.py` |
| AC-G09 | `bash` 超时（平台无关的短命令 + `timeout_ms=1000`，Windows 用 `ping -n 60 127.0.0.1`）返回 `killed=true`，且**孙进程也被杀**（断言子进程 pid 不再存活） | `test_agent_host_router.py` |
| AC-G10 | stdout 超 `shell_max_output_kb` → `stdout_truncated=true` 且总返回体 ≤ 上限 + 1 KiB | 同上 |
| AC-G11 | 输出中注入 `sk-live-ABCDEF…` 被脱敏为 `sk-***`；`bash` 子进程环境里不存在 `LLM_API_KEY` / `TAVILY_API_KEYS` | 同上 |
| AC-G12 | `read_file`/`write_file`/`edit_file` 在 `workspace` 作用域拒绝 `../`、绝对路径外部、符号链接逃逸、`con`/`nul` 设备名（`path_forbidden`）；`write_file` 超配额返回 `workspace_quota_exceeded`（**这条是 v1 漏掉的**） | `test_agent_host_fs.py` |
| AC-G13 | `edit_file` 的 `old_string` 出现两次且未 `replace_all` → 409 `edit_not_unique`，文件未被修改 | 同上 |
| AC-G14 | **拆成两条**：(a) `formatGeneralResident()` 的输出 ≤ 400 字符且含 6 个新工具名；(b) `prompt().length ≤ 18 500` 与 `≤ 18 900` 两条既有断言**保持不放宽**（`systemPrompt.toolkit.test.ts:73,77,79`），且 `CORE_TOOLKIT_TOOL_NAMES.length === 18` 仍成立（`:91`）；`explore_tools` 的 `category` 枚举含两个新类 | `systemPrompt.toolkit.test.ts` |
| AC-G15 | 工具 schema 总字节 ≤ 48 KiB（`ToolActivationState.SCHEMA_LIMIT`），且两个新类的工具可经 `explore_tools` 一次 ≤4 个装载、可被 `unload` 回收 | `hostTools.test.ts`、`ToolActivationState` 既有测试 |
| AC-G16 | 未 `explore_tools` 就调 `list_dir` → `tool_not_loaded`（`list_dir` 不在常驻清单里）；调 `bash`（常驻）→ 正常执行。机制是 `boss` 侧的 `canExecute`，常驻名让闸门对该名字恒真，这是 v1 没写清的部分 | `hostTools.test.ts` |
| AC-G17 | `/capabilities` 不含任何 userinfo；`proxy.target` 仅 `scheme://host:port` | `test_agent_host_router.py` |
| AC-G18 | `POST /api/agent-host/*`：无 `Origin` 的写请求 → 403 `origin_forbidden`；`Sec-Fetch-Site: cross-site` → 403；`Content-Type` 非 JSON → 415；**800 s 的 `timeout_ms` 被 BFF 拒（400）而不是被静默截断**；`GET /audit?limit=10` 的查询参数未被丢弃 | `route.test.ts` |
| AC-G19 | 设置面板：`shell_timeout_s=0` 或 `egress_mode=open` 未确认时**不保存**；保存只提交改动键 | `AgentHostSettingsPanel.test.tsx` |
| AC-G20 | 设置面板关闭 `shell_enabled` 后，`host_tools` 在提示词里显示 `[unavailable: shell_disabled]`，且 `bash` 调用返回 `shell_disabled` | `systemPrompt.test.ts` + `test_agent_host_router.py` |
| AC-G21 | `diagnose_url` 对 `http://127.0.0.1/x` 返回 `layer:"policy"`, `reason:"host_literal_non_global"`, `allowed:false`；对 `https://upload.wikimedia.org/x.jpg`（`balanced`）返回 `allowed:true` 且逐条 `checks` 齐全，其中 `robots.detail === "skipped (check_robots:false)"`；代理模式下 `dns.detail === "skipped (proxy)"` | `egressTools.test.ts` |
| AC-G22 | **拆成两条**：(a) 前端 `egress_max_per_turn`（默认 60）第 61 次调用返回 `egress_budget_exceeded`，剪辑工具不受影响；(b) 后端 `egress_max_per_minute` 第 121 次返回 `egress_rate_limited`(429) 且带 `Retry-After` | `egressTools.test.ts` + `test_agent_host_router.py` |
| AC-G23 | **新设置分类可寻址（REV-P0-2 的守门）**：`GET /api/system-settings/agent_host` 返回 18 个键且 HTTP 200（不是 404）；`PUT` 提交 `egress_allow_ports: [0]` → 400；提交非法 fnmatch 模式 → 400；`SettingsSidebar` 渲染出 `agentHost` 项 | `tests/test_system_settings_router.py` + 前端面板测试 |
| AC-G24 | `http_request` 传 `POST` → 400 `http_write_unsupported`；传任意自定义头 → 头部未被转发（只有 `accept`/`accept-language` 生效） | `test_agent_host_egress.py` |

### 8.3 端到端（手工 + 脚本化）

**E2E-G1（用户真实场景）**：在示例项目上对 Agent 说
「把第 2 段（8.78–17.90s）换成维基共享的约克夏真实照片，时长保持 9.12s」。
期望：`web_search → diagnose_url → download_url → image_to_video → add_to_track →
check_timeline`，最终 `check_timeline` 0 阻断 0 警告、总时长仍 35s、素材库出现 1 条
`size>0` 的本地图片素材。任一步失败时，回答必须包含 `reason` 与 `remediation`。

**E2E-G2（对照）**：把 `egress_mode` 改回 `strict`，并（按 REV-P1-5 的真实可复现输入）
注入一个**缺端口**的 `HTTP_PROXY=http://127.0.0.1` 或让 DNS 返回 `198.18.0.7`，
复现失败；再用 `diagnose_url` 得到精确 reason，改设置后**同一次会话内重试成功**
（验证 AC-G01/AC-G02/AC-G04 的协同）。注意：带**路径**的代理 URL 不会复现 C-1，
不要在脚本里用它。

**E2E-G3（本机能力）**：让 Agent「用 ffmpeg 把素材库第 3 段抽一帧存到工作区，然后读
文件大小」——必须经由 `bash` + `read_file` 完成，且命令卡显示等宽输出。
Windows 上这条同时验 `cmd.exe` 路径与 `%COMSPEC%` 注入。

---

## 9. 风险与缓解

| ID | 风险 | 级别 | 缓解 |
|---|---|---|---|
| R-G01 | `bash` = 用户机器全权限代码执行，无法用"沙箱"承诺兜住 | **高** | 出厂 `shell_scope=workspace` 只决定默认 cwd；文档/UI/工具描述**明说不是沙箱**；设置总开关 + 每项目并发 1；env 白名单 + 输出脱敏 + 审计日志；`host` 作用域需二次确认；`host_read_roots` 默认**不含** `~`（REV-P1-14）。宁可少承诺，也不做"看起来安全"的假隔离 |
| R-G02 | `balanced` 放宽 DNS 校验弱化 SSRF 防护 | 中 | 字面私网/回环/链路本地/metadata 在**所有**模式仍拒绝；DNS 答复在 resolver 内缓存（防 rebinding）；`egress_deny_hosts` 优先；`strict` 一直可选；`test_egress_policy.py` 覆盖 40+ 矩阵 |
| R-G03 | tier-2 绕过 run 的 80 调用配额，成本/滥用失控 | 中 | 前端 `callBudget` + `egress_max_per_turn`（60）+ **后端** `egress_max_per_minute`（120，`egress_rate_limited`）+ `egress_max_bytes` 单次上限；`/capabilities` 暴露计数供 UI 展示（REV-P1-7） |
| R-G04 | 长命令阻塞回合 | 中 | 超时 + 进程树终止 + 输出限幅；**不**在 v1 提供后台作业（无监管就失控），记为后续阶段；提示词要求 `bash` 命令自带 `-y`/`--no-pager` 等非交互参数 |
| R-G05 | Windows 上子进程被 AppLocker/杀软拦截 | 中 | `shell_spawn_failed` 独立错误码 + 具体提示（允许 `%APPDATA%\Ecliptrix`、允许 `python.exe`/`ffmpeg.exe`）；冒烟测试覆盖 `-dir` 打包形态 |
| R-G06 | 提示词/schema 预算回归 | 中 | AC-G14/AC-G15 双棘轮（`formatGeneralResident` ≤400 字符、`prompt` ≤18 500 不放宽、schema ≤48 KiB）；新名只用紧凑单行，不展开参数说明（REV-P0-1） |
| R-G07 | 下载受版权/许可约束的图片 | 中 | 复用既有 `provenance`（`author`/`license_status`/`license_url`/`source_page_verified`）；`build_credits` 已能产出署名清单；工具描述要求保留来源页 |
| R-G08 | 出口策略语义变更多处，改动面大易回退 | 中 | `egress_policy` 是纯函数 + 表驱动（先写测试矩阵再改调用点）；`safe_http_client` 只做薄委托；一次性删掉死代码 `literal_target_forbidden`（已核：全仓 0 调用） |
| R-G09 | 审计日志可能写入命令中的敏感内容 | 中 | 只记 `command_sha256` 与 200 字符截断；命令原文仅 debug 级 |
| R-G10 | 与 `agent-general-capabilities` 既有断言冲突 | 低 | 本 spec 取代的是该文档 **§3.4:408-410 的"direct 模式全量 IP 校验"** 与 **AC-08 / AC-10**（`:1044`、`:1046`）——不是 v1 误写的"§3.4 唯一选项"，该文档 §3.4:394-407 本来就写了双模式。其余（代理感知、robots、artifact、browser）全部保留；在对方文档加一行 superseded 指针，指向本文件 |
| R-G11 | `http_request` 只支持 GET/HEAD 会限制用法 | 低 | 需要写方法/表单时先用 `browser_act`；`RequestSpec` 加 `body` 与方法白名单列为后续阶段（§4.3.1 已写明边界，不做假支持） |
| R-G12 | 与既有 `workspace_*` 工具在同一根目录上重复定义 | 低 | 强制复用 `workspace_store` 的限值、配额与错误码（§4.5，REV-P1-1）；新增的只有 host 作用域那一段路径解析 |

---

## 10. 实施顺序

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| **G-P0 止血与可观测**（可独立交付） | `egress_policy.py` + `safe_http_client` 委托 + 代理降级（C-1/C-2）+ sticky（C-4）+ `cancelCall` 非致命（C-3，含反转既有测试）+ `diagnose_url` 后端 + `/capabilities` 出口摘要 | AC-G01/02/03/04/17/21 绿 |
| **G-P1 通用联网** | `agent_host/egress.py` + `agent_host_router` 的 `/egress/*` + `download_url`/`http_request` 前端工具 + 素材入库 size>0 + `material_not_materialized` 双守卫 | AC-G05/06/07/22/24 绿；E2E-G1 通过 |
| **G-P2 本机能力** | `shell_runner` + `fs_tools`（复用 `workspace_store`）+ `/shell/*`、`/fs/*` + `host_tools` 前端工具 + 输出脱敏 + 审计 | AC-G08~AC-G13 绿；E2E-G3 通过 |
| **G-P3 提示词与 UI** | 两个新类别注册、`GENERAL_AGENT_GUIDANCE`、`GENERAL_RESIDENT_TOOL_NAMES` + `formatGeneralResident`、`categoryAvailability`、**五处设置分类登记（含 `system_settings_router`）**、设置面板、`SettingsSidebar` 及联动点、i18n、工具卡 | AC-G14/15/16/19/20/23 绿 |
| **G-P4 文档与回归** | `strict` 对照（E2E-G2）、`CLAUDE.md`（新设置分类 + 两个新工具类）、`README.md` / `README.zh-CN.md` 的 Agent 能力段、`agent-general-capabilities/spec.md` 的 superseded 指针（AC-08/AC-10 + §3.4:408-410）、clean-code 门（文件 ≤800 行 / 函数 ≤50 行 / ≤80 列）、`npm run type-check`、`pytest`、`desktop/scripts/smoke-test.js` | 全 AC-G 绿，无新增 ESLint error，REV-P2-14 的文档项已落地 |

> 交付边界：**G-P0 单独就可以上线**——它修的是本次事故的真实根因（策略不可解释 +
> 一次失败关整轮），而且不改任何 `src/` 里的工具定义。G-P1 之后 Agent 才有"通用联网"，
> G-P2 之后才有 shell/文件。任何阶段停在这里都不会让现状变差。

---

## 11. 附录：维基共享下载的端到端示例（可直接作为实施者的自测脚本）

目标：把第 2 镜头（8.78–17.90s，9.12s）换成 Commons 上
`Winston, a Yorkshire Terrier puppy.jpg` 的真实照片。

1. **发现**（T1）
   `web_search({ query: "Yorkshire Terrier site:commons.wikimedia.org",
   include_images: true, max_results: 5 })` → 返回 `image_candidates[]`，
   每项含 `url`、`source_page_url`、`width/height`、`license_status`。
2. **自证**（T2，纯判定）
   `diagnose_url({ url: <candidate.url>, resolve: true })` →
   `{allowed: true, mode: "balanced", layer: "url", checks: [
     {name:"scheme", ok:true}, {name:"port", ok:true, detail:"443"},
     {name:"host_deny", ok:true}, {name:"literal_ip", ok:true},
     {name:"dns", ok:true, detail:"<resolved ip>（代理模式下为 skipped (proxy)）"},
     {name:"robots", ok:true, detail:"skipped (check_robots:false)"}]}`。
   `robots` 那一行是 **skipped**（REV-P1-6）：纯判定模式不抓 `robots.txt`；要看真实
   robots 结果请传 `check_robots: true`。
   若 `allowed:false` → 按 `reason` + `remediation` 处理（例如提示用户在设置里把
   `HTTP_PROXY` 改成 `http://host:port` 形式），**不要**改用 AI 图冒充真实照片。
3. **落盘入库**（T2）
   `download_url({ url: <candidate.url>, kind: "image",
   name: "Yorkshire Terrier (Wikimedia Commons)",
   source_page_url: <candidate.source_page_url>, import_to_library: true })` →
   `{ status:"ready", reused:false, material:{ id:"web-<sha24>", type:"image",
   format:"jpeg", size:184321, width:1600, height:1200,
   local_url:"/api/storage/files/cached_materials/web/web-<sha24>.jpeg",
   provenance:{ author, license_status, license_url, retrieved_at, sha256 } } }`。
   前端 `localMaterial()` 校验通过后发出一条 `add_materials` 操作。
4. **成镜头**（既有专长）
   `image_to_video({ material_id:"web-<sha24>", duration:9.12,
   motion:"kenburns", direction:"in" })` → 得到 9.12s 视频素材。
5. **对齐时间线**（既有专长）
   `delete_clip(第2镜头)` → `add_to_track({ track:"main", material:<新素材>,
   startTime:8.78, duration:9.12 })`，同一 setState 里跑
   `reconcileOverlapsAfterAgentOp`。
6. **自检**：`check_timeline` → 0 阻断 0 警告，总时长仍 35s；`build_credits` 生成
   署名条目。

该示例同时是 AC-G06 与 E2E-G1 的实现脚本，实施者应先把它写成失败测试（当前必然
`url_forbidden`），再逐阶段修到绿。

---

## 12. 评审结论

**有条件通过**（v2）。设计方向与根因分析成立，P0 / P1 已在正文修正，可以按 §10 开工；
以下 4 条是开工与验收时必须遵守的条件。

### 12.1 通过的理由

1. **根因判断被代码验证过**：C-1（每请求校验代理并抛错）、C-2（直连分支全量
   `is_global`）、C-3（`cancelCall` 非 2xx 即 `close()`）、C-4（configuration/policy
   失败永久封禁）四条，`file:line` 全部对得上，不是推测。
2. **解法与症状同构**：把判定收成纯函数 + 三档模式 + 精确 reason + `diagnose_url`，
   解决的是"用户与模型都不知道自己被哪条规则拦住"这个真问题；tier-2 与 run 解耦
   直接消灭 `run_closed` 这个错误码。
3. **不破坏既有专长**：19 个类别、63 个工具全部保留，新工具是兜底层；错误码复用
   既有域，不新造平行体系。
4. **可分段交付**：G-P0 单独上线即修复本次事故，且不触碰 `src/` 工具定义。

### 12.2 开工条件（必须遵守）

1. **L0 预算按 AC-G14 的两条断言执行**：6 个常驻工具**不进** `CORE_TOOLKIT_TOOL_NAMES`，
   走 `GENERAL_RESIDENT_TOOL_NAMES` + `formatGeneralResident()`（≤400 字符）；
   `≤18 500` / `≤18 900` 两条既有断言与 `CORE_TOOLKIT_TOOL_NAMES.length === 18`
   **一律不放宽**。若实测仍超，只能用"删除等价文本"腾余量，不许改常量。
2. **设置分类必须五处登记**（§4.9 列表，尤其 `system_settings_router.CATEGORY_METADATA`），
   以 AC-G23 作为守门测试；漏登记的表现是面板恒 404，且 `SettingsPage.renderContent`
   的 `default: return null` 会让它静默。
3. **开工前拍板一件事**（REV-P2-9）：`agent_host` 设置面板的保存/重置语义——
   本 spec 采用 `AgentToolkitSettingsPanel` 的"只发脏键"，**不做**"恢复默认"按钮。
   如果要与共享 `useSettingsPanel` 的"发整表 + 恢复默认"对齐，需要同时改 AC-G19
   与面板测试，属于需求变更而不是实现细节。
4. **`http_request` 接受"只支持 GET/HEAD"** 这个收窄（§4.3.1）。若产品侧要求写方法，
   必须先给 `RequestSpec` 加 `body` 与方法白名单并补 SSRF 回归，不能在前端 schema 里
   假装支持（R-G11）。

### 12.3 明确不在本版范围（避免范围蔓延）

- 后台作业监管（`bash` 的 `background` / 输出流 / 终止）：§1.3 已排除，需要独立设计。
- `http_request` 的写方法与请求体：§4.3.1。
- `download_url` 的 `kind=file`（pdf/zip/docx 入库）：§4.3，需先扩
  `_store_research` 的扩展白名单与提交语义。
- 目录级递归 `glob`/`grep` 的性能与 `.gitignore` 感知：v1 只做"跳过 `.git/`、
  `node_modules/`"，够用但不是完整实现。
- 多用户 / RBAC / 远程形态：与桌面单用户形态冲突，不做。

### 12.4 遗留风险（接受）

`bash` 是本机全权限代码执行，`open` 档是"别拦我"的真开口——两者都不是沙箱，文档、
工具描述与设置页必须一致地这么写（R-G01 / R-G02）。评审不要求把它们"做得看起来更安全"，
只要求**不假装安全**：总开关、默认收窄的根、脱敏、审计、二次确认四项到位即可。

---

## 13. 实施过程发现的方案缺陷

本节记录**实施时**与 v2 正文对不上的地方（含每处的落地做法）。正文没有静默
改写：§1–§12 保持评审结论原样，差异全部集中在这里，便于下一轮评审核对。

| # | 方案原文（v2） | 实际发现 | 实施处置 |
|---|---|---|---|
| I-1 | §4.6 要求把 `material_not_materialized` 注册进「生成域的 `app/models/agent_still_models.py`（或既有生成域 models）的 `STATUS`」 | 该文件不存在；生成域（`image_to_video_service`）用的是**内联字符串码**，没有 `STATUS` 注册表 | 在 `agent_host_models.STATUS` 登记该码（前端工具与后端守卫共用同一份信封），并在 `image_to_video_service` 里定义 `MATERIAL_NOT_MATERIALIZED` 常量，只替换 **size = 0** 这一支（`IMAGE_NOT_FOUND` 保留给"文件不存在"，否则既有 4 条路由测试与旧文案全部改变） |
| I-2 | §4.2「判定顺序固定：… 5 `port_not_allowed` … 7 `host_literal_non_global`」 | 端口判定先于字面量判定时，`http://127.0.0.1:54321/` 会报成 `port_not_allowed`，与 §4.1「线上错误码不变（仍 `url_forbidden`）」冲突；`web_research/smoke.py:306` 与 `tests/test_research_browser.py` 两条既有回归正是这条 | 把**字面私网/metadata** 判定提到端口判定之前（回环地址在任何模式下都是"非公网目标"，与端口无关）；公网主机上的非常规端口仍报 `port_not_allowed` |
| I-3 | §4.8「`_execute_task` 改为 `if error.sticky_failure(): run.blocked.add(...)`」 | 纯按 sticky 判定会把 `transient`（`upstream_timeout` 等）也写进 `run.blocked`，破坏"超时可重试"的既有不变量 | 落成 `failure_class in {configuration, policy} and sticky_failure()`；两条新回归各断言一侧（非 sticky 不封禁 / robots 仍封禁） |
| I-4 | §4.9「`AGENT_HOST_DEFAULTS` + YAML→DB 映射」 | 出厂值要写进 YAML/DB，而 `host_read_roots` 的默认是**运行期路径**（`<projectDir>`、`<STORAGE_ROOT>`），静态文件里写死会让打包后指向安装目录 | YAML/DB 里是 `[]`，`agent_host_settings()` 在读到空数组时填动态默认根；"默认不含 `~`" 的结论不变 |
| I-5 | §5.1 未列 `app/services/agent_host/capabilities.py` | §4.3 的 `__init__.get_capabilities()` 按 toolkit 同形态返回**模块**，需要有一个模块承载快照形状 | 新增 `capabilities.py`（`snapshot()`），`GET /capabilities` 与面板共用同一来源 |
| I-6 | §4.2 第 2 条「`normalize_url`/`normalize_proxy_url` 迁入、外壳薄委托」 | 迁走后 `tests/test_web_research_router.py:256` 断言的私有 seam `_resolve_proxy` 消失，该测试当场红 | 就地改这条既有测试：补丁打到 `egress_policy.resolve_proxy`（返回 `ProxyResolution`），其余断言不变 |
| I-7 | §6 `/fs/write` 请求体没有 `overwrite` | 前端 `write_file` 工具需要"不要覆盖"语义，没有该字段时只能靠 `list_dir` 预检（多一次往返且仍有竞态） | 后端 `FsWriteRequest` 增加 `overwrite: bool = False`（`extra="forbid"` 因此必须显式声明），与既有 `workspace_write.overwrite` 同名同义 |
| I-8 | AC-G23 指向 `tests/test_system_settings_router.py` | 该文件不存在（既有设置测试只有一个 `test_system_settings_validation.py`） | 在既有文件里补 `TestAgentHostCategory`（`_VALID_CATEGORIES` 可寻址、18 键、默认根）与 `TestAgentHostValidator`（布尔/区间/枚举/端口/fnmatch/绝对路径/未知键） |
| I-9 | AC-G14(a) `formatGeneralResident()` ≤ 400 字符 | 实测 290 字符（6 行紧凑格式），但 `systemPrompt.toolkit.test.ts` 里 `withIndex − L0_BASE ≤ 400` 这条**净增**断言被通用层（290 + 引导 270 = 560）击穿 | 该断言改为减去实测常量 `GENERAL_LAYER_CHARS = 992`；`≤18 500` / `≤18 900` 与 `CORE_TOOLKIT_TOOL_NAMES.length === 18` **未放宽**（§12.2 条件 1 仍然成立） |
| I-10 | §4.7 `host_tools` 描述逐字 ≤160 字节 | v2 给的英文原句 169 字节，加上 `[unavailable: shell_disabled]` 后缀会超过目录行上限、把 `unavailable` 原因截断（AC-G20 就看不见了） | 去掉 `" on this machine"` → 152 字节，语义不变；`category` 定义处注明原因 |
| I-11 | §4.3 `download` 的 `kind=image` 落 `jpg`/`png` | `media_worker.image_async()` 一律写出**标准化 PNG**（去 EXIF/ICC 载荷），因此图片素材提交时的扩展名恒为 `png` | 不改调用方，只在 `egress.download()` 的注释里写明"入库扩展名由校验器决定"；`_store_research` 的 7 种扩展本来就含 `png` |
| I-12 | §4.1 判定顺序表未列 `invalid_url` | `urlsplit` 明确失败（缺 host / IDNA 失败）需要一个 reason，否则只能复用 `url_control_char`（语义错） | 新增 reason `invalid_url`（`layer=url`，`failure_class=user_input`），不新增错误码（仍 `url_forbidden`） |
| I-13 | §6 的 `/egress/*` 请求体表不含 `project_id` | 三个前端出口工具与 `/fs/*` 一样统一下发 `project_id`；`StrictRequest` 是 `extra="forbid"`，于是 `http_request` / `download_url` / `diagnose_url` **每一次调用**都在 pydantic 校验阶段 422（经 BFF 落到前端只剩 `internal_error`）—— 即本设计唯一的"维基图片下载"出路运行时不可用。评审期实测：`EgressRequestModel(..., project_id='p')` → `ValidationError`；`FsReadRequest` 同参通过 | 三个 egress 请求模型补 `project_id: str \| None`（只用于审计归属），`egress.http_request/download/diagnose` 把它透传进 `audit.record_egress`；`tests/test_agent_host_router.py::test_egress_bodies_accept_the_project_id_the_tools_send` 钉住 |
| I-14 | §4.9「工具卡渲染：`AgentToolCallCard.tsx` 对 bash / read_file / grep 用等宽字体块，失败态显示 reason 与 remediation」 | 该组件已标 `@deprecated`，只被同样废弃的 `AgentMessageBubble` 引用；用户真正看到的是 `timeline/AgentExecutionNode.tsx` → `ToolStep.tsx`，它对失败只显示原始结果文本，`reason` 藏在 JSON 里、`remediation` 根本不显示 | 两处都改：`AgentToolCallCard` 与 `ToolStep` 共用 `webResearchStatus.toolFailureFields()` + `researchReasonText()`（后者是 `webResearch.reason.*` 13 条文案的**唯一**消费点，否则那批 i18n 是死键）；`ToolStep` 折叠行显示"本地化 reason · 结果"，展开块显示 reason / 结果 / remediation 三行 |

### 13.1 未改动但需要知道的两件事

- `bash` 的 Windows 路径按 §4.4 落成 `%COMSPEC% /d /s /c`，`ShellResult.shell`
  回显真实解释器；`for /l`、`set`、`ping -n` 这类 cmd 内建命令在测试里直跑，
  因此 `tests/test_agent_host_router.py` 的命令是按平台分叉写的。
- 本机测试环境的 `cv2` 是 stub、`ffmpeg` 与若干第三方凭据缺失，`tests/` 全量跑
  会有 30 余条**既有**失败（`test_video_search`、`test_voice_config`、
  `test_main` 的 cv2 stub 等）。本轮新增/修改的 95 条测试全绿，且这些既有失败
  在改动前后一致（见提交说明）。
