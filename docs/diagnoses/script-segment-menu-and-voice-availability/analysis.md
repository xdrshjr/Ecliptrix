# 脚本段落卡片更多菜单与配音功能可用性诊断

诊断日期：2026-11-20（America/New_York）。取证基线：`12e8474c`。
前序节点交付问题定位、复现材料与修复建议；本次方案 A 实施结果见文末“方案 A 实施与验收”。未执行提交。

## 问题描述

用户要求解说脚本的每张段落卡片满足以下行为：

1. “更多操作”三点按钮位于卡片右上角、时长显示右侧。
2. 菜单优先向右弹出，完整可见，不被左侧区域或应用侧栏覆盖。
3. 只要对应段落已有生成的配音，无论人工还是 Agent 生成，相关功能都应识别这一事实。

当前确认有三处独立原因：按钮挂在底部操作行；定位算法将菜单右边缘对齐按钮，导致菜单向左展开；部分操作使用仅由人工生成回调更新的组件内集合判断配音是否存在，绕过了现有共享音频派生状态。

菜单覆盖具有布局触发条件，并非每次打开都被遮挡。浏览器中默认 320px 面板、无额外操作按钮时未覆盖侧栏；280px 面板、旧配音导致出现“更新本段配音”按钮并换行时，已稳定复现。

## 复现步骤

### 无凭证的自动化最小复现

在已经安装本仓库 npm 依赖的 PowerShell 中执行：

```powershell
Set-Location M:/takoAI/Ecliptrix
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/script-segment-menu-and-voice-availability/vitest.repro.config.ts --reporter verbose --no-color
```

入口为同目录的 `repro.test.tsx`，使用真实 `ScriptPanel`、段落关联 hook、Agent TTS 工具、事件路由和素材仓库。仅模拟外部 HTTP 返回，不调用收费模型、TTS 服务或真实下载。

前序诊断节点运行退出码为 0，5 个取证用例全部通过，耗时 19.84 秒。这里的“通过”表示**成功断言当前缺陷存在**，并不表示已修复。完整输出见 [repro-output.txt](repro-output.txt)；本次评审独立复核的结果另见文末。

| 用例 | 实测结果 |
|---|---|
| 卡片按钮归属 | 更多按钮在 `.segment-card__actions`，不在 `.segment-card__head` |
| 菜单定位 | 模拟按钮横向范围 `[188,220]`、菜单宽 232 时，实际菜单 `left=8px`；Portal 目标为 `.editor-workbench` |
| 无配音负向对照 | 显示“未生成配音”，AI 匹配禁用并提示先完成语音转换 |
| Agent 完整前端链路 | TTS 成功、素材带正确段 ID、卡片显示“配音已生成”，更换画面及 AI 匹配仍禁用 |
| 面板重新挂载 | 配音素材仍在仓库，重新挂载后仍出现上述错误禁用 |

核心日志原文：

```text
更多按钮所在区域=segment-card__actions；卡头包含更多按钮=false
按钮=[188,220]；菜单宽=232；菜单left=8；Portal=editor-workbench
配音状态=已生成；更换画面=禁用；AI匹配=禁用；提示=请先完成语音转换
Test Files  1 passed (1)
     Tests  5 passed (5)
```

用例不会自动加入项目默认测试集，也不会写入真实工程数据。它会在本目录生成 `repro-menu.html`：真实组件 DOM 的静态快照，加载仓库原始 CSS，并从源码提取真实 `placeMenu` 函数，在浏览器中重新计算真实坐标。

### 浏览器最小复现：菜单遮挡

先运行上面的命令生成快照，再执行：

```powershell
Start-Process 'M:/takoAI/Ecliptrix/docs/diagnoses/script-segment-menu-and-voice-availability/repro-menu.html'
```

页面固定使用受支持的最小脚本面板宽度 280px，并设置一个仍有旧配音、文案已变化的段落，使真实组件出现“更新本段配音”。菜单默认打开；再次点击三点按钮可重算位置。

在浏览器开发者工具控制台粘贴：

```javascript
const menu = document.querySelector('[role="menu"]');
const sidebar = document.querySelector('.vertical-taskbar');
const rect = menu.getBoundingClientRect();
const hit = document.elementFromPoint(rect.left + 4, rect.top + 14);
console.log({
  menuLeft: rect.left,
  menuZ: getComputedStyle(menu).zIndex,
  sidebarZ: getComputedStyle(sidebar).zIndex,
  coveredBySidebar: sidebar.contains(hit)
});
```

本次 ego-browser 的 Chromium 实测输出：

```text
面板宽度=280
按钮水平范围=[177.71,209.71]
菜单水平范围=[8,240.00]
侧栏水平范围=[0,48.00]
menuZIndex=80；sidebarZIndex=100
取样点=(12,349.46)
elementFromPoint.className=vertical-taskbar
coveredBySidebar=true
```

原始数值见 [browser-observations.json](browser-observations.json)，截图见 [menu-overlap.png](menu-overlap.png)。同一 JSON 保留了 320px 无额外按钮的对照，`coveredBySidebar=false`；两次观测的宽度和配音状态不同，不能据此单独归因于宽度。

该页面用于隔离组件布局和 CSS 层叠，不是完整桌面端到端运行。它未加载 Tailwind 编译产物，仅补充必要的页面布局，因此最终修复仍需在桌面工作台验收；按钮位置、方向算法和层级冲突另有真实组件测试及源码证据支撑。

