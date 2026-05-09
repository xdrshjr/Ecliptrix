# Fix Plan — Web Bug Report 20260509 (iter4)

## 元信息

- **来源 Bug 报告**: `docs/diagnoses/web-bug-report-20260509-iter4/bug-report.md`（7 个 Bug）
- **基线 commit**: `9abd7a7` (iter3 review-report，HEAD)
- **覆盖范围**: 前 3 轮未触及的工作流保存/运行、素材库筛选空态、时间轴特效/转场工具条、用户管理统计-列表口径、头脑风暴 nav 入口、工作流组件 console 噪音
- **修复策略原则**:
  1. **后端为先**：Bug #1 是 Critical 后端 async/greenlet 缺陷，前端脱敏只是双层防御，根因必须修
  2. **复用 iter1-3 已建立的范式**：debugLog (`dlog`)、useMemo 闸门 + disabled+title+aria-label、comingSoon 标记、i18n schema 三处同步 (interface/EN/ZH)
  3. **不重复造轮子**：素材库空态、特效工具条、头脑风暴 nav 都用 `comingSoon` / 类型分支结构，统一一致
  4. **覆盖 i18n schema**: 所有新增文案先写 `interface` 块再补 EN/ZH，否则 type-check 会失败（iter3 已验证此教训）

---

## 验证快照（line numbers @ HEAD 9abd7a7）

| 模块 | 文件 | 关键行 |
|---|---|---|
| 工作流保存（后端 router） | `backend-services/basic-service/app/routers/workflow_router.py` | 32–88（`save_agent_workflow`，try/except+`HTTPException(detail=f"Failed to save workflow: {str(e)}"`）|
| 工作流保存（后端 service） | `backend-services/basic-service/app/services/agent_workflow_service.py` | 53–161（`save_workflow`：分支 `existing` 与 `new_workflow`；`db.flush()` 后无 `await db.refresh()`；`_record_to_model` 在 31–51 直接读取 `record.created_at`/`record.updated_at`）|
| 工作流保存（前端 toast） | `src/components/workflow/WorkflowInterface.tsx` | 800–853（`handleSaveWorkflow`：`error.message` 直接 `notification.showError`，无脱敏） |
| 工作流运行按钮 | `src/components/workflow/WorkflowInterface.tsx` | 1022–1033（`<button disabled={!activeWorkflow}>`，未检查节点列表/Start 节点） |
| 工作流执行器 | `src/components/workflow/WorkflowExecutor.ts` | 86–91（`throw new Error('No Start node found in workflow')` + 142–143 `console.error`） |
| 素材面板空态 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 1988–2014（空态分支；line 2007 标题 `noMaterials`；line 2009 描述 `emptyDescription`，单一固定文案） |
| 素材面板筛选状态 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | line 525 `handleTypeFilter`；line 5/231/525 `selectedMaterialType: MaterialType \| 'all'` |
| 时间轴 effects/transitions handler | `src/components/video/timeline/TimelinePanel.tsx` | 625–631（仅弹 `showInfo` 占位） |
| 时间轴工具条 | `src/components/video/timeline/TimelineToolbar.tsx` | 179–200（effects/transitions 按钮无 `disabled`、无 `comingSoon` 标记） |
| 用户管理统计 service | `backend-services/basic-service/app/services/user_service.py` | 783–836（`get_user_stats`：聚合不带 `current_user` 过滤）vs 270–312（`get_all_users`：admin 调用者 line 311 排除 `is_admin/is_root`） |
| 头脑风暴 nav 入口 | `src/components/Taskbar.tsx`：187–193；`src/components/VerticalTaskbar.tsx`：30–70 + 160–183；`src/components/Container.tsx`：268–284（占位页 — iter3 已加 `comingSoonHint`） |
| 工作流 console 噪音 | `src/components/workflow/WorkflowInterface.tsx` (~60 处)、`WorkflowSidebar.tsx`（~10 处）、`WorkflowCanvas.tsx`（~30 处） |

---

## Bug #1 — 工作流保存 500 + SQLAlchemy greenlet 错误外泄

### 根因

后端 `agent_workflow_service.save_workflow` 在两条分支都执行 `await db.flush()` 后**直接读取 ORM 对象的 server-default 列**，触发 lazy-load：

- `db_models.AgentWorkflow.created_at = Column(..., server_default=func.now())`，line 48
- `db_models.AgentWorkflow.updated_at = Column(..., server_default=func.now(), onupdate=func.now())`，line 49

`_record_to_model` (line 31–51) 在 `flush()` 后访问 `record.created_at.isoformat()` / `record.updated_at.isoformat()`：
- 对 **新插入的行**：`created_at`/`updated_at` 是数据库端默认值，`flush()` 不会自动 SELECT 回填到 Python 对象 → 触发隐式 lazy-load
- 对 **更新的行**：`updated_at` 因 `onupdate=func.now()` 同样需要回读

