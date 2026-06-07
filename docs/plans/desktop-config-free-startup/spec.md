# 桌面端免配置启动 + 应用内配置引导 — 设计文档

> Feature: `desktop-config-free-startup`
> Version: **v2**(评审修订稿 — P0/P1 问题已全部修复合入正文,见下方评审记录)
> Date: 2026-06-07
> Author: Subtask #0(方案设计节点);Reviewer: Subtask #1(设计评审节点)
> 上游轮次: 第 1 轮 `desktop-electron-packaging`(a52bc01)、第 2 轮 `desktop-build-ps1`(b10a184)

---

## 评审记录(Review Notes)

> 评审方式:逐节对照代码库实证核查(可行性 / 完整性 / 一致性 / 体量适配四维)。
> 已核实成立的关键前提:`app/main.py:72-75` 对空 LLM 凭证仅 warning(`get_settings()` 恒以 `os.getenv("LLM_API_KEY", "")` 传入,Pydantic 必填字段被空串满足);`/api/config/` 已在 `auth_middleware.py:99` 的 `ALLOWLIST_PREFIX` 中;`config_router` 以 `prefix="/config"` 挂载于 `/api`(`main.py:619`);`get_effective_config`(`model_settings_service.py:559`)对未配置不抛异常、返回带 `source` 的 env 回退;`model_settings_router` 整路由级 `require_admin` 且 `resolve/{function_type}` 回传明文 key(不可公开复用的判断成立);`createPassthroughRoute` 支持 GET;`AuthContext` 已暴露 `canManageUsers`(`AuthContext.tsx:397-404`);`ensureRequiredEnv` 唯一调用方为 `index.js:99`;启动期不存在 model_providers 自动播种,冒烟断言 `configured===false` 安全;匿名请求已被 `rate_limit_middleware` 按 IP 限流,公开端点无放大风险;`Header.tsx:187`、`ModelSettingsPanel.tsx`(1456 行,空态位于 904-908 / 1208-1211)、`chat/route.ts:66`、`smoke-test.js:101-114` 等行号引用全部准确。

| # | 严重度 | 位置 | 问题 | 处置 |
|---|--------|------|------|------|
| R1 | **P1** | §6.1 | **测试框架写错:项目前端测试跑的是 Vitest 而非 Jest**(`package.json` → `"test": "vitest run"`;既有测试如 `ModelSettingsPanel.form.test.tsx`、`backend-proxy.test.ts` 均为 Vitest + Testing Library)。按 v1 文档下游会尝试引入/运行 Jest,要么失败要么新增冗余依赖 | ✅ 已修复:§6.1 及相关表述统一改为 Vitest |
| R2 | **P1** | §2.2-A、§2.2-D、§3 文件#3、§7 风险#3 | **占位值剔除的前提不完整**:`desktop/scripts/env.template.desktop:77-82` 中火山 TTS 四个占位值(`your_volcano_tts_api_key` / `your_volcano_tts_appid` / `your_volcano_tts_access_token` / `your_volcano_tts_secret_key`)**没有 `_here` 后缀**,不匹配 `PLACEHOLDER_PATTERN`(`^your_.*_here$`),将作为假凭证注入子进程——与 §2.2-A「剔除后回到既有优雅降级路径」的承诺矛盾 | ✅ 已修复:文件#3 范围扩为同步把这四个占位值规整为 `_here` 后缀;正文补充存量 `.env` 的遗留缓存注意事项 |
| R3 | **P1** | §2.2-C3、§3 文件#10/#18、§6.1 | **重复造轮子**:`src/components/ui/Modal.tsx` 已实现完整 WAI-ARIA Dialog 模式(role/aria-modal/labelledby/describedby、Tab 焦点圈定、Esc、遮罩点击、焦点交还),且有专属测试 `ui/__tests__/Modal.test.ts`。v1 让 `SetupGuideDialog` 手写整套焦点管理,违反一致性且扩大测试面 | ✅ 已修复:§2.2-C3 改为组合 `ui/Modal`,组件只负责内容与视觉;#18 测试面相应收窄 |
| R4 | P2 | §2.2-B、§2.2-C2、§4.1、§6.1 | **失败语义两层不一致**:后端解析异常返回 `configured=false`(fail-closed,触发弹窗),而前端钩子对网络错误映射 `'unknown'`(fail-open,不弹)。后端瞬时故障会对已配置管理员误弹引导 | ✅ 已顺手修复:后端异常分支改为 `success:false`(仍 HTTP 200),钩子将 `success !== true` 一律映射 `'unknown'`,两层语义对齐 |
| R5 | P2 | §2.2-C4 | 钩子以 `isAuthenticated` 门控,非管理员登录也会发起一次无意义的状态请求(其无权修复、齿轮入口对其也不可见) | ✅ 已顺手修复:`enabled` 改为 `isAuthenticated && canManageUsers` |
| R6 | P2 | §2.2-C4 | `showSetupGuide` 未排除 `isProfileOpen`,引导可能盖在个人资料页上 | ✅ 已顺手修复:可见性条件追加 `!isProfileOpen` |
| R7 | P2 | §2.3 | 首启日志示例写 `config incomplete (LLM_API_KEY, LLM_API_URL)`,但模板 `LLM_API_URL` 是真实 dashscope 地址(非占位),实际 missing 只有 `LLM_API_KEY` | ✅ 已顺手修复:示例日志改为与模板实际状态一致 |
| R8 | P2 | §4.1 | 公开端点每次请求都触发一次 DB 查询——经核查匿名流量已被 `rate_limit_middleware` 按 IP 计数限流(normal 类别),无需额外防护 | 📝 备注即可,无需改动 |

