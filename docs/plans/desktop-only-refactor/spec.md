# Ecliptrix 纯桌面端收敛重构 · 开发方案（spec v4）

| 项 | 值 |
|----|----|
| Feature | `desktop-only-refactor` |
| 文档版本 | **v4（评审后基线 · 可实施）** |
| 基线分支 | `feat/remove-user-system`（HEAD `37719be`） |
| 证据采集日期 | 2026-09-01 |
| 上游文档 | v1 设计 / v2 评审（本轮已合并吸收，见附录 A） |
| 评审状态 | 已评审：3×P0 / 8×P1 / 8×P2 全部在正文修订完毕（见《评审记录》与《评审结论》） |
| 下游节点 | 开发节点按 §9.1 顺序 + §5 文件清单逐项落地；每阶段贴门禁实际输出 |

> **本版与 v2 的关系（务必先读）**
>
> v1/v2 是在**重构尚未开工**时写的：它把 P0～P6 七个阶段都当作"待实施"。
> 本轮实测发现 **P0、P1、P2 已经落在工作区**（438 个文件、109,046 行删除已进
> 暂存区），而 **P3～P6 一行未动**，并且这次"半程实施"**留下了 3 处会让门禁
> 失效的硬伤**。
>
> 因此 v3 不是 v2 的润色，而是**按真实现状重写的可执行基线**：
> §2 是本轮实测的现状复核（谁已落地、怎么验证、哪里坏了），§4/§5 只对**尚未
> 落地的部分**给出逐行实现细节，并新增 **P7（门禁修复与收尾）**。
> 开发节点**不得**重做 §2.1 中标记为"已落地"的工作——重做等于回滚。

---

## 评审记录（Review Notes · v4）

> **评审人**：Anthropic 工程团队高级评审（评审节点）　**评审日期**：2026-09-01
> **评审对象**：本文档 v3 基线（1,052 行）
> **评审方式**：逐节对照 `feat/remove-user-system` 工作区实测。每条结论都附可当场复核的命令，
> 不接受"读起来合理"。
>
> **关于版本号**：上游任务模板要求"评审后把版本标记为 v2"，其语义是"评审后版本"。本文档谱系是
> v1 设计 → v2 评审 → v3 现状重写基线 → **v4 评审后基线**，且 v3 表头「下游节点」栏已约定本轮
> 产出《评审记录 v4》/《评审结论 v4》。因此本轮落章为 **v4**：把编号回退到 v2 会让两份内容完全
> 不同的文档同号，正好制造本次重构要消灭的"第二个事实来源"。

### R.0 先复核"现状复核"

v3 §2 的每一条实测数据都被重新跑过，**全部对得上**：

| 复核命令 | v3 声明 | 评审人实测 | |
|----------|---------|------------|---|
| `git diff --cached --shortstat` | 438 files / 109,046 deletions | 逐字一致 | ✅ |
| `git status --porcelain \| wc -l` | ~485 | 485 | ✅ |
| `npx tsc --noEmit` | exit 0 | exit 0 | ✅ |
| `python -m pytest tests/ -q --co` | 1111 collected, 2 errors | 1111 collected, 2 errors（7.45 s） | ✅ |
| `grep -rn "useAuth()" src/` | 14 | 14 | ✅ |
| `grep -rn "requireAuth" src/` | 38 | 38 | ✅ |
| `find src/app/api -name route.ts \| wc -l` | 122 | 122；待删 19 个逐目录点清（admin 9 + auth 2 + user 2 + rate-limit 3 + workflow 2 + timeline-export 1） | ✅ |
| §2.3 H-1 / H-2 / H-3 | 3 处硬伤 | 逐处定位到行，成因描述准确 | ✅ |
| §2.5 六项死代码 | 零引用 | `workflow/**`、`timeline-export`、`sessionGuard.ts` 均零调用点 | ✅ |
| §4.4 `grep get_current_user app/` | 0 | 0 | ✅ |

**结论：v3 的现状描述可信，可以作为实施基线。** 本轮全部问题集中在"尚未落地部分的可执行性"
与"验收判据的自洽性"，没有一条是"事实说错了"。这在本类文档里少见，值得记一笔。

### R.1 问题清单

| ID | 维度 | 严重度 | 位置 | 结论 |
|----|------|--------|------|------|
| **P0-1** | 完整性 / 可行性 | **P0** | §4.9 · §4.8 · §5-P3 | 删除三个鉴权错误类会同时打断 `tsc` 与 `npm test`，且撞上被本文档标为"不改"的 `ModelSettingsPanel` |
| **P0-2** | 右尺寸 / 一致性 | **P0** | §2.1 · §3.3 · A9 | P0 阶段过删了 309 个 `docs/**`（其中 93 个是**桌面端自身**的缺陷根因档），而源码里 92 处注释指向它们 |
| **P0-3** | 完整性 / 人机交互 | **P0** | §4.6 · D14 | 删掉 `LandingPage` 后全应用**再无任何"新建任务"入口**：关掉最后一个标签页即成死路，只能重启进程 |
| **P1-1** | 完整性 | P1 | §4.7 · §5-P3 | 漏了 `src/app/not-found.tsx`——它 import 了要被重命名的 `DesktopTitleBar`，重命名即断 `tsc` |
| **P1-2** | 可行性 / 一致性 | P1 | §4.11 · A5 · §12.4 | `window-state.test.js` 的"换个键"指令对其中 3 个用例不可执行；且 A5 与 §12.4 的判据互相矛盾 |
| **P1-3** | 可行性 | P1 | §4.11 | `smoke-test.js` 没有渲染进程内省能力，"首屏出现工作区容器"实现不了；同时会丢掉唯一一条端到端 SQLite 读通断言 |
| **P1-4** | 正确性 | P1 | §5-P7 | `tests/conftest.py` 里那个 stub 是 **cv2 stub**（不是为 rate_limiter 装的），按文档"若已无必要则删除"会让整套后端测试无法收集 |
| **P1-5** | 完整性 | P1 | §4.8 | `GeneralSettingsPanel` 的"必须保留"清单漏了 `auto` 模式的 `matchMedia` 系统主题跟随监听 |
| **P1-6** | 完整性 | P1 | §10.1 · §5-P3 | 要改的 `tests/integration/**` 被 `vitest.config.ts` 显式排除，`npm test` 根本跑不到，门禁清单里也没有 `test:integration` |
| **P1-7** | 一致性 | P1 | §10.4 A1 | A1 的 grep 判据与 `test_no_auth_surface.py`、新增前端护栏测试的**负向断言**天然冲突，恒不可满足 |
| **P1-8** | 正确性 | P1 | §4.11 | `prepare-env.js` 并非"无独立凭证分支"：`LOCAL_ADMIN_KEYS` 是活代码常量，不是注释 |
| P2-1 | 精确性 | P2 | §2.3 · §5-P7 | H-3 修复片段把实际字面量 `"测试响应"` 写成 `"中文响应"`；给的 `grep` 字节区间在 Git Bash 下不可靠 |
| P2-2 | 一致性 | P2 | §4.6 | `useLlmConfigStatus(enabled)` 的形参与 docstring 在鉴权消失后语义作废，只会恒传 `true` |
| P2-3 | 完整性 | P2 | §4.9 | http-client 删除清单漏 `SESSION_USER_KEY` / `clearSessionToken` / `isDesktop` 三个导入（最后一个会变成未使用导入，`lint` 报错） |
| P2-4 | 精确性 | P2 | §5-P3 | 设置目录重命名影响 **5** 个测试文件（另有 `components/__tests__/` 两个），不是 3 个 |
| P2-5 | 精确性 | P2 | §5-P3 | `VideoEditingInterface.tsx:142` 的 `user` 是**未使用解构**，全文件零下游用法，删行即可 |
| P2-6 | 完整性 | P2 | §5-P6 | `CLAUDE.md` 过期项不止文档列的两处（另有 `:27`、`:133`、`:150` 与"23 routers"） |
| P2-7 | 精确性 | P2 | §4.1 | 架构图写"30 routers"，实测 `app.include_router` 32 处 |
| P2-8 | 完整性 | P2 | §9.1 | 顺序图缺"第 0 步：先提交现有工作区"（只写在 R-11 里，照图施工会漏） |

**处置**：P0/P1 共 11 条已**直接改入正文**，每处在正文标注 `【v4 评审修订】`；P2 共 8 条成本都在
一两行，一并改入正文，不留待办。

### R.2 P0 详情

#### P0-1 · 删鉴权错误类会打断门禁，且与"ModelSettingsPanel 不改"直接冲突

§4.9 把 `MissingAuthError` / `SessionExpiredError` / `ForbiddenError` 列为删除，但它们有 4 类
消费者，§5-P3 一个都没列：

```bash
grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/ | grep -v http-client.ts
```

| 消费者 | 后果 |
|--------|------|
| `src/components/AdminSettings/ModelSettingsPanel.tsx:6,289,291`（`import` + 两处 `instanceof`） | **`tsc` 直接断**。而 §4.8 的面板表把这个文件明确标成"（不改）"——实施者照表施工必然踩坑 |
| `src/components/video/timeline/infrastructure/RemoteMaterialPrefetchAdapter.ts:307-308`（按 `err.name` 判定） | 不断编译，但变成**永假分支**：类删掉后这两个名字再不会出现，留着即死代码 |
| `src/components/video/timeline/__tests__/RemoteMaterialPrefetchAdapter.test.ts:5-6,255-317` | **`npm test` 断**。§5-P3 只写了"去掉会话令牌预置"，漏了两个用例整体作废 |
| `src/lib/api/__tests__/llm.test.ts:21-34,100-105`（`vi.mock` 里自造了一份 `SessionExpiredError`） | **`npm test` 断**，且该文件根本没进 §5-P3 清单 |

这与 v2 评审的 P1-2（`useAgentExecution` 从 `lib/auth` 导入）同属一类遗漏，但更严重：v2 那条至少
把文件列进了变更表，这条则和文档自己的"不改"标注互相打架。**修订落点**：§4.8 面板表、§4.9 新增
「调用点迁移」小节、§5-P3 新增 4 行。

#### P0-2 · P0 阶段过删了 309 个 docs，92 处源码注释就此悬挂

```bash
git diff --cached --name-status -- docs/ | awk '{print $2}' | cut -d/ -f1-2 | sort | uniq -c
#=> 215 docs/plans   93 docs/diagnoses   1 docs/fixes
grep -rn "docs/diagnoses\|docs/plans" src/ --include=*.ts --include=*.tsx | wc -l   #=> 87
grep -rn "docs/plans" backend-services/basic-service/app --include=*.py | wc -l      #=> 5
grep -n  "docs/plans" vitest.config.ts vitest.integration.config.ts CLAUDE.md        #=> 3
# 评审人用 §10.5 的扫描脚本实测：scanned=995  dangling=98
```

三个问题叠在一起：

1. **超范围**。§3.2/§3.3 定义的范围是"删除非桌面工件"。可 `docs/diagnoses/**` 里躺的全是
   **桌面端自己**的缺陷根因档——`desktop-login-stale-root-password`、
   `video-export-packaged-desktop-loopback-ssrf`、`audio-midclip-start-silent`……
   它们不是"Web SaaS 时代的负债"，而是这个桌面产品最贵的调试资产。
2. **自相矛盾**。本文档 §10.4 A9 的判据就是"无残留悬挂引用"。删掉后，92 处源码注释 +
   `vitest.config.ts:3` + `vitest.integration.config.ts:4` + `CLAUDE.md:150` 全部指向不存在的路径，
   A9 当场不可能通过。
3. **窗口正在关闭**。这批删除**尚未 commit**（§2.1 实测），现在是唯一一次零成本回退的机会；
   一旦按 R-11 提交，"§2.1 已落地的不得重做"这条规则就会把损失固化。

**修订落点**：新增 **D19** 与 §2.6，把"回退 `docs/diagnoses/` 与 `docs/plans/`"作为 **P0-R** 排进
§9.1 第 0 步；§3.3 补范围外声明；A9 补可执行判据。

#### P0-3 · 删掉 LandingPage 后，全应用没有任何"新建任务"入口

这是本轮最重要的功能性发现。实测：

```bash
grep -n "onCreateTask" src/components/HomePage/LandingPage.tsx        #=> 3 处（全应用唯一创建入口）
grep -n "createTask\|onCreateTask" src/components/VerticalTaskbar.tsx  #=> 0
sed -n '73,110p' src/components/Container.tsx   # activeTask=null 空态：两张纯说明卡片，无任何按钮
```

- `VerticalTaskbar` 只渲染**已存在**的标签，没有"+"；
- `Container` 在 `activeTask === null` 时渲染的是两张**不可点击**的介绍卡片；
- §4.6 的 `didAutoOpenRef` 是**一次性**的，`tabs.length` 归零后不再触发。

于是：用户关掉最后一个标签页 → 左侧任务栏空 → 右侧一张说明卡 → **没有任何控件能创建新任务**，
只能杀进程重启（重启时 `tabs.length===0` 才会再次自动建标签）。一个自称"顶级人机交互"的桌面应用
不能有这种死路。顺带一提：即使在**今天**的桌面端，有标签之后也无法再新建第二种任务——LandingPage
只在 `tabs.length === 0` 时出现，而桌面端根本不渲染它。删掉 LandingPage 会把这个隐性缺陷升级成
显性死锁。

**修订落点**：新增 **D20**；§4.6 骨架给 `Container` 传 `onCreateTask` 并把空态两张卡片改成可操作
按钮（复用现有 `t.welcome.*` / `t.tasks.*` 文案，零新增 i18n 键）；§4.6 追加"可选增强：任务栏 +
按钮"；§8.1 增加"零死路"要求；§10.3 走查加第 11 条。

### R.3 P1 详情（逐条给证据与修订方向）

| ID | 证据（可当场复核） | 修订方向 |
|----|--------------------|----------|
| **P1-1** | `grep -rn "DesktopTitleBar" src/` → `src/app/not-found.tsx:5,22` 以 prop-less 形式渲染它 | §5-P3 增 `not-found.tsx` 一行；§4.7 说明 D10 恒渲染后该页在浏览器下会出现"仅品牌"标题栏（`hasAppActions=false`，可接受） |
| **P1-2** | `desktop/main/window-state.test.js` 实际有 **5** 个 ROOT 相关用例：`testDesktopTemplateUsesAdminAdminRootDefault(:76)`、`testBackfillMigratesStaleFactoryRootPassword(:92)`、`testBackfillMigratesChangeMeFactoryRootPassword(:116)` 三个测的正是要删的 `STALE_FACTORY_ROOT_PASSWORDS` 自愈分支——行为消失后无法"换个键"保留；只有 `testBackfillPreservesCustomRootPassword(:143)` 与 `testBackfillPreservesChangedRootUsername(:158)` 能换键 | §4.11 按"删 3 / 改 2"重写；A5 与 §12.4 统一为"全仓库零命中" |
| **P1-3** | `desktop/scripts/smoke-test.js` 靠轮询 `userData/logs/main.log` 判断窗口加载，**无渲染进程内省能力**；其第 3 步"带 `Bearer` 读 `/api/video-projects` 200"是唯一一条端到端 SQLite 读通断言 | 改成：删 `SMOKE_USERNAME/PASSWORD` 与 `.env` 的 `ROOT_*` 播种（`:97-98`）、删登录步（`:139-146`）、把第 3 步改为**不带任何鉴权头**请求 `/api/video-projects` 断言 200——它同时证明"无鉴权"与"SQLite 读通"，比原断言更强；窗口加载沿用现有 `main.log` 断言，不引入 CDP/Playwright |
| **P1-4** | `tests/conftest.py` 模块 docstring 写得很清楚：stub 是给 **cv2** 装的（`app/services/__init__.py` 急切 import `video_composition_service` → `import cv2`），`rate_limiter` 只是当年被连累的举例 | §5-P7 改为"只订正注释里失效的 `rate_limiter` 举例；cv2 stub 与 UUID/JSONB dialect shim **一律保留**" |
| **P1-5** | `src/components/UserProfile/OtherSettingsPanel.tsx:211-219` 有 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 监听（仅 `theme==='auto'` 时挂载） | §4.8 的"必须保留的实现细节"补这一条；漏移植会让"跟随系统"在运行期不再跟随，属功能回归 |
| **P1-6** | `vitest.config.ts` 有 `exclude: ['tests/integration/**']`；`package.json` 另有 `test:integration` 脚本，而 §10.1 门禁清单里没有它 | §10.1 增补：P3 结束跑一次 `npm run test:integration` 并贴输出；若环境不具备（需真起后端）则在 §5-P3 显式声明"仅静态改写、不进门禁"，二选一必须写死 |
| **P1-7** | `tests/test_no_auth_surface.py:118,122` 正文里就写着 `get_current_user` / `require_admin` / `app.dependencies.auth`（负向断言必须提到符号名）；P7-b 新建的前端护栏测试同理会写 `SESSION_TOKEN_KEY` | A1 判据收窄：前端 grep 排除 `__tests__`，后端从 `backend-services/` 收窄到 `app/`（与 §4.4 复核命令口径一致） |
| **P1-8** | `desktop/scripts/prepare-env.js:38` 的 `const LOCAL_ADMIN_KEYS = ['ADMIN_USERNAME','ADMIN_PASSWORD']` 并入 `EXCLUDED_KEYS`——是**活代码**，存在的唯一理由是"别把构建机的管理员口令打进安装包"；其上方注释还引用了早已删除的 `config.py:928-929` | §4.11 改为"删 `LOCAL_ADMIN_KEYS` 常量与其在 `EXCLUDED_KEYS` 的引用 + 重写注释块"，§12.4 增补 `grep -rn "ADMIN_PASSWORD" desktop/` 目标 0 |

### R.4 评审人明确认可的部分（后续轮次不要"优化"掉）

1. **D2 幂等 UPDATE + 零破坏性 DDL**：对一个被 DDL 自愈坑过两次的项目，这是唯一正确的选择。
2. **D13 读放宽 / 写收敛**：用"列表枚举全部 `user_*` 目录"换掉目录搬迁，零迁移、无中间态、可逆。
3. **保留 `RateLimitError` 与 429 解析**（§4.9 / R-6 / P7-b 正向断言三重保险）：这是 v2 踩过的坑，
   v3 用三处冗余把它钉死，做法正确。
4. **§9.1 把 P7-a 排到最前**：先修好门禁再动主体，理由充分。
5. **§9.1 P3-1 先于 P3-2**（先改引用、后删目录）：避免中间态 `tsc` 必断，是本方案最有价值的顺序约束。
6. **`page.tsx` 目标骨架把根容器从 `bg-gray-50` 改成 `bg-background`**：现状下水合占位是
   `bg-background`、外层却是 `bg-gray-50`，首帧确实会闪一下——这个改动顺手修掉了一个真实缺陷。

---

## 1. 概述（Overview）

Ecliptrix 是一个 AI 内容创作平台（视频剪辑 + 语音合成 + 素材管理 + AI 生成），
仓库里长期同时存在**两种产品形态**：一种是面向公网部署的 Web SaaS（`ops/` 远程
部署脚本、systemd/nginx 模板、PostgreSQL + Alembic 迁移、CORS 白名单、按 IP 全局
限流、HSTS、生产环境关闭 `/docs`、多用户 + RBAC + 单设备会话），另一种是面向本机
运行的 Electron 桌面应用（`desktop/`：内嵌 CPython + FFmpeg + Next.js standalone，
强制 SQLite、强制绑定 `127.0.0.1`）。两种形态在同一份源码里互相纠缠：后端每个业务
路由都要 `Depends(get_current_user)` 取出一个在桌面端恒为 `admin` 的用户；前端
`src/app/page.tsx` 用 `isDesktop()` 在"着陆页 / 登录弹窗 / 编辑器"三种首屏之间分叉；
Electron 主进程通过 IPC 把 `ROOT_PASSWORD` **明文**交给渲染进程，只为让本机用户
"静默登录"自己的电脑。

