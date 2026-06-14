# 解说直接生成：首次生成应「替换」示意脚本，却始终「追加」

- **Bug slug**: `narration-direct-script-first-gen-append-instead-of-replace`
- **诊断角色**: 问题定位与分析（Subtask #0）
- **诊断日期**: 2026-06-14
- **涉及模块**: 视频编辑「解说」面板 / 「解说直接生成」两步式弹窗
- **相关需求/设计**: `docs/plans/ai-generate-script-modes/spec.md`（§2.4「追加」而非「替换」语义、§4.1/§8）

---

## 1. 问题描述（Problem description）

视频编辑功能里「解说」tab 的「AI 生成 → 解说直接生成」是一个两步式弹窗：第 1 步撰写/AI 改写解说文案，第 2 步逐句拆分精修，点「完成」后把拆分好的解说句子写入弹窗外面下方的「文本脚本（解说）」面板（即 `ScriptPanel` 的解说脚本 `segments`）。

用户期望的语义是：

- **首次生成**：面板里最开始展示的是系统的「示意 / 系统模板」文本脚本数据，首次「完成」时应当**替换掉**这些示意脚本内容。
- **后续生成**：第 2 次及以后才**追加**到已有解说脚本之后。

实际行为：**第一次「完成」也是直接「追加」**，新解说被拼在示意脚本之后（形成「示意脚本 + 新解说」并存），而不是替换示意脚本，导致面板里残留一堆无用的示意/模板段落，用户必须手动逐个删除。

---

## 2. 复现步骤（Reproduction steps）

> 关键前置条件：触发该 Bug 需要面板下方此刻**确实持有脚本 segments**（无论是系统示意占位被「落库」，还是项目已有脚本内容）。下面给出两条都可稳定复现的路径，路径 A 是测试最常踩到的「示意脚本 + 首次生成」场景。

### 复现路径 A —— 先与示意脚本发生过任意交互（最贴合用户描述）

1. `npm run dev`，打开视频编辑器并进入/新建一个项目。
2. 「文本脚本」面板默认展示 3 段系统示意脚本（来自 `getMockScriptSegments`，即用户口中的「示意 / 系统模板」数据）。
3. 对任意一段示意脚本做一次「自然的编辑」——例如双击某句解说句子、改一个字、回车保存（或对某段做一次 TTS / 关联视频等任何会回写 segments 的操作）。
   - 这一步会把「示意脚本」**真正写入** `content.scriptSegments`（见 §3 证据链第 3 点）。
4. 「解说」tab → 顶部「AI 生成」下拉 → 「解说直接生成」。
5. 第 1 步：在左侧输入或让右侧 AI 改写出一段解说文案 → 「下一步」。
6. 第 2 步：等待逐句拆分 → 「完成」。
7. **期望**：3 段示意脚本被新解说段落替换。
   **实际**：新解说段落被追加在 3 段示意脚本**之后**（示意脚本仍在）。← Bug

### 复现路径 B —— 项目已有脚本内容

1. 打开一个 `content.scriptSegments` 已非空的项目（例如此前通过主流程/Agent 生成过脚本的项目）。
2. 直接执行「解说直接生成」→「完成」。
3. **实际**：新解说追加在已有 segments 之后，首次生成不替换。← Bug

### 对照：纯净空项目当前「碰巧」是替换的（这正是设计脆弱点）

- 全新项目且**从未与示意脚本交互**时，`content.scriptSegments` 为 `undefined`，此时首次「完成」会以 `[...[], ...new] = [new]` 替换掉「示意占位」——这与 spec.md 第 98 行的设计预期一致。
- 但只要面板里的 segments 被「物化」进 `content.scriptSegments`（路径 A/B），首次生成立即退化为追加。用户实际操作中几乎总会先看到/动到示意脚本，所以这条「碰巧正确」的路径在真实使用中并不成立。

---

## 3. 根因分析（Root cause analysis，含证据）

### 3.1 直接根因：完成回调**无条件追加**，没有「首次替换」语义

「完成」最终落到父级的追加回调，硬编码 `[...existing, ...segments]`，从不区分「首次 / 后续」：

```ts
// src/components/video/VideoEditingInterface.tsx:1022-1027
// 「解说直接生成」完成时把逐句新解说 segments 追加（而非替换）到 content.scriptSegments，
// 复用面板既有的 handleUpdateSegments 单一写入路径，单次批量写入（评审决议 R3）。
const handleAppendNarrationSegments = useCallback((segments: ScriptSegment[]) => {
  const existing = scriptSegmentsRef.current ?? [];
  scriptGeneration.handleUpdateSegments([...existing, ...segments]);   // ← 永远追加
}, [scriptGeneration]);
```

