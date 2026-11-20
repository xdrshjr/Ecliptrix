# SkillRouter 能力中转站接入（统一能力调用机制）设计文档

- 状态：设计 **v2**（已评审，**已实现**，待桌面端真机走查与对 aragon-router 的联调）；v1→v2 变更见「评审记录」
- 目录：`docs/plans/skillrouter-capability-gateway/`
- 中转站：<https://www.skillrouter.net/>（代码参考 `F:\TMP-PROJECTS\aragon-router`，下称「中转站」）
- 适用范围：Ecliptrix 桌面应用（Electron + FastAPI + Next.js 本地三件套）

---

## 评审记录

> 评审人视角：Anthropic 工程评审。依据：`CLAUDE.md`、真实代码（`integration_registry.py`、`credential_errors.py`、`setup_status_service.py`、`model_settings_service.py`、`llm_client.py`、`streamLlmChat.ts`、`wizardSteps.ts`、`ModelSettingsPanel.tsx`、`runCrew.ts`）与 `aragon-router` 源码。
> 已核实成立：`llm_client`/`streamLlmChat` 的 URL 拼接约定（openai→`api_url+/chat/completions`，anthropic→`api_url+/v1/messages`）与 §3.4 的 `api_url` 取值一致；`integration_credentials.value()/resolve()` 为同步内存读取，`is_routed` 可保持同步；`capabilities=()` 对 `_REGISTRY`/`INTEGRATION_CAPABILITIES` 循环安全。

| # | 级别 | 维度 | 问题 | 处理 |
| --- | --- | --- | --- | --- |
| RV-01 | **P1** | 一致性 | §9.1 不变量 3 宣称「`ar-` Key 不进渲染进程」，但既有 `GET /api/model-settings/resolve/{slot}` 返回明文 `api_key`，且 Next 的同名 `createPassthroughRoute` 对浏览器可达（`ModelSettingsPanel.tsx:671` 即从渲染进程调用；`runCrew.ts:63` 依赖其 `api_key`）。覆盖层接入 resolve 后 `ar-` Key 必然经此通道出现，原不变量自相矛盾。 | 已修（§3.4.5、§9.1、AC-12）：不变量改写为可验证的真实边界——新增端点/日志/审计/状态/前端存储零密钥，`ar-` Key 仅经既有回环 resolve 通道交付给服务端与 Agent 调用方（与全部既有 LLM Key 一致）；设置面板不读取 `api_key`；加自动化扫描。 |
| RV-02 | **P1** | 完整性 | LLM 热路径依赖模型目录网络：`get_effective_config` 每次对话都要由 `provider` 判定协议；冷启动/离线/目录为空时 §3.4.3 直接 503，导致已配置用户因中转站目录抖动整条对话链路不可用。 | 已修（§3.2、§3.4）：保存模型选择时同时持久化协议（新字段 `slot_protocols`，服务端写入）；resolve 只读本地快照，不联网；目录仅用于设置界面与「未保存模型」槽位的默认推荐。 |
| RV-03 | **P1** | 一致性/完整性 | 通用 `/api/integrations` 列表与 `/api/integrations/{id}` 读写会自动暴露 `skillrouter`（遍历 `REGISTRY`）：形成第二条写入通道，向导/设置「服务与素材库」还会多出一张无归属卡片，夹具与分组契约测试需额外豁免。 | 已修（§3.2）：`IntegrationSpec` 增加 `internal: bool`，`internal=True` 不出现在通用列表、`serialize_registry` 与通用读写路由（404），唯一写入通道为 `/api/skillrouter`；校验器放在 `integration_credentials_service.save` 内，防御纵深。 |
| RV-04 | **P1** | 可行性/安全 | 资产下载「同源 + 不跟随跨源重定向」与 `httpx` 默认行为冲突；本地开发放行 `http://localhost` 时 Key 可能随重定向泄漏。 | 已修（§3.3）：`RouterClient`/`assets` 一律 `follow_redirects=False`，3xx 仅当 `Location` 同源才手动跟随一次，Key 头仅对同源附带；加测试。 |
| RV-05 | **P1** | 完整性 | 状态接口新增 `unavailable` 状态与 `source='router'`：`CapabilityState`/`CapabilitySource` 是 Pydantic `Literal` 与前端 TS 联合，旧前端（升级窗口、缓存的 standalone 包）收到未知值可能崩溃/误弹向导。 | 已修（§4.7）：前端 `normalize` 对未知 state 降级为 `indeterminate`、未知 source 降级为 `none`（fail-open），`isGap` 不把未知值当缺口；加测试。 |
| RV-06 | **P1** | 完整性 | `require_configured` 路由分支未规定：集成无对应能力（`volcano_asr`、`volcano_voice_clone`）时的行为；能力在 `manual_capabilities` 内时应报哪个集成。 | 已修（§3.6）：缺省映射 → 永远走原手动校验；能力在 `manual_capabilities` 内 → 原手动校验并报原集成；仅真正路由时才可能报 `skillrouter`。 |
| RV-07 | P2 | 完整性 | `DELETE /api/skillrouter` 描述含未定论的「保留其他字段？否」。 | 已修（§5.1）：明确为清除 Key 并 `mode=manual`，保留 `base_url`/`manual_capabilities`/槽位模型。 |
| RV-08 | P2 | 一致性 | §7.5 引用不存在的锚点（`§4.3 第 5 点`、`§D2`）；「18 个 BFF 路由」无出处。 | 已修（锚点改为 §4.3 第 5 点、§3.1 D2；去掉具体数字）。 |
| RV-09 | P2 | 适当规模 | `GET /usage` 完全来自 capabilities 缓存，与 `catalog` 重叠。 | 已标注为可选薄视图，P0 可不实现。 |
| RV-10 | P2 | 完整性 | 并发 2 路上限的本地节流只在批量 TTS 描述，图片多批、检索分页同样会撞限。 | 已修（§3.3）：`RouterClient` 内置按能力的信号量。 |
| RV-11 | P2 | 完整性 | 未规定 Key 吊销后在飞视频任务的行为。 | 已修（§4.5）：轮询遇 `authentication_error` 保持 `unknown`，换 Key 后可恢复。 |
| RV-12 | P2 | 完整性 | 缺少回滚/紧急阀。 | 已修（§10）：`SKILLROUTER_ENABLED` 紧急阀，关闭时 `is_routed` 恒为 False。 |
| RV-13 | P2 | 一致性 | 向导新增步骤须保证 `deriveWizardSteps` 对 manual 既有输出逐项不变。 | 已在 §9 与 AC-01 体现，无需改正文。 |

结论：无遗留 P0；P1（RV-01~06）均已在正文修复；P2 已处理。

---

## 1. 概述

### 1.1 要做什么

Ecliptrix 现有 14 项能力：LLM 五个槽位（chat / fast / video_cut / vision / research）、联网搜索（web_search）、语音（tts / asr / voice_clone）、AI 生成（ai_image / ai_video）、素材库（video_library / image_library / audio_library）。目前每一项都要用户**逐个**去各家申请 Key、逐个填写，调用直连各家 API。

本特性新增**第二种能力来源**：「AI 能力中转站（SkillRouter）」。用户只需到 skillrouter.net 注册并创建一把 `ar-…` Key，填入一次，软件里中转站覆盖的能力就全部经由中转站调用。原有手动配置完整保留，两种来源可随时切换，互不破坏。

### 1.2 为什么这样设计

1. **一次配置、统一出口**：中转站对外只有一把 Key、一个 base URL、两套 LLM 协议（Anthropic `/api/v1/messages`、OpenAI `/api/v1/chat/completions`）和六类媒体能力（`ai_image`、`ai_video`、`tts`、`image_search`、`video_search`、`audio_search`）。
2. **不重写业务**：Ecliptrix 业务代码（编辑器、分镜、配音、素材检索）不应知道中转站的存在。因此改动被收敛到**少数既有接缝**：
   - LLM：`model_settings_service` 的配置解析层（前端 BFF 与后端都走它）。
   - 凭证闸门：`credential_errors.require_configured`。
   - 供应商出口：`TTSClient.synthesize_speech`、`ark_image_service` 的 POST、`ark_video_service.create_task/_read_provider`、三个搜索服务的公开 `search_*` 方法。
3. **非破坏、可回退**：来源模式只是一个「覆盖层」，不删除、不改写用户的手动配置；切回手动模式即恢复原样。
4. **诚实的覆盖边界**：中转站**不**提供联网搜索（Tavily）、ASR（字幕识别）、声音复刻。这三项在中转站模式下仍走手动配置，向导与设置页明确标注，绝不假装“已被中转站覆盖”。

### 1.3 非目标

- 不改中转站代码，不在 Ecliptrix 内实现中转站的管理后台。
- 不做自动回退到手动 Key（见 §3.7：静默回退会造成计费与隐私混淆；改用「按能力单独选择来源」）。
- 不把 `ar-` Key 暴露给渲染进程；不改变「业务表 `user_id = LOCAL_OWNER_ID`」「后端无鉴权」等既有不变量。
- Video-library selections now use gateway `ingest` in router mode (2026-11-20 fix); searches and automatic prefetch never create paid assets. Image/audio catalogue downloads retain the existing CDN workflow; see §4.6.

---

## 2. 中转站接口事实（设计依据）

> 以下来自 `aragon-router` 的 README §16 与源码，实现时以 `GET /api/v1/capabilities` 的 `limits` 为准，**客户端不得硬编码尺寸/音色/模型枚举**。

| 项 | 事实 |
| --- | --- |
| 鉴权 | `x-api-key: ar-…` 或 `Authorization: Bearer ar-…`；Ecliptrix 统一用 `x-api-key`（Anthropic 路径本来就用它，OpenAI 路径用 Bearer，两者均被接受） |
| 响应信封 | 成功 `{data}`；失败 `{error:{message,code}}`；时间为 epoch 毫秒；资产 URL 为相对路径 `/api/v1/media/assets/{id}`，**读取需带 Key** |
| 能力清单 | `GET /api/v1/capabilities` → 6 项：`id / kind / enabled / available / unavailableReason / limits / quota{unit,dailyLimit,used,remaining,resetsAt}` |
| 模型清单 | `GET /api/v1/models` → `{object:'list', data:[{id, owned_by, provider, display_name?}]}`；`provider` 为 `openai` / `anthropic`（上游协议）或 `route`（运营方配置的虚拟模型，**两种协议都可调用**）；上游全不可达时返回 `200 data:[]` |
| 图片 | `POST /media/images/generations` `{prompt,size?,count?1-4,model?,watermark?,referenceImage?}` → `{assets[],failed,errors?,model,latencyMs}`；`model` 必须等于被选上游配置的模型，否则 400 |
| 视频 | `POST /media/videos/generations` → `202 {job}`；轮询 `GET /media/jobs/{id}`；`job.status ∈ queued/running/succeeded/failed/expired/cancelled`；字段 `prompt, model?, mode(description/keyframe/reference), duration, aspectRatio, resolution, watermark, cameraFixed, firstFrameUrl, lastFrameUrl, referenceImageUrls[]`；取消仅为本地取消，上游继续计费 |
| 语音 | `POST /media/audio/speech` `{text,voice?,speed?,response:'url'|'stream'}`；默认单次上限 `limits.maxChars`（出厂 1000）；音色 id 与 Ecliptrix 现有火山音色 id 同源 |
| 检索 | `POST /media/search/{images|videos|sounds}` `{query,perPage?,cursor?,…过滤}` → `{items,total,hasMore,nextCursor,attribution}`；`perPage` 上限 30 / 80 / 150；每页计 1 次 |
| 请求体上限 | 媒体 POST 默认 8 MB（含 data URI 参考图） |
| 并发 | 图片/语音同一调用方默认 2 路在飞（`429 too_many_inflight`）；视频活跃任务默认 3 |
| 错误码 | 28 个，稳定只增不改：`invalid_request, text_too_long, authentication_error, capability_disabled, tier_denied, not_found, quota_exceeded, too_many_inflight, too_many_jobs, upstream_rate_limited, upstream_unavailable, invalid_provider_response, capability_not_configured, capability_unavailable, egress_unavailable, upstream_timeout, content_rejected …`；视频任务级错误写在 `job.error.code`：`submission_unknown, upstream_generation_failed, upstream_task_expired, local_deadline_exceeded, asset_download_failed` |
| 无幂等键 | 提交类端点网络重试可能重复计费 → **所有付费 POST 一律不自动重试** |

