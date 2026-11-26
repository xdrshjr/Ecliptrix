# Agent 浏览器工作台 · 迭代 3（r3）收口方案 · 产品级设计 v2

> **文档**：`docs/plans/agent-browser-workspace-r3/spec.md`
> **版本**：**v2**（v1 = 初稿；v2 = 依 `## 评审记录` 修复 2 条 P0 + 7 条 P1 后的定稿）
> **性质**：迭代 3 的**唯一设计依据**。本节点只产出设计，不写实现代码。
> **前置**：
> - 迭代 1 蓝图 `docs/plans/agent-browser-workspace/spec.md`（v2，已提交 `4e1ad78f`，CLAUDE.md 的「Agent browser workspace」小节即其摘要）。
> - 迭代 2 增补同文件「迭代 2 增补（v2.2）」节（W1–W9），实施结果在同目录 `acceptance.md` 的「迭代 2 · 收口与硬化验收记录」（I2-1…I2-6）。
> - 本文件**不重复**已完成的架构、工具面、UI 结构设计；只处理迭代 2 收尾时**仍然敞开**的四件事。
>
> 阅读顺序建议：第 1 节看「为什么还要一轮」→ 第 2 节看每条工作流的可实施细节 → 第 3 节照表落代码 → 第 6 节照表验收。

---

## 评审记录（Review Notes）

> 评审对象：本文件 **v1**。评审方法：不采信文中数字，逐条回源码/命令复核（v1 第 1 节自己立的规矩：「不是功能能跑，而是每条验收标准都有证据」）。下列每条都注明**复核方式**，可原样重跑。
>
> **结论先行**：v1 的**诊断全部成立**（四处敞开的债、4 条红断言、悬空引用、面板不看 `dockViewportRect` 均实测确认），**矛盾算术证明（§2.1.1）也是对的**。问题出在**修复方案本身**：E1 的删减对象在源码里**不存在**（P0-3）、E1 少算了一条同源断言（P0-1）、E4 漏了坐标系换算（P0-2），另有 9 条 P1 会让实施节点在确定性边界上卡住或产出假证据。**均已在本版正文修复**，逐条「处理」列指向修复位置。

### 问题总表

| ID | 严重度 | 位置（v1） | 问题 | 处理 |
|---|---|---|---|---|
| **P0-3** | **P0** | §2.1.3 / §3.1 / AC-R3-2 | E1 唯一的减字对象「`同轨不可重叠`段内的重复示例句」**在源码中不存在**：该段全文 620 字符且**不含任何「例如/举例/示例/比如」**。v1 的减字路径无法执行，AC-R3-2 又是硬门禁 ⇒ 实施节点必卡死 | 已修（§2.1.3 改为「两段等义压缩 + 规则清单不变」并给出可核对的 12 条规则锚点；§3.1、AC-R3-2、§7 R-3 同步） |
| **P0-1** | **P0** | §2.1.2 / §2.1.3 / §3.1 | E1「收 76 字符 → 无索引转绿」**不成立**；`.test.ts:76` 还有第三处 18 900 硬上限未纳入方案，且与 §2.1.2 的「18 500 语义收紧」语义冲突 | 已修（§2.1.4 新增「同源断言清理」逐条列出 6+2 处；`agent.ts:259` 运行时告警计入影响面） |
| **P0-2** | **P0** | §2.4 | `dockViewportRect` 是**视口坐标**（`getBoundingClientRect`），`avoidDockRect` 在**父容器坐标**里算 → 两套坐标系直接比，避让必然算错 | 已修（§2.4 增「坐标系与换算」小节 + 契约增 `dockRectOffset`；§5.3 同步） |
| **P1-1** | P1 | §2.1.4 | `promptBudget.ts` 放 `__tests__/helpers/` 会被 `vitest.config.ts` 当测试文件收集（**空测试套件即失败**） | 已修（§3.1 改为 `__tests__/fixtures/promptBudget.ts`，并说明理由） |
| **P1-2** | P1 | §2.2 | `loginHeuristics.js` 与 `pageScripts/*.js` **不在** `build.js` 的 `BROWSER_WORKSPACE_MODULES` 里 → 检查 1 失败而检查 3 通过，自相矛盾；且未写明产物根目录名 | 已修（§2.2 增「补充既有债」步 + 先失败门禁；产物根明确为 `win-unpacked`；`appDir` 解析算法显式化） |
| **P1-3** | P1 | §2.2 | 打包后主进程在 `app.asar` 内（`asar: true`），检查 1 只搜 `<appDir>/resources/**` 会找不到 → **必然假红** | 已修（§2.2 表：解包目录优先 + `app.asar` 用 `require('asar')` 只读遍历，禁自研 parser） |
| **P1-4** | P1 | §2.3 / §4.3 | v1 两处命令 `node scripts/check-walkthrough-table.js` **跑不起来**（脚本要编辑 `acceptance.md` ⇒ 须在**仓库根**执行，而 `desktop/scripts/` 是相对 `desktop/` 的路径） | 已修（§4.3 按执行目录分组，逐个标注 cwd；脚本内改为 `__dirname` 锚定仓库根） |
| **P1-5** | P1 | §6.2 AC-R3-6 | 验收只查「每行有结论」，而填入「未执行」就满足 → **合规的假证据**；且「①②③ 编号 + 列名即契约」未落到脚本契约上 | 已修（AC-R3-6 增三档 `已执行/未执行/阻塞` 判据 + 按 E2 门禁的硬性交叉校验） |
| **P1-6** | P1 | §2.1.2 / §7 R-1 | 19 800 是涨了**两条**测试上限，而运行时唯一防线 `agent.ts:259` 只是 `console.warn` → 「不再被忽略」这句不成立 | 已修（§2.1.2 拆清「测试 pin」与「运行时告警」两件事；R-1 补运行时影响与替代保障） |
| **P1-7** | P1 | 全文 | v1 用**不存在的相对路径**指认位置：`browserWorkspaceCopy.ts`（实为 `src/lib/browserWorkspaceCopy.ts`）、`BrowserDock.test.tsx`（实为 `src/components/browser/__tests__/BrowserDock.test.tsx`）→ 实施节点会照错路径找 | 已修（§2.4、§2.2、§3 全部改为核对过的真实路径 + 行号） |
| **P1-8** | P1 | §3.4 / §6.2 AC-R3-8 | 声称 `AgentChatFloatingPanel` 有「12 个生命周期测试」、`BrowserViewport.tsx` 改动须为空 —— 但未给出**基线数字的来源命令**，验收时无法判定 | 已修（§6.1 增「基线登记」四行命令，AC-R3-8 改为引用可复算的基线） |
| **P2-1** | P2 | §2.1.1 | 「索引段 1 093」的构成算错：`MAX_INDEX` 是 10×104 字符 + 9 换行 = **1 049**，非 10×104+9×1 的表述；且 `description` 为 `'描'.repeat(60)` | 已修（§2.1.1 改为按 `formatSkillIndex` 实测口径重写） |
| **P2-2** | P2 | §5.1 | 基线 JSON 的 `noIndexTotal: 18400` 与 `fullIndexTotal: 19493` 差值 1 093 成立，但与 §2.1.3「目标收回 ≥116」对不上（18 576−116 = 18 460） | 已修（§5.1 改为「实测后重写、且 ≤ 本表」并给出 18 460 的推导） |
| **P2-3** | P2 | §2.2 表 | `verify-no-bundled-secrets.js` 实际扫描「asar 条目」而非源码目录，「对新模块无误报」一句口径含糊 | 已修（§2.2 表改为对 `app.asar` 条目扫描，与 §4.3 命令一致） |
| **P2-4** | P2 | §2.1.4 | `/** @vitest-environment node */` 写「首行」——但它必须在 import 之前，仍属「首行」语义；真正的坑是它只影响**该文件**，而 `npm test` 全量仍会在别处碰到 `node:crypto` | 已修（§2.1.4 补「不宣称修好全量」的边界说明） |
| **P2-5** | P2 | §7 O-2 | 开放问题 O-2 已有明确推荐却仍列为「开放」→ 实施节点会停下来问 | 已修（O-2 改为**已裁决**，移出开放问题） |

### P0/P1 逐条详述（含证据）

**P0-1 · E1 的修法漏了同源断言，方案在当前形态下不可能全绿。**

- 复核方式：先跑 `npx vitest run --environment node src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts` → **`4 failed | 32 passed (36)`**，失败值 `19 673 > 18 500` / `18 576 > 18 500` / `1 606 > 400` / `18 576 > 18 500`，与 v1 §2.1.1 表格**完全一致**（v1 的实测无误）。
- 但 v1 §2.1.2/§2.1.3 只处理了 `.test.ts:84`、`:154-157`、`:159`、`:335` 与 `subtitleDisclosure:112-113`，**漏掉 `.test.ts:76-79`**：`it('stays under the 18900-char ceiling with plan and memory injected')` 断言 `prompt().length ≤ 18_900`（无索引，实测 18 576，**现在是通过的**）。它与 v1 的「`L0_NO_INDEX_CHAR_MAX = 18 500` 语义收紧为不含索引段的最坏提示词上限」**直接冲突**：任何按 18 900 写的断言，在语义收紧后都必须改成 18 500，否则「18 500 是上限」就是假的（18 800 也能过）。
- 更隐蔽的是 `.test.ts:82` 与 `:336` 的 `expect(L0_PROMPT_CHAR_CEILING).toBe(18_900)`：v1 §2.1.2 把常量改成 19 800，这两条 **pin 断言必然变红**，而 v1 §3.1 只写「3 处断言」——实际需要改的是 **6 处**（`:76`、`:82`、`:154-157`、`:159`、`:335`、`:336`）+ `subtitleDisclosure:112-113`。v1 的 AC-R3-1 却宣称「4 条红断言全绿」，按 v1 实施会得到**红断言从 4 条变成 2 条**（`:76`/`:82` 或 `:336` 新红），验收不通过。
- v1 的另一处影响面漏项：该常量在**运行时有消费者** `agent.ts:259`，`systemPrompt.length > L0_PROMPT_CHAR_CEILING` 时 `console.warn`。改 19 800 意味着运行时告警阈值一起放宽 900 字符——v1 §2.1.2 却写「保留一个与分段预算矛盾的常数才是真风险……等于没有护栏」，而**放宽的恰恰是唯一的运行时护栏**。这不否决方案，但必须写明，且用逐段棘轮补位。
- 已修：见本版 §2.1.3（新增「同源断言清理」小节，把 6 处逐条列出）、§2.1.4（`agent.ts:259` 运行时影响与补偿）、§3.1 表（断言改动从「3 处」更正为「6 处 + 2 处」）、AC-R3-1（明确「转绿」指哪几条、`git diff` 须命中哪几个行号）。

**P0-2 · E4 拿两套坐标系直接比大小，避让结果必错。**

- 复核方式：`src/components/browser/useViewBounds.ts:60` → `const box = element.getBoundingClientRect()`，`:61` → `send(roundRect(box))`；`src/components/browser/BrowserViewport.tsx:88-90` → `store.setDockViewportRect({ left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height })`。即 **`dockViewportRect` 是 `getBoundingClientRect()` 的视口坐标**（相对窗口内容区左上角）。
- 而 `avoidDockRect` 的候选算式（v1 §2.4）是 `parent.width - dockRect.left`、`bottom = parent.height - dockRect.top` —— 这是**相对父容器（工作区）的边框盒**坐标。`AgentChatFloatingPanel.usePanelGeometry` 也确实是父容器口径：`const width = parent.clientWidth`（`:75`），`right/bottom` 是「距父容器右/下边的距离」（`fabAvoid.ts:19` 注释、`DEFAULT_FAB_POSITION`）。
- 两者相差的是父容器的 `getBoundingClientRect().left/top`。工作区不是全窗口（有顶栏/竖向栏），这个偏移是**几百像素量级**，不是舍入误差。直接把 `dockRect.left` 与 `parent.width` 相减，会得到一个偏出几百像素的锚点，然后被 `clamp(SAFE, …)` 夹回边界 —— 表现是「面板莫名贴到某条边上」，或「该避让时不避让」。**这是本迭代唯一会直接把交互做坏的设计缺陷。**
- v1 还顺带误称 `dockViewportRect` 由「`browserWorkspaceStore` 提供并在 `BrowserDock.test.tsx:202-205` 有断言」——断言确实存在（`src/components/browser/__tests__/BrowserDock.test.tsx:202/205`），但**没有任何源码断言过它的坐标系**，所以这个错误不会被现有测试拦住。
- 已修：见本版 §2.4「坐标系与换算」小节（显式换算公式 + `dockRectOffset` 契约 + 一条专门的坐标系回归用例）、§4.2 `avoidDockRect` 签名、§5.3。

**P1-1 · `promptBudget.ts` 放 `helpers/` 会被 Vitest 当测试文件收集。**

