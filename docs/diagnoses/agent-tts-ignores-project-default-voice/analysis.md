# Agent 生成配音时未使用「全片默认音色」 — 问题定位与分析

- **Bug slug**: `agent-tts-ignores-project-default-voice`
- **报告日期**: 2026-06-29
- **所属轮次**: 标准 Bug 修复 / 第 1 轮
- **分析人**: Subtask #0（问题定位与分析）
- **约束**: 本节点只做定位与分析，不写修复代码（fix 由 Subtask #2 按本文"推荐方案"落地）

---

## 一、问题描述（Problem description）

AI 剪辑助手在生成配音（TTS）时，使用的默认音色与用户在界面上选择的「全片默认音色」不一致。

用户视角的期望（来自任务描述）：

1. Agent 剪辑生成语音配音时，**默认音色必须与左侧文案脚本面板底部「全片默认音色」一致**；
2. 用户在该处改过默认音色后，Agent 生成配音也要跟着用用户选的音色；
3. 涉及生成配音时，Agent **应当在对话界面里询问用户是否需要更换音色**（而不是自己默默决定）。

实际观察到的行为：

- 用户在「全片默认音色」里选择（或保持内置缺省）**少年梓辛 2.0**（`zh_male_shaonianzixin_uranus_bigtts`）；
- 让 Agent「给脚本加旁白 / 生成配音 / 把这段文案读出来」后，生成出来的音频是**女声、清新女声 2.0**（`zh_female_qingxinnvsheng_uranus_bigtts`）；
- 界面上的「全片默认音色」自始至终没有变化，Agent 也从不询问是否需要换音色。

一句话概括：**界面里"显示的默认音色"和 Agent 真正使用的"默认音色"是两条互不相交的数据通路，且两者的内置缺省值都不是同一个音色。**

---

## 二、复现步骤（Reproduction steps）

### A. 单元级复现（最快，10 秒，不依赖后端/界面/凭证）

> 目标：直接证明 Agent 侧的 TTS 工具在"调用方未指定 `voice_type`"时会忽略工程默认音色。

1. 新建临时复现文件 `src/lib/video-editing-agent/__tests__/_repro.tts-default-voice.test.ts`，内容如下
   （`UI_DEFAULT_VOICE` 取值来自 `src/components/video/ScriptPanel.tsx:58`，即界面缺省显示的"全片默认音色"）：

   ```ts
   import { describe, expect, it, vi } from 'vitest';
   import type { ToolContext } from '../types';
   import { createGenerateTtsTool } from '../tools/generateTts';
   import { createBatchGenerateTtsTool } from '../tools/batchGenerateTts';

   /** src/components/video/ScriptPanel.tsx:58 — 界面「全片默认音色」的缺省值。 */
   const UI_DEFAULT_VOICE = 'zh_male_shaonianzixin_uranus_bigtts';

   function context(defaultVoiceId: string): ToolContext {
     return {
       materials: [], operations: new Map(),
       apiBaseUrl: 'http://127.0.0.1:3000',
       recordOperation: vi.fn(), updateTimeline: vi.fn(),
       defaultVoiceId, // 期望通路：工程默认音色经 ToolContext 下发
     } as unknown as ToolContext;
   }

   describe('[REPRO] agent TTS must use the project default voice', () => {
     it('generate_tts 未显式指定 voice_type 时使用工程默认音色', async () => {
       const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
         success: true, audio_url: '/a.mp3', duration: 1,
       }), { status: 200 }));
       vi.stubGlobal('fetch', fetch);
       await createGenerateTtsTool(context(UI_DEFAULT_VOICE)).execute('one', { text: '一句话' });
       expect(JSON.parse(fetch.mock.calls[0][1].body).voice_type).toBe(UI_DEFAULT_VOICE);
     });

     it('batch_generate_tts 未显式指定 voice_type 时使用工程默认音色', async () => {
       const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
         success: true, results: [{ segment_id: 'x', success: true, audio_url: '/a.mp3' }],
       }), { status: 200 }));
       vi.stubGlobal('fetch', fetch);
       await createBatchGenerateTtsTool(context(UI_DEFAULT_VOICE))
         .execute('batch', { segments: [{ text: '第一句' }] });
       const body = JSON.parse(fetch.mock.calls[0][1].body);
       expect(body.segments.map((s: { voice_type: string }) => s.voice_type))
         .toEqual([UI_DEFAULT_VOICE]);
     });
   });
   ```

2. 运行：

   ```
   npx vitest run src/lib/video-editing-agent/__tests__/_repro.tts-default-voice.test.ts --reporter=verbose
   ```

3. **实测输出（2026-06-29，本机，当前工作树）—— 两个断言全部失败，即 Bug 成立：**

   ```
   × [REPRO] agent TTS must use the project default voice > generate_tts without voice_type ...
     → expected 'zh_female_qingxinnvsheng_uranus_bigtts'
             to be 'zh_male_shaonianzixin_uranus_bigtts' // Object.is equality
   × [REPRO] agent TTS must use the project default voice > batch_generate_tts without voice_type ...
     → expected [ Array(1) ] to deeply equal [ Array(1) ]

   AssertionError: expected 'zh_female_qingxinnvsheng_uranus_bigtts'
                   to be 'zh_male_shaonianzixin_uranus_bigtts'
   Expected: "zh_male_shaonianzixin_uranus_bigtts"
   Received: "zh_female_qingxinnvsheng_uranus_bigtts"

   - Expected
   + Received
     [
   -   "zh_male_shaonianzixin_uranus_bigtts",
   +   "zh_female_qingxinnvsheng_uranus_bigtts",
     ]

    Test Files  1 failed (1)
         Tests  2 failed (2)
   ```

   > 注：该临时文件仅用于取证，取证后已删除（本节点不落地任何测试/修复代码）。
   > Subtask #2 应把它（去掉下划线前缀）作为回归测试固化下来。

### B. 端到端复现（在桌面端 / `npm run dev` 界面内）

前置：TTS 凭证可用（设置 → 服务与素材库 → TTS 已配置），工程里有至少一段带句子的文案脚本。

1. 启动应用（桌面端或 `npm run dev` 后打开一个视频编辑任务）。
2. 看左侧「文案脚本」面板**底部**的底栏，确认显示：`全片默认音色：少年梓辛 2.0`（或任选一个与"清新女声"不同的音色，例如 `温柔淑女 2.0`）。
3. 点该底栏右侧「更换」，在弹出列表里**选一个男声**（如 `阳光青年 2.0` / `zh_male_yangguangqingnian_uranus_bigtts`），关闭弹层，确认底栏名字已更新。
4. 在右下 Agent 对话里发送：`给第一段文案生成配音，加到音频轨`。
5. 观察 Agent 的工具调用卡 `generate_tts`：参数里**没有 `voice_type`**（模型省略了它）。
6. 播放生成结果：是**女声**（清新女声 2.0），与步骤 3 选的男声不一致；底栏仍是步骤 3 选的男声。
7. 交叉验证（可选，取日志证据）：在 Agent 生成的音频请求上抓 `/api/tts/convert` 的请求体，`voice_type` 恒为 `zh_female_qingxinnvsheng_uranus_bigtts`，与工程设置无关。

### C. 对照实验（用来区分"通路断"还是"用户说了不管用"）

- 在对话里**明确指定**音色：「用 `zh_male_yangguangqingnian_uranus_bigtts` 生成配音」→ Agent 会照用，音频是男声。
  **这说明"参数能够生效"，坏掉的只是"默认值来源"**，不是整条 TTS 通路。
- 在片段卡片上（非 Agent 路径）点「转换语音」→ 音频立刻变成底栏所选音色。
  **说明 UI 侧通路是正确的**，差异只出现在 Agent 侧。

---

## 三、根因分析（Root cause analysis）

整条链路上有 **5 个断点**，任何一处补上都还不够——音色信息在"前端请求体"这一步就已经丢失了。

### 3.1 界面侧的真相：默认音色存在工程内容里，缺省是"少年梓辛 2.0"

- `src/components/video/ScriptPanel.tsx:57-58` — 界面内置缺省常量：

  ```ts
  /** 全片默认音色的内置缺省值（旧工程没有 content.defaultVoiceId 时沿用，I-1）。 */
  export const DEFAULT_VOICE_ID = 'zh_male_shaonianzixin_uranus_bigtts';
  ```