产品方向已经明确：**后续只做纯桌面端**。这些为公网多租户而生的代码不再是资产，
而是负债——它们放大攻击面（仓库里曾躺着一份可用的生产服务器 SSH 私钥）、制造双
事实来源（用户偏好同时存在于 `localStorage` 与后端 `users.preferences`）、让每次
改动都要在两种形态里各验证一遍，也直接损害体验（本机单用户应用启动后先弹一个
`admin/admin` 登录框，是明确的人机交互反模式）。

本方案把产品收敛为**单一运行形态**：Electron 主进程拉起本机 FastAPI（SQLite）与
Next.js standalone，渲染进程加载同源本地页面，**启动即进入剪辑工作区**。四件事：
(1) 删除全部非桌面工件（远程部署、示例包、覆盖率产物、服务器安装/启停脚本）；
(2) 把"多用户 + 会话鉴权 + 限流 + RBAC"整体折叠为一个编译期常量 `LOCAL_OWNER_ID`，
以**零破坏性 DDL** 的方式完成——这是本方案最关键的风险控制决策，因为该项目历史上
两次在启动期做破坏性 DDL 自愈都造成了事故；(3) 数据层收敛到 SQLite-only，移除
PostgreSQL / Alembic 双轨；(4) 前端外壳收敛为"标题栏 + 任务栏 + 工作区"三件套，
设置中心信息架构重排，首启直达工作区。

**全程不删除任何一项在用业务能力**：视频剪辑、时间线、预览合成、TTS、素材库、
AI 混剪、分镜、封面、字幕、导出、YouTube、水印去除等全部保留，行为逐字节不变。
P0～P2 已删除 109,046 行；P3～P7 预计再净删除约 5,500～6,000 行前端与文档代码
（P3 主体 5,214 行 + BFF 162 行 + i18n / 测试 / 桌面壳若干，减去新增的 `localOwner.ts`
与 `GeneralSettingsPanel.tsx`）。

---

## 2. 现状复核（本轮实测证据）

以下每一条都可用给出的命令当场复核。数据采集于 2026-09-01，工作区
`feat/remove-user-system` 分支，**尚未 commit**。

### 2.1 已落地（P0 / P1 / P2）——本轮不得重做

```bash
git diff --cached --shortstat
#=> 438 files changed, 109046 deletions(-)
git diff --shortstat
#=> 42 files changed, 1079 insertions(+), 2209 deletions(-)
```

| 阶段 | 状态 | 实测判据 |
|------|------|----------|
| **P0 仓库工件清理** | ✅ 已落地 | `ops/`（含 `.pem` 私钥）、`install.sh`/`install.ps1`/`start.sh`/`kill.sh`、`coverage/`（15 文件）、`example-package/`（14 文件）、`scripts/{preflight,smoke-api-auth}.sh`、`test_seedance.py`、`backend-services/basic-service/{datas,migrations,sql,templates,scripts,migrate.sh,run.sh,start_server.py}`、历史 `docs/diagnoses/**` 与 `docs/plans/**` 均已进暂存区删除；`.gitignore` 新增 `coverage/`、`/logs/`、`.run-log/`、`.claude-index/graph.json`，并移除 `!ops/config.env` 例外 |
| **P1 后端身份收敛** | ✅ 已落地 | `app/{dependencies/,middleware/auth_middleware.py,models/{auth,user}_models.py,routers/{auth,user,rate_limit_settings,telemetry,admin_playback}_router.py,services/{auth,user,session,rate_limiter,rate_limit_config,playback_metrics_aggregator}*.py}` 全部删除；新增 `app/constants.py`（`LOCAL_OWNER_ID` / `LOCAL_OWNER_NAME`）；`grep -rn "get_current_user\|require_admin" app/` **零命中** |
| **P2 中间件 / 数据层收敛** | ✅ 已落地 | `alembic/`、`alembic.ini` 已删；`requirements.txt` 移除 `alembic`/`asyncpg`；`app/database.py` 引入 `_resolve_database_url()`（遗留 PG DSN 兜底改写为 SQLite）+ `_install_sqlite_pg_type_shims()` + 幂等所有权认领；`app/middleware/` 仅剩 `security_headers.py`，且已精简为 `nosniff` + `Referrer-Policy` + `Permissions-Policy` 三头 |
| **§4.6 素材文件系统归属（D13）** | ✅ 已落地 | `app/services/storage_service.py:823 list_user_materials()` 已改为"枚举全部 `user_*` 目录"（读放宽），写入侧仍落 `user_{LOCAL_OWNER_ID}/`（写收敛） |
| 新增回归测试 | ✅ 已落地 | `tests/test_no_auth_surface.py`、`tests/test_local_owner_claim.py`、`tests/test_local_owner_materials_listing.py`（均为未跟踪新文件） |

### 2.2 未落地（P3 / P4 / P5 / P6）——本轮主体工作

| 阶段 | 状态 | 实测判据 |
|------|------|----------|
| **P3 前端外壳与鉴权收敛** | ❌ 未开始 | `src/contexts/AuthContext.tsx`(435)、`src/components/LoginModal.tsx`(296)、`src/components/auth/{AuthGate,LoginScreen,useLoginForm}`(468)、`src/components/HomePage/LandingPage.tsx`(150)、`src/components/{Header,Footer,GlobalMobileDetection}.tsx`(166)、`src/components/UserProfile/**`(789)、`src/components/AdminSettings/{UserManagement,RateLimitSettings}.tsx`(1669)、`src/lib/api/{auth,userManagement,userPreferences,rateLimitSettings}.ts`(717)、`src/lib/auth/**`(207)、`src/lib/desktop/desktopAuth.ts`(33)、`src/app/login/page.tsx`(48) 全部原样存在。`grep -rn "useAuth()" src/` = **14 处**；`grep -rn "requireAuth" src/` = **38 处** |
| **P4 BFF 路由与死代码** | ❌ 未开始 | `src/app/api/` 共 **122** 个 `route.ts`；待删 19 个（`admin/**` 9、`auth/**` 2、`user/**` 2、`rate-limit/**` 3、`workflow/**` 2、`timeline-export` 1，共 162 行）。`next.config.js:36` 仍是 `output: process.env.DESKTOP_BUILD === '1' ? 'standalone' : undefined` |
| **P5 桌面外壳去凭证** | ❌ 未开始 | `desktop/preload/preload.js:23` 仍暴露 `getBootstrapCredentials`；`desktop/main/index.js:119` 仍读 `ROOT_PASSWORD`；`desktop/main/envCheck.js:15` 仍有 `STALE_FACTORY_ROOT_PASSWORDS` 迁移分支；`src/types/desktop.d.ts` 仍声明 `BootstrapCredentials`。（`desktop/main/index.js` 当前的未暂存改动仅为窗口生命周期日志，与鉴权无关，不要误删） |
| **P6 文档收尾** | ⚠️ 部分 | `CLAUDE.md` 仅被 project-indexer 追加了 Clean Code 段并更新索引日期；**桌面化改写未做**（仍写着 `install.sh` / `start.sh` / `alembic upgrade head` / PostgreSQL / `AgentWorkflow` / "Gitignore is minimal" / `src/components/workflow/`）。`README.md` / `README.zh-CN.md` / `backend-services/basic-service/env.template` 未动 |

### 2.3 半程实施留下的 3 处硬伤（新增 P7 阶段处理）

这是本轮最重要的发现——**当前仓库的两条门禁命令有一条已经不能整体运行**。

```bash
cd backend-services/basic-service && python -m pytest tests/ -q --co
#=> 1111 tests collected, 2 errors in 8.19s     ← 整体收集失败，pytest 以 exit≠0 中断
```

| ID | 位置 | 现象 | 根因 |
|----|------|------|------|
| **H-1** | `tests/test_thumbnail_service.py:227` | 3 个测试 ERROR：`test_post_thumbnail_frame_persists_and_returns_url` / `..._rejects_non_image` / `test_get_material_thumbnails_lists_poster_and_frames` | `thumb_client` fixture 仍 `from app.dependencies.auth import get_current_user` 并做 `dependency_overrides`。P1 删掉了该模块，测试未同步 → **这是 P1 的回归，必须修** |
| **H-2** | `tests/test_tts_api.py:421` | 整个文件收集失败：`AttributeError: module pytest has no attribute config` | `pytest.config` 是 pytest 5.0 移除的 API，且 `--integration` 选项从未在任何 `conftest.py` 用 `addoption` 注册过 → 该文件**从来没跑起来过**，属陈腐代码 |
| **H-3** | `tests/test_content_polish_api.py:135` | 整个文件收集失败：`SyntaxError: bytes can only contain ASCII literal characters` | `b'data: {"choices": [{"delta": {"content": "中文响应"}}]}'` 在 bytes 字面量里写了非 ASCII 字符 → 该文件**从来没被解析成功过** |

H-2 / H-3 与本次重构无因果关系，但它们让 `pytest tests/` 这条**项目自己写在
`CLAUDE.md` 里的门禁命令**无法作为验收依据。本方案把它们纳入范围：一个声称
"稳健、可靠"的产品，不能有一条跑不起来的测试门禁。

### 2.4 当前门禁的真实可用性

```bash
npx tsc --noEmit                      #=> exit 0（前端仍可编译，因为 P3/P4 未动）
cd backend-services/basic-service
python -m pytest tests/test_no_auth_surface.py tests/test_local_owner_claim.py \
  tests/test_local_owner_materials_listing.py tests/test_thumbnail_service.py tests/security/ -q
#=> 152 passed, 2 skipped, 3 errors   ← 3 errors 即 H-1
```

结论：**后端主体健康，前端未动，门禁被 3 个陈腐/回归测试文件卡住。**

### 2.5 本轮新确认的死代码（v2 未收录）

| 路径 | 行数 | 判据 |
|------|------|------|
| `src/lib/auth/sessionGuard.ts` | 147 | 它守护的 `/api/workflow/test-node` 早已不存在；`grep -rn "auth/sessionGuard" src/ tests/` **零命中**。即使不做本次重构，它今天也是纯死代码 |
| `src/components/video/playback/telemetry.ts` + 2 个测试 | 236+ | 仅被 `playback/index.ts:44` 再导出，全仓库**零构造点**（`grep -rn "PlaybackTelemetry" src/` 只命中导出行与自身） |
| `AdminSettingsPage` 的 `systemSettings` 分支 | ~20 | 面板内容是"功能开发中"占位（`t.common.underDevelopment`），无任何实现 |
| `src/components/ui/RoleBadge.tsx` | — | 仅被 `UserManagement.tsx` 与 `HeaderActions.tsx` 使用，两者 P3 后都不再需要角色概念 |
| `src/app/api/video-proxy/route.ts` 的 OSS 白名单项 | 1 行 | `ecliptrix.oss-cn-beijing.aliyuncs.com` 是 Supabase/OSS 时代残留；存储已 local-only（见 `CLAUDE.md` Storage 章），该 host 不会再出现。**路由本身要保留**——`src/components/video/utils/extractVideoThumbnail.ts:5` 仍在用它代理 ARK CDN |
| `src/hooks/useMobileDetection.ts` | — | 仅服务 `GlobalMobileDetection`；桌面应用无移动端形态 |

---

### 2.6 【v4 评审修订 · P0-2】P0 阶段的一处过删，必须在动工前回退

P0 把 **309 个 `docs/**` 文件**放进了暂存删除：

```bash
git diff --cached --name-status -- docs/ | awk '{print $2}' | cut -d/ -f1-2 | sort | uniq -c
#=> 215 docs/plans   93 docs/diagnoses   1 docs/fixes
```

其中 `docs/diagnoses/**` 记录的**全部是桌面端自身**的缺陷根因（`desktop-login-stale-root-password`、
`video-export-packaged-desktop-loopback-ssrf`、`audio-midclip-start-silent` …），它们不属于
§3.2 定义的"非桌面工件"。而源码正大量引用它们：

```bash
grep -rn "docs/diagnoses\|docs/plans" src/ --include=*.ts --include=*.tsx | wc -l   #=> 87
grep -rn "docs/plans" backend-services/basic-service/app --include=*.py | wc -l      #=> 5
grep -n  "docs/plans" vitest.config.ts vitest.integration.config.ts CLAUDE.md        #=> 3
# 评审人用 §10.5 的扫描脚本实测：scanned=995  dangling=98
```

删掉它们会让 **92 处源码注释 + 3 处配置注释**变成悬挂引用，与本文档 §10.4 的 **A9（无残留悬挂
引用）**直接冲突。这批删除**尚未 commit**，现在是唯一一次零成本回退的窗口（见 D19 与 §9.1 的
P0-R 步骤）。

回退命令（**只**碰 docs，不触碰任何其它暂存内容）：

```bash
cd M:/takoAI/Ecliptrix
git restore --staged --worktree docs/diagnoses docs/plans docs/fixes
git status --porcelain -- docs/ | wc -l        # 期望 0（除本 spec 所在的新目录外）
```

回退后仍**保留删除**的：无。`docs/` 下没有任何"服务器时代"专属内容——`ops/` 部署脚本早在 P0
被删（那部分正确）。

---

## 3. 设计原则与范围边界

### 3.1 原则

1. **单一形态**：源码中不再存在"Web 产品形态"的分支。保留 `isDesktop()` **仅**用于
   判断"当前是否运行在 Electron 外壳内"（决定是否渲染窗口控制按钮），因为
   `npm run dev` 的浏览器调试链路必须继续可用。
2. **零破坏性 DDL**：启动期**只做** `CREATE TABLE IF NOT EXISTS`（`create_all`）与
   幂等 `UPDATE`；**禁止** `DROP TABLE` / `DROP COLUMN` / `ALTER ... DROP`。历史事故
   （`user_id` 自愈系列）根因即在此。
3. **删除优先于开关**：不为被删能力留 feature flag；需要回退时用 Git。
4. **不改业务语义**：剪辑、预览、导出、TTS、素材、AI 能力的行为必须逐字节保持一致
   （导出产物比对见 §10.4）。
5. **每步可编译、可测试**：分阶段推进，每阶段结束 `npm run type-check` +
   `pytest tests/` 必须通过，且必须贴出实际输出（不接受"应该能过"）。
6. **不留半程状态**：本轮结束时，`pytest tests/` 必须能**整体收集并通过**——这是
   §2.3 三处硬伤必须进范围的理由。

### 3.2 范围内（In scope）

- P3：前端外壳与鉴权收敛（登录、着陆页、Header/Footer、用户资料、用户管理、限流台）。
- P4：BFF 路由删除（19 个）+ `next.config.js` 无条件 standalone + 死代码清理。
- P5：桌面主进程去凭证 IPC + env 模板去 `ROOT_*`。
- P6：`README` / `README.zh-CN` / `CLAUDE.md` / `env.template` / `.claude-index` 同步。
- P7：门禁修复（H-1/H-2/H-3）与全量验收。
- 设置中心信息架构重排（§4.8）与标题栏动作簇收敛（§4.7）——**信息架构与交互层面的
  重组，不做视觉语言重设计**。

### 3.3 范围外（Out of scope）

- 任何视频编辑内核（`src/components/video/timeline/**`、`playback/**`、
  `app/services/composition/**`）的重构。
- 新增业务功能；设计语言（配色、字体、圆角、间距 token）的重新定义。
- macOS / Linux 打包。
- Git 历史重写（已删除 `.pem` 的历史清除属运维动作，见 §11 R-1）。
- `src/lib/i18n.ts` 的整体拆分（仅删除失效的 auth/用户/限流文案键）。
- 已落地的 P0/P1/P2 的任何回滚或"再优化"，**唯一例外**是 §2.6 / D19 指明的
  `docs/diagnoses` + `docs/plans` + `docs/fixes` 定点回退（P0-R）。
- `docs/**` 的内容治理（归档、重排、精简）：本轮只做"不要误删"，不做重组。

---

## 4. 技术设计（Technical Design）

### 4.1 目标架构