调用链：

- 弹窗「完成」→ `useNarrationDirectScript.complete()` 组装逐句 segments 后单次上抛 `onComplete(segments)`：
  - `src/components/video/hooks/useNarrationDirectScript.ts:154-172`（`onComplete(segments); close();`）
- `onComplete` 即 `handleAppendNarrationSegments`：
  - `src/components/video/VideoEditingInterface.tsx:1029-1033`（`onComplete: handleAppendNarrationSegments`）
- 写入走 `handleUpdateSegments`，整段覆盖 `content.scriptSegments`：
  - `src/components/video/hooks/useScriptGeneration.ts:257-280`（`scriptSegments: updatedSegments`）

`scriptSegmentsRef` 镜像的是**真实的** `content.scriptSegments`（而非面板上展示的占位）：

```ts
// src/components/video/VideoEditingInterface.tsx:1013-1016
const scriptSegmentsRef = useRef<ScriptSegment[]>(content?.scriptSegments || []);
useEffect(() => {
  scriptSegmentsRef.current = content?.scriptSegments || [];
}, [content?.scriptSegments]);
```

### 3.2 设计假设的脆弱点：「示意脚本」是「展示态」而非「数据态」

面板渲染时用 `||` 回退到示意占位，但占位**只用于展示**，从不进入 `content.scriptSegments`：

```tsx
// src/components/video/VideoEditingInterface.tsx:2628-2634
<ScriptPanel
  segments={content?.scriptSegments || getMockScriptSegments(locale)}  // ← 仅展示回退
  ...
  onUpdateSegments={scriptGeneration.handleUpdateSegments}             // ← 回写真实 content
/>
```

示意数据来源（固定 id：`segment-1/2/3`、`sentence-1-1` …）：

- `src/components/video/data/mockScriptSegments.ts:6-104`（`getMockScriptSegments`）

设计文档把「首次替换」完全寄托在「`content.scriptSegments` 此刻为空」这一隐含前提上：

> `docs/plans/ai-generate-script-modes/spec.md:98`
> 注意：面板空态下渲染的是 `getMockScriptSegments`（占位 mock），但回写读取的是真实 `content.scriptSegments`，因此首次「完成」会以真实 segment 取代 mock 占位，符合预期。

> `docs/plans/ai-generate-script-modes/spec.md:260`（§8 验收）
> 完成写入语义 → 追加一个新 segment 到 `content.scriptSegments`，经 `handleUpdateSegments([...existing, ...new])` 合并写入；不替换、不按句拆成多 segment。

也就是说，「替换」从未被显式实现，只是「空数组追加 == 替换」这一巧合。一旦 `content.scriptSegments` 非空，巧合失效，立即变成追加。

### 3.3 闭环证据：示意占位会被「自然交互」物化进 `content`

面板里对示意脚本的任意一次保存类操作，都会把当前 `segments`（此刻就是示意占位）整体回写进 `content.scriptSegments`，从而满足 §3.1 里 `existing` 非空的条件：

```ts
// src/components/video/ScriptPanel.tsx:619-629（编辑句子保存）
const updatedSegments = segments.map(segment => ({          // segments == 示意占位
  ...segment,
  sentences: segment.sentences.map(sentence =>
    sentence.id === editingSentenceId ? { ...sentence, text: trimmedText } : sentence),
}));
onUpdateSegments(updatedSegments);                          // ← 示意占位被写入 content.scriptSegments
```

同类回写点（任一触发都会物化占位）：

- 编辑解说文案保存：`src/components/video/ScriptPanel.tsx:655-665`
- 为段落关联/AI 匹配视频：`src/components/video/ScriptPanel.tsx:700-719`、`775-815`
- 句子级字段增量回写（如 AI 视频提示词状态）：`src/components/video/ScriptPanel.tsx:107-121`

一旦上述任何一次发生，`content.scriptSegments` 从 `undefined` 变为「示意占位数组」，随后首次「解说直接生成」的 `existing` 即为示意占位，`[...existing, ...new]` 自然表现为「示意 + 新解说」并存——与用户报告完全吻合。

### 3.4 排除项（确认占位**不会**被自动落库的两条路径已排查）