### 完整工作台人工复现路径

已配置开发环境时，可按 `README.md` 的桌面开发方式启动：

```powershell
Set-Location M:/takoAI/Ecliptrix
npm --prefix desktop run dev
```

1. 打开视频编辑任务，在“文案 / 脚本”的解说页生成或填写一个真实段落，保留稳定段 ID。
2. 观察三点按钮：当前位于“试听 / 更换画面”同一操作行，不在卡头时长右侧。
3. 在 Agent 中要求为该段完整旁白生成配音，并传入对应 `segment_id`；等待成功并看到素材入库、卡片显示“配音已生成”。
4. 悬停“更换画面”，再打开三点菜单悬停“为本段找画面（AI 匹配）”：仍分别显示先生成本段配音、请先完成语音转换的提示。
5. 要把后续 AI 匹配本身也作为验收对象，另外准备未占用且已有分析结果的视频素材；否则它在配音识别修复后仍应因缺少素材或分析能力而禁用，并显示真正原因。
6. 单独复现遮挡时，把脚本面板拖到最小宽度 280px。对已有配音的段落修改旁白，使卡片显示“配音待更新”和“更新本段配音”，再打开更多菜单；底部操作行换行后菜单可能进入应用侧栏下方。具体位置受语言、字体和显示比例影响。
7. 保存后重新打开工程，检查保留的音频能否使上述操作恢复可用。自动化已验证保留素材后的重新挂载；本次未进行真实工程保存、应用重启或真实服务合成。

## 根因分析

### 1. 三点按钮被定义在底部操作行

`src/components/video/components/SegmentCard/SegmentCard.tsx:113` 的 `SegmentCardHeader` 在时长节点后直接结束：时长位于第 162 行，卡头结束于第 168 行。

同文件 `:172` 的 `SegmentCardActionsRow` 包含试听、更换画面和更多菜单，实际菜单调用位于 `:214`：

```tsx
<SegmentMoreMenu items={menuItems} label={copy.more} />
```

`SegmentCard` 分别在 `:274` 和 `:292` 渲染卡头和操作行。因此问题来自组件结构，单改图标外观或菜单 CSS 不能把按钮移至时长右侧。

`src/styles/editor-workbench.css:1239` 对操作行启用了 `flex-wrap: wrap`。额外的“更新配音”操作或较长文案会进一步改变三点按钮所在行及其横坐标。

### 2. 菜单方向错误，覆盖来自层级冲突而非缺少 Portal

`src/components/video/components/SegmentCard/SegmentMoreMenu.tsx:39` 的 `placeMenu`：

```tsx
const left = Math.max(VIEWPORT_MARGIN, trigger.right - width);
```

这会将菜单右边缘对齐按钮右边缘，让 232px 菜单主要向按钮左侧展开。第 42 行仅检查视口左边缘，没有检查工作台左边界或应用侧栏；也没有横向右侧溢出处理。第 43–45 行只处理下方空间不足时向上翻转。

同文件 `:32` 的 `resolvePortalRoot` 已返回最近的 `.editor-workbench`，`:157` 使用 `createPortal`，`:165` 设置 `position: fixed`。菜单的 DOM 已脱离卡片列表和脚本区域；把问题笼统归为“没有 Portal、被脚本列表 overflow 裁剪”与当前实现不符。隔离页面证实的是侧栏覆盖，不代表已经排除完整桌面祖先的裁剪或层叠影响，详见评审补充。

真实覆盖链路为：

1. 按钮处在左侧底部操作行，换行后横坐标靠左。
2. `trigger.right - 232` 小于视口边距，于是菜单被放在 `left=8px`。
3. 应用侧栏占据 `[0,48]`，与菜单重叠约 40px。
4. `src/styles/globals.css:299` 的 `.vertical-taskbar` 为定位元素，`:306` 设置 `z-index:100`；`src/styles/editor-workbench.css:499` 的 `.ws-menu` 在 `:507` 设置 `z-index:80`。
5. 浏览器命中测试直接返回 `.vertical-taskbar`，确认重叠部分被侧栏覆盖。

`src/components/video/workbench/layoutPrefs.ts:38` 的 `LEFT_MIN=280` 说明取证使用的脚本宽度处于产品支持范围。

### 3. 操作可用性与“配音已生成”读取了不同的数据源

`src/components/video/ScriptPanel.tsx:186`：

```tsx
const [completedSegments, setCompletedSegments] = useState<Set<string>>(new Set());
```

全文件唯一写入发生在 `:1370` 的人工配音 hook 回调：

```tsx
onVoiceGenerated: (segmentId, results) => {
  setSentenceTimingInfo(prev => ({ ...prev, [segmentId]: results }));
  setCompletedSegments(prev => new Set([...Array.from(prev), segmentId]));
},
```

但三个地方把该临时集合当作段落是否已有配音的真值：

| 消费点 | 源码位置 | 实际作用 |
|---|---|---|
| `handleOpenVideoSearch` | `ScriptPanel.tsx:1054`，判断在 `:1056` | 即使修好按钮禁用状态，未同步修改此处仍会提前返回 |
| `replaceVisualBlockReason` | `ScriptPanel.tsx:1543`，判断在 `:1545` | 更换画面和空画面缩略图被错误禁用 |
| `aiMatchBlockReason` | `ScriptPanel.tsx:1548`，判断在 `:1549` | AI 匹配首先返回“请先完成语音转换” |

