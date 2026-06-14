# 「解说直接生成」左侧文案不流式输出 —— 缺陷定位与分析

> 子任务 #0「问题定位与分析」产出。**本节只做定位与分析，不写修复代码、不提交。**
>
> 本轮用户需求（与「13-BUG修复2-系统模板 (副本)」一致）：
> 视频编辑里「文本脚本中的解说直接生成」功能 —— 用户在**右侧 AI 助手面板**输入需求并发送后，
> **左侧没有输出解说文案**；期望**左侧像 ChatGPT 一样实时（流式）输出**生成的解说文案，
> 且必须在**桌面客户端**上生效。

---

## TL;DR（先给结论）

- 用户描述的现象 = 上一轮（第 2 轮）已定位的 **Bug 1**（「左侧不流式、只在流末一次性回写」）。
- 该缺陷**已于提交 `bb53f3f`（2026-06-14）修复**：在 `useNarrationChat` 增加了 `onStreamDraft` 增量回调，把 content 逐块写入左侧 `draftText`（ChatGPT 式）。
- **当前 HEAD 源码已含修复**，且单测 10/10 全绿（含「流式回写左侧」用例）。工作区对 `src/components/video/` **无任何改动**。
- 因此**针对当前源码（`npm run dev`），该 Bug 不可复现** —— 左侧会随流逐块出现文字。
- 用户在**桌面客户端**仍看到「左侧无输出」，最可能的真因是 **R-A：客户端运行的是 `bb53f3f` 之前打包的过期 standalone 构建**（桌面端内嵌的是打包时冻结的前端快照）。
- 此外存在一条**当前 HEAD 仍真实存在的代码边缘缺陷 R-B**：当所配置的对话模型**只产出 reasoning、不产出正文 content** 时，左侧在流中与流末都**永久保持空白**，与现象完全一致。

> 处理建议（详见第六节）：先**核对/重建客户端构建**（R-A，操作层，不需改源码主路径）；若在全新构建上仍能复现，则落地 **R-B 的内容空守卫**（最小代码改动）。

---

## 一、问题描述

在「解说脚本」面板点击「AI 生成 → 解说直接生成」，打开两步式弹窗并停在第 1 步（compose，左=文案 textarea / 右=AI 对话）。在右侧对话框输入需求并「发送」后：

- **现象（用户报告）**：左侧文案区在整段过程中**没有任何文字出现**；体感为「发送后一直等待、左侧没有反应」。
- **期望**：左侧应随模型产出**逐字 / 逐块流式出现**文案（类似 ChatGPT），且必须在**桌面客户端**生效。

这正是第 2 轮分析（`docs/diagnoses/narration-direct-stream-and-split-export/analysis.md`）记录的 **Bug 1**。

---

## 二、复现步骤

环境：前端 `npm run dev`（:3000）+ 后端 FastAPI（:8000），并在「设置 → 模型设置」配置好可用 LLM 凭证（保证 `/api/chat` 能正常流式返回）。

1. 进入视频编辑界面，切到「解说脚本」面板（`narration` tab）。
2. 点击面板上方「AI 生成」下拉，选「解说直接生成」，弹窗打开并停在第 1 步（compose）。
3. 右侧对话输入任意需求（如「写一段 30 秒咖啡品牌解说」），点「发送」。
4. **观察左侧 `textarea`**：
   - **在已含 `bb53f3f` 的源码 / 全新构建上**：左侧随流逐块出现文字 → **符合预期，无 Bug**。
   - **在 `bb53f3f` 之前打包的桌面客户端上**：左侧整段空白，流末才一次性出现（或配合 R-B/R-C 完全空白）→ **复现用户现象**。

### 复现 R-B（当前 HEAD 仍存在的边缘缺陷）

1. 在「模型设置」把对话模型配置为一个**把答案放进 `reasoning_content`（OpenAI 兼容）/ `thinking`（Anthropic）通道、正文 `content` 为空**的推理模型。
2. 重复上面第 1～3 步。
3. **观察**：左侧**全程空白且流末仍空白**；右侧助手气泡里能在可折叠的「思考」区看到模型输出，但左侧解说文案区一字未出 → 与「左侧没有输出解说文案」**完全吻合**。

### 自动化证据（当前 HEAD 修复已生效）

```
npx vitest run src/components/video/hooks/__tests__/useNarrationDirectScript.test.ts
→ Test Files 1 passed (1) | Tests 10 passed (10)
```

