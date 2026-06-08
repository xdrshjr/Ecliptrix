# 桌面端：免登录直达剪辑界面 + 自绘标题栏（无系统程序栏）

- Feature slug: `desktop-direct-editor-titlebar`
- 版本：v2（评审修复 — 已修复全部 P0/P1，见「评审记录」「评审结论」）
- 适用范围：仅桌面端（Electron 打包产物 / `desktop/`）。浏览器端（`npm run dev` / 线上 Web）行为保持不变。
- 关联文档：`desktop/README.md`、`docs/plans/desktop-electron-packaging/spec.md`、`CLAUDE.md`

---

## 评审记录（Review Notes，v1 → v2）

评审人：Anthropic 工程团队（资深评审）。逐节对照源码（`desktop/main/*`、`desktop/preload/preload.js`、`src/app/page.tsx`、`src/contexts/AuthContext.tsx`、`src/lib/api/http-client.ts`、`src/hooks/useTasks.ts`、`src/components/{Header,Container}.tsx`、`desktop/scripts/{smoke-test.js,env.template.desktop}`、`desktop/main/envCheck.js`）核验「可行性 / 完整性 / 一致性 / 适度性」四个维度。

**核验通过的关键前提（无需改动）**
- 静默登录可行：`smoke-test.js` 已证明后端在「零 LLM 配置」下仍用 `.env` 的 `ROOT_USERNAME/ROOT_PASSWORD` 播种管理员并能 `POST /api/auth/login` 200；`env.template.desktop` 默认 `admin`/`change_me_on_first_run` 非 `your_*_here` 占位,`loadUserEnv()` 会保留它们 → 渲染进程拿到的凭证一定能登录。
- smoke-test 走 HTTP 直连登录 API(非点 UI),去掉登录页不影响它(原 §7 风险 8 确认成立,无需改 smoke-test)。
- `Container` 在 `activeTask === null` 时已有「无活跃任务」欢迎态(`Container.tsx:74`),桌面端跳过着陆页后不会崩。
- `createTask('video')` 首任务分支建 chat+video 并激活 video(`useTasks.ts:208`);自动开任务效果以 `didAutoOpenRef` + `tabs.length===0` + `createTask` 依赖收敛,不会死循环。

**问题清单（按严重度）**

| # | 维度 | 严重度 | 问题 | 处置 |
|---|---|---|---|---|
| R1 | 可行性/完整性 | **P1** | `isDesktop()` 依赖 `window`,在 SSR 期恒为 `false`。把 `!isDesktop()` 直接写进渲染期的 `showLandingPage`,会导致桌面端 SSR HTML 渲染 `LandingPage`、客户端水合渲染编辑器 → React 水合不一致;且主窗口 `ready-to-show` 会先画出 SSR 的着陆页、splash 关闭后**闪现一帧 `LandingPage`**,直接违背需求一。 | 已修复 §2.2(e):以 `hydrated` 为闸门 + 水合前渲染中性占位,两端首帧一致,桌面端全程不出现着陆页。 |
| R2 | 可行性/完整性 | **P1** | `auth:bootstrap-credentials` 原计划「在 `main()` 解析完 `state.userEnv` 后注册」,但 `--dev` 模式下 `main()` 在 `loadUserEnv` 之前就 `return`(`index.js:93-97`),该 IPC 不会注册且 `state.userEnv` 为 `null`。于是 §6 列出的「`npm run dev` + Electron」验收路径对需求一**根本无法生效**(invoke 无 handler → 静默登录拿不到凭证 → 永不进编辑器)。 | 已修复 §2.2(a) §2.3(b) §6:两个 IPC 一律在 `isDev` 早退之前注册;bootstrap handler 读 `state.userEnv` 缺失时回退模板默认值;§6 标注 dev 模式静默登录依赖所连后端已播种同名 ROOT 账号。 |
| R3 | 完整性 | P2 | 无边框窗口下,除 `/`、`/login` 外的路由(如 `not-found.tsx`)无自绘标题栏 → 无最小化/拖拽/关闭按钮。桌面端正常导航不可达这些路由,且 `Alt+F4` 仍可关窗,故非阻断。 | §2.3(e) 增加说明:给 `not-found.tsx` 同样挂 `<DesktopTitleBar />`(可选、低成本),并记录 `Alt+F4` 兜底。 |
| R4 | 一致性 | P2 | ROOT 密码经 IPC 暴露给渲染进程,与 `preload.js` 现有注释及 `desktop-electron-packaging` §4.3「零特权 IPC」约定相悖。本地单机、仅加载同源本地应用、外链走系统浏览器,攻击面有限(原 §7 风险 1 已承认)。 | §7 风险 1 强化:落地时必须同步更新 `preload.js` 注释,声明本期起开放受控 IPC 及其理由;给出后续「主进程登录、只下发 session token」的收敛路线。 |
| R5 | 适度性/完整性 | P2 | §2.2 未指明 `silentDesktopLogin` 与 React `login` 的归属:`login` 在 `AuthContext` 内,`desktopAuth.ts` 无法直接调用它。 | §2.2(c) 明确:`desktopAuth.ts` 只负责取凭证;静默登录编排放 `AuthContext`(直接复用其 `login`),避免把 React 闭包外泄到工具模块。 |
| R6 | 完整性 | P2 | 「无 stored token」分支会先把 `isLoading` 置 `false`,静默登录是异步的 → 桌面端会闪一下 `Container` 空态再进编辑器。 | §2.2(c) 增补:桌面端在静默登录 in-flight 期间保持 `isLoading=true`,登录 resolve 后再落 false,消除空态闪烁。 |
| R7 | 完整性 | P2 | 静默重登失败会把 http-client 的 `sessionExpiryHandled` once-flag 永久置真(仅 `login` 成功才 `resetSessionExpiryFlag`),本会话不再自动恢复;`MissingAuthError`(尚无 token 时)路径也不触发静默登录。 | 接受(v1 范围):自动开任务已以 `isAuthenticated` 为前置,首启时机受控。§7 风险 14 记录边界与后续改进。 |

