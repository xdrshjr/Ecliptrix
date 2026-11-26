# Agent 浏览器 · 真实图片获取与入库链路 · 设计方案 v2

> **文档**：`docs/plans/agent-browser-image-ingest/spec.md`
> **版本**：**v2**（v1 经评审后修订；评审记录见 §0.0，结论见文末）
> **性质**：本节点只产出设计，**不写实现代码**，不改 `docs/plans/agent-browser-image-ingest/` 之外的任何文件。
> **前置**：
> - 迭代 1 蓝图 `docs/plans/agent-browser-workspace/spec.md`（v2，已提交 `4e1ad78f`）
> - 迭代 2 增补（同文件 v2.2）与验收记录 `docs/plans/agent-browser-workspace/acceptance.md`（I2-1…I2-8）
> - 迭代 3 收口方案 `docs/plans/agent-browser-workspace-r3/spec.md`（v2，已提交 `abe65563`）
> - 仓库约定 `CLAUDE.md` →「Agent browser workspace」小节的 11 条不变量
>
> 本文件**不重复**已完成的架构、工具面与 UI 结构设计。它只处理一件事：**用户在需求里写的「真实图片的时候要使用浏览器去获取」这条链路，目前断在最后一米。**

---

## 评审记录（Review Notes）

评审日期：2026-11-26 · 评审对象：本文件 v1（314 行 / 28,512 字节）
评审方式：**不采信 v1 自述，逐条回源码复核**（沿用迭代 3 立下的规矩）。下表每条都给出可原样重跑的位置。
状态标记：`已修正` = 已直接改在 v2 正文；`已澄清` = v1 表述有歧义，v2 补写；`保留` = 经复核 v1 正确，不改。

### P0（阻断实现，必须修，v2 已全部修正）

| ID | 问题 | 复核证据 | 处置 |
|---|---|---|---|
| **P0-1** | **Next BFF 不是「零改动」通用代理。** v1 §2.1 写「`/api/web-research/browser/read` ← 通用 `[...path]` 代理，零改动」。实际该路由有**显式方法+路径白名单正则**，新增端点必然 404。 | `src/app/api/web-research/[...path]/route.ts:7-11`：`POST: /^(search|fetch|extract-images|download|research|browser\/(open|read|act)|test-connection)$/`；路径不命中即 `return researchProxyError('not_found', 404)`（同文件 `:43-45`）。`browser/{uuid}/save-image` 与 `browser/request-user` 均不在白名单内。 | **已修正**：§3 文件计划新增该文件；§4.2 明确必须把 `browser/${UUID}/save-image` 加入 `ROUTES.POST`。**此为纯路径白名单改动，不改代理语义、不加新路由文件。** |
| **P0-2** | **图片候选并入 `read` 结果会与 11 500 字节裁剪器冲突，最坏情形死循环。** v1 把 `images` 塞进 `POST /browser/read` 的响应，却未提裁剪器。 | `browser_result.py:12` `MAX_RESULT_BYTES = 11500`；`:28-37` `fit_result()` 的 `while` 只处理两件事：`if result.get("elements"): pop()` 否则 `text = clip_bytes(text, max(0, len(text.encode()) - 512))`。**若超限来自第三类字段（`images`），elements 与 text 都会被清空，之后 `len("".encode()) - 512` 恒为 0、`text` 恒为 `""`，`while` 条件永远成立 → 进程挂死。** 40 条候选 ≈ 8 KB，叠加正文与元素可稳定超限。 | **已修正**：§2.2 新增「候选裁剪必须独占」；§4.1 规定 `images` 走独立预算（`IMAGES_MAX_BYTES`），且 `fit_result` 必须新增 `images` 分支**并**加「三类皆空则 `break`」的死循环守卫；§6 新增 AC-I19 专门覆盖「图片很多但正文也多」的组合，断言函数返回且总字节 ≤ 上限。 |
| **P0-3** | **两个新错误码未进登记表。** v1 §2.6 要求 `image_not_found`(404) 与 `inline_image_unsupported`(400)，但 §3 文件计划没有 `web_research_models.py`。 | `web_research_models.py:8-60` 的 `STATUS` 字典逐码登记（注释：*「未登记的码按 422 处理属于开放映射，正文列出的每个错误码都必须在这里有明确状态，否则 UI 与重试语义会漂移」*）；`tests/test_web_research_router.py:147-152` 断言 `sorted(set(STATUS) - set(FAILURE_CLASS_BY_CODE)) == []`，即**双表必须同步**。 | **已修正**：§2.6 明确「两码必须同时进 `STATUS` 与 `FAILURE_CLASS_BY_CODE`」；§3 新增 `app/models/web_research_models.py` 为该变更的**必需**文件；§6 AC-I5 的验证命令补上该双表一致性测试。 |
| **P0-4** | **提示词 L1 余量算错一个量级。** v1 §2.4 规定「新增 L1 引导 ≤ 2 行、每行 ≤ 200 字符」（即最多 400 字节），而实际可用余量不足其 1/3。 | 实测 `BROWSER_WORKSPACE_GUIDANCE` = **1 082 字节**（`promptParts.ts:255-262`，7 行拼接；量法见下方命令）；`src/lib/video-editing-agent/__tests__/browserWorkspace.surface.test.ts:88-89` 断言 `bytes(BROWSER_WORKSPACE_GUIDANCE) <= 1200`。**真实余量 = 118 字节。** 400 字节方案会直接击穿 1 200 上限，让既有测试变红。 | **已修正**：§2.4 改写为「**净增 ≤ 118 字节**（实测余量），且必须先同义压缩既有第 3 / 第 6 行腾出空间」；并给出可重跑的测量命令。同时修正 `onDemandCatalog` 自述值 2 337 → **2 339**（`prompt-budget-baseline.json` 实测）。 |
| **P0-5** | **取回字节的超时三处不一致，10 MiB 图片在慢网必失败。** v1 §4.3 只定了前端 60 000 ms 与「后端建议 55 s」，未把已在源码里硬编码的两个更小值列为必改。 | 前端 `control_client.py:116-120` `fetch_resource` 硬编码 `timeout=40`；主进程 `desktop/main/browserWorkspace/resourceFetch.js:14` `FETCH_TIMEOUT_MS = 30_000`。**链路实际被 30 s 掐断**，v1 的 60 s 是空话。 | **已修正**：§4.3 给出**三处成对数值**（前端 60 000 ms / `control_client.py` 55 s / `resourceFetch.js` 55 s），§3 把 `driver.py`、`control_client.py`、`resourceFetch.js` 列为必改文件，并新增 AC-I20 断言三处常量一致。 |
| **P0-6** | **目标文件 `state_store.py` 不存在。** v1 §3 写「`state_store.py` 改：`TabEntry` 增 `images` 字段」。 | `backend-services/basic-service/app/services/browser_workspace/` 实际只有 `approvals.py control_client.py dispatch.py driver.py policy.py resources.py result.py service.py settings.py __init__.py`；`TabEntry` 定义在 `service.py:32-39`。`state_store.js` 是 **desktop 侧**的文件（`desktop/main/browserWorkspace/stateStore.js`），职责是渲染层状态广播，与 `TabEntry` 无关。 | **已修正**：§3 改为 `service.py`（`TabEntry` 就地扩字段）。**不要新建 `state_store.py`** —— 这会凭空造出第二份会话状态真相。 |

### P1（须修，v2 已全部修正）