**四维结论**:可行性——全部关键前提经代码实证成立,无虚构 API;完整性——R2/R4/R7 补齐后,边界(占位值、异常路径、Web 回归、旧工件兜底)覆盖充分;一致性——R1/R3 修复后与既有测试栈、UI 基建、`createPassthroughRoute`/`BaseResponse` 惯例完全对齐,新文件均符合 800 行/50 行阈值;体量适配——19 项文件变更各自足够小且非目标边界清晰,无过度设计(刻意不重做 AdminSettings、不迁移可选 key 是正确的收敛)。

---

## 1. Overview(概述)

第 1 轮桌面端打包方案在 `desktop/main/envCheck.js` 中设置了一道**启动硬闸**:解析 `userData/.env`,若 `LLM_API_KEY` / `LLM_API_URL` 缺失或仍为 `your_*_here` 占位值,就弹出原生模态对话框(「打开配置文件 / 我已配置,重新检测 / 退出」)并阻塞循环,直到用户手工编辑 `.env` 通过校验。用户实测反馈(本轮需求):打包后首次打开即被「Ecliptrix 配置缺失」对话框拦下,体验粗糙——要求改为**未配置也能正常打开应用**,打开后**提醒**用户前往应用内「设置」补全 KEY 与凭证,且设置界面要美观优雅、符合人机交互最佳实践。

代码勘察证实这道硬闸是**纯前置防御而非真实依赖**:后端 `app/main.py:72` 对空 `LLM_API_KEY` 只打 warning 并继续启动(`Settings.llm_api_key` 虽声明为必填字段,但 `get_settings()` 恒以 `os.getenv("LLM_API_KEY", "")` 传入空串,Pydantic 不会拒绝);更关键的是,项目**已经内建了一套完整的运行时模型凭证系统**——后端 `model_settings_router`(服务商 CRUD、连通性测试、模型列表拉取、`resolve/{function_type}` 生效配置解析,DB 优先、env 回退),前端 `设置 → 模型设置`(`AdminSettings/ModelSettingsPanel.tsx`),且 `/api/chat`、`/api/video-editing-agent/chat` 等 LLM 消费方均已走 `resolve` 优先链路。换言之,「在应用内完成配置」的全部基础设施都已就绪,缺的只是:① 拆掉 Electron 启动闸;② 一个**优雅的首次启动引导**把用户领到模型设置;③ 模型设置面板在零配置状态下的**快速开始**体验打磨。

本方案据此做最小侵入改造:Electron 主进程改为「解析 .env → 剔除占位值 → 无条件启动服务」;后端在既有公开前缀 `/api/config/` 下新增一个**不含任何秘密**的 `GET /api/config/llm-status` 状态端点;前端新增一个符合 WAI-ARIA 对话框模式的 `SetupGuideDialog` 首次配置引导(管理员登录后、CHAT 凭证未配置时出现,主按钮直达「设置 → 模型设置」),配套设置入口的「待配置」琥珀色徽标、模型设置面板的三步快速开始空态卡片,以及 i18n 中英双语文案。Web 部署形态(env 已配置)行为完全不变。

### 范围与非目标

- **目标**:桌面端零配置可启动、可登录、可浏览;配置引导闭环(提醒 → 确认 → 设置页 → 配置生效后提醒消失);设置引导链路的视觉与交互打磨。
- **非目标**:不重做整个 AdminSettings 视觉体系;不把 Pexels/ARK/TTS 等可选外部 API key 迁入应用内设置(它们本就可选、缺失时各功能既有降级逻辑生效,`.env` 仍是其配置通道);不改管理员初始账号体系;不做 macOS/Linux;非管理员普通用户(Web 多用户场景)不展示引导(其无权修复,仅管理员可见)。

---

## 2. Technical Design(技术设计)

### 2.1 架构总览

```
┌─ Ecliptrix.exe(Electron 主进程)──────────────────────────────────────┐
│ envCheck.js: loadUserEnv(envPath)                                      │
│   解析 .env → 剔除 your_*_here 占位值 → {env, missing}                 │
│   missing 仅写日志,不再弹窗、不再阻塞、不再退出  ◄── 本轮核心改动      │
│ index.js: 无条件 resolvePorts → startServices → createMainWindow       │
└────────────────────────────────────────────────────────────────────────┘
        │ 子进程(均与现状一致,占位值已被剔除故不会以假 key 注入)
        ▼
┌─ FastAPI 后端 ─────────────────────────┐  ┌─ Next.js standalone 前端 ──┐
│ config_router.py(新增,公开路径)      │  │ /api/config/llm-status      │
│  GET /api/config/llm-status            │◄─┤  (createPassthroughRoute)  │
│  → resolve CHAT 生效配置(DB→env)     │  │ /api/chat 等(既有,不动)  │
│  → {configured, source} 零秘密返回     │  └────────────────────────────┘
└────────────────────────────────────────┘
        ▲
        │ 渲染进程(同源 Web 应用)
┌─ src/app/page.tsx ─────────────────────────────────────────────────────┐
│ useLlmConfigStatus(isAuthenticated)  → 'loading|configured|            │
│                                         unconfigured|unknown'          │
│ ├─ SetupGuideDialog(管理员 && unconfigured && 本次会话未忽略)         │
│ │    「前往设置」→ openSettingsAt('modelSettings')                     │
│ ├─ Header 设置齿轮琥珀色提醒徽标(unconfigured 时常驻)                │
│ └─ AdminSettingsPage initialItem='modelSettings'                       │
│      └─ ModelSettingsPanel:零服务商时渲染「三步快速开始」空态卡片;   │
│         保存成功后派发 'ecliptrix-llm-config-updated' 事件刷新状态     │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键代码路径

#### A. Electron 主进程 — 拆除启动闸(`desktop/main/envCheck.js`、`index.js`)

`envCheck.js` 删除 `ensureRequiredEnv`(及 `electron` 的 `dialog`/`shell` 导入,模块降级为纯 `fs` 模块,可直接单测),新增:

```js
/**
 * Non-blocking replacement for ensureRequiredEnv (round 3).
 * Strips placeholder values (your_*_here) for ALL keys so they never reach
 * child processes as fake credentials, then reports which required keys are
 * still missing. Never shows a dialog, never blocks startup.
 * @returns {{ env: Record<string,string>, missing: string[] }}
 */