### 2.1 能力映射表（代码中的唯一来源 `ROUTER_CAPABILITY_MAP`）

| Ecliptrix 能力 | 中转站能力 | 中转站模式下 |
| --- | --- | --- |
| chat / fast / video_cut / vision / research（LLM 槽位；`coding` 并入 chat） | LLM 中继 | ✅ 覆盖 |
| tts | `tts` | ✅ 覆盖（克隆音色除外，见 §4.3） |
| ai_image | `ai_image` | ✅ 覆盖 |
| ai_video | `ai_video` | ✅ 覆盖 |
| video_library | `video_search`（Pexels） | ✅ 覆盖 |
| image_library | `image_search`（Unsplash） | ✅ 覆盖 |
| audio_library | `audio_search`（Freesound） | ✅ 覆盖 |
| web_search（Tavily） | —— | ❌ 仍手动 |
| asr | —— | ❌ 仍手动 |
| voice_clone | —— | ❌ 仍手动 |

`MANUAL_ONLY = {web_search, asr, voice_clone}`。`research` 槽位只是 LLM，会被覆盖；它依赖的 Tavily 搜索 Key 仍手动。

---

## 3. 技术设计

### 3.1 总体架构

```
 渲染进程 (Next.js UI)                      Next.js 服务端 (BFF)             FastAPI 后端 (127.0.0.1:8000)
 ┌────────────────────────┐   /api/skillrouter/*    ┌───────────────┐       ┌──────────────────────────────────────┐
 │ SetupWizard(source 步) │ ───────────────────────▶ │ protectedWrite │ ───▶ │ routers/skillrouter_router.py        │
 │ Settings→能力来源       │                          └───────────────┘       │   services/skillrouter/               │
 └────────────────────────┘                                                    │     config.py   模式/覆盖/快照         │
        │  /api/chat 等 LLM 路由                                                │     client.py   唯一 HTTP 出口         │
        ▼                                                                      │     catalog.py  能力+模型缓存(TTL)     │
 getConfig() → GET /api/model-settings/resolve/{slot}  ─────────────────────▶  │     llm_overlay.py  LLM 覆盖层         │
        │ (api_url/api_key/model/api_type = 中转站)                             │     tts/image/video/search adapters   │
        ▼                                                                      │     assets.py   带 Key 的资产下载      │
 直连 https://www.skillrouter.net/api/v1 (由 Next 服务端发起，Key 不进浏览器)     │     errors.py   错误码映射            │
                                                                               └──────────────────────────────────────┘
                                                                                        │ httpx (x-api-key)
                                                                                        ▼
                                                                              https://www.skillrouter.net
```

关键决策：

- **D1 来源模式是覆盖层，不是数据迁移**：模式、Key、base URL、每槽位模型、手动覆盖列表存入既有表 `integration_credentials` 的一行（id=`skillrouter`），沿用 `integration_credentials_service` 的读写锁、脱敏、`credential_property`、审计与前端 `IntegrationCard` 契约。不新增表、无 DDL，符合「只做加法」。
- **D2 全局模式 + 按能力覆盖**：`mode ∈ {manual, router}`；`router` 模式下可对单个能力选择「使用我自己的配置」（`manual_capabilities`），用于“LLM 走中转站、素材库用自己的 Pexels Key”等混合场景，也解决克隆音色问题。
- **D3 状态机三态**：`unset`（从未选择，新装用户）/ `manual` / `router`。**已有安装默认 `manual`**，升级后行为零变化；仅 `unset` 且存在能力缺口时，向导才先出「选择来源」。
- **D4 服务路由决策是纯函数**：`is_routed(capability) -> bool` = `mode=='router' ∧ capability∈ROUTED ∧ capability∉manual_capabilities`。所有接缝只调用它，不各自判断。
- **D5 付费请求永不重试、永不回退**（见 §3.7）。
- **D6 任务 id 命名空间**：中转站视频任务对外暴露为 `sr_<jobId>`（匹配现有 `[A-Za-z0-9_-]{1,128}`），状态读取按前缀分流，因此**飞行中的任务不受之后模式切换影响**，重启恢复也无状态依赖。

### 3.2 配置模型（`integration_registry` 新增一项）

```python
IntegrationSpec(
    id="skillrouter",
    name="AI 能力中转站（SkillRouter）",
    fields=(
        FieldSpec("mode", "choice", default="manual", choices=("manual", "router")),
        FieldSpec("api_key", "secret", required=True),                 # ar-…
        FieldSpec("base_url", "text", default="https://www.skillrouter.net"),
        FieldSpec("manual_capabilities", "text"),                      # 逗号分隔，校验 ⊂ ROUTED
        FieldSpec("model_chat", "text"), FieldSpec("model_fast", "text"),
        FieldSpec("model_video_cut", "text"), FieldSpec("model_vision", "text"),
        FieldSpec("model_research", "text"),
        FieldSpec("slot_protocols", "text"),                           # RV-02：JSON {slot: "openai"|"anthropic"}，仅服务端写入
    ),
    capabilities=(),            # 不解锁任何能力；能力由 ROUTER_CAPABILITY_MAP 决定
    verify_level="free",        # 校验只调 GET /capabilities，零成本
    internal=True,              # RV-03：不进通用列表/夹具/通用读写路由
)
```

约束与实现要点：

- **`internal=True`（RV-03）**：`IntegrationSpec` 新增布尔属性 `internal`（默认 False）。`internal` 集成不出现在 `GET /api/integrations`、`serialize_registry`（前端夹具 `integrations-schema.json` **不变**）以及 `/api/integrations/{id}` 的读写/测试路由（一律 404），唯一对外通道为 `/api/skillrouter`。`validate_base_url`、`manual_capabilities`、`router_key_required` 实现在 `integration_credentials_service.save` 内，绕过路由层也一致生效。
- `slot_protocols`（RV-02）：保存 `model_<slot>` 时由服务端依据目录写入该模型协议；目录暂不可用时，请求带显式 `protocol`（仅 `openai|anthropic`）则采用，否则按 `openai` 保守写入（`route` 虚拟模型两协议皆可）。resolve 只读此字段，不联网。
- `capabilities=()`：`INTEGRATION_CAPABILITIES`、`setup_status` 的循环对空元组天然安全；`baseline_patterns()` 对无 `baseline` 的字段跳过。由于 `internal=True`，前端夹具与分组契约测试不受影响（新增一条测试：`serialize_registry` 不含 `skillrouter`）。
- `base_url` 校验（`validate_patch` 之后的专用校验器 `validate_base_url`）：协议仅 `https`，例外 `http` 且主机为 `localhost/127.0.0.1/::1`（便于对接本地 `aragon-router` 开发实例）；拒绝 userinfo、query、fragment；去尾部 `/`；长度 ≤ 200。不满足返回 422 `invalid_base_url`（沿用 `CredentialValidationError`）。
- `api_key` 校验：`strip()`；非空；长度 8–256；不含空白；**不强制 `ar-` 前缀**（只在 UI 做软提示），避免中转站改前缀后客户端被锁死。
- `manual_capabilities`：解析为去重有序列表；任一不在 ROUTED 集合 → 422 `unknown_capability`。`MANUAL_ONLY` 能力写入时被忽略并在响应中说明（它们本就手动）。
- `mode='router'` 保存规则：必须已有可用 `api_key`（同次请求带或此前已存），否则 422 `router_key_required`；服务器不在保存时联网（验证是独立动作，见 §5.1），保证离线也能切换。
- 同一 integration 的 `mode` 为 `choice` 字段，`ResolvedField.source=='default'` 表示 `unset`。

### 3.3 `services/skillrouter/` 模块划分

| 文件 | 职责（单文件 ≤ 400 行，函数 ≤ 50 行，遵循 CLAUDE.md Clean Code） |
| --- | --- |
| `config.py` | `RouterSnapshot`（不可变 dataclass：`mode, base_url, api_key, manual_capabilities, slot_models, revision`）；`get_snapshot()`；`is_routed(cap)`；`ROUTER_CAPABILITY_MAP / ROUTED / MANUAL_ONLY` 常量；`revision` = sha256(mode+base_url+key 指纹+overrides)[:16]，**不含密钥明文**。 |
| `client.py` | 唯一 HTTP 出口 `RouterClient`：`httpx.AsyncClient`，`x-api-key`、`User-Agent: Ecliptrix/<ver>`、`Accept: application/json`；超时分级（元数据 10s、LLM 由调用方、媒体同步 180s、轮询 15s、资产下载 120s）；仅**幂等 GET** 允许 1 次重试（指数退避 + `Retry-After`）；所有 POST 不重试；响应体大小上限；`follow_redirects=False`，3xx 仅当 `Location` 与 `base_url` 同源时手动跟随一次，Key 头只对同源请求附带；内置按能力的 `asyncio.Semaphore`（图片/语音 2、视频提交 1，RV-10）；错误统一转 `RouterError`。日志只记 method/path/status/耗时/请求 id，**绝不记录 Key、提示词、参考图**。 |
| `errors.py` | `RouterError(code, http_status, message, retry_after, details)` 与映射表（§5.3）；`to_error_response()` 复用 `ErrorResponse` 信封。 |
| `catalog.py` | `get_capabilities()` / `get_models()`：内存 TTL 缓存（60 s）+ stale-while-revalidate；单飞（同一时刻只有一个刷新请求）；配置 `revision` 变化即失效；失败保留旧值并标记 `stale=True`，永不抛到状态接口。提供 `capability_limits(id)` 与 `capability_available(id)`。 |
| `llm_overlay.py` | LLM 配置覆盖（§4.1）。 |
| `tts_adapter.py` | `RouterTTSClient`（与 `TTSClient.synthesize_speech` 同签名，§4.3）。 |
| `image_adapter.py` | `generate_via_router(...)`（§4.4）。 |
| `video_adapter.py` | `submit_job / read_job → ARK 形状字典`（§4.5）。 |
| `search_adapter.py` | 三类检索的结果归一（§4.6）。 |
| `assets.py` | `download_asset(asset_url, dest, *, max_bytes)`：仅允许与 `base_url` **同源**的 URL；带 `x-api-key`；流式写 `.part` 再原子改名；校验 `Content-Length` 与实际字节；不跟随跨源重定向（3xx 仅同源手动跟随一次）。 |
| `status.py` | 给 `setup_status_service` 的路由感知探针（§4.7）。 |

`app/routers/skillrouter_router.py` 前缀 `/skillrouter`，在 `main.py` 与 `integrations_router` 并列注册（`prefix="/api"`）。

### 3.4 数据流一：LLM（所有槽位、所有消费方自动生效）

现状：前端全部 LLM BFF 路由已通过 `getConfig()` → `GET /api/model-settings/resolve/{slot}` 取得 `{api_url, api_key, model_name, api_type}`；后端部分服务直接读 `settings.*`（见 §6 “直读点清单”）。

设计：

