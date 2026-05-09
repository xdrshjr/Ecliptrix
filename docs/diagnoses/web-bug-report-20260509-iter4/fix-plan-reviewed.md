# Fix Plan — Reviewed (iter4)

**审查对象**: `docs/diagnoses/web-bug-report-20260509-iter4/fix-plan.md`
**Bug 报告**: `docs/diagnoses/web-bug-report-20260509-iter4/bug-report.md`（7 个 Bug）
**基线 commit**: `9abd7a7` (HEAD; iter3 review-report)
**审查者职责**: 校验 fix-plan 中的代码定位、API 形态、边界条件、与既有代码 / 既有 i18n / 既有约定的一致性，给出最终可直接执行的方案。

---

## 0. 审查结论摘要

原 fix-plan 整体方向正确（后端 db.refresh + 前端 useMemo 闸门 + i18n 三处同步 + comingSoon 一致性），但存在以下 **9 项必须修正项**，否则会出现 TypeScript 编译失败 / 文案重复 / 边界覆盖不全等问题：

| # | 问题 | 严重度 | 影响 |
|---|------|-------|------|
| C1 | `dlog` import 路径错误 | **Critical** | 直接编译失败 |
| C2 | `dlog` API 形态错误 (没有 `.log/.info/.error` 子方法) | **Critical** | 直接编译失败 / 语义错误 |
| C3 | Bug #7 不应整体替换 `console.error` → `dlog.error` | **High** | prod 错误信号被误吞掉 |
| C4 | Bug #1 服务层错误消息未脱敏 | High | 仅修 router 仍泄露 |
| C5 | Bug #3 空态条件覆盖不全 (filter≠all 且 materials 非空时不触发) | High | 主报告场景仍未修 |
| C6 | Bug #6 i18n 重复 (`tasks.comingSoonBadge` 与已有 `landing.comingSoonBadge` 重复) | Medium | i18n bloat |
| C7 | Bug #4 `featureComingSoon` 已存在，新增 key 与之重复 | Low | i18n bloat |
| C8 | Bug #6 范围过宽 (VerticalTaskbar 不在 bug 范围内) | Low | 不必要变更 |
| C9 | Bug #2 console.error 抑制策略需调整 | Medium | 生产丢失诊断信号 |

修正后给出的最终方案位于 §3。

---

## 1. 验证快照（line numbers @ HEAD `9abd7a7`，已逐一打开核对）

| 模块 | 文件 | 关键行 | 验证 |
|---|---|---|---|
| 后端 service.save_workflow | `backend-services/basic-service/app/services/agent_workflow_service.py` | 53–161; `_record_to_model` 31–51; `await db.flush()` @ 114, 133（无 `db.refresh`）；service `try/except` 在 148–161 返回 `{"success":False, "message": f"Failed to save workflow: {error_msg}", ...}` | ✅ 与原 plan 一致；plan 漏写了 service 层也外泄消息 |
| 后端 router.save | `backend-services/basic-service/app/routers/workflow_router.py` | 32–89；line 65 `detail=result.get('message', ...)` 把 service message 透传；line 88 `detail=f"Failed to save workflow: {str(e)}"` 兜底也外泄 | ✅ |
| 前端 save handler | `src/components/workflow/WorkflowInterface.tsx` | 800–853；line 847 `error.message` 直传 toast | ✅ |
| 前端 run 按钮 | `src/components/workflow/WorkflowInterface.tsx` | 1022–1046（含 `stop` 分支）；line 1026 `disabled={!activeWorkflow}` | ✅ |
| 前端 executor | `src/components/workflow/WorkflowExecutor.ts` | 86–91（`throw new Error('No Start node found in workflow')`）；142–152 `console.error + addLog('error', ...)` | ✅ |
| 素材面板空态 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 1987–2014；空态外层条件: `materials.length === 0 && storyboardPacks.length === 0 && characterPacks.length === 0 && scenePacks.length === 0 && framePacks.length === 0` (line 2000) — **当 materials 含其它类型项时不会触发** | ⚠️ plan 漏掉此边界 |
| 时间轴工具条 | `src/components/video/timeline/TimelineToolbar.tsx` | 179–200（effects 无 `disabled`/`comingSoon`）；renderIconButton 在 222–258 已对 `button.disabled` 做处理 | ✅ |
| 时间轴 handler | `src/components/video/timeline/TimelinePanel.tsx` | 625–631（handleAddEffect/Transition 仅弹 `effectsRequireSelection`/`transitionsRequireSelection`） | ✅ |
| 用户管理 service | `backend-services/basic-service/app/services/user_service.py` | 783–836 `get_user_stats(self, db, current_user: Optional[User] = None)` — **签名已包含 current_user**, 只是未在 SQL 中应用过滤 | ✅ |
| 用户管理 router | `backend-services/basic-service/app/routers/user_router.py` | 765–790；line 780 `await user_service.get_user_stats(db=db, current_user=current_user)` — **router 已传 current_user**，无需改动 | ✅ |
| Taskbar nav 入口 | `src/components/Taskbar.tsx` | 187–193（brainstorm 菜单项）| ✅ |
| Container 占位页 | `src/components/Container.tsx` | 268–283（已使用 `t.common.underDevelopment` + `t.landing.comingSoonHint`，由 iter3 加入）| ✅ |
| 工作流 console 数量 | `src/components/workflow/{WorkflowInterface,WorkflowSidebar,WorkflowCanvas,WorkflowExecutor}.{ts,tsx}` | `console.*` 总计 **183 处** = 60+10+50+63；其中 `console.log/info` 49 处 (Interface)；`console.error/warn` 11 处 (Interface)；Executor 49 / 14 | ⚠️ plan 写 "150+" 偏低；且策略需区分 |
| `dlog` 实际位置 | `src/lib/utils/debugLog.ts` | exports `dlog(...args)` 与 `dwarn(...args)` ——**没有 `.log/.info/.error` 子方法**；isProd gate；`window.__ECLIPTRIX_DEBUG__` 运行时开关 | ⚠️ plan 写 `@/lib/debugLog` + `dlog.log/error` **均错** |
| iter3 已建立的 i18n | `src/lib/i18n.ts` | `landing.comingSoonBadge` ('Coming Soon' / '即将推出') @ EN 2722 / ZH 5427；`landing.comingSoonHint` ('This feature is in development. Stay tuned!' / '功能开发中，敬请期待') @ EN 2723 / ZH 5428；`landing.brainstormingDescPreview` 也已存在 | ⚠️ plan 新增的 `tasks.comingSoonBadge` 与之重复 |
| iter3 已建立的 i18n (timeline) | `src/lib/i18n.ts` | `timeline.messages.featureComingSoon`、`timeline.messages.effectsRequireSelection`、`timeline.messages.transitionsRequireSelection` 已存在 | ⚠️ plan 新增 `timeline.toolbar.comingSoonHint` 与 `featureComingSoon` 语义重叠 |

