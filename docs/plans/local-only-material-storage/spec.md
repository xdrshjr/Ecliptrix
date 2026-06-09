# 视频编辑素材本地化存储 — 移除「上传到服务器」代码 设计方案 (spec)

- **Feature slug**: `local-only-material-storage`
- **版本 / Version**: **v2**（评审完成，所有 P0/P1 已就地修复）
- **作者 / Author**: Subtask #0（方案设计）
- **评审 / Reviewer**: Subtask #1（方案评审与修复）
- **创建日期**: 2026-06-08
- **评审日期**: 2026-06-08
- **状态**: Reviewed（评审结论见文末「评审结论」段）

---

## 0. 评审记录 / Review Notes (v2)

> 本节由 Subtask #1（资深评审）在 v1 基础上**逐节对照真实代码**后补入。所有结论均经过 `git grep` / 读源码核实（核实点见每条「证据」）。**P0/P1 已在本文档正文就地修复并标注 `[已修复 v2]`**；P2 为实现期提示，列入文末「评审结论」的放行条件。

### 评审维度小结

| 维度 | 结论 |
|---|---|
| 可行性 Feasibility | ✅ 通过。核心判断「桌面端 OSS 恒关」已核实：`config.py:1001` 默认 `OSS_ENABLED=false`，桌面注入环境不开启，运行日志 `grid_pack_service:584 ... No module named 'oss2'` 证明远端清理早已是空操作。删除 OSS 链路是行为保持的死代码消除。 |
| 完整性 Completeness | ⚠️ 发现 3 处遗漏（P1-1 依赖、P1-2 config 媒体代理侧 OSS 子配置、P1-3 R1 下游未决），已修复。 |
| 一致性 Consistency | ✅ 通过。迁移编号 `014` 紧接现网最新 `013_drop_agent_workflows`，正确。REST 路径不变，符合 CLAUDE.md「删除僵尸代码/不制造孤岛」。 |
| 适度性 Right-sizing | ✅ 通过。端到端删除而非半改造，范围恰当；§8 R5 已自我约束「最小改动」。 |

### 问题清单

| 编号 | 严重度 | 问题 | 证据 | 处置 |
|---|---|---|---|---|
| P1-1 | **P1** | `oss2>=2.18.0` 仍留在 `requirements.txt:59`，但全仓唯一的 `import oss2` 来源 `oss_client.py` 及各服务内 `import oss2` 均被删除。DoD 要求「不再存在上传到服务器的代码**与配置**」，残留依赖与之矛盾。 | `requirements.txt:59 → oss2>=2.18.0` | **[已修复 v2]**：§3.2 新增 (I) 条、§4 表新增第 29 行删除该依赖；§7-1 静态扫描加入 `oss2` 已覆盖。 |
| P1-2 | **P1** | §3.2(D) 仅列出 `pp_oss_yaml`（预览代理侧），**遗漏对称的媒体代理侧 OSS 子配置**：`MediaProxyConfig.oss_bucket_subprefix` 字段（`config.py:732`）、`PreviewProxyConfig.oss_bucket_subprefix` 字段（`751`）、`mp_oss_yaml` 解析（`942`）与其填充（`963`）。删 yaml `oss:` 块后这些字段沦为读取已删 key 的死配置（因 `... or {}` 默认值不会崩溃，但属残留 OSS 配置，违反 DoD，且 §7-1 原 grep 清单抓不到）。 | `git grep oss_bucket_subprefix → config.py:732,751,963,994；唯一读取点 preview_proxy_service.py:518（位于待删 OSS 块内）` | **[已修复 v2]**：§3.2(D) 重写为精确行号清单，连带删除两个 `oss_bucket_subprefix` 字段定义与 `mp_oss_yaml`/`pp_oss_yaml` 解析；§7-1 静态扫描加入 `oss_bucket_subprefix`、`OSS_ENABLED`。 |
| P1-3 | **P1** | §8 R1 把 `oss_url` 下游消费方判定「留到实现期 grep」——一个可能破坏成片状态的删除被延后决策。评审期已可定论。 | 读 `video_composition_service.py:1429-1471`：`composition_update["oss_url"]`/`final_update["oss_url"]` 仅在 `oss_video_url` 真值时写入**进程内** `self.compositions[...]` 字典；全仓 `git grep -e oss_url -e ossUrl`（`app/` 与 `src/`）**无任何读取方**。 | **[已修复 v2]**：R1 由「待查」改判为「已核实可直接删除」，§3.2(C) 给出确定做法。 |
| P2-1 | P2 | `desktop/build/backend/`（如 `desktop/build/backend/app/config.py` 镜像了同样的 OSS 代码）是**被 `.gitignore` 忽略、0 个 git 跟踪文件**的构建产物，由桌面构建从 `backend-services/basic-service` 复制生成。 | `git ls-files desktop/build/ → 空；.gitignore:71 → desktop/build/` | 实现节**不要手改**该目录，亦不要提交；改完 `backend-services/basic-service` 源码后由桌面构建脚本重新生成即可。同理 `desktop/release/win-unpacked/resources/server`（只读参考根）亦为产物。已写入文末放行条件。 |
| P2-2 | P2 | `media_proxy_service.py` 的 OSS 仅存在于注释（行 10/17/18，「OSS upload follows when OSS_ENABLED=true」），无实际调用。 | `git grep -i oss app/services/media_proxy_service.py → 仅 10,17,18 注释` | §3.2(D) 已含「清理 media_proxy_service 注释」，本处把行号钉死，避免误判为有调用。 |
| P2-3 | P2 | 迁移 014 用裸 `op.drop_column`。PG 无碍；若未来有人在 SQLite(<3.35) 上跑该迁移会失败（SQLite 早期不支持 DROP COLUMN）。桌面/测试均走 `create_all` 不跑 alembic，故仅为防御性提示。 | 见 §3.2(E)、§6 | §6 迁移写法加注：upgrade/downgrade 用 `op.batch_alter_table` 以兼容 SQLite，PG 上等价。 |

