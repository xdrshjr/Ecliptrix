# 工作区媒体导入失败诊断

诊断日期：2026-11-05。代码基线：
`9b971a9a900c7c2b1bb0eecc2a5f517b04e3073b`。
前序节点负责定位与复现，本次评审补充执行路径、反例和实施边界。
前序诊断与评审节点均未修改产品代码，未执行 Git 提交；
本轮实施节点已落实评审方案 A，实施细节与验证结果见文末。
下文根因引用的源码行号对应诊断基线，保留用于追溯。

## 问题描述

用户给已有 60 秒西高地白梗视频添加欢快 BGM。音频已下载，
FFmpeg 已成功生成 60 秒的 `bgm_ukulele_quiet.mp3`，随后出现：

| 顺序 | 用户看到的现象 | 本次查明的实际原因 |
|---|---|---|
| 1 | 导入提示“该文件已不存在” | 文件在项目工作区根目录，导入只查找 `files/` |
| 2 | 列表提示“出现内部错误”，同时显示两个空列表 | `workspace_list` 未加载，执行闸门拒绝；界面丢失具体原因并渲染空态 |
| 3 | 复制到 `files/` 后仍提示“工作区暂时不可用” | 新建缓存记录把 `source_url` 写成 `NULL`，违反数据库非空约束 |

第 3 项是阻断正确路径媒体入库的主缺陷。第 2 项并不是后端列表接口故障。
另外，导入响应固定返回 `duration: 0`；即使解决入库失败，
音频上轨仍有被当作 5 秒素材的后续问题，需要纳入修复验收。

## 证据来源与边界

已阅读 `README.md`、`CLAUDE.md` 和 `.claude-index/index.md`。
产品是 Windows Electron + Next.js + FastAPI + 本地 SQLite；
工作区与素材缓存是两个存储层。

本次证据包含：

- [evidence.json](evidence.json)：以 SQLite `mode=ro` 读取本次项目会话，
  提取 7 条相关工具记录、数据库列约束、两份 BGM 文件的大小/哈希，
  以及桌面端后端访问日志的相关行。绝对用户目录已替换为 `<userData>`。
- [repro_backend.py](repro_backend.py)：真实业务函数与真实 SQLite 的离线复现，
  包括单变量对照实验。
- [repro.test.tsx](repro.test.tsx)：真实工具加载闸门和工作区卡片的离线复现。
- [repro-output.txt](repro-output.txt)：实际命令、退出码和输出。

未更改用户数据库、原始音频、时间线或设置，未调用素材供应商或 LLM。
没有重新执行原项目的完整剪辑/导出，也没有把离线诊断通过说成修复完成。

## 复现步骤

### 一、可复制执行的离线复现

