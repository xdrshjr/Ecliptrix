# Web Bug Report — 2026-05-09 (iter4)

## 元信息

- **轮次**: iter4 / 第 4 轮
- **测试目标**: http://192.168.1.123:3010 (dev server)
- **生产分支 commit (HEAD)**: 9abd7a7 (iter3 review-report)
- **浏览器**: Microsoft Edge (msedge, headed, persistent profile)
- **账户**: admin (`ec37fe18-48be-4db8-9667-2c34a7cba6a6`, isAdmin=true)
- **测试时间**: 2026-05-09 19:06–19:16 (UTC+8)
- **测试方式**: playwright-cli + 手动结合，全量 snapshot/截图/console/network 留痕
- **覆盖范围**: 前 3 轮未深入触及的模块 — 视频编辑器素材面板筛选、视频处理面板、特效/转场工具条、用户管理（添加/列表/统计）、工作流编辑器（保存、运行、节点画布）、locale 切换、新建项目对话框
- **证据目录**: `.web-debugger/{snapshots,screenshots,logs}` (本地 dev 调试输出，已 gitignore)
- **未触发的旧 Bug**: 已重新核验 iter1/iter2/iter3 的 21 个 Bug 修复点（Cover modal WYSIWYG、登录鉴权、TTS 校验、a11y、html lang、ModelSettings form、ChatType modal sort、LandingPage brainstorm、TimelineExport disable、useTasks 持久化等），均无回归。

---

## Bug #1 — 保存工作流时后端 500，且原始 SQLAlchemy 错误字符串外泄到用户提示

- **严重程度 (Severity)**: **Critical** (P0)
- **优先级 (Priority)**: P0 — 阻断"工作流"模块整条工作流持久化路径
- **位置**:
  - 触发入口：工作流页 → 任意工作流（含全新空工作流）→ 顶部"保存"按钮
  - 后端接口：`POST /api/workflow/agent/save` 返回 `500 Internal Server Error`
  - 后端代码线索：`backend-services/basic-service/app/services/workflow_*` / `app/database.py`（async session / greenlet 边界相关）
  - 前端展示：右上角 alert toast，包含原始后端错误字符串与官方 SQLAlchemy 错误页 URL

### 复现步骤

1. 登录 admin → 顶部导航点击"工作流"
2. 任选一个工作流（例如 "New Workflow"）→ 点击"工作流界面"
3. 不做任何修改，直接点击右上角"保存"按钮
4. 观察右上角弹出的红色 alert 与浏览器 Network 面板

### 预期行为

- `POST /api/workflow/agent/save` 返回 200 / 422 / 409 等明确语义状态码
- 即便后端发生异常，前端也只应展示"保存失败，请稍后重试"或类似经过脱敏的提示，**绝不应该**把数据库实现细节、SQLAlchemy 类名、官方错误页 URL 透传给最终用户

### 实际行为

- 后端返回 `500 Internal Server Error`
- 前端弹出 alert，原文为：

  > Failed to save workflow: greenlet_spawn has not been called; can't call await_only() here. Was IO attempted in an unexpected place? (Background on this error at: https://sqlalche.me/e/20/xd2s)

- 含义：后端 async SQLAlchemy 在非 greenlet 上下文里发起了 `await_only()`（典型场景：在同步代码或非 async session 中触发 lazy-load / autoflush），引发执行失败。这是一个真正的后端 Bug，不是网络瞬态错误。

### 证据

- `network`: `[POST] http://192.168.1.123:3010/api/workflow/agent/save => [500] Internal Server Error`
- `snapshot`: `.web-debugger/snapshots/iter4-wfsave-191446.yaml`（包含 alert e1873 完整文案）
- 截图：`.web-debugger/screenshots/iter4-wfrun-empty-191433.png`

### 修复建议方向

- **后端**：定位 `save_agent_workflow` 等保存路径中触发 lazy load / 非 async 操作的位置；要么使用 `await session.refresh(...)`，要么提前 `selectinload`/`joinedload` 关联，或用 `await session.run_sync(...)` 包裹同步代码块
- **前端**：在 toast/alert 处增加错误脱敏层（参考 iter2 修复 `WorkflowLogPanel` 的 `safeStringify` 思路），把后端 500 映射为统一友好文案；保留可折叠的"详细信息"区域以便开发模式下的调试
- 双重防御：后端 `BaseResponse.error_details` 在生产环境 (`ENV=production`) 应裁剪 traceback / DSN / SQLAlchemy URL

