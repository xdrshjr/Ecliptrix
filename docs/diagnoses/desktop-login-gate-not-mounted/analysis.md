# 桌面端强制登录闸门未生效 —— 问题定位与分析 (analysis.md)

> Bug slug: `desktop-login-gate-not-mounted`
> Round: 第 2 轮（BUG 修复）— Subtask #0「问题定位与分析」产出
> 关联设计: `docs/plans/desktop-root-admin-login-gate/spec.md`（第 1 轮方案，v2 已评审通过）
> Author: Senior Debugging Engineer (Anthropic engineering)
> Status: 已定位根因（含代码证据）+ 候选修复对比 + 推荐方案
> 本节点约束: **不写修复代码、不 `git commit`**（修复交由 Subtask #2）。

---

## 1. 问题描述（Problem Description）

用户反馈（第 2 轮需求原文）：

> 没修改好，桌面端打开，没有先显示登录窗口，让进行登录，而是直接进入到了程序中，导致没有登录信息，无法使用。

即第 1 轮的目标——「打包后的桌面端启动时**先弹出强制登录界面**，用户输入 `admin/adminjr` 登录后才进入应用」——**没有生效**。实际表现是：

1. 桌面端冷启动后**不显示任何登录界面**；
2. 应用主体（标题栏 + 编辑器工作区）**直接渲染**出来；
3. 此时**没有任何登录态 / 会话凭证**（`isAuthenticated=false`、localStorage 无 `ecliptrix-session-token`）；
4. 后续任何需要鉴权的后端请求都会失败（401），用户「无法使用」。

第 1 轮的方案文档（`spec.md`）设计了 `AuthGate` + `LoginScreen` 强制闸门，并要求**删除桌面端的静默自动登录**。本轮 Bug 的本质是：**方案只落地了一半**——闸门组件被创建了，静默登录被删除了，但「把闸门接到应用入口」这一步**从未执行**，导致桌面端既不自动登录、也不显示登录界面，落入「无人值守的未认证」空档。

---

## 2. 复现步骤（Reproduction Steps）

### 2.1 最快复现（源码层，无需打包）

无需打包桌面端即可在源码层证明闸门缺失：

```bash
# 1. 在仓库根目录搜索 AuthGate 的"使用点"（而非定义）
cd M:/takoAI/Ecliptrix
grep -rn "AuthGate" src/ | grep -v "AuthGate.tsx"
# 预期输出：只有 2 行，且都在 src/contexts/AuthContext.tsx 的【注释】里
#   src/contexts/AuthContext.tsx:218: ... The desktop login gate (AuthGate → LoginScreen) surfaces
#   src/contexts/AuthContext.tsx:268: ... AuthGate surface the LoginScreen in place (spec §2.4).
# —— 没有任何 import / <AuthGate> 的真实渲染。

# 2. 确认应用入口 page.tsx 未引用 AuthGate
grep -n "AuthGate\|auth/LoginScreen" src/app/page.tsx
# 预期输出：空（page.tsx 根本没引入闸门）

# 3. 确认新建的闸门文件处于"未跟踪"状态（说明集成步从未提交/接线）
git status --short src/components/auth/ src/app/page.tsx
# 预期输出：
#   ?? src/components/auth/        ← 整目录未跟踪（新文件存在但未接线）
#   （page.tsx 不在列表里 = 未被改动）
```

### 2.2 端到端复现（打包桌面端）

1. 用第 1 轮之后、第 2 轮之前的代码打包/运行桌面端（`npm run dev` 走 Electron，或运行打包后的 `.exe`）。
2. 等待 splash → 主窗口加载 `http://127.0.0.1:<frontendPort>/`（即 `/` 路由，对应 `src/app/page.tsx`，见 `desktop/main/index.js:153`）。
3. **观察**：窗口直接出现应用界面（标题栏 + 空白编辑器/容器），**没有任何登录界面**。
4. 打开 DevTools，在 Console 执行 `localStorage.getItem('ecliptrix-session-token')` → 返回 `null`（无会话）。
5. 触发任意需要鉴权的操作（如打开工程列表 / 调用后端 API）→ 返回 401 / `MissingAuthError`，功能不可用。

