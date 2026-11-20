# Pexels 视频库下载误入通用网页出口：诊断报告

Implementation update (2026-11-20): approved fix A is implemented and verified with deterministic network fixtures and real MP4 bytes. See the final implementation section for evidence and live-environment limits; earlier sections retain the original diagnostic baseline.

## 问题描述

**结论：搜索阶段已经调用视频库 API，缺陷发生在搜索结果的下载、缓存与 Agent 工具之间。** 搜索工具把 Pexels 结果标为尚无本地字节的候选，却统一要求 Agent 调用 `download_url`。该工具进入通用网页出口，以默认 `document=True` 执行 robots 检查，没有根据视频库来源选择手动 API 或 SkillRouter 下载能力，也没有先复用视频库缓存。现场 `robots_failure_stage=http`、`upstream_status=403` 表示获取 robots 的响应被拒绝；不能据此声称 MP4 返回了 403，或网站明确写了某条 Disallow 规则。

- 本轮需求：手动配置使用 Pexels 视频库 API；聚合配置使用 SkillRouter 视频库能力，搜索后可靠下载入库。
- 当前节点：问题定位与分析。仅新增本报告、离线复现与结果文件，不修改业务实现，不运行 `git commit`。
- 代码基线：`cb93a53438ef830e17984cbb38371dc5c4907277` 加进入任务前已有的未提交改动。保留上一轮脚本、失败隔离及 robots 缓存修复。
- 已阅读 `README.md`、`CLAUDE.md` 和项目索引；产品运行链为 Electron → Next.js Agent 工具/BFF → FastAPI → 外部能力/本地缓存。

## 复现步骤

### 1. 确定性离线复现（推荐，无需任何真实 Key）

在仓库根目录 `M:/takoAI/Ecliptrix` 的 PowerShell 中分别运行以下命令。前提：已有项目 Node/Python 依赖可用；无需启动 Electron、Next.js 或 FastAPI。每条命令结束后检查退出码，再执行下一条。

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
python docs/diagnoses/pexels-video-download-routing/repro/backend_repro.py
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/pexels-video-download-routing/repro/vitest.config.ts --reporter=default --reporter=json --outputFile=docs/diagnoses/pexels-video-download-routing/repro/frontend-results.json
```

Python 复现执行真实 `VideoSearchService`、搜索适配器、`egress.download` 和 `SafeHttpClient`；仅替换手动 HTTP、网关 HTTP 边界及下载字节传输，固定机器人规则响应为 403。没有修改磁盘凭证、没有请求公网。预期退出 0，并生成 `repro/backend-results.json`，包含四组观察：

| 用例 | 预期观察 |
|---|---|
| 手动搜索 | 调用 `https://api.pexels.com/videos/search`，带测试 Authorization 头，取得 MP4 链接 |
| 聚合搜索 | 调用 `media/search/videos`，取得同一个 MP4 链接 |
| 手动配置下通用下载 | 两个不同视频均为 `robots_disallowed`；第一次缓存未命中，第二次命中；只请求一次 `/robots.txt`；视频字节请求、入库及视频库路由判定均为 0 |
| 聚合配置下通用下载 | 与上一项一致；聚合模式未改变通用下载路径 |

后两组还包含一个纯离线对照：相同假传输对 MP4 本身返回 200，说明拒绝产生在 robots 前置阶段。对照中的 `respect_robots=False/document=False` **仅用于测试定位，不是生产修复建议**。下载对配置的复现通过替换真实 `is_routed` 返回值完成；断言证实该通用路径根本没有调用此判定，不代表启动了两套真实用户配置。

Vitest 执行真实 Agent 工具和候选守卫，HTTP 响应为离线夹具，预期三个用例通过：

1. `search_video` 返回 `pexels-10814082` 候选，`next_step` 指向 `download_url`。
2. 即使同轮上下文已有这个视频的 ready 本地缓存，`download_url` 仍只调用 `/api/agent-host/egress/download`，不查询缓存，也不传 `source/source_id`；模拟后端 robots 拒绝后不发布入库操作。
3. 只有 `cacheUrl`、仍保留 `size=0` 的候选，真实 `isMetadataOnlyMaterial` 继续返回 true。

这些测试刻意断言**当前缺陷行为**，通过表示成功复现，不表示业务已修复。修复节点应将其转换或补充为正确行为回归测试。

### 2. 现有测试交叉验证

在后端目录运行以下命令；使用仓库内独立临时目录，不接触真实用户数据库：

```powershell
Set-Location 'M:/takoAI/Ecliptrix/backend-services/basic-service'
python -m pytest tests/test_skillrouter_search.py::test_video_results_map_to_video_info tests/test_skillrouter_search.py::test_mixed_orientation_sends_no_filter tests/test_research_safe_http.py::test_robots_cached_refusal_never_fetches_target -q --basetemp=M:/takoAI/Ecliptrix/.agentmesh/pexels-diagnosis-pytest --junitxml=M:/takoAI/Ecliptrix/docs/diagnoses/pexels-video-download-routing/repro/pytest-results.xml
```

实测：5 个参数化后用例通过，26 条既有弃用警告。两项搜索测试使用真实本地假网关 HTTP 和真实 RouterClient；robots 测试验证 401/403/503 缓存拒绝不会请求目标文件。它们不覆盖公网 CDN 或网关媒体入库。

### 3. 应用交互复现步骤（供修复节点验收）

1. 正常启动开发版或安装版，打开视频编辑工程；先在设置选择手动模式并保存有效 Pexels Key。
2. 向 Agent 下达“搜索 `cockapoo puppy cute` 的竖屏视频，下载第一条并加入素材库”。记录 `search_video` 成功回执及它返回的 `video_url`。
3. 观察下一工具：当前描述引导 `download_url`，其后端路径为 `/api/agent-host/egress/download`。
4. 若运行环境中 CDN 的 `/robots.txt` 返回 403，可看到与原日志相同的 `robots_disallowed`；再下载同源第二个视频将命中 robots 缓存。若该环境 robots 可访问，缺陷路径仍存在，但本次不保证出现拒绝。
5. 改为 SkillRouter 模式，保存有效网关配置后重复步骤 2～4；搜索应走聚合 API，下载目前仍进入相同通用出口。
6. 对照后端 `/api/material/lookup?source=pexels&source_id=<实际视频ID>` 的状态，检查后台缓存是否已 ready、Agent 是否仍尝试另行下载。不要将后台缓存成功当成 Agent 已取得下载回执。