> **未发现 P0**：方案的根基判断（桌面 OSS 恒关 → 删除即行为保持）与迁移编号、REST 兼容、本地预览代理保留（`preview_proxy.enabled` 默认 True，独立于 OSS 子块，见 `config.py:975`）均经核实成立，不存在阻断级缺陷。

---

## 1. 概述 / Overview

Ecliptrix 已经从「Next.js 15 前端 + FastAPI 后端」的网页项目，演进为一个**自包含的本地桌面应用**（Electron 外壳 + 内嵌 Python 后端 + Next.js standalone 前端 + 内置 ffmpeg，全部跑在 `127.0.0.1` 的本地端口上：前端 18320 / 后端 18321）。在这种形态下，用户在「视频编辑」里上传的各种素材（视频 / 音频 / 图片），其字节流通过本地 HTTP（前端 BFF 代理 → 本地 FastAPI）写入用户数据目录 `userData/storage`，**本身已经是本地保存**。但代码里仍保留了一条「额外上传到服务器」的链路——即 **阿里云 OSS（Object Storage Service）集成**：每次落盘后，若 `OSS_ENABLED=true`，文件会被再次上传到远端 OSS 桶并返回 CDN URL。这条链路是当年作为网页 / 云部署时，为了让远端浏览器能就近访问素材而设计的。

本需求要求：既然软件已改为本地桌面端、后续不再当作网页项目，「额外上传到服务器」的逻辑就不再需要，素材只需保存在本地即可，**应当把上传到服务器（OSS）的代码整体移除**。

关键判断（也是本方案能低风险落地的根基）：**桌面端 `OSS_ENABLED` 恒为 `false`**（见 `desktop/main/backendService.js` 注入的环境变量里并不开启 OSS），因此当前每一处 `if oss_client:` 分支在运行时**本来就不会进入**。这意味着「删除整条 OSS 链路」在功能上是**行为保持（behaviour-preserving）的死代码消除**：删除后所有上传、AI 生成媒体、TTS、合成视频、帧包/网格包、预览代理都将**只**返回本地 URL（`/api/storage/files/...`），与当前桌面端实际运行行为完全一致，不引入功能回归。本方案因此把范围定为「端到端移除 OSS 集成」，而非仅改造其中一个分支，避免留下半残的 `oss_client` 引用与死配置（符合 CLAUDE.md Clean Code「删除僵尸代码」「不制造孤岛」的要求）。

本方案聚焦用户明确关心的「视频编辑素材上传」主链路（`storage_service`）作为核心交付，同时一并清理其余复用了同一 `get_oss_client()` 的服务，使仓库中不再残留任何「上传到服务器」的代码。

---

## 2. 现状梳理 / Current State

### 2.1 素材上传主链路（用户关注点）

```
用户拖拽 / 选择文件
  └─ src/components/video/hooks/useMaterialManagement.ts
       processFileUpload() → uploadSingleFile()
         ├─ 视频:  POST /api/storage/upload-video   (FormData: file, task_id, generate_thumbnail, user_id)
         └─ 音/图: POST /api/storage/upload-file    (FormData: file, task_id, user_id)
  └─ Next.js BFF 代理 (src/app/api/storage/upload-{file,video}/route.ts)
       → backendConfig.joinPath() → BACKEND_URL/api/storage/upload-{file,video}
  └─ FastAPI: app/routers/storage_router.py  (鉴权 + 文件名净化 + MIME 校验)
       → app/services/storage_service.py
            1) aiofiles 写入本地 STORAGE_ROOT (userData/storage)   ← 本地保存（保留）
            2) if get_oss_client(): 上传到 OSS，返回 CDN URL        ← 「额外上传到服务器」（移除）
            3) 返回 file_url（本地或 OSS）
```

落盘文件经 `GET /api/storage/files/{path}`（鉴权 + 归属校验路由，非 StaticFiles）回放；前端 `selectPlaybackUrl()` 用多级优先级在预览 / 导出之间挑选 URL，其中 **P2 级**专门回退到 OSS 预览代理（`previewProxyOssUrl`）。

### 2.2 OSS（「服务器上传」）代码分布

`get_oss_client()` 来自 `app/services/oss_client.py`（`OSSClient` 封装 `oss2` SDK；`OSS_ENABLED=false` 时返回 `None`）。调用方遍布如下服务（均为 `if oss_client: 上传/删除远端对象` 形态）：