使用已安装项目依赖的环境，在仓库根目录逐条执行：

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
python docs/diagnoses/workspace-media-import-failure/repro_backend.py
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/workspace-media-import-failure/repro.config.ts
```

后端复现需要 Python 3.10+、SQLAlchemy、aiosqlite、Pydantic 2、
FastAPI 及项目依赖；前端使用仓库已有 Vitest/React 依赖。
本次运行环境为 Windows、Python 3.11.7、SQLAlchemy 2.0.31、Vitest 4.1.5。
不需要启动桌面应用、配置密钥或连接网络。
修复后的音频回归需要本机可执行的 `ffprobe`（桌面应用已随包提供）。

后端脚本依次执行以下过程：

1. 在报告目录内建立自动清理的临时工作区，在内存 SQLite 中使用
   **真实 `CachedMaterial` ORM 表定义**建表。
2. 调用真实 `_resolve_cwd()`，在默认根目录生成一个可解码的 1.5 秒 WAV。
   调用真实 `_import_material()`，确认得到 `workspace_not_found / 404`。
3. 将同一文件复制到 `files/bgm.wav`。
   调用真实 `workspace_store.list_files()`，确认可以正常枚举文件。
4. 再次调用 `_import_material()`，在真实 SQLite 非空约束下首次导入成功，
   SQL 错误为空，返回真实时长 1.5 秒。
5. 校验数据库 `source_url`、返回 URL 与实际缓存文件相符，源文件仍在。
6. 使用既有缓存 URL 查询与本地媒体解析器读取同一文件。
7. 再次导入，确认 `reused=true`、ID/URL 不变、缓存只有一份且时长仍为 1.5 秒。

隔离措施只替换配置、日志、服务单例以及包级全量装配；
素材提交的业务函数、ORM、事务、文件操作及错误转换均为仓库实现。
该脚本的数据库与提交运行在同一个测试循环；常规后端回归另覆盖
后台线程桥接与真实 HTTP 闸门。修复前的非空失败及单变量对照输出保留在
`repro-output.txt` 开头，便于对比。

前端复现先仅加载 `workspace_import_material`，再尝试执行未加载的
`workspace_list`，确认没有任何 HTTP 调用，随后将真实拒绝结果交给卡片。
现在断言显示明确加载提示，且不出现“没有文件/文档”和虚构用量。
另一个用例确认 `cache_commit_failed` 显示素材保存失败并保留已知文件名。

修复后两个命令均退出 0；前端为 1 个文件、2 个用例通过。
断言已由确认故障转为验证正确行为。

### 二、原始会话的确定性还原

定位路径为 `video_projects.project_data` 中
`conversations[0].messages[5].agentToolCalls`；下列序号从 0 开始。
摘录见 `evidence.json`，无需重新运行模型来猜测行为。

| 记录序号 | 已确认的输入/输出 |
|---|---|
| 7 | `explore_tools` 的 `tool_names` 只有 `workspace_import_material`，返回 `loaded` 也只有它 |
| 11 | `bash` 默认 cwd 是 `agent_workspace/project-34adb9d71cc6`；FFmpeg 输出相对文件名 `bgm_ukulele_quiet.mp3`，退出 0，输出 `Duration: 00:01:00.00` |
| 12 | 用该裸文件名导入，返回 `workspace_not_found`、HTTP 404 |
| 13 | `dir /b` 同时列出根目录 MP3 和 `files`、`digest` 等子目录 |
| 14 | `workspace_list` 返回 `success:false` 和 `error: tool_not_loaded: ...`，无后端错误码 |
| 15 | shell 将根目录 MP3 复制进 `files/`，退出 0 |
| 16 | 再次导入，返回 `cache_commit_failed`、HTTP 507、`failureClass: internal` |

后端访问日志与之对应：

```text
<userData>/logs/backend.log:4732  2026-11-05 07:00:58 POST /api/agent-toolkit/workspace/import
<userData>/logs/backend.log:4733  Response: 404
<userData>/logs/backend.log:4755  2026-11-05 07:01:31 POST /api/agent-toolkit/workspace/import
<userData>/logs/backend.log:4756  Response: 507
```

时间按日志原文记录，未推断时区。现场根目录和 `files/` 中的 MP3 都仍存在，
均为 1,356,764 字节，SHA-256 均为
`dfecdf2f63a8d518b626041da5f54baa8b1e9991a4b536fd4b66dc2659f4ceb1`。
因此，第 3 项不能归因为“文件复制失败”或“素材没有生成”。

## 根因分析

### A. 主根因：本地素材来源与缓存表非空契约冲突（P1）

调用链：

```text
workspace_import_material
  → POST /api/agent-toolkit/workspace/import
  → _import_material()
  → store_workspace_file_async()
  → _store_workspace_file()
  → _commit_research(..., url=None, source="workspace")
  → INSERT cached_materials(source_url=NULL)
  → SQLite 非空约束拒绝
  → cache_commit_failed