> 说明：`npm run dev` 与打包端都走同一个 `/` 路由与同一份 `page.tsx`，因此源码层复现（2.1）与端到端复现（2.2）指向同一缺陷，2.1 已足够证明根因，无需打包即可定位。

---

## 3. 根因分析（Root Cause Analysis，含证据）

### 3.1 一句话根因

> **第 1 轮创建了 `AuthGate` / `LoginScreen` / `useLoginForm` 三个新组件、并从 `AuthContext` 删除了静默自动登录，但唯独漏掉了「集成」这一步——`<AuthGate>` 从未被 `import` 进 `src/app/page.tsx`（也未进 `src/app/login/page.tsx`）。结果：桌面端启动后没有静默登录（已删），也没有登录闸门（没接线），直接渲染未认证的应用主体。**

这是一个典型的「组件已造好，但没装到墙上」的**集成缺口（integration gap）**，而非组件本身的逻辑错误。

### 3.2 证据链

**证据 A — `AuthGate` 在全代码库只出现在注释里，零真实使用：**

`grep -rn "AuthGate" src/`（排除定义文件 `AuthGate.tsx` 自身）只命中两处，且**都是注释**：

- `src/contexts/AuthContext.tsx:218`
  ```
  // platform. The desktop login gate (AuthGate → LoginScreen) surfaces
  ```
- `src/contexts/AuthContext.tsx:268`
  ```
  // AuthGate surface the LoginScreen in place (spec §2.4).
  ```

注释信誓旦旦地说「AuthGate 会原地浮现登录界面」，但**没有任何文件 import 或渲染 `<AuthGate>`**——这个「会浮现」的前提从未成立。

**证据 B — 应用入口 `src/app/page.tsx` 直接渲染应用主体，无任何闸门：**

`src/app/page.tsx:133-249` 的 `return` 结构为：

```tsx
return (
  <div className="h-screen flex flex-col ...">
    <DesktopTitleBar .../>                {/* page.tsx:137 —— 页级标题栏，无条件渲染 */}
    {ready && !isDesktop() && <Header .../>}
    <div className="flex-1 flex overflow-hidden">
      {showBootPlaceholder ? <.../> : (
        <>
          {!showLandingPage && <VerticalTaskbar .../>}
          ...
          <Container .../>               {/* 直接渲染编辑器/容器，未经任何认证闸门 */}
        </>
      )}
    </div>
    <LoginModal isOpen={isLoginModalOpen} .../>   {/* page.tsx:234 —— 仍是 Web 端"按钮触发"的可关闭弹窗，默认 isOpen=false */}
  </div>
);
```

- `page.tsx` 全文**没有** `import AuthGate`、也**没有** `<AuthGate>`。
- 它对未认证状态**毫无保护**：`isAuthenticated` 仅用于 `didAutoOpenRef`（`page.tsx:45-51`）和 `showLandingPage`/`showSetupGuide` 等分支，**没有任何分支会在桌面端未认证时拦截渲染并显示登录界面**。
- 桌面端 `showLandingPage = ready && tabs.length===0 && ... && !isDesktop()`（`page.tsx:100-101`）因 `!isDesktop()` 恒为 `false`，所以桌面端**连着陆页都不显示**，直接落到 `<Container>` 分支——「直接进入程序」由此而来。
- 仅有的登录入口 `LoginModal`（`page.tsx:234-237`）受 `isLoginModalOpen` 控制、默认 `false`、且**仅由 Header/标题栏按钮点击触发**，桌面端启动时不会自动打开——所以「没有先显示登录窗口」。

**证据 C — `AuthContext` 已删除静默自动登录，未认证时直接落定 `unauthenticated`：**

`src/contexts/AuthContext.tsx:216-231`（挂载时的会话引导逻辑）：

```ts
} else {
  // Stored session is invalid — settle to unauthenticated on every
  // platform. The desktop login gate (AuthGate → LoginScreen) surfaces
  // in place; there is no silent auto-login any more (spec §2.2/§2.3).
  setAuthState({ user: null, isAuthenticated: false, isLoading: false, sessionToken: null });
}
...
} else {
  // No stored session — land unauthenticated. On desktop this is what
  // raises the mandatory login gate; on web it shows the landing page.
  setAuthState(prev => ({ ...prev, isLoading: false }));
}
```