- 自动保存只序列化 `content`，不注入示意：`src/components/video/projects/hooks/useProjectAutosave.ts:92-108` + `src/lib/api/videoProjects.ts:normaliseProjectDataForSave`（仅做剥离，不补 `scriptSegments`）。
- 新建项目不带脚本种子：前端 `src/components/video/projects/VideoProjectListView.tsx:169-183`（`createVideoProject` 不传 `project_data`）；后端 `backend-services/basic-service/app/services/video_project_service.py:385`（`project_data=payload.project_data or {}`）。

> 结论：根因是**前端首次写入语义缺失**，与后端/持久化无关。

### 3.5 一句话根因

`handleAppendNarrationSegments` 永远执行 `[...existing, ...new]`；所谓「首次替换示意脚本」从未被实现，仅依赖「`content.scriptSegments` 恰好为空」的巧合。而面板里的示意脚本是**展示态占位**，只要被任意交互（编辑/TTS/关联视频）或项目本就有脚本而物化进 `content.scriptSegments`，巧合即失效，首次生成退化为追加。

### 3.6 评审补充证据：占位 id 的「唯一性」——推荐方案安全性的基石

> 评审动机：推荐方案 A 的语义是「`existing` 是系统示意占位时 → **替换（丢弃 existing）**」。这条路径一旦**误判**（把真实脚本认成占位）就会**删除用户内容**，是比当前 Bug 更严重的回归。因此「占位 id 不可能与真实脚本 id 碰撞」必须被证明，而非默认。原报告 §6 只声称「占位 id 稳定」，未证明唯一性。此处补全该证据。

**(1) 全仓只有 `getMockScriptSegments` 产出 `segment-1/2/3` 这组固定 id**（即示意/系统模板）：

- `src/components/video/data/mockScriptSegments.ts:11、36、67`（segment id `segment-1/2/3`，无任何动态后缀）。
- 这组 id 与 locale **无关**（id 是字面量，仅 `title/text` 随 i18n 变化）——见同文件 `t.defaultContent.scriptSegments.*` 仅作用于文案。

**(2) 所有「真实脚本」生成路径都使用与之互斥的 id 前缀**，不可能落到 `segment-1/2/3`：

| 真实脚本来源 | segment id 形态 | 位置 |
|---|---|---|
| Agent 结构化脚本同步（`set_script_with_narration`） | `agent-segment-${i}` | `src/components/video/VideoEditingInterface.tsx:616` |
| Agent 文本解析为脚本 | `agent-segment-${i}` | `src/components/video/VideoEditingInterface.tsx:85、96` |
| 解说直接生成（本 Bug 的新内容） | `seg-<uuid>` / `sent-<uuid>`（`genId`） | `src/components/video/hooks/useNarrationDirectScript.ts:21-26、163、166` |
| AI 视频脚本 | `ai-video-seg-${Date.now()}-...` | `src/components/video/hooks/useEnhancedScriptGeneration.ts:419`、`components/AIVideoScriptTab/AIVideoScriptTab.tsx:13` |
| 故事板脚本 | `storyboard-seg-${packId}-...` | `src/components/video/hooks/useStoryboardScriptGeneration.ts:578` |
| ScriptPanel 手动新增句子 | `sentence-${Date.now()}`（仅 sentence 级，且带时间戳后缀，≠ 固定 `sentence-1-1`） | `src/components/video/ScriptPanel.tsx:1558、1593` |

**(3) `getMockScriptSegments` 从不被任何代码「写入」`content`**——它只出现在「展示回退」一处：

- 全仓引用点（grep `getMockScriptSegments`）：`VideoEditingInterface.tsx:29`（import）、`:2629`（仅作 `content?.scriptSegments || getMockScriptSegments(locale)` 展示回退）、`data/mockScriptSegments.ts:6/107`（定义）、`data/index.ts:2`（re-export）。**没有任何写入路径**。
- 这与 §3.4 排除项相互印证：占位之所以会进 `content`，唯一途径是 §3.3 的「面板交互把 `segments` prop（此刻=占位）整体回写」，而非任何代码主动注入占位。

**结论（安全性定理）**：`content.scriptSegments` 中出现 id ∈ `{segment-1, segment-2, segment-3}` 的 segment，**当且仅当**它是被物化的示意占位——真实脚本永远不会携带这些 id。因此「按占位 segment id 集合判定 → 命中即替换」**不存在误删真实内容的可能**。这是推荐方案 A 成立的关键前提，原报告缺此一环，现补齐。

---

## 4. 影响面（Impact surface）