1. 在 `ModelSettingsService` 解析链**最前**插入覆盖层：
   - `get_effective_config(function_type)`：先 `router = await llm_overlay.resolve(function_type)`，非 `None` 直接返回（`source="skillrouter"`）。
   - `_pick_stage(stages)`：对每个 `(function_type, prefix)`，先问覆盖层；命中即 `return function_type, config`。路由模式下每个槽位都有独立模型，因此**无需回落借位**，`resolve_stage_origin` 的 `inherited` 语义在路由模式下恒为 “own”。
   - **resolve 不联网（RV-02）**：协议取自已保存的 `slot_protocols`，目录只用于设置界面与「未保存模型」槽位的默认推荐；热路径零网络依赖，目录抖动不影响已配置用户。
   - `llm_overlay.resolve` 返回 `None` 的情形：模式非 router / 该槽位对应能力在 `manual_capabilities` 中 / 未保存 Key。此时走原逻辑，`manual` 行为逐字节不变。
2. 返回值构造：
   - `api_key` = `ar-` Key；`model_name` = 槽位所选模型；`temperature/max_tokens` 沿用调用方默认。
   - `api_type` / `api_url` 由**所选模型的协议**决定（来自 `/api/v1/models` 的 `provider` 字段）：
     - `openai`、`route`（默认）→ `api_type="openai"`，`api_url = {base}/api/v1`（后端 `llm_client` 与前端 `streamLlmChat` 均拼 `/chat/completions`）；
     - `anthropic` → `api_type="anthropic"`，`api_url = {base}/api`（均拼 `/v1/messages`）。
   - 这个拼接约定必须有**契约测试**（用本地假中转站同时断言 URL 与头部）。
3. 默认模型选择 `pick_default_model(slot, models)`，**确定性、可测试**，优先级：
   1. 用户已保存且仍在目录中的 `model_<slot>`；
   2. 运营方约定的虚拟模型 id `ecliptrix-<slot>`（如 `ecliptrix-chat`）——让中转站运营者无需发版即可为客户端指定默认；
   3. 名称启发式：`fast` 偏 `/haiku|flash|mini|lite|turbo|air|small/i`；`vision` 偏 `/vl|vision|omni|gemini|4o|sonnet|opus/i`；其余偏 `/sonnet|opus|gpt|deepseek|qwen|glm|kimi|claude/i`；
   4. 目录第一项。
   仅当槽位**未保存**模型且目录不可用/为空时 → 抛 `RouterError('models_unavailable')`（映射 503，提示“中转站暂无可用模型，请联系中转站运营方或切换手动”）。
4. 模型目录缓存 60 s，且在向导/设置的“刷新模型”按钮上可强制刷新。
5. **密钥边界（RV-01）**：既有 resolve 通道对回环调用方返回明文 `api_key`（Next 服务端路由与 Agent 的 `runCrew` 依赖它），覆盖层沿用该契约；`ModelSettingsPanel.fetchEffectiveConfigs` 只读 `provider_name/api_url/model_name/source`，不得读取或保存 `api_key`；`source="skillrouter"` 时 `provider_name="SkillRouter"`。`/api/skillrouter*`、`/api/integrations*`、`capability-status`、日志、审计一律零密钥（自动化扫描）。
6. `get_effective_config` 返回的 `ResolvedConfigResponse.source` 增加取值 `"skillrouter"`；`setup_status_service._item_from_config` 的 `CapabilitySource` 需容纳 `router`（见 §4.7）。

**LLM 连接测试**：`model_settings_router` 的 test-connection 在路由模式下针对中转站 URL 同样可用（通过既有 `_test_openai_connection/_test_anthropic_connection`）；设置页「能力来源」里每个槽位旁有“测试”按钮，复用它。

### 3.5 数据流二：媒体能力

统一模式：**接缝处调用 `is_routed(cap)`，为真则走适配器，否则原代码路径不动**。适配器的输出被映射回既有数据结构（`ArkImageResult`、ARK 形状任务字典、`ImageInfo/VideoInfo/AudioInfo`），所以上层（路由、前端）零感知。详见 §4.3–§4.6。

### 3.6 `require_configured` 闸门

`credential_errors.require_configured(integration_id)` 是所有 router 层的统一前置检查。新增分支（放在函数最前）：

```python
capability = capability_of_integration(integration_id)   # 如 ark_image → ai_image
if capability and skillrouter.is_routed(capability):
    skillrouter.require_ready()    # 无可用 Key → CredentialNotConfigured("skillrouter")
    return
```

- 新增消息 `_MESSAGES["skillrouter"] = "AI 能力中转站尚未配置 API Key。"`；`error_details.integration_id="skillrouter"`，前端 `ConfigureCta` 据此打开向导的中转站步骤。
- `INTEGRATION_TO_CAPABILITY` 中缺省的集成（`volcano_asr`、`volcano_voice_clone`、`skillrouter` 自身）永远走原手动校验；能力在 `manual_capabilities` 内时同样走原手动校验并报**原集成**的 `credential_not_configured`；只有真正被路由的能力才可能报 `skillrouter`。
- `ark_video_config.py` 中的 `require_configured("ark_video")`、`validate_model_configuration` 在路由模式下跳过（模型由中转站决定）。
- 新增 `INTEGRATION_TO_CAPABILITY` 映射表（`volcano_tts→tts, ark_image→ai_image, ark_video→ai_video, pexels→video_library, unsplash→image_library, freesound→audio_library`；`volcano_asr/voice_clone` 不在内 → 永远走手动校验）。

### 3.7 错误处理与“不回退”原则

- 路由模式下中转站失败时**不自动改用手动 Key**：用户可能没有手动 Key，也可能不希望费用/数据流向另一家；静默回退还会掩盖中转站故障。取而代之：
  1. 给出可操作错误（§5.3）与按钮“切换该能力到我自己的配置”（即写 `manual_capabilities`）；
  2. 设置页展示每项能力的实时可用性与剩余额度，故障提前可见。
- 付费 POST 失败后的重试由**用户显式触发**；视频 `submission_unknown` 沿用既有 `generation_submission_unknown`（sticky，不重试）语义。

---

## 4. 各能力接缝的具体设计

### 4.1 LLM（见 §3.4）补充

- 直读点治理：把后端下列位置改为经 `model_settings_service.get_effective_config / resolve_vision_config` 取配置（**每次调用时解析，不在 `__init__` 缓存**），否则路由模式对这些路径无效：
  `chat_service.py:20-23`、`ai_mixed_editing_service.py:119-127`、`video_understanding_script_service.py:30-33`、`storyboard_service.py:311-314, 1290-1323`、`video_analysis_service.py:54-70, 466, 515`、`video_export_router.py:71-74`。
- 新增守卫测试 `tests/test_no_direct_llm_settings_reads.py`：禁止 `services/`、`routers/` 出现 `settings.(llm|fast_llm|vl_llm|video_cut_llm)_`（`model_settings_service.py`、`config.py` 白名单），与现有 `test_no_direct_credential_reads.py` 同构。
- 该治理同时让手动模式下“面板里保存的分配”在这些路径上真正生效（既存缺陷）。属行为改进，需在变更说明中单列，并用测试固定 env 回退仍然有效。
- `main.py` 启动期对 `LLM_API_KEY` 的告警保持仅警告；路由模式下不应因缺 env 失败（已是 warning，无需改，加测试固定）。

### 4.2 能力来源状态在 BFF 的透传

无需修改各 LLM 路由：`getConfig()` 读取的 resolve 接口已被覆盖层接管。需要确认并加单测的点：resolve 响应**不被缓存**（`Cache-Control: no-store`），否则切换模式后最长一个缓存周期内仍用旧配置。

### 4.3 TTS（`tts_service.py`）

接缝：`TTSService._synthesize_with_retries` 内 `client = TTSClient(...)` → `client = make_tts_client()`：

```python
def make_tts_client(self):
    if skillrouter.is_routed("tts"):
        return RouterTTSClient()          # 同签名 synthesize_speech(text, output_file, voice_type, speed_ratio) -> bool
    return TTSClient(self.api_key, self.resource_id)
```

`RouterTTSClient.synthesize_speech`：

1. 读取 `limits`：`maxChars`、`speed{min,max}`、`voices`。`speed_ratio` 夹取到范围内。
2. 文本超过 `maxChars`：按句末标点（。！？!?；;\n）切块，每块 ≤ `maxChars`，仍超则硬切；**顺序**合成（尊重并发 2 路上限）；用 `ffmpeg -f concat -c copy` 合并为单个 mp3（项目已依赖 ffmpeg，使用 `TTSService._get_ffmpeg_path()`）。配额按 `ceil(字数/1000)` 计，拆块不增加额外配额。
3. 每块调用 `POST /media/audio/speech` `{text, voice, speed, response:'url'}`，再用 `assets.download_asset` 下载 mp3 到 `output_file`（先写 `.part`，校验非空后改名；失败调用既有 `cleanup_failed_audio`）。
4. 错误映射到既有 `make_tts_error(...)`，使上层重试/提示逻辑不变：`authentication_error→TTS_AUTH_FAILED`、`quota_exceeded→TTS_QUOTA_EXHAUSTED`、`upstream_rate_limited/too_many_inflight→TTS_RATE_LIMITED`（可重试，遵守 `Retry-After`）、超时/网络→`TTS_TIMEOUT/TTS_NETWORK_ERROR`、其余→`TTS_UNKNOWN_ERROR`。
5. **克隆音色**：若 `voice_type` 以克隆音色前缀（`volcano_voice_clone_speaker_id_prefix`）开头，路由模式下**不**发往中转站，直接抛出 `TTS_VOICE_UNAVAILABLE`，错误 details 带 `suggest="manual_capability:tts"`；UI 据此提示“克隆音色只能用你自己的火山凭证”，并提供一键把 `tts` 切为手动。
6. `get_available_voice_types(locale)`：路由模式下以 `limits.voices` 为准（`generation`/`category`/`language` 字段映射为现有 `VoiceTypeInfo`），目录不可达时回退本地静态表并标记 `stale`。
7. 批量 TTS（`batch_tts_service`）并发上限在路由模式下取 `min(现配置, 2)`，避免撞 `too_many_inflight`；仍撞则按 `Retry-After` 退避。

### 4.4 AI 图片（`ark_image_service.py`）

两处出口（`_call_ark` 与 `_generate_legacy_images` 内的 POST）抽成一个函数：

```python
async def _provider_generate(payload: dict) -> list[RemoteImage]   # RemoteImage(url, headers: Mapping[str,str])
```

- 手动：行为不变，`headers={}`。
- 路由：`image_adapter.generate_via_router(prompt, size, n, reference, watermark)`：
  - **尺寸映射** `nearest_size(requested, limits.sizes)`：先取宽高比最接近者，同比取面积最接近者；映射结果写日志；若与请求不同，在返回结构的 `notes` 中记录，UI 可提示“已按中转站支持的尺寸 1280x720 生成”。
  - `count` 夹取到 `limits.maxCount`（4）；超出则分批串行（每批 ≤ 4，遵守并发 2）。
  - **参考图**：沿用 `_resolve_multi_references` 已合成的单张 `normalized_reference`；若是 data URI 且 base64 长度 > 6 MB，则用现有 `reference_compositor` 的缩放能力降到长边 2048 并 JPEG q85 再发；仍超则返回 `invalid_request`（含清晰提示）。中转站只接受**一张**参考图。
  - **不传 `model`**，除非用户在设置里显式选了 `limits.models` 中的某个（预留，v1 不暴露）。
  - 响应 `assets[]`（相对路径）→ 拼 `base_url` → `RemoteImage(url=…, headers={'x-api-key': …})`；`failed>0` 的部分成功按成功项返回并把 `errors` 写入日志与结果 `notes`。
