# 「解说直接生成」两步弹窗 — 流式不显示 & 句子导出成单段 缺陷分析

> 子任务 #0「问题定位与分析」产出。本节**只做定位与分析，不写修复代码、不提交**。
> 对应本轮（第 2 轮）需求：
> 1. 「解说直接生成」弹窗输入消息点击发送后一直等待、左侧无文字产生，需要**像 ChatGPT 一样把文字流式输出到左侧**。
> 2. 第 2 步逐句拆分完成后点击「完成」，导出到外部「解说脚本」面板时**全部塞进了一个段落**，需要**一句一句对应地放进去**。

涉及功能在第 1 轮（提交 `d9dfc98`）引入，spec 见 `docs/plans/ai-generate-script-modes/spec.md`。

---

## 一、问题描述

### Bug 1 — 改写对话发送后左侧无任何流式文字
在解说脚本面板点击「AI 生成 → 解说直接生成」打开两步弹窗，第 1 步右侧对话框输入需求并「发送」后：
- 左侧文案区在整段流式过程中**始终为空**，没有任何字符逐步出现；
- 右侧助手气泡只显示一个静态「正在改写文案…」占位，看不到模型正在产出的文本；
- 只有在**整条流彻底结束之后**，左侧才会一次性整段出现完整文案。

对慢模型 / 推理模型而言，从「发送」到「整段出现」之间是一段无任何反馈的长等待，用户体感即「一直等待、没有反应、左侧没有消息产生」。需求要求改为 ChatGPT 式：文字在左侧逐字 / 逐块流式出现。

### Bug 2 — 拆分句子导出后挤在同一段落
第 2 步逐句拆分得到 N 条句子并编辑满意后点击「完成」，外部「解说脚本」面板只新增**一张卡片**，其「解说文案」区把全部句子拼接成**一整段**显示，而不是按句拆成 N 条独立条目。需求要求一句一句对应地放入面板。

---

## 二、复现步骤

环境：前端 `npm run dev`（:3000），后端 FastAPI（:8000）并在「设置 → 模型设置」配置好可用的 LLM 凭证（保证 `/api/chat` 能正常流式返回）。

### 复现 Bug 1
1. 进入视频编辑界面，定位到「解说脚本」面板（`narration` tab）。
2. 点击面板上方「AI 生成」下拉，选择「解说直接生成」，弹窗打开并停在第 1 步（compose）。
3. 在右侧对话输入框输入任意需求（如「写一段 30 秒咖啡品牌解说」），点击「发送」。
4. **观察**：左侧文案 `textarea` 在流式期间一直为空；右侧助手气泡只显示「正在改写文案…」；直到流结束才一次性出现整段文案。
   - 期望：左侧应随流逐字 / 逐块出现文字（ChatGPT 式），而非结束后一次性出现。

### 复现 Bug 2
1. 完成 Bug 1 第 3 步、待左侧出现一段文案（或手动在左侧粘贴一段含多句的文案，如「第一句。第二句。第三句。」）。
2. 点击「下一步」，等待 AI / 本地拆分完成，进入第 2 步（split），左侧出现逐句列表（如 3 条）。
3. （可选）增删改这些句子，点击「完成」。
4. **观察**：外部「解说脚本」面板只新增 1 张卡片，其「解说文案」区把 3 句拼成一段（如「第一句。第二句。第三句。」）显示在一个 `<p>` 里。
   - 期望：面板按句新增条目（一句一条），互相对应。

---

## 三、根因分析（含证据）

### Bug 1 根因：左侧只在「流结束后一次性回写」，流式期间无任何增量写入左侧；右侧又刻意隐藏流式正文

**(1) `/api/chat` 流式管道本身是通的**，逐块下发 `data: {"content": "..."}`：

```ts
// src/app/api/chat/route.ts:148
const payload: { content?: string; reasoning?: string } = {}
if (event.kind === 'content') payload.content = event.text
else if (event.kind === 'reasoning') payload.reasoning = event.text
controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
```

**(2) `useNarrationChat` 在流式期间确实把内容累加进了「右侧助手消息」的 state**，但它**只更新了 assistant 气泡的 `content`，没有任何一处把增量写到左侧 `draftText`**：

```ts
// src/components/video/hooks/useNarrationChat.ts:178
if (chunk) accumulated += chunk;
if (reasoningChunk) accumulatedReasoning += reasoningChunk;
setMessages((prev) => {            // ← 只写右侧消息列表
  const next = [...prev];
  const idx = next.length - 1;
  if (idx >= 0 && next[idx].role === 'assistant') {
    next[idx] = { ...next[idx], content: accumulated, reasoningContent: accumulatedReasoning };
  }
  return next;
});
```