---

## 2. 必须修正项（C1–C9）

### C1 (Critical) — `dlog` 的 import 路径错误

- **plan 写法**: `import { dlog } from '@/lib/debugLog';`
- **实际**: 文件位于 `src/lib/utils/debugLog.ts`，正确写法 `import { dlog, dwarn } from '@/lib/utils/debugLog';`
- 参考 iter2 已落地用法: `src/components/chat/ChatInterface.tsx:11` `import { dlog } from '@/lib/utils/debugLog';`
- **修正**: 全部 `import` 路径统一为 `@/lib/utils/debugLog`。

### C2 (Critical) — `dlog` API 形态错误

`debugLog.ts` 实际只导出两个 callable：
```ts
export const dlog  = (...args: unknown[]): void => { if (enabled()) console.log(...args); };
export const dwarn = (...args: unknown[]): void => { if (enabled()) console.warn(...args); };
```

- 没有 `dlog.log` / `dlog.info` / `dlog.warn` / `dlog.error` 任何子方法。
- plan 中 PowerShell 一键替换：
  ```powershell
  -replace 'console\.log\(', 'dlog.log(' `
  -replace 'console\.error\(', 'dlog.error('
  ```
  会产出 `dlog.log(...)` 这种 **不存在的 API 调用**，TS 编译报 `Property 'log' does not exist on type '(...args: unknown[]) => void'`。

- **正确映射**:
  | 原写法 | 替换为 | 备注 |
  |---|---|---|
  | `console.log(...)`  | `dlog(...)`   | 渲染期/调试日志 |
  | `console.info(...)` | `dlog(...)`   | 信息级与 log 同处理 |
  | `console.warn(...)` | `dwarn(...)`  | 用专属导出 |
  | `console.error(...)` | **保持原样** (见 C3) | 真正的错误信号必须留在 prod |
- **不要使用一键 sed/PowerShell 全文替换**。优先用 `Edit` 工具按行替换，避免破坏注释/字符串里的 `console.log` 字面量。

### C3 (High) — Bug #7 不应整体替换 `console.error` → `dlog.error`

`debugLog.ts` 头部明确写道："Keep `console.error` and `console.warn` for unexpected failures." iter2 落地实践（`ChatInterface.tsx`、`MessageBubble.tsx`）也仅替换了 `console.log`，未触碰 `console.error`。

- **错误的 plan 行为**: `console.error('[WorkflowInterface] Error saving workflow:', error)` → `dlog.error(...)` —— 会让 prod 完全丢失保存失败的诊断信号；同时由于 `dlog.error` 不存在还会编译失败 (C2)。
- **正确策略**:
  | 类别 | 处理 |
  |---|---|
  | **渲染/状态调试日志** (`Active workflow:`, `Rendering canvas:`, `Updating chat messages` 等) | `console.log` → `dlog` |
  | **业务可预期错误回退** (eg. Bug #2 的 `No Start node`：从 throw 改成早返) | 不再走 catch 路径 (见 §3 Bug #2) |
  | **未预期失败** (`Error saving workflow`、`Pexels Video Search failed`、`Execution error: <未知 error>`) | **保持 `console.error`** |
- 范围建议：
  - `WorkflowInterface.tsx` 60 个 console 中，约 49 个是 `console.log`（渲染/state 日志），全部转 `dlog`；其余 11 个 `console.error/warn` 保留。
  - `WorkflowSidebar.tsx` 10 个全是 `console.log`/render 日志 → 全转 `dlog`。
  - `WorkflowCanvas.tsx` 50 个中按上表分类替换。
  - `WorkflowExecutor.ts` 63 个中：49 个 `console.log` → `dlog`；14 个 `console.error/warn` **保留**（这些是节点执行失败、Pexels/TTS 错误等真实诊断点）。
- **唯一例外**：Bug #2 中 `console.error('[WorkflowExecutor] Execution error:', error)` (line 143) —— 由 Bug #2 修复（早返 + 不进 catch）从根上消除；不要简单替换。

### C4 (High) — Bug #1 service 层错误消息未脱敏

plan 只修了 router 的 `detail` 文案，但 service `save_workflow` 在 catch 分支返回：
```python
return {"success": False, "message": f"Failed to save workflow: {error_msg}", ...}
```
当 router 走 `if not result.get('success'): raise HTTPException(detail=result.get('message'))`（line 65）时，**service 层的 message 字段仍把 SQLAlchemy 原文带到 HTTPException detail**。

- **修正**: 同步把 service 层 catch 分支改为：
  ```python
  except Exception as e:
      error_msg = str(e)
      logger.error("Error saving agent workflow", { ... })  # 完整错误进日志
      return {
          "success": False,
          "message": "Failed to save workflow",  # 脱敏 — 不再嵌入 str(e)
          "error_code": "SAVE_ERROR",
      }
  ```
  同款修改应用到 `load_workflows`、`delete_workflow`。
- router 层 `detail=result.get('message', 'Failed to save workflow')` 不需要改（已经只读 message 字段）；但 `except Exception as e:` 兜底分支（line 86–89）仍需把 `f"Failed to save workflow: {str(e)}"` → 改为固定字符串 `"Failed to save workflow"`。
- 前端 `sanitizeErrorMessage` 仍然有用：作为最后一道防线，防止其它后端接口返回的错误细节穿透。**保留**新文件 `src/lib/sanitizeError.ts` 与 `WorkflowInterface.tsx` 各 catch 分支的 sanitize 包裹。

### C5 (High) — Bug #3 空态条件覆盖不全

bug-report 第 113–139 行明确场景：BugTest 项目当前**有 1 个音频素材**，切换到"图片"或"帧"标签时空态文案错乱。
当前 `MaterialsPanel.tsx` line 2000 的空态条件是：
```tsx
materials.length === 0
  && storyboardPacks.length === 0
  && characterPacks.length === 0
  && scenePacks.length === 0
  && framePacks.length === 0