- **功能**：仅影响视频编辑器「解说」tab 的「解说直接生成」首次写入语义；「视频理解生成」本期为占位弹窗，不受影响。
- **触发面**：任何「面板已有脚本 segments」的场景——
  - 用户先看/编辑过系统示意脚本（最常见，几乎是默认路径）；
  - 项目此前已通过主流程/Agent/视频理解生成过脚本。
- **用户后果**：
  1. 首次生成后面板残留示意/模板段落，需要手动逐段删除，破坏「一键生成解说」体验。
  2. 残留的示意 segments 会继续参与下游 TTS、字幕识别、AI 视频匹配/生成等操作，可能基于无意义的占位文案产出无用音频/视频/字幕素材。
  3. 这些垃圾 segments 会随自动保存被持久化进 `project_data`，污染项目数据。
- **不影响**：数据不会丢失（是「多」而非「少」）；纯净且零交互的空项目当前仍是替换（但不可依赖）。

---

## 5. 候选修复方案（Candidate fixes）

| 方案 | 思路 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A. 占位识别 + 首次替换**（推荐） | 在 `handleAppendNarrationSegments` 中判断 `existing` 是否「为空 **或** 仍是系统示意占位（按 `getMockScriptSegments` 的固定 id 集合识别）」。若是 → 用 `segments` **替换**；否则 → `[...existing, ...segments]` 追加。识别逻辑抽成 `isPlaceholderScript(segments)` 导出到 `mockScriptSegments.ts`。 | 低（仅改 1 个回调 + 新增 1 个纯函数） | 低。占位 id 稳定（`segment-1/2/3`），即便用户改过占位文案 id 不变仍可识别；不引入持久化/迁移。 | 小 |
| **B. 显式「是否已有用户脚本」状态位** | 在 `content`（或 store）新增 `hasUserAuthoredScript` 标志：首次解说生成或任意「真实创作」时置真。回调据该标志决定替换/追加。 | 中（改 `VideoEditingTaskContent` 类型 + 多处写入点 + 持久化兼容旧项目） | 中。需考虑旧项目无该字段时的默认值与迁移；写入点分散易遗漏。 | 中 |
| **C. 让示意占位成为真正「空态」，首次走替换通道** | 不再把占位当可编辑 segments 物化；明确区分「空态占位」与「真实内容」，首次完成走 `handleScriptGenerated`（整体替换），后续走追加。 | 高（动 `ScriptPanel` 占位/编辑行为 + 双写入通道） | 高。`ScriptPanel` 已 2700+ 行且 spec R11 禁止在其中新增业务分支；回归面大。 | 大 |

> 说明：方案 A 与 B 可叠加（A 处理「占位」，B 处理「项目已有真实脚本但用户仍希望首次解说替换」的边界），但就用户当前诉求（替换示意/系统模板）而言，A 已足够且最小化破坏面。

---

## 6. 推荐方案（Recommended fix）

**采用方案 A：占位识别 + 首次替换。**

理由：

1. **精准命中用户诉求**：用户要的是「首次替换示意/系统模板，后续追加」。方案 A 把「替换」从隐式巧合变成显式判断——`existing` 为空或仍是系统示意占位时替换，否则追加——语义与用户期望一一对应。
2. **最小破坏面**：只改 `VideoEditingInterface.handleAppendNarrationSegments` 一个回调，并在 `mockScriptSegments.ts` 旁新增一个纯函数 `isPlaceholderScript(segments)`（按 `getMockScriptSegments` 的固定 segment/sentence id 集合判定）。不触碰 `ScriptPanel`（符合 spec R11「禁止在该超大文件新增业务分支」），不改类型、不动持久化、无迁移成本。
3. **稳健**：示意占位 id 恒定（`segment-1/2/3`、`sentence-i-j`），用户即便改过占位文案 id 也不变，识别依然可靠；判定为「占位」时替换，符合「示意数据本就该被首条真实解说取代」的直觉。
4. **可测**：可对 `handleAppendNarrationSegments`/`isPlaceholderScript` 直接补单测——
   - `existing 为空 → 结果 == new`（替换）；
   - `existing == 系统示意占位 → 结果 == new`（替换）；
   - `existing == 真实非占位 segments → 结果 == [...existing, ...new]`（追加）。