`async_sessionmaker(expire_on_commit=False)`（database.py:29）已经关闭了 commit-time 过期，但**新行的 server-default 列首次访问仍会发起隐式 fetch**。在 async session 中，这次 IO 必须在 greenlet 上下文里发起 — 而 `_record_to_model` 是普通方法（非 `async`），调用栈里没有 `greenlet_spawn`，因此抛出：

```
greenlet_spawn has not been called; can't call await_only() here
```

### 前端二次缺陷

`WorkflowInterface.tsx:822-849` 把 `response.message`（即后端返回的 `Failed to save workflow: <原始 SQLAlchemy 异常>`）直接喂给 `notification.showError`：
- `lib/api/workflow.ts:67` 把 `data.message` 抛成 `Error(data.message)`
- `WorkflowInterface.tsx:847` `error instanceof Error ? error.message : ...`

→ 整个 SQLAlchemy 错误页 URL（含 `https://sqlalche.me/e/20/xd2s`）被透传到 toast。

### 修复方案

**后端（必须）**：

`backend-services/basic-service/app/services/agent_workflow_service.py:53–161`

```python
async def save_workflow(self, db: AsyncSession, request: SaveAgentWorkflowRequest) -> Dict[str, Any]:
    try:
        ...
        if existing:
            old_data = existing.workflow_data or {}
            old_version = old_data.get("version", 1)
            workflow_data_json["version"] = old_version + 1

            existing.workflow_name = request.workflow_name
            existing.description = request.workflow_description
            existing.workflow_data = workflow_data_json
            await db.flush()
            # ⬇️ FIX: refresh server-side onupdate timestamp into Python object
            await db.refresh(existing, attribute_names=["created_at", "updated_at"])

            workflow_record = self._record_to_model(existing)
        else:
            workflow_data_json["version"] = 1

            new_workflow = AgentWorkflow(
                user_id=request.user_id,
                workflow_name=request.workflow_name,
                workflow_data=workflow_data_json,
                description=request.workflow_description,
                is_template=False,
            )
            db.add(new_workflow)
            await db.flush()
            # ⬇️ FIX: pull server-default timestamps back into the ORM object
            await db.refresh(new_workflow, attribute_names=["created_at", "updated_at"])

            workflow_record = self._record_to_model(new_workflow)
        ...
```

要点：
- `db.refresh(..., attribute_names=[...])` 限定字段，避免 `selectinload` 全量重读
- `db.commit()` 由 `get_db_session()` dependency 在 yield 后自动调用，service 层只 `flush` + `refresh`

**后端（错误脱敏，双层防御）**：

`backend-services/basic-service/app/routers/workflow_router.py:80-89`

```python
except Exception as e:
    logger.error(f"Error saving agent workflow: {str(e)}", {
        "error_type": type(e).__name__,
        "user_id": request.user_id,
        "workflow_id": request.workflow_id,
    })
    raise HTTPException(
        status_code=500,
        detail="Failed to save workflow. Please try again or contact support.",  # ⬅️ 脱敏文案，不再 f"…{str(e)}"
    )
```

实现等价的 `delete_*`/`load_*` 也修剪同款（统一脱敏）。

**前端（toast 兜底，最后防线）**：

新增 `src/lib/sanitizeError.ts`：

```ts
const SENSITIVE_PATTERNS = [
  /sqlalche\.me/i,
  /greenlet_spawn/i,
  /SQLAlchemy/i,
  /asyncpg/i,
  /psycopg2/i,
  /at 0x[0-9a-fA-F]+/,
  /Traceback \(most recent call last\)/,
];

export function sanitizeErrorMessage(raw: string, fallback: string): string {
  if (!raw) return fallback;
  if (SENSITIVE_PATTERNS.some((p) => p.test(raw))) return fallback;
  // 截断超长（>240 字符）后端原文
  if (raw.length > 240) return fallback;
  return raw;
}
```

`WorkflowInterface.tsx:844-849`:

```ts
} catch (error) {
  console.error('[WorkflowInterface] Error saving workflow:', error);
  const raw = error instanceof Error ? error.message : '';
  notification.showError(
    sanitizeErrorMessage(raw, t.workflowInterface.notifications.workflowSaveFailed),
    5000,
  );
}
```

同样兜底应用到其它 `await saveAgentWorkflow(...)` 站点（315、394、477）以及 `loadAgentWorkflows` / `deleteAgentWorkflow` 的 catch 分支。

### 测试