function loadUserEnv(envPath) {
  const raw = parseEnvFile(envPath)
  const env = {}
  for (const [key, value] of Object.entries(raw)) {
    if (PLACEHOLDER_PATTERN.test(String(value).trim())) continue
    env[key] = value
  }
  return { env, missing: missingRequiredKeys(env) }
}

module.exports = { parseEnvFile, missingRequiredKeys, loadUserEnv, REQUIRED_KEYS, PLACEHOLDER_PATTERN }
```

`parseEnvFile`、`missingRequiredKeys`、`REQUIRED_KEYS`、`PLACEHOLDER_PATTERN` 原样保留(`PLACEHOLDER_PATTERN` 此前未导出,本轮补入 `module.exports` 供单测使用)。**对所有键剔除占位值**(不只 REQUIRED_KEYS)是刻意行为:现状下 `PEXELS_API_KEY=your_pexels_api_key_here` 会被当成真实 key 注入子进程,导致后端在调用期收到 401 而非走「未配置」降级分支;剔除后回到既有的优雅降级路径。

> ⚠️ **评审修复(R2)**:`env.template.desktop:77-82` 的火山 TTS 四个占位值(`your_volcano_tts_api_key`、`your_volcano_tts_appid`、`your_volcano_tts_access_token`、`your_volcano_tts_secret_key`)**缺少 `_here` 后缀**,不匹配 `PLACEHOLDER_PATTERN`,会作为假凭证漏注入。修复方式是**规整模板而非放宽正则**(放宽到 `^your_.*$` 会扩大误杀面、且后端 `llm-status` 与冒烟脚本共用同一模式):文件#3 同步把这四个值改为 `your_volcano_tts_api_key_here` 等 `_here` 形态。**遗留缓存注意**:首启前已从旧模板复制出的 `userData/.env` 仍含旧占位值、不会被剔除——影响仅限 TTS 在调用期报鉴权错误(与改造前现状一致,不构成回归);README 的「首次启动与配置」小节提示存量用户删除占位行即可。

`index.js` 的 `main()` 中,原:

```js
const userEnv = ensureRequiredEnv(envPath)
if (!userEnv) { state.logger.log(...); app.quit(); return }
state.userEnv = userEnv
```

改为:

```js
const { env: userEnv, missing } = loadUserEnv(envPath)
if (missing.length > 0) {
  // Round 3: do NOT block — the renderer shows an in-app setup guide instead.
  state.logger.log('main', `config incomplete (${missing.join(', ')}) — starting anyway; in-app setup guide will prompt`)
}
state.userEnv = userEnv
```

`backendService.js` / `frontendService.js` 的 `...userEnv` 注入逻辑零改动。`--dev` 模式原本就跳过校验,不受影响。

#### B. 后端 — 公开零秘密状态端点(`app/routers/config_router.py`)

`/api/config/` 前缀已在 `auth_middleware.py` 的 `ALLOWLIST_PREFIX` 中公开(api-authz-rate-limiting T01 已添加),**无需改中间件**。在 `config_router.py` 追加:

```python
_PLACEHOLDER_PATTERN = re.compile(r"^your_.*_here$", re.IGNORECASE)

@router.get("/llm-status")
async def llm_status() -> dict:
    """Report whether a usable CHAT LLM credential exists (DB assignment or env).

    Public by design (auth middleware allowlists /api/config/) and secret-free:
    only booleans/enums are returned so the renderer can decide whether to show
    the first-run setup guide. NEVER add api_key/api_url fields here.
    """
    try:
        config = await model_settings_service.get_effective_config(ModelFunctionType.CHAT)
        api_key = (config.api_key or "").strip()
        api_url = (config.api_url or "").strip()
        configured = bool(api_key) and bool(api_url) and not _PLACEHOLDER_PATTERN.match(api_key)
        source = config.source if configured else "none"
    except Exception:
        # R4: resolution fault ≠ "unconfigured" — signal indeterminate so the
        # renderer maps it to 'unknown' and does NOT flash the setup guide at
        # an already-configured admin during a transient backend fault.
        logger.exception("llm-status resolution failed — reporting indeterminate")
        return {"success": False, "data": {"configured": False, "source": "none"}}
    return {"success": True, "data": {"configured": configured, "source": source}}
```

设计决策:① 只看 CHAT 功能位——启动闸拦的 `LLM_API_KEY/LLM_API_URL` 正是 CHAT 的 env 回退源,且 FAST/VIDEO_CUT/VISION 的 env 回退全部级联到 CHAT 配置;② 占位值在服务端再校验一次,保护 Web 部署里照抄 `env.template` 未填值的情况(模板 `LLM_API_URL` 为真实 dashscope 地址,故只需校验 key 一侧);③ 恒 HTTP 200,渲染端无需分支处理 5xx;**解析异常时返回 `success:false`**(R4 评审修复)——「真没配置」与「暂时查不到」是两种信号,前者弹引导、后者由钩子映射 `'unknown'` 静默跳过,与前端网络错误的 fail-open 语义对齐;④ 不复用 `resolve/{function_type}`——它返回明文 `api_key` 且被 `require_admin` 路由级守卫,公开它或为它开洞都是更差的选择。注:`get_effective_config` 对「未配置」本身不抛异常(env 回退返回空串),异常分支只覆盖 DB 访问类故障。

#### C. 前端 — 状态钩子与配置引导

1. **代理路由** `src/app/api/config/llm-status/route.ts`(标准两行 passthrough):

```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
export const { GET } = createPassthroughRoute('/api/config/llm-status')
```

2. **状态钩子** `src/hooks/useLlmConfigStatus.ts`:

```ts
export type LlmConfigStatus = 'loading' | 'configured' | 'unconfigured' | 'unknown'