静默登录确实已按 `spec.md` §3 #5 删除（`isLoading` 明确置 `false`，落到 `unauthenticated`）。**这一半是对的**——它本应把控制权交给 `AuthGate`。但因为证据 B（`AuthGate` 没接线），「raises the mandatory login gate」这件事**没有任何代码去执行**。两半合起来恰好制造了空档：**既不自动登录，也无闸门拦截**。

会话过期路径同理：`AuthContext.tsx:269-291` 监听 `ecliptrix:session-expired`，清空 `isAuthenticated`（注释 `:267-268` 说「lets AuthGate surface the LoginScreen in place」），但 `AuthGate` 不存在于渲染树，过期后同样无界面浮现。

**证据 D — Git 状态印证「只落地一半」的不对称：**

```
git status --short  →
   M src/contexts/AuthContext.tsx     ← 修改了（删静默登录），已落地
  ?? src/components/auth/             ← 整目录未跟踪：AuthGate.tsx / LoginScreen.tsx / useLoginForm.ts 是新文件
  （src/app/page.tsx 不在变更列表 = 完全未改动）
  （src/app/login/page.tsx 不在变更列表 = 完全未改动）
```

`AuthContext.tsx` 被改、闸门组件被新建，但**集成它们的 `page.tsx` 一字未动**——这个不对称正是「集成缺口」的指纹。第 1 轮的任务记录也写明「(无 git 提交记录)」，说明第 1 轮工作**未提交**，集成步在收尾时被遗漏。

**证据 E — 桌面窗口加载的就是 `/` 路由（= page.tsx）：**

`desktop/main/index.js:153`：

```js
createMainWindow(`http://127.0.0.1:${state.frontendPort}`)
```

主窗口加载 `http://127.0.0.1:<port>/`（根路由），Next.js App Router 用 `src/app/page.tsx` 渲染该路由。因此「桌面端打开看到的界面」就是证据 B 里那个**无闸门**的 `page.tsx`，符号链路闭合。

**证据 F — 闸门组件本身是好的、可直接使用（即「只差接线」）：**

- `src/components/auth/AuthGate.tsx:35-63` 是一个完整、可用的默认导出组件，状态机正确：未挂载→`BootPlaceholder`；非桌面→`children`；桌面 `isLoading`→`BootPlaceholder`；桌面未认证→`<LoginScreen reason={reason}/>`；已认证→`children`，并已监听 `ecliptrix:session-expired`（`AuthGate.tsx:48-52`）。
- `src/components/auth/LoginScreen.tsx:37` 默认导出 `LoginScreen({ reason })`，仅依赖既有模块（`useLocale`、`DesktopTitleBar`、`useLoginForm`、`next/image`，见 `LoginScreen.tsx:3-7`），不会因缺依赖而崩。
- `src/components/auth/useLoginForm.ts:40` 导出 `useLoginForm`。

> 结论：**根因是「集成缺口」而非组件缺陷**。修复的核心就是把已经造好的 `AuthGate` 接进 `page.tsx`（并按 spec §2.7 处理「整窗仅一条标题栏」）。

### 3.3 次要 / 关联缺陷（同源，建议一并修）

- **D1｜`/login` 兜底路由未更新（`spec.md` §3 #7 漏做）。** `src/app/login/page.tsx`（最后修改 `6月8`，本轮未动）仍渲染旧的 `LoginModal` + 自带 `DesktopTitleBar`，**没有**切换到新的 `LoginScreen`。桌面端 401 不跳 `/login`（`http-client` 早退），所以这不是主症状成因；但若 Web 或异常路径走到 `/login`，看到的仍是旧弹窗，与新设计不一致。
- **D2｜i18n 文案键需校验。** `git status` 显示 `src/lib/i18n.ts` 为 `MM`（暂存区与工作区均有改动）。`LoginScreen` 通过 `useLocale().t(...)` 取文案，接线后须确认 `LoginScreen` 用到的键在 `i18n.ts` 中已存在，否则界面会出现裸键名（属修复阶段的回归校验项，非根因）。
  - **【评审核验 2026-06-16｜D2 已澄清为非风险】** 已逐键核对 `LoginScreen` + `useLoginForm` 实际引用的全部文案键，**en / zh 两套语言均已齐备**，不存在缺键，接线后不会出现裸键名：
    - 类型声明：`i18n.ts:52,56,57,63,67,68,69,70,71,74,76,77,78`（`loginButton/welcomeTitle/welcomeSubtitle/loggingIn/loginGateTitle/loginGateSubtitle/loginTagline/usernamePlaceholder/loginPasswordPlaceholder/capsLockOn/feature1/feature2/feature3`）。
    - en 实值：`i18n.ts:2583,2587,2588,2594,2597,2598,2599,2600,2601,2604,2606,2607,2608`。
    - zh 实值：`i18n.ts:5126,5130,5131,5137,5140,5141,5142,5143,5144,5147,5149,5150,5151`。
    - 另核 `sessionExpired`/`requiredFields`/`loginFailed`/`username`/`password`/`showPassword`/`hidePassword` 均存在（`grep` 命中 en+zh 各一）。
    - 结论：`i18n.ts` 的 `MM` 状态只是「第 1 轮加了键但未提交」的指纹（与证据 D 同源），**键本身已就绪**。修复阶段只需把 `i18n.ts` 一并 `git add` 提交，无需补键。

