# 桌面端：移除重复 Header，将动作按钮并入自绘标题栏

- Feature slug: `desktop-header-into-titlebar`
- 版本：**v2**（已评审，P0/P1 就地修复 — 详见文首「## 评审记录」与文末「## 评审结论」）
- 适用范围：仅桌面端（Electron 打包产物 / `desktop/`）。浏览器端（`npm run dev` / 线上 Web）**稳态**行为与外观保持像素级不变；唯一差异是 Header 由「无条件渲染」改为「水合后渲染」（退出 SSR 首屏输出），仅影响水合前不到一帧的 boot 窗口，详见 §2.2 与评审记录 **P1-1**。
- 关联文档：`docs/plans/desktop-direct-editor-titlebar/spec.md`（第 1 轮：免登录直达 + 自绘标题栏）、`CLAUDE.md`、`desktop/README.md`
- 关联提交：`dd22018e9937eafb1ea829b1578a6f3093caeb44`（第 1 轮产物，本轮在其之上继续）

---

## 评审记录（Review Notes · v2）

> 评审人：Anthropic 工程团队资深评审。维度：**Feasibility**（可行性）/ **Completeness**（完备性）/ **Consistency**（一致性）/ **Right-sizing**（规模合理性）。下列问题按严重度标注，**P0/P1 已就地修复并标 `[已修复]`**；P2 为改进建议（部分就地修复，其余留给 Subtask #2 落地裁量）。最终判定见文末「## 评审结论」。

**总体评价**：方案对现状的核对扎实，评审已逐一复核并确认属实——`Header.tsx` 300 行且内联 `useTheme`、`DesktopTitleBar` 32px(`h-8`) 无 props 且挂载于 `page.tsx`/`login/page.tsx`/`not-found.tsx` 三处、`page.tsx` 的 `ready = hydrated` 闸门与 `showLandingPage` 的 `!isDesktop()` 写法、`src/types/desktop.d.ts` 的 `WebkitAppRegion`/`DesktopWindowControls` 类型扩展、`tailwind.config.js` 的 `border` 色板（故 `bg-border` 合法）、以及所复用的全部 i18n key 均存在。抽出 `HeaderActions` 共享组件、`useTheme` 独立 hook 的方向正确（守住 DRY 与「逻辑单份」），与第 1 轮 R1 的「`ready` 闸门 + 水合后求值 `isDesktop()`」范式一致，规模适中、无明显过度设计。问题主要集中在「对 Web 端零回归的措辞过强」与「新增 Escape 监听作用域未约束」两点，均已就地修复。

### P0（阻断级）

- **无**。方案在当前技术栈下可直接落地：测试运行器（`vitest` + `@testing-library/react` + `jsdom`，见 `package.json` 的 `test` 脚本）、类型扩展（`desktop.d.ts`）、色板 token（`border`）、复用的 i18n key 均已就位并经核实，§6 所述 jsdom 单测可行。

### P1（须修复）

- **P1-1 `[已修复]` · Consistency / Completeness**：文首「像素级不变」与 §1/§7「零 Web 回归」的绝对表述，与本方案实际行为存在内部矛盾。Header 由「无条件渲染」改为 `ready && !isDesktop()` 闸门后，**Web 端首屏 SSR 不再输出 Header，Header 改在水合后渲染**，内容区在水合瞬间随之落定（约 56px 的一帧级 reflow）。§2.2 虽已隐性提及「水合前一帧无 Header」，但与 headline 的绝对保证冲突，会让下游 QA 把这一帧误判为缺陷。**修复**：将「像素级不变」收敛为「**稳态**像素级不变」，并在文首适用范围、§2.2 正确性论证、§7 风险 1/2 精确描述 boot 窗口行为；同时在 §2.2 补充一个可选的「强 SSR 保真」备选（桌面壳在 `preload` 同步给 `<html>` 打 `is-desktop-shell` 标记 + 全局 CSS 隐藏 Web Header），供评审在「与第 1 轮 `ready` 范式一致」与「严格 SSR 一致」之间取舍。
- **P1-2 `[已修复]` · Completeness**：§2.1 新增的「按 `Escape` 关闭下拉」是迁移之外**新增的 Web 行为**，但未约束监听作用域。若该 `keydown` 监听在无下拉打开时也拦截、或调用 `preventDefault`/`stopPropagation`，会吞掉 `LoginModal`、`SetupGuideDialog` 等组件的 Escape，制造新的 Web 回归。**修复**：在 §2.1 明确——**仅当某下拉处于 open 时才处理 Escape**，且**不**调用 `preventDefault`/`stopPropagation`，用 `document` 冒泡阶段监听，下拉关闭后即不再拦截。

### P2（改进建议）