---

## Bug #2 — 工作流"运行"按钮在 0 节点时仍可点击，触发未捕获 Error 写入 console

- **严重程度**: Medium (P1)
- **优先级**: P1 — 影响新手对工作流的第一次体验，且每次 0-节点点击都会污染 console
- **位置**:
  - 入口：工作流编辑器（`WorkflowCanvas` / `WorkflowInterface`）右上角"运行"按钮
  - 错误源：浏览器 console — `[ERROR] [WorkflowExecutor] Execution error: Error: No Start node found in workflow` (栈顶 `Q.execute`)
  - 前端代码线索：`src/lib/workflow/WorkflowExecutor*.ts`、`src/components/workflow/Toolbar*.tsx`

### 复现步骤

1. 顶部导航 → 工作流 → 选中"New Workflow"（节点: 0，连接: 0）
2. 点击"工作流界面"
3. 此时画布为空，画布提示语为 "右键点击画布任意位置添加您的第一个节点"
4. 直接点击右上角"运行"按钮
5. 打开 DevTools Console 查看错误

### 预期行为

- "运行"按钮在 `nodes.length === 0` 或缺失 Start 节点时应当 **disabled** 并提供 `title`/`aria-label` 说明（例如"请先添加 Start 节点"）
- 即便保留启用状态，也应通过 toast / inline 提示给用户而不是 `console.error` 抛出 `Error`

### 实际行为

- 按钮始终可点击（与 iter3 修复 VideoPlayerPanel 导出按钮的"内容缺失即 disable"思路不一致）
- 点击后 console 打印 `Error: No Start node found in workflow` 与完整堆栈
- 执行日志面板里也写入一条红色"Workflow execution failed: No Start node found in workflow"日志（这部分 UX 是好的，但 console.error 是噪音）

### 证据

- `console error`: `[ERROR] [WorkflowExecutor] Execution error: Error: No Start node found in workflow ...`
- `snapshot`: `.web-debugger/snapshots/iter4-wfrun-empty-191433.yaml`（含 alert e1864 "1 个错误" 计数）

### 修复建议方向

- 沿用 iter3 Bug#6 的 `useMemo` 闸门思路：派生 `hasStartNode = useMemo(() => nodes.some(n => n.type === 'start'), [nodes])`；`disabled = isRunning || !hasStartNode`
- 同步刷新 `title` / `aria-label` 两路文案；i18n 新增 key（`workflow.runEmptyHint` / `workflow.runMissingStart`）
- `WorkflowExecutor` 内部把 "no start node" 这种业务错误从 `throw new Error` 降级为返回值 `{ ok: false, reason: 'no_start_node' }`，避免 console.error 噪音

---

## Bug #3 — 视频编辑器素材库筛选标签的空状态文案与所选筛选类型不匹配

- **严重程度**: Medium (P1) — 误导用户，破坏多类型素材的发现路径
- **优先级**: P1
- **位置**:
  - 入口：视频编辑器（任意项目）→ 右侧"素材管理"面板 → 筛选标签（全部/视频/音频/图片/分镜包/人物包/场景包/帧）
  - 前端代码线索：`src/components/video/MaterialPanel*.tsx` 或同目录下的 `EmptyState.tsx`

### 复现步骤

1. 进入任一视频项目（例如 BugTest，URL `?tab=video&task=...`）
2. 在右侧素材管理面板，选中"图片"或"帧"标签（注意 BugTest 当前只有 1 个音频素材，因此切到这两个类型会进入空状态）
3. 观察空状态文案

### 预期行为

- 文案应当与所选类型匹配，例如：
  - 选"图片"：`图片库为空，点击"上传素材"添加图片，或点击"AI 创建"生成图片`
  - 选"帧"：`暂无帧素材，使用「视频处理 → 视频帧提取」从视频中抽取帧后即可使用`
  - 选"分镜包"：`暂无分镜包，使用「AI 分镜」生成`（已正确显示"暂无分镜包"标题，但下方说明仍指向"搜索视频"）

### 实际行为

- 切到"帧"或"图片"筛选时，空状态标题为"暂无素材"，描述固定为：
  > 素材库为空，点击下方「搜索视频」按钮来添加高质量的视频素材
- 即用户已经选了非视频类型，提示却仍引导他们去添加"视频素材"，且引用的"搜索视频"按钮在该面板上下文里也并不显眼（实际操作入口是顶部的"上传素材"或"AI 创建"）