---

## 4. 影响面（Impact Surface）

| 维度 | 影响 |
|---|---|
| **受影响形态** | **打包后的桌面端（Electron）+ `npm run dev` 的 Electron 模式**——两者都加载 `/` 路由。 |
| **不受影响形态** | 纯 Web（浏览器）端：`AuthGate` 设计上 `!isDesktop()` 时直接放行 `children`（`AuthGate.tsx:59`），且 Web 本就是「着陆页 + 按钮登录弹窗」形态；即便接了闸门，Web 行为也不变。故 Web 端无回归、也无此 Bug。 |
| **受影响用户** | 所有使用桌面端的用户——**100% 无法正常使用**：启动即进入未认证应用，后续鉴权请求全部 401。 |
| **功能影响** | 桌面端**全部需要后端鉴权的功能失效**（工程列表、TTS、视频合成/导出、素材管理等）；同时第 1 轮需求「强制登录 + 持久化登录态」**完全未达成**。 |
| **安全影响** | 本应「只有 root 账户可进入」的硬闸门未生效；虽然后端仍要求鉴权（请求会 401），但前端没有任何登录入口被自动呈现，用户陷入死局。 |
| **数据风险** | 无数据损坏风险；纯属「进不去/用不了」的可用性阻断。 |

---

## 5. 候选修复方案（Candidate Fixes — 对比）

> 三个方案都**不需要重写**已有组件；差异在「接线方式」与「改动面」。

| # | 方案 | 做法概述 | 侵入性 | 风险 | 工作量 | 是否符合 spec |
|---|---|---|---|---|---|---|
| **F1** | **在 `page.tsx` 用 `<AuthGate>` 包裹整个 HomePage 主体**（spec §2.7 推荐） | `import AuthGate`；把 `page.tsx:133-248` 的整个返回 `<div>`（含页级 `DesktopTitleBar`）作为 `children` 包进 `<AuthGate>`；即 `return <AuthGate>{原有 <div>...</div>}</AuthGate>`。`AuthGate` 未认证时以 `LoginScreen`（自带唯一标题栏）取代整棵子树，已认证时透传原 UI。 | 低（≈ 2 行：1 import + 1 包裹） | 低：`AuthGate` 已实现且自带 SSR 占位/水合保护（`AuthGate.tsx:36-58`）；`LoginScreen` 自带 `DesktopTitleBar`，被包住的页级标题栏在未认证时不挂载，天然满足「整窗仅一条标题栏」 | 最小 | ✅ 与 `spec.md` §3 #6 / §2.7 完全一致 |
| **F2** | **在 `page.tsx` 内联条件渲染**，不引入 `AuthGate` | 直接在 `page.tsx` 写 `if (mounted && isDesktop() && !isAuthenticated) return <LoginScreen .../>`，并自行处理水合/`isLoading`/会话过期 reason。 | 中：要在 `page.tsx` 重写一套与 `AuthGate` 等价的状态机 | 中：重复实现易遗漏水合保护（SSR `isDesktop()` 恒 false → 水合不一致，spec R2）或漏处理 `session-expired` reason；与既有 `AuthGate.tsx` 逻辑重复、后续漂移 | 中 | ⚠️ 偏离 spec（spec 明确要 `AuthGate` 组件），且让 `AuthGate.tsx` 变死代码 |
| **F3** | **在全局 `layout.tsx` 套闸门** | 在 `src/app/layout.tsx` 的 Provider 层外再包 `<AuthGate>`，一次性覆盖所有路由。 | 高：影响 `/login` 等所有路由 | 高：会与 `/login` 自渲染登录界面冲突、造成双重登录界面/重复标题栏（spec §7-D1 已明确否决在 `layout.tsx` 设闸门） | 中 | ❌ spec §7-D1 明确反对 |

