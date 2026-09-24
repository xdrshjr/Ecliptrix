# 品牌 LOGO 全量替换方案（brand-logo-refresh）

> 文档版本：**v2**（v1 方案设计 → v2 设计评审修订，P0/P1 已并入正文）
> 日期：2026-09-24
> 分支：`feat/remove-user-system`
> 需求原文：「给这个项目所有涉及到LOGO的地方，适配这个LOGO，包括桌面端打包之后，显示在电脑任务栏的图标」
> 新 LOGO 原图：`docs/plans/brand-logo-refresh/assets/ecliptrix-logo-source.png`
> （由附件 `.agentmesh/attachments/paste-1790262865055.png` 原样拷贝而来，1254×1254，RGB，无透明通道）

---

## 评审记录

评审人：设计评审节点（2026-09-24）。评审方式：逐节对照 `CLAUDE.md` 约定与代码现状核实（`desktop/electron-builder.yml`、`desktop/main/{index,window,window-state.test}.js`、`desktop/scripts/prepare-frontend.js`、`src/app/layout.tsx`、`src/components/shell/AppTitleBar.tsx`、`desktop/package.json`、本机 Pillow/NumPy 版本）。

已核实成立的事实：`win.signAndEditExecutable: false`（`electron-builder.yml:60`，自 a52bc01 起）；electron 33.4.11 / electron-builder 25.1.8；`appId: com.ecliptrix.desktop`；`files` 含 `assets/**`，`buildResources: resources`（不进包）；`prepare-frontend.js:55-57` 会把 `public/` 整目录拷进 standalone，故 `public/brand/*` 打包可用；`window-state.test.js:10` 会 `require('./window')`，新增 `require('./appIcon')` 须保持纯 Node 可加载；`logo-ai` 仅 3 处引用（AppTitleBar、两份 README）；本机 Pillow 10.1.0、NumPy 1.26.4；前端 `npm test` = `vitest run`，`src/components/shell/__tests__/` 存在。

| # | 级别 | 维度 | 问题 | 处理（v2） |
|---|------|------|------|-----------|
| RV-1 | **P1** | 可行性 | v1 让 `BrowserWindow.icon` 指向 `app.asar/assets/icon.ico`。Electron 在 Windows 上加载 `.ico` 走 Win32 `LoadImage(LR_LOADFROMFILE)` 直接读磁盘路径，**无法读取 asar 虚拟路径**（PNG 走 asar 感知的读取，ICO 不走）。结果是打包后窗口图标静默为空，只能依赖 exe 资源兜底；dev 下虽可用，但生产验收会与设计意图不符且无人察觉 | §3.2.1 增加 `asarUnpack: [assets/icon.ico]`；§3.2.2 `APP_ICON_PATH` 改为解析到 `app.asar.unpacked`；§7.1 新增 `testIconIsUnpackedFromAsar` 与路径解析单测；§7.3 新增对 `resources/app.asar.unpacked/assets/icon.ico` 的存在性检查 |
| RV-2 | **P1** | 完整性 / 错误路径 | 图标文件缺失或路径错误时 v1 无任何信号（`BrowserWindow` 对不存在的 icon 静默忽略），违反 `CLAUDE.md`「Never swallow… fail fast / 不做隐藏 bug 的静默回退」 | §3.2.3 在 logger 初始化后 `fs.existsSync(APP_ICON_PATH)` 为假时 `logger.warn('main', …)` 并带出绝对路径；不中断启动（图标缺失不应阻止用户使用应用），但日志可追溯 |
| RV-3 | **P1** | 完整性 / 发布 | v1 打开 `signAndEditExecutable` 后，打包前置条件变化（首次需解压 winCodeSign，含 darwin 符号链接），但只在风险表里提了一句，打包文档与回退方式未写明；另一台机器首次打包会直接失败而不知原因 | §3.5 明确在 `desktop/README.md` 打包章节新增「exe 图标 / rcedit」小节（前置条件、报错原文、开发者模式解决方法、`ie4uinit.exe -show` 刷新缓存）；§8 R1 补回退策略：不得为绕过报错把 `signAndEditExecutable` 改回 `false`（该回归由 `testBuilderEditsExecutable` 拦截） |
| RV-4 | P2 | 一致性 | v1 `appIcon.js` 示例 JSDoc 行长 > 80 字符，违反 Clean Code 行长上限 | §3.2.2 示例已折行 |
| RV-5 | P2 | 可行性 | ICO `append_images` 按尺寸取帧依赖 Pillow ≥ 10.1；v1 只在注释里写版本，未在脚本中校验，老版本 Pillow 会静默重采样 256 帧导致小尺寸发糊 | §3.1.4 脚本启动时校验 `PIL.__version__ >= 10.1`，不满足直接 `SystemExit` |
| RV-6 | P2 | 适度性 | NSIS `installerIcon/uninstallerIcon/installerHeaderIcon` 在 electron-builder 中默认即取 `win.icon`，显式写出属冗余 | 保留（显式声明便于检索、成本为 3 行），不视为问题 |
| RV-7 | P2 | 适度性 | `desktop/assets/brand-mark.png` 与 `public/brand/ecliptrix-mark.png` 内容重复 | 保留：闪屏在 Next 服务就绪前显示，只能读 asar 内文件；二者由同一脚本生成，不会漂移 |
| RV-8 | P2 | 测试 | `testBuilderEditsExecutable` 用文本匹配 yml，缩进/注释变化可能误报 | 可接受：误报方向是"测试红"而非"漏过回归"；实现时用 `/^\s*signAndEditExecutable:\s*true\s*$/m` 正则，避免被注释行命中 |
| RV-9 | P2 | 文档卫生 | §3.2.4 末行"闪屏窗口额外加 `skipTaskbar: false` 不需要…不改"是无效信息 | 已删除 |
| RV-10 | P2 | 完整性 | 仅覆盖 Windows；macOS/Linux 的 `.icns`/PNG 未涉及 | 与现状一致：`electron-builder.yml` 仅有 `win`/`nsis` 目标，不扩范围 |