AI 匹配菜单在 `src/components/video/components/SegmentCard/SegmentCardList.tsx:89` 读取阻止原因，于 `:103` 设置 `disabled`。菜单在 `SegmentMoreMenu.tsx:182`、`:184` 将该值映射到禁用状态和鼠标提示，与用户症状一致。

Agent 路径已经正确产生可关联音频：

- `src/lib/video-editing-agent/tools/ttsResponse.ts:29` 的 `segmentVoiceMetadata` 写入 `segment_id`、文案 hash、时间戳、音色和语速。
- `src/lib/video-editing-agent/tools/generateTts.ts:57` 创建音频，`:58` 盖章，`:61` 记录 `add_material`。
- `src/lib/video-editing-agent/tools/batchGenerateTts.ts:72` 为成功项盖章，`:82` 记录 `add_materials`，故批量同样受此集合判断影响。
- `src/lib/video-editing-agent/AgentEventRouter.ts:580` 的 `handleMaterialOperation` 在 `:584`、`:588` 将单个或批量音频写入共享素材仓库；没有调用 ScriptPanel 的人工生成回调。

正确工作的共享派生链路则是：

- `src/components/video/lib/segments/segmentLinks.ts:213` 的 `findLatestVoiceMaterial` 按音频类型和 `metadata.segment_id` 查找本段音频。
- `src/components/video/hooks/useSegmentLinks.ts:95` 把它放入 `latestVoiceById`；hook 在 `:129`、`:133` 依赖素材和段落重新派生。
- `segmentLinks.ts:355` 的 `deriveSegmentStatus` 在 `:364` 读取关联配音，在 `:372` 判定 `ready` 或 `stale`，供“配音已生成 / 待更新”标签展示。
- `SegmentCardList.tsx:189` 的试听可用性已经读取 `latestVoice`，与两项错误禁用操作形成直接对照。

所以即使共享状态已看到 Agent 配音，局部集合仍为空，便出现“标签显示配音已生成、功能却要求先转换”的矛盾。并非音频生成失败，也并非缺少段 ID 的必然结果；自动化使用正确 ID 和真实操作路由仍复现。

### 4. 集合生命周期还会造成恢复与失效问题

集合初始化为空，未从已有音频恢复。保留素材后重新挂载的用例已证实错误禁用；人工生成后重新进入面板也会遇到相同机制，这是基于初始化与唯一写入位置的推论，本次未运行真实人工合成后重启应用。

反方向也有风险：局部集合只增加、不随素材删除或关联变化派生，曾经人工生成的段落可能在音频已不存在时仍被视为“完成”。另外，`useSegmentVoiceGeneration.ts:218` 在 `:224` 下载及 `:230` 素材入库之前就调用完成回调，后续下载失败也可能留下完成标志。两者是源码支持的相关风险，本次未新增专项运行用例。

## 影响面

| 用户 / 功能 | 影响 |
|---|---|
| 所有解说段落卡片 | 三点按钮位置与要求不符；操作行增多时更易换行 |
| 靠左的菜单触发按钮 | 左向展开进入侧栏范围时，文字和点击区域被覆盖 |
| Agent 单段及批量配音 | 音频已关联入库，仍错误禁用更换画面和 AI 匹配 |
| 已有音频的面板恢复 | 共享素材保留，组件局部完成记录丢失；重新挂载已复现 |
| 人工生成当前会话 | 通过回调通常能够解锁；但临时集合存在失效风险 |
| AI 匹配的真实前置条件 | 当前配音错误提示遮住缺少分析能力、无可用已分析视频、正在匹配等后续原因 |

没有证据说明音频字节、TTS 后端、预览合成或导出引擎因这两个 UI 问题损坏。本次不把字幕时序展示等相邻功能扩展为已证实缺陷。

## 候选修复方案

下列是覆盖全部用户要求的三套组合方案；工作量为相对估计。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| A：复用既有组件和共享派生音频（推荐） | 更多按钮移到卡头时长右侧；保留 Portal、修改定位为优先右侧并处理边界；三个配音门禁统一读取段落关联音频 | 小，主要为卡片、菜单、ScriptPanel | 低；需保留键盘交互和 AI 匹配其他前置条件，并验证音频移除后的收敛 | 小到中 |
| B：同步局部完成集合 | 完成相同菜单调整；监听素材变化或 Agent 事件补写 `completedSegments`，并补工程恢复、删除、失败等同步 | 中，新增第二套状态维护 | 中到高；事件丢失、局部状态过期、首次恢复与删除分支容易漏；若用 effect 全量同步也有额外状态更新和中间态 | 中 |
| C：抽取统一浮层及操作能力层 | 新增或迁移通用弹层、操作能力模型，统一所有相关菜单与生成来源 | 大，涉及公共组件及更多消费者 | 高；容易引入与本次无关的主题、焦点、层级和 API 变更 | 大 |

## 推荐修复及理由

选择 **A**。现有 `SegmentLinksContext` 已经声明它是唯一段落派生来源，音频盖章、Agent 入库和试听都已经使用它，缺失的是部分旧门禁的迁移。再次让 Agent 模拟人工回调只会保留同类同步问题。

建议实现边界如下：