| ID | 问题 | 复核证据 | 处置 |
|---|---|---|---|
| **P1-1** | **§0「断点 1：后端没有对应动作」过度概括，导致 §3 的改动性质判错。** v1 把它写成「新增私有 `_images()`」，实际是「既有一个 `images()`，需改造 + 归一化」，且已有调用方。 | `service.py:239-248` **已存在** `BrowserWorkspaceService.images(run, session_id)`：它调 `_run_command(run, 'images', ...)` 并把候选映射成 `{image_url, alt, width, height, in_viewport, is_og}`。`web_research/browser_service.py:388-403` 也有 `images()`（isolated 侧）。`actions.js:178-181` 有 `images(ctx)` 处理器。**调用方**：`web_research/web_image_service.py:18,21` 调 `workspace.images(run, via_tab)`。 | **已修正**：§0 断点 1 重述为「**服务层已有 `images()` 且被 `web_image_service` 使用；缺的是 REST 端点、`image_id` 归一化、`dispatch.read` 转发**」。§3 把 `service.py` 的动作从「新增 `_images()`」改为「改造既有 `images()` + 新增归一化」。 |
| **P1-2** | **改造既有 `images()` 会打断在用的调用方**：其返回形状与 §4.1 声明的候选形状不同，而 v1 未提向后兼容。 | 现有返回 `width/height`（`service.py:243-244`），§4.1 声明 `natural_w/natural_h/rendered_w/rendered_h/kind/via_srcset_best/page_url/image_id` —— 六项缺失、两项改名。`web_image_service.py` 消费的是现形状。 | **已修正**：§4.1 规定**只增字段、不改既有字段名**（`width`/`height` 保留为 `natural_w`/`natural_h` 的别名），并新增 AC-I21 断言 `web_image_service` 路径零回归。 |
| **P1-3** | **AC-I13 指向不存在的测试文件。** | `src/components/browser/__tests__/` 实际只有 `ApprovalBanner/BrowserDock/BrowserFooterButton/BrowserPanels/occlusion/omnibox/portalOccluders/testUtils`，**无 `browserWorkspace.surface.test.ts`**。该文件真实位置是 `src/lib/video-editing-agent/__tests__/browserWorkspace.surface.test.ts`。 | **已修正**：§3 与 §6 全部改为真实路径。 |
| **P1-4** | **「配额耗尽 → 429」是错的。** | `service.py:94-99` `_spend()` 抛 `browser_budget_exceeded`；`web_research_models.py:33` 登记为 **413**（`response_too_large` 同组）。而 429 组里是 `research_busy`/`browser_busy`/`provider_rate_limited`。 | **已修正**：§2.6 表改为 413，并补 `browser_busy` 429 作为并发争用的真实来源。 |
| **P1-5** | **v1 自己给的工具描述超了自定的 120 字符上限。** | v1 §4.3 注释的示例字符串实测 **130 字符**。 | **已修正**：§4.3 换成实测 **118 字符**的版本（见该节），并新增 AC-I13 的字节断言。 |
| **P1-6** | **手写 `recordOperation` 会重犯 §0 自己批评的缺陷。** v1 §3 写「在返回值里 `recordOperation(add_materials)`」。 | `tools/webToolAdapter.ts:184-232` 的 `executeWebTool` 已内置 `importMaterial:'record'`：它做 `localMaterial()` 同源 URL 正则校验（`:159-176`，要求 `/api/storage/files/cached_materials/<bucket>/<file>`）、`cacheStatus:'ready'`、`metadata.storageKind:'cached_remote'`、`already_in_library` 去重、以及「取消后不发布」（`!stopped()` 守卫）。手写只填 `{type:'add_materials', materials}` 会**缺少 `cacheStatus`** —— 正是 v1 §0 批评 `addMaterialToLibrary` 的那条。 | **已修正**：§3 与 §4.3 明确「必须用 `executeWebTool(..., importMaterial:'record')`，禁止手写 `recordOperation`」。 |
| **P1-7** | **拒绝 `data:`/`blob:` 的理由是错的。** v1 说这两个「不可保存」暗示技术上不支持。 | `resourceFetch.js:43-51` `readDataUrl()` 与 `:53-59` `readBlob()` **已完整支持**（含 `resource_not_image` 与 `resource_too_large` 判定）。 | **已修正**：§2.3 改为「技术上支持，**本轮刻意拒绝**」，并给出真实理由（`data:` 无来源页 → provenance 不可信；`blob:` 依赖页面存活 → 保存瞬间可能已失效；两者都不出现在真实新闻配图主路径）。这是**范围决策**，不是能力缺陷。 |
| **P1-8** | **AC-I4「schema 拒 URL」不成立。** | `Type.String({minLength:2,maxLength:8})` 挡不住 `"http://"`（7 字符）。 | **已修正**：§4.3 改用 `pattern: '^i[1-9][0-9]?$'`；AC-I4 改为「schema 挡形状、后端闭集挡归属」**两层各自可验证**，不再声称 schema 能单独挡 SSRF。 |
| **P1-9** | **新增第 6 个工具会打破两条既有断言，v1 未提。** | `browserWorkspace.surface.test.ts:98-106` 断言 `explore_tools('browser_tools')` 的 `loaded` **恰好 4 个**，且 `usage_hints` 含 `tool_names:[browser_request_user]`；`promptParts.ts:258` 的措辞是「it is the **5th** tool」。当前 `browser_tools` = open/read/act/close + request_user(非 YOLO) = 5。再加 `browser_save_image` = 6。 | **已修正**：§2.4 点名这两处必须同步改（措辞 5th→6th、`loaded` 长度断言、以及「一次最多 4 个」的既有语义），并列入 AC-I12 的必跑清单。 |
| **P1-10** | **provenance 契约与既有入库产出不符。** v1 §2.3 要求 `source:'workspace'` + `tab_id`，§4.2 响应体也称含 `tab_id`。 | `web_media_download.py:94-111` `_commit()` 实际产出：`source_page_url / final_url / title / author / license_status / sha256 / artifact_id / source_page_verified`，`via` 与 `source_kind:'browser'`、`page_url` **仅当 `source.get("via")` 存在才写**，**不含 `tab_id`**；且 `material.metadata.source` 是字符串 `'web'`（`:110`），不是 `'workspace'`。 | **已修正**：§2.3 改为「**沿用 `_commit()` 既有字段**；`tab_id` 与 `source:'workspace'` 由 `_commit()` 从 `source` dict 透传（需在 `_commit` 内加两个条件写入），并把 `web_media_download.py` 列入 §3 变更文件」。§4.2 响应体同步改为实际可得字段。 |
| **P1-11** | **`save_agent_image` 签名与既有 `fetch_via_tab` 不匹配。** | `resources.py:28` `fetch_via_tab(run, source, url, kind, maximum)` —— **从 `source["tab_id"]` 取 tab，无独立 `tab_id` 形参**；而 v1 §3 写 `save_agent_image(run, tab_id, url, name)`。 | **已修正**：§3 给出显式签名 `save_agent_image(run, session_id, image_url, page_url, name)`，内部构造 `source = source_record(page_url); source.update(via='workspace_tab', tab_id=session_id, source_page_verified=False)`（与 `resources.py:44-46` 用户路径同形），再走 `download_material(..., source=source)`。 |

### P2（记录在案，不阻断；v2 已澄清或降级为开放问题）

| ID | 问题 | 处置 |
|---|---|---|
| **P2-1** | `images_max` 20..100 与主进程 `collectImages(..., {limit: 100})`（`actions.js:179` 硬编码 100）的关系未定。 | **已澄清**：主进程固定取前 100，`images_max` 只在**后端归一化阶段**截断。写明「不要为此改主进程」。 |
| **P2-2** | `workspace_locked`(423) 的触发点描述不准。 | **已澄清**：`pick_mode` 在 locked 时**回落 isolated**（`dispatch.py:80-81`），423 只出现在「已建立的 workspace 会话遇到锁」。§2.6 已注明。 |
| **P2-3** | v1 AC-I16 写死「基线 17 个错误」。 | **已修正**：改为「不新增（与改前 `git stash` 对比）」，禁止写死易过期数字。 |
| **P2-4** | 「素材不受 1 天留存约束」未给证据。 | **已澄清**：`result.py:11` `WORKSPACE_RETENTION_DAYS=1` 只作用于 `store.write(...)`（artifact），素材走 `material_download_service`（`web_media_download.py:88`），**不同存储**。结论成立，但 §2.3 要求写进代码注释并加 AC-I8 断言。 |
| **P2-5** | isolated 模式是否有候选能力。 | **已澄清**：**有**（`web_research/browser_service.py:388-403`）。故 `dispatch.read(images=True)` 落 isolated 时应调 `.images()` 并标注 `mode:'isolated'`；**保存仍明确不支持**（无 Cookie 分区意义、且 isolated 是隐藏窗口）。 |
| **P2-6** | 保存前页面已自跳转 → `image_url` 失效但 `entry.version` 不变。 | **已澄清**：`save_image` 额外比对 `entry.url`（页面 URL）与候选人登记的 `page_url`，不一致回 `409 stale_snapshot`。 |
| **P2-7** | 「image_id 每次新快照重建」与「read → act → save」的可用性冲突。 | **已修正**：`_finish_snapshot` **仅在本次请求带 `images` 时**替换 `entry.images`，`act` **不清空**；因此 `read(images:true) → act → save` 仍可用（图 URL 与版本无关）。§2.2 已写明。 |
| **P2-8** | §6 走查「11 条变 12 条」是否有误。 | **保留**：`acceptance.md:215` 实测 `已执行 0 / 未执行 11 / 阻塞 0`，v1 正确。 |
| **P2-9** | §3「`index.js` 门面已 387 行」。 | **保留**：实测 387 行，正确。 |
| **P2-10** | 「`collectImages` 归主进程（`actions.js:178-181`）」是否准确。 | **保留**：实测 `images(ctx)` 在 `actions.js:178`，`collectImages` 在 `pageScripts/snapshot.js:134-176`，v1 正确。 |

### 复核时可原样重跑的命令