| 文件 | OSS 用途 | 关键行 |
|---|---|---|
| `app/services/storage_service.py` | 素材上传 + 视频缩略图上传（**核心**） | 22, 449–460, 587–595 |
| `app/services/ark_video_service.py` | ARK 生成视频 + 缩略图上传 | 18, 229–300 |
| `app/services/ark_image_service.py` | ARK / Seedream 生成图上传 | 43, 289–300, 379–420 |
| `app/services/tts_service.py` | TTS 音频上传 | 22, 812–818 |
| `app/services/video_composition_service.py` | 合成成片上传 + `oss_url` 字段 | 32, 1431–1470 |
| `app/services/storyboard_service.py` | 故事板成片/封面上传 + OSS 前缀删除 | 54, 1186–1199, 1730–1739, 2023–2105, 2276–2284 |
| `app/services/frame_pack_service.py` | 帧包 OSS 对象清理 | 38, 373–440 |
| `app/services/grid_pack_service.py` | 网格包 OSS 对象清理 | 563–577（函数内 import） |
| `app/services/preview_proxy_service.py` | 预览代理转码后镜像到 OSS + 写 `preview_proxy_oss_url` | 57, 514–533 |

配置与数据层：

| 位置 | 内容 |
|---|---|
| `app/config.py` | `OSSConfig` 类（315–330）；`Settings.oss` 字段（580）；`OSSConfig(...)` 构造（999–1008）；预览代理 OSS 子配置解析 `pp_oss_yaml`（~990–996） |
| `backend-services/basic-service/env.template` | OSS_* 段（84–97） |
| `config/preview-proxy-config.yaml` / `config/media-proxy-config.yaml` | `enabled_via: "OSS_ENABLED"` 及 OSS 子配置（46 / 35） |
| `app/models/db_models.py` | `cached_materials.preview_proxy_oss_url` 列（149） |
| `alembic/versions/011_add_preview_proxy_fields.py` | 该列的建表迁移（13, 56, 95） |
| `app/routers/material_router.py` | ingest/lookup 响应字段 `preview_proxy_oss_url`（57, 189） |

前端 OSS URL 残留：

| 文件 | 内容 | 行 |
|---|---|---|
| `src/types/index.ts` | `MaterialItem.previewProxyOssUrl?` | 550 |
| `src/components/video/lib/selectPlaybackUrl.ts` | P2 OSS 分支 + 接口字段 + 文档 | 10, 53, 107–108 |
| `src/components/video/lib/resolveSequencePlaybackUrl.ts` | OSS URL 比较 | 137 |
| `src/components/video/hooks/useRemoteMaterialPrefetch.ts` | 把后端 `preview_proxy_oss_url` 灌进 patch | 152 |
| `src/components/video/timeline/domain/ports.ts` | DTO 字段 `preview_proxy_oss_url` | 140 |
| 测试 | `selectPlaybackUrl.previewProxy.test.ts`、`resolveSequencePlaybackUrl.test.ts` | — |

> **不在本需求范围内但需保留**：`media_proxy_service` / `preview_proxy_service` 的**本地**热缓存与本地转码能力（这是给本地播放用的，与 OSS 无关），仅移除其中「镜像到 OSS」的那一小段。`ops/` 下的部署脚本属于已废弃的网页部署工具，不在本次代码改动范围（仅在风险节提示）。

---

## 3. 技术设计 / Technical Design

### 3.1 设计原则

1. **行为保持**：因桌面端 OSS 恒关，删除所有 `if oss_client:` 分支等价于「永远走 else（本地）分支」，运行时行为不变。
2. **端到端清理**：删除 `oss_client.py` 模块本身，使任何遗留引用在导入期即报错——这是确保「无残留」的强校验手段（实现期 `python -c "import app.main"` 必须通过）。
3. **最小改动**：每个调用点只做「折叠分支 / 删除镜像段」，不顺手重构无关逻辑，不改动公开 REST 路径与既有本地存储目录结构。
4. **统一返回本地 URL**：所有服务的产物 URL 一律为 `self._get_file_url(relative_path)` 形态（即 `/api/storage/files/...` 同源相对路径），由现有 `storage_files_router` 鉴权回放。

### 3.2 关键代码改造（按文件，供下游逐行实现）

**(A) 删除模块**
- `app/services/oss_client.py` → **整文件删除**（`OSSClient`、`get_oss_client`、`_oss_client` 单例）。

**(B) `app/services/storage_service.py`（核心：素材上传）**
- 删除 `from app.services.oss_client import get_oss_client`（22）。
- `upload_file()` 449–460：将「先本地 URL，再 try OSS 覆盖」整段折叠为：
  ```python
  file_url = self._get_file_url(relative_path)
  ```
  （删除 `oss_client = get_oss_client()` 与 `if oss_client: ... try upload_file ... except ...`）。
- `upload_video_file()` 587–595：删除缩略图的 OSS 上传段，`thumbnail_url` 保持为本地 URL。