```
┌─────────────────────── Electron 主进程 (desktop/main) ────────────────────────┐
│  index.js  ──┬── config.js        userData/{data,storage,logs} + desktop-     │
│              │                     config.json                                │
│              ├── envCheck.js      userData/.env（首启从模板复制、缺键回填）    │
│              │                     ★P5: 删除 ROOT_* 迁移分支                  │
│              ├── processManager.js 子进程生命周期 + 健康探测 + 退出清理        │
│              ├── backendService.js spawn CPython → run.py                     │
│              │      env 硬注入: DATABASE_URL=sqlite+aiosqlite:///…/data/*.db  │
│              │                   STORAGE_ROOT / HOST=127.0.0.1 / PORT=18321   │
│              ├── frontendService.js spawn node → .next/standalone :18320      │
│              └── window.js/windowControls.js  无边框窗口 + 窗口控制 IPC        │
│                                                                               │
│  preload.js  contextBridge → window.ecliptrixDesktop                          │
│              { version, logsPath, windowControls }   ★P5: 删 getBootstrap…    │
└───────────────────────────────────────────────────────────────────────────────┘
        │ loadURL(http://127.0.0.1:18320)
        ▼
┌─────────────────────── 渲染进程 (Next.js standalone) ─────────────────────────┐
│  app/layout.tsx    LocaleProvider → NotificationProvider → children           │
│                    ★P3: 删 AuthProvider / GlobalMobileDetection               │
│  app/page.tsx      AppTitleBar + VerticalTaskbar + (SettingsPage | Container) │
│                    ★P3: 删 AuthGate/LoginModal/Header/Footer/LandingPage/     │
│                          UserProfilePage，首屏直达工作区                       │
│  app/api/**        103 个 BFF 路由（★P4: 122 → 103），同源转发到 :18321       │
└───────────────────────────────────────────────────────────────────────────────┘
        │ http://127.0.0.1:18321
        ▼
┌────────────────────────── FastAPI (backend-services) ─────────────────────────┐
│  main.py    CORSMiddleware(D5) → SecurityHeadersMiddleware(D6) → 32 routers   │
│  database.py  SQLite + create_all + 幂等所有权认领（已落地）                   │
│  constants.py LOCAL_OWNER_ID / LOCAL_OWNER_NAME（已落地）                      │
│  services/**  业务服务层，签名保留 user_id: str，实参恒为 LOCAL_OWNER_ID        │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 关键决策记录（Decision Log）

D1～D13 由 v1/v2 确立并**已在 P0～P2 实现**，此处保留以供复核与下游理解；
D14～D18 为 v3 新增，对应尚未落地的部分。

| ID | 决策 | 理由 | 状态 |
|----|------|------|------|
| **D1** | 用常量 `LOCAL_OWNER_ID = "00000000-0000-0000-0000-000000000001"` 取代运行时用户身份；四张业务表的 `user_id` 列**保留**，服务层签名 `user_id: str` **保留** | 服务层与其 30+ 单测零改动；避免大面积 DDL；`user_id` 沦为"本机所有者标记"，语义单一 | ✅ 已实现 |
| **D2** | 启动期用**幂等 UPDATE** 认领遗留行：`UPDATE <t> SET user_id=:owner WHERE user_id<>:owner`，**不做任何 DROP** | 老库里的工程/分类/分镜包/封面在新版本中仍可见，零数据丢失；四张表 `user_id` 上无唯一约束，UPDATE 不冲突 | ✅ 已实现 |
| **D3** | `users` / `login_history` 从 ORM 模型删除，但**不 DROP 既有表** | `create_all` 只建不删，遗留表变惰性数据，零风险；两表与业务表间无外键 | ✅ 已实现 |
| **D4** | 删除 `RateLimitMiddleware` 及整条全局限流链路 | 服务仅绑 `127.0.0.1`，唯一客户端是本机渲染进程；限流只会在批量 TTS / 批量素材下载时误伤用户。`media-proxy-config.yaml` 的 `per_ip_rate_limit_per_min` 属代理服务自身下载节流，**保留** | ✅ 已实现 |
| **D5** | **保留** `CORSMiddleware`，删除 `cors_legacy_wildcard` / production 分支 / 空白告警 | 前端 `:18320` 与后端 `:18321` 确实跨源；`npm run dev`（:3000 → 独立后端）调试链路依赖它。按"删除优先"原则的显式例外 | ✅ 已实现 |
| **D6** | **保留** `SecurityHeadersMiddleware`，精简为 `nosniff` + `Referrer-Policy` + `Permissions-Policy` | `X-Frame-Options`/HSTS 在本地 http 场景无意义；`nosniff` 对 `/api/storage/files` 的本地文件服务仍有价值 | ✅ 已实现 |
| **D7** | `/docs`、`/redoc`、`/openapi.json` 恒开 | 仅监听 `127.0.0.1`，是本地调试资产 | ✅ 已实现 |
| **D8** | 数据层 SQLite-only：删 `alembic/`、`alembic.ini`、`migrate.sh`，requirements 移除 `alembic`/`asyncpg` | 桌面产物从未包含 `alembic/`；建表唯一路径就是 `create_all` | ✅ 已实现 |
| **D9** | 语言/主题以 `localStorage` 为唯一事实来源，删除 `/api/user/me/preferences` 与 `userPreferences.ts` | 消除双事实来源；`notifications`/`privacy` 字段在本机应用无语义 | 后端 ✅ / 前端 ⏳ P3 |
| **D10** | 标题栏改为**恒渲染**（窗口控制按钮在 `mounted && isDesktop()` 时才出现），并成为唯一 chrome | 删除 `Header` 后浏览器调试链路仍需设置/主题/语言入口；同时消灭"两套同源动作簇" | ⏳ P3 |
| **D11** | `src/components/AdminSettings/` → `src/components/settings/`，删除 `UserManagement`/`RateLimitSettings`，新增 `GeneralSettingsPanel` | 外部引用仅 3 处（全在 `page.tsx`）；"Admin" 概念随 RBAC 一起消失 | ⏳ P3 |
| **D12** | 删除 `auth:bootstrap-credentials` IPC 与 `desktopAuth.ts` | 主进程不再需要把 `ROOT_PASSWORD` 明文交给渲染进程——`preload.js` 注释里自己标注的"待收敛风险 1" | ⏳ P5 |
| **D13** | 素材**列表侧所有者无关**（枚举全部 `user_*` 目录），**写入侧不变**，**不做目录改名或搬迁** | 磁盘路径是第二条编码所有者的链路；"读放宽 + 写收敛"零迁移、无中间态、可逆 | ✅ 已实现 |
| **D14**（v3 新增） | **首屏直达工作区对两端一致**：删除 `showLandingPage` 的 `!isDesktop()` 分叉，水合后 `tabs.length === 0` 即 `createTask('video')`，浏览器与桌面行为相同 | 单形态产品不该有两种首屏；浏览器仅是调试链路，让它和产品一致才能真正调试产品。同时消除"等 `isAuthenticated` 才建首个标签页"的一整个登录 RTT | ⏳ P3 |
| **D15**（v3 新增） | §2.5 列出的 6 项死代码随本次一并删除；`video-proxy` 路由**保留但收缩白名单** | 它们与鉴权无关，但都是"服务器时代残留"，属本次清理目标；`extractVideoThumbnail.ts` 仍依赖 `video-proxy` 代理 ARK CDN，删路由会打断缩略图 | ⏳ P4 |
| **D16**（v3 新增） | 新增 **P7** 修复 H-1/H-2/H-3，恢复 `pytest tests/` 可整体收集通过 | 一条跑不起来的门禁等于没有门禁；H-1 更是 P1 留下的回归 | ⏳ P7 |
| **D17**（v3 新增） | `SettingsMenuItem` 联合类型成员去掉冗余 `Settings` 后缀（`modelSettings` → `model` …），并按 §4.8 分组 | 类型已名为 `SettingsMenuItem`，成员再带 `Settings` 违反 `CLAUDE.md`「One concept, one name」；该目录本就要整体重命名，改名成本被摊薄。**调用点仅 5 处**，逐一列在 §5-P3 | ⏳ P3 |
| **D18**（v3 新增） | 前端 `LOCAL_OWNER_ID` 常量落在 `src/lib/localOwner.ts`，与 `app/constants.py` **双向注释互指**；素材接口继续保留 `user_id` 入参 | 后端 `constants.py` 的模块 docstring 已经声明了这个文件的存在（"The frontend mirror of `LOCAL_OWNER_ID` lives in `src/lib/localOwner.ts`"）——**当前该文件不存在，是一处悬挂引用**，P3 必须补上；保留入参可让后端 `list_user_materials` 签名与其单测零改动 | ⏳ P3 |
| **D19**（v4 评审新增） | `docs/diagnoses/**`、`docs/plans/**`、`docs/fixes/**` **定点回退**，不随 P0 删除 | 它们是桌面端自身的缺陷根因与设计档，不是"非桌面工件"；92 处源码注释 + 3 处配置注释指向它们，删了必然违反 A9。回退成本为零（尚未 commit），保留成本也为零（纯文本，不进安装包） | ⏳ P0-R |
| **D20**（v4 评审新增） | 删掉 `LandingPage` 的同时，**必须**把"新建任务"能力落到 `Container` 的空态上：空态两张介绍卡片改为可操作按钮，`onCreateTask` 由 `page.tsx` 透传 | `LandingPage` 是全应用**唯一**的创建入口（`grep -n "onCreateTask" src/` 可证），`VerticalTaskbar` 无"+"，`Container` 空态无按钮，`didAutoOpenRef` 又是一次性的——直接删会让"关掉最后一个标签页"变成只能重启的死路 | ⏳ P3 |

### 4.3 启动时序（重构完成后）

```
Electron ready
  └─ initUserData()          创建 data/ storage/ logs/，首启复制 .env 模板
  └─ loadUserEnv() + 缺键回填  ★P5: 不再有 ROOT_* 迁移分支
  └─ splash 窗口
  └─ spawn backend  ──► FastAPI lifespan
  │                      ├─ setup_logging
  │                      ├─ 队列初始化（video_analysis / storyboard）
  │                      ├─ init_db()
  │                      │    ├─ create_all（含新表；已有表不动）
  │                      │    └─ 幂等所有权认领（D2）
  │                      ├─ system_settings 播种 + 载入缓存
  │                      └─ derived-file GC 诊断（dry-run，保留）
  └─ 健康探测 /api/health（≤120s）
  └─ spawn frontend ──► Next standalone :18320，健康探测 /（≤60s）
  └─ 主窗口 loadURL → page.tsx 挂载
       ├─ useTasks 水合（读 localStorage 标签页）
       ├─ tabs.length === 0 → createTask('video')     ★D14 直达剪辑工作区
       └─ useLlmConfigStatus() === 'unconfigured' → SetupGuideDialog（非阻塞）
  └─ 主窗口 show → 关闭 splash
```

**与今天的差异**：删除了 `AuthGate` 阻塞层、`LoginScreen`、静默登录 IPC 往返、
以及"等 `isAuthenticated` 才建首个标签页"的等待——首屏可交互时间减少一整个登录
RTT，且不再出现 `admin/admin` 登录框。

### 4.4 后端所有权模型（已落地，仅供复核）

```python
# app/constants.py  —— 已存在，勿改
LOCAL_OWNER_ID = "00000000-0000-0000-0000-000000000001"
LOCAL_OWNER_NAME = "local-owner"
```

机械变换的形状（路由层）：

```python
# BEFORE
@router.get("/projects")
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    return await video_project_service.list_projects(db, str(current_user.id))

# AFTER（已落地）
@router.get("/projects")
async def list_projects(db: AsyncSession = Depends(get_db_session)):
    return await video_project_service.list_projects(db, LOCAL_OWNER_ID)
```

复核命令（应全部零命中）：

```bash
cd backend-services/basic-service
grep -rn "get_current_user\|require_admin\|require_root" app/     #=> 0
grep -rn "Depends(get_current_user)" app/                          #=> 0
python -c "import app.main"                                        #=> 无异常
```

### 4.5 前端所有权镜像（P3 新增）

新建 `src/lib/localOwner.ts`：

```ts
/**
 * The desktop build has exactly one owner. This mirrors
 * `LOCAL_OWNER_ID` in `backend-services/basic-service/app/constants.py`
 * — the two values MUST stay identical; the backend docstring points back
 * at this file.
 *
 * It is passed as the `user_id` query parameter of the material APIs. The
 * backend ignores it for *reads* (D13: listing enumerates every `user_*`
 * directory so pre-refactor material stays visible) and uses it for the
 * *write* path (new files land under `user_<LOCAL_OWNER_ID>/`).
 */
export const LOCAL_OWNER_ID = '00000000-0000-0000-0000-000000000001';
```

替换规则：所有 `const { user } = useAuth(); … user.id` 的素材调用点改为直接使用
`LOCAL_OWNER_ID`，**不要**改 `getUserMaterials(userId, …)` 的函数签名——
`src/lib/api/userMaterials.ts:45` 的签名与其单测 `userMaterials.test.ts` 保持不变。

### 4.6 前端外壳收敛（`src/app/page.tsx` 目标形态）

当前 255 行 → 目标约 110 行。目标形态（可直接照抄骨架）：

```tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import AppTitleBar from '@/components/shell/AppTitleBar';
import VerticalTaskbar from '@/components/VerticalTaskbar';
import Container from '@/components/Container';
import SettingsPage from '@/components/settings/SettingsPage';
import { SettingsMenuItem } from '@/components/settings/SettingsSidebar';
import SetupGuideDialog from '@/components/Onboarding/SetupGuideDialog';
import { useTasks } from '@/hooks/useTasks';
import { useLlmConfigStatus } from '@/hooks/useLlmConfigStatus';

// Session-scoped (not localStorage): re-prompt on next launch if still
// unconfigured, but never twice in one session.
const SETUP_GUIDE_DISMISSED_KEY = 'ecliptrix-setup-guide-dismissed';

export default function HomePage() {
  const {
    tasks, tabs, activeTabId, activeTask,
    createTask, selectTab, closeTab, updateTask, hydrated,
  } = useTasks();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsItem, setSettingsItem] = useState<SettingsMenuItem>('general');
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);

  // No RBAC any more — the single local owner may always fix credentials.
  // 【v4 评审修订 P2-2】`enabled` 形参存在的唯一理由是"未登录/非管理员时不发请求"，
  // 鉴权消失后它恒为 true。P3 顺手把形参与 docstring 一并删掉（hook 变成无参），
  // 这里先按无参形态书写；同文件的 `http.get(..., { requireAuth: false })` 属于
  // §4.9 要清理的 38 处调用点之一，不清理会因超量属性检查直接断 tsc。
  const { status: llmStatus, refresh: refreshLlmStatus } = useLlmConfigStatus();

  // D14: straight to the editing workspace once the tab store has hydrated.
  // The gate is `hydrated` alone — SSR and the first client frame both render
  // the neutral placeholder, so there is no hydration mismatch.
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (!hydrated || didAutoOpenRef.current || tabs.length > 0) return;
    didAutoOpenRef.current = true;
    createTask('video');
  }, [hydrated, tabs.length, createTask]);

  const [setupGuideDismissed, setSetupGuideDismissed] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined'
        && window.sessionStorage.getItem(SETUP_GUIDE_DISMISSED_KEY) === '1';
    } catch { return false; }
  });

  const dismissSetupGuide = () => {
    try { window.sessionStorage.setItem(SETUP_GUIDE_DISMISSED_KEY, '1'); }
    catch { /* ignore — degrade to per-session reminder */ }
    setSetupGuideDismissed(true);
  };

  const handleSelectTab = (tabId: string) => {
    setIsSettingsOpen(false);
    selectTab(tabId);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    setSettingsItem('general');
    refreshLlmStatus();   // the owner may have just saved model credentials
  };

  const showSetupGuide =
    llmStatus === 'unconfigured' && !setupGuideDismissed && !isSettingsOpen;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppTitleBar
        onSettingsClick={() => setIsSettingsOpen(true)}
        showSettingsAttention={llmStatus === 'unconfigured'}
      />
      <div className="flex-1 flex overflow-hidden">
        {!hydrated ? (
          <div className="flex-1 flex items-center justify-center bg-background" />
        ) : (
          <>
            <VerticalTaskbar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={closeTab}
              isBlurred={isChatModalOpen}
            />
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {isSettingsOpen ? (
                <SettingsPage initialItem={settingsItem} onClose={closeSettings} />
              ) : (
                <Container
                  activeTask={activeTask}
                  onUpdateTask={updateTask}
                  onChatModalStateChange={setIsChatModalOpen}
                  /* 【v4 评审修订 P0-3 / D20】LandingPage 删除后，Container 的空态
                     是唯一的"新建任务"入口。不传这个 prop = 关掉最后一个标签页后
                     应用变砖。 */
                  onCreateTask={createTask}
                  tasks={tasks}
                  tabs={tabs}
                  onSelectTab={selectTab}
                />
              )}
            </div>
          </>
        )}
      </div>
      <SetupGuideDialog
        open={showSetupGuide}
        onGoToSettings={() => { dismissSetupGuide(); setSettingsItem('model'); setIsSettingsOpen(true); }}
        onDismiss={dismissSetupGuide}
      />
    </div>
  );
}
```

#### 4.6.1 【v4 评审修订 · P0-3 / D20】空态必须可操作

`Container.tsx` 在 `activeTask === null` 时渲染一个欢迎空态（`:73-110`），今天它是**两张
不可点击的介绍卡片**。`LandingPage` 删除后它成为唯一的创建入口，必须改造：

| 改动 | 内容 |
|------|------|
| `ContainerProps` | 新增 `onCreateTask?: (type: TaskType) => void`（可选，保持既有调用点不破） |
| 空态两张卡片 | `<div className="bg-muted …">` → `<button type="button" onClick={() => onCreateTask?.('chat' \| 'video')} …>`，加 `aria-label`、`focus-visible:ring-2 focus-visible:ring-ring`、`hover:bg-accent`、`disabled={!onCreateTask}` |
| 文案 | **零新增 i18n 键**——直接复用现有 `t.welcome.title` / `t.welcome.description` / `t.tasks.aiChat` / `t.tasks.videoEditing` / `t.welcome.aiChatDesc` / `t.welcome.videoEditingDesc`（`LandingPage` 用的是同一批键） |
| 键盘 | 两张卡片是原生 `<button>`，Tab 可达、Enter/Space 可触发，无需额外 key handler |

**可选增强（推荐但非阻塞）**：给 `VerticalTaskbar` 加一个常驻的"+ 新建"按钮
（`onCreateTask` 同源透传）。它顺带修掉一个**今天就存在**的缺陷——一旦有了标签页，
桌面端就再也无法新建第二种任务（`LandingPage` 只在 `tabs.length === 0` 时出现，而桌面端
根本不渲染它）。若时间紧张可不做，但 §4.6.1 主体（Container 空态可操作）**不可省**。

**不要**用"tabs 归零就自动重建标签"来代替本节：那会让"关闭标签页"这个动作没有可观测效果，
是更糟的交互。

消失的状态与回调（务必全删，否则 lint 会报未使用变量）：
`isLoginModalOpen`、`isProfileOpen`、`profileInitialSection`、`isAuthenticated`、
`isLoading`、`canManageUsers`、`hasActiveTask`、`showLandingPage`、
`showBootPlaceholder`、`ready`、`handleCreateTask`、`handleReturnHome`、
`openSettingsAt`。

> ⚠️ `handleReturnHome` 调用的 `closeAllTabs` **只**被它使用；删掉后
> `useTasks` 返回的 `closeAllTabs` 在 `page.tsx` 中不再解构。**不要**去删
> `useTasks` 里的 `closeAllTabs` 实现——先 `grep -rn "closeAllTabs" src/`
> 确认无其他消费者再决定，属 P4 死代码判定，不属 P3。

### 4.7 标题栏与动作簇（`AppTitleBar` / `TitleBarActions`）

**`src/components/desktop/DesktopTitleBar.tsx` → `src/components/shell/AppTitleBar.tsx`**

结构不变（40px 三段：品牌拖拽区 / 弹性拖拽区 / `no-drag` 命令区），改动三点：

1. **恒渲染（D10）**：删除 `if (!mounted || !isDesktop()) return null;`。
   改为 `if (!mounted) return null;`（保留挂载闸门以避免水合不一致），
   窗口控制三按钮包在 `{isDesktop() && controls && ( … )}` 里。
   浏览器下渲染"品牌 + 动作簇"，没有最小化/最大化/关闭。
2. **props 收敛**：`onLoginClick` / `onProfileClick` / `onAccountSettingsClick`
   全删，只留 `onSettingsClick?: () => void` 与 `showSettingsAttention?: boolean`。
   连带删除 `hasAppActions = !!props.onProfileClick` 这个判据，改为
   `const hasAppActions = !!props.onSettingsClick`。
3. **拖拽区**：浏览器下 `WebkitAppRegion` 是无效 CSS，不需要条件化——保持原样。
4. **【v4 评审修订 P1-1】改名会波及 `src/app/not-found.tsx`**：它在 `:5` import、`:22`
   以 prop-less 形式渲染 `DesktopTitleBar`（`grep -rn "DesktopTitleBar" src/` 可证）。
   §5-P3 已补该文件的修改条目；漏改则重命名当场断 `tsc`。
   另注意 D10 恒渲染后，该页在**浏览器**下会出现一条"仅品牌、无动作簇"的标题栏
   （`hasAppActions = !!props.onSettingsClick` 为 `false`）——这是可接受的既定行为，
   不要为它再加一个 `isDesktop()` 分叉（那正是本次要消灭的双形态分支）。

**`src/components/HeaderActions.tsx` → `src/components/shell/TitleBarActions.tsx`**

- 删除 `HeaderActionsVariant` / `variant` prop 与 `resolveVariantClasses()`
  ——Header 已不存在，只剩 titlebar 一种形态，`VariantClasses` 直接内联为常量。
- 删除 `useAuth()`、`user`、`logout`、`canManageUsers`、`RoleBadge`、头像、
  账号下拉菜单、`onLoginClick`/`onProfileClick`/`onAccountSettingsClick`。
- 保留：语言切换下拉、主题切换按钮（`useTheme`）、设置齿轮（含
  `showSettingsAttention` 琥珀色脉冲点）。
- 保留并强化无障碍：每个图标按钮 `aria-label` + `title`；下拉容器
  `role="menu"`、项 `role="menuitem"`；Esc 关闭下拉；`focus-visible:ring-2
  ring-ring ring-offset-1 ring-offset-card`。

### 4.8 设置中心信息架构重排

**目录**：`src/components/AdminSettings/` → `src/components/settings/`
（`AdminSettingsPage.tsx` → `SettingsPage.tsx`；`SettingsSidebar.tsx` 保留名字）。

**类型（D17）**：

```ts
export type SettingsMenuItem =
  | 'general'        // 新增：语言、外观、启动行为
  | 'model'          // was 'modelSettings'
  | 'tts'            // was 'ttsSettings'
  | 'videoAnalysis'  // was 'videoAnalysisSettings'
  | 'upload'         // was 'uploadSettings'
  | 'watermark'      // was 'watermarkSettings'
  | 'youtube';       // was 'youtubeSettings'