```bash
# P0-4 / P1-9：L1 引导实测字节数与余量（不经文档自述）
python -c "import re,pathlib;s=pathlib.Path('src/lib/video-editing-agent/promptParts.ts').read_text(encoding='utf-8');b=re.search(r'BROWSER_WORKSPACE_GUIDANCE =(.*?);\n\n',s,re.S).group(1);t=''.join(x.replace(chr(92)+chr(39),chr(39)) for x in re.findall(r\"'((?:[^'\\\\]|\\\\.)*)'\",b));print('bytes',len(t.encode()),'headroom',1200-len(t.encode()))"

# P0-1：BFF 白名单正则
python -c "import pathlib;print([l for l in pathlib.Path('src/app/api/web-research/[...path]/route.ts').read_text(encoding='utf-8').splitlines() if 'POST:' in l or 'not_found' in l])"

# P0-2：裁剪器与图片数组的冲突面
python -c "import pathlib;print(pathlib.Path('backend-services/basic-service/app/services/web_research/browser_result.py').read_text(encoding='utf-8')[-900:])"

# P0-3 / P1-4：错误码登记表（含 413 vs 429）
python -c "import pathlib;print([l for l in pathlib.Path('backend-services/basic-service/app/models/web_research_models.py').read_text(encoding='utf-8').splitlines() if 'browser_budget_exceeded' in l or 'resource_not_image' in l])"

# P0-5：三处超时
python -c "import pathlib;[print(p) or print([l for l in pathlib.Path(p).read_text(encoding='utf-8').splitlines() if 'timeout' in l.lower()][:4]) for p in ['backend-services/basic-service/app/services/browser_workspace/control_client.py','desktop/main/browserWorkspace/resourceFetch.js']]"

# P1-1 / P1-2：既有 images() 及其调用方
python -c "import pathlib;print([l for l in pathlib.Path('backend-services/basic-service/app/services/browser_workspace/service.py').read_text(encoding='utf-8').splitlines() if 'images' in l])"
python -c "import pathlib;print([l for l in pathlib.Path('backend-services/basic-service/app/services/web_research/web_image_service.py').read_text(encoding='utf-8').splitlines() if 'images' in l])"

# P1-3：surface 测试真实位置
python -c "import pathlib,glob;print(glob.glob('src/**/browserWorkspace.surface.test.ts',recursive=True))"

# P0-6：state_store.py 不存在
python -c "import pathlib;print(pathlib.Path('backend-services/basic-service/app/services/browser_workspace/state_store.py').exists())"
```

---

## 0. 基线核查（先立证据，再谈方案）

评审迭代 3 时立过一条规矩：**不采信文中数字，逐条回源码复核**。本节沿用该规矩，每条都给出可原样重跑的定位。**v2 已纠正 v1 的四处误判（标 `v2 改`）。**

| 事实 | 复核位置 | 结论 |
|---|---|---|
| 主进程**已能**采集页面图片候选 | `desktop/main/browserWorkspace/pageScripts/snapshot.js:134-176` 的 `collectImages()`；`desktop/main/browserWorkspace/actions.js:178-181` 的 `images(ctx)` 处理器 | **成立**。返回 `image_url / kind / alt / natural_w / natural_h / rendered_w / rendered_h / in_viewport / is_og / via_srcset_best`，覆盖 `img.currentSrc`、`picture[srcset]` 最优档、`og:image`/`twitter:image`、大背景图（面积 > 10 000 px²），按面积排序取前 N（`actions.js:179` 固定 `limit: 100`） |
| 控制服务**已注册** `images` 命令 | `actions.js:98` `handlers` 表含 `images`，`:178` 实现，`:301` 把它导出为 `handlers` 键 | **成立**。控制服务协议无需改动 |
| 后端服务层**已有** `images()` | `backend-services/basic-service/app/services/browser_workspace/service.py:239-248`；isolated 侧 `app/services/web_research/browser_service.py:388-403` | **v1 改**。v1 称「后端没有对应动作」——服务层**有**，且被 `app/services/web_research/web_image_service.py:18,21` **在用**。缺的是下面三处 |
| 调度层**不转发** `images` | `backend-services/basic-service/app/services/browser_workspace/dispatch.py:118-127` 的 `read()` 只传 `max_bytes/screenshot/elements_max`；`Dispatch` 无 `images`/`save_image` 方法 | **断点 1**（重述）。能力在服务层，适配层没有出口 |
| 路由**没有**对应端点 | `backend-services/basic-service/app/routers/research_browser_router.py:84-118`：只有 `/browser/open` `/browser/read` `/browser/act` `/browser/request-user` `DELETE /browser/{id}`，检索 `images`/`save` 无命中 | **断点 2**。模型无路可达 |
| **Next BFF 白名单**也挡着 | `src/app/api/web-research/[...path]/route.ts:8` POST 白名单为 `search\|fetch\|extract-images\|download\|research\|browser\/(open\|read\|act)\|test-connection` | **断点 3**（**v1 遗漏**）。v1 称其「零改动」，实测新增端点必然 404 |
| 模型侧**没有**对应工具 | `src/lib/video-editing-agent/tools/browserTools.ts:47-83`：只有 `browser_open / browser_read / browser_act / browser_close`（+ YOLO 下被移除的 `browser_request_user`） | **断点 4**。`browser_read` 只有 `screenshot`，拿到的是**截图 artifact id**，不是可入库的**页面图片 URL 清单** |
| 带 Cookie 取字节的入库通道**已存在**且是为此类场景写的 | `app/services/browser_workspace/resources.py:28-33` `fetch_via_tab()`、`:36-53` `save_resource()`、`:12` `LIMITS = {image: 10 MiB, media: 100 MiB}`；主进程 `desktop/main/browserWorkspace/resourceFetch.js:108-119` | **成立**。由标签页分区会话带 Cookie 与 Referer 取回（`:73-74`），每跳重查 URL 守卫（`:75-80`），复用 `web_media_download.download_material` 做魔数/尺寸/入库，provenance 额外带 `via:'workspace_tab'` |
| 该通道**只对「用户右键保存」与「研究候选」开放**，Agent 无入口 | 同文件 `:36` 注释「用户右键「保存到素材库」：没有 run」；`dispatch.py` 无 `save_image` | **断点 5**。Agent 路径拿不到这条通道 |
| 点击合成的旧工具会**静默产出坏素材** | `src/lib/video-editing-agent/tools/addMaterialToLibrary.ts:56-75`：`size: 0`、`url: params.url`（远端 URL）、`recordOperation({type:'add_material'})` | **风险源**。模型若把页面图片 URL 直接丢给它，得到一条 `size=0`、无本地缓存、`cacheStatus` 缺失的素材，时间线一放就黑帧 |
| 结果裁剪器**只认 elements/text** | `app/services/web_research/browser_result.py:12` `MAX_RESULT_BYTES=11500`；`:28-37` `fit_result()` | **断点 6**（**v1 遗漏**）。把 `images` 塞进同一响应会让裁剪器失去收敛性（见 P0-2） |
| 截图可被视觉工具读取（已有正向能力） | `src/lib/video-editing-agent/tools/visionTools.ts:28-36` 支持 `source:'artifact'`、`:59-60` 的 `artifact_id`；`backend …/agent_vision/image_source.py:324-349` 的 `_resolve_artifact()` 走 `_artifact_store()`；`backend …/browser_workspace/service.py:63-67` `_store()` 返回**同一个** `get_artifact_store()` | **成立**。`browser_read(screenshot:true)` → `screenshot_artifact_id` → `view_image(source:'artifact')` 已闭环，**无需新建**，但提示词从未告诉模型这条路 |

**一句话结论**：浏览器「看得见页面文字」，但**还拿不到页面上的真实图片**。用户需求里「真实图片要使用浏览器去获取」当前只能靠模型手工抄 URL 再赌一次公网直取；有防盗链或登录态的站点必然失败，且失败方式难以诊断。

---

## 1. 概览（Overview）

本轮要建的是**「页面图片候选 → 带会话凭据取回 → 真实字节入库 → 可被时间线使用」**这一条完整链路。它复用已经存在的五块基础设施（主进程 `collectImages`、服务层 `images()`、`resources.fetch_via_tab` 的带 Cookie 取字节、`cached_materials` 的严格入库、`executeWebTool(importMaterial:'record')` 的素材发布），只补中间五处断点（调度转发、路由端点、BFF 白名单、模型工具、裁剪器分支），因此**不新增外部依赖、不改数据库结构、不动控制服务协议**。

之所以必须做，是因为它直接对应用户原始需求里最容易被做假的一条：*「Agent 在涉及到需要获取新闻，资讯，或者其他地方取不到的消息的时候，可以去浏览器上找」* 与 *「当需要实时新闻或者实时资讯，或者真实图片的时候，要使用浏览器去获取」*。文字部分迭代 1–3 已经闭环；**图片部分目前只有截图（一张整页画面），没有「把网页上那张真实照片拿来当素材」的能力**。而『顶级产品』的判据不是『能跑』，而是**模型有一条可靠的、可诊断的、不会静默产出坏数据的路**。