**(C) 其余服务：统一「折叠到本地分支」**
对 `ark_video_service.py`、`ark_image_service.py`、`tts_service.py`、`video_composition_service.py`、`storyboard_service.py`、`preview_proxy_service.py`：
- 删除 `oss_client` 相关 import；
- 删除 `oss_client = get_oss_client()` 与其 `if oss_client:` 上传块，使产物 URL 保持为本地路径；
- `video_composition_service.py`：删除 `oss_video_url` 局部变量与其 OSS 上传段（1429–1440），并删除 `composition_update["oss_url"]` / `final_update["oss_url"]` 两处条件赋值（1451–1452, 1469–1470）。**[P1-3 已核实 v2]**：这两处仅在 `oss_video_url` 为真值时写入**进程内** `self.compositions[composition_id]` 状态字典，桌面端 `oss_video_url` 恒为 `None` 故从不写入；且全仓（后端 `app/` 与前端 `src/`）`git grep -e "oss_url" -e "ossUrl"` **无任何读取方**，因此可直接删除，无 KeyError 风险（原 R1 的「实现期再查」前置条件已消解）；
- `preview_proxy_service.py` 514–533：删除 OSS 镜像段与 `row.preview_proxy_oss_url = oss_url` 赋值，仅保留本地 `preview_proxy_local_url`。

对「OSS 对象清理」类（`frame_pack_service.py` 373–440、`grid_pack_service.py` 563–577、`storyboard_service.py` 的 `_oss_delete_prefix` 2276–2284 及其调用 2023–2105）：
- 删除 OSS 删除前缀逻辑及 `_oss_delete_prefix` 辅助函数，仅保留本地文件/目录清理。

**(D) 配置层** — **[P1-2 已扩充 v2，行号以现网源码核实]**
- `app/config.py`（精确清单，缺一不可）：
  - 删除 `OSSConfig` 类（315–330）、`Settings.oss` 字段（580）、`oss_config = OSSConfig(...)` 构造及其传入 `Settings(...)` 的位置（999–1008）。
  - **预览代理侧**：删除 `pp_oss_yaml = (... .get("oss", {}) or {})` 解析（**970**）与 `PreviewProxyConfig(...)` 内 `oss_bucket_subprefix=...` 填充（**994–996**）。
  - **媒体代理侧（v1 遗漏，本次补入）**：删除 `mp_oss_yaml = (... .get("oss", {}) or {})` 解析（**942**）与 `MediaProxyConfig(...)` 内 `oss_bucket_subprefix=...` 填充（**963–965**）。
  - **两个模型字段定义一并删除**：`MediaProxyConfig.oss_bucket_subprefix`（**732**）、`PreviewProxyConfig.oss_bucket_subprefix`（**751**）。删除前确认唯一读取点是 `preview_proxy_service.py:518`，而该行位于 §3.2(C) 待删的 OSS 镜像块内，删块后无悬挂引用。保留预览/媒体代理的全部本地参数（`enabled`、`max_concurrent_transcode`、`hot_cache_dir` 等）不动。
- `backend-services/basic-service/env.template`：删除 OSS_* 段（**85–92**，含其上方注释行 85–88）。
- `config/preview-proxy-config.yaml`、`config/media-proxy-config.yaml`：删除文件末尾的 `oss:` 子块（含 `enabled_via: "OSS_ENABLED"`、`bucket_subprefix`）。**注意**：两个 yaml 的本地代理开关是各自独立的 `preview_proxy.enabled` / `proxy.*`（默认启用，见 `config.py:975`），与 `oss:` 子块**无依赖**，删 OSS 块不会关闭本地代理（佐证 §8 R3）。
- `media_proxy_service.py`：仅清理 OSS 措辞注释（**行 10/17/18**「OSS upload follows when OSS_ENABLED=true」之类），无实际调用。`app/main.py`：若有 OSS 注释/文档串一并清理。

**(E) 数据模型与迁移**
- `app/models/db_models.py` 149：删除 `preview_proxy_oss_url` 列定义。
- `app/routers/material_router.py`：删除响应模型字段 `preview_proxy_oss_url`（57）与其填充（189）。
- 新增迁移 `alembic/versions/014_drop_preview_proxy_oss_url.py`：`op.drop_column("cached_materials", "preview_proxy_oss_url")`；`downgrade` 重新 `add_column`（对照 011）。
- **桌面 SQLite 现实说明**：桌面端用 `Base.metadata.create_all()` 建表、**不跑 alembic**。删除模型列后，全新桌面库自然不含该列；已有桌面库会残留一个**未被映射、永远为 NULL 的物理列**（create_all 不会 DROP），SQLAlchemy 只 SELECT 已映射列，故无害。迁移 014 仅服务于历史 PG 环境的对齐。

**(F) 前端 OSS URL 清理**
- `src/types/index.ts` 550：删除 `previewProxyOssUrl?`。
- `src/components/video/lib/selectPlaybackUrl.ts`：删除接口字段（53）、P2 分支（107–108）、文档行（10）。预览仍优先 P1（本地 480p 预览代理）→ P3（本地全量缓存）→ P4（同源 media-proxy）→ P5（origin）。
- `src/components/video/lib/resolveSequencePlaybackUrl.ts` 137：删除对 `material.previewProxyOssUrl` 的比较分支。
- `src/components/video/hooks/useRemoteMaterialPrefetch.ts` 152：删除 `patch.previewProxyOssUrl = ...`。
- `src/components/video/timeline/domain/ports.ts` 140：删除 DTO 字段 `preview_proxy_oss_url`。