- 复核方式：`vitest.config.ts` 的 `include` 覆盖 `src/**/__tests__/**/*.ts`。放入 `__tests__/helpers/promptBudget.ts` 会被无条件载入；该文件只有导出、没有 `describe`/`it`，Vitest 报 **"No test suite found in file"** 并计为**失败套件**（本仓 `npm test` 是全量收集，红一个套件即整体红）。
- 已修：见本版 §3.1 —— 改放 `src/lib/video-editing-agent/__tests__/fixtures/promptBudget.ts`，并在表内写明「`fixtures/` 不在收集范围，`helpers/` 在」。这是**放错一个目录就整轮红**的确定性问题，不是风格问题。

**P1-2 · `assert-fresh-build` 的第一项检查在**当前**代码树上必然失败，v1 却把它写成「四项全通过」。**

- 复核方式：`desktop/scripts/build.js:104-110` 的 `BROWSER_WORKSPACE_MODULES` 逐项列举，**不含 `loginHeuristics`，也不含 `pageScripts/` 目录整体**（只列了 `pageScripts/index|snapshot|act|overlay|sentinel` 五个文件）。v1 §2.2 的检查 1 要求「`<appDir>/resources/**/main/browserWorkspace/` 下存在 `index.js`、**`loginHeuristics.js`**、`approvals.js`、`viewShortcuts.js` 与 **`pageScripts/` 目录**」——按现表打包，`loginHeuristics.js` 与 `pageScripts/` 都不会进包，检查 1 必红。
- 同一段代码还说明检查 3 为什么「通过」也没意义：v1 说检查 3 验「`APP_PAYLOADS` 覆盖 `main/browserWorkspace/**`」，但 `APP_PAYLOADS` 是**白名单**（`...BROWSER_WORKSPACE_MODULES`），不是 glob。白名单的形状使得「覆盖」永远为真（列出来的都在），**漏掉的文件它检测不到**——这正是 v1 R-5 前科的同构缺陷，只是换了个位置。所以检查 1 与检查 3 **一红一绿自相矛盾**，必须靠检查 1 把真实缺口顶出来。
- v1 也没写产物根目录名。复核方式：`desktop/electron-builder.yml:39` `asar: true`、`:52-59` `extraResources` 把 `build/frontend`、`build/backend` 等**平铺**进 `resources/`，故 `appDir` 应为 `<build/win-unpacked>`，`resources/` 下没有 `app/` 这一层 —— v1 的 `resources/**/main/browserWorkspace/` 用 `**` 含糊带过，实施时容易写成错的 `resources/app/main/...`。
- 已修：见本版 §2.2 —— 新增第 0 步「补齐已声明但未入包」的**既有债**（把 `loginHeuristics.js` 与 `pageScripts/` 加入 `BROWSER_WORKSPACE_MODULES`），并规定**这步必须先失败一次**（用旧包跑检查 1 得红），再转绿；`appDir` 解析算法与 `win-unpacked` 显式写出；检查 3 改为「`APP_PAYLOADS` 与磁盘实际文件集**双向**一致」（多列/漏列都红）。

**P1-3 · 打包后主进程在 `app.asar` 里，只搜 `resources/**` 会假红。**

- 复核方式：`desktop/electron-builder.yml:39` `asar: true`；`:4-8` 注释「The asar archive only contains the Electron shell (main/preload/assets + …)」；只有 `assets/icon.ico` 在 `asarUnpack`（`:80-81`）。故 `main/browserWorkspace/*.js` 打包后位于 **`resources/app.asar` 内部**，`fs.existsSync('<appDir>/resources/app/main/browserWorkspace/index.js')` 为 `false`。
- 已修：见本版 §2.2 表 —— 检查 1 改为「先查 `app.asar.unpacked/`，再查 `resources/app.asar` **内部条目**（`require('asar')` 的只读遍历）；两者都没有才判失败」，并明确**禁止自研 asar 解析器**（`desktop/scripts/` 已有 `verify-no-bundled-secrets.js` 用过 `asar`，直接复用同一依赖）。

**P1-4 · 走查表命令的 cwd 写错，两条命令拷过去都跑不起来。**

- 复核方式：v1 §4.3 两条 `node scripts/check-walkthrough-table.js` 位于「主进程套件 `cd desktop`」之后的小节，但同一表第一条又是仓库根相对路径 `src/lib/...`，上下文只有一处 `cd desktop`，**执行者无法确定当前目录**。更硬的事实：脚本要解析 `docs/plans/agent-browser-workspace/acceptance.md`，该路径**只在仓库根**成立，因此必须在仓库根执行 `node desktop/scripts/check-walkthrough-table.js`。
- 已修：见本版 §4.3 —— 命令按「执行目录」分组，每条注明 cwd，并给出脚本内 `path.resolve(__dirname, '../..')` 的**仓库根锚定**写法（不依赖调用者的 cwd）。

**P1-5 · 走查表验收允许「填一句未执行」就过，等于可造合规假证据。**

- 复核方式：v1 §2.3「断言 ①–⑪ 每行都有 5 列且『实测』列非空（**含「未执行」也算有结论**）」+ AC-R3-6「未执行的行如实写『未执行 + 原因』」。两者叠加的漏洞：11 行全部写「未执行」，脚本退出 0，**AC-R3-6 通过**，而迭代 2 spec W9 的原话是「未执行的行保持『未执行』，**不得空白通过**」——「有结论」不等于「有证据」。
- 另外 v1 §5.2 声称「表格格式即契约：增列/改编号都会让脚本失败」，但脚本只断言「5 列」与「①–⑪ 存在」，**改列名不会失败**（列名从未被比对）。契约描述强于实现。
- 已修：见本版 §2.3 —— 「实测」列改三档前缀 `已执行/未执行/阻塞`，脚本额外校验**列名逐字匹配**与「前缀合法」；AC-R3-6 增硬性交叉校验（`已执行` 的行必须能对上 §4.3 某条命令的真实输出或明确的走查记录，`未执行` 必须写缺什么），并把「档位统计」写进 `acceptance.md` 表头（`已执行 N / 未执行 M`），让 N=0 不可冒充通过。

**P1-6 · 「19 800 会成为真正生效的护栏」这句不成立。**

- 复核方式：`src/lib/video-editing-agent/agent.ts:259-263` 是**唯一**运行时消费者，且只 `console.warn`（注释自己写「超出只是告警：prompt 不可裁剪，静默超限才是 bug」）。测试侧改 19 800 不会让运行时护栏变强，只是把告警线一起抬高 900。
- 已修：见本版 §2.1.2（把「测试 pin」「运行时限」「分段预算」三个概念拆开写，不再用「护栏」一词混指）与 §7 R-1（补「运行时告警随之上移 900 字符」为已知代价，替代保障 = 12 段棘轮 + `promptBudgetRatchet.test.ts` 的快照对比）。

**P1-7 · 两处源码路径写错，实施节点会照错路径找文件。**

- 复核方式：`where /r src browserWorkspaceCopy.ts` → `src/lib/browserWorkspaceCopy.ts`（v1 写 `browserWorkspaceCopy.ts` 且未给目录，§2.0/§1 的 `browserWorkspaceCopy.ts:71/275` 因此无法定位）；`where /r src BrowserDock.test.tsx` → `src/components/browser/__tests__/BrowserDock.test.tsx`（v1 §2.4 写 `BrowserDock.test.tsx:202-205`，无目录）。
- 已修：本版全文凡引用均给**从仓库根起的完整路径 + 行号**。

**P1-8 · 两处基线数字没有来源命令，验收无法判定。**

- 复核方式：v1 §2.4「牵动 12 个生命周期测试」、AC-R3-8「`git diff src/components/browser/BrowserViewport.tsx` 为空」——前者无命令可复算（`AgentChatDock` 目录下有多个测试文件，`12` 指哪个集合不明），后者依赖「基线本来干净」这一未登记前提。
- 已修：见本版 §6.1「基线登记」小节（四条命令，实施前先跑一次存档），AC-R3-8 改为引用该存档。

### 复核为「成立、无需改动」的判断（留档，避免下轮重复质疑）

| v1 判断 | 复核方式 | 结果 |
|---|---|---|
| 4 条红断言与 4 个实测值 | §2.1.1 引用的 vitest 命令 | **成立**（`4 failed / 32 passed`；18 576、19 673、1 606、索引 1 093 全部复现） |
| 「索引段 ≤1 300」与「净增 ≤400」不可同时成立 | `skillContext.ts:166` 截断用 `SKILL_INDEX_TOTAL_MAX_CHARS`；`formatSkillIndex` 返回含 `INDEX_HEADER` 的整段 | **成立**，算术证明正确，本版原样保留 |
| `smoke-test.js:20`/`:1035` 已挂 `browserWorkspaceSmoke` | `findstr /n browserWorkspaceSmoke desktop/scripts/smoke-test.js` | **成立**（两行精确命中） |
| `browser-workspace-smoke.js` 从未在新产物上跑过 | 文件存在（127 行）；`acceptance.md` 仅 149 行且 `:62` 自述「未生成安装包、未跑打包态冒烟」 | **成立** |
| `acceptance.md:146/148` 两处悬空（无 I2-7/I2-8 段） | `findstr /n "I2-7 I2-8"` 只命中 `:146`/`:148` 的**引用**，正文到 I2-6 结束 | **成立** |
| `usePanelGeometry`（56–113）不读 `dockViewportRect`；`snapFabClearOf` 只接在 `useDraggableFab.ts:204` | 读 `AgentChatFloatingPanel.tsx:56-113` 全文 + `findstr dockViewportRect` | **成立** |
| 四个「结构债」文件零改动的行数 | 实测 `index.js` 387 / `dispatch.py` 192 / `desktop/main/index.js` 732 / `page.tsx` 212 | **成立**（与 v1 §2.0 I-6 完全一致） |
| `@vitest-environment node` 的必要性 | 不带该 flag 跑 `.test.ts` → `Error: No such built-in module: node:` | **成立**（且有 `node:crypto` externalized 警告，指向 `effectApplyReceipts.ts`） |

**评审方法局限（如实写）**：本轮**未执行** `npm run build:dir` 与 `smoke-test.js`（本机打包耗时长且非评审职责），故「打包产物里到底有什么」的判断来自 `electron-builder.yml` + `build.js` 的**静态阅读**。P1-2/P1-3 的结论因此是「按配置推导必然如此」，实施节点若实测发现配置已变更，应以实测为准并回填本节。

---

## 1. 概览（Overview）

迭代 1 把「Agent 能用浏览器」这条链路从零建起来了：Electron 主进程托管真实的 `WebContentsView`（`persist:wb-<profile>`，登录态可缓存），后端 `app/services/browser_workspace/` 做适配，模型侧只有一套 `browser_open / read / act / close`（外加 `browser_request_user`）工具，前端在 footer 最左侧、紧贴竖向栏的位置放了「浏览器」按钮，Agent 操作时按钮呈 `agent-active` 态（`BrowserFooterButton.tsx` 的四态视觉）。迭代 2 补齐了这段链路上的**体验断点**（`Ctrl+L`/`Ctrl+Alt+B` 的焦点交还、登录完成建议 `suggestComplete`、设置入口、遮挡标记棘轮、真后端↔真 Electron 联调）。功能面已经闭合，`test:browser` 11 套 96 项、`test:browser:e2e` 13/13、后端 `pytest -k "browser or workspace"` 231 passed 都是实测通过。

但「顶级产品」的验收标准不是「功能能跑」，而是**每条验收标准都有证据、每个预算数字都自洽、每一处已知缺陷都有明确归属**。按这个口径复核源码与 `acceptance.md`，迭代 2 收尾时仍有四处敞开，且**四处都不是新功能**，而是「已声明但未落地」的债：

1. **提示词预算护栏是红的（4 条断言，实测）**。`npx vitest run --environment node src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts` 当前 **4 failed / 32 passed**：无索引最坏 18 576 > 18 500（两处独立断言）、满索引最坏 19 673 > 18 500、AC-B8 净增 1 606 > 400。迭代 2 判定 W4b 触发停止条件（需删 >800 字符 L0 规则文本，超 600 字符线）后整项后移，并在 spec 里写明「AC-B8（净增 ≤400）与『索引段 ≤1 300 字符』两条既有断言本身互相矛盾，需单独立项取舍」。**本文件就是那个「单独立项」**。护栏红着，后续任何提示词改动都没有回归网——这是当前技术债里风险最高的一条，因为它保护的是「实时资讯/真实图片必须走浏览器」这条**业务规则本身**。
2. **打包态证据缺失（`acceptance.md` 的 I2-7 指向一个不存在的段落）**。`desktop/scripts/lib/browser-workspace-smoke.js` 已写好并在 `desktop/scripts/smoke-test.js:20,1035` 挂进冒烟，但**从未在新的 `build:dir` 产物上跑过**；`acceptance.md:146` 写「H7 打包态冒烟｜见 I2-7」，而该文件到 I2-6 就结束了（150 行，无 I2-7）。文档里有一句引用悬空，验收表就无法签字。
3. **人工走查表缺失（同上，I2-8 悬空，位置在 `acceptance.md:148`）**。走查清单在 `desktop/README.md`，但 11 项（首次授权披露、登录持久化、重启后登录仍在、搜新闻→读正文→取图入库、接管/交还、风险确认、遮挡与冻结帧、最小化后继续、闸门锁定恢复、`Ctrl+L`、登录完成提示）**没有一行被记录过结论**。
4. **悬浮助手面板仍按几何默认值摆放（W5b 明确未做）**。`AgentChatFloatingPanel.tsx` 的 `usePanelGeometry`（56–113 行）只把面板夹在父容器内（`clamp(fabRight, SAFE, width - panelWidth - SAFE)`），**完全不看** `dockViewportRect`；`fabAvoid.ts` 的 `snapFabClearOf` 只接在 FAB 拖动结束（`useDraggableFab.ts:204`）。结果：面板默认打开时若与 Dock 视口相交，视口被换成冻结帧——虽然 `BrowserViewport.tsx:101-103` 已有 `data-native-inflow` 的「已被浮层遮挡 · 实时画面暂停」提示条（文案 `browserWorkspaceCopy.ts:71/275`），但「边聊边看 Agent 浏览」这条核心旅程默认就断了。

