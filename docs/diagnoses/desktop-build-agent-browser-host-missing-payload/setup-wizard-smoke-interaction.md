# 诊断:首启向导(SetupWizard)与冒烟门禁的指针交互

- **触发**:`gate-soak2-summary.md` 观察到 5 次门禁中 3 次的失败报告里
  出现首启向导文案(`Let's connect your AI` / `Connect a provider` /
  `Maybe later`),并把它列为「覆盖层吞掉合成点击」的候选 1。
- **本文件回答一个问题**:在**刮除凭据的隔离 profile + 全新 userData**这一
  固定前提下,向导打开是不是**必然**,产品/门禁的**正确交互**是什么。
- **结论一句话**:向导在全新 profile + 零可用的 LLM 配置下**必然打开**,
  而且**每次重载都会重新打开一次**(除非本会话已经点过「稍后再说」);
  仓库里**不存在**任何「预置状态让向导不开」的受支持机制;向导同时具备
  **全屏遮罩拦截指针** 与 **抢焦点/吃 Escape** 两种机制,**两者都是**。
  门禁应当**确定性地**走产品自己的「稍后再说」关闭路径,并把向导行为
  单独断言;不能靠 `reopen()` 里的机会主义点击。
- **所有结论均来自读代码与读取门的产物**,我没有启动打包应用,也没有跑
  门禁(那是并行 agent 的职责)。

---

## 1. 向导打开的条件(逐条,带行号)

### 1.1 自动模式(`auto`)

唯一入口是根页面的一个 effect(`src/app/page.tsx:80-87`):

```ts
const shouldAutoOpen =
  hydrated
  && setupStatus === 'needs-setup'
  && !setupGuideDismissed
  && !isSettingsOpen;
if (shouldAutoOpen) setWizardMode((current) => current ?? 'auto');
```

四个条件缺一不可:

| # | 条件 | 证据 |
|---|---|---|
| C1 | 任务库已 hydrate(`hydrated`) | `src/app/page.tsx:81` |
| C2 | `setupStatus === 'needs-setup'` | `src/app/page.tsx:82` |
| C3 | 本会话未点过「稍后再说」 | `src/app/page.tsx:83` |
| C4 | 设置页没打开 | `src/app/page.tsx:84` |

`setupStatus` 的取值(`src/hooks/useSetupStatus.ts:92-95`):
`capabilities === null` → `loading`(或不含向导的 `unknown`),
否则 `hasSetupGap(...) ? 'needs-setup' : 'complete'`。

`hasSetupGap`(`src/hooks/useSetupStatus.ts:22-31`):

```ts
capabilities.some((c) => isGap(c) &&
  (c.tier === 'core' || !optOuts.includes(c.id)))
```

- `isGap` = 状态是 `missing` 或 `invalid`
  (`src/lib/api/setupStatus.ts:66-69`)。`indeterminate` **不是** gap。
- **core 永远算 gap,没有任何 opt-out 通道**(`useSetupStatus.ts:29`)。
- extended(`research` / `web_search`)只有在用户没勾选「不用它」时才
  算 gap;opt-out 白名单只含这两个 id
  (`src/lib/setupOptOut.ts:8-10`,存储键 `ecliptrix-setup-optouts`,
  见 `setupOptOut.ts:19,29`)。

tier 由后端判定,不在前端猜:
`chat` / `fast` / `video_cut` 是 `_direct_slot`,硬编码 `tier="core"`
(`backend-services/basic-service/app/services/setup_status_service.py:84-88`);
`vision` 是 `_staged_slot(..., "core", ...)`(`同文件:135`);
`research` 是 `extended`(`同文件:136`),`web_search` 是 `extended`
(`同文件:120,139`)。

### 1.2 手动模式(`manual`)

`rerunSetupWizard`(`src/app/page.tsx:118-121`)由设置页的
`onRerunSetupWizard`(`同文件:152`)触发,**完全不看 `setupStatus`**,
且 manual 模式把**所有**槽位都算进流程
(`src/components/Onboarding/wizard/wizardSteps.ts:39-40,57-59`)。

### 1.3 失败/异常路径(不会打开)

- 状态查询失败 → `unknown`(`useSetupStatus.ts:75-76`),
  fail-open,向导**不**打开;重试间隔 1/2/4 s
  (`useSetupStatus.ts:16,71-74`),全部失败后不再重试。