- 下载环节（两处 `dl_client.get(remote_url)`）改为 `get(remote_url, headers=item.headers)`；下载路径 `STORAGE_ROOT/images/ark/<date>/`保持不变，业务侧路径契约不变。
- `defer_download=True` 分支：路由模式下**忽略延迟**，立即下载并返回本地 URL（路由资产需带 Key，无法让消费方匿名取）。需核对所有 `defer_download=True` 的调用方能接受本地 `/api/storage/files/...` 形式，并加测试。
- 九宫格/分镜合成（`_generate_grid_pack`）走同一函数，无需特殊处理。

### 4.5 AI 视频（`ark_video_service.py`）

策略：**协议垫片**——适配器把中转站任务翻译成现有代码已经消费的 ARK 形状，其余（任务上下文、配置修订、产物收取、缓存登记、前端状态机）原样复用。

- `create_task`：`config = resolve_video_config(...)` 之前先判断 `is_routed("ai_video")`：
  - 路由：不调用 `resolve_video_config`；`request` 字段近乎 1:1 映射（`mode/duration/aspect_ratio/resolution/watermark/camera_fixed/first_frame_url/last_frame_url/image_urls`→`referenceImageUrls`）。`image_url` 在 `keyframe` 下作为 `firstFrameUrl`。
  - 本地文件/本地存储 URL 的首尾帧、参考图：读文件转 data URI；按 `limits.models[].maxRefImages / supportsLastFrame` 预检；总请求体 > 8 MB 时先缩放；仍超 → `invalid_request`。每边需在 300–6000 px、宽高比 0.4–2.5（中转站会预检，本地也可先查并给出友好提示）。
  - 模型：`request.model` 为空 → 不传，由中转站决定；非空 → 必须在 `limits.models[].id` 内，否则 422 `invalid_model_configuration`（沿用既有错误码）。
  - `POST /media/videos/generations`（**不重试**；网络错误/5xx/超时 → `generation_submission_unknown`，sticky）。
  - 返回 `VideoSubmission(task_id=f"sr_{job.id}", model_id=job.model, config_revision=snapshot.revision)`。
- `config_revision`：路由模式下为 `RouterSnapshot.revision`；`expected_config_revision` 不一致沿用既有 409 行为（不自动再 POST）。
- `get_status("sr_…")`（前缀分流）→ `_read_provider` 的路由版 `read_router_job(task_id)` 返回 ARK 形状：

  | 中转站 `job.status/phase` | 垫片 `status` |
  | --- | --- |
  | `queued` | `queued` |
  | `running`（generating） | `running` |
  | `succeeded` | `succeeded`，`content.video_url = {base}{asset.url}`（+ 标记需要带头下载） |
  | `failed` / `expired` / `cancelled` | `failed` / `expired` / `cancelled` → 现有 `_apply_provider` 的 finish 分支；`error.code` 映射到既有 `video_generation_failed / video_task_expired / video_download_failed` |

- 产物收取：`_start_artifact`/`collect_artifact` 增加可选参数 `source_fetcher: Callable[[Path], Awaitable[None]] | None`。提供时用它替换 `_download`（路由版 fetcher = `assets.download_asset` 带 Key），之后的 `validate_video → _register → _thumbnail` 全部沿用；缓存仍登记 `source="ark"`、`source_id=<sr_…>`，以满足既有 `local_url.startswith("/api/storage/files/cached_materials/ark/")` 断言并保证编辑器即时同源预览。`validate_remote_url` 对路由 URL 不适用（本地 `http://localhost` 开发实例会被它拒绝），路由分支用 `assets` 的同源校验代替。
- 取消：Ecliptrix 现无取消入口，v1 不接 `/jobs/{id}/cancel`；文档注明“关闭应用不取消上游任务，且仍计费”（与 ARK 现状一致）。
- Key 失效（RV-11）：轮询遇 `authentication_error` 时任务保持 `unknown`（不置 `failed`、不丢产物上下文），提示更换 Key 后可继续。
- 超时：沿用 `video_task_contexts` 的本地期限；轮询间隔沿用前端现有节奏（≥2 s，且路由模式不低于 2 s，避免触发限流）。
- `/api/ark-video/models`：路由模式下由 `limits.models[]` 映射（`id/label/profile/modes/resolutions/maxRefImages/supportsLastFrame/supportsCameraFixed`）为现有契约，`config_revision` 取快照 revision；`profile` 值与 `ark_video_profiles` 的 `text_only/first_frame/seedance_2` 对齐，未知 profile 按 `text_only` 保守降级（继续遵守“`text_only` 不能静默丢弃分镜首帧”）。
- 同时并发：活跃任务上限 3；超出时中转站返回 `429 too_many_jobs`，映射为可读提示“中转站同时生成的视频已达上限”。

### 4.6 三类素材检索

接缝在 `ImageSearchService.search_images`、`VideoSearchService.search_videos`、`AudioSearchService.search_audios` 的**公开方法入口**（而非内部 `_make_api_request`，因为后者混有 Key 轮换逻辑）：

```python
if skillrouter.is_routed("image_library"):
    return await/同步封装 search_adapter.search_images(...)   # 返回原 ImageSearchResponse
```

- 同步/异步：现有三个服务是同步 `requests` 风格；适配器提供同步包装（`httpx.Client`），不改变调用方签名。
- 分页聚合：现 API 的 `max_images/max_videos/max_audios`（如 60）大于中转站 `perPage` 上限（30/80/150）时，按 `nextCursor` 循环取页直至满额或 `hasMore=false`；**每页消耗 1 次检索额度**，设置硬上限 `MAX_PAGES=4`，防止刷额度。
- 字段映射（缺失字段保持 `None`，不伪造）：`thumbUrl/previewUrl/downloadUrl/width/height/durationMs/color/description/tags/license/author{name,url}/pageUrl/waveformUrl`→ 对应 `ImageInfo/VideoInfo/AudioInfo`；`attribution` 写入各条的署名字段（Unsplash/Pexels 要求署名，UI 现有署名展示沿用）。
- **Video-library download routing (2026-11-20)**: `search_video` returns a trusted candidate reference. Explicit `materialize_video` selection uses the sole `is_routed('video_library')` decision: manual mode consumes Pexels API file metadata, router mode submits `media/ingest` once and downloads its authenticated same-origin asset. Both validate bytes and update the existing `pexels-<id>` entry under `cached_materials/pexels/`. Ready files are reused; concurrent selections share work. Ingest receipts persist asset identity or an uncertain submission outcome so retries/restarts cannot blindly create another billable asset. Search and automatic routed prefetch never ingest. Image/audio CDN downloads and `unsplash/pexels/freesound` cache identities are preserved.
- 过滤：Ecliptrix 的 `orientation`、`duration_min/max` 等映射到中转站字段（`orientation` 的取值集合以 `limits` 为准；不支持的值忽略并记日志，不报错）。
- 错误：路由失败要抛出结构化 `RouterError`（不可返回 `None`，否则前端会渲染成“无搜索结果”——这是 `require_configured` 设计时已记录的陷阱）。

### 4.7 配置向导就绪度（`setup_status_service`）

- `compute_capability_status` 增加路由感知：对每个能力先 `is_routed(cap)`：
  - 路由且 Key 可用且 `catalog.capability_available(cap)` 为真 → `state="ready"`, `source="router"`, `provider_name="SkillRouter"`, LLM 槽位带 `model_name`。
  - 路由且无 Key → `missing`；Key 被拒（最近一次校验 `authentication_error`）→ `invalid`。
  - 路由但中转站报告该能力 `available=false`（`capability_disabled/tier_denied/capability_not_configured`）→ 新状态 `unavailable`（TS 联合与 `isGap` 同步更新，视为缺口，可一键“该能力改用自己的配置”）。
  - 目录读取失败/超时（2 s 内）→ `indeterminate`（fail-open，保持既有约定，绝不因网络抖动弹向导）。
  - `MANUAL_ONLY` 能力永远走原有逻辑。
- 状态接口**不得**因路由慢而变慢：只读缓存，后台刷新（SWR）。
- **向前兼容（RV-05）**：前端 `normalize` 对未知 `state` 降级为 `indeterminate`、对未知 `source` 降级为 `none`，`isGap` 不把未知值视为缺口（fail-open），升级窗口内的旧前端不会误弹向导或崩溃，并有单测。
- 前端 `CapabilitySource` 增加 `'router'`，`CapabilityState` 增加 `'unavailable'`；`CapabilityChecklist/StatusPill` 增加对应文案与图标（颜色+图标+文字三重编码，见 §7.5）。

---

## 5. 接口设计

### 5.1 后端 REST（`/api/skillrouter/*`，沿用 `integrations_router` 的 `validate_ui_origin` 写保护）

| 方法与路径 | 说明 | 成功响应要点 |
| --- | --- | --- |
| `GET /api/skillrouter` | 公开状态（零密钥） | `{mode, modeState:'unset'|'manual'|'router', baseUrl, keyConfigured, keyHint('ar-…****abcd'|null), manualCapabilities[], slotModels{chat,…}, defaults{slot→model}, lastVerified{ok,at,outcome}|null, revision}` |
| `PUT /api/skillrouter` | 局部更新（patch 语义，与 `/api/integrations/{id}` 一致） | 同上；`mode:'router'` 需已有 Key；错误码见 §5.3 |
| `DELETE /api/skillrouter` | 清除 Key 并把 `mode` 置 `manual`；保留 `base_url`、`manual_capabilities`、槽位模型与协议（便于换 Key 后恢复）；手动配置不受影响 | 同上 |
| `POST /api/skillrouter/verify` | 用已保存（或本次临时提交、`{apiKey?, baseUrl?}`）的凭证调用 `GET /api/v1/capabilities`，**零成本**。临时提交的 Key 不落库；限流 1 次/2 s | `{outcome:'ok'|'invalid_credentials'|'unreachable'|'upstream_error'|'unverifiable', latencyMs, capabilities:[{id, available, unavailableReason, quota{unit,dailyLimit,used,remaining,resetsAt}}], coverage:{routed[], manualOnly[]}}` |
| `GET /api/skillrouter/catalog?refresh=0|1` | 目录（能力+模型+每槽位默认） | `{models:[{id,label,protocol,isRoute}], capabilities:[…], stale, fetchedAt}` |
| `GET /api/skillrouter/usage` | 额度摘要（`catalog` 的薄视图；可选，P0 可不实现，设置页直接用 `verify`/`catalog` 的 `capabilities[].quota`） | 每能力 `used/dailyLimit/remaining/resetsAt` |

- 所有响应使用既有 `ErrorResponse`/`BaseResponse` 信封；**任何响应、日志、审计行不含 Key 明文**；`keyHint` 仅末 4 位。
- `verify` 的 `outcome` 复用 `ProbeOutcome` 闭集；**不返回假 ok**。

### 5.2 Next BFF（`src/app/api/skillrouter/…`）

- `route.ts`（GET / PUT / DELETE）、`verify/route.ts`（POST）、`catalog/route.ts`（GET）、`usage/route.ts`（GET）。
- 写操作通过 `protectedSettingsWrite(..., always=true)`（转发 `Origin`、JSON Content-Type），与 `integrationsBff` 一致。
- 前端类型化客户端 `src/lib/api/skillrouter.ts`，所有请求经 `http-client`，成功后调用 `notifySetupConfigUpdated()`（事件 `ecliptrix-llm-config-updated`），使向导/清单/设置页即时刷新。

### 5.3 错误码映射（`RouterError` → Ecliptrix `ErrorResponse`）