第二个必须做它的理由是可诊断性。`resources.py` 的取字节路径已经把「先取回、再校验、再入库」拆成三段，每段都有精确错误码（`resource_too_large` / `resource_not_image` / `download_failed`）。把 Agent 接上去，等于把这套诊断能力给到模型；不接，模型就只能看到 `add_material_to_library` 的一句 `success: true` 和一条 0 字节素材——这是最坏的失败形态：**看起来成功**。

本轮同时收紧一个已在源码里坐实的 foot-gun：`add_material_to_library` 产出 `size:0` 的远端 URL 素材。方案不删除该工具（历史会话会重放它），而是把「浏览器来源的图片」在提示词与工具返回值两层导流到新链路。

范围上**不新增任何用户可见入口**（Dock、工具栏、footer 按钮一律零改动）、**不改控制服务的对外 HTTP 契约**、**不加数据库 DDL**、**不加系统设置键**（避开「漏一处注册就静默 404」的已知缺陷类）。

---

## 2. 技术设计（Technical design）

### 2.1 架构与请求路径

一次「把网页上那张图变成我的素材」的完整链路：

```
模型
 └─ browser_read { session_id, images: true }            ← 前端工具（扩展既有工具，不新增）
     └─ Next BFF  /api/web-research/browser/read          ← 已在白名单内（route.ts:8），零改动
         └─ FastAPI  POST /api/web-research/browser/read  ← research_browser_router 增加 images 分支
             └─ browser_workspace.dispatch.Dispatch.read(images=True)   ← 断点 1 修复
                 └─ service.BrowserWorkspaceService.read(...) → 既有 images()   ← 改造 + 归一化
                     └─ 控制服务 POST /command { action:'images' }              ← 协议不变
                         └─ 主进程 actions.js images() → pageScripts.collectImages()   ← 已存在
             ↑ 返回 { images: ImageCandidate[] }，每项带稳定 image_id

模型
 └─ browser_save_image { session_id, image_id, name? }   ← 前端工具（新增 1 个，仅属 browser_tools 类）
     └─ Next BFF  /api/web-research/browser/{id}/save-image ← **必须先把该路径加入 ROUTES.POST**（P0-1）
         └─ FastAPI POST /browser/{session_id}/save-image   ← 新增端点
             └─ resources.save_agent_image(...)             ← 新增（复用 _validated + download_material）
                 └─ web_media_download.download_material(source.via='workspace_tab')  ← 已存在
                     └─ fetch_via_tab → 主进程 /v1/resources/fetch（带 Cookie/Referer）  ← 已存在
             ↑ 返回 material 载荷（cached_materials 同源 URL）
     └─ executeWebTool(..., importMaterial:'record')        ← 已存在，自动发 add_materials
 └─ 素材库出现、时间线可用、SSE 推 UI
```

**关键设计取舍：为什么 `browser_read` 扩展而 `browser_save_image` 新增。**

`browser_read` 的语义本来就是「读当前页面」，图片候选属于页面内容，扩展参数比新增工具更省预算：「读文字 / 读元素 / 读图片」是同一个心智模型，模型不需要学第 5 个概念。而**保存**是一个有副作用、可失败、需要独立错误码的动作，塞进 `browser_act` 的 union 会把「交互动作」的失败语义搅浑（act 的 `stale_snapshot 409` 语义不适用于保存），因此单独成工具。

新增工具**只挂在 `browser_tools` 按需类别**，不进常驻工具集——这一点决定了提示词预算的算法（见 §2.4）。

### 2.2 图片候选的可寻址性与新鲜度

`collectImages()` 返回的是**按面积排序的数组**，位置会随页面变化。若模型拿到的是数组下标，一次滚动后就会指错。因此设计规定：

1. 后端在 `service.read(images=True)` 里把候选数组**归一化并注册进会话条目**（`TabEntry.images = { image_id: candidate }`），`image_id` 形如 `i1`…`i99`，与 `elements` 的 `e1`… 同构。
2. 归一化时**逐项补 `page_url`**（当时页面的 `final_url`）与 `snapshot_version`，形成一个不可歧义的快照引用；**同时保留既有字段名**（`width`/`height` 不删，`natural_w`/`natural_h` 作为新增别名），以免打断 `web_image_service.py` 在用路径（P1-2）。
3. `browser_save_image` 只接受 `image_id`，**绝不接受裸 URL**。这条与 `visionTools.ts:22` 的「来源是闭集」纪律同源：模型不能凭空构造一个 URL 让后端去取，否则会变成 SSRF 入口。取回的 URL 只能来自主进程给出的候选集。
4. **候选的裁剪必须独占预算**（P0-2）：`images` 数组**不得**与 `elements`/`text` 共用 11 500 字节的 `fit_result` 池。归一化阶段就按 `images_max` × 单项上限截断，并在 `browser_result.fit_result()` 增加 `images` 分支：**先砍 `images` 尾部 → 再丢 `elements` → 再裁 `text`**，且新增「三类皆空仍超限则 `break`」的收敛守卫。**没有这条守卫，`fit_result` 会死循环。**
5. 新鲜度：`browser_save_image` **不要求** `snapshot_version`（保存不改变页面），但若传入则与 `entry.version` 比对，不一致回 `409 stale_snapshot` 并要求先 `browser_read`；**无论如何都比对页面 URL** —— `entry.url` 与候选人登记的 `page_url` 不一致同样回 `409 stale_snapshot`（页面自跳转不会改 `version`，见 P2-6）。
6. `image_id` 的生命周期：`_finish_snapshot` **仅在本次请求带 `images` 时**替换 `entry.images`；`act` **不清空**（P2-7）。因此 `read(images:true) → act → save` 仍可用——图 URL 的有效性与 `snapshot_version` 无关。指向从未登记过的 id 回 `404 image_not_found`。
7. `images_max` 默认 40、范围 20..100；主进程固定取前 100（`actions.js:179`），**截断只发生在后端归一化阶段**，不为 `images_max` 改主进程（P2-1）。

### 2.3 入库与 provenance

复用 `download_material`，不另写入库。约束：

- `source` 记录必须带 `via:'workspace_tab'` 与 `tab_id`（与 `resources.py:44-46` 现有用户路径同形）；`provenance` 沿用 `web_media_download._commit()` 的既有字段（`source_page_url` / `final_url` / `title` / `sha256` / `source_page_verified` 等），**并新增两条条件写入**：`provenance['tab_id']` 与 `provenance['source']='workspace'`（P1-10）。`material.metadata.source` 保持既有 `'web'` 不变（前端 `localMaterial()` 依赖它）。
- 图片上限 **10 MiB**（沿用 `LIMITS['image']`，`resources.py:12`），超限 `resource_too_large 422`。
- `content-type` 不以 `image/` 开头 → `resource_not_image 422`（`resources.py:23-24`）。这挡住「URL 其实是 HTML 错误页」这类最常见失败。
- 空字节 → `502 download_failed`（`resources.py:19-20`）。
- `data:` / `blob:` 候选**技术上可保存但本轮刻意拒绝**，回 `400 inline_image_unsupported`（P1-7）。真实理由：`data:` 没有来源页 → provenance 不可信（而 provenance 是本链路的交付物之一）；`blob:` 依赖页面存活 → 保存瞬间可能已失效。两者都不出现在「新闻配图」主路径上。工具返回值必须明确说「这是内联图，请换一张外链候选」。
- 素材入库后**不受**工作台 artifact 的 1 天留存限制（`result.py:11` 的 `WORKSPACE_RETENTION_DAYS=1` 只作用于 `store.write()` 的 artifact，素材走 `material_download_service`，是不同存储）。这条必须写进代码注释，否则后续维护者会误把素材一起按 1 天清理。

### 2.4 提示词预算（本轮唯一的算术风险点）

**实测数字（v2 复核，不采信 v1 自述）：**

| 量 | 实测值 | 位置 |
|---|---|---|
| `L0_PROMPT_CHAR_CEILING` | 19 800 = 18 500 + 1 300 | `systemPrompt.ts:482,496`；`skillContext.ts:18` |
| `fullIndexTotal`（满索引最坏） | **19 552** → **余量 248 字符** | `__tests__/fixtures/prompt-budget-baseline.json` |
| `onDemandCatalog` 段 | **2 339**（v1 自述 2 337，差 2） | 同上 |
| `BROWSER_WORKSPACE_GUIDANCE`（L1） | **1 082 字节**，上限 1 200 → **余量 118 字节** | `promptParts.ts:255-262`；`browserWorkspace.surface.test.ts:88-89` |

因此本设计规定：

