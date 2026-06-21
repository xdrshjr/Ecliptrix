# 解说直接生成 —— 顺序化「解说文案 → AI 视频脚本 → 英文搜索关键词」方案设计（spec v2）

> 子任务 #0「方案设计」产出，子任务 #1「设计评审」已审阅并就地修复 P0/P1（见 `## 评审记录`、`## 评审结论`）。本节点只产出设计文档，**不写实现代码、不改 `docs/plans/<feature>/` 以外的任何源码、不执行 `git commit`**。
> Feature slug：`narration-direct-ai-video-script-keywords`
> 关联前序诊断：`docs/diagnoses/narration-direct-script-duplicate-and-missing-keywords/analysis.md`（本方案沿用其证据，但在「关键词取材 / 语言 / 执行顺序」三点上**有意覆盖**其 R-4 决议，理由见 §3.3 与 §8）。

---

## 评审记录（Review Notes）

> 评审人：Anthropic 工程团队高级评审（子任务 #1）。评审维度：可行性 / 完整性 / 一致性 / 规模适配。
> 方法：对 spec 引用的 10 处 `file:line` 逐一回读源码核验（全部属实），并核对测试设施（项目用 vitest，已存在 API 路由单测 `src/app/api/video-proxy/__tests__/route.test.ts`，新增测试可行）。
> 结论速览：无 P0；P1×3 已**就地修复**；P2×4 记录为实现期注意项 / 验收条件，详见 `## 评审结论`。

| 编号 | 维度 | 严重度 | 问题 | 处置 |
|---|---|---|---|---|
| R-1 | 完整性 / 可行性 | **P1** | AI 视频脚本由 `/api/prompt-polish` 的 `ai-video` 分支生成，其 system prompt 全中文、产出**中文**画面描述（`route.ts:79-109`）。但关键词要求**英文**。原 §5.1 英文 prompt 未声明「输入可能是中文、必须输出英文」，朴素 LLM 可能回吐中文或行为不稳。 | 已修：§5.1 英文 prompt 明确「无论源文为中/英，一律输出英文关键词」，并补英文 few-shot 示例（与既有中文 few-shot 对称）。 |
| R-2 | 一致性（文档内自相矛盾） | **P1** | 关键词数量在文中**前后冲突**：§1「固定 3 个」、§2 表「固定取 3 个」、旧 §5.1「exactly 3」、§8.1 断言 `keywords.length===3`；但同处 §5.1 又用 `.slice(0,3)`（≤3）、§6 写「≤3 个」。LLM 无法保证恰好回 3 行，`===3` 断言与「固定 3」是无法兑现的契约。 | 已修：统一为「**目标 3 个、上限 3 个（best-effort ≤3）**」；§8.1 断言改为 `1 ≤ length ≤ 3`；§1/§2/§5.1/§6/§8.3 措辞对齐。 |
| R-3 | 完整性 / 健壮性 | **P1** | 关键词端点现有解析 `!line.match(/^\d+\./)` 是**整行丢弃**编号行，而非剥离编号前缀。英文 LLM 极易输出「1. Mountain landscape」式编号，导致解析后**0 关键词**、功能静默失效。 | 已修：§5.1 解析规范改为「**剥离**行首 `\d+[.)、]`/`- `/`* `/包裹引号后再保留该行」，英文分支沿用该健壮解析；并在 §4 路由行注明。 |
| R-4 | 规模适配 / 完整性 | P2 | §5.1 把非法 `language` 的处理留为「回退中文 或 400，二选一」开放项；待实现 spec 不宜留二元开放。 | 已就地收敛为「**非法即回退中文**」（不阻断富化），与全链路非阻塞哲学一致。 |
| R-5 | 完整性（时序边界） | P2 | 富化为 append 后异步触发，搜索按钮受 `completedSegments`（TTS 完成）门控（`ScriptPanel.tsx:1022`）。若富化慢于 TTS，用户开搜索时关键词可能尚未落盘 → 预填为空。 | 接受（**非回归**：旧链路关键词同为异步）。已在 §7 / §9-R9 记录为可接受降级；如需强一致可在后续迭代加「生成中」门控。 |
| R-6 | 可行性（引用精度，外观） | P2 | 个别行号轻微漂移：§3.3 引用 `useScriptGeneration.ts:190`（实际旧链路调用在 `:193`）、`route.ts` 的 `POST` 实际自 `:77` 起。均为「附近」级别，不影响判断。 | 记录，实现时以符号定位为准（不阻塞）。 |
| R-7 | 一致性（文档契约） | P2 | `generateKeywordsForSegments` 顶部 doc 注释当前写死「取材须为解说原文、覆写前调用（评审 R-4）」，与本次反转冲突。 | §4 已要求更新该注释；本评审追加强调：注释须显式标注「取材现可为 AI 视频脚本、语言可选，反转前序诊断 R-4」。 |