左侧 `draftText` 的写入**只发生在整条流结束之后、一次性回写**：

```ts
// src/components/video/hooks/useNarrationChat.ts:208
const rewritten = stripCodeFence(accumulated).trim();
// 流正常结束且有内容：整段回写左侧文案（spec §2.2 B-3 一次性回写）。
if (!wasAborted && !errorMessage && rewritten) {
  onRewrite(rewritten);           // ← 唯一一次写左侧，发生在流末
}
```

`onRewrite` → 编排 hook 的 `handleRewrite` → `setDraftTextState(fullText)`：

```ts
// src/components/video/hooks/useNarrationDirectScript.ts:87
const handleRewrite = useCallback((fullText: string) => {
  setDraftTextState(fullText);
}, []);
```

**(3) 右侧面板在流式期间又刻意不渲染正文 `m.content`，只显示静态「正在改写文案…」占位**，所以连右侧也看不到流式文字：

```tsx
// src/components/video/components/NarrationDirectScriptModal/NarrationChatPanel.tsx:73
const streaming = !!m.isStreaming;
const body = m.summaryText
  ? m.summaryText
  : streaming
    ? t.narrationDirectScript.assistantThinking   // ← 流式时只显示「正在改写文案…」占位
    : m.content || '';                            // ← m.content 仅在非流式时才显示
```

（`assistantThinking` 文案：`src/lib/i18n.ts:4976` en=`Rewriting…` / 对应 zh=`正在思考…` 系列占位。）

**(4) 左侧 `textarea` 在流式期间还被设为只读**，进一步强化「左侧不会动」的观感（这一项本身不是 bug，但与上面叠加后无任何活体反馈）：

```tsx
// src/components/video/components/NarrationDirectScriptModal/ComposeStep.tsx:51
<textarea id="narration-draft" value={draftText}
  onChange={(e) => setDraftText(e.target.value)}
  readOnly={isStreaming}    // ← 流式只读
  ... />
```

**结论**：从「发送」到「流结束」这段时间里，**左侧零增量、右侧只显示占位**——没有任何活体反馈。这正是 spec §2.2 B-3 / 评审决议 R4 当初有意为之的「一次性回写、避免覆盖用户手改」设计；但该设计与本轮新需求（ChatGPT 式逐字流式到左侧）直接冲突。**根因是缺少一条「流式增量 → 左侧 draftText」的写入路径**（而非 `/api/chat` 故障）。慢 / 推理模型先吐 `reasoning` 再吐 `content` 时，空白等待更明显。

> 备注：若 LLM 凭证未配置，`/api/chat` 会抛错，最终会在 `useNarrationChat.ts:223` 把气泡替换成「改写失败：…」并触发顶部红色错误条。用户描述的是「一直等待、无反应」而非报错，故主因判定为**缺少流式到左侧的增量写入**这一交互缺陷，凭证缺失只是需排除的次要前置条件。

### Bug 2 根因：`complete()` 把全部拆分句 `join` 成单段 `narrationText`，只产出 1 个 segment

`complete()` 把第 2 步所有句子**拼接成一个字符串**塞进单个 `ScriptSegment.narrationText`，整段只生成 **1 个** segment：

```ts
// src/components/video/hooks/useNarrationDirectScript.ts:168
const complete = useCallback(() => {
  const sentences = splitRef.current
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
  if (sentences.length === 0) return;
  const segment: ScriptSegment = {
    id: genId('seg'),
    title: titleRef.current,
    narrationText: joinNarration(sentences.map((s) => s.text)),  // ← N 句拼成一段
    sentences: sentences.map((s) => ({ id: genId('sent'), text: s.text, narration: s.text })),
  };
  onComplete(segment);   // ← 只上抛 1 个 segment
  close();
}, [onComplete, close]);
```

`joinNarration` 的职责正是把多句无缝拼接为一段连续文本：

```ts
// src/components/video/hooks/useNarrationDirectScript.ts:32
function joinNarration(parts: string[]): string { /* A. + B. → "A. B." 单串 */ }
```

上抛后由父级**作为单个 segment 追加**：