- `browser_save_image` **不进常驻工具集**，只计入 `browser_tools` 按需类别的工具清单与 L1 引导，故**不直接占用 248 字符的 `fullIndex` 余量**。
- **L1 引导的硬上限是净增 ≤ 118 字节**，不是 v1 写的「2 行 × 200 字符」（400 字节会直接击穿 1 200）。因为余量太小，实施顺序必须是：**先同义压缩既有 7 行**（优先第 6 行的 `extract_web_images`/`fetch_web_image` 旧措辞——那正是本轮要取代的路径），腾出空间后再写新行。
- 实施时必须：
  1. 先用既有 `measurePrompt()` 跑一次「改前」实测并存档；
  2. 再改，再跑「改后」；
  3. 增长量在原基线 JSON 上**显式上调并写明理由**（`browser_tools` 从 5 个工具变 6 个，是唯一合法理由），禁止为了让测试变绿而调高 `L0_NO_INDEX_CHAR_MAX`。
- 硬上限：`browser_save_image` 的 `description` **≤ 120 字符**；L1 引导整体（含新增）**≤ 1 200 字节**。
- **两处既有断言会被新工具打破，必须同步改**（P1-9）：
  - `promptParts.ts:258` 的「it is the **5th** tool」→ 第 6 个工具后措辞失效；
  - `browserWorkspace.surface.test.ts:98-106` 断言 `explore_tools('browser_tools')` 的 `loaded` **恰好 4 个**，且 hints 含 `tool_names:[browser_request_user]`。
- `browser_read` 新增 `images` 参数**不写长描述**，只给 `'Also return image candidates (real photos on the page).'` 级别的短语，参数名本身已自解释。

### 2.5 视觉接地（复用，不新建）

`browser_read(screenshot:true)` 已产出 `screenshot_artifact_id`，而 `view_image(source:'artifact', artifact_id)` 走同一个 `get_artifact_store()`（§0 已核）。因此「让 Agent 真的看见页面」**不需要新代码**，只需要把这条写进 `browser_tools` 的 L1 引导：布局错乱 / 元素被遮挡 / 验证码这类「读文字读不出来」的情况，用截图 + `view_image` 看一眼。这是零成本能力发现，也是本轮对「好看 / 好用」的实际贡献。

> **预算冲突提示**：这条新增措辞同样吃掉那 118 字节余量。若压缩后仍不足，**优先保「真实图片走 `browser_save_image`」这条**，视觉接地只保留一个逗号短语（`screenshot -> view_image(source:'artifact')`）。

### 2.6 操作序列（正常路径 / 失败路径）

正常：

1. `browser_open {url}` → `session_id`、`snapshot_version`、`elements`
2. `browser_read {session_id, images:true}` → `images: [{image_id:'i3', image_url, alt, natural_w, natural_h, in_viewport, kind:'url'}]`
3. `browser_save_image {session_id, image_id:'i3', name:'新闻配图-发布会'}` → `{material_id, local_url, width, height, already_in_library}`
4. `executeWebTool(importMaterial:'record')` 自动发 `add_materials` → UI 素材库即时出现
5. `browser_close`

失败路径（每条都必须有独立错误码，不许合并成 `error`）。**新码必须同时登记 `STATUS` 与 `FAILURE_CLASS_BY_CODE` 两张表**（`web_research_models.py`，`tests/test_web_research_router.py:147-152` 强制；P0-3）：

| 情形 | 码 | HTTP | 登记状态 |
|---|---|---|---|
| 候选是 `data:`/`blob:` | `inline_image_unsupported` | 400 | **新增码**，两表同登记 |
| `image_id` 不在当前快照 | `image_not_found` | 404 | **新增码**，两表同登记 |
| 页面已关/会话丢失 | `browser_session_lost` | 410 | 已登记（`:31`） |
| 传了旧 `snapshot_version` 或页面 URL 已变 | `stale_snapshot` | 409 | 已登记（`:52`） |
| 命中私网/被策略拒绝 | `private_network_blocked` / `navigation_blocked`（沿用 `policy.py` 与主进程 `checkUrl`） | 403 | 已登记（`:54-55`） |
| 闸门锁定（**仅限已建立的会话**；`pick_mode` 在锁定时回落 isolated） | `workspace_locked` | 423 | 已登记（`:48`） |
| 取回字节为空 | `download_failed` | 502 | 已登记（`:38`） |
| 超过 10 MiB | `resource_too_large` | 422 | 已登记（`:59`） |
| 不是图片 | `resource_not_image` | 422 | 已登记（`:58`） |
| 每次 run 动作预算耗尽 | `browser_budget_exceeded` | **413**（v1 误写 429） | 已登记（`:33`） |
| 同一标签页被并发占用 | `browser_busy` | 429 | 已登记（`:51`） |
| 上游取字节超时 | `upstream_timeout` | 504 | 已登记（`:36`） |

---

## 3. 文件 / 模块变更计划

| 文件 | 动作 | 一行意图 |
|---|---|---|
| `backend-services/basic-service/app/models/web_research_models.py` | 改 | **新增码登记（P0-3）**：`STATUS` 加 `image_not_found:404`、`inline_image_unsupported:400`，`FAILURE_CLASS_BY_CODE` 同步；`BrowserReadRequest` 加 `images: bool=False`、`images_max: int=40 (ge=20,le=100)` |
| `backend-services/basic-service/app/services/browser_workspace/service.py` | 改 | `TabEntry` 加 `images: dict = field(default_factory=dict)`（**不是新建 `state_store.py`**，P0-6）；改造既有 `images()` 补 `kind/rendered/via_srcset_best/page_url/natural_*` 别名；`read()` 加 `images`/`images_max` 形参并归一化注册；新增 `save_image(run, session_id, image_id, name, snapshot_version=None)` |
| `backend-services/basic-service/app/services/browser_workspace/dispatch.py` | 改 | `read()` 透传 `images`/`images_max`；新增 `save_image()`（workspace 保留、isolated 明示 `action_unsupported_in_isolated`） |
| `backend-services/basic-service/app/services/browser_workspace/resources.py` | 改 | 新增 `save_agent_image(run, session_id, image_url, page_url, name)`：自建 `source`（`via='workspace_tab'`, `tab_id=session_id`）→ `download_material`；补注释说明素材不受 1 天留存约束 |
| `backend-services/basic-service/app/services/web_research/web_media_download.py` | 改 | `_commit()` 条件写入 `provenance['tab_id']` 与 `provenance['source']='workspace'`（P1-10）；`material.metadata.source` 保持 `'web'` |
| `backend-services/basic-service/app/services/web_research/browser_result.py` | 改 | **`fit_result()` 增加 `images` 分支 + 三类皆空的 `break` 守卫（P0-2）**；新增 `IMAGES_MAX_BYTES` |
| `backend-services/basic-service/app/services/browser_workspace/driver.py` / `control_client.py` | 改 | `fetch_resource` 超时 40 s → **55 s**（P0-5） |
| `desktop/main/browserWorkspace/resourceFetch.js` | 改 | `FETCH_TIMEOUT_MS` 30 000 → **55 000**（P0-5） |
| `backend-services/basic-service/app/routers/research_browser_router.py` | 改 | `POST /browser/read` 接受 `images`/`images_max`；新增 `POST /browser/{session_id}/save-image`（超时 55 s） |
| `src/app/api/web-research/[...path]/route.ts` | 改 | **`ROUTES.POST` 正则加 `browser\/${UUID}\/save-image`（P0-1）**。纯白名单，不改代理语义 |
| `src/lib/video-editing-agent/tools/browserTools.ts` | 改 | `browser_read` 加 `images`/`images_max`；新增 `browser_save_image`（`description` ≤120 字符、`image_id` 用 `pattern: '^i[1-9][0-9]?$'`），**在 YOLO 早退之前 push**，调用 `executeWebTool(..., importMaterial:'record')`（P1-6，禁止手写 `recordOperation`） |
| `src/lib/video-editing-agent/promptParts.ts` | 改 | 先同义压缩 `BROWSER_WORKSPACE_GUIDANCE` 旧措辞，再加「真实图片先 collect 再 save」；「5th tool」→ 第 6 个（**净增 ≤118 字节**，P0-4） |
| `src/lib/video-editing-agent/tools/addMaterialToLibrary.ts` | 改 | 返回值增加 `hint`：浏览器来源图片请改用 `browser_save_image`（不改历史行为，只导流） |
| `src/lib/video-editing-agent/__tests__/fixtures/prompt-budget-baseline.json` | 改 | 更新实测基线（只由 `measurePrompt()` 写入，禁手填） |
| `src/lib/video-editing-agent/__tests__/browserWorkspace.surface.test.ts` | 改 | **真实路径（P1-3）**：`loaded` 长度断言、新工具 `description` ≤120 字符、L1 ≤1 200 字节 |
| `src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts` | 改 | 工具数与 `browser_tools` 目录段断言同步（数值来自实测） |
| `backend-services/basic-service/tests/test_browser_workspace_images.py` | 增 | 候选归一化 / save-image / 12 条错误码 / provenance / 裁剪收敛 / `web_image_service` 回归 |
| `src/lib/video-editing-agent/tools/__tests__/browserSaveImage.test.ts` | 增 | 工具参数 schema、`importMaterial:'record'` 发布一次、错误码直传、YOLO 下仍注册 |
| `desktop/main/browserWorkspace/pageScripts/pageScripts.test.js` | 改 | `collectImages` 的 `inline` 与 `og:image` 边界用例补充 |
| `docs/plans/agent-browser-workspace/acceptance.md` | 改 | 追加本轮 I3 记录（含 I2-7/I2-8 未执行项的现状与新增走查项） |
| `desktop/README.md` | 改 | 走查清单增加「保存网页图片 → 素材库出现 → 时间线可用」 |
| `CLAUDE.md` | 改 | 「Agent browser workspace」小节补一句图片链路与 `image_id` 闭集纪律 |