---

## 6. 推荐方案（Recommended Fix）

### 6.1 推荐：**F1 —— 在 `src/app/page.tsx` 用 `<AuthGate>` 包裹整个 HomePage 主体**

**理由：**

1. **直击根因、改动最小。** 根因是「闸门已造好但没接线」，F1 正是补上那条缺失的接线（1 个 import + 1 层包裹，约 2 行），不动任何已验证逻辑，风险最低、可回滚性最好。
2. **复用既有、不留死代码。** `AuthGate.tsx` / `LoginScreen.tsx` / `useLoginForm.ts` 都已实现且导出正常（证据 F），F1 让它们真正生效；F2 反而会把 `AuthGate` 晾成死代码。
3. **天然满足「整窗仅一条标题栏」不变式（spec §2.7）。** 把含页级 `DesktopTitleBar`（`page.tsx:137`）的整棵子树作为 `children` 交给 `AuthGate`——未认证时 `AuthGate` 以 `LoginScreen`（自带唯一标题栏）**取代**整棵子树，页级标题栏根本不挂载，不会出现两条标题栏。
4. **水合 / Web 端零回归。** `AuthGate` 已用 `mounted` 闸门避免 SSR `isDesktop()` 不一致（`AuthGate.tsx:36,58`），且 `!isDesktop()` 时直接放行 `children`（`AuthGate.tsx:59`），Web 端行为不变。
5. **与方案文档完全对齐。** 即 `spec.md` §3 #6 与 §2.7 的原定实现，无需重新决策。

### 6.2 落地要点（交给 Subtask #2）

- 在 `src/app/page.tsx` 顶部 `import AuthGate from '@/components/auth/AuthGate';`。
- 将 `HomePage` 的 `return (...)` 整体包进 `<AuthGate>...</AuthGate>`（**包含** `page.tsx:137` 的页级 `DesktopTitleBar`，确保未认证时它随子树一起被替换，满足单标题栏不变式）。
- **一并处理关联缺陷 D1**（spec §3 #7）：把 `src/app/login/page.tsx` 改为渲染 `<LoginScreen reason={reason}/>`，并删除其自带的 `DesktopTitleBar` 与重复的会话过期提示条，避免 `/login` 路由仍走旧弹窗。
- **回归校验 D2**：确认 `LoginScreen` 用到的 i18n 键在 `src/lib/i18n.ts`（当前 `MM`）中均已存在，避免裸键名。
- **验收（对照 spec §8.2）**：桌面端冷启动首屏应为 `LoginScreen`；输入 `admin/adminjr` 成功进入应用；错误凭证被拒；登录态持久化；**整窗仅一条 `DesktopTitleBar`**；`npm run type-check` / `npm run build` 通过。

---

## 7. 附：关键证据索引（便于评审/复核）

| 证据 | 文件:行 | 说明 |
|---|---|---|
| 闸门只在注释里被提及 | `src/contexts/AuthContext.tsx:218`、`:268` | `grep AuthGate` 仅命中注释，零真实渲染 |
| 入口页无闸门、直接渲染应用 | `src/app/page.tsx:133-249`（标题栏 `:137`、容器 `:216`、登录弹窗默认关闭 `:234`） | `page.tsx` 全文无 `AuthGate` import/使用 |
| 静默登录已删，落定未认证 | `src/contexts/AuthContext.tsx:216-231`、`:269-291` | `isLoading=false` 落到 `unauthenticated`，依赖不存在的闸门 |
| Git 不对称（只改一半） | `git status`：`M AuthContext.tsx` / `?? src/components/auth/` / `page.tsx` 未变 | 集成步被遗漏的指纹 |
| 桌面窗口加载 `/` 路由 | `desktop/main/index.js:153` | `createMainWindow('http://127.0.0.1:<port>')` → page.tsx |
| 闸门组件已就绪可用 | `src/components/auth/AuthGate.tsx:35-63`、`LoginScreen.tsx:37`、`useLoginForm.ts:40` | 默认导出、依赖完整，仅差接线 |
| `/login` 兜底未更新（关联） | `src/app/login/page.tsx`（最后改 `6月8`） | 仍用旧 `LoginModal`，spec §3 #7 漏做 |