export function useLlmConfigStatus(enabled: boolean): {
  status: LlmConfigStatus
  refresh: () => void
}
```

实现要点:`enabled=false` 时不发请求且 status 固定 `'loading'`(page.tsx 传 `isAuthenticated && canManageUsers`,R5 评审修复——非管理员无权修复也看不到齿轮入口,不为其发请求);`fetch('/api/config/llm-status')` 成功且响应体 `success === true` → 按 `data.configured` 映射 `'configured' | 'unconfigured'`;网络错误 / 非 200 / 解析失败 / **响应体 `success !== true`**(R4,后端解析故障信号)→ `'unknown'`(**fail-open:不展示引导**,避免后端瞬时不可用时误骚扰已配置用户);`useEffect` 内监听 `window` 的 `'ecliptrix-llm-config-updated'` 自定义事件并调用 `refresh`(卸载时移除监听);`refresh` 用 `useCallback` 固定引用。

3. **引导对话框** `src/components/Onboarding/SetupGuideDialog.tsx`(纯展示组件,可见性逻辑放 page.tsx):

```ts
interface SetupGuideDialogProps {
  open: boolean
  onGoToSettings: () => void   // 主操作:前往 设置 → 模型设置
  onDismiss: () => void        // 次操作 / Esc / 遮罩点击:本次启动不再提示
}
```

**基座复用(R3 评审修复)**:组件**组合既有 `src/components/ui/Modal.tsx`** 而非手写对话框骨架——`Modal` 已实现完整 WAI-ARIA Dialog 模式(`role="dialog"`、`aria-modal`、`labelledBy/describedBy`、Tab 焦点圈定、Esc 关闭、遮罩点击、关闭后焦点交还),且有专属测试 `ui/__tests__/Modal.test.ts` 守护。`SetupGuideDialog` 只负责内容与视觉:`<Modal isOpen={open} onClose={onDismiss} labelledBy="setup-guide-title" describedBy="setup-guide-desc" className={遮罩样式} contentClassName={面板样式}>`。

视觉与交互规范(本轮「美观优雅、顶级、符合人机交互最佳实践」的落点之一):

- **布局**(经 Modal 的 `className`/`contentClassName` 注入):遮罩 `fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm`;面板 `max-w-lg w-[92vw] rounded-2xl bg-card text-foreground border border-border shadow-2xl p-8`。入场动画 fade + scale(`transition` 200ms,包裹 `motion-reduce:transition-none` 尊重 `prefers-reduced-motion`)。
- **内容结构**(自上而下):① 渐变圆形图标容器(`w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-primary/5` 内嵌钥匙/火花 SVG,`text-primary`);② 标题 `text-xl font-semibold` 带 `id="setup-guide-title"`(`t.setupGuide.title`:「欢迎使用 Ecliptrix」/ "Welcome to Ecliptrix");③ 副文案 `text-sm text-muted-foreground leading-relaxed` 带 `id="setup-guide-desc"`(说明 AI 功能需先配置模型 API 凭证,普通素材浏览/剪辑不受影响);④ 三步骤列表,每行 = 圆形序号徽标(`w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold`)+ 步骤名 + 一行说明:**1 添加模型服务商**(填入 API 地址与密钥)→ **2 测试连接**(一键验证密钥可用)→ **3 分配给功能**(为对话/混剪/视觉理解选择模型);⑤ 按钮区右对齐:次按钮「稍后再说」(`ghost` 风格 `text-muted-foreground hover:bg-accent`),主按钮「前往设置」(`bg-primary text-primary-foreground hover:bg-primary/90`,`autoFocus`——Modal 仅在焦点不在面板内时才聚焦容器,`autoFocus` 的主按钮优先生效)。
- **可访问性**:焦点圈定、Esc、遮罩点击、焦点交还均由 `Modal` 提供,组件内**不得**重复实现;Esc 与遮罩点击经 `onClose={onDismiss}` 等价「稍后再说」。
- **暗色模式**:全部使用 shadcn 语义 token(`bg-card/text-foreground/border-border/...`),不写死色值。

4. **page.tsx 接线**(`src/app/page.tsx`):

```tsx
const { isAuthenticated, isLoading, canManageUsers } = useAuth();
// R5: gate on admin too — non-admins can't fix the config and never see the gear.
const { status: llmStatus, refresh: refreshLlmStatus } =
  useLlmConfigStatus(isAuthenticated && canManageUsers);
const [settingsInitialItem, setSettingsInitialItem] = useState<SettingsMenuItem>('userManagement');
const [setupGuideDismissed, setSetupGuideDismissed] = useState<boolean>(() =>
  typeof window !== 'undefined' && window.sessionStorage.getItem(SETUP_GUIDE_DISMISSED_KEY) === '1'
);

const dismissSetupGuide = () => {
  try { window.sessionStorage.setItem(SETUP_GUIDE_DISMISSED_KEY, '1'); } catch { /* ignore */ }
  setSetupGuideDismissed(true);
};
const openSettingsAt = (item: SettingsMenuItem) => {
  setSettingsInitialItem(item);
  setIsProfileOpen(false);
  setIsSettingsOpen(true);
};
const showSetupGuide =
  isAuthenticated && canManageUsers && llmStatus === 'unconfigured' &&
  !setupGuideDismissed && !isSettingsOpen && !isProfileOpen; // R6: 不盖个人资料页