**明确不改**：`desktop/main/browserWorkspace/index.js`（门面已 387 行，控制服务协议不变）、`control.js`、`viewHost.js`、`stateStore.js`、任何 `src/components/browser/*.tsx`（UI 零改动）、`src/app/page.tsx`、任何数据库模型、`electron-builder.yml`、以及**不要新建** `app/services/browser_workspace/state_store.py`（P0-6）。

---

## 4. 接口设计

### 4.1 `POST /api/web-research/browser/read`（扩展）

```jsonc
// 请求
{ "session_id": "uuid", "max_bytes": 4000, "elements_max": 80,
  "screenshot": false,
  "images": true,          // 新增，默认 false
  "images_max": 40 }       // 新增，20..100，默认 40
// 响应（既有字段不变，新增 images）
{ "session_id": "uuid", "snapshot_version": 3, "title": "…", "final_url": "…",
  "text": "…", "elements": [ /* … */ ],
  "images": [
    { "image_id": "i1", "image_url": "https://…/a.jpg", "kind": "url",
      "alt": "发布会现场",
      "natural_w": 1600, "natural_h": 900,          // 新增别名
      "width": 1600, "height": 900,                 // 保留（web_image_service 在用）
      "rendered_w": 800, "rendered_h": 450, "in_viewport": true,
      "is_og": false, "via_srcset_best": true, "page_url": "https://…/news/1" }
  ],
  "images_truncated": false,   // 候选被 images_max 截断时为 true
  "truncated": false }
```

**裁剪规则（P0-2，必须实现）**：`images` 的字节数不计入 `MAX_RESULT_BYTES` 的争夺池前先被 `IMAGES_MAX_BYTES` 单独限制；`fit_result()` 的收敛顺序为 `images` 尾部 → `elements` → `text`，三类皆空仍超限则 `break`。

### 4.2 `POST /api/web-research/browser/{session_id}/save-image`（新增）

```jsonc
// 请求
{ "image_id": "i1", "name": "新闻配图-发布会", "snapshot_version": 3 }  // snapshot_version 可选
// 200
{ "material_id": "…", "name": "新闻配图-发布会", "type": "image",
  "local_url": "/api/storage/files/cached_materials/workspace/ab12cd.jpg",
  "width": 1600, "height": 900, "size": 284133, "format": "jpg",
  "already_in_library": false,
  "provenance": { "source": "workspace", "via": "workspace_tab",
                  "tab_id": "uuid", "source_page_url": "https://…/news/1",
                  "final_url": "https://…/a.jpg", "sha256": "…" } }
// 错误 → §2.6 表，body 形状沿用既有 { "detail": { "error_code": "...", "message": "..." } }
```

> **BFF 前提**：`src/app/api/web-research/[...path]/route.ts:8` 的 `ROUTES.POST` 必须加 `browser/${UUID}/save-image`，否则该请求在 Next 层就被 `not_found 404` 掉（P0-1）。

### 4.3 模型侧工具签名

```ts
// browser_read（扩展参数，工具名/其余参数不变）
images: Type.Optional(Type.Boolean())
images_max: Type.Optional(Type.Integer({ minimum: 20, maximum: 100 }))

// browser_save_image（新增，只属 browser_tools 按需类别；YOLO 下也必须注册）
Type.Object({
  session_id: Type.String({ format: 'uuid' }),
  image_id: Type.String({ pattern: '^i[1-9][0-9]?$' }),   // 'i1'…'i99'，绝不接受 URL
  name: Type.Optional(Type.String({ maxLength: 80 })),
  snapshot_version: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false })
// description（实测 118 字符，≤120）：
// 'Save one page image (image_id from browser_read images:true) into the library using session cookies. Never pass a URL.'
```

**超时（三处必须同改，P0-5）**：

| 位置 | 值 | 说明 |
|---|---|---|
| `browserTools.ts`（前端 `executeWebTool`） | `60 000 ms` | 不等人类，故不进 `140 000` 那条链 |
| `control_client.py` `fetch_resource` | `55 s` | 现为 40 s |
| `resourceFetch.js` `FETCH_TIMEOUT_MS` | `55 000 ms` | 现为 30 s |

`browser_read` 保持 `15 000 ms`。**只改前端不改后端等于没改**——10 MiB 图会被 30 s 掐断，且错误码会伪装成 `upstream_timeout`。

---

## 5. 数据模型

**无数据库变更。** 不新增表、不新增列、不做任何 DDL（`CLAUDE.md`：启动期禁止破坏性 DDL）。

内存结构：

```python
# service.py TabEntry 新增字段（会话期内存，随 session 释放；不新建 state_store.py）
images: dict[str, dict]   # {'i1': {image_url, kind, alt, natural_w, ..., page_url, snapshot_version}, ...}
```

```ts
// 前端不新增持久化结构；复用既有 MaterialItem，由 executeWebTool(importMaterial:'record') 构造
interface SavedPageImage {
  material_id: string; local_url: string;   // 必须是 /api/storage/files/cached_materials/…
  width: number; height: number; size: number; format: string;
  provenance: { source: 'workspace'; via: 'workspace_tab'; tab_id: string; source_page_url: string };
}
```

入库落点复用既有 `cached_materials` 目录与 `download_material` 的元数据写入；前端 `MaterialItem` 的 `cacheStatus:'ready'` 与 `metadata.storageKind:'cached_remote'` 由 `webToolAdapter.localMaterial()` 统一填（`webToolAdapter.ts:159-176`），**不得手写**。

---

## 6. 测试与验收标准

每条 AC 都要能指到一条**可原样重跑**的命令或一次**写明缺什么**的走查，禁止「功能能跑」式结论。