- **pytest**（新建 `backend-services/basic-service/tests/test_agent_workflow_service.py`）：
  - 用 SQLite in-memory + `async_sessionmaker(expire_on_commit=False)`
  - 测试 `save_workflow` 新建 → 返回 `success=True`，`data.created_at`/`updated_at` 非空且能 isoformat
  - 测试更新分支 → version 自增；二次保存不抛 greenlet 错误
- **vitest**（新建 `src/lib/__tests__/sanitizeError.test.ts`）：
  - sqlalche.me/greenlet/asyncpg 等关键字命中 → 返回 fallback
  - 长度 > 240 → 返回 fallback
  - 普通短消息（"Workflow not found"）→ 透传

### 风险

- `db.refresh` 增加一次 SELECT；性能上对保存路径影响可忽略（每次保存仅 1 行）
- 限定 `attribute_names` 避免触发关联表反查
- 前端脱敏默认拒绝 SQL 错误关键字，需手动验证业务级简短错误（如 "Workflow not found"）依旧能透传

---

## Bug #2 — 0 节点工作流"运行"按钮触发 console.error

### 根因

`WorkflowInterface.tsx:1023-1027` 的 `disabled={!activeWorkflow}` 只判断 workflow 对象存在，未检查 `nodes` 列表：

```tsx
<button
  className="..."
  onClick={() => handleRunWorkflow()}
  disabled={!activeWorkflow}
>
```

而 `WorkflowExecutor.ts:88-91` 把"找不到 Start 节点"作为 `throw new Error`，紧接着在 line 143 `console.error`，污染 console 并把错误堆栈打印到 DevTools。

### 修复方案

**前端 (1) 闸门**：

`WorkflowInterface.tsx`:

```tsx
const hasStartNode = useMemo(
  () => Boolean(activeWorkflow?.data.nodes?.some((n) => n.type === 'start')),
  [activeWorkflow?.data.nodes],
);

const isRunDisabled = !activeWorkflow || executionState.isRunning || !hasStartNode;
const runDisabledTitle = !activeWorkflow
  ? t.workflowInterface.editor.runHintNoWorkflow
  : !hasStartNode
    ? t.workflowInterface.editor.runHintMissingStart
    : '';
```

按钮：

```tsx
<button
  type="button"
  className="px-4 py-2 ... disabled:opacity-50 disabled:cursor-not-allowed"
  onClick={() => { if (!isRunDisabled) handleRunWorkflow(); }}
  disabled={isRunDisabled}
  title={runDisabledTitle || undefined}
  aria-label={runDisabledTitle || t.workflowInterface.editor.run}
>
  ...
</button>
```

**前端 (2) 降级 console.error**：

`WorkflowExecutor.ts:142-152`：把 "no start node" 这种业务错误从 `throw` 路径转为返回 `{ ok: false, reason }`；保留 catch 分支的 `addLog('error', ...)` 用于日志面板。

更小的改动：仅把 `console.error` 改为通过 `dlog`（iter2 已引入 `src/lib/debugLog.ts`）：

```ts
import { dlog } from '@/lib/debugLog';
...
} catch (error: any) {
  dlog.error('[WorkflowExecutor] Execution error:', error);
  this.executionState.isRunning = false;
  ...
}
```

但保留功能性 `addLog('error', ...)` 把消息写入执行日志面板（这是产品需要的 UX）。

**i18n keys**（interface + EN + ZH 三处同步）：

| key | EN | ZH |
|---|---|---|
| `workflowInterface.editor.runHintNoWorkflow` | "Select a workflow first." | "请先选择一个工作流" |
| `workflowInterface.editor.runHintMissingStart` | "Add a Start node before running." | "请先添加 Start 节点再运行" |

### 测试

- **vitest**（新建 `src/components/workflow/__tests__/WorkflowInterface.runGate.test.tsx`）：
  - mount with `nodes: []` → 按钮 `disabled` 且 `title` 包含 missingStart
  - mount with `nodes: [{type: 'start'}]` → 按钮启用
  - mount 无 activeWorkflow → 按钮 `disabled` 且 `title` 包含 noWorkflow
- **手动**：进入空工作流，hover 运行按钮 → tooltip "请先添加 Start 节点"；点击不触发 console.error

### 风险

- 用户当前若依赖运行按钮触发 toast 提示，会变成静默；用 `title` + `addLog` 在执行日志写入"按钮被屏蔽"信息可缓解（可选）
- `dlog.error` 在 prod 默认关闭；但 `addLog` 路径仍把红色错误写入执行日志面板，UX 不退化

---

## Bug #3 — 素材库筛选空态文案与所选类型不匹配

### 根因

`MaterialsPanel.tsx:1988-2014` 的非 storyboard_pack 空态分支硬编码 `t.materialsPanel.emptyDescription`，文案统一为 "素材库为空，点击下方「搜索视频」按钮…添加高质量的视频素材"（i18n.ts:6091）。无论 `selectedMaterialType` 是 video/audio/image/frame_pack/character_pack/scene_pack 都返回同一文案 → 误导。