---

## 1. Overview（概述）

视频编辑器「文案/脚本」面板顶部「AI 生成 → 解说直接生成」是一条两步式弹窗链路：用户先与 AI 对话写出**解说文案**（旁白，给 TTS 念），再逐句拆分精修，点「完成」后把逐句解说写入面板下方的解说脚本列表。当前这条链路在写入后会异步「富化」（`enrichNarrationSegments`）每个条目：为每句生成独立的**画面/视频脚本描述**写入 `sentence.text`（面板「AI视频脚本」字段），并为每段补跑**搜索关键词**写入 `segment.keywords`（供「搜索在线视频」弹窗预填）。功能已可用，但**执行顺序、关键词取材与关键词语言**与本次需求不一致。

本次需求把这条富化链路重新定义为一个**严格顺序的三段流水线**：(1) 先完成解说文案生成（既有 compose 步骤）；(2) 解说完成后**再**针对每一句解说、以**整篇解说文案为上下文**调用模型生成该句对应的 **AI 视频脚本**（画面描述）；(3) **再**把生成出的 AI 视频脚本作为输入交给模型，提取**英文搜索关键词（目标 3 个、上限 3 个，best-effort ≤3）**，写回该段；随后用户打开「搜索在线视频」弹窗时这些英文关键词自动预填到搜索框。三段全部复用同一套 LLM 能力（`LLM_API_URL` / `LLM_API_KEY`）。

与现状相比，本方案的核心变化是**两点反转 + 一点本地化**：① 把「先关键词、后画面脚本」反转为「**先画面脚本、后关键词**」；② 关键词的取材从「解说原文」改为「**生成出的 AI 视频脚本**」；③ 关键词语言从中文改为**英文（目标 3 个，≤3）**（更契合 Pexels 等在线视频库的检索习惯）。注意 AI 视频脚本由 `/api/prompt-polish` 的 `ai-video` 分支生成、产出**中文**画面描述，故关键词端点的英文分支须**显式做跨语言输出**（中文输入 → 英文关键词，见 §5.1，评审 R-1）。由于解说脚本面板的渲染源、TTS 取文逻辑、搜索弹窗的预填机制都已就绪且无需改动，改动可收敛在 **1 个 API 路由 + 1 个共享工具函数 + 1 段父级富化逻辑**，外加配套测试，属低侵入、可回归验证的修改。

---

## 2. 现状与目标差异（Current vs Target Delta）

| 维度 | 现状（已实现） | 本次目标 |
|---|---|---|
| 执行顺序 | 富化内**先**生成关键词（`enrichNarrationSegments` step 1）→ **后**生成画面脚本（step 2） | **先**生成 AI 视频脚本 → **后**从该脚本生成关键词 |
| 关键词取材 | 解说原文（`narrationText` 对应的 `sentence.text`，覆写前计算，评审 R-4） | **AI 视频脚本**（覆写后的 `sentence.text` / 画面描述） |
| 关键词语言/数量 | 中文，2–3 个（`/api/script-keywords-generation` 中文 prompt） | **英文，目标 3 个（上限 3，best-effort ≤3；评审 R-2）** |
| AI 视频脚本生成 | `generateSentenceAiVideoPrompt(narration, fullScript)`，已满足"整篇解说作上下文、针对当前句生成画面描述" | 不变，保留 |
| 搜索预填 | `segment.keywords → openSearchModal(keywords)` 自动填入 | 不变，保留（填入英文关键词） |
| 面板渲染源 | 「解说文案」=`narrationText`；「AI视频脚本」=`sentence.text` | 不变，保留 |
| TTS 取文 | 优先 `narrationText`，永不读 `sentence.text`（`tts.ts:201`） | 不变，保留（覆写 `sentence.text` 对 TTS 安全） |