**(G) 测试同步**
- `backend-services/basic-service/tests/test_ark_cache_writeback.py` 43：删除 `monkeypatch.setattr(ark_video_service, "get_oss_client", lambda: None)`（函数已不存在），改为断言产物为本地 URL。
- 前端 `selectPlaybackUrl.previewProxy.test.ts`（P2 用例）、`resolveSequencePlaybackUrl.test.ts`（含 OSS URL 的用例）：删除/改写为本地路径断言。
- 实现期对 `grep -ri "oss" tests/` 逐一核对，移除/改写依赖 OSS 的断言。

**(H) 文档（由实现节 #2 顺带更新，本节仅登记）**
- `CLAUDE.md`：移除「External API Integrations」表中 Alibaba Cloud OSS 行、「Storage」段「Optional: Alibaba Cloud OSS」描述。
- `README.md` / `README.zh-CN.md`：如有 OSS 字样一并清理。
- `.claude-index/index.md`：通过「regenerate index」刷新，不手工编辑。
- `desktop/scripts/prepare-env.js` 与生成的 `env.template.desktop`：核对并移除可能写入的 OSS_* 键。

**(I) 依赖清理** — **[P1-1 新增 v2]**
- `backend-services/basic-service/requirements.txt`：删除 `oss2>=2.18.0`（第 **59** 行）。删除 `oss_client.py` 与各服务内 `import oss2` 后，该依赖已无任何导入方；保留它即残留「上传到服务器」的配置面，违反 DoD。删除后 `pip install -r requirements.txt` 不再拉取 `oss2`。

**(J) 构建产物边界（勿改）** — **[P2-1 提示 v2]**
- `desktop/build/backend/`（含 `app/config.py` 等）与 `desktop/release/win-unpacked/resources/server` 是**被 `.gitignore` 忽略、git 不跟踪**的构建产物，由桌面构建从 `backend-services/basic-service` 复制生成。**实现节只改源码树 `backend-services/basic-service` 与 `src/`，不要手改、不要 `git add` 这些产物目录**；重新构建桌面包时会自动同步。

### 3.3 操作时序（改造后素材上传）

```
拖拽文件 → useMaterialManagement.uploadSingleFile()
  → POST /api/storage/upload-{file,video}  (BFF 代理)
  → storage_router  (鉴权/净化/MIME 校验)
  → storage_service.upload_*()
       aiofiles 写入 userData/storage/...        (唯一一次落盘，本地)
       file_url = self._get_file_url(relative_path)   (恒本地，无 OSS 分支)
       (视频) ffprobe 取时长/宽高 + ffmpeg 出本地缩略图
       return { success, file_url, thumbnail_url, duration, width, height, ... }
  → 前端 MaterialItem.url/serverUrl = file_url (同源 /api/storage/files/...)
  → 预览 selectPlaybackUrl(preview): P1/P3/P4/P5（无 P2 OSS）
  → 导出 selectPlaybackUrl(export): serverUrl||url（本地路径）
```

---

## 4. 文件 / 模块变更计划 / File & Module Change Plan