> 适度性总评:方案整体**右尺寸**——零后端改动、以 `isDesktop()` 运行期闸门隔离桌面/浏览器、复用既有登录与任务体系,未过度工程化。两处 P1 均为「SSR/进程生命周期」边界遗漏,已就地补齐。

---

## 1. Overview（概述）

Ecliptrix 是一个 Next.js 15 前端 + FastAPI 后端的内容创作平台，桌面端通过 Electron 把前端、后端、CPython 与 FFmpeg 打进一个 Windows 安装包（见 `desktop/README.md`）。Electron 主进程拉起本地 Next.js（默认 `:18320`）与 FastAPI（默认 `:18321`）两个子进程，主窗口 `loadURL(http://127.0.0.1:18320)`，渲染进程加载的就是**未经改造的同一套 Web 应用**。这意味着「桌面端」与「浏览器端」共用 `src/` 下的全部前端代码，差异只能在**运行期**通过 preload 注入的 `window.ecliptrixDesktop` 标志来区分。

本需求包含两件事。其一（免登录直达剪辑界面）：当前 Web 应用入口 `src/app/page.tsx` 在「没有任何任务标签（`tabs.length === 0`）」时渲染营销性质的着陆页 `LandingPage`，而着陆页的「开始创作」按钮要求用户先登录（`onLoginRequired` 弹出 `LoginModal`），未登录时大量后端接口（工程列表、媒体标签等）会返回 401 并被 `http-client` 重定向到 `/login`。桌面端是单机单用户场景，用户期望「双击即用」，因此要去掉登录交互、去掉着陆页，打开后**直接进入视频剪辑工作区**。其二（自绘标题栏）：当前主窗口虽设置了 `autoHideMenuBar: true`，但仍保留 Windows 原生窗口边框/标题栏（即「系统最上方的程序栏」）。需要改为**无边框窗口**并由应用自身绘制标题栏，最右侧提供「最小化 / 最大化-还原 / 关闭」三个按钮。

设计的核心约束是**零回归**：所有改动都以 `isDesktop()` 运行期判断为闸门，浏览器端代码路径完全不变。免登录采用「**桌面端静默自动登录**」而非「拆除后端鉴权」——后端在桌面端用 SQLite 启动时会用 `.env` 中的 `ROOT_USERNAME` / `ROOT_PASSWORD`（模板默认 `admin` / `change_me_on_first_run`）播种管理员账号，因此渲染进程只要拿到这对凭证、在挂载时静默调用既有 `/api/auth/login`，即可获得一个合法 session（含 cookie 同步），既满足「用户看不到登录」，又让媒体标签、工程列表等依赖鉴权的链路继续可用，改动面最小、风险最低。

---

## 2. Technical Design（技术方案）

### 2.1 运行期桌面判定（两个需求共用的基石）

新增前端工具 `src/lib/desktop/isDesktop.ts`：

```ts
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.ecliptrixDesktop;
}
```

并新增全局类型声明 `src/types/desktop.d.ts`，把 preload 暴露的 `window.ecliptrixDesktop` 形状补全（`version` / `logsPath` 已有，新增 `windowControls`、`getBootstrapCredentials`），避免在业务代码里到处 `as any`。

### 2.2 需求一：免登录直达剪辑界面

分三段实现：**静默登录** → **跳过着陆页** → **启动即开视频任务**。

#### (a) 主进程提供 ROOT 凭证（IPC，不走 argv）

`desktop/main/index.js` 在 `main()` 中注册一个 IPC handler 返回 ROOT 凭证（`loadUserEnv` 返回完整 `.env` 键值，`ROOT_USERNAME`/`ROOT_PASSWORD` 非占位值故一定在内）。

```js
const { ipcMain } = require('electron') // 需新增引入
ipcMain.handle('auth:bootstrap-credentials', () => ({
  // 读 state.userEnv;dev 模式或尚未 loadUserEnv 时回退模板默认值,
  // 保证 handler 始终能返回一对可用凭证(R2)。
  username: (state.userEnv && state.userEnv.ROOT_USERNAME) || 'admin',
  password: (state.userEnv && state.userEnv.ROOT_PASSWORD) || 'change_me_on_first_run',
}))
```