本节点没有执行真实凭证交互、CDN 下载或付费入库；上面是可操作的现场复现/验收步骤，非已完成的端到端验收。

## 根因分析（含证据）

### F-01：API 搜索已经正确分流，候选下载却统一指向通用工具（主因）

手动搜索的 `VideoSearchService._make_api_request` 使用 Authorization 头和 API GET：`backend-services/basic-service/app/services/video_search_service.py:137`、`backend-services/basic-service/app/services/video_search_service.py:146`。`VideoSearchService.search_videos` 在 `backend-services/basic-service/app/services/video_search_service.py:189` 使用唯一判定 `is_routed("video_library")`，聚合路径调用 `backend-services/basic-service/app/services/skillrouter/search_adapter.py:252` 的 `media/search/videos`，并在 `backend-services/basic-service/app/services/skillrouter/search_adapter.py:169` 把 `downloadUrl` 映射为 `video_url`。

前端搜索工具经过 `/api/video-search` BFF，但明确告诉模型候选必须用通用下载：`src/lib/video-editing-agent/tools/searchVideo.ts:98`、`src/lib/video-editing-agent/tools/searchVideo.ts:192`。候选指引的实际内容见 `src/lib/video-editing-agent/tools/stillClip.ts:162`：

```typescript
export const CANDIDATE_NEXT_STEP =
  'Use download_url to write the bytes, then add_to_track.';
```

`downloadTool` 在 `src/lib/video-editing-agent/tools/egressTools.ts:115` 固定选择 `/egress/download`；`src/lib/video-editing-agent/tools/hostToolAdapter.ts:483` 拼接为 `/api/agent-host/egress/download`。后端 `backend-services/basic-service/app/services/agent_host/egress.py:268` 的 `download` 不读取视频库配置、候选 ID 或已有缓存，直接请求传入 URL。离线用例证实两种来源模式均走这一分支。

因此不能把问题归结为“Pexels 搜索在爬网页”，也不能仅重写搜索接口就认为下载衔接完成。当前用户看到的“搜索成功”只表示取得视频元数据和文件链接。

### F-02：媒体文件按默认文档策略进行 robots 检查（直接触发条件）

`backend-services/basic-service/app/services/agent_host/egress.py:286` 构造：

```python
policy = FetchPolicy(limit, seconds,
                     settings.get("respect_robots", True))
```

该构造未指定第四个字段；`backend-services/basic-service/app/services/web_research/safe_http_client.py:274` 的 `document` 默认为 true。`backend-services/basic-service/app/services/web_research/safe_http_client.py:375` 因 `respect_robots and document` 在请求媒体之前执行 `check_robots`。

robots 加载在 `backend-services/basic-service/app/services/web_research/safe_http_client.py:476` 将 401/403 记录为整个 origin 的 disallowed；`backend-services/basic-service/app/services/web_research/safe_http_client.py:458` 对缓存命中继续抛错。TTL 在 `backend-services/basic-service/app/services/web_research/safe_http_client.py:39` 为 3600 秒。该行为解释了原日志首条 `robots_cache_hit=false`、之后同源不同视频均为 true。

现场日志的关键证据（来自本轮任务描述）：

```json
{
  "error_code": "robots_disallowed",
  "error_details": {
    "layer": "robots",
    "upstream_status": 403,
    "robots_scope": "origin",
    "robots_origin": "https://videos.pexels.com/",
    "robots_failure_stage": "http",
    "robots_cache_hit": false
  }
}
```

本轮真实 SafeHttpClient 离线复现的观察：

```text
实际传输请求 = ["https://videos.pexels.com/robots.txt"]
视频字节请求次数 = 0
首次错误 = robots_disallowed，robots_cache_hit=false
同源第二条错误 = robots_disallowed，robots_cache_hit=true
离线 MP4 响应对照 = 200
```

根因假说已被离线证据支持：**视频库文件被交给网页工具后，robots 403 成为下载前置拒绝。** 原现场 robots 403 究竟由 CDN/WAF、地区网络还是其他上游策略导致，尚无公网响应头或边缘请求日志可确定。本节点没有复现真实 CDN 的当前 HTTP 行为，也没有发现需要回滚上一轮缓存拒绝修复的证据。

### F-03：已有后台预下载未形成 Agent 可使用的物化回执（放大因素）

`backend-services/basic-service/app/routers/video_router.py:118` 开始对搜索结果执行后台预下载，`backend-services/basic-service/app/routers/video_router.py:125` 无论结果来自哪种搜索模式都使用 `source="pexels"` 入队。后台服务当前使用 FFmpeg 读取 CDN，见 `backend-services/basic-service/app/services/material_download_service.py:849`，并非复现中的 SafeHttpClient。因此后台下载可能成功、失败或仍进行中，**不能从 Agent robots 错误推断后台也遇到相同拒绝**。

缓存已有公开查询和入队接口：`backend-services/basic-service/app/routers/material_router.py:65`、`backend-services/basic-service/app/routers/material_router.py:132`；服务支持按 `(source, source_id)` 查找，见 `backend-services/basic-service/app/services/material_download_service.py:274`。但 Agent 搜索先写入 `size=0` 候选并把其推入同轮上下文：`src/lib/video-editing-agent/tools/searchVideo.ts:69`、`src/lib/video-editing-agent/tools/searchVideo.ts:178`。通用下载不查询这些缓存；前端预取在 `src/components/video/hooks/useRemoteMaterialPrefetch.ts:356` 只补 `cacheUrl`，没有同步大小及候选标记。对这种仍为 `materialized=false` 的零字节候选，`src/lib/video-editing-agent/tools/stillClip.ts:180` 返回 true；但该函数第 178 行允许“已物化且有合法 storage key”的条目不报告大小，不能概括成所有零大小素材都被拒绝。