| # | 文件 | 动作 | 一句话意图 |
|---|---|---|---|
| 1 | `backend-services/basic-service/app/services/oss_client.py` | 删除 | 移除 OSS SDK 封装与 `get_oss_client()` 单例 |
| 2 | `.../app/services/storage_service.py` | 修改 | 素材/缩略图上传去掉 OSS 分支，恒返回本地 URL |
| 3 | `.../app/services/ark_video_service.py` | 修改 | ARK 视频/缩略图改为本地 URL |
| 4 | `.../app/services/ark_image_service.py` | 修改 | ARK/Seedream 图改为本地 URL |
| 5 | `.../app/services/tts_service.py` | 修改 | TTS 音频改为本地 URL |
| 6 | `.../app/services/video_composition_service.py` | 修改 | 成片去 OSS 上传与 `oss_url` 字段 |
| 7 | `.../app/services/storyboard_service.py` | 修改 | 故事板成片/封面去 OSS 上传与 OSS 前缀删除 |
| 8 | `.../app/services/frame_pack_service.py` | 修改 | 帧包仅本地清理，去 OSS 对象删除 |
| 9 | `.../app/services/grid_pack_service.py` | 修改 | 网格包仅本地清理，去 OSS 对象删除 |
| 10 | `.../app/services/preview_proxy_service.py` | 修改 | 预览代理仅产本地 URL，去 OSS 镜像 |
| 11 | `.../app/config.py` | 修改 | 删除 `OSSConfig`、`Settings.oss`、OSS 构造与 OSS 子配置解析 |
| 12 | `.../env.template` | 修改 | 删除 OSS_* 配置段 |
| 13 | `.../config/preview-proxy-config.yaml` | 修改 | 删除 OSS 子块，保留本地转码参数 |
| 14 | `.../config/media-proxy-config.yaml` | 修改 | 删除 OSS 子块，保留本地缓存参数 |
| 15 | `.../app/models/db_models.py` | 修改 | 删除 `cached_materials.preview_proxy_oss_url` 列 |
| 16 | `.../app/routers/material_router.py` | 修改 | ingest/lookup 响应去 `preview_proxy_oss_url` |
| 17 | `.../alembic/versions/014_drop_preview_proxy_oss_url.py` | 新建 | 历史 PG 库删除该列（downgrade 可回退） |
| 18 | `src/types/index.ts` | 修改 | `MaterialItem` 去 `previewProxyOssUrl` |
| 19 | `src/components/video/lib/selectPlaybackUrl.ts` | 修改 | 删除 P2 OSS 回退分支与字段/文档 |
| 20 | `src/components/video/lib/resolveSequencePlaybackUrl.ts` | 修改 | 删除 OSS URL 比较分支 |
| 21 | `src/components/video/hooks/useRemoteMaterialPrefetch.ts` | 修改 | 不再回填 OSS URL |
| 22 | `src/components/video/timeline/domain/ports.ts` | 修改 | DTO 去 `preview_proxy_oss_url` |
| 23 | `.../tests/test_ark_cache_writeback.py` | 修改 | 去 `get_oss_client` monkeypatch，改本地 URL 断言 |
| 24 | `src/components/video/lib/__tests__/selectPlaybackUrl.previewProxy.test.ts` | 修改 | 删除/改写 P2 OSS 用例 |
| 25 | `src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts` | 修改 | 删除/改写 OSS URL 用例 |
| 26 | `CLAUDE.md` | 修改（实现节） | 去除 OSS 集成与「可选云存储」描述 |
| 27 | `README.md` / `README.zh-CN.md` | 修改（实现节） | 去除 OSS 字样（若有） |
| 28 | `desktop/scripts/prepare-env.js` | 核对/修改 | 移除桌面 env 模板可能写入的 OSS_* 键 |
| 29 | `backend-services/basic-service/requirements.txt` | 修改 | 删除 `oss2>=2.18.0` 依赖（**P1-1**） |

> 实现期请用 `git grep -nI -e "oss_client" -e "get_oss_client" -e "OSSConfig" -e "oss2" -e "oss_bucket_subprefix" -e "previewProxyOssUrl" -e "preview_proxy_oss_url" -e "OSS_ENABLED"` 做收尾扫描，确保表外无漏网点。
> **构建产物排除**（P2-1）：扫描命中应只来自 `backend-services/basic-service`、`src/`、`config/`、`docs/`；若命中出现在 `desktop/build/` 或 `desktop/release/` 属正常（产物，下次构建覆盖），不要手改。

---

## 5. 接口设计 / Interface Design

**REST 路径不变**（保证前端零改动即可工作）：

| 端点 | 方法 | 变化 |
|---|---|---|
| `/api/storage/upload-file` | POST | 无路径/参数变化；`file_url` 恒为本地 `/api/storage/files/...` |
| `/api/storage/upload-video` | POST | 同上；`thumbnail_url` 恒为本地 |
| `/api/storage/files/{path}` | GET | 不变（鉴权回放） |
| `/api/material/ingest` | POST | 响应去除 `preview_proxy_oss_url` 字段 |
| `/api/material/lookup` | GET | 响应去除 `preview_proxy_oss_url` 字段 |

**响应体差异**：
- `FileUploadResponse` / `VideoUploadResponse`：`file_url` / `video_url` / `thumbnail_url` 语义不变，但取值恒为本地路径（此前在 OSS 开启时才可能是 CDN URL）。
- `MaterialIngestResultEntry` / lookup 响应：删去 `preview_proxy_oss_url`（前端已不读取）。其余字段（`status`、`local_url`、`preview_proxy_local_url` 等）不变。

**前端函数签名不变**：`selectPlaybackUrl()` / `effectivePreviewUrl()` 签名与返回类型不变，仅内部优先级少一级（P2）。

---

## 6. 数据模型 / Data Model

`cached_materials` 表：删除一列。

| 列 | 类型 | 变化 |
|---|---|---|
| `preview_proxy_oss_url` | `String(1024)` nullable | **删除** |

其余列（`source`、`source_id`、`source_url`、`local_path`、`status`、`proxy_*` 本地热缓存、`preview_proxy_local_url`/`preview_proxy_status` 等）全部保留不变。

迁移 `014_drop_preview_proxy_oss_url.py`（**[P2-3 v2]** 用 `batch_alter_table` 以兼容 SQLite，PG 上等价于裸 DDL）：
- `upgrade()`：
  ```python
  with op.batch_alter_table("cached_materials") as batch:
      batch.drop_column("preview_proxy_oss_url")
  ```
- `downgrade()`：
  ```python
  with op.batch_alter_table("cached_materials") as batch:
      batch.add_column(sa.Column("preview_proxy_oss_url", sa.String(length=1024), nullable=True))
  ```