// 删除：'userManagement'、'apiSecurity'、'systemSettings'（占位面板，§2.5）
```

**分组侧栏**（从 9 项平铺 → 3 组 7 项，每组一个小标题）：

| 分组 | 项 | 面板组件 | 说明 |
|------|----|----------|------|
| 应用 | 通用 `general` | `GeneralSettingsPanel`（新建） | 语言、外观（浅色/深色/跟随系统）、启动时自动打开剪辑工作区 |
| AI 能力 | 模型与凭证 `model` | `ModelSettingsPanel`（**仅改错误分支**，见 §4.9.1） | 供应商、密钥、按功能分配模型 |
| | 语音合成 `tts` | `TTSSettingsPanel`（不改） | |
| | 视频理解 `videoAnalysis` | `VideoAnalysisSettingsPanel`（不改） | |
| 媒体与工具 | 上传与存储 `upload` | `UploadSettingsPanel`（不改） | |
| | 水印去除 `watermark` | `WatermarkSettingsPanel`（不改） | |
| | YouTube `youtube` | `YouTubeSettingsPanel`（不改） | |

**`GeneralSettingsPanel` 的来源**：从 `src/components/UserProfile/OtherSettingsPanel.tsx`
（399 行）**移植**语言与主题两块，**丢弃**其余：

- 丢弃 `notifications.{email,push,marketing}`、`privacy.{profileVisible,activityVisible}`
  ——本机单用户应用里这些开关没有任何语义（D9）。
- 丢弃 `fetchUserPreferences` / `useUserPreferencesMutation` 的后端往返（`userPreferences.ts`
  随之删除），语言与主题**只**落 `localStorage`。
- **必须保留的实现细节**（否则会引入主题闪烁与不一致）：
  - `applyTheme()` 同时写 `ecliptrix-theme`（解析后的 `light`/`dark`，供
    `layout.tsx` 的 head 内联脚本读取）和 `ecliptrix-theme-pref`（原始偏好，
    含 `auto`，供下拉回显）。两个键**都要写**。
  - `readCurrentTheme()` 的回退顺序：`ecliptrix-theme-pref` → `ecliptrix-theme`
    → `'dark'`。
  - 所有 `localStorage` 读写包 `try/catch`（受限 webview 会抛）。
  - **【v4 评审修订 P1-5】`auto` 模式的系统主题跟随监听必须一并移植**：
    `OtherSettingsPanel.tsx:211-219` 有一个仅在 `theme === 'auto'` 时挂载的
    `window.matchMedia('(prefers-color-scheme: dark)')` `change` 监听，回调是
    `() => applyTheme('auto')`，并在 cleanup 里 `removeEventListener`。
    漏移植的表现很隐蔽：设置里选"跟随系统"看起来正常，但用户在 Windows 里切换
    浅色/深色时应用**不再实时跟随**，要等下次启动才对——属功能回归，不是样式问题。
- 新增"启动时自动打开剪辑工作区"开关是**可选增强**；若实现，键名
  `ecliptrix-autostart-editor`，默认 `true`，由 §4.6 的 `didAutoOpenRef` 分支读取。
  **若时间紧张，本项可不做**——不做时 §4.6 骨架保持无条件 `createTask('video')`。

### 4.9 HTTP 客户端去鉴权（`src/lib/api/http-client.ts`）

**删除**：

- `SESSION_TOKEN_KEY` 导入与注入（`:24`、`:291`）；
  **【v4 评审修订 P2-3】同一 import 块里的 `SESSION_USER_KEY`（`:25`）与
  `clearSessionToken`（`:26`）也要删**（消费点在 `:169-170` 的 401 清仓逻辑），
  并顺带删掉 `isDesktop` 导入（`:28`）——它在本文件里**只**服务 401 跳转分支
  （`:189`），分支删掉后会变成未使用导入，`npm run lint` 直接报错；
- `MissingAuthError`（`:53`）、`SessionExpiredError`（`:66`）、`ForbiddenError`（`:76`）；
- `requireAuth` 选项（`:37`、`:395`、`:401`、`:516`）——连同全仓库 **38 处**
  `requireAuth` 调用点一并清除（`grep -rn "requireAuth" src/`）；
- 401 全局去抖跳转 `/login`（`:158` `NO_REDIRECT_PATHS`、`:186-195`）——登录路由已不存在。

**必须保留**（v2 的 P1-6 结论，v3 复核仍成立）：

- `RateLimitError`（`:121`）与 429 / `Retry-After` 解析（`:224-263`）——D4 删掉的是
  **全局限流中间件**；`media_proxy_service.py` 自身的每-IP 下载节流按 D4 明确保留，
  它仍会返回 429。删掉解析分支会让素材代理的节流错误退化成未分类错误。
- `ApiError`、路径白名单、超时、重试、统一错误封装。

#### 4.9.1 【v4 评审修订 · P0-1】三个错误类的调用点迁移（漏一处即断门禁）

`MissingAuthError` / `SessionExpiredError` / `ForbiddenError` 在 `http-client.ts` **之外**
还有 4 类消费者，v3 的 §5-P3 一个都没列。复核命令：

```bash
grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/ | grep -v http-client.ts
```

| # | 文件 | 现状 | P3 必须做的处置 |
|---|------|------|-----------------|
| 1 | `src/components/AdminSettings/ModelSettingsPanel.tsx`（`:6` import，`:289`/`:291` `instanceof`） | 保存供应商失败时按 `MissingAuthError` / `SessionExpiredError` 给不同提示 | 删 import；两个分支并入既有的 `ApiError` / 兜底分支（本机应用不会再有"未登录 / 会话过期"这类失败）。**§4.8 面板表已同步改为"仅改错误分支"**——不要照 v3 的"（不改）"施工，那会直接断 `tsc` |
| 2 | `src/components/video/timeline/infrastructure/RemoteMaterialPrefetchAdapter.ts`（`:307-308`） | 用 `err.name === 'MissingAuthError' \|\| 'SessionExpiredError'` 决定"致命错误立即中止轮询" | 删这两个 `err.name` 判据（保留 `AbortError` / `TimeoutError`）。不删不断编译，但会留下永假分支——正是本次要清的死代码 |
| 3 | `src/components/video/timeline/__tests__/RemoteMaterialPrefetchAdapter.test.ts`（`:5-6` import，`:255-261`、`:300-317` 两个用例） | 断言"无会话令牌时抛 `MissingAuthError`"与"401 时 `SessionExpiredError` 向外传播" | 两个用例**整体删除**（所验证的行为已不存在），并去掉 `:9` 的 `SESSION_TOKEN_KEY` 预置；其余用例保留 |
| 4 | `src/lib/api/__tests__/llm.test.ts`（`:21-34` 的 `vi.mock` 自造类、`:100-105` 的 C6 用例） | 断言 `fetchLLMModels` 会向外传播 `SessionExpiredError` | 删 mock 里的假类与 C6 用例；成功路径与 `ApiError` 传播用例保留。该文件 v3 未列入清单，务必补上 |

另有 3 处**仅注释**引用，顺手订正，不影响编译：`src/lib/api/audioTranscription.ts:12,83,102`
与 `src/lib/api/llm.ts:17` 的 `@throws` 段。

`src/lib/api/__tests__/http-client.test.ts` 中以这三个类为主体的用例（T1 / T7 / T8 / T9 以及
401 去抖并发用例）同样整体删除——但**不要**顺手删掉 429（`RateLimitError`）、超时、路径白名单
三组断言，它们是本节"必须保留"清单的守卫（v2 P1-6 踩过的坑）。

**`src/lib/api/server/backend-proxy.ts`**：删除 `:139-146` 的 `Authorization` 与
`x-session-token` 透传，以及 `:15` 对应的文件头注释；保留 URL 拼接、超时、流式
转发与错误封装。同步更新 `src/lib/api/__tests__/http-client.test.ts` 与
`server/__tests__/`（去掉令牌注入断言，保留 429/超时/白名单断言）。

### 4.10 BFF 路由与构建配置（P4）

- 删除 19 个路由目录（清单见 §5-P4）。
- `next.config.js:36`：`output: process.env.DESKTOP_BUILD === '1' ? 'standalone' : undefined`
  → `output: 'standalone'`（桌面是唯一目标）。
  ⚠️ **`DESKTOP_BUILD` 环境变量本身不要删**——先
  `grep -rn "DESKTOP_BUILD" desktop/ src/ package.json` 确认其它消费者；
  `next.config.js` 顶部关于遗留 env 名的告警块与 `src/lib/config/backend.ts:58`
  的 `LEGACY_ENV_VAR_NAMES` 在注释里互相声明"必须同步"，**要么都留，要么都删**，
  只删一侧会留下悬挂引用。本方案选择**都留**（它们与鉴权无关，且仍在为误配
  `BACKEND_SERVICE_URL` 的用户提供有效诊断）。
- `src/app/api/video-proxy/route.ts`：`ALLOWED_HOSTS` 删除
  `'ecliptrix.oss-cn-beijing.aliyuncs.com'` 一行（D15），保留 ARK CDN 项与
  路由本身。

### 4.11 桌面主进程去凭证（P5）

| 文件 | 改动 |
|------|------|
| `desktop/preload/preload.js` | 删 `:23` 的 `getBootstrapCredentials` 与 `:13` 相关注释；`contextBridge` 暴露面收敛为 `{ version, logsPath, windowControls }` |
| `desktop/main/index.js` | 删 `auth:bootstrap-credentials` 的 `ipcMain.handle`，以及 `:112-119` 读取 `ROOT_USERNAME`/`ROOT_PASSWORD` 组装凭证的整段。**保留** `:255-272` 本轮新增的窗口生命周期日志（与鉴权无关） |
| `desktop/main/envCheck.js` | 删 `:15` `STALE_FACTORY_ROOT_PASSWORDS` 常量与 `:118-128` 的 root 口令迁移分支；`missingRequiredKeys` 移除 `ROOT_*` |
| `desktop/main/window-state.test.js` | **【v4 评审修订 P1-2】该文件实际有 5 个 ROOT 相关用例，且不能一刀切"换个键"**：① `testDesktopTemplateUsesAdminAdminRootDefault`（`:76`）、② `testBackfillMigratesStaleFactoryRootPassword`（`:92`）、③ `testBackfillMigratesChangeMeFactoryRootPassword`（`:116`）测的正是 P5 要删掉的 `STALE_FACTORY_ROOT_PASSWORDS` 自愈分支与模板 ROOT 默认值——**行为消失后无法换键保留，整例删除**；④ `testBackfillPreservesCustomRootPassword`（`:143`）、⑤ `testBackfillPreservesChangedRootUsername`（`:158`）测的是"用户改过的值不被模板覆盖"这个**通用**回填语义，把 `ROOT_PASSWORD`/`ROOT_USERNAME` 换成 `LLM_API_KEY`/`VOLCANO_TTS_API_KEY` 即可保留。文件顶部 5 个窗口尺寸用例（`:16-74`）与本次无关，一律不动 |
| `desktop/scripts/env.template.desktop` | 删 `ROOT_USERNAME`/`ROOT_PASSWORD`/`INVITE_CODE` 段与"启动后需登录"说明 |
| `desktop/scripts/prepare-env.js` | **【v4 评审修订 P1-8】该脚本有活代码，不止注释**：`:38` 的 `const LOCAL_ADMIN_KEYS = ['ADMIN_USERNAME', 'ADMIN_PASSWORD']` 及其并入 `EXCLUDED_KEYS`（`:39`）的引用一并删除——它存在的唯一理由是"别把构建机的管理员口令打进安装包"，而该口令概念已随 P1 消失。同时重写 `:29-37` 的注释块：其中引用的 `config.py:928-929`（root 播种）在 P1 已被删除，是二次悬挂引用 |
| `desktop/scripts/smoke-test.js` | **【v4 评审修订 P1-3】v3 的提法既不可实现又会掉覆盖**：该脚本靠轮询 `userData/logs/main.log` 判断窗口加载，**没有渲染进程内省能力**，"首屏出现工作区容器"需要 CDP / Playwright，属新增能力、超范围。改为三步：① 删 `SMOKE_USERNAME` / `SMOKE_PASSWORD` 与写进 `.env` 的 `ROOT_*` 播种（`:97-98`）；② 删登录步骤（`:139-146`）；③ 把原第 3 步改成**不带任何鉴权头**请求 `GET /api/video-projects` 并断言 200——它同时证明"无鉴权"与"SQLite 读通"，比原来的带 `Bearer` 断言**更强**，绝不能简单删掉。`/api/config/llm-status`、SQLite 文件、分类日志、窗口加载四组断言原样保留 |
| `src/types/desktop.d.ts` | 删 `BootstrapCredentials` 接口与 `EcliptrixDesktopBridge.getBootstrapCredentials` 声明 |

---

## 5. 文件 / 模块变更计划

图例：`D` 删除 · `M` 修改 · `A` 新增 · `R` 重命名（`git mv`）。
**P0/P1/P2 已落地，不再列出待办项**（复核清单见 §2.1）。

### P0-R — 【v4 评审新增 · P0-2 / D19】文档定点回退（动工前第一件事）

| 操作 | 路径 | 意图 |
|------|------|------|
| 回退 | `docs/diagnoses/**`（93 文件） | 桌面端自身的缺陷根因档，92 处源码注释指向它们（§2.6） |
| 回退 | `docs/plans/**`（215 文件） | 含 `vitest.config.ts:3`、`vitest.integration.config.ts:4`、`CLAUDE.md:150` 指向的规格档 |
| 回退 | `docs/fixes/**`（1 文件） | 同上 |

```bash
git restore --staged --worktree docs/diagnoses docs/plans docs/fixes
git diff --cached --name-status -- docs/ | wc -l        # 期望 0
git diff --cached --shortstat                           # 期望降到约 129 files
```

⚠️ 命令**只**列出这三个路径。禁止 `git restore .` / `git checkout .`——那会把 P0/P1/P2
的 109,046 行删除一并还原（R-11）。回退后再执行 R-11 的"提交现有工作区"。

### P3 — 前端：外壳与鉴权收敛（主体工作，删除约 5,214 行 + 测试，净减约 5,000 行）

| 操作 | 路径 | 意图 |
|------|------|------|
| A | `src/lib/localOwner.ts` | 前端 `LOCAL_OWNER_ID` 常量，与 `app/constants.py` 双向注释互指（D18，修复后端 docstring 的悬挂引用） |
| D | `src/app/login/` | 删除登录路由（48 行） |
| D | `src/components/auth/{AuthGate,LoginScreen,useLoginForm}` | 删除登录闸门、登录页与表单（468 行） |
| D | `src/components/LoginModal.tsx` + `src/components/__tests__/LoginModal.a11y.test.ts` | 删除登录弹窗（296 行）与其 a11y 测试 |
| D | `src/components/HomePage/`（含 `__tests__/LandingPage.a11y.test.ts`） | 删除 Web 着陆页（150 行） |
| D | `src/components/{Header,Footer,GlobalMobileDetection}.tsx` | 删除 Web 页面外壳与移动端提示（166 行） |
| D | `src/hooks/useMobileDetection.ts` | 删除移动端检测（仅服务 `GlobalMobileDetection`） |
| D | `src/components/UserProfile/`（4 个面板 + `__tests__/UserInfoPanel.test.tsx`） | 删除账号资料页（789 行）；语言/主题迁入 `GeneralSettingsPanel` |
| D | `src/contexts/AuthContext.tsx` + `src/contexts/__tests__/AuthContext.network.test.ts` | 删除前端会话状态机与 5 分钟轮询（435 行） |
| D | `src/lib/auth/`（`sessionGuard.ts` 147 + `storage-keys.ts` 60） | `sessionGuard` 今天已零引用（§2.5）；`storage-keys` 随会话删除 |
| D | `src/lib/desktop/desktopAuth.ts` | 删除桌面静默登录桥（33 行） |
| D | `src/types/auth.ts` | 删除 `User` / 角色类型 |
| D | `src/lib/api/{auth,userManagement,userPreferences,rateLimitSettings}.ts` + `__tests__/{auth,userManagement,userPreferences}.test.ts` | 删除鉴权/用户/偏好/限流客户端（717 行） |
| D | `src/components/ui/RoleBadge.tsx`，并从 `src/components/ui/index.ts` 移除其导出 | 角色概念随 RBAC 消失（D15） |
| M | `src/app/layout.tsx` | 移除 `AuthProvider` 与 `GlobalMobileDetection` 的 import 与挂载；`LocaleProvider → NotificationProvider → children` 保留；head 内联主题脚本**保留不动** |
| M | `src/app/not-found.tsx`（`:5`、`:22`） | **【v4 评审修订 P1-1】**改 import 路径为 `@/components/shell/AppTitleBar` 并改标签名。漏改则重命名当场断 `tsc`（`grep -rn "DesktopTitleBar" src/` 可证只有 `page.tsx` 与本文件两个真实消费者） |
| M | `src/components/Container.tsx`（`ContainerProps` + `:73-110` 空态） | **【v4 评审修订 P0-3 / D20】**新增可选 `onCreateTask`；空态两张介绍卡片改为可操作 `<button>`（`aria-label` + `focus-visible:ring-2`），文案复用现有 `t.welcome.*` / `t.tasks.*`，零新增 i18n 键。详见 §4.6.1 |
| M | `src/components/AdminSettings/ModelSettingsPanel.tsx`（`:6`、`:289`、`:291`） | **【v4 评审修订 P0-1】**删 `MissingAuthError` / `SessionExpiredError` 的 import 与两个 `instanceof` 分支，并入既有 `ApiError` / 兜底分支。§4.8 面板表的"不改"标注已同步更正 |
| M | `src/components/video/timeline/infrastructure/RemoteMaterialPrefetchAdapter.ts`（`:307-308`） | **【v4 评审修订 P0-1】**删两条 `err.name === 'MissingAuthError' / 'SessionExpiredError'` 判据，保留 `AbortError` / `TimeoutError` |
| M | `src/lib/api/__tests__/llm.test.ts`（`:21-34`、`:100-105`） | **【v4 评审修订 P0-1】**删 `vi.mock` 里自造的 `SessionExpiredError` 与 C6 用例；其余用例保留 |
| M | `src/hooks/useLlmConfigStatus.ts` | **【v4 评审修订 P2-2】**删 `enabled` 形参与相关 docstring（鉴权消失后恒为 `true`）、删 `{ requireAuth: false }` 调用选项（`:52`，属 38 处之一）。同步更新 `page.tsx` 的调用为无参形态 |
| M | `src/app/page.tsx` | 按 §4.6 重写（255 → ~110 行） |
| R+M | `src/components/desktop/DesktopTitleBar.tsx` → `src/components/shell/AppTitleBar.tsx` | 按 §4.7 恒渲染 + props 收敛。目录 `src/components/desktop/` 随之为空则删除 |
| R+M | `src/components/HeaderActions.tsx` → `src/components/shell/TitleBarActions.tsx` | 按 §4.7 收敛为"语言 / 主题 / 设置" |
| M | `src/components/VerticalTaskbar.tsx`（`:24`） | 移除 `useAuth()`（当前用 `isAuthenticated` 决定新建任务是否提示登录），改为无条件允许新建；**props 契约不变**（它从不接收 `onHomeClick`）。同步检查 `__tests__/VerticalTaskbar.a11y.test.ts` 是否需要去掉 AuthProvider 包裹 |
| R+M | `src/components/AdminSettings/` → `src/components/settings/` | 见 §4.8；`AdminSettingsPage.tsx` → `SettingsPage.tsx` |
| D | `src/components/settings/{UserManagement,RateLimitSettings}.tsx` | 删除用户管理（1,374 行）与限流管理台（295 行） |
| A | `src/components/settings/GeneralSettingsPanel.tsx` | 从 `OtherSettingsPanel` 移植语言 + 主题，丢弃通知/隐私与后端往返（§4.8） |
| M | `src/components/settings/SettingsSidebar.tsx` | 按 §4.8 改为 3 组 7 项 + 分组小标题；`SettingsMenuItem` 按 D17 重命名 |
| M | `src/components/settings/SettingsPage.tsx` | `initialItem` 默认值 `'userManagement'` → `'general'`；`switch` 删除 `userManagement`/`apiSecurity`/`systemSettings` 三个 case，新增 `general`；`import UserManagement/RateLimitSettings` 删除。**保留** Esc 关闭 + 焦点归还的 `useEffect`（无障碍资产） |
| M | `src/components/settings/__tests__/*`（3 个）与 `src/components/settings/components/__tests__/*`（2 个） | **【v4 评审修订 P2-4】**影响面是 **5** 个测试文件，不是 3 个：`__tests__/{ModelSettingsPanel.form.test.tsx,ModelSettingsPanel.test.ts,TTSSettingsPanel.invariant.test.tsx}` 与 `components/__tests__/{SettingsFieldHelpers.test.tsx,useSettingsPanel.test.ts}`。其中 `ModelSettingsPanel.test.ts` 与 `useSettingsPanel.test.ts` 正文里写死了 `components/AdminSettings` 路径，必须改；其余 3 个只需跟随 `SettingsMenuItem` 成员名 |
| M | `src/lib/api/http-client.ts` + `__tests__/http-client.test.ts` | 按 §4.9 去鉴权，**保留** `RateLimitError`/429 分支 |
| M | `src/lib/api/server/backend-proxy.ts` + `__tests__` | 删除 `Authorization` / `x-session-token` 透传（`:139-146`） |
| M | 全部 38 处 `requireAuth` 调用点（`grep -rn "requireAuth" src/`） | 随选项删除而清理 |
| M | `src/components/video/hooks/useMaterialManagement.ts`（`:49,:290`） | 删 `useAuth()`；`useMaterialUpload({ … user })` 的 `user` 实参改为传 `LOCAL_OWNER_ID`（同步调整 `materialManagement/useMaterialUpload.ts` 的入参类型） |
| M | `src/components/video/components/MyMaterialsModal/MyMaterialsModal.tsx`（`:22,:48,:56`） | `user.id` → `LOCAL_OWNER_ID` |
| M | `src/components/video/components/AiImageModal/MaterialLibraryGrid.tsx`（`:23,:39`） | 同上 |
| M | `src/components/video/VideoEditingInterface.tsx`（`:142`） | **【v4 评审修订 P2-5】**该处 `const { user } = useAuth();` 是**未使用解构**——全文件对 `user` 零下游引用（`grep -n "user\.\|user?\." src/components/video/VideoEditingInterface.tsx` 只命中注释里的 "user"）。直接删两行（import + 解构）即可，不需要"逐一替换" |
| M | `src/components/video/hooks/useAgentExecution.ts`（`:28,:288-291`） | 移除 `SESSION_TOKEN_KEY` 导入与 `Authorization` 注入。**必须与删 `src/lib/auth/` 同一提交**，否则 `tsc` 立刻断 |
| M | `src/components/video/timeline/__tests__/RemoteMaterialPrefetchAdapter.test.ts`（`:9`） | 同上，去掉会话令牌预置 |
| D | `src/components/video/playback/telemetry.ts` + `playback/__tests__/telemetry.{test,pii.test}.ts`，并从 `playback/index.ts:44-50` 移除导出 | 前端播放遥测随后端 `/api/telemetry/playback` 一起删除；实测零构造点（§2.5） |
| M | `src/lib/i18n.ts`（7,889 行） | 删除登录/注册/邀请码/用户管理/限流文案键。`grep -n "login\|register\|inviteCode\|userManagement" src/lib/i18n.ts` 命中 **72 行**，需逐条确认（`t.auth.*`、`t.adminSettings.userManagement*`、`t.adminSettings.apiSecurity*`、`inviteCode*`）。⚠️ 三份结构必须同改：类型声明块（`:42` 起）、英文块（`:2661` 起）、中文块（`:5293` 起）——漏改任一份都会让 `tsc` 报错或运行期取到 `undefined` |
| D | `tests/integration/auth-flow.test.ts`、`tests/integration/helpers/test-user.ts` | 删除鉴权集成测试与测试用户夹具 |
| M | `tests/integration/backend-proxy-integration.test.ts`、`tests/integration/helpers/spawn-stack.ts` | 去掉登录预置步骤。**【v4 评审修订 P1-6】`vitest.config.ts` 有 `exclude: ['tests/integration/**']`，`npm test` 跑不到这些文件**——改完必须用 `npm run test:integration` 单独验证并贴输出（见 §10.1 门禁清单第 5 条）；若该环境确实起不了真后端，则在提交信息里显式写明"integration 未跑"，不得默认它们是绿的 |

### P4 — 前端：BFF 路由与死代码清理（约 −200 行）

| 操作 | 路径 | 意图 |
|------|------|------|
| D | `src/app/api/auth/{login,validate-session}/` | 随后端登录端点删除 |
| D | `src/app/api/user/{profile,me/preferences}/` | 随用户资料/偏好端点删除（D9） |
| D | `src/app/api/admin/users/**`（9 个路由） | 随用户管理端点删除 |
| D | `src/app/api/rate-limit/{config,status,reset}/` | 随限流管理端点删除（D4） |
| D | `src/app/api/workflow/{ai-video-generate,video-export}/` | 已确认零调用点（工作流特性早已下线） |
| D | `src/app/api/timeline-export/` | 已确认零调用点（`timeline-import` 有 2 处调用，export 为 0；`TimelineRepository.ts:312` 命中的只是一个文件名字符串） |
| M | `next.config.js:36` | `output: 'standalone'` 改为无条件；**保留**遗留 env 告警块（§4.10） |
| M | `src/app/api/video-proxy/route.ts` | `ALLOWED_HOSTS` 删除 OSS 项，保留 ARK CDN 与路由本体（D15） |
| M | `src/hooks/useTasks.ts` | 仅当 `grep -rn "closeAllTabs" src/` 在 P3 后归零时，才删除 `closeAllTabs`；否则保留 |

删除后 `src/app/api/` 由 **122** 个 `route.ts` 降到 **103** 个。

### P5 — 桌面外壳与打包收敛

见 §4.11 的逐文件表，此处不重复。**验收补充**：`desktop/main/window-state.test.js`
改造后必须实跑 `node desktop/main/window-state.test.js`（或 `npm test -w desktop`
如已配置）并贴出输出。

### P6 — 文档与收尾

| 操作 | 路径 | 意图 |
|------|------|------|
| M | `README.md` / `README.zh-CN.md` | 重写为桌面应用说明：`cd desktop && npm run dev` / `npm run build`；删除 PostgreSQL、`install.sh`/`start.sh`/`kill.sh`、`ops/` 部署章节、多用户/登录说明 |
| M | `CLAUDE.md` | ① 命令区删 `install.sh`/`start.sh`/`kill.sh`/`alembic upgrade head`，桌面命令补齐；② Database 章改 SQLite-only（删 PostgreSQL/Alembic/asyncpg、删 `AgentWorkflow` 描述）；③ Auth 约定章改为"无鉴权，单一本机所有者 `LOCAL_OWNER_ID` / `LOCAL_OWNER_NAME`"；④ **【v4 评审修订 P2-6】过期描述共 6 处，不止 2 处**：「Gitignore is minimal」（实测已 98 行）、「`src/components/workflow/`（node-based visual builder）」（目录不存在）、`:27`「`run.py`（used by `start.sh`）」、`:133`「目录结构由 `install.sh` 创建」（改为"由 Electron 主进程 `initUserData()` 在首启时创建"）、`:150` 指向已删除的 `docs/plans/video-editor-playback-optimization/`（P0-R 回退后该路径恢复，仅需复核）、Backend Structure 的「registers 23 routers」（实测 `grep -c "app.include_router" app/main.py` = **32**）；⑤ 前端结构章把 `AuthContext` 从 Context 列表移除、`src/components/AdminSettings/` 改为 `src/components/settings/` |
| M | `backend-services/basic-service/README.md`、`env.template`、`env.template`（根） | 删除 PostgreSQL / 鉴权 / 限流 / `ROOT_*` / `INVITE_CODE` 相关说明与变量 |
| M | `.claude-index/index.md`、`.claude-index/config.md` | 最后一步重新生成索引 |

### P7 — 门禁修复与收尾（v3 新增，D16）

| 操作 | 路径 | 意图 |
|------|------|------|
| M | `backend-services/basic-service/tests/test_thumbnail_service.py`（`:220-236`） | **H-1**：`thumb_client` fixture 删除 `from app.dependencies.auth import get_current_user` 与 `app.dependency_overrides[get_current_user] = …` 两行，以及末尾 `app.dependency_overrides.clear()`。路由已无鉴权依赖，直接 `include_router` + `patch.object(storage_router, "thumbnail_service", thumb_svc)` 即可。改完这 3 个用例必须转 pass |
| M | `backend-services/basic-service/tests/test_tts_api.py`（`:417-421`） | **H-2**：`pytest.config.getoption("--integration")` 是 pytest 5.0 移除的 API，且 `--integration` 从未注册。改为模块级 `pytestmark = pytest.mark.skipif(os.getenv("RUN_TTS_INTEGRATION") != "1", reason="needs live Volcano TTS credentials")`，并在文件顶部 `import os`。选择环境变量而非 `addoption`，因为仓库根本没有注册该选项的 `conftest` 钩子，加钩子等于扩大改动面 |
| M | `backend-services/basic-service/tests/test_content_polish_api.py`（`:135` 及同类行） | **H-3**：bytes 字面量含非 ASCII → `SyntaxError`。**【v4 评审修订 P2-1】该行的真实字面量是 `"测试响应"`，不是 v3 写的 `"中文响应"`**——照抄 v3 的片段会静默改掉夹具数据。正确改法：`'data: {"choices": [{"delta": {"content": "测试响应"}}]}'.encode("utf-8")`，只改容器（`b'...'` → `'...'.encode()`），**不动字面量内容**。全文件扫描用 Python（v3 给的 `grep` 字节区间在 Git Bash 的 UTF-8 locale 下不可靠）：`python -c "import io;[print(i+1,l.rstrip()) for i,l in enumerate(io.open('tests/test_content_polish_api.py',encoding='utf-8')) if \"b'\" in l and any(ord(c)>127 for c in l)]"` |
| M | `backend-services/basic-service/tests/conftest.py`（`:23` 附近） | **【v4 评审修订 P1-4】v3 的措辞会诱导删掉一个承重件**。实测：该 stub 是 **cv2 stub**，安装原因是 `app/services/__init__.py` 急切 import `video_composition_service` → `import cv2`；`rate_limiter` 只是当年被连累的**举例**。**只改注释**（把失效的 `rate_limiter` 举例换成仍然成立的例子，如 `app.services.thumbnail_service`），**cv2 stub 与 `postgresql.UUID`/`JSONB` 的 dialect shim 一律保留**——删掉任何一个都会让整套后端测试在本机无法收集，直接毁掉 A4 |
| M | `backend-services/basic-service/tests/test_no_auth_surface.py` | 该测试已断言 `telemetry_router`/`admin_playback_router` 不可导入、`app.dependencies.auth` 无家可归。**补一条断言**：`src/` 侧不再存在 `SESSION_TOKEN_KEY`（可放前端测试）——或在前端新增 `src/lib/api/__tests__/no-auth-surface.test.ts` 做等价守卫 |
| A | `src/lib/api/__tests__/no-auth-surface.test.ts`（新建） | 回归护栏：断言 `http-client` 不再导出 `MissingAuthError`/`SessionExpiredError`/`ForbiddenError`/`requireAuth`，且**仍**导出 `RateLimitError`（防止后人"顺手"把 429 分支也删了，这是 v2 P1-6 踩过的坑） |

---

## 6. 接口设计（Interface Design）

### 6.1 已删除的 HTTP 端点（P1 已落地）

| 方法 | 路径 | 原归属 |
|------|------|--------|
| POST | `/api/auth/{login,register,logout,validate-session}` | `auth_router` |
| GET/POST/PUT/DELETE | `/api/users/**`（列表、创建、编辑、删除、重置密码、启停、强制下线、登录历史、统计） | `user_router` |
| GET/PATCH | `/api/user/me`、`/api/user/me/preferences`、`/api/user/profile` | `user_router` |
| GET/PUT/POST | `/api/rate-limit/{config,status,reset}` | `rate_limit_settings_router` |
| POST | `/api/telemetry/playback` | `telemetry_router` |
| GET | `/api/admin/{playback-metrics,playback-proxies}` | `admin_playback_router` |

对应的 Next.js BFF 路由由 **P4** 同步删除（目前仍在，处于"前端还在、后端已无"的
悬挂状态——这正是 P4 必须做的理由：现在调用它们会拿到后端 404 而不是明确的
"功能已下线"）。

### 6.2 保留端点的契约变化

所有保留端点**路径、请求体、响应体形状均不变**，唯一变化是：

- 不再要求 `Authorization: Bearer <token>` / `X-Session-Token` /
  `ecliptrix-session-token` cookie；携带也不会报错（直接被忽略）。
- 不再返回 `401 SESSION_EXPIRED` / `403 FORBIDDEN`；原先由 `require_admin` 保护的
  设置类端点（`/api/model-settings/**`、`/api/system-settings/**`）对本机调用方
  无条件开放。
- **全局限流**产生的 `429 RATE_LIMITED` 与 `X-RateLimit-*` 响应头消失。
  **但不是"再也不会有 429"**：`/api/media-proxy` 自身的每-IP 下载节流按 D4 保留，
  仍可能返回 429，因此前端 `RateLimitError` 解析分支**必须保留**（§4.9）。
- 响应头集合：`X-Process-Time`、`X-Content-Type-Options: nosniff`、
  `Referrer-Policy: strict-origin-when-cross-origin`、
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`，以及 CORS 头。
- 素材接口 `/api/storage/user-materials?user_id=…` 的 `user_id` **仍然存在**，
  但语义变为"本机所有者标记"：**读**忽略它（枚举全部 `user_*` 目录，D13），
  **写**使用它。前端恒传 `LOCAL_OWNER_ID`（§4.5）。

### 6.3 Electron IPC 通道（重构后）

| 通道 | 方向 | 保留？ |
|------|------|--------|
| `window:minimize` / `window:toggle-maximize` / `window:close` / `window:is-maximized` | 渲染 → 主 | 保留 |
| `window:maximize-changed` | 主 → 渲染 | 保留 |
| `auth:bootstrap-credentials` | 渲染 → 主 | **删除**（D12 / P5） |

`window.ecliptrixDesktop` 的类型定义 `src/types/desktop.d.ts` 同步删除
`getBootstrapCredentials` 与 `BootstrapCredentials`。`CSSStyleDeclaration` /
`react.CSSProperties` 的 `WebkitAppRegion` 增补**保留**（标题栏仍需要）。

### 6.4 命令行 / npm scripts（重构后）

| 命令 | 位置 | 用途 |
|------|------|------|
| `npm run dev` | 仓库根 | Next 开发服务器 :3000（浏览器调试链路，仍可用） |
| `npm run type-check` / `lint` / `test` | 仓库根 | 前端门禁 |
| `npm run dev` | `desktop/` | 拉起后端 + 前端 + Electron 的完整开发链路 |
| `npm run build` | `desktop/` | 产出 Windows 安装包 |
| `npm run smoke-test` | `desktop/` | 打包产物冒烟 |
| `pytest tests/ -v` | `backend-services/basic-service/` | 后端门禁（**P7 之后才真正可用**） |

已删除：`bash install.sh`、`bash start.sh`、`bash kill.sh`、`alembic upgrade head`、
`ops/deploy.sh` 等全部服务器命令。

---

## 7. 数据模型（Data Model）

### 7.1 重构后的表清单（SQLite，`create_all` 建表）

| 表 | 状态 | `user_id` 语义 |
|----|------|----------------|
| `video_projects` | 保留 | 恒 `LOCAL_OWNER_ID`（D2 幂等认领） |
| `video_project_categories` | 保留 | 同上 |
| `storyboard_packs` | 保留 | 同上 |
| `project_covers` | 保留 | 同上 |
| `cached_materials` | 保留 | 无 `user_id` 列 |
| `model_providers` / `model_assignments` | 保留 | 本就全局，无所有者 |
| `system_settings` / `system_settings_audit` | 保留 | `updated_by` 写 `LOCAL_OWNER_NAME` |
| `users` / `login_history` | **从 ORM 删除，既有表不 DROP**（D3） | 惰性遗留数据，新库不会创建 |
| `agent_workflows` | 早已下线 | 同上 |

### 7.2 `user_id` 列的新语义

```python
# app/models/db_models.py（示意）
user_id = Column(
    PG_UUID(as_uuid=False), nullable=False, index=True,
    # Single-owner marker. There is no user table any more — every row is
    # owned by app.constants.LOCAL_OWNER_ID. Kept as a column (rather than
    # dropped) because dropping it would require destructive DDL on existing
    # user databases, which this project has twice been burned by.
)
```

**不加唯一约束、不加外键、不改类型**——这是 D2 幂等 UPDATE 能成立的前提。

### 7.3 兼容矩阵

| 场景 | 结果 |
|------|------|
| 全新安装 | `create_all` 建表；认领 UPDATE 命中 0 行；素材目录从 `user_<LOCAL_OWNER_ID>/` 开始 |
| 从旧版本升级（库里 `user_id` = 真实 root UUID） | 启动时幂等 UPDATE 把 4 张表的行认领给 `LOCAL_OWNER_ID`；`users`/`login_history` 保留但不再被读；旧素材因 D13 的"读放宽"仍可见 |
| 旧 `.env` 带 `DATABASE_URL=postgresql+asyncpg://…` | `_resolve_database_url()` 大声降级为 SQLite（已落地），不会因缺 PG 驱动崩在启动期 |
| 回滚到旧版本 | 数据库结构未变，旧版本仍可读；但 `user_id` 已被改写为常量 UUID，旧版本的 root 用户会看不到这些行（**已知单向性，见 §11 R-3**） |

### 7.4 前端持久化（localStorage / sessionStorage）

| 键 | 用途 | 变化 |
|----|------|------|
| `ecliptrix-theme` | 解析后的主题（`light`/`dark`），供 `layout.tsx` head 内联脚本首帧读取 | 保留 |
| `ecliptrix-theme-pref` | 原始偏好（含 `auto`），供设置下拉回显 | 保留（迁入 `GeneralSettingsPanel`） |
| `ecliptrix-locale` | 语言 | 保留 |
| `ecliptrix-tasks` 等标签页状态（`useTasks`） | 工作区标签 | 保留 |
| `ecliptrix-setup-guide-dismissed`（sessionStorage） | 首启引导本会话不再提示 | 保留 |
| `ecliptrix-autostart-editor` | 启动时自动打开剪辑工作区 | **可选新增**（§4.8） |
| `ecliptrix-user` / `ecliptrix-session-token` | 会话 | **删除**（P3） |
| `ecliptrix-other-settings` | 通知/隐私开关 | **删除**（D9，无语义） |

---

## 8. 人机交互与视觉设计规范

本次不重定义设计语言，但**收敛后的外壳必须达到桌面应用的基本水准**。以下为验收级
要求，不是建议。

### 8.1 首屏

- **零登录**：启动后不出现任何身份输入。
- **【v4 评审修订 P0-3】零死路**：任何时刻都必须存在一条可见、可键盘到达的"新建任务"路径。
  关掉最后一个标签页后，右侧空态的两张卡片就是这条路径（§4.6.1）；它们必须是真按钮
  （`<button>` + `aria-label` + 可见焦点环），不是装饰。**验收方式**：§10.3 走查第 11 条。
- **零空窗**：水合前渲染中性占位（`bg-background`，无文字、无 spinner 闪烁）；
  水合后立即进入剪辑工作区。占位与工作区的背景色必须一致，避免"闪一下白/灰"。
- **首启引导非阻塞**：LLM 未配置时 `SetupGuideDialog` 可关闭，关闭后本会话不再打扰；
  设置齿轮上保留琥珀色脉冲点作为持续但低干扰的提示。

### 8.2 标题栏（40px）

- 三段式：品牌（可拖拽，双击最大化）/ 弹性拖拽区 / 命令区（`no-drag`）。
- 命令区顺序固定：语言 → 主题 → 设置 → 分隔线 → 最小化 / 最大化 / 关闭。
- 关闭按钮 hover 为红色（`hover:bg-red-600 hover:text-white`），其余按钮
  `hover:bg-accent`——遵循 Windows 桌面惯例。
- 浏览器调试链路下，命令区只到"设置"为止，分隔线与窗口控制不渲染。

### 8.3 设置中心

- 侧栏 3 组 7 项，每组有小标题（`text-xs uppercase tracking-wide
  text-muted-foreground`），项内含 label + 一行描述。
- 默认落点 `general`——用户打开设置最可能是改语言/主题，而不是配模型。
- Esc 关闭并把焦点归还给触发元素（现有 `useEffect` 已实现，**务必保留**）。
- 面板内的输入框在聚焦时不被 Esc 关闭页面误伤（现有实现已判断
  `INPUT`/`TEXTAREA`/`isContentEditable`，**务必保留**）。

### 8.4 无障碍（每个改动过的组件都要满足）

- 所有图标按钮有 `aria-label`（且与 `title` 一致）。
- 下拉菜单：容器 `role="menu"`、项 `role="menuitem"`、`aria-expanded` 随开合更新、
  Esc 关闭、点击外部关闭。
- 焦点可见：`focus-visible:ring-2 focus-visible:ring-ring`，禁止 `outline: none`
  裸删焦点环。
- 删除组件时**连带删除**其 a11y 测试（`LoginModal.a11y.test.ts`、
  `LandingPage.a11y.test.ts`），但 `VerticalTaskbar.a11y.test.ts` **保留并修**。

### 8.5 文案

- i18n 键删除后，中英文两份必须同步为**完全相同的键集合**——否则切语言会出现
  `undefined`。P3 完成后跑一次键集合比对（§12 速查提供命令）。

---

## 9. 实施顺序、门禁与回滚

### 9.1 顺序（严格串行，每步一提交）

```
P0-R  【v4 新增】docs 定点回退（git restore --staged --worktree docs/{diagnoses,plans,fixes}）
  └─ gate: git diff --cached --name-status -- docs/ | wc -l  == 0
P0-C  【v4 新增】提交现有工作区（R-11；精确 git add，严禁 git add -A）
  └─ gate: git status --porcelain 逐行确认 + git log -1 --stat 复核
P7-a  先修 H-1（test_thumbnail_service）  ← 让后端门禁立刻恢复可用
  └─ gate: pytest tests/ -q  能整体收集
P3-1  新增 localOwner.ts + 去 useAuth（14 处）+ http-client 去鉴权
  └─ gate: npx tsc --noEmit
P3-2  删除登录/着陆页/用户资料/用户管理/限流台 + page.tsx 重写 + 标题栏收敛
  └─ gate: npx tsc --noEmit && npm run lint
P3-3  设置中心目录重命名 + IA 重排 + GeneralSettingsPanel
  └─ gate: npx tsc --noEmit && npm test
P3-4  i18n 键清理
  └─ gate: 键集合比对 + npx tsc --noEmit
P4    BFF 路由删除 + next.config + 死代码
  └─ gate: npx tsc --noEmit && npm run build
P5    桌面主进程去凭证
  └─ gate: node desktop/main/window-state.test.js
P7-b  H-2 / H-3 + 回归护栏测试
  └─ gate: pytest tests/ -q 全绿
P6    文档 + 索引
  └─ gate: 人工通读 + `grep -rn "docs/diagnoses\|docs/plans" src/ | wc -l` 命中的路径全部存在
  └─ gate: 人工通读
```

**为什么 P7-a 排在最前**：它是 P1 的回归，且只有它修好后端门禁才有意义。
把它留到最后意味着中间每一步都无法用 `pytest tests/` 验收。

**为什么 P3-1 必须先于 P3-2**：`useAgentExecution.ts:28` 与
`RemoteMaterialPrefetchAdapter.test.ts:9` 从 `src/lib/auth/storage-keys` 导入。
先删目录再改引用，中间态 `tsc` 一定断，无法逐步验收。

### 9.2 回滚

每阶段一个提交（`feat:` 前缀），出问题 `git revert <sha>` 即可。
**不设 feature flag**（原则 3）。数据层无 DDL 变更，回滚不涉及数据迁移。

---

## 10. 测试与验收标准

### 10.1 自动化门禁（每阶段结束必跑，**必须贴出实际输出**）

```bash
# 前端（仓库根）
npx tsc --noEmit
npm run lint
npm test                      # vitest 单元测试
npm run build                 # 生产构建（P4 之后必跑一次）

# 后端（backend-services/basic-service）
python -m pytest tests/ -q            # P7 之后必须整体通过
python -m pytest tests/security/ -q   # 安全用例单独确认
python -c "import app.main"           # 导入自检

# 集成测试（【v4 评审修订 P1-6】vitest.config.ts 显式 exclude 了 tests/integration/**，
# `npm test` 永远跑不到它们；P3 改过这些文件后必须单独跑一次并贴输出）
npm run test:integration      # 需要真起后端；跑不了就在提交信息写明"未跑"，不得默认为绿
```

### 10.2 必须新增/保留的回归测试

| 测试 | 断言 | 阶段 |
|------|------|------|
| `tests/test_no_auth_surface.py`（已存在） | `app.dependencies.auth` 等模块不可导入；`main` 未注册鉴权中间件 | 保留 |
| `tests/test_local_owner_claim.py`（已存在） | 幂等 UPDATE 认领遗留行；重复执行结果一致 | 保留 |
| `tests/test_local_owner_materials_listing.py`（已存在） | 列表侧枚举全部 `user_*` 目录（D13 读放宽） | 保留 |
| `tests/test_thumbnail_service.py` | 3 个缩略图端点用例**转为 pass**（H-1） | P7-a |
| `src/lib/api/__tests__/no-auth-surface.test.ts`（新建） | `http-client` 不再导出 4 个鉴权符号；**仍**导出 `RateLimitError` | P7-b |
| `src/components/__tests__/VerticalTaskbar.a11y.test.ts` | 去掉 AuthProvider 包裹后仍全绿 | P3-2 |
| `desktop/main/window-state.test.js` | env 合并/回填断言改用非鉴权键后仍全绿 | P5 |

### 10.3 桌面端手工走查（Definition of Done 的硬性一环）

在**打包产物**（不是 `npm run dev`）上执行，逐条记录结果：

1. 全新安装（清空 `userData/`）→ 启动 → **不出现登录框** → 直接进入剪辑工作区。
2. 从旧版本升级（保留旧 `userData/`）→ 启动 → 旧工程列表、旧分类、旧分镜包、
   旧封面**全部可见**；素材库里升级前导入的素材**全部可见**（D13 验证点）。
3. 导入一段本地视频 → 拖到时间线 → 预览播放有画面有声音 → 拖动播放头可 seek。
4. TTS 生成一段音频 → 落到素材库 → 拖上音频轨 → 预览可听。
5. 导出一次 → 与重构前同工程的导出产物做 **ffprobe 比对**（时长、分辨率、
   码率、音轨数一致）。
6. 打开设置 → 默认落在"通用" → 切换语言、切换主题 → 立即生效 → 重启后保持。
7. 设置 → 模型与凭证 → 保存一个供应商 → 关闭设置 → 齿轮上的琥珀点消失。
8. 标题栏最小化 / 最大化 / 还原 / 关闭四个动作正常；双击品牌区切换最大化。
9. 关闭窗口 → 后端与前端子进程全部退出（任务管理器确认无残留 python/node）。
10. `%APPDATA%/Ecliptrix/logs/` 下有日志，且**不含任何口令/令牌字样**。
11. **【v4 评审修订 P0-3】零死路走查**：关闭所有标签页 → 右侧出现欢迎空态 →
    空态上的"AI 对话"/"视频剪辑"两张卡片**可点击**，点任一张都能新建任务；
    仅用键盘（Tab → Enter）同样可达。再关掉、再新建，重复两轮无异常。

### 10.4 验收标准（Acceptance Criteria）

| # | 标准 | 判据 |
|---|------|------|
| A1 | 源码中不存在鉴权概念 | **【v4 评审修订 P1-7】判据必须排除负向断言测试**，否则恒不可满足（`tests/test_no_auth_surface.py:118,122` 与新增的前端护栏测试正文里必然写着这些符号名）。前端：`grep -rn "useAuth\|SESSION_TOKEN_KEY\|AuthProvider\|isAuthenticated" src/ --include=*.ts --include=*.tsx \| grep -v "__tests__"` = 0；后端：`grep -rn "get_current_user\|require_admin" backend-services/basic-service/app/` = 0（与 §4.4 复核命令同口径，**不要**扩到整个 `backend-services/`） |
| A2 | 源码中不存在非桌面部署工件 | `ops/`、`install.*`、`start.sh`、`kill.sh`、`coverage/`、`example-package/`、`alembic/` 均不存在 |
| A3 | 前端门禁全绿 | `npx tsc --noEmit` exit 0；`npm run lint` 无 error；`npm test` 全绿；`npm run build` 成功 |
| A4 | 后端门禁全绿 | `pytest tests/ -q` **整体收集并全部通过**（0 error / 0 failed） |
| A5 | 桌面凭证桥消失 | **【v4 评审修订 P1-2】统一为全仓库零命中**（v3 的"`window-state.test.js` 除外"与 §12.4 的"目标 0"互相矛盾；按 §4.11 改造后该文件不再有 ROOT_* 断言）：`grep -rn "getBootstrapCredentials\|ROOT_PASSWORD\|ROOT_USERNAME\|ADMIN_PASSWORD" desktop/ src/` = 0；`src/types/desktop.d.ts` 无 `BootstrapCredentials` |
| A6 | 业务能力零回归 | §10.3 十条走查全部通过；第 5 条 ffprobe 比对一致 |
| A7 | 数据零丢失 | §10.3 第 2 条通过（旧工程 + 旧素材全部可见） |
| A8 | 文档与代码一致 | `README*` / `CLAUDE.md` 中不再出现 PostgreSQL、Alembic、`install.sh`、登录、用户管理；`CLAUDE.md` 的 Auth 章描述与 `app/constants.py` 一致 |
| A9 | 无残留悬挂引用 | ① `app/constants.py` docstring 提到的 `src/lib/localOwner.ts` 确实存在；② BFF 路由不再指向已删除的后端端点；③ **【v4 评审修订 P0-2】源码/配置注释引用的文档路径全部存在**——跑 §10.5 的扫描脚本，`dangling=0` |

---

### 10.5 【v4 评审新增】悬挂文档引用扫描（A9 判据）

源码注释里写着 `docs/plans/...` / `docs/diagnoses/...` 的地方有近百处，它们是这个项目
最有价值的"为什么这么写"线索。P0-R 回退之后必须验证一处不缺：

```bash
cd M:/takoAI/Ecliptrix
python - <<'PY'
import io, os, re, glob
PAT = re.compile(r'docs/[a-z-]+/[A-Za-z0-9._/-]+')
files = (glob.glob('src/**/*.ts', recursive=True)
         + glob.glob('src/**/*.tsx', recursive=True)
         + glob.glob('backend-services/basic-service/app/**/*.py', recursive=True)
         + ['vitest.config.ts', 'vitest.integration.config.ts', 'CLAUDE.md'])