本迭代把这四件事一次收干净，交付判定统一为：**每条 AC 要么有自动化证据、要么有一行带日期的「未执行 + 原因」**，不允许空白通过。范围上**不新增任何用户可见功能**、**不改控制服务与对外 HTTP 接口**、**不动数据库**，因此风险面极小；真正的难点集中在预算数字的自洽性论证（§2.1）与打包态门禁的可重复性（§2.2）。

---

## 2. 技术设计（Technical design）

### 2.0 全局不变量（本迭代不得违反）

| # | 不变量 | 违反即缺陷 |
|---|---|---|
| I-1 | **授权只在主进程、按用户**（`profiles.json → agentConsentAt`） | 不得写 `system_settings`/后端/渲染层 |
| I-2 | **控制令牌永不出主进程** | 不得进 Next、渲染层、日志、审计、任何响应、artifact |
| I-3 | **cookie value 永不出主进程** | `loginHeuristics.js` 只读 `name\|domain\|path` + 标志位 |
| I-4 | **原生视图在 DOM 之上**，遮挡由几何判定 | 新增浮层必须带 `role="dialog\|menu\|listbox\|tooltip"` 或 `data-native-occluder`；in-flow 用 `data-native-inflow`，两者互斥 |
| I-5 | 浏览器规则的 132 字符（含 YOLO 变体 119 字符）与一切安全/授权/egress 规则**不可被压缩** | 本迭代所有「减字符」动作都不得触碰 |
| I-6 | 结构债只减不增 | `desktop/main/browserWorkspace/index.js` 现 387 行、`dispatch.py` 192、`desktop/main/index.js` 732、`src/app/page.tsx` 212 —— 本迭代**对这四个文件零改动** |

### 2.1 E1 · 提示词预算：先把矛盾证明清楚，再让数字自洽

#### 2.1.1 归因（实测，不可再凭估算）

| 量 | 实测 | 断言 | 结论 |
|---|---|---|---|
| 无索引最坏 `W_noIndex` | **18 576** | ≤18 500（`toolkit.test.ts:84`、`:335`） | 超 **76**，与技能索引无关，是 L0 正文自身超了 |
| 满索引最坏 `W_fullIndex` | **19 673** | ≤18 500（`toolkit.test.ts:159`、`subtitleDisclosure.test.ts:112`） | 超 **1 173** |
| 索引段 `W_index` | **1 093** | ≤1 300（`toolkit.test.ts:163-168`） | **合规**，且远低于上限 |
| AC-B8 净增 `Δ` | **1 606** | ≤400（`toolkit.test.ts:154-157`） | 超 **1 206** |

**矛盾的算术证明（这是本方案的地基，必须写进代码注释）**：索引段渲染格式为 `- <id>: <description>`（`skillContext.ts:141-144`），`formatSkillIndex` 返回 `header + '\n' + 行联接`（`skillContext.ts:155-171`），其中 `INDEX_HEADER` 见 `skillContext.ts:147-149`。`MAX_INDEX` 夹具每行 = 前缀 `- <id>: `（42）+ 60 字符描述 = 102，10 行 + 9 换行 = 1 029，加 header 与引导换行后**实测约 1 093**。于是：

> 〔v2·P2-1〕本节不再复述手算细节：v1 写的「10×104 + 9 = 1 049，加 header 44 = 1 093」与 `renderIndexLine` 的实际前缀长度（`- <id>: ` = 42，因 `id` 被 `.slice(0, 40)` 截到 38）对不上。**索引段的权威数字只有一个来源：`promptBudget.ts` 的 `indexSection` 返回值**（§4.2），文档与断言都引用它，不再二次手算。结论（1 093 落在 (400, 1 300] 区间）不变。

- 「索引段 ≤1 300」允许 §“索引段” 最大 1 300；
- 「净增 ≤400」要求整段索引（含 header）≤400。

**只要索引段长度落在 (400, 1 300]，两条断言就必然一真一假。** 当前 1 093 正好落在这个区间中段。这不是「没压够」，是**两条断言无法同时成立**。评审要求「不放宽任何字符预算断言」，在没有第三条约束（例如「索引段必须 ≤400」同时也压低 1 300）的前提下，这个要求数学上不可满足——迭代 2 的停止条件判定是正确，但结论「需单独立项」需要在此闭环。

#### 2.1.2 决策：单一硬上限 + 分段预算，删掉派生量断言

采用「**一个硬上限 + 若干独立分段上限**」的模型，所有数字都可从别的数字推导出来：

```
L0_NO_INDEX_CHAR_MAX   = 18 500   // 既有，语义收紧为「不含索引段的最坏提示词上限」
SKILL_INDEX_TOTAL_MAX_CHARS = 1 300  // 既有 skillContext.ts:18 导出，成为唯一索引预算
L0_PROMPT_CHAR_CEILING = 19 800   // = 18 500 + 1 300，由上面两条推导，不再是手填的独立数字
```

- **`L0_PROMPT_CHAR_CEILING` 由 18 900 改为 19 800**：这是本迭代**唯一**放宽的数字，依据是上面两条既有预算的加法，而不是「跑不过就调大」。19 800 字符约 9.9k CJK token 量级，相对当前模型上下文仍有 10 倍以上余量，不构成真实风险。

  〔v2·P1-6〕**必须把三件事分开说，v1 混为一谈**（原文「等于没有护栏」把测试 pin 当成了运行时护栏）：

  | 概念 | 载体 | 改 19 800 后是否变强 |
  |---|---|---|
  | 测试 pin | `systemPrompt.toolkit.test.ts:82`、`:336` 的 `toBe(18_900)` | 只是**跟着改**，不产生任何新约束 |
  | 运行时限 | `agent.ts:259` `if (systemPrompt.length > L0_PROMPT_CHAR_CEILING) console.warn(...)` | **变弱 900 字符**：唯一运行时防线是 `console.warn`（`agent.ts:257-258` 注释自述「超出只是告警」），阈值上移即告警更晚 |
  | 分段预算 | `SKILL_INDEX_TOTAL_MAX_CHARS` + 新增 12 段棘轮 | **这是真正变强的部分**，也是本方案对「上移 900」的补偿 |

  因此本方案的正确表述是：**运行时护栏本就不存在（只是告警），本迭代把它从 18 900 上移到 19 800，代价是「告警更晚」，补偿是逐段棘轮把约束改成「每段只减不增」——后者比一个总数告警更严、更可定位**。§7 R-1 同步记录该代价，不得再宣称「护栏不再红所以护栏生效了」。
- **删除 AC-B8「净增 ≤400」这条断言**，不是「改小」，而是**删除冗余**：它表达的约束（索引不能太大）已由 `SKILL_INDEX_TOTAL_MAX_CHARS = 1 300` 完整表达，且后者才是可执行的那一条。删除时必须在测试文件里留注释指向本节，并保留一条**新增**断言 `L0_PROMPT_CHAR_CEILING === L0_NO_INDEX_CHAR_MAX + SKILL_INDEX_TOTAL_MAX_CHARS`（防止以后又有人手填一个不相容的数字）。
- 若产品负责人坚持 18 500 为绝对上限（否决 19 800），**唯一可行路径**是把索引段压到 ≤400，即把 10 条索引压成 10×~36 字符——连 40 字符的 id 都放不下，技能将不可发现。因此本方案标注这条为**需要产品确认的一个开放问题**（§7 O-1），但工程侧推荐 19 800。

#### 2.1.3 先收回真实的 76 字符（与索引无关，必须做）

`W_noIndex = 18 576` 是**纯 L0 正文**超出，与索引无关，任何方案都要先修。

〔v2·P0-3〕**v1 定的唯一取材处在源码里不存在，本小节整段重写。** 复核方式：`findstr /n /c:"例如" /c:"举例" src/lib/video-editing-agent/systemPrompt.ts` → **0 命中**（同样搜 `示例`/`比如`/`demo` 也是 0，`e.g.` 只出现在两行 JSDoc 注释里，不在提示词正文）。实测该段长度：`systemPrompt.ts:736-741` 的 `## ⚠️ 强制约束：同轨不可重叠（反思-修复闭环）` 全文 **620 字符**（1 个标题 + 5 个 bullet），**不是 v1 声称的 3 155**，且其中**没有任何「重复示例句」**可删。按 v1 的指令实施，实施节点会在「找不到要删的句子」处卡死，而 AC-R3-2 又是硬门禁（要求删减「全部位于该段」），两条互相锁死。

> 计数口径（已自校）：按 `splitlines()` 行长度求和、**含段内换行、不含段后空行**。视频轨道段（`:730-734`）= **268** 字符；同轨段（`:736-741`）= **620** 字符；两段合计 **890** 字符。v1 的 `239` 与 `3 155` 与之均不符。

v1 的「分段实测」表也因此不可信：把该表 12 段相加（规则 1 354 + 常驻工具 406 + 按需目录 2 337 + 核心工作流 9 444 + 项目状态 49 + 配方 222 + 技能 1 093 + 视频轨道时长 239 + 同轨 3 155 + 常驻通用 1 137 + 计划 77 + 记忆 74）= **19 587**，与它自己给的 `W_fullIndex = 19 673` 差 86、与 `W_noIndex = 18 576` 差 1 011，**没有任何一组能对齐**。而实测这两段是 268 + 620 = **888**（≠ v1 的 239 + 3 155 = 3 394，差 2 506）。**结论：这套分段数字是估出来的，不能作为棘轮基线。**

**改为「实测驱动、两段等义压缩」**：

1. **先用 `measurePrompt()` 量，不允许手写任何基线数字。** 实施节点第一步只做这件事，把 `segments` 的真实返回值写进 `__fixtures__/prompt-budget-baseline.json`（§5.1 的数值仅作「数量级参照」，**不是**基线来源）。
2. **取材处（两段，均在同一 `hardConstraints` 模板串内，`systemPrompt.ts:730-741`）**：
   - `## ⚠️ 强制约束：视频轨道时长规则`（`:730-734`，实测 **268** 字符）
   - `## ⚠️ 强制约束：同轨不可重叠（反思-修复闭环）`（`:736-741`，实测 **620** 字符）
   这两段合计 **888** 字符，是全 L0 里**唯一**同时满足「含重复表述」且「不含任何安全/授权/egress 规则」的段落——满足了 v1 想表达的意图，只是对象写错了。压缩 ≥120 字符即占总量的 13.5%，现实可达成。
3. **只允许「同义压缩」，不允许删除规则**。压缩前必须先把这两段的**规则清单**固化下来（共 12 条，见下表），压缩后逐条 grep 断言仍然存在——这是「减字但不减约束」的唯一可验证办法：

   | # | 规则锚点（压缩后必须仍能匹配到） |
   |---|---|
   | 1 | 视频轨道必须是最长轨道 |
   | 2 | 明确时长只能由用户修改 |
   | 3 | 不为消警告延长总长 |
   | 4 | 多片段首尾相连不留空隙 |
   | 5 | 编辑后调用 `get_timeline` 查 `constraintCheck` |
   | 6 | 同轨任意两片段区间不得重叠 |
   | 7 | 出现 `overlapWarning` 必须立即 `auto_fix_overlaps` 一次 |
   | 8 | 报告完成前 `check_timeline_overlaps` → 修复 → 复检至 `valid=true` |
   | 9 | 连续 2 次 `fixedCount=0` 或 `noop=true` 立即停止 |
   | 10 | `autoFixable=false` 的重叠（subtitle/locked）不自动修 |
   | 11 | 上述自检仅用于编辑路径，纯搜索/生成不调用 |
   | 12 | 刻意留白用 `move_clip` 显式调整 |

