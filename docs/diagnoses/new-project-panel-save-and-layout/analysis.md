# 诊断报告：「新建项目」面板 — 保存失败 + 弹窗宽高比例丑

- **Bug slug**: `new-project-panel-save-and-layout`
- **分支**: `feat/remove-user-system`（移除用户系统的改动尚未提交，处于工作区）
- **诊断日期**: 2026-06-22
- **诊断者**: Subtask #0（问题定位与分析）
- **本节点不写修复代码、不执行 git commit。**

---

## 1. 问题描述（Problem description）

用户在「新建项目」面板反馈两个问题：

1. **Bug #1（功能）**：现在无法创建新项目，点击「创建」后弹出错误提示 **"保存项目失败"**。
2. **Bug #2（视觉）**：「新建项目」弹窗面板的**宽高比例太丑**，需要美观优雅、固定宽高比。

两个问题相互独立：Bug #1 是 `feat/remove-user-system` 引入的**升级回归**（功能 500），Bug #2 是一个**长期存在的 UI 质量问题**（与本次改动无关）。

---

## 2. 复现步骤（Reproduction steps）

### Bug #1 — 保存项目失败

前置条件（关键）：**这是一次"老库 → 新代码"的升级场景**，必须是一个**此前已被旧版本创建过的数据库**。

桌面端复现：

1. 用**旧版本**的 Ecliptrix 桌面应用启动一次（旧版 `VideoProject` 模型带 `user_id NOT NULL` 列），它会在 `%APPDATA%\Ecliptrix\data\ecliptrix.db` 生成 SQLite 库，建出带 `user_id` 列的 `video_projects` / `video_project_categories` 表。
2. 升级到**当前分支**（已移除用户系统，模型不再有 `user_id`）。因为 `deleteAppDataOnUninstall: false`（`desktop/electron-builder.yml:66`），旧的 `ecliptrix.db` 被保留。
3. 启动新应用 → 进入视频编辑 → 项目列表页（列表能正常加载）。
4. 点击「新建项目」→ 填写名称 → 点击「创建」。
5. **结果**：弹出红色提示 **"保存项目失败"**；浏览器/渲染进程控制台打印 `[VideoProjectListView] Create project failed`，后端返回 HTTP 500。

> 「新建分类」会因为完全相同的根因（`video_project_categories.user_id NOT NULL` 残留）同样失败。

#### 最小可复现脚本（已实际运行，证据见下）

随报告附带 `repro_user_id_not_null.py`（同目录），它不依赖完整后端/Postgres，纯 SQLite + SQLAlchemy 还原整条链路：

```bash
python docs/diagnoses/new-project-panel-save-and-layout/repro_user_id_not_null.py
```

实际输出：

```
columns after create_all: ['id', 'user_id', 'category_id', 'name', 'description', 'cover_url', 'project_data', 'created_at', 'updated_at', 'last_opened_at']
-> create_all did NOT drop the stale 'user_id' column (as expected)

INSERT failed with IntegrityError (bug reproduced):
    NOT NULL constraint failed: video_projects.user_id
```

脚本证明了两件事：(a) `create_all` 不会修改已存在的表（`user_id` 残留）；(b) 新模型按"无 user_id"插入 → 触发 `NOT NULL constraint failed: video_projects.user_id`。

> **为什么全新安装不复现 / CI 也测不到**：全新库由 `create_all` 按新模型建表，不含 `user_id`，插入正常。桌面冒烟测试每次都用临时空 `userData`（`desktop/scripts/smoke-test.js:90-91` `mkdtempSync` + 空 `.env`），永远是全新库，因此从不触发本回归。

### Bug #2 — 弹窗宽高比例丑

1. 进入项目列表页 → 点击「新建项目」。
2. 观察弹窗：宽度由内容撑开而非稳定值，竖向偏长、比例失衡；窗口高度较小时表单会溢出且无内部滚动。

---

## 3. 根因分析（Root cause analysis，含证据）

### 3.1 Bug #1 根因：移除用户系统后，桌面端旧库的 `user_id NOT NULL` 残留列与新模型冲突

**链路自上而下都正常，唯独最底层 INSERT 撞到了残留的 NOT NULL 列。**

**(1) 前端：创建失败即弹 "保存项目失败"**

`src/components/video/projects/VideoProjectListView.tsx:169-183`：