```ts
// src/components/video/VideoEditingInterface.tsx:1024
const handleAppendNarrationSegments = useCallback((segment: ScriptSegment) => {
  const existing = scriptSegmentsRef.current ?? [];
  scriptGeneration.handleUpdateSegments([...existing, segment]);   // ← 追加 1 个
}, [scriptGeneration]);
```

外部「解说脚本」面板里，每个 segment 的「解说文案」区把 `narrationText` 当作**单个 `<p>` 段落**渲染：

```tsx
// src/components/video/ScriptPanel.tsx:2178
) : (
  <p className="text-sm text-foreground leading-relaxed">
    {segment.narrationText}     // ← 整段拼接文本 = 用户看到的「全部在一个段落」
  </p>
)
```

**结论**：当前实现「N 句 → 拼成 1 段 narrationText → 追加 1 个 segment → 面板渲染成 1 个 `<p>`」，正是用户看到的「全部放在了一个段落中」。要实现「一句一句对应地放进去」，需让导出按句生成**多个 segment（每句一个）**，而不是 1 个 segment 装全部。

> 关于「条目」的口径：外部面板里**一个 `ScriptSegment` 渲染为一张卡片**（`ScriptPanel.tsx:2134` 起的卡片体），卡片内的「视频脚本」子列表才是逐句展开。用户说的「一句一句放进去 / 一句一句对应」指的是**面板层的条目**，因此正确做法是「每句一个 segment」，而非仅把卡片内子列表展开。

---

## 四、影响面

| 维度 | 说明 |
|---|---|
| 受影响功能 | 仅「解说脚本」面板 → 「AI 生成」→「解说直接生成」两步式弹窗（第 1 步对话改写、第 2 步拆分导出）。 |
| 受影响用户 | 所有使用「解说直接生成」的用户：Bug 1 让第 1 步几乎不可用（无反馈、疑似卡死）；Bug 2 让第 2 步导出结果不符合「逐句」预期、后续逐句 TTS / 逐句 AI 视频等按句操作的颗粒度受影响。 |
| 不受影响 | 「视频理解生成」（本期仅占位）、既有脚本生成主路径、`useStoryboardChat` 等其它对话功能均不涉及。 |
| 风险关联 | Bug 2 改为「每句一 segment」会改变下方面板的条目数量与 TTS 颗粒度，需确认下游（批量 TTS、AI 匹配、句子级 AI 视频）对「每段仅一句」的形态兼容（结构上 `ScriptSegment` 字段不变，应兼容）。 |

---

## 五、候选修复方案对比

### Bug 1 候选

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A1（推荐）** | 在 `useNarrationChat` 增加「流式增量 → 左侧」写入路径：每次累加 `accumulated` 后，除更新右侧消息外，再通过新回调（如 `onStreamChunk(accumulated)` 复用到 `setDraftTextState`）把当前累计文本写入左侧 `draftText`；流末仍以 `stripCodeFence` 后的整段作权威回写。左侧 `readOnly={isStreaming}` 保留（只读但会随 value 实时更新）。 | 低（集中在 hook + 一个回调透传） | 低：与「流末权威回写」不冲突；只读规避了用户手改竞态 | 小 |
| A2 | 仅改右侧：流式时渲染 `m.content` 而非「正在改写…」占位（`NarrationChatPanel.tsx:73`）。 | 极低 | 与需求**偏差**：需求明确要「左侧」流式 | 极小 |
| A3 | A1 + A2 组合：左侧流式 + 右侧也显示流式正文。 | 低-中 | 低 | 小-中 |

### Bug 2 候选

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **B1（推荐）** | `complete()` 改为**每句一个 `ScriptSegment`**（`narrationText` = 该句、`sentences` = 单元素），并把 `onComplete` 签名改为接收 `ScriptSegment[]`；`handleAppendNarrationSegments` 一次性 `handleUpdateSegments([...existing, ...segments])`（单次写入，符合评审决议 R3）。 | 中（改 `complete` + 回调签名 + 类型 `UseNarrationDirectScriptReturn`/`onComplete`） | 低-中：需回归下方面板渲染与下游按段操作 | 中 |
| B2 | 保持 `onComplete(segment)` 单参，在 `complete()` 里循环对每句调用一次。 | 低 | **高（有 bug）**：`handleAppendNarrationSegments` 读的是 `scriptSegmentsRef.current`，该 ref 仅在 `content` 变更的 `useEffect` 后更新；同步循环 N 次时 ref 不会即时刷新，导致每次都基于同一 `existing` 追加、最终只剩最后一句（后写覆盖）。 | 低 |
| B3 | 不动数据结构，仅改面板把单 segment 的 `narrationText` 按句渲染成多行。 | 低 | 与需求**偏差**：面板层条目仍是 1 条；且与「逐句导出 / 逐句对应」语义不符 | 低 |