> **注册时序（R2,务必遵守）**:该 `ipcMain.handle` 必须在 `main()` 的 `if (isDev) { … return }` 早退**之前**调用——`--dev` 模式下 `main()` 会在 `loadUserEnv` 之前 `return`(`index.js:93-97`),若把注册放在其后,dev 模式下该 channel 不存在,`invoke` 直接 reject,需求一在 dev 下无法验证。把注册前置后,handler 用上面的回退值兜底;`state.userEnv` 在打包模式下随后被赋值,handler 闭包读到的是赋值后的值(读取发生在 renderer 调用时,而非注册时)。`main()` 经 `app.whenReady().then(main)` 只跑一次,`restartServices()` 不重入 `main()`,故 `ipcMain.handle` 不会重复注册(重复注册会抛错)。

选用 IPC 而非 `additionalArguments`（argv）传递密码：argv 会出现在系统进程列表里，IPC 仅在主进程内存与渲染进程之间传递，泄露面更小（见 §7 风险 1）。

#### (b) preload 暴露凭证获取与窗口控制

`desktop/preload/preload.js` 改为同时引入 `ipcRenderer`，在 `ecliptrixDesktop` 上追加：

```js
getBootstrapCredentials: () => ipcRenderer.invoke('auth:bootstrap-credentials'),
windowControls: { /* 见 §2.3 */ },
```

#### (c) 渲染进程静默登录（接入 AuthContext）

新增 `src/lib/desktop/desktopAuth.ts`，**只负责取凭证**：导出 `getBootstrapCredentials(): Promise<{username,password}|null>`（读 `window.ecliptrixDesktop.getBootstrapCredentials()`，无桥接 / invoke 失败均返回 `null`）。**不在此模块编排登录**——React 的 `login` 是 `AuthContext` 的闭包，工具模块拿不到也不应持有（R5）；静默登录的编排放在 `AuthContext` 内，直接复用其 `login`。

改造 `src/contexts/AuthContext.tsx`：
- 新增内部 `silentDesktopLogin()`（定义在 Provider 作用域内，可直接调用同作用域的 `login`）：`if (!isDesktop()) return;` → `getBootstrapCredentials()` → `null` 时直接返回不抛错、不调 `login`；拿到凭证则 `await login(credentials)`。
- 在 `loadAuthState()` 末尾——当判定为**未登录**（无 stored token，或 `validateSession()` 失败）且 `isDesktop()` 为真时——调用一次 `silentDesktopLogin()`。`login` 成功后会写入 `localStorage`、同步 session cookie、置 `isAuthenticated = true`，与手动登录完全一致。
- **避免空态闪烁（R6）**:在「未登录但将要静默登录」的桌面分支,**不要**先把 `isLoading` 置 `false`;保持 `isLoading=true` 直到 `silentDesktopLogin()` resolve(由 `login` 自身落 `isLoading=false`,失败则在 `catch` 里落 `false`)。否则 `isLoading` 提前为 `false` 而 `isAuthenticated` 仍为 `false`,桌面端会先渲染 `Container` 空态再跳进编辑器,出现一次闪烁。
- 在 `ecliptrix:session-expired` 事件处理器里，如果 `isDesktop()`，在清空状态后再次触发 `silentDesktopLogin()`，使桌面端会话失效后自动恢复，而不是停留在登出态。
- 用一个 `useRef` 防抖（`desktopLoginInFlightRef`），避免并发/重复登录。

#### (d) 抑制桌面端 401 → `/login` 跳转

`src/lib/api/http-client.ts` 当前在 401 时 `window.location.href = '/login?reason=session-expired'`。桌面端的 `/login` 没有意义（且会与自动登录抢路由造成闪烁）。改为：401 处理分支里，`if (isDesktop())` 只 `dispatchEvent('ecliptrix:session-expired')`（交给 AuthContext 重新静默登录），**不做** location 跳转；非桌面端逻辑原样保留。

#### (e) 跳过着陆页（须避免 SSR 水合不一致与着陆页闪烁 — R1）

**不能**简单地把 `!isDesktop()` 直接塞进渲染期条件:

```ts
// ❌ 反例:isDesktop() 依赖 window,SSR 期恒为 false
const showLandingPage =
  tabs.length === 0 && !isSettingsOpen && !isProfileOpen && !isDesktop();
```

`page.tsx` 是 `'use client'`,但 App Router 仍会在(桌面端本地的)Next.js 服务器上先 SSR 出 HTML、再在渲染进程水合。上式会让 **SSR 标记 = 渲染 `LandingPage`**(`window` 不存在 → `isDesktop()===false`),而**客户端水合 = 不渲染**(桌面端 `isDesktop()===true`),触发 React 水合不一致;更糟的是主窗口 `once('ready-to-show')` 会先把 SSR 出来的 `LandingPage` 画出来、splash 关闭后**闪现一帧营销着陆页**,与需求一「打开直达剪辑页」直接冲突。