- 后端解析器整体异常 → `success:false` → 前端抛错 → 同上
  (`src/lib/api/setupStatus.ts:47-54`;
  `app/routers/config_router.py:83-90`)。

### 1.4 只挂载在需要时,不是隐藏

`SetupWizard` 只在 `wizardMode` 非空时渲染
(`src/app/page.tsx:169-177`)。所以「DOM 里没有
`[aria-labelledby="setup-wizard-title"]`」= 向导确实没开,
门禁可以据此做存在性断言。

---

## 2. 刮除凭据后 `capability-status` 到底返回什么

这是本题的核心:如果返回里仍有 `ready`,向导就不会开,门禁无需处理。

**实测(打包态,第 19 次门禁)**:`failure.json` 的 `body` 是
产品自己渲染出来的清单(`.agentmesh/cover-finalization-runtime/
ecliptrix-smoke-vDYymr/artifacts/failure.json`):

```
Chat & agent            Needs setup
Quick model             Needs setup
AI mixed editing        Needs setup
Visual review           Incomplete
Research                Incomplete
Web search              Needs setup
```

对照 i18n 文案(`src/lib/i18n.ts:7239-7245`):
`missing` → `Needs setup`,`invalid` → `Incomplete`。
即:`chat/fast/video_cut/web_search = missing`,
`vision/research = invalid`。**六项全是 gap**。

后端如何得到这个结果(逐项):

- **chat / fast / video_cut**:直接槽位,要求 api_key、api_url、
  model_name 三者都可用,缺一即 `missing`
  (`setup_status_service.py:63-73`)。
- **vision**:沿 `[vision, chat, fast]` 取第一个可用凭据,都没有则
  `missing`;解析抛 `configuration_invalid` 时是 `invalid`
  (`setup_status_service.py:38-42,91-100`)。零键时三者皆空,
  实际观测到 `invalid`。
- **research**:同上,沿 `[research, fast, chat]`
  (`setup_status_service.py:43-47,136`)。
- **web_search**:`usable_keys()` 为空即 `missing`(需要 Tavily 键)
  (`setup_status_service.py:113-120`)。

`is_usable_secret` 还额外把模板占位符 `your_*_here` 当成不可用
(`setup_status_service.py:27-29,50-53`),所以**即使**模板 `.env` 漏进
运行时也不会误判成已配置。

**凭据为什么一定是空的**(三重保证,缺一不可):

1. 门禁写的是**空** `.env`(`desktop/scripts/smoke-test.js:1252`),
   注释写明「deliberately no keys of any kind」
   (`同文件:1235-1238`);
2. 后端子进程的环境是 `{ ...process.env, ...userEnv, ... }`
   ——**继承启动器的宿主环境**
   (`desktop/main/backendService.js:40-42`),所以必须靠启动器刮除;
   `final-gate-19.log:2` 记录了刮除的 14 个变量,含 `LLM_API_KEY` /
   `LLM_API_URL` / `LLM_MODEL` / `ZENMUX_API_KEY` / `ARK_API_KEY`;
3. 门禁自己另有一条断言,要求 `llm-status` 返回
   `success:true, configured:false`
   (`smoke-test.js:1322-1333`)。

我核对了当前 shell 的环境(只打印是否 SET):`LLM_API_KEY` /
`LLM_API_URL` / `LLM_MODEL` / `ZENMUX_API_KEY` 已设且**都在刮除名单里**,
而 `FAST_LLM_*` / `VIDEO_CUT_LLM_*` / `VL_LLM_*` / `RESEARCH_LLM_*` /
`TAVILY_*` 全未设。**结论:在今天的启动器下,scrub 之后必然零可用配置,
三个 core 能力必然是 `missing`,向导必然打开。**

> 附带风险(不影响本结论,但值得记一笔):刮除名单是**枚举**式的,
> `FAST_LLM_API_KEY`、`VIDEO_CUT_LLM_API_KEY`、`VL_LLM_API_KEY`、
> `TAVILY_API_KEYS` 不在其中。哪天宿主 shell 导出了这几个变量,
> 相应能力会变 `ready`,向导可能自己就不开了 —— 门禁对向导的断言
> 需要能区分「本应打开却不是」与「本来就不该打开」。

### 2.1 每次挂载都重开,还是只在首次?