未发现 P0 问题。P1 × 3 已全部在正文修订；P2 已修订或给出保留理由。

---

## 1. 概述

Ecliptrix 目前有**三套互不一致的 LOGO**：Web 端标题栏和 README 用的是 `public/logo-ai.png`（768×767 的圆形"日蚀月牙 + ECLIPTRIX 字样"）；Next.js 网站图标 `src/app/icon.png` 是同一张图，但**棋盘格"透明背景"是烧进像素里的**（左上角像素为 `(39,39,39,0)`，四角实际显示为灰白格子）；桌面端 `desktop/resources/icons/icon.ico` 是打包脚本生成的**占位图标**（深紫圆底 + 白色字母 "E"，`desktop/README.md:222` 自己写着"v1 为脚本生成的占位图标"）。启动闪屏 `splash.html` 和开发等待页 `dev-waiting.html` 则只用渐变文字 "Ecliptrix" 充当 LOGO。

更严重的是**任务栏图标根本不是我们的图标**。实测已打包的 `desktop/release/win-unpacked/Ecliptrix.exe`，用 `System.Drawing.Icon.ExtractAssociatedIcon` 取出的是 **Electron 默认原子图标**。原因是 `desktop/electron-builder.yml` 中 `win.signAndEditExecutable: false`：electron-builder 的"签名 + 编辑可执行文件"是同一步，关掉后 rcedit 不会运行，`win.icon` 根本没有写进 exe 资源段。Windows 任务栏按钮、固定到任务栏的图标、资源管理器里的 exe 图标都取自 exe 资源（窗口运行时的按钮图标还会取 `BrowserWindow` 的 `icon`，而我们三个 `BrowserWindow` 都没设置），所以用户看到的永远是 Electron 原子。此外主进程也没调用 `app.setAppUserModelId`，运行中的窗口和 NSIS 创建的快捷方式（AUMID = `appId`）可能不被归为同一个任务栏分组。

本方案把新 LOGO（渐变莫比乌斯三角丝带 + "Ecliptrix" 深蓝字标）作为**唯一品牌源**，用一个可重复运行的 Python 生成脚本从源图派生出所有尺寸的资产（透明图形标、ICO、favicon），并修复桌面打包链路，使安装后的 exe、任务栏、开始菜单快捷方式、安装/卸载程序、窗口标题栏、启动闪屏全部显示新 LOGO。派生资产**提交进仓库**，构建流程不依赖生成脚本（不给 `npm run build` 引入 Python/Pillow 依赖）。

---

## 2. LOGO 使用点全量盘点（现状）

| # | 位置 | 当前资产 | 显示场景 | 处理 |
|---|------|----------|----------|------|
| 1 | `desktop/electron-builder.yml` → `win.icon` | `desktop/resources/icons/icon.ico`（占位 "E"） | exe 文件图标、任务栏、快捷方式、NSIS 安装包 | 替换 ICO + 打开 exe 编辑 |
| 2 | `desktop/main/window.js` 三个 `BrowserWindow` | 未设置 `icon` | 运行时任务栏按钮 / Alt-Tab | 新增 `icon` |
| 3 | `desktop/main/index.js` | 未设置 AUMID | 任务栏分组、固定到任务栏 | 新增 `app.setAppUserModelId` |
| 4 | `desktop/assets/splash.html` `.logo` | 渐变文字 | 启动闪屏 | 加图形标 |
| 5 | `desktop/assets/dev-waiting.html` `.logo` | 渐变文字 | dev 等待页 | 加图形标 |
| 6 | `src/components/shell/AppTitleBar.tsx:92` | `/logo-ai.png` | 应用标题栏左上角（18px） | 换新图形标 |
| 7 | `src/app/icon.png` + `layout.tsx` `metadata.icons` | 旧圆形图（棋盘格烧死） | 浏览器 tab favicon（调试路径） | 换新图形标，删冗余 metadata |
| 8 | `README.md:2`、`README.zh-CN.md:2` | `public/logo-ai.png` | GitHub 仓库首页 | 换完整 LOGO（带字标） |
| 9 | `docs/generate_logo.py` | 会写出旧 `public/logo-ai.png` | 开发者误运行会回退 LOGO | 删除 |
| 10 | `desktop/README.md:222` | 文案"占位图标" | 文档 | 更新文案 |