```

- `<SetupGuideDialog open={showSetupGuide} onGoToSettings={() => { dismissSetupGuide(); openSettingsAt('modelSettings'); }} onDismiss={dismissSetupGuide} />` 渲染于根容器末尾(LoginModal 旁)。两条路径都置会话忽略标记:用户从设置页退出时不应再次弹窗(齿轮徽标继续承担常驻提醒)。
- `AdminSettingsPage` 改传 `initialItem={settingsInitialItem}`;`onClose` 中追加 `refreshLlmStatus()` 并重置 `setSettingsInitialItem('userManagement')`。
- `Header` 新增可选 prop `showSettingsAttention={llmStatus === 'unconfigured'}`。
- `SETUP_GUIDE_DISMISSED_KEY = 'ecliptrix-setup-guide-dismissed'`(sessionStorage):**会话级**忽略——本次启动不再弹、下次启动(仍未配置)重新提醒。刻意不用 localStorage(永久忽略会让用户彻底失去引导)也不每次路由都弹(打扰)。

5. **AdminSettingsPage.tsx**:props 增加 `initialItem?: SettingsMenuItem`,`useState<SettingsMenuItem>(initialItem ?? 'userManagement')`。其余不动。

6. **Header.tsx**:settings 齿轮按钮(187 行附近)外层加 `relative`,`showSettingsAttention` 为真时渲染:

```tsx
<span aria-hidden="true"
  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none" />