- **P2-1 · Right-sizing**：§2.3d 以 `hasAppActions = !!props.onProfileClick` 隐式判别是否渲染动作簇，契约偏脆弱。当前仅 `page.tsx` 传该回调、可接受；已在 §2.3d 就地补注契约边界（`page.tsx` 为唯一动作提供方；若未来出现多入口，改用显式 `showActions?: boolean`）。
- **P2-2 · Consistency**：`HeaderActions` 的 render 若一次性铺开「语言 + 主题 + 设置 + 用户菜单」四簇 JSX，函数体很可能突破 `CLAUDE.md` 的「单方法 ≤ 50 行」。建议落地时把语言下拉、用户菜单各抽为**同文件内**小组件（不破坏「逻辑单份」）。已在 §8 实施顺序补注。
- **P2-3 · Completeness**：§6 桌面验收对「如何在 `npm run dev` 下用 Electron 验标题栏」语焉不详（是否需整包 `desktop/build.ps1`、或存在 dev-Electron 入口）。已在 §6 补充具体验证指引与降级方案（无 dev-Electron 时以 `win-unpacked` 整包为准）。
- **P2-4 · Feasibility**：§2.1 表格中 `titlebar` 下拉用 `top-full` 锚定的是按钮的 `relative` 包裹层（约 28px 高、居中于 40px 栏），`top-full` 会落在栏内而非栏底，下拉将轻微压住标题栏底缘。已在 §2.3c 补注：实现时让下拉锚定到栏底（包裹层取 `h-full`，或下拉改 `top-[40px]`/`top-full mt-1` 配合 `h-full` 包裹层）。
- **P2-5 · Completeness（可选增强）**：当前下拉为「button + div」，无 `aria-expanded`/`aria-haspopup`/`role="menu"`——与既有 Header 持平（**非回归**）。本轮主打「符合人机交互最佳实践」，建议顺手补 `aria-expanded`/`aria-haspopup` 作为可选增强，不阻断验收。
- **P2-6 · 跨节点提示（非本 spec 缺陷）**：`CLAUDE.md` 约定 commit 前缀为 `[add]/[modify]/[update]/[refactor]/[fix]`，而 Subtask #3 任务卡要求 `feat:` 前缀，二者冲突。留给 Subtask #3 按其任务卡（`feat:`）执行并在提交说明中知会即可。

---

## 1. Overview（概述）

第 1 轮已经让桌面端「双击即用」：主窗口改为无边框（`frame:false`），由 `src/components/desktop/DesktopTitleBar.tsx` 自绘一条 32px 标题栏（左侧 logo + `Ecliptrix` 文本作为拖拽区，最右侧三个窗口控制按钮：最小化 / 最大化-还原 / 关闭）；同时入口 `src/app/page.tsx` 在桌面端跳过着陆页、静默登录后直达视频剪辑工作区。但第 1 轮**保留了原有的 `src/components/Header.tsx`**（高 56px，`h-14`）。于是桌面端顶部同时出现了两条横栏：上面是自绘标题栏（含 logo + 品牌名），下面是 Header（又有一遍 logo + 品牌名 + 副标题，以及语言 / 主题 / 设置 / 用户菜单等动作按钮）。两条横栏的品牌区完全重复，既浪费了约 56px 的纵向空间（对剪辑这种重布局尤其可惜），视觉上也显得臃肿。

本轮目标（用户原话）：「和项目的 header 重复了，现在的 header 在桌面端不需要了，对应的相关设置按钮挪动到现在的新的标题栏上，美观优雅顶级设计，符合人机交互最佳实践」。拆成两件事：其一，**桌面端不再渲染 `Header`**，消除重复的品牌区与多余横栏；其二，把 Header 右侧那一簇**功能动作按钮**（语言切换、明暗主题切换、管理员设置齿轮 + 未配置告警红点、用户头像菜单 → 个人资料 / 账户设置）**迁移到自绘标题栏**，与窗口控制按钮并排，形成一条统一、紧凑、优雅的「命令栏」。浏览器端不受影响：Web 端继续显示完整的 56px Header，标题栏组件在 Web 端仍渲染 `null`。

设计的核心约束沿用第 1 轮的两条铁律：**零 Web 回归** 与 **零 SSR 水合不一致（hydration mismatch）**。所有桌面/浏览器分支一律以运行期 `isDesktop()` 为闸门，且 `isDesktop()` 只允许在「挂载/水合之后」求值（第 1 轮 R1 已踩过坑：`isDesktop()` 在 SSR 期恒为 `false`，若直接写进渲染期分支会导致两端首帧不一致 + 桌面端闪现）。为了避免把 Header 那约 150 行的下拉/主题/点击外关逻辑复制一份到标题栏（违反 `CLAUDE.md` 的 DRY 与「单文件 ≤ 800 行」约定，且会制造维护孤岛），本轮采用**抽出共享组件 `HeaderActions`** 的做法：把动作簇收敛为一个带 `web` / `titlebar` 两种变体的可复用组件，由 Web 端的 `Header` 与桌面端的 `DesktopTitleBar` 各自消费同一份逻辑，从根上保证「Web 与桌面动作行为一致、只是外观容器不同」。

---

## 2. Technical Design（技术方案）

### 2.0 现状梳理（改造前的事实，已逐文件核对）

- `Header.tsx`（300 行）右侧动作簇包含：**语言下拉**（en / zh-CN）、**主题切换**（内联 `useTheme` hook，读写 `localStorage['ecliptrix-theme']` / `ecliptrix-theme-pref` + 切换 `<html>` 的 `dark`/`light` 类）、**设置齿轮**（仅当 `isAuthenticated && canManageUsers && onSettingsClick` 时渲染，带 `showSettingsAttention` 琥珀色脉冲红点）、**用户菜单**（头像 → 下拉：个人资料 / 账户设置 / 登出；桌面端已隐藏登出，未登录时显示「登录/注册」按钮、桌面端亦隐藏）。下拉通过 `mousedown` 点击外关闭；用 `mounted + isDesktop()` 做桌面判定（避免水合不一致）。
- `Header.tsx` 仅在 `src/app/page.tsx` 一处挂载，接收 6 个回调：`onLoginClick / onProfileClick / onSettingsClick / onAccountSettingsClick / onHomeClick / showSettingsAttention`，分别由 `page.tsx` 的弹窗/页面状态（`isLoginModalOpen / isProfileOpen / isSettingsOpen` 等）驱动。
- `DesktopTitleBar.tsx` 当前**无 props**，挂载于三处：`page.tsx`、`src/app/login/page.tsx`、`src/app/not-found.tsx`。它在 `!mounted || !isDesktop()` 时返回 `null`，否则渲染 32px（`h-8`）横栏：左侧品牌（拖拽区 + 双击最大化），右侧三个窗口控制按钮（`no-drag`）。
- `page.tsx` 已用 `hydrated`（来自 `useTasks`）作为闸门：`ready = hydrated`，`showBootPlaceholder = !ready`，且 `showLandingPage = ready && … && !isDesktop()`——即 `isDesktop()` 只在 `ready` 为真（水合后）才被求值，避免 R1。本轮**复用这一既有 `ready` 闸门**来安全地隐藏桌面端 Header。