已确认**不涉及** LOGO 的地方：`desktop/assets/error.html`（仅标题文字，不加图，保持错误页朴素）、`src/components/video/workbench/*`、各类 `icons.tsx`（均为功能图标，非品牌 LOGO）、后端（无品牌图片）。

---

## 3. 技术设计

### 3.1 资产派生流水线

```
docs/brand/ecliptrix-logo-source.png   (1254², 浅灰底, 含字标 —— 唯一品牌源)
        │  docs/brand/generate_brand_assets.py  (Pillow ≥10.1, 手动运行)
        ├─► 抠图: color-to-alpha 去浅灰背景  → 透明 RGBA
        ├─► 裁出图形标(三角丝带, 不含字标) → 方形留白 → mark_master (1024², RGBA)
        │
        ├─► public/brand/ecliptrix-mark.png          256²  (标题栏)
        ├─► public/brand/ecliptrix-logo.png          源图原样拷贝 (README, 带浅底)
        ├─► src/app/icon.png                          512²  (Next 文件约定 favicon)
        ├─► src/app/favicon.ico                       16/32/48
        ├─► desktop/assets/brand-mark.png             256²  (闪屏/等待页 <img>)
        ├─► desktop/assets/icon.ico                   多尺寸 (运行时 BrowserWindow.icon)
        └─► desktop/resources/icons/icon.ico          与上者逐字节相同 (electron-builder)
```

#### 3.1.1 背景估计与抠图（color-to-alpha）

源图背景是近白浅灰且有轻微渐变（四角实测 `(240,243,244)`~`(241,243,245)`），不能用单一色键硬切，否则丝带外侧的柔光会出现白边。采用 GIMP "Color to Alpha" 同类算法：

1. **背景色 `bg`**：取图像四条边各 8px 宽边框内全部像素，按通道取**中位数**，得到 RGB 三元组。
2. **逐像素 alpha**：`d = 欧氏距离(pixel.rgb, bg)`；`alpha = clamp((d - T0) / (T1 - T0), 0, 1)`，常量 `T0 = 6`、`T1 = 42`（写成模块级常量 `ALPHA_FLOOR_DISTANCE`、`ALPHA_FULL_DISTANCE`）。
3. **反预乘去白边**：当 `alpha > 0` 时 `rgb_out = clamp((pixel.rgb - (1 - alpha) * bg) / alpha, 0, 255)`；`alpha == 0` 的像素 RGB 置 0。
4. 实现用 NumPy 向量化（`numpy` 已是后端依赖；若运行环境无 numpy，脚本在 import 处直接报错退出，不做纯 Python 回退）。

#### 3.1.2 图形标裁剪

1. 在 alpha 通道上只看 `y < WORDMARK_TOP_Y`（常量 `915`：实测字标 bbox 为 `(253,938)-(1002,1111)`，图形标 bbox 为 `(242,175)-(1012,875)`，二者之间有 ~60px 空白，915 落在空白带内）。
2. 取 `alpha > 0.1` 的像素求 bbox。**健全性检查**：算出的 bbox 与期望 `(242,175,1012,875)` 每条边偏差都必须 ≤ 12px，否则 `raise SystemExit` 并打印实测 bbox（防止换了源图却静默产出错位资产）。
3. 以 bbox 较长边 `L` 为基准，方形画布边长 `S = round(L / (1 - 2 * MARK_PADDING_RATIO))`，`MARK_PADDING_RATIO = 0.06`；图形标在画布中水平、垂直居中；画布透明。
4. 用 `Image.Resampling.LANCZOS` 缩放到 1024² 得到 `mark_master`。

#### 3.1.3 各尺寸输出