### 修复方案

**前端**：在 `MaterialsPanel.tsx` 内派生空态文案：

```tsx
const emptyHint = useMemo(() => {
  const m = t.materialsPanel.empty;
  switch (selectedMaterialType) {
    case 'video':         return { title: m.videoTitle,    desc: m.videoDesc };
    case 'audio':         return { title: m.audioTitle,    desc: m.audioDesc };
    case 'image':         return { title: m.imageTitle,    desc: m.imageDesc };
    case 'frame_pack':    return { title: m.frameTitle,    desc: m.frameDesc };
    case 'character_pack':return { title: m.characterTitle,desc: m.characterDesc };
    case 'scene_pack':    return { title: m.sceneTitle,    desc: m.sceneDesc };
    case 'storyboard_pack': // 已有专属分支，line 1988-1998
      return { title: m.storyboardTitle, desc: m.storyboardDesc };
    case 'all':
    default:              return { title: m.allTitle,      desc: m.allDesc };
  }
}, [selectedMaterialType, t]);
```

替换 line 2007–2010：

```tsx
<h3 className="text-lg font-medium text-foreground mb-2">{emptyHint.title}</h3>
<p className="text-sm text-muted-foreground text-center max-w-sm">{emptyHint.desc}</p>
```

保留 line 2011–2013 拖拽提示原样。

**i18n schema**（interface + EN + ZH）：增加 `materialsPanel.empty` 子对象，包含 16 条 key (8 类型 × 2 字段)：

```ts
// interface (新)
materialsPanel: {
  ...
  empty: {
    allTitle: string;
    allDesc: string;
    videoTitle: string;
    videoDesc: string;
    audioTitle: string;
    audioDesc: string;
    imageTitle: string;
    imageDesc: string;
    frameTitle: string;
    frameDesc: string;
    characterTitle: string;
    characterDesc: string;
    sceneTitle: string;
    sceneDesc: string;
    storyboardTitle: string;
    storyboardDesc: string;
  };
};
```

ZH 文案样例（EN 类似）：
- video: "暂无视频素材" / "点击「上传素材」上传视频，或「搜索视频」从素材库添加"
- audio: "暂无音频素材" / "点击「上传素材」上传音频，或使用 AI 创建生成 TTS 音频"
- image: "暂无图片素材" / "点击「上传素材」上传图片，或「AI 创建」生成图片"
- frame: "暂无帧素材" / "使用「视频处理 → 视频帧提取」从视频中抽取帧后即可使用"
- character: "暂无人物建模包" / "使用「AI 人物建模」生成"
- scene: "暂无场景包" / "使用「AI 场景建模」生成"
- storyboard: "暂无分镜包" / "点击 AI 图像生成创建分镜包"（与现有硬编码文案一致）
- all: 沿用当前 emptyDescription

`emptyDescription` 与 `noMaterials` 旧 key **保留**（内部其它分支可能引用）。

### 测试

- **vitest**（新建 `src/components/video/components/MaterialsPanel/__tests__/MaterialsPanel.emptyHint.test.tsx`）：
  - 渲染时 `selectedMaterialType='image'` + materials=[] → 文案含 "图片"
  - `selectedMaterialType='frame_pack'` + 全空 → 文案含 "帧" / "视频帧提取"
- **手动**：BugTest 项目（仅 1 音频）切换 video/image/frame/audio/character/scene 标签 → 文案各自匹配

### 风险

- 16 条新 i18n key 需要 schema 三处同步；按 iter3 教训先写 `interface` 再补 EN/ZH
- 现有 `emptyDescription` key 不删（避免破坏其它引用）

---

## Bug #4 — 特效/转场按钮以正常状态露出但实为占位

### 根因

`TimelineToolbar.tsx:179-200` 的 effects/transitions 按钮配置无 `disabled` 字段，与上方真实可用的 export/subtitles 按钮视觉无差。`TimelinePanel.tsx:625-631` 的 handler 仅 `showInfo(... 功能开发中)`。

### 修复方案

**前端 (1) 工具条标记**：

`TimelineToolbar.tsx:179-200`：在 effects/transitions 按钮配置加 `comingSoon: true`：

```tsx
{
  id: 'effects',
  action: onAddEffect,
  icon: (...),
  label: t.timeline.toolbar.effects,
  shortcut: t.timeline.shortcuts.effectsShortcut,
  comingSoon: true,  // ⬅ 新增
  disabled: true,     // ⬅ 与 comingSoon 联动
},
{
  id: 'transitions',
  action: onAddTransition,
  ...
  comingSoon: true,
  disabled: true,
},
```

`renderIconButton` 保留对 `disabled` 的判断（line 226 已有），追加 `title` 显示 "功能开发中"：