> 结论：本次是对**已存在富化链路的"重排 + 改取材 + 英文化"**，而非从零新建。设计文档据此聚焦三处改动点，其余既有路径维持不动。

---

## 3. Technical Design（技术设计）

### 3.1 架构与既有关键路径（read-only 参照，file:line）

- 弹窗编排：`src/components/video/hooks/useNarrationDirectScript.ts:154-172`（`complete()` 每句生成一个 `ScriptSegment`，每段 1 句，`narrationText`/`sentence.text`/`sentence.narration` 此刻三者皆为解说原文）→ `onComplete(segments)`。
- 父级写入与富化触发：`src/components/video/VideoEditingInterface.tsx:1117-1126`（`handleAppendNarrationSegments`：先即时按解说原文写入卡片，再 `void enrichNarrationSegments(segments)`）。
- 富化主体：`src/components/video/VideoEditingInterface.tsx:1037-1111`（`enrichNarrationSegments`，本次主要改动点）。
- 画面脚本工具：`src/lib/api/sentenceAiVideoPrompt.ts:6-50`（`buildFullScriptContext` + `generateSentenceAiVideoPrompt`，后者走 `/api/prompt-polish` 的 `targetType:'ai-video'`）。
- 画面脚本 prompt：`src/app/api/prompt-polish/route.ts:79-109`（`ai-video` 系统提示，把一句话扩写为画面/镜头/视觉风格描述）。
- 关键词工具：`src/components/video/hooks/useScriptGeneration.ts:12-90`（`generateKeywordsForSegments`，POST `/api/script-keywords-generation`，取材 `segment.sentences.map(s=>s.text).join(' ')`）。
- 关键词端点：`src/app/api/script-keywords-generation/route.ts:17-200`（当前中文 prompt，`.slice(0,3)` 取前 3）。
- 写入单一出口：`src/components/video/hooks/useScriptGeneration.ts:260-283`（`handleUpdateSegments`，整段替换 `scriptSegments`）。
- 搜索预填：`src/components/video/ScriptPanel.tsx:1020-1042`（`handleOpenVideoSearch` 读 `segment.keywords`）→ `src/components/video/hooks/useVideoSearch.ts:222-242`（`openSearchModal` 把 `keywords.join(' ')` 写入 `searchQuery`）。

### 3.2 目标流水线（sequence of operations）

`enrichNarrationSegments(newSegments)` 重排为如下严格顺序（父级、异步、非阻塞）：

```
[0] 立即写入：handleAppendNarrationSegments 已先把解说原文写入卡片（兜底，面板永不空白）
        │
[1] 构建整篇解说上下文：
        fullScript = buildFullScriptContext([...scriptSegmentsRef.current, ...newSegments])
        // 该函数优先取每段 narrationText → 即"整篇所有解说文案"，满足"整篇解说作上下文"
        │
[2] 逐句生成 AI 视频脚本（并发，limit=2）：
        for each sentence:
          res = generateSentenceAiVideoPrompt(sentence.narration, fullScript)  // 针对当前句、全篇作上下文
          visualBySentence[sentence.id] = res.prompt (成功且非空时)
        │
[3] 用"生成出的 AI 视频脚本"组装关键词输入：
        scriptedSegments = newSegments.map(seg => ({
          ...seg,
          sentences: seg.sentences.map(s => ({ ...s, text: visualBySentence[s.id] ?? s.text }))
        }))
        // s.text 现在等于画面脚本（缺失则回退解说原文）
        │
[4] 从 AI 视频脚本生成英文关键词（每段 3 个）：
        keyworded = generateKeywordsForSegments(scriptedSegments, taskId, logger, { language: 'english' })
        keywordsBySegment[seg.id] = keyworded.keywords   // segmentContent = 画面脚本拼接 → 关键词取材=AI视频脚本
        │
[5] 记录每句解说原文 narrationBySentence（编辑守卫用）
        │
[6] 按 id 合并 scriptSegmentsRef.current（用户可能在富化期间编辑/删除），单次 handleUpdateSegments：
        - 仅当 sentence.text 仍等于解说原文（未被用户手改）时，覆写为画面脚本，
          并预置 aiVideoPrompt=画面脚本 / aiVideoPromptStatus='succeeded'（抑制 TTS 后重复润色，评审 R-3）
        - segment.keywords = keywordsBySegment[seg.id] ?? seg.keywords
        - 若 newSegments 对应 id 全被删除则直接 return（不写）
```