- PNG：`mark_master.resize((n, n), LANCZOS)`，`optimize=True` 保存。
- **小尺寸锐化**：边长 ≤ 48 的帧在缩放后再做 `ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=0)`，避免 16/24/32px 下丝带发糊。
- **ICO**：先生成每个尺寸各自的 RGBA 帧（含上面的锐化），然后 `frames[-1].save(path, format="ICO", sizes=[(n,n) for n in sizes], append_images=frames[:-1])`（Pillow ≥10.1 在 `append_images` 中找到同尺寸帧时直接使用、不再重采样）。桌面 ICO 尺寸：`16, 20, 24, 32, 40, 48, 64, 128, 256`（覆盖 100%–250% DPI 的任务栏/标题栏/资源管理器）；favicon ICO 尺寸：`16, 32, 48`。
- `desktop/resources/icons/icon.ico` 与 `desktop/assets/icon.ico` 由**同一次 `save` 的字节**写出（先写 assets，再 `shutil.copyfile` 到 resources），保证逐字节一致。
- `public/brand/ecliptrix-logo.png`：源图原样 `shutil.copyfile`（带浅底，深色字标在 GitHub 亮/暗主题下都可读）。
- 脚本结束打印每个输出文件路径与尺寸；另外生成一张**审阅图** `docs/brand/preview.png`（把 16/24/32/48/256 帧分别合成到 `#0b1020` 深底与 `#ffffff` 白底上并排排列），供人工验收抠图质量。该审阅图同样提交。

#### 3.1.4 脚本形态

- 路径：`docs/brand/generate_brand_assets.py`（沿用仓库既有 `docs/generate_logo.py` 放在 docs 下的先例）。
- 运行：仓库根目录 `python docs/brand/generate_brand_assets.py`，无参数；所有路径以 `Path(__file__).resolve().parents[2]` 为仓库根计算，不依赖 cwd。
- 启动即校验 Pillow ≥ 10.1（`ICO` 的 `append_images` 按尺寸取帧自 10.1 起生效；旧版会静默从 256 帧重采样，小尺寸发糊）：不满足时 `raise SystemExit("Pillow>=10.1 required, found …")`（RV-5）。
- 函数划分（均带类型注解，单函数 ≤ 60 行）：`estimate_background(img) -> tuple[int,int,int]`、`color_to_alpha(img, bg) -> Image.Image`、`crop_mark(rgba) -> Image.Image`、`render_png(master, size) -> Image.Image`、`write_ico(master, sizes, path) -> None`、`write_preview(master, path) -> None`、`main() -> None`。

### 3.2 桌面端：exe 图标与任务栏

#### 3.2.1 打开 exe 资源编辑（根因修复）

`desktop/electron-builder.yml`：

```yaml
win:
  target: ...（不变）
  icon: resources/icons/icon.ico
  # rcedit stamps icon + version info into Ecliptrix.exe; without it the exe
  # (and so the taskbar/pinned icon) keeps Electron's default atom. No
  # certificate is configured, so electron-builder still skips the signing
  # half — v1 ships unsigned (spec §7 risk 7), SmartScreen note in README.
  signAndEditExecutable: true

# Win32 LoadImage reads .ico straight from disk and cannot see inside asar,
# so the runtime window icon must live in app.asar.unpacked (spec RV-1).
asarUnpack:
  - assets/icon.ico

nsis:
  ...（原有键不变）
  installerIcon: resources/icons/icon.ico
  uninstallerIcon: resources/icons/icon.ico
  installerHeaderIcon: resources/icons/icon.ico
```

说明：未配置 `CSC_LINK`/`WIN_CSC_LINK` 时 electron-builder 会打印 "no signing info identified, signing is skipped" 并**只做 rcedit**，不会因为缺证书失败。rcedit 来自 `winCodeSign-2.6.0` 缓存，本机 `%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe` 已存在。

#### 3.2.2 新模块 `desktop/main/appIcon.js`（纯函数，不依赖 electron）

```js
'use strict'

const path = require('path')

const APP_ID = 'com.ecliptrix.desktop'

/**
 * Win32 loads .ico via LoadImage on a real disk path, which cannot read
 * inside app.asar; electron-builder's `asarUnpack` puts the file in
 * app.asar.unpacked, so rewrite the path there. No-op in dev (no asar).
 */
function resolveUnpackedPath(filePath) {
  return filePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

// Lives under assets/ (shipped via `files: assets/**`), not resources/,
// which is buildResources and is NOT packaged. Byte-identical copy of
// resources/icons/icon.ico (appIcon.test.js).
const APP_ICON_PATH = resolveUnpackedPath(
  path.join(__dirname, '..', 'assets', 'icon.ico')
)

/**
 * Dev runs get their own AUMID so they never merge into an installed
 * copy's taskbar group.
 */
function resolveAppUserModelId(isDev) {
  return isDev ? `${APP_ID}.dev` : APP_ID
}