4. **量化目标**：`W_noIndex ≤ 18 500`，需收回 ≥76；为确保一次到位，实际目标**收回 ≥120**（留 44 字符余量给段间换行与标点，避免下一次加一句话就再红）。
5. **禁止取材（与 v1 一致，不变）**：`promptParts.ts:35-39` 的浏览器规则（132/119 字符，I-5）、任何 egress/授权/拒绝类规则、`AGENT_TOOLKIT_GUIDANCE` 的自检纪律（有独立断言）、`WEB_RESEARCH_GUIDANCE`。
6. **压缩后必须新增两条归因断言**：(a) 12 段长度 ≤ 基线（棘轮，任一段增长即红并可定位到段）；(b) 上表 12 条规则锚点全部仍可匹配（防「为了减字把规则删了」）。

> **给实施节点的兜底**：若同义压缩做不到 ≥120（例如中文已极简），**不得**转而删规则、不得改 `promptParts.ts`，而应**停下来上报**，改走 O-1 的产品裁决（19 800 是否可接受）。这是本方案唯一允许的「停」点。

#### 2.1.4 两个提示词文件的环境声明

`systemPrompt.toolkit.test.ts` 与 `subtitleDisclosure.test.ts` 在默认 jsdom 下**加载即失败**（复核：不带 flag 直接跑 `.test.ts` → `Error: No such built-in module: node:`，并伴随 `Module "node:crypto" has been externalized ... imported by effectApplyReceipts.ts` 警告；既有问题，不在本迭代修，也不占本迭代预算）。在两个文件**首个 import 之前**加 `/** @vitest-environment node */` 文档块（**只是环境声明，不是断言**）。

〔v2·P2-4〕边界必须写清：该文档块**只对所在文件生效**，`npm test` 全量运行时其它触及 `effectApplyReceipts.ts` 的测试仍会在 jsdom 下失败。本迭代**不宣称**修好了全量 `node:crypto` 问题，只宣称「这两个文件能被默认命令跑到」。若全量仍有红，按既有基线处理，不得记为本迭代引入。

#### 2.1.5 〔v2·P0-1〕同源断言清理清单（v1 漏项，逐条列出）

v1 只处理了 4 条红断言，但改 `L0_PROMPT_CHAR_CEILING` 与收紧 18 500 语义会**连带**让另外 2 条当前为绿的断言变红。实施节点必须按同一张表改完，否则「红从 4 条变 2 条」，AC-R3-1 不成立。复核方式：`findstr /n "L0_PROMPT_CHAR_CEILING 18_500 18_900" src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts`。

| # | 位置 | 现状 | v1 是否处理 | v2 处置 |
|---|---|---|---|---|
| 1 | `systemPrompt.toolkit.test.ts:84` | `prompt().length ≤ 18_500`（**红**，18 576） | 是 | 改引用 `L0_NO_INDEX_CHAR_MAX` |
| 2 | `systemPrompt.toolkit.test.ts:154-157` | 净增 ≤400（**红**，1 606） | 是 | **删除**，改为上限一致性断言（§2.1.2） |
| 3 | `systemPrompt.toolkit.test.ts:159` | `withIndex ≤ 18_500`（**红**，19 673） | 是 | 改 `≤ L0_PROMPT_CHAR_CEILING` |
| 4 | `systemPrompt.toolkit.test.ts:335` | `text ≤ 18_500`（**红**，18 576） | 是 | 改 `≤ L0_NO_INDEX_CHAR_MAX` |
| 5 | `subtitleDisclosure.test.ts:112` | `prompt(MAX_INDEX) ≤ 18_500`（**红**，19 673） | 是 | 拆成满索引 ≤ 天花板 |
| 6 | `subtitleDisclosure.test.ts:113` | `prompt() ≤ 18_500`（**红**，18 576） | 是 | 拆成无索引 ≤ 18 500 |
| **7** | `systemPrompt.toolkit.test.ts:76-79` | `it('stays under the 18900-char ceiling ...')` → `≤ 18_900`（**绿**，18 576） | **否** | **必须改**：语义收紧后 18 900 不再是「无索引上限」，改为 `L0_NO_INDEX_CHAR_MAX`，并同步 `it()` 标题里的 `18900` 字样 |
| **8** | `systemPrompt.toolkit.test.ts:82` | `expect(L0_PROMPT_CHAR_CEILING).toBe(18_900)`（**绿**） | **否** | **必须改**为 `toBe(19_800)`，否则常量一改即红 |
| **9** | `systemPrompt.toolkit.test.ts:336` | 同上 `toBe(18_900)`（**绿**） | **否** | **必须改**为 `toBe(19_800)` |

另外两处非断言消费者，不得遗漏：

| 位置 | 现状 | 处置 |
|---|---|---|
| `systemPrompt.yolo.test.ts:126` | `expect(yolo).toBeLessThanOrEqual(L0_PROMPT_CHAR_CEILING)`（引用常量，非硬编码） | **无需改**；但因为它引常量，天花板升到 19 800 后这条**自动变宽**——在测试注释里标明它现在守的是 19 800，不是 18 500 |
| `agent.ts:259` | 运行时 `console.warn` 阈值 | 随常量一起变成 19 800（代价见 §2.1.2 表 / §7 R-1），**无代码改动**，但要在此登记 |

> **验收口径**：AC-R3-1「4 条红断言全绿」的准确含义是「上表 1–6 由红转绿，且 7–9 已同步改动、全文件 0 failed」。实施后必须贴出 `Test Files 2 passed` / `Tests 36 passed` 的完整输出，不接受只贴「4 条绿」。

### 2.2 E2 · 打包态冒烟：先证明「测的是新包」，再跑

现状：`desktop/scripts/lib/browser-workspace-smoke.js` 已存在并被 `smoke-test.js:20` require、`:1035` 调用；但**从未在新的 `build:dir` 产物上执行**。本仓有「过期 standalone 打包当结论」的前科（迭代 2 spec 的 R3-11 就是为此写的），所以本迭代把「新鲜性」做成**机器可判的门禁**，而不是文档里的提醒。

新增 `desktop/scripts/lib/assert-fresh-build.js`（纯函数 + 一个 CLI 入口，≤120 行，无 Electron 依赖，纯 node）。

**第 0 步（〔v2·P1-2〕新增，且必须最先做）：补齐「已声明但未入包」的既有债。** 复核方式：`desktop/scripts/build.js:101-110` 的 `BROWSER_WORKSPACE_MODULES` 是**逐项白名单**，其值来自 `.map(name => 'main/browserWorkspace/${name}.js')`，逐条比对后确认：

- **缺 `loginHeuristics`** —— 迭代 2 的 W1 产物，`test:browser` 里有 `loginHeuristics.test.js`（`test-browser-workspace.js:17`），但**不在打包白名单**，即发布态根本没有这个模块。
- **缺 `pageScripts/` 目录整体** —— 只列了 `pageScripts/index|snapshot|act|overlay|sentinel` 五个文件（需逐个核对磁盘上 `desktop/main/browserWorkspace/pageScripts/` 的实际文件集，多一个少一个都会让检查 1 红）。

因此 `assertFreshBuild` 的检查 1 在**当前代码树上必然失败**。这不是脚本缺陷，是它**正确暴露了真实缺口**。处置顺序固定为：先让检查 1 **红**（贴旧包输出）→ 把 `loginHeuristics` 与 `pageScripts/` 实际文件集补进 `BROWSER_WORKSPACE_MODULES` → 重新出包 → 转绿。这是本迭代的**第一个先红后绿**。

关于产物根目录（v1 只写了含糊的 `resources/**`）：复核 `desktop/electron-builder.yml` 的 `asar: true`（`:39`）、`extraResources` 把 `build/frontend|backend|python|ffmpeg|effects` 平铺进 `resources/`（`:41-59`）、`asarUnpack: assets/icon.ico`（`:80-81`）⇒ 预期产物根为 **`desktop/build/win-unpacked/`**，结构是：

```
desktop/build/win-unpacked/
  Ecliptrix.exe
  resources/
    app.asar              ← 主进程（main/browserWorkspace/*.js）在这里面！
    app.asar.unpacked/    ← 目前只有 assets/icon.ico
    frontend/ backend/ python/ ffmpeg/ effects/   ← extraResources 平铺
```

`appDir` 解析算法（写进脚本，不靠调用者传）：CLI 无参时依次尝试 `desktop/build/win-unpacked`、`desktop/build/mac`/`desktop/build/win-unpacked` 的兄弟目录，取**含 `resources/app.asar` 或 `resources/app`** 的第一个；都没有 → 四个检查全部记 `pass: false, detail: 'no build output'`，退出码非 0。

四项检查，任一失败即返回非 0（冒烟脚本第一步调用，失败直接中止，不产生「通过」结论）：

| 检查 | 判据 | 为什么需要它 |
|---|---|---|
| `packaged-main-modules` | 〔v2·P1-3〕**两级查找**：① 先查 `<appDir>/resources/app.asar.unpacked/main/browserWorkspace/`；② 再查 `<appDir>/resources/app.asar` **内部条目**（用 `require('asar')` 的 `listPackage` 只读遍历，**禁止自研 asar 解析器**；`desktop/scripts/verify-no-bundled-secrets.js` 已依赖同一模块）。判据：`index.js`、`loginHeuristics.js`、`approvals.js`、`viewShortcuts.js` 四个文件 + `pageScripts/` 下**与磁盘同名文件集**全部存在 | 主进程打包后**在 `app.asar` 内**，只搜 `resources/**` 的写法必然假红 |
| `packaged-renderer-fresh` | 前端 `page.js`（standalone，`resources/frontend/`）的 mtime **晚于** `src/` 下最后修改的 `.ts/.tsx` mtime | 直接命中「过期 standalone」前科 |
| `page-scripts-not-excluded` | 〔v2·P1-2〕**双向一致**：`APP_PAYLOADS` 解析出的文件集 ⊇ 磁盘 `main/browserWorkspace/` 下所有**运行时** `.js`（排除 `*.test.js`），且**不包含**任何 `.test.js`；多列/漏列都判失败。另跑 `verify-no-bundled-secrets` 对 `app.asar` 条目无新 finding | 白名单漏一个 = 发布态静默缺模块（当前就漏了 `loginHeuristics.js`）；反向混入测试文件也会膨胀包体 |
| `no-secret-in-bundle` | `app.asar` 条目中不出现 `BROWSER_WORKSPACE_CONTROL_TOKEN` 的**字面值**（只允许出现变量名）。复核：`desktop/main/browserWorkspace/controlServer.js:70` 该令牌是「32-byte hex secret, per launch」——**运行时生成**，故打包产物里出现字面值只可能是硬编码泄漏 | I-2 的发布态证据 |

随后 `cd desktop` 后跑 `node scripts/smoke-test.js`，使 `browserWorkspaceSmoke` 真实跑一遍（§8.3 ①②③④⑦⑨⑩），失败项必须归因到「代码缺陷」或「冒烟脚本缺陷」并修复，**不允许**记「脚本问题」了事。

**无法出包的环境**（本机缺 rcedit/签名环境等）：`assert-fresh-build` 仍然要跑（`no build output` 本身就是结论），`acceptance.md` 记「未执行 + 具体缺什么」，**不得**用源码级测试通过替代打包态结论。

### 2.3 E3 · 走查证据表：把「清单」变成「可签字的表」

`desktop/README.md` 的走查清单是给人看的；`acceptance.md` 需要的是**结果**。本迭代补两段（`I2-7` = E2 的冒烟记录，`I2-8` = 走查表），11 行 × 5 列。

列的定义（**列名逐字固定，脚本会比对**）：

| 列 | 内容 |
|---|---|
| 步骤 | ①–⑪，与迭代 2 spec W9 的编号严格一致（复核：`docs/plans/agent-browser-workspace/spec.md:1131-1133` 逐项列出这 11 条） |
| 预期 | 一句话可判定的现象（不是「正常」这种词） |
| 实测 | 〔v2·P1-5〕**必须以下列三档之一开头**（见下） |
| 日期 | `2026-MM-DD` |
| 执行人 | 姓名/代号 |

〔v2·P1-5〕**「实测」列的三档制，替掉 v1 的「含未执行也算有结论」。** v1 的漏洞是：11 行全写「未执行」，脚本退出 0，AC-R3-6 就算通过——这是**合规的假证据**。迭代 2 spec W9 的原话是「未执行的行保持『未执行』，**不得空白通过**」，要求的是「有据」，不是「有字」。三档：

| 档位 | 前缀 | 硬性要求（脚本校验） |
|---|---|---|
| 已执行 | `已执行:` | 其后必须有非空描述，**且**该行对应能力若已由 E2 覆盖到自动化（例如 ⑦ 遮挡冻结帧、⑩ `Ctrl+L`），描述里必须引用具体命令或产物 |
| 未执行 | `未执行:` | 其后必须写**缺什么**（缺桌面包 / 缺真实站点账号 / 缺真机 等），只写「未执行」不满足 |
| 阻塞 | `阻塞:` | 其后必须写**阻塞它的缺陷 ID**（如 `P0-3` / `R-5`），且该 ID 必须在本文件或 `acceptance.md` 中可查到 |