bad = []
for f in files:
    for i, line in enumerate(io.open(f, encoding='utf-8', errors='ignore'), 1):
        for m in PAT.findall(line):
            target = m.rstrip('.')                 # 去掉句末句点
            if not os.path.exists(target):
                bad.append((f, i, target))
print('scanned=%d  dangling=%d' % (len(files), len(bad)))
for row in bad[:20]:
    print('  ', row)
PY
```

**判据**：`dangling=0`。

> 参考值：**回退之前**（即 P0 删除生效的状态）这条脚本实测报出 `scanned=995  dangling=98`——这正是
> §2.6 / P0-2 的直接证据。如果 P0-R 执行后它仍非 0，说明回退没做干净或做过头。


## 11. 风险与缓解

| ID | 风险 | 等级 | 缓解 |
|----|------|------|------|
| **R-1** | `ops/key/inkclaw-singpore-260322.pem` 曾被 Git 追踪。删除文件**不会**清除历史，该私钥仍可从任意历史提交中取出 | **P0** | 本方案已删除文件并在此登记。**密钥轮换是运维动作，必须在服务器侧执行**（生成新密钥对、替换 `authorized_keys`、作废旧密钥），代码变更无法替代。范围外但必须落实 |
| **R-2** | 前端一次性删除 ~5,200 行，`tsc` 报错可能雪崩，难以定位 | 中 | §9.1 的顺序即为缓解：P3-1 先补 `localOwner.ts` 并改所有引用点，再在 P3-2 删目录。每小步单独提交并跑 `tsc` |
| **R-3** | `user_id` 被改写为常量后，回滚到旧版本时 root 用户看不到这些行（单向性） | 中 | 已在 §7.3 登记为已知行为。旧版本回滚场景仅出现在开发期；如需真正回退，用 `UPDATE … SET user_id='<旧 root uuid>'` 反向认领（不涉及 DDL） |
| **R-4** | i18n 三份结构（类型 / en / zh）漏改一份 → 运行期 `undefined` 文案 | 中 | §12 提供键集合比对命令，P3-4 门禁必跑；`tsc` 能挡住类型块与实现块不一致，但挡不住 en/zh 之间不一致 |
| **R-5** | 设置项枚举重命名（D17）漏改调用点 | 低 | 调用点仅 5 处（`page.tsx` 2、`SettingsPage.tsx` 1、`SettingsSidebar.tsx` 1、`__tests__` 1）；`tsc` 会全部挡住 |
| **R-6** | 删掉 `RateLimitError` 导致 media-proxy 429 退化为未分类错误 | 中 | §4.9 明确保留；P7-b 的 `no-auth-surface.test.ts` 增加"仍导出 `RateLimitError`"的正向断言，把它钉死 |
| **R-7** | 删 `/api/video-proxy` 会打断视频缩略图 | 中 | 已核实 `extractVideoThumbnail.ts:5` 仍在用 → **保留路由**，只收缩白名单（D15） |
| **R-8** | `desktop/main/window-state.test.js` 整体删除会丢失 env 合并/回填的回归覆盖 | 中 | §4.11 明确要求"换断言键，不删测试" |
| **R-9** | H-2 / H-3 修好后，两个文件里可能藏着一批从未跑过的失败用例 | 中 | 修语法/API 后**先单独跑这两个文件**，把失败清单单独评估：若是陈腐断言则连同用例删除并在提交信息说明；不允许为了让门禁变绿而 `xfail` 掩盖 |
| **R-10** | `npm run build` 在 P4 之前可能一直没跑过，`output: standalone` 改无条件后才暴露构建问题 | 低 | P4 门禁强制 `npm run build`；若失败，先排查是否因删除 BFF 路由导致的 import 悬挂 |
| **R-11** | 本轮工作区有大量**未提交**改动（438 文件暂存删除 + 42 文件未暂存修改）。任何 `git checkout .` / `git reset --hard` 都会毁掉 P0–P2 的成果 | **P0** | 开发节点动手前**先提交现有工作区**（`feat:` 前缀，精确 `git add <路径>`，严禁 `git add -A`——`__pycache__/`、`.next/`、`tsconfig.tsbuildinfo` 会混进来）。提交后再开始 P3 |
| **R-12**（v4） | P0-R 的 `git restore` 打错路径 → 把 P0/P1/P2 的 109,046 行删除一起还原 | **P0** | 命令**只**接受 `docs/diagnoses docs/plans docs/fixes` 三个字面路径；执行后立刻 `git diff --cached --shortstat` 复核仍有约 129 files / 十万级删除量。禁止任何形式的 `git restore .` / `git checkout .` |
| **R-13**（v4） | §4.6.1 的空态按钮被实现成"看着像按钮的 div" → 键盘用户仍然走不通，等于没修 P0-3 | 中 | 必须用原生 `<button type="button">`；§10.3 第 11 条明确要求"仅用键盘 Tab → Enter"复核一遍 |
| **R-14**（v4） | 三个鉴权错误类的调用点（§4.9.1）漏改一处，`tsc`/`npm test` 在 P3-1 之后才炸，定位成本高 | 中 | P3-1 的门禁在 `npx tsc --noEmit` 之外补一条 `npm test -- src/lib/api src/components/video/timeline`（只跑受影响目录，秒级反馈）；§12.2 已补对应 grep |

---

## 12. 附录：实施者速查

### 12.1 现状复核（动手前先跑一遍，确认与 §2 一致）

```bash
cd M:/takoAI/Ecliptrix
git status --porcelain | wc -l            # 期望 ~485
git diff --cached --shortstat             # 期望 438 files, 109046 deletions
npx tsc --noEmit; echo "tsc=$?"           # 期望 0