- 桌面 SQLite 不执行该迁移（用 create_all），已存在的库残留无害的 NULL 列，已在 §3.2(E) 说明；`batch_alter_table` 仅为保证「万一有人在 SQLite<3.35 上跑 alembic」也不报错。

---

## 7. 测试与验收 / Testing & Acceptance Criteria

**静态校验**
1. `git grep -nI -e "get_oss_client" -e "OSSClient" -e "OSSConfig" -e "oss2" -e "oss_bucket_subprefix" -e "previewProxyOssUrl" -e "preview_proxy_oss_url" -e "OSS_ENABLED"` 在 `app/`、`src/`、`config/`、`env.template`、`requirements.txt` 中**无实际代码命中**（仅允许本设计文档与 011 历史迁移内的文字；`desktop/build`、`desktop/release` 产物目录命中可忽略，见 §3.2(J)）。
2. 后端可导入：`python -c "import app.main"` 成功（验证无遗留 OSS import）。
3. 前端 `npm run type-check` 通过；`npm run lint` 无新增错误。

**后端单测**
4. `pytest tests/ -v` 全绿；重点 `test_ark_cache_writeback.py`、`test_storyboard_*`、`test_video_cover.py`、`test_frame_pack_router.py` 改写后通过。
5. 新增/沿用一条用例：调用 `storage_service.upload_file(...)` 返回的 `file_url` 以 `/api/storage/files/` 开头（断言本地化）。

**端到端（桌面）**
6. 启动桌面应用，在视频编辑里分别上传 视频 / 音频 / 图片：文件出现在 `userData/storage/...`，预览可播放，时间线可用，导出合成成功且成片落在本地。
7. AI 生成图 / 生成视频 / TTS / 故事板：产物 URL 均为本地，编辑器可即时预览。
8. `OSS_ENABLED` 这一开关被移除后，应用启动、上传、合成全流程无报错（对照改动前桌面行为一致）。

**验收标准（Definition of Done 对齐）**
- 仓库中不再存在「上传到服务器（OSS）」的代码与配置；
- 视频编辑素材仅本地保存并可正常预览 / 导出；
- 现有公开 REST 路径与本地目录结构未变，无功能回归。

---

## 8. 风险与缓解 / Risks & Mitigations

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | ~~`video_composition_service` 写入的 `oss_url` 可能被下游读取~~ **[评审已消解 v2]** | 无 | 评审期已核实：`oss_url` 仅写入进程内 `self.compositions[...]` 字典且仅在 OSS 真值时（桌面恒不进入），全仓 `app/`+`src/` 无任何 `oss_url`/`ossUrl` 读取方，可直接删除，不存在 KeyError/显示异常风险（详见 §3.2(C)、§0 P1-3）。 |
| R2 | 已存在的桌面 SQLite 库残留 `preview_proxy_oss_url` 物理列 | 理论脏列 | 列 nullable 且不再映射，SQLAlchemy 不 SELECT，无害；已在 §3.2(E) 文档化 |
| R3 | 误删 OSS 时连带删掉**本地**预览代理 / media-proxy 缓存逻辑 | 预览性能回退 / 播放失败 | 明确：仅删除「镜像到 OSS」段；本地转码与本地热缓存全部保留（§2.2 末注、§3.2(C)(D)） |
| R4 | 帧包 / 网格包 / 故事板的 OSS 前缀删除被移除后，远端遗留对象无人清理 | 远端 OSS 残留（仅历史 OSS 桶） | 桌面端从不向 OSS 写入，故无新增残留；历史桶清理属运维一次性动作，不在代码范围 |
| R5 | 范围蔓延：顺手重构 OSS 之外逻辑 | 引入额外回归、评审困难 | 严守「折叠分支 / 删镜像段」最小改动；不动公开接口与目录结构 |
| R6 | 测试里大量 `oss` 字样需逐一甄别（多为 `cross`/`loss` 等误命中） | 改错或漏改 | 用精确标识符（`get_oss_client`/`OSSClient`/`previewProxyOssUrl`）而非裸 `oss` 检索；逐条人工确认 |
| R7 | `config.py` 删除 `Settings.oss` 后，若别处 `settings.oss.xxx` 仍被引用 | 启动期 AttributeError | §7-2 的 `import app.main` + `get_settings()` 实例化作为闸门；并 grep `settings.oss`/`\.oss\.` |

---

## 9. 附：实现顺序建议（供 Subtask #2）

1. 先删模块 `oss_client.py` → 借「导入即报错」定位全部引用点（自顶向下编译驱动）。
2. 逐个服务折叠 `if oss_client:` 分支（先 `storage_service` 核心，再其余）。
3. 清 `config.py` / `env.template` / 两个 proxy yaml。
4. 删模型列 + 写迁移 014 + 改 `material_router` 响应。
5. 清前端 OSS URL 字段与 P2 分支。
6. 同步后端/前端测试，跑 `pytest` 与 `type-check`。
7. 跑 §7 静态扫描与桌面端到端验证。
8. 更新 `CLAUDE.md` / README，必要时「regenerate index」。

---

## 10. 评审结论 / Review Verdict

**结论：有条件通过（Approved with conditions）— v2**