```

关键代码证据：

- `backend-services/basic-service/app/services/material_download_service.py:531`：
  `_store_workspace_file()` 校验扩展名和哈希后，在第 543 行将 `None`
  作为来源参数传给共享提交函数。
- `backend-services/basic-service/app/services/material_download_service.py:594`：
  新建缓存记录直接使用 `source_url=url`。
- `backend-services/basic-service/app/models/db_models.py:91`：
  `source_url = Column(Text, nullable=False, index=True)`。
  现场数据库 `PRAGMA table_info(cached_materials)` 也确认 `not_null=true`，
  不是只存在于源码中的约束。
- `backend-services/basic-service/app/services/material_download_service.py:609`：
  捕获所有普通异常，改抛 `WebResearchError("cache_commit_failed")`，
  `from None` 隐藏原始异常链，且该分支没有记录根异常。

离线复现实际输出：

```text
error_code=cache_commit_failed
status=507
failure_class=internal
sqlite_error=NOT NULL constraint failed: cached_materials.source_url
```

为何是 507：`web_research_models.py:58` 给 `cache_commit_failed` 定义了 507；
`agent_toolkit_router.py:160` 的 `_web_error_to_toolkit()` 原样保留上游状态。
虽然 `agent_toolkit_models.py:56` 本域定义的是 500，传入的 507 会覆盖它。
所以现场 507 **不能证明磁盘已满或配额耗尽**。

`src/lib/agentToolkitStatus.ts:66` 将 `cache_commit_failed` 映射为
`storageUnavailable`，最终显示通用工作区不可用文案。

反证/对照：把唯一的空来源参数换为确定的站内缓存引用，同样的 SQLite
表、文件权限和提交路径立即成功；失败后的源文件也保持完整。
这直接支持数据契约冲突，而非 Windows 权限或外部网络故障。

该失败主要发生在**新建缓存记录**时。已有正确来源的 ready 记录可能走复用分支，
不执行 INSERT；复现也验证了这一边界，不能声称任何导入都必然失败。

### B. 首次失败：两类工具对“工作区相对路径”的解释不同（P2）

- `backend-services/basic-service/app/services/agent_host/shell_runner.py:101`：
  默认 cwd 为 `project_directory(project_id)`，即项目根目录。
- `backend-services/basic-service/app/services/agent_toolkit/workspace_store.py:387`：
  `resolve_file()` 固定拼接 `directory / "files" / relative`（第 391 行）。
- `src/lib/video-editing-agent/tools/workspaceTools.ts:52`：导入参数描述仅称
  “existing workspace file”的相对路径，没有明确相对 `files/`。
- `src/lib/video-editing-agent/promptParts.ts:283`、`:295` 告知产物要导入，
  没有把 shell 输出路径与导入名的对应关系讲清楚。

例如 shell 在默认 cwd 输出 `bgm.wav`，应改为输出 `files/bgm.wav`
或显式以 `cwd="files"` 执行；对应导入参数仍是 `name="bgm.wav"`，
不能再传 `files/bgm.wav` 造成双重 `files/`。

现场记录 11、13、15 完整证明了此路径差异；复制后第一次问题消失，
第二次导入才暴露 A。这不是项目 ID 丢失的推测，也不需要全盘搜索文件。

### C. 列表“内部错误”：加载闸门与卡片错误表达断开（P2）

记录 7 只加载导入工具。虽然错误建议要求查看工作区，
`src/lib/video-editing-agent/tools/toolkitAdapter.ts:51` 只说
`Call workspace_list ...`，未提示先显式加载。

`src/lib/video-editing-agent/tools/index.ts:532` 的执行闸门拒绝未加载工具，
第 535 行只返回 `error` 字符串，没有 `error_code` 或结构化 `next_step`。
`src/lib/video-editing-agent/registry/ToolActivationState.ts:84` 的 `offer()`
和同文件第 90 行的 `canExecute()`
要求工具先进入下一轮模型可用集合。这个边界本身是正确约束，应保留。

卡片在 `src/components/video/components/VideoChatWindow/WorkspaceFileCard.tsx:236`
只把 `error_code/code` 交给状态映射；记录 14 只有 `error`，因此落入通用
`internalError`。同文件第 260 行即使失败也调用 `detailFor()`；
`ListingDetail()`（第 133 行）把缺失的文件/文档字段转为两个空数组。

于是一次**未执行的列表请求**同时显示“内部错误”和“没有文件”，
并不是读取到了空工作区。前端复现确认 HTTP 调用次数为 0，
与原始记录一致。无需通过修改后端文档查询或数据库建表来修复这一现象。

### D. 后续阻塞风险：导入音视频丢失真实时长（P1，附带确认）

`backend-services/basic-service/app/routers/agent_toolkit_router.py:345`
固定返回 `"duration": 0`。
`src/lib/video-editing-agent/tools/workspaceTools.ts:86` 原样保存这个值；
`src/lib/video-editing-agent/tools/addToTrack.ts:150` 使用
`material.duration || 5`，并将其写入 `originalDuration`（第 161 行）。

离线对照已经验证：真实 1.5 秒 WAV 成功复用后仍返回 0。
由下游代码可知，它会按 5 秒创建片段；同样路径下的 60 秒 BGM 也会丢失长度。
这不是现场 507 的成因，原会话尚未成功走到该上轨步骤。
修复 A 后需探测真实媒体元数据，并验证从导入到上轨的长度，
不能只用“导入返回 success”作为本轮修复验收。

## 影响面

- A 影响所有首次经工作区导入的允许格式，包括 shell/分析生成的音频、视频、
  图片和 SVG；根因与 MP3 编码、是否联网及 Windows 特定权限无关。
- B 影响从默认 shell cwd 生成产物，再使用工作区工具读取或导入的流程。
- C 影响未加载 `workspace_list` 时的错误恢复，并误导用户把读取失败理解成数据为空。
  其他只含 `error` 的闸门结果也应核查，但本报告只实测上述工作区路径。
- D 影响成功入库后的音视频时间线长度；图片的静态展示时长应继续按图片规则处理。
- 远程 `download_url` 传入实际来源 URL，不会仅因 A 的空值冲突失败；
  原始下载成功不代表工作区二次导入也能成功。
- 不涉及上轮默认音色、供应商停用或时间线约束修复；历史黑板 F-1～F-3
  为前轮记录，不作为本轮待修问题。

## 候选修复方案

三种方案都需同步处理路径说明、结构化错误/失败空态和真实时长；
表格比较核心存储契约的选择。

| 方案 | 实施方式 | 侵入性 | 主要风险 | 工作量 |
|---|---|---|---|---|
| A：工作区来源使用确定的站内缓存引用（推荐） | 新记录按内容标识与扩展名构造非空引用；已有记录按实际提交路径复用，保持来源、路径和返回 URL 一致 | 小；集中在工作区提交入口及关联工具链 | 不能仅替换 `None`：同内容扩展名别名会造成来源与路径不一致；见文末实测反例 | 小到中；加真实 SQLite、缓存一致性与导入上轨回归 |
| B：将来源 URL 改为可空 | ORM 与旧库同步迁移，所有消费者允许缺省来源 | 大 | 只改 ORM 不会改变已有 SQLite 非空列；常见 SQLite 重建表方案不符合仓库禁止破坏性启动 DDL 的约束 | 大；需要另行设计兼容迁移，不适合作为本次最小修复 |
| C：单独引入本地素材记录 | 新增独立表/仓储，工作区不复用远程缓存模型 | 大 | 需要同步素材查找、去重、预览、导出、清理和跨版本兼容 | 最大；适合后续模型重构 |

不建议仅把 `None` 改为随意的空字符串：它虽可能避开非空检查，
但不表达可定位的来源，也会给按 URL 查询带来歧义。
不建议扩大导入路径到任意绝对路径或直接修改 shell 的全局默认 cwd：
前者改变已有路径边界，后者可能破坏现有脚本。

## 推荐方案与实施边界

推荐 A。单变量对照已证明，在不改表结构的前提下提供合法来源可以解除主阻塞，
兼容已有 SQLite 安装，也避免触碰上轮可靠性修复。
下游实施应保持以下边界：

1. **提交契约**：工作区来源使用确定的本地缓存引用，来源类型仍为 `workspace`；
   来源引用须与实际持久化路径一致，同内容的合法扩展名别名复用已提交文件。
   保留哈希校验、幂等复用、原子复制和提交前失败回滚；已提交后取消不得删文件。
   提交失败时记录脱敏后的异常类别与请求关联信息；
   区分数据库提交失败、真实磁盘不可写和配额不足，不向模型暴露完整 SQL 参数。
   在工作区转换边界使用本域 `cache_commit_failed=500`，保留真实配额错误的 507；
   不修改共享 web 错误码表，不借此重构全部存储错误分类。
2. **产物路径**：明确默认 cwd、`files/` 输出目录、工具 `name` 的关系；
   给模型可执行示例。保持既有相对路径校验，不自动跨项目搜索或搬运任意文件。
3. **加载与呈现**：闸门返回稳定的 `tool_not_loaded` 结构化码与下一步；
   缺失文件的恢复建议先加载 `workspace_list`，再在下一次响应调用。
   卡片失败时不显示“没有文件/文档”或虚构的零用量；
   兼容历史只有 `error` 字符串的记录。保持按需加载及单轮授权边界。
4. **媒体信息**：对可导入音视频读取有限且大于零的实际时长，视频读取必要尺寸；
   首次与复用路径均需返回这些数据。探测须有超时、支持取消，并针对音频选取音频流，
   不能直接套用仅选 `v:0` 的视频探测器。探测失败不得产生素材库添加操作，
   不能成功返回 0 后静默按 5 秒上轨；图片/SVG 保持原有静态时长规则。

以上为前序评审交给实施节点的边界；实施情况见文末。

### 建议验收矩阵

| 检查项 | 修复后应满足 |
|---|---|
| 新的 WAV/MP3 工作区素材 | 在真实 SQLite 非空约束下首次提交成功，返回可读取的同源 URL |
| 重复导入 | ID/URL 稳定，复用同一缓存记录，不重复插入素材操作 |
| 同内容并发、扩展名别名 | 两个不同调用 ID 导入同内容时只生成一条记录；`.jpg`/`.jpeg` 复用同一实际缓存，来源引用、查询路径、返回 URL 一致 |
| 根目录与 `files/` | 输出和导入相对名契约一致；错误路径有具体恢复提示，不扩大路径边界 |
| 工具未加载 | 先返回可识别的加载提示，无 HTTP；加载并进入下一响应后才能执行 |
| 列表失败与成功空列表 | 失败不展示空态；成功且为空才显示空态；中英文均可用 |
| 60 秒 BGM 导入上轨 | 导入时长和片段原始时长与探测一致，不变成 0 或 5 秒；覆盖目标 60 秒 |
| 已有旁白/视频 | 背景音乐进入独立音轨，时间线与旁白不被移位，最终再做时间线检查 |
| 文件损坏、权限/磁盘错误 | 明确错误码，无伪成功，提交前失败清理本次临时产物并保留源文件；提交后取消或响应失败保留可复用的完整缓存 |
| 媒体探测与源文件变化 | 覆盖纯音频、无音轨视频、缺失探测程序、超时、无效时长；用于哈希、探测和入库的内容一致，失败不添加素材 |
| 既有 web 缓存及历史修复 | URL 查找、导出、本地素材复用和上轮回归仍通过 |

## 前序诊断节点验证记录

后端复现退出 0，前端诊断 2/2 通过，完整输出已保存。
脚本最初曾遇到本机 OpenCV 包加载问题和诊断夹具的中文语言键拼写错误；
已分别通过隔离无关包级装配、使用真实 `zh-CN` 键修正诊断入口，
未修改产品或依赖。最终记录对应修正后的实际执行。

仅新增本诊断目录。开始前已有的 `desktop/README.md`、
`desktop/scripts/lib/electron-env.js`、`desktop/scripts/smoke-test.js`
及未跟踪的 `desktop/scripts/lib/electron-env.test.js` 均保留。
未运行全量构建或完整测试集，因为本节点没有产品改动；
完整修复验证由后续实施节点执行。

## 评审结论

**最终仅推荐方案 A：保留现有表结构，为工作区缓存写入与实际持久化文件一致的
站内引用，同时修复本次流程直接涉及的路径说明、错误呈现和音视频时长。**
主根因成立，方案方向通过；“只把 `None` 替换成按本次入参拼出的 URL”不足以作为
完整实现，必须满足下面的缓存一致性与失败边界。方案 B、C 不进入本轮实施。

### 证据链复核与结论强度

1. **实际入口连通。**
   `src/lib/video-editing-agent/tools/workspaceTools.ts:184` 发起导入请求，
   `backend-services/basic-service/app/routers/agent_toolkit_router.py:284`
   的路由先经工具闸门和调用缓存，再于第 289 行调用 `_import_material()`。
   第 309 行解析 `files/`，第 322 行进入真实素材提交服务。
   `backend-services/basic-service/app/main.py:735` 注册此路由，
   第 740 行将本域异常交给统一错误响应。原会话的两次导入访问日志与
   `workspace_not_found/404`、`cache_commit_failed/507` 对应；被引用函数
   确实处于该请求路径，而非未使用的另一套素材上传实现。
2. **应区分现场记录和诊断捕获。**
   现场日志只保存 HTTP 状态，没有保存底层 SQLite 异常；
   `NOT NULL constraint failed` 来自本仓库代码、真实表定义及内存 SQLite
   的确定性复现。结合现场同名文件存在、实际列为非空、路径修正后进入提交失败，
   足以将空来源确定为本轮必须修复的主缺陷；不能声称日志原文已经记录该 SQL 错误，
   也不能仅凭一个 507 排除所有可能的 I/O 故障。
   本评审未校验已安装桌面程序与仓库每个文件的字节一致性，未重放原项目。
3. **替代解释已经受到约束。**
   `workspace_not_found` 在提交之前产生，不能由数据库空值解释；
   `tool_not_loaded` 在 HTTP 之前产生，不能由后端列表读取失败解释；
   正确路径下的新记录空来源冲突可在不联网的真实 SQLite 中重现，
   不需要用 CDN、授权状态或 MP3 编码失败解释。
   单变量成功对照排除了该诊断环境中的权限/空间不足，不能证明任意环境都没有这些问题。
4. **复用反例范围更广。**
   `backend-services/basic-service/app/services/material_download_service.py:592`
   仅在 `row is None` 时写入 `source_url`；已有非空来源记录即使不走 ready 复用、
   而是修复丢失缓存，也可能绕过本次空值 INSERT 问题。
   因此准确的触发条件是“经此入口新建工作区缓存记录”，不是“所有导入必败”。
   时长为零则是成功响应的独立缺陷，不能倒推成原现场 507 的原因。

### 推荐方案的兼容性与遗漏边界

**站内引用可被既有消费者处理，无需增加下载器或静态挂载。**
`backend-services/basic-service/app/services/material_download_service.py:255`
按来源引用精确查 ready 行并返回存在的 `local_path`，第 318 行的
`local_url_for()` 从实际路径生成站内 URL，不要求来源是公网地址。
`src/lib/video-editing-agent/tools/workspaceTools.ts:75` 接受该形式的路径，
并将其同时保存为 `url/serverUrl/cacheUrl`。
`src/components/video/lib/selectPlaybackUrl.ts:239` 在导出时优先使用本地引用；
`backend-services/basic-service/app/services/composition/media_resolution.py:58`
先查缓存，再调用本地解析器；
`backend-services/basic-service/app/services/local_media_resolver.py:166`
将 `/api/storage/files/` 映射回存储根目录，校验文件后返回本地路径。
本次隔离实验也验证了缓存 URL 查询与本地解析器得到同一个文件。
因此不应把站内引用送进远程 `enqueue`/HTTP 下载补救路径；缓存丢失时应从
仍存在的工作区源文件修复，源文件也丢失则明确报错。

**新确认的反例：同内容、不同合法扩展名。**
`backend-services/basic-service/app/services/material_download_service.py:544`
以 `workspace-<digest前24位>` 为标识，扩展名不参与去重；第 578 行却将扩展名
拼入目标路径。第 586 行按这次的目标文件判定复用，第 596 行可改写旧行的
`local_path`，但第 594 行只给新行设置 `source_url`。
`backend-services/basic-service/app/models/db_models.py:121` 的唯一键也只有
`(source, source_id)`。

评审使用真实 2×2 JPEG，在报告目录内的临时工作区和内存 SQLite 中运行一次性
`python -` 实验；沿用 `repro_backend.py` 的配置隔离，实际执行
`store_workspace_file_async()` 的哈希锁和 SQL/文件提交逻辑。
只在诊断进程的提交入口把 `None` 替换为本次文件的站内引用，模拟最简单的方案 A，
没有修改产品源码。先并发导入两次 `.jpg`，再把相同字节以 `.jpeg` 导入，结果为：

```text
同扩展名并发：同一 record_id；reused=[false,true]；1 行；结束后哈希锁数=0
URL 查询与本地路径解析：一致，文件哈希匹配
随后 .jpeg 导入：同一 record_id；reused=false；缓存文件数=2
source_url 后缀=.jpg；local_path 后缀=.jpeg；本次返回 local_url 后缀=.jpeg
查询旧 .jpg URL：返回 .jpeg 路径
```

这是推荐实现的边界反例，不是原 MP3 失败的新解释。应在 `source="workspace"`
的分支优先复用已提交、存在且完整哈希匹配的文件，并由实际路径生成返回引用；
新建或修复记录时同时保证来源引用和实际路径一致。
合法别名不能让同一素材 ID 的缓存路径来回变化；若不支持某种不一致输入，
应显式拒绝，不能隐式改写既有记录。保留既有内容标识，避免改 ID 后使历史引用失联；
共享 web 分支保持现有行为。

**并发和取消必须沿用现有提交语义。**
`backend-services/basic-service/app/services/material_download_service.py:135`
将提交调度到专属循环，第 538 行按完整 digest 加锁；不能把锁移到 HTTP 循环，
也不能仅依赖调用 ID 去重。后者位于
`backend-services/basic-service/app/services/agent_toolkit/toolkit_calls.py:49`，
只合并同一 `(call_id, action)`，不同调用 ID 仍需内容锁。
已有唯一约束是最后防线，不能吞掉约束异常后直接宣称复用成功。
本轮同循环实验验证了同内容并发对照，尚未覆盖真实跨线程桥接或多进程；
当前单用户桌面架构无需为此新增分布式锁。

`backend-services/basic-service/app/services/material_download_service.py:552`
屏蔽提交中取消，等待数据库提交结果；第 614 行仅清理未提交的新目标文件。
这意味着“请求被取消/失败”不总等于“没有持久化结果”：若提交完成后取消或
刷新/响应失败，必须保留 ready 文件供重试复用。后续验证须覆盖提交前失败、
提交期间取消、提交后取消，以及 ready 缓存丢失后重建；不能用统一删缓存补偿。
原有 `backend-services/basic-service/tests/test_research_cache_commit.py:18`
覆盖的是 web 提交后取消，可作为回归基线，但不等于工作区路径已经验收。

还不能把共享提交函数的 `except` 视为所有 I/O 的兜底：目录创建位于
`material_download_service.py` 第 577 行，在第 581 行的 `try` 之前；
路由第 319 行的源文件读取也在错误转换范围外。文件在解析后消失或权限变化时，
应在工作区导入边界保留明确的失败信封，不以扩大共享异常吞噬范围来解决。

**文件与媒体信息必须指向相同内容。**
`backend-services/basic-service/app/routers/agent_toolkit_router.py:319` 先读源文件，
提交服务第 536 行再验哈希、第 589 行才复制；内容锁不能阻止 shell 同时重写源文件。
新增探测不可把一次探测的时长与另一次复制的字节混在一起；应基于稳定快照或在
最终发布前复核复制内容的哈希，发现变化则返回可恢复错误。
这些是从代码确认的竞争窗口，本评审未把它说成原会话已发生的并发故障。

元数据修复还须覆盖纯音频。现有
`backend-services/basic-service/app/services/composition/media_probe.py:122`
的 `probe_video_stream()` 固定选择 `v:0`，其解析器又要求视频尺寸；直接复用它
会漏掉本次 MP3。应使用现有 FFmpeg/ffprobe 的发现方式，对音频/视频分别探测，
无需新增依赖或把整套导出质量检测搬到导入入口。
探测以秒返回有限正值，缺失程序、超时、损坏媒体、无可用时长须有稳定错误码，
并同步登记本域错误映射、前端状态和恢复建议。
建议在创建新缓存前完成可失败的探测；复用既有缓存时也不得在探测失败后删掉
共享 ready 文件。MP3 以实际探测时长为准，60 秒验收允许合理编码误差，
时间线覆盖目标仍需按用户要求裁切/对齐，不能硬编码所有导入音频为 60 秒。

复用还需检查前端状态：
`src/lib/video-editing-agent/tools/workspaceTools.ts:204` 发现同 ID 已存在便跳过
素材添加，返回的新时长不会自动写回旧素材。若既有素材的时长仍为 0，
仅修后端响应不能保证再次上轨正确。重导入应局部补齐该素材的有效元数据，
保持 ID 和去重行为；不要求扫描全部历史项目或自动修改已经编辑的片段。

**路径和卡片修复应保持局部。**
默认 `shell_scope="workspace"` 下可使用 `cwd="files"` 输出 `bgm.mp3`，
再以 `name="bgm.mp3"` 导入；若从项目根输出，则明确写 `files/bgm.mp3`，
并先确保父目录存在。这个相对 cwd 示例不适用于 `shell_scope="host"`，
不能把两种模式混为一谈。保留 `resolve_file()` 的项目与相对路径边界。
闸门增加结构化码时仍保留旧 `error` 字段兼容已有消费者，并给下一轮加载提示。
失败的列表卡片不显示“没有文件/文档”和伪造计数；导入卡片仍可保留已知文件名。
兼容历史 `tool_not_loaded: ...` 字符串，不把任意错误文本直接当本地化文案。
执行中、取消和成功空列表要分别验证，不能只给状态映射添加一个键就结束。

### 最小变更的裁定与交接验收

方案 A 的最小存储修复点是工作区提交的来源/实际文件契约。
路径说明和列表恢复是同一次会话已经观察到的问题；真实时长是解除主阻塞后立即
影响 BGM 上轨的已证实缺陷，三者纳入本轮有直接依据。
同内容别名的一致性属于新来源契约的必要边界，不另建缓存体系。
其余工作限定为相应回归与局部错误转换，不扩展到全局缓存迁移、全量元数据回填、
更改 shell 默认目录、放宽路径校验、重写时间线算法或供应商网络策略。

方案 B 既不能单靠 ORM 改动修复已安装数据库，也不能补齐路径、UI 和时长；
其迁移与空值消费者审计成本明显超过本次收益。方案 C 则要重新实现查找、复用、
预览、导出与清理，且同样绕不开并发和失败边界。本次均没有采用理由。

下游除前文验收矩阵外，必须将真实 SQLite 首次导入纳入常规回归，不能 mock 掉
`CachedMaterial` 或 `_commit_research()` 后只验证成功载荷。
需验证工具 HTTP 入口的状态/信封、后台循环提交、真实音频探测、素材库去重、
导入后上轨的原始时长，以及图片/SVG 和既有 web 缓存回归。
新错误或兼容逻辑只加在本次链路，保留上轮时间线与工具加载约束。
当前报告中的诊断断言锁定的是故障，实施时应转为正确行为断言；
不能以这些旧断言仍通过作为“修复成功”。

### 本次评审验证记录

- 2026-11-05 重新执行
  `python docs/diagnoses/workspace-media-import-failure/repro_backend.py`：退出 0；
  根路径 404、真实 SQLite 非空失败 507、回滚、非空来源对照及零时长均重现。
- 执行 `node node_modules/vitest/vitest.mjs run --config docs/diagnoses/workspace-media-import-failure/repro.config.ts --cache=false`：
  退出 0，1 个文件、2 项诊断通过；这是缺陷复现结果。
- 上述临时 `python -` 实验退出 0；同内容并发正对照、站内引用解析正对照和
  `.jpg`/`.jpeg` 不一致反例均由真实 SQLite/文件实现验证，临时目录自动清理。
- 本次交付只修改本 `analysis.md`，修正了工具激活状态的行号并补齐边界证据；
  前序证据/复现文件及已有 desktop 改动保留。没有产品修复、Git 提交、
  原项目剪辑、完整渲染或供应商调用；未声称跨线程、取消及全部媒体格式已通过修复验收。

## 实施过程中发现的方案缺陷

实施日期：2026-11-05。方案 A 的方向与边界成立，没有改用 B/C。
落实时确认以下两处需要沿整条链路处理，均在评审已规定的范围内：

1. 仅修复后端时长不能更新已经进入前端素材库的零时长记录。
   现有 `add_materials` 只按 ID 去重，因此补充窄范围的 `update_material`
   操作，只更新时长及尺寸；真实 Store 和撤销路径同步支持该操作。
   用户名称、素材 ID、已经编辑的片段均保持原样，撤销仅回退本次更新的字段。
2. 除新记录与扩展名别名外，已有 ready 记录也可能保留错位的来源引用。
   新增真实 SQLite 回归先观察到该用例失败，再补上原位校正：
   复用既有缓存文件及路径，只更新来源引用，不重新复制或删除共享缓存。
   工作区转换同时采用本域提交/完整性错误状态，避免继承 web 域的 507/502；
   真实磁盘满仍返回 507，不改变共享 web 错误码表。

## 方案 A 实施结果

- **缓存与事务**：工作区新记录写入实际缓存路径对应的非空站内 URL；
  完整哈希锁仍在下载服务专属循环，`.jpg/.jpeg` 并发导入只保留同一记录及文件。
  缓存丢失后沿原路径重建；复制副本先核验哈希再探测、发布。
  提交前错误清理本次临时产物，提交期间取消等待事务落定，提交后失败保留缓存。
- **媒体元数据**：沿现有 PATH 发现 ffprobe，音频选择 `a:0`，视频选择 `v:0`，
  使用 15 秒超时并在取消/超时时终止、回收子进程。
  首次导入与复用均返回有限正时长，视频返回显示尺寸；图片/SVG 保留静态时长。
  损坏文件、无效时长、缺少探测程序和超时均明确失败，前端不发布素材操作。
- **错误与路径**：数据库错误记录异常类别及可与响应关联的 request_id，
  不记录 SQL 参数；权限错误、磁盘满、文件消失分别返回对应信封。
  提示词与导入参数明确默认 shell cwd、`files/` 输出及不带此前缀的 `name`；
  `run_analysis` 的 `out/` 产物需先复制进 `files/` 再导入。
- **加载与界面**：加载闸门保留旧 `error`，增加 `tool_not_loaded`、失败类别及下一步。
  缺失文件建议先加载列表工具、下一响应再调用。卡片兼容历史字符串记录，
  失败/取消/执行中/无成功载荷时不显示空态或零用量，中英文均有白名单文案。
- **改动范围**：未增加依赖或永久文件，未改 ORM/数据库表结构、shell 默认 cwd、
  时间线算法或供应商策略。保留原有四个 desktop 文件改动，未执行 Git 提交。

### 实施验证与限制

实际命令、退出码及历史失败均保存在 [repro-output.txt](repro-output.txt)。

| 验证 | 结果 |
|---|---|
| 原后端复现转回归 | 退出 0；真实 SQLite 首次成功，1.5 秒 WAV 时长正确，重复导入 ID/URL 稳定，缓存查询与本地解析得到同一文件 |
| 原前端复现转回归 | 1 文件、2 项通过，退出 0 |
| 常规后端相关回归 | 6 文件、101 项通过、1 项跳过，退出 0；覆盖真实 SQLite/HTTP、专属后台循环、WAV/MP3/无音轨视频/SVG、别名并发、取消、失败清理和源文件变化 |
| 前端工具链扩大回归 | 限制 4 个工作进程后，100 文件、1054 项通过，退出 0 |
| 补充真实 Agent 上轨 | `toolkitTools.test.ts` 增至 17 项且通过；60 秒 BGM 在独立音轨，视频/旁白未移动，时间线检查 0 阻塞，内容/渲染/缓存总长均为 60 秒 |
| 编译与静态检查 | TypeScript、Next.js 生产构建、4 个后端修改文件语法检查、凭据扫描和 `git diff --check` 通过 |

前端扩大回归首次使用默认并发时，一项视觉工具测试在动态模块加载阶段超出
5 秒，并引发同文件后续初始化错误；保持产品代码不变，限制 4 个工作进程后
整组通过。最终补充测试曾使用项目旧编译目标不支持的迭代器遍历，已改为
数组 `forEach`，最终 TypeScript 检查退出 0。

另行运行的 `test_material_router.py` 有 5 项失败、4 项通过：旧测试的 MagicMock
未提供预览代理字段，触发 Pydantic 校验。将素材服务替换为 `git show HEAD:...`
获取的原始代码、仅在隔离测试进程执行后，仍得到相同 5 项失败；没有修改该测试、
素材路由或相关模型。此项是已确认的基线问题，未计入上表通过项。
构建还有既有 Browserslist 数据陈旧提示；后端存在既有依赖弃用警告。

验证使用仓库内临时目录、隔离 SQLite 和本地合成媒体。
未重放用户原项目、未修改用户数据库/音频/时间线、未调用真实供应商，
也未声称已给原项目实际铺好 BGM 或完成导出。

收尾时，自动审批先后拒绝了经路径校验的批量清理和逐目录显式清理，
返回理由均为 `blocked by policy`。因此仓库根目录的
`.pytest-workspace-import/`、`.pytest-workspace-alias/` 两个测试临时目录暂时保留；
它们是隔离测试生成的合成媒体和 SQLite 夹具，不属于产品交付文件，未暂存。
诊断脚本自身的 `diagnosis-*` 临时目录已自动清理。

## Final code review (2026-11-05)

Reviewed the implementation against scheme A and the acceptance matrix above.
The non-null workspace source reference fixes the SQLite contract at the cache
commit boundary. It does not relax the schema or mask a failed insert. Path
guidance, tool activation errors, failed-list presentation, measured duration,
metadata refresh and undo remain confined to the affected workflow.

One remaining issue was reproduced and fixed during this review: content-based
deduplication accepted incompatible filename extensions while retaining the
original cache URL. The response could therefore describe a different format or
media type under the same material ID. Reimport now requires the original
extension, except for the equivalent `.jpg` / `.jpeg` spellings. An incompatible
extension returns `unsupported_media_type` without changing the existing cache.
The real-SQLite regression failed before this change and passed afterward.

The background-loop integration test now includes a real WAV and invokes the
actual ffprobe subprocess across the service's thread boundary. The prior SVG
case did not exercise subprocess support; both variants pass.

| Fresh review validation | Result |
|---|---|
| Incompatible-extension regression and real background loop | Before fix: 1 failed, 2 passed; after fix: 3 passed |
| Backend cache, toolkit, media probe, workspace, resolver and web research suites | 165 passed, 1 skipped, exit 0 |
| Frontend agent, workspace card, status, client and proxy suites | 100 files, 1055 passed, exit 0 |
| Workspace diagnosis | Backend SQLite/WAV reproduction exit 0; frontend 2 passed |
| Prior-round editing reliability diagnosis | 16 passed, exit 0 |
| TypeScript and Next.js production build | Both exit 0 |
| Modified Python production files | All 4 parse successfully |
| Credential scan after staging the complete fix | 2565 tracked files, no findings, exit 0 |

The build retains the existing Browserslist age warning and configured lint
skip. Backend tests retain dependency deprecation warnings and a platform skip.
The five material-router baseline failures documented by the implementation
node were not part of this review's passing test set and were not rerun here.
No live provider calls, original-project edits or exports were performed.

The intended commit contains exactly 20 source/test files and the 6 files in
this diagnosis directory. The four pre-existing desktop changes, both
`.pytest-workspace-*` directories, review runtime files and build output are
excluded. Desktop files were not edited during this review. Final validation
output is appended to [repro-output.txt](repro-output.txt).