并在 `I2-8` 表头上一行写**档位统计**：`已执行 N / 未执行 M / 阻塞 K（N+M+K=11）`。这样 N=0 时一眼可见是「一条都没验」，无法被当成通过。

新增 `desktop/scripts/check-walkthrough-table.js`（≤80 行，纯 node，**只依赖 `fs`/`path`**）：解析 `acceptance.md` 中 `## I2-8` 段，断言：

1. **表头列名逐字**为 `步骤 / 预期 / 实测 / 日期 / 执行人`（5 列，顺序一致）——这是 v1 声称但未实现的「格式即契约」；
2. ①–⑪ 共 11 行**全部存在**，且每行 5 列；
3. 「实测」列匹配 `^(已执行|未执行|阻塞):\s*\S`；
4. 档位统计行的三个数字之和为 11，且与逐行统计一致（防「表格改了统计没改」）。

任何一条不满足即非 0 退出，并打印**具体是哪一行哪一列**。**脚本只校验「有结论且档位合法」，不校验「结论是不是通过」**——通过与否是人的判断，脚本无权代签。

〔v2·P1-4〕**脚本自身的路径锚定**：它要读 `docs/plans/agent-browser-workspace/acceptance.md`，该路径只在**仓库根**成立，而文件在 `desktop/scripts/`。因此脚本内必须用

```js
const REPO_ROOT = path.resolve(__dirname, '..', '..');   // desktop/scripts -> repo root
const TARGET = path.join(REPO_ROOT, 'docs/plans/agent-browser-workspace/acceptance.md');
```

**不依赖调用者的 cwd**。允许用第一个 CLI 参数覆盖 TARGET（供测试注入夹具），但默认值必须是上面这条绝对锚定。§4.3 的命令相应注明在哪个目录执行。

### 2.4 E4 · 悬浮助手面板默认避让 Dock 视口（补 W5b）

迭代 2 只做了 FAB 拖动结束吸附（`fabAvoid.ts:22 snapFabClearOf`，接在 `useDraggableFab.ts:204`）。面板本身的位置由 `usePanelGeometry`（`src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx:56-113`）从 FAB 锚点推导并夹取，**从不看 `dockViewportRect`**（复核：`findstr dockViewportRect src/*.ts src/*.tsx` 在 `AgentChatFloatingPanel.tsx` 中 **0 命中**；该值由 `src/lib/browserWorkspaceStore.ts:36` 定义，写入点只有 `src/components/browser/BrowserViewport.tsx:88`，读取点只有 `useDraggableFab.ts:204` 与 `src/components/browser/__tests__/BrowserDock.test.tsx:202/205`）。

设计原则：**不动 `usePanelGeometry` 的既有夹取/翻转逻辑**，而是**在它上游改输入**——把「锚点」从「FAB 当前位置」改成「避让后的位置」。

#### 2.4.1 〔v2·P0-2〕坐标系与换算（v1 在此处会直接做坏交互）

v1 的候选算式 `right = parent.width - dockRect.left + gap` 把**两套坐标系**混用，必须先换算清楚。

| 量 | 坐标系 | 证据 |
|---|---|---|
| `parent.clientWidth/clientHeight`、面板的 `right/bottom`（距父容器右/下边） | **父容器边框盒**（工作区） | `AgentChatFloatingPanel.tsx:75-76`、`fabAvoid.ts:19` 注释、`DEFAULT_FAB_POSITION` |
| `dockViewportRect` | **视口坐标**（相对窗口内容区左上角） | `useViewBounds.ts:60` `element.getBoundingClientRect()` → `:61` `send(roundRect(box))` → `BrowserViewport.tsx:88-90` 取 `rect.x/rect.y` 写入 store |

两者相差父容器的 `getBoundingClientRect().left/top`。工作区不是全窗口（其上方有标题栏 + 任务栏，左侧有竖向栏），这个偏移是**几百像素量级**，不是舍入误差。直接用会把锚点算偏，再被 `clamp(SAFE, …)` 夹回边界，表现为「面板莫名贴边」或「该避让时不避让」——**这是本迭代唯一会直接把交互做坏的设计缺陷**，且现有测试拦不住（`BrowserDock.test.tsx:202/205` 只断言「rect 变化/归零」，从未断言坐标系）。

**换算（唯一允许的写法）**：把 `dockViewportRect` 一次性转成父容器坐标后再参与候选计算。

```ts
// parent 的视口原点（父容器边框盒左上角在视口中的位置）
const parentOrigin = parent.getBoundingClientRect();
const dockInParent = dockRect && {
  left:   dockRect.left   - parentOrigin.left,
  top:    dockRect.top    - parentOrigin.top,
  right:  dockRect.right  - parentOrigin.left,
  bottom: dockRect.bottom - parentOrigin.top,
};
```

`parentOrigin` 由调用方（`usePanelGeometry.recompute`，那里已持有 `parent` 元素）算好传入，**纯函数 `avoidDockRect` 不接触 DOM**。为保持纯函数签名可测，`avoidDockRect` 的输入里显式带 `dockRectOffset: { x: number; y: number }`（即 `parentOrigin.left/top`），换算在纯函数内做 —— 这样「坐标系」这件事本身可以被单元测住。

配套**必须**新增一条坐标系回归用例：给定「父容器 origin = (240, 128) + dockRect 视口坐标」，断言避让结果与「父容器 origin = (0,0)」时**不同**；并断言直接用未换算的 `dockRect` 会得到越界候选而被跳过。这条用例是 P0-2 的验收凭据（进 AC-R3-7）。

#### 2.4.2 纯函数契约

- 新增纯函数到既有 `fabAvoid.ts`（该文件现 53 行，已是本域唯一纯函数家，≤200 行基线内）：

```ts
export interface PanelBox { width: number; height: number }
export interface AnchorHint { right: number; bottom: number }
/** 返回一个不与 dockRect 相交的 (right,bottom) 锚点；无解时返回原锚点。
 *  dockRect 为视口坐标，dockRectOffset = 父容器边框盒的视口原点。 */
export function avoidDockRect(input: {
  anchor: AnchorHint; panel: PanelBox; parent: PanelBox;
  dockRect: { left: number; top: number; right: number; bottom: number } | null;
  dockRectOffset: { x: number; y: number };
  fabHalf: number; safe: number; gap: number;
}): AnchorHint
```

  候选序列（依次尝试，取第一个面板矩形与 `dockRect` **（已换算到父容器坐标）** 不相交者）：① 原位；② 左移：`right = parent.width - dockLeft + gap`；③ 右移：`right = parent.width - dockRight - panel.width - gap`；④ 上移：`bottom = parent.height - dockTop + gap`；⑤ 下移：`bottom = parent.height - dockBottom - panel.height - gap`。每个候选都过一遍既有的 `clamp(SAFE, 边界)`。**结果必须仍在父容器内**（否则跳过该候选）。五者皆不可行 → 返回原锚点（退化到迭代 2 行为，绝不摆到屏幕外）。

- 面板实际矩形的口径与 `usePanelGeometry` 保持一致，才能和 `dockInParent` 比较：`panelRight = right`、`panelBottom = bottom`（距父容器右/下边），故 `{ left: width - right - panel.width, top: height - bottom - panel.height }`。**必须复用 `usePanelGeometry` 里已有的这套换算式**，不得另立一套（`:85-86` 就是这么算的）。

- `AgentChatFloatingPanel.tsx`：`usePanelGeometry` 里在 `recompute()` 算出 `fabRight/fabBottom`（`:80-81`）之后、`clamp`（`:82-84`）之前，插入一次 `avoidDockRect({...})`。`dockRect` 取自 `browserWorkspaceStore.getSnapshot().dockViewportRect`，**必须订阅而非一次性读取**——把 `dockViewportRect` 加进 `useLayoutEffect` 依赖数组（现为 `:111` `[anchor, isHidden, panelRef, settle, onFabOcclusionChange]`），并在组件内用 `useBrowserWorkspaceStore()` 拿到会随 store 更新而重渲染的值（与 `BrowserViewport.tsx:87` 同一写法）。净增 ≤12 行。
- **只在「首次打开」时避让，用户拖动后以用户位置为准**：用 `useRef(false) placed`，`anchor` 来自用户拖动（`anchor` prop 存在且 `placed.current === true`）则跳过避让；持久化用户位置用既有 `localStorage` 路径（`try/catch`，缺失即默认）。
- 冻结帧行为**保持不变**（遮挡判定是几何的、安全的、正确的）。面板仍可能被用户拖到视口上，此时 `src/components/browser/BrowserViewport.tsx:101-104` 的 `data-native-inflow` 提示条照旧生效（`:103` 实测存在）——已有一条回归断言保证它不被当成遮挡物（`computeOcclusion` 用例），本迭代不得破坏。
- 测试：`fabAvoid.test.ts` 新增 7 例（原位可用即原位 / 左移 / 上移 / 视口占满全屏 → 返回原锚点 / `dockRect === null` → 原位 / 候选结果不越父容器 / **非零 `dockRectOffset` 时必须换算**）；`AgentChatFloatingPanel` 相关测试补「首次打开且 Dock 展开 ⇒ 面板矩形与 `dockViewportRect` 不相交」1 例、以及「用户拖动后不再避让」1 例，共 9 例（v1 写 8 例，漏了坐标系那一条）。

---

## 3. 文件 / 模块变更计划

> 全部为**新建或小改**；标「零改动」的文件本迭代一行也不碰。

### 3.1 E1 提示词预算

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/lib/video-editing-agent/systemPrompt.ts` | 改（〔v2·P0-3〕**两段同义压缩**：`视频轨道时长规则`(268 字符, `:730-734`) + `同轨不可重叠`(620 字符, `:736-741`)，净减 ≥120 字符，12 条规则锚点全部保留）；`L0_PROMPT_CHAR_CEILING` 18 900 → 19 800；新增导出 `L0_NO_INDEX_CHAR_MAX = 18_500` | 收回真实越界 + 让上限可推导 |
| `src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts` | 改（〔v2·P0-1〕**6 处**：`:76` 与 `:84` 用 `L0_NO_INDEX_CHAR_MAX`；`:154-157` 删净增断言并改为「上限一致性」断言；`:159` 用天花板；`:335` 用 `L0_NO_INDEX_CHAR_MAX`；`:82`/`:336` 常量 pin 改 19 800；`:163-168` 不变） | 断言自洽，语义不变 |
| `src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts` | 改（`:112-113` 拆成无索引 ≤18 500 与满索引 ≤19 800 两条） | 同上 |
| `src/lib/video-editing-agent/__tests__/fixtures/promptBudget.ts` | **新建**（≤100 行）〔v2·P1-1〕**放 `fixtures/` 不是 `helpers/`**：`vitest.config.ts` 的 `include` 覆盖 `src/**/__tests__/**/*.ts`，无 `describe`/`it` 的文件会被计为失败套件（"No test suite found in file"）；`fixtures/` 不在收集范围 | `measurePrompt()`：返回 `{ total, noIndexTotal, indexSection, segments }`，两个测试文件共用，数字可归因 |
| `src/lib/video-editing-agent/__tests__/fixtures/prompt-budget-baseline.json` | **新建** | 12 段基线长度（**由 `measurePrompt()` 实测写入**，禁手填），供棘轮断言 |
| `src/lib/video-editing-agent/__tests__/promptBudgetRatchet.test.ts` | **新建**（≤80 行） | 逐段棘轮 + 上限一致性 + 12 条规则锚点仍在 |
| `src/lib/video-editing-agent/skillContext.ts` | **零改动**（`SKILL_INDEX_TOTAL_MAX_CHARS` 已是导出常量，直接 import 复用） | 避免改渲染逻辑引入风险 |
| `src/lib/video-editing-agent/promptParts.ts` | **零改动**（浏览器规则 132/119 字符原样，I-5） | — |

### 3.2 E2 打包态冒烟

| 文件 | 动作 | 意图 |
|---|---|---|
| `desktop/scripts/build.js` | 〔v2·P1-2〕**改**：把 `loginHeuristics` 与 `pageScripts/` 的实际文件集补进 `BROWSER_WORKSPACE_MODULES`（`:101-110`）。**必须先让检查 1 红再改**，这是本迭代第一个先红后绿 | 补既有债：迭代 2 的 W1 模块此前根本不在发布包里 |
| `desktop/scripts/lib/assert-fresh-build.js` | **新建**（≤120 行） | 四项新鲜性检查（§2.2 表），纯 node，`require('asar')` 只读遍历 |
| `desktop/scripts/lib/assert-fresh-build.test.js` | **新建**（≤120 行） | 假目录树夹具：四检查各 1 通过 + 1 失败；另 1 例「只有 `app.asar` 没有 unpacked」 |
| `desktop/scripts/lib/browser-workspace-smoke.js` | 改（首部调用 `assertFreshBuild`，失败即 `fail()` 并返回；净增 ≤6 行） | 冒烟不再可能在旧包上「通过」 |
| `desktop/scripts/smoke-test.js` | **零改动** | 已挂好（`:20`/`:1035`，复核确认） |
| `desktop/scripts/test-browser-workspace.js` | 改（注册 `assert-fresh-build.test.js`，套件 **11 → 12**；现 `LOADERS` 有 11 项，见 `:7-19`） | 主进程套件表 |

### 3.3 E3 走查证据表

| 文件 | 动作 | 意图 |
|---|---|---|
| `docs/plans/agent-browser-workspace/acceptance.md` | 改（**新增** `## I2-7 打包态冒烟记录`、`## I2-8 人工走查表`；`:146`/`:148` 两处悬空引用随之落实；`I2-8` 表头带档位统计） | 消除悬空引用，验收可签字 |
| `desktop/scripts/check-walkthrough-table.js` | **新建**（≤80 行，只依赖 `fs`/`path`） | 〔v2·P1-5〕校验列名逐字 + ①–⑪ 齐全 + 三档前缀合法 + 统计与逐行一致（只验「有据」，不验「通过」） |
| `desktop/scripts/check-walkthrough-table.test.js` | **新建** | 缺行 / 列名不符 / 前缀非法 / 统计不符 / 合规表 五例（v1 只写三例，漏了列名与统计两条） |
| `desktop/scripts/test-browser-workspace.js` | 改（注册上一行的测试，套件 **12 → 13**） | 与 E2 同批改，一次提交 |