```tsx
<button
  ...
  disabled={button.disabled}
  title={button.comingSoon ? t.timeline.toolbar.comingSoonHint : button.label}
  aria-label={button.comingSoon ? `${button.label} - ${t.timeline.toolbar.comingSoonHint}` : button.label}
>
```

**前端 (2) 视觉降级**：在按钮 className 上追加 `disabled:opacity-50 disabled:cursor-not-allowed`，与 export 按钮的 disabled 体感一致。可在 label 旁加小标 `(BETA)` / `(开发中)` — 也可只用 opacity 表达，与 LandingPage iter3 的 comingSoon 风格一致。

**前端 (3) handler 兜底**（防呼叫穿透）：

`TimelinePanel.tsx:625-631` 保留弹窗，但仅在某些 dev 分支触发；推荐做法：直接删除（按钮已 disabled），不再被调用。但因 `handleAddEffectRef.current()` 仍可被键盘快捷键 (E/T) 触发（line 395/398），handler 改为：

```tsx
const handleAddEffect = useCallback(() => {
  showInfo(t.timeline.toolbar.comingSoonHint, 3000);
}, [showInfo, t]);
```

文案统一为新 i18n key `comingSoonHint`，避免长句。

**i18n keys**（interface + EN + ZH）：

| key | EN | ZH |
|---|---|---|
| `timeline.toolbar.comingSoonHint` | "Coming soon" | "功能开发中，敬请期待" |

### 测试

- **vitest**（`TimelineToolbar.comingSoon.test.tsx`）：渲染 effects/transitions → `disabled=true` + `title` 含 "Coming soon"/"开发中"
- **手动**：进入视频项目 → 工具条 effects/transitions 灰显，hover 显示 tooltip；按 E / T 快捷键 → 弹"功能开发中"toast

### 风险

- 现有 `effectsRequireSelection` / `transitionsRequireSelection` i18n key 保留（不引用即可，避免破坏旧测试）
- `disabled=true` 后按钮的 `[active]` 高亮态自然消失（无副作用）

---

## Bug #5 — 用户管理统计卡与表格条目数不一致

### 根因

后端两个端点应用了不同的过滤口径：

- `user_service.get_all_users`（line 270–312）：admin 调用者**排除 admin/root**（line 311 `User.is_admin == False, User.is_root == False`）
- `user_service.get_user_stats`（line 783–836）：注释明说 "Stats are aggregate data — show accurate counts regardless of caller role"，**全量统计**，不带 `current_user` 过滤

→ 总用户 2，列表 1（admin 看到的非 admin 用户）。

### 修复方案

**方案 B（推荐）**：让 stats 与 list 同口径，admin 调用者的 stats 也排除 admin/root。

`backend-services/basic-service/app/services/user_service.py:783-836`：

```python
async def get_user_stats(self, db: AsyncSession, current_user: Optional[User] = None) -> Dict[str, Any]:
    try:
        # Apply same permission filter as list endpoint
        base_filter = []
        if current_user is not None and not current_user.is_root:
            # admin (non-root) callers: exclude admin and root users from stats
            base_filter = [User.is_admin == False, User.is_root == False]

        def _count(extra_filter=None):
            stmt = select(func.count(User.id))
            for f in base_filter:
                stmt = stmt.where(f)
            if extra_filter is not None:
                stmt = stmt.where(extra_filter)
            return stmt

        total = (await db.execute(_count())).scalar() or 0
        admin_count = (await db.execute(_count(User.user_role == "admin"))).scalar() or 0
        premium_count = (await db.execute(_count(User.user_role == "premium"))).scalar() or 0
        regular_count = (await db.execute(_count(User.user_role == "regular"))).scalar() or 0
        active_count = (await db.execute(_count(User.is_active == True))).scalar() or 0
        disabled_count = (await db.execute(_count(User.is_active == False))).scalar() or 0
        online_count = (await db.execute(_count(User.active_session_token.isnot(None)))).scalar() or 0

        return {"success": True, "message": "用户统计获取成功", "data": {...}}
```

要点：
- `current_user.is_root` 时不做过滤（root 看到全量，与 list 一致 — list 仅排除 self，stats 不排除 self 是可接受的小差异；admin 场景下 `total` 与列表 `total` 完全相等）
- admin 自己看到的 admin_count 自然为 0（因为已被 base_filter 排除）— 这是符合 admin 视角的
- root 看到 admin_count 仍为 1（与列表 total 等于"全部 - 自己"差 1，但这是 root 的特殊视角，注释说明即可）

**前端**：保持现状即可（统计卡组件不需要改）。

如果需要 root 调用时也对齐 list 的 "exclude self" 口径，可以再加：

```python
if current_user is not None and current_user.is_root:
    base_filter = [User.id != current_user.id]
```