**评审限定实际调用点：** `src/lib/video-editing-agent/tools/addToTrack.ts:108` 对视频候选的拒绝取决于 `turnState.editingGoal` 和候选标记；直接调用 `isMetadataOnlyMaterial` 的无条件分支只针对图片。本报告的第三个前端诊断用例验证候选判定函数，未执行视频上轨。因此已证实的是下载衔接和回执缺失，不能用该用例声称所有视频上轨场景必定失败。

因此单独改提示词“直接上轨”，或只给候选添加 `cacheUrl`，都不足以稳定完成入库和上轨。需要包含真实本地字节、大小、稳定 ID 与同轮上下文更新的回执。现有通用工具对物化标志的写回可参考 `src/lib/video-editing-agent/tools/hostToolAdapter.ts:267`，但应保留视频库身份，避免把同一个 Pexels 素材重新建成不相关的 `web-*` 项。

### API 契约核查与历史设计差异

1. **Pexels 文件链接仍是 API 工作流的一部分。** [Pexels 官方文档](https://www.pexels.com/api/documentation/#videos) 定义视频 JSON 的 `video_files[].link` 为文件地址；API 鉴权通过 Authorization 头。API 解析后从文件地址取字节不等于爬取页面。手动模式应由后端持有 API 凭证、解析/刷新文件信息并下载，不能把 Key 交给 Agent 或发送给 CDN。
2. 官方文档现列出 `https://api.pexels.com/v1/videos/` 新前缀，并提示旧前缀将弃用；当前项目和网关源码仍用 `/videos/search`。这是应单独跟踪的兼容性事项；现场搜索已经成功，没有证据表明它是此次 robots 错误的原因。[官方接口说明](https://www.pexels.com/api/documentation/#videos-search)
3. 历史方案 `docs/plans/skillrouter-capability-gateway/spec.md:351` 明确采用“聚合 API 搜索、文件仍由客户端取 CDN、不用 ingest”。对应适配器文件头也保留相同设计。新需求要求聚合模式下载使用平台能力，实施时须同步修订这条设计，不能声称旧预下载已满足新契约。
4. 已只读核查用户指定的网关仓库。`F:/TMP-PROJECTS/aragon-router/src/lib/media/adapters/pexels.ts:138` 返回上游 `downloadUrl`；现有 `POST /api/v1/media/ingest` 可接收搜索文件并保存资产，入口为 `F:/TMP-PROJECTS/aragon-router/src/app/api/v1/media/ingest/route.ts:20`，响应为 `201 {data:{asset}}`。`F:/TMP-PROJECTS/aragon-router/src/lib/media/gateway/ingest.ts:205` 读取 `sourceUrl`，只接受已启用素材源的 CDN，并在同文件第 224 行消耗一个入库额度、占用 generate 并发槽。资产 URL 投影见 `F:/TMP-PROJECTS/aragon-router/src/lib/media/view.ts:106`。这些是**本地网关源码契约**，未验证线上部署版本支持情况。
5. Ecliptrix 已有同源带 Key 的资产下载器：`backend-services/basic-service/app/services/skillrouter/assets.py:55`。该能力校验同源、限制字节数并使用 `.part` 原子落盘，可复用，不应把需要鉴权的资产 URL直接交给浏览器匿名加载。

## 影响面

| 范围 | 已确认或可能影响 |
|---|---|
| 手动 Pexels 配置 | API 搜索可成功，但 Agent 按候选指引下载时可能被通用 robots 前置拒绝 |
| SkillRouter 视频库配置 | API 搜索已经分流；Agent 下载未跟随该路由，且后台预下载仍走直接 CDN/FFmpeg |
| 同源多文件 | robots 403 缓存会影响同一 origin 的其他视频；这不是上一轮已修复的全通道熔断 |
| 素材入库、审阅、上轨、导出 | 受影响素材若没有其他可用本地副本，就无法可靠完成后续流程；不意味着所有导出都失败 |
| 手动界面/后台预取 | 存在独立缓存路径；不能直接等同 Agent 失败，但若改缓存公共接口需回归这些消费者 |
| 图片、音频及普通网页 | 共享候选指引/通用工具，具有类似耦合风险；本轮没有对其外部供应商进行现场复现 |
| 已有本地素材/脚本/TTS/AI 生成 | 无证据表明此次 robots 错误直接影响这些能力；不应扩大实现范围 |

## 候选修复方案

| 方案 | 实现要点 | 侵入性 | 风险与权衡 | 工作量 |
|---|---|---|---|---|
| **A：统一视频库物化服务 + 专用 Agent 工具（推荐）** | 新增按候选/素材 ID 获取本地视频的接口和工具；在服务内只用 `is_routed("video_library")` 选手动 Pexels 或 SkillRouter；复用原缓存、稳定 ID 和入库回执 | 中，覆盖 Agent 工具、视频库服务和预下载衔接 | 清楚满足两模式要求；聚合 ingest 增加额度、延迟和平台存储，必须受控且不自动重试付费 POST；需处理旧候选和飞行请求 | 中 |
| B：只衔接现有缓存 API | Agent 查询 `/api/material/lookup`，按需入队并等待 ready；补全字节信息和同轮上下文，修改搜索指引 | 低 | 能减少重复下载并绕开错误工具选择；但后台仍直接取 CDN，**不能完整满足聚合下载经平台 API 的新需求**；缓存失败时仍需正式方案 | 小，适合过渡 |
| C：在通用 download_url 中识别已登记视频库候选并转发 | 保留工具名，后端只对服务端确认的候选进入视频库分支，内部仍实现双模式下载 | 中到高 | 兼容旧模型调用，但把通用网页与供应商职责耦合；若只凭 URL/客户端 source 判定就会扩大信任范围；长期维护较复杂 | 中到大 |

不建议关闭全局 robots、把 Pexels 域名直接加入通用跳过名单、无条件设置 `document=False`，或反复重试相同被拒绝 URL。这些操作没有补上能力路由、缓存回执和身份衔接。

## 推荐修复及理由

**推荐方案 A。** 它直接修复“视频库候选应由视频库能力物化”的职责缺口，并能复用现有缓存与网关资产下载器。方案 B 可提供部分缓存复用代码，但不能作为满足本轮需求的最终结论。

建议实施边界如下（均为待实施建议，本节点未落业务代码）：

1. **新增按候选身份物化的服务。** Agent 只提交 `material_id` 或服务端签发的候选引用，不提交任意 URL 来获得供应商下载权限；后端从可信搜索记录解析 `source/source_id`、原链接、来源模式、署名及配置快照。缺失/过期候选应返回可恢复的明确错误。对历史候选，仅经过视频库 ID/API 校验后迁移。
2. **手动模式。** 使用现有凭证服务读取 Pexels Key，经 API 搜索结果或按视频 ID 的详情取得可下载文件链接；有效搜索结果可复用，链接失效再通过 API 刷新。由受限媒体下载器取字节，保留 URL/重定向/DNS 校验、大小与超时限制、媒体探测及原子落盘；研究网页 robots 策略不参与专用供应商 API 下载。API 请求携带 Pexels Authorization，CDN 请求不携带该 Key。官方新路径迁移需另行验证，不能与本次拒绝原因混淆。
3. **聚合模式。** 搜索保留现有 `POST /api/v1/media/search/videos`；物化通过 `POST /api/v1/media/ingest`，请求体使用 `sourceUrl`，带来源署名。网关源码定义的 HTTP 响应为 `201 {data:{asset}}`；现有 RouterClient 已解包 `data`，Python 调用方应读取 `result['asset']['url']`，用现有 `assets.download_asset` 同源带 Key 下载，再登记本地视频。不要假定有 `/videos/download`，也不要将 `/search/videos` 当成返回 MP4 的接口。部署若不支持 ingest，应明确报不支持；禁止静默改用手动 Key 或直接 CDN。
4. **复用与并发。** 保留 `(pexels, video_id)` 缓存键；对 ready、真实存在且验证通过的本地文件直接复用。对相同候选并发请求合并为一个下载；原有搜索预下载、前端预取应接到同一个物化入口，避免聚合模式还在并行用 FFmpeg 下载所有结果。聚合入库只为用户实际选中的素材触发，避免每次搜索自动消耗全部结果的额度。
5. **完整回执与一致性。** 物化成功必须回传真实本地 `local_url`、`size>0`、格式、尺寸、时长、source/source_id；更新原候选稳定 ID、`candidate=false/materialized=true`、Agent 同轮上下文和客户端 store。需要补齐当前缓存响应缺少真实文件大小的问题，不能只改 `cacheUrl` 或伪造非零大小。继续使用现有租约/取消和操作回执机制，避免旧回合在取消后写入工程。
6. **模式及 Key 快照。** 路由只通过 `backend-services/basic-service/app/services/skillrouter/config.py:109` 的 `is_routed` 决定；保留手动能力覆盖与总开关。飞行任务持有一致的来源和配置修订，模式/凭证变化时明确冲突或按已捕获快照完成，不能混用两类 Key；Key 不进入候选、模型上下文、前端存储或日志。
7. **错误与成本。** 缓存未 ready 不宣称已下载；401/403/404、429、超时、超限及媒体校验失败提供对应结构化回执。聚合 ingest 会消耗额度并新增资产，不能沿用搜索的幂等 POST 重试设置；请求结果不明时禁止盲目重新 POST。普通 `download_url` 保留网页出口及现有分支失败隔离。
8. **更新指引与文档。** `search_video` 的描述、`next_step`、上轨候选守卫应指向视频库物化工具；保留图片/音频现有行为，避免直接修改共享常量造成范围扩大。同步更新历史方案中“素材下载不经中转站”的视频库条目。

### 修复节点的最小验收清单

- 手动模式：有 Pexels Key、无 SkillRouter Key，真实 API 搜索和本地下载成功，工具路径不进入通用 robots 检查。
- 聚合模式：有 SkillRouter Key、无 Pexels Key，搜索 → ingest → 鉴权资产下载 → 本地入库；断言无手动 Key 读取、无客户端直连 Pexels CDN。
- 模拟 CDN `/robots.txt` 为 403、实际 API 文件可获取：专用视频库流程仍可完成；普通网页工具仍按原策略拒绝。
- 再次物化已有本地缓存不下载、不创建聚合资产；并发同 ID 只执行一次；不同 ID 不互相错误熔断。
- `size=0`、伪造 source/URL、私网重定向、超大/空/损坏文件、失效链接均不产生“成功素材”；Key 不出现在 CDN 请求或日志。
- 401/403/404/429、网关不支持 ingest、模式切换、取消、超时后结果不明均明确报告；不自动重复付费入库、不静默降级。
- 同轮下载后可复用原 ID 审阅与上轨；保存/重开后仍使用本地路径，完成一次真实视频导出。

## 验证记录与限制

- 2026-11-20：Python 离线脚本四组观察完成；真实 SafeHttpClient 执行 robots 缓存逻辑，`backend-results.json` 已保存。
- Agent 工具离线复现：3 个用例通过，`frontend-results.json` 已保存。
- 既有相关后端测试：5 个用例通过，`pytest-results.xml` 已保存；仅有既有弃用警告。
- 源码定位与网关接口核查完成；没有执行真实 Pexels/SkillRouter 计费请求，没有验证线上 ingest 版本、真实 CDN 可达性、安装包交互、保存重开或最终导出。
- 本节点不声称缺陷已修复；后续节点应评审方案、实现并执行上述验收。任务状态回报与本地回退情况记录在任务板本节点区域。

## 评审补证与方案审计（2026-11-20）

### R-01：调用链成立，但生产版本与公网原因必须保留证据边界

补全两段实际路由：`src/app/api/video-search/route.ts:5` 将搜索转发到 `/api/video/search`；`backend-services/basic-service/app/routers/agent_host_router.py:196` 注册 `/egress/download`，第 199 行直接调用报告引用的 `egress.download`。结合 F-01 中真实工具的固定请求路径，可排除“报告只引用了同名但未被调用的下载函数”。`src/lib/video-editing-agent/tools/index.ts:432` 也确实注册了 `search_video`，并非未使用的旧实现。

现场首个请求 `4e528a40-cfc4-4dd5-a4cd-48655e574d1b` 记录 robots HTTP 403、origin 级拒绝且未命中缓存，第二个不同视频请求 `f7529f31-1e5b-4c5c-af30-7c7e0c425b6e` 命中同源缓存，日志出处为本节点输入任务文件第 375、416 行。当前源码和离线复现能解释这一序列。前端 `src/lib/video-editing-agent/tools/hostToolAdapter.ts:404` 仅把 `robots_unavailable` 扩为同源前端拒绝；本次 `robots_disallowed` 由后端 robots 缓存解释，不能误报为全局熔断复发。

成立条件是通用出口开启且 `respect_robots=true`；这由 `backend-services/basic-service/app/services/agent_host/egress.py:271` 和第 286 行决定。robots 放行、关闭该设置或直接使用现成本地文件，均可不出现本次拒绝，不能因此否认错误路由。反过来，API 取元数据成功不证明 MP4 可达；离线对照里的 200 是夹具，尚不能排除实际文件下载时另有 WAF、网络、过期链接或权限错误。

未取得现场应用构建号或网关部署版本。现场 `robots_origin` 带尾斜杠，而当前 `safe_http_client.py:437` 的字符串不带尾斜杠，故证据支持同一失败机制，不证明现场与工作区逐字节相同。实施验收须补记录实际版本及分阶段响应；不需要为此回滚现有 robots 拒绝缓存。

### R-02：复用稳定 ID 必须更新原条目，不能重复 add

这是原推荐方案的必要补充：`src/lib/video-editing-agent/tools/hostToolAdapter.ts:268` 在发现同 ID 已存在时跳过发布和上下文写入；`src/stores/slices/materialSlice.ts:60` 的 `addMaterials` 也只追加新 ID。即使后端返回完全正确的本地文件，照搬通用成功适配器并保持 `pexels-<id>`，原候选仍可能保持 `size=0/materialized=false`。

现有 `src/lib/video-editing-agent/types.ts:259` 将 `update_material.patch` 限定为时长、宽、高，尚不能合法携带物化字段。最小修复应扩展该既有更新操作所需的字段，更新 `size/cacheUrl/storageKey/cacheStatus/metadata`，并保留原署名、标签及脚本关联；已有候选使用更新操作，库中不存在才添加。`src/lib/video-editing-agent/AgentEventRouter.ts:591` 已将更新交给 store，`src/stores/slices/materialSlice.ts:74` 已支持合并，无需把全局 `addMaterials` 改成覆盖式 upsert。

还须在工具内同步更新同轮 `context.materials`；客户端收到事件不会自动刷新服务端正在运行的上下文。`src/lib/video-editing-agent/OperationApplier.ts:403` 已支持记录更新前值并撤销，第 529 行的添加撤销则直接删素材；把已有候选伪装成新添加会产生“撤销下载删除原候选”的回归。重复搜索同 ID 也不得用新的候选覆盖已成功物化的原条目。

### R-03：ready 缓存复用需要失效恢复与并发互斥

`backend-services/basic-service/app/services/material_download_service.py:328` 仅在 ready 且本地路径存在时提供 `local_url`，未检查文件非空或媒体有效性。更关键的是 `_enqueue_impl` 在第 202 行只重排 failed/pending，ready 但文件消失时在第 208 行选择不下载。评审以真实方法、模拟会话及缺失文件执行，观察为：

```text
_enqueue_impl('pexels', '10814082', trusted_url)
  -> status='ready', local_url=None, _submit.call_count=0
```

因此 A/B/C 均不能把“lookup ready，否则再 enqueue”当成完备恢复。物化入口应验证文件处于缓存根内、真实存在、大小有效且可探测；失效时清理 ready 状态后按同一来源流程恢复。保留 `(pexels, video_id)` 与 `src/components/video/lib/materialKey.ts:57` 的键算法，不把缓存数据库 UUID、前端 `pexels-<id>` 和网关 asset ID 混为一个 ID。视频变体仍沿用现有选片规则，不在本次引入多清晰度缓存体系。

`backend-services/basic-service/app/services/material_download_service.py:181` 先查后插，`backend-services/basic-service/app/models/db_models.py:122` 的唯一约束只能阻止重复记录，不能自动处理并发插入异常；第 236 行的 `_inflight` 也只覆盖旧后台下载任务。新入口须在同一缓存服务所属事件循环内按素材身份合并请求，并处理唯一键竞争，不能以两个独立的“查询后 POST”实现去重。服务现有跨循环桥接见 `backend-services/basic-service/app/services/material_download_service.py:135`；不要跨 FastAPI 与后台事件循环复用一个裸 `asyncio.Lock`。共享任务的单个等待者取消只撤销该等待者的工程发布，不应取消其他等待者；取消或失败的任务不得永久占住身份锁，落盘使用独立临时文件后原子提交。

### R-04：聚合契约可复用，但付费阶段需要本地恢复记录

网关 ingest 确有对应实现，非凭空设计。`F:/TMP-PROJECTS/aragon-router/src/lib/media/gateway/ingest.ts:212` 检查来源是否启用，第 224 行按搜索能力消耗一单位并占 generate 槽；搜索成功并不保证后续入库时来源仍启用、额度仍足够。`backend-services/basic-service/app/services/skillrouter/client.py:112` 返回 `payload['data']`，评审通过真实 AsyncRouterClient 和 httpx 假传输确认返回 `{asset:{...}}`，已纠正前文的调用方字段层级。

`backend-services/basic-service/app/services/skillrouter/client.py:199` 的异步 POST 只发送一次；注入 ReadTimeout 实测 `POST次数=1, request_sent=true`。但是客户端单次发送本身不足以防止下一次 Agent 调用或应用重启再次创建资产。至少区分以下三个阶段，并用可持久恢复、无密钥的记录保存结果：

| 阶段 | 下一次处理 |
|---|---|
| ingest 未发送，或服务端明确拒绝 | 修正输入/配置/额度后按明确重试策略处理，不自动轮询 POST |
| ingest 已成功，获得 asset ID/URL，随后本地 GET、校验或提交失败 | 先保存 asset ID/URL、素材身份及网关凭证修订；重试只恢复该资产 GET 和本地提交，不再次 ingest |
| ingest 已发送但超时/断连，结果不明；含应用崩溃后遗留的提交中状态 | 返回结果不明并阻止自动重复计费；仅在有可信资产回执或明确核对结果后继续，不虚构网关幂等键或查询接口 |

现有 `CachedMaterial` 字段见 `backend-services/basic-service/app/models/db_models.py:88`，没有网关资产回执或入库阶段。若复用此表，应仅作本任务必要的加法扩展并兼容旧行；也可复用项目内等效持久记录，不需要另建通用任务账本。网关资产记录绑定来源网关与 `credential_revision`，后者定义于 `backend-services/basic-service/app/services/skillrouter/config.py:40`，不能将旧账户资产自动交给新 Key。记录不得包含原始 Key。

同一候选去重之外还要限制不同候选的并发。`backend-services/basic-service/app/services/skillrouter/client.py:44` 的已注册 gate 只有 `ai_image/tts/ai_video_submit`，第 159 行对未知 gate 返回 None；直接传 `gate='video_library'` 没有任何限流效果。实施时明确将 ingest 纳入已生效的受限队列或登记有效 gate，并处理服务端 429/Retry-After；网关共享 generate 槽的最终限制仍以服务端为准。

### R-05：避免把旧自动预取变成自动计费，并补齐实际工具入口

后端搜索会为全部结果入队（`backend-services/basic-service/app/routers/video_router.py:123`）；客户端也会为远程素材启动预取（`src/components/video/hooks/useRemoteMaterialPrefetch.ts:325`），并在第 370 行调用 `pollUntilReady`。因此仅替换后台下载函数会让新聚合 ingest 随搜索结果或界面渲染自动收费，仅移除后端预下载仍可能留下客户端触发路径。

聚合视频候选的这两处自动预取都应停在候选/查缓存阶段；仅被实际选中的候选进入统一物化入口。已有有效本地文件直接复用，手动模式可以保留原有免费预取体验；图片、音频及其他来源的预取行为不随之重构。客户端手动重试也必须经过 R-04 的阶段恢复检查。

专用工具须注册到搜索类别，使 `search_video` 可见时就可发现或使用物化工具，而不依赖通用 egress 类别已加载。若新增 `/api/agent-host/...` 路径，`src/app/api/agent-host/[...path]/route.ts:20` 的代理按方法和路径白名单放行，且第 140 行非下载路由默认只有 30 秒；不能只加 FastAPI handler 后让新工具遭遇 404 或中途超时。优先复用已有素材 BFF，并明确物化/轮询预算；不要扩宽通配代理权限。

新物化入口应继续尊重 `downloads_enabled`（当前检查位于 `backend-services/basic-service/app/services/agent_host/egress.py:280`）。通用出口的 `egress_enabled` 只描述通用联网，专用视频库不应为了修本次故障而被硬绑在该开关上。配置修订在搜索、排队、付费提交前都要有一致性检查；已切换来源的旧候选返回明确的配置冲突/重新搜索提示，不跨模式静默尝试。保持唯一 `is_routed` 判定、手动覆盖及应急开关，不在新服务复制第二套判断公式。

### 候选方案的最终比较与范围收敛

| 方案 | 审计结论 |
|---|---|
| A | 保留为唯一推荐，但必须补入 R-02～R-05。采用现有缓存服务外的一层视频库编排、现有 RouterClient/资产下载器与更新操作；避免再建缓存、队列平台或凭证体系。可信候选可用有限生命周期的签发引用/服务端记录表达，不强制新建永久搜索历史。 |
| B | 对已就绪缓存有用，适合作为 A 的快速路径。旧 enqueue 仍直接 FFmpeg 取 CDN，缺失文件不能恢复，也没有视频库来源/计费快照；单独采用仍不满足聚合下载契约。 |
| C | 要安全地识别来源并处理缓存、计费及一致性，仍须实现 A 的核心编排，没有消除这些工作。把来源识别塞进任意 URL 出口会扩大其职责和回归面；本轮不采用隐式 URL 分流。旧调用保留明确的专用工具指引即可。 |

不将新网关接口、全局媒体下载重构、永久候选历史、图片/音频改造或 Pexels API 前缀迁移作为本次修复前置条件。2026-11-20 已重新查阅 [Pexels 官方 API 文档](https://www.pexels.com/api/documentation/)，确认 Authorization、视频文件 link 和新前缀说明；这些支持 API 元数据加文件下载的工作流，不证明真实 CDN 必然可达，也不改变本次根因。

### 评审阶段独立验证

- 只读重新执行既有 `backend_repro.py` 的 `observe_searches()` 与 `observe_downloads()`：四组观察及断言通过。通过 `runpy.run_path(..., run_name='review_probe')` 加载，未调用写 JSON 的 main；将日志 FileHandler 换为 NullHandler，使用 `python -B`，未覆盖原始结果文件。
- 重新运行 `node node_modules/vitest/vitest.mjs run --config docs/diagnoses/pexels-video-download-routing/repro/vitest.config.ts --reporter=default --no-cache --configLoader=runner`：3/3 通过，退出 0；这仍是缺陷行为诊断，不是修复通过。
- 只读调用 `backend-services/basic-service/tests/test_research_safe_http.py:36` 的 401/403/503 三个参数及该文件第 9 行的 200/401/503 三个 257-origin 缓存淘汰参数：6 组既有测试函数断言通过，支持保留上一轮拒绝缓存修复；未将其冒充新运行的完整 pytest 套件。
- 三组额外内存探针通过：真实 `_enqueue_impl` 配模拟会话确认 ready 缺文件不重排；真实 AsyncRouterClient 配 MockTransport 确认 ingest 响应解包；ReadTimeout 确认付费 POST 只发送一次并标为结果可能已提交。未访问真实数据库或网关、未创建媒体文件。
- 本轮仅修改本报告，原复现脚本及 JSON/XML 结果保持原样；未实现业务修复、未执行 git commit。真实应用/安装包交互、线上 ingest、外部文件下载、保存重开及导出仍属于后续验收。

## 评审结论

**评审通过，唯一推荐方案为 A 的收敛版：复用现有缓存与更新操作，增加一个按可信候选身份工作的专用视频库物化入口，按 `is_routed('video_library')` 选择手动 Pexels API 文件下载或 SkillRouter ingest → 鉴权资产下载。** 根因是 API 候选被交给通用文档出口；robots 403 是该路径中的前置拒绝，后台缓存缺少 Agent 回执进一步放大问题。证据不支持把搜索改成网页抓取、关闭全局 robots，或回滚拒绝缓存。

选择 A 的理由是：它同时满足两种来源模式和本地入库要求；B 缺聚合下载能力，C 同样需要这层编排却扩大通用出口职责。实现限于视频库链路，复用缓存、路由和网关客户端；R-02 的原 ID 更新、R-03 的失效缓存恢复、R-04 的付费阶段恢复记录和 R-05 的自动预取约束都是避免确定性失败或重复计费的必要组成，并非另行扩展产品功能。

实施节点除前文验收清单外，还必须证明以下边界：

1. 已有候选物化后原 ID、真实大小、本地 storage key、metadata 在同轮上下文和客户端同步更新；重复搜索不退回候选；撤销更新不删除原条目，回放操作不重复添加。
2. ready 文件缺失、空文件或损坏会从同一来源恢复；并发同 ID 只有一份付费提交和本地提交，并发不同 ID 受实际 gate 限制；一个等待者取消不影响其他等待者，迟到结果不写回已离开的工程。
3. ingest 成功但本地 GET 失败后仅恢复资产下载；已发送且结果不明时不自动再次 ingest，应用重启也不丢失这条约束；网关/Key 变更时不跨账户复用受鉴权资产。
4. 搜索出多条聚合候选及界面自动预取均不会自行计费，实际选中时才物化；手动覆盖、应急开关、禁止下载设置、候选过期和配置冲突各有明确回执，未静默改用另一种 Key 或 CDN。
5. 专用工具已注册、BFF 路由和预算可达；普通网页 robots、图片/音频预取及其他本地素材保持既有行为；最后以真实视频完成审阅、上轨、保存重开与导出。

本结论批准的是修复方向与实现边界，**不表示业务缺陷已修复或线上链路已验收**。

## 实施过程发现的方案缺陷 (Issues Found During Implementation)

### Implementation decisions and corrections — 2026-11-20

- Implemented only the approved A/R-02–R-05 video-library boundary. `video_library_service.py` orchestrates trusted, expiring search references, the existing `(pexels, video_id)` cache, source snapshots, and selected downloads. `video_library_transfer.py` applies bounded public-provider transfers and real MP4 probing. General web robots behavior is preserved.
- Persistent ingest recovery uses small, atomic, fsynced JSON receipts inside the existing Pexels cache directory rather than adding columns to every existing desktop database. The records contain source/asset identity, gateway origin, credential revision, and submission state; no key. A submitting/uncertain record blocks another paid POST across restarts. A known asset resumes its authenticated GET. A definitive rejection permits an explicit retry after credentials are corrected; account changes remain blocked for accepted or uncertain submissions.
- The existing operation contract permits one operation per tool call. Re-searching an existing unresolved candidate therefore cannot refresh several client entries through separate update operations without expanding that contract. The minimal correction is to resolve trusted server candidates by material ID by default; only an explicitly supplied `candidate_ref` is sent. Persisted client refs cannot prevent recovery after re-search. Materialization itself updates the original ID with the existing undoable `update_material` operation and synchronizes same-turn context.
- Review exposed additional ready-cache hazards: configuration changes during probing, disabled downloads while queued, and legacy lookup publishing corrupt bytes before a queued transfer starts. Configuration/download checks now run before submission and local publication, including cache hits. Pexels lookup/ingest responses validate actual media and cache-root containment before exposing a local URL; stale ready records are repaired by the same source workflow.
- Gateway HTTP 501 now has an explicit unsupported-ingest response while its potentially uncertain submission remains protected from automatic repetition. Search configuration conflicts retain their structured HTTP 409 response through the actual video router.
- Search and automatic routed/unknown-mode prefetch never create gateway assets. Explicit Agent or UI selection invokes the shared materialization endpoint. Manual prefetch retains the API-backed workflow. Images, audio, and ordinary egress keep their existing behavior.
- The dedicated material BFF has a 180-second budget and preserves `Retry-After`. The tool and UI disable POST retries, report uncertain transport outcomes, and prevent canceled/previous-project results from being published. Different IDs share an effective two-transfer gate; the existing cache event loop owns all shared work and same-ID requests are shielded from individual waiter cancellation.
- Legacy material-router test rows were unrestricted `MagicMock` objects. Executing the baseline projection from `git show HEAD` reproduced invalid proxy fields before this change. The relevant fixtures now use plain row values and explicitly model validated cache metadata; production proxy behavior was not broadened to accommodate mocks.
- Pexels' [official API documentation](https://www.pexels.com/api/documentation/) was checked again for the detail-resource/file-link contract. Existing video API prefixes were retained as required by the approved scope; migration to the newer prefix remains separate.

### Implementation verification

- Backend: 148 routing, transfer, durable-recovery, API, search and robots tests passed; 3 credential-access audit tests and 14 existing cache/local-composition tests also passed. The runs retain 26–27 existing dependency deprecation warnings. New regression tests first exposed cache-hit configuration, queued download policy, unsupported ingest, and corrupt ready-cache failures, then passed after the corrections.
- Frontend: 12 relevant suites / 146 tests passed, covering the dedicated tool/BFF, actual store update/undo/replay, candidate guards, prefetch, UI selection cancellation, source metadata and tool availability. The original diagnosis configuration now asserts the corrected routing and passes 3/3; its existing `frontend-results.json` has been refreshed.
- Re-ran `python docs/diagnoses/pexels-video-download-routing/repro/backend_repro.py` successfully. Its existing `backend-results.json` now records both API search paths, preserved general-web robots refusal, and both corrected materialization paths. A real 1,704-byte MP4 probes as 32×48, 0.5 seconds. Manual CDN requests contain no key and make no robots request. Routed materialization performs one ingest and one authenticated asset GET, with no client CDN transfer. Repeat materialization reuses the validated local cache. Saving/reloading the local receipt and a real FFmpeg copy export succeed for both modes.
- Production TypeScript diagnostics: zero. Full TypeScript checking remains blocked by the pre-existing `src/components/skillrouter/__tests__/SkillRouterSettingsPanel.test.tsx:145` fixture missing `stale`; this unrelated file was left unchanged. Python compilation of all changed backend modules passed. Relevant frontend lint has zero errors; existing warnings remain.
- Started the real FastAPI application with isolated SQLite/storage on port 18131 and Next.js on port 18130. The homepage compiled and returned HTTP 200. The new BFF compiled and reached FastAPI, returning the expected HTTP 409 `video_candidate_expired`; arbitrary URL input was rejected with HTTP 422. Both task smoke servers were stopped afterward; the user's existing backend on port 8000 was left running.
- No dependency was added and no `git commit` was run. Existing unrelated workspace changes, including the prior SkillRouter work in the shared spec, were preserved. Only the task's new video-library behavior and its necessary tests/documentation were added.

### Remaining verification limits

No live Pexels/SkillRouter request, saved user key, or paid gateway transaction was used. The network boundaries are deterministic fixtures; the video bytes, probing, cache rows, local-reference serialization and FFmpeg output are real. Packaged Electron interaction, actual editor project save/reopen, and the full application timeline export have not been exercised. The local reference/FFmpeg smoke checks must not be represented as those broader end-to-end checks. Gateway deployment support and real CDN availability still require live environment validation.

## Final code review — 2026-11-20

The approved A/R-02–R-05 implementation addresses the routing root cause:
video-library selections use their configured capability rather than the
general webpage downloader. Review covered the following requirements.

| Requirement | Reviewed behavior and evidence |
| --- | --- |
| F-01 / F-02: capability routing | Trusted search candidates reach the dedicated material BFF and service. Manual files use API-issued links or authenticated detail lookup; routed files use gateway ingest and authenticated asset GET. Ordinary webpage robots refusal remains intact. The offline reproduction executes both paths with real MP4 bytes. |
| R-02: stable identity | Materialization updates the existing `pexels-<id>` through `update_material`, including real size and local storage identity. The same-turn context is updated; real store replay and undo retain the original candidate. Ready materials survive repeated searches. |
| R-03: cache recovery and concurrency | Real media probing and cache-root containment precede ready receipts. Invalid ready files recover through the source workflow. Same-ID requests share a task on the cache loop, individual waiter cancellation is shielded, and different IDs share an effective semaphore. |
| R-04: paid submission recovery | An atomic, secret-free receipt is saved before ingest and updated before asset GET. Ambiguous submissions block another POST; known assets resume GET after failures/restarts. Account revisions prevent reuse with another credential. A rate-limited asset GET now retains backoff without creating another asset. |
| R-05: explicit selection | Search and routed/unknown-mode automatic prefetch do not ingest. UI selection and the resident Agent tool use the material endpoint with POST retries disabled. Manual prefetch retains the API-backed path. |
| Configuration and cancellation | Source and download policy are checked before submission and publication, including cache hits and queued work. Canceled materialization and previous-project UI results are withheld. Search results now also reject a changed project before recording operations. |
| Adjacent behavior and style | Image/audio prefetch, ordinary web egress, existing cache keys, credential resolution and gateway selection stay on their existing paths. No dependency, broad URL exemption, TODO, or new global retry policy was added. |

### Corrections made during final review

1. **Gateway asset backoff:** the reused asset downloader mapped an actual HTTP
   429 to `upstream_unavailable`, producing a public 502 and dropping
   `Retry-After`. A regression using the real downloader with an HTTP fixture
   failed with that exact result before the fix. The downloader now maps 429
   to the existing rate-limit code and uses the shared bounded header parser.
   The test also verifies that two explicit recovery attempts issue only one
   ingest POST and retain the asset receipt, without exposing response text.
2. **Search project ownership:** the search tool could record successful
   candidate additions after its context changed projects while awaiting HTTP.
   A regression failed before the fix. It now captures project identity before
   asynchronous work and returns `video_project_changed` before publishing to
   a different project, matching the materialization tool's ownership guard.

The initially considered candidate-reference synchronization concern does not
require another material operation: downloads resolve the current trusted
candidate by stable identity, and materialization publishes the final update.
Search keeps existing ready entries and never re-adds them for undo.

### Final independent verification

- Backend: **193 passed**, with 27 existing dependency deprecation warnings.
  The run includes `test_video_library_materialization.py`,
  `test_video_library_transfer.py`, `test_video_library_routes.py`,
  `test_material_router.py`, `test_skillrouter_search.py`,
  `test_research_safe_http.py`, `test_skillrouter_client.py`,
  `test_material_download_service.py`, `test_video_composition_local_refs.py`,
  and `test_no_direct_credential_reads.py`.
- Frontend: **8 suites / 93 tests passed**, covering materialization and the
  real store/undo, candidate guards, tool availability, prefetch, explicit UI
  selection and service receipt validation. The dedicated routing reproduction
  adds **3 passed** tests. Both final-review regressions were observed failing
  before their source corrections and passing afterward.
- `backend_repro.py` passed again: both modes use a real 1,704-byte MP4,
  validated local cache receipts, repeat-cache reuse, serialized local
  references and a real FFmpeg copy export. General web robots refusals remain
  expected; routed mode issues one ingest and one authenticated asset GET.
- Relevant frontend lint completed with **zero errors**, retaining existing
  warnings. Full `tsc --noEmit --incremental false` reported only the existing,
  unrelated settings-test fixture at
  `src/components/skillrouter/__tests__/SkillRouterSettingsPanel.test.tsx:145`
  missing `stale`; no production-source diagnostics were reported.
- Live providers, paid transactions, packaged Electron interaction, editor
  project save/reopen and full timeline export were not exercised. The earlier
  implementation startup checks are predecessor evidence, not a new startup
  claim by this review.

Only this video's routing implementation, regression coverage and diagnostic
evidence belong in the commit. The shared capability specification contributes
only its two video-download routing corrections; its unrelated second-round
planning changes and all other existing workspace edits remain unstaged.