---

## 六、推荐方案与理由

- **Bug 1 → A1**：直接满足「ChatGPT 式把文字流式输出到左侧」的硬性需求，改动集中在 `useNarrationChat` 单一 hook，新增一条增量回调即可，对既有「流末整段权威回写（B-3）」是叠加而非替换，风险最低。可按需叠加 A2 让右侧也显示流式正文，但 A1 已闭环需求。注意此举有意修订第 1 轮 spec §2.2 B-3 / 决议 R4 的「一次性回写」决策——这是新需求明确要求的变更，符合多轮迭代「除非新需求明确要求否则不回改」的约束。

- **Bug 2 → B1**：唯一能真正做到「面板层一句一条目、互相对应」的方案；务必采用 `ScriptSegment[]` 批量回调 + **单次** `handleUpdateSegments` 写入，规避 B2 的 ref 陈旧竞态（这是把循环单写改批量写的关键理由）。落地时需回归：①下方面板逐句卡片正常渲染（`ScriptPanel.tsx:2134`）；②批量 TTS / AI 匹配 / 句子级 AI 视频在「每段一句」形态下行为正常（结构字段未变，预期兼容）。

> 交接给子任务 #1（评审）/ #2（实现）：本节已给出文件:行级证据与最小改面建议；实现时请保持改动最小、不要回滚第 1 轮既有代码，并在改完后按「二、复现步骤」手动回归一次。

---

## 七、关键证据索引（file:line）

- `src/app/api/chat/route.ts:148` — 后端逐块下发 `data:{content}`（流式管道正常）。
- `src/components/video/hooks/useNarrationChat.ts:178` — 流式累加只写右侧消息，无左侧增量写入。
- `src/components/video/hooks/useNarrationChat.ts:208` — 仅流末 `onRewrite` 一次性回写左侧。
- `src/components/video/hooks/useNarrationDirectScript.ts:87` — `handleRewrite` → `setDraftTextState`（唯一写左侧路径）。
- `src/components/video/components/NarrationDirectScriptModal/NarrationChatPanel.tsx:73` — 流式时右侧只显示占位、隐藏 `m.content`。
- `src/components/video/components/NarrationDirectScriptModal/ComposeStep.tsx:51` — 左侧 `textarea` 流式期间 `readOnly`。
- `src/components/video/hooks/useNarrationDirectScript.ts:168` — `complete()` 把 N 句 `joinNarration` 成单段、只产 1 个 segment。
- `src/components/video/VideoEditingInterface.tsx:1024` — `handleAppendNarrationSegments` 追加单个 segment。
- `src/components/video/ScriptPanel.tsx:2178` — 面板把 `narrationText` 渲染为单个 `<p>`（= 用户看到的「一个段落」）。
- 类型：`src/types/index.ts:180`（`ScriptSegment`）/ `:161`（`ScriptSentence`）；`src/components/video/types/videoEditingTypes.ts:493`（`UseNarrationDirectScriptReturn`，含 `complete`）。

---

## 八、评审结论（Review Verdict）

> 子任务 #1「分析报告评审与修复」产出。评审方式：逐条打开 #0 引用的源码与第 1 轮 spec 实地核对「该代码是否真的跑在失败路径上 / 是否有反例与替代解释 / 证据是否解释了现象」，并审查候选方案的边界、最小性与回归风险。**本节只评审与补证，不写修复代码、不提交。**

### 8.1 证据链复核结论：成立（含行号微校）

两处根因的 file:line 证据**全部实地命中、解释了观测现象**，仅个别行号有 ±2 行偏移，不影响结论：