- `src/components/video/ScriptPanel.tsx:123` — 属性缺省即取该常量：`defaultVoiceId = DEFAULT_VOICE_ID,`
- `src/components/video/ScriptPanel.tsx:1820-1824` — 底栏渲染的就是这个值：
  `selectedVoiceId={defaultVoiceId}`（组件 `src/components/video/components/SegmentCard/DefaultVoiceBar.tsx:104-121`，文案"全片默认音色：{名称}"）
- `src/components/video/workbench/useWorkbenchWiring.ts:196` — 真正的持久化来源：`defaultVoiceId: content?.defaultVoiceId`，
  写入在 `:182-184`（`setDefaultVoiceId` → 写 `content.defaultVoiceId`，随工程保存）。
- `src/components/video/VideoEditingInterface.tsx:2246` — `defaultVoiceId={workbench.defaultVoiceId} onDefaultVoiceChange={workbench.setDefaultVoiceId}`

**UI 侧用它生成配音是正确的**（对照组证据）：`src/components/video/hooks/useSegmentVoiceGeneration.ts:252`
`voiceId: segment.voiceId ?? defaultVoiceId,` —— 片段覆盖优先，其次全片默认。

### 3.2 断点 1：Agent 请求体根本没有携带音色

`src/components/video/hooks/useAgentExecution.ts:577-595` 构造 `/api/video-editing-agent/chat` 的请求体：

```ts
startExecution({
  url: '/api/video-editing-agent/chat',
  body: {
    messages: stripHistoryForRequest(messagesWithUser),
    timelineState: { ...baseline, aspectRatioId: coverAspectRatioRef.current ?? '16:9' },
    materials: stripInlineMediaForAgent(materialsRef.current),
    projectId,
    lastCompositionId: readLastCompositionId(projectId),
    ...(options?.skillId ? { skillId: options.skillId } : {}),
    ...(options?.mentions?.length ? { mentions: options.mentions } : {}),
    ...buildEditorContextField(getEditorContextRef.current),
    ...(yolo ? { autonomy: 'yolo' as AgentAutonomy } : {}),
  },
  ...callbacks,
});
```

- 没有 `defaultVoiceId` 字段。
- 入参类型 `UseAgentExecutionParams`（`useAgentExecution.ts:76-105`）也没有这个字段——上层想传都无处可传。
- 调用点 `src/components/video/VideoEditingInterface.tsx:2011-2029` 同样没传（它手里的 `content?.defaultVoiceId` 只给了 `ScriptPanel` 与 `segmentCommands`，后者见 `:2209`）。

> 佐证（零命中即可证明字段不存在）：
> `findstr /n "defaultVoiceId" src/app/api/video-editing-agent/chat/route.ts src/components/video/hooks/useAgentExecution.ts src/lib/video-editing-agent/types.ts src/lib/video-editing-agent/agent.ts` → **无任何输出**。

### 3.3 断点 2：Route 不读，类型里也没有

- `src/lib/video-editing-agent/types.ts:323-339` — `AgentChatRequest` 只有
  `messages / timelineState / materials / projectId / lastCompositionId / skillId / mentions / autonomy`。
- `src/app/api/video-editing-agent/chat/route.ts:339-342` — 只解构与白名单校验这几项：

  ```ts
  const { messages, timelineState, materials, projectId } = body as AgentChatRequest & { projectId?: string };
  const lastCompositionId = readCompositionId(body.lastCompositionId);
  const editorContext = readEditorContext((body as { editorContext?: unknown }).editorContext);
  const autonomy   = readAutonomy((body as { autonomy?: unknown }).autonomy);
  ```

  没有任何音色字段的读取/校验/传递。

### 3.4 断点 3：ToolContext 没有音色字段，工厂也不注入

- `src/lib/video-editing-agent/types.ts:20-101` — `ToolContext` 全文无 `voice`/`defaultVoiceId` 相关字段。
- `src/lib/video-editing-agent/agent.ts:82-118` — `createVideoEditingAgent` 组装 ToolContext 时只放了
  `timelineState / materials / apiBaseUrl / projectId / lastCompositionId / turnState / callBudget / ...`，
  没有音色来源。

### 3.5 断点 4：两个 TTS 工具各自硬编码了"清新女声"

- `src/lib/video-editing-agent/tools/generateTts.ts:11`

  ```ts
  const DEFAULT_VOICE_TYPE = 'zh_female_qingxinnvsheng_uranus_bigtts';
  ```

  - `:42` `const voiceType = params.voice_type ?? DEFAULT_VOICE_TYPE;`（省略即清新女声）
  - `:75-78` 音色不可用时的回退也是回退到这个常量（`voiceType === DEFAULT_VOICE_TYPE` 短路）

- `src/lib/video-editing-agent/tools/batchGenerateTts.ts:13` 同值常量，
  - `:43` `voice_type: segment.voice_type ?? DEFAULT_VOICE_TYPE,`
  - `:95` 连请求**顶层** `voice_type` 也写死成同一个常量。

  后端语义是"段级优先，顶层兜底"：`backend-services/basic-service/app/services/batch_tts_service.py:157`
  `segment.voice_type or request.voice_type,` —— 所以顶层写死虽然目前被段级填充"盖住"，仍是第二个隐性默认值来源。

> 结论：**`zh_female_qingxinnvsheng_uranus_bigtts`（工具缺省）≠ `zh_male_shaonianzixin_uranus_bigtts`（界面缺省）**。
> 即使一个用户从没改过设置，Agent 生成的人声也和界面显示的不一致。

### 3.6 断点 5：提示词把错误的默认值明确告诉了模型

- `src/lib/video-editing-agent/promptParts.ts:159-170`（`TTS_VOICE_TABLE_MD`）最后一行：

  > `省略 voice_type 时默认使用 zh_female_qingxinnvsheng_uranus_bigtts。所有可选音色见 /api/tts/voices；不要使用 *_moon_bigtts (1.0) — 已停用。`

- 这段被拼进 TTS 类别的使用提示：`promptParts.ts:219-224`（`CATEGORY_USAGE_HINTS[CATEGORY_IDS.TTS_TOOLS]`，`… + TTS_VOICE_TABLE_MD`），
  `explore_tools(tts_tools)` 与 Layer B 回顾都会渲染它。

也就是说：**提示词把"省略即清新女声"当成事实教给模型**，与界面「全片默认音色」显示的"少年梓辛 2.0"直接矛盾；模型即使想遵守界面设置也无从得知。

  > **评审修正（2026-06-29，见 §8.2 E-2 / E-3）**：本节的**机制描述不成立**——`TTS_VOICE_TABLE_MD`
  > （含 `:170` 这一行）在生产路径上**不会**进入模型上下文：`explore_tools` 带 `activation`
  > 时只回 `tools[].description`（`tools/exploreTools.ts:70-94`），不含 usage_hints；Layer B 的
  > `formatExploredCategoriesAppendix` 又恒为空（`agent.ts:153` 传 `exploredCategories: []`）。
  > 但"提示词把错误默认值写成了事实"这个**结论依然成立**，真正生效的载体是
  > `generateTts.ts:17` 的参数描述，它经 Layer A 的 `formatParamSignature`
  > （`systemPrompt.ts:283-285`）**每一轮都**渲染进 L0 系统提示词。

### 3.7 需求第 3 点（Agent 主动咨询是否换音色）为何也没实现

- 咨询能力本身存在：`src/lib/video-editing-agent/tools/askUserTool.ts:40-60`（`ask_user`，单轮最多一次，`:52-60` 的 `already_asked` 保护；YOLO 模式下整类移除，见 `agent.ts:122-128`）。
- 但**没有任何规则触发它**：TTS 工具描述只说"仅音色不可用时尝试一次默认音色"（`generateTts.ts:32`），
  TTS 类别提示（`promptParts.ts:219-224`）也没有"生成配音前先确认音色"的指令。
  所以现状是——既用错默认音色，也不会问。

### 3.8 这不是偶发：错误默认值被现有测试固定住了

- `src/lib/video-editing-agent/__tests__/ttsTools.errorPropagation.test.ts:6`
  `const DEFAULT_VOICE = 'zh_female_qingxinnvsheng_uranus_bigtts';`