1. 在 `SegmentCardHeader` 的时长后渲染唯一的 `SegmentMoreMenu`，从 `SegmentCardActionsRow` 移除。菜单触发按钮应与卡头展开按钮互为兄弟节点，避免嵌套 button，也避免点击菜单同时展开卡片。
2. 定位优先放在按钮右侧，例如以 `trigger.right + MENU_GAP` 为首选横坐标；右侧不足时才翻转或约束到可见工作台范围。保留固定定位和现有 Portal，继续处理滚动、resize、底部空间不足，并为菜单高于可用空间提供最大高度及内部滚动。
3. 右侧展开后通常无需覆盖应用侧栏；若 fallback 会接近侧栏，应检查工作台可见边界。单纯提高 `z-index` 无法满足按钮位置和向右展开要求，不应作为完整方案；也不能为了出界显示而去掉脚本列表滚动或全局 overflow。
4. 从共享 `latestVoiceById` 等已有派生信息确认该段是否已有真实关联配音，替换 `completedSegments` 的三个消费点。可用音频与是否在本组件手动生成无关；不要只去掉菜单的 `disabled` 而遗留搜索函数内的提前返回。
5. 将“音频已存在”与“文案 / 音色已过期”分开处理。用户要求已转换的段落可使用相应功能，不应简单把 `status.voice === 'ready'` 当成唯一依据而重新锁住有旧配音的段落；保留已有“配音待更新”提示和更新动作。无关联音频的段落仍需阻止，不能仅凭 `segment.duration`、文件名或别的段落音频推断完成。
6. 保留关键词生成中、缺少分析能力、无可用已分析视频、正在匹配等既有门禁，让它们在语音条件满足后显示各自真实原因。
7. 检查解锁后的匹配时长来源。当前人工流程在 `useSegmentVoiceGeneration.ts:231` 写入段落时长，Agent 工具在 `generateTts.ts:180` 写入音频素材时长；`ScriptPanel.tsx:967` 却直接传 `segment.duration`。可复用 `segmentLinks.ts:403` 的 `resolveSegmentDuration` 获取当前适用时长，避免只解锁按钮后丢失时长约束；本项是实施时应验证的相邻差异，不是本次禁用提示的直接根因。不要为没有逐句时序的 Agent 音频伪造句子时间。

后续实现的验收至少包括：人工单段 / 批量与 Agent 单段 / 批量均可解锁；已有配音恢复后可用；删除配音后状态正确收敛；仍有旧配音时保留过期提示；无配音时仍禁用；AI 匹配保留真实其他前置条件；280px、320px 面板和中英文下按钮均在时长右侧；菜单优先向右、无侧栏遮挡；滚动、窗口变化、靠近底部、Esc 关闭与返回焦点、方向键导航保持有效。

## 本节点验证范围与交付

- 已读取 `README.md`、`CLAUDE.md` 和项目索引，核对相关卡片、面板、音频工具、事件路由与共享派生模块。
- 独立诊断用例最新结果：1 个文件、5 个用例通过；断言的是当前症状。
- 已用 ego-browser 在 Chromium 内测量真实布局坐标、CSS 层级及命中元素，并查看截图；浏览器任务空间已关闭。
- 未运行收费服务、真实音频试听、真实项目重启或完整桌面验收；未作业务修复，因此没有执行全项目构建或宣称修复通过。
- 工作区原有其他模块的未提交改动已保留。本次业务源码未改动；新增交付均在本诊断目录，任务运行材料在指定 `.agentmesh` 任务目录内。

复现材料：`repro.test.tsx`、`vitest.repro.config.ts`、`repro-output.txt`、`repro-menu.html`、`browser-inspect.mjs`、`browser-observations.json`、`menu-overlap.png`。

## 评审补充证据与边界

评审日期：2026-11-20（America/New_York）。本节为分析报告评审节点的新增取证；仅修订本报告，未修改业务源码、测试或前序取证材料，未执行 `git commit`。

### 1. 确认被引用的组件与数据源确实位于真实执行路径

真实工作台并非直接将 Zustand 素材数组交给脚本面板，中间还存在素材管理 hook。前序复现的 `ConnectedPanel` 直接订阅仓库，验证了核心因果，但不能单凭它宣称完整生产接线已动态覆盖。补充源码链路如下：

| 环节 | 代码证据 | 对根因的意义 |
|---|---|---|
| Agent 结果路由 | `AgentEventRouter.ts:317` 先调用 `filterCurrentSegmentOperation`，`:330` 进入素材分支，`:333` 调用 `handleMaterialOperation` | 引用的入库方法确实被工具结果处理路径调用，并非未使用代码 |
| 仓库更新 | `src/stores/slices/materialSlice.ts:49`、`:58` 为单个 / 批量新增创建新的素材数组 | 成功音频能够触发订阅方重渲染 |
| 仓库到工作台的桥接 | `src/components/video/hooks/useMaterialManagement.ts:103` 订阅仓库，`:105` 的 effect 将尚未合并的新素材加入本地数组，`:655` 返回为 `allMaterials` | 单段和批量 Agent 新音频均进入工作台；存在 effect 调度间隔，不应在入库同一调用栈就断言界面已更新 |
| 唯一共享派生 | `VideoEditingInterface.tsx:2203` 用 `editorSegments` 和 `allMaterials` 调用 `useSegmentLinks`，`:2218` 提供 `SegmentLinksContext` | 方案 A 可以直接消费已经存在的派生结果，无需再订阅 Agent 事件或再调用一次 hook |
| 人工配音和面板接线 | 同文件 `:2233` 渲染真实 `ScriptPanel`，`:2239` 将人工入库接至 `addOrReplaceMaterial`，`:2242` 传相同 `allMaterials` | `useMaterialManagement.ts:449`、`:470` 的人工入库直接更新本地数组；若只读 Zustand 原始数组，会漏掉部分人工音频 |
| 卡片与门禁消费 | `ScriptPanel.tsx:161` 读取共享 context；`SegmentCardList.tsx:164`、`:189` 用 `latestVoiceById` 控制试听，`:211` 重建菜单 | 真实 UI 已能识别共享音频，剩下三个旧集合门禁足以解释标签与功能矛盾 |