— 但这会导致 admin/regular 切换 root 视角时数字变化，反而让人困惑。**推荐**：root 看全量（stats 内含 root 自己），admin 看非 admin/root 的子集，并在前端文档中说明此口径。

### 测试

- **pytest**（新建/扩充 `tests/test_user_stats_consistency.py`）：
  - seed: 1 root + 1 admin + 2 regular
  - admin 调用 stats → total=2 (regular only)；list → total=2
  - root 调用 stats → total=4；list → total=3 (排除 self)
- **手动**：重新登录 admin，对比统计卡总数与 "共 N 条"

### 风险

- 管理员第一次发现 "总用户数" 减少可能困惑；可通过 i18n 在统计卡 `aria-label` 加 "（不含管理员）" 注解（可选）
- root 用户视角不变（业务侧表态：root 是超级权限，看到的就是全量）

---

## Bug #6 — 头脑风暴 nav 入口仍可点击进入占位页

### 根因

- `Taskbar.tsx:187-193`：第 4 项菜单按钮 `onClick={() => handleCreateTask('brainstorm')}` 无任何 disabled / coming-soon 标记
- `VerticalTaskbar.tsx`（垂直任务栏）的 tab 列表渲染 brainstorm 类型 tab 时不区别于 chat/video/workflow（line 160–183）
- `Container.tsx:268-283` 占位页虽已 iter3 加了 `comingSoonHint`（line 280），但与 LandingPage 风格仍不一致（缺 Coming Soon 徽章）

### 修复方案

**前端 (1) Taskbar 菜单标记**：

`Taskbar.tsx:187-193`：

```tsx
<button
  onClick={(e) => {
    e.preventDefault();
    showInfo(t.tasks.brainstormingComingSoon, 3000);
  }}
  className="w-full px-4 py-2 text-left flex items-center space-x-3 opacity-50 cursor-not-allowed"
  aria-disabled="true"
  title={t.tasks.brainstormingComingSoon}
>
  {getTaskIcon('brainstorm')}
  <span className="text-sm">{t.tasks.brainstorming}</span>
  <span className="ml-auto text-[10px] text-muted-foreground border border-border rounded px-1">
    {t.tasks.comingSoonBadge}
  </span>
</button>
```

注意：
- 仍渲染按钮（不删除），保持菜单 layout 一致
- `onClick` 不再 `handleCreateTask('brainstorm')`，改为弹 toast 提示，避免创建无意义的占位 tab
- `opacity-50 cursor-not-allowed` 与 iter3 LandingPage 风格一致（不加 `pointer-events-none`，保留 hover tooltip）

**前端 (2) VerticalTaskbar tab 标记**（已存在的 brainstorm tab 已经创建过，需要兼容旧用户）：

VerticalTaskbar 不阻断已存在的 brainstorm tab（用户可能想关闭它），但点击时仍跳到 `Container.tsx` 的 brainstorm 占位 — 这部分体验由 (3) 处理。

**前端 (3) Container 占位页统一风格**：

`Container.tsx:268-284`：保留现有结构，再加一个 Coming Soon 徽章（与 iter3 LandingPage 一致）：

```tsx
{activeTask.type === 'brainstorm' && (
  <div className="flex-1 flex items-center justify-center bg-background">
    <div className="text-center max-w-md">
      <div className="...icon container">...</div>
      <div className="inline-flex items-center gap-2 mb-2">
        <h2 className="text-2xl font-semibold text-foreground">{t.tasks.brainstorming}</h2>
        <span className="text-xs px-2 py-0.5 border border-primary/30 text-primary/80 rounded-full">
          {t.tasks.comingSoonBadge}
        </span>
      </div>
      <p className="text-muted-foreground mb-1">{t.common.underDevelopment}</p>
      <p className="text-sm text-muted-foreground/80">{t.landing.comingSoonHint}</p>
    </div>
  </div>
)}
```

**i18n keys**（interface + EN + ZH）：

| key | EN | ZH |
|---|---|---|
| `tasks.brainstormingComingSoon` | "Brainstorming is coming soon." | "头脑风暴功能即将推出" |
| `tasks.comingSoonBadge` | "Coming Soon" | "即将推出" |

### 测试

- **vitest**（新建 `src/components/__tests__/Taskbar.brainstorm.test.tsx`）：
  - 点击 brainstorm 菜单项 → 不调用 `onAddTask`；调用 `showInfo`
  - 菜单项 `aria-disabled="true"`
- **手动**：顶部任务菜单 → 点击 "头脑风暴" → 弹 toast，不创建 tab；旧的 brainstorm tab 仍能打开占位页（带 Coming Soon 徽章）

### 风险