- 同文件 `:370-374` 断言"未指定 voice_type 的段落 → `DEFAULT_VOICE`"：

  ```ts
  segments: [{ text: '第一句', voice_type: 'voice-a' }, { text: '第二句' }],
  ...
  expect(request.segments.map(s => s.voice_type)).toEqual(['voice-a', DEFAULT_VOICE]);
  ```

  这个测试**通过**，说明"省略即清新女声"是被当作正确契约锁定下来的既有行为——修复时必须同步修正该断言，否则 Subtask #2 会与它正面冲突。

### 3.9 根因结论

> **音色在设计上就没有进入 Agent 的数据通路。** 界面把全片默认音色存在工程内容 `content.defaultVoiceId`（缺省 `zh_male_shaonianzixin_uranus_bigtts`），
> Agent 却只能通过"请求体 → `AgentChatRequest` → `VideoEditingAgentConfig`/`ToolContext` → 工具"拿到上下文，
> 而这条链条在**第一环（`useAgentExecution` 请求体）就没有这个字段**，
> 于是两个 TTS 工具只能落到各自的硬编码常量 `zh_female_qingxinnvsheng_uranus_bigtts`，
> 提示词又把这个错误常量写成了"事实"。三处默认值（界面 / 工具 / 提示词）互不一致，且相互之间没有任何引用关系。
> **评审修正（见 §8.2 E-1）**：实际是 **13 处字面量（female 6 / male 7）**，而且**后端自己就自相矛盾**
> —— `tts_models.py:101,158` 默认 male，`tts_service.py:72` 默认 female，`tts_service.py:341,354` 又默认 male。
> "三处"低估了漂移面，但**不影响**"音色从未进入 Agent 通路"这一根因结论。

---

## 四、影响面（Impact surface）

### 4.1 受影响的功能

| 功能 | 是否受影响 | 说明 |
|---|---|---|
| Agent 单段配音 `generate_tts` | **是** | 模型按提示词习惯省略 `voice_type` → 落硬编码常量 |
| Agent 批量配音 `batch_generate_tts` | **是** | 每段未指定即落常量；顶层也写死（`batchGenerateTts.ts:43,95`） |
| 所有"让 Agent 加旁白/配音/读文案"的对话工作流 | **是** | 包括内置 skill 里的解说类配方、故事板旁白、`generate_video_script` 产出的 `narration_text` 转 TTS |
| 左侧片段卡片「转换语音」 | 否 | 走 `useSegmentVoiceGeneration.ts:252`，正确读 `segment.voiceId ?? defaultVoiceId` |
| 段落级音色覆盖 UI（`SegmentVoiceOverride.tsx:35,40`） | 否 | 仅影响手动路径 |
| 「全片默认音色」底栏本身 | 否 | 渲染正常，只是"说了不算" |

### 4.2 受影响的用户

- **所有用户**：因为界面缺省（少年梓辛 2.0）与工具缺省（清新女声 2.0）本身就不同，连"没改过设置"的人也会看到人声与底栏不符。
- **改过默认音色的用户**：改动被完全忽略，属于"设置失效"级别的问题，信任度伤害更大。
- 英文工程更明显（用户可能设 `en_male_tim_uranus_bigtts` 却被生成中文女声）。

### 4.3 下游 / 次生影响

- **时长与时间轴**：不同音色的语速不同，配音时长会整体偏差，导致字幕时长、音频轨与视频轨的对齐（"视频轨必须最长"硬约束）需要返工。
- **导出成品**：成片人声与用户在界面上确认过的音色不符，需重新生成配音 + 重新对齐 + 重导出。
- **排查成本高**：没有任何日志或工具返回字段说明"本次音色来自哪里"。用户看到底栏写着 X、听到 Y，无从判断是 Bug 还是自己没点保存。

---

## 五、候选修复方案（Candidate fixes）

| # | 方案 | 做法要点（文件级） | 侵入面 | 风险 | 工作量 | 能否修好根因 |
|---|---|---|---|---|---|---|
| **A** | **前端透传工程默认音色（推荐）** | `useAgentExecution` 请求体加 `defaultVoiceId`；`AgentChatRequest`/Route 白名单读取；`VideoEditingAgentConfig`/`ToolContext` 新增字段；两个 TTS 工具改为 `params.voice_type ?? context.defaultVoiceId ?? FALLBACK`；提示词注入当前默认音色 + 咨询规则 | 前端 2 文件、类型 2 文件、route 1、agent 1、工具 2~3、提示词 2，**约 8-10 文件 / 60-90 行** | **低**：只沿既有通路（请求体→ToolContext）加一个字符串字段，不新增后端调用、不改 TTS 后端、不动 UI 渲染 | 0.5–1 天 | **是**（且"用户改过也一致"） |
| B | Route 侧按 `projectId` 自查工程默认音色 | route 里照 `loadMemoryDigest` 的模式（`route.ts:265-294`）再拉一次工程数据，读出 `project_data.defaultVoiceId` 注入 ToolContext | 后端 route + 可能的工程读取接口，2-3 文件 | **中**：每轮多一次 HTTP + JSON 解析；工程数据可能是客户端未落盘的旧快照（`useProjectAutosave` 异步写），存在"刚改完就问 Agent 仍用旧音色"的竞态；与 `projectId` 缺失场景要另写降级 | 0.5–1 天 | 是，但会引入"两个真相源"和时序问题 |
| C | 只改提示词 / 强制 `ask_user` | 把 `promptParts.ts:170` 的"省略即清新女声"改成"生成配音前先 `ask_user` 问用户" | 1 文件 | **低** | 0.2 天 | **否**：模型仍然不知道界面默认音色；且每轮都问，打断自动化；YOLO 模式下 `ask_user` 不注册（`agent.ts:122-128`），该方案在 YOLO 下彻底失效 |
| D | 把工具常量改成"少年梓辛"以对齐界面缺省 | 改 `generateTts.ts:11`、`batchGenerateTts.ts:13` 常量 | 2 文件 | **低** | 0.1 天 | **否**：只对齐"缺省场景"，用户一旦改过设置又错；且把默认值再复制一处，漂移更严重 |
| E | A + B 组合（客户端传，服务端兜底） | A 为主，B 仅在客户端未传时启用 | A 的 8-10 文件 + B 的 2-3 文件 | 中 | 1–1.5 天 | 是，但 B 的时序风险会带进主链路 |

**"改动最小且真正修好"的判定**：A 是唯一同时满足①与界面一致、②用户改过也一致、③不新增状态源 的方案；
D 是最小改动但只治标；C 独立使用无效，但它的"咨询规则"应作为 A 的组成部分保留（对应需求的第 3 点）。

---

## 六、推荐方案与理由（Recommended fix）

### 6.1 推荐：方案 A（前端透传）+ 提示词与咨询规则（A 的组成部分）

**为什么是它**

1. **唯一真相源不动**：界面已经是"用户可见的默认音色"的唯一来源（`content.defaultVoiceId`），A 只是把它沿既有请求通路带下去，没有引入新的状态或第二份持久化。
2. **改动面贴着现有架构**：`lastCompositionId` / `autonomy` / `editorContext` 都是"前端传、route 白名单校验、注入 ToolContext"的同款模式（`types.ts:323-339`、`route.ts:339-342`、`agent.ts:82-118`），A 完全复刻这条路径，不新开岛屿。
3. **没有时序风险**：不走后端二次读取，用户刚点完「更换」立刻发消息也一定一致（B 的竞态在这里不存在）。
4. **顺手消灭三处常量漂移**：现在 `zh_female_qingxinnvsheng…` 出现在 2 个工具 + 1 处提示词，`zh_male_shaonianzixin…` 出现在 1 处界面常量；A 把它们收敛到 1 个模块。
5. **同时满足需求第 3 点**：只有在提示词里"知道"当前默认音色，模型才能把"使用默认（X）/ 换成别的"作为选项交给用户——不修通路，咨询规则就是空话。

### 6.2 落地清单（供 Subtask #2 直接照做）

1. **收敛默认音色常量（新模块，唯一来源）**
   - 新增 `src/lib/video-editing-agent/voiceDefaults.ts`：
     - `export const FALLBACK_TTS_VOICE_ID = 'zh_male_shaonianzixin_uranus_bigtts';`
       （与界面缺省同值，避免"无任何信息时"再退化成女声）
     - `export function resolveVoiceType(requested?: string, projectDefault?: string): string`
       —— 优先级：**用户在对话里明确指定 > 工程全篇默认 > FALLBACK**；空串/纯空白视为未指定。
   - `src/components/video/ScriptPanel.tsx:58` 改为从该模块 re-export（`export const DEFAULT_VOICE_ID = FALLBACK_TTS_VOICE_ID;`），
     保持既有 import 不破坏；工具侧删掉本地 `DEFAULT_VOICE_TYPE`（`generateTts.ts:11`、`batchGenerateTts.ts:13`）。