### 2.1 架构决策：抽出共享动作组件 `HeaderActions`

新增 `src/components/HeaderActions.tsx`（`'use client'`），把 Header 右侧整簇动作（语言 / 主题 / 设置齿轮 / 用户菜单）+ 点击外关逻辑 + 桌面端登录/登出隐藏逻辑全部迁入。Web 端 `Header` 与桌面端 `DesktopTitleBar` 都渲染同一个 `<HeaderActions/>`，仅通过 `variant` 调整尺寸/间距/下拉对齐，**逻辑零分叉**。

同时把 Header 内联的 `useTheme` 抽到独立 hook `src/hooks/useTheme.ts`（单一职责、可复用、压缩文件体积），由 `HeaderActions` 引用。

`HeaderActions` 的 props：

```ts
type HeaderActionsVariant = 'web' | 'titlebar';

interface HeaderActionsProps {
  variant?: HeaderActionsVariant;      // 默认 'web'
  onLoginClick: () => void;
  onProfileClick: () => void;
  onSettingsClick?: () => void;        // 不传则不渲染设置齿轮
  onAccountSettingsClick?: () => void;
  /** LLM 凭证缺失时,在设置齿轮上显示琥珀色脉冲红点 */
  showSettingsAttention?: boolean;
}
```

组件内部（迁移自 Header，行为保持不变）：
- `useLocale()`（语言 + 文案 `t`）、`useAuth()`（`user / isAuthenticated / logout / canManageUsers`）、`useTheme()`（`isDark / toggleTheme`）。
- `mounted`（`useEffect(() => setMounted(true), [])`）+ `isDesktopShell = mounted && isDesktop()`：桌面端隐藏「登录/注册」与用户下拉里的「登出」（沿用第 1 轮 §2.2g，避免「登出 → 自动重登」的怪异观感）。
- 两个 `useRef` + `mousedown` 监听做下拉点击外关闭（语言下拉、用户下拉），与现状一致。
- **新增**：按 `Escape` 键关闭已打开的下拉（HCI 最佳实践，低成本；不破坏点击外关闭）。**作用域约束（P1-2，须遵守）**：该 `keydown` 监听挂在 `document` 的冒泡阶段；**仅当 `isLanguageDropdownOpen || isUserDropdownOpen` 为真时才处理 Escape**（关闭下拉），**不调用 `preventDefault`/`stopPropagation`**——否则会吞掉 `LoginModal`、`SetupGuideDialog` 等组件自身的 Escape 关闭，制造新的 Web 回归。下拉关闭后监听即对 Escape 不再产生副作用。

变体差异（仅样式，不涉及逻辑）：

| 维度 | `web`（容器=Header，h-14） | `titlebar`（容器=标题栏，h-10） |
|---|---|---|
| 簇容器间距 | `space-x-3` | `gap-1`（更紧凑） |
| 图标按钮尺寸 | `w-8 h-8`（图标 `w-4 h-4`） | `w-7 h-7`（图标 `w-4 h-4`，居中） |
| 头像按钮 | `w-8 h-8` 圆 | `w-7 h-7` 圆 |
| 下拉面板对齐 | `absolute right-0 mt-2` | `absolute right-0 top-full mt-1`（紧贴栏底向下展开） |
| 下拉层级 | `z-[10001]`（不变） | `z-[10001]`（标题栏根节点须建立 `relative z-[10000]` 层叠上下文，见 §2.3） |

> 注：`titlebar` 变体仅调整上述 className，**不复制任何下拉/主题/鉴权逻辑**——逻辑只此一份。

### 2.2 需求一：桌面端不再渲染 Header（消除重复，无水合不一致、无闪烁）

**不能**让 `Header` 在桌面端「先渲染再返回 null」——SSR 会把 Web Header 写进首屏 HTML，桌面端 `ready-to-show` 后会**闪现一帧 Header** 再消失（与第 1 轮 R1 同源）。

**做法**：复用 `page.tsx` 既有的 `ready`（= `hydrated`）闸门，把 Header 的渲染条件改为「水合完成 **且** 非桌面端」：

```tsx
// src/app/page.tsx —— 改造后（仅展示 Header 的渲染条件变化）
{ready && !isDesktop() && (
  <Header
    onLoginClick={() => setIsLoginModalOpen(true)}
    onProfileClick={() => setIsProfileOpen(true)}
    onSettingsClick={() => setIsSettingsOpen(true)}
    onAccountSettingsClick={() => {
      setIsSettingsOpen(false);
      setProfileInitialSection('otherSettings');
      setIsProfileOpen(true);
    }}
    onHomeClick={handleReturnHome}
    showSettingsAttention={llmStatus === 'unconfigured'}
  />
)}
```