其中用例 `sendChatMessage() streams a rewrite and writes the full text back to the draft`
（`src/components/video/hooks/__tests__/useNarrationDirectScript.test.ts:57`）断言：发送后 `draftText`
等于流式累计的完整文案 —— 证明「流式 → 左侧」路径在当前源码已通。

---

## 三、根因分析（含证据）

### 3.1 历史根因（已被 `bb53f3f` 修复，给出对照）

第 2 轮定位的 Bug 1 根因为「左侧只在流末一次性回写、流式期间无任何增量写入左侧」。`bb53f3f` 的修复把这条路径补上：

**(1) `/api/chat` 流式管道本就正常**，逐块下发 `data:{content}` / `data:{reasoning}`：

```ts
// src/app/api/chat/route.ts:148
const payload: { content?: string; reasoning?: string } = {}
if (event.kind === 'content') payload.content = event.text
else if (event.kind === 'reasoning') payload.reasoning = event.text
controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
```

底层 `streamLlmChat` 对 OpenAI / Anthropic 均会把正文作为 `content` 事件吐出：

```ts
// src/lib/llm/streamLlmChat.ts:141   (OpenAI)
if (delta.content) yield { kind: 'content', text: delta.content }
if (delta.reasoning_content) yield { kind: 'reasoning', text: delta.reasoning_content }
// src/lib/llm/streamLlmChat.ts:220   (Anthropic)
if (p.delta?.type === 'text_delta' && p.delta.text) yield { kind: 'content', text: p.delta.text }
else if (p.delta?.type === 'thinking_delta' && p.delta.thinking) yield { kind: 'reasoning', text: p.delta.thinking }
```

**(2) 当前 HEAD 已存在「流式增量 → 左侧」写入路径**（这正是修复点，原缺陷为「此处缺失」）：

```ts
// src/components/video/hooks/useNarrationChat.ts:199
// 流式增量 → 左侧：把已累计的正文（不含 reasoning）实时写入 draftText。
if (chunk) onStreamDraft?.(accumulated);
```

```ts
// src/components/video/hooks/useNarrationDirectScript.ts:72
// 流式增量：把对话产出的正文逐块写入左侧 draftText（ChatGPT 式逐字显示）。
const handleStreamDraft = useCallback((partial: string) => {
  setDraftTextState(partial);
}, []);
// :76 透传给 chat hook：onStreamDraft: handleStreamDraft
```

左侧 `textarea` 双向绑定 `draftText`、流式期间只读但 value 仍实时刷新：

```tsx
// src/components/video/components/NarrationDirectScriptModal/ComposeStep.tsx:51
<textarea id="narration-draft" value={draftText}
  onChange={(e) => setDraftText(e.target.value)}
  readOnly={isStreaming} ... />
```

**结论（3.1）**：当前源码中，**普通模型**（会吐 `content`）下左侧会随流逐块出现文字，Bug 1 已闭环。`git log` 佐证：

```
bb53f3f fix: stream narration rewrite to left draft and export one segment per sentence
d9dfc98 feat: add AI-generate dropdown with narration-direct two-step modal
```

`git status` 显示工作区对 `src/components/video/` 无改动 → 现网源码即修复后状态。

### 3.2 R-A：桌面客户端运行的是 `bb53f3f` 之前打包的过期构建（桌面端最可能真因）

桌面客户端**不实时跑源码**，而是启动**打包时冻结的 Next.js standalone 快照**：

```js
// desktop/scripts/prepare-frontend.js:20
// Build the Next.js standalone bundle and assemble it under build/frontend/
//   const standaloneDir = path.join(REPO_ROOT, '.next', 'standalone')   (:32)
//   fs.cpSync(standaloneDir, destDir, { recursive: true })              (:45)
// desktop/main/frontendService.js:6
// Spawn descriptor for the Next.js standalone server (spec §2.1 / §4.2).
```

即：桌面端跑的是 `build/frontend/.next/standalone/server.js` —— 一份**打包当时的前端快照**。`bb53f3f` 是 **2026-06-14（今天）** 才落地的修复；任何在此之前打出的客户端都内嵌**修复前**的 `useNarrationChat`（无 `onStreamDraft`），因此在桌面端上必然表现为「左侧不流式 / 流末才出现」。这与用户「桌面客户端左侧无输出」的报告**高度吻合**，且不需要源码层再次修改 —— 只需**重新打包**。