方案根基判断（桌面端 OSS 恒关 → 整链路删除为行为保持的死代码消除）经核实成立，范围适度、迁移编号正确、REST 兼容、本地预览/媒体代理能力得以保留。评审发现的 **3 个 P1（依赖残留、config 媒体代理侧 OSS 子配置遗漏、R1 下游未决）已在本文档 v2 正文就地修复**，**无 P0、无遗留 P1**。

下列放行条件（均为 P2 级实现期约束）须在 Subtask #2 执行时遵守：

1. **只改源码树**：改动限定在 `backend-services/basic-service`、`src/`、`config/`、`docs/`；**不要手改或 `git add`** `desktop/build/`、`desktop/release/win-unpacked/resources/server` 等被 gitignore 的构建产物（P2-1 / §3.2(J)）。
2. **config.py 删除按 §3.2(D) 精确清单执行**：预览代理侧与媒体代理侧的 `*_oss_yaml` 解析、两个 `oss_bucket_subprefix` 填充与**两个模型字段定义**必须一并删除，勿只删预览侧（P1-2）。
3. **依赖同删**：`requirements.txt` 删除 `oss2>=2.18.0`（P1-1 / §3.2(I)）。
4. **迁移 014 用 `op.batch_alter_table`** 写 upgrade/downgrade，兼容 SQLite（P2-3 / §6）。
5. **收尾以 §7-1 增强版静态扫描为闸门**：扫描词新增 `oss2`、`oss_bucket_subprefix`、`OSS_ENABLED`；除本文档与 011 历史迁移、`desktop/build`·`desktop/release` 产物外，`app/`+`src/`+`config/`+`env.template`+`requirements.txt` 应零命中。
6. **导入闸门**：`python -c "import app.main"` 与 `get_settings()` 实例化必须通过（验证无悬挂 `settings.oss` / OSS import）。

满足上述条件即视为完全符合 DoD（仓库不再存在「上传到服务器（OSS）」的代码与配置、素材仅本地保存且可正常预览/导出、公开 REST 与本地目录结构不变）。

---

## 11. 实施过程发现的方案缺陷 / Issues Found During Implementation (Subtask #2)

实施时严格按 §4 文件变更计划逐项落地，**未发现阻断级设计缺陷**。以下为实现期的几处「计划未逐字枚举、但为删除 OSS 分支的必然连带项」的处置说明，记录以保证下游 Review 完全透明（均属 §3.1「最小改动」与 CLAUDE.md Clean Code「删除僵尸代码/注释」的直接后果，未扩大范围）：

1. **死变量连带清理**：删除 OSS 上传段后，仅服务于 OSS 的局部变量随之失去引用，一并删除以免留下 lint 噪音：
   - `ark_video_service.py`：`video_relative_path`（原仅用于 OSS 上传的相对路径）。
   - `storyboard_service.py` `cleanup_pack_storage` / `delete_pack`、`frame_pack_service.py` `delete_pack` / `cleanup_pack_storage` / 末帧删除、`grid_pack_service.py` `delete_pack`：仅用于拼 OSS 前缀的 `date_str`。
2. **TTS 结果字段语义对齐**：`tts_service.py` 返回体的 `storage_upload` / `local_only` 两键原引用 `oss_uploaded` 变量；删 OSS 后该变量不复存在，固定为 `storage_upload=False` / `local_only=True`（恒本地，语义不变，键名保留以兼容下游读取方）。
3. **两处过期注释更新**（§4 未列，但直接描述本次改动的清理流程）：`pack_ownership_service.py` 与 `video_project_service.py` 中「filesystem + OSS cleanup」措辞，因 OSS 清理已移除，改为「filesystem cleanup」。
4. **未改动项说明**：§4 第 27 行 README、第 28 行 `desktop/scripts/prepare-env.js` 经核对**不含任何 OSS 字样/键**（README 仅有合法的 LLM `dashscope.aliyuncs.com` 端点，与 OSS 无关），故无需改动。`silence_removal_service.py` 注释中以「OSS/CDN」举例描述 FFmpeg **读取**远端 URL 的能力（非上传），且不被 §7-1 精确标识符扫描命中，按最小改动保留。

**验证闸门结果**：`python -m py_compile`（全部 15+2 文件）通过；`get_settings()` 实例化通过且 `oss`/`oss_bucket_subprefix` 已不存在；`import app.main` 穿过全部被改服务（仅因本机环境缺失第三方依赖 cv2[损坏]/aiofiles/python-multipart 而无法走到最后，与本次改动无关）；§7-1 精确标识符静态扫描在 `app/`+`src/`+`config/`+`env.template`+`requirements.txt` **零命中**（alembic 仅 011 历史迁移与新增 014）；前端 `npm run type-check` 通过、相关 vitest 26/26 通过；后端 `test_ark_cache_writeback.py` 1 passed（已改为断言产物为本地 `/api/storage/files/...` URL）。

---

*本方案为 **v2**：v1 由 Subtask #0 撰写；Subtask #1 逐节对照真实源码评审，补入 §0「评审记录」、就地修复全部 P0/P1、并在本节给出评审结论；Subtask #2 实施后补入 §11「实施过程发现的方案缺陷」。*