```

并把按钮 `title` / `aria-label` 切换为 `t.setupGuide.settingsAttentionHint`(「模型凭证待配置」)。

7. **ModelSettingsPanel.tsx**(1456 行,已超项目 800 行阈值,**新 UI 必须外置为新文件**):

- 新建 `src/components/AdminSettings/components/ModelQuickStartCard.tsx`:替换 providers 标签页 904-908 行的虚线空态 div。卡片 = 渐变描边容器(`rounded-xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 text-center`)+ 标题「快速开始」+ 横排三步骤(复用 SetupGuideDialog 的步骤文案 i18n 键,序号徽标 + 步骤名 + 说明,小屏 `flex-col`)+ 居中主 CTA「添加服务商」。props:`{ onAddProvider: () => void }`,由面板把既有「添加服务商」按钮的 onClick 回调传入。
- assignments 标签页 1208-1211 行空态:改为同风格提示「先添加一个服务商,再为各功能分配模型」+ 次级按钮「去添加服务商」(`setActiveTab('providers')`)。此处文案简单,直接内联,不新建文件。
- `handleSaveProvider` 与 `handleSaveAssignment` 的成功分支(通知 toast 之后)各追加一行:`window.dispatchEvent(new Event('ecliptrix-llm-config-updated'))`,驱动首页徽标/引导实时熄灭。

8. **i18n**(`src/lib/i18n.ts`,interface + en + zh 三处同步):新增顶层 `setupGuide` 命名空间:`title`、`description`、`stepProviderTitle/Desc`、`stepTestTitle/Desc`、`stepAssignTitle/Desc`、`goToSettings`、`later`、`settingsAttentionHint`;`adminSettings` 下新增 `modelQuickStartTitle`、`modelQuickStartDesc`、`modelQuickStartAddProvider`、`modelAssignmentsNeedProvider`、`modelAssignmentsGoProviders`。

9. **`/api/chat` 错误文案**(`src/app/api/chat/route.ts:66`,P2 顺手项):未解析到 key 时抛出的英文报错改为可行动文案:`'尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置 (AI model not configured — open Settings → Model Settings)'`,聊天界面现有错误展示通道即可把用户指回设置。

#### D. 桌面配套文件

- `desktop/scripts/env.template.desktop`:LLM 配置段注释从「必填 — 缺失时应用会弹出配置引导,后端拒绝启动」改为「可选 — 推荐启动应用后登录,在 设置 → 模型设置 中配置;此处的值仅作为环境变量回退,且 your_*_here 占位值会被忽略」;文件头同步删去「弹出配置引导」表述;**(R2)火山 TTS 段四个占位值统一规整为 `_here` 后缀**(`your_volcano_tts_api_key_here` / `your_volcano_tts_appid_here` / `your_volcano_tts_access_token_here` / `your_volcano_tts_secret_key_here`),使其落入 `PLACEHOLDER_PATTERN` 剔除范围。
- `desktop/README.md`:「打包」之后新增「首次启动与配置」小节:双击即开 → 用 `.env` 中 `ROOT_USERNAME/ROOT_PASSWORD` 登录 → 按引导进入 设置 → 模型设置 添加服务商、测试连接、分配功能;`.env` 仍可作为高级/批量配置通道。
- `desktop/scripts/smoke-test.js`:这是本轮核心回归的自动化验证 — 生成的冒烟 `.env` **删除** `LLM_API_KEY/LLM_API_URL/LLM_MODEL` 三行(仅保留 ROOT 账号),更新 101-102 行注释;在「login ok」之后新增步骤 2.5:`GET /api/config/llm-status` 断言 HTTP 200 且 `success === true && data.configured === false`(R4:`success:false` 表示解析故障,在冒烟里应视为失败而非「未配置」)。即:**未配置 LLM 时,应用必须能完整启动、登录、读库**。

### 2.3 运行时序

**首启(未配置)**:Electron `main()` → `initUserData` 复制模板 `.env` → `loadUserEnv` 剔除占位、记日志 `config incomplete (LLM_API_KEY)`(R7:模板 `LLM_API_URL` 为真实 dashscope 地址,missing 仅 key 一项)→ splash → 后端/前端健康 → 主窗口。渲染端:登录页 → 管理员登录 → `useLlmConfigStatus` 拉取 `/api/config/llm-status` → `unconfigured` → `SetupGuideDialog` 弹出(齿轮徽标同步点亮)→「前往设置」→ AdminSettings(modelSettings 预选)→ 添加服务商 → 测试连接 → 分配 CHAT → 保存成功派发 `ecliptrix-llm-config-updated` → 钩子刷新为 `configured` → 徽标熄灭;关闭设置页回首页,引导不再出现(配置已生效 + 会话忽略双保险)。**次启(已配置)**:`llm-status` 返回 `configured`(source=database),全程无打扰。**Web 形态**:env 已配置 → `configured`(source=environment),与现状无任何可见差异。

---

## 3. File / Module Change Plan(文件 / 模块变更计划)

| # | 文件 | 动作 | 一行意图 |
|---|------|------|----------|
| 1 | `desktop/main/envCheck.js` | 修改 | 删除阻塞式 `ensureRequiredEnv`,新增非阻塞 `loadUserEnv`(占位值剔除 + missing 报告),移除 electron 导入 |
| 2 | `desktop/main/index.js` | 修改 | 改调 `loadUserEnv`,missing 仅写日志,删除 quit 分支,无条件继续启动时序 |
| 3 | `desktop/scripts/env.template.desktop` | 修改 | LLM 段与文件头注释改为「可选,推荐应用内设置」,删除「拒绝启动」表述;(R2)火山 TTS 四占位值规整为 `_here` 后缀 |
| 4 | `desktop/scripts/smoke-test.js` | 修改 | 冒烟 `.env` 去掉 LLM 三行;新增 llm-status `configured===false` 断言(零配置可启动回归) |
| 5 | `desktop/README.md` | 修改 | 新增「首次启动与配置」小节,描述登录 + 应用内引导流程 |
| 6 | `backend-services/basic-service/app/routers/config_router.py` | 修改 | 新增 `GET /config/llm-status` 公开零秘密状态端点(CHAT 生效配置→布尔) |
| 7 | `backend-services/basic-service/tests/test_config_llm_status.py` | 新建 | 端点四态单测:无配置 / 占位值 / env 配置 / DB assignment 配置 |
| 8 | `src/app/api/config/llm-status/route.ts` | 新建 | `createPassthroughRoute('/api/config/llm-status')` 标准代理 |
| 9 | `src/hooks/useLlmConfigStatus.ts` | 新建 | 状态钩子:拉取/刷新 llm-status,监听 `ecliptrix-llm-config-updated` 事件 |
| 10 | `src/components/Onboarding/SetupGuideDialog.tsx` | 新建 | 首次配置引导对话框:组合 `ui/Modal`(R3),自身只含三步骤内容、视觉样式与降噪动画 |
| 11 | `src/components/AdminSettings/AdminSettingsPage.tsx` | 修改 | 新增 `initialItem?: SettingsMenuItem` prop 作为初始选中项 |
| 12 | `src/app/page.tsx` | 修改 | 接线:状态钩子、引导可见性、`openSettingsAt`、会话忽略、设置关闭后 refresh |
| 13 | `src/components/Header.tsx` | 修改 | 新增 `showSettingsAttention` prop:齿轮琥珀色脉冲徽标 + aria 提示 |
| 14 | `src/components/AdminSettings/components/ModelQuickStartCard.tsx` | 新建 | 模型设置零服务商空态:三步快速开始卡片 + 「添加服务商」CTA |
| 15 | `src/components/AdminSettings/ModelSettingsPanel.tsx` | 修改 | 两处空态替换/升级;保存成功后派发 `ecliptrix-llm-config-updated` |
| 16 | `src/lib/i18n.ts` | 修改 | 新增 `setupGuide` 命名空间与 `adminSettings.modelQuickStart*` 键(interface+en+zh) |
| 17 | `src/app/api/chat/route.ts` | 修改 | 未配置报错文案改为指向「设置 → 模型设置」的可行动提示(P2) |
| 18 | `src/components/Onboarding/__tests__/SetupGuideDialog.test.tsx` | 新建 | 渲染条件、两按钮回调、文案/步骤内容测试(焦点圈定/Esc/遮罩由 `ui/__tests__/Modal.test.ts` 既有覆盖,不重测) |
| 19 | `src/hooks/__tests__/useLlmConfigStatus.test.ts` | 新建 | 钩子四态映射、enabled 门控、事件刷新测试(mock fetch) |

不修改:`desktop/main/{backendService,frontendService,config,ports,processManager,window,logger}.js`、`desktop/preload/preload.js`、打包脚本与 `build.ps1`(占位值剔除发生在主进程内存中,与打包无关)、auth 中间件(`/api/config/` 已公开)、`model_settings_router.py` 及其服务层。

---

## 4. Interface Design(接口设计)

### 4.1 REST — `GET /api/config/llm-status`(新增,公开,无需鉴权)

- 后端真实路径:`/api/config/llm-status`(`config_router`,挂载于 `/api` 前缀下);前端经 Next passthrough 同路径访问。
- 请求:无参数、无请求体。
- 响应(恒 HTTP 200;R4:解析异常时 `success:false` 表示「状态不可判定」,渲染端映射 `'unknown'` 不弹引导):

```json
{ "success": true, "data": { "configured": true, "source": "database" } }
```

| 字段 | 类型 | 语义 |
|------|------|------|
| `success` | boolean | `true` = 状态可信;`false` = 后端解析故障,状态不可判定(R4) |
| `data.configured` | boolean | CHAT 功能位存在可用凭证(api_key 与 api_url 均非空且 key 非 `your_*_here` 占位) |
| `data.source` | `"database" \| "environment" \| "none"` | 凭证来源;`configured=false` 时恒为 `"none"` |

> 流量备注(R8):该公开端点每请求一次 DB resolve;匿名流量已被 `rate_limit_middleware` 按 IP 在 normal 类别限流,无需额外防护。

**安全契约**:响应永不携带 key/url/model 等字段;该端点为公开路径,新增字段前必须重新评估信息暴露面(代码注释中已写明)。

### 4.2 前端组件 / 钩子签名

```ts
// src/hooks/useLlmConfigStatus.ts
export type LlmConfigStatus = 'loading' | 'configured' | 'unconfigured' | 'unknown'
export function useLlmConfigStatus(enabled: boolean): { status: LlmConfigStatus; refresh: () => void }

// src/components/Onboarding/SetupGuideDialog.tsx — 内部组合 ui/Modal(R3)
interface SetupGuideDialogProps { open: boolean; onGoToSettings: () => void; onDismiss: () => void }