正确性论证：
- **SSR 与首帧**：`hydrated` 在 SSR 与客户端首帧均为 `false`（`useTasks` 在挂载后的 effect 才置 `true`），故 `ready` 为 `false` → **两端首帧都不渲染 Header**，HTML 一致，无 hydration mismatch。`isDesktop()` 只在 `ready === true`（水合后）才被求值，规避 R1。
- **桌面端**：`ready` 转真后 `!isDesktop()` 恒为 `false` → Header 永不渲染，**不出现重复横栏、无闪现**；动作改由标题栏承载（§2.3）。
- **浏览器端**：`ready` 转真后渲染 Header，与现状一致。**精确行为（P1-1，须知会 QA）**：改造前 Header 是**无条件渲染**、随 SSR 进入首屏 HTML；改造后 Header 受 `ready` 闸门约束，**不再出现在 SSR 首屏**，而在水合后才挂载——此时内容区从「占满整屏的中性占位」让出约 56px 给 Header（一帧级 reflow）。由于 `page.tsx` 现状本就用 `showBootPlaceholder = !ready` 在水合前对内容区渲染**无内容的中性背景**，用户实际感知是「空背景 → (Header + 内容) 同时落定」，没有"既有内容被推走"的可见跳动，与既有引导节奏一致、肉眼不可察。故"零 Web 回归"应理解为**稳态零回归**：稳态（水合后）外观与行为像素级一致，差异仅在水合前不到一帧的 boot 窗口。
  - **可选备选（强 SSR 保真）**：若产品对「Header 必须出现在 SSR 首屏、Web 端零 boot 差异」有硬性要求，可改用标记类方案——桌面壳在 `desktop/preload/preload.js` 于 `document-start` 同步执行 `document.documentElement.classList.add('is-desktop-shell')`，全局 CSS 加 `html.is-desktop-shell .web-header { display: none }`，Header 给 `web` 变体容器加 `web-header` 类。如此 SSR 始终输出 Header（Web 端零 boot 差异、零 CLS），桌面端在首帧前即被 CSS 隐藏（无 R1 闪现）。代价：与第 1 轮 `showLandingPage` 沿用的 `ready && !isDesktop()` JS 范式产生两套隐藏机制、轻微不一致。**本方案默认沿用 `ready` 闸门**（与第 1 轮一致、改动面最小），仅在评审明确要求严格 SSR 一致时启用此备选。

> 说明：第 1 轮的 `Header.tsx` 内部用 `mounted + isDesktop()` 只隐藏了「登录/登出」两项、并未隐藏整条 Header。本轮把「是否渲染整条 Header」的决策上移到 `page.tsx` 的 `ready && !isDesktop()` 闸门；`Header.tsx` 内部不再需要 `isDesktop()` 判定（登录/登出的桌面隐藏逻辑随动作簇一起迁入 `HeaderActions`，由标题栏变体使用）。

### 2.3 需求二：动作按钮并入自绘标题栏

#### (a) 标题栏接收动作 props，并提栏高到 40px

`DesktopTitleBar` 由「无 props」改为可选接收与 Header 同名的动作回调：

```ts
interface DesktopTitleBarProps {
  onLoginClick?: () => void;
  onProfileClick?: () => void;
  onSettingsClick?: () => void;
  onAccountSettingsClick?: () => void;
  showSettingsAttention?: boolean;
}
```

栏高由第 1 轮的 `h-8`（32px）提到 **`h-10`（40px）**。理由：① 32px 内同时塞品牌 + 4 个动作按钮 + 3 个窗口按钮过于拥挤，点击目标偏小；40px 可让动作图标按钮做到 28px（`w-7 h-7`），满足 WCAG 2.5.8（≥24px）并贴近桌面端舒适命中区，符合「人机交互最佳实践」。② 即便提到 40px，仍是「40px 单栏」取代「32px 标题栏 + 56px Header = 88px」的旧双栏，**净省约 48px** 纵向空间，剪辑区更大。③ 40px 是常见 Electron 应用标题栏高度（VS Code/Spotify 量级）。窗口控制按钮保持 `h-full`（即 40px 高）× `w-12`（48px，接近 Windows 11 caption 按钮宽度）。
> 备选：若评审更倾向最小改动、严格沿用第 1 轮 32px，可保留 `h-8` 并把动作按钮压到 `w-6 h-6`（24px，仍满足 WCAG 下限）。本方案以 `h-10` 为准并记录此备选。