> 落地提示（交由 Subtask #2 实现，本节不写修复代码）：
> - 新增 `export function isPlaceholderScript(segments): boolean`，依据 `getMockScriptSegments(locale)` 的 id 集合做集合相等判定（覆盖 zh-CN / en 两种 locale 的同一组 id）。
> - `handleAppendNarrationSegments` 改为：`const replace = existing.length === 0 || isPlaceholderScript(existing); handleUpdateSegments(replace ? segments : [...existing, ...segments]);`
> - 同步更新 `spec.md §2.4 / §8` 中「首次完成靠空态巧合替换」的描述，改为「首次（空态或仅示意占位）替换、后续追加」的显式契约，并补对应单测。

---

## 7. 关键证据索引（File:line 速查）

| 证据 | 位置 |
|---|---|
| 无条件追加的完成回调（直接根因） | `src/components/video/VideoEditingInterface.tsx:1024-1027` |
| `scriptSegmentsRef` 镜像真实 content（非占位） | `src/components/video/VideoEditingInterface.tsx:1013-1016` |
| `onComplete` 绑定到追加回调 | `src/components/video/VideoEditingInterface.tsx:1029-1033` |
| 面板展示用 `||` 回退示意占位（展示态） | `src/components/video/VideoEditingInterface.tsx:2628-2634` |
| `complete()` 上抛 `onComplete(segments)` | `src/components/video/hooks/useNarrationDirectScript.ts:154-172` |
| `handleUpdateSegments` 整段覆盖写入 content | `src/components/video/hooks/useScriptGeneration.ts:257-280` |
| 示意/系统模板占位数据（固定 id） | `src/components/video/data/mockScriptSegments.ts:6-104` |
| 编辑句子保存 → 物化占位进 content | `src/components/video/ScriptPanel.tsx:619-629` |
| 编辑解说文案保存 → 物化占位 | `src/components/video/ScriptPanel.tsx:655-665` |
| 设计文档：首次替换依赖「空态巧合」 | `docs/plans/ai-generate-script-modes/spec.md:98`、`:260` |
| 排除项：自动保存不注入占位 | `src/components/video/projects/hooks/useProjectAutosave.ts:92-108` + `src/lib/api/videoProjects.ts`（`normaliseProjectDataForSave`）|
| 排除项：新建项目不带脚本种子 | `src/components/video/projects/VideoProjectListView.tsx:169-183`、`backend-services/basic-service/app/services/video_project_service.py:385` |
| 占位 id 唯一性（修复安全基石） | `src/components/video/data/mockScriptSegments.ts:11/36/67` vs 真实路径 `VideoEditingInterface.tsx:616/85/96`、`useNarrationDirectScript.ts:21-26`、`useEnhancedScriptGeneration.ts:419`、`useStoryboardScriptGeneration.ts:578` |

---

## 评审结论（Review Verdict）

> 评审角色：Subtask #1「分析报告评审与修复」。已对 §3 全证据链逐行复核源码、对 §5 候选方案做边界/并发/回归审查，并补齐 §3.6 缺失的「占位 id 唯一性」证据。下文为最终裁定。

### A. 根因证据审计：**成立，证据链闭合**

逐条复核结论：

1. **直接根因属实**：`handleAppendNarrationSegments`（`VideoEditingInterface.tsx:1024-1027`）确为无条件 `[...existing, ...segments]`，`existing` 取自镜像真实 `content` 的 `scriptSegmentsRef`（`:1013-1016`），经 `onComplete`（`:1031`）→ `useNarrationDirectScript.complete()`（`useNarrationDirectScript.ts:154-172`，`onComplete(segments); close()` 同步执行、无异步缺口）→ `handleUpdateSegments`（`useScriptGeneration.ts:257-280`，整段覆盖写入）。**该路径确实在失败场景中被执行**。
2. **症状与根因逻辑自洽（无替代解释）**：面板展示是 `content?.scriptSegments || getMockScriptSegments(locale)`（`:2629`）——是 **OR 回退**而非拼接。故「示意 + 新解说并存」**唯一可能**的成因，就是占位先被物化进 `content.scriptSegments`、再被首次生成追加。§3.3（`ScriptPanel.tsx:619-629` 等把 `segments` prop 整体回写）正是该物化通道，已核实保留段 id 不变。不存在「展示层错误拼接」之类的替代解释。
3. **「碰巧替换」的脆弱点属实**：spec.md:98 明文把「首次替换」寄托于「`content.scriptSegments` 恰好为空」，从未显式实现替换——核对原文一致。
4. **补强**：新增 §3.6 证明占位 id 全仓唯一（仅 `mockScriptSegments` 产出 `segment-1/2/3`，真实路径前缀互斥，且占位从不被写入 `content`），消除「按 id 判定替换」误删真实内容的隐患。这是原报告缺失、而修复安全性所必需的一环。