| 中转站 | HTTP | Ecliptrix `error_code` | 用户可见处理 |
| --- | --- | --- | --- |
| （无 Key） | 409 | `credential_not_configured`（`integration_id=skillrouter`） | “还没填中转站 Key”→ 打开向导中转站步骤 |
| `authentication_error` | 409 | `router_key_invalid` | “Key 无效或已吊销”→ 重新填写 / 去中转站查看 |
| `capability_disabled` / `tier_denied` | 403 | `router_capability_denied` | “当前账号无权使用该能力”→ 联系中转站 / 该能力改自己的配置 |
| `capability_not_configured` / `capability_unavailable` | 503 | `router_capability_unavailable` | “中转站暂未开通该能力”→ 改自己的配置 |
| `quota_exceeded` | 429 | `router_quota_exceeded`（`details.resets_at`） | “今日额度已用完，将于 HH:mm 重置” |
| `too_many_inflight` / `too_many_jobs` / `upstream_rate_limited` / `probe_throttled` | 429 | `router_busy`（`details.retry_after_seconds`） | 自动按 `Retry-After` 退避（仅幂等读与 TTS 分块）；其余提示稍后重试 |
| `content_rejected` | 422 | `content_rejected` | 提示词被拒，修改后重试 |
| `invalid_request` / `text_too_long` / `request_too_large` / `unsupported_media` | 422 | `router_invalid_request`（带脱敏 message） | 显示具体原因（如尺寸、文本长度） |
| `upstream_unavailable` / `invalid_provider_response` / `upstream_timeout` / `egress_unavailable` | 502 / 504 | `router_upstream_error` | “中转站上游暂时不可用”，可重试 |
| 网络层错误（DNS/连接/TLS/超时） | 502 | `router_unreachable` | “无法连接中转站”，检查网络 / base URL |
| 视频任务级 `submission_unknown` | 502 | `generation_submission_unknown`（沿用） | 提示“可能已受理，请先查看中转站用量，勿重复提交” |

- 稳定性：错误码属于对外 API，一经发布不得更名（CLAUDE.md §5）。
- 前端统一 `describeRouterError(code, details, t)`，所有文案进 i18n（中/英）。

---

## 6. 文件 / 模块变更清单

### 6.1 后端（`backend-services/basic-service/`）

| 路径 | 动作 | 意图 |
| --- | --- | --- |
| `app/services/skillrouter/__init__.py` | 新增 | 导出 `is_routed / get_snapshot / require_ready` |
| `app/services/skillrouter/config.py` | 新增 | 快照、映射表、`is_routed`、revision |
| `app/services/skillrouter/client.py` | 新增 | 唯一 HTTP 出口（超时/重试/脱敏日志） |
| `app/services/skillrouter/errors.py` | 新增 | `RouterError` 与映射表 |
| `app/services/skillrouter/catalog.py` | 新增 | 能力/模型缓存（TTL+SWR+单飞） |
| `app/services/skillrouter/llm_overlay.py` | 新增 | LLM 覆盖层与默认模型选择 |
| `app/services/skillrouter/tts_adapter.py` | 新增 | `RouterTTSClient` + 分块合并 |
| `app/services/skillrouter/image_adapter.py` | 新增 | 图片适配、尺寸映射、参考图压缩 |
| `app/services/skillrouter/video_adapter.py` | 新增 | 视频垫片（提交/读取/形状映射） |
| `app/services/skillrouter/search_adapter.py` | 新增 | 三类检索适配与分页聚合 |
| `app/services/skillrouter/assets.py` | 新增 | 同源带 Key 资产下载 |
| `app/services/skillrouter/status.py` | 新增 | 就绪度探针 |
| `app/routers/skillrouter_router.py` | 新增 | §5.1 的端点 |
| `app/models/skillrouter_models.py` | 新增 | Pydantic 请求/响应模型 |
| `app/main.py` | 修改 | 注册路由；启动时无需联网 |
| `app/services/integration_registry.py` | 修改 | 新增 `skillrouter` 项 |
| `app/services/integration_credentials_service.py` | 修改 | `validate_base_url`、`manual_capabilities` 校验、`router_key_required` 规则 |
| `app/services/credential_errors.py` | 修改 | `require_configured` 路由分支、`INTEGRATION_TO_CAPABILITY`、消息 |
| `app/services/model_settings_service.py` | 修改 | `get_effective_config` / `_pick_stage` 接入覆盖层 |
| `app/services/setup_status_service.py` + `app/models/setup_status_models.py` | 修改 | 路由感知就绪度、`unavailable` 状态、`source=router` |
| `app/services/tts_service.py` | 修改 | `make_tts_client`、音色目录路由版 |
| `app/services/batch_tts_service.py` | 修改 | 路由模式并发上限 2 |
| `app/services/ark_image_service.py` | 修改 | `_provider_generate`、下载带头、`defer_download` 处理 |
| `app/services/ark_video_service.py` / `ark_video_artifacts.py` / `ark_video_config.py` | 修改 | `sr_` 前缀分流、`source_fetcher`、路由模式跳过 Ark 配置校验 |
| `app/routers/ark_video_router.py` | 修改 | `/ark-video/models` 路由版 |
| `app/services/image_search_service.py` / `video_search_service.py` / `audio_search_service.py` | 修改 | 入口分流到适配器 |
| `app/services/chat_service.py`、`ai_mixed_editing_service.py`、`video_understanding_script_service.py`、`storyboard_service.py`、`video_analysis_service.py`、`app/routers/video_export_router.py` | 修改 | LLM 直读点改走 `model_settings_service`（§4.1） |
| `app/services/integration_probes.py` | 修改 | 新增 `skillrouter` 探针（调用 `GET /capabilities`，7 种 outcome） |
| `config/`（无新 YAML） | — | 本特性不新增配置文件 |
| `tests/…` | 新增 | 见 §8 |

### 6.2 前端（`src/`）

| 路径 | 动作 | 意图 |
| --- | --- | --- |
| `src/lib/api/skillrouter.ts` | 新增 | 类型化客户端 + `describeRouterError` |
| `src/lib/api/integrations.ts` | 修改 | `IntegrationId` 加 `skillrouter`（不进入向导分组） |
| `src/lib/api/setupStatus.ts` | 修改 | `CapabilitySource+='router'`、`CapabilityState+='unavailable'`、`isGap` |
| `src/lib/api/__fixtures__/integrations-schema.json` | 重新生成 | 由 `serialize_registry` 产出 |
| `src/lib/credentialLinks.ts` | 修改 | 新增 `skillrouter`：注册 `https://www.skillrouter.net/login`，Key 页 `https://www.skillrouter.net/console/my-keys`，文档 `https://www.skillrouter.net/console/docs`（仅经 `GetCredentialLink` 渲染，https + 主机白名单加入 `www.skillrouter.net`） |
| `src/app/api/skillrouter/route.ts`、`verify/route.ts`、`catalog/route.ts`、`usage/route.ts` | 新增 | BFF 代理 |
| `src/components/skillrouter/SourceModeChooser.tsx` | 新增 | 两张卡片（中转站 / 手动）的单选组 |
| `src/components/skillrouter/RouterConnectCard.tsx` | 新增 | 注册引导 + Key 输入 + 校验结果 |
| `src/components/skillrouter/RouterCoverageList.tsx` | 新增 | 覆盖清单（每项：来源开关、状态、额度） |
| `src/components/skillrouter/RouterModelSlots.tsx` | 新增 | 5 个 LLM 槽位模型下拉 + 刷新 + 测试 |
| `src/components/skillrouter/RouterQuotaMeter.tsx` | 新增 | 额度条（含重置时间，本地时区） |
| `src/components/skillrouter/useSkillRouter.ts` | 新增 | 状态、校验、保存、乐观更新与回滚 |
| `src/components/skillrouter/skillrouter.css`（并入 `styles/globals.css` 的 `.sr-scope`） | 新增/修改 | 设计令牌（§7.1） |
| `src/components/settings/SkillRouterSettingsPanel.tsx` | 新增 | 设置页「能力来源」面板 |
| `src/components/settings/SettingsSidebar.tsx` / `SettingsPage.tsx` | 修改 | 新菜单项 `skillrouter`（“AI 配置”组首位）与注意点 |
| `src/components/settings/ModelSettingsPanel.tsx`、`TTSSettingsPanel.tsx`、`IntegrationsSettingsPanel.tsx`、`WebResearchSettingsPanel.tsx` | 修改 | 被中转站接管的能力显示 `RoutedNotice` 横幅（保留可见、置灰，不删除数据） |
| `src/components/integrations/IntegrationCard.tsx` | 修改 | 路由接管时显示“由中转站提供 · 改用自己的 Key” |
| `src/components/integrations/ConfigureCta.tsx` | 修改 | `integration_id=skillrouter` 时打开向导中转站步骤 |
| `src/components/Onboarding/wizard/wizardSteps.ts` | 修改 | 新增步骤 `source`、`router`；`deriveWizardSteps` 接受来源模式 |
| `src/components/Onboarding/wizard/SourceStep.tsx`、`RouterStep.tsx`、`RouterModelsStep.tsx`、`ManualOnlyStep.tsx` | 新增 | 向导新步骤 |
| `src/components/Onboarding/wizard/useSetupWizard.ts`、`WizardStepper.tsx`、`DoneStep.tsx`、`OverviewStep.tsx`、`CapabilityChecklist.tsx`、`StatusPill.tsx` | 修改 | 步骤编排、路由状态展示 |
| `src/lib/i18n.ts` | 修改 | `skillrouter`、`setupWizard.source/router`、`routerErrors` 中英文词条（接口类型 + en + zh 三处） |
| `src/lib/setupEvents.ts` | （复用） | 不新增事件 |

### 6.3 其他

| 路径 | 动作 | 意图 |
| --- | --- | --- |
| `CLAUDE.md` | 修改（实现节点完成后） | 在 Project Overview / Setup wizard / External credentials 小节补充“能力来源（SkillRouter）”要点与三条不变量（§9） |
| `docs/plans/skillrouter-capability-gateway/acceptance.md` | 新增（验收节点） | 逐条 AC 证据 |
| `desktop/`（无变更） | — | 渲染进程不直连中转站；Key 只在后端/Next 服务端；无需新增 IPC |

---

## 7. 交互与界面设计（Anthropic 的克制 + Supabase 的界面语言）

### 7.1 设计令牌（`.sr-scope`，只作用于中转站相关界面，不改全局主色）

| 令牌 | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--sr-bg` | `#1c1c1c` | `#fcfcfc` | 面板底 |
| `--sr-surface` | `#232323` | `#ffffff` | 卡片 |
| `--sr-border` | `#2e2e2e` | `#e6e6e6` | 1 px 描边（不用重阴影） |
| `--sr-fg` / `--sr-muted` | `#ededed` / `#a0a0a0` | `#171717` / `#6b6b6b` | 文本 |
| `--sr-accent` | `#3ecf8e` | `#1f9d6b` | 选中态、连接成功、主按钮（文字用 `#04251a` / `#ffffff`，对比度 ≥ 4.5:1） |
| `--sr-danger` / `--sr-warn` | `#f87171` / `#fbbf24` | `#dc2626` / `#b45309` | 失败 / 注意 |
| 圆角 | 8 px（卡片 12 px） | | |
| 字号 | 13–14 px 正文，12 px 辅助；标题 16–20 px 半粗 | | 字体沿用应用现有字体栈 |

动效：150 ms ease-out 的淡入/上移，`prefers-reduced-motion` 下关闭；骨架屏代替转圈。

### 7.2 向导（`SetupWizard`）新流程

```
overview → source ─┬─ router → routerModels → manualOnly(仅缺口) → done
                   └─ manual → provider → models → voice → generation → media → search → done   (现有流程不变)
```