因此，**应读取 `segmentLinks.latestVoiceById`，不能把方案 A 偷换成只读 `useVideoEditingStore.getState().materials`**。真实接线已由源码核实；本次仍未启动完整桌面环境。

### 2. 配音门禁的反例、并发与失败分支

- **工具成功不等于本段已有音频。** `ttsResponse.ts:14` 的 `prepareSegmentVoice` 在缺省 `segment_id` 时允许普通 TTS，但 `:29` 的 `segmentVoiceMetadata` 不会为其盖段落章；传入不存在 ID 或不匹配的全文则返回失败。`findLatestVoiceMaterial`（`segmentLinks.ts:213`）要求 `type === 'audio'` 且 `metadata.segment_id` 精确相等。其他段落音频、未关联普通音频、仅有历史 `duration` 都不能解锁；不能按文件名猜测关联。本缺陷在正确关联条件下仍可复现，不需要修改 TTS 关联协议。
- **批量仅为成功项解锁。** `batchGenerateTts.ts:45` 按各项稳定脚本 ID 保存请求快照，`:65` 过滤已删除段落的迟到结果，`:72` 只把规范化成功项映射为素材，`:82` 记录 `add_materials`。失败项只有失败结果，不产生关联素材。不得依据批次顶层 `success` 一次解锁所有段落，也不能把返回结果中的批次请求 ID 当作脚本 ID。
- **文案过期和生成中都不等于没有音频。** `segmentLinks.ts:364` 找出 `latest`，但 `:372` 优先标记 `generating`，随后判断时间轴当前音频或最新素材是否 `stale`。以 `status.voice === 'ready'` 代替旧集合，会重新锁住已有旧配音、或重配期间仍有旧音频的段落。存在性门禁应只依据共享映射；保留原有生成按钮忙碌状态、过期提示及 AI 匹配其他条件，不借本次修复放宽“应用新配音”等独立命令的约束。
- **下载失败不能凭回调解锁。** 人工 `useSegmentVoiceGeneration.ts:218` 先通知逐句时序，`:224` 才下载，`:230` 才入库；下载抛错时没有新素材。保留 `onVoiceGenerated` 对逐句时序的用途，只移除其中对完成集合的写入及集合声明。若没有旧关联音频，失败后继续禁用；若有旧配音，失败不应使旧配音失效。
- **删除要看剩余版本。** `findLatestVoiceMaterial` 根据 `segment_assigned_at` 找当前剩余素材中的最新版本，缺少时间戳按现有规则处理。删除最新版本而仍有旧版本时仍可用；最后一个本段音频从 `allMaterials` 移除后才重新禁用。不要引入“曾经成功过”的缓存，也不要改写现有版本排序或候选应用逻辑。
- **两个素材容器不能混为一谈。** 正常素材面板删除在 `useMaterialManagement.ts:273`、`:279` 同时更新仓库与本地列表；`:104` 的已合并 ID 集合防止删除项被后续 Agent 新增带回。其桥接 effect 只追加新 ID，不能据此承诺任意直接 `store.removeMaterial` / 同 ID 更新都会同步到 `allMaterials`。本次删除验收使用真实素材管理入口；更改全局素材同步机制属于独立问题，不能暗中扩大方案 A。
- **闭包必须同时更新。** `handleOpenVideoSearch` 的依赖数组在 `ScriptPanel.tsx:1155` 仍包含 `completedSegments`。替换函数体时必须将依赖迁移到共享映射或依赖正确的统一存在性谓词，否则会出现按钮已解锁、点击仍返回，或删除后继续使用旧映射。`handleAIMatchVideos` 如使用共享派生时长，也需更新 `:1040` 的依赖数组。

Agent 段落删除的实时保护也已存在：`AgentEventRouter.ts:563` 使用前端当前段落过滤单个 / 批量素材，`:318` 在实际应用前调用它。保留这些校验；无需为了本次 UI 门禁再增加一套事件驱动的“完成”记录。

### 3. 布局证据的强度与定位方案的遗漏

已复核前序 `browser-observations.json` 和 `menu-overlap.png`：280px / 旧配音场景的菜单从 `x=8` 开始，侧栏结束于约 `x=48`，截图确实缺失左侧文字，命中记录为 `vertical-taskbar`。320px 对照同时改变了配音状态和按钮数量，因此只能证明“并非必然遮挡”，不能宣称 280px 是唯一临界值。截屏未包含 Tailwind 产物和完整桌面祖先，具体触发宽度仍需集成验收。

进一步核对真实结构：`src/app/page.tsx:160` 的侧栏与 `:169` 的工作区为兄弟；工作区、`VideoEditingInterface.tsx:2220` 的外层及 `editor-workbench.css:47` 均保留溢出约束。`EditorWorkbench.tsx:88` 的工作台包围主内容，菜单 Portal 的宿主在主内容外。因此局部列表的 overflow 不是这次已证实覆盖的直接原因，但仍应在真实 DOM 检查 fixed 定位的包含块和层叠关系，不能仅凭 `80 < 100` 推断任意祖先结构下都能或不能遮挡。