| ID | 验收标准 | 验证方式 |
|---|---|---|
| AC-I1 | 图片候选链路通：`images:true` 返回带 `image_id` 的候选，含 `og:image` 与大背景图 | `pytest tests/test_browser_workspace_images.py -k candidates` |
| AC-I2 | 保存成功：真实图片经标签页 Cookie 取回并入库，`local_url` 为同源 `cached_materials` | 同上 `-k save_ok` |
| AC-I3 | 拒绝内联图：`data:`/`blob:` 候选回 `400 inline_image_unsupported` | 同上 `-k inline_refused` |
| AC-I4 | **两层各自可验证**（P1-8）：前端 schema 用 `pattern` 挡形状（`"http://"` 被拒）；后端对未登记 id 回 `404 image_not_found` | 同上 `-k url_not_accepted` + 前端 schema 测试 |
| AC-I5 | 12 条错误码逐条命中，且两个新码在 `STATUS` 与 `FAILURE_CLASS_BY_CODE` **双表**同登记 | 同上 `-k error_codes`（参数化 12 例）+ `pytest tests/test_web_research_router.py -k registered` |
| AC-I6 | 非图片内容（HTML 错误页）回 `422 resource_not_image` | 同上 `-k not_image` |
| AC-I7 | 超过 10 MiB 回 `422 resource_too_large` | 同上 `-k too_large` |
| AC-I8 | provenance 含 `source:'workspace'` / `via:'workspace_tab'` / `tab_id` / `source_page_url` | 同上 `-k provenance` |
| AC-I9 | 前端工具**恰好发布一次** `add_materials`，且 `cacheStatus:'ready'` 由 `localMaterial()` 填 | `npx vitest run src/lib/video-editing-agent/tools/__tests__/browserSaveImage.test.ts` |
| AC-I10 | YOLO 下 `browser_save_image` 仍注册（它不等人类） | 同上 `-k yolo` |
| AC-I11 | `stale_snapshot` 与 `image_id` 重建：新快照后旧 id 回 404；`read→act→save` 仍可用 | 后端 `-k snapshot_stale` |
| AC-I12 | 提示词预算自洽：改后 `fullIndex` ≤ 19 800，L1 ≤1 200 字节，`loaded` 长度与「6th tool」措辞同步 | `npx vitest run --environment node src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts src/lib/video-editing-agent/__tests__/promptBudgetRatchet.test.ts src/lib/video-editing-agent/__tests__/browserWorkspace.surface.test.ts` |
| AC-I13 | 新工具 `description` ≤ 120 字符；L1 引导 ≤1 200 字节 | `npx vitest run src/lib/video-editing-agent/__tests__/browserWorkspace.surface.test.ts`（**真实路径**，P1-3） |
| AC-I14 | 主进程 `collectImages` 边界（`srcset` 最优档、`inline` 标记） | `cd desktop; npm run test:browser`（`pageScripts` 套件） |
| AC-I15 | 无回归：既有浏览器套件全绿 | `cd desktop; npm run test:browser`；`npx vitest run src/components/browser src/contexts`；`pytest tests -k "browser or workspace" --ignore=data` |
| AC-I16 | 类型与 lint **不新增**错误（与改前 `git stash` 对比，不写死数字，P2-3） | `npm run type-check` 前后各跑一次并比对条数；`ESLINT_USE_FLAT_CONFIG=false npx eslint <触碰文件>` |
| AC-I17 | 打包态新鲜性门禁仍绿 | `cd desktop; node scripts/lib/assert-fresh-build.js` |
| AC-I18 | 人工走查新增 ①'「保存网页图片 → 素材库出现 → 拖进时间线可播」如实记档 | `node desktop/scripts/check-walkthrough-table.js`（cwd = 仓库根），三档前缀齐全 |
| **AC-I19** | **裁剪收敛（P0-2）**：`images` 很多 + 正文很长 + 元素很多时，`fit_result()` **返回而不挂死**，且总字节 ≤ 上限 | `pytest tests/test_browser_workspace_images.py -k fit_result_terminates`（含 41 条候选 × 8 KB 夹具） |
| **AC-I20** | **三处超时一致（P0-5）**：前端 60 000 / `control_client` 55 / `resourceFetch` 55 000 | `pytest tests/test_browser_workspace_images.py -k timeout_chain` + 读三处常量 |
| **AC-I21** | **`web_image_service` 零回归（P1-2）**：既有 `workspace.images()` 调用方在候选形状扩展后仍通过 | `pytest tests -k "web_image"` |
| **AC-I22** | **BFF 白名单可达（P0-1）**：`POST /api/web-research/browser/<uuid>/save-image` 不被 Next 层 404 | 前端路由单测（`ROUTES.POST` 正则命中 + 未登记路径仍 404） |

**本轮必须如实交代的既有欠账**（不得用源码测试冒充）：`acceptance.md` 的 I2-7（`build:dir` + 打包态冒烟）与 I2-8（11 项人工走查，当前实测 `已执行 0 / 未执行 11 / 阻塞 0`）仍**没有实机证据**。本轮新增的图片链路会把走查项从 11 条变 12 条；若本机仍无桌面安装包与可登录站点账号，只能按 `未执行: 缺 <X>` 记档，并明确写「`已执行` 为 0 时本表只算格式合规，不计走查通过」。

---

## 7. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | **提示词预算**：`fullIndex` 余量 248 字符、L1 余量仅 **118 字节**（v1 误算为 400） | 高（顶破后后续任何提示词改动都无回归网） | 新工具不进常驻集；`description ≤ 120` 字符；L1 **净增 ≤118 字节**且先压缩旧措辞；实施前先存档 `measurePrompt()` 实测；**禁止**上调 `L0_NO_INDEX_CHAR_MAX` 换绿 |
| R-2 | 把「保存」塞进 `browser_act` 会污染动作语义 | 中 | 明确新增独立工具；act 的 union 与 `stale_snapshot` 语义不动 |
| R-3 | **SSRF 面**：若允许传裸 URL，等于把后端变成任意 URL 取字节代理 | 高（安全） | 三道防线：schema `pattern` 挡形状 → 后端 `image_id` 闭集挡归属 → 主进程 `resourceFetch.js:116-118` 的 `checkUrl` 与每跳重查（`:75-80`）仍生效。**不依赖任何单一层** |
| R-4 | 防盗链/登录态站点的图片取回仍需 Cookie | 中 | 这正是 `fetch_via_tab` 存在的理由；isolated 模式（无凭据）**明确回不支持保存**，不假装成功 |
| R-5 | 素材与 artifact 的留存策略混淆，误按 1 天清理用户素材 | 中 | 代码注释 + AC-I8 断言 provenance；留存常量只在 `result.py` 作用域内 |
| R-6 | `add_material_to_library`（`size:0`）被模型误用于浏览器图片 | 中 | 返回值加 `hint` 导流 + 提示词明确「页面图片走 `browser_save_image`」；不删旧工具（历史重放需要） |
| R-7 | 会话条目 `images` 无界增长 | 低 | `images_max ≤ 100`、随 `TabEntry` 释放（LRU ≤64，`service.py:19`） |
| R-8 | **超时三处不一致**（前端 60 s / 后端 40 s / 主进程 30 s） | 高（大图必失败且误报 `upstream_timeout`） | 三处同提交、AC-I20 钉住；`resourceFetch.js` 与 `control_client.py` 已列入 §3 必改 |
| R-9 | 走查仍无实机证据，被当成「已验收」 | 中 | 沿用三档记档规则；`已执行 0` 时明文声明不计通过 |
| R-10 | 评审最易误判处：以为「图片能力已完整」（因 `collectImages` 与 `images()` 都存在） | 中 | §0 用可重跑定位把六处断点钉死；**能力存在 ≠ 可达**（服务层有 `images()` 但无端点、无 BFF 白名单、无工具） |
| **R-11** | **`fit_result()` 失去收敛性 → 请求挂死**（v1 完全未识别） | **高（进程级）** | §2.2 第 4 条 + `IMAGES_MAX_BYTES` 独立预算 + `break` 守卫 + AC-I19 夹具 |
| **R-12** | 改造既有 `images()` 打断 `web_image_service` | 中 | 只增字段不改名 + AC-I21 |

### 开放问题

- **O-1（需裁决）**：`browser_save_image` 是否也应支持**视频**（同页 `<video>` 候选）？推荐**本轮不做**——`collectImages` 只采图片，扩到视频要新增页面脚本与 100 MiB 取回路径，收益低于风险；留作下一迭代。
- **O-2（需裁决）**：保存后是否**自动**把素材拖进时间线？推荐**不自动**——沿用「生成排队 ≠ 已应用」的既有纪律，入库与上轨分开，由模型显式 `add_to_track`。
- **O-3（需裁决，v2 新增）**：`data:`/`blob:` 本轮**刻意拒绝**（P1-7）。若后续确有场景（如 Canvas 渲染的图表），可开关式放开——但必须先解决 provenance 缺失问题。

---

## 8. 实施顺序（给下游节点的确定性清单）

1. **先存基线**：跑 `measurePrompt()` 存档；记录 `BROWSER_WORKSPACE_GUIDANCE` 实测字节数（当前 1 082 / 上限 1 200）；`git rev-parse --short HEAD` 记录起点。
2. **错误码登记**（P0-3）：`web_research_models.py` 双表加两个新码 → 先跑 `pytest tests/test_web_research_router.py -k registered` 确认绿。
3. **后端候选链路**：`TabEntry.images`（在 `service.py`）→ 改造 `images()`（只增字段）→ `dispatch.read(images=)` → 路由收 `images`。同时做 `browser_result.fit_result()` 的 `images` 分支与 `break` 守卫（P0-2），先写 `-k candidates` 与 `-k fit_result_terminates` 失败用例。
4. **后端保存链路**：`resources.save_agent_image()` → `web_media_download._commit()` 两个 provenance 字段 → `dispatch.save_image()` → 路由 `POST /browser/{id}/save-image`。参数化 12 条错误码用例。
5. **超时三处同改**（P0-5）：`browserTools.ts` 60 000 / `control_client.py` 55 / `resourceFetch.js` 55 000。
6. **BFF 白名单**（P0-1）：`route.ts` 的 `ROUTES.POST` 加一条正则，配 AC-I22。
7. **前端工具**：`browser_read` 扩参 → 新增 `browser_save_image`（YOLO 早退前 push，`importMaterial:'record'`）→ `add_material_to_library` 加 `hint`。
8. **提示词**：先压缩 `BROWSER_WORKSPACE_GUIDANCE` 旧措辞腾空间，再加新行；「5th tool」→ 第 6 个；改完立刻跑 AC-I12 与 AC-I13，超额就**回退措辞**而不是改上限。
9. **文档与走查**：`acceptance.md` 追加 I3 段、`desktop/README.md` 走查加一条、`CLAUDE.md` 一句。
10. **全量门禁**：AC-I15…AC-I22 逐条跑，结果原样写进 `acceptance.md`。