- **何时出现 `source` 步**：①首次安装（`modeState=unset`）且存在能力缺口；②设置页“重新运行向导”（manual 模式）；③`ConfigureCta` 传入 `skillrouter` 焦点。已完整手动配置的老用户启动时**不弹向导**（`hasSetupGap=false`）。
- **`source` 步界面**（单选卡片组，`role="radiogroup"`，方向键切换）：

```
 你想怎样配置 AI 能力？
 ┌───────────────────────────────┐ ┌───────────────────────────────┐
 │ ◉ AI 能力中转站      推荐      │ │ ○ 手动配置                     │
 │ 一把 Key，搞定对话、配音、     │ │ 逐个填写各家服务商的 Key，      │
 │ 生图、视频与素材库。           │ │ 完全自己掌控。                  │
 │ ✓ 2 分钟完成   ✓ 无需分别注册  │ │ ✓ 可选任意服务商                │
 └───────────────────────────────┘ └───────────────────────────────┘
 之后可随时在「设置 → 能力来源」切换，两边的配置都会保留。
                                         [ 继续 ]
```

- **`router` 步**（三段式，单屏完成）：
  1. “还没有账号？”——说明文字 + 按钮 **前往 skillrouter.net 注册**（`GetCredentialLink`，系统浏览器打开；说明“注册后在「我的密钥」创建一把 Key”）；
  2. Key 输入框（遮罩，眼睛按钮切换可见；支持粘贴后自动去空白；占位 `ar-…`；非 `ar-` 前缀只给软提示不拦截）+ 高级折叠区“自定义中转站地址”（默认 `https://www.skillrouter.net`）；
  3. **验证**：按钮或粘贴后 600 ms 自动触发；结果以内联结果卡呈现（`aria-live="polite"`）：成功显示“已连接 · 12 ms”+ 覆盖清单（✓ 对话/配音/生图/视频/三类素材库，以及今日额度）；并**明确列出“仍需手动配置：联网搜索、字幕识别、声音复刻”**（可跳过）。失败显示可操作原因（Key 无效 / 无法连接 / 暂不可用）。
  - 只有验证通过（或用户选择“先保存稍后验证”）才可继续；保存时即写入 `mode=router`。
- **`routerModels` 步**：5 个槽位下拉，已按 `pick_default_model` 预填并标注“推荐”；“刷新模型列表”“测试”按钮；目录为空时给出“中转站暂无可用模型”的空状态与重试。
- **`manualOnly` 步**：只列 web_search / asr / voice_clone，复用既有卡片，可整体跳过（沿用“不再提醒”opt-out）。
- **`done` 步**：清单中中转站覆盖项显示“由 SkillRouter 提供”；一句话说明“在设置中可随时切换”。

### 7.3 设置页「能力来源」

- 顶部：`SourceModeChooser`（同向导卡片，切换即时生效，成功后 toast“已切换到中转站，手动配置已保留”）。切换到 router 但无 Key 时，不直接切，而是内联展开连接卡片。
- 连接卡片：状态胶囊（已连接 / 未验证 / Key 无效 / 无法连接）、Key 末四位、“重新验证”“更换 Key”“清除 Key（需确认：将回到手动模式）”“打开中转站控制台”。
- **覆盖清单**（表格式列表）：每行 = 能力名 + 来源分段开关（`中转站 | 自己的配置`）+ 状态 + 额度条；MANUAL_ONLY 行开关禁用并标注“中转站暂不提供”。
- **模型槽位**区（router 模式）：同向导，可单独测试。
- 其他设置面板（模型/语音/素材库）对被接管能力显示置灰横幅“当前由 AI 能力中转站提供 · [改用自己的配置]”，数据保留可见。

### 7.4 交互细则（人机交互最佳实践）

1. **可逆**：任何模式切换都不删除数据；破坏性动作（清除 Key）才二次确认，并写明后果。
2. **即时反馈**：保存/验证期间按钮 `aria-busy` + 就地进度；失败信息贴近出错控件；不用弹窗打断。
3. **键盘与读屏**：所有控件可 Tab；单选卡片方向键；验证结果用 `aria-live`；焦点在步骤切换后移到标题；Esc 行为沿用 `Modal`（有未提交草稿先确认，复用现有 `discardPrompt`）。
4. **不以颜色为唯一信息**：状态均为 图标 + 文本 + 颜色。
5. **隐私透明**：中转站卡片注明“选择中转站后，你的提示词与素材请求将经由 skillrouter.net 转发”，并链接隐私/文档；手动模式不出现该提示。
6. **时间本地化**：额度重置按本地时区显示（UTC 零点仅作悬停说明）。
7. **离线/弱网**：目录与状态读缓存，显示“上次更新 HH:mm”，不阻塞界面。
8. **首屏性能**：设置面板懒加载；目录/额度请求并行，骨架屏占位。

### 7.5 我补充考虑的事项（需求中未提及）

- **覆盖边界透明**（web_search/asr/voice_clone）与**按能力混合来源**（§3.1 D2）。
- **克隆音色兼容**（§4.3 第 5 点）与**长文本 TTS 分块**（§4.3.2）。
- **额度可见与预警**：设置页额度条；`remaining≤10%` 或 `=0` 时在对应功能入口出现轻量提示；`quota_exceeded` 带重置时间。
- **在飞任务不受模式切换影响**（`sr_` 前缀，§D6）。
- **付费请求永不自动重试**（无幂等键）与**视频提交结果未知**的诚实提示。
- **本地开发实例支持**（`http://localhost:3000`），便于联调 `aragon-router`；生产强制 https。
- **Key 不落日志/不进渲染进程/响应只给末四位**，沿用“零密钥响应”测试风格。
- **运营方默认模型约定** `ecliptrix-<slot>`，免客户端发版。
- **版本与兼容提示**：请求带 `User-Agent: Ecliptrix/<ver>`；`capabilities` 返回未知新能力时忽略不崩溃（前端 normalize 容错）。
- **老用户零影响**：默认 `manual`、不弹向导、行为逐字节不变（有回归测试）。

---

## 8. 测试与验收标准

### 8.1 测试策略

> 不 mock 高风险路径：TTS 合并走真实 ffmpeg；媒体与 LLM 契约用**进程内假中转站**（FastAPI/`httpx.MockTransport` 之外，另起本地 HTTP 服务器，行为取自 `aragon-router` README §16 与源码），而不是对 `RouterClient` 打桩。

**后端 pytest（SQLite 内存库）**

| 测试文件 | 覆盖 |
| --- | --- |
| `test_skillrouter_config.py` | 默认 manual；`router` 无 Key → 422 `router_key_required`；`base_url` 校验（https/localhost 例外/userinfo/query）；`manual_capabilities` 校验；响应与日志零密钥；清除回 manual |
| `test_skillrouter_client.py` | 头部、超时、仅 GET 重试、POST 不重试、`Retry-After`、错误映射全表（§5.3，逐码断言） |
| `test_skillrouter_llm_overlay.py` | 各槽位解析；openai/anthropic/route 三类模型的 `api_url/api_type`；默认模型选择优先级；覆盖列表 → 回落手动；staged（vision/research）命中；模型目录为空的错误 |
| `test_skillrouter_contract_llm.py` | 假中转站断言 `/api/v1/chat/completions` 与 `/api/v1/messages` 的最终 URL 与 `x-api-key`/Bearer（后端 `llm_client`）；前端同契约由 vitest 覆盖 |
| `test_skillrouter_tts.py` | 正常合成落盘；超长文本分块+真实 ffmpeg 合并；速度夹取；克隆音色拒绝；错误码映射；失败清理半成品文件 |
| `test_skillrouter_image.py` | 尺寸最近映射；count>4 分批；参考图超限压缩；部分成功；带头下载；`defer_download` 路由行为 |
| `test_skillrouter_video.py` | 请求映射；本地帧转 data URI；任务状态翻译全表；`sr_` 前缀分流；产物下载走 `source_fetcher` 并登记缓存；`submission_unknown`；模式切换后飞行任务仍可轮询 |
| `test_skillrouter_search.py` | 三类字段映射；分页聚合与 `MAX_PAGES`；署名保留；错误不得返回空结果伪装 |
| `test_skillrouter_status.py` | 就绪度各状态；`unavailable`；目录失败 → `indeterminate`；状态接口不联网阻塞（SWR） |
| `test_skillrouter_gate.py` | `require_configured` 路由分支；`MANUAL_ONLY` 不受影响；手动模式回归 |
| `test_no_direct_llm_settings_reads.py` | 守卫（§4.1） |
| `test_manual_mode_regression.py` | 默认安装下所有既有路径（TTS/图片/视频/检索/LLM）**不触碰中转站**（假中转站收到 0 请求） |

**前端 vitest + Testing Library**：`SourceModeChooser`（键盘/单选语义）、`RouterConnectCard`（粘贴自动验证、各结果态、遮罩切换）、`RouterCoverageList`（开关写回与回滚）、向导步骤编排（`deriveWizardSteps` 对 unset/manual/router 的全部分支，已配置老用户不弹）、`describeRouterError` 全码覆盖、契约夹具测试（registry ↔ fixture ↔ TS）、`ConfigureCta` 路由。

**端到端联调（开发调试必做）**：本地启动 `F:\TMP-PROJECTS\aragon-router`（`scripts\start-dev.ps1`，其“桩上游”可跑通六类能力），Ecliptrix `base_url=http://localhost:<port>`，用管理员/成员创建 `ar-` Key，逐项走通：向导 → LLM 对话（openai 与 anthropic 两种模型）→ TTS（含 >1000 字）→ 图片（含参考图）→ 视频（文生/首帧）→ 三类检索 → 额度耗尽与 Key 吊销的错误态 → 模式往返切换。结果记入 `acceptance.md`。

### 8.2 验收标准（AC）