```
materials 含 1 个 audio → `materials.length === 1` → **空态分支根本不会触发**，用户看到的是空 grid（line 2015 的 else 分支里 `.filter()` 返回空数组）。

- plan 只把空态的文案按类型分支，但**条件完全没动** — 主报告场景仍然不会触发。
- **修正**: 派生 `visibleMaterials`，将空态条件改为「按当前筛选后可见集合都为空」：
  ```tsx
  const visibleMaterials = useMemo(() => (
    selectedMaterialType === 'all'
      ? materials.filter(m => m.type !== 'storyboard_pack')
      : materials.filter(m => m.type === selectedMaterialType)
  ), [materials, selectedMaterialType]);

  const visiblePacks = useMemo(() => {
    switch (selectedMaterialType) {
      case 'storyboard_pack': return storyboardPacks;
      case 'character_pack': return characterPacks;
      case 'scene_pack':     return scenePacks;
      case 'frame_pack':     return framePacks;
      case 'all':            return [
        ...storyboardPacks, ...characterPacks, ...scenePacks, ...framePacks
      ];
      default: return [];
    }
  }, [selectedMaterialType, storyboardPacks, characterPacks, scenePacks, framePacks]);

  const isFilteredEmpty = visibleMaterials.length === 0 && visiblePacks.length === 0;
  ```
- 然后空态分支改为：
  ```tsx
  {isFilteredEmpty ? (
    <EmptyHintBlock title={emptyHint.title} desc={emptyHint.desc} />
  ) : (
    /* grid */
  )}
  ```
- 删除原 line 1988–1998 的 `selectedMaterialType === 'storyboard_pack' && storyboardPacks.length === 0` 单独分支 — 由统一的 `isFilteredEmpty` + `emptyHint.storyboardTitle/Desc` 替代。
- 拖放提示行（line 2011–2013）保留为 `emptyHint` 内容下方静态附加。

### C6 (Medium) — Bug #6 i18n 重复 (`tasks.comingSoonBadge`)

- 已存在: `landing.comingSoonBadge` ('Coming Soon' / '即将推出') @ interface line 37, EN 2722, ZH 5427。
- plan 新增 `tasks.comingSoonBadge` —— 完全同义。
- **修正**: Bug #6 的徽章文案直接复用 `t.landing.comingSoonBadge`；不新增 `tasks.comingSoonBadge`。
- 仅新增 **1 个** key：`tasks.brainstormingComingSoon`（toast 文案，"头脑风暴功能即将推出" / "Brainstorming is coming soon."）。

### C7 (Low) — Bug #4 `featureComingSoon` 已存在

- 已存在: `timeline.messages.featureComingSoon`（具体文案见 i18n.ts:780 / EN / ZH）；`timeline.messages.effectsRequireSelection`、`transitionsRequireSelection` 也都有现成的"功能开发中"提示。
- 选择二选一：
  - **方案 A (推荐)**: 复用 `t.timeline.messages.featureComingSoon`（已有）作为按钮 `title` 与 toast 内容；不新增任何 i18n key。
  - **方案 B**: 新增 `t.timeline.toolbar.comingSoonHint`（更短、Tooltip 专用）。
- 推荐 A 以保持 i18n 简洁；如选 B，必须确保三处同步 (interface 1980+ / EN ~3568 / ZH ~6273)。本审查方案最终采用 A。

### C8 (Low) — Bug #6 范围过宽 (VerticalTaskbar)

bug-report 仅描述顶部主导航 (`Taskbar.tsx`) 的 brainstorm 入口。plan 第 553-557 行额外触及 `VerticalTaskbar.tsx` 但理由不充分（"已存在的 brainstorm tab 仍能打开占位"非新 bug，由 Container 占位页统一风格已覆盖）。

- **修正**: 不修改 `VerticalTaskbar.tsx`。仅修改：
  1. `Taskbar.tsx:187-193` — brainstorm 菜单项软禁用 + toast。
  2. `Container.tsx:268-283` — 占位页加 Coming Soon 徽章（复用 `t.landing.comingSoonBadge`）。

### C9 (Medium) — Bug #2 错误抑制策略

plan 给了"两个备选"：(a) 把 throw 改为 return (b) `console.error` → `dlog.error`。在 §C2/C3 已确认 (b) 编译失败/语义错误。

- **修正**: 唯一可行方案是 (a) — 在 `WorkflowExecutor.execute()` 头部加守卫：
  ```ts
  async execute(...): Promise<...> {
    const startNode = this.nodes.find(n => n.type === 'start');
    if (!startNode) {
      this.addLog('warning', undefined, 'Cannot run: no Start node in workflow');
      this.executionState.isRunning = false;
      this.notifyStateChange();
      return; // 早返，不进 catch，不打 console.error
    }
    // ...原 try/catch 保持
  }
  ```
- 但因前端按钮已经 disabled（Bug #2 主修复），`executeWorkflow()` 几乎不可能被无 Start 节点调用（除非走快捷键或开发态调试）。早返作为深度防御保留。
- 原 `console.error('[WorkflowExecutor] Execution error:', error)` (line 143) **保留**——它捕获的是其它真实未预期错误。

---

## 3. 最终 Bug 修复清单（直接执行版）

> 顺序与 plan PR 分组一致。每条给出**最小可执行 diff 思路**与**关键判断点**。

### Bug #1 — 工作流保存 500 + 错误外泄 (PR-A，先行)

#### 后端 (1) — `agent_workflow_service.py`

```python
# save_workflow — 在两条分支的 db.flush() 之后加 db.refresh
if existing:
    existing.workflow_name = request.workflow_name
    existing.description = request.workflow_description
    existing.workflow_data = workflow_data_json
    await db.flush()
    await db.refresh(existing, attribute_names=["created_at", "updated_at"])  # ⬅ 新增
    workflow_record = self._record_to_model(existing)