- 已有用户的 brainstorm tab 会保留，但点击后仍是占位 — 可接受
- `aria-disabled="true"` + 仍可点击 toast 是 W3C 推荐的"软禁用"模式（不破坏 a11y 但允许提示）

---

## Bug #7 — 工作流相关组件大量 console.log 噪音

### 根因

`WorkflowInterface.tsx`（~60 处 console.log/error）、`WorkflowSidebar.tsx`（~10 处）、`WorkflowCanvas.tsx`（~30 处）、`WorkflowExecutor.ts`（~50 处）共 **150+ 个直接 console 调用**，未走 iter2 引入的 `dlog` (`src/lib/debugLog.ts`)，生产环境 console 泛滥。

### 修复方案

**前端**：批量替换 `console.log/info/warn/error` → `dlog.log/info/warn/error`。

替换规则：
- `console.log(...)` → `dlog.log(...)`
- `console.info(...)` → `dlog.info(...)`
- `console.warn(...)` → `dlog.warn(...)`
- `console.error(...)` → `dlog.error(...)`
- 文件顶端 import `import { dlog } from '@/lib/debugLog';`

**保留 console.error 的场景**（不替换）：
- 真正应该在 prod 报错的关键路径（**目前 workflow 组件里全部是开发期诊断日志**，可以全替）
- 用户故意引发的错误（如保存失败的兜底已经有 toast，不需要 console.error 重复）

**目标文件**：
- `src/components/workflow/WorkflowInterface.tsx`
- `src/components/workflow/WorkflowSidebar.tsx`
- `src/components/workflow/WorkflowCanvas.tsx`
- `src/components/workflow/WorkflowExecutor.ts`
- `src/components/workflow/NodeExecutionCard.tsx`（如果有）
- `src/components/workflow/ExecutionProcessPanel.tsx`（如果有）
- `src/components/workflow/WorkflowChatInterface.tsx`（如果有）

替换办法（PowerShell）：

```powershell
Get-ChildItem src/components/workflow/*.{ts,tsx} | ForEach-Object {
  (Get-Content $_.FullName -Raw) `
    -replace 'console\.log\(', 'dlog.log(' `
    -replace 'console\.info\(', 'dlog.info(' `
    -replace 'console\.warn\(', 'dlog.warn(' `
    -replace 'console\.error\(', 'dlog.error(' |
  Set-Content $_.FullName -Encoding utf8
}
```

但应**先用 Edit 工具手动批量改**，避免破坏字符串内含 `console.log` 的注释或 doc。

修改后每个文件顶端补 `import { dlog } from '@/lib/debugLog';`。

### 测试

- **vitest**（新建 `src/components/workflow/__tests__/console-hygiene.test.tsx`）：
  - 用 spyOn(console, 'log') 包裹 mount + interaction → 在 NODE_ENV='production' 模拟下 spy 调用次数 0
  - 用 `window.__ECLIPTRIX_DEBUG__ = true` 反之验证日志开启
- **手动**：`npm run build && npm run start` 后打开 http://localhost:3000/，进入工作流页 → DevTools console 应只剩 LocalAudioManager / Auth / 必要运行期日志

### 风险

- `dlog.error` 在 prod 默认沉默；若某条 console.error 是用户必须看到的（极少见），需手动保留 console.error
- WorkflowExecutor 内的 `console.error('[WorkflowExecutor] Pexels Video Search failed:', error)` 等可保留为 dlog.error（addLog 会写入面板）

---

## 修复顺序与 PR 分组

| 顺序 | PR | 涵盖 Bug | 估计工作量 |
|---|---|---|---|
| 1 | **PR-A 后端 + 错误脱敏** | Bug #1 | 后端 service `db.refresh` + router 脱敏 + 前端 sanitizeError + 兜底 |
| 2 | **PR-B 工作流 UX 闸门 + 日志洁化** | Bug #2 + Bug #7 | useMemo 闸门、dlog 替换、i18n 2 key |
| 3 | **PR-C 视频编辑器 i18n & UX** | Bug #3 + Bug #4 | 16 条 empty + 1 条 coming-soon-hint i18n key、TimelineToolbar comingSoon、MaterialsPanel switch |
| 4 | **PR-D 用户管理统计口径** | Bug #5 | get_user_stats 加权限过滤 + pytest |
| 5 | **PR-E 全站 coming-soon 一致性** | Bug #6 | Taskbar / Container / 2 i18n key |

**先做 PR-A**：Bug #1 是 Critical，阻断工作流持久化；其它 PR 可并行但不应在 PR-A 之前 ship。

**i18n 三处同步规则**：
- 总新增 key 数量：~22 个（Bug #2: 2, Bug #3: 16, Bug #4: 1, Bug #6: 2, Bug #2 复用 1）
- **必须**先写 `interface` 块（`src/lib/i18n.ts` 头部）再补 EN/ZH 两块；漏写 interface 会导致 TS type-check 报错（iter3 教训）