方案 A 必须补齐以下局部边界，不能仅把减号改为加号：

1. 横向可用区取**视口与整个工作台可见矩形的交集**，使用 `getBoundingClientRect()` 的同一坐标系。先尝试 `trigger.right + MENU_GAP`；空间不足时左翻或夹取，最后仍不能越过工作台左边界进入应用侧栏。边界不能取 280px 脚本列本身，否则向右菜单会被重新挤回左侧。宿主回退到 `document.body` 时使用视口边界。
2. 菜单高度随菜单项变化。`SegmentCardList.tsx:84` 的命令 context 会增加菜单项，`segmentMenuExtras.ts:47` 可再生成多个音频版本项；前序复现没有提供命令 context，不能代表最长菜单。仅靠 `placeMenu` 向上翻转无法容纳高于窗口的菜单；应在组件局部设置可用最大高度与内部滚动，并保留必要的宽度约束。不调整全局 `.ws-menu` 的层级或所有菜单样式。
3. 当前 `SegmentMoreMenu.tsx:76` 的定位 effect 仅依赖 `[isOpen]`，监听窗口 resize / 捕获 scroll。菜单打开时 Agent 入库会改变版本项数量，拖动脚本分隔条也可能移动触发按钮而不触发 window resize。应在打开期间对实际尺寸 / 锚点布局变化重定位（例如局部尺寸观察并清理），不能无条件依赖每次 render 创建的新 `items` 数组而造成重复布局更新。菜单关闭或组件卸载后移除监听；锚点不可见 / 移除时不能留下可操作的悬空菜单。
4. 移到卡头后，触发按钮必须是展开按钮的兄弟，只保留一份菜单；维持长标题省略、时长和图标不挤出卡片。`SegmentCard.tsx:15` 的交互元素过滤和 `SegmentMoreMenu.tsx:128` 的 Esc 消费继续有效。动态禁用或移除已聚焦菜单项时，应仍能用方向键导航；打开、关闭和返回焦点行为不能退化。不要因按钮位置变化重写整套卡片选择模型。

### 4. 三套方案复审与时长取舍

| 方案 | 边界复审 | 结论 |
|---|---|---|
| A：复用共享派生 | 在每次 `allMaterials` 更新后的渲染中读取现有映射；自然覆盖人工 / Agent、恢复、失败无新增素材与剩余版本；仍需修正回调依赖和局部浮层边界 | 最小充分方案，采用 |
| B：同步完成集合 | 只补 Agent 成功事件会漏人工下载失败、恢复、删除和迟到事件；若再完整维护生命周期，等于复制共享派生；effect 同步还增加一次状态更新和中间态 | 无必要的第二份真值，拒绝 |
| C：统一公共浮层 / 能力模型 | 即使公共层正确，也必须先解决本段素材存在性；迁移主题、Portal、焦点与其他调用者扩大回归范围，未发现本缺陷需要新公共抽象的证据 | 超出必要改动，拒绝 |

时长问题不是“先完成语音转换”提示的根因，但它直接影响解锁后的 AI 匹配，应在同一调用点收敛：`ScriptPanel.tsx:967` 将 `segment.duration` 传给 `useVideoAIMatch.ts:86`，后者原样传给匹配服务；Agent 仅写音频素材时长，人工则写段落字段。最终方案在该处复用 `resolveSegmentDuration(segment, segmentRange, latestVoice)`，保持既有“时间轴范围 → 段落字段 → 音频时长”的优先级，无值时仍传 `undefined`。这是一处消费者参数修正，不改变共享 helper、时间轴或 TTS 数据结构；不要把未应用候选的时长强行覆盖已有时间轴。现有 `segmentLinks.test.ts:153` 已锁定该优先级。

### 5. 本次独立验证记录

为遵守仅修改 `analysis.md` 的限制，本次未重跑会改写 `repro-menu.html` 的用例；保留前序全部原始材料。实际执行：

```powershell
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/script-segment-menu-and-voice-availability/vitest.repro.config.ts --reporter verbose --no-color --no-cache -t '更多按钮位于|尚无配音|Agent真实工具|面板重新挂载'
node node_modules/vitest/vitest.mjs run src/components/video/components/SegmentCard/__tests__/SegmentCard.test.tsx src/components/video/lib/segments/__tests__/segmentLinks.test.ts src/components/video/hooks/__tests__/useMaterialManagement.storeSync.test.tsx --reporter dot --no-color --no-cache
```

实测摘要（两个进程均退出 0）：

```text
取证用例：Test Files 1 passed；Tests 4 passed | 1 skipped (5)；Duration 15.64s
相关基线：Test Files 3 passed；Tests 43 passed (43)；Duration 10.11s
```

另以 Node + TypeScript AST 从磁盘源码提取函数，仅在内存编译执行，没有创建脚本文件或改写模块：

| 只读检查 | 输入与结果 | 意义 |
|---|---|---|
| 原 `placeMenu` | 按钮 `[188,220]`、菜单 `232×260`、视口高 600，得到 `left=8, top=236` | 复核向左展开的算法证据 |
| 原 `placeMenu` 底部翻转 | 按钮顶 550、底 582，菜单高 260，得到 `top=286` | 原有向上翻转有效，应保留 |
| 原 `placeMenu` 超高菜单 | 按钮顶 300，菜单高 700，视口高 600，得到 `top=8, bottom=708` | 确认只翻转仍会越界，需要限高滚动 |
| 关联与时长函数 | 数组逆序仍选时间戳较新音频；移除新版仍选旧版；移除最后版本返回 null；无段 ID 音频返回 null；无段落时长时解析音频为 3 秒 | 5 项断言通过，验证方案 A 的关键数据边界 |