#### (b) 标题栏布局（拖拽区 / 动作簇 / 窗口控制 三段）

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [logo Ecliptrix] ←drag→ [   弹性 spacer (drag)   ] | 语言 主题 ⚙ 头像 | ─ │ □ │ ✕ │
│  品牌(drag,双击最大化)         可拖拽抓取区          no-drag 动作簇   分隔  窗口控制(no-drag) │
└────────────────────────────────────────────────────────────────────────────┘
```

- **左侧品牌**：沿用第 1 轮——`WebkitAppRegion:'drag'`，`onDoubleClick` 切换最大化。
- **中部 spacer**：`flex-1` 且属于拖拽区（`drag`），给用户一大片可抓取移动窗口的区域（HCI：标题栏应有充足拖拽面积）。
- **右侧 no-drag 区**（一个 `WebkitAppRegion:'no-drag'` 容器，内含三组）：
  1. `<HeaderActions variant="titlebar" .../>`——仅当**提供了动作 props 时**才渲染（见 §2.3d 的 `hasAppActions` 闸门）。
  2. **分隔符**：`<span className="w-px h-5 bg-border mx-1" aria-hidden="true" />`——在「应用命令」与「窗口命令」之间做视觉分组（HCI：功能分区）。
  3. **窗口控制按钮**：沿用第 1 轮的最小化 / 最大化-还原 / 关闭（含 `onMaximizeChange` 订阅、`isMax` 图标切换、关闭键 `hover:bg-red-600`）。

> ⚠️ 拖拽/点击规则（务必遵守）：整个右侧动作 + 窗口控制区必须 `WebkitAppRegion:'no-drag'`，否则按钮与下拉点不动（Electron 中 `drag` 区域不可靠地接收鼠标事件）。下拉面板须渲染在该 no-drag 子树内，方可点击其菜单项。

#### (c) 标题栏建立层叠上下文，保证下拉浮于内容之上

标题栏是 `page.tsx` 根 `div`（`h-screen flex flex-col overflow-hidden`）的第一个 flex 子节点。语言/用户下拉为 `absolute` 向下展开、会盖到下方内容区。需：
- 标题栏根节点加 `relative z-[10000]`（与原 Header 同级别），下拉面板用 `z-[10001]`（与原 Header 下拉同级别），确保压过内容区可能存在的层叠上下文。
- 外层 `overflow-hidden` 只裁剪超出**整屏**的内容；下拉位于 40px 栏正下方、仍在视口内，不会被裁剪。
- **下拉锚点（P2-4）**：`titlebar` 变体下拉的定位上下文是按钮的 `relative` 包裹层（约 28px 高、居中于 40px 栏），若直接 `top-full` 会落在栏内、轻微压住栏底缘。实现时让下拉锚定到**栏底**：给该 `relative` 包裹层加 `h-full`（撑满 40px，`top-full` 即落在栏正下方），或下拉显式用 `top-[40px]`；再以 `mt-1` 留出与栏底的呼吸缝隙。

#### (d) `HeaderActions` 的渲染闸门（区分主页面与兜底路由）

`login/page.tsx`、`not-found.tsx` 也挂 `<DesktopTitleBar/>`，但它们**没有** `isSettingsOpen/isProfileOpen` 等弹窗状态、也无处打开设置/资料。故标题栏内只有「提供了动作 props」时才渲染动作簇：

```tsx
const hasAppActions = !!props.onProfileClick;   // page.tsx 才传,兜底路由不传
…
{hasAppActions && (
  <HeaderActions
    variant="titlebar"
    onLoginClick={props.onLoginClick!}
    onProfileClick={props.onProfileClick!}
    onSettingsClick={props.onSettingsClick}
    onAccountSettingsClick={props.onAccountSettingsClick}
    showSettingsAttention={props.showSettingsAttention}
  />
)}
```

> **契约边界（P2-1）**：`hasAppActions` 用 `!!props.onProfileClick` 作隐式判别，成立的前提是「`page.tsx` 是唯一传动作回调的调用方，兜底路由零 props 挂载」——当前事实如此，可接受。若未来出现第二个传部分回调的调用方，应改用显式的 `showActions?: boolean` prop 以免误判。

于是：**主页面**标题栏 = 品牌 + 动作簇 + 分隔符 + 窗口控制；**兜底路由（login/404）** 标题栏 = 品牌 + 窗口控制（无动作簇），保持最小可用（仍可拖拽/最小化/关闭）。`login/page.tsx`、`not-found.tsx` 文件**无需改动**（它们已无 props 地挂载标题栏，新增的栏高 40px 由其 flex 布局自适应）。

#### (e) `page.tsx` 把动作 props 透传给标题栏

`DesktopTitleBar` 仍作为根 `div` 的**首个子节点无条件挂载**（它自身在 Web 端/挂载前返回 `null`，自带闸门），但补齐动作 props——与传给 `Header` 的同源：

```tsx
<DesktopTitleBar
  onLoginClick={() => setIsLoginModalOpen(true)}
  onProfileClick={() => setIsProfileOpen(true)}
  onSettingsClick={() => setIsSettingsOpen(true)}
  onAccountSettingsClick={() => {
    setIsSettingsOpen(false);
    setProfileInitialSection('otherSettings');
    setIsProfileOpen(true);
  }}
  showSettingsAttention={llmStatus === 'unconfigured'}