### 3.3 R-B：仅产 reasoning、不产 content 的模型 → 左侧永久空白（当前 HEAD 仍存在的真实代码缺陷）

修复后的增量写入与流末权威回写**都只挂在 content 通道上**（这是第 2 轮 8.3「reasoning 绝不进左侧」边界的有意取舍）：

```ts
// src/components/video/hooks/useNarrationChat.ts:182
if (chunk.length === 0 && reasoningChunk.length === 0) continue;
// :183
if (chunk) accumulated += chunk;          // 只有 content 进 accumulated
// :199
if (chunk) onStreamDraft?.(accumulated);  // 只有 content 才写左侧
...
// :216
const rewritten = stripCodeFence(accumulated).trim();  // accumulated 仅含 content
// :218
if (!wasAborted && !errorMessage && rewritten) {
  onRewrite(rewritten);                   // content 为空 → rewritten 为空 → 不写左侧
}
```

**推理链**：若所配置模型把答案全部放进 `reasoning_content`（OpenAI 兼容）/ `thinking`（Anthropic），则 `chunk` 始终为空、`accumulated` 始终为空：
1. 流中：`:199` 因 `if (chunk)` 永不触发 → 左侧零增量；
2. 流末：`rewritten` 为空 → `:218` 条件为假 → `onRewrite` 不调用 → 左侧**永久空白**；
3. 右侧气泡因 `rewritten` 为空，收尾摘要落到 `formatStreaming()`（「正在改写文案…」），reasoning 显示在可折叠区。

结果与「左侧没有输出解说文案」**完全一致**，且此缺陷在**当前 HEAD 全新构建上也能复现**（属修复未覆盖的边缘）。

### 3.4 R-C：LLM 凭证未配置（需排除的次要前置条件）

凭证缺失时 `/api/chat` 抛错，最终把右侧气泡替换为「改写失败：…」并触发顶部红色错误条：

```ts
// src/app/api/chat/route.ts:68
throw new Error('尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置 ...')
// src/components/video/hooks/useNarrationChat.ts:231（收尾摘要写「改写失败：…」）
```

用户描述是「一直等待 / 无反应 / 左侧无输出」而非「报错」，故 R-C 不是主因，但**复现前应先确认凭证已配置**，以免把配置问题误判为流式缺陷。

---

## 四、影响面

| 维度 | 说明 |
|---|---|
| 受影响功能 | 仅「解说脚本」面板 →「AI 生成」→「解说直接生成」两步弹窗的**第 1 步对话改写流式显示**。 |
| 受影响用户 | R-A：所有使用 `bb53f3f` 之前打包客户端的桌面用户（第 1 步几乎不可用、疑似卡死）。R-B：配置了「只产 reasoning」模型的用户（左侧永久空白）。R-C：未配置 LLM 凭证的用户（报错而非空白）。 |
| 不受影响 | 在含 `bb53f3f` 的源码 / 全新构建上、且使用会产 content 的普通模型的用户；「视频理解生成」占位入口；既有脚本生成主路径；`useStoryboardChat` 等其它对话功能。 |
| 数据/导出 | 仅影响第 1 步**显示反馈**；第 2 步逐句拆分与导出（Bug 2）已由 `bb53f3f` 改为「每句一 segment」，不在本症状范围内。 |

---

## 五、候选修复方案对比

| 方案 | 做法 | 针对真因 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **F1（推荐·首选）** | **核对并重建桌面客户端**：确认失败客户端的构建是否早于 `bb53f3f`；若是，从 `≥ bb53f3f` 的提交重新 `prepare-frontend` + 打包发版。源码主路径**无需改动**。 | R-A | 无源码改动（运维层） | 低 | 小 |
| **F2（推荐·叠加）** | **内容空守卫**：在 `useNarrationChat` 流末，当 `accumulated`（content）为空但 `accumulatedReasoning` 非空时，给出**明确的空结果反馈**（右侧摘要 / 顶部提示「模型未返回正文，请更换模型或调整提示」），避免「静默空白」。**严禁把 reasoning 混入左侧 draft**（遵守第 2 轮 8.3 边界）。 | R-B | 低（集中在 hook 收尾分支） | 低 | 小 |
| F3 | 复现前先在「设置 → 模型设置」配置好可用凭证，把 R-C 从干扰项中排除。 | R-C | 无源码改动 | 低 | 极小 |
| F4（否决） | 把 reasoning 当正文写进左侧 draft（让左侧「至少有字」）。 | R-B | 低 | **高**：违反 8.3「reasoning 绝不进左侧」、会把思考过程当解说导出、污染后续逐句 TTS / 拆分。 | 小 |