else:
    new_workflow = AgentWorkflow(...)
    db.add(new_workflow)
    await db.flush()
    await db.refresh(new_workflow, attribute_names=["created_at", "updated_at"])  # ⬅ 新增
    workflow_record = self._record_to_model(new_workflow)
```

```python
# save_workflow / load_workflows / delete_workflow — catch 分支脱敏
except Exception as e:
    error_msg = str(e)
    logger.error("Error <op> agent workflow", {"error": error_msg, "error_type": type(e).__name__, ...})
    return {
        "success": False,
        "message": "Failed to save workflow",  # ⬅ 不再嵌入 str(e)
        "error_code": "SAVE_ERROR",
    }
```

#### 后端 (2) — `workflow_router.py`

```python
# save_agent_workflow / load_agent_workflows / delete_agent_workflow 兜底分支
except Exception as e:
    logger.error(f"Error saving agent workflow: {str(e)}", { ... })
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to save workflow",  # ⬅ 去掉 f-string 嵌入
    )
```

#### 前端 (3) — 新建 `src/lib/sanitizeError.ts`

```ts
const SENSITIVE_PATTERNS: RegExp[] = [
  /sqlalche\.me/i,
  /greenlet_spawn/i,
  /SQLAlchemy/i,
  /asyncpg/i,
  /psycopg2?/i,
  /at 0x[0-9a-fA-F]+/,
  /Traceback \(most recent call last\)/,
];

export function sanitizeErrorMessage(raw: unknown, fallback: string): string {
  const msg = typeof raw === 'string' ? raw : (raw instanceof Error ? raw.message : '');
  if (!msg) return fallback;
  if (SENSITIVE_PATTERNS.some((p) => p.test(msg))) return fallback;
  if (msg.length > 240) return fallback;  // 超长后端原文一律回退
  return msg;
}
```

#### 前端 (4) — `WorkflowInterface.tsx` 各 catch

```tsx
} catch (error) {
  console.error('[WorkflowInterface] Error saving workflow:', error);  // ⬅ 真实错误：保持 console.error
  notification.showError(
    sanitizeErrorMessage(error, t.workflowInterface.notifications.workflowSaveFailed),
    5000
  );
}
```

应用站点：保存 (line 844)、load (1 处)、delete (1 处) 三个 await 调用的 catch。

### Bug #2 — 0-节点 run 闸门 (PR-B)

```tsx
// WorkflowInterface.tsx
const hasStartNode = useMemo(
  () => Boolean(activeWorkflow?.data.nodes?.some((n) => n.type === 'start')),
  [activeWorkflow?.data.nodes]
);

const isRunDisabled = !activeWorkflow || executionState.isRunning || !hasStartNode;
const runDisabledTitle = !activeWorkflow
  ? t.workflowInterface.editor.runHintNoWorkflow
  : !hasStartNode
    ? t.workflowInterface.editor.runHintMissingStart
    : '';