- 自动模式的判定在 **effect** 里(`src/app/page.tsx:80-87`),
  所以**每次挂载根页面都会重新判定一次**:重载、新窗口、新进程都算。
- 「本会话已关闭」只存在 **sessionStorage**
  (`src/app/page.tsx:18-21,59-68,70-75`),键名
  `ecliptrix-setup-guide-dismissed`(`同文件:20`)。
  该注释明确写:**下次启动若仍未配置就再提示,但同一会话内不提示第二次**。
- 结论:**同一次门禁运行内**,`Page.reload` 保留 sessionStorage,
  所以点过一次「稍后再说」之后整个 run 都不会再开;
  但**没点过的那次重载之后,它一定会在 capability-status 解析完成时挂载**。
- 关键时序:向导挂载时刻 = 状态查询完成时刻,而 `reopen()` 里的
  「未就绪」判断发生在 `Page.loadEventFired` 之后立即
  (`smoke-test.js:865-867`)。此时 fetch 还在飞(超时 5 s,
  失败重试 1/2/4 s,见 `useSetupStatus.ts:16,51`),DOM 里**还没有**
  向导。所以 `reopen()` 那次机会主义点击常常**什么都没点到**,
  之后向导才挂上来,并且再无代码去关它。

---

## 3. 有没有「受支持的」跳过向导的预置机制?

**没有。逐条查证如下,结论是必须靠产品自己的关闭路径。**

- **`desktop-config.json` 加字段**:结构只有 `schemaVersion` /
  `frontendPort` / `backendPort` / `windowBounds` / `lastRunVersion`
  (`desktop/main/config.js:13-21`),门禁整份写入
  (`smoke-test.js:1251`)。**没有**向导相关字段。
- **userData 里的 `seen` / `dismissed` 状态文件**:主进程只建
  `data/storage/logs`,并在缺 `.env` 时拷模板
  (`desktop/main/config.js:28-50`)。**不存在**。
- **环境变量开关**:主进程只读 `ECLIPTRIX_LOG_LEVEL` /
  `ECLIPTRIX_LOG_DIR`(`desktop/main/index.js:32,120-121`)与
  `ECLIPTRIX_RESEARCH_CDP_PORT` / `_CONTROL_PORT`
  (`同文件:269-271`)。**没有 skip 开关**。
- **`localStorage['ecliptrix-setup-optouts']`**:白名单只含
  `research` / `web_search`(`src/lib/setupOptOut.ts:10`),core
  不能 opt-out(`useSetupStatus.ts:29`)。**即使预置也关不掉**
  (chat/fast/video_cut 仍是 gap)。
- **`sessionStorage['ecliptrix-setup-guide-dismissed']`**:存在,
  但只由产品自己的关闭/去设置路径写入
  (`src/app/page.tsx:70-75,102-116`)。它是**产品行为**,
  不是预置 API;门禁可以在首帧前注入它(见下)。
- **预置 DB 里的模型配置**:需要**真实**可用键才会 `ready`
  (`setup_status_service.py:63-73`),与门禁「零配置启动」的既有
  断言(`smoke-test.js:1322-1333`)直接冲突,不可用。


门禁里**已经存在**唯一一种「预置浏览器存储」的技术:
`Page.addScriptToEvaluateOnNewDocument` 注入 locale
(`smoke-test.js:854`)。如果确实要预置,这就是现成钩子,不是新机制。

**推荐(最小正确改法,按优先级)**:

1. **确定性关闭(首选,不新增机制)**:在每个 `reopen()` 之后,
   显式等待「向导决策已完成」,再关掉它并**等它离开 DOM**:
   轮询到 `[aria-labelledby="setup-wizard-title"]` 出现 → 点
   「稍后再说」(`OverviewStep.tsx:47`,文案 `Maybe later`
   `src/lib/i18n.ts:7176` / 中文 `稍后再说` `src/lib/i18n.ts:11089`)
   → 轮询到该选择器消失;若超时窗口内没出现,则要求
   `capability-status` 已返回且 DOM 中确实没有向导。
   这一步走的是**产品真实的关闭路径**,顺便就验证了产品。
2. **前置守卫(与并行 agent 的 press 修复正交)**:`pressWithPointer`
   派发前断言 `document.elementFromPoint(x, y)` 落在目标内
   (现有 `pressWithPointer` 只算坐标,`smoke-test.js:367-380`);
   若命中的是向导,直接以「向导遮罩拦截」这一条明确报错,
   而不是伪装成「dialog 没打开」。