module.exports = {
  APP_ID,
  APP_ICON_PATH,
  resolveAppUserModelId,
  resolveUnpackedPath,
}
```

`APP_ID` 必须与 `electron-builder.yml` 的 `appId` 一致（测试校验）。正则只替换第一个 `app.asar` + 分隔符，因此已是 `app.asar.unpacked` 的路径不会被二次改写（`.unpacked` 之后紧跟的不是分隔符）。

#### 3.2.3 `desktop/main/index.js`

在 `const isDev = ...` 之后、`requestSingleInstanceLock()` 之前（模块顶层，早于 `whenReady`，Electron 要求 AUMID 在创建任何窗口前设置）：

```js
const { resolveAppUserModelId } = require('./appIcon')
...
// Must precede any BrowserWindow: ties running windows to the NSIS shortcut's
// AUMID so taskbar pinning/grouping uses our icon (spec brand-logo-refresh §3.2.3).
if (process.platform === 'win32') {
  app.setAppUserModelId(resolveAppUserModelId(isDev))
}
```

并在 `state.logger` 创建并打印启动行（现 `index.js:103`）之后加一处存在性检查（RV-2）。图标缺失不阻止启动——它不影响任何功能——但必须留痕，否则窗口会静默退回默认图标：

```js
const { APP_ICON_PATH } = require('./appIcon')
...
if (!fs.existsSync(APP_ICON_PATH)) {
  state.logger.warn('main', `App icon missing at ${APP_ICON_PATH}`)
}
```

（`index.js` 若尚未引入 `fs`，一并 `require('fs')`。）

#### 3.2.4 `desktop/main/window.js`

- 顶部 `const { APP_ICON_PATH } = require('./appIcon')`。
- `createSplashWindow`、`createMainWindow`、`showErrorWindow` 三个 `new BrowserWindow({...})` 各加一行 `icon: APP_ICON_PATH,`（放在 `width/height` 之后）。
- `appIcon.js` 不 `require('electron')`，保证 `window-state.test.js`（纯 Node 下 `require('./window')`）不受影响。

### 3.3 桌面端：闪屏与 dev 等待页

`desktop/assets/splash.html`：

- `<div class="logo">Ecliptrix</div>` 改为：

```html
<div class="brand">
  <img class="mark" src="brand-mark.png" alt="" width="72" height="72" />
  <div class="logo">Ecliptrix</div>