**修复**:把桌面判定延后到挂载之后,并让 SSR 与客户端首帧渲染一致。复用 §2.2(f) 暴露的 `hydrated`(挂载后才置 `true`)作为闸门,水合前两端都渲染**中性占位**(既非 `LandingPage` 亦非编辑器):

```ts
const ready = hydrated;            // 水合完成前,两端首帧一致
const showBootPlaceholder = !ready; // 纯背景/轻量 spinner,无营销内容
const showLandingPage =
  ready && tabs.length === 0 && !isSettingsOpen && !isProfileOpen && !isDesktop();
```

渲染分支:`showBootPlaceholder` 为真 → 渲染纯背景占位;否则维持既有分支(`showLandingPage` → `LandingPage`;桌面端 `showLandingPage` 恒为 `false`,落到 `Container`)。结果:
- **桌面端**:首帧中性占位 → 水合 + 静默登录就绪后 §2.2(f) 一次性 `createTask('video')` 直达编辑器,**全程不出现 `LandingPage`**,无闪烁、无水合警告。
- **浏览器端**:首帧中性占位(仅一帧) → 水合后 `tabs.length===0` 仍渲染 `LandingPage` 与登录流程;相较 v1 仅多出一帧加载态,无功能回归(§6 风险 7 已据此更新)。

用户若在桌面端手动关掉所有标签,`showLandingPage` 因 `isDesktop()` 仍为 `false`,回落到 `Container` 的「无活跃任务」欢迎态（非营销着陆页），符合「不要起始页面」。

#### (f) 启动即打开视频剪辑任务

「剪辑界面」= `type === 'video'` 的任务工作区（`Container` 在 `activeTask.type==='video'` 且无 `selectedProjectId` 时渲染 `VideoProjectListView` 工程列表，选中工程后进入 `VideoEditorContainer` 时间线编辑器）。

`useTasks` 已暴露 `createTask`。需在 `src/hooks/useTasks.ts` 的返回值里**额外暴露 `hydrated`**（内部已有该 state），供入口判断「localStorage 恢复是否完成」。

`src/app/page.tsx` 新增一次性自动打开效果：

```ts
const didAutoOpenRef = useRef(false);
useEffect(() => {
  if (!isDesktop() || didAutoOpenRef.current) return;
  if (!hydrated || isLoading || !isAuthenticated) return; // 等水合 + 等静默登录
  if (tabs.length > 0) return;                            // 已有持久化标签则不打扰
  didAutoOpenRef.current = true;
  createTask('video');
}, [hydrated, isLoading, isAuthenticated, tabs.length, createTask]);
```

`createTask('video')` 在「首个任务」分支会同时建 `chat` + `video` 两个任务并把 `video` 设为激活（见 `useTasks.createTask` 的 `isFirstTaskFromLanding` 逻辑），于是 `Container` 直接渲染视频剪辑工作区。等待 `isAuthenticated` 才创建，能保证工程列表请求发出时已携带 token，规避 401（见 §7 风险 3）。

#### (g) 桌面端隐藏登录/登出入口（收尾）

`src/components/Header.tsx`：用 `isDesktop()` 包裹「登录/注册」按钮分支与用户下拉里的「登出」项。桌面端恒为已登录，登录按钮本就不渲染；隐藏登出可避免用户登出后触发自动重登的循环观感。其余（语言、主题、设置、个人资料）保持不变。

### 2.3 需求二：自绘标题栏（无边框窗口 + 窗口控制）

#### (a) 主窗口改为无边框

`desktop/main/window.js` 的 `createMainWindow` 在 `BrowserWindow` 选项中加入 `frame: false`（移除原生标题栏与边框）。**不要**设置 `thickFrame: false`——Electron 默认 `thickFrame: true`，无边框窗口在 Windows 上仍保留隐藏的 `WS_THICKFRAME`，**边缘拖拽缩放依旧可用**（见 §7 风险 6）。原有 `minWidth/minHeight/autoHideMenuBar` 保留（`autoHideMenuBar` 在无边框下无害）。

同时在 `createMainWindow` 内监听最大化状态变化，推送给渲染进程，用于切换按钮图标：

```js
const emitMax = () => win.webContents.send('window:maximize-changed', win.isMaximized())
win.on('maximize', emitMax)
win.on('unmaximize', emitMax)
```

`splash.html`（已 `frame:false`）与 `error.html`（独立 BrowserWindow）保持现状——错误窗口刻意保留原生边框，确保异常态用户永远能关窗（见 §7 风险 7）。

#### (b) 主进程注册窗口控制 IPC

新增 `desktop/main/windowControls.js`：