与现状的差异仅在 **[2]→[3]→[4] 的顺序**与 **[4] 的取材/语言参数**；[1]、[5]、[6] 的并发/编辑守卫/单次写回结构沿用现有实现，不引入新竞态模型。

### 3.3 关键词取材与语言：有意覆盖诊断 R-4

诊断 §R-4 当初要求「关键词必须取自解说原文、且在覆写 `sentence.text` 之前计算」，以保持「早期有关键词」时的取材语义。**本次需求明确要求关键词取自 AI 视频脚本、且为英文**，因此本方案**有意反转该决议**：

- **理由**：在线视频库（Pexels 等）以视觉/画面英文词检索命中率最高；AI 视频脚本本就是「画面/镜头/视觉风格」的具体化描述，比旁白原文更贴合素材检索语义。需求文「传入它对应的 AI 视频脚本，把关键词提取出来，要 3 个英文的」即此意。
- **取材实现**：因关键词在 [4] 计算、输入为 [3] 组装出的 `scriptedSegments`（`sentence.text` 已是画面脚本），`generateKeywordsForSegments` 现有的 `segmentContent = sentences.map(s=>s.text).join(' ')` 自然等于「AI 视频脚本」，无需改取材代码，只需改调用顺序与语言参数。
- **回归边界**：旧脚本生成链路（`handleGenerateScriptWithConfig` 调 `generateKeywordsForSegments`，`useScriptGeneration.ts:190` 附近）**不传 `language`**，端点默认中文，旧链路行为零变化。

---

## 4. File / Module Change Plan（文件 / 模块变更计划）

| 文件 | 变更类型 | 一句话意图 |
|---|---|---|
| `src/app/api/script-keywords-generation/route.ts` | 修改 | 请求体新增可选 `language?: 'chinese' \| 'english'`（默认 `chinese`；非法值回退 `chinese`，评审 R-4）；新增英文 prompt 与英文 system message，prompt 须**显式声明「源文可能是中文、一律输出英文关键词」**（评审 R-1）；英文分支目标 3 个、上限 3（`.slice(0,3)`，best-effort ≤3，评审 R-2）；解析改为**剥离行首编号/项目符号/引号**再保留该行（替换原 `!line.match(/^\d+\./)` 整行丢弃逻辑，评审 R-3）；旧默认（中文）路径行为不变。 |
| `src/components/video/hooks/useScriptGeneration.ts` | 修改 | `generateKeywordsForSegments` 增加可选第 4 参 `options?: { language?: 'chinese' \| 'english' }`，把 `language` 透传进 POST body；更新顶部 doc 注释——须**显式标注**「取材现可为 AI 视频脚本、语言可选，**反转前序诊断 R-4** 的『取材须为解说原文』约束」（评审 R-7）。签名向后兼容，旧调用点不动。 |
| `src/components/video/VideoEditingInterface.tsx` | 修改 | 重排 `enrichNarrationSegments`：先逐句生成 AI 视频脚本（[2]）→ 用画面脚本组装 `scriptedSegments`（[3]）→ 从画面脚本生成英文关键词 `language:'english'`（[4]）→ 合并写回（[6]）；保留 fullScript 上下文、并发、编辑守卫、aiVideoPrompt 预置、单次写回。 |
| `src/app/api/script-keywords-generation/__tests__/route.english.test.ts` | 新增 | 单测：`language:'english'` 时调用方 prompt 含英文要求、解析出 ≤3 个关键词；`language` 缺省时仍走中文 prompt（防回归）。 |
| `src/components/video/hooks/__tests__/generateKeywordsForSegments.test.ts` | 新增 | 单测：`options.language='english'` 透传进 `http.post` body；失败/无效响应降级返回原 segment（保留既有语义）。 |
| `src/lib/i18n.ts` | 可选修改 | 若决定在富化进行中给出可视进度提示（见 §7 可选项），新增 `narrationDirectScript.enriching*` 文案；否则不动。 |