// 按钮 (line 1022-1033)
<button
  type="button"
  className="px-4 py-2 bg-primary text-primary-foreground ... disabled:opacity-50 disabled:cursor-not-allowed"
  onClick={() => { if (!isRunDisabled) handleRunWorkflow(); }}
  disabled={isRunDisabled}
  title={runDisabledTitle || undefined}
  aria-label={runDisabledTitle || t.workflowInterface.editor.run}
>
  ...
</button>
```

```ts
// WorkflowExecutor.ts execute() 入口处加深度防御 (C9)
const startNode = this.nodes.find(n => n.type === 'start');
if (!startNode) {
  this.addLog('warning', undefined, 'Cannot run: no Start node in workflow');
  this.executionState.isRunning = false;
  this.notifyStateChange();
  return;
}
// ...原 try/catch 保留 (含 console.error 不动)
```

i18n 新增 2 key (interface `workflowInterface.editor` 块 / EN / ZH 三处同步)：
| key | EN | ZH |
|---|---|---|
| `workflowInterface.editor.runHintNoWorkflow` | "Select a workflow first." | "请先选择一个工作流" |
| `workflowInterface.editor.runHintMissingStart` | "Add a Start node before running." | "请先添加 Start 节点再运行" |

### Bug #3 — 素材库空态文案 + 条件 (PR-C)

```tsx
// MaterialsPanel.tsx
const visibleMaterials = useMemo(() => (
  selectedMaterialType === 'all'
    ? materials.filter(m => m.type !== 'storyboard_pack')
    : materials.filter(m => m.type === selectedMaterialType)
), [materials, selectedMaterialType]);

const visiblePacks = useMemo(() => {
  switch (selectedMaterialType) {
    case 'storyboard_pack': return storyboardPacks;
    case 'character_pack': return characterPacks;
    case 'scene_pack':     return scenePacks;
    case 'frame_pack':     return framePacks;
    case 'all':            return [...storyboardPacks, ...characterPacks, ...scenePacks, ...framePacks];
    default:               return [];
  }
}, [selectedMaterialType, storyboardPacks, characterPacks, scenePacks, framePacks]);

const isFilteredEmpty = visibleMaterials.length === 0 && visiblePacks.length === 0;

const emptyHint = useMemo(() => {
  const m = t.materialsPanel.empty;
  switch (selectedMaterialType) {
    case 'video':          return { title: m.videoTitle,      desc: m.videoDesc };
    case 'audio':          return { title: m.audioTitle,      desc: m.audioDesc };
    case 'image':          return { title: m.imageTitle,      desc: m.imageDesc };
    case 'frame_pack':     return { title: m.frameTitle,      desc: m.frameDesc };
    case 'character_pack': return { title: m.characterTitle,  desc: m.characterDesc };
    case 'scene_pack':     return { title: m.sceneTitle,      desc: m.sceneDesc };
    case 'storyboard_pack':return { title: m.storyboardTitle, desc: m.storyboardDesc };
    default:               return { title: m.allTitle,        desc: m.allDesc };
  }
}, [selectedMaterialType, t]);
```

**新空态分支替换 1987–2014**:
```tsx
{isFilteredEmpty ? (
  <div className="flex flex-col items-center justify-center py-12 px-4">
    <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center mb-4">
      <svg className="w-8 h-8 text-muted-foreground" ...>
        <path .../>
      </svg>
    </div>
    <h3 className="text-lg font-medium text-foreground mb-2">{emptyHint.title}</h3>
    <p className="text-sm text-muted-foreground text-center max-w-sm">{emptyHint.desc}</p>
    <p className="text-sm text-muted-foreground text-center max-w-sm mt-2">
      {t.materialsPanel.empty.dragHint}
    </p>
  </div>
) : (
  <div className="grid grid-cols-3 gap-3">
    /* ...原 grid 渲染保留... */
  </div>
)}
```

i18n schema (interface `materialsPanel` 块紧跟 `noMaterials`/`emptyDescription` 后；EN 3372+ / ZH 6077+；保留旧 `noMaterials`、`emptyDescription` 两 key 不删):

```ts
// interface
empty: {
  allTitle: string;        allDesc: string;
  videoTitle: string;      videoDesc: string;
  audioTitle: string;      audioDesc: string;
  imageTitle: string;      imageDesc: string;
  frameTitle: string;      frameDesc: string;
  characterTitle: string;  characterDesc: string;
  sceneTitle: string;      sceneDesc: string;
  storyboardTitle: string; storyboardDesc: string;
  dragHint: string;
};
```

ZH 文案（EN 镜像）:
- `allTitle` "暂无素材" / `allDesc` "素材库为空，使用「上传素材」或「AI 创建」开始添加"
- `videoTitle` "暂无视频素材" / `videoDesc` "点击「上传素材」上传视频，或「搜索视频」从素材库添加"
- `audioTitle` "暂无音频素材" / `audioDesc` "点击「上传素材」上传音频，或使用 AI 创建生成 TTS"
- `imageTitle` "暂无图片素材" / `imageDesc` "点击「上传素材」上传图片，或「AI 创建」生成图片"
- `frameTitle` "暂无帧素材" / `frameDesc` "使用「视频处理 → 视频帧提取」从视频中抽取帧"
- `characterTitle` "暂无人物建模包" / `characterDesc` "使用「AI 人物建模」生成"
- `sceneTitle` "暂无场景包" / `sceneDesc` "使用「AI 场景建模」生成"
- `storyboardTitle` "暂无分镜包" / `storyboardDesc` "点击「AI 图像生成」创建分镜包"
- `dragHint` "或者直接拖拽文件到此处上传"

合计 17 key。

### Bug #4 — 时间轴 effects/transitions Coming Soon 标记 (PR-C)

```tsx
// TimelineToolbar.tsx 179–200
{
  id: 'effects',
  action: onAddEffect,
  icon: (...),
  label: t.timeline.toolbar.effects,
  shortcut: t.timeline.shortcuts.effectsShortcut,
  comingSoon: true,
  disabled: true,
},
{
  id: 'transitions',
  action: onAddTransition,
  icon: (...),
  label: t.timeline.toolbar.transitions,
  shortcut: t.timeline.shortcuts.transitionsShortcut,
  comingSoon: true,
  disabled: true,
},
```

`renderIconButton` 的 `title`/`aria-label` 增量（沿用方案 A，复用 `t.timeline.messages.featureComingSoon`）：
```tsx
<button
  ...
  disabled={button.disabled}
  aria-label={
    button.comingSoon
      ? `${button.label} — ${t.timeline.messages.featureComingSoon}`
      : (button.shortcut ? `${button.label} (${button.shortcut})` : button.label)
  }
  title={
    button.comingSoon
      ? t.timeline.messages.featureComingSoon
      : (button.shortcut ? `${button.label} (${button.shortcut})` : button.label)
  }