```js
'use strict'
const { ipcMain, BrowserWindow } = require('electron')
function winOf(e) { return BrowserWindow.fromWebContents(e.sender) }
function registerWindowControlIpc() {
  ipcMain.handle('window:minimize', (e) => { winOf(e)?.minimize() })
  ipcMain.handle('window:toggle-maximize', (e) => {
    const w = winOf(e); if (!w) return false
    if (w.isMaximized()) w.unmaximize(); else w.maximize()
    return w.isMaximized()
  })
  ipcMain.handle('window:close', (e) => { winOf(e)?.close() })
  ipcMain.handle('window:is-maximized', (e) => !!winOf(e)?.isMaximized())
}
module.exports = { registerWindowControlIpc }
```

在 `desktop/main/index.js` 的 `main()` 起始处调用一次 `registerWindowControlIpc()`——**务必在 `if (isDev) { … return }` 早退之前**(R2),否则 `--dev` 模式下窗口控制 IPC 不存在、自绘按钮全部失效。窗口控制不依赖 `state.userEnv`,放最前面即可;与 `auth:bootstrap-credentials` 一样,`main()` 仅经 `whenReady` 跑一次,不会重复注册。

#### (c) preload 暴露 windowControls

`desktop/preload/preload.js` 的 `ecliptrixDesktop.windowControls`：

```js
windowControls: {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizeChange: (cb) => {
    const listener = (_e, val) => cb(!!val)
    ipcRenderer.on('window:maximize-changed', listener)
    return () => ipcRenderer.removeListener('window:maximize-changed', listener)
  },
},
```

#### (d) 前端自绘标题栏组件

新增 `src/components/desktop/DesktopTitleBar.tsx`（`'use client'`）：
- 浏览器端 `isDesktop() === false` 时返回 `null`，零影响。
- 桌面端渲染一条高 32px 的条（`h-8`，复用 Tailwind 主题色 `bg-card border-b border-border`）：
  - 左侧：应用 logo + `Ecliptrix` 标题文本，整条作为拖拽区 `style={{ WebkitAppRegion: 'drag' }}`，并 `onDoubleClick={() => controls.toggleMaximize()}` 复刻原生双击最大化。
  - 右侧：三个图标按钮（最小化 / 最大化-还原 / 关闭），容器与按钮均 `WebkitAppRegion: 'no-drag'`，否则按钮点不动。关闭按钮 hover 用红色（`hover:bg-red-600 hover:text-white`）。
  - 通过 `useEffect` 订阅 `controls.onMaximizeChange` 维护 `isMax` 本地 state，初始用 `controls.isMaximized()` 校准；按 `isMax` 切换「最大化/还原」图标与 `title`。
- 注意：`WebkitAppRegion` 不在 React `CSSProperties` 类型里，用 `style={{ ['WebkitAppRegion' as any]: 'drag' }}` 或在 `desktop.d.ts` 中扩展 `CSSProperties`。

#### (e) 挂载标题栏（保持低爆炸半径）

不改 `src/app/layout.tsx`（server component 维持纯净），而是把 `<DesktopTitleBar />` 作为**首个 flex 子节点**插入：
- `src/app/page.tsx` 根 `div`（`h-screen flex flex-col`）的第一行——在 `<Header />` 之上。32px 标题栏 + 56px Header + `flex-1` 内容在 `h-screen overflow-hidden` 容器内自适应，不溢出。
- `src/app/login/page.tsx`（自动登录失败的兜底路由）外层包一层 `flex flex-col`，顶部放 `<DesktopTitleBar />`，下方放原 `min-h-screen` 内容并改为 `flex-1 min-h-0`。
- `src/app/not-found.tsx`（R3,可选但建议）：无边框窗口下任何**没有自绘标题栏的路由都没有最小化/拖拽/关闭按钮**。桌面端正常导航不会走到 404(应用只在 `/` 内通过 tab/modal 切换,`/login` 失败兜底也 `router.replace('/')`),且 `Alt+F4` 仍能关窗,故非阻断;但为彻底消除「卡在无控件窗口」的可能,给 `not-found.tsx` 也按同样方式挂一个 `<DesktopTitleBar />`。落地未做时,须在 `desktop/README.md` 记录「404 等非常规路由用 `Alt+F4` 关闭」。

组件自身在浏览器端返回 `null`，因此这些插入对 Web 端无视觉/布局影响。

---

## 3. File / Module Change Plan（文件 / 模块变更计划）