/>
```

桌面端这些回调驱动同一套弹窗（`AdminSettingsPage` / `UserProfilePage` / `LoginModal`）；Web 端标题栏渲染 `null`，回调被忽略，零影响。

#### (f) Header 瘦身为「品牌 + 共享动作簇」

`Header.tsx` 改造后只剩：左侧品牌（保留 `onHomeClick` 点击回主页，Web 端语义不变）+ 右侧 `<HeaderActions variant="web" …/>`。删除内联的语言/主题/设置/用户下拉代码与内联 `useTheme`（改由 `HeaderActions` 承载）。Header 不再需要 `isDesktop()` 相关分支（整条 Header 是否渲染已由 `page.tsx` 决定）。改造后 `Header.tsx` 预计从 300 行降至 ~80 行。

> **桌面端「品牌→回主页」的取舍（HCI）**：标题栏左侧品牌是**拖拽区**，单击在 Electron 拖拽区不可靠（OS 接管），不宜在其上挂单击「回主页」。故桌面端不在标题栏品牌上提供「回主页」；该能力在桌面端仍可经左侧 `VerticalTaskbar` 关闭标签到空态达成，且桌面端启动即自动开 video 任务、对「回主页」诉求弱。此为有意的 HCI 取舍，记录在 §7 风险 6。如评审坚持保留显式入口，可在动作簇最左加一个 `no-drag` 的「Home」图标按钮（可选，低成本）。

### 2.4 时序（桌面端首启，改造后）

1. 主进程创建无边框窗口（第 1 轮），渲染进程加载本地 Next.js 页面。
2. SSR 首屏：`hydrated=false` → `page.tsx` 渲染中性 boot 占位、**不渲染 Header**；`DesktopTitleBar` 在 SSR/首帧返回 `null`。两端首帧一致。
3. 挂载后：`DesktopTitleBar` 的 `mounted` 置真 → 渲染 40px 标题栏（窗口控制即刻可用，含动作簇——其条件子项随鉴权 resolve 逐步出现）。`useTasks` 的 `hydrated` 置真 → `ready=true`，桌面端因 `!isDesktop()===false` **不渲染 Header**；内容区从 boot 占位切到剪辑工作区（第 1 轮静默登录 + 自动开 video 任务）。
4. 用户在标题栏点语言/主题/设置/头像，行为与原 Header 完全一致（共用 `HeaderActions`）。

---

## 3. File / Module Change Plan（文件 / 模块变更计划）

| 文件 | 动作 | 一句话意图 |
|---|---|---|
| `src/hooks/useTheme.ts` | 新建 | 抽出 Header 内联的明暗主题切换 hook（读写 `ecliptrix-theme`/`-pref` + 切 `<html>` 类），供共享动作组件复用 |
| `src/components/HeaderActions.tsx` | 新建 | 共享动作簇：语言 / 主题 / 设置齿轮(含告警红点) / 用户菜单 + 点击外关 + 桌面隐藏登录登出；`web`/`titlebar` 双变体，逻辑单份 |
| `src/components/Header.tsx` | 修改 | 瘦身为「品牌 + `<HeaderActions variant='web'/>`」；删内联动作代码与内联 `useTheme`；移除不再需要的 `isDesktop()` 分支 |
| `src/components/desktop/DesktopTitleBar.tsx` | 修改 | 新增动作 props；栏高 32px→40px；中部加可拖拽 spacer；窗口控制左侧渲染 `<HeaderActions variant='titlebar'/>` + 分隔符；根节点 `relative z-[10000]` |
| `src/app/page.tsx` | 修改 | Header 渲染条件改为 `ready && !isDesktop()`（桌面端不渲染，消重复，无水合不一致）；把动作 handler 透传给 `<DesktopTitleBar/>` |
| `src/app/login/page.tsx` | 不改（仅回归验证） | 仍无 props 挂载标题栏（仅窗口控制）；新栏高 40px 由 flex 自适应 |
| `src/app/not-found.tsx` | 不改（仅回归验证） | 同上 |
| `src/lib/i18n.ts` | 仅在需要时改 | 本方案复用既有 `t.header.* / t.adminSettings.* / t.setupGuide.* / t.auth.*`，**不新增** key；若实现中确需新 tooltip，须同时补 en 与 zh-CN |

> 不改任何后端文件、不改 preload/主进程 IPC（窗口控制与 bootstrap 凭证沿用第 1 轮）。

---

## 4. Interface Design（接口设计）

本轮无 REST / WebSocket / IPC 改动，仅前端组件接口（React props）：

**`HeaderActions`（新建）**
```ts
type HeaderActionsVariant = 'web' | 'titlebar';
interface HeaderActionsProps {
  variant?: HeaderActionsVariant;        // 默认 'web'
  onLoginClick: () => void;
  onProfileClick: () => void;
  onSettingsClick?: () => void;
  onAccountSettingsClick?: () => void;
  showSettingsAttention?: boolean;        // 默认 false
}
```

**`DesktopTitleBar`（由无 props → 可选动作 props）**
```ts
interface DesktopTitleBarProps {
  onLoginClick?: () => void;
  onProfileClick?: () => void;
  onSettingsClick?: () => void;
  onAccountSettingsClick?: () => void;
  showSettingsAttention?: boolean;
}
```
- 兼容性：所有 props 可选；`login/page.tsx`、`not-found.tsx` 的 `<DesktopTitleBar/>`（零 props）调用保持有效（仅渲染品牌 + 窗口控制）。

**`useTheme`（新建 hook）**
```ts
function useTheme(): { isDark: boolean; toggleTheme: () => void };
```

**`Header`（props 不变）**：`onLoginClick / onProfileClick / onSettingsClick? / onAccountSettingsClick? / onHomeClick? / showSettingsAttention?`——签名保持向后兼容，内部委托给 `HeaderActions`。

> 命名遵循 `CLAUDE.md`：公开 API 用 `interface`；布尔以 `is/has/should` 起头（`isDark`/`isDesktopShell`/`hasAppActions`）；动作回调动词起头（`onSettingsClick`/`toggleTheme`）。

---

## 5. Data Model（数据模型）

无数据库 schema 变更。涉及的内存 / 持久化形状（均沿用现状）：

- **主题偏好**（`useTheme` 读写，不改键名）：`localStorage['ecliptrix-theme']`（`'dark'|'light'`）与 `localStorage['ecliptrix-theme-pref']`；同时切换 `document.documentElement` 的 `dark`/`light` 类与 `style.colorScheme`。
- **语言**：经 `useLocale()`（`LocaleContext`），不改。
- **会话/用户**：经 `useAuth()`（`localStorage['ecliptrix-user']` / `['ecliptrix-session-token']`），不改。
- **组件内存态**：`HeaderActions` 内 `isLanguageDropdownOpen / isUserDropdownOpen / mounted`（boolean）；`DesktopTitleBar` 内 `mounted / isMax`（boolean）。
- **LLM 配置告警**：`showSettingsAttention`（boolean，源自 `page.tsx` 的 `llmStatus === 'unconfigured'`），透传至两处动作簇的设置齿轮红点，不改。

---

## 6. Testing & Acceptance Criteria（测试与验收）

### 单元/逻辑测试
- `useTheme`：初始读取 `<html>` 是否含 `dark` 类；`toggleTheme()` 后类与 `localStorage` 两键被正确切换（jsdom）。
- `HeaderActions`：
  - `variant='web'`（默认）渲染语言/主题/用户菜单；`onSettingsClick` 提供 + `isAuthenticated && canManageUsers`（mock `useAuth`）时渲染设置齿轮，`showSettingsAttention` 为真时出现脉冲红点。
  - 桌面端（mock `isDesktop()=true` + mount）：不渲染「登录/注册」与下拉里的「登出」。
  - 点击外部 / 按 `Escape` 关闭打开的下拉。
- `DesktopTitleBar`：`!isDesktop()` 返回 `null`（Web 零影响）；桌面端提供动作 props 时渲染动作簇，零 props（兜底路由）时仅渲染窗口控制。
- 回归：`useTasks` 现有持久化测试不受影响（本轮未触 `useTasks`）。

### 手动/集成验收

> **验证路径（P2-3，已核实）**：桌面端无需每次整包即可验标题栏——`desktop/package.json` 提供 `dev` 脚本（`electron . --dev`，加载 `http://localhost:3000`，见 `desktop/main/index.js:18-19,105`）。
> - **首选（快速回路）**：仓库根 `npm run dev`（Next 起在 :3000）→ 另开终端 `cd desktop` 后 `npm run dev`（无边框 Electron 壳加载 :3000，`window.ecliptrixDesktop` 由 preload 注入，`isDesktop()` 为真）。可验下方 1–5 项标题栏/动作/拖拽逻辑。
> - **整包回归**：涉及静默登录/打包路径的端到端项，以 `desktop/build.ps1`（或 `npm run build:dir`）产出的 `win-unpacked` 为准。
> - **Web 零回归（第 6 项）**：仅 `npm run dev` 用浏览器访问 `/`（不启 Electron），`isDesktop()` 恒假。
1. **桌面端无重复 Header**：启动后顶部**只有一条 40px 标题栏**，无下方 56px Header、无重复 logo/品牌；splash 关闭瞬间不闪现 Header（无 hydration mismatch 告警）。
2. **动作迁移到位**：标题栏右侧（窗口控制左侧）依次出现 语言 / 主题 / 设置齿轮（管理员可见，含未配置红点）/ 用户头像；点击行为与原 Header 一致——语言切换、主题明暗切换、设置齿轮打开 `AdminSettingsPage`、头像菜单打开个人资料 / 账户设置；桌面端**无登出、无登录**入口。
3. **下拉浮层正确**：语言/用户下拉在标题栏正下方展开、压过内容区、点击菜单项生效、点击外部或按 Escape 收起、不被 `overflow-hidden` 裁剪。
4. **拖拽与窗口控制不受影响**：品牌区与中部空白可拖动窗口；动作按钮与三个窗口按钮均可点击（`no-drag`）；双击品牌切换最大化；最小化/最大化-还原/关闭正常，最大化图标随状态切换。
5. **兜底路由可用**：`/login`、`/404` 标题栏为「品牌 + 窗口控制」（无动作簇），仍可拖拽/最小化/关闭。
6. **浏览器零回归**：`npm run dev`（无 Electron）下 `/` 水合后显示**完整 56px Header**（语言/主题/设置/用户菜单、未登录显示登录按钮、登录后可登出），外观与改造前一致；页面顶部**无**自绘标题栏；无水合告警。