2. **前端透传**
   - `src/components/video/hooks/useAgentExecution.ts:76-105`：`UseAgentExecutionParams` 增 `defaultVoiceId?: string`；
     请求体（`:577-595`）加 `...(defaultVoiceId ? { defaultVoiceId } : {})`；用 ref 读最新值（与 `materialsRef` 同风格），并补进 `sendAgentMessage` 的依赖数组。
   - `src/components/video/VideoEditingInterface.tsx:2011-2029` 传入 `defaultVoiceId: workbench.defaultVoiceId ?? DEFAULT_VOICE_ID`
     （与 `:2209` `getDefaultVoiceId` 完全同源同值，保证"界面显示 / 段落 TTS / Agent TTS"三者一致）。

3. **类型与 Route 白名单**
   - `src/lib/video-editing-agent/types.ts:323-339`：`AgentChatRequest` 增 `defaultVoiceId?: string`；
     `ToolContext`（`:20-101`）与 `VideoEditingAgentConfig`（`:389-463`）各增 `defaultVoiceId?: string`（带注释说明来源）。
   - `src/app/api/video-editing-agent/chat/route.ts`：仿 `readCompositionId`（`:305-310`）新增
     `readVoiceId(value: unknown): string | undefined` —— 仅接受 `/^[A-Za-z0-9_-]{1,64}$/`，非法一律 `undefined`（不 400，降级）；
     在 `:339-342` 旁读取，并传进 `createVideoEditingAgent`（`:557-577`）。

4. **注入 ToolContext**
   - `src/lib/video-editing-agent/agent.ts:82-118`：`toolContext.defaultVoiceId = config.defaultVoiceId;`

5. **工具改用解析函数**
   - `generateTts.ts:42` → `const voiceType = resolveVoiceType(params.voice_type, context.defaultVoiceId);`
     音色不可用时的回退（`:75-78`）同样回退到 `resolveVoiceType(undefined, context.defaultVoiceId)`，而不是硬编码常量。
   - `batchGenerateTts.ts:43` → 每段 `resolveVoiceType(segment.voice_type, context.defaultVoiceId)`；
     `:95` 顶层 `voice_type` 改为 `resolveVoiceType(undefined, context.defaultVoiceId)`（与段级语义一致，后端 `batch_tts_service.py:157` 仍是"段级优先"）。

6. **提示词：让模型知道真相，并在必要时咨询用户**
   - `src/lib/video-editing-agent/promptParts.ts:170`：把"省略 voice_type 时默认使用 zh_female_qingxinnvsheng…"改为
     "省略 voice_type 时使用本工程「全片默认音色」（见系统提示中的「全片默认音色」段）；用户明确指定则以用户为准。"
   - `src/lib/video-editing-agent/systemPrompt.ts`：`BuildSystemPromptInput`（`:488-510`）增 `defaultVoiceId?: string`；
     新增 `formatDefaultVoice(id)`，输出一小节 `## 全片默认音色`（≤200 字符，含音色 ID 与一句"生成配音省略 voice_type 即用它"），
     插在 `projectStatus` 之后（`buildSystemPrompt` `:640-657` 的 sections 数组），并计入既有 `L0_PROMPT_CHAR_CEILING = 18_900`（`:376`）预算。
   - **咨询规则**（写进 `CATEGORY_USAGE_HINTS[TTS_TOOLS]`（`promptParts.ts:219-224`）与 `generateTts.ts:32` / `batchGenerateTts.ts:32` 描述）：
     - 默认：**直接用全片默认音色**，不要每轮都问；
     - 仅当出现下列信号之一时，先用 `ask_user` 问**一次**（选项示例：`使用当前默认音色 X` / `换一个音色` / `我来挑，先别生成`）：
       用户提到性别/风格/语言/年龄/情绪（"男声""温柔一点""英文""童声"）、或说"换个声音""音色不对"；
     - YOLO 模式下不问（`ask_user` 不注册，遵循 `agent.ts:122-128` 的既有排除机制）。

7. **测试（先红后绿，"修 bug 从复现测试开始"符合 CLAUDE.md 第 7 条）**
   - 新增 `src/lib/video-editing-agent/__tests__/ttsTools.defaultVoice.test.ts`（由本文 §2.A 的复现用例转正）：
     ① 单段未指定 → 用 `ToolContext.defaultVoiceId`；② 批量未指定 → 同上；③ 显式 `voice_type` 优先；
     ④ 无工程默认 → 落 `FALLBACK_TTS_VOICE_ID`；⑤ 音色不可用的回退目标 = 工程默认音色。
   - **修订** `src/lib/video-editing-agent/__tests__/ttsTools.errorPropagation.test.ts:6,370-374`：
     该断言目前把"省略 → 清新女声"当契约，必须改成显式注入 `defaultVoiceId` 后断言该值（或显式传 `voice_type`），否则与新行为冲突。
   - route 侧：为 `readVoiceId` 增白名单单测（非法值丢弃、超长丢弃、正常值透传）。
   - 提示词侧：`__tests__/systemPrompt.test.ts` / `agent.systemPrompt.test.ts` 已断言 `L0_PROMPT_CHAR_CEILING`，
     加入「全片默认音色」段后必须重跑，确认仍在 18 900 以内（现有余量约 650 字符，新增段 ≤200 字符，可行）。
    > **评审修正（见 §8.1 V-9）**：该判断用错了上限。`L0_PROMPT_CHAR_CEILING = 18_900` 只是**告警阈值**
    > （`agent.ts:180-184` 仅 `console.warn`），真正会把测试打红的是三条更紧的断言：
    > `systemPrompt.toolkit.test.ts:79` 与 `:146`（`≤ 18_500`）、`systemPrompt.yolo.test.ts:128`（`interactive ≤ 18_500`）。
    > 故可用余量上限是 `18_500 − 当前长度`（严格 ≤400 字符），不是 650。→ §8.6 已据此改写落地清单。

8. **验收标准**
   - §2.A 的两个断言由红转绿；
   - §2.B 的端到端步骤：底栏设为男声 → Agent 生成配音也是男声，且 `generate_tts` 返回的音频与手动「转换语音」音色一致；
   - `npx vitest run src/lib/video-editing-agent` 与 `npm run type-check` 通过；
   - 旧工程（无 `content.defaultVoiceId`）行为与现在一致（回落到 `FALLBACK_TTS_VOICE_ID` = 界面缺省 少年梓辛 2.0，不退化）。
       > **评审修正（见 §8.6）**："与现在一致"措辞错误：相对**现状**这是**变更**（清新女声 → 少年梓辛 2.0），
       > 正确的验收表述是"与**界面缺省**一致，且与手动「转换语音」同音色"。

### 6.3 风险与需要确认的点

- **批量接口语义**：`batchGenerateTts.ts:95` 改顶层 `voice_type` 后，需确认后端仍按"段级优先"（已核实：`batch_tts_service.py:157`），不会因顶层变化影响已显式指定音色的段。
- **音色可用性回退**：`generateTts.ts:75-78` 的回退目标改为"工程默认"后，若工程默认音色本身不可用（例如该音色已下线），需要保留最后一次回退到 `FALLBACK_TTS_VOICE_ID`，且仍通过 `voice_fallback: true` 上报（现有字段，见 `:83-91`）。
- **提示词预算**：新增小节必须在 `L0_PROMPT_CHAR_CEILING` 内，并放在确定性前缀之后（避免破坏 Anthropic prompt cache 的稳定前缀，见 `systemPrompt.ts:638-657` 的注释）。
- **YOLO 模式**：咨询规则在 YOLO 下不生效——这是既有设计，不是缺陷；需在提示词里显式写成"YOLO 下直接用默认音色"。

---

## 七、结论摘要