| 文件 | 动作 | 一句话意图 |
|---|---|---|
| `desktop/main/window.js` | 修改 | `createMainWindow` 加 `frame: false`；监听 `maximize`/`unmaximize` 向渲染进程推送状态 |
| `desktop/main/windowControls.js` | 新建 | 注册 `window:minimize/toggle-maximize/close/is-maximized` 四个 IPC handler |
| `desktop/main/index.js` | 修改 | `main()` 中调用 `registerWindowControlIpc()`；注册 `auth:bootstrap-credentials` 返回 ROOT 凭证 |
| `desktop/preload/preload.js` | 修改 | 引入 `ipcRenderer`，在 `ecliptrixDesktop` 上暴露 `windowControls` 与 `getBootstrapCredentials` |
| `src/lib/desktop/isDesktop.ts` | 新建 | 运行期判定是否桌面端（`!!window.ecliptrixDesktop`） |
| `src/lib/desktop/desktopAuth.ts` | 新建 | 封装获取 bootstrap 凭证 + `silentDesktopLogin` 辅助 |
| `src/types/desktop.d.ts` | 新建 | 声明 `Window.ecliptrixDesktop` 形状，扩展 `CSSProperties.WebkitAppRegion` |
| `src/components/desktop/DesktopTitleBar.tsx` | 新建 | 自绘标题栏：拖拽区 + 最小化/最大化-还原/关闭按钮，浏览器端渲染 null |
| `src/contexts/AuthContext.tsx` | 修改 | 未登录且桌面端时静默自动登录；会话过期时桌面端自动重登 |
| `src/lib/api/http-client.ts` | 修改 | 桌面端 401 不跳 `/login`，只派发 `session-expired` 事件 |
| `src/hooks/useTasks.ts` | 修改 | 返回值新增 `hydrated`，供入口判断水合完成 |
| `src/app/page.tsx` | 修改 | 以 `hydrated` 为闸门跳过着陆页(水合前渲染中性占位,杜绝 SSR 水合不一致/着陆页闪烁 — R1);水合+登录完成后一次性 `createTask('video')`；顶部插入 `<DesktopTitleBar />` |
| `src/app/login/page.tsx` | 修改 | 兜底路由顶部插入 `<DesktopTitleBar />`，布局改 flex 列 |
| `src/app/not-found.tsx` | 修改（可选，R3） | 顶部插入 `<DesktopTitleBar />`，避免无边框窗口下 404 路由无窗口控件 |
| `src/components/Header.tsx` | 修改 | 桌面端隐藏「登录/注册」与「登出」入口 |

> 不修改后端任何文件：免登录通过复用既有 `/api/auth/login` + ROOT 播种账号实现。

---

## 4. Interface Design（接口设计）

均为 Electron IPC（`ipcRenderer.invoke` ⇄ `ipcMain.handle`），无 REST/WebSocket 改动。

| Channel | 方向 | 入参 | 返回 | 语义 |
|---|---|---|---|---|
| `auth:bootstrap-credentials` | renderer→main | — | `{ username: string, password: string }` | 桌面端静默登录用的 ROOT 凭证 |
| `window:minimize` | renderer→main | — | `void` | 最小化当前窗口 |
| `window:toggle-maximize` | renderer→main | — | `boolean`（切换后是否最大化） | 最大化/还原切换 |
| `window:close` | renderer→main | — | `void` | 关闭当前窗口 |
| `window:is-maximized` | renderer→main | — | `boolean` | 查询当前是否最大化 |
| `window:maximize-changed` | main→renderer | `boolean` | — | 最大化状态变更推送（事件） |

preload 暴露的渲染端 API：

```ts
window.ecliptrixDesktop: {
  version: string
  logsPath: string
  getBootstrapCredentials(): Promise<{ username: string; password: string }>
  windowControls: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (isMax: boolean) => void): () => void  // 返回取消订阅函数
  }
}
```

前端工具签名：`isDesktop(): boolean`；`getBootstrapCredentials(): Promise<{username,password} | null>`。

---

## 5. Data Model（数据模型）

无数据库 schema 变更。涉及的内存/存储形状：

- **bootstrap 凭证**（仅内存/IPC）：`{ username: string; password: string }`，源自主进程 `state.userEnv.ROOT_USERNAME/ROOT_PASSWORD`，绝不落盘到渲染进程持久化层。
- **会话存储**（沿用现状，不改）：`localStorage['ecliptrix-user']`（`User` JSON）、`localStorage['ecliptrix-session-token']` + 同源 session cookie。静默登录复用既有 `login()`，写入同样的键。
- **任务状态**（沿用现状）：`localStorage['ecliptrix-tasks-state-v1']`（`{ tasks, tabs, activeTabId }`）。桌面端自动创建的 `video`/`chat` 任务与手动创建结构完全一致，可被既有水合/清洗逻辑正常恢复。
- **标题栏 UI state**（组件内存）：`isMax: boolean`。

---

## 6. Testing & Acceptance Criteria（测试与验收）

### 单元/逻辑测试
- `isDesktop()`：`window.ecliptrixDesktop` 存在/不存在两种返回（jsdom 注入/删除全局）。
- `useTasks`：新增断言 `hydrated` 在 mount 后变为 `true`，且不破坏既有持久化测试（`useTasks.persistence.test.ts`）。
- `desktopAuth.silentDesktopLogin`：mock `getBootstrapCredentials` 与 `login`，断言成功路径置 `isAuthenticated`；凭证为 `null` 时不抛错、不调用 `login`。
- AuthContext：mock `isDesktop=true` + 无 stored token → 断言挂载后触发一次静默登录；`session-expired` 事件在桌面端触发重登（`useRef` 防抖只登一次）。

### 手动/集成验收（对打包产物或 `npm run dev` + Electron）