> 不改：`ScriptPanel.tsx`（渲染源/搜索按钮已正确）、`useVideoSearch.ts`（预填已正确）、`sentenceAiVideoPrompt.ts`（画面脚本工具已满足）、`tts.ts`（取 `narrationText`，覆写安全）、`prompt-polish/route.ts`（`ai-video` prompt 已满足）、`types/index.ts`（字段齐全，无新增）。

---

## 5. Interface Design（接口设计）

### 5.1 `POST /api/script-keywords-generation`（修改：新增 `language`）

请求体：

```jsonc
{
  "segmentTitle": "string，必填非空",
  "segmentContent": "string，必填非空（解说直接生成链路此处传入 AI 视频脚本拼接；该脚本通常为中文）",
  "taskId": "string，必填",
  "language": "chinese | english（可选，默认 chinese；非法值回退 chinese）"   // 新增
}
```

响应体（不变）：

```jsonc
{ "success": true, "keywords": ["...", "...", "..."], "segmentTitle": "...", "taskId": "..." }
```

行为：

- `language === 'english'`：system message 与 user prompt 全英文。prompt 须满足以下硬约束（评审 R-1 / R-2 / R-3）：
  - **跨语言**：明确声明「The source script may be written in Chinese; you MUST output keywords in ENGLISH regardless of the source language.」——因 AI 视频脚本由 `ai-video` 分支产出且为中文。
  - **数量**：「produce up to 3（目标 3）concise ENGLISH keywords / short noun phrases suitable for stock-video search」。约定为 **best-effort ≤3**，不承诺恰好 3（LLM 不可强制保证行数）。
  - **格式**：「one per line；no numbering, no bullets, no quotes」。
  - **英文 few-shot**：给一组英文示例（如 `mountain landscape` / `city skyline at night` / `team meeting`），与既有中文 few-shot 对称，稳定输出格式。
- **解析（中/英分支统一健壮化，评审 R-3）**：按行拆分后，对每行**剥离**行首编号/项目符号/包裹引号（正则示例 `^\s*(?:\d+[.)、]|[-*•])\s*` 去前缀、再去首尾引号）→ trim → 过滤空行 → `.slice(0, 3)`。**不再整行丢弃编号行**（原 `!line.match(/^\d+\./)` 会把「1. Mountain landscape」误删致 0 关键词）。解析后若 `keywords.length === 0` 仍按现状返回 500（上层降级保留原 segment、留空关键词）。
- 其余分支（含缺省 / 非法值回退）：维持现有中文 prompt 与 2–3 个关键词语义（解析健壮化对中文分支同样生效，纯增强、不改语义）。
- 校验：`language` 若提供且不在 `chinese|english` 枚举内 → **回退缺省 `chinese`**（不返回 400，避免阻断富化，评审 R-4）。失败语义与现状一致（非 2xx 时上层降级保留原 segment）。

### 5.2 `generateKeywordsForSegments`（修改：新增 options）

```ts
export const generateKeywordsForSegments = async (
  segments: ScriptSegment[],
  taskId: string,
  logger: VideoEditingLogger,
  options?: { language?: 'chinese' | 'english' },   // 新增，缺省=中文
): Promise<ScriptSegment[]>
```

- 内部 `http.post('/api/script-keywords-generation', { segmentTitle, segmentContent, taskId, language: options?.language })`。
- 其余逻辑（并发 `Promise.all`、失败返回原 segment、成功挂 `keywords`）不变。

### 5.3 `generateSentenceAiVideoPrompt`（复用，不改）

`generateSentenceAiVideoPrompt(sentenceText, fullScript)` → `polishPrompt({ prompt, videoAnalysisContext: fullScript, targetType: 'ai-video' })` → `POST /api/prompt-polish`。解说直接生成链路传 `sentenceText = sentence.narration`、`fullScript = buildFullScriptContext(全部段落)`。

---

## 6. Data Model（数据模型）

无数据库 schema 变更、无持久化结构变更（全部为客户端内存态 + 无状态 LLM 端点）。涉及的内存形态与字段语义（`src/types/index.ts:161-189`）：