```ts
const handleCreateProject = async (values: ProjectFormValues) => {
  try {
    const created = await createVideoProject({ ... });   // POST /api/video-projects
    ...
  } catch (err) {
    console.error('[VideoProjectListView] Create project failed', err);
    showError(t.videoProjects.saveError);                // → "保存项目失败"
  }
};
```

`t.videoProjects.saveError === '保存项目失败'`（`src/lib/i18n.ts:5048`）。

**(2) HTTP 层：后端 500 会被抛成异常**

`createVideoProject` 走 `http.post`（`src/lib/api/videoProjects.ts:144-152`）。`http-client` 对 5xx 抛 `ApiError`（`src/lib/api/http-client.ts:423-439`）。BFF 代理把后端的 JSON 500 原样透传、状态码保留（`src/lib/api/server/backend-proxy.ts:337-342`）。因此后端 500 → 前端 `catch` → "保存项目失败"。**前端、代理、HTTP 层都没问题，错误来自后端。**

**(3) 后端：服务层按"无 user_id"插入**

工作区 `app/services/video_project_service.py:362-381`：

```python
async def create_project(self, db, payload):
    project = VideoProject(
        name=payload.name.strip(),
        description=payload.description,
        category_id=_as_uuid(payload.category_id),
        cover_url=payload.cover_url,
        project_data=payload.project_data or {},
    )
    db.add(project)
    await db.flush()      # ← 这里触发 INSERT
    ...
```

工作区模型 `app/models/db_models.py:138-164` 的 `VideoProject` **已无 `user_id`**（全部列：id / category_id / name / description / cover_url / project_data / created_at / updated_at / last_opened_at）。

`get_db_session` 在异常时 `rollback()` 后**重新抛出**（`app/database.py:89-97`），FastAPI 全局异常处理把它变成 500。

**(4) 数据库：旧库仍带 `user_id NOT NULL`，且 `create_all` 不会改它**

- 已提交版（HEAD）的模型里，`VideoProject` / `VideoProjectCategory` 都有
  `user_id = Column(String(36), nullable=False, index=True)`（`git show HEAD:.../db_models.py` 第 169 / 194 行）。旧桌面构建建出的表就带这一列。
- 启动只调用 `init_db()` → `Base.metadata.create_all`（`app/database.py:100-118`、`app/main.py:112-126`）。`create_all` **只建不存在的表，从不 ALTER 已存在的表、从不删列**。
  - 旁证：同文件 `database.py:113-116` 专门为"已存在表加列"写了一段 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS api_format`，正是因为 `create_all` 不会补列——反向也成立，它同样不会删列。
- 于是旧库的 `video_projects.user_id NOT NULL` 一直在，新模型 INSERT 不带它 → **`IntegrityError: NOT NULL constraint failed: video_projects.user_id`**（见第 2 节复现脚本实跑输出）。

**(5) 本该修复它的迁移 015 在桌面端根本不会执行**

- `alembic/versions/015_drop_user_system.py` 会正确地从四张业务表删 `user_id` 并删 `users`/`login_history`。
- 但桌面打包**故意不包含 `alembic/`、完全依赖 `create_all`**：
  `desktop/scripts/prepare-backend.js:15-16` —
  *"venv/, tests/, alembic/ (desktop relies on create_all, spec §2.4) ... stay out by omission"*；
  `desktop/main/backendService.js:65` — *"Cold start does create_all + settings seeding"*。
- 因此桌面端永远跑不到迁移 015，残留列无人清理。（开发态 Postgres 若手动跑过 `alembic upgrade head`（`install.sh:447-448`）则不受影响；只有"老库 + 没跑迁移"才会中招——桌面端正是这种情况。）
- **（评审补证）需区分"`alembic/` 目录"与"`alembic` 包"**：打包只排除了 `alembic/`**项目目录**（迁移脚本 + `env.py`），但 `alembic>=1.13.0` 是后端运行时依赖（`backend-services/basic-service/requirements.txt:56`），由 `desktop/scripts/prepare-backend.js:118-121` 的 `pip install -r requirements.txt` 装进 `Lib/site-packages`。也就是说**桌面运行时仍可 `import alembic`/`alembic.operations`**——这正是「把迁移 015 的 `batch_alter_table` 逻辑搬进 `app` 运行时」在桌面端可行的前提（见 §6 与评审结论中的实现注意事项）。

**(6) 数据持久、跨升级保留 → 升级用户必中**

桌面 SQLite 固定在 `userData/data/ecliptrix.db`（`desktop/README.md:15-17`），`deleteAppDataOnUninstall: false`（`electron-builder.yml:66`），升级/重装都保留旧库。所以**任何用过旧版本的用户升级后都会命中此 Bug**。

> **排除项**：工作区已无任何对已删除模块（auth/user/session 等）的残留 import（在 `backend-services/basic-service/app` 全量搜索 `auth_service|user_service|session_service|user_models|auth_models|dependencies.auth|require_admin|get_current_user` 等 = 0 命中）。因此后端能正常启动，**不是"后端启动崩溃导致全部接口失败"**——这也与"列表能加载、仅创建失败"的现象一致。

### 3.2 Bug #2 根因：弹窗宽高交给了内层 `<form>`，而真正被居中的 flex 项（`Modal` 的 `contentClassName`）没有任何尺寸

`Modal` 把尺寸类透传给真正被居中的对话框元素 `contentClassName`：
`src/components/ui/Modal.tsx:67-84`（外层 `fixed inset-0 flex items-center justify-center p-4`，内层 `<div role="dialog" className={contentClassName}>`）。

但 `ProjectFormDialog` **没有传 `contentClassName`**，而是把宽度写在内层 `<form>` 上：
`src/components/video/projects/ProjectFormDialog.tsx:62-66`：

```tsx
<Modal isOpen={isOpen} onClose={onCancel} labelledBy="project-form-title">
  <form className="bg-card rounded-md shadow-xl border border-border w-full max-w-md">