> **dev 模式注意（R2）**:`auth:bootstrap-credentials` 在 dev 下返回模板默认 `admin`/`change_me_on_first_run`,**静默登录能否成功取决于所连后端是否播种了同名 ROOT 账号**。因此「免登录直达」(下面第 1–3 条)以**打包产物**为权威验收对象;`npm run dev` + Electron 可验「无系统程序栏 + 三按钮」(第 4–6 条)与「不渲染 `LandingPage`」(第 1 条的 UI 部分),但静默登录链路需后端账号匹配方能在 dev 下走通。

1. **免登录直达**：全新 userData 启动 → 不出现任何登录界面、不出现 `LandingPage`（含 splash 关闭瞬间也**不闪现**一帧着陆页 — R1） → 直接显示视频剪辑工作区（工程列表）；左侧 taskbar 含 video/chat 两个标签，video 激活。
2. **鉴权链路可用**：剪辑界面能拉取工程列表、媒体缩略图正常加载（证明 session cookie 已同步），控制台无 401→`/login` 跳转。
3. **会话自愈**：手动清空 `ecliptrix-session-token` 后触发一次受保护请求 → 不跳 `/login`，自动静默重登后请求恢复。
4. **无系统程序栏**：窗口顶部无 Windows 原生标题栏/边框；可见应用自绘标题栏，左侧 logo+标题，最右三按钮。
5. **窗口控制**：最小化生效；最大化↔还原切换且按钮图标随之变化；双击标题栏切换最大化；关闭按钮退出应用（触发既有 `before-quit` 清理子进程）。
6. **拖拽与缩放**：按住标题栏空白处可拖动窗口；从窗口四边可缩放。
7. **浏览器零回归**：`npm run dev`（无 Electron）下，`/` 水合后仍显示 `LandingPage` 与登录流程（水合前可能有**一帧中性占位**,属预期 — R1），页面顶部**无**自绘标题栏，`isDesktop()` 为 `false`；控制台无 React 水合不一致(hydration mismatch)告警。

### 验收门槛
- `npm run type-check` 与 `npm run lint` 通过（新文件含 `WebkitAppRegion` 类型扩展）。
- `desktop/scripts/smoke-test.js` 仍通过（注意：该脚本现走「登录 API」断言鉴权链路；若其依赖可见登录页，需同步确认其改为直接命中 API 而非 UI——见 §7 风险 8）。

---

## 7. Risks & Mitigations（风险与缓解）

1. **ROOT 密码传到渲染进程（R4）**：本地单机应用、渲染进程为自有可信 Web 应用，凭证仅经 IPC 内存传递、不落盘、不进 argv；可接受。**但此改动反转了 `preload.js` 现有注释及 `desktop-electron-packaging` §4.3 声明的「v1 零特权 IPC」约定**——落地时必须同步更新 `preload.js` 顶部注释,声明本期起开放受控 IPC(`windowControls` + `getBootstrapCredentials`)及其单机可信前提,避免代码与文档约定打架(否则下游评审会把它当违规)。后续收敛路线:改为「主进程内直接 `POST /api/auth/login`,只把 session token 下发给渲染进程」,使 ROOT 密码永不出主进程。
2. **静默登录与水合/编辑器数据请求的竞态**：自动开任务效果以 `hydrated && !isLoading && isAuthenticated` 为前置条件，确保工程列表请求发出时已持有 token。
3. **首启时极早期请求 401 闪烁**：§2.2(d) 桌面端 401 不跳 `/login`，仅派发事件触发重登，避免 `/login` 闪现。
4. **重复/并发自动登录**：`desktopLoginInFlightRef` + `didAutoOpenRef` 双重防抖，保证各自只执行一次。
5. **持久化用户已有标签**：自动开任务前判断 `tabs.length === 0`，老用户不被强行新建任务、不打扰其上次工作区。
6. **无边框窗口失去缩放/拖拽**：保留默认 `thickFrame:true` 维持 Windows 边缘缩放；拖拽由标题栏 `WebkitAppRegion:'drag'` 提供；按钮区显式 `no-drag`。
7. **错误兜底窗口**：`error.html`/`showErrorWindow` 保留原生边框，保证异常态可关窗，不纳入无边框改造。
8. **smoke-test 与登录 UI 解耦**：`smoke-test.js` 通过 HTTP 直接调用登录 API 断言鉴权（非点 UI），去掉登录页不影响它；落地时需回归确认。若它假设了某个 UI 元素，按「直接命中 API」修正。
9. **端口回退导致 origin 变更清空 localStorage**：既有逻辑（`index.js resolvePorts`）已弹窗提示；桌面端静默登录可在新 origin 上自动重建会话，体验反而更顺。
10. **`WebkitAppRegion` 类型缺失**：在 `desktop.d.ts` 扩展 `CSSProperties` 或局部 `as any`，避免 `type-check` 失败。
11. **跨平台**：本期仅 Windows 打包；`frame:false` + 自绘按钮在 macOS 需配合 `trafficLightPosition`，本期不处理，组件按钮顺序按 Windows（右侧）布局。
12. **SSR 水合不一致 / 着陆页闪烁（R1，已修复）**：`isDesktop()` 在 SSR 期恒为 `false`,若用于渲染期分支会让桌面端 SSR 渲染 `LandingPage`、客户端水合渲染编辑器,导致水合告警 + 主窗口 `ready-to-show` 闪现一帧着陆页。已在 §2.2(e) 以 `hydrated` 闸门 + 水合前中性占位修复:两端首帧一致,桌面端全程无着陆页。
13. **dev 模式 IPC 注册时序（R2，已修复）**:`--dev` 下 `main()` 在 `loadUserEnv` 前 `return`,两个 IPC 必须在 `isDev` 早退之前注册,`auth:bootstrap-credentials` 用模板默认值兜底;dev 模式静默登录还取决于所连后端账号是否匹配(见 §6 注意)。
14. **静默重登失败的 once-flag 闩锁 / `MissingAuthError` 不触发重登（R7,接受）**:http-client 的 `sessionExpiryHandled` 仅在 `login` 成功后 `resetSessionExpiryFlag()`;若静默重登持续失败,本会话不再自动恢复(避免死循环,符合预期)。尚无 token 时受保护请求抛 `MissingAuthError`(非 401),不触发静默登录——但自动开任务已以 `isAuthenticated` 为前置,首启请求时机受控,影响面仅限其它在登录前自行发请求的组件(与现网未登录态一致)。v1 接受,后续可在 `MissingAuthError` 边界对桌面端补一次静默登录。