```ts
interface ScriptSentence {
  id: string;
  text: string;          // 「AI视频脚本」展示源 —— 富化后= 画面/视觉描述
  narration?: string;    // 该句解说原文（旁白），富化全程不变
  aiVideoPrompt?: string;            // 富化时预置= 画面脚本（抑制 TTS 后重复润色）
  aiVideoPromptStatus?: 'idle'|'generating'|'succeeded'|'failed';  // 富化时预置 'succeeded'
  // ...其余句级 AI 视频字段不动
}
interface ScriptSegment {
  id: string;
  title: string;
  sentences: ScriptSentence[];   // 解说直接生成：每段恰 1 句
  narrationText?: string;        // 「解说文案」展示源 + TTS 取文源，富化全程不变
  keywords?: string[];           // 「搜索在线视频」预填源 —— 富化后= 3 个英文关键词
}
```

字段流转不变量：

- `narrationText` 与 `sentence.narration` 在整个富化期间**只读不写**（保护 TTS 与「解说文案」展示）。
- `sentence.text` 仅在「仍等于解说原文（未被用户手改）」时被覆写为画面脚本（编辑守卫）。
- `keywords` 来自「画面脚本」生成、英文（目标 3、上限 3，best-effort ≤3，评审 R-2）；失败时留空（与旧降级一致）。

---

## 7. 实现要点与可选项（Implementation Notes）

1. **顺序硬约束**：[4] 关键词依赖 [2]/[3] 的画面脚本结果，必须串行于其后；[2] 内逐句、[4] 内逐段仍各自并发，避免整体串行放大时延。
2. **失败降级矩阵**：
   - 画面脚本单句失败 → 该句 `sentence.text` 保留解说原文；关键词输入随之回退该句解说原文（仍能产出关键词）。
   - 关键词整体失败/无效 → `segment.keywords` 留空 → 搜索框无预填（与旧行为一致，不报错、不阻断）。
3. **并发与卸载守护**：沿用 `runWithConcurrency(jobs, 2, ...)` 与 `scriptSegmentsRef.current` 合并；富化置于父级（弹窗 `close()` 不影响），单次 `handleUpdateSegments` 批量写回（决议 R3）。
4. **可选可视进度**：当前富化静默后台。可选增强：在卡片上对 `aiVideoPromptStatus==='generating'`/关键词进行中显示轻量「生成中…」标记（需新增 i18n 文案 `narrationDirectScript.enrichingScript`/`enrichingKeywords`）。非必需，不阻塞主改动；若做需保证与既有句级 AI 视频状态徽标不冲突。
5. **同一 AI 能力**：三段（解说改写 `/api/chat`、画面脚本 `/api/prompt-polish`、关键词 `/api/script-keywords-generation`）均读取同一组 `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL`，满足「都使用同样的 AI 模型和 AI 能力」。

---

## 8. Testing & Acceptance Criteria（测试与验收标准）

### 8.1 单元测试

- `route.english.test.ts`：
  - `language:'english'` → mock LLM 返回三行英文 → 响应 `1 ≤ keywords.length ≤ 3` 且为英文（**不断言 `===3`**，因 best-effort，评审 R-2）；断言下发给 LLM 的 messages 含英文要求与「跨语言/输出英文」声明（断言 system/user 文本，评审 R-1）。
  - **编号鲁棒性（评审 R-3）**：mock LLM 返回带编号/项目符号的英文（如「1. mountain landscape」「- city skyline」）→ 断言解析后剥离前缀、`keywords.length ≥ 1`（验证不再整行丢弃）。
  - 不传 `language`（及非法 `language` 回退中文，评审 R-4）→ 走中文 prompt（断言 messages 含中文要求），保证旧链路零回归。
  - LLM 非 2xx → 透传错误状态（与现状一致）。
- `generateKeywordsForSegments.test.ts`：
  - `options.language='english'` → 断言 `http.post` 收到的 body 含 `language:'english'`。
  - 缺省 options → body 不含 `language`（或为 `undefined`），端点默认中文。
  - `http.post` 抛错 / `success:false` → 返回原 segment（`keywords` 不变），不抛出。

### 8.2 集成 / 顺序断言（建议）

- 对 `enrichNarrationSegments` 的顺序，以「关键词请求体的 `segmentContent` 等于画面脚本（而非解说原文）」作为可观测断言：mock `generateSentenceAiVideoPrompt` 返回固定画面文本 X，mock 关键词端点，断言其收到的 `segmentContent` 含 X、不含解说原文；并断言最终 `handleUpdateSegments` 的 segment `sentence.text===X`、`keywords` 为英文 3 个。

### 8.3 手动验收（桌面走查，强制门禁）