| 项 | 内容 |
|---|---|
| **症状** | Agent 生成配音的音色与界面「全片默认音色」不一致（实测：界面 少年梓辛 2.0 / Agent 清新女声 2.0） |
| **直接原因** | `useAgentExecution` 请求体不带音色 → `AgentChatRequest`/`ToolContext` 无此字段 → 工具落硬编码常量（`generateTts.ts:11,42`、`batchGenerateTts.ts:13,43,95`） |
| **放大因素** | 提示词 `promptParts.ts:170` 把错误的默认值写成事实；现有测试 `ttsTools.errorPropagation.test.ts:6,373` 把它固化 |
| **证据** | §2.A 复现用例 2 条断言失败（含实测报错原文）；§3 共 6 处 `path:line` 代码引用；`findstr` 零命中证明字段不存在 |
| **推荐修复** | 方案 A：前端透传 `defaultVoiceId` → route 白名单 → ToolContext → `resolveVoiceType(用户指定 > 工程默认 > FALLBACK)`；提示词注入当前默认音色并加"仅在必要时 `ask_user` 询问一次"规则；常量收敛到单一模块 |
| **影响面** | `generate_tts` / `batch_generate_tts` 及所有 Agent 旁白工作流；不影响手动「转换语音」与片段级音色覆盖 |

---

## 八、评审复核（Reviewer audit · 2026-06-29）

> 复核人：Subtask #1（评审）。复核方式：**只读**源码逐行比对（`read_file` / `findstr` / `grep`），
> 未改动任何实现代码，未执行 `git commit`。复核对象：§2 复现、§3 全部代码引用、§4 影响面、
> §5 方案对比、§6 落地清单。结论：**根因成立，修复方向正确，但机制描述有一处硬性错误、
> 优先级有一处错位、落地清单有四处需要收窄或修正**——见下。

### 8.1 复核结论速览（逐条裁决）

| # | 被复核的判断 | 裁决 | 复核证据（本次实测） |
|---|---|---|---|
| V-1 | 前端请求体不带 `defaultVoiceId` | **成立** | `useAgentExecution.ts:577-595` 请求体字段全列；该文件 `defaultVoiceId` 全文**零命中** |
| V-2 | Route / `AgentChatRequest` / `ToolContext` 无音色字段 | **成立** | `route.ts:339-342`；`types.ts:323-339`；`types.ts:20-101`（`types.ts` 内 `voice` **零命中**） |
| V-3 | 两个 TTS 工具硬编码清新女声 | **成立** | `generateTts.ts:11,42,75-78`；`batchGenerateTts.ts:13,43,95` |
| V-4 | 界面缺省=少年梓辛 2.0，持久化在 `content.defaultVoiceId` | **成立** | `ScriptPanel.tsx:57-58,95-96,123,1821`；`useWorkbenchWiring.ts:182-184,196`；`types/index.ts:363` |
| V-5 | UI 手动路径是正确的对照组 | **成立** | `useSegmentVoiceGeneration.ts:244-274`（`:252` `segment.voiceId ?? defaultVoiceId`） |
| V-6 | 提示词把"省略即清新女声"教给模型 | **结论成立，机制错误** | `promptParts.ts:159-170` 在生产路径**到不了模型**（§8.2 E-3）；真正生效的是 `generateTts.ts:17` → Layer A（§8.2 E-2） |
| V-7 | 现有测试把错误默认值固化为契约 | **成立，且多一处** | `ttsTools.errorPropagation.test.ts:6,370-374`，以及报告漏掉的 `:53-68`（回退目标断言 `:63`） |
| V-8 | 默认音色只有"三处" | **不成立（低估）** | 13 处字面量（female 6 / male 7），后端自身矛盾（§8.2 E-1） |
| V-9 | 提示词预算"余量约 650 字符" | **不成立（用错上限）** | 生效断言是 `18 500`（`systemPrompt.toolkit.test.ts:79,146`、`systemPrompt.yolo.test.ts:128`），`18 900` 只是告警 |
| V-10 | §2.A 的复现输出（2 条断言失败） | **无法从仓库复核** | `__tests__/` 内已无 `_repro.*` 文件（临时件已删）；但断言的行为由 V-3 源码唯一确定，结论不受影响 |
| V-11 | 修复面封闭在一条路由 | **成立** | 全仓 `createVideoEditingAgent` 仅 `route.ts:557` 一处调用；TTS 工具仅经 `tools/index.ts:419-421` 注入共享 `context` |
| V-12 | "咨询用户"能力可直接用 | **成立但代价被低估** | `ask_user` 会**结束本回合**（`askUserTool.ts:75-85` `status:'awaiting_user'`），不是"问一句继续做" |
| V-13 | 修复后需重跑提示词预算测试 | **成立但更严格** | `agent.systemPrompt.test.ts:122`、`systemPrompt.test.ts:165,200`（`≤18 900`）+ 三条 `≤18 500` |

### 8.2 报告未覆盖、但证据链必需的新增引用

**E-1 后端也有默认音色，且内部自相矛盾（13 处字面量：female 6 / male 7，另附枚举来源）**

| 归属 | 位置 | 值 |
|---|---|---|
| 界面常量 | `src/components/video/ScriptPanel.tsx:58` | male（少年梓辛 2.0） |
| 类型注释 | `src/types/index.ts:363` | male |
| 提示词音色表 | `promptParts.ts:164` | male（表内一行） |
| Agent 工具 | `tools/generateTts.ts:11` | **female** |
| Agent 工具 | `tools/batchGenerateTts.ts:13` | **female** |
| Agent 提示词 | `promptParts.ts:160,170` | **female** |
| Agent 测试 | `__tests__/ttsTools.errorPropagation.test.ts:6` | **female** |
| 后端 Pydantic | `app/models/tts_models.py:101` (`TTSRequest`) | male |
| 后端 Pydantic | `app/models/tts_models.py:158` (`BatchTTSRequest`) | male |
| 后端 service | `app/services/tts_service.py:72` (`VolcanoTTSClient.synthesize_speech`) | **female** |
| 后端 service | `app/services/tts_service.py:341,354` | male |
| 后端 config | `config/batch_tts_config.yaml:50-…`（102 条音色表） | 无默认，仅枚举 |

> 意义：后端**不是**一个可信的单一真相源；`tts_service.py:72` 与 `:341/:354` 在同一文件里就是两个值。
> 因此"让后端默认值兜底"（§8.5 方案 D′）只能当安全网，不能当方案。

**E-2 真正把"清新女声"塞进模型上下文的载体（修正 §3.6）**

- `generate_tts` 的 `voice_type` **参数描述**就写着"默认清新女声"：`tools/generateTts.ts:16-18`。
- 该参数描述经 Layer A 渲染进 **L0 系统提示词**：`promptParts.ts:141-142`（`generate_tts`/`batch_generate_tts`
  都在 `CORE_TOOLKIT_TOOL_NAMES` 里）→ `systemPrompt.ts:322-338`（`formatCoreToolkit`）
  → `systemPrompt.ts:283-285`（`formatParamSignature` 把 `prop.description` 拼进 `参数：……`）。
- **每一轮**都渲染，且 `generate_tts` 本来就常驻可调用（`agent.ts:125-129` 把 coreNames 预载入 activation）。
- 附带一处陈旧事实：`:170` 说"所有可选音色见 `/api/tts/voices`"，而真实路由是 `/api/tts/voice-types`
  （`src/lib/api/tts.ts:237`；`src/app/api/tts/` 下无 `voices` 目录）。

**E-3 `TTS_VOICE_TABLE_MD` 在生产路径上是死文本（修正 §3.6 的机制）**

- `explore_tools` 在**带 activation**（生产路径，`tools/index.ts` 构造时传入）时只返回
  `tools[{name, description}]`，**不返回 usage_hints**：`tools/exploreTools.ts:70-94`；
  只有不带 activation 的分支才拼 hints（`:96-125`）。
- Layer B 回顾恒为空：`agent.ts:153` 显式传 `exploredCategories: []`，且 `systemPrompt.ts:421`
  对空数组直接返回 `''`；`agent.ts:160-164` 追加的只是"已加载类别名"一句话，不含 hints。
- 结论：`promptParts.ts:159-170` 目前既不进 L0 也不进 explore 结果 → **是潜在缺陷（latent），不是现行症状的成因**。
  但它仍是必修项：任何让 Layer B/explore 恢复渲染的改动都会把错误默认值重新灌进上下文。

**E-4 前端已有同款注入范式（落地形状不必新造）**

- `useSegmentCommands.ts:63,111` 声明 `getDefaultVoiceId(): string`，`:439` 经 `optionsRef` 读取，
  `VideoEditingInterface.tsx:2209` 注入 `() => content?.defaultVoiceId ?? DEFAULT_VOICE_ID`。