| # | 标准 |
| --- | --- |
| AC-01 | 新装用户启动：出现“选择来源”，两种模式可选；老用户（已手动配置完整）启动**不出现**向导且行为不变 |
| AC-02 | 选择中转站 → 引导注册链接（系统浏览器打开，主机白名单）→ 粘贴 Key → 验证通过 → 覆盖清单正确列出 11 项已覆盖与 3 项仍需手动 |
| AC-03 | 路由模式下，LLM 五槽位全部经中转站：`/api/chat`、视频剪辑 Agent、脚本生成、分镜、视频分析、AI 混剪、导出路径均不再读取 `LLM_*` 环境变量（守卫测试保证） |
| AC-04 | openai/anthropic/route 三类模型均可对话与流式输出，URL 与头部符合 §3.4 |
| AC-05 | TTS：短文本与 >1000 字文本均成功；时长与既有 `duration` 字段正确；克隆音色给出可行动提示 |
| AC-06 | 图片：文生图、参考图生图成功；返回尺寸与请求不同时有提示；文件落 `images/ark/<date>/` |
| AC-07 | 视频：文生/首帧生成成功；预览与导出同源本地路径可用；切换模式不影响在飞任务 |
| AC-08 | 三类检索结果可显示、可下载缓存，署名保留；翻页不超过 `MAX_PAGES` |
| AC-09 | 设置页可随时切换来源；切换不丢任何手动配置；切回手动后全部功能恢复原路径（假中转站 0 请求） |
| AC-10 | 按能力覆盖：把 `video_library` 改自己的配置后，仅该能力走 Pexels，其余仍走中转站 |
| AC-11 | 错误态全覆盖（§5.3 每个码至少一条 UI/接口断言），文案中英文齐全，且都有下一步操作 |
| AC-12 | 全链路零密钥泄露：`/api/skillrouter*`、`/api/integrations*`、`capability-status`、日志、审计、前端存储均无 Key 明文；仅既有回环 resolve 通道可返回 Key（自动化扫描 + 断言） |
| AC-13 | 无自动重试付费 POST；视频 `submission_unknown` 不重复提交 |
| AC-14 | 界面符合 §7：键盘可达、读屏可用、深浅色对比度 ≥ 4.5:1、`prefers-reduced-motion` 生效 |
| AC-15 | `npm run type-check`、`npm run lint`、`pytest tests/ -v`（既有基线红测试除外，需列出）、`vitest` 全绿；新增文件满足 Clean Code 阈值 |

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| **LLM 直读点遗漏**导致路由模式下部分功能仍用 env | 部分功能不走中转站、与用户预期不符 | §4.1 迁移清单 + 守卫测试；验收时人工 grep |
| 治理直读点改变**手动模式**行为（面板分配开始真正生效） | 老用户个别路径使用的模型变化 | 变更说明单列；测试固定“无 DB 分配时仍回落 env”；仅当用户已保存分配才变化（符合其本意） |
| 中转站协议/限额变更 | 适配器失效 | 一切枚举读 `limits`；未知字段容错；错误码映射带兜底；契约测试夹具随中转站版本更新 |
| 无幂等键，重试导致重复计费 | 用户额外花费 | 付费 POST 零自动重试；UI 明示；视频提交未知态 sticky |
| 路由模式并发上限（2/3）撞限 | 批量配音/多图变慢或失败 | 路由模式下压低本地并发；`Retry-After` 退避；清晰的 `router_busy` 提示 |
| 请求体上限 8 MB（参考图、帧） | 大图被拒 | 预压缩（长边 2048、JPEG q85）+ 预检；仍超则提示 |
| 中转站不可达（境内网络/上游故障） | 所有路由能力不可用 | 不自动回退（§3.7）；设置页实时可用性；一键把能力改手动；状态探针 fail-open |
| 克隆音色/ASR/Tavily 不被覆盖 | 用户误以为“全能力” | 覆盖清单与向导明示；`MANUAL_ONLY` 禁用开关并说明 |
| 开发实例 `http://localhost` 放宽被滥用 | SSRF/明文传 Key | 仅 loopback 主机放行；Key 仅发往配置的 `base_url` 同源；资产下载同源校验；不跟随跨源重定向 |
| 向导改动影响既有测试与老用户体验 | 回归 | `deriveWizardSteps` 对 manual/老用户分支保持原输出；新增快照测试；`SetupWizard.test.tsx` 既有用例必须全绿 |
| 视频垫片与既有 `video_task_contexts`/缓存假设冲突（`source="ark"`、`validate_remote_url`） | 产物收取失败 | `source_fetcher` 最小侵入；沿用 `ark` 缓存源标签；覆盖测试含重启恢复 |
| 设计要求（Supabase 绿色）与应用主色（蓝）风格冲突 | 视觉割裂 | 令牌限定 `.sr-scope`，仅中转站相关界面使用；其余界面不变 |
| 中转站条款/隐私 | 用户数据经第三方 | 选择时明确披露；手动模式保持直连、无披露 |

### 9.1 新增不变量（写入 `CLAUDE.md`，破坏即缺陷）

1. **来源模式是覆盖层**：任何代码不得在切换模式时删除/改写手动配置；`manual` 默认且老用户行为不变。
2. **路由决策唯一入口** `skillrouter.is_routed(capability)`；各接缝不得自行读取模式字段。
3. **`ar-` Key 零泄露边界（RV-01）**：Key 仅落库于后端；除既有回环 `resolve` 通道（Next 服务端与 Agent 调用方所必需，与所有既有 LLM Key 一致）外，**任何新增端点、状态接口、日志、审计、前端存储/UI 都不得含 Key 明文**（响应只给末四位，渲染进程不缓存、不入 localStorage）；付费请求不自动重试、不静默回退。

---

## 10. 实施顺序（供下游节点拆分）

0. **紧急阀（RV-12）**：环境变量 `SKILLROUTER_ENABLED`（默认开启）；设为 `0` 时 `is_routed` 恒为 False，所有接缝回到手动路径，无需改数据。
1. **P0 配置与客户端**：registry/校验/`config.py`/`client.py`/`errors.py`/`catalog.py` + 路由与 BFF + 单测。
2. **P1 LLM 覆盖层 + 直读点治理 + 守卫测试 + 就绪度/闸门**。
3. **P2 媒体适配器**：TTS → 图片 → 检索 → 视频（风险最高，最后）。
4. **P3 前端**：客户端与 i18n → 设置页面板 → 向导新步骤 → 其他面板横幅/IntegrationCard。
5. **P4 联调与验收**：对接本地 `aragon-router` 全链路；补 `acceptance.md`；更新 `CLAUDE.md`；桌面端冒烟（打包版必须验证 Next 服务端能访问中转站）。

每个阶段独立可合并，且阶段完成时 `manual` 模式回归测试必须为绿。

---

## 评审结论

**有条件通过**（v2）。

设计总体可行、边界清晰：覆盖层 + 唯一路由决策入口 + 协议垫片的接缝策略与既有架构（`integration_credentials`、`require_configured`、`model_settings_service`、`setup_status_service`）一致，「不回退、不重试付费请求」的取舍正确。评审发现的 6 项 P1（RV-01~06）已全部在正文修复，无遗留 P0/P1。

通过条件（实现阶段必须满足，均已写入正文/AC）：

1. 落实 `internal=True`，确保 `skillrouter` 不出现在通用 `/api/integrations*` 与前端夹具中（RV-03）。
2. resolve 热路径零网络依赖，协议取自已持久化的 `slot_protocols`（RV-02），并以「目录不可达仍可正常对话」的测试固定。
3. 零密钥边界按 §9.1 第 3 条的真实范围落地并自动化扫描（RV-01）；`ModelSettingsPanel` 不读取 `api_key`。
4. `RouterClient` 禁用自动重定向，Key 仅发往同源（RV-04）。
5. 状态模型新增值向前兼容旧前端（RV-05）。
6. P2 项（RV-09~13）在对应阶段落实；`SKILLROUTER_ENABLED` 紧急阀随 P0 一并交付。

---

## 实施过程发现的方案缺陷

### 媒体适配器（TTS / 图片 / 检索，a1-media）

| # | 缺陷（spec 原文） | 实际情况 | 处理 |
| --- | --- | --- | --- |
| IM-01 | §4.6 / §4.4 只写“接缝在服务入口” | `image_router` / `video_router` / `audio_router` / `ark_image_router` 都在 `try` 内把任何异常压成通用 500（或 `generation_error_response` 的 `generation_submission_unknown`），`RouterError` 的结构化错误码、`Retry-After`、`resets_at` 全部丢失，前端只会看到“Internal server error” | 四个路由在通用 `except` 前加 `except RouterError: raise`，交给 `main.py` 的应用级处理器；`tests/test_skillrouter_search.py`、`test_skillrouter_image.py` 各有 HTTP 级断言 |
| IM-02 | §4.4 `RemoteImage(url, headers)`，下载时 `get(url, headers=...)` | 既有下载用 `follow_redirects=True`，httpx 只在跨源重定向时剥离 `Authorization`，**不剥离 `x-api-key`**；带 Key 的 GET 一旦被重定向就会把 Key 发给第三方 | `RemoteImage` 改为携带 `router` 快照，路由资产一律走 `assets.download_asset`（同源校验 + 不跟随跨源重定向 + `.part` 原子改名）；CDN 地址仍走原下载路径。测试覆盖跨源重定向拒绝且无残留文件 |
| IM-03 | §4.4 只覆盖 `ark_image_service` 两处出口 | `storyboard_service._call_ark_seedream` / `_download_batch_original` 是第三处直连 ARK 图片的出口（分镜 2x2 合成图，`n=1`、`watermark=False`），路由模式下仍会读 `ark_image_api_key()` 并直连火山 | 不属于本节点文件（分镜服务由视频节点修改）；适配器已提供可复用的 `image_adapter.generate_via_router(prompt=, size=, count=, reference=, watermark=)` 与 `RemoteImage` + `assets.download_asset`，接缝需由 storyboard 所有者接入，并在闸门 `require_configured("ark_image")` 之外补 `ark_image_api_key()` 空值判断的路由分支（`storyboard_service.py:766`） |
| IM-04 | §4.3.4 只列 5 个 TTS 错误码映射，且说“其余→`TTS_UNKNOWN_ERROR`” | `TTSErrorDetails` 是 `extra='forbid'` 且没有 `suggest` 字段，§4.3.5 的 `suggest="manual_capability:tts"` 无处存放；`invalid_request`、`capability_disabled`、`invalid_provider_response`、`upstream_unavailable` 落入 UNKNOWN 会丢失可行动信息 | `TTSErrorDetails` 增加可选字段 `suggest`（加法，默认 `None`）；扩充映射：`invalid_request/text_too_long/content_rejected→TTS_INVALID_REQUEST`、`capability_disabled/tier_denied→TTS_PERMISSION_DENIED`、`invalid_provider_response→TTS_INVALID_RESPONSE`、`upstream_unavailable/egress_unavailable/capability_*→TTS_PROVIDER_ERROR`、`router_key_missing→TTS_CONFIG_MISSING`；仅 `TTS_RATE_LIMITED/TTS_TIMEOUT/TTS_NETWORK_ERROR` 可重试（沿用 `RETRYABLE_CODES`） |
| IM-05 | §3.3 `catalog.py` 全异步，§4.3/§4.6 的 TTS 工作线程与三个检索服务是同步 | 同步调用方无法 `await` 目录缓存；冷缓存时没有 `limits` 就无法夹取语速、字数、每页上限 | 新增 `skillrouter/sync_support.py`：`blocking_limits()`（先读 `catalog` 缓存，冷缓存才发一次阻塞 `GET /capabilities`，60 s 本地缓存）与 `run_blocking()`（在任意线程运行协程，包括已有事件循环的线程） |
| IM-06 | §4.3.6 “目录不可达时标记 stale”，但 `VoiceTypesResponse` 无承载字段；`TTSService.validate_config()` 仍要求火山 Key | 路由模式下用户没有火山 Key，所有 TTS 入口（含批量/句子批量/健康检查）都会先在 `validate_config` 上报 `TTS_CONFIG_MISSING` | `VoiceTypesResponse.stale: bool = False`；`validate_config` 在 `is_routed("tts")` 时改为只检查中转站 Key；`GET /tts/voice-types` 路由版走 `tts_adapter.router_voice_types` |
| IM-07 | §4.6 “缺失字段保持 None，不伪造”，但目标模型有必填字段 | `ImageInfo` 的 `user_id/created_at/updated_at/html_url/download_location/...`、`VideoInfo.id: int`、`AudioInfo.id: int` 都是必填；中转站检索项 `id` 是字符串，且不含 `user_id`、`created_at` 等 | 必填但网关未给出的字符串写空串、数值写 0（与手动路径对缺失字段的既有默认一致）；`user_username` 取自 `author.url` 的 `/@handle`，否则回落作者名（UI 以 `@{user_username}` 展示署名）；视频/音频 `id` 必须是纯数字，否则该条被跳过并记日志，**整页都被跳过则抛 `router_bad_response`**（绝不伪装成空结果）；署名文本 `attribution.text` 追加到响应 `message` |
| IM-08 | §4.6 “每页 1 次额度，`MAX_PAGES=4`” 未说明翻页时 `perPage` | 游标绑定页号，翻页间改 `perPage` 会让偏移错位（page 2 of 10 ≠ 接着 30 条） | 翻页期间 `perPage` 固定，最后超出的条目截断；首页失败抛 `RouterError`，**首页之后**的失败保留已取得的页并记日志（图片分批同理：已计费的图片不丢） |