### 证据

- `snapshot`（图片筛选）：`.web-debugger/snapshots/iter4-img-filter-190957.yaml` 第 197–198 行：
  ```
  - heading "暂无素材" [level=3] [ref=e978]
  - paragraph: 素材库为空，点击下方「搜索视频」按钮来添加高质量的视频素材
  ```
- `snapshot`（帧筛选）：`.web-debugger/snapshots/iter4-frame-filter-190943.yaml` 第 197–198 行（同样文案）

### 修复建议方向

- 把空态文案改为 i18n key 表，按当前筛选类型 (`activeFilter`) 索引：
  ```ts
  const emptyHint = {
    all: t('material.empty.all'),
    video: t('material.empty.video'),
    audio: t('material.empty.audio'),
    image: t('material.empty.image'),
    storyboard: t('material.empty.storyboard'),
    character: t('material.empty.character'),
    scene: t('material.empty.scene'),
    frame: t('material.empty.frame'),
  }[activeFilter];
  ```
- 同步本地化 EN + ZH，参考 iter3 Bug#4 引入 8 个新 key 时的 schema 三处同步（interface / EN / ZH）

---

## Bug #4 — "特效 (E)" / "转场 (T)" 工具条按钮以正常状态展示，但功能为开发占位

- **严重程度**: Low (P2) — 用户被诱导点击，得到"功能开发中"提示
- **优先级**: P2
- **位置**:
  - 入口：视频编辑器底部时间轴工具条右侧 — `特效 (E)` (ref=e663) 与 `转场 (T)` (ref=e668)
  - 同区域的 `字幕 (S)` 是真实可用的，加深了用户对前两者也可用的预期

### 复现步骤

1. 进入任一视频项目
2. 不选中任何片段，点击工具条上的"特效 (E)"按钮
3. 观察弹层文案
4. 同样测试"转场 (T)"

### 预期行为

如果功能未上线：
- 按钮应当 `disabled` + `title="特效功能开发中，敬请期待"`，并在视觉上加灰
- 或在下拉前先弹"功能开发中"toast，避免用户多花一次点击成本

### 实际行为

- 两个按钮均处于完全启用、悬停高亮的状态，并支持 `[active]` 标记
- 点击后弹出对话框，文案分别为：
  - 特效：`请先在时间轴上选中片段，再添加特效。（功能开发中）`
  - 转场：`请先选中两段相邻片段，再添加转场。（功能开发中）`
- 用户即便去时间轴选中片段，仍然得到同样的"功能开发中"标语 — 即引导本身是死路

### 证据

- `snapshot`（特效）：`.web-debugger/snapshots/iter4-effects-190747.yaml` 第 444 行：
  ```
  - generic [ref=e876]: 请先在时间轴上选中片段，再添加特效。（功能开发中）
  ```
- `snapshot`（转场）：`.web-debugger/snapshots/iter4-trans-190805.yaml`：
  ```
  - generic [ref=e885]: 请先选中两段相邻片段，再添加转场。（功能开发中）
  ```

### 修复建议方向

- 复用 iter3 Bug#5 LandingPage `comingSoon` 模式：在按钮配置里增加 `comingSoon: true`，统一控制 `disabled` + `title` + 视觉变灰
- 或引入"开发中"角标徽章，与"字幕"按钮做强视觉区分

---

## Bug #5 — 用户管理统计卡与表格条目数不一致（总用户数 2，但表格只列 1 行）

- **严重程度**: Medium (P1) — 影响管理员对系统真实用户规模的判断
- **优先级**: P1
- **位置**:
  - 入口：管理员设置 → 用户管理 (`UserManagement.tsx`)
  - 后端接口：
    - `GET /api/admin/users/stats` → `total=2, admin=1, normal=1, active=2`
    - `GET /api/admin/users/list?page=1&page_size=10&...` → `共 1 条`，仅返回非 admin 用户

### 复现步骤

1. admin 登录
2. 顶部导航 → 管理员设置 → 用户管理
3. 对比顶部 6 个统计卡（总用户数 / 管理员 / 高级用户 / 普通用户 / 激活 / 在线）与下方表格"共 N 条"

### 预期行为

二者应当对齐：
- 方案 A：统计卡也排除当前 admin 自己（与列表口径一致）
- 方案 B：列表也包含 admin（与统计卡一致），且禁用对自己的"删除/降权"等危险操作
- **不论选哪种**，"共 1 条" 与 "总用户数 2" 不该并列