---

## 8. 评审补强证据（Reviewer-added Evidence，2026-06-16）

> 本节由 Subtask #1 评审节点补入，针对「F1 是否会在未认证时产生副作用鉴权请求」这一边界问题做证据补强——因为 F1 是「在 `HomePage` 内部把 `return` 包进 `<AuthGate>`」，`HomePage` 顶部的 hooks 仍会执行，需证明它们在未认证时不会发鉴权请求（否则登录界面期间会出现 401 噪音，违背 spec AC9）。

**证据 G — F1 接线后，未认证态下 `HomePage` 的 hooks 不会触发任何鉴权请求（无副作用）：**

F1 的接法是 `return <AuthGate>{原 <div>…</div>}</AuthGate>`，置于 `HomePage` 函数体内。这意味着未认证时：

1. **数据组件不挂载** —— `AuthGate.tsx:61` 在桌面未认证分支 `return <LoginScreen reason={reason}/>`，用 `LoginScreen` **取代**整棵 children 子树，故 `Container` / `VerticalTaskbar` / `LandingPage` 等**根本不挂载**，它们内部的请求自然不发生。
2. **仍会执行的 `HomePage` 顶层 hooks 均已按 `isAuthenticated` 门控，不会越权发请求：**
   - `useLlmConfigStatus(isAuthenticated && canManageUsers)`（`page.tsx:65-66`）—— 入参带 `isAuthenticated`，未认证时 `enabled=false`，不发请求。
   - `didAutoOpenRef` effect（`page.tsx:45-51`）—— 第 47 行 `if (!hydrated || isLoading || !isAuthenticated) return;` 提前早退，未认证不会 `createTask`（即不触发工程列表请求）。
   - `useTasks()`（`page.tsx:25-36`）—— 仅读写 localStorage（spec §2.7/P2-6 已核实），无鉴权请求。

> 结论：F1「包在 `HomePage` 内部」与「包在 `HomePage` 外部」在副作用上**等价**——因为所有会发鉴权请求的 hook 都已自带 `isAuthenticated` 闸门。这与 spec §2.7「`AuthGate` 以 `LoginScreen` 取代 children（而非并列）」+ §8.2 AC9「登录界面无副作用请求」一致。**F1 不引入登录界面期间的 401 噪音。**

**证据 H — `AuthGate` / `AuthContext` 双重监听 `session-expired`，过期回闸路径闭合、无竞争：**

- `AuthGate.tsx:48-52` 监听 `ecliptrix:session-expired` → 置 `reason='session-expired'`；`AuthGate.tsx:54-56` 在 `isAuthenticated` 恢复时清 `reason`。
- `AuthContext.tsx:269-291` 同一事件 → 清 localStorage + 置 `unauthenticated`。
- 桌面端 401 **不**导航 `/login`（spec §2.4 / P1-1 已核实 `http-client.ts:189` 早退），故只有「事件 → `AuthGate` 原地浮现 `LoginScreen`」单一路径，**无 `/login` 跳转与原地闸门的竞争**（spec R4 已降级为「桌面端不存在此竞争」）。F1 接线后此路径才真正生效（此前 `AuthGate` 不在渲染树，过期后无界面浮现，见证据 C 末段）。

**证据 I — D1 修复存在一个类型边界，须提示 Subtask #2（否则 `type-check` 失败）：**

`src/app/login/page.tsx:27` 的 `const reason = searchParams.get('reason')` 类型为 `string | null`，而 `LoginScreen` 的 props 为 `reason?: 'session-expired' | null`（`LoginScreen.tsx:9-13`）。若直接 `<LoginScreen reason={reason}/>` 会**类型不兼容**（`string` 不可赋给字面量联合），触碰 spec AC8 的 `npm run type-check` 门。正确写法须收窄：