1. 「AI 生成 → 解说直接生成」，写一段解说 → 下一步逐句拆分 → 完成。
2. 卡片「解说文案」= 旁白原文；展开「AI视频脚本 (N)」= 画面/镜头描述，**与解说文案明显不同**。
3. 对某条目完成 TTS 后点「搜索在线视频」：搜索框**自动预填英文关键词（目标 3 个，≤3）**，且关键词语义贴合该条目的画面脚本。若富化恰好慢于 TTS（评审 R-5），预填可能短暂为空，稍后重开即填入——属可接受降级、非报错。
4. 网络面板可见调用次序：先 `/api/prompt-polish`（画面脚本）后 `/api/script-keywords-generation`（关键词，body 含画面脚本 + `language:'english'`）。
5. 旧「脚本生成」链路产出的条目，关键词仍为中文（无回归）。
6. 断网/Key 失效场景：画面脚本失败 → 卡片回退解说原文不空白；关键词失败 → 搜索框为空、无报错弹层。

### 8.4 Definition of Done

- 上述单测通过；`npm run type-check` 与 `npm run lint` 无新增错误（沿用项目阈值）。
- 桌面走查 1–6 全部满足。
- 仅改动 §4 计划内文件，无构建产物 / `__pycache__` / `.next` 被牵连。

---

## 9. Risks & Mitigations（风险与缓解）

| 风险 | 说明 | 缓解 |
|---|---|---|
| R1 时延上升 | 关键词须串行于画面脚本之后，整体富化时间变长 | 两段内部各自并发；后台异步、不阻塞卡片显示；卡片先以解说原文即时可见 |
| R2 关键词语义漂移 | 关键词取自画面脚本而非旁白，可能偏离解说主题 | **设计意图如此**（更利于素材检索），文档显式记录覆盖诊断 R-4；如需回退，仅改 [3] 的取材源与 `language` 参数即可 |
| R3 共享端点回归 | 关键词端点被旧链路共用 | `language` 默认 `chinese`，仅解说直接生成传 `english`；新增英文单测 + 旧默认单测双向兜底 |
| R4 富化期用户编辑竞态 | 用户在富化途中改/删条目 | 沿用 `narrationBySentence` 编辑守卫 + 按 id 合并 `scriptSegmentsRef.current` + 单次写回；id 全删则不写 |
| R5 TTS 误读画面脚本 | 覆写 `sentence.text` 是否影响语音 | 不影响：TTS 优先 `narrationText`（`tts.ts:201`），`narrationText` 全程不变（评审 R-1） |
| R6 LLM 不守约 | 返回非英文 / >3 个 / 夹带编号 | prompt 强约束 + 解析过滤编号 + `.slice(0,3)`；偶发杂质不影响搜索可用性 |
| R7 上下文截断 | `buildFullScriptContext` 截断到 4000 字符，超长解说后段丢失全局上下文 | 现状可接受；如需可在后续迭代提升预算或按句邻域裁剪，本期不改 |
| R8 重复润色 | TTS 后 `autoGeneratePromptsForSegment` 可能再润色画面脚本 | 富化时预置 `aiVideoPrompt`/`aiVideoPromptStatus:'succeeded'`，`shouldAutoGeneratePrompt` 命中即跳过（`sentenceAiVideoPrompt.ts:52-58`） |
| R9 富化慢于 TTS（评审 R-5） | 搜索按钮受 `completedSegments`（TTS 完成）门控（`ScriptPanel.tsx:1022`）；若关键词富化更慢，用户开搜索时预填可能为空 | **非回归**（旧链路关键词同为异步、同样可能未就绪）；空预填可手输、重开即填；如需强一致可在后续迭代加「关键词生成中」门控，本期不做 |
| R10 跨语言关键词（评审 R-1） | AI 视频脚本为中文，英文关键词须由 LLM 跨语言产出 | §5.1 英文 prompt 显式声明「源文可能为中文、必须输出英文」+ 英文 few-shot；偶发杂质由健壮解析兜底 |

---

## 10. 附：关键证据索引（file:line）