> 说明：F1 与 F2 不互斥 —— F1 解决「桌面端为何还旧」，F2 堵住「全新构建上仍可能空白」的边缘。F4 仅作记录，明确否决。

---

## 六、推荐方案与理由

1. **首选 F1（核对/重建构建）**：当前 HEAD 源码已含 `bb53f3f` 的流式修复且单测全绿，桌面端跑的是打包冻结快照（`prepare-frontend.js`）。对「桌面客户端左侧无输出」最可能、最直接的解法是**确认并重建客户端**，无需再动源码主路径，风险最低。

2. **叠加 F2（内容空守卫）**：这是当前 HEAD **仍真实存在**的代码缺陷（R-B）的最小修复 —— 当模型只产 reasoning 时，给出明确的空结果反馈而非静默空白；务必**不把 reasoning 写入左侧**（守住 8.3 边界），避免污染解说与下游逐句操作。若第 2 步骤要求「必须有可落地的代码改动」，F2 即为推荐的代码改动点。

3. **F3 作为复现前置**：确保 LLM 凭证已配置，排除 R-C 干扰。

> 交接子任务 #1（评审）/ #2（实现）：
> - 评审请优先核实「失败客户端的构建提交是否 < `bb53f3f`」（决定 F1 是否即为全部）；
> - 若实现侧需要代码改动，按 F2 在 `useNarrationChat` 收尾分支加「content 空 + reasoning 非空」的明确反馈，**不得**把 reasoning 注入 `draftText`；
> - 改完按「二、复现步骤」（含 R-B 路径）手动回归一次，勿引入未规划文件或依赖、勿回滚 `bb53f3f` 既有修复。

---

## 七、关键证据索引（file:line，均对当前 HEAD）

- `git log -- src/components/video/hooks/useNarrationChat.ts` → 最新即 `bb53f3f`（修复提交）；`git status` 对 `src/components/video/` 无改动。
- `src/components/video/hooks/useNarrationChat.ts:199` — **已存在**的「content 增量 → 左侧」写入（`onStreamDraft`，即修复点）。
- `src/components/video/hooks/useNarrationChat.ts:182` / `:183` / `:216` / `:218` — 增量与流末回写**仅挂 content 通道**（R-B 缺陷证据）。
- `src/components/video/hooks/useNarrationDirectScript.ts:72` — `handleStreamDraft → setDraftTextState`（左侧增量写入实现）。
- `src/components/video/components/NarrationDirectScriptModal/ComposeStep.tsx:51` — 左侧 `textarea` 绑定 `draftText`、流式只读但 value 实时刷新。
- `src/app/api/chat/route.ts:148` — 后端逐块下发 `data:{content|reasoning}`（管道正常）。
- `src/lib/llm/streamLlmChat.ts:141` / `:220` — 正文走 `content` 事件、思考走 `reasoning`（OpenAI / Anthropic）。
- `desktop/scripts/prepare-frontend.js:20`、`:32`、`:45` + `desktop/main/frontendService.js:6` — 桌面端跑打包冻结的 standalone 快照（R-A 证据）。
- `src/app/api/chat/route.ts:68` + `useNarrationChat.ts:231` — 凭证缺失走报错分支（R-C，非主因）。
- 单测：`src/components/video/hooks/__tests__/useNarrationDirectScript.test.ts:57` —「流式回写左侧」用例，`vitest run` 10/10 通过（修复已生效的自动化证据）。
- 历史对照：`docs/diagnoses/narration-direct-stream-and-split-export/analysis.md`（第 2 轮 Bug 1/Bug 2 完整定位，已由 `bb53f3f` 修复）。

---

## 八、评审补充证据（子任务 #1 评审员补全 · 均对当前 HEAD 复核）

> 评审员逐条复核了第七节的全部 file:line 引用，**结论：引用均准确、被引代码确在失败/成功路径上执行**。
> 复核动作：`git log --oneline -- src/components/video/hooks/useNarrationChat.ts`（最新即 `bb53f3f`，且其 diff 确含 `+ if (chunk) onStreamDraft?.(accumulated);`）；
> `git status --porcelain src/components/video/` 返回空（工作区无改动）。下面补三条原报告**遗漏或低估**的证据，使证据链闭合。