> 注：`acceptance.md` 是**记录**文件，本节点不改它（设计节点不产出实测结果）；实施节点按本表填写。

### 3.4 E4 面板避让

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/components/video/components/AgentChatDock/fabAvoid.ts` | 改（新增 `PanelBox`/`AnchorHint`/`avoidDockRect`，含 `dockRectOffset` 换算，净增 ≤60 行） | 覆盖 Dock 视口的纯函数锚点求解 |
| `src/components/video/components/AgentChatDock/__tests__/fabAvoid.test.ts` | 改（**+7 例**：五候选 + 退化 + 〔v2·P0-2〕坐标系换算） | 五候选 + 退化 + 坐标系 |
| `src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx` | 改（净增 ≤12 行：调用 + 依赖数组 + `placed` ref） | 默认位置避让，用户拖动后尊重用户 |
| `src/components/video/components/AgentChatDock/__tests__/*`（现有生命周期测试） | 改（+2 例） | 首次避让 / 拖动后不避让 |
| `src/components/browser/BrowserViewport.tsx` | **零改动** | 冻结帧与 `data-native-inflow` 提示条保持现状（I-4） |

### 3.5 文档同步

| 文件 | 动作 | 意图 |
|---|---|---|
| `CLAUDE.md`「Agent browser workspace」小节 | 改（+1–2 行） | 补「提示词上限由 18 500 + 1 300 推导」与「打包冒烟带新鲜性门禁」两条不变式；同步 `test:browser` 套件数（11 → 13） |
| `desktop/README.md` | 改（+3 行） | `test:browser` 新套件、`check-walkthrough-table` 用法 |

---

## 4. 接口设计

### 4.1 不新增任何对外接口

- HTTP（控制服务 `/v1/*`、后端 `/api/web-research/browser/*`、Next BFF）：**零改动**。
- 数据库与 `system_settings` 类别：**零改动**（无新键、无新表）。
- 环境变量：**零改动**（不新增任何 `*_TOKEN` / `*_URL`）。
- IPC（`window.ecliptrixDesktop.browser`）：**零改动**。

### 4.2 新增的**内部**契约（模块级，均非稳定 API）

```ts
// src/lib/video-editing-agent/systemPrompt.ts
export const L0_NO_INDEX_CHAR_MAX = 18_500;      // 新增导出
export const L0_PROMPT_CHAR_CEILING = 19_800;    // 值变更（18 900 → 19 800）

// src/lib/video-editing-agent/__tests__/fixtures/promptBudget.ts   〔v2·P1-1〕
export interface PromptMeasurement {
  total: number;                                  // 满索引最坏总长
  noIndexTotal: number;                           // 无索引最坏总长
  indexSection: number;                           // 「## 可用技能」段长度
  segments: Record<string, number>;               // 12 段长度（名字固定）
}
export function measurePrompt(): PromptMeasurement;

// desktop/scripts/lib/assert-fresh-build.js
export function assertFreshBuild(input: {
  appDir: string; srcRoot: string; payloads?: string[];
}): { ok: boolean; checks: Array<{ name: string; pass: boolean; detail: string }> };

// desktop/scripts/check-walkthrough-table.js  —— 仅 CLI，退出码 0/1
//   默认目标路径由 __dirname 锚定仓库根，不依赖 cwd（〔v2·P1-4〕）

// src/components/video/components/AgentChatDock/fabAvoid.ts
export function avoidDockRect(input: {
  anchor: { right: number; bottom: number };
  panel: { width: number; height: number };
  parent: { width: number; height: number };
  dockRect: { left: number; top: number; right: number; bottom: number } | null;
  /** 〔v2·P0-2〕父容器边框盒的视口原点，用于把 dockRect 从视口坐标换算到父容器坐标。 */
  dockRectOffset: { x: number; y: number };
  fabHalf: number; safe: number; gap: number;
}): { right: number; bottom: number };
```

### 4.3 命令（写进 `acceptance.md`，实施节点原样执行）

〔v2·P1-4〕**按「执行目录」分组**——v1 把仓库根相对路径与 `desktop/` 相对路径混在一段，执行者无法确定当前目录。以下命令照抄即可，每组标注 **cwd**：

```bash
# ── cwd = 仓库根 M:/takoAI/Ecliptrix ─────────────────────────────

# 1) 提示词预算（唯一权威命令，固定 node 环境）
npx vitest run --environment node src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts src/lib/video-editing-agent/__tests__/promptBudgetRatchet.test.ts

# 2) 面板避让（含 fabAvoid 坐标系用例）
npx vitest run src/components/video/components/AgentChatDock

# 3) 浏览器目录回归
npx vitest run src/components/browser src/contexts

# 4) 走查表完整性（脚本在 desktop/scripts，但目标文件在仓库根 ⇒ 可在仓库根调用）
node desktop/scripts/check-walkthrough-table.js

# 5) 类型
npm run type-check
```

```bash
# ── cwd = desktop ────────────────────────────────────────────────

# 6) 主进程套件（11 → 13 套）
npm run test:browser

# 7) 打包态：先建包，再验新鲜性，再冒烟（三步都要，缺一不算）
npm run build:dir
node scripts/lib/assert-fresh-build.js
node scripts/smoke-test.js
```

```bash
# ── cwd = backend-services/basic-service ─────────────────────────