- **Bug 1**：`useNarrationChat.ts` 流式循环（`:163`–`:196`）每块只 `setMessages` 更新右侧 assistant 气泡（`:180`–`:191`），全程**无任何写左侧 `draftText` 的语句**；唯一写左侧发生在流末 `onRewrite(rewritten)`（`:210`–`:212`）→ `handleRewrite`→`setDraftTextState`（`useNarrationDirectScript.ts:87`–`:89`）。右侧又在流式期间以 `t.narrationDirectScript.assistantThinking` 占位**顶替** `m.content`（`NarrationChatPanel.tsx:73`–`:77`，流式三元在 `:75`–`:77`），左侧 textarea 同时 `readOnly={isStreaming}`（`ComposeStep.tsx:55`）。→ 「发送到流末」之间左侧零增量、右侧仅占位，与「一直等待、左侧无文字」现象**完全吻合**。根因判定**缺少流式增量→左侧的写入路径**成立。
- **Bug 2**：`complete()`（`useNarrationDirectScript.ts:168`–`:185`）把 N 句 `joinNarration` 成单串塞进单个 `ScriptSegment.narrationText`、只 `onComplete(segment)` 上抛 1 个 segment；父级 `handleAppendNarrationSegments` 追加该单 segment（`VideoEditingInterface.tsx:1024`–`:1027`）；`ScriptPanel` 以 `segments.map` 一段一卡（`:2002`），卡内「解说文案」把 `narrationText` 渲染为单个 `<p>`（`:2179`–`:2181`，分析引用的 `:2178` 为 `) : (` 起始）。→ 「N 句拼 1 段 → 1 个 segment → 1 张卡 1 个 `<p>`」与「全部塞进一个段落」**完全吻合**。

未发现反例或更优替代根因；`/api/chat` 流式管道正常（`route.ts:148` 逐块下发 `data:{content}`，且 `useNarrationChat.ts:178` 已能累加 content），排除「后端不流式」这一替代解释。凭证缺失会走 `:223` 报错分支并弹红条，与用户「无反应（非报错）」描述不符，故为需排除的次要前置条件而非主因——此判定成立。

### 8.2 补充证据（强化薄弱环节）

原报告对「为何 B2 会丢句」「B1 改完下游是否兼容」给的论证偏口径，补三条实测证据：

1. **B2 ref 陈旧会丢句——实证**：`scriptSegmentsRef.current` 只在 `useEffect([content?.scriptSegments])` 里刷新（`VideoEditingInterface.tsx:1013`–`:1016`）。`complete()` 若按 B2 在同一同步 tick 内对 N 句各调一次 `onComplete`，每次 `handleAppendNarrationSegments` 读到的都是**同一份未刷新的 `existing`**（effect 要等渲染提交后才跑），于是每次都 `handleUpdateSegments([...existing, segment_i])`，**后写覆盖前写，最终只剩最后一句**。→ B2「有 bug」的判定证据充分，B1 的「批量单次写入」是必需而非偏好。
2. **spec 早已规定批量写入路径**：评审决议 R3（`docs/plans/ai-generate-script-modes/spec.md:21`、`:89`）原文即为复用 `handleUpdateSegments([...existing, ...new])`——**注意 `...new` 本就是复数展开**。B1 的 `[...existing, ...segments]` 正是 R3 钦定路径；B2 的逐次单写反而**违反** R3。这条把 B1 从「合理」抬升到「spec 一致」。
3. **B1 下游结构兼容——实证**：TTS 走 `convertScriptSegmentToSentenceRequest(segment, …)` **按 segment** 发起、segment 内**按句**转换（`ScriptPanel.tsx:1291`、`:1299`–`:1301`，文本择取 `narrationText` 优先、降级 `sentences`，`:1274`–`:1280`）；句子级 AI 视频以 `segmentId+sentenceId` 定位（`:2204` 子列表 + `handleGenerateAiVideoForSentence`）。B1 后每个 segment 仍是合法的「1 句 + 1 narrationText」结构，TTS 变为「N 个 segment 各转 1 句」、AI 视频定位不变。→ `ScriptSegment` 字段未动，**结构与下游兼容**，分析的兼容性假设证据落地。

### 8.3 候选方案裁决

**Bug 1 → 采纳 A1（流式增量写左侧）为唯一推荐**，否决 A2/A3：