### E1（关键）——「单测 10/10」并不能证明「增量流式」，只证明了「流末终态」

原报告第二节/第七节把 `useNarrationDirectScript.test.ts:57` 用例当作「流式 → 左侧」已通的自动化证据，**这是对证据的高估**。该用例只在 `await sendChatMessage(...)` **完成之后**断言一次 `draftText` 等于完整文案：

```ts
// src/components/video/hooks/__tests__/useNarrationDirectScript.test.ts:66
await act(async () => { await result.current.sendChatMessage('更口语化一些'); });
// :69
expect(result.current.draftText).toBe('这是改写后的完整解说文案。');
```

而流末的一次性回写 `onRewrite(rewritten)` 本身就会把 `draftText` 设为同一份完整文案：

```ts
// src/components/video/hooks/useNarrationChat.ts:216
const rewritten = stripCodeFence(accumulated).trim();
// :218
if (!wasAborted && !errorMessage && rewritten) { onRewrite(rewritten); }
```

**推论**：即使把增量回调 `:199 if (chunk) onStreamDraft?.(accumulated);` 整行删掉（即退回到「只在流末一次性回写」的原 Bug 1 行为），该用例**仍会通过**——因为它从不在流中途取样 `draftText`。
**意义**：① 「源码确实增量流式」这一点目前只有**代码静态可证**（`:199 → handleStreamDraft → setDraftTextState`），**没有任何自动化回归护栏**；② 该测试名 `streams a rewrite` 名不副实。
**对结论的影响**：不动摇 R-A / R-B 的根因判断（增量路径代码确实存在），但削弱「自动化已证明流式」这一论据，并要求修复节点补一条**真正断言中途增量**的回归测试（见 F2 修订）。

### E2——R-B 连带一处被低估的「误导性流末摘要」缺陷

原报告 3.3 仅说 reasoning-only 模型下「收尾摘要落到 `formatStreaming()`」，但**未点明这本身是第二处缺陷**：流**已经结束**，右侧气泡却显示「正在改写文案…（Rewriting…）」，让用户误以为仍在进行、从而继续干等——与用户「发送后一直等待、左侧没反应」的体感**叠加吻合**。

```ts
// src/components/video/hooks/useNarrationChat.ts:232
} else if (rewritten) {
  summary = formatUpdated();        // 有正文 → 「已更新左侧文案」
} else {
  summary = formatStreaming();      // :235 无正文 → 错误地显示「正在改写文案…」(= formatStreaming, 见 :68)
}
```

即：`accumulated` 为空（仅 reasoning）时，流末 `else` 分支把**进行中文案**当作**终态摘要**，是 R-B 的次生症状。F2 必须一并修掉此处。

### E3——「发送→改写」链路完好，可排除「按钮未接线」这一替代解释

为排除「点发送什么也没发生 → 左侧自然空白」的替代假说，评审员复核了从发送按钮到 hook 的接线，**完好无断点**：

```
NarrationDirectScriptModal.tsx:127  onSend={sendChatMessage}
  → ComposeStep.tsx:66              onSend={onSend}
  → NarrationChatPanel.tsx:43       onSend(value)   // 回车/点击发送即触发
```

`sendChatMessage` 即 `chat.sendMessage`（`useNarrationDirectScript.ts:186`）。故「发送无反应」不是 UI 接线问题，根因仍收敛在 R-A（过期构建）/ R-B（仅 reasoning），与原报告一致。

---

## 九、评审结论（Review Verdict）

### 9.1 根因评审

| 假说 | 评审裁定 | 依据 |
|---|---|---|
| **R-A** 桌面端跑 `bb53f3f` 之前的冻结 standalone 快照 | **成立，且为用户实际桌面症状的最高概率真因** | `prepare-frontend.js:24-45`（桌面跑打包冻结快照）+ `bb53f3f` 为今日（2026-06-14）才落地的流式修复；任何早于它的客户端都内嵌无 `onStreamDraft` 的旧 hook。 |
| **R-B** 仅产 reasoning、不产 content 的模型 → 左侧永久空白 | **成立，当前 HEAD 全新构建上仍可复现的真实代码缺陷** | `useNarrationChat.ts:183/199`（增量仅挂 content）+ `:216/:218`（流末回写仅含 content），叠加 E2 的 `:235` 误导摘要。 |
| **R-C** 未配置 LLM 凭证 | **成立但非主因**（报错而非空白，与用户描述不符） | `route.ts:68` 抛错 → `useNarrationChat.ts:231` 显示「改写失败：…」。复现前置排除项。 |
| 替代假说：发送按钮未接线 / 主路径源码未修 | **已排除** | E3 链路完好；`git log` 证明 HEAD 已含 `bb53f3f`，`git status` 工作区干净。 |