>
```

`TimelinePanel.tsx:625-631` 的 handler 不删（快捷键仍可触发），统一短文案：
```tsx
const handleAddEffect = useCallback(() => {
  showInfo(t.timeline.messages.featureComingSoon, 3000);
}, [showInfo, t]);

const handleAddTransition = useCallback(() => {
  showInfo(t.timeline.messages.featureComingSoon, 3000);
}, [showInfo, t]);
```

**i18n: 不新增任何 key**（复用 `t.timeline.messages.featureComingSoon`）。

### Bug #5 — 用户管理统计与列表口径一致 (PR-D)

```python
# user_service.py get_user_stats — 加 base_filter
async def get_user_stats(self, db: AsyncSession, current_user: Optional[User] = None) -> Dict[str, Any]:
    try:
        # Apply same permission filter as get_all_users:
        # - admin caller: exclude admin and root from stats (matches list view)
        # - root caller: show all (root sees everything; matches list view minus self)
        base_filter = []
        if current_user is not None and not current_user.is_root:
            base_filter = [User.is_admin == False, User.is_root == False]

        def _scalar(extra=None):
            stmt = select(func.count(User.id))
            for f in base_filter:
                stmt = stmt.where(f)
            if extra is not None:
                stmt = stmt.where(extra)
            return stmt

        total          = (await db.execute(_scalar())).scalar() or 0
        admin_count    = (await db.execute(_scalar(User.user_role == "admin"))).scalar() or 0
        premium_count  = (await db.execute(_scalar(User.user_role == "premium"))).scalar() or 0
        regular_count  = (await db.execute(_scalar(User.user_role == "regular"))).scalar() or 0
        active_count   = (await db.execute(_scalar(User.is_active == True))).scalar() or 0
        disabled_count = (await db.execute(_scalar(User.is_active == False))).scalar() or 0
        online_count   = (await db.execute(_scalar(User.active_session_token.isnot(None)))).scalar() or 0

        return {
            "success": True,
            "message": "用户统计获取成功",
            "data": {
                "total_users": total,
                "admin_count": admin_count,
                "premium_count": premium_count,
                "regular_count": regular_count,
                "active_count": active_count,
                "disabled_count": disabled_count,
                "online_count": online_count,
            }
        }
    except Exception as e:
        logger.error("Get user stats exception", {"error": str(e)})
        return {"success": False, "message": "用户统计获取失败", "error_code": "QUERY_ERROR"}
```

router 已传 `current_user`（`user_router.py:780`），无需改动。前端无需改动。

> **预期口径**：
> - admin 调用：stats.total = list.total（admin/root 都排除）→ 主报告场景的 "总用户 2 vs 列表 1" 修正为 "1 vs 1"。
> - root 调用：stats.total = 全量；list.total = 全量 - self（root 自身）。差 1 是 root 的明确语义。

### Bug #6 — 头脑风暴 nav 入口 (PR-E)

```tsx
// Taskbar.tsx:187-193
<button
  type="button"
  onClick={(e) => {
    e.preventDefault();
    showInfo?.(t.tasks.brainstormingComingSoon, 3000);
  }}
  className="w-full px-4 py-2 text-left flex items-center space-x-3 opacity-50 cursor-not-allowed"
  aria-disabled="true"
  title={t.tasks.brainstormingComingSoon}
>
  {getTaskIcon('brainstorm')}
  <span className="text-sm">{t.tasks.brainstorming}</span>
  <span className="ml-auto text-[10px] text-muted-foreground border border-border rounded px-1">
    {t.landing.comingSoonBadge}  {/* ⬅ 复用 iter3 已有 key */}
  </span>