3. **首帧预置(可选,只在某些场景)**:复用 `smoke-test.js:854` 的
   注入点写 `sessionStorage`,让非向导用例不受打扰。
   但**不能只做这一条**,否则产品的首启行为就再也没人测了。

---

## 4. 症状到底是怎么发生的:遮罩还是抢焦点?

**两者都有,而且遮罩是主因。**

### 4.1 全屏遮罩 + 点击被静默吞掉

向导把 `Modal` 的根样式**整段覆盖**成全屏固定层
(`src/components/Onboarding/SetupWizard.tsx:64`):

```
className="fixed inset-0 z-[100] flex items-center justify-center
           bg-black/50 p-4 backdrop-blur-sm"
```

- `Modal` 的根 div 就是这个 `className` 的宿主,并挂 `onClick`
  (`src/components/ui/Modal.tsx:77-83`),而向导传
  `closeOnBackdrop={false}`(`SetupWizard.tsx:61`)——
  于是点在遮罩上**既不关闭、也不透传**,纯粹被吃掉。
- `.cover-studio` 只是普通流的 `<section>`
  (`src/components/video/cover/CoverStudio.tsx:235`),
  **没有任何 z-index**,所以 `fixed` + `z-[100]` 必然盖在上面。
- 顺带一条规范问题:仓库的语义 z 轴是
  `overlay:900 / modal:1000`(`tailwind.config.js:132-143`),
  向导却用 `z-[100]` 覆盖掉默认的 `z-modal`,违反该文件注释里
  「不要用 `z-[NNN]` 任意值」的约定。功能上仍盖住工作区,但属于债。

### 4.2 抢焦点 + 吃 Escape

- 挂载即抢焦点:`Modal` 的 effect 里
  `if (root && !root.contains(document.activeElement)) root.focus();`
  (`src/components/ui/Modal.tsx:39-41`),并记录「之前焦点」以便关闭时归还
  (`同文件:70-71`)。
- 概览页的主按钮 **autoFocus**
  (`src/components/Onboarding/wizard/OverviewStep.tsx:50`),
  这是「Get started」,样式 `BUTTON_PRIMARY`
  (`OverviewStep.tsx:50`,`wizardStyles.ts:5`)。
- 文档级 keydown 监听把 Escape `preventDefault()` 后交给向导关闭
  (`src/components/ui/Modal.tsx:43-50`),Tab 在向导内部循环
  (`同文件:51-65`)。也就是说:向导开着时,Escape 属于向导而不是
  原生 `<dialog>`。

### 4.3 与本次 soak 观测对齐

第 19 次的 probe(`final-gate-19.log:141`)关键字段:

- `activeClass` = `inline-flex items-center justify-center gap-2 rounded-lg
  bg-primary px-4 py-2 …` —— 把 `${MOTION}` 与 `${FOCUS_RING}`
  展开后**逐字等于 `BUTTON_PRIMARY`**
  (`src/components/Onboarding/wizard/wizardStyles.ts:1-7`,我用脚本
  比对过两串),即**向导的主按钮**。`wizardStyles.ts` 只被向导自己的
  6 个文件 import(`SetupWizard.tsx:15`、`OverviewStep.tsx:8`、
  `ModelsStep.tsx:16`、`ProviderStep.tsx:17`、`SearchStep.tsx:15`、
  `DoneStep.tsx:8`),所以这串 class 在打包态 DOM 里**唯一**
  指向首启向导,不存在别的候选人;
- `activeInDialog:false`、`activeInStudio:false` —— 焦点既不在预览
  dialog,也不在封面工作区;`studioPresent:true`。
- `dialogOpen:false`(33/33)—— 预览 dialog **从未打开**。

所以 soak 观测到的「press 被吞」与 **4.1 遮罩拦截**一致;
**4.2 抢焦点**则由 `activeElement` 落在向导主按钮上单独证实
(它是遮罩在场的旁证,不是 dialog 未打开的原因)。

### 4.4 一条必须说清的反证

soak 自己的数据(`gate-soak2-summary.md:87-89`)显示:
`05:57`、`16`、`18` 三次失败时**向导是关闭的**,其中两次
`activeTag:"BODY"`。所以:

- 向导开着是**充分原因**(遮罩必然吞掉 press);
- 但它**不是必要条件** —— press 本身还有第二个缺陷
  (`Input.dispatchMouseEvent` 不带 `buttons` 字段,
  `smoke-test.js:376-379`,归并行 agent 的 press 修复)。
- **两件事都要修**:只修 press,向导仍会在 3/5 的运行里吞点击;
  只确定性关向导,另外 2/5 的运行仍会红。
- 另注意 `failure.json.body` 是**失败之后**抓的
  (`smoke-test.js:1114`),不是 press 那一刻;它只能证明
  「press 之后约 10 s 内向导在场」,不能证明「press 时它已在」。
  与 3.x 的时序分析一致:向导很可能就是在 settle 窗口里挂上来的。

---

## 5. 产品角度:这是不是一个该被门禁抓住的 UX 问题?

坦白说:**首启拦一次是合理的,每次启动都拦是不合理的。**

- 合理的一面:零配置时聊天/混剪/研究全部不可用,向导是这个单用户
  桌面应用**唯一**把凭据带进来的入口(CLAUDE.md:74 与
  `smoke-test.js:1235-1238` 都把「零配置也要能启动到工作区、
  由 in-app setup guide 处理键」写成了产品契约)。所以首启模态
  不是 bug。
- 不合理的一面:「稍后再说」**只记在 sessionStorage**
  (`src/app/page.tsx:18-21`)——用户明确表达了「先不配」,
  下一次启动却仍然被同一个模态挡住。**持久的是缺失状态,
  不是用户的决定**。这在单用户本地应用里是明确的体验缺陷:
  用户第一次已经做过选择,却每次开机都要重做一遍。
  已有现成替代入口(设置页 → 重新运行向导,
  `src/app/page.tsx:118-121`),所以持久化关闭不会让用户失去入口。

**建议(分工明确)**:

1. **门禁侧(现在就做,不改产品)**:不要放宽断言,也不要把
   失败归因成「门禁自己太脆」。按 §3 的推荐 1 + 2 做:
   确定性关闭 + `elementFromPoint` 守卫。门禁的目标是
   「在有向导的前提下依然完成指针用例」,而不是「假设没有向导」。
2. **产品侧(另立改动,不在本任务范围)**:把
   `ecliptrix-setup-guide-dismissed` 从 sessionStorage 提到
   localStorage(或按 `lastRunVersion` 记一次),让「稍后再说」
   真正成为用户的持久决定;`needs-setup` 仍通过
   `showSettingsAttention`(`src/app/page.tsx:127`)与设置页的
   注意点(`wizardSteps.ts:75-84`)提示。**改完之后门禁的
   「每次重载都重开」这条断言需要同步改成「每次全新 profile 才重开」。**
3. 顺带把 `SetupWizard.tsx:64` 的 `z-[100]` 换成语义档位
   (`tailwind.config.js:132-143` 要求),避免以后再出现
   「谁的任意 z 值更大」这类问题。

---

## 6. 门禁应当对向导断言什么(有意覆盖,而不是碰巧覆盖)

选择器建议:`[aria-labelledby="setup-wizard-title"]`(Modal 的
dialog 根,`src/components/ui/Modal.tsx:85-91`;id 来自
`src/components/Onboarding/wizard/StepHeading.tsx:11`)。

1. **全新 profile 必然出现**:启动并等 `capability-status` 完成后,
   该 dialog 必须在场,且标题/步骤条与
   `src/lib/i18n.ts:7164-7173` 一致(至少 `Overview` +
   `Connect a provider` 两步存在)。
2. **「稍后再说」能关掉它**:点 `Maybe later`(`i18n.ts:7176`,
   中文 `稍后再说` `i18n.ts:11089`),轮询到 dialog **从 DOM 消失**
   (不是 `hidden`),并断言
   `sessionStorage['ecliptrix-setup-guide-dismissed'] === '1'`
   (`src/app/page.tsx:20,72`)。
3. **同会话重载不再出现**:一次 `Page.reload` 之后再等一次
   `capability-status`(留足 5 s + 重试余量),断言 dialog 仍不存在。
   —— 这条正好把「sessionStorage 语义」钉死,防止有人把它改成
   localStorage 而无人察觉。
4. **关闭后不残留焦点**:`document.activeElement` 不在
   `[aria-labelledby="setup-wizard-title"]` 内
   (回归第 19 次里 `activeInStudio:false` 的现象)。