证据链评审：第七节引用经逐条复核**全部准确**；唯一需修正的是「单测已证明流式」的措辞（见 E1，应改述为「单测证明的是流末终态回写，增量流式仅代码静态可证、暂无自动化护栏」）。在此修正下，证据链闭合。

### 9.2 修复方案评审

- **F1（重建/重打包桌面端，源头 ≥ `bb53f3f`）**：针对 R-A **正确且必要**。它是用户**实际桌面症状的唯一解**——HEAD 源码已流式，桌面端只是跑旧快照，任何源码改动都救不了一份旧打包。但它是**发布/运维动作，不产生可提交的代码 diff**。
- **F2（内容空守卫）**：针对 R-B 的**最小代码改动，方向正确**，但原描述边界不全，需收紧（见 9.3）。回归风险**低**——改动集中在 `sendMessage` 的**流末 finalize 分支**，不触碰 `:183/:199` 的 content 增量流式主路径，不会回退 `bb53f3f`。
- **F4（把 reasoning 写进左侧 draft）**：**维持否决**。reasoning 不是解说正文，注入 `draftText` 会被后续逐句拆分 → TTS → 导出当作文案处理，污染下游（`useNarrationDirectScript.ts:154-170` 的 `complete()` 直接把 draft 拆句成 segment）。否决理由充分。

### 9.3 最终推荐修复（单一方案）

**推荐落地并提交的单一代码修复 = F2（内容空守卫 + 收紧流末四态 + 补增量流式回归测试），改动范围仅限 `src/components/video/hooks/useNarrationChat.ts` 的流末 finalize 分支，并新增/扩充对应单测。**

实现约束（交付子任务 #2，须逐条满足）：

1. **流末四态分明**（替换当前 `:227-236` 的三分支），且**任何分支都不得改写 `draftText`/不得把 reasoning 注入 draft**（守住第 2 轮 8.3 边界）：
   - `wasAborted` → 「[已取消]」（不变）；
   - `errorMessage` → 「改写失败：…」（不变）；
   - 有正文 `rewritten` → 「已更新左侧文案」（不变）；
   - **新增**：`!rewritten && accumulatedReasoning.trim()`（仅 reasoning、无正文）→ 明确反馈，如「模型仅返回思考内容、未生成解说正文，请更换模型或重试 / The model returned only reasoning, no narration body — switch models or retry.」——**修掉 E2 的 `:235` 误导摘要**；
   - **新增**：`!rewritten && !accumulatedReasoning.trim()`（全空）→ 「模型未返回任何内容，请重试」。
2. **补一条真正断言增量流式的回归测试**（针对 E1）：用可分步推进 / 暂停的 SSE，在**第二个 content chunk 到达前**取样一次 `draftText`，断言其等于「截至当前累计的正文」（而非完整文案），以锁死「删掉 `:199` 即应失败」的护栏；并补一条「仅 reasoning chunk → `draftText` 全程为空且流末摘要为新空守卫文案」的用例。
3. 改完按第二节「复现步骤」（含 R-B 路径）手动回归一次；**不得**引入未规划文件 / 依赖，**不得**回滚 `bb53f3f`。

**强制并行的发布动作（非代码节点职责，但必须随本次修复一起追踪）= F1**：从 `≥ bb53f3f` 的提交重新 `prepare-frontend` 并重打包桌面客户端。**理由**：用户报告的是桌面端症状，其最高概率真因 R-A 只能由 F1 消除；若只提交 F2 而不重打包，对「跑旧快照」的用户而言现象**依旧存在**。F2 负责堵住「全新构建上 reasoning-only 模型仍空白」的边缘，F1 负责让用户真正用上已修复的流式主路径——二者不互斥、缺一不可。

**一句话裁定**：源码主路径（content 模型流式）已由 `bb53f3f` 修好且无需再动；本轮**代码侧唯一应落地并提交的修复是 F2 内容空守卫（含四态收尾与增量流式回归测试）**，并**必须搭配 F1 重打包桌面端**才能消除用户实际看到的「左侧无输出」。