---

## 评审结论（Review Verdict）

**有条件通过。**

结论依据：v1 的核心判断（「图片链路断在最后一米，且必须复用 `fetch_via_tab` 这条带 Cookie 的取字节通道」）经逐条回源码复核后**成立**，设计方向正确、复用面选得准、`image_id` 闭集这一安全纪律与仓库既有执行方式（`visionTools` 的「来源是闭集」）一致。但 v1 在**可行性细节上有 6 处会直接导致实现失败或进程挂死的硬伤**（P0-1…P0-6），另有 11 处会误导实施的描述偏差（P1-1…P1-11）。这些已在 v2 正文中逐条修正，因此给「有条件通过」而非「不通过」。

**通过条件（全部为可验证项，缺一不可）：**

1. **P0-1** 已并入 §3 与 §4.2：`src/app/api/web-research/[...path]/route.ts` 的 `ROUTES.POST` 必须加入 `browser/${UUID}/save-image`，由 AC-I22 验证。**未改这一行，新端点在整个 Next 层不可达。**
2. **P0-2** 已并入 §2.2 与 §4.1：`browser_result.fit_result()` 必须新增 `images` 分支与「三类皆空则 `break`」守卫，由 AC-I19 验证。**未加守卫，`images` 撑爆 11 500 字节时请求永久挂死。**
3. **P0-3** 已并入 §2.6 与 §3：`image_not_found`、`inline_image_unsupported` 必须同时登记 `STATUS` 与 `FAILURE_CLASS_BY_CODE`，由 AC-I5 的 `test_web_research_router -k registered` 验证。
4. **P0-4** 已并入 §2.4：L1 引导**净增 ≤118 字节**（实测余量），且必须先同义压缩旧措辞；**禁止**通过上调 `L0_NO_INDEX_CHAR_MAX` 换取测试变绿。
5. **P0-5** 已并入 §4.3：三处超时必须同提交（60 000 / 55 / 55 000），由 AC-I20 验证。
6. **P0-6** 已并入 §3 与 §5：`TabEntry.images` 加在 `service.py`，**不得新建 `app/services/browser_workspace/state_store.py`**。
7. **P1-2 与 P1-10**：改造既有 `images()` 与 `_commit()` 时必须**只增字段、不改名**，由 AC-I21 与 AC-I8 验证。
8. **P1-6**：`browser_save_image` 必须走 `executeWebTool(..., importMaterial:'record')`，**禁止手写 `recordOperation`**，由 AC-I9 的 `cacheStatus:'ready'` 断言验证。
9. 实施完成后必须按 §6 如实记档，且在 `已执行` 仍为 0 时**不得**把人工走查表计为通过。

> 未纳入本轮、需人类裁决的事项见 §7 开放问题 O-1 / O-2 / O-3。

## 实施过程发现的方案缺陷

> 本节记录实现时发现、与本文 v2 正文不一致的地方。按任务约束「不静默偏离」，逐条写清原因与实际做法。

| ID | v2 正文写法 | 实际发现 | 实际处理 |
|---|---|---|---|
| **D-1** | §3 要求改 `service.py`（`TabEntry` + 改造 `images()` + `save_image`）与 `dispatch.py`（`read` 透传 + `save_image`） | 仓库有行数棘轮 `tests/test_line_budgets_bw.py：service.py ≤ 350 、dispatch.py ≤ 200`。直接加入会到 **414 / 210**，两个用例变红 | 抽出新文件 `app/services/browser_workspace/images.py`（归一化 / 挂载候选 / 保存 / 沙盒只读候选与拒保存），`service.py`（347）与 `dispatch.py`（200）只保留薄委托。**未上调任何预算数字**。与上一轮把审批拆到 `approvals.py` 同一种处置 |
| **D-2** | §3 写「`driver.py` / `control_client.py` 改：`fetch_resource` 超时 40 s → 55 s」 | 40 s 常量并不在 `control_client.py`，而在 **`driver.py:118`** 的 `timeout=40`；`control_client.request` 本身无硬编码值 | 只改 `driver.py`，新增 `FETCH_TIMEOUT_S = 55` 常量并在注释里点名三处成对关系；`control_client.py` 未动 |
| **D-3** | §2.4 说 L1 余量 118 字节，要求「净增 ≤118」 | 实测确认余量 **118**（改前 1 082 / 上限 1 200），但若真按「净增」写，两处必改的措辞（工具数 5→6、图片路径）会把余量吃到 0 附近 | 改为**净减 23 字节**（第 6 段重写更短，第 3 段仅换工具措辞），实测 1 059；余量反而从 118 升到 **141** |
| **D-4** | §3 要求改 `pageScripts/pageScripts.test.js`（补 `inline` / `og:image` 边界用例） | 该用例**已存在**（`pageScripts.test.js:138-139` 已断言 `kind==='inline'` 与 `is_og`），重写只会制造重复 | 未改该测试，AC-I14 仍由现有 9 项 `pageScripts` 套件覆盖 |
| **D-5** | §3 要求改 `__tests__/fixtures/prompt-budget-baseline.json` | 基线 JSON 是 `measurePrompt()` 的快照；本轮 L1 不进 L0 段，`fullIndex` / `onDemandCatalog` 均未变，手改反而会造假 | 未改基线 JSON；4 个提示词套件（59 项）仍全绿 |
| **D-6** | §6 AC-I18 指向 `check-walkthrough-table.js` 校验「三档前缀齐全」 | 该脚本的契约被写死为 **I2-8 的 ①–⑪**（`ROWS` 常量 + 总数必须等于 11），新增 ⑫ 会让它变红 | 未改脚本：I3 的 12 条表按同一档位规矩人工记档，并在验收记录里写明「由脚本校验的是 I2-8，I3 不由它校验」 |

| **D-7** | §4.3 只规定 `browser_save_image` 的工具签名与 60 000 ms 超时，未规定**请求体形状** | 首版实现写 `body: params`，把 `session_id` 一并塞进 body；而 `BrowserSaveImageRequest` 是 `StrictRequest`（`extra="forbid"`），实测 `BrowserSaveImageRequest(session_id=…, image_id='i1')` 抛 `extra_forbidden` → 真实链路**必然 422**，一次都不会成功。两侧单测各自都绿（前端 mock 了 `toolFetch`，后端直调 service），因为没人测这个**接缝** | 前端新增 `saveImageBody()`，只发 `image_id`/`name`/`snapshot_version`（缺省字段不出现，不发 `null`），session 只走路径；补两条前端用例断言 body 不含 `session_id`、且可选字段缺省时不出现 |
| **D-8** | §2.2 第 4 条与 §4.1 要求「`images` 必须过 `fit_result` 并单独受限 `IMAGES_MAX_BYTES`」 | 候选是在 `_finish_snapshot` 的 `fit_result` **之后**才挂到结果上的，首版**没有再裁一次**，于是 100 条候选实测 **35 557 字节**，是 11 500 上限的三倍；`images_max` 上限 100 又允许这种规模。沙盒分支同理，且它把增量单独裁剪，合并进快照后仍会超限 | `images.attach()` 挂载后补一次 `fit_result(result)`；沙盒改为 `attach_isolated()` 在**合并之后**统一裁一次。`fit_result` 内真正落地独立图片预算（先把图片尾部砍到 `IMAGES_MAX_BYTES`），并让任何一次削图都同时置 `truncated` 与 `images_truncated`。补后端用例：100 条候选后总字节 ≤ 11 500、`truncated` 为真、登记表仍是完整闭集 |
| **D-9** | §4.3 只写「`browser_read` 保持 15 000 ms」，未意识到 images 是**第二条**主进程命令 | `read(images:true)` 串行跑 `snapshot`（10 s）与 `images`（10 s），两条各自的超时都合法，但路由的动作预算写死 10 s、前端 15 000 ms —— 最坏情形会被自己的超时链掐成 `upstream_timeout`，且错误码伪装成上游问题 | 新增 `READ_IMAGES_TIMEOUT_S = 25`（不带 images 仍是 10 s）与前端 `BROWSER_READ_IMAGES_TIMEOUT_MS = 25_000`（不带 images 仍是 15 000 ms），补一条后端断言「读预算 > 两条命令之和」与一条前端断言「带图读比普通读更宽」 |

**一句话结论**：本文 v2 的 5 个 P0 约束全部按写法落地（白名单、裁剪收敛、双表登记、三处超时、`TabEntry` 位置）；D-1…D-6 为「文件级落点与已有棘轮冲突」，**D-7…D-9 则是复审时抓到的三处接缝级缺陷**（请求体形状、裁剪时机、第二条命令的预算），三者的共同点都是「两侧各自单测都绿、真实链路必炸」，现均已修复并有回归用例钉住。