5. **指针用例前置守卫**:任何 `pressWithPointer` 之前断言
   `elementFromPoint` 命中的不是向导;命中即报
   「setup wizard overlay intercepted the press」(明确缺陷名,
   而不是 `dialog 没打开`)。
6. **顺序**:上述 1–3 必须排在所有指针用例之前执行一次,
   并让 `reopen()` 之后**显式等待向导决策完成**,
   而不是在同一次 `evaluate` 里顺手点一下
   (`smoke-test.js:868-874` 的现状)。

---

## 7. 未能核实 / 故意没做的事

- **没有启动打包应用,也没有跑门禁**(并行 agent 正在跑,并发会污染
  端口与进程检查)。所以本文没有新增的运行时观测:
  `capability-status` 的原始 JSON 我**没有**直接取;
  第 2 节里的六项状态是从第 19 次运行的 `failure.json` 的
  `body`(产品渲染的清单)反向确定的,不是接口原文。
- **没有验证**向导从挂载到出现的真实时延(是否真的落在 settle
  窗口内)。依据只有:effect 在 fetch 完成后才置 `needs-setup`
  (`useSetupStatus.ts:59-77`)、以及 `reopen()` 紧贴
  `loadEventFired` 就下判断(`smoke-test.js:865-874`)。
  要证实需要一次带 `performance.now()` 打点的门禁运行。
- **没有确认** Ctrl+F5 之外是否存在其它清空 sessionStorage 的路径
  (例如主进程重建窗口)。本次 run 中窗口只 `Page.reload`,
  所以「点过一次就整 run 不再开」这个推论只在 reload 语义下成立。
- **没有核实** `vision`/`research` 为什么是 `invalid` 而不是
  `missing`(需要 `WebResearchError.configuration_invalid` 的具体
  触发点,见 `setup_status_service.py:94-98`)。对本题无影响:
  两者都算 gap。
- 关于 press 本身的缺陷(缺 `buttons`、坐标在
  `setDeviceMetricsOverride` 后过期)我**只做了引用**,
  没有复核 —— 那是并行 agent 正在修的部分。

---

## 8. 证据索引

| 主题 | 位置 |
|---|---|
| 自动打开的四条件 | `src/app/page.tsx:80-87` |
| core 永不可 opt-out | `src/hooks/useSetupStatus.ts:29` |
| gap 定义 | `src/lib/api/setupStatus.ts:66-69` |
| 状态四态与重试 | `src/hooks/useSetupStatus.ts:13,16,59-95` |
| opt-out 只限 extended | `src/lib/setupOptOut.ts:8-10` |
| sessionStorage 关闭键 | `src/app/page.tsx:18-21,59-75,102-116` |
| 手动模式入口 | `src/app/page.tsx:118-121,152` |
| 后端能力判定 | `setup_status_service.py:50-73,91-120,131-138` |
| 占位符不算密钥 | `setup_status_service.py:27-29` |
| capability-status 路由 | `app/routers/config_router.py:76-90` |
| 后端继承宿主环境 | `desktop/main/backendService.js:40-42` |
| 刮除 14 个变量 | `final-gate-19.log:2` |
| 空 `.env` 与零配置契约 | `smoke-test.js:1235-1238,1252,1322-1333` |
| 机会主义关闭(现状) | `smoke-test.js:864-876` |
| press 的派发点 | `smoke-test.js:367-380,454-468` |
| `failure.json` 是事后抓取 | `smoke-test.js:1114` |
| 遮罩样式与 `closeOnBackdrop` | `SetupWizard.tsx:61,64`;`ui/Modal.tsx:77-83` |
| 抢焦点 / Escape 归属 | `ui/Modal.tsx:39-41,43-50`;`OverviewStep.tsx:50` |
| `BUTTON_PRIMARY` 逐字匹配 | `wizardStyles.ts:5` vs `final-gate-19.log:141` |
| 语义 z 轴 | `tailwind.config.js:132-143` |
| 状态文案 | `src/lib/i18n.ts:7239-7245`(en)、`11073-11089`(zh) |
| 向导按钮文案 | `src/lib/i18n.ts:7174-7176`;`OverviewStep.tsx:43-52` |

写于 2026-10-29。本文件只做诊断与建议,**没有改动任何代码**。