### 实际行为

- 统计卡：`总用户数: 2`、`管理员用户: 1`、`普通用户: 1`、`激活: 2`、`在线用户: 1`
- 表格：仅 1 行 `T test test@local.dev 普通用户 已启用 - 2026/03/17 00:31`
- 表格底部 footer：`共 1 条`

### 证据

- `network`:
  - `[GET] /api/admin/users/list?...` → 200，但 body 只返回 1 条
  - `[GET] /api/admin/users/stats` → 200，stats.total=2
- `snapshot`：`.web-debugger/snapshots/iter4-usermgmt-191221.yaml` 第 109/189–193 行
- 截图：`.web-debugger/screenshots/iter4-usermgmt-191221.png`

### 修复建议方向

- 后端：在 `users/list` 中可选地包含 `current_user_id`（前端用 `disabled-row + locked` 渲染），并保持统计与列表同源；推荐方案 B（列表带上 admin，但对自身行禁用敏感操作）
- 前端：若坚持方案 A，则 `users/stats` 也减去 admin 自己（口径一致），并在 i18n 上写明"不含您自己"

---

## Bug #6 — 头脑风暴顶部导航条目仍可点击进入"功能开发中"占位页（iter3 修复未覆盖此入口）

- **严重程度**: Low (P2)
- **优先级**: P2 — 并非阻断性，但与 iter3 在 LandingPage / Container 上做的 coming-soon 引导不一致
- **位置**:
  - 入口：顶部主导航 `头脑风暴` (snapshot ref=e109 / e1644 等)
  - 目标页面：路径 `?tab=brainstorm` → 显示 heading "头脑风暴" + "功能开发中..." 占位
  - 前端代码线索：`src/components/layout/Header*.tsx` / 主导航组件、tab 路由分发

### 复现步骤

1. 任意页面，点击顶部导航的"头脑风暴"按钮
2. 观察跳转后的页面与导航条目状态

### 预期行为

- iter3 已为 LandingPage 的"头脑风暴"特性卡和 Container 中的相关入口添加 `comingSoon` + `cursor-not-allowed` + 无障碍 hint
- 顶部主导航里的同名条目应当与之对齐：
  - 选项 A：也加 `aria-disabled` + `title="即将推出"`，点击不路由
  - 选项 B：保留路由，但目标页给出与 LandingPage 卡片一致的"开发中"组件，避免出现"另一种风格"的占位

### 实际行为

- 头部"头脑风暴"完全可点击，且无 disabled / title 提示
- 跳转目标是一个最简化的 placeholder 页：
  - heading "头脑风暴"
  - paragraph "功能开发中..."
  - paragraph "该功能正在开发中，敬请期待。"
- 与 iter3 在 LandingPage 给出的 `comingSoonHint` 完全不同款，体感像两段不同人写的占位

### 证据

- `snapshot`（点击进入后）：`.web-debugger/snapshots/iter4-brainstorm-191318.yaml`：
  ```
  - heading "头脑风暴" [level=2] [ref=e1652]
  - paragraph: 功能开发中...
  - paragraph: 该功能正在开发中，敬请期待。
  ```

### 修复建议方向

- 在导航 schema 上引入 `comingSoon: true` 标志（与 iter3 LandingPage feature 数组同款），统一渲染为 `aria-disabled="true"` + `cursor-not-allowed`，点击 `preventDefault`
- 或保留导航可点击，但把 `?tab=brainstorm` 路由的占位页统一替换为 iter3 中 `BrainstormingPlaceholder` 风格组件（如还没有可考虑抽出）

---

## Bug #7 — 工作流相关组件在生产环境产生大量 [LOG] console 噪音（与 iter2 ChatInterface 修复同类问题）

- **严重程度**: Low (P2) — 不阻断功能，但污染 console、增大 prod 排错成本
- **优先级**: P2
- **位置**:
  - 触发组件：`WorkflowInterface` / `WorkflowSidebar` / `WorkflowCanvas`
  - 现象：每次渲染（即使 0 改动）都打印多行 `[LOG]`，单次切换 tab 即产生 10+ 行
  - 前端代码线索：`src/components/workflow/WorkflowInterface.tsx`、`WorkflowSidebar.tsx`、`WorkflowCanvas.tsx`

### 复现步骤