</div>
```

- 新增 CSS：`.brand { display:flex; flex-direction:column; align-items:center; gap:10px; }`、`.mark { width:72px; height:72px; -webkit-user-drag:none; }`。
- `.logo` 渐变与 spinner 配色改为新 LOGO 色板：文字渐变 `linear-gradient(90deg, #ff8a5c, #7b6cff 50%, #38bdf8)`；spinner `border: 3px solid rgba(56,189,248,0.25); border-top-color: #38bdf8;`。背景渐变保留（深色底与新图形标对比良好）。
- 窗口 420×280：72px 图 + 10px + 30px 文字 + 22px gap + 34px spinner + 状态行 + 提示行 ≈ 240px，仍能放下；实现后需人工目测确认不溢出（`overflow:hidden` 下溢出会被截断而非滚动）。若溢出，把 `.mark` 降到 60px，不改窗口尺寸。

`desktop/assets/dev-waiting.html`：同样结构，`.mark` 用 56px，配色同上（该页 `h1` 的 `#ffd27a` 警示色保持不变）。

`brand-mark.png` 与 html 同在 `desktop/assets/`，`loadFile` 下相对路径直接可用，且 `files: assets/**` 已包含，无需改打包配置。

### 3.4 前端（Next.js）

1. `src/components/shell/AppTitleBar.tsx:92`：`src="/logo-ai.png"` → `src="/brand/ecliptrix-mark.png"`，其余属性不变（18×18，`object-contain`）。256² 源经 next/image 缩放，高 DPI 下清晰。
2. `src/app/icon.png`：由脚本覆盖为 512² 透明图形标（Next App Router 文件约定，自动生成 `<link rel="icon">`）。
3. 新增 `src/app/favicon.ico`（16/32/48），Next 会自动输出 `/favicon.ico`，消除浏览器默认请求 404。
4. `src/app/layout.tsx`：删除 `metadata.icons` 字段（`icons: { icon: '/icon.png' }`）。原因：`public/` 下并无 `icon.png`，该配置引用的是一个不存在的公共路径，当前只是被文件约定覆盖才没出错；保留它会形成"两个概念指同一件事"。
5. 删除 `public/logo-ai.png`（全仓仅 AppTitleBar 与两份 README 引用，均在本方案中改掉）。

### 3.5 文档

- `README.md:2`、`README.zh-CN.md:2`：`src="public/logo-ai.png"` → `src="public/brand/ecliptrix-logo.png"`，`width="200"` → `width="240"`（新图带字标、四周留白更多）。
- `desktop/README.md:222`：`# 应用图标(v1 为脚本生成的占位图标)` → `# 应用图标(由 docs/brand/generate_brand_assets.py 从品牌源图生成)`。
- `desktop/README.md` 打包章节新增「exe 图标（rcedit）」小节（RV-3），内容固定为：① 为什么必须 `signAndEditExecutable: true`（不开则 exe/任务栏为 Electron 原子）；② 首次打包需解压 `winCodeSign-2.6.0`，若报 `Cannot create symbolic link` → 开启 Windows「开发者模式」或以管理员身份跑一次 `npm run build` 填充缓存；③ **禁止**通过改回 `false` 绕过该报错（`appIcon.test.js` 会拦截）；④ 覆盖安装后图标未变 → 先卸载旧版，仍不变执行 `ie4uinit.exe -show`；⑤ 未签名 → SmartScreen 提示（沿用原说明）。
- 删除 `docs/generate_logo.py`（它会把旧 LOGO 写回 `public/logo-ai.png`）。`docs/ecliptrix-logo-philosophy.md` 为旧 LOGO 设计理念，文件开头加一行 `> 已被 docs/brand/（2026-09 新 LOGO）取代，仅作历史参考。`，不删除。
- 新增 `docs/brand/README.md`（≤ 30 行）：说明源图、生成命令、输出清单（即 §3.1 流程图）、"换 LOGO 只需替换源图后重跑脚本并重新打包"。

---

## 4. 文件 / 模块变更计划

| 操作 | 文件 | 意图 |
|------|------|------|
| 新增 | `docs/brand/ecliptrix-logo-source.png` | 品牌唯一源图（从 `docs/plans/brand-logo-refresh/assets/ecliptrix-logo-source.png` 拷贝） |
| 新增 | `docs/brand/generate_brand_assets.py` | 抠图、裁图形标、生成全部尺寸 PNG/ICO 与审阅图 |
| 新增 | `docs/brand/README.md` | 品牌资产说明与再生成方法 |
| 新增 | `docs/brand/preview.png` | 深/浅底多尺寸审阅图（脚本产出） |
| 新增 | `public/brand/ecliptrix-mark.png` | 标题栏用透明图形标 256² |
| 新增 | `public/brand/ecliptrix-logo.png` | README 用完整 LOGO（源图原样） |
| 替换 | `src/app/icon.png` | Next favicon，512² 透明图形标 |
| 新增 | `src/app/favicon.ico` | 16/32/48 favicon |
| 删除 | `public/logo-ai.png` | 旧 LOGO |
| 修改 | `src/components/shell/AppTitleBar.tsx` | 标题栏图片路径换新 |
| 修改 | `src/app/layout.tsx` | 删掉指向不存在路径的 `metadata.icons` |
| 替换 | `desktop/resources/icons/icon.ico` | electron-builder 用的多尺寸新图标 |
| 新增 | `desktop/assets/icon.ico` | 运行时 `BrowserWindow.icon`（与上者逐字节一致） |
| 新增 | `desktop/assets/brand-mark.png` | 闪屏/等待页图形标 256² |
| 新增 | `desktop/main/appIcon.js` | `APP_ID` / `APP_ICON_PATH` / `resolveAppUserModelId` / `resolveUnpackedPath` |
| 新增 | `desktop/main/appIcon.test.js` | 图标文件、ICO 尺寸、一致性、builder 配置、asar 解包路径断言 |
| 修改 | `desktop/main/index.js` | win32 下启动即 `setAppUserModelId`；logger 就绪后图标缺失告警 |
| 修改 | `desktop/main/window.js` | 三个窗口加 `icon: APP_ICON_PATH` |
| 修改 | `desktop/electron-builder.yml` | `signAndEditExecutable: true` + `asarUnpack: [assets/icon.ico]` + NSIS 三个图标键 |
| 修改 | `desktop/assets/splash.html` | 加图形标 + 新色板 |
| 修改 | `desktop/assets/dev-waiting.html` | 加图形标 + 新色板 |
| 修改 | `README.md`、`README.zh-CN.md` | 顶部 LOGO 换新 |
| 修改 | `desktop/README.md` | 图标说明文案 |
| 修改 | `docs/ecliptrix-logo-philosophy.md` | 顶部标注已被取代 |
| 删除 | `docs/generate_logo.py` | 防止旧 LOGO 被误生成回来 |

不改动：后端全部代码、`desktop/scripts/*`（构建脚本无需感知图标）、`package.json`（不新增依赖）。

---

## 5. 接口设计

本需求不涉及 REST / WebSocket 接口变化。唯一新增的"接口"是 CommonJS 模块 `desktop/main/appIcon.js`：

| 导出 | 类型 | 说明 |
|------|------|------|
| `APP_ID` | `string` | `'com.ecliptrix.desktop'`，与 `electron-builder.yml` 的 `appId` 一致 |
| `APP_ICON_PATH` | `string` | dev 下为 `<desktop>/assets/icon.ico`；打包后为 `resources/app.asar.unpacked/assets/icon.ico`（真实磁盘文件，Win32 `LoadImage` 可读；asar 内的 `.ico` 不可读，见 RV-1） |
| `resolveAppUserModelId(isDev: boolean)` | `string` | 生产返回 `APP_ID`，dev 返回 `APP_ID + '.dev'` |
| `resolveUnpackedPath(filePath: string)` | `string` | 把路径中首个 `app.asar<sep>` 改写为 `app.asar.unpacked<sep>`；无 asar 段时原样返回 |

CLI：`python docs/brand/generate_brand_assets.py`（无参数，退出码 0 = 全部产出成功；bbox 健全性检查失败 / 源图缺失 → 非 0 并打印原因）。

静态 URL 变化：新增 `/brand/ecliptrix-mark.png`、`/brand/ecliptrix-logo.png`、`/favicon.ico`；移除 `/logo-ai.png`。

## 6. 数据模型

无数据库变更。资产规格即"数据模型"：

| 资产 | 尺寸 | 模式 | 背景 |
|------|------|------|------|
| `mark_master`（内存） | 1024² | RGBA | 透明，图形标四周 6% 留白 |
| `ecliptrix-mark.png` / `brand-mark.png` | 256² | RGBA | 透明 |
| `src/app/icon.png` | 512² | RGBA | 透明 |
| 桌面 `icon.ico` | 16,20,24,32,40,48,64,128,256 | RGBA（256 帧以 PNG 压缩存储） | 透明 |
| `favicon.ico` | 16,32,48 | RGBA | 透明 |
| `ecliptrix-logo.png` | 1254² | RGB | 源图浅灰底 |

---

## 7. 测试与验收标准

### 7.1 自动化

1. **`desktop/main/appIcon.test.js`**（风格同 `window-state.test.js`：纯 `node` + `assert`，`node main/appIcon.test.js` 运行，末尾打印 `ok`），测试函数各管一个主题：
   - `testIconFileExists`：`APP_ICON_PATH` 存在且以 ICO 头 `00 00 01 00` 开头。
   - `testIconHasTaskbarSizes`：解析 ICONDIR（6 字节头 + 每项 16 字节，宽/高字节 0 表示 256），尺寸集合 ⊇ `{16,24,32,48,256}`。
   - `testBuilderIconMatchesRuntimeIcon`：`resources/icons/icon.ico` 与 `assets/icon.ico` SHA-256 相同。
   - `testBuilderEditsExecutable`：读 `electron-builder.yml` 文本，断言不含 `signAndEditExecutable: false`，且含 `signAndEditExecutable: true`（防止回归根因）。
   - `testAppIdMatchesBuilderConfig`：正则提取 yml 中 `^appId:\s*(\S+)`，等于 `APP_ID`。
   - `testDevAumidIsDistinct`：`resolveAppUserModelId(true) !== resolveAppUserModelId(false)`。
   - `testIconIsUnpackedFromAsar`：yml 的 `asarUnpack` 列表包含 `assets/icon.ico`（RV-1 回归守卫）。
   - `testUnpackedPathRewrite`：`resolveUnpackedPath('C:\\x\\resources\\app.asar\\assets\\icon.ico')` 得到 `…\\app.asar.unpacked\\assets\\icon.ico`；`/` 分隔符同理；无 `app.asar` 段的 dev 路径原样返回；已是 `app.asar.unpacked` 的路径不被二次改写。
   - yml 断言统一用行首锚定正则（如 `/^\s*signAndEditExecutable:\s*true\s*$/m`），避免被注释行命中（RV-8）。
2. `node main/window-state.test.js` 继续通过（`window.js` 新增 require 不得破坏它）。
3. 前端：`npm run type-check`、`npm run lint` 无新增错误；`npx vitest run src/components/shell` 通过。
4. 全仓 `git grep -n "logo-ai"` 除 `docs/plans/` 历史文档外无结果。

### 7.2 生成脚本

- 运行 `python docs/brand/generate_brand_assets.py` 退出码 0；再运行一次，`git status` 显示产物无变化（确定性输出）。
- 打开 `docs/brand/preview.png` 人工检查：深底与白底上图形标边缘无白边/灰边、三角中空区域完全透明、16px 下仍可辨认三角丝带轮廓。

### 7.3 桌面端（必须在打包产物上验收）

1. `cd desktop && npm run build:dir`，构建日志不得出现 rcedit 报错；允许出现 "signing is skipped"。
2. PowerShell 取 exe 图标：`[System.Drawing.Icon]::ExtractAssociatedIcon("desktop/release/win-unpacked/Ecliptrix.exe").ToBitmap().Save("exe.png")`，图片为新三角图形标，**不是** Electron 原子（本方案撰写时的基线即为原子，可对比）。
3. `desktop/release/win-unpacked/resources/app.asar.unpacked/assets/icon.ico` 存在，且与 `desktop/resources/icons/icon.ico` SHA-256 相同；启动打包产物后 `userData/logs` 中**不得**出现 `App icon missing`（RV-1 / RV-2）。
4. `node scripts/smoke-test.js` 通过。
5. `npm run build` 生成 NSIS 安装包：安装包文件图标、安装向导窗口图标、桌面/开始菜单快捷方式、运行后任务栏按钮、右键"固定到任务栏"后的图标、Alt-Tab 缩略图图标均为新 LOGO；卸载程序图标为新 LOGO。
6. 启动闪屏显示 72px 图形标 + 渐变文字，无内容被截断；主窗口标题栏左上角 18px 为新图形标。
7. `npm run dev`（desktop）下任务栏按钮显示新图标（来自 `BrowserWindow.icon`），且不与已安装版本合并为同一任务栏分组。

---

## 8. 风险与缓解

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 打开 `signAndEditExecutable` 后，首次在新机器打包需下载并解压 `winCodeSign-2.6.0.7z`，其中含 darwin 符号链接，在未开启"开发者模式"/非管理员的 Windows 上 7z 解压报 "Cannot create symbolic link"，导致打包失败 | 本机缓存已存在（已验证）。在 `desktop/README.md` 打包章节补一段：遇到该错误时开启 Windows 开发者模式或以管理员身份运行一次 `npm run build` 以完成缓存；不引入 afterPack 自调 rcedit 的旁路方案（多一份自维护代码）。**回退策略**：打包机无法解压缓存时修环境，不得把 `signAndEditExecutable` 改回 `false`（`testBuilderEditsExecutable` 拦截）；该步骤写入 desktop/README「exe 图标（rcedit）」小节（RV-3） |
| R2 | Windows 图标缓存：覆盖安装后任务栏/快捷方式仍显示旧图标 | 验收前先卸载旧版本；仍旧则执行 `ie4uinit.exe -show` 刷新图标缓存。在 desktop/README 的常见问题中记录 |
| R3 | 抠图参数不当：丝带高光（近白青色）被部分透明化，或柔光留下白边 | 反预乘去白边 + `preview.png` 深/浅底人工验收；阈值集中为两个常量便于调参；bbox 健全性检查防止错裁 |
| R4 | 16px 下细节丢失，图形标糊成一团 | 小尺寸独立缩放 + UnsharpMask；ICO 为每个尺寸提供独立帧而非让系统缩放 256 帧 |
| R5 | AUMID 变化导致已固定到任务栏的旧快捷方式与新窗口不再同组 | 之前从未设置 AUMID（旧版分组本就依赖 exe 路径），生产 AUMID 等于 NSIS 快捷方式已写入的 `appId`，属于修正而非变更；用户若有旧固定项，重新固定一次即可 |
| R6 | 闪屏加图后 420×280 窗口内容溢出被截断 | §3.3 已给出尺寸预算与降级规则（`.mark` 降到 60px） |
| R7 | `public/logo-ai.png` 删除后，某处未被 grep 到的引用（如用户已保存的外链）404 | 全仓 grep 仅 3 处引用且均已改；本地桌面应用无外部引用该 URL 的场景 |
| R8 | rcedit 同时写入 exe 版本信息（ProductName/FileDescription 等），改变 exe 属性面板 | 属预期的正向变化；smoke-test 不依赖这些字段 |
| R9 | 新源图非透明、带浅灰底，直接用于深色标题栏会出现浅色方块 | 标题栏、闪屏、ICO、favicon 一律使用抠图后的透明图形标；只有 README 使用带底完整图 |
| R10 | 运行时 `.ico` 位于 asar 内时 Win32 无法加载，窗口图标静默为空 | `asarUnpack` + `resolveUnpackedPath`（§3.2.1/§3.2.2）；启动时缺失告警（§3.2.3）；`testIconIsUnpackedFromAsar` 与 §7.3 第 3 条双重验收 |

---

## 评审结论

**通过**（v2）。

- 根因定位（`signAndEditExecutable: false` 导致 rcedit 未运行、exe 不含品牌图标）与代码现状一致，修复方向正确且范围适度：只动桌面打包配置、三个主进程文件、两张 HTML、一处前端组件与文档，不引入新运行时依赖，不改变 `npm run build` 的依赖面。
- 未发现 P0。3 个 P1（RV-1 asar 内 ICO 不可读、RV-2 图标缺失无信号、RV-3 打包前置条件与回退未文档化）已在正文 §3.2.1 / §3.2.2 / §3.2.3 / §3.5 / §5 / §7 / §8 修订完毕，并各有自动化或打包验收项守护。
- P2 项已修订或在评审记录中给出保留理由，不阻塞实现。
- 实现阶段需注意（非附加条件，已写入正文）：§7.3 桌面验收必须在**打包产物**上完成，`preview.png` 需人工目测抠图质量；两者都不能由单元测试替代。