### 验收门槛
- `npm run type-check`、`npm run lint` 全绿（新文件无新增 warning/error；`HeaderActions` 复用第 1 轮已声明的 `WebkitAppRegion` 类型扩展）。
- `desktop/scripts/smoke-test.js` 仍通过（本轮不触后端与登录链路，预期不受影响；落地后回归确认）。
- Web 端 `Header` 视觉对比无差异（建议截图对照改造前后）。

---

## 7. Risks & Mitigations（风险与缓解）

1. **SSR 水合不一致 / 桌面端 Header 闪现**：Header 渲染条件用 `ready(=hydrated) && !isDesktop()`，`isDesktop()` 只在水合后求值，两端首帧（均 `ready=false`）都不渲染 Header → 无 mismatch、桌面端无闪现（沿用第 1 轮 R1 的修复范式）。
2. **共享重构引入 Web 回归**：`HeaderActions` 必须 1:1 迁移原 Header 动作逻辑（文案 key、条件、下拉、主题、登出隐藏），`web` 变体样式与原值逐一对齐；以「改造前后 Web 截图对照 + 单测」守门。**两处需特别守门（P1-1 / P1-2）**：① Header 退出 SSR 首屏、改为水合后渲染，属"稳态零回归、boot 期一帧差异"（详见 §2.2），QA 应以**稳态**截图对照、勿把 boot 帧当回归；如需严格 SSR 一致改用 §2.2 备选。② 新增的 Escape 关闭下拉是**有意的增强**，须按 §2.1 约束作用域（仅 open 时处理、不 `preventDefault`/不阻断冒泡），确保不影响 `LoginModal` 等既有 Escape 行为——故本轮 Web 端是"零回归 + 一处有意增强"。
3. **标题栏下拉被裁剪 / 被内容盖住**：标题栏根 `relative z-[10000]`、下拉 `z-[10001]`；下拉置于 `no-drag` 子树内；`overflow-hidden` 仅裁超出整屏者，下拉在视口内不受影响。
4. **拖拽区吞掉点击**：右侧动作 + 窗口控制整体 `no-drag`，品牌与中部 spacer 为 `drag`；下拉面板在 no-drag 子树内，菜单项可点。
5. **栏高变化的连带影响**：栏高 32px→40px 同时作用于 `page.tsx`/`login`/`not-found` 三处标题栏；三者均为 flex 列布局（`flex-1` 内容自适应），不会溢出；`page.tsx` 旧的「32+56」纵向占用降为「40」，剪辑区更大。若评审要求严格沿用 32px，可按 §2.3a 备选保留 `h-8` + 24px 按钮。
6. **桌面端失去「品牌→回主页」入口**：标题栏品牌是拖拽区不宜挂单击；桌面端「回主页/清空」仍可经 `VerticalTaskbar` 关标签达成，且启动即自动开任务、诉求弱（§2.3f 已说明）。如需显式入口，可在动作簇最左加一个 `no-drag` Home 图标按钮（可选）。
7. **`HeaderActions` 在 `titlebar` 变体下的鉴权时机**：桌面端静默登录（第 1 轮）resolve 前 `isAuthenticated/canManageUsers` 可能短暂为假，设置齿轮/头像随之延迟出现——与 Web 端「未登录时不显示这些项」行为一致，属预期，非缺陷。
8. **i18n 漏字**：本方案不新增 key；若实现中临时加 tooltip，须同步补 `en` 与 `zh-CN`，避免某语言缺字（沿用 `src/lib/i18n.ts` 单文件约定）。
9. **跨平台**：本期仅 Windows；标题栏按钮顺序按 Windows（窗口控制在最右）。macOS 的 trafficLight 布局与第 1 轮一样不在本期范围。