```tsx
<LoginScreen reason={reason === 'session-expired' ? 'session-expired' : null} />
```

这是 D1（spec §3 #7）实现时的**唯一非平凡边界**，本身不影响主症状修复（F1）。

---

## 9. 评审结论（Review Verdict）

> 评审人：Senior Reviewer（Anthropic engineering）｜评审日期：2026-06-16｜评审对象：本 `analysis.md` 的根因证据链与候选修复。
> 评审方法：逐条把 analysis 的行号 / `grep` / `git status` 断言与**真实代码**比对（已核 `page.tsx`、`AuthContext.tsx`、`AuthGate.tsx`、`LoginScreen.tsx`、`useLoginForm.ts`、`login/page.tsx`、`desktop/main/index.js`、`src/lib/i18n.ts`、以及 spec.md v2）。

### 9.1 根因证据审计 —— **通过（证据链闭合）**

逐项复核结果：

| 证据 | analysis 断言 | 评审复核 | 结论 |
|---|---|---|---|
| A | `AuthGate` 仅出现在 `AuthContext.tsx:218/:268` 注释 | `grep "AuthGate" src/`：命中即此两处注释 + `AuthGate.tsx` 自身定义（`:8/:35`），**零真实 import/渲染** | ✅ 属实 |
| B | `page.tsx` 无闸门、直接渲染应用主体 | `page.tsx` 无 `AuthGate` import；`return`(133)、页级 `DesktopTitleBar`(137) 无条件渲染、`Container`(216)、`LoginModal`(234) 默认 `isOpen=false`；桌面端 `showLandingPage` 因 `!isDesktop()` 恒 false（100-101）落到 `Container` | ✅ 属实，行号准确 |
| C | 静默登录已删、落定 `unauthenticated` | `AuthContext.tsx:216-231`（无效/无会话置 `isLoading=false` + `unauthenticated`）、`:269-291`（过期监听仅清状态、不再 silent login） | ✅ 属实 |
| D | Git 只落一半（不对称） | `git status`：`M AuthContext.tsx` / `MM i18n.ts` / `?? src/components/auth/`；`page.tsx`、`login/page.tsx` **均不在变更列表** = 未改动 | ✅ 实测一致 |
| E | 桌面窗口加载 `/` 路由 | `desktop/main/index.js:153` `createMainWindow(\`http://127.0.0.1:${state.frontendPort}\`)` | ✅ 逐字属实 |
| F | 闸门组件已就绪 | `AuthGate.tsx:35-63`（默认导出、状态机正确、`:48-52` 监听过期、`:58-59` 水合+Web 放行、`:61` 渲 `LoginScreen`）、`LoginScreen.tsx:37`、`useLoginForm.ts:40` 导出齐全、依赖完整 | ✅ 属实 |

- **被引代码确在失败路径上**：桌面窗口加载 `/`（证据 E）→ `page.tsx`（证据 B 的无闸门主体）→ `AuthContext` 落定 `unauthenticated`（证据 C）。三段串成完整失败链。
- **症状被证据充分解释**：①不显示登录界面 = 无人渲染 `LoginScreen`（A/B/F）；②直接进入程序 = `page.tsx` 无条件渲 `Container`（B）；③无登录态 = 静默登录已删、又无闸门承接（C）；④后续 401 = 无 token。四个症状一一对应。
- **已排除的替代解释**：(a)「闸门已接但坏了」——`grep` 证零使用，排除；(b)「静默登录仍在跑、只是 token 失效」——证据 C 证 `silentDesktopLogin` 调用已删、明确落 `unauthenticated`，排除；(c)「缺键导致界面崩」——证据 D2 核验 i18n 键齐备，排除。
- **唯一未在源码层闭合的环节**：`isDesktop()` 在**打包端**须返回 `true`，闸门才会触发。这不是本 Bug 的根因（闸门压根没接线），但属修复的生效前提；现状 `page.tsx` 既有的 Header/标题栏分支已在用 `isDesktop()`，且桌面走查（spec §8.2）会兜底验证，故不阻断——列为 Subtask #2 的验收项而非证据缺口。

> 根因判定：**「集成缺口（integration gap）」成立且证据airtight** —— 组件已造好（F），静默登录已删（C），唯独 `<AuthGate>` 未接进 `page.tsx`（A/B/D）。