cd backend-services/basic-service
python -m pytest tests/ -q --co 2>&1 | tail -3   # 期望 1111 collected, 2 errors
grep -rn "get_current_user\|require_admin" app/  # 期望 0
```

### 12.2 P3 收口检查（每小步后跑）

```bash
cd M:/takoAI/Ecliptrix
grep -rn "useAuth\|AuthProvider\|isAuthenticated" src/          # 目标 0
grep -rn "SESSION_TOKEN_KEY\|ecliptrix-session-token" src/      # 目标 0
grep -rn "requireAuth" src/                                     # 目标 0
grep -rn "RateLimitError" src/lib/api/http-client.ts            # 目标 >0（必须还在）
grep -rn "auth/storage-keys\|auth/sessionGuard" src/ tests/     # 目标 0
grep -rn "LOCAL_OWNER_ID" src/                                  # 目标 >0（至少 5 处）
ls src/lib/localOwner.ts                                        # 必须存在（D18）

# 【v4 评审新增】P0-1：三个鉴权错误类的调用点必须清干净（漏一处即断门禁）
grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/   # 目标 0
# 【v4 评审新增】P0-3：空态创建入口必须存在
grep -n "onCreateTask" src/components/Container.tsx                     # 目标 >0
# 【v4 评审新增】P1-1：标题栏重命名的两个消费者都改到位
grep -rn "components/desktop/DesktopTitleBar" src/                      # 目标 0
grep -rn "components/shell/AppTitleBar" src/                            # 目标 2（page.tsx / not-found.tsx）
```

### 12.3 i18n 键集合比对（P3-4 门禁）

```bash
node -e "
const s=require('fs').readFileSync('src/lib/i18n.ts','utf8');
const keys=t=>[...t.matchAll(/^\s{4,}([a-zA-Z][a-zA-Z0-9_]*):/gm)].map(m=>m[1]);
// 粗比对：英文块与中文块的键数量应一致
console.log('total key-ish lines:', keys(s).length);
"
# 更可靠的方式：临时脚本 import 编译后的 en/zh 对象做深度键集合 diff
```

### 12.4 P4 / P5 收口检查

```bash
find src/app/api -name route.ts | wc -l                    # 目标 103
grep -rn "DESKTOP_BUILD" next.config.js                    # standalone 应无条件
grep -rn "getBootstrapCredentials" desktop/ src/           # 目标 0
grep -rn "ROOT_PASSWORD\|ROOT_USERNAME\|ADMIN_PASSWORD" desktop/ src/     # 目标 0（v4：含 test）
grep -rn "LOCAL_ADMIN_KEYS" desktop/scripts/prepare-env.js                 # 目标 0（v4 · P1-8）
grep -rn "BootstrapCredentials" src/types/desktop.d.ts     # 目标 0
```

### 12.5 P7 收口检查

```bash
cd backend-services/basic-service
python -m pytest tests/ -q 2>&1 | tail -3   # 目标：N passed，0 error / 0 failed
grep -rn "pytest.config" tests/             # 目标 0
grep -rn "app.dependencies.auth" tests/     # 目标：仅 test_no_auth_surface.py 的负向断言
```

### 12.6 提交纪律

- 每阶段一个提交，`feat:` 前缀 + 一句话摘要。
- **精确暂存**：`git add <具体路径>`，严禁 `git add -A`。
  本仓库 `.gitignore` 虽已补强，但 `__pycache__/`、`.next/`、
  `tsconfig.tsbuildinfo`、`.idea/` 仍会不时冒出来。
- 提交前 `git status --porcelain` 逐行确认，`git log -1 --stat` 复核。

---

## 附录 A：v1/v2 历史评审结论留档（已全部吸收进 v3）

v2 评审共提出 3 个 P0、8 个 P1、5 个 P2，处置如下：

| 原编号 | 问题 | v3 处置 |
|--------|------|---------|
| P0-1 | 所有权改造漏了文件系统：素材在 `user_<uuid>/` 目录下，只改 DB 会让升级用户素材库变空 | 已由 D13"读放宽 + 写收敛"解决并**已落地**（`storage_service.py:823`）；前端侧的 `LOCAL_OWNER_ID` 传参落在 P3 |
| P0-2 | `tests/security/conftest.py` 的 `create_user` / `patched_auth_factories` 夹具被 `test_04`/`test_07` 消费，删用户系统会连坐 | 已在 P1/P2 落地时改造完成（`tests/security/` 152 passed 可证） |
| P1-2 | `useAgentExecution.ts` 与 `RemoteMaterialPrefetchAdapter.test.ts` 从 `lib/auth` 导入，删目录会直接打断 `tsc` | 保留为 P3 显式条目，并在 §9.1 用"先改引用后删目录"的顺序钉死 |
| P1-3 | 前端播放遥测 `playback/telemetry.ts` 属死代码，应与后端 `telemetry_router` 同删 | 保留为 P3 条目（§2.5 已复核确认零构造点） |
| P1-6 | 删 `RateLimitError` 会让 media-proxy 的 429 退化 | §4.9 明确保留 + §11 R-6 + P7-b 正向断言三重保险 |
| P1-8 | 缺基线固化步骤 | 由 §12.1「现状复核」与 §11 R-11「先提交工作区」取代 |
| P2-3 | `next.config.js` 的遗留 env 告警块与 `backend.ts` 的 `LEGACY_ENV_VAR_NAMES` 必须同步 | §4.10 决定**都保留** |
| P2-6 | `CLAUDE.md` 另有两处过期描述 | 已并入 P6 的第 ④ 条 |
| 其余 P1/P2 | 后端相关（`test_06_misc` 的 `/docs` 断言、`system_settings_router` 的 `updated_by`） | 均已在 P1/P2 落地时解决 |

v3 相对 v2 的**新增结论**：D14（首屏两端一致）、D15（6 项新死代码）、
D16 / P7（门禁 3 处硬伤）、D17（设置枚举命名）、D18（`localOwner.ts` 是后端
docstring 的悬挂引用，必须补齐）、R-11（未提交工作区的保护）。

v4 相对 v3 的**新增结论**（详见《评审记录》）：**D19**（`docs/{diagnoses,plans,fixes}`
定点回退，新增 P0-R 阶段）、**D20**（空态必须承载"新建任务"入口，§4.6.1）、
§4.9.1（三个鉴权错误类的 4 类调用点迁移）、§4.11 三行改写（`window-state.test.js`
删 3 改 2 / `prepare-env.js` 有活代码 / `smoke-test.js` 改为无鉴权 200 断言）、
A1·A5·A9 判据自洽化、R-12～R-14。

---

## 评审结论（Review Verdict · v4）

### 结论：**有条件通过**（Approved with conditions）

方案的骨架是对的，而且是**少见地对**：现状复核的每一条实测数据都经得起复算；D2（零破坏性
DDL）与 D13（读放宽 / 写收敛）两个关键决策精准命中了这个项目历史上最贵的两次事故；§9.1 的
"P7-a 最前 / P3-1 先于 P3-2"顺序约束显示作者真的在脑子里跑过一遍中间态。这不是一份需要打回
重写的设计。

但它有 3 个 P0 与 8 个 P1，**全部已在本轮直接改入正文**（P2 也一并改完，不留待办）。之所以
仍是"有条件通过"而不是"通过"，是因为其中两条的正确性只能由开发节点在动手时验证，评审无法
代劳：

### 放行条件（开发节点必须逐条兑现，缺一不可）

| # | 条件 | 验收方式 |
|---|------|----------|
| **C-1** | **动工前第一件事**执行 §5-P0-R 的 docs 定点回退，且**只**回退那三个字面路径 | `git diff --cached --name-status -- docs/ \| wc -l` == 0，同时 `git diff --cached --shortstat` 仍保留十万级删除量（证明没误伤 P0/P1/P2） |
| **C-2** | 回退后立刻按 R-11 提交现有工作区，精确 `git add`，严禁 `git add -A` | `git log -1 --stat` 里没有 `__pycache__/`、`.next/`、`tsconfig.tsbuildinfo`、`.idea/` |
| **C-3** | §4.9.1 的 4 类调用点全部迁移完毕 | `grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/` = 0，且 `grep -rn "RateLimitError" src/lib/api/http-client.ts` > 0 |
| **C-4** | §4.6.1 的空态创建入口落地，且是真 `<button>` | §10.3 走查第 11 条通过（含"仅键盘 Tab → Enter"） |
| **C-5** | §4.11 三行按 v4 版本执行（`window-state.test.js` 删 3 改 2、`prepare-env.js` 删 `LOCAL_ADMIN_KEYS`、`smoke-test.js` 改无鉴权 200 断言） | `node desktop/main/window-state.test.js` 全绿；`grep -rn "ROOT_PASSWORD\|ADMIN_PASSWORD" desktop/ src/` = 0 |
| **C-6** | `tests/conftest.py` 的 cv2 stub 与 dialect shim **原样保留**，只改注释 | `pytest tests/ -q` 能整体收集（A4） |
| **C-7** | `npm run test:integration` 要么跑通并贴输出，要么在提交信息里显式写明"未跑"及原因 | 提交信息可查 |
| **C-8** | 每阶段贴出门禁**实际输出**（§3.1 原则 5），不接受"应该能过" | 阶段提交信息 / 运行日志 |

### 范围外但必须落实（不阻塞本方案，但不做就是留了个洞）

- **R-1 密钥轮换**：`ops/key/inkclaw-singpore-260322.pem` 曾被 Git 追踪，删文件不清历史。
  轮换是运维动作，代码改不掉。本文档只能登记，落实要靠人。

### 不通过的情形（触发任一条即打回）

1. 用 `git restore .` / `git checkout .` / `git reset --hard` 执行 C-1，导致 P0/P1/P2 成果丢失；
2. 为了让门禁变绿而 `xfail` / `skip` 掉 H-2 / H-3 修复后暴露的失败用例（R-9 已明令禁止）；
3. 删除 `RateLimitError` 或 429 解析分支（v2 已踩过一次，v4 有三重保险仍被绕过）；
4. 对 §2.1 标记为"已落地"的 P0/P1/P2 做"再优化"（P0-R 的定点回退是唯一例外）。

---

**文档状态**：**v4 评审后基线完成**。3×P0 / 8×P1 / 8×P2 已全部在正文修订，无遗留未决项。
开发节点可按 §9.1 的顺序（P0-R → P0-C → P7-a → P3-1…）直接施工，逐阶段贴门禁实际输出。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> **记录人**：实施节点　**记录日期**：2026-09-01　**基线**：spec v4
> 下面每一条都在实施时被实测触发，并已按"纠正后的做法"落地。**方案本身未被静默偏离**：
> 有偏离的地方都写在这里，并注明为什么。
> 编号 **I-n**（Implementation finding），与评审的 P0/P1/P2 编号区分开。

### 汇总

| ID | 严重度 | 位置 | 一句话 |
|----|--------|------|--------|
| **I-1** | **P0** | §10.4 A4 · §12.5 | `pytest tests/` **从来没有绿过**：HEAD 基线就是 98 failed / 19 errors。A4「0 failed / 0 error」不是本次重构能达成的判据 |
| **I-11** | P2 | §10.1 · §4.4 | `python -c "import app.main"` 这条门禁在本机**恒失败**，原因是 OpenCV 二进制损坏（`import cv2` 单独也失败），与代码无关 |
| **I-2** | **P0** | §5-P7 H-2 | `test_tts_api.py` 不只是"缺 `--integration` 注册"：修好收集后暴露 17 个针对**已不存在的 TTS 契约**的失败用例 |
| **I-3** | P1 | §10.5 · C-1 | P0-R 执行到位后扫描仍报 `dangling=15`，原因是**早于本次重构**的悬挂引用（2358302 删档），不是"回退没做干净" |
| **I-4** | P1 | §4.9.1 · §5-P3 | 鉴权链条比方案列出的 4 类调用点长：Agent 侧还有 5 个文件在传 `authToken`，只删 `SESSION_TOKEN_KEY` 会留下每次工具调用都打印的误导性告警 |
| **I-5** | P1 | §4.9 | 「保留 `http-client.test.ts` 里的 429 断言」这个前提不成立——**全仓库从来没有过** `RateLimitError` 的测试 |
| **I-6** | P1 | §10.4 A3 | `npm run lint` **从来没有 0 error**：8 个 error 全在本次未触碰的文件里 |
| **I-7** | P1 | §4.11 | §4.11 的逐文件表漏了 `desktop/scripts/dev.js`，它仍在向后端与 Electron 注入 `ROOT_*`，不清会让 A5 恒不为 0 |
| **I-8** | P2 | §4.8 | `GeneralSettingsPanel` 复用 `t.profile.*` 会留下"设置面板读 profile 命名空间"的错位；改为新增 `adminSettings.general*` 键并整组删除 `t.auth` / `t.profile` |
| **I-9** | P2 | §4.6.1 | 「可选增强：任务栏 + 按钮」实际是**必需**的：不做的话有标签页之后仍然无法新建第二种任务 |
| **I-10** | P2 | §9.1 P0-C | 本节点被上游任务约束明令禁止 `git commit`，P0-C 无法执行，C-2 顺延给下游提交节点 |

---

### I-1（P0）· A4「后端门禁全绿」是一个从未成立过的判据

**方案怎么写的**：§10.4 A4 要求 `pytest tests/ -q` 整体收集并**全部通过**（0 error / 0 failed）；
§2.4 由此推断"后端主体健康"。

**实测**：§2.4 的那条命令只跑了 5 个文件的子集（152 passed）。**整套** `tests/` 从来没有被跑过——
v4 自己给的复核命令是 `--co`（只收集不执行）。我把它真跑了一遍，并且为了区分"既有腐化"和
"本次回归"，用 `git worktree` 在 HEAD 上建了一份基线，只补上 H-2/H-3 两个收集修复后同样跑一遍：

| | failed | passed | errors |
|---|---|---|---|
| HEAD 基线（只补收集修复） | **98** | 1175 | **19** |
| 本次实施后 | **82** | 1020 | **19** |

**结论**：这 82 个失败与 19 个 error **全部是既有腐化，不是本次重构引入的**；本次重构还顺带让失败数
从 98 降到 82。passed 从 1175 降到 1020 是因为随用户系统删掉了约 155 个鉴权/限流用例。

失败的形态（抽样）：patch 到已不存在的方法（`VideoCompositionService.compose_video`、
`BatchTTSService.process_batch`）、Pydantic 模型漂移、依赖 `datas/merge/*.mp4` 等外部素材、
依赖真实网络与 DNS 的 SSRF 用例、`async def` 测试没有 asyncio 插件而被跳过。

**纠正后的做法**：H-1/H-2/H-3 按方案修复（收集恢复正常），**不**为了让 A4 变绿去 `skip`/`xfail`
任何用例（§评审结论「不通过情形 2」明令禁止）。A4 判据必须改写为**差分判据**：

> A4′：`pytest tests/` 能整体收集；且失败集合 **不大于** 同一命令在 `git merge-base` 上的失败集合。

修复这 82 个既有失败是一个独立工作项，不属于"删除非桌面代码"的范围，硬塞进来会让本次 diff
失去可评审性。

---

### I-2（P0）· `test_tts_api.py` 是整文件腐化，不是一个 flag 的问题

**方案怎么写的**：§5-P7 把 H-2 定性为「`pytest.config` 是 pytest 5.0 移除的 API」，改成
`pytestmark = skipif(os.getenv("RUN_TTS_INTEGRATION") != "1")` 即可。

**实测**：把收集修好之后，该文件 24 个用例里 **17 个失败**，且失败原因与凭证无关：

- `patch('...tts_service.check_health')` / `get_voice_types` / `BatchTTSService.process_batch`
  —— 这三个方法在当前 `tts_service.py` / `batch_tts_service.py` 里**都不存在**（现名
  `get_available_voice_types`，`check_health` 已无对应物）；
- 若干端点返回 404 / 422，与用例断言的 200 / 400 不符——路由契约已经换代；
- 一条断言比对的错误文案与当前实现不同。

也就是说：这个文件是为**上一代 TTS 路由**写的，因为从未被成功收集，漂移了很久没人发现。

**纠正后的做法**：按方案落 **模块级** `pytestmark` 隔离（`RUN_TTS_INTEGRATION=1` 才跑），但在文件
顶部 docstring 里**写清楚真实原因**——不是"需要真实凭证"，而是"契约已漂移 + 需要真实凭证"，并注明
重写这 17 个用例是独立工作项。理由：本节点若照方案的措辞只写"需要凭证"，就是在用一个准确的
机制掩盖一个不准确的说法；若强行现场重写 17 个用例，则是引入方案完全没有覆盖的新范围。

---

### I-3（P1）· `dangling=0` 判据成立，但 v4 给的失败解释是错的

**方案怎么写的**：§10.5 参考值「回退之前 `scanned=995 dangling=98`；**如果 P0-R 执行后它仍非 0，
说明回退没做干净或做过头**」。

**实测**：P0-R 严格按 §5-P0-R 的三个字面路径执行（`git diff --cached --name-status -- docs/ | wc -l`
= 0，且 `git diff --cached --shortstat` 仍保留 129 files / 28,497 deletions，证明没误伤 P0/P1/P2），
扫描结果是 **`dangling=15`**，不是 0。

逐条追查后确认：这 15 条**全部指向 `docs/plans/unified-api-auth-refactor/**` 等目录，而这些目录是在
提交 `2358302` 里被删掉的——远早于本次重构**。`git ls-tree HEAD` 对它们零命中。也就是说 v4 漏了
第三种可能：**基线本身就带着悬挂引用**。

**纠正后的做法**：P0-R 照做（它本身是对的、且必要）；随后单独清掉这 15 条早已失效的
`Spec:` / `See:` 指针（只删指针，保留解释"为什么这么写"的正文）。最终 `scanned=943 dangling=0`，
A9 达成。顺带一提，被指向的 `unified-api-auth-refactor` 正是本次要拆掉的那套鉴权设计，留着指针
本身也是误导。

---

### I-4（P1）· 鉴权链条比 §4.9.1 列的长：Agent 侧还有 5 个文件

**方案怎么写的**：§5-P3 只列了 `useAgentExecution.ts`（`:28` 导入、`:288-291` 注入）。

**实测**：会话令牌是一条**贯穿 5 个文件的链路**：

```
useAgentExecution.ts (读 localStorage → header + body.sessionToken)
  → src/app/api/video-editing-agent/chat/route.ts (readIncomingAuth / getConfig(authToken) / ToolContext.authToken)
    → src/lib/video-editing-agent/agent.ts (authToken 透传)
      → src/lib/video-editing-agent/types.ts (ToolContext.authToken / AgentChatRequest.sessionToken)
        → src/lib/video-editing-agent/tools/apiHelper.ts (注入 Authorization)
```

只按方案删最上游那一处，`tsc` 不会断，但 `apiHelper.ts:112-113` 有一条
`if (!context.authToken) console.warn('… request will be unauthenticated')` ——令牌永远为空之后，
它会在**每一次 Agent 工具调用**时打印一条误导性告警。另有 `src/app/api/chat/route.ts` 的
`extractSessionToken()` 同属此类（它的注释还写着"resolve 端点是 require_admin"，而 `require_admin`
在 P1 就已删除）。

**纠正后的做法**：整条链路一次清理干净（5 + 1 个文件），符合 A1「源码中不存在鉴权概念」的意图。
`src/app/api/storage/files/[...path]/route.ts` 的 `forwardHeaders: ['range', 'cookie']` 里的 `'cookie'`
同理删除——它存在的唯一理由是"`<img>/<video>` 带不了 Authorization，改走 session cookie 兜底"。

---

### I-5（P1）· "保留 http-client.test.ts 的 429 断言"——那些断言不存在

**方案怎么写的**：§4.9「**不要**顺手删掉 429（`RateLimitError`）、超时、路径白名单三组断言」；
评审结论 C-3 与「不通过情形 3」都把这条列为红线。

**实测**：`git show HEAD:src/lib/api/__tests__/http-client.test.ts | grep -c "RateLimitError\|429"`
= **0**。`git grep -l "RateLimitError" HEAD -- src/` 只命中 `http-client.ts` 自己。也就是说
**`RateLimitError` 这条被三重强调"必须保留"的分支，从来没有任何测试守着它**——这恰恰解释了
v2 当初为什么能把它顺手删掉。

**纠正后的做法**：不只是"保留"，而是**补齐**。除方案要求的
`src/lib/api/__tests__/no-auth-surface.test.ts`（断言仍导出 `RateLimitError` 且 `CODE==='RATE_LIMITED'`）
外，在 `http-client.test.ts` 新增三个**行为级**用例：T22（429 → `RateLimitError`，`retryAfter` 取自
`Retry-After` 头）、T23（无头时回退到 `error_details.retry_after`）、T24（派发
`ecliptrix:rate-limited` 全局事件）。三者均已跑通。

---

### I-6（P1）· A3「`npm run lint` 无 error」同样是从未成立过的判据

**实测**：`npm run lint` 报 **8 个 error**，分布在 6 个文件：
`AudioSearchModal.tsx` / `ImageSearchModal.tsx` / `VideoSearchModal.tsx`（`no-empty-object-type`）、
`MaterialsPanel.tsx` / `WatermarkRemovalModal.tsx`（`react/no-unescaped-entities`）、
`VideoCoverModal/components/ImageUploadInput.tsx`（`no-restricted-syntax`：直接 `fetch('/api/...')`）。
**这 6 个文件本次全部未触碰**，8 个 error 与本次改动无因果关系。

**纠正后的做法**：不在本次 diff 里修它们（超范围，且会把一个已经很大的 diff 搅浑）。但**改掉了那条
自定义 lint 规则的提示语**——它写着"so the Authorization header is injected and 401 routes through
the global session-expired handler"，指向的是本次删掉的行为，属于必须同步的悬挂描述。
A3 判据同 A4，应改为差分判据。

---

### I-7（P1）· §4.11 漏了 `desktop/scripts/dev.js`

**实测**：`desktop/scripts/dev.js:49-50` 定义 `ROOT_USERNAME` / `ROOT_PASSWORD`，并在 `:192-193`
注入后端子进程、`:248-249` 注入 Electron 子进程。§4.11 的逐文件表没有它。不清理的话
A5（`grep -rn "ROOT_PASSWORD\|ROOT_USERNAME" desktop/ src/` = 0）**恒不可满足**。

**纠正后的做法**：三处一并删除。另外 `desktop/scripts/prepare-frontend.js:37` 的报错信息
「check the DESKTOP_BUILD conditional in next.config.js」在 P4 把 `output` 改成无条件之后也变成
悬挂描述，一并改写。

---

### I-8（P2）· `GeneralSettingsPanel` 不该复用 `t.profile.*`

**方案怎么写的**：§4.8 说从 `OtherSettingsPanel` 移植语言与主题两块。

**实测**：那两块用的是 `t.profile.language` / `t.profile.theme` / `t.profile.{light,dark,auto}Theme`。
而 `UserProfilePage` 整个被删之后，`grep -rn "t\.profile\." src/` = 0、`grep -rn "t\.auth\." src/` = 0
——两个命名空间都变成纯死键。若新面板继续读 `t.profile.*`，就得为一个"已经不存在的概念"续命，
违反 `CLAUDE.md`「One concept, one name」。

**纠正后的做法**：在 `adminSettings` 下新增 11 个键（`groupApp`/`groupAi`/`groupMedia`/`general`/
`generalDesc`/`language`/`theme`/`lightTheme`/`darkTheme`/`autoTheme`/`generalAutoSaveNote`），
并**整组删除** `auth` 与 `profile`（类型声明块 / en 块 / zh-CN 块三处同步），另删 `adminSettings`
下 51 个用户管理 / 限流 / 占位面板键。三份结构用**大括号配平**的脚本处理，不用行号，避免误伤邻接组。
（`adminSettings` 这个命名空间名在目录改叫 `settings` 之后本身也已错位，但改名会波及 7 个面板，
超出本次范围，留作独立工作项。）

---

### I-9（P2）· 任务栏"新建"按钮不是可选增强，是必需项

**方案怎么写的**：§4.6.1「**可选增强（推荐但非阻塞）**：给 `VerticalTaskbar` 加一个常驻的
'+ 新建'按钮……若时间紧张可不做」。

**实测**：不做的话，§4.6.1 自己描述的那个缺陷依然存在——`Container` 空态只在
`activeTask === null` 时出现，也就是**一个标签页都没有**的时候。一旦有了任意一个标签页，用户就
再也无法新建第二种任务（`didAutoOpenRef` 是一次性的，任务栏只渲染已存在的标签）。
换句话说：只做空态按钮，修好的是"死路"，没修好的是"单向门"。

**纠正后的做法**：两个都做。空态两张卡片改成真 `<button>`（`aria-label` + `focus-visible:ring-2`
+ `disabled={!onCreateTask}`），任务栏底部新增一组常驻新建按钮（视频 / 对话）。文案零新增 i18n 键
——用现有 `t.common.newTask` 与 `t.tasks.*` 组合成「新建任务 · 视频剪辑」。
`VerticalTaskbar.a11y.test.ts` 同步改写：删掉针对已删除登录提示的两个用例，新增 3 个针对
"新建入口存在且可访问"的用例。

---

### I-10（P2）· P0-C 无法在本节点执行

§9.1 把 P0-C（提交现有工作区）排在第 2 步，评审结论 C-2 也据此验收。但**本节点的任务约束明确写着
「Do not run `git commit`. Committing is the responsibility of the next node.」**。

**纠正后的做法**：不提交，工作区完整留给下游提交节点。C-2（精确 `git add`、`git log -1 --stat`
里不得出现 `__pycache__/` / `.next/` / `tsconfig.tsbuildinfo` / `.idea/`）**顺延为下游节点的验收项**。
需要特别提示下游：

- 本轮**新增/未跟踪**的关键文件必须显式 `git add`：`src/lib/localOwner.ts`、
  `src/components/settings/GeneralSettingsPanel.tsx`、`src/lib/api/__tests__/no-auth-surface.test.ts`、
  `docs/plans/desktop-only-refactor/spec.md`；
- 目录重命名已用 `git mv` 完成（`AdminSettings/` → `settings/`、`DesktopTitleBar` → `shell/AppTitleBar`、
  `HeaderActions` → `shell/TitleBarActions`），索引里是 R 记录，不要用 `git add -A` 打散；
- `.next/`、`__pycache__/` 在本轮跑过构建与 pytest，**一定**会出现在 `git status` 里。

---

### I-11（P2）· `python -c "import app.main"` 在本机恒失败，与代码无关

§10.1 / §4.4 把 `python -c "import app.main"` 列为导入自检。本机执行它会抛
`ImportError: recursion is detected during loading of "cv2" binary extensions`。

**这不是代码问题**：`python -c "import cv2"` 单独执行同样失败——本机 OpenCV 安装已损坏。
这正是 `tests/conftest.py` 那段 cv2 stub 存在的理由（其 docstring 写得很清楚），也正是评审 C-6
要求原样保留它的理由。

**证据**：在 pytest 下（stub 生效）`app.main` 导入完全正常——
`pytest tests/test_no_auth_surface.py tests/test_local_owner_claim.py
tests/test_local_owner_materials_listing.py tests/test_thumbnail_service.py tests/security/ -q`
→ **155 passed, 2 skipped, 0 errors**（对比 §2.4 记录的基线 152 passed / 2 skipped / **3 errors**，
差值正是 H-1 修好的那 3 个用例）。而 `test_no_auth_surface.py` 本身就断言
`app.main` 未注册鉴权中间件、`app.dependencies.auth` 不可导入——它通过即证明 `app.main` 导入正常。

**纠正后的做法**：该门禁在装有可用 OpenCV 的机器上才有意义；本机以上面那条 pytest 子集作为等效
替代并贴出输出。修 OpenCV 属环境问题，不在代码范围内。

---

### 顺带修掉的既有缺陷（不属于方案范围，但与本次删除强相关）

| 位置 | 问题 | 处置 |
|------|------|------|
| `.eslintrc.json:16` | 自定义 `no-restricted-syntax` 的提示语描述的是已删除的 401/session 行为 | 改写为"共享超时 / abort / 错误封装" |
| `desktop/main/envCheck.js` | 删掉 ROOT 自愈分支后，`stripEnvQuotes()` 与两个局部变量变成死代码 | 一并删除（`node envCheck.js` 与 `window-state.test.js` 均通过） |
| `src/app/api/storage/files/[...path]/route.ts` | `forwardHeaders` 里的 `'cookie'` 只为 session 兜底而存在 | 删除，注释同步 |
| `src/app/api/video-proxy/__tests__/route.test.ts` | D15 从 `ALLOWED_HOSTS` 删掉 OSS 项后，"代理 OSS 主机返回 200"的用例必然失败 | 改为反向断言"已下线的 OSS 主机返回 403"，ARK CDN 的 content-type 断言移到保留的用例上 |

---

### 门禁实际输出（§3.1 原则 5：不接受"应该能过"）

```text
# P0-R
git diff --cached --name-status -- docs/ | wc -l        → 0
git diff --cached --shortstat                           → 129 files changed, 28497 deletions(-)

# 前端
npx tsc --noEmit                                        → exit 0（清掉 .next/types 陈旧产物后）
npm run build                                           → exit 0，.next/standalone/server.js 生成
find src/app/api -name route.ts | wc -l                 → 103
npx vitest run                                          → 最终 3 failed / 1808 passed / 204 files
                                                          （3 个均在 HEAD 上同样失败，已逐个用
                                                           HEAD 版本源码复现验证：backend-proxy
                                                           T2/T18 与 cachePlayback 端到端用例）
npm run lint                                            → 0 new error（8 个既有 error，见 I-6）

# 桌面
node desktop/main/window-state.test.js                  → window-state tests passed
node --check desktop/scripts/{smoke-test,dev}.js        → OK

# 后端
python -m pytest tests/test_thumbnail_service.py -q     → 16 passed（H-1 已修）
python -m pytest tests/test_content_polish_api.py -q    → 20 passed（H-3 已修）
python -m pytest tests/test_tts_api.py -q               → 25 skipped（H-2 已隔离，见 I-2）
python -m pytest tests/ -q                              → 82 failed / 1020 passed / 19 errors
                                                          （HEAD 基线 98 / 1175 / 19，见 I-1）
python -m pytest tests/test_no_auth_surface.py   tests/test_local_owner_claim.py   tests/test_local_owner_materials_listing.py   tests/test_thumbnail_service.py tests/security/ -q     → 155 passed, 2 skipped, 0 errors
                                                          （§2.4 基线 152 passed / 3 errors）
python -c "import app.main"                             → 本机恒失败（OpenCV 损坏，见 I-11）

# 判据
grep -rn "useAuth\|AuthProvider\|isAuthenticated" src/                        → 0
grep -rn "requireAuth" src/                                                   → 0
grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/         → 0
grep -rn "SESSION_TOKEN_KEY\|ecliptrix-session-token" src/                    → 0
grep -c  "RateLimitError" src/lib/api/http-client.ts                          → 13（必须 >0）
grep -rn "getBootstrapCredentials\|ROOT_PASSWORD\|ROOT_USERNAME\|ADMIN_PASSWORD" desktop/ src/ → 0
§10.5 悬挂文档引用扫描                                                        → scanned=943 dangling=0
```

**未执行项**：`npm run test:integration`（C-7）。这些用例需要真起一套后端 + 前端栈
（`tests/integration/helpers/spawn-stack.ts`），本环境未起栈，`bootStack()` 会走 skip 分支，
跑出来是"全 skip"而不是"全绿"，据此宣称通过是虚假绿灯。按 C-7 的二选一条款，**在此显式声明：
integration 未跑**。改动本身是静态的（删除 `auth-flow.test.ts` 与 `helpers/test-user.ts`，
把 `backend-proxy-integration.test.ts` 的 6 个用例从"带 Bearer 断言非 401"改为"匿名断言 200"），
`npx tsc --noEmit` 覆盖了其类型正确性。

**同样未执行**：§10.3 的桌面端手工走查十一条 —— 需要 `npm run build:dir` 产出安装包并人工操作，
属于人工验收环节，不在本节点能力范围内。§10.3 第 11 条（零死路）所依赖的代码已落地并有
`VerticalTaskbar.a11y.test.ts` 的静态守卫。

---

## 收尾轮记录（Endgame Notes）

> **写入者**：收尾轮流水线节点 #2（开发 / F 阶段）。**写入时间**：2026-09-01。
> **本节只追加，不修改本文档任何既有内容**（E-14）。上游方案见
> [`docs/plans/desktop-only-refactor-finalization/spec.md`](../desktop-only-refactor-finalization/spec.md)（Endgame Spec v2）。
>
> **本节的作用**：v4 的 A3 / A4 / A5 / C-3 四条验收判据，有的**从未成立过**，有的会被
> **护栏测试**或**上一次构建的残留**判负。留着它们，只会逼下一个节点用「删测试 / 加 skip /
> 放宽 grep」造一个假绿灯出来 —— 那正是 v4《评审结论》「不通过情形 2」明令禁止的事。
> 因此本节按 E-8 把它们改写为**可满足且仍然有牙齿**的判据，并保留原判据的文字以存轨迹。

### EN.1 判据自洽化（取代原 A3 / A4 / A5 / C-3 的字面判据）

#### A3′（前端门禁 · 差分判据）

> **基线 = commit `37719be`**（本次重构的父提交，即 `feat/remove-user-system` 在重构前的 tip）。
>
> - `npx tsc --noEmit` exit 0；
> - `npm run build` exit 0；
> - `npm test`（`vitest run`）的**失败集合不大于**同一命令在基线 `37719be` 上的失败集合；
> - `npm run lint` 的 **error 集合不大于**基线 error 集合（基线实测 **8** 个，全部落在本次重构
>   未触碰的文件里）。
>
> **为什么改**：原 A3 写的是「lint 无 error / test 全绿」。I-6 已用 `git worktree` 建出
> `37719be` 基线实测证明：这个仓库**从来没有**处在「lint 0 error」的状态过。一条恒不可满足的
> 判据不会提高质量，它只会把实施者推向造假绿灯。
>
> **【收尾轮修订 R-P1-4 / E-18】基线必须写死 SHA**，不得写 `HEAD`（六个提交落地后它就漂走了），
> 更不得写 `git merge-base HEAD main`（实测 = `dc25d77`，是一棵**从未被测量过**的更早的树）。
> 取基线的方法：`git worktree add <仓库外目录> 37719be`，用完 `git worktree remove`。

#### A4′（后端门禁 · 差分判据）

> **基线 = commit `37719be`**（同 A3′）。
>
> - `pytest tests/ -q` 能**整体收集** —— 精确含义是：**不存在因本次改动而新增的 collection
>   error**（如 `import app.dependencies.auth` 这类 ImportError）。基线自带的 19 个 error 是
>   **fixture / 运行期错误，不是 collection error**，它们照旧存在、照旧计入「失败集合 ⊆ 基线」
>   这一侧，与「能整体收集」不冲突。
> - 失败集合**不大于**同一命令在基线上的失败集合。
>
> 基线实测：`37719be` = **98 failed / 1175 passed / 19 errors**；
> 本次重构后 = **82 failed / 1020 passed / 19 errors**（失败**减少 16 个**；passed 下降是因为
> 随用户系统一并删掉了约 155 个鉴权 / 限流用例，属预期）。
>
> **禁止**用 `skip` / `xfail` 制造差值（v4《评审结论》「不通过情形 2」；E-11）。

#### A5′（桌面凭证桥归零 · 源码口径）

> `rg "getBootstrapCredentials|ROOT_PASSWORD|ROOT_USERNAME|ADMIN_PASSWORD|BootstrapCredentials"`
> 于 **`desktop/main`、`desktop/preload`、`desktop/scripts`、`src/`** = **0**；
> 且 `src/types/desktop.d.ts` 中无 `BootstrapCredentials`。
>
> **明确排除**：`desktop/node_modules/`、`desktop/build/`、`desktop/release/` —— 三者都是
> `.gitignore` 覆盖的构建产物，不是源码。
>
> **为什么改**：原 A5 写的是 `grep -rn ... desktop/ src/`，实测 **32 命中**，逐条定位后确认
> **全部**来自上一次打包时拷进 `desktop/build/backend/app/**` 与
> `desktop/release/win-unpacked/resources/backend/app/**`（含 `__pycache__`）的**旧后端副本**。
> 判据不该被上一次构建的残留决定。源码目录实测为 0。
>
> **附带澄清（R-P1-5）**：收尾轮 v1 曾写「跑 `build:dir` 前必须先 `npm run clean`，否则陈旧后端
> 会被打进新包」——**这条因果是错的，已撤销**。实测 `desktop/scripts/prepare-backend.js:51` 与
> `:87` 每次 `build:dir` 都 `fs.rmSync` 掉 `build/backend/` 与 `build/python/` 再重建，
> 该机制不存在。`npm run clean` 保留为**建议**动作（清 `release/`，避免 electron-builder 复用
> 半成品 unpacked 目录），不是 A5′ 的前置条件。

#### C-3′（鉴权错误类清除 · 排除负向断言）

> `grep -rn "MissingAuthError|SessionExpiredError|ForbiddenError" src/` 的命中**必须全部位于**
> `src/lib/api/__tests__/no-auth-surface.test.ts`（护栏测试的负向断言）；
> 且 `grep -c "RateLimitError" src/lib/api/http-client.ts` **> 0**。
>
> 实测：4 命中，行号 **7 / 29 / 30 / 31**，全在该护栏文件内；`RateLimitError` = **13**。
>
> **为什么改**：与 A1 在 v4 评审时已经打过的 P1-7 补丁同口径 —— 护栏测试的正文里**必然**写着
> 这些符号名，那正是它存在的意义。**删掉护栏测试来满足判据是本末倒置**（E-8 / EC-10）。

#### RC-3′（启动路径无破坏性 DDL · 排除注释与字节码）【收尾轮 F 阶段新增】

> 原 RC-3 写的是
> `grep -rniE "drop\s+(table|column)|ALTER .* DROP" backend-services/basic-service/app/` = 0。
> **实测 = 2**，但两条都不是 DDL：
>
> ```
> backend-services/basic-service/app/database.py:132:    DROP / ALTER ... DROP here — both ``user_id`` self-heal incidents in
> Binary file backend-services/basic-service/app/__pycache__/database.cpython-311.pyc matches
> ```
>
> 第一条是 `_claim_ownership_for_local_owner()` 的 docstring，内容恰恰是**禁止**这么做的告警
> （"Never emit DROP / ALTER ... DROP here"）；第二条是同一文件的编译字节码，`.gitignore` 覆盖的
> 构建产物。
>
> **改写**：判据限定为 `--include=*.py` 且**排除注释 / docstring 行与 `__pycache__/`**，期望 **0**。
> 实测改写后 = **0**。**这是与 C-3′ / A5′ 完全同一类的判据缺陷**（负向断言 + 构建产物），
> 处置同样是**改判据、不改代码** —— 把那句告警注释删掉才是真正的倒退，它是这个项目
> 最贵的两次生产事故留下的护栏（F-2）。

### EN.2 收尾轮 F 阶段的实测门禁结果（证据）

> 全部为 `by-running`，执行环境：Windows 11 / MINGW64 / 无 `venv`（用环境解释器，见 N-4）。

| 门禁 | 命令 | 实测 | 判定 |
|------|------|------|------|
| tsc | `npx tsc --noEmit` | **exit 0** | 通过（A3′） |
| 后端子集 | `python -m pytest tests/test_no_auth_surface.py tests/test_local_owner_claim.py tests/test_local_owner_materials_listing.py tests/test_thumbnail_service.py tests/security/ -q` | **155 passed, 2 skipped, 25 warnings in 10.29s** | 通过（RC-4/RC-6/RC-16/EC-9） |
| 桌面单测 | `node desktop/main/window-state.test.js` | `window-state tests passed` | 通过（RC-15） |
| 语法检查 | `node --check` × `smoke-test.js` / `dev.js` / `prepare-env.js` | 三件全 OK | 通过（RC-15） |
| 悬挂引用 | §10.5 扫描脚本（`python -c`，未在仓库内建文件） | **scanned=943 dangling=0** | 通过（A9 ③ / RC-11） |
| 命名一致性 | `grep -rn "AdminSettings\|DesktopTitleBar\|HeaderActions" src/` | **0**（F1 修完两行注释后） | 通过（RC-18 / B-14） |
| 调试残留 | 本次 diff **新增**行中的 `console.log` / `TODO` / `FIXME` | **0** | 通过（RC-20） |
| i18n 完整性 | 新增「通用」面板的 8 个键在 `Translations` 接口 + en + zh 三处均存在 | 每键 3 次命中 | 通过（RC-21） |
| DDL 安全 | RC-3′（见 EN.1） | **0** | 通过（RC-3′ / F-2） |
| lint | `npm run lint` | **8 error**（`AudioSearchModal` 9:11 / `ImageSearchModal` 8:11 / `VideoSearchModal` 8:11 的 `no-empty-object-type`；`MaterialsPanel` 2772:21+2772:55 与 `WatermarkRemovalModal` 629:43+629:50 的 `no-unescaped-entities`；`ImageUploadInput` 61:26 的 `no-restricted-syntax`） | 通过（A3′）：**= 基线 8，未新增**。6 个文件经 `git status --porcelain -- <file>` 逐一验证**全部返回空**，即本次重构一个都没碰过 |
| vitest | `npm test` | **204 files / 1811 tests passed，0 failed**，exit 0 | 通过（A3′）：失败集合 = ∅ ⊆ 基线。**上一轮记录的 3 个既有失败本轮未复现**（1808+3=1811），见 RA-4 |
| build | `npm run build` | **exit 0**，`Compiled successfully in 17.0s`，`.next/standalone/server.js` 已产出（6475 B） | 通过（A3′） |
| 后端全量 | `python -m pytest tests/ -q` | **82 failed / 1020 passed / 35 skipped / 19 errors，224.57s** | 通过（A4′）：失败 98→**82**（减 16）、errors 19→19、**collection error = 0**（`ImportError` / `SyntaxError` / `error collecting` 命中均为 0；`app.dependencies.auth` 与 `pytest.config` 残留均为 **0**，证明 v4 的 P7 已把 F-9 彻底闭环） |

> **A4′ 的 19 个 error 是 per-test 的 fixture / setup 错误，不是 collection error** ——
> 逐条列出确认：`test_main.py` 10 条、`test_subtitle_simple.py` 4 条、
> `test_audio_volume_consistency.py` 3 条、`test_aspect_ratios.py` 1 条、`test_video_cut_fix.py` 1 条。
> 与基线同为 19，且整套用例**能被完整收集**（R-P2-5 澄清的正是这个区别）。

**A3′ / A4′ 判定结论：全部通过。本次重构零新增回归** —— 前端失败集合为空、lint error 与基线
逐条相同且全在未触碰文件里、后端失败数比基线**少 16 个**。

### EN.3 U-2 / U-3 的归属（本节点未执行，非遗漏）

**U-2（`npm run test:integration`）与 U-3（`build:dir` + `smoke-test.js`）本节点未执行**，
这是**方案规定的时序**而不是遗漏：收尾轮 v2 评审的 R-P0-2 把这两个长任务从 F 阶段**移到了
六个提交落地之后**（E-16 / EC-7）。理由是工作区在提交前是**唯一副本**，而 `prepare-backend.js`
每次 `build:dir` 都要组装 embeddable CPython 并 `pip install`（需网络、分钟级）——
上一轮的节点 #3 正是崩在提交之前，整轮产出险些归零。

因此二者归 **V 阶段（提交节点）**，判负按 RA-8 登记，**不回滚已落地的提交**（B-10 修订条款）。

### EN.4 本轮对 v4 结论的影响：无

v4 的重构结论（P0-R / P3 / P4 / P5 / P6 / P7 的全部设计与实现）**一律未改动**（E-1）。
收尾轮只做了三件事：**判据自洽化**（EN.1）、**两行注释的命名修正**（N-3，见
`src/hooks/useTheme.ts:14` 与 `src/hooks/__tests__/useTheme.test.ts:4`）、
以及**把工作区落进 git 历史**。任何试图在收尾轮重新设计 UI / 重组目录 / 再删代码的动作，
都违反 E-1，应当被打回。