# 8) 后端回归（本迭代不动后端，只验不减）
pytest tests -k "browser or workspace" --ignore=data
```

> 注：v1 的命令 4/5 写的是 `node scripts/check-walkthrough-table.js`，只有 cwd = `desktop` 时才成立，但脚本要读的 `docs/plans/.../acceptance.md` 只在仓库根成立 —— **两条约束互斥**，这是 v1 的实际错误。本版用「脚本内 `__dirname` 锚定仓库根」+「命令 4 在仓库根调用」同时满足两边。

---

## 5. 数据模型

本迭代**无数据库变更**。三处内存/JSON 形状如下。

### 5.1 `prompt-budget-baseline.json`（新增夹具）

```json
{
  "version": 1,
  "measuredAt": "2026-MM-DD",
  "noIndexTotal": 18400,
  "fullIndexTotal": 19493,
  "indexSection": 1093,
  "segments": {
    "rules": 1354, "residentTools": 406, "onDemandCatalog": 2337,
    "coreWorkflowTools": 9444, "projectState": 49, "recipes": 222,
    "skillIndex": 1093, "trackDuration": 239, "noOverlap": 3039,
    "generalResident": 1137, "plan": 77, "memory": 74
  }
}
```

语义：**每段为「不得超过」的棘轮上限**。

〔v2·P0-3 / P2-2〕**上表数值不得作为基线来源，只作数量级参照。** 两处必须注意：

1. `noOverlap: 3039` 与 v1 §2.1.3 的 `3 155` 本身就不一致，而**实测该段只有 620 字符**（§2.1.3，`:736-741`）——说明这一列是估的。基线**必须**由 `measurePrompt()` 实测输出直接写入（脚本可提供 `--write-baseline`，禁止手改）。
2. `noIndexTotal: 18400` 与 §2.1.3 的目标不自洽：现状 18 576、需收回 ≥76、实际目标收回 ≥120 ⇒ 目标应为 **≤18 456**。表里的 `18400` 只有当压缩量 ≥176 时才成立，而 AC-R3-2 只要求 ≥120。**统一取 `≤18 456`**，与「≥120」同步。

补齐后的字段（实施时以实测重写数值，键名固定）：

```json
{
  "version": 1,
  "measuredAt": "<实测日期>",
  "noIndexTotal": 18456,
  "fullIndexTotal": 19549,
  "indexSection": 1093,
  "segments": { "...": "12 个固定键名，值 = 实测长度" }
}
```

> `fullIndexTotal` 的推导：`noIndexTotal + indexSection` = 18 456 + 1 093 = 19 549，须 ≤ `L0_PROMPT_CHAR_CEILING`（19 800），留 251 字符余量。

### 5.2 走查表（`acceptance.md` 内的 markdown 表）

列固定为 `步骤 | 预期 | 实测 | 日期 | 执行人`；行 id 固定 `①`…`⑪`（全角圈号，与迭代 2 spec W9 一致，见 `docs/plans/agent-browser-workspace/spec.md:1131-1133`）。〔v2·P1-5〕「实测」列固定三档前缀 `已执行: / 未执行: / 阻塞:`，表头上方一行写档位统计。`check-walkthrough-table.js` 按这四个固定点解析（列名、行 id、前缀、统计），因此**表格格式即契约**：增列/改列名/改编号/漏统计都会让脚本失败（这是刻意的，防止格式漂移后校验静默失效）。

### 5.3 `avoidDockRect` 的输入输出（纯值对象）

无状态、无副作用、无 DOM 依赖。`dockRect === null`（Dock 未展开或视口为零尺寸）时**必须**返回原 `anchor`，从而与迭代 2 行为完全一致。

〔v2·P0-2〕**坐标约定（契约的一部分，不是实现细节）**：`dockRect` 进函数时是**视口坐标**；`avoidDockRect` 用 `dockRectOffset`（父容器边框盒的视口原点）**在函数内**换算成父容器坐标后，才与 `anchor/panel/parent` 同一空间比较。调用方负责提供 `dockRectOffset`，不得预先换算后再传 `{x:0,y:0}`（那会让坐标系回归用例失去意义）。

---

## 6. 测试与验收标准

### 6.1 测试矩阵

| 范围 | 命令 | 期望 |
|---|---|---|
| 提示词三文件（node 环境） | §4.3 命令 1 | **`Test Files 3 passed` / 0 failed**（现 2 文件 4 failed） |
| 逐段棘轮 + 规则锚点 | 同上（含 `promptBudgetRatchet.test.ts`） | 每段 ≤ 基线；上限一致性断言通过；12 条规则锚点仍在 |
| 主进程 | §4.3 命令 6（cwd=desktop） | **13 套全绿**（现 11 套 / 96 项） |
| 打包态 | §4.3 命令 7（cwd=desktop，三步） | 四项检查全通过，`browserWorkspaceSmoke` 全通过；或如实记「未执行 + 缺什么」 |
| 走查表 | §4.3 命令 4（cwd=仓库根） | ①–⑪ 每行有合法档位 → 退出 0 |
| 面板避让 | §4.3 命令 2 | 全绿，含 **9** 个新用例（v1 写 8，漏坐标系） |
| 浏览器目录回归 | §4.3 命令 3 | 全绿（迭代 2 基线 25 文件 / 250 项） |
| 后端回归 | §4.3 命令 8（cwd=backend-services/basic-service） | ≥231 passed / 1 skipped（本迭代不动后端） |
| 类型 | §4.3 命令 5 | **无新增**错误（基线 17 个，全在 `docs/diagnoses/**` 与一处 `SkillRouterSettingsPanel.test.tsx`） |
| Lint | 触碰文件逐个 eslint | 0 error |

### 6.1.1 〔v2·P1-8〕基线登记（实施前先跑一次并存档，AC-R3-8 依赖它）

v1 用了两个**没有来源命令**的基线数字（「12 个生命周期测试」「`BrowserViewport.tsx` diff 为空」），验收时无法判定。实施节点在**动手前**先把下面四条输出贴进 `acceptance.md` 的 `## I2-6.1 基线登记`：

```bash
# cwd = 仓库根
npx vitest run src/components/video/components/AgentChatDock      # 记下文件数/用例数
npx vitest run src/components/browser src/contexts                # 记下文件数/用例数
git status --short src/components/browser/BrowserViewport.tsx     # 必须为空（干净前提）
git rev-parse --short HEAD                                        # 基线提交号
```

此后 AC-R3-8 的「`git diff` 为空」才有可复算的对照物。

### 6.2 验收标准（AC-R3）

| AC | 条件 | 证据 |
|---|---|---|
| **AC-R3-1** | 〔v2·P0-1〕`systemPrompt.toolkit.test.ts:76/84/154-157/159/335/336` + `subtitleDisclosure.test.ts:112-113` **共 8 处**全部按 §2.1.5 表处置；三文件 0 failed；`L0_NO_INDEX_CHAR_MAX = 18 500`、`SKILL_INDEX_TOTAL_MAX_CHARS = 1 300` 两数字**一字不改**；`L0_PROMPT_CHAR_CEILING = 19 800` 且有一条断言证明它等于前两者之和 | §4.3 命令 1 的完整输出（须 `Test Files 3 passed`）+ `git diff` 仅含约定改动 |
| **AC-R3-2** | 〔v2·P0-3〕无索引最坏 ≤18 500 是**靠真实压缩 L0 文本**达成的，压缩**全部位于** `视频轨道时长规则` 与 `同轨不可重叠` 两段（`systemPrompt.ts:730-741`），且 §2.1.3 表里 **12 条规则锚点全部仍可匹配**；`promptParts.ts` 零改动 | 12 条锚点的 grep 输出（逐条）+ 压缩前后两段长度对比 + `git diff --stat src/lib/video-editing-agent/promptParts.ts` 为空 |
| **AC-R3-3** | 12 段长度棘轮生效：任一段超出基线即红（用人为 +1 字符验证过该断言有效，验证后还原） | `promptBudgetRatchet.test.ts` + 一次「先红后绿」记录 |
| **AC-R3-4** | 打包态：`assert-fresh-build` 四项检查在新 `build:dir` 产物上全通过；`smoke-test.js` 的 `browserWorkspaceSmoke` 真实执行并通过。二者缺一不得写「通过」，只能写「未执行 + 原因」 | `acceptance.md` I2-7（含命令、输出、日期） |
| **AC-R3-5** | `assert-fresh-build` 能识别旧包：① 前端 `page.js` mtime 回拨到 `src/` 之前 ⇒ `packaged-renderer-fresh` 判失败；② 〔v2·P1-2〕改 `build.js` 白名单**之前**的旧包 ⇒ `packaged-main-modules` 因缺 `loginHeuristics.js` 判失败（**两处都先红后绿**） | `assert-fresh-build.test.js` + 一次真包先红输出 |
| **AC-R3-6** | 〔v2·P1-5〕`acceptance.md` 的 `I2-7`、`I2-8` 两处悬空引用已落实；`I2-8` 表头列名逐字正确、有档位统计行、①–⑪ 每行「实测」以 `已执行:/未执行:/阻塞:` 开头且其后非空（`未执行` 必须写缺什么）；**若档位统计的 `已执行` 为 0，AC-R3-6 只能记为「格式合规、无实机证据」**，不得计为「走查通过」 | `check-walkthrough-table.js` 退出 0 + 人工核对档位统计 |
| **AC-R3-7** | 面板首次打开且 Dock 展开时，面板矩形与 `dockViewportRect` **不相交**；用户拖动后不再自动避让；`dockRect === null` 时行为与迭代 2 完全一致；〔v2·P0-2〕**非零 `dockRectOffset` 的坐标系用例通过** | 9 个新用例（含坐标系 1 例）+ 走查⑦ |
| **AC-R3-8** | 冻结帧不变量未被破坏：`BrowserViewport` 的 `data-native-inflow` 提示条仍在（`:103`），`computeOcclusion` 仍判「提示条不是遮挡物」；`git diff src/components/browser/BrowserViewport.tsx` 为空 | §6.1.1 的基线登记 + 既有回归用例保持绿 |
| **AC-R3-9** | `test:browser` 13 套全绿，`CLAUDE.md` 计数同步为 13，`desktop/README.md` 同步 | 命令输出 + `grep` 文档 |
| **AC-R3-10** | 零破坏：控制服务/HTTP/数据库/环境变量/IPC 零改动；后端 `pytest` 不减；`type-check` 无新增错误；触碰文件 eslint 0 error | 各命令输出 + `git status --short` 只含 §3 表文件 |

### 6.3 先红后绿（red-then-green）要求

〔v2〕**五条**必须先红后绿（v1 写三条，补了 E1 的规则锚点与 E2 的白名单缺口）：

| # | 对象 | 红的样子 |
|---|---|---|
| 1 | AC-R3-3 逐段棘轮 | 人为给某段 +1 字符 ⇒ 该段断言红 |
| 2 | AC-R3-5① `packaged-renderer-fresh` | 回拨 `page.js` mtime ⇒ 该项红 |
| 3 | AC-R3-5② `packaged-main-modules` | 改 `build.js` 之前的包 ⇒ 因缺 `loginHeuristics.js` 红 |
| 4 | AC-R3-7 `avoidDockRect` | 先写坐标系用例，未换算实现下必红 |
| 5 | AC-R3-2 规则锚点 | 先写 12 条锚点断言，压缩前若误删任一条即红 |

这是本仓既有惯例（迭代 1 的 `COVER-R3-REVIEW-1` 等就是靠先红后绿证明的），也是「断言真的会红」的唯一证据。

---

## 7. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | **`L0_PROMPT_CHAR_CEILING` 放宽到 19 800 被解读为「降标准」** | 中：护栏可信度 | 〔v2·P1-6〕数字由既有 18 500 + 1 300 推导，附算术证明；**唯一放宽项**且写死在文档与代码注释。**已知代价（必须写进提交说明）**：`agent.ts:259` 的运行时告警线随之从 18 900 上移到 19 800（它只是 `console.warn`，不是硬门禁），即「告警更晚 900 字符」。**替代保障**= §2.1.3 的 12 段棘轮（每段只减不增，比单个总数告警更严、能定位到段）+ 12 条规则锚点断言 |
| R-2 | 删除 AC-B8「净增 ≤400」后索引无人管 | 中 | `SKILL_INDEX_TOTAL_MAX_CHARS = 1 300` 成为唯一且可执行的上限；`skillContext.ts` 零改动，渲染逻辑不变；`promptBudgetRatchet.test.ts` 的 `skillIndex` 段棘轮兜住 |
| R-3 | 〔v2·P0-3 重写〕压缩 L0 文本导致模型行为回归（不知道规则） | **高** | **只允许同义压缩，禁止删规则**；压缩前先固化 §2.1.3 的 12 条规则锚点并在压缩后逐条 grep 断言仍存在；`promptParts.ts` 零改动；压缩后跑三文件 + `browserWorkspace.surface.test.ts`。若压缩量不足 ≥120，**停下来上报**，不得删规则、不得改 `promptParts.ts` |
| R-4 | `assert-fresh-build` 依赖 mtime，检出/复制会重置时间戳 → 误判 | 中 | mtime 只用于「渲染层是否新于源码」这一条，且允许显式覆盖（`--built-at <ISO>`）；另三条用**文件存在性与内容**，与时间无关 |
| R-5 | `build:dir` 在本机不可用（缺 rcedit/签名） | 中 | 如实记「未执行 + 缺什么」，不拿旧 `win-unpacked` 当结论（本仓前科）；`assert-fresh-build` 仍要跑，`no build output` 本身就是结论 |
| R-6 | 〔v2·P1-5 收紧〕走查表被「补个未执行」草率填写 | **高** | 三档前缀 + 「未执行必须写缺什么」+ 档位统计行；**`已执行` 为 0 时 AC-R3-6 只能记「格式合规、无实机证据」**。脚本仍只验「有据」不验「通过」，判断权留给人 |
| R-7 | 面板避让改变既有交互习惯 | 中 | 只在**首次打开**避让；用户拖动后尊重用户；五候选皆不可行时退回原行为，不摆到屏幕外 |
| R-8 | 触碰 `AgentChatFloatingPanel` 破坏既有生命周期测试 | 中 | 不动 `usePanelGeometry` 的夹取/翻转，只在上游替换锚点输入；先红后绿；跑全量 `AgentChatDock` 目录；基线数字由 §6.1.1 登记（不再口称「12 个」） |
| R-9 | `@vitest-environment node` 文档块掩盖真实的 jsdom 问题 | 低 | 它只对**这 2 个文件**生效；`effectApplyReceipts.ts` 的 `node:crypto` 问题登记为独立立项，不在本迭代修也不宣称修好（§2.1.4 已显式声明边界） |
| **R-10** | 〔v2·P0-2 新增〕**坐标系混用**：`dockViewportRect` 是视口坐标，面板几何是父容器坐标 | **高** | 契约里加 `dockRectOffset`，换算在纯函数内做且**必须**有专门回归用例（父容器 origin 非零时结果必须不同）；见 §2.4.1 |
| **R-11** | 〔v2·P1-2 新增〕**发布包缺模块**：`loginHeuristics.js` 从未进 `BROWSER_WORKSPACE_MODULES` | **高**（已实际发生） | 本迭代把它当第一个先红后绿修掉；`page-scripts-not-excluded` 改为**双向**一致检查，防再漏 |

### 开放问题

- **O-1（需产品确认，唯一真开放项）**：提示词绝对上限取 19 800（推荐，索引可用）还是坚持 18 500（则索引必须压到 ≤400，技能将不可发现）。工程侧推荐前者，并在实施前记录一次确认。**这是本方案唯一的「停点」**：若压缩量做不到 ≥120，也回到这里裁决。
- ~~**O-2**：`acceptance.md` 沿用还是新开目录~~ → 〔v2·P2-5〕**已裁决**：**沿用 `agent-browser-workspace/`**（理由：验收是一条连续证据链，拆目录会割裂「迭代 1 → 2 → 3」的可追溯性；只有 `spec.md` 因体量与语义独立新开 `agent-browser-workspace-r3/`）。移出开放问题，实施节点不再停下来问。
- **O-3**：走查需带桌面的真机与真实站点账号；若本机不具备，`I2-8` 只能按 `未执行: 缺 <X>` 填写，档位统计 `已执行` 为 0，AC-R3-6 以「格式合规 + 每行有据」收口，**不得**记「走查通过」。

---

## 8. 实施顺序与完成定义

**顺序**（依赖关系决定，不可并行处已注明）：

1. **基线登记**（〔v2·P1-8〕新增，只读）：按 §6.1.1 跑四条命令，把输出贴进 `acceptance.md` 的 `## I2-6.1`。
2. **E1 先量**（只读）：把 `measurePrompt()`（放 `__tests__/fixtures/`）与 12 段基线落地（**由实测写入，禁手填**），先让棘轮测试红，记录红输出。
3. **E1 规则锚点**（〔v2·P0-3〕新增，先红后绿）：先写 §2.1.3 表里 12 条锚点断言，确认当前全绿（作为「压缩前基线」）。
4. **E1 回收**：对 `视频轨道时长规则`(268) + `同轨不可重叠`(620) **同义压缩 ≥120 字符**（禁删规则、禁动 `promptParts.ts`）→ `W_noIndex ≤ 18 456` 转绿 + 12 条锚点仍绿。
5. **E1 断言改造**：按 §2.1.5 表改 **8 处**（含 `:76`/`:82`/`:336`）；`L0_PROMPT_CHAR_CEILING = 19 800`、导出 `L0_NO_INDEX_CHAR_MAX`、加一致性断言 → 三文件全绿（AC-R3-1/2/3）。
6. **E2 第一步（先红，〔v2·P1-2〕）**：`assert-fresh-build` 写好 → 在**未改 `build.js` 的旧包**上跑 → 检查 1 因缺 `loginHeuristics.js` 红，留档。
7. **E2 第二步**：把 `loginHeuristics` 与 `pageScripts/` 实际文件集补进 `BROWSER_WORKSPACE_MODULES` → 重新 `build:dir` → 四项检查转绿 → 挂进 `browser-workspace-smoke` → `smoke-test`（AC-R3-4/5）。
8. **E4**：`avoidDockRect`（含 `dockRectOffset` 换算，先红后绿）→ 接进 `usePanelGeometry` 上游 → 9 例全绿（AC-R3-7/8）。*（与 E2 无文件交集，可并行）*
9. **E3**：`check-walkthrough-table` + `acceptance.md` 的 `I2-7`/`I2-8`（依赖第 7 步的真实输出）。
10. **文档同步**：`CLAUDE.md`、`desktop/README.md`。
11. **全量回归**：§6.1 全表跑一遍，与基线对照，写进 `acceptance.md`。

**完成定义**：AC-R3-1…10 全部有结论（R3-4/R3-6 允许以「未执行 + 原因」收口，但不得缺行）；`acceptance.md` 的 `I2-7`/`I2-8` 已落实且无悬空引用；`git status --short` 只含 §3 表中的文件；提交按仓库风格（`fix:` / `feat:` 前缀 + 一句话摘要，`git add <具体路径>`，**严禁** `git add -A`）。

---

## 评审结论（Review Verdict）

### 结论：**有条件通过**

v1 的**诊断层面完全成立**，问题定位准确、数字经复现一致、矛盾算术证明正确——这部分不需要重做。但**修复方案**有 3 处会在实施时直接失败或做坏产品，必须在动手前按本版（v2）正文执行：E1 的删减对象在源码中不存在（P0-3）、E1 漏改 3 处同源断言（P0-1）、E4 混用两套坐标系（P0-2）。这 3 条已在本版正文修好，不再是「待办」。

**通过条件**（逐条可判，缺一不得开工）：

| # | 条件 | 落地位置 |
|---|---|---|
| C-1 | E1 的减字改为「两段同义压缩 ≥120 字符」，且 12 条规则锚点在压缩后逐条 grep 仍存在；`promptParts.ts` 零改动 | §2.1.3、§3.1、AC-R3-2 |
| C-2 | E1 按 §2.1.5 表改满 **8 处**断言（含 `:76`/`:82`/`:336`），验收看「三文件 0 failed」而非「4 条绿」 | §2.1.5、AC-R3-1 |
| C-3 | E4 的 `avoidDockRect` 必须带 `dockRectOffset` 换算，并有「父容器 origin 非零」的回归用例 | §2.4.1、§5.3、AC-R3-7 |
| C-4 | E2 先让检查 1 在旧包上红（缺 `loginHeuristics.js`），再补 `build.js` 白名单转绿；检查 1 必须能读 `app.asar` 内部条目 | §2.2、§3.2、AC-R3-5 |
| C-5 | `promptBudget.ts` 放 `__tests__/fixtures/`，基线 JSON **由实测写入**，禁手填 | §3.1、§5.1 |
| C-6 | 走查表用三档前缀 + 档位统计；`已执行` 为 0 时 AC-R3-6 只能记「格式合规、无实机证据」，不得记「走查通过」 | §2.3、AC-R3-6 |
| C-7 | §4.3 命令按 cwd 分组执行；`check-walkthrough-table.js` 内部用 `__dirname` 锚定仓库根 | §4.3、§2.3 |
| C-8 | O-1（19 800 vs 18 500）在实施前取得一次产品确认；若压缩量不足 ≥120，停下来回到 O-1 裁决，**不得**删规则或改 `promptParts.ts` | §2.1.3、§7 O-1 |
| C-9 | 五条先红后绿全部留档（逐段棘轮、`packaged-renderer-fresh`、`packaged-main-modules`、`avoidDockRect` 坐标系、12 条规则锚点） | §6.3 |

### 不阻塞、但请实施节点注意的两件事

1. **P2 未逐条改正文的地方**：只有 P2-1 的算术表述被改写（并改成「以 `measurePrompt()` 为唯一来源」），其余 P2 都是口径澄清，已在对应小节就地标注，不影响可实施性。
2. **本轮未实测打包**：P1-2/P1-3 的结论来自 `electron-builder.yml` + `build.js` 的静态阅读。若实施时实测发现产物结构与本节描述不同，**以实测为准**，并把差异回填到 §2.2 与本节的复核说明里（这是本评审唯一的证据边界，已如实标注）。

### 附：本次评审动过的位置（便于 diff 审阅）

本版仅修改 `docs/plans/agent-browser-workspace-r3/spec.md`，未触碰任何源码，未执行 `git commit`。改动集中在：标题版本行、新增 `## 评审记录`（含问题总表、P0/P1 详述、成立项留档）、§2.1.1（算术口径）、§2.1.2（三概念拆分）、§2.1.3（整段重写：同义压缩 + 12 条锚点）、§2.1.4（边界声明）、§2.1.5（新增同源断言清单）、§2.2（第 0 步 + asar + 产物根）、§2.3（三档制 + 路径锚定）、§2.4（新增坐标系小节 + 契约）、§3.1–§3.4（文件表）、§4.2/§4.3（契约与命令分组）、§5.1/§5.2/§5.3（基线与坐标约定）、§6.1/§6.1.1/§6.2/§6.3（矩阵、基线登记、10 条 AC、5 条先红后绿）、§7（R-1/R-3/R-6/R-8/R-9 改写 + 新增 R-10/R-11 + O-2 移出开放问题）、§8（顺序改为 11 步）。

---

## 实施过程发现的方案缺陷

> 本节由实施节点追加（任务约束：设计方案与实测冲突时**不得静默偏离**，须记录后按实测执行）。
> 全部条目均以本机实测为判据，命令可原样重跑。**未执行 `git commit`。**

### D-1（P0 级，推翻 §2.2 / R-11 的核心论断）「发布包缺 `loginHeuristics.js`」不成立

- **spec 原文**：P1-2 与 R-11 断言 `build.js` 的 `BROWSER_WORKSPACE_MODULES` 白名单「漏了 `loginHeuristics` 与 `pageScripts/` 目录」，因此「发布态根本没有这个模块」。
- **实测**：
  - `desktop/electron-builder.yml:20-24` 的 `files` 是 **`main/**` 目录通配**，不是白名单。白名单只在 `build.js` 里做**构建期存在性断言**（`checkPayloads`），不决定打包内容。
  - 直接遍历既有产物：`node -e "require('@electron/asar').listPackage('release/win-unpacked/resources/app.asar')"` → **`\main\browserWorkspace\loginHeuristics.js` 与 `pageScripts\{index,snapshot,act,overlay,sentinel}.js` 全部在包内**。
  - `pageScripts/` 磁盘实际文件集 = `index|snapshot|act|overlay|sentinel`（+ `pageScripts.test.js`），与白名单**逐字一致**，**不存在缺口**。
- **真实缺口只有一处**：`loginHeuristics` 未进白名单，症状是 **`build.js` 的载荷断言漏检**（少一道保险），而**不是**发布包缺模块。
- **处置**：仍按 spec 把 `loginHeuristics` 补进白名单（这是对的），但把结论降级为「构建期断言补漏」，不再宣称「发布包缺模块」。`assert-fresh-build` 的检查 3 从「白名单漏一个 = 发布态静默缺模块」改写为「白名单与磁盘**双向**一致」，措辞已同步。

### D-2（P1 级）产物根目录与渲染层入口名与 spec 不符

- **spec 原文**（§2.2）：产物根为 `desktop/build/win-unpacked/`，检查 2 要验 `resources/frontend/page.js`。
- **实测**：
  - `electron-builder.yml:17` `directories.output: release` ⇒ 真实产物根是 **`desktop/release/win-unpacked/`**（`build/` 只是 `extraResources` 的**输入**目录，从不含 `win-unpacked`）。
  - `resources/frontend/` 是 Next **standalone** 输出，入口是 **`server.js`**（无 `page.js`）。
- **处置**：`resolveAppDir` 依次探测 `release/win-unpacked` → `build/win-unpacked` → `release/mac`；检查 2 改判 `resources/frontend/server.js` 的 mtime。二者都不是「设计意图变了」，而是 spec 的静态阅读错误，故按实测实现。

### D-3（P1 级）§2.1.3 的两段实测长度与 spec 不符，目标值需重算

- **spec 原文**：`视频轨道时长规则` = 268 字符、`同轨不可重叠` = 620 字符；索引段 1 093；目标 `noIndexTotal ≤ 18 456`（收回 ≥120）。
- **实测**（`measurePrompt()`，见 §5.1 的权威口径）：
  - 压缩**前**：`trackDuration` = **241**、`noOverlap` = **618**（合计 859，非 888）。
  - 索引段 = **1 095**（非 1 093）。
  - `noIndexTotal` = 18 576、`fullIndexTotal` = 19 673 —— **与 spec 完全一致**。
- **处置**：不接受「收回 ≥120 就必然 ≤18 456」的推演，改为**逐轮实测直到达标**；最终 `noIndexTotal = 18 455`、`fullIndexTotal = 19 552`（收回 **121** 字符）。过程中曾一次压到 18 456 但同时把规则 1 的措辞改坏（「必须最长的轨道」），被**规则锚点断言当场判红**并回退——这条断言的价值由此得到实证（对应 §6.3 第 5 条先红后绿）。
- **副产物**：spec §5.1 表中 `noOverlap: 3039`、`trackDuration: 239` 等数字确认全部是估算，**不得**作为基线；基线 JSON 已由 `measurePrompt()` 实测写入。

### D-4（P2 级）「满索引 − 无索引 = 索引段」差 2 个字符

- **spec 原文**（§2.1.2 推论）：两者之差就是索引段长度。
- **实测**：差值 = 1 097 = 索引段 1 095 **+ 2**。多出的 2 个字符是 `sections.join('\n\n')` 的段间分隔符（有索引时多一段，就多一个 `\n\n`）。
- **处置**：一致性断言写成 `total - noIndexTotal === indexSection + 2`，并把「2」的来历写进测试注释，避免以后又被当成 bug 去「修」。

### D-5（P1 级）§2.4 的 `placed` 判据按字面实现会让避让**完全失效**

- **spec 原文**（§2.4.2）：「用 `useRef(false) placed`，`anchor` prop 存在且 `placed.current === true` 则跳过避让」。
- **实测为什么不行**：`AgentChatDock.tsx:224` 无条件把 `anchor={position}` 传进面板（`useDraggableFab` 的持久化位置，默认 `{right:24,bottom:48}`）。按字面实现，「`anchor` 存在」恒为真 ⇒ 首次打开也跳过避让。另有一处更隐蔽：若把判据写成「避让过一次就 `placed=true`」，`ResizeObserver` 触发的第二次 `recompute` 就会退回原始锚点——**避让等于没做**，而单元测试仍可能因为只渲染一次而变绿。
- **处置**：判据改为「**FAB 锚点相对『打开时』是否变过**」：
  - 首次 `recompute` 记录 `openedAnchorRef = {right,bottom}`；
  - 之后 `anchor` 与它不同 ⇒ 用户拖动过 ⇒ 跳过避让；
  - 面板隐藏（`isHidden`）时清空该 ref，下次打开重新避让。
  - 这条已由「用户拖动过之后不再自动避让」用例钉住（真机行为：拖过就尊重用户）。
- **量化偏差**：`AgentChatFloatingPanel.tsx` 净增约 **+30 行**（spec 要求 ≤12）。超出的原因是**订阅 store**（`useLayoutEffect` + `subscribe` + `useState`）与上述锚点记忆，二者都是正确性必需；删掉任何一个，避让都会在真实交互中失效。文件的夹取/翻转逻辑**零改动**（R-8 的实质要求已满足）。

### D-6（P2 级）AC-R3-8「`git diff BrowserViewport.tsx` 为空」在该基线下**不可能成立**

- **实测**：`git status --short src/components/browser/BrowserViewport.tsx` → **` M`**，即该文件在迭代 2 就已修改且**未提交**（基线提交 `4e1ad78f`）。
- **处置**：改为**内容哈希**判定本迭代零改动：
  `sha256 = f8186ed76213ec643c72c6a89f76311a8542791e70020ffe9dd457d9dc0f91a1`（记录在 `acceptance.md` 的 `## I2-6.1`）。这比 `git diff` 更强：它不依赖「基线本来就干净」这个未登记前提。

### D-7（P2 级）基线数字登记（v1 的「12 个生命周期测试」无来源命令）

- **实测**（cwd = 仓库根，改动前）：`npx vitest run src/components/video/components/AgentChatDock` → **7 files / 76 tests**；`npx vitest run src/components/browser src/contexts` → **10 files / 98 tests**。
- **处置**：已写入 `acceptance.md` 的 `## I2-6.1 基线登记`，后续所有对照都以它为准。

### D-8（环境限制，非缺陷）`build:dir` 与打包态冒烟**未执行**

- 本节点单次工具调用有上限，`npm run build:dir`（prepare-frontend → prepare-backend → prepare-ffmpeg → prepare-env → electron-builder）远超该上限。
- 既有 `desktop/release/win-unpacked` 是迭代 2 的**旧产物**，`packaged-renderer-fresh` 实测判红（渲染层 2026-11-25T17:30Z < 源码 2026-11-26T08:03Z）。
- **处置**：按 spec §2.2 的规矩，`acceptance.md` 的 `I2-7` 只写「未执行 + 缺什么」，**不拿源码级测试替代打包态结论**；同时把「门禁本身能不能识别旧包」做成 7 个临时树用例（不需要出包），使这部分的证据不依赖环境。

### 复核说明（对应 §2.2 结尾的「以实测为准」要求）

spec 在评审结论里已声明「本轮未实测打包，若实测发现产物结构不同，以实测为准并回填」。D-1 / D-2 正是那次回填：**`release/win-unpacked` 而非 `build/win-unpacked`**、**`server.js` 而非 `page.js`**、**包内已有 `loginHeuristics.js` 而非缺模块**。