### 视频垫片与 LLM 直读治理（a2-video-llm）

| # | 缺陷（spec 原文） | 实际情况 | 处理 |
| --- | --- | --- | --- |
| VL-01 | §4.5「`config_revision` = `RouterSnapshot.revision`」 | `ArkVideoGenerateRequest.expected_config_revision` 与 `StoryboardBatchVideoRequest.expected_config_revision` 是 `UUID` 类型，16 位十六进制 revision 会在 Pydantic 校验阶段 422，409 路径永远走不到 | `video_adapter.router_revision(snapshot)`：对 `snapshot.revision` 做 sha256 取 32 位十六进制并格式化为 UUID；仍是快照的确定性函数、不含密钥，配置变化即变 |
| VL-02 | §4.5「`create_task` 在 `is_routed` 时跳过 `resolve_video_config`」 | 分镜批量路径（`storyboard_service.batch_generate_videos` / `storyboard_video_queue.enqueue`）在 `create_task` 之前就调用 `resolve_video_config` 并预留上下文；这两处若不改，路由模式下会因没有 Ark Key 而 409 | 不改分镜文件：`resolve_video_config` 本身路由感知，返回不含密钥的 `VideoRuntimeConfig(integration_id="skillrouter")`。`create_task` 按**预留时冻结的配置**（`integration_id`）而非实时 `is_routed` 决定走哪条路，预留后切换模式不会把空 Key 发给 ARK |
| VL-03 | §4.5 `limits.models` 校验「非空必须在目录内」 | 目录不可达（冷缓存且网络失败）时无法校验；硬拒会让可用的中转站被本地缓存状态误伤 | 目录为空时放行 `model` 交给中转站校验（返回 `router_invalid_request`）；目录可用时仍本地 422 `invalid_model_configuration` |
| VL-04 | §4.5 RV-11「auth_error 轮询保持 `unknown`」 | `ArkVideoStatusResponse.status` 没有 `unknown` 值 | 解释为：轮询抛 409 `router_key_invalid`（`retryable:false`，前端停止轮询），任务上下文与产物**不**被置 `failed`（`_KEEP_TASK_CODES`），换 Key 后同一 `sr_` id 可继续；分镜队列因其 `finally` 会释放句柄，该分镜 job 以 `router_key_invalid` 失败 |
| VL-05 | §4.5「已受理但失败」未覆盖 | 中转站在提交未知结果时返回 **202 + 已失败任务**（`error.code=submission_unknown`），不是网络错误 | `submit_job` 识别该形态，同样抛 `generation_submission_unknown`（sticky），不重提交 |
| VL-06 | §4.1 直读点清单只列 `settings.*llm*` | `AIMixedEditingService()` 的无参旧构造器与 `VideoUnderstandingScriptService`/`ChatService` 的 `__init__` 缓存配置，且既有 2 个测试文件依赖无参构造 | `AIMixedEditingService` 必须传 `LLMCallConfig`（请求路径本就用 `create()`），两个测试改传显式配置；`ChatService`/`VideoUnderstandingScriptService` 去掉构造期读取，改为 `resolve_config()/resolve_llm_config()`，路由层先调用它以保持原有「未配置 → 500」语义；公共解析入口 `services/llm_call_config.py` |
| VL-07 | §4.1 视觉路径改走 `resolve_vision_config` | 视觉域（`video_analysis_service`、分镜描述帧）使用 OpenAI SDK，只会说 OpenAI 协议；路由模式下若视觉槽位选了 `anthropic` 协议模型，`{base}/api` + `/chat/completions` 会 404。另 `resolve_vision_config` 在无 VL 配置时按设计回落到 chat/fast（旧代码是「未配置」） | 本节点保持 OpenAI SDK 并对 anthropic 告警；**建议**设置面板对视觉槽位只推荐 `openai`/`route` 协议模型，或后续让视觉调用走 `llm_client`（含 anthropic 图片块转换）。回落到 chat 是 `resolve_vision_config` 既有文档化语义 |
| VL-08 | §4.2 / resolve 端点 | `model_settings_router.resolve_config` 把任何异常（含 `RouterError('models_unavailable')`）压成 500 `detail=str(e)`，与 §3.4.3「503 + 可操作提示」不符 | 未改（lead 文件）；建议 `except RouterError` 映射 `response_status` 与 `error_code` |
| VL-09 | 测试环境 | `llm_client` 用默认 `httpx.AsyncClient`（`trust_env=True`），Windows 系统代理（如 Clash）会对 `127.0.0.1` 本地网关返回 502；`client.py` 已对回环主机关闭 `trust_env`，但 `llm_client` 没有 | 契约测试用 `NO_PROXY` 绕过；若要支持「本地 aragon-router 开发实例 + 系统代理」，需让 `llm_client` 对回环主机同样关闭 `trust_env` |

### 前端核心（客户端 / BFF / 设置面板，b1-frontend）

| # | 缺陷（spec 原文） | 实际情况 | 处理 |
| --- | --- | --- | --- |
| FC-01 | §5.3 `router_quota_exceeded` / `router_busy` 两个 429 码由前端 `describeRouterError(code, …)` 区分 | 共享 `http-client` 对**所有** 429 抛 `RateLimitError`（`code` 恒为 `RATE_LIMITED`），原始 `error_code` 被丢弃，并广播全局 `ecliptrix:rate-limited` 事件（默认 5 s 倒计时 toast，对“今日额度已用完”是误导文案） | `routerErrorCodeOf(error)` 依据 `error_details` 推断：含 `resets_at` → `router_quota_exceeded`，否则 `router_busy`。**遗留**：全局 429 toast 仍会触发；建议后续让 `http-client` 把 `error_code` 保留进 `RateLimitError.details`，并对带 `resets_at` 的 429 不广播通用倒计时 |
| FC-02 | §3.3 / §5.1 未写时间单位 | `catalog.fetchedAt` 是 epoch **秒**（`time.time()`），而 `quota.resetsAt`、`lastVerified.at` 是毫秒 | 客户端 `getSkillRouterCatalog` 统一换算为毫秒；建议后端在 §5.1 注明或改为毫秒 |
| FC-03 | §7.3 状态胶囊含“已连接/未验证/Key 无效/无法连接” | `lastVerified` 仅存内存（重启即丢），重启后任何已保存 Key 都会显示“未验证”，需用户点一次“重新验证” | 如实显示“未验证”（不把未知当成已连接）；若要重启后保持，需后端把最近一次验证结果持久化（不含密钥） |
| FC-04 | §6.2 “`credentialLinks` 新增 `skillrouter`：注册、Key 页、文档” | `GetCredentialLink` 只渲染 `consoleUrl` + `docsUrl`，没有“注册”位 | 注册页登记为独立 registry id `skillrouter_register`（`consoleUrl=…/login`），Key 页与文档为 `skillrouter`；二者都只经 `GetCredentialLink` 渲染，主机白名单加入 `www.skillrouter.net` |
| FC-05 | §3.4 RV-01 “设置面板不读取 `api_key`” | `ModelSettingsPanel.fetchEffectiveConfigs` 本来就只复制展示字段；缺的是防回归 | 新增源码扫描测试（`skillrouterContract.test.ts`）断言该函数体不含 `api_key`，并在函数前加注释说明原因 |

### 向导（b2-wizard）

| # | 缺陷（spec 原文） | 实际情况 | 处理 |
| --- | --- | --- | --- |
| WZ-01 | §6.2 “`IntegrationId` 加 `skillrouter`（不进入向导分组）” | `IntegrationId` 驱动 `Record<IntegrationId, …>`（`INTEGRATION_CAPABILITIES`）、`t.integrations[id]`、夹具契约测试；加入后这些表都要为一个“不是卡片”的 id 造假条目，与 RV-03 `internal=True` 的意图相悖 | `IntegrationId` 保持 8 项；新增 `SetupWizardFocus = IntegrationId \| 'skillrouter'`（`setupEvents.ts`），`openSetupWizard` / `ConfigureCta` / `CredentialMissingListener` 使用它；`credentialMissing.notConfiguredTarget()` 在 `notConfiguredIntegration()` 之外识别 `skillrouter`，后者的返回契约（含 `useIntegrationCard` 的“必填”分支）不变 |
| WZ-02 | §7.2 “`deriveWizardSteps` 接受来源模式”未说明何时读取 | 向导步骤在打开时冻结，来源模式必须**先于挂载**读到；而既有 `SetupWizard` 单测不传来源也必须逐字节不变 | `deriveWizardSteps(…, source?)` 的 `source` 省略即旧行为；`SetupWizard` 新增可选 `sourceMode`，缺省 = 无 `source` 步；新增 `SetupWizardHost` 先读 `GET /api/skillrouter`（2.5 s 超时、失败 fail-open 为 `manual`）再挂载向导，`page.tsx` 改渲染 Host |
| WZ-03 | §7.2 流程图 `source` 步后分支，但步骤列表要“冻结” | 用户在 `source` 步翻转卡片时右侧步进条的后续步骤应随之预览 | 翻转卡片是用户的即时选择，与 `skipOptional` 同属“冻结”的例外：`selectChoice` 重新派生（仅影响 `source` 之后的步骤） |
| WZ-04 | §7.2 `manualOnly` 步复用“既有卡片 + search 步内容” | 既有 `useSearchStep` 保存成功后会 `goNext`，在 `manualOnly` 内会跳过 asr/voice_clone 两张卡片；`SearchStep` 的表单与导航又绑在一起 | 抽出 `SearchKeyField`（textarea + 链接 + 反馈）给两处复用；`useSetupWizard` 的搜索完成回调在当前步为 `manualOnly` 时不前进；`IntegrationGroupStep` 增加 `ids` / `bare` 以嵌入 |
| WZ-05 | §4.7 `unavailable` “可一键改用自己的配置”未规定落点 | 写入 `manual_capabilities` 之后，该能力的手动凭证在哪配置没有说明；路由分支的步骤里没有对应的分组步 | `switchCapabilityToOwn()` 先重读状态再追加（不丢他处新增的覆盖项），随后 `openSetupWizard(<该能力的集成>)` 打开手动卡片，LLM 槽位则打开模型设置；清单行与完成页都提供该按钮 |
| WZ-06 | §7.4 “焦点在步骤切换后移到标题” | 既有步骤各自 `autoFocus` 主按钮/输入框，统一抢焦点会改变既有行为与测试 | 仅新步骤（`source/router/routerModels/manualOnly`）使用 `StepHeading focusOnMount`；既有步骤保持原样（遗留：若要全局统一需另行评审既有 autoFocus） |
| WZ-07 | §7.2 “未保存的 Key 草稿关闭前确认” | `RouterConnectCard` 的 Key 草稿在其内部 hook 中，向导的 `hasDraft` 感知不到 | 遗留：卡片未暴露 `onDraftChange`；建议 b1 后续加一个可选回调并接入 `reportIntegrationDraft('skillrouter', …)` |
| WZ-08 | 环境 | 本机 shell 设置了 `NODE_ENV=production`，`npm ci` 默认跳过 devDependencies，仓库根目录原本没有 `node_modules`，vitest/tsc/eslint 均不可用 | 用 `NODE_ENV=development npm ci --include=dev --ignore-scripts` 安装；测试以 `NODE_ENV=test npx vitest run` 运行 |

- **VL-07 决议（lead）**：采用方案 (a)——`pick_default_model("vision")` 优先非 anthropic 协议模型；视觉调用点仍用 OpenAI SDK，若用户手动把 vision 槽位设为 anthropic 模型只记录警告。方案 (b)（VL 调用迁到 llm_client）留待后续。VL-08 已修：`resolve_config` 对 `RouterError` 原样抛出，由 main.py 处理器返回结构化信封。