1. 顶部导航 → 工作流
2. 任意点击工作流卡片或在"聊天界面/工作流界面"之间切换
3. 打开 DevTools Console，观察 `[LOG]` 行的增长

### 预期行为

- 与 iter2 Bug#4 修复一致：通过 `dlog`（`src/lib/debugLog.ts`）封装的 logger，仅在 `NODE_ENV !== 'production'` 或 `window.__ECLIPTRIX_DEBUG__ === true` 时输出
- 生产 console 应保持干净（只剩 LocalAudioManager 等真正必要的运行期信息）

### 实际行为

console 中频繁出现以下日志（取自 1 次 tab 切换）：

```
[LOG] [WorkflowInterface] Active workflow: {activeWorkflowId: workflow-..., activeWorkflowName: New Workflow, nodesCount: 0}
[LOG] [WorkflowInterface] Active chat state: {workflowId: workflow-..., messagesCount: 0, contextCleared: false}
[LOG] [WorkflowSidebar] Rendering sidebar: {workflowsCount: 3, activeWorkflowId: workflow-..., timestamp: 2026-05-09T11:14:46.955Z}
[LOG] [WorkflowCanvas] Rendering canvas: {nodesCount: 0, connectionsCount: 0, selectedNodeId: null, selectedConnectionId: null, scale: 1}
[LOG] [WorkflowInterface] Rendering interface: {...}
[LOG] [WorkflowInterface] Restoring UI state: {...}
... (重复 2 轮)
```

### 证据

- `console`（保存空工作流后即时抓取）：`.web-debugger/snapshots/iter4-wfsave-191446.yaml` 节点附近，console 段含 `L96–L133` 与 `L134–L145` 两批新条目，全部为 `[LOG]` 级别

### 修复建议方向

- 把上述组件里的 `console.log(...)` 调用替换为 iter2 已经引入的 `dlog(...)`（`src/lib/debugLog.ts`）
- 同步搜索：`grep -rn "console.log\(\[Workflow" src/components/workflow` 一次性替换
- 验证：生产 build (`npm run build && npm run start`) 后 console 应当只剩白名单内的运行期日志

---

## 优先级与修复路径汇总

| # | 严重度 | Bug | 推荐 PR 分组 |
|---|-------|-----|------------|
| 1 | **Critical** | 工作流保存 500 + 后端原始 SQL 错误外泄 | PR-A: 后端 async session 修复 + 前端错误脱敏 |
| 2 | Medium | 0 节点工作流"运行"按钮触发 console error | PR-B: 工作流 UX 闸门 (run-disabled / save 容错) |
| 3 | Medium | 素材库筛选空态文案与类型不匹配 | PR-C: 视频编辑器 i18n & UX |
| 4 | Low | 特效/转场按钮以可用形式露出但实为占位 | PR-C: 视频编辑器 i18n & UX |
| 5 | Medium | 用户管理统计卡与表格行数不一致 | PR-D: 管理员后台数据口径 |
| 6 | Low | 头脑风暴 nav 入口仍可点击 | PR-E: 全站 coming-soon 一致性 |
| 7 | Low | 工作流组件 console 日志噪音 | PR-B: 工作流 UX 闸门（同批） |

> 共 7 个有效 Bug，其中 1 个 Critical、3 个 Medium、3 个 Low —— 满足"至少 5 个"的目标。

---

## 已核验的回归项（无问题）

- iter1 视频封面 modal 8 项（WYSIWYG --cover-px、a11y、color hex 校验、字号 clamp、frame slider keyboard 等）
- iter2 登录 401 / requireAuth 拆分、TTS 校验、Workflow safeStringify、debugLog gating（**仅在 ChatInterface/MessageBubble 范围**）、Project Card a11y、UserManagement 表单 noValidate 等
- iter3 useTasks LS 持久化 + URL 同步、html lang SSR/CSR 同步、ModelSettings form noValidate、ChatType modal sortedWorkflows、LandingPage comingSoon、VideoPlayerPanel hasAnyExportableItem 闸门

---

## 测试设备 & 环境

- OS: Windows 11 Pro 10.0.26200
- Browser: Microsoft Edge (msedge) — playwright-cli 0.1.4，headed + persistent profile
- Frontend: Next.js 15 dev server on http://192.168.1.123:3010
- Backend: FastAPI on http://192.168.1.123:8000（dev server, kt 用户，2x RTX 2080 Ti）
- 网络: 主控 Windows，dev server 为内网 192.168.1.123（per memory `reference_dev_server.md`）