### B. 候选方案审计

- **方案 A（占位识别 + 首次替换）**：命中诉求、最小破坏面、可单测；§3.6 已证其无数据丢失风险。**采纳。**
- **方案 B（显式状态位）**：需改类型 + 多写入点 + 旧项目迁移，写入点分散易漏，超出当前诉求。**不采纳**（仅作为未来「真实脚本也想首次替换」的可选增强）。
- **方案 C（重构占位为真空态）**：触碰 2700+ 行 `ScriptPanel` 且违反 spec R11，回归面过大。**不采纳。**

### C. 最终推荐修复（单一方案）

**采用方案 A：占位识别 + 首次替换。** 在 `handleAppendNarrationSegments` 中按「示意占位 segment id 集合」判定，命中（或 `existing` 为空）即**替换**，否则**追加**。

判定建议（交 Subtask #2 落地，含本评审的两点精化）：

```text
PLACEHOLDER_SEGMENT_IDS = new Set(getMockScriptSegments().map(s => s.id))   // = {segment-1,2,3}
isPlaceholderScript(existing) =
    existing.length > 0 && existing.every(seg => PLACEHOLDER_SEGMENT_IDS.has(seg.id))

const replace = existing.length === 0 || isPlaceholderScript(existing)
handleUpdateSegments(replace ? segments : [...existing, ...segments])
```

精化要点与理由：

1. **只按 SEGMENT id 判定，不比 sentence id / 文案**：占位被「编辑句子 / 新增句子」后，segment id 恒为 `segment-1/2/3` 不变（`ScriptPanel.tsx:619-629`、`655-665` 保留段 id；新增句子是 sentence 级 `sentence-${Date.now()}`，不改段 id）。按段 id 判定对「占位内文案/句子被改动」天然鲁棒，也**与 locale 无关**（id 是字面量）——无需 locale 参数。
2. **用「子集（`every`）」而非「集合严格相等」**：因 §3.6 已证真实段 id 与 `segment-1/2/3` 互斥，子集判定**不会误删真实内容**；同时还能正确覆盖「用户先删掉 1~2 段占位再首次生成」的子场景（严格相等会在此退化为追加，违背诉求）。
3. **占位 id 从 `getMockScriptSegments()` 派生为单一真源**，不硬编码字面量，避免日后改 mock 时判定失配。
4. **并发/错误路径无新增风险**：`complete()` 同步 `onComplete→close`，单次批量 `handleUpdateSegments` 写入（既有 R3 修复）保持不变，方案 A 只在「已读到的 `existing`」上加一个纯分支，不引入新的读-写竞态。
5. **改动面最小**：仅改 `handleAppendNarrationSegments` 1 处 + 在 `mockScriptSegments.ts` 旁新增纯函数 `isPlaceholderScript`/导出 `PLACEHOLDER_SEGMENT_IDS`；不动 `ScriptPanel`（符合 spec R11）、不改类型、零持久化迁移。
6. **必做单测**（行为命名，非实现细节）：
   - `existing 为空 → 结果 === segments`（替换）；
   - `existing === 系统示意占位（segment-1/2/3）→ 结果 === segments`（替换）；
   - `existing === 占位但其中一句被编辑 → 仍替换`（段 id 不变）；
   - `existing === 真实脚本（agent-segment-* / seg-<uuid>）→ 结果 === [...existing, ...segments]`（追加，验证不误删）。

### D. 已知边界与非目标（明确划定，避免 Subtask #2 过度工程）

- **不做历史数据修复**：已被旧版本污染（占位 + 旧解说并存）的项目，其 `content.scriptSegments` 含 `seg-<uuid>` 等真实 id → 子集判定为「非占位」→ 后续生成仍追加、不清残留占位。这是**前向修复、零迁移**的有意取舍，符合诉求范围；如需清残留另开任务。
- **文档对齐（次要、非阻断）**：`spec.md §2.4/§8` 现把首次写入描述为「靠空态巧合替换 / 始终追加」，与本修复的显式契约相悖，建议在 Subtask #2 顺手改为「首次（空态或仅示意占位）替换、后续追加」。

**一句话裁定**：根因成立、证据链已闭合并补强；**最终推荐 = 方案 A（占位识别 + 首次替换）**，按段 id 子集判定、从 `getMockScriptSegments()` 派生占位 id 集合，最小改动且无数据丢失风险。