### 9.2 候选修复审计

- **F1（推荐）—— 在 `src/app/page.tsx` 用 `<AuthGate>` 包裹整个 `HomePage` 主体（含页级 `DesktopTitleBar`）。**
  - **最小性**：1 行 import + 1 层包裹，直击根因「缺接线」，不动任何已验证逻辑——是解决**本次上报症状**的**充分且必要**改动。
  - **边界覆盖**：
    - *Web 端*：`AuthGate.tsx:59` `!isDesktop()` 直接透传 children → 零回归。
    - *水合/SSR*：`AuthGate.tsx:36/58` 以 `mounted` 闸门避免 SSR `isDesktop()` 不一致 → 安全。
    - *未认证副作用*：证据 G 证 `HomePage` 顶层 hooks 全部 `isAuthenticated`-门控 → 登录界面期间无 401 噪音（满足 AC9）。
    - *会话过期/并发*：证据 H 证回闸路径单一闭合、无 `/login` 竞争。
    - *单标题栏不变式*：未认证时 `AuthGate` 以 `LoginScreen`（自带唯一 `DesktopTitleBar`，`LoginScreen.tsx:103`）取代整棵子树，页级标题栏不挂载 → 满足 spec §2.7（无双标题栏）。
  - **回归风险**：低。无新依赖、可即时回滚。
- **F2（内联条件渲染）—— 否决。** 在 `page.tsx` 重写一套等价状态机，重复 `AuthGate` 逻辑、易漏水合/过期处理，并使 `AuthGate.tsx` 沦为死代码；偏离 spec（spec 明确要 `AuthGate` 组件）。
- **F3（`layout.tsx` 套闸门）—— 否决。** 会与 `/login` 自渲染冲突、造成双登录界面/重复标题栏；spec §7-D1 已明确反对。

### 9.3 最终推荐修复（Final Recommended Fix）

> **采纳 F1：在 `src/app/page.tsx` 顶部 `import AuthGate from '@/components/auth/AuthGate';`，并把 `HomePage` 的整个 `return (…)`（含 `page.tsx:137` 的页级 `DesktopTitleBar`）包进 `<AuthGate> … </AuthGate>`。**

**理由（一句话）**：本 Bug 的根因是「闸门已造好却没接线」的集成缺口（§9.1 证据 A–F 已闭合），F1 正是补上那条缺失的接线——改动最小（≈2 行）、直击根因、复用既有组件不留死代码、Web/水合零回归（证据 G/H）、天然满足单标题栏不变式，且与 spec.md v2 §3 #6 / §2.7 完全对齐。F2/F3 均偏离 spec 且引入更大风险，已否决。

**交付 Subtask #2 的强制落地清单（按重要性排序）：**

1. **【主修复·必做】** 按 F1 接线 `page.tsx`（1 import + 1 包裹）。这是解决上报症状「桌面端不弹登录窗、直接进入」的充分必要改动。
2. **【关联·建议同 PR】D1**：把 `src/app/login/page.tsx` 改为渲染 `<LoginScreen reason={…}/>`，删除其自带 `DesktopTitleBar`(45) 与重复的会话过期提示条(47-54)。**注意证据 I 的类型收窄**：`reason={reason === 'session-expired' ? 'session-expired' : null}`，否则 `type-check` 失败。说明：D1 **不是**本次症状成因（桌面端 401 不跳 `/login`），仅为 `/login` 兜底路由的视觉一致性（spec §3 #7），可与主修复同 PR。
3. **【回归·已澄清】D2**：i18n 键经评审核验**已齐备**（§3.3 D2 核验段），**无需补键**；只需把 `src/lib/i18n.ts` 一并 `git add` 提交即可。
4. **【验收门】** 对照 spec §8.2：桌面冷启动首屏为 `LoginScreen`；`admin/adminjr` 成功进入、错误凭证被拒；登录态持久化；**整窗仅一条 `DesktopTitleBar`**（AC6）；登录界面期间无失败鉴权请求（AC9）；`npm run type-check` / `npm run build` 通过。

**放行结论：分析报告根因证据链 airtight，推荐修复唯一明确（F1），可移交 Subtask #2 直接实现。本节点未写任何修复代码、未 `git commit`（遵循节点约束）。**