```

问题：被居中的 flex 项（`role="dialog"` 的 div）`className` 是 `undefined`，宽度为 `auto`、随内容收缩；表单的 `w-full`（100%）于是是相对一个"收缩包裹自身"的父级求值，**宽度由内容内在宽度决定，而非稳定的 `max-w-md`(448px)**，比例不稳。并且整条链路**没有 `max-height` 与内部滚动**，窗口偏矮时竖向较长的表单（标题 + 名称 + 简介 textarea + 分类下拉 + 底部按钮）会溢出。`CategoryFormDialog`（`:51-55`，`w-full max-w-sm`）有同样的写法问题。

**对照：项目里其它对话框都把尺寸放在 `contentClassName`（正确做法）**：

- `src/components/video/components/VideoUnderstandingModePlaceholderModal.tsx:32` → `contentClassName="w-full max-w-md overflow-hidden rounded-md border border-border bg-card shadow-xl"`
- `src/components/video/components/NarrationDirectScriptModal/NarrationDirectScriptModal.tsx:59` → `contentClassName="flex h-[88vh] max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden ..."`
- `src/components/Onboarding/SetupGuideDialog.tsx:51` → `contentClassName="max-w-lg w-[92vw] rounded-2xl ... p-8"`

可见"宽高写在 `contentClassName` 上、并带 `max-h`/`overflow`"是既有约定，`ProjectFormDialog` / `CategoryFormDialog` 偏离了它，这就是观感失衡的来源。

---

## 4. 影响面（Impact surface）

| 区域 | 影响 |
|---|---|
| **Bug #1** | 所有**从旧版本升级**且保留了 `userData/data/ecliptrix.db` 的桌面用户：**无法新建项目、无法新建分类**（同一残留列）。开发态若用了未跑迁移 015 的老 Postgres 库同样中招。从 Workflow 标签页 handoff 自动建项目的路径（`VideoProjectListView.tsx:145-156`）也会失败。全新安装/全新库不受影响。 |
| **Bug #2** | 所有用户：「新建项目」「新建分类」「重命名」弹窗观感（宽度不稳、比例失衡、矮窗溢出）。纯视觉，不阻断功能。 |

---

## 5. 候选修复方案（Candidate fixes）

### 5.1 Bug #1（保存失败）

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 数据安全 |
|---|---|---|---|---|---|
| **A（推荐）启动期幂等"清残列"** | 在 `init_db()` 内 `create_all` 之后，用 SQLAlchemy inspector 检测四张业务表是否还存在 `user_id`，存在则用 `batch_alter_table(recreate="always")` 删列+删相关索引（把迁移 015 的逻辑搬进 `app` 代码，因为桌面不带 `alembic/`）。可顺带 drop 残留的 `users`/`login_history`。仿照 `database.py:113-116` 既有"启动期 DDL 自愈"先例。 | 低（只动 `database.py`） | 低（inspector 守卫 → 幂等；只在检测到残列时动作；保留所有项目数据） | 小~中 | ✅ 不丢项目 |
| **B 桌面端打包 `alembic/` 并启动跑 `upgrade head`** | 改 `prepare-backend.js` 纳入 `alembic/`，启动执行迁移（迁移 015 现成且经测试）。 | 中（改打包+启动） | 中（包体变大、冷启动变慢；`create_all`(新库已建表) 与 alembic 版本戳易错位，需处理 stamp） | 中 | ✅ 不丢项目 |
| **C 整库重置（全新开始）** | 检测到旧 schema 直接删库重建（迁移 015 的 `downgrade` 也声明这是"一次性破坏性重置"）。 | 低 | 高（**丢失用户已有项目**） | 小 | ❌ 丢项目 |

### 5.2 Bug #2（弹窗比例）

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A（推荐）尺寸归位到 `contentClassName`** | 给 `Modal` 传 `contentClassName="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-md border border-border bg-card shadow-xl"`，内层 `<form>` 去掉自带的 `bg-card/border/shadow/max-w`、仅留布局；微调 padding/间距让纵向节奏更匀。与既有约定一致（见 §3.2 对照）。同样修 `CategoryFormDialog`。 | 低 | 低 | 小 |
| **B 字面"固定宽高比"** | 固定宽度 + `aspect-[4/3]`（或 1/1）+ 内部滚动。 | 低 | 中（表单内容高度可变，硬比例易显空旷或拥挤/溢出） | 小 |
| **C 抽公共 Dialog 外壳** | 把两个表单弹窗收敛到统一带尺寸/滚动的壳组件，按设计令牌统一。 | 中 | 低 | 中 |

---

## 6. 推荐方案（Recommended fix）

### Bug #1 → **方案 A：在 `init_db()` 中加幂等的"清残列"自愈步骤**

理由：

1. **直击根因**：残留的 `user_id NOT NULL` 列才是 500 的源头，删掉它即彻底解决。
2. **桌面端唯一可行的自愈路径**：桌面**不带 `alembic/`、只跑 `create_all`**（`prepare-backend.js:15-16`、`backendService.js:65`），所以修复必须落在 `app` 运行时代码里，不能依赖迁移 015。
3. **有现成先例可仿**：`database.py:113-116` 已经在启动期对"已存在表"做过幂等 DDL（`ADD COLUMN IF NOT EXISTS`），本方案是其"删列"对偶，风格一致。
4. **保留用户项目数据**（相对方案 C）、**不增包体/不改打包/无 alembic 戳错位风险**（相对方案 B）。

实现要点（交给 Subtask #2）：
- 仅当 inspector 探测到列存在时才动作 → 幂等，可反复启动安全；
- 复用迁移 015 的 `batch_alter_table(recreate="always")` + 先删引用 `user_id` 的索引再删列，兼容老版本 SQLite 无原生 `DROP COLUMN` 的情况，PostgreSQL 上自动降级为普通 `ALTER TABLE`；
- 覆盖四张表：`video_projects`、`video_project_categories`、`storyboard_packs`、`project_covers`（均带残留 `user_id`），并 drop 残留的 `users`/`login_history`（先子后父）；
- 按 CLAUDE.md「修 bug 先写复现测试」：可把本目录 `repro_user_id_not_null.py` 的思路落成一个 pytest（旧 schema 库 → 跑自愈 → 断言 `user_id` 消失且能插入）。

### Bug #2 → **方案 A：把宽高/滚动归位到 `contentClassName`，并微调内距**

理由：与项目内其它弹窗（`VideoUnderstandingModePlaceholderModal` / `NarrationDirectScriptModal` / `SetupGuideDialog`）的既定约定一致、风险最低、即可获得稳定宽度 + 矮窗滚动 + 匀称比例。若用户坚持"字面固定宽高比"，可在方案 A 基础上叠加一个稳定宽度 + 协调内距来呈现一致比例，而非用硬 `aspect-ratio` 去对抗可变的表单高度（后者易拥挤/溢出，作为次选并注明取舍）。

---

## 7. 关键证据索引（File:line）

**Bug #1**
- 前端创建失败→提示：`src/components/video/projects/VideoProjectListView.tsx:169-183`
- 文案 saveError：`src/lib/i18n.ts:5048`
- API client：`src/lib/api/videoProjects.ts:144-152`
- HTTP 层对 5xx 抛错：`src/lib/api/http-client.ts:423-439`
- BFF 透传后端状态码：`src/lib/api/server/backend-proxy.ts:337-342`
- 后端服务 create_project（无 user_id）：`app/services/video_project_service.py:362-381`
- 工作区模型（无 user_id）：`app/models/db_models.py:138-164`
- 已提交模型（user_id NOT NULL）：`git show HEAD:backend-services/basic-service/app/models/db_models.py` 第 169 / 194 行
- 启动只 create_all + 同文件 ALTER 先例：`app/database.py:100-118`（先例 `:113-116`）
- 会话异常重抛：`app/database.py:89-97`；启动 lifespan：`app/main.py:112-126`
- 迁移 015（本应删 user_id）：`alembic/versions/015_drop_user_system.py`
- 桌面不带 alembic、只 create_all：`desktop/scripts/prepare-backend.js:15-16`、`desktop/main/backendService.js:65`
- 桌面 SQLite 持久路径：`desktop/README.md:15-17`；`desktop/electron-builder.yml:66`
- 冒烟测试用全新空库（故漏测）：`desktop/scripts/smoke-test.js:90-91, 150`
- 复现脚本与实跑输出：`docs/diagnoses/new-project-panel-save-and-layout/repro_user_id_not_null.py`（§2）

**Bug #2**
- Modal 把尺寸交给 contentClassName：`src/components/ui/Modal.tsx:67-84`
- ProjectFormDialog 未传 contentClassName、宽度写在 form：`src/components/video/projects/ProjectFormDialog.tsx:62-66`
- CategoryFormDialog 同样问题：`src/components/video/projects/CategoryFormDialog.tsx:51-55`
- 正确约定对照：`VideoUnderstandingModePlaceholderModal.tsx:32`、`NarrationDirectScriptModal.tsx:59`、`SetupGuideDialog.tsx:51`

---

## 评审结论（Review Verdict）

> 评审者：Subtask #1（分析报告评审与修复）。下述每条根因与方案均经**独立复核源码**（非仅信任原报告引用），不一致或证据不足处已在上文就地补证（见 §3.1 第 (5) 条的"评审补证"）。本节给出**最终推荐方案 + 理由 + 交给 Subtask #2 必须处理的边界**。

### A. 证据链审计结论（逐条复核）

**Bug #1（保存失败）——根因成立，证据链闭环。** 复核要点：

1. **失败路径确为最底层 INSERT 撞残留 NOT NULL 列**：复核 `git show HEAD:.../db_models.py` 确认旧模型 `VideoProject`/`VideoProjectCategory`/`StoryboardPackOwnership` 均带 `user_id = Column(String(36), nullable=False, index=True)`（第 169 / 194 行附近），而工作区模型（`db_models.py:138-164` 等）已无该列。**关键反例排除**：旧表列集恰为「新表列 ∪ {user_id}」（严格超集），故新模型 INSERT 写入的列在旧表中全部存在，唯一冲突就是旧表多出的 `user_id NOT NULL` 无默认值 → 触发的确是 `NOT NULL constraint failed`，**不是**被掩盖的 `no such column`。报告的"列表能加载、仅创建失败"现象与此一致（SELECT 不写 user_id 故正常）。
2. **`create_all` 不删列**：复核 `database.py:100-118`，启动仅 `Base.metadata.create_all`（对已存在表只跳过、不 ALTER/不删列），其后唯一的 DDL 是 `:113-116` 的 `ADD COLUMN IF NOT EXISTS`——**注意该补列被 `if engine.dialect.name == "postgresql"` 显式门控，SQLite 不执行**（见下"先例辨析"）。
3. **服务层确不传 user_id**：`video_project_service.py:362-381` 的 `create_project` 仅构造 `name/description/category_id/cover_url/project_data`，`await db.flush()` 触发 INSERT；`get_db_session`（`database.py:89-97`）异常 `rollback()` 后**重抛** → FastAPI 全局处理转 500。
4. **桌面端跑不到迁移 015**：`prepare-backend.js:15-17` 的 `COPY_ENTRIES` 不含 `alembic/`，`backendService.js:65` 注释"Cold start does create_all"。迁移 015（`alembic/versions/015_drop_user_system.py`）恰好覆盖四张业务表 `video_projects/video_project_categories/storyboard_packs/project_covers` 并 drop `login_history`/`users`（先子后父），但桌面端永不执行。
5. **CI/冒烟为何漏测（强化证据）**：`smoke-test.js:89-91` 用 `fs.mkdtempSync` 建**全新空 userData + 空 .env**（永远全新库 → `create_all` 按新模型建表、无 user_id），且其断言只 **GET** `/api/video-projects`（`:145` 一带，列表）、检查 sqlite 文件存在——**从不 POST 创建项目**。因此该回归在结构上不可能被现有冒烟捕获，与"全新安装不复现"吻合。
6. **复现脚本**：`repro_user_id_not_null.py` 纯 SQLite 还原链路，实跑输出 `NOT NULL constraint failed: video_projects.user_id`，与上述推理一致。

→ **Bug #1 根因判定：成立，证据闭环，无遗漏的替代解释。**（已排除"后端启动崩溃"：全量搜索无残留 auth/user import。）

**Bug #2（弹窗比例）——根因成立。** 复核 `Modal.tsx:67-84`：被居中的 `role="dialog"` flex 子项 `className={contentClassName}`，两个表单弹窗（`ProjectFormDialog.tsx:62-66` 未传 `contentClassName`、宽度写在内层 `<form className="... w-full max-w-md">`；`CategoryFormDialog.tsx:51-55` 同形，`max-w-sm`）→ 对话框包裹层无尺寸而 shrink-wrap，内层 `w-full` 相对一个"包裹自身"的父级求值 → 宽度由内容内在宽度决定、不稳定，且整链**无 `max-height`/`overflow`**，矮窗溢出。与既有约定（`contentClassName` 携尺寸 + `max-h`/`overflow`）相悖，证据充分。`handleRenameProject` 复用同一 `ProjectFormDialog`，故修复同时覆盖"重命名"弹窗。

### B. 方案审计：边界 / 最小化 / 回归风险

**Bug #1 推荐方案 A（启动期幂等清残列）的关键校验：**

- **先例辨析（修正报告措辞）**：报告称"有现成先例可仿（`database.py:113-116`）"。复核发现该先例**是 PostgreSQL-only** 且其注释明言 SQLite 下 `create_all` 已建好列、无需补列；而本 Bug 平台恰是 **SQLite**。故该先例只佐证了"启动期条件式 DDL 自愈"这一**模式**，并不提供 SQLite 的**删列机制**——方案 A 的 SQLite 删列（表重建）属于**新增代码**，不是该先例的镜像。结论不变（模式有先例、方向正确），但 Subtask #2 不能简单照抄 `:113-116`。
- **可行性前提已补证（原报告缺失）**：方案 A 要复用 015 的 `batch_alter_table`，依赖运行时能 `import alembic`。已确认 `alembic>=1.13.0` 随桌面打包进 `Lib/site-packages`（`requirements.txt:56` + `prepare-backend.js:118-121`），仅 `alembic/` 目录被排除 → **可行**。
- **实现注意事项（必须处理，交 Subtask #2）**：
  1. `alembic.op` 是绑定到活动 `MigrationContext` 的代理，**不能在 app 代码里直接 `from alembic import op` 调用**。须显式构造 `Operations(MigrationContext.configure(sync_conn))` 并在其上调 `batch_alter_table`，且在 `init_db()` 的 `engine.begin()` + `run_sync(...)` 内用**同步连接**执行；或干脆**不依赖 alembic**，用 SQLAlchemy Core/原生 SQL 完成 SQLite 表重建（更自洽，推荐作为等价实现）。
  2. **幂等守卫按表逐一探测**：用 inspector 对四张表分别判断 `user_id` 是否存在，仅存在时才动作；放在 `create_all` **之后**（全新库无 user_id 故天然跳过，零影响）。
  3. **SQLite `recreate="always"` 会全表复制**：`video_projects.project_data` 可达每行数 MB，大库时一次性重建会拖慢冷启动并占内存，须落在 120s 健康窗口内（`backendService.js:66`）。属一次性成本（修复后列消失即跳过），建议 `log` 出"检测到残留 user_id，正在清理 N 行"。
  4. **索引先于列删除**：旧表带 `ix_*_user_*` 复合索引/隐式单列索引，SQLite 表重建会复制未删的索引，复制一个仍引用已删 `user_id` 的索引会"no such column"失败 → 须如 015 用 inspector 发现并先删（`if_exists=True`）。
  5. **`users`/`login_history` 的 drop 属"附带清理"而非修 500 必需**（这两表不在 create_project 的 INSERT 路径上）；保留以彻底退役旧 schema，低风险，子表先于父表。
- **是否"做多了"？——否，方案 A 是最小完整修复**：`storyboard_packs`/`project_covers` 同样残留 `user_id NOT NULL`，其各自 INSERT 路径（生成分镜 / 保存封面）会以**完全相同根因** 500；覆盖四表是"修同一类缺陷"，不是额外工作。被否决的更"微"方案（给 `user_id` 加默认值绕过）在 SQLite 上同样要表重建、且留下死列与"用户系统已移除"语义冲突，劣于直接删列。
- **回归面**：仅改 `database.py`（+ 可选一个 pytest）。PG 开发库若已 `upgrade head` → 无 user_id → 守卫跳过，不受影响；未跑迁移的老 PG 库同样被自愈。守卫保证可反复启动安全。

**Bug #2 推荐方案 A 的校验**：与既有三处弹窗约定一致、改动仅两文件、零功能风险。针对用户原话"**固定宽高比**"：复核确认表单内容高度可变（标题+名称+简介 textarea+分类下拉+按钮），**字面 `aspect-ratio`（方案 B）会与可变高度对抗**（易空旷/拥挤/溢出），故应以"**固定稳定宽度 + 上限高度 + 内部滚动**"实现用户想要的"匀称固定观感"，而非硬比例盒。

### C. 最终推荐修复（Final Recommended Fix）

**Bug #1 → 方案 A：在 `init_db()` 中加幂等的"清残列"启动自愈。**
理由：(1) 直击根因——删掉残留 `user_id NOT NULL` 即根除 500；(2) 桌面端不带 `alembic/` 目录、只跑 `create_all`，修复**必须**落在 `app` 运行时（已证 `alembic` 包可用，可复用 015 逻辑或等价 Core 实现）；(3) 覆盖四张同病表是最小**完整**修复，非过度设计；(4) 相对方案 B（打包 alembic + 跑 upgrade）不增包体/不改打包/无 stamp 错位风险，相对方案 C（整库重置）**保住用户既有项目数据**。Subtask #2 必须落实上文 B 节"实现注意事项"五条（尤其 `op` 需 `Operations` 上下文 / 或改用 Core；逐表幂等守卫；索引先删；大表重建告警）。建议按 CLAUDE.md「修 bug 先写复现测试」补一个 pytest：旧 schema 库 → 启动自愈 → 断言 `user_id` 消失且 `create_project` 成功。

**Bug #2 → 方案 A：把宽高/滚动归位到 `Modal` 的 `contentClassName`，内层 `<form>` 仅留布局。**
建议 `ProjectFormDialog` 传 `contentClassName="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-md border border-border bg-card shadow-xl"`（`CategoryFormDialog` 同法、宽度可保 `max-w-sm`），并从内层 `<form>` 去掉重复的 `bg-card/border/shadow/max-w`。这样得到**稳定固定宽度 + 矮窗内部滚动 + 匀称比例**，既满足用户"固定、美观、优雅"的诉求，又与项目既有弹窗约定一致、风险最低。

### D. Definition of Done 核对

- [x] 证据链闭环：Bug #1 前端→代理→HTTP→服务→模型→旧库残列→`create_all` 不删列→迁移 015 不执行，逐环复核并补证（alembic 包可用、严格超集排除 no-such-column、冒烟只 GET）。Bug #2 CSS 机制复核到位。
- [x] 评审结论唯一推荐：Bug #1 = 方案 A（启动期幂等清残列），Bug #2 = 方案 A（尺寸归位 `contentClassName`），均附明确理由与实现边界。
- [x] 仅修改 `analysis.md`，未写修复代码、未 `git commit`。