上述原定位函数检查 3/3、关联与时长检查 5/5 通过；断言的仍是现有函数行为。43 项基线测试证明现有卡片交互、共享派生与正常删除桥接契约，**不等于修复后的功能验收**。本节点没有运行收费服务、完整桌面浏览器、真实项目重启、真实下载 / 试听或全项目构建。

## 评审结论

**唯一推荐方案：采用 A，在现有卡片 / 菜单组件内完成位置与可见边界修正，并将三个配音门禁统一迁移至 `SegmentLinksContext.latestVoiceById`。** 三项根因成立；评审已补全真实素材桥接、失败与批量分支、闭包、版本删除及浮层动态尺寸的证据。前序隔离复现能解释用户症状，完整桌面精确触发条件仍是下一节点的验证责任。

下一节点按以下范围实施：

1. `SegmentCard.tsx`：将唯一三点菜单放到卡头时长右侧，与展开按钮平级；删除操作行中的原入口。仅按实际需要增加卡头局部样式。
2. `SegmentMoreMenu.tsx`：保留现有 Portal、主题和键盘模型；优先向右，按工作台与视口交集做翻转 / 约束，补局部限高滚动及打开期间的尺寸 / 锚点重定位。保持应用级侧栏与对话框的层级，不全局提高 `.ws-menu` 的 `z-index`。
3. `ScriptPanel.tsx`：删除 `completedSegments` 及其写入，用同一共享音频存在性判断替换两个禁用理由和 `handleOpenVideoSearch` 的提前返回，并修正回调依赖；保留逐句时序回调、过期提示、关键词生成与 AI 匹配真实前置条件。AI 匹配调用处复用现有 `resolveSegmentDuration`，不重构素材同步、TTS 工具或时间轴。
4. 验收覆盖人工 / Agent 单段及批量（含部分失败）、入库后的响应式解锁、恢复、旧音频仍在时的过期 / 重配、下载失败、删除最新与最后版本、无关音频负向对照，以及实际点击能执行。布局在真实桌面工作台核对 280px / 320px、长标题 / 播放标记、中英文、最长版本菜单、低窗口高度、分隔条拖动、滚动 / resize、Esc 和焦点回归。前序“断言缺陷存在”的用例需转为或补充“断言预期行为”的回归验收，不能以原断言继续通过作为修复标准。

选择 A 的理由是：它直接修复三处已证实的断点，复用两种生成来源已经汇合的共享音频事实，避免引入事件镜像状态、公共层迁移或新依赖。方案 B 增加同步风险，方案 C 扩大无关回归面，均无必要。本节点的分析评审已完成；业务修复和修复后验收由下一节点执行。

## 方案 A 实施与验收

代码修复节点已按唯一推荐方案 A 完成，未发现需要调整推荐方案的缺陷。业务改动仅有四个文件：

- `SegmentCard.tsx`：唯一三点菜单移至卡头时长右侧，与展开按钮平级。
- `SegmentMoreMenu.tsx`：保留原 Portal 和主题，优先右向；以视口与整个工作台的交集限制横纵边界，空间不足时翻转，局部限高滚动。打开期间观察尺寸并跟踪锚点位置；滚动离开可见区时关闭，关闭及卸载时清理。动态删除或禁用焦点项后可继续导航，Esc 返回触发按钮。
- `ScriptPanel.tsx`：移除局部完成集合，三个配音门禁直接读取共享 `latestVoiceById`；修正闭包依赖，保留逐句时序、过期提示和其余门禁；匹配时长复用 `resolveSegmentDuration`。
- `editor-workbench.css`：只补卡头局部紧凑布局，保留长标题省略、播放标记、时长及菜单按钮。

未新增依赖或文件，未改全局浮层层级、素材同步或 TTS 协议。既有诊断目录中的测试与浏览器材料已更新为修复后验收；`menu-overlap.png` 现在是修复后截图，历史坐标仍保留于 `browser-observations.json`，原 `repro-output.txt` 保留前序取证记录。工作区原有 SkillRouter 等无关改动未由本节点修改、暂存或提交。

### 自动化与编译

执行以下命令，最终进程均退出 0：

```powershell
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/script-segment-menu-and-voice-availability/vitest.repro.config.ts --reporter verbose --no-color --no-cache --silent
node node_modules/vitest/vitest.mjs run src/components/video/components/SegmentCard/__tests__/SegmentCard.test.tsx src/components/video/lib/segments/__tests__/segmentLinks.test.ts src/components/video/hooks/__tests__/useMaterialManagement.storeSync.test.tsx --reporter dot --no-color --no-cache --silent
npm run build
```

专项 **15/15**、相关基线 **43/43** 通过。专项覆盖人工成功与下载失败、Agent 单段及批量部分失败、响应式解锁、保留音频后重新挂载、旧配音过期仍可用、无关联与其他段落音频、删除最新与最后版本、实际搜索点击、实际 AI 匹配请求携带音频 3 秒时长、菜单边界及动态焦点。修复前已运行预期行为断言并确认按钮归属、方向失败；最终验收不再依赖原“缺陷存在”断言。