</button>
```

> 需确认 `Taskbar` 当前是否已有 `useNotification` 引入；若无，按 iter2 模式新增 `import { useNotification } from '@/contexts/NotificationContext';` 与 `const { showInfo } = useNotification();`。如风险，可退化为 `aria-disabled`+`title` 仅做提示，去掉 `onClick` toast。

```tsx
// Container.tsx:268-283 占位页加 Coming Soon 徽章
{activeTask.type === 'brainstorm' && (
  <div className="flex-1 flex items-center justify-center bg-background">
    <div className="text-center max-w-md">
      <div className="w-20 h-20 bg-primary/10 rounded-full mx-auto mb-6 flex items-center justify-center">
        <svg .../>
      </div>
      <div className="inline-flex items-center gap-2 mb-2">
        <h2 className="text-2xl font-semibold text-foreground">{t.tasks.brainstorming}</h2>
        <span className="text-xs px-2 py-0.5 border border-primary/30 text-primary/80 rounded-full">
          {t.landing.comingSoonBadge}  {/* ⬅ 复用 iter3 已有 key */}
        </span>
      </div>
      <p className="text-muted-foreground mb-1">{t.common.underDevelopment}</p>
      <p className="text-sm text-muted-foreground/80">{t.landing.comingSoonHint}</p>
    </div>
  </div>
)}
```

i18n 新增 **1 个** key（interface `tasks` 块 line 512+ / EN 3197+ / ZH 5902+）：
| key | EN | ZH |
|---|---|---|
| `tasks.brainstormingComingSoon` | "Brainstorming is coming soon." | "头脑风暴功能即将推出" |

> **不新增** `tasks.comingSoonBadge`（用 `landing.comingSoonBadge`）。

### Bug #7 — workflow 组件 console 噪音治理 (PR-B)

按 §C2/C3 原则：
- 替换映射：`console.log/info → dlog`；`console.warn → dwarn`；**`console.error` 全部保留**。
- 路径：`@/lib/utils/debugLog`（不是 `@/lib/debugLog`）。
- 工具：用 `Edit` 工具按行替换；不使用全文 sed/PowerShell（避免破坏注释/字符串字面量）。
- 文件清单（仅 4 个，**不**包括 nodes/、ConfigPanels/、ExecutionProcessPanel.tsx 等同目录次要文件）：
  - `src/components/workflow/WorkflowInterface.tsx` (60 console，约 49 个 log/info → dlog)
  - `src/components/workflow/WorkflowSidebar.tsx` (10 console，全 log)
  - `src/components/workflow/WorkflowCanvas.tsx` (50 console)
  - `src/components/workflow/WorkflowExecutor.ts` (63 console；**保留** ~14 个 error/warn)
- 每个文件顶部确保有 `import { dlog, dwarn } from '@/lib/utils/debugLog';`。

> 验证：替换后 `grep -nE '\bdlog\.(log|info|error|warn)\b' src/components/workflow/` **必须返回 0 行**（确认没有错误的 `dlog.X` 调用）。

---

## 4. i18n 新增 key 汇总表

| Bug | path | EN | ZH | 三处坐标 (interface / EN / ZH 锚点) |
|---|---|---|---|---|
| #2 | `workflowInterface.editor.runHintNoWorkflow` | "Select a workflow first." | "请先选择一个工作流" | i18n.ts:633 之前 / 3308 块 / 6013 块 |
| #2 | `workflowInterface.editor.runHintMissingStart` | "Add a Start node before running." | "请先添加 Start 节点再运行" | 同上 |
| #3 | `materialsPanel.empty.allTitle/allDesc/videoTitle/...storyboardDesc/dragHint` (17 key) | 见 §3 Bug #3 | 见 §3 Bug #3 | i18n.ts:837 之后 / 3386 之后 / 6091 之后 |
| #6 | `tasks.brainstormingComingSoon` | "Brainstorming is coming soon." | "头脑风暴功能即将推出" | i18n.ts:516 后 / 3200 块 / 5905 块 |

合计 **20 key**（plan 原方案 22；C6/C7 各省 1，C7 复用 1）。

> 每加完一组 key 后立即跑 `npm run type-check`（iter3 教训：interface 漏写会导致整体 type-check 失败）。

---

## 5. 测试方案

### 5.1 vitest 新增

| 文件 | 覆盖 |
|---|---|
| `src/lib/__tests__/sanitizeError.test.ts` | sanitizeErrorMessage：sqlalche.me/greenlet/asyncpg 命中 → fallback；长度 > 240 → fallback；普通短消息透传 |
| `src/components/workflow/__tests__/WorkflowInterface.runGate.test.tsx` | 0 节点 → disabled+title hint missingStart；含 start node → 启用；无 activeWorkflow → disabled+noWorkflow hint |
| `src/components/video/components/MaterialsPanel/__tests__/MaterialsPanel.emptyHint.test.tsx` | filter=image + materials=[audio] → 显示 "图片" 文案；filter=frame_pack + 全空 → 显示 "帧素材" + "视频帧提取" 引导 |
| `src/components/video/timeline/__tests__/TimelineToolbar.comingSoon.test.tsx` | effects/transitions 按钮 disabled=true，title 包含 featureComingSoon 文案 |
| `src/components/__tests__/Taskbar.brainstorm.test.tsx` | brainstorm 菜单项 aria-disabled="true"；点击调用 showInfo (toast) 而非 onAddTask |
| `src/components/workflow/__tests__/console-hygiene.test.tsx` | 在 NODE_ENV=production 模拟下 spy(console, 'log') 调用次数为 0；window.__ECLIPTRIX_DEBUG__=true 时再次激活 |

### 5.2 pytest 新增

| 文件 | 覆盖 |
|---|---|
| `backend-services/basic-service/tests/test_agent_workflow_service.py` | save_workflow 新建 → 返回 success=True，data.created_at/updated_at 非空 isoformat；二次保存（更新分支）→ version 自增 + 不抛 greenlet 错误；模拟 db.flush 抛 RuntimeError → 返回 message="Failed to save workflow"（不含 str(e)） |
| `backend-services/basic-service/tests/test_user_stats_consistency.py` | seed: 1 root + 1 admin + 2 regular。admin 调用 stats → total=2（与 list 一致）；root 调用 stats → total=4，list → 3（self 排除） |

### 5.3 手动验证清单

- [ ] **Bug #1**: 保存空工作流 → 200 + toast 显示成功；模拟 service 异常 → toast "Failed to save workflow"，无 sqlalche.me URL。
- [ ] **Bug #2**: 进入空工作流 → 运行按钮灰显 + tooltip "请先添加 Start 节点再运行"；点击不触发；console 无 `Execution error: Error: No Start node`。
- [ ] **Bug #3**: BugTest 项目（仅 1 audio）切到 video/image/frame/character/scene → 各自空态文案匹配；切到 audio → 显示 audio 卡片（非空态）；切到 all → 显示该 audio。
- [ ] **Bug #4**: 时间轴 effects/transitions 按钮灰显 + tooltip "Coming soon"/"功能开发中"；按 E / T 快捷键弹同一文案 toast。
- [ ] **Bug #5**: 重新登录 admin → 用户管理统计卡 "总用户数" = 表格 "共 N 条"；root 登录看到完整 stats。
- [ ] **Bug #6**: 顶部新建任务菜单 "头脑风暴" 灰显 + Coming Soon 徽章；点击不创建 tab，弹 toast；旧 brainstorm tab 占位页有 Coming Soon 徽章。
- [ ] **Bug #7**: `npm run build && npm run start` → 工作流页 console 仅剩白名单日志（LocalAudioManager / Auth / 真实运行期错误）；无 `[WorkflowInterface] Active workflow` / `[WorkflowSidebar] Rendering` / `[WorkflowCanvas] Rendering`。
- [ ] **回归**: iter1/2/3 共 21 项不退化。

---

## 6. PR 分组与执行顺序

| 顺序 | PR | Bug | 依赖 |
|---|---|---|---|
| 1 | **PR-A 后端 Critical + 错误脱敏** | #1 | 无；阻断其它 PR |
| 2 | **PR-B 工作流闸门 + 日志洁化** | #2 + #7 | dlog 存在（已存在） |
| 3 | **PR-C 视频编辑器 i18n & UX** | #3 + #4 | 无 |
| 4 | **PR-D 用户统计口径** | #5 | 无 |
| 5 | **PR-E 全站 coming-soon 一致性** | #6 | 无 |

**可并行**: PR-B/C/D/E 互不依赖；但 PR-A 必须先 ship。

每完成一个 PR：
1. `npm run type-check` (vitest 路径)
2. `pytest tests/test_<新文件>.py -v` (后端路径)
3. `npm run build` 一次冒烟
4. 用 `dev/deploy_dev_20260420.py` 推 dev server 复测一次

---

## 7. 风险一览

| 区域 | 风险 | 缓解 |
|---|---|---|
| `db.refresh(attribute_names=...)` | 单行 SELECT 性能影响 | 仅 created_at/updated_at 两列；对保存路径的 1-行场景可忽略 |
| service+router 双层脱敏 | 误拦截短业务消息（如 "Workflow not found"） | sanitizeErrorMessage 仅在长度>240 或匹配 SQL 关键字时回退；普通短消息透传 |
| dlog 替换批量操作 | 误改字符串/注释 | **强制** 用 Edit 工具按行；完成后 `grep -nE 'dlog\\.(log\|info\|error\|warn)'` 必须返回 0 |
| MaterialsPanel emptyHint useMemo 依赖 | 漏写 t 依赖导致 locale 切换不刷新 | useMemo deps 包含 `[selectedMaterialType, t]` |
| Bug #5 admin 视角 admin_count=0 | 用户困惑 | 文案/aria-label 可加 "(不含管理员)" 注解（可选；非必需） |
| Taskbar useNotification 引入 | 改动文件过大 | 退化方案：去掉 onClick toast，仅 aria-disabled+title 提示 |

---

## 8. Step-4 实施前检查表

- [ ] dlog import 路径 `@/lib/utils/debugLog`（**不是** `@/lib/debugLog`）
- [ ] dlog API 用 `dlog(...)` / `dwarn(...)`（**不是** `dlog.log/error`）
- [ ] `console.error` / `console.warn` **全部保留**（除 Bug #2 的 No-Start 早返路径）
- [ ] service + router 两层都改为脱敏 message
- [ ] MaterialsPanel 用 `isFilteredEmpty` 替代旧的 `materials.length === 0 && allPacks 全 0` 条件
- [ ] Bug #6 复用 `landing.comingSoonBadge` / `landing.comingSoonHint`，仅新增 `tasks.brainstormingComingSoon`
- [ ] Bug #4 复用 `timeline.messages.featureComingSoon`，**不新增** key
- [ ] 不修改 `VerticalTaskbar.tsx`
- [ ] 每加一组 i18n key 立即 `npm run type-check`
- [ ] 完成后 `npm run build` 全量冒烟 + dev server 部署复测

---

## 9. 准备就绪

本审查方案在 plan 基础上修正了 9 处问题（其中 2 项 Critical 编译错误），所有 line numbers 与 HEAD `9abd7a7` 复核一致，可直接进入 Step 4 执行阶段。