- A2「仅右侧显示流式正文」与硬需求「**左侧** ChatGPT 式逐字」直接偏差，单用不达标；A3=A1+A2，A2 部分是可选锦上添花，不应纳入「最小修复」。
- A1 是满足需求的最小面：仅在 `UseNarrationChatOptions` 增一个增量回调（如 `onStreamDraft?(partial)`），在流式循环 `setMessages` 之后调用、把**仅含 content 的 `accumulated`** 透传给 `setDraftTextState`；流末仍由 `onRewrite(stripCodeFence(accumulated))` 做权威回写（修正流中可能露出的半截 ``` 围栏）。
- **关键边界（实现须按此定，避免踩坑）**：
  - **只回传 `accumulated`（content），不回传 `accumulatedReasoning`**——二者本就分开累加（`useNarrationChat.ts:178` vs `:179`），推理文本继续留在右侧可折叠区，**绝不能混进左侧 draft**。
  - **保留 `readOnly={isStreaming}`（`ComposeStep.tsx:55`）**：这正是 R4 防「流式中用户手改被结束回写覆盖」的竞态保护；A1 只改「无增量反馈」，不碰这层保护，故与 R4 不冲突（仅有意修订 R4/B-3 的「流末一次性回写」决策，属本轮新需求明确授权）。
  - **中止/出错时左侧状态**：现逻辑在 `!wasAborted && !errorMessage` 才回写（`:210`），A1 下用户取消会让左侧停在**已流入的半截文本**。这是 ChatGPT 式的可接受行为，**采「保留半截」为默认**（最小改动）；「发送前快照 draft、取消即还原」属可选增强，非必需。实现者须**显式选定**此行为，勿让其成为意外。

**Bug 2 → 采纳 B1（每句一 segment + 批量单次写入）为唯一推荐**，否决 B2/B3：

- B3「只改面板把单 segment 渲染成多行」面板层仍是 1 条目，与「一句一句对应」「逐句导出」语义不符，且后续逐句 TTS/AI 视频颗粒度仍绑在一卡内，偏差。
- B2「逐次单写」按 8.2-(1) 会丢句，**带 bug**，否决。
- B1 落地清单（最小面）：
  1. `UseNarrationDirectScriptOptions.onComplete` 由 `(segment: ScriptSegment) => void` 改为 `(segments: ScriptSegment[]) => void`（`useNarrationDirectScript.ts:17`）。
  2. `complete()`（`:168`–`:185`）改为**每个 trim 后非空句生成一个 `ScriptSegment`**：`narrationText`=该句、`sentences`=`[{id,text,narration}]`、`title`=`titleRef.current`，组成 `ScriptSegment[]` 后 `onComplete(segments)` **调用一次**。保留「全空→`return` 空操作」守卫（`:172`）。
  3. `handleAppendNarrationSegments`（`VideoEditingInterface.tsx:1024`）入参改 `ScriptSegment[]`，`handleUpdateSegments([...existing, ...segments])` **单次写入**（合 R3）。
  4. **`UseNarrationDirectScriptReturn.complete` 保持 `() => void` 不变**——原分析「改 `UseNarrationDirectScriptReturn`」表述略宽，实际只动 `…Options.onComplete` 与父级回调签名，无需改 Return 类型。
  5. 可选锦上添花：N 张卡共用同一 `defaultSegmentTitle`（zh「解说段落」/en「Narration segment」，`i18n.ts:7501`/`:4994`），可给标题补 1 基序号（`${title} ${i+1}`）提升「逐句对应」可读性；**非正确性必需**，可留给实现/产品定夺。
- **回归核对项**（实现后按「二、复现步骤」回归并核对）：① `ScriptPanel` 逐句出 N 张卡（`:2002`/`:2134`/`:2179`）；② 句子级 TTS 在「每段 1 句」下正常（`:1291`）；③ 句子级 AI 视频按 `segmentId+sentenceId` 仍命中；④ 普通「脚本生成」主路径不受影响（独立写入路径，未触碰）。

### 8.4 最终推荐（单一方案）

| Bug | 最终推荐 | 一句话理由 |
|---|---|---|
| **Bug 1** | **A1** — 在 `useNarrationChat` 加一条「content 增量 → 左侧 `setDraftTextState`」回调，保留流末 `stripCodeFence` 权威回写与 `readOnly={isStreaming}` | 唯一满足「左侧 ChatGPT 式流式」硬需求的最小面，与 R4 竞态保护正交、不回滚第 1 轮既有代码 |
| **Bug 2** | **B1** — `complete()` 每句一 `ScriptSegment`、`onComplete` 改 `ScriptSegment[]`、父级 `[...existing, ...segments]` 单次写入 | 唯一能做到「面板层一句一卡、逐句对应」且规避 B2 ref 陈旧丢句的方案，正是 spec R3 钦定的批量写入路径，下游结构兼容 |

**交接子任务 #2（实现）**：严格按 8.3 落地，改动限定上述 4–5 处文件；务必处理 8.3 Bug1 的「中止/出错左侧状态」决策与「reasoning 不入左侧」约束；改完按「二、复现步骤」手动回归一次，勿引入未规划文件或依赖。