- `useAgentExecution.ts:185-219` 已有 `getEditorContextRef` / `materialsRef` 的 ref 范式。

**E-5 候选 B 的时序风险有硬证据**

- `useProjectAutosave.ts:38` `const IDLE_DEBOUNCE_MS = 800;`，`:275-277` 防抖后再走 PUT。
  → 用户点完「更换」后 800ms 内发消息，服务端读到的仍是旧值；新建工程未落盘时更读不到。

**E-6 音色 ID 白名单可行性（实测）**

- `config/batch_tts_config.yaml` 共 **102** 条音色，字符集仅 `[0-9a-z_]`，最长 **39** 字符
  （`zh_female_tianmeixiaoyuan_uranus_bigtts`）。
- 故 §6.2 建议的 `/^[A-Za-z0-9_-]{1,64}$/` 对当前全量音色**全部通过**；建议放宽到 `{1,96}` 并允许 `.`
  以留未来余量（多接受合法值、少出现"合法 id 被静默丢弃"）。

**E-7 后端会拒绝空串音色**

- `tts_models.py:108-117`（`TTSRequest.validate_voice_type`）与 `:179-186`（`BatchTTSRequest`）：
  `voice_type` 为空/非字符串直接抛 `tts_voice_empty`（HTTP 422）。
- 故 `resolveVoiceType` **绝不允许**产出 `''`；工程默认值必须 `trim()` 后判空。

**E-8 路由是纯透传，`/api/tts/convert` 不补默认值**

- `src/app/api/tts/convert/route.ts:1-5` `createPassthroughRoute('/api/tts/convert')`。
- 因此"到底用哪个音色"完全由**请求体**决定：工具传什么，后端就用什么。

**E-9 脚本段落根本不在 Agent 请求里**

- `AgentChatRequest`（`types.ts:323-339`）只有 `messages/timelineState/materials/projectId/lastCompositionId/skillId/mentions/autonomy`，
  **没有 `segments`**；`timelineState` 里的片段（`TimelineItem`，`src/types/index.ts:832-876`）只有
  `volume/opacity/clipStart…` 等字段，**没有音色字段**。
- 影响：段级覆盖 `segment.voiceId`（`src/types/index.ts:294`）对 Agent **同样不可见**。
  这是本 bug 的**范围外邻接缺陷**，必须在文档里声明（见 §8.7 Q-2），否则修复后会出现"默认音色对了、
  被用户单独改过音色的那一段又错了"的二次报告。

**E-10 SSE 重试天然保持音色快照**

- `ToolContext` 每请求新建（`types.ts:63-68` 注释 + `agent.ts:82-118`），重试复用同一请求体 →
  `defaultVoiceId` 快照语义自动正确，不需要额外处理（这一点报告没写，但它是方案 A 的加分项）。

### 8.3 §3 引用逐条复核结果

| 报告引用 | 复核 |
|---|---|
| `ScriptPanel.tsx:57-58` / `:123` / `:1820-1824` | ✅ 行号与内容一致（底栏传参实为 `:1821`） |
| `useWorkbenchWiring.ts:196` / `:182-184` | ✅ |
| `VideoEditingInterface.tsx:2246` / `:2011-2029` / `:2209` | ✅（`:2209` 为 `getDefaultVoiceId`） |
| `useAgentExecution.ts:76-105` / `:577-595` | ✅（接口到 `:106`；请求体到 `:593`） |
| `types.ts:323-339` / `:20-101` / `:389-463` | ✅ |
| `route.ts:339-342` / `:305-310` / `:557-577` | ✅ |
| `agent.ts:82-118` / `:122-128` | ✅ |
| `generateTts.ts:11,42,75-78` / `batchGenerateTts.ts:13,43,95` | ✅ 全部命中 |
| `promptParts.ts:159-170` / `:219-224` | ✅ 文本存在；**但"会被渲染给模型"的机制不成立**（E-3） |
| `ttsTools.errorPropagation.test.ts:6,370-374` | ✅，且漏了 `:53-68/:63`（V-7） |
| `askUserTool.ts:40-60` | ✅（`:52-60` 为 `already_asked` 保护） |
| `batch_tts_service.py:157` | ✅ `segment.voice_type or request.voice_type` |

**结论：§3 的 6 处（实为 12 条）代码引用全部真实存在且内容一致，没有幻觉引用。**
唯一失真的是对"提示词如何到达模型"的机制推断（§8.4/§8.5），以及默认值数量的低估（V-8）。

### 8.4 反例与替代解释（逐条裁决）

| # | 反例 / 替代解释 | 事实核查 | 裁决 |
|---|---|---|---|
| R-1 | "工具干脆不传 `voice_type`，后端默认就是男声，不需要前端透传" | `tts_models.py:101,158` 默认确为 male = 界面缺省；路由纯透传（E-8） | **只修"从没改过设置"的场景**。用户改过设置（需求第 2 点）依然失效；且把真相源搬到 Python，前端改缺省时静默漂移。→ 不可作为最终方案，仅作 FALLBACK 同值安全网 |
| R-2 | "模型不是省略了 `voice_type`，而是**显式传了**清新女声" | `generateTts.ts:17` 参数描述明写"默认清新女声"，且音色表 female 排首位；模型对工具参数描述极敏感 | **很可能同时存在**。→ 只改工具的 `?? DEFAULT` **不足以消除症状**；改写参数描述与让工具回显实际音色必须与通路修复**同批**落地（本轮最重要的一条评审结论） |
| R-3 | "也许界面底栏显示的音色本身是错的/没保存" | `useSegmentVoiceGeneration.ts:252` 手动路径与底栏同源；§2.C 对照实验（手动转换出男声） | **否证**：UI 侧通路正确 |
| R-4 | "音色也许已经随 `editorContext` 传到服务端了" | `agentTurnContext.ts`、`editorContextPrompt.ts` 内 `voice` **零命中** | **否证** |
| R-5 | "Agent 拿到 `timelineState`，可以从时间轴推出音色" | `timelineState` 无音色字段；`AgentChatRequest` 无 `segments`（E-9） | **否证** |
| R-6 | "用户只是没点保存 / 刷新丢了" | 界面缺省（male）与工具缺省（female）本来不同值，未改设置的用户 100% 复现 | **否证**（§3.5 结论成立） |
| R-7 | "这是 TTS 后端或音色表的问题" | 同一次点击，手动「转换语音」用同一后端、同一音色 ID 出正确男声 | **否证** |
| R-8 | "只要把 `defaultVoiceId` 传下去就够了，提示词无关" | R-2（模型可能显式传 female）+ `batch` 的段级 `voice_type` 也由模型填 | **不成立**：通路与指令是同一条链的两半 |
| R-9 | "这是并发/竞态 bug" | 请求体快照 + 每请求新建 ToolContext（E-10），同回合内多次调用音色一致 | **否证**：纯配置透传缺失，非竞态 |

### 8.5 候选方案的边界 / 错误路径 / 回归审计

| 维度 | A（透传） | B（route 自查工程） | C（只改提示词+ask） | D（改工具常量） | D′（删常量+不传） | E（A+B） |
|---|---|---|---|---|---|---|
| 并发 / 重试 | ✅ 请求体快照，SSE 重试一致 | ❌ 800ms 防抖 + PUT（E-5）导致读到旧值 | ✅ | ✅ | ✅ | ⚠️ 继承 B |
| 错误路径 | ✅ 需保留两级回退（工程默认 → FALLBACK） | ⚠️ 读失败须降级，且要多一份缓存/失效 | ⚠️ YOLO 下规则失效 | ✅ | ✅ | ⚠️ |
| 边界：无 projectId | ✅ | ❌ 必须另写兜底 | ✅ | ✅ | ✅ | ⚠️ |
| 边界：非法/超长 id | ✅ route 白名单丢弃→退化 FALLBACK（E-6） | ⚠️ | — | — | — | ⚠️ |
| 边界：空串/空白 | ✅ 需 trim（E-7 后端会 422） | ⚠️ | — | — | ⚠️ 空串会 422 | ⚠️ |
| 边界：旧工程无 `defaultVoiceId` | ✅ FALLBACK = 界面缺省 | ⚠️ 落回后端默认（巧合正确） | ❌ | ✅ | ✅ | ✅ |
| YOLO 模式 | ✅ 不问，用默认 | ✅ | ❌ `ask_user` 不注册 | ✅ | ✅ | ✅ |
| 满足需求 1（与界面一致） | ✅ | ✅（近似） | ❌ | ⚠️ 仅缺省场景 | ✅ 仅缺省场景 | ✅ |
| 满足需求 2（改过也一致） | ✅ | ⚠️ 时序 | ❌ | ❌ | ❌ | ✅ |
| 满足需求 3（可咨询） | ✅（需 E-2 描述改写） | ❌ | ⚠️ 代价是每轮多一轮问答 | ❌ | ❌ | ✅ |
| 新回归风险 | ⚠️ 见下 4 条 | ⚠️ 第二真相源 | — | ⚠️ 再加一处漂移 | ⚠️ 真相源迁到 Python | ⚠️ 两者相加 |
| 工作量 | 中 | 中 | 小 | 极小 | 极小 | 大 |