---

## 8. 实施顺序建议（给下游开发 Subtask #2）

1. 抽 `src/hooks/useTheme.ts`（从 Header 原样搬运逻辑，先保证 Web 主题切换无回归）。
2. 新建 `src/components/HeaderActions.tsx`：迁移语言/主题/设置/用户菜单 + 点击外关 + Escape 关闭（按 §2.1 P1-2 约束作用域）+ 桌面登录登出隐藏；实现 `web`/`titlebar` 两变体样式。**（P2-2）** 若主 render 函数因四簇 JSX 逼近/突破 `CLAUDE.md` 的「单方法 ≤ 50 行」，把语言下拉、用户菜单各抽为**同文件内**的小组件（如 `LanguageMenu`/`UserMenu`），保持「逻辑单份」的同时压低单方法行数。
3. 改 `Header.tsx`：仅留品牌 + `<HeaderActions variant='web'/>`，删内联动作与 `useTheme`；本地 `npm run dev` 对照 Web 端外观/行为无差异。
4. 改 `DesktopTitleBar.tsx`：加动作 props、栏高 40px、中部 spacer、右侧 `HeaderActions(titlebar)` + 分隔符 + 窗口控制；根节点 `relative z-[10000]`。
5. 改 `page.tsx`：Header 渲染条件改 `ready && !isDesktop()`；给 `<DesktopTitleBar/>` 透传动作 props。
6. 跑 `type-check`/`lint` + 单测；对 `win-unpacked` 走 §6 桌面验收，`npm run dev` 走 §6 Web 零回归与兜底路由验收；Web Header 截图对照。

---

## 评审结论（Review Verdict）

**有条件通过（Approved with Conditions）。**

方案的技术判断正确、与第 1 轮 R1 范式一致、规模适中无过度设计，对现状的事实核对经评审逐项复核属实（见「评审记录·总体评价」）。**所有 P0/P1 已在本 v2 文档内就地修复**，无遗留 P0/P1。下游 Subtask #2 落地时须满足以下条件（均已写入正文，列此便于核对）：

1. **（源自 P1-1）** Header 按 §2.2 用 `ready && !isDesktop()` 闸门；接受并向 QA 知会 Web 端「Header 水合后落定」的一帧级 boot 行为（已与既有 `showBootPlaceholder` 节奏对齐），验收以**稳态**截图对照。如产品对严格 SSR 一致有硬性要求，再启用 §2.2 的 `is-desktop-shell` + CSS 备选。
2. **（源自 P1-2）** `HeaderActions` 的 Escape 监听严格按 §2.1 约束：**仅下拉 open 时处理、不 `preventDefault`、不阻断冒泡**，确保不干扰 `LoginModal`/`SetupGuideDialog` 等既有 Escape 行为。
3. **（验收门槛）** `npm run type-check` 与 `npm run lint` 全绿；Web 端 Header 改造前后稳态截图对照无差异；桌面端按 §6 完成「无重复 Header / 动作迁移到位 / 下拉浮层正确 / 拖拽与窗口控制 / 兜底路由可用 / 浏览器零回归」六项。

P2 项（P2-1…P2-6）为质量改进，**建议落地**（尤其 P2-2 的方法拆分与 P2-4 的下拉锚点），但不作为通过门槛。

— 评审完成，文档版本升至 **v2**。