初次独立 `tsc --noEmit --incremental false` 曾报告未关联的 SkillRouter 测试缺少 `stale` 字段，以及本节点随后修正的取证测试 `this` 类型；本节点未改 SkillRouter 文件。最终正常 `npm run build` 已完成编译、类型检查、99 页生成及 standalone 打包。另启动构建后的生产服务，首页 **HTTP 200**，`.next/standalone/server.js` 存在。仅有项目既有 Browserslist、静态目录等提示；`git diff --check` 通过。独立只读子代理评审通过，未发现高置信度业务缺陷。

### 浏览器人工复跑

浏览器页改为加载真实 `EditorWorkbench`、`useWorkbenchLayout`、`ScriptPanel`、共享派生和 `useMaterialManagement`，包含编译后的真实 Tailwind/CSS。外部 HTTP 使用模拟响应，验收数据与真实工程隔离。可在仓库根目录启动现有 Vite（不安装依赖、不新增配置文件）：

```powershell
@'
import {createServer} from 'vite';
const server=await createServer({configFile:false,resolve:{alias:{'@':process.cwd()+'/src'}},oxc:{jsx:{runtime:'automatic'}},define:{'process.env':{}},optimizeDeps:{entries:['docs/diagnoses/script-segment-menu-and-voice-availability/repro-menu.html']},server:{host:'127.0.0.1',port:5179,watch:{ignored:['**/.next/**']}}});
await server.listen(); server.printUrls();
'@ | node --input-type=module
```

打开 `http://127.0.0.1:5179/docs/diagnoses/script-segment-menu-and-voice-availability/repro-menu.html`，使用顶部验收控制即可复跑。`browser-inspect.mjs` 提供核心自动操作入口。浏览器测量保存在 `browser-observations.json` 的 `fix` 项：

| 场景 | 实际结果 |
|---|---|
| 280px、旧配音待更新、操作行换行 | 三点按钮在卡头；按钮右缘约 307.43，菜单左缘约 311.43；`coveredBySidebar=false`，更换画面可用 |
| 无可用已分析视频 | AI 匹配提示真实缺少素材原因，不再提示先完成语音转换 |
| 打开菜单后实时宽度预览至 320px | 菜单自动跟到约 x=351.43，无需窗口 resize；实际分隔条拖动也已执行 |
| 英文、长标题、播放标记、280px | 标题省略，播放标记、时长、三点按钮均留在卡头范围；实际点击打开搜索并带入 `valley` |
| 通过真实素材删除入口删版本 | 删最新仍有旧版时功能可用；确认删除最后版本后重新禁用 |
| 30 项长菜单、360px 高窗口 | 菜单 y=8、底边约 352、最大高度 344；内部滚动，End 可到达末项 |
| 打开中 resize 至 320px 高 | 菜单高度随之变为 304，底边 312；动态减至两项后收缩，键盘仍可用 |
| 列表滚动使锚点不可见 | 菜单关闭，无悬空可操作浮层 |
| Esc | 关闭菜单，焦点返回三点按钮，不展开或折叠卡片 |

本次复跑使用真实工作台组件的浏览器集成页，未启动完整 Electron 应用、收费合成、真实项目保存重启或媒体播放。Agent 工具到事件路由入库及人工下载失败链路另由真实组件回归用例覆盖；没有将模拟 HTTP 等同于真实服务验收。验收临时服务和自建浏览器任务空间在结束前关闭，未触碰已有后台服务。

## Final code review and verification

Final review date: 2026-11-20. The implementation matches recommended
方案 A. No blocking source issue was found, so no additional production
changes were necessary during final review.

| Review item | Result |
|---|---|
| Card structure | A single menu trigger follows the duration in the header, alongside the expansion button. Card selection and expansion handlers remain intact. |
| Menu placement | Placement prefers the right side and clamps to the workbench/viewport intersection. Local size limits, scrolling, anchor tracking, observer cleanup, and keyboard focus recovery address the reviewed boundaries without changing global stacking levels. |
| Voice availability | All three gates read the existing shared audio mapping. The obsolete local completion cache is removed, so manual and Agent results, restored audio, stale versions, and removal follow the same source of truth. |
| Adjacent behavior | Search callback dependencies use the shared mapping. AI matching uses the existing duration resolver and retains its other prerequisites. TTS protocols, material synchronization, timeline data, and dependencies are unchanged. |

Fresh final-review checks completed successfully:

- Focused regression command documented above: **15/15** tests passed.
- Adjacent card, segment-link, and material-sync suites: **43/43** tests passed.
- Targeted Next.js lint for the three changed TSX files: exit **0**.
  An in-memory comparison against `HEAD` confirmed all **10** ScriptPanel
  warnings already existed; this fix introduces **0** warnings and **0** errors.
- Normal `npm run build`: exit **0**, including compilation, TypeScript
  validation, generation of **99** pages, and standalone output.
- Staged whitespace validation passed after removing one redundant blank
  line at the end of the historical reproduction log. Its recorded results
  were otherwise preserved.

The commit scope is the four production files and the eight files in this
diagnosis directory. Build output, task runtime files, and unrelated edits
are excluded. Content hashes for the 23 unrelated tracked files were
unchanged before committing. The saved screenshot and measurements were
reviewed; final review did not rerun Electron, paid services, real playback,
or project save/restart. The browser acceptance scope remains as stated above.