**A 的回归风险与必须处理的细节（本轮审计新增）**

1. **回退短路必须改成比较"解析后的值"**：现有 `generateTts.ts:75-76` 是
   `voiceType === DEFAULT_VOICE_TYPE` 才不重试；换成解析函数后若仍与常量比较，
   会出现"显式传入的正是 FALLBACK 值 → 仍然二次请求"或"解析出 FALLBACK 却不短路"。
   正确形状：`resolved = resolveVoiceType(params.voice_type, ctx.defaultVoiceId)`；
   回退目标 `fallback = resolveVoiceType(undefined, ctx.defaultVoiceId)`；
   `if (resolved === fallback) return result;` 才重试一次 `FALLBACK_TTS_VOICE_ID`。
2. **`batch_generate_tts` 没有音色不可用回退**（对比 `generateTts.ts:75-91`，`batchGenerateTts.ts:45-54`
   只把失败原样归一化）。本 bug **不应**顺手补它（扩大表面积），但报告必须写明这条不对称，
   否则修复节点容易"顺手加"从而改变批量失败语义。
3. **顶层 `voice_type`（`batchGenerateTts.ts:95`）**改成解析值后，显式指定段不受影响
   （后端 `batch_tts_service.py:157` 段级优先），但这依赖后端语义——须在测试里钉住
   （现有 `:370-374` 正好是这条断言，改值时要把"段级优先"保留）。
4. **新增可选字段不会破坏既有测试**：`ttsTools.errorPropagation.test.ts:8-14` 用
   `as unknown as ToolContext` 构造上下文，`defaultVoiceId` 为可选 → 类型层安全；
   但**行为**会变（未注入时落 FALLBACK=male），`:63` 那条断言必然要改（V-7）。
5. **提示词预算**：任何新增 L0 文本都要过三条 `≤18 500` 断言（V-9）。因此**不建议**新增
   `## 全片默认音色` 段（`18_500 − 当前长度 ≤ 400`，而该段还要带"省略即用它"的说明与咨询规则，
   极易超限且属于"为了提示词而改提示词"的额外工作）——见 §8.6 的替代方案。

### 8.6 对 §6.2 落地清单的修订（给 Subtask #2 的唯一有效版本）

| 原清单 | 修订 |
|---|---|
| 1. 新建 `voiceDefaults.ts` + 收敛常量 | **保留**。补充：`resolveVoiceType(requested, projectDefault)` 必须 `trim()` 判空（E-7）、纯函数、并让 `ScriptPanel.tsx:58` 从它 re-export（不新增第 4 份常量） |
| 2. 前端透传（请求体 + `UseAgentExecutionParams` + 传参） | **保留**，但**删掉"补进 `sendAgentMessage` 依赖数组"**：用 `defaultVoiceIdRef`（同 `materialsRef`，`useAgentExecution.ts:185-219`）读取即可，避免无谓的 callback 重建；参数形状复刻 `useSegmentCommands.ts:63,111` + `VideoEditingInterface.tsx:2209`（E-4） |
| 3. 类型 + route 白名单 `readVoiceId` | **保留**。正则放宽为 `/^[A-Za-z0-9_.-]{1,96}$/`（E-6 实测 102 条音色全部通过，且留余量）；非法值一律 `undefined`（降级不 400） |
| 4. `agent.ts` 注入 ToolContext | **保留**（`:82-118` 加一行） |
| 5. 工具改用 `resolveVoiceType` | **保留**，但必须按 §8.5-1 修正回退短路；**不要**给 batch 新增回退（§8.5-2） |
| 6. 提示词：改写 `:170` + 新增 `## 全片默认音色` L0 段 + 咨询规则 | **改为（P0，与通路同批）**：<br>(a) 重写 `generateTts.ts:16-18` 参数描述为"省略则用本工程「全片默认音色」；用户明确指定则以用户为准"（**这是真正进上下文的载体**，E-2）；<br>(b) 在 `generateTts.ts:32` / `batchGenerateTts.ts:32` 的 description 里写"默认使用全片默认音色；仅在用户提到性别/风格/语言/年龄/情绪或抱怨音色时用 `ask_user` 问一次"（`ask_user` 会结束回合，见 V-12，故必须"默认不问"）；<br>(c) **取消**新增 L0 `## 全片默认音色` 段（预算，V-9）；当前音色改由**工具结果回显**（见下 7）；<br>(d) 顺手修 `promptParts.ts:170` 的两处错误（默认值 + 不存在的 `/api/tts/voices` → `/api/tts/voice-types`），并让它成为"潜在缺陷已消除"的记录 |
| 7. 测试 | **保留并增补**：除报告列出的 5 条外，新增 ②`resolveVoiceType` 单测（显式 > 工程默认 > FALLBACK、空白/空串、`resolved===fallback` 不二次请求）；③`readVoiceId` 白名单单测（非法/超长/合法 39 字符真实 id）；④**参数描述回归断言**：`generate_tts` 的 `voice_type` 描述不得再出现具体音色 ID（防 R-2 复发）；⑤修订 `ttsTools.errorPropagation.test.ts:63` 与 `:374` 两处 |
| 8. 验收 | **改措辞**：旧工程不是"与现在一致"，而是"与界面缺省一致（相对现状是变更）"；再加一条"`generate_tts` 的返回里能看到实际使用的音色 ID"（可观测性，见 9.1-(3)） |

**新增建议（成本≈1 行/工具，收益最大）：工具结果回显实际音色**

- `generateTts.ts:52-59` 的返回体与 `batchGenerateTts.ts:105-123`（`batchPayload`）各加一个
  `voice_type: <实际使用值>`。理由：
  1. 让模型能主动告诉用户"本次用的是全片默认音色（少年梓辛 2.0）"，**不花提示词预算**；
  2. 用户换过音色后，Agent 的行为可被一眼核对（报告 §4.3 抱怨"没有任何日志说明音色来自哪里"）；
  3. 也为将来在 `ask_user` 选项里写出具体音色名提供了事实来源。

### 8.7 复核后仍需 Subtask #2 决策的开放问题

- **Q-1（必答）**：`FALLBACK_TTS_VOICE_ID` 是否允许与后端 `tts_models.py:158` 默认值长期重复？
  建议：允许，但在 `voiceDefaults.ts` 注释里写明"后端默认仅在请求缺字段时生效，工具始终显式传值"（E-1/E-8）。
- **Q-2（建议本轮不做）**：段级 `voiceId` 覆盖对 Agent 不可见（E-9）是否需要在本轮一并解决？
  建议单独开 bug（需要把 segments 送进请求体，属于请求体契约扩张）。
- **Q-3（建议本轮不做）**：`batch_generate_tts` 补"音色不可用回退"（§8.5-2）。
- **Q-4（建议做）**：`readVoiceId` 命中非法值时是否要 `console.warn` 一次？建议要（静默丢弃会让
  "用户设了新音色但没生效"再次变成不可排查的问题）。

---

## 评审结论（Review Verdict · 第九节）

### 9.1 最终推荐修复（唯一）：方案 A′ —— 方案 A 的最小化实施版

**A′ = 通路透传（原 A 的 1–5 步，按 §8.6 修正）+ 指令同步（原第 6 步改为改写工具参数描述/描述，
不改 L0 段落）+ 结果回显实际音色（新增，1 行/工具）。三项必须在同一批改动里落地，缺任何一项都不算修好。**

**(1) 通路（P0，必要性最清楚）**