---

## 手动验证清单（Step 5 收尾时使用）

- [ ] **Bug #1**：保存空工作流 → 后端返回 200 + toast 显示成功；模拟 service 异常 → toast 仅 "保存失败，请稍后重试"，无 sqlalche.me URL
- [ ] **Bug #2**：进入空工作流 → 运行按钮灰显 + tooltip "请先添加 Start 节点再运行"；console 无 `[WorkflowExecutor] Execution error: Error: No Start node`
- [ ] **Bug #3**：素材库切换到帧 → 标题 "暂无帧素材"，描述指向 "视频帧提取"；切到图片 → 描述含 "上传图片"
- [ ] **Bug #4**：时间轴 effects/transitions 按钮灰显 + tooltip "Coming soon" / "功能开发中"；按 E / T 快捷键弹 toast
- [ ] **Bug #5**：用户管理页统计卡 "总用户数" 与表格 "共 N 条" 数字一致（admin 视角下都为非 admin/root 用户数）
- [ ] **Bug #6**：顶部新建任务菜单 "头脑风暴" 灰显 + Coming Soon 徽章 + 点击不创建 tab；已存在的 brainstorm tab 占位页有 Coming Soon 徽章
- [ ] **Bug #7**：`npm run build && npm run start` 后浏览工作流页 → console 仅有运行期信息日志，无 `[WorkflowInterface]` / `[WorkflowSidebar]` / `[WorkflowCanvas]` / `[WorkflowExecutor]` 调试日志
- [ ] **回归**：iter1/2/3 共 21 个修复点不退化（视频封面 modal、登录鉴权、TTS 校验、html lang、ModelSettings form、ChatType modal、LandingPage brainstorm card、VideoPlayerPanel 导出闸门、useTasks LS 持久化）

---

## 风险一览

| 区域 | 风险 | 缓解 |
|---|---|---|
| 后端 db.refresh | 增加 1 次 SELECT/保存 | `attribute_names` 限定字段；单行 SELECT 影响可忽略 |
| 前端 sanitizeError | 短业务消息可能误判 | 仅对包含 SQL 关键字 / 长度 >240 触发回退；保留普通短消息 |
| i18n schema 三处同步 | 漏写 interface 导致 type-check 失败 | step4 改完每加完一组就 `npm run type-check` |
| dlog 全量替换 | 误把字符串里的 `console.log` 注释替换 | 优先用 Edit 工具按行替换，不用全文 sed |
| Bug #5 stats 口径 | admin 视角的 admin_count 永为 0 | 这是符合 admin 看不到 admin/root 的隐私边界，非 bug |
| TimelineToolbar coming-soon | iter3 LandingPage 已建立模式，不引入新风格 | 复用 opacity + cursor-not-allowed + tooltip 三件套 |

---

## 附录：i18n 新增 key 清单

| Bug | 文件 | key 路径 | 备注 |
|---|---|---|---|
| #2 | i18n.ts (interface 1132+ / EN 3793+ / ZH 6474+) | `workflowInterface.editor.runHintNoWorkflow` | "请先选择一个工作流" |
| #2 | 同上 | `workflowInterface.editor.runHintMissingStart` | "请先添加 Start 节点再运行" |
| #3 | i18n.ts (materialsPanel 块) | `materialsPanel.empty.{all,video,audio,image,frame,character,scene,storyboard}{Title,Desc}` | 共 16 个 |
| #4 | i18n.ts (timeline.toolbar 块) | `timeline.toolbar.comingSoonHint` | "功能开发中，敬请期待" / "Coming soon" |
| #6 | i18n.ts (tasks 块) | `tasks.brainstormingComingSoon` | toast 文案 |
| #6 | 同上 | `tasks.comingSoonBadge` | 徽章文案 |

→ 共 **22 个新 key**，分布在 4 个 i18n 命名空间（`workflowInterface.editor` / `materialsPanel.empty` / `timeline.toolbar` / `tasks`）。

---

## 准备就绪

本计划基于 HEAD `9abd7a7`，所有 line numbers 已与现网代码核对。Step 3（review）建议复核：
- (a) Bug #1 是否真的需要 `attribute_names` 限定（如果 `selectinload` 不到关联表，可省略，纯 `await db.refresh(obj)` 即可）
- (b) Bug #5 root 调用者是否需要排除 self（推荐保留 root 看全量）
- (c) Bug #6 toast 提示是否对已有 brainstorm tab 用户体验造成困惑（推荐 acceptable）
- (d) Bug #7 是否要把 WorkflowExecutor 中产品功能性 console.error（如 Pexels 失败）保留为 console.error（推荐改 dlog.error，addLog 已写面板）