// src/components/AdminSettings/AdminSettingsPage.tsx
interface AdminSettingsPageProps { onClose: () => void; initialItem?: SettingsMenuItem }

// src/components/Header.tsx(新增可选 prop,缺省 false,Web 旧调用零破坏)
interface HeaderProps { /* 既有字段不变 */ showSettingsAttention?: boolean }

// src/components/AdminSettings/components/ModelQuickStartCard.tsx
interface ModelQuickStartCardProps { onAddProvider: () => void }
```

### 4.3 Electron 主进程模块签名

```js
// desktop/main/envCheck.js
loadUserEnv(envPath: string): { env: Record<string,string>, missing: string[] }
// 删除导出:ensureRequiredEnv(唯一调用方 index.js 同步切换)
```

### 4.4 浏览器内约定

| 名称 | 类型 | 语义 |
|------|------|------|
| `ecliptrix-setup-guide-dismissed` | sessionStorage 键,值 `'1'` | 本次启动会话内不再弹引导(下次启动自动复位) |
| `ecliptrix-llm-config-updated` | `window` CustomEvent | 模型设置保存成功的广播;`useLlmConfigStatus` 监听并刷新 |

---

## 5. Data Model(数据模型)

**无数据库 schema 变更。** 复用既有 `model_providers` / `model_assignments` 表(`db_models.py`)与 `get_effective_config` 的「DB assignment 优先 → env 回退」解析语义。新增的状态仅存在于:① 后端无状态计算(每次请求即时 resolve);② 浏览器 sessionStorage 一个布尔键;③ React 组件内存状态(`LlmConfigStatus` 四值枚举,见 §4.2)。桌面 `userData/.env` 与 `desktop-config.json` 的文件格式均不变,变化只是 `.env` 的 LLM 键从「必填」降级为「可选回退」。

---

## 6. Testing & Acceptance Criteria(测试与验收标准)

### 6.1 自动化测试

- **后端 pytest**(`tests/test_config_llm_status.py`,SQLite 内存库,monkeypatch env;鉴权敏感路径不 mock,但本端点本就公开):
  1. `rejects_nothing_when_unconfigured`:无 env、无 DB → `configured=false, source="none"`;
  2. `treats_placeholder_env_as_unconfigured`:`LLM_API_KEY=your_llm_api_key_here` → `false/none`;
  3. `reports_environment_source`:真实格式 env 键 → `true/environment`;
  4. `prefers_database_assignment`:建 provider + CHAT assignment → `true/database`;
  5. `signals_indeterminate_on_resolution_failure`(R4):monkeypatch `get_effective_config` 抛异常 → HTTP 200 且 `success=false`;
  6. 响应体断言不含 `api_key`/`api_url` 字段(安全契约回归)。
- **前端 Vitest**(R1:项目测试栈为 Vitest + Testing Library,`npm test` = `vitest run`,**不是 Jest**;新测试文件沿用既有 `__tests__/*.test.tsx?` 命名):`SetupGuideDialog`(open=false 不渲染;两按钮回调;标题/三步骤文案渲染——焦点圈定/Esc/遮罩行为由 `ui/__tests__/Modal.test.ts` 既有覆盖,R3)、`useLlmConfigStatus`(enabled 门控;200+success/configured、200+success/unconfigured、网络错误→unknown、`success:false`→unknown(R4);收到 `ecliptrix-llm-config-updated` 后重新 fetch)。`npm run type-check` 通过;ModelSettingsPanel 既有测试(`__tests__/ModelSettingsPanel.*`)不回归。
- **Electron 冒烟**(`smoke-test.js`,改造后):零 LLM 配置打包件可在 90s 内双服务健康、root 登录成功、SQLite 落盘、`llm-status` 返回 `configured=false`、优雅退出无残留进程。

### 6.2 手动验收清单(在 `build.ps1` 全量构建产物上执行,不得用 `-SkipFrontend/-SkipBackend` 复用旧工件)

1. 删除 `%APPDATA%\Ecliptrix`(或用 `--user-data-dir` 指向空目录)启动安装包:**无任何「配置缺失」对话框**,直接进入主窗口登录页。
2. 用模板默认 root 账号登录 → `SetupGuideDialog` 弹出,样式与 §2.2-C3 规范一致(暗色模式下亦正常);Header 齿轮带琥珀色脉冲点。
3. 点「前往设置」→ 直达 设置 → **模型设置**,providers 空态显示三步快速开始卡片;走完 添加服务商 → 测试连接(真实 key)→ 分配 chat → 徽标熄灭;回到首页引导不再出现。
4. 点「稍后再说」→ 本次会话内任意导航不再弹;重启应用(仍未配置)→ 引导再次出现。
5. 未配置状态下发起 AI 对话 → 错误提示指向「设置 → 模型设置」,而非裸英文堆栈。
6. 配置完成后重启 → 无引导、无徽标,AI 对话正常出流。
7. Web 形态回归:`npm run dev` + 已配置 `.env` 后端 → 首页无引导、Header 无徽标、设置入口行为同旧版。

**Definition of Done**:6.1 全绿 + 6.2 七条全过。

---

## 7. Risks & Mitigations(风险与缓解)

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| 1 | 后端在零 LLM 配置下隐藏启动期崩溃(某服务 import/启动期读 key) | 中 | 已勘察:`main.py:72` 仅 warning,`chat_service`/`storyboard_service` 等均在调用期读取;冒烟测试改为零配置启动,把该回归固化为 CI 级断言 |
| 2 | `llm-status` 公开端点的信息暴露 | 低 | 仅 1 bit「是否配置」+ 来源枚举,无凭证字段;代码注释立禁止扩字段契约;复用既有公开前缀,不扩 allowlist |
| 3 | 占位值剔除改变可选键行为(如占位 PEXELS key 从「无效 key 报 401」变为「未配置降级」) | 低 | 这是修复而非破坏:恢复了各服务设计内的未配置降级路径;真实值不匹配 `your_*_here` 不受影响;在 env.template 注释中明示该规则。(R2)模板中火山 TTS 四占位值无 `_here` 后缀、不在剔除范围 → 文件#3 同步规整;存量 `.env` 仍含旧占位值时 TTS 行为与改造前一致(调用期鉴权报错),README 提示删除即可 |
| 4 | 引导弹窗打扰已配置/不相关用户 | 低 | 四重门控:仅管理员、仅 `unconfigured`(unknown fail-open 不弹)、会话级忽略、设置页打开时不弹;常驻提醒降级为齿轮徽标 |
| 5 | `ModelSettingsPanel.tsx`(1456 行,超 800 行阈值)继续膨胀 | 中 | 新 UI 强制外置 `ModelQuickStartCard.tsx`;面板内改动限定为两处空态替换 + 两行事件派发;既有测试守护表单行为 |
| 6 | 渲染端 sessionStorage 在受限 webview 下抛异常 | 低 | 读写均 try/catch 包裹(项目既有惯例,见 `playbackFlags.ts`),失败时退化为「每次都提醒」而非崩溃 |
| 7 | 验收时误用旧打包工件(改动在 frontend/backend 资源内,`-Skip*` 会复用旧产物) | 中 | 验收清单 §6.2 显式要求全量构建;smoke-test 的 llm-status 断言在旧工件上会 404 失败,形成兜底 |
| 8 | i18n 三处(interface/en/zh)漏改导致 type-check 失败或界面缺文案 | 低 | 变更计划逐键列出;`npm run type-check` 为 DoD 必过项 |
| 9 | 多语言/时序竞态:保存 provider 但未分配 assignment 且 env 为空 → 状态仍 unconfigured | 低 | 符合预期语义(CHAT 尚不可用);快速开始卡片第 3 步明示「分配给功能」,assignments 空态再次引导 |

---

## 8. 实施顺序建议(供下游开发节点)

1 → 2(Electron 拆闸,可独立验证「能打开」)→ 6 → 7(后端端点 + 单测)→ 8 → 9(前端数据链路)→ 16(i18n,先行避免 TS 报错)→ 10 → 11 → 12 → 13(引导 UI 接线)→ 14 → 15(设置面板打磨)→ 17(文案顺手项)→ 3 → 5(模板与文档)→ 4(冒烟改造)→ 全量 `build.ps1` + §6.2 手动验收。

---

## 实施过程发现的方案缺陷(Issues Found During Implementation)

| # | 位置 | 缺陷 | 实际处置 |
|---|------|------|----------|
| I1 | §2.2-C2 / §4.2 | 钩子示例代码使用裸 `fetch('/api/config/llm-status')`,但项目 ESLint 规则(`no-restricted-syntax`)禁止直接 `fetch('/api/...')`,强制走 `@/lib/api/http-client` 包装器 | `useLlmConfigStatus` 改用 `http.get<LlmStatusResponse>('/api/config/llm-status', { requireAuth: false })`——该端点公开,`requireAuth:false` 同时避免偶发 401 触发全局会话过期跳转;所有异常路径(网络错误 / 非 200 / 解析失败)经 catch 统一映射 `'unknown'`,与 §2.2-C2 的 fail-open 语义完全一致 |
| I2 | §6.1 前端测试 | 方案预期 `SetupGuideDialog.test.tsx` 做渲染断言,但项目 Vitest 配置无 `@vitejs/plugin-react`,无法挂载 JSX(既有惯例见 `ui/__tests__/Modal.test.ts`、`ModelSettingsPanel.form.test.tsx` 的文件头说明) | 按项目既有惯例改为源码契约测试(source-level regex assertions):验证组合 `ui/Modal`、不重复实现焦点圈定/Esc、ARIA id 接线、三步骤 i18n 键、双按钮回调与 `autoFocus`;`useLlmConfigStatus.test.ts` 为纯钩子,可用 `renderHook` 真实挂载,四态映射/门控/事件刷新均为行为级断言 |
| I3 | (记录)`src/lib/api/server/__tests__/backend-proxy.test.ts` | 全量 `npm test` 有 2 个**预先存在**的失败(builder 路径 + query string 转发断言),由历史提交 27b095c 将 query 转发扩展到所有 HTTP 方法后未同步更新测试所致;工作区中该文件无本轮改动 | 非本轮范围,不修复不掩盖;本轮新增 16 项前端测试与 6 项后端测试全部通过 |

---

## 评审结论(Review Verdict)

**通过(Approved)**

- 共识别 8 项问题:0 项 P0、3 项 P1(R1 测试框架误写 Jest→已改 Vitest;R2 火山 TTS 占位值漏剔除→已扩文件#3 范围并补遗留缓存说明;R3 对话框骨架重复造轮子→已改组合 `ui/Modal`)、5 项 P2(R4-R7 已顺手修入正文,R8 经核查无需改动)。**全部 P0/P1 已直接修复合入 v2 正文,无遗留阻塞项。**
- 方案的核心判断经代码实证全部成立:启动闸是纯前置防御(后端对空 LLM 凭证仅 warning)、应用内模型凭证系统(`model_settings_*` + 设置面板)完整可用、`/api/config/` 公开前缀无需动中间件——「拆闸 + 状态端点 + 引导 UI」的最小侵入路线是正确的体量选择。
- 对下游开发节点的两点强调:① §6.1 测试一律用 **Vitest**(`npm test`),不要引入 Jest;② `SetupGuideDialog` 必须组合 `src/components/ui/Modal.tsx`,不得自行实现焦点圈定/Esc/遮罩逻辑。
- 验收以 §6 为准(后端 6 项 pytest + 前端 Vitest + 零配置冒烟 + 7 条手动验收),其中冒烟测试的「零 LLM 配置可完整启动」断言是本轮需求的回归底线。