`useAgentExecution`（ref 读值）→ 请求体 `defaultVoiceId` → `route.readVoiceId` 白名单 →
`VideoEditingAgentConfig.defaultVoiceId` → `ToolContext.defaultVoiceId` →
`resolveVoiceType(用户显式 > 工程默认 > FALLBACK_TTS_VOICE_ID)` 被 `generate_tts` / `batch_generate_tts` 共同调用。
单一前端常量模块（`voiceDefaults.ts`），`ScriptPanel.tsx:58` 从它 re-export。

**(2) 指令（P0，与 (1) 同优先级 —— 这是本次评审推翻报告优先级的唯一一处）**

改写 `generateTts.ts:16-18` 的参数描述（不再出现"默认清新女声"这种陈述式事实），并在两个工具的
description 里加入"默认用全片默认音色；仅在用户提到性别/风格/语言/年龄/情绪或抱怨音色时
`ask_user` 问一次；YOLO 下不问"。**理由（R-2 + E-2）**：真正每一轮进模型的是参数描述而不是
`promptParts.ts:170`；若只修通路不修描述，模型仍会显式传 `zh_female_qingxinnvsheng_uranus_bigtts`，
症状不会消失——这一条如果不做，(1) 做得再对，用户看到的仍是女声。

**(3) 可解释（P1，1 行/工具）**

工具返回体带 `voice_type` 实际值，让模型/用户/日志都能确认"这一次到底用了哪个音色"。

**明确不做（防止扩大表面积）**：不新增 L0 `## 全片默认音色` 段（预算见 V-9）；不给
`batch_generate_tts` 新增音色回退（§8.5-2）；不把 segments 送进请求体（E-9）；不在 route 侧
二次读工程数据（B 的时序风险，E-5）。

### 9.2 为什么不是 B / C / D / E

| 方案 | 一句话否决理由 |
|---|---|
| **B**（route 自查工程） | `useProjectAutosave.ts:38` 的 800ms 防抖 + 异步 PUT（E-5）会让"刚改完音色立刻提问"读到旧值；且引入第二真相源与一套缓存失效逻辑，违反"唯一真相源" |
| **C**（只改提示词/强制 ask） | 模型仍不知道界面默认音色；`ask_user` 直接结束回合（V-12）→ 每次配音多一轮问答；YOLO 下 `ask_user` 不注册（`agent.ts:122-128`）→ 完全失效 |
| **D**（改工具常量） | 只对齐缺省场景（需求 2 失效），且**不改参数描述就不会改变模型显式传 female 的行为**（R-2）→ 很可能"改了也没效果"；还把默认值复制到第 4 处 |
| **D′**（删常量+不传，靠后端默认） | 与 D 同样只覆盖缺省场景，并把真相源迁到 `tts_models.py:158`，前端改缺省时静默漂移 |
| **E**（A+B） | 多出的 B 只带来时序风险与缓存复杂度，没有多覆盖任何需求 |

### 9.3 对"证据链是否严密"的最终判定

- **成立且严密的部分**：症状 → 请求体缺字段 → 类型层缺字段 → ToolContext 缺字段 → 工具落硬编码常量。
  12 条代码引用全部复核一致（§8.3），关键零命中可复现（V-1/V-2）。
- **本次评审修掉的三处不严密**：①§3.6 的"提示词如何到达模型"机制错误（§8.2 E-2/E-3）；
  ②默认值数量低估（3 → 13，§8.2 E-1）；③提示词预算上限用错（18 900 → 18 500，V-9）。
- **修复方向**：A 的骨架正确，但**把"提示词/描述"从第 6 步的前置条件改为与通路同批的 P0**，
  并去掉 L0 新增段落、增加工具结果回显。改完即满足 Definition of Done：证据链封闭、单一推荐方案明确。

### 9.4 一句话结论

> **采用方案 A′**：把 `defaultVoiceId` 沿既有"请求体 → route 白名单 → ToolContext"通路透传，
> 在唯一的前端常量模块里实现 `resolveVoiceType(显式 > 工程默认 > FALLBACK)`，**同时**改写
> `generate_tts` 的参数描述与两个 TTS 工具的描述（让模型默认省略音色、仅在必要时 `ask_user` 问一次），
> 并让工具结果回显实际音色；不新增 L0 提示词段、不在服务端二次读工程、不给批量加音色回退。

---

## 实施过程发现的方案缺陷（Subtask #2，2026-06-29）

> 方案 A′ 的**方向与三块内容（通路 / 指令 / 回显）全部按原文落地**，下面 4 条是落地过程中发现的
> 表述或位置缺陷，均已按修正后的做法实施，不影响根因结论与验收标准。

1. **`VideoEditingInterface.tsx` 的传参点写错了变量（TS 编译期实测）**

   - 原文（§8.6 第 2 步 / §9.1(1)）：`useAgentExecution({ … defaultVoiceId: workbench.defaultVoiceId … })`。
   - 实测：`workbench`（`useWorkbenchWiring` 的返回值）在 `:2011` 的 `useAgentExecution` **之后**
     才声明（`getDefaultVoiceId` 的注入点在 `:2209`），直接读它报
     `TS2448 Block-scoped variable 'workbench' used before its declaration` /
     `TS2454 Variable 'workbench' is used before being assigned`。
   - 修正：改用同源等价值 `defaultVoiceId: content?.defaultVoiceId ?? DEFAULT_VOICE_ID` ——
     `workbench.defaultVoiceId` 就是 `content?.defaultVoiceId`（`useWorkbenchWiring.ts:196`），
     而 `:2209` 的 `getDefaultVoiceId` 也正是这一表达式，所以"界面显示 / 手动转换语音 / Agent TTS"
     仍然是同一个值，评审要求的"同源同值"没有打折。

2. **`readVoiceId` 不能放在 `route.ts`（Next App Router 的导出白名单）**

   - 原文（§8.6 第 3 步 / §9.1(1)）：在 `chat/route.ts` 新增 `readVoiceId`；§8.6 第 7 步又要求
     为它写白名单单测。
   - 冲突：`route.ts` 只允许导出 HTTP 方法与少量路由字段（多导出会得到
     `is not a valid Route export field` 的类型错误），导出纯函数做单测会破坏构建；
     不导出则无法单测。仓库里 `resolveTurnPrompt` 被抽到 `./turnPrompt.ts` 正是同一处境的既有解法。
   - 修正：把 `readVoiceId` 放进新的 `src/lib/video-editing-agent/voiceDefaults.ts`（与
     `resolveVoiceType` 同一模块 = "音色 id 规则"的单一来源），`route.ts` 只 import 调用，
     白名单单测写在 `__tests__/voiceDefaults.test.ts`。

3. **批量工具的"回显音色"语义需要收窄**

   - 原文（§8.6 新增建议）：`batchGenerateTts.ts` 的返回体加 `voice_type: <实际使用值>`。
   - 问题：一批里的段落可以逐段指定不同音色，单个 `voice_type` 无法表示"整批实际使用的音色"。
   - 修正：字段语义明确为「本批未逐段指定时的实际音色」，即 `resolveVoiceType(undefined, defaultVoiceId)`
     的结果，并在 `TtsBatchToolResult.voice_type` 的类型注释里写明；逐段音色仍由 `results[]` 的
     `input_index` 对应关系表达（未改动该结构）。

4. **`readVoiceId` 的告警范围**：只对"脏值"（非法字符 / 超长）`console.warn`；空串、纯空白、
   非字符串按"没带这个字段"处理并静默降级——旧客户端不带该字段、`undefined` 都是正常情况，
   每次都告警会把日志刷满（§8.7 Q-4 的"要告警"只针对"看起来像音色却不可用"的值）。

**实施结果对照（用于验收）**

| 项 | 结果 |
|---|---|
| §2.A 复现用例（`_repro.tts-default-voice.test.ts` 原样重跑） | 修前 2 断言红 → 修后 2 断言绿 |
| 回归测试 | 新增 `ttsTools.defaultVoice.test.ts`（9 例）、`voiceDefaults.test.ts`（16 例）；`ttsTools.errorPropagation.test.ts` 的兜底常量改为引用 `FALLBACK_TTS_VOICE_ID` |
| `npx vitest run src/lib/video-editing-agent` | 83 文件 / 818 例全绿 |
| `npm run type-check` | 通过 |
| L0 提示词长度（`18 500` 断言） | 16 129–16 222 字符，仍有余量（新增文本只落在工具描述，未新增 L0 段落） |