---

## 8. 实施顺序建议（给下游开发）

1. 先做判定与类型底座：`isDesktop.ts` + `desktop.d.ts`。
2. 主进程/preload 的 IPC（窗口控制 + bootstrap 凭证）打通，能在 DevTools 手测 `window.ecliptrixDesktop.windowControls`。
3. `window.js` 加 `frame:false` + 标题栏组件 `DesktopTitleBar.tsx`，先把「无系统栏 + 三按钮」跑通（需求二闭环）。
4. AuthContext 静默登录 + http-client 401 守卫（需求一鉴权闭环）。
5. `useTasks` 暴露 `hydrated` + `page.tsx` 跳着陆页（`hydrated` 闸门 + 中性占位,R1）与自动开 video 任务 + `Header` 隐藏登录/登出（需求一交互闭环）。
6. 补单测、跑 `type-check`/`lint`，对 `win-unpacked` 跑一遍 §6 手动验收与 smoke-test（dev 验收限于需求二与「不渲染着陆页」,免登录链路以打包产物为准 — R2）。

---

## 评审结论（Review Verdict）

**有条件通过（Approved with Conditions）。**

方案在可行性、一致性、适度性上整体扎实:零后端改动、以 `isDesktop()` 运行期闸门隔离桌面/浏览器、复用既有 `/api/auth/login` + ROOT 播种账号与既有任务体系,核心前提已逐一对照源码核验通过(静默登录可行、smoke-test 不依赖登录 UI、`Container` 容忍空 `activeTask`、自动开任务无死循环)。评审发现的 **2 个 P1**(R1 SSR 水合不一致/着陆页闪烁、R2 dev 模式 IPC 注册时序与验收路径)与相关 **P2** 均已在本 v2 文档**就地修复**,无遗留 P0/P1。

放行需在**代码落地阶段**满足以下条件(均已在正文写清,下游 Subtask #2 必须照做):

1. **(对应 R1)** `page.tsx` 必须用 `hydrated` 闸门 + 水合前中性占位,严禁把 `isDesktop()` 直接写进渲染期 `showLandingPage`;验收时确认桌面端 splash 关闭瞬间**不闪现**着陆页、控制台无 hydration mismatch。
2. **(对应 R2)** `registerWindowControlIpc()` 与 `auth:bootstrap-credentials` 两个 IPC 必须在 `main()` 的 `if (isDev) … return` **之前**注册;bootstrap handler 带模板默认值兜底;`index.js` 新增 `ipcMain` 引入。
3. **(对应 R4)** 落地时同步更新 `preload.js` 顶部「零特权 IPC」注释,声明本期开放受控 IPC 及单机可信前提,保持代码与 `desktop-electron-packaging` §4.3 文档一致。
4. **(对应 R5/R6)** 静默登录编排放 `AuthContext`(复用其 `login`),`desktopAuth.ts` 仅取凭证;桌面端在静默登录 in-flight 期间保持 `isLoading=true`,消除空态闪烁。
5. **(对应 R3,可选但建议)** 给 `not-found.tsx` 也挂 `<DesktopTitleBar />`,或在 `desktop/README.md` 记录「非常规路由用 `Alt+F4` 关闭」。
6. 交付门槛不变:`npm run type-check`、`npm run lint`、`desktop/scripts/smoke-test.js` 全绿,并对 `win-unpacked` 走完 §6 手动验收。

满足上述条件即视为完全通过,可进入 Subtask #2(代码开发)。