- `src/components/video/VideoEditingInterface.tsx:1037-1111` — `enrichNarrationSegments`（本期主改：重排 [2]→[3]→[4]）。
- `src/components/video/VideoEditingInterface.tsx:1117-1132` — `handleAppendNarrationSegments` + `useNarrationDirectScript` 接线（触发富化，不改）。
- `src/components/video/hooks/useScriptGeneration.ts:12-90` — `generateKeywordsForSegments`（加 `options.language`）。
- `src/components/video/hooks/useScriptGeneration.ts:260-283` — `handleUpdateSegments`（单一写入出口，不改）。
- `src/app/api/script-keywords-generation/route.ts:17-200` — 关键词端点（加英文 prompt + `language` 参数）。
- `src/app/api/prompt-polish/route.ts:79-109` — `ai-video` 画面脚本 prompt（复用，不改）。
- `src/lib/api/sentenceAiVideoPrompt.ts:6-58` — `buildFullScriptContext` / `generateSentenceAiVideoPrompt` / `shouldAutoGeneratePrompt`（复用，不改）。
- `src/components/video/ScriptPanel.tsx:1020-1042` — `handleOpenVideoSearch` 读 `keywords`（不改）。
- `src/components/video/hooks/useVideoSearch.ts:222-242` — `openSearchModal` 预填搜索框（不改）。
- `src/lib/api/tts.ts:201-217` — TTS 取 `narrationText`（覆写 `sentence.text` 安全的依据）。
- `src/types/index.ts:161-189` — `ScriptSentence` / `ScriptSegment` 字段（无新增）。

---

> 文档版本：v2（已过子任务 #1 设计评审，P0/P1 已就地修复）。本方案在「关键词取材 / 语言 / 顺序」三点上**有意覆盖**前序诊断 R-4，已在 §3.3、§9-R2 给出理由与回退路径；评审确认该取舍符合本次需求（英文画面词更利于 Pexels 等素材检索）。

---

## 评审结论（Review Verdict）

**有条件通过（Approved with conditions）。**

**总评**：方案与本次需求高度吻合，技术路径**可行且低侵入**。评审逐一回读了 spec 引用的 10 处 `file:line`，**全部属实**（`enrichNarrationSegments` 现序为「先关键词后画面脚本」确为待反转对象；`buildFullScriptContext` 优先 `narrationText` 满足「整篇解说作上下文」；`generateSentenceAiVideoPrompt` / `runWithConcurrency` / `shouldAutoGeneratePrompt` 均如述存在；TTS 优先 `narrationText`，覆写 `sentence.text` 安全；搜索预填路径 `openSearchModal(keywords)` 正确）。测试设施为 **vitest**、已有 API 路由单测先例，新增测试落地无障碍。改动收敛在 1 路由 + 1 工具函数 + 1 段父级富化 + 测试，**规模适配得当，无过度设计**。

**已就地修复（P0/P1）**：
- 无 P0。
- **R-1（P1）**：§5.1 英文 prompt 增加「源文可能为中文、必须输出英文」跨语言声明 + 英文 few-shot。
- **R-2（P1）**：统一关键词数量口径为「目标 3、上限 3、best-effort ≤3」；§8.1 测试断言由 `===3` 改为 `1 ≤ length ≤ 3`；标题/§1/§2/§5.1/§6/§8.3 全部对齐。
- **R-3（P1）**：§5.1 解析规范由「整行丢弃编号行」改为「剥离行首编号/项目符号/引号后保留」，并补编号鲁棒性单测，杜绝英文编号输出导致 0 关键词。

**放行条件（实现期必须满足，对应 P2）**：
1. **R-4**：非法 `language` 一律回退 `chinese`，不得返回 400 阻断富化。
2. **R-7**：实现时更新 `generateKeywordsForSegments` 顶部 doc 注释，显式标注「取材现可为 AI 视频脚本、语言可选、反转诊断 R-4」，避免旧注释误导。
3. **R-5/R-9**：接受「富化慢于 TTS 时预填短暂为空」的降级（非回归），不得因此报错或阻断；如未来要强一致再加门控。
4. **R-6**：以符号（函数名）定位实现，不依赖文中行号（个别已轻微漂移）。
5. **桌面走查强制门禁**：§8.3 步骤 1–6 必须全部通过（本仓约定：桌面 standalone 走查为合并前的强制 gate），并确认提交不牵连 `__pycache__` / `.next` / 构建产物。

满足以上条件即可进入实现（子任务 #2）。**无 P0 / P1 遗留。**
