# 段落工作台 Iteration 2：让「一段视频」真正成为可操作、可撤销的对象（Segment-Centric Workbench R2）

> Feature slug: `segment-centric-editor-workbench-r2`
> Status: **v2（已评审，P0/P1 已改入正文；见「评审记录」与文末「评审结论」）**
> Author: 方案设计节点（Subtask #0 / solution architect）· Iteration 2/2 · 2026-09-23
> Reviewer: 设计评审节点（Subtask #1）· 2026-09-23 · v1 → v2
> 前置：Iteration 1 已提交 `feab883`（spec：`docs/plans/segment-centric-editor-workbench/spec.md`，下称「R1 spec」）。R1 完成了布局、顶栏、段落卡、「素材 | 属性」、时间轴段落标签和 AI 抽屉，**只做了重排和只读派生**。本轮实现 R1 spec §10 延后的事项，也就是建议第三～七节中的 P1 / P2 内容。
> 设计依据：《AI 给出的建议》全文、设计图 `.agentmesh/attachments/paste-1790170761034.png`、本体约束 `n_BmWWbXBkyq`（PyCharm 式软件风格），以及本节点在 HEAD `feab883` 上核对过的代码事实（文中写作 `文件:行`）。
> 硬约束：**不能影响现有功能。** 所有新增持久化字段都是可选字段，旧工程打开后的行为与今天完全相同。启动时不做任何破坏性 DDL（本轮不改数据库）。预览必须与导出一致（round 3 的硬约束）。

---

## 评审记录（Review Notes，v1 → v2）

评审方法：逐节按「可行性 / 完整性 / 一致性 / 规模」四个维度审阅，并在 HEAD `feab883` 上逐条核对 spec 引用的代码事实。已核实**成立**的事实：`historySlice.recordAction(type, payload?)` 已支持任意 payload，`captureNextState` 会在轨道不变时 `discardLastAction`（`historySlice.ts:120-137`）；`replaceTimelineAction` 的签名、锁豁免集合与「轨道相等返回 false」（`replaceTimeline.ts:56-95`）；`normaliseProjectDataForSave` 是 `...rest` 透传而非白名单（`videoProjects.ts:245-285`，新顶层键会被保存）；`hydrateTimeline.ts:63` 会 `clearHistory`；`useWorkbenchWiring.ts:54` 的比例为不持久化的 `useState('16:9')`；`ScriptPanel.tsx:175` 音色为面板级 `useState`；`:1547` 用回包时的 `segment` 计算 hash；`resolveAutoMixTargetTracks`（`applyScriptAutoMix.ts:54`）、`useEditorFocusStore`、`useSegmentAudition`、`shortcutOwnership.ts` 均存在；`build_video_filter` 两个分支与 `filtergraph_builder.py:231-233` 的 `scale…decrease + pad` 与描述一致。

发现的**不成立 / 缺口**如下。P0 / P1 均已改入正文（「改入位置」列），P2 中标注「已改」的也已顺手改入，其余 P2 作为实现期注意事项保留。

| # | 级别 | 维度 | 问题 | 改入位置 / 处理 |
|---|---|---|---|---|
| RV2-01 | **P1** | 一致性（事实错误）+ 功能保全 | v1 §3.4.3-3 称「卡片时长回退链优先使用时间轴区间」，实际 `resolveSegmentDuration`（`segmentLinks.ts:258-268`）**优先读 `segment.duration`**。且 `segment.duration` 仍有下游读取方（`useAIVideoScriptGeneration.ts:219/275/298/321` 以它作为 ARK 生成时长，`AIVideoScriptTab.tsx:341`）。v1 停止在生成后写 `segment.duration` 会改变这些下游的取值，违反「不能影响功能」。 | §3.4.3-3 改为**保留今天的写入**；卡片时长改为「有时间轴区间时优先区间」（纯显示层）；T-VOICE-NO-DURATION-WRITE 改为 T-VOICE-DURATION-WRITE-KEPT + T-LINKS-DURATION-RANGE-FIRST；§8 R-8 更新 |
| RV2-02 | **P1** | 完整性（逻辑冲突） | 「恢复上一版配音」走 `planSegmentVoiceApply`，而该规划器对 hash ≠ 当前文案的候选一律返回 `candidate-stale`。旧版配音几乎总是基于旧文案（这正是用户重新生成的原因），因此「恢复上一版」在最常见场景下**必然被拒绝**。 | §3.2.3 新增 `allowStale` 参数；§3.4.2 恢复入口对 stale 版本先显示「此版本基于旧文案，应用后本段配音将显示为待更新」再应用；新增测试 T-CMD-VOICE-5 |
| RV2-03 | **P1** | 完整性（逻辑冲突） | 恢复旧版后 `appliedVoiceMaterialId = 旧版`，而 `latest` 仍是较新的那条，按 v1 的 `candidate` 派生规则提示条会**立刻再次出现**「新配音已生成」，与用户刚做的明确选择相矛盾。 | §3.4.1 / §6 新增 `ScriptSegment.appliedVoiceAt?`（ISO 时间，应用时由 `patch-segment` 写入）；`candidate` 只在 latest 的 `segment_assigned_at` 晚于 `appliedVoiceAt` 时给出；撤销会连同该字段一起回退，候选随之恢复。T-LINKS-APPLIED 追加断言 |
| RV2-04 | **P1** | 可行性（归属错误） | v1 §3.6 让替换后的素材「写入 `metadata.segment_id` 段落戳」。`resolveItemSegmentId`（`segmentLinks.ts:103-114`）的优先级是 `sentenceSegments.segment_id` → **素材** `metadata.segment_id` → 素材 `linkedSegmentId` → **片段** `metadata.linkedSegmentId`。直接给库中素材打戳会把**所有**使用该素材的片段（包括其他段落的）改判到本段；若素材已带别段的戳，则新片段仍被判给旧段落，替换后「本段画面」反而为空。 | §3.6 改为：素材无段落戳 → 只在**新片段**上写 `metadata.linkedSegmentId`（随轨道快照进入历史，可撤销，不改素材）；素材带其他段落的戳 → 用 `stampMaterialForSegment` 生成带本段戳的**副本**加入素材库（与 `handleAddVideosToSegment` 同一写法），片段引用副本。T-CMD-VISUAL-5 覆盖 |
| RV2-05 | **P1** | 完整性（竞态） | 规划在打开对话框时完成、确认时才应用。对话框打开期间时间轴仍可能被改变（Agent 以锁豁免的 `'agent'` reason 写入、自动字幕回填等），此时应用旧 plan 会**整体覆盖**这些改动（`replaceTimelineAction` 取的是 plan 的完整 tracks）。 | §3.3.3 plan 携带 `baseTracks`；`applySegmentCommandAction` 先 `tracksEqual(plan.baseTracks, 当前 tracks)`，不等则返回 `'stale-plan'`，调用方重新规划并重开对话框（或提示「时间轴已变化，请重试」）。T-HIST-4 |
| RV2-06 | **P1** | 可行性（闭包过期） | companion 恢复器「由 VEI 在 mount 时注册一次」。`commitNarrationSegments`（`VideoEditingInterface.tsx:1027`）依赖 `scriptGeneration`，每次渲染都会变化；在 mount 时注册的闭包会拿到过期的 `onUpdateContent` / `content`，撤销时可能把旧 content 写回、覆盖用户后来的编辑。另外 React StrictMode 下的「注册 → 注销 → 注册」需要注销函数只注销自己。 | §3.3.1 改为「注册一个稳定包装函数，内部通过 ref 读取最新的 `commitNarrationSegments` 和 `scriptSegmentsRef.current`」；注销函数只在当前注册者仍是自己时清空。T-HIST-5 |
| RV2-07 | **P1** | 功能保全 | v1 I-4 让所有段落命令在 Agent 编辑锁期间被拒绝。但今天「删除段落」只改脚本，**在编辑锁期间可以执行**；改走 `replaceTimelineAction` 后会被拒绝，属于功能回退。 | §2.3 I-4 与 §3.7 / §3.8 改为：锁定期间，**只改脚本**的命令（删除但不移除片段、仅调整脚本顺序）按今天的方式直接写脚本，不产生历史记录；删除对话框的「同时移除时间轴片段」复选框置灰并说明原因。只有会改动轨道的命令才被拒绝 |
| RV2-08 | **P1** | 可行性（后端） | v1 §3.9.3 对 `filtergraph_builder.py` 只说「替换为 `build_fit_steps` 返回 steps 列表」。该处是 `filter_complex` 中按逗号串接的单链（`steps` 列表），`blur` 需要 `split` + 两条支路 + `overlay`，**无法表达为同一条链上的若干 step**，需要带标签的子图接线。另外 `cover` 的 camera 位置前后矛盾：导出串把 `{camera}` 放在 `scale…increase` 与 `crop` 之间（运镜作用在超出画框的放大帧上），而预览说「`cover` 的内容矩形就是裁切后的画框」。 | §3.9.3 改为：`build_fit_fragment` 对 contain / cover 返回 steps；blur 返回 graph 生成器，由 `filtergraph_builder` 把当前链在 fit 处断开、接入 `split/overlay` 子图后继续原链（给出接线示例）；`-vf` 路径（`video_composition_service.py:782/839/866`）保持字符串（`-vf` 接受单入单出的带标签图，无需 `FilterSpec.kind`）。`cover` 统一为 `scale…increase,crop=W:H{camera},setsar`（运镜作用在裁切后的画框上，与预览一致）。T-FIT-4 覆盖 blur 子图接线 |
| RV2-09 | **P1** | 完整性（几何） | `planSegmentVoiceApply` 在「旁白轨上本段没有音频（A 为空）」时一律插在前一段终点。若本段在时间轴上**已有画面**（有区间，只是没有配音），配音会被放在错误位置并把本段画面整体后推，画面与配音错位。 | §3.2.3 分三种情况：A 非空；A 为空但本段有区间 → 以区间起点为 `oldStart`、区间长度为旧跨度，其余与 A 非空相同；本段无区间 → 插入（原逻辑）。T-CMD-VOICE-3b |
| RV2-10 | **P1** | 交互（完整性） | v1 §3.8：段落不在时间轴时重排也弹出「无法一起移动」对话框。早期只写了脚本、尚未成片时，**每次重排都会弹框**，把最常见的场景变成了打扰。 | §3.8：所有涉及段落都没有时间轴内容时，直接只调整脚本顺序（仍是一条可撤销记录），toast 说明；只有「部分在时间轴 / 交错 / 锁定」时才弹框 |
| RV2-11 | **P1** | 规模 | 本轮是 Iteration 2/2（最后一轮），却一次纳入 12 项、约 60 个文件，其中 S8 横跨前后端导出。没有交付分档，下游一旦时间不够，容易出现「每项都做了一半」。 | 新增 §2.4「交付分档」：A 档必交（S1、S2、S3、S5、S6、S12），B 档应交（S4、S7、S8），C 档可延（S9、S10、S11）；每档必须完整交付，未交的项在报告中如实列出，不得半成品合入 |
| RV2-12 | P2（已改） | 完整性 | `shiftItemsFrom` 在 delta<0 时「按轨道截到最大可行值」会让不同轨道的平移量不一致，造成音画错位。 | §3.2.2：先在所有 eligible 轨道上求**统一**可行值，再一次平移 |
| RV2-13 | P2（已改） | 完整性 | 跨越 `oldEnd` 的非本段片段（起点早于 `oldEnd`、终点晚于它）不会被平移，而其后的片段会，可能产生重叠。 | §3.2.2：平移以「片段起点 ≥ oldEnd − EPS」判定；跨越片段不移动，规划器检测到平移后与之重叠时把本次平移改为 `interleaved` 拒绝，并提示用户手动处理 |
| RV2-14 | P2（已改） | 可行性 | 导出的模糊用 `boxblur` + `eq=brightness=-0.25`：`eq` 的 brightness 是**加性**偏移，而 canvas `brightness(0.6)` 是乘性，两者在亮部 / 暗部偏差不同，T-FIT-3 < 6/255 的阈值很可能过不了。 | §3.9.3 改为 `gblur=sigma=σ_px`（与 canvas 高斯一致）+ `colorchannelmixer=rr=0.6:gg=0.6:bb=0.6`（乘性） |
| RV2-15 | P2（已改） | 一致性 | T-FIT-2 的共享 fixture 放在 `docs/plans/...` 下，测试依赖文档目录，不符合仓库测试惯例。 | 改放 `backend-services/basic-service/tests/fixtures/fit-cases.json`，TS 测试按仓库根相对路径读取 |
| RV2-16 | P2（已改） | 可行性 | T-FIT-3「与预览 canvas 截图比较」：vitest 的 jsdom 不绘制像素，Playwright 截图又依赖桌面环境，作为自动化门禁不稳定。 | T-FIT-3 改为只校验**导出帧**与由 `computeVideoFitRects` 几何生成的参考帧（内容矩形位置 + 留边 / 裁切区域）；预览与导出的目视一致归入 §7.3 第 8 项手工验收 |
| RV2-17 | P2（已改） | 完整性 | 前端 `VideoCompositionRequest` 类型（`@/lib/api/videoComposition`）需要新增 `fit_mode`，文件变更表缺这一项。 | §4 补一行 |
| RV2-18 | P2 | 一致性 | `defaultVoiceId` / `canvasSettings` 经 `onUpdateContent({...content, …})` 写回，若调用方持有过期的 `content` 闭包，可能覆盖同时发生的其他写入。这是仓库已有模式的共性风险。 | 实现注意：写回时读取最新 content（与 `commitNarrationSegments` 同样使用 ref），并在 T-PERSIST-1 中加入「连续两次不同字段写入都被保留」的断言 |
| RV2-19 | P2 | 完整性 | blur 预览在 1080p 每帧 `ctx.filter` 模糊，Electron 中开销可能超过 4ms 预算。 | v1 已给出离屏 1/4 降级；实现时记录采样结果到运行日志即可 |
| RV2-20 | P2 | 一致性 | §3.11 中 `dismissedAdvisories`「写入 `canvasSettings`，与之并列的新键」表述含糊。 | 以 §6 为准：`canvasSettings.dismissedAdvisories` |

未发现 P0 问题：核心机制（纯函数规划器 + 单一写入口 + 历史 companion）在现有 store 上可行，且 `recordAction` 的 payload 通道已经存在，不需要改动历史数据结构。

---

## 0. 一页结论（给赶时间的实现者）

1. **段落命令层**：新增纯函数模块 `segmentCommands.ts`，把「应用本段配音 / 替换本段画面 / 删除段落 / 调整段落顺序」都规划成一次「新时间轴 + 脚本补丁 + 影响范围说明」。执行时统一经 `applySegmentCommandAction` 写入，**一次操作只产生一条撤销记录**。
2. **跨脚本与时间轴的撤销**：时间轴历史目前只保存时间轴快照。本轮给历史项加一个可选的 `companion`（脚本补丁操作），撤销或重做时由 `VideoEditingInterface` 注册的恢复器把补丁反向或正向应用到**当前**脚本上。这样按一次 Ctrl+Z 就能同时恢复段落文字和时间轴片段，而且不会覆盖用户之后输入的文字。
3. **配音采用「候选 → 试听 → 应用」**：「生成 / 更新本段配音」只生成候选配音，保存在素材库，这与今天的行为一致。卡片上出现「新配音已生成 · 8.0s → 10.0s」提示条，提供「试听 / 应用到时间轴 / 暂不应用」。新配音时长变化超过 0.05s 时，弹出**时长变化对话框**，提供「调整本段时长 / 修改文案或语速 / 暂不应用」，并写明影响范围：后移哪几段、背景音乐不移动、哪些轨道已锁定不会移动。⋯ 菜单新增「恢复上一版配音」。
4. **过期保护与失败保留**：请求发出时记录 `requestTextHash`，回包后与当前文案比较；不一致时提示「此结果基于上一版文案」，候选不能直接应用。失败原因保留在段落卡上，并提供「只重试本段」。批量转换能正确统计失败数（修复 `failCount` 恒为 0）。任务中心显示逐段进度和失败重试。
5. **音色分两层**：新增 `ScriptSegment.voiceId?` / `voiceSpeed?`，以及工程级 `content.defaultVoiceId?`（修复「全片默认音色」不持久化的问题）。卡片展开态显示「本段音色：使用全片默认 / 已单独设置」。修改全片默认音色后询问「仅用于后续生成 / 重新生成已有配音（N 段）」，不会自动重做。
6. **替换本段画面**：有三个入口，分别是卡片「更换画面」选完素材后、素材卡 ⋯「替换第 N 段画面」、把素材拖到段落卡上。替换时保持本段起止时间、配音、字幕和其他段落不变：素材够长就裁剪，不够长就循环铺满。
7. **删除段落**：确认框列出将移除的关联内容（时间轴上 N 个片段，素材库文件保留），默认勾选「同时移除时间轴上的关联片段」。执行一次撤销即可整体恢复。
8. **段落重排**：卡头提供拖动手柄，⋯ 菜单提供「上移 / 下移」。关联的画面、配音和字幕作为整块一起移动，背景音乐不动。无法整块移动时（段落内容在时间轴上交错、轨道被锁）只调整脚本顺序，并明确告诉用户原因。
9. **画布适配**：「画布」下拉新增「保持完整（可能留边）/ 填满画布（可能裁掉部分画面）/ 背景填充（保留主体，周围模糊填充）」三项，是工程级设置，默认「保持完整」，等于今天的行为。预览合成器 `CanvasCompositor` 和后端导出 `video_scaling.py` / `filtergraph_builder.py` 同步实现，并用一致性测试守门。
10. **时间轴**：双击轨道名可重命名（可撤销，导出 JSON 跟随显示名）；空的图片轨和字幕轨可以折叠成一条「＋ 添加图片 / 字幕」细条；拖放时显示**真实落点**说明（追加到 00:25.60 / 替换第 2 段画面 / 轨道已锁定）。
11. **导出前检查分级**：阻断项（素材丢失、没有可见内容）维持现状；新增提示项（有段落新配音未应用、有字幕待更新、画布留黑边、尾部黑屏），在确认面板里列出，用户可以「仍然导出」。
12. **AI 按作用范围命名**：段落 ⋯ 菜单加「润色本段文案」（复用 `ContentPolishModal` 的段落模式）；「生成初稿」下拉加「批量补齐缺失内容」，执行前先显示作用范围；AI 助手请求附带 `editorContext`，让 Agent 真正知道「正在协助第 2 段」。
13. **收尾 R1 遗留问题**：试听释放音频 src、默认音色弹层 Esc 层级、`retryNow` 在内容回到已保存版本时的状态、检查器再次点击同一素材、删除未使用的 `dock` z-index token。
14. **v2 评审修订要点**：`segment.duration` 写入保持不变，只改卡片显示（RV2-01）；恢复旧版配音允许基于旧文案的版本，并用 `appliedVoiceAt` 避免候选反复出现（RV2-02/03）；替换画面不直接给库中素材打戳（RV2-04）；应用前校验 `baseTracks`（RV2-05）；恢复器经 ref 读取最新提交函数（RV2-06）；编辑锁下只改脚本的命令保持今天的行为（RV2-07）；blur 导出接入 `filter_complex` 子图（RV2-08）；按 §2.4 分档交付（RV2-11）。

---

## 1. 概述 Overview

R1 把编辑页整理成「顶栏 / 左栏段落 / 中栏成片 / 右栏素材 | 属性 / 底部时间轴」的工作台，并用 `SegmentLinksContext` 把段落编号、选中高亮和状态芯片贯穿到四个区域。用户现在已经能**看清**自己正在编辑哪一段。但按建议第三节的验收任务（打开项目，修改「活泼天性」这一段的文案，重新生成本段配音，替换本段画面，然后导出）走一遍，仍有三处断点。代码勘察确认如下：

- **生成的配音到不了时间轴**。`handleConvertToSpeech`（`ScriptPanel.tsx:1374-1668`）只把配音 `onAddMaterial` 进素材库。唯一把配音放上时间轴的路径是「AI 一键成片」（`useScriptAutoMix` → `applyScriptAutoMixAction`，`applyScriptAutoMix.ts:119`），而它会**替换整条主画面轨和旁白轨**。R1 只能在卡片上如实显示「新配音未上时间轴」，用户想更新一段，要么重跑全片，要么手动拖放、手动对齐。这正是建议里点名要避免的「改一句话就重跑整条视频」。
- **段落操作只改文字**。`handleDeleteSegment`（`ScriptPanel.tsx:1884-1918`）只从脚本里过滤掉段落，时间轴上的关联片段和素材都留成孤儿。脚本编辑和时间轴历史分属两个 store，时间轴历史（`historySlice.ts`）只保存时间轴快照，因此不存在「一次撤销整体恢复」。段落重排没有入口，替换画面也只改候选列表 `segment.videos`（`ScriptPanel.tsx:738`），不改时间轴。
- **生成过程不可见、不可恢复**。逐段 TTS 失败只弹一个 toast（`:1650`），段落上不保留原因。`handleBatchConvertToSpeech`（`:1754`）因为下层吞掉了异常，`failCount` 恒为 0。回包时不比较文案版本：请求期间改了文字，旧配音照样被标上**新**文案的 hash（`:1547` 用的是回包时的 `segment`）。音色只有一个面板级 `useState`（`:175`），不持久化，也不能按段设置。

本轮的核心思路是 R1 spec 结尾那句话：**研发层面应把它定义为同一段内容的不同视图，而不是三套数据互相猜测着同步。** 具体做法是在 R1 的只读派生层 `segmentLinks.ts` 之上，增加一层**纯函数的段落命令规划器** `segmentCommands.ts`。每个段落级操作都先规划成「新的时间轴轨道 + 脚本补丁 + 影响范围」，交给用户确认（需要时），再由一个 store action 作为**一条**历史记录写入。历史记录通过新增的 `companion` 字段携带脚本补丁，使撤销能跨脚本和时间轴两个 store。所有规划器都是纯函数，可以穷举单测；所有写入都复用已经证明可靠的 `replaceTimelineAction`，它自带编辑锁拒绝、拖动中取消、轨道视图标志保留和空操作不记历史这些保护。

画布适配三选一在设计图里已经画出（「画面适配：适应 / 填满 / 背景填充」）。它会改变导出画面，因此本轮前后端同步实现，默认值等于今天的行为，并以同一组几何测试同时约束预览（TS）和导出（Python）。其余视觉和交互延续 R1 的 `--ws-*` token 与 PyCharm 式工具窗口语言，不引入新的视觉体系。

---

## 2. 范围、非目标与功能保全

### 2.1 本轮范围

| 编号 | 内容 | 建议出处 | 优先级 |
|---|---|---|---|
| S1 | 段落命令层 `segmentCommands.ts` + `applySegmentCommandAction` + 历史 `companion`（跨 store 单步撤销） | 三「删除段落…一次撤销整体恢复」 | P0（其余各项的基础） |
| S2 | 本段配音「候选 → 试听 → 应用」+ 时长变化对话框 + 恢复上一版配音 | 三「更新本段配音」「配音时长变化」 | P0 |
| S3 | 生成过期保护（`requestTextHash`）、段落失败原因与只重试本段、批量 `failCount` 修复、任务中心逐段进度与重试 | 五「让生成过程可见、可取消、可恢复」 | P0 |
| S4 | 本段音色覆盖、全片默认音色持久化、修改默认音色时询问 | 五「配音设置必须分清全片默认和本段覆盖」 | P1 |
| S5 | 替换本段画面（三个入口，保持时长） | 三「替换本段画面」、四.1 | P1 |
| S6 | 删除段落并处理关联内容、单步撤销 | 三「删除段落」 | P1 |
| S7 | 段落重排（拖动手柄 + 上移 / 下移），关联内容整块移动 | 三「拖动段落调整顺序」 | P1 |
| S8 | 画布适配三选一（预览 + 导出同步） | 四.2 | P1 |
| S9 | 时间轴：轨道重命名、空轨折叠、真实落点提示 | 四.3 | P2 |
| S10 | 导出前检查分级面板 | 七「导出前检查也要区分严重程度」 | P2 |
| S11 | AI：润色本段文案、批量补齐缺失内容（先显示作用范围）、Agent 上下文注入 | 五 | P2 |
| S12 | R1 遗留问题收尾（见 §3.13） | R1 spec 末节 | P2 |

### 2.2 非目标（本轮明确不做）

- **不新增时间轴「插入 / 覆盖」拖放模式。** 今天拖放一律追加到轨道末尾（`ItemPlacementService.calculatePlacementPosition`，`:183-191`），`Track.tsx:168-182` 的 drop 不读取指针位置。新增两种放置语义会改变现有的拖放功能。本轮只把**真实落点**说清楚（S9），「替换」只通过段落卡这个明确目标提供（S5）。
- **不做任务取消。** `asyncTaskSlice` 没有取消能力，逐段 TTS 走一次性 POST，ARK 没有 cancel（CLAUDE.md）。本轮用「暂不应用」来兜底：生成结果只是候选，不会自动改动工程。任务中心文案写明「生成中无法取消，完成后可选择不应用」。
- **不做片段级锁定。** 现在只有轨道锁（`TrackData.isLocked`）和 Agent 编辑锁。建议中的「用户手动锁定的片段」本轮按**轨道锁**解释：锁定轨道上的片段不会被任何段落命令移动或改写，并在影响说明中列出。
- **不做「收藏」分类、「模板」入口**（设计图中有，但产品没有对应功能，R1 已按「不加空入口」处理）。
- **不做生成结果的并排对比界面**（建议 P2「生成结果对比」）。只提供「试听候选 / 试听当前」两个按钮和「恢复上一版」。
- **不改后端 TTS / Agent 协议之外的接口**：唯一的后端改动是导出请求新增可选字段 `fit_mode`（S8），以及 Agent 路由读取可选的 `editorContext`（S11，BFF 层）。
- **不拆分超过 1000 行的历史文件**（`TimelinePanel.tsx` 1524 行、`ScriptPanel.tsx` 2334 行、`VideoEditingInterface.tsx` 2373 行）。本轮对它们设**规模门：净增 ≤ 0 行**，新增逻辑一律放进新文件。

### 2.3 功能保全：行为不变量（实现与验收逐条勾选）

| # | 不变量 | 如何保证 |
|---|---|---|
| I-1 | 旧工程（没有任何新字段）打开后，预览画面、导出画面、音色、段落状态与 `feab883` 完全一致 | 所有新字段可选；读取时一律使用 `?? 旧默认值`；`fit_mode` 缺省为 `contain`，后端对 `contain` 生成**逐字符相同**的 filter 字符串（测试 T-FIT-1） |
| I-2 | 「生成本段配音」仍会把配音加进素材库，**不会自动改动时间轴** | S2 只新增「应用」按钮，生成流程只改音色来源和 hash 戳 |
| I-3 | 「AI 一键成片」`useScriptAutoMix` 的行为不变 | 规划器只**读取** `planScriptAutoMix` 的循环铺满规则（抽出共享的 `fillSpanWithMaterial`），不改它的输出（既有测试全绿） |
| I-4 | **会改动轨道**的段落命令在 Agent 编辑锁生效期间被拒绝，并提示 `t.timeline.messages.editLockedByAgent`；**只改脚本**的命令（删除但不移除片段、仅调整脚本顺序）在锁定期间按今天的方式直接写脚本、不产生历史记录（今天删除段落在锁定期间可用，不能回退，RV2-07） | 统一经 `useSegmentCommands`：plan 的轨道与当前相等且锁定时走 `commitSegments` 直写；否则经 `applySegmentCommandAction` → `replaceTimelineAction`，入口先调用 `isEditLocked` |
| I-5 | 锁定轨道上的片段不会被移动、裁剪或删除 | 规划器把锁定轨道原样复制到输出（测试 T-CMD-LOCK） |
| I-6 | 背景音乐轨（不含任何段落关联片段的音频轨）不会被段落命令移动 | 规划器的「段落相关轨道」判定（§3.2.2）；测试 T-CMD-BGM |
| I-7 | 删除段落不会删除素材库中的原文件 | 规划器只产出轨道和脚本补丁，不接触 `materials` |
| I-8 | 撤销 / 重做快捷键、按钮、编辑锁、拖动中拒绝的语义不变 | companion 恢复发生在既有 `undo()` / `redo()` 内部，拒绝条件不变 |
| I-9 | 文本输入框获得焦点时，段落重排和新快捷键不会被触发 | 新快捷键一律经 `resolveGlobalSpaceAction` / `shouldTimelineHandleKeyEvent` 同一套守卫 |
| I-10 | 现有导出阻断（素材丢失、没有可见内容）的判定和文案不变 | S10 只在 `planVideoExport` 返回 `ready` **之后**追加提示层 |
| I-11 | 逐段配音生成后 `segment.duration` 的写入与今天一致（下游 `useAIVideoScriptGeneration` 以它作为生成时长） | 保留 `ScriptPanel.tsx:1569-1588` 的写入逻辑（随迁移原样搬进 hook）；只调整卡片的**显示**优先级（RV2-01） |

### 2.4 交付分档（RV2-11）

本轮是最后一轮，按档交付；每一档必须**完整**交付（代码 + 测试 + i18n + 验收项），不得把某一项做一半合入。

| 档 | 范围 | 说明 |
|---|---|---|
| A 必交 | S1、S2、S3、S5、S6、S12 | 覆盖验收主任务（改文案 → 更新本段配音 → 替换本段画面 → 导出）的全部断点与「一次撤销」 |
| B 应交 | S4、S7、S8 | S8 横跨前后端导出，风险最高，放在 A 档全部通过之后单独实施与验证 |
| C 可延 | S9、S10、S11 | 时间不够时整项延后，并在下游报告与 §10 中如实列出「未交付」 |

---

## 3. 技术设计 Technical Design

### 3.1 总体架构

```
            ┌──────────── 读（R1 已有）────────────┐
 ScriptSegment[] ─┐                                 │
 MaterialItem[] ──┼─► useSegmentLinks ─► SegmentLinksContext ─► 卡片 / 时间轴 / 素材 / 检查器
 TimelineStore ───┘                                 │
            └──────────── 写（本轮新增）────────────┘
 用户操作 ─► useSegmentCommands (hook, VEI 调用一次)
               │ 1. 读当前 tracks / materials / segments
               │ 2. segmentCommands.planXxx(...)  ← 纯函数
               │      → { ok, tracks, scriptOps, impact } | { ok:false, reason }
               │ 3. 需要确认？→ SegmentImpactDialog / VoiceDurationDialog
               │ 4. applySegmentCommandAction(get, { tracks, companion: scriptOps })
               │      → replaceTimelineAction(..., 'segment', { companion })  ← 1 条历史
               │ 5. applyScriptOps(scriptOps, 'forward') → commitNarrationSegments
               ▼
       undo / redo ─► historySlice ─► restoreFromSnapshot(tracks)
                                   └► historyCompanion.restore(ops, 'inverse'|'forward')
                                          └► VEI 注册的恢复器 → commitNarrationSegments
```

**唯一写入口原则**（沿用 R1 的 RV-01 思路）：全仓只有 `useSegmentCommands` 调用 `applySegmentCommandAction`，只有 VEI 调用一次 `useSegmentCommands`，结果经 `SegmentCommandsContext` 下发给段落卡、素材卡、时间轴拖放和检查器。代码评审用 `grep -rn "useSegmentCommands(" src` 的非测试结果等于 1 来核验。

### 3.2 段落命令规划器 `segmentCommands.ts`（新增，纯函数）

位置：`src/components/video/lib/segments/segmentCommands.ts`（主体，≤ 600 行）＋ `segmentCommandGeometry.ts`（区间与平移工具，≤ 250 行）。只依赖 `segmentLinks.ts`、`timeline/domain` 的纯类型和 `ItemPlacementService.createItemFromMaterial`（它本身是纯函数，`applyScriptAutoMix.ts:96` 已经这样使用）。

#### 3.2.1 通用输出

```ts
export interface SegmentCommandPlan {
  ok: true;
  /** 规划时读取的轨道（原引用），应用前用于检测时间轴是否已变化（RV2-05）。 */
  baseTracks: TrackData[];
  /** 完整的新轨道列表（未涉及的轨道保持原对象引用）。 */
  tracks: TrackData[];
  /** 对脚本的补丁；空数组表示不改脚本。 */
  scriptOps: ScriptOp[];
  impact: SegmentImpact;
}
export type SegmentCommandResult = SegmentCommandPlan | { ok: false; reason: SegmentRefusal };

export type SegmentRefusal =
  | 'edit-locked' | 'segment-not-found' | 'not-on-timeline'
  | 'target-track-locked' | 'no-target-track' | 'span-occupied'
  | 'interleaved' | 'candidate-stale' | 'nothing-to-do';

export interface SegmentImpact {
  /** 本段时长变化（秒，正数表示变长）；0 表示不变。 */
  durationDelta: number;
  /** 被整体平移的其它段落序号（1-based，升序）。 */
  shiftedSegmentOrdinals: number[];
  /** 被平移但不属于任何段落的片段数（如无归属字幕）。 */
  shiftedLooseItemCount: number;
  /** 因锁定而保持原位的轨道显示名（deriveTrackDisplayName）。 */
  lockedTrackNames: string[];
  /** 被保留、不移动的背景音乐轨显示名。 */
  untouchedMusicTrackNames: string[];
  /** 本次移除的片段计数，按轨道显示名分组，供删除确认框使用。 */
  removedItems: { trackName: string; count: number }[];
  /** 工程总时长：变更前 → 变更后。 */
  totalDurationBefore: number;
  totalDurationAfter: number;
}
```

#### 3.2.2 共享规则

- **段落相关轨道** `isSegmentBearingTrack(track)`：满足以下**任一**条件的非锁定轨道——(a) 含至少一个 `resolveItemSegmentId` 非空的片段；(b) `type === 'subtitle'`；(c) 轨道 id 以 `image-track` 开头。其余音频轨视为**背景音乐轨**，所有命令都不移动它们（I-6），并记入 `impact.untouchedMusicTrackNames`（仅当该轨有片段位于受影响区间之后）。
- **锁定轨道**：原样复制，名字记入 `impact.lockedTrackNames`（仅当它有片段位于受影响区间之后）。
- **主画面轨 / 旁白轨**：复用 `resolveAutoMixTargetTracks(tracks)`（`applyScriptAutoMix.ts:55`），与「一键成片」取同一条轨，避免两套判定。
- **片段归属**：一律使用 `resolveItemSegmentId`，不另写判定。**字幕片段**没有 segment_id，按「起点落在本段区间 `[start, end)` 内」归属本段（与 R1 `hasOverlappingSubtitle` 的区间一致，但改成按起点归属，保证每条字幕只属于一段）。
- **平移** `shiftItemsFrom(tracks, fromTime, delta, eligible)`：对 `eligible` 轨道上 `startTime >= fromTime - EPS` 的片段加上 `delta`。`delta < 0` 时先在**所有** eligible 轨道上求出**统一的**最大可行值（任何一条轨道上都不会与 `fromTime` 之前的片段重叠），再用这一个值平移全部轨道，并在 impact 里反映真实值；不允许各轨道分别截断，否则音画会错位（RV2-12）。**跨越片段**（起点早于 `fromTime`、终点晚于它、且不属于本段）不平移；若平移后会与它重叠，规划器返回 `interleaved`，不做任何改动（RV2-13）。`EPS = 1e-6`，时间一律 `roundTime`，保留 6 位小数，与 `planScriptAutoMix` 一致。
- **铺满** `fillSpanWithMaterial(material, track, start, span)`：从 `planScriptAutoMix` 抽出的**共享**函数。素材时长 ≥ span 时生成一段，`clipStart=0`、`clipEnd=span`；否则循环生成多段，最后一段裁到刚好填满，最短片段 `MIN_CLIP_SECONDS=0.1`，短于它的尾段并入前一段（前一段 clipEnd 不超过素材时长时才并入，否则丢弃并在 impact 注明「留有 <0.1s 空隙」）。图片素材 → 一段，`duration=span`。片段通过 `ItemPlacementService.createItemFromMaterial(toMaterialData(material), emptyTrack)` 生成，与手动拖放、一键成片完全同构（颜色、url / cacheUrl / storageKey 快照、`originalMaterialType`、波形）。**`planScriptAutoMix` 改为调用这个共享函数，输出不变**（I-3，用既有测试守门）。

#### 3.2.3 四个规划器

| 规划器 | 输入 | 算法要点 | 脚本补丁 |
|---|---|---|---|
| `planSegmentVoiceApply` | `{tracks, materialsById, segments, segmentId, candidate, lengthMode: 'adjust'｜'keep', allowStale?: boolean}` | 1) 候选的 `metadata.segment_text_hash` ≠ 当前 `segmentTextHash(segment)` 且 `allowStale !== true` → `candidate-stale`。`allowStale` 只由「配音版本 › 使用此版」在用户确认后传入（RV2-02）。2) 旁白轨上本段的音频片段集合 A。**A 非空**：`oldStart=min(start)`、`oldEnd=max(end)`；删除 A，在 `oldStart` 放入候选（一段，`duration = candidate.duration`）；`delta = newDur − (oldEnd − oldStart)`。**A 为空但本段有区间**（例如只有画面，RV2-09）：`oldStart` / `oldEnd` 取本段区间（`segmentRanges`）的起点 / 终点，在 `oldStart` 放入候选，其余与 A 非空相同。**本段无区间**：插入点 = 按脚本顺序前一个在时间轴上的段落的区间终点（没有则为 0）；`delta = newDur`（相当于插入）。3) `lengthMode='adjust'`：对段落相关轨道 `shiftItemsFrom(oldEnd, delta)`（旁白轨上刚放入的候选除外）；本段的主画面片段：delta>0 时把本段最后一个画面片段延长 delta（`clipEnd+delta ≤ originalDuration`），不够则 `fillSpanWithMaterial` 用本段第一个画面素材补足；delta<0 时从尾部裁掉 −delta，裁到短于 0.1s 的片段直接移除。4) `lengthMode='keep'`（仅 A 非空、且 delta<0 时可选，对应「保留原时长」）：不平移，也不改画面，旁白尾部留空。 | `patch-segment`：`appliedVoiceMaterialId: old → candidate.id`，`appliedVoiceAt: old → 应用时刻 ISO`（RV2-03），`duration: old → newDur` |
| `planSegmentVisualReplace` | `{tracks, materialsById, segments, segmentId, material}` | 主画面轨上本段的画面片段集合 V。**V 非空**：区间 `[vs, ve]` = V 的并集外包；移除 V，用 `fillSpanWithMaterial(material, mainTrack, vs, ve−vs)` 填入；其它轨道**完全不动**（保持时长、配音、字幕与节奏）。**V 为空但本段有区间**：若主画面轨在 `[start,end)` 内空闲则填入，否则返回 `span-occupied`。**本段无区间**：`not-on-timeline`（调用方只打脚本补丁，见 §3.6）。主画面轨锁定 → `target-track-locked`。 | `patch-segment`：`videos: old → [material]` |
| `planSegmentRemoval` | `{…, segmentId, removeTimelineItems: boolean}` | `removeTimelineItems=false` → tracks 原样返回，只打脚本补丁。`true`：移除非锁定轨道上归属本段的全部片段（包括按起点归属的字幕）；**不平移**后续片段（与今天手动删除片段的行为一致，避免在用户不知情时移动整条时间轴），在 impact 里写明「将留下 X 秒空隙，可用『整理素材』收紧」。锁定轨道上的关联片段保留，并在 impact 中列出。 | `remove-segment`：`{segment, index}` |
| `planSegmentReorder` | `{…, segmentId, toIndex}` | 1) 求出每段在段落相关轨道上的区间（`segmentRanges`）。2) **可整块移动的条件**：所有涉及段落都有区间、区间按脚本顺序排列且两两不重叠，受影响的段落相关轨道都未锁定。否则返回 `interleaved`（或 `target-track-locked`）；所有涉及段落都没有区间时返回 `ok` 且 `tracks === baseTracks`（只打脚本补丁，RV2-10）。3) 按新顺序重新排布：保持块内相对偏移，块与块之间的空隙按原顺序保留，从受影响范围的最早起点开始依次排列；背景音乐轨不动。 | `reorder`：`{beforeOrder, afterOrder}`（段落 id 数组） |

每个规划器在最后统一计算 `impact.totalDurationBefore/After`（全部轨道片段终点的最大值）和 `shiftedSegmentOrdinals`（区间起点发生变化的段落）。

### 3.3 跨脚本与时间轴的单步撤销（history companion）

#### 3.3.1 数据

```ts
// src/components/video/timeline/store/historyCompanion.ts（新增）
export type ScriptOp =
  | { type: 'remove-segment'; segment: ScriptSegment; index: number }
  | { type: 'insert-segment'; segment: ScriptSegment; index: number }
  | { type: 'reorder'; beforeOrder: string[]; afterOrder: string[] }
  | { type: 'patch-segment'; segmentId: string;
      before: Partial<ScriptSegment>; after: Partial<ScriptSegment> };

export interface HistoryCompanion { kind: 'script-ops'; ops: ScriptOp[] }

export type CompanionDirection = 'forward' | 'inverse';
export type CompanionRestorer = (ops: ScriptOp[], direction: CompanionDirection) => void;

export function registerCompanionRestorer(fn: CompanionRestorer): () => void; // 返回注销函数
export function runCompanion(payload: unknown, direction: CompanionDirection): void;
```

- 恢复器只保存**一个**（最后注册者生效），由 `useSegmentCommands` 在 mount 时注册，unmount 时注销。切换项目时 `hydrateTimeline` 会 `clearHistory`，旧项目的 companion 不会被应用到新项目（沿用现有语义）。
- **防过期闭包（RV2-06）**：注册的是一个**稳定的包装函数**，它在被调用时才通过 ref 读取最新的 `commitNarrationSegments`（`optsRef.current.commitSegments`）和最新脚本（`scriptSegmentsRef.current`），再执行 `applyScriptOps`。不得把某次渲染的 `commitNarrationSegments` 直接注册进去：它依赖 `scriptGeneration`，每次渲染都会变化，过期闭包会把旧 `content` 写回。
- **注销只注销自己**：`registerCompanionRestorer(fn)` 返回的注销函数仅在当前注册者仍是 `fn` 时才清空，这样 React StrictMode 的「注册 → 注销 → 注册」顺序不会误删新注册者（T-HIST-5）。
- `applyScriptOps(segments, ops, direction)`（纯函数，同文件导出）把补丁作用在**当前**脚本上，而不是整体回滚到快照，这样用户在命令之后输入的文字会被保留：
  - `remove-segment`：forward 按 id 过滤；inverse 在 `min(index, length)` 处插回（id 已存在则跳过）。
  - `insert-segment`：与上面互逆。
  - `reorder`：forward 按 `afterOrder` 排序当前存在的 id，inverse 按 `beforeOrder` 排序；不在序列中的新段落保持相对位置，追加在末尾。
  - `patch-segment`：只写 `before` / `after` 中出现的键；目标段落不存在则跳过。
  - inverse 时 ops 逆序执行。

#### 3.3.2 历史切片改动（`historySlice.ts`、`HistoryService.ts`、`replaceTimeline.ts`）

1. `HistoryService` 新增 `peekUndo(): TimelineAction | null` 与 `peekRedo(): TimelineAction | null`，只读，不移动指针。
2. `undo()`：`const action = peekUndo()` → 保持原有 `_historyService.undo()` + `restoreFromSnapshot` 流程 → 若 `action?.payload` 含 `companion`，调用 `runCompanion(payload, 'inverse')`。`redo()` 对称，使用 `'forward'`。拒绝条件（编辑锁、拖动中）不变，被拒绝时 companion 也不执行（I-8）。
3. `captureNextState()` 的「轨道未变化就撤回该条历史」规则：payload 带 companion 时**不撤回**（例如「删除段落但不移除时间轴片段」，轨道不变、脚本改变，仍然需要一条可撤销记录）。
4. `replaceTimelineAction(get, data, reason, options?: { companion?: HistoryCompanion })`：`ReplaceTimelineReason` 新增 `'segment'`（不在编辑锁豁免集合内）。轨道相等时：没有 companion 则维持今天的「不记历史，返回 false」；有 companion 则仍然记录一条历史，payload 为 `{ reason, companion }`，返回 true。
5. `TimelineAction['type']` 保持 `'REPLACE_TIMELINE'`（沿用 replaceTimelineAction 现有的 type），不新增枚举值，避免影响历史面板和日志。

#### 3.3.3 执行 action

```ts
// src/components/video/timeline/store/actions/applySegmentCommand.ts（新增）
export function applySegmentCommandAction(
  get: () => TimelineStore,
  plan: SegmentCommandPlan,
): { ok: true; recorded: boolean } | { ok: false; reason: 'edit-locked' | 'invalid' | 'stale-plan' };
```

流程：`isEditLocked` → `edit-locked`；`!tracksEqual(plan.baseTracks, get().exportToData().tracks)` → `stale-plan`（对话框打开期间时间轴被 Agent 或其它写入改变过，不能用旧 plan 整体覆盖，RV2-05）。调用方收到 `stale-plan` 后用当前状态重新规划：结果与原 plan 的 impact 相同则直接应用，否则关闭对话框并提示 `时间轴已变化，请重新操作`；`replaceTimelineAction(get, { ...get().exportToData(), tracks: plan.tracks }, 'segment', { companion: { kind:'script-ops', ops: plan.scriptOps } })`，构造失败时捕获并返回 `invalid`，同时记录日志；成功后由**调用方**（`useSegmentCommands`）立即执行 `applyScriptOps(current, ops, 'forward')` → `commitNarrationSegments`。顺序固定为「先时间轴、后脚本」：时间轴写入可能被拒绝，而脚本写入不会失败。

**编辑锁下的只改脚本命令（RV2-07）**：`useSegmentCommands` 在调用本 action 之前判断：若 `isEditLocked` 且 `plan.tracks` 与 `plan.baseTracks` 相等（只改脚本），则不写历史，直接 `commitSegments(applyScriptOps(current, ops, 'forward'))`，行为与今天在锁定期间删除段落完全相同；若会改动轨道，则拒绝并提示 `editLockedByAgent`。

### 3.4 本段配音：候选、应用、时长决策、恢复

#### 3.4.1 状态派生（改 `segmentLinks.ts`）

- 新增持久化字段 `ScriptSegment.appliedVoiceMaterialId?: string`（§6）。
- `deriveVoiceOnTimeline`：旁白片段的 `materialId` 等于 `latest.id` **或** 等于 `segment.appliedVoiceMaterialId` 时，视为 `'current'`。这样「恢复上一版」之后不会被误判为过时。
- 新增持久化字段 `ScriptSegment.appliedVoiceAt?: string`（ISO 时间，应用配音时由 `patch-segment` 写入，撤销时随补丁回退，RV2-03）。
- 新增派生字段 `SegmentStatus.candidate: null | { materialId; duration; deltaFromTimeline: number | null; isStale: boolean }`：latest 存在、latest ≠ 时间轴上本段的配音、latest ≠ `appliedVoiceMaterialId`，**并且**（`appliedVoiceAt` 缺省，或 latest 的 `segment_assigned_at` 晚于 `appliedVoiceAt`）时给出。后一条保证用户通过「配音版本」恢复旧版后，较新的那条不会马上又以「新配音已生成」出现；之后再生成的配音仍会正常成为候选。`deltaFromTimeline` = latest 时长 − 时间轴上本段旁白区间长度（本段无旁白时为 null）。
- `isVoiceStale` 的比较对象改为「时间轴上正在使用的那条配音」，没有则用 latest（与 R1 行为一致，只是来源更准确）。

#### 3.4.2 界面

- **候选提示条** `VoiceCandidateBanner`（新增，渲染在 `SegmentCard` 芯片区下方，折叠态和展开态都显示，高度 32px，`--ws-primary-bg` 底）：
  - 正常：`新配音已生成 · 8.0s → 10.0s（+2.0s）`，按钮依次为 `试听`（ghost）、`应用到时间轴`（primary-solid）、`暂不应用`（text）。本段未上时间轴时显示 `新配音已生成 · 10.0s`，主按钮文案为 `放到时间轴`。
  - 过期（`isStale`）：`此配音基于上一版文案` + `重新生成`（primary）+ `仍然试听`；**没有「应用」按钮**。
  - 「暂不应用」只在本次会话内隐藏提示条（存入 `editorFocusStore.dismissedCandidateIds`），芯片仍显示「新配音未上时间轴」，⋯ 菜单仍有「应用新配音」。
- **时长变化对话框** `VoiceDurationDialog`（新增，基于现有 `ConfirmationDialog` 的样式骨架，宽 440）：|delta| ≥ 0.05s 时点击「应用」弹出；|delta| < 0.05s 时直接以 `adjust` 模式应用，toast 提示「已应用本段新配音 · Ctrl+Z 撤销」。
  - 标题：`新配音比原来长 2.0 秒` / `新配音比原来短 1.2 秒`。
  - 影响说明（逐行，来自 `plan.impact`，由 `formatSegmentImpact` 生成）：
    - `第 3 段「亲密陪伴」及之后内容将后移 2.0 秒`（有平移时）
    - `背景音乐「音频 2」保持原位`
    - `轨道「字幕」已锁定，不会移动`
    - `工程总时长 25.6s → 27.6s`
  - 三个选项（单选卡片 + 底部确认按钮，符合「先说明做什么」）：
    1. **调整本段时长**（默认选中）→ `lengthMode='adjust'`。
    2. **修改文案或语速** → 关闭对话框，展开本段卡片，聚焦解说编辑框，并在编辑框下方显示「语速」分段控件（0.8× / 0.9× / 1.0× / 1.1× / 1.2×，写入 `segment.voiceSpeed`），同时显示「按新设置重新生成」按钮。不应用任何内容。
    3. **暂不应用** → 关闭，候选保留。
  - 变短时额外出现「保留原时长（尾部留空）」，作为选项 1 的子选项复选框，对应 `lengthMode='keep'`。
- **恢复上一版配音**：`SegmentMoreMenu` 新增子菜单「配音版本」，列出本段全部配音素材（按 `segment_assigned_at` 降序，最多 5 条）：`当前 · 10.0s · 09:12`，其余每行为 `09:05 · 8.0s  试听 / 使用此版`。选择后走同一个 `planSegmentVoiceApply`（候选 = 该素材），因此同样经过时长对话框，并且可以撤销。**该版本基于旧文案时**（hash 与当前文案不一致，这是恢复旧版的常见情况，RV2-02），行内显示 `基于旧文案` 标记；点击「使用此版」时，时长对话框顶部多一行 `此版本基于旧文案，应用后本段配音将显示为「待更新」`，确认后以 `allowStale: true` 规划。候选提示条上的「应用」仍不允许 stale（§3.4.2 过期态），`allowStale` 只开放给这个明确的版本选择入口。
- **试听互斥**：候选试听沿用 R1 的 `useSegmentAudition`（素材试听不改变成片播放头，并且会先暂停成片）。

#### 3.4.3 生成流程改动（`ScriptPanel.tsx` → 抽到 `hooks/useSegmentVoiceGeneration.ts`）

为了满足 ScriptPanel 净增 ≤ 0 的规模门，把 `handleConvertToSpeech` 的主体（约 290 行）整体迁到新 hook `useSegmentVoiceGeneration`。ScriptPanel 只保留调用。迁移分两步：先**原样搬迁**并跑全量测试，再做以下改动：

1. **音色与语速**：`voiceId = segment.voiceId ?? defaultVoiceId`，`speed = segment.voiceSpeed ?? 1.0`，传给 `convertScriptSegmentToSentenceRequest(segment, voiceId, speed, taskId, 3)`（该函数已支持 `speedRatio`，`tts.ts:195`）。素材 `metadata` 增加 `voice_speed`；`voice_type` 记录**实际使用的**音色。
2. **过期保护**：进入函数时计算 `requestTextHash = segmentTextHash(segment)` 并写入 `metadata.segment_text_hash`（替代 `:1547` 回包时的计算）。回包后读取 `segmentsRef.current` 中的同 id 段落：段落已被删除 → 不加入素材库，记录日志并提示「第 N 段已删除，配音结果已丢弃」；hash 不一致 → 照常加入素材库（派生层会自动判为 stale），并提示 `此结果基于上一版文案，未应用`。
3. **保留 `segment.duration` 的写入，只改卡片显示（v2 修订，RV2-01）**：今天回包后会把 `total_duration` 写进 `segment.duration`（`:1569-1588`）。v1 曾计划停止这一写入，但评审核实 `segment.duration` 仍被下游读取（`useAIVideoScriptGeneration.ts:219/275/298/321` 用它作为 ARK 视频生成时长，`AIVideoScriptTab.tsx:341`），停止写入会改变这些功能的取值，违反「不能影响功能」。因此**写入逻辑随迁移原样保留**（I-11）。「未应用时卡片却显示新时长」的矛盾改在显示层解决：`resolveSegmentDuration`（`segmentLinks.ts:258`，今天是 字段 → 区间 → 配音）调整为 **区间 → 字段 → 配音**，即本段在时间轴上有区间时显示时间轴上的真实时长，没有区间时行为与今天相同。这只影响卡片上的时长文字。应用时 `patch-segment` 仍写 `duration`，保证撤销时字段一起回退。
4. **失败保留**：`catch` 分支除保留原 toast 外，调用 `editorFocusStore.setSegmentVoiceError(segmentId, sanitizeTaskError(message))`；开始新请求时清除该段错误。返回值改为 `Promise<'ok' | 'failed' | 'skipped' | 'discarded'>`。
5. **批量统计**：`handleBatchConvertToSpeech` 按返回值统计 `successCount` / `failCount`，结束时的汇总提示使用真实数字（修复「失败也报全部成功」）。
6. **进度镜像**：`ttsProgress` 的模拟进度同时写入 `editorFocusStore.segmentVoiceProgress`（Map，节流：整数变化才写）。任务中心的逐段行显示百分比（修 R1 IF-16）。

#### 3.4.4 段落失败的呈现

- `SegmentCard` 在芯片区下方显示 `SegmentErrorRow`：`⚠ 配音生成失败：{原因}`，右侧有 `只重试本段` 按钮（调用同一个生成函数）。它和候选提示条互斥，错误优先。颜色使用 `--ws-danger`，并配图标加文字，不只靠颜色表达。
- 任务中心：`collectActiveTasks` 新增来源 `segmentVoiceErrors`，以 `status:'failed'` 行进入 `recent`，行尾显示「重试」按钮（`TaskCenterButton` 新增可选 prop `onRetrySegmentVoice(segmentId)`；未传时不渲染按钮，保持 R1 的只读默认）。
- 错误状态只在会话内保存（不持久化）：失败原因通常是临时性的（网络、密钥），重开工程后再显示旧原因反而会误导用户。这一取舍写进 §8 R-6。

### 3.5 音色：全片默认与本段覆盖

- **全片默认持久化**：`VideoEditingTaskContent.defaultVoiceId?: string`。`ScriptPanel` 的 `selectedVoiceId` 初始值改为 `content.defaultVoiceId ?? 'zh_male_shaonianzixin_uranus_bigtts'`（与今天的硬编码默认一致，I-1）。修改时经 VEI 的 `onUpdateContent` 写回，自动保存负责落盘。
- **本段覆盖**：`ScriptSegment.voiceId?` / `voiceSpeed?`。入口有两个：(a) 卡片展开态的解说编辑区下方显示一行 `本段音色：使用全片默认（少年梓辛）▾`，下拉项为「使用全片默认」和音色列表（复用 `VoiceSelector`）；已覆盖时显示 `本段音色：已单独设置 · Brayan 2.0  恢复默认`。(b) 属性页 `SegmentInspector` 的同名字段。修改音色或语速只写脚本（普通脚本编辑，不进入时间轴历史，与改文案一致），芯片将配音标为「待更新」。实现方式：`isVoiceStale` 增加比较项——配音素材的 `voice_type` / `voice_speed` 与段落当前生效的音色 / 语速不一致时也视为 stale。**向后兼容**：旧素材没有 `voice_speed` 时视为 1.0；没有 `voice_type` 时不参与比较。
- **修改全片默认时询问**：`DefaultVoiceBar` 选择新音色后，统计「使用默认音色、且已有配音（voice ≠ none）的段落」数量 N（已单独设置音色的段落数为 M）。N = 0 时直接切换；N > 0 时弹出 `DefaultVoiceChangeDialog`：
  - 文案：`全片默认音色将改为「Brayan 2.0」。已有 N 段配音使用旧的默认音色。`（M > 0 时追加 `另有 M 段已单独设置音色，不受影响。`）
  - 选项：`仅用于后续生成`（默认）/ `重新生成这 N 段配音` / `取消`。
  - 选择「重新生成」：逐段生成**候选**（复用批量循环，间隔 1s），**不自动应用**。完成后顶栏任务中心和段落卡显示候选；左栏标题栏出现批量提示 `N 段新配音待应用  [全部应用]`。
- **全部应用**：`planSegmentVoiceApplyMany(segmentsInScriptOrder)` 依次在上一步的输出轨道上规划（模式 adjust），合并为一个 plan、一条历史记录。执行前弹出 `SegmentImpactDialog`，汇总每段变化（`01 +0.4s · 02 −1.2s · 03 +0.0s`）和总时长变化。任何一段为 stale 或被拒绝时，该段跳过，并在对话框中列出原因。

### 3.6 替换本段画面

- **入口 A（卡片「更换画面」）**：保持现有流程（`handleOpenVideoSearch` → 搜索弹窗 → `handleAddVideosToSegment` 写 `segment.videos` 并把带段落戳的副本加入素材库）。**新增**：`handleAddVideosToSegment` 成功后，如果本段在主画面轨上已有画面片段，卡片出现一次性提示条 `已为本段选好新画面  [替换时间轴上的本段画面]  [稍后]`。点击替换时，以所选的第一个视频执行 `planSegmentVisualReplace`。不自动替换，保持 I-2 的精神：选素材不等于改工程。
- **入口 B（素材卡 ⋯ 菜单）**：`MaterialMoreMenu` 在有选中段落、且素材类型为 video / image 时新增 `替换第 2 段画面`（带段落标签），并且放在菜单第一项。
- **入口 C（拖到段落卡）**：`SegmentCard` 成为 drop target，接受素材拖拽的 `application/json`（与时间轴相同的 MIME）。`dragenter` 时整卡显示 2px 主色虚线描边和覆盖标签 `松开以替换第 2 段画面`；素材类型不兼容（音频）时显示 `音频不能作为画面` 并使用 `dropEffect='none'`。drop → 执行 `planSegmentVisualReplace`。
- 结果处理：`ok` → 直接应用（时长不变，不需要确认），toast `已替换第 2 段画面 · Ctrl+Z 撤销`；`not-on-timeline` → 只打脚本补丁 `videos`（仍然作为一条可撤销的 companion 历史），提示 `本段尚未放到时间轴，已设为本段画面候选`；`span-occupied` / `target-track-locked` → 提示原因，不做任何改动。
- **归属写法（v2 修订，RV2-04）**：`resolveItemSegmentId` 的优先级是 `sentenceSegments.segment_id` → 素材 `metadata.segment_id` → 素材 `linkedSegmentId` → 片段 `metadata.linkedSegmentId`（`segmentLinks.ts:103-114`）。因此**不得直接给库中素材打戳**，否则所有使用该素材的片段（包括其他段落的）都会被改判到本段。规则如下：
  - 素材**没有**任何段落戳：只在规划器生成的**新片段**上写 `metadata.linkedSegmentId = segmentId`。它随轨道快照进入历史，撤销时一起消失，素材本身不变。
  - 素材已带**本段**的戳：直接使用。
  - 素材带**其他段落**的戳：用 `stampMaterialForSegment`（从 `handleAddVideosToSegment` 抽出的共享实现）生成带本段戳的**副本**（新 id），经 `addMaterial` 加入素材库，新片段引用副本。素材库不在时间轴历史中，撤销后副本保留在库里（与今天「更换画面」加入的副本一致，符合 I-7「不删素材」）。
  - 这样「已用于第 N 段」芯片立即正确，且不会影响其他段落。T-CMD-VISUAL-5 覆盖三种情况。

### 3.7 删除段落

- `SegmentMoreMenu`「删除段落」改为打开 `SegmentDeleteDialog`（替换原 `ConfirmationDialog` 调用，原确认文案保留为第一行）：
  - `将删除第 2 段「活泼天性」的解说和画面描述。`
  - 复选框（默认勾选）`同时移除时间轴上的关联片段：主画面 2 个、旁白 1 个、字幕 3 个`（来自 `planSegmentRemoval(...,true).impact.removedItems`；本段在时间轴上没有片段时不显示复选框）。
  - 说明：`素材库中的原文件会保留。删除后可用 Ctrl+Z 一次恢复。`
  - 勾选时补充一行：`时间轴上会留下 8.0 秒空隙，可用「整理素材」收紧。`
  - 锁定轨道上有关联片段时补充：`轨道「字幕」已锁定，其中的 3 个片段会保留。`
- **Agent 编辑锁生效时**（RV2-07）：复选框置灰且不勾选，旁边说明 `AI 助手正在编辑时间轴，暂时只能删除解说`；确认后只删脚本，与今天的行为相同（不产生历史记录）。
- 确认后执行 `planSegmentRemoval` → `applySegmentCommandAction`。`handleDeleteSegment` 保留为兼容入口，内部改为调用 `segmentCommands.remove(segmentId, {removeTimelineItems})`。
- 如果删除的是当前选中段落，`editorFocusStore.selectSegment(null)`；撤销后不自动重新选中（避免布局跳动）。

### 3.8 段落重排

- **拖动**：`SegmentCard` 卡头左侧新增 16×32 的拖动手柄（`⋮⋮`，`aria-label="拖动调整第 2 段顺序"`）。只有从手柄开始拖动才会重排，点击卡片其它位置的行为不变。拖动时显示插入线（2px 主色，位于两张卡之间）。实现使用原生 HTML5 DnD，MIME 为 `application/x-ecliptrix-segment`，与素材拖拽区分，互不干扰；不引入新依赖。
- **键盘与菜单**：⋯ 菜单新增 `上移` / `下移`（首尾段禁用）；焦点在手柄上时，`Alt+↑` / `Alt+↓` 触发同样的操作。
- **执行**：`planSegmentReorder`。
  - `ok` → 直接应用，toast `已将第 2 段移到第 3 位，画面、配音、字幕已一起移动 · Ctrl+Z 撤销`。
  - **所有涉及段落都没有时间轴内容**（只写了脚本、尚未成片，RV2-10）→ 不弹框，直接只打 `reorder` 脚本补丁（仍是一条可撤销记录），toast `已将第 2 段移到第 3 位 · Ctrl+Z 撤销`。
  - Agent 编辑锁生效且需要移动时间轴内容 → 提示 `editLockedByAgent`，并提供 `仅调整脚本顺序`（锁定期间按 §3.3.3 直写脚本，不产生历史记录）。
  - `interleaved` / `target-track-locked` / **部分**段落不在时间轴 → 弹出 `SegmentImpactDialog` 说明原因：`第 2 段在时间轴上与其它段落交错（或：轨道「主画面」已锁定），无法一起移动时间轴内容。` 选项为 `仅调整脚本顺序` / `取消`。选择前者时，只打 `reorder` 脚本补丁（仍然是一条可撤销的历史记录）。
- 段落编号（01/02/03）由 `buildSegmentIndex` 按脚本顺序派生，重排后时间轴标签、素材「已用于第 N 段」芯片会自动更新。已有素材的 `metadata.segment_number` 是历史戳，不再作为显示依据（R1 已按 id 派生）。

### 3.9 画布适配（预览 + 导出同步）

#### 3.9.1 语义

| 值 | 菜单文案（标题 + 说明，直接写在菜单项里） | 视频层几何 |
|---|---|---|
| `contain`（默认） | **保持完整** · 画面完整显示，比例不同时会留边 | 今天的 `fitSourceInFrame`：按比例缩小并居中，四周黑边 |
| `cover` | **填满画布** · 铺满画布，可能裁掉部分画面 | 按比例放大到覆盖画框，居中裁切 |
| `blur` | **背景填充** · 保留完整主体，周围用模糊画面填充 | 底层：同一画面按 `cover` 绘制并高斯模糊（σ=20，按输出高度 1080 归一：`σ_px = 20 × H/1080`），亮度 ×0.6；上层：按 `contain` 绘制 |

- 只作用于**视频层**。图片层由 `imagePosition` 决定位置，行为不变；字幕不受影响。运镜（camera motion）作用在 `contain` 的内容矩形上（今天的语义）。`cover` / `blur` 与运镜同时存在时，运镜仍作用在前景内容矩形上：`cover` 的内容矩形就是**裁切后的画框**（导出端运镜链因此放在 `crop` 之后，见 §3.9.3，RV2-08），`blur` 的内容矩形是前景 contain 矩形。
- 工程级设置：`VideoEditingTaskContent.canvasSettings?: { aspectRatioId?: string; fit?: 'contain'|'cover'|'blur' }`。**顺带持久化画面比例**（今天是 `useWorkbenchWiring.ts:54` 的 `useState('16:9')`，不持久化）。缺省时使用 `'16:9'` 和 `'contain'`，与今天一致（I-1）。
- `CanvasMenu` 新增「画面适配」分组（三个单选项，带上表中的说明文字），位于比例分组下方；当前内容比例与画布比例一致时，说明行显示 `当前画面与画布比例一致，三种方式效果相同`。播放器标题栏的 `画布 16:9 ▾` 改为 `画布 16:9 · 保持完整 ▾`。

#### 3.9.2 预览（`CanvasCompositor.ts`）

- `CompositorLayer` 的 video 分支新增 `fit: CanvasFit`（由 `useCompositionTransport` 从 `canvasSettings.fit` 注入，所有视频层一致）。
- 新增纯函数 `computeVideoFitRects(intrinsicW, intrinsicH, frame, fit) → { background: FitRect | null; content: FitRect; clip: FitRect }`，放在 `playback/videoFit.ts`：
  - `contain`：`content = fitSourceInFrame(...)`，`background = null`，`clip = frame`。
  - `cover`：`content` 为覆盖画框的放大矩形（可能超出 frame），`clip = frame`（绘制前 `ctx.save(); ctx.beginPath(); ctx.rect(frame); ctx.clip()`）。
  - `blur`：`background` 为 cover 矩形，`content` 为 contain 矩形，`clip = frame`。
- `_drawVideoLayer` 按 rects 绘制：先裁切，再画背景（`ctx.filter = 'blur(σpx) brightness(0.6)'`，画完重置为 `'none'`），然后走原有路径（有运镜时进入 `_drawCameraVideoLayer`，传入 `content`）。`fit='contain'` 时的代码路径与今天**逐语句相同**（前置分支判断），不影响现有测试。
- 性能：`blur` 模式每帧多一次 drawImage 和 filter。预算为 1080p 画布上单层增加 ≤ 4ms（用 `performance.now()` 采样日志验证）；超出时降级为先绘制到 1/4 尺寸的离屏 canvas 再模糊放大（实现内置，不设开关）。

#### 3.9.3 导出（后端）

- `app/models/video_models.py`：`VideoCompositionRequest` 新增 `fit_mode: Literal['contain','cover','blur'] = 'contain'`（Pydantic 可选字段，旧客户端不传时等于今天）。前端 `useVideoExport.ts:125` 在 `aspect_ratio` 旁边传 `fit_mode`。
- `video_scaling.py`：`calculate_scaling_params(..., fit_mode='contain')` 与 `build_video_filter(params, camera_chain='', fit_mode='contain')`：
  - `contain`：**原样返回今天的字符串**。T-FIT-1 对两个分支（需要 pad / 不需要 pad）做逐字符相等断言。
  - `cover`：`scale=W:H:force_original_aspect_ratio=increase,crop=W:H:(iw-W)/2:(ih-H)/2{camera},setsar=1:1`。运镜链放在 `crop` **之后**，作用在裁切后的画框上，与预览「`cover` 的内容矩形就是画框」一致（v2 修订，RV2-08；v1 把它放在 `scale` 与 `crop` 之间，与预览语义矛盾）。
  - `blur`：`split=2[bg][fg];[bg]scale=W:H:force_original_aspect_ratio=increase,crop=W:H,gblur=sigma={σ},colorchannelmixer=rr=0.6:gg=0.6:bb=0.6[bgb];[fg]scale={contain}{camera}[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1:1`。其中 `σ = 20 × H / 1080`，与预览的 `σ_px` 同一公式。v2 用 `gblur`（高斯，与 canvas `blur()` 同类）和乘性的 `colorchannelmixer`（与 canvas `brightness(0.6)` 同为乘性）替换 v1 的 `boxblur` + 加性的 `eq=brightness`，避免亮部与暗部出现不同偏差（RV2-14）。
  - **`-vf` 路径**（`video_composition_service.py:782/839/866` 的预裁切路径）：`-vf` 接受单输入单输出、带内部标签的滤镜图，因此三种模式都以**字符串**返回，调用点不变，不需要 v1 的 `FilterSpec.kind`。`:839/:866` 的「去掉运镜重试」按原样对新字符串生效。
- **`filter_complex` 路径**（`filtergraph_builder.py:222-233`，v2 修订，RV2-08）：该处把一个片段的处理写成逗号串接的**单条链**（`steps` 列表）。`contain` / `cover` 可以直接表示为若干 step；`blur` 需要 `split` 和两条支路，**不能**写成同一条链上的 step。改为：
  - 新增 `build_fit_fragment(width, height, fit_mode, camera_chain) -> FitFragment`，`FitFragment = { steps: list[str] } | { graph: Callable[[in_label, out_label], str] }`。`contain` 返回原来的两行 `scale…decrease` + `pad…black`（逐字符不变）；`cover` 返回 `scale…increase` + `crop`；`blur` 返回 graph 生成器。
  - 返回 `graph` 时，片段链在 fit 位置断开：`[in]trim…,setpts=PTS-STARTPTS[{p}_pre];` + `graph('{p}_pre', '{p}_fit')` + `;[{p}_fit]setsar=1:1,trim=duration=…,（原链余下的 alpha / fade 步骤）…`。标签前缀 `{p}` 用片段序号生成，保证同一 filter_complex 内唯一。
  - `fit_mode` 通过现有的 composition context 传入，不新增全局变量。T-FIT-4 断言 blur 子图的标签唯一、链可被 `ffmpeg -filter_complex` 解析（需要 ffmpeg 时缺失则 skip 并注明原因）。
- **一致性守门**（§7.1 T-FIT-2/3）：用同一组 12 个几何用例（源 16:9 / 9:16 / 4:3 / 1:1 × 画布 16:9 / 9:16 / 1:1 的子集，fixture 放在 `backend-services/basic-service/tests/fixtures/fit-cases.json`，TS 测试按仓库根相对路径读取，RV2-15）分别断言 TS `computeVideoFitRects` 与 Python `calculate_scaling_params` 输出的内容矩形在 ±1px 内一致；再用一段 2 秒的 9:16 纯色分区测试视频在 16:9 画布下导出三种模式，抽取第 1 秒帧，与**由同一 fixture 几何生成的参考帧**比较（contain：留边区域为黑、内容矩形位置正确；cover：无黑边且裁切位置正确；blur：内容矩形内与源一致、四周非黑且亮度约为源的 0.6 倍），平均绝对误差 < 6/255。预览 canvas 与导出成片的目视一致归入 §7.3 第 8 项手工验收，不作为自动化门禁（jsdom 不绘制像素，RV2-16）。
- **失败降级**：后端遇到 `blur` 滤镜构造失败（理论上不会发生）时抛出 `VideoProcessingError`，由现有导出错误路径报告，**不静默降级为 contain**（遵循「不静默回退」约定）。

### 3.10 时间轴：轨道重命名、空轨折叠、真实落点提示

- **轨道重命名**：`Track.tsx` 轨道头名称双击后进入就地编辑（`input`，Enter / 失焦提交，Esc 取消，长度 ≤ 24）。新增 `renameTrackAction(get, trackId, name)`（`actions/trackActions.ts` 追加，`recordAction('TRACK_RENAME')` + 修改 `track.name` + `captureNextState`，可撤销）。提交空字符串表示恢复默认名（`name=''`，`deriveTrackDisplayName` 已规定非空 name 优先）。导出 JSON、AI 混剪确认框会自动使用新名字（它们已经调用同一个函数）。`TimelineAction.type` 新增 `'TRACK_RENAME'`。锁定轨道也允许改名（改名不影响内容）。
- **空轨折叠**：`image-track*` 和 `subtitle-track*` 在 `items.length === 0` 时默认折叠成 20px 细条：`＋ 添加图片`（或 `＋ 添加字幕`）。点击后展开为正常高度，展开状态存入 `localStorage` 键 `ecliptrix.timeline.expandedEmptyTracks.<projectId>`（按工程保存，try/catch 包裹，失败时视为默认值）。轨道一旦有内容就总是展开。这只是视图状态，不写进工程，也不进入历史。「添加字幕」细条的点击行为 = 展开，**不会**直接触发转写（转写费时，仍然需要用户点击工具栏里现有的「添加字幕」）。
- **真实落点提示**：`Track.tsx` 的 `dragover` 已经会调用 `evaluateMaterialDrag`。新增 `DropHintBadge`（复用 R1 `DragTimeBadge` 的样式），跟随指针显示：
  - 兼容且未锁定：`追加到末尾 · 00:25.60`（时间 = 该轨最后片段终点，与 `calculatePlacementPosition` 同一公式，由新导出的纯函数 `computeAppendStart(track)` 提供；`ItemPlacementService` 改为调用它，保证提示与结果一致）。
  - 锁定：`轨道已锁定`；类型不兼容：`此轨道不接受音频`。
  - 段落卡上的替换提示见 §3.6 入口 C。
- 不新增插入 / 覆盖模式（§2.2）。

### 3.11 导出前检查分级

- 新增纯函数 `collectExportAdvisories(input) → ExportAdvisory[]`（`hooks/exportAdvisories.ts`），在 `planVideoExport` 返回 `ready` **之后**调用（I-10）：

| code | 条件 | 文案 | 操作 |
|---|---|---|---|
| `voice-pending` | 有段落 `candidate` 非空且非 stale | `2 段有新配音尚未应用到时间轴（第 2、3 段）` | `去处理`：关闭面板并选中第一个相关段落 |
| `voice-stale` | 有段落 voice 为 stale | `1 段文案已修改，配音仍是旧版本` | 同上 |
| `subtitle-none` | 工程中存在旁白片段，但没有任何字幕片段 | `成片没有字幕` | 无（仅提示） |
| `letterbox` | `fit='contain'`，且有视频片段的源比例与画布比例相差 > 2% | `部分画面比例与画布不同，会留出黑边（可在「画布 › 画面适配」中调整）` | `打开画布设置` |
| `black-tail` | 沿用现有 `useVideoExport.ts:298` 的黑尾判定 | 沿用现有文案 | 无 |

- 有任一提示项时，点击导出先弹出 `ExportPreflightSheet`（右上角导出按钮下方的 Popover，宽 360）：标题 `导出前检查`，逐条列出提示（图标 + 文案 + 操作），底部为 `仍然导出`（primary-solid）和 `返回编辑`。勾选 `本工程不再提示「成片没有字幕」` 时写入 `canvasSettings.dismissedAdvisories: string[]` 并持久化（以 §6 为准，RV2-20）（只允许 `subtitle-none` 和 `letterbox` 被永久忽略，因为它们可能正是用户的选择）。
- 没有提示项时，行为与今天一致，直接导出。原来黑尾的 warning toast 迁入面板，不再重复弹出。

### 3.12 AI 交互：按作用范围命名

- **润色本段文案**：`SegmentMoreMenu` 新增 `润色本段文案`（位于「生成本段配音」之上）。点击后打开 `ContentPolishModal`，传入新增的 props `mode='segment'`、`originalContent = segment.narrationText ?? 句子拼接`，以及 `onContentSelect(text)`。选择结果写回 `segment.narrationText`（普通脚本编辑，芯片会自动变成「配音待更新」）。modal 标题改为 `润色第 2 段文案`。API 不变（`/api/content-polish-multiple` 本来就接受任意 `originalContent`）。原有的全文润色入口不变。
- **批量补齐缺失内容**：左栏 `生成初稿 ▾`（`AiGenerateMenu`）新增一项 `批量补齐缺失内容…`。点击后先弹出 `BatchFillScopeDialog`，内容由纯函数 `planBatchFill(segments, statusById)` 计算：
  - `将生成 3 段配音（第 1、2、4 段：没有配音或文案已修改）。`
  - `第 3 段已有最新配音，跳过。`
  - `生成完成后需要你试听并应用，不会自动改动时间轴。`
  - 按钮：`开始生成` / `取消`。执行 = 对这些段落调用逐段生成（候选），完成后在左栏标题栏显示「N 段新配音待应用 [全部应用]」（与 §3.5 共用）。本轮「补齐」只覆盖配音；画面缺失的段落只在对话框中列出 `第 4 段还没有画面，可用「为本段找画面」`，不自动匹配（AI 匹配会覆盖 `segment.videos`，属于覆盖手工编辑的情况，交给用户逐段决定）。
- **Agent 上下文注入**：`useAgentExecution.ts:609-618` 的请求体新增可选字段 `editorContext: { selectedSegmentId: string | null; segmentLabel: string | null; segmentRange: {start,end} | null }`，由 VEI 从 `editorFocusStore` 和 `SegmentLinksContext` 读取后传入 hook 选项 `getEditorContext()`。BFF 路由 `src/app/api/video-editing-agent/chat/route.ts:244` 解构该字段，传给 `buildThinkingPrompt(userMessage, timelineState, materials, editorContext)`；有值时，在提示词的时间轴状态之后追加一段：`用户当前正在编辑第 2 段「活泼天性」（时间轴 8.5s–16.5s）。除非用户另有说明，涉及「这一段 / 本段」的指令都指该段。` 字段缺省时提示词逐字不变（测试 T-AG-1）。

### 3.13 R1 遗留问题收尾

| # | 问题（R1 spec 末节） | 修正 |
|---|---|---|
| L-1 | 试听停止时只 pause，不释放 src | `useSegmentAudition.stop()` 在 pause 后执行 `audio.removeAttribute('src'); audio.load()` |
| L-2 | `DefaultVoiceBar` 弹层的 Esc 与内层 `VoiceSelector` 下拉同时关闭；弹层位置不随窗口缩放更新 | 内层下拉打开时由它消费 Esc 并调用 `stopPropagation`；弹层监听 `resize` 重新定位（rAF 节流） |
| L-3 | `retryNow` 在内容回到已保存版本时，状态仍显示「保存失败」 | `retryNow` 发现 `snapshot === lastSavedJsonRef.current` 时调用 `onSaveSuccess` |
| L-4 | 检查器中再次点击同一素材不会切回该素材 | `inspectorSelection` 记录「最近一次用户操作」时带上递增序号，同一 id 重复点击也会刷新 |
| L-5 | `tailwind.config.js` 中的 `dock` / `dock-panel` 层级 token 已无代码使用 | 用 grep 确认没有引用后删除 |

### 3.14 关键时序

**A. 验收主任务**（修改「活泼天性」文案 → 更新本段配音 → 替换本段画面 → 导出）

1. 在第 2 段展开态中编辑解说，失焦时保存。派生层发现 hash 变化，配音芯片显示「配音待更新」，字幕芯片不变。
2. 点击卡片提示按钮「更新本段配音」→ `useSegmentVoiceGeneration(segment)`：记录 `requestTextHash`，写入 `convertingSegmentIds`，任务中心显示「第 2 段配音 · 生成中 35%」。其他段落仍可编辑。
3. 回包：hash 一致，候选加入素材库。卡片出现 `新配音已生成 · 8.0s → 10.0s（+2.0s） 试听 / 应用到时间轴 / 暂不应用`。
4. 点击「应用到时间轴」→ `VoiceDurationDialog`：`第 3 段「亲密陪伴」将后移 2.0 秒；背景音乐保持原位；总时长 25.6s → 27.6s`，选择「调整本段时长」→ `planSegmentVoiceApply(adjust)` → `applySegmentCommandAction`（1 条历史）→ 脚本补丁写入 `appliedVoiceMaterialId`、`appliedVoiceAt` 和 `duration`。芯片变为「配音已生成」（绿）。
5. 在素材页选中一段视频，⋯ →「替换第 2 段画面」→ `planSegmentVisualReplace`：主画面轨 8.5s–18.5s 被新素材铺满，其他轨道不动 → 1 条历史。
6. 点击「导出视频」→ `planVideoExport` 为 ready → 提示项：`成片没有字幕`（如适用）→ `仍然导出`。
7. 任意时刻按 Ctrl+Z：依次撤销第 5 步（画面与 `videos` 一起恢复）和第 4 步（旁白、平移、`appliedVoiceMaterialId` 一起恢复）；第 1 步的文字编辑不在时间轴历史中，保持不变（与今天一致）。

**B. 生成期间继续编辑**：第 2 步请求在途时用户又改了文案 → 回包 hash 不一致 → 候选以旧 hash 入库，提示条显示「此配音基于上一版文案 · 重新生成」，没有「应用」按钮。

**C. 撤销删除段落**：删除（勾选移除片段）→ 1 条历史（轨道变化 + `remove-segment`）→ 用户在别的段落输入文字 → Ctrl+Z → `restoreFromSnapshot` 恢复片段，`runCompanion(inverse)` 把段落插回原位置，**用户后来输入的文字保留**。

---

## 4. 文件 / 模块变更计划

规模门：`ScriptPanel.tsx`、`VideoEditingInterface.tsx`、`TimelinePanel.tsx` 净增 ≤ 0 行；新文件 ≤ 600 行，函数 ≤ 60 行（超过时在注释中说明原因）。

| 文件 | 类型 | 目的 |
|---|---|---|
| `src/components/video/lib/segments/segmentCommands.ts` | 新增 | 四个规划器 + `planSegmentVoiceApplyMany` + `planBatchFill` |
| `src/components/video/lib/segments/segmentCommandGeometry.ts` | 新增 | `isSegmentBearingTrack` / `shiftItemsFrom` / `assignSubtitlesBySegment` / `computeTotalDuration` |
| `src/components/video/lib/segments/fillSpanWithMaterial.ts` | 新增 | 从 `planScriptAutoMix` 抽出的铺满函数（两处共用） |
| `src/components/video/lib/segments/formatSegmentImpact.ts` | 新增 | impact → 本地化说明行（纯函数，i18n 由参数传入） |
| `src/components/video/lib/segments/stampMaterialForSegment.ts` | 新增 | 段落戳写法的共享实现（ScriptPanel 与替换共用） |
| `src/components/video/lib/segments/segmentLinks.ts` | 修改 | `appliedVoiceMaterialId` / `appliedVoiceAt` 判定、`candidate` 派生、音色 / 语速 stale 判定、`resolveSegmentDuration` 改为区间优先（RV2-01，同步更新其既有测试） |
| `src/components/video/lib/segments/SegmentLinksContext.ts` | 修改 | `SegmentStatus.candidate` 类型；新增 `SegmentCommandsContext` |
| `src/components/video/lib/aiMix/planScriptAutoMix.ts` | 修改 | 改为调用 `fillSpanWithMaterial`（输出不变） |
| `src/components/video/timeline/store/historyCompanion.ts` | 新增 | `ScriptOp` 类型、注册 / 运行恢复器、`applyScriptOps` |
| `src/components/video/timeline/store/actions/applySegmentCommand.ts` | 新增 | 段落命令唯一写入 action |
| `src/components/video/timeline/store/actions/replaceTimeline.ts` | 修改 | 新 reason `'segment'`、`options.companion` |
| `src/components/video/timeline/store/slices/historySlice.ts` | 修改 | undo / redo 运行 companion；带 companion 的记录不撤回 |
| `src/components/video/timeline/domain/services/HistoryService.ts` | 修改 | `peekUndo` / `peekRedo`；type 新增 `'TRACK_RENAME'` |
| `src/components/video/timeline/store/actions/trackActions.ts` | 修改 | `renameTrackAction` |
| `src/components/video/timeline/store/index.ts` | 修改 | 导出新 action |
| `src/components/video/timeline/domain/services/ItemPlacementService.ts` | 修改 | 抽出并导出 `computeAppendStart`（行为不变） |
| `src/components/video/timeline/Track.tsx` | 修改 | 轨道名就地编辑、空轨折叠细条、`DropHintBadge` 挂载 |
| `src/components/video/timeline/TrackNameEditor.tsx` | 新增 | 轨道名编辑输入框 |
| `src/components/video/timeline/EmptyTrackStrip.tsx` | 新增 | 折叠细条 |
| `src/components/video/timeline/DropHintBadge.tsx` | 新增 | 落点提示 |
| `src/components/video/timeline/hooks/useEmptyTrackExpansion.ts` | 新增 | 按工程保存展开状态（localStorage） |
| `src/components/video/hooks/useSegmentCommands.ts` | 新增 | 规划 → 确认 → 应用 → 脚本补丁；注册 companion 恢复器 |
| `src/components/video/hooks/useSegmentVoiceGeneration.ts` | 新增 | 从 ScriptPanel 迁出的逐段 TTS（音色 / 语速 / hash / 失败 / 进度） |
| `src/components/video/ScriptPanel.tsx` | 修改 | 调用新 hook；删除确认改为新对话框；默认音色读写 content |
| `src/components/video/VideoEditingInterface.tsx` | 修改 | 调用一次 `useSegmentCommands`；Provider；`canvasSettings` / `defaultVoiceId` 接线（接线放进 `useWorkbenchWiring`） |
| `src/components/video/workbench/useWorkbenchWiring.ts` | 修改 | 比例与适配从 content 读写（替代 `useState('16:9')`） |
| `src/components/video/components/SegmentCard/SegmentCard.tsx` | 修改 | 候选提示条、错误行、拖动手柄、drop target |
| `src/components/video/components/SegmentCard/VoiceCandidateBanner.tsx` | 新增 | 候选提示条 |
| `src/components/video/components/SegmentCard/SegmentErrorRow.tsx` | 新增 | 失败原因 + 只重试本段 |
| `src/components/video/components/SegmentCard/SegmentVoiceOverride.tsx` | 新增 | 本段音色 / 语速行 |
| `src/components/video/components/SegmentCard/SegmentMoreMenu.tsx` | 修改 | 润色、上移 / 下移、配音版本子菜单、应用新配音 |
| `src/components/video/components/SegmentCard/SegmentCardList.tsx` | 修改 | 重排拖放、插入线、批量待应用提示 |
| `src/components/video/components/SegmentCard/useSegmentReorderDrag.ts` | 新增 | 手柄拖动与键盘重排 |
| `src/components/video/components/SegmentCard/DefaultVoiceBar.tsx` | 修改 | 修改默认音色的询问；L-2 |
| `src/components/video/components/SegmentDialogs/VoiceDurationDialog.tsx` | 新增 | 时长变化三选一 |
| `src/components/video/components/SegmentDialogs/SegmentImpactDialog.tsx` | 新增 | 通用影响说明 / 批量应用 / 重排降级 |
| `src/components/video/components/SegmentDialogs/SegmentDeleteDialog.tsx` | 新增 | 删除段落确认 |
| `src/components/video/components/SegmentDialogs/DefaultVoiceChangeDialog.tsx` | 新增 | 默认音色变更询问 |
| `src/components/video/components/SegmentDialogs/BatchFillScopeDialog.tsx` | 新增 | 批量补齐作用范围 |
| `src/components/video/components/MaterialsPanel/MaterialMoreMenu.tsx` | 修改 | 「替换第 N 段画面」 |
| `src/components/video/components/VideoPlayerPanel/CanvasMenu.tsx` | 修改 | 画面适配分组 |
| `src/components/video/playback/videoFit.ts` | 新增 | `computeVideoFitRects` |
| `src/components/video/playback/CanvasCompositor.ts` | 修改 | 视频层按适配方式绘制 |
| `src/components/video/playback/useCompositionTransport.ts`（或 layer 构建处） | 修改 | 注入 `fit` |
| `src/components/video/hooks/useVideoExport.ts` | 修改 | 传 `fit_mode`；接入提示面板 |
| `src/lib/api/videoComposition.ts` | 修改 | `VideoCompositionRequest` 类型新增可选 `fit_mode`（RV2-17） |
| `src/components/video/hooks/exportAdvisories.ts` | 新增 | 提示项计算 |
| `src/components/video/workbench/ExportPreflightSheet.tsx` | 新增 | 导出前检查面板 |
| `src/components/video/workbench/EditorTopBar.tsx` | 修改 | 导出按钮挂载预检面板 |
| `src/components/video/workbench/collectActiveTasks.ts` | 修改 | 逐段进度、失败行 |
| `src/components/video/workbench/TaskCenterButton.tsx` | 修改 | 进度百分比、`onRetrySegmentVoice` |
| `src/components/video/workbench/inspector/SegmentInspector.tsx` | 修改 | 本段音色 / 语速字段 |
| `src/components/video/workbench/inspector/inspectorSelection.ts` | 修改 | L-4 |
| `src/components/video/hooks/useSegmentAudition.ts` | 修改 | L-1 |
| `src/components/video/projects/hooks/useProjectAutosave.ts` | 修改 | L-3 |
| `src/components/video/components/ContentPolishModal/ContentPolishModal.tsx` | 修改 | `mode='segment'` |
| `src/components/video/components/AiGenerateMenu/AiGenerateMenu.tsx` | 修改 | 「批量补齐缺失内容…」 |
| `src/components/video/hooks/useAgentExecution.ts` | 修改 | `editorContext` |
| `src/app/api/video-editing-agent/chat/route.ts` | 修改 | 读取并注入 `editorContext` |
| `src/stores/editorFocusStore.ts` | 修改 | `segmentVoiceErrors` / `segmentVoiceProgress` / `dismissedCandidateIds` |
| `src/types/index.ts` | 修改 | 新可选字段（§6） |
| `src/lib/i18n.ts` | 修改 | `workbench.segmentCommands.*` 等（中 / 英两套齐全） |
| `src/styles/editor-workbench.css` | 修改 | 提示条、drop 态、插入线、空轨细条、落点徽标 |
| `tailwind.config.js` | 修改 | L-5 |
| `backend-services/basic-service/app/models/video_models.py` | 修改 | `fit_mode` |
| `backend-services/basic-service/app/services/composition/video_scaling.py` | 修改 | 三种适配 |
| `backend-services/basic-service/app/services/composition/filtergraph_builder.py` | 修改 | 调用 `build_fit_fragment`，blur 时断链接入子图（RV2-08） |
| `backend-services/basic-service/app/services/video_composition_service.py` | 修改 | 把 `fit_mode` 传入 `calculate_scaling_params` / `build_video_filter` 与 composition context（调用点签名不变） |
| `backend-services/basic-service/tests/fixtures/fit-cases.json` | 新增 | TS / Python 共享的几何用例（RV2-15） |
| 各模块 `__tests__/` 与 `backend-services/basic-service/tests/` | 新增 | 见 §7 |

---

## 5. 接口设计

### 5.1 前端 hook 与 context

```ts
// hooks/useSegmentCommands.ts
export interface UseSegmentCommandsOptions {
  getSegments(): ScriptSegment[];            // = scriptSegmentsRef.current
  commitSegments(next: ScriptSegment[]): void; // = commitNarrationSegments
  getMaterials(): MaterialItem[];
  addMaterial(material: MaterialItem): void;   // 供替换时写段落戳副本
}
export interface SegmentCommands {
  applyVoice(segmentId: string, candidateId?: string): void;   // 打开时长对话框或直接应用
  applyAllPendingVoices(): void;
  replaceVisual(segmentId: string, materialId: string): void;
  remove(segmentId: string, opts: { removeTimelineItems: boolean }): void;
  previewRemoval(segmentId: string): SegmentImpact | null;     // 删除对话框用
  move(segmentId: string, toIndex: number): void;
  /** 当前打开的对话框状态，供 SegmentDialogsHost 渲染。 */
  dialog: SegmentDialogState;
  closeDialog(): void;
}
export function useSegmentCommands(opts: UseSegmentCommandsOptions): SegmentCommands;
export const SegmentCommandsContext: React.Context<SegmentCommands | null>;
```

`SegmentDialogState` 是一个判别联合：`{kind:'none'} | {kind:'voice-duration', plan, adjustPlan, keepPlan?} | {kind:'impact', title, lines, confirmLabel, onConfirm} | {kind:'delete', segmentId, impactWith, impactWithout}`。所有对话框由 VEI 中唯一的 `SegmentDialogsHost` 渲染（放在 `workbench/` 下，VEI 只加一行 JSX）。

```ts
// hooks/useSegmentVoiceGeneration.ts
export type VoiceGenerationOutcome = 'ok' | 'failed' | 'skipped' | 'discarded';
export function useSegmentVoiceGeneration(opts: {
  taskId: string; segmentsRef: MutableRefObject<ScriptSegment[]>;
  defaultVoiceId: string; onAddMaterial(m: MaterialItem): void;
  onSegmentsTouched?(segments: ScriptSegment[]): void; // 仅 autoGeneratePrompts 仍需
}): { convert(segment: ScriptSegment): Promise<VoiceGenerationOutcome>;
      convertMany(ids: string[]): Promise<{ ok: number; failed: number }>;
      convertingIds: ReadonlySet<string> };
```

### 5.2 store

```ts
applySegmentCommandAction(get, plan): { ok: true; recorded: boolean } | { ok: false; reason: 'edit-locked' | 'invalid' };
replaceTimelineAction(get, data, reason: ReplaceTimelineReason | 'segment', options?: { companion?: HistoryCompanion }): boolean;
renameTrackAction(get, trackId: string, name: string): void;
registerCompanionRestorer(fn: CompanionRestorer): () => void;

// editorFocusStore 新增
segmentVoiceErrors: ReadonlyMap<string, string>;
segmentVoiceProgress: ReadonlyMap<string, number>;
dismissedCandidateIds: ReadonlySet<string>;
setSegmentVoiceError(id: string, message: string | null): void;
setSegmentVoiceProgress(id: string, value: number | null): void;
dismissCandidate(materialId: string): void;
// reset() 同时清空这三项
```

### 5.3 REST

| 接口 | 变化 |
|---|---|
| `POST {BACKEND}/api/video/compose`（导出所用的现有合成端点，经 `useVideoExport`） | 请求体新增可选 `fit_mode: "contain" \| "cover" \| "blur"`，缺省为 `"contain"`。响应不变 |
| `POST /api/video-editing-agent/chat`（Next BFF） | 请求体新增可选 `editorContext: { selectedSegmentId: string\|null; segmentLabel: string\|null; segmentRange: {start:number; end:number}\|null }`。响应不变 |
| `POST /api/tts/convert-sentences` | 不变（`speed_ratio` 字段已存在，现在会传入非 1.0 的值） |
| `POST /api/content-polish-multiple` | 不变 |

实现者在 `useVideoExport.ts` 中以实际使用的端点路径为准。本节只约束「新增一个可选字段、缺省等于今天的行为」。

---

## 6. 数据模型

### 6.1 持久化（`project_data` JSON，全部是可选字段，不改数据库）

```ts
interface ScriptSegment {
  // …既有字段不变
  voiceId?: string;              // 本段音色；缺省 = 全片默认
  voiceSpeed?: number;           // 0.8–1.2；缺省 = 1.0
  appliedVoiceMaterialId?: string; // 用户明确应用到时间轴的配音素材 id
  appliedVoiceAt?: string;       // 应用时刻（ISO）；用于判定候选是否比已应用的更新（RV2-03）
}
interface VideoEditingTaskContent {
  // …既有字段不变
  defaultVoiceId?: string;       // 缺省 = 'zh_male_shaonianzixin_uranus_bigtts'
  canvasSettings?: {
    aspectRatioId?: string;      // 缺省 '16:9'
    fit?: 'contain' | 'cover' | 'blur'; // 缺省 'contain'
    dismissedAdvisories?: Array<'subtitle-none' | 'letterbox'>;
  };
}
```

- `TrackData.name`：已有字段，重命名时写入，不新增字段。
- 素材 `metadata` 新增 `voice_speed?: number`（TTS 生成时写入）。`segment_text_hash` 的**语义**改为「请求时的文案 hash」，字段不变。
- 需要确认 `normaliseProjectDataForSave` 不会丢弃未知的顶层键：`defaultVoiceId` / `canvasSettings` 必须和 `scriptSegments` 一样被保存。若该函数使用白名单，就把这两个键加入白名单；uiState 持久化会丢弃未知键（`types/index.ts:298` 的注释），所以**不能**放在 `uiState` 里。测试 T-PERSIST-1 守门。
- 后端数据库：**无变化**。`project_data` 是 JSON 列，新键透明存取。

### 6.2 内存

- `editorFocusStore`：新增的三个字段（§5.2），不持久化。
- 历史项 payload：`{ reason: 'segment', companion: { kind: 'script-ops', ops } }`。只存在于内存中的历史栈；`ops` 里的 `ScriptSegment` 是深拷贝（`structuredClone`），避免后续编辑改到历史快照。
- localStorage：`ecliptrix.timeline.expandedEmptyTracks.<projectId>` → `string[]`（轨道 id）。

---

## 7. 测试与验收

### 7.1 自动化测试清单（每个 bug 修复都附带以行为命名的回归测试）

| ID | 文件 | 断言 |
|---|---|---|
| T-CMD-VOICE-1 | `segmentCommands.voice.test.ts` | 变长 2s：旁白被替换，后续段落相关轨道后移 2s，本段画面延长 2s，总时长 +2 |
| T-CMD-VOICE-2 | 同上 | 变短 1.2s + adjust：后续前移，本段画面裁短；keep：不平移，旁白尾部留空 |
| T-CMD-VOICE-3 | 同上 | 本段未上时间轴：插在前一段区间终点，后续内容后移 |
| T-CMD-VOICE-3b | 同上 | 本段只有画面、没有旁白：候选放在本段区间起点，按区间长度计算 delta（RV2-09） |
| T-CMD-VOICE-4 | 同上 | 候选 stale → `candidate-stale`，tracks 未被改动 |
| T-CMD-VOICE-5 | 同上 | stale 候选在 `allowStale: true` 时可以应用（恢复旧版，RV2-02） |
| T-CMD-SHIFT-UNIFORM | `segmentCommands.tracks.test.ts` | delta<0 时各轨道使用同一个截断值；跨越片段会被挤压时返回 `interleaved`（RV2-12/13） |
| T-CMD-BGM | `segmentCommands.tracks.test.ts` | 不含段落片段的音频轨在四种命令下都保持原对象引用 |
| T-CMD-LOCK | 同上 | 锁定轨道原样保留，并列入 `lockedTrackNames` |
| T-CMD-VISUAL-1/2/3 | `segmentCommands.visual.test.ts` | 长素材裁剪 / 短素材循环铺满 / 图片单段；其他轨道不变；总时长不变 |
| T-CMD-VISUAL-4 | 同上 | 区间被占用 → `span-occupied`；无区间 → `not-on-timeline` |
| T-CMD-VISUAL-5 | 同上 | 无戳素材 → 只在新片段写 `linkedSegmentId`，素材不变；带本段戳 → 直接用；带别段戳 → 生成副本，原素材和别段归属不变（RV2-04） |
| T-CMD-REMOVE-1/2 | `segmentCommands.remove.test.ts` | 移除本段片段（字幕按起点归属），不平移后续；`removeTimelineItems=false` 时轨道不变 |
| T-CMD-REORDER-1/2 | `segmentCommands.reorder.test.ts` | 三段交换后块内偏移和块间空隙保持；交错 → `interleaved` |
| T-CMD-REORDER-3 | 同上 | 所有段落都不在时间轴：`ok`，`tracks === baseTracks`，只有 `reorder` 补丁（RV2-10） |
| T-AUTOMIX-UNCHANGED | 既有 `planScriptAutoMix` 测试 | 抽出 `fillSpanWithMaterial` 后全部通过，无需修改 |
| T-HIST-1 | `historyCompanion.test.ts` | `applyScriptOps` forward / inverse 互逆；inverse 保留命令之后的文字编辑 |
| T-HIST-2 | `historySlice.companion.test.ts` | 带 companion 的记录在轨道不变时不被撤回；undo 调用恢复器（inverse），redo 调用恢复器（forward）；编辑锁下两者都不调用 |
| T-HIST-3 | `replaceTimeline.test.ts` 追加 | 无 companion 且轨道相等时仍返回 false（行为不变） |
| T-HIST-4 | `applySegmentCommand.test.ts` | 规划后时间轴被改动 → `stale-plan`，轨道与历史都不变（RV2-05）；锁定时只改脚本的 plan 不写历史、脚本照常更新，改轨道的 plan 被拒绝（RV2-07） |
| T-HIST-5 | `historyCompanion.test.ts` | 恢复器读取最新的 commit 函数（重渲染后换了函数，撤销调用的是新函数）；StrictMode 顺序「注册 A → 注销 A → 注册 B」后 B 仍有效，A 的迟到注销不会清掉 B（RV2-06） |
| T-VOICE-HASH | `useSegmentVoiceGeneration.test.ts` | `segment_text_hash` 取请求时的值；回包前文案被修改 → 提示 + 候选 stale |
| T-VOICE-DELETED | 同上 | 回包前段落被删除 → 候选不入库，结果为 `discarded` |
| T-VOICE-BATCH-FAILCOUNT | 同上 | 批量中 1 段失败 → 汇总为「成功 2 / 失败 1」 |
| T-VOICE-OVERRIDE | 同上 | 请求使用 `segment.voiceId ?? default` 和 `voiceSpeed ?? 1` |
| T-VOICE-DURATION-WRITE-KEPT | 同上 | 生成后 `segment.duration` 仍按今天的逻辑写成新配音时长（I-11，RV2-01） |
| T-LINKS-DURATION-RANGE-FIRST | `segmentLinks.test.ts` 追加 | 有时间轴区间时卡片时长取区间；无区间时与今天相同（字段 → 配音） |
| T-LINKS-APPLIED | `segmentLinks.test.ts` 追加 | 旁白为 `appliedVoiceMaterialId`（旧版本）时 voiceOnTimeline 为 `current`；`candidate` 派生正确；音色 / 语速不一致时判为 stale；旧素材没有 `voice_speed` 时不判 stale；恢复旧版（`appliedVoiceAt` 晚于 latest 的 `segment_assigned_at`）后 `candidate` 为 null，之后新生成的配音重新成为候选（RV2-03） |
| T-UI-BANNER | `VoiceCandidateBanner.test.tsx` | 正常 / 过期 / 未上时间轴三种文案与按钮 |
| T-UI-DURATION | `VoiceDurationDialog.test.tsx` | 影响说明行、三选项、Esc 关闭且不应用 |
| T-UI-DELETE | `SegmentDeleteDialog.test.tsx` | 分轨计数、复选框默认勾选、无片段时隐藏 |
| T-UI-REORDER | `useSegmentReorderDrag.test.ts` | 只有从手柄开始才拖动；Alt+↑ 在输入框中不触发 |
| T-UI-DROP-SEG | `SegmentCard.drop.test.tsx` | 视频显示「松开以替换第 2 段画面」；音频显示禁止 |
| T-FIT-1 | `tests/composition/test_video_scaling_fit.py` | `contain` 时两个分支的输出与改动前逐字符相等 |
| T-FIT-2 | 同上 + `videoFit.test.ts` | 12 个几何用例 TS / Python 矩形误差 ±1px（共享 JSON fixture `backend-services/basic-service/tests/fixtures/fit-cases.json`，两边测试都读取它，RV2-15） |
| T-FIT-3 | `tests/composition/test_fit_render.py`（需要 ffmpeg，缺失时 skip 并注明原因） | 三种模式导出帧与由 fixture 几何生成的参考帧的平均误差 < 6/255（RV2-16） |
| T-FIT-4 | `tests/composition/test_filtergraph_fit.py` | `filter_complex` 路径：contain 链逐字符不变；cover 运镜位于 crop 之后；blur 子图标签唯一且可被 ffmpeg 解析（RV2-08） |
| T-TRACK-RENAME | `trackActions.rename.test.ts` | 改名可撤销；空名恢复默认；导出 JSON 使用新名 |
| T-EMPTY-TRACK | `EmptyTrackStrip.test.tsx` | 空图片轨折叠；有内容时强制展开；localStorage 抛错时仍能渲染 |
| T-DROP-HINT | `computeAppendStart.test.ts` | 提示时间与实际落点一致 |
| T-EXPORT-ADV | `exportAdvisories.test.ts` | 五类提示的触发条件；dismissed 项不出现；阻断路径不变 |
| T-AG-1 | `route.editorContext.test.ts` | 无 `editorContext` 时提示词逐字不变；有值时追加上下文段 |
| T-PERSIST-1 | `normaliseProjectDataForSave.test.ts` | `defaultVoiceId` / `canvasSettings` 被保存并能读回；连续两次写入不同字段都被保留（RV2-18） |
| T-L1..L5 | 各自文件 | 遗留问题的回归测试 |

### 7.2 静态与质量门

1. 基线：在 `feab883` 上记录 `npm test`（R1 结束时为 392 个文件 / 2918 条用例，0 失败）、`npm run type-check`（0）、改动文件 eslint（0 error）、后端 `pytest tests/`（沿用 R1 的差分判定：失败集合不得扩大）。
2. 实施后：vitest 0 失败且只增不减；tsc 0；改动文件 eslint 0 error（单文件 lint 需要 `ESLINT_USE_FLAT_CONFIG=false`）；`npm run build` exit 0；后端新测试全部通过，既有测试失败集合不变。
3. 规模门：三个大文件净增 ≤ 0；`grep -rn "useSegmentCommands(" src --include=*.ts* | grep -v __tests__` 结果为 1；`grep -rn "applySegmentCommandAction(" src | grep -v __tests__` 只出现在 `useSegmentCommands.ts`。
4. 对比度：新组件只使用 R1 已实测达标的 `--ws-*` token。新增的提示条底色 `--ws-primary-bg` 上的文字使用 `--ws-primary-text`，用 R1 的对比度脚本复测深浅两套主题。
5. 热区：新按钮 ≥ 32px（拖动手柄的可点击区域为 24×32，满足 WCAG 2.2 最低 24px，并在注释中说明原因）。

### 7.3 手工验收（`desktop/ npm run dev`，1600×900 与 1024×768；打包版验收前必须先 `prepare-frontend`）

1. **主任务**：按 §3.14 A 完整走一遍。验收点：全程能看出当前是第 2 段；没有重跑整个项目；时长对话框的影响说明与实际结果一致；导出成片使用新配音和新画面；Ctrl+Z 两次恢复原状。
2. 生成期间修改文案 → 出现「此配音基于上一版文案」，并且无法应用。
3. 断网后更新第 2 段配音 → 卡片保留失败原因 → 恢复网络后「只重试本段」成功；任务中心能看到失败行和重试按钮。
4. 修改全片默认音色 → 出现询问；选择「仅用于后续生成」后，已有配音不变。
5. 设置第 3 段单独音色 → 芯片变为「配音待更新」，生成使用新音色。
6. 删除第 2 段（勾选移除片段）→ 素材库文件仍在 → 在第 1 段输入文字 → Ctrl+Z → 第 2 段文字和片段都恢复，第 1 段新输入的文字保留。
7. 把第 3 段拖到第 1 位 → 画面、旁白、字幕一起移动，背景音乐不动；锁定主画面轨后再拖 → 出现「仅调整脚本顺序」选项。
8. 竖屏素材在 16:9 画布上分别使用三种适配，预览与导出成片目视一致；旧工程打开后默认为「保持完整」，画面与之前相同。
9. 重命名「旁白」轨为「女声旁白」→ 导出时间轴 JSON 中的名字一致；空字幕轨折叠后可展开。
10. 拖素材到轨道上时出现「追加到末尾 · 时间」，与松手后的实际位置一致。
11. 导出前检查：有未应用的配音时出现面板；「仍然导出」可以继续；素材丢失时仍然像今天一样被阻断。
12. AI 助手在选中第 2 段时发送「把这一段的画面换成更明亮的」→ 后端日志中提示词包含第 2 段上下文。
13. 在任意输入框中按 Space / Alt+↑ / Ctrl+Z：不会触发时间轴或重排操作（Ctrl+Z 执行的是输入框自身的撤销）。

---

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | companion 恢复器与用户后来的脚本编辑冲突（例如撤销「删除段落」时，同 id 段落已被 Agent 重新生成） | 段落重复或位置错乱 | `applyScriptOps` 是幂等的：插回时 id 已存在就跳过；reorder 只排序当前存在的 id。T-HIST-1 覆盖这些情况 |
| R-2 | Agent 生成脚本时使用位置式 id（`agent-segment-0`），重新生成后旧素材挂到新段落上（R1 R5 / IF-15） | 规划器把别段的片段当作本段 | 配音用 `segment_text_hash` 双重校验（stale 候选不能应用）；画面仍按 id 关联，这是已知风险，在影响说明中列出段落标签，用户可以在确认前看到。长期方案（持久 id）不在本轮 |
| R-3 | 平移算法与用户手工布局冲突（片段间有刻意留下的空隙或重叠） | 布局被意外改变 | 只平移 `oldEnd` 之后的片段、保持相对间距；变短时截断到不重叠；锁定轨道不动；每次都只产生一条历史，可一键撤销 |
| R-4 | 画布适配预览与导出不一致 | 违反 round 3 的硬约束 | T-FIT-2 共享 fixture + T-FIT-3 像素比对；`contain` 分支逐字符不变（T-FIT-1）；blur 参数由像素比对校准，不靠目测 |
| R-5 | blur 模式导出变慢 | 长视频导出时间增加 | 仅在用户选择时生效；在 CanvasMenu 说明中注明「导出稍慢」；性能数据记录到运行日志 |
| R-6 | 段落失败原因不持久化，重开工程后消失 | 用户看不到之前的失败 | 这是有意的取舍（原因通常是临时的）；配音芯片仍会如实显示「未生成 / 待更新」，信息不会丢失 |
| R-7 | `handleConvertToSpeech` 迁移到 hook 时破坏 `autoGeneratePromptsForSegment` 等副作用 | 画面描述不再自动生成 | 两步迁移：先原样搬迁并跑全量测试，再改行为；保留 `onSegmentsTouched` 回调 |
| R-8 | （v2 已消除）v1 计划停止写 `segment.duration`，会改变 `useAIVideoScriptGeneration` 等下游的取值 | AI 视频生成时长变化 | v2 保留写入（I-11），只把卡片显示改为区间优先；T-VOICE-DURATION-WRITE-KEPT 守门 |
| R-9 | `normaliseProjectDataForSave` 丢弃新的顶层键 | 设置不持久化 | T-PERSIST-1 |
| R-10 | 段落卡同时作为素材 drop target 和重排拖动源，两种拖拽互相干扰 | 误操作 | 使用两种不同的 MIME；drop 处理先判断 MIME；重排只从手柄开始 |
| R-11 | 三个大文件的规模门 | 实现受阻 | 所有新增逻辑放在新 hook / 组件中；VEI 只增加 Provider、Host 和一次 hook 调用，用删除迁出代码的行数抵消 |
| R-12 | 桌面走查多轮没有执行（R1、r2、r3 都遗留） | 真机问题无法发现 | §7.3 为本轮的**必做**门禁；下游节点如果无法执行，必须在报告中明确写「未执行」，不得宣称完成验收 |

---

## 9. 实施顺序（每一步都保持可运行、可测试）

> v2：步骤按 §2.4 交付分档推进。A 档（S1、S2、S3、S5、S6、S12，对应下面第 1–8 步和第 14 步中的 L-1..L-5）全部通过门禁后，再进入 B 档（第 9、10 步及第 7 步中的重排）与 C 档（第 11–13 步）。任何一档未完成时，如实报告，不得宣称全部完成。

1. **基线**（§7.2 第 1 项），记录到运行日志。
2. **纯函数层**：`fillSpanWithMaterial`（并让 `planScriptAutoMix` 改用它，跑 T-AUTOMIX-UNCHANGED）→ `segmentCommandGeometry` → `segmentCommands` 四个规划器 → `formatSegmentImpact`，以及对应测试。
3. **历史 companion**：`HistoryService.peek*` → `historyCompanion.ts` → `historySlice` / `replaceTimelineAction` → `applySegmentCommandAction`，跑 T-HIST-*。
4. **派生层**：`segmentLinks` 的 applied / candidate / 音色 stale 判定，跑 T-LINKS-*。
5. **配音生成迁移**：原样把 `handleConvertToSpeech` 搬进 `useSegmentVoiceGeneration`（跑全量测试）→ 修改 hash / 音色 / 语速 / 失败 / 进度 / 批量计数。
6. **`useSegmentCommands` + `SegmentDialogsHost` + 各对话框**，接入 VEI（Provider + 1 次调用 + 注册恢复器）。
7. **段落卡**：候选提示条、错误行、本段音色、⋯ 菜单扩展、删除对话框、拖动手柄与重排、drop target。
8. **素材区**：⋯「替换第 N 段画面」。
9. **音色**：`defaultVoiceId` 持久化、`DefaultVoiceChangeDialog`、全部应用。
10. **画布适配**：`videoFit.ts` + CanvasCompositor → 后端 `video_scaling` / `filtergraph_builder` / 模型 → `useVideoExport` 传参 → CanvasMenu → T-FIT-*。
11. **时间轴**：轨道改名、空轨折叠、落点提示。
12. **导出前检查**、任务中心进度与重试。
13. **AI**：润色本段、批量补齐、`editorContext`。
14. **遗留问题 L-1..L-5**、i18n 中英补齐、CSS 清理、§7.2 全部门禁、§7.3 手工验收。

---

## 10. 本轮之后仍不做（记录备查）

| 事项 | 原因 |
|---|---|
| 时间轴插入 / 覆盖拖放模式 | 会改变现有拖放行为；需要单独设计指针定位与冲突规则 |
| 任务取消 | 后端与第三方（ARK）不支持；「暂不应用」已经保证生成结果不会自动改动工程 |
| 片段级锁定 | 需要新的领域字段和 UI；本轮以轨道锁代替 |
| 段落持久 id（修复 Agent 位置式 id 的误关联） | 涉及 Agent 脚本生成协议 |
| 生成结果并排对比 | 本轮只提供候选试听和恢复上一版 |
| 「收藏」分类、「模板」入口 | 产品还没有对应功能 |
| 画面「批量补齐」自动匹配 | 会覆盖手工选择的画面，需要逐段决定 |

---

## 评审结论（Review Verdict）

**有条件通过（v2）。**

核心设计成立：纯函数规划器 + 唯一写入口 + 历史 `companion` 可以直接建在现有 store 上（`recordAction` 已有 payload 通道，`replaceTimelineAction` 已具备编辑锁、拖动取消、视图标志保留和空操作不记历史这些保护），新增持久化字段全部可选，数据库不变，画布适配以 `contain` 逐字符不变作为零回归守门。评审未发现 P0；11 个 P1（RV2-01 至 RV2-11）已全部改入正文，其中 RV2-01（`segment.duration` 下游依赖）和 RV2-07（编辑锁下删除段落）两项直接关系到「不能影响功能」这条硬约束。

放行条件（下游实现与验收节点必须满足）：

1. **功能保全优先**：I-1 至 I-11 逐条勾选。特别是 I-11（`segment.duration` 写入保持不变）、I-4（锁定期间只改脚本的命令仍可用）、T-FIT-1 / T-FIT-4 中 `contain` 逐字符不变，任何一条不满足都不得合入。
2. **按 §2.4 分档交付**：A 档必须完整交付；B / C 档未完成的项在报告和 §10 中如实列为「未交付」，不得半成品合入。
3. **新增测试实际运行**：§7.1 中 v2 新增的 T-CMD-VOICE-3b / 5、T-CMD-SHIFT-UNIFORM、T-CMD-VISUAL-5、T-CMD-REORDER-3、T-HIST-4 / 5、T-VOICE-DURATION-WRITE-KEPT、T-LINKS-DURATION-RANGE-FIRST、T-FIT-4 必须实现并运行通过；§7.2 的基线差分门禁（vitest 0 失败、tsc 0、改动文件 eslint 0 error、`npm run build` 通过、后端失败集合不扩大）必须留下运行记录。
4. **桌面手工验收**：§7.3 是本轮必做门禁（R-12）。无法执行时必须在报告中写明「未执行」及原因，不得宣称通过验收。
5. **P2 实现注意事项**：RV2-18（写回 content 时读取最新值）和 RV2-19（blur 预览性能采样记入运行日志）在实现时一并落实。


## 实施过程发现的方案缺陷

- IF-TL-1（S9，落点提示时间格式）：§3.10 示例写作 `00:25.60`，实现复用时间轴现有的 `formatTimelineTime(t, { showMs: true })`（与 R1 `DragTimeBadge` 一致），不足 1 小时显示为 `0:25.60`。若必须两位分钟，应统一改该格式器而不是另起一个。
- IF-TL-2（S9，重命名写入方式）：`Track` 实体的 `name` setter 会对锁定轨道抛 `TrackLockedError`，与「锁定轨道也允许改名」冲突。`renameTrackAction` 因此走 `exportToData → 改 name → importFromData`（与 `addTrackAction` 同一模式），不直接改聚合内的实体；撤销/重做与编辑锁行为按规格实现。
- IF-TL-3（S9，折叠细条的轨道头）：20px 放不下 22px 的轨道头按钮，折叠时轨道头只保留图标与名称（仍可双击改名），锁定/删除等按钮需先展开细条才可用。规格未给出折叠后重新收起的入口：本轮不提供；已展开的空轨 id 会一直记住，未展开过的轨道在内容被删空后会再次折叠。
- IF-TL-4（S9，工程 id 来源）：Track 拿不到工程 id，只能由 `TimelinePanel` 的 `taskId` 经 `TrackContainer` 透传（`TimelinePanel` 把新 prop 写在已有的一行上，净增 0 行）。`taskId` 缺省为 `'timeline'`，未传 taskId 的宿主会共用该键。
- IF-TL-5（S9，轨道高度）：`TrackContainer` 仍按「可用高度 / 轨道数」计算统一的轨道高度，折叠的轨道也计入分母，所以折叠只会在底部腾出空白，其它轨道不会随之变高。如需让其它轨道吃掉空余高度，需要改 `TrackContainer` 的高度计算（本轮未做）。
- IF-TL-6（S9，拖放提示并存）：R1 已有的轨道居中叠层（「拖放到 X」/「轨道已锁定」/「不兼容」）被 `Track.materialDrop.test.ts` 钉住，本轮保留；`DropHintBadge` 作为额外的指针跟随提示叠加显示。折叠细条上不显示居中叠层，只显示跟随提示。
- IF-TL-7（S9，样式归属）：`.ws-track-name-input`、`.ws-empty-track-strip`、`.ws-drop-hint-badge`、`.ws-drop-hint-badge--refused` 的样式需由 `editor-workbench.css` 的负责人合入；合入前细条是浏览器默认按钮样式（提示徽标已内联 `position: fixed` 与 `pointer-events: none`，不会打乱布局）。
- IF-FIT-1（S8，函数名）：后端不存在 `calculate_scaling_params`，实际函数是 `video_scaling.calculate_video_scaling`（服务包装 `_calculate_video_scaling`）。本轮在其上加 `fit_mode='contain'` 参数：`contain` 返回与改动前完全相同的字典；`cover` / `blur` 在其上追加 `cover_*` 矩形与 `fit_mode` 键。另新增 `camera_frame_size` / `fit_content_rect` / `fit_background_rect` 供服务与测试读取几何；`cover` 的运镜帧尺寸改为画布尺寸（运镜在 `crop` 之后）。
- IF-FIT-2（S8，异常类型）：`VideoProcessingError` 是 Pydantic 模型（`video_models.py:496`），不是异常。新增 `app/services/composition/canvas_fit.py::CanvasFitError(ValueError)`；`_normalize_video` 捕获后返回 `retryable: False` 的失败结果，走现有的规范化失败 / 导出错误路径，不重试、不静默降级为 contain。
- IF-FIT-3（S8，filter_complex 实际不走 fit）：生产路径调用 `build_filtergraph(..., pre_trimmed=True)`（`video_composition_service.py:331/346`），片段在 `-vf` 规范化阶段就已完成缩放与适配，filter_complex 中的 fit 步骤只在 `pre_trimmed=False` 时生成。`build_fit_fragment` 与 blur 断链接线已按 §3.9.3 实现并由 T-FIT-4 守门（含 ffmpeg 解析），但真正决定成片效果的是 `-vf` 路径（T-FIT-3 覆盖）。仓库没有独立的 composition context 对象，`fit_mode` 通过 `build_filtergraph(fit_mode=...)` 进入新增的 `ChainContext`（同时把 `_append_clip_chain` 的参数压到 5 个）。
- IF-FIT-4（S8，同比例源）：源与画布比例差 < 0.01 时（与 `fitSourceInFrame` / `calculate_video_scaling` 的既有容差一致），`cover` / `blur` 与 `contain` 输出同一个直接缩放串，预览也直接铺满画框、不画模糊底，三种方式效果相同（与菜单说明一致）。
- IF-FIT-5（S8，blur 串细节）：`-vf` 路径的前景用 contain 的显式尺寸 `scale=sw:sh`；filter_complex 路径不知道源尺寸，前景用 `scale=W:H:force_original_aspect_ratio=decrease`。`overlay=(W-w)/2:(H-h)/2` 中的 `W/H/w/h` 保留为 ffmpeg 变量而非数字代入；σ 按 `20×H/1080` 输出为最多 4 位小数（1080→`20`，1920→`35.5556`）。子图内部标签：`-vf` 用 `[bg][fg][bgb][fgs]`，filter_complex 用 `f{i}_fit_` 前缀，断链标签为 `f{i}_pre` / `f{i}_fit`。
- IF-FIT-6（S8，预览模糊边缘）：canvas `blur()` 会把图像自身边缘模糊成透明（ffmpeg `gblur` 复制边缘像素），直接绘制会在画框边缘出现暗晕。预览把背景矩形按原比例各边外扩 2σ 再绘制（仅影响被模糊的背景，1080p 下约放大 4%），前景几何不变。
- IF-FIT-7（S8，cover + 运镜预览）：运镜 crop 以「裁切后的画框」为基准归一化，预览用 `visibleSourceWindow` + `cropInSourceWindow` 把它映射回整段源坐标；`assembleLayers` 在 `cover` 下把运镜的 `frameAspect` 设为输出画框比例（与导出运镜帧 = W×H 一致）。3D 降级路径的仿射近似在整段源坐标内夹取，极端运镜下可能取到可见窗口外少许像素（仍被画框裁掉）。
- IF-FIT-8（S8，透明度与 blur）：导出在「背景+前景合成之后」再施加片段透明度 / 淡入淡出；预览对背景和前景分别用同一 `globalAlpha` 绘制，淡变过程中前景下方会透出少量背景，稳定段（opacity=1）无差异。未纳入自动门禁，归入 §7.3 目视验收。
- IF-FIT-9（S8，RV2-19 性能采样）：`BlurBackgroundPainter` 用 `performance.now()` 统计每 30 帧均值（只能测到 CPU 提交耗时，GPU 端滤镜开销可能延后结算），首个窗口和触发降级时各 `console.info` 一次；均值超过 4ms 后本实例永久切换为 1/4 离屏降级。jsdom 下离屏 canvas 不可用时自动回到直接绘制。
- IF-FIT-10（S8，接线）：§3.9.2 写的「由 `useCompositionTransport` 注入」与代码不符——该 hook 不构建图层。实际链路：`VideoPlayerPanel` 新增可选 prop `canvasFit` → `useCompositionPlayback({ videoFit })` → `MultiTrackAttachDeps.getVideoFit`（每帧读取，改值不重挂引擎，暂停时经新增的 `engine.repaint()` 立即重绘）→ `assembleLayers({ videoFit })` → 视频层 `fit`。`VideoEditingInterface` 给 `<VideoPlayerPanel canvasFit={canvasSettings?.fit}>` 传值、`useVideoExport` 在请求中带 `fit_mode`、`CanvasMenu` 的选项，均属其他负责人的文件，本切片未改。
- IF-TL-7 / IF-FIT-10 已闭环（主实现节点）：S9 的四个样式类已合入 `src/styles/editor-workbench.css` 末尾；`VideoEditingInterface` 已给 `VideoPlayerPanel` 传 `canvasFit` / `onCanvasFitChange`（来自 `useWorkbenchWiring` 的 `canvasSettings`），`useVideoExport` 请求带 `fit_mode`（仅在非 `contain` 时写入，`contain` 请求与改动前逐字节相同），`CanvasMenu` 已新增「画面适配」分组与「画布 16:9 · 保持完整」触发文案。
- IF-1（§3.2.3 `fillSpanWithMaterial` 的抽取形态）：`planScriptAutoMix` 铺满的是「本段视频列表」按顺序循环（多素材），规格说的共享函数是单素材。为保证一键成片输出逐位不变（I-3），把**算法**抽成 `coverSpanWithSources(sources, start, span)`（多素材，原样搬迁），`fillSpanWithMaterial(material, track, start, span)` 是它的单素材 + 建片段包装；`planScriptAutoMix` 调用前者。既有 `planScriptAutoMix` 测试未改动全部通过。
- IF-2（§3.2.3 变短时的画面裁剪 / 变长时的延长基准）：规格写「从尾部裁掉 −delta / 最后一个画面延长 delta」。实现以「本段画面的并集终点 ve」为基准，把画面终点移到 `ve + delta`（素材剩余长度不够时用本段第一个画面素材 `fillSpanWithMaterial` 补足）。统一平移值被其它轨道截断（RV2-12）时，画面按请求值裁剪，可能留下 < |delta| 的小空隙；影响说明中的时长变化仍按请求值显示。
- IF-3（§3.2.2 平移的「钉住片段」）：本段自己的片段（含按起点归属的字幕、刚放入的候选配音、延长后的画面）一律不参与平移与「跨越片段」判定，否则本段的长字幕 / 长画面会让变短时被误判为 `interleaved`。但它们仍参与「统一可行值」的计算（RV2-12），例如本段字幕尾部超过新终点时，后续内容只能前移到字幕尾部为止。
- IF-4（§3.6 替换画面的「副本 id」）：`handleAddVideosToSegment` 今天是用**原 id** 覆盖素材库条目（addOrReplace），并非「副本」。`stampMaterialForSegment` 保持该行为不变（不传 copyId）；只有「替换画面」遇到带**其他段落**戳的素材时才传入新 id（`<原id>_seg_<时间戳>`）生成真正的副本（RV2-04）。
- IF-5（§3.4.2「配音版本」子菜单）：`SegmentMoreMenu` 没有子菜单能力，实现为 ⋯ 菜单中的一组平铺项（分隔线后，最多 5 条，当前版本置灰显示「当前配音 · 时间 · 时长」，旧文案版本带「（基于旧文案）」）。行内「试听」未做：候选试听走卡片提示条，旧版本试听需先「使用此版」再在时间轴试听（可撤销）。
- IF-6（§3.4.2 提示条底色 token）：规格写 `--ws-primary-bg`，该 token 在 `editor-workbench.css` 中不存在。改用 R1 已实测对比度的 `--ws-selected-bg` 底 + `--ws-text` 字；过期态用 `--ws-warn-bg` + `--ws-warn`，失败态用 `--ws-danger-bg` + 图标 `--ws-danger`。
- IF-7（§5.1 接口扩展）：`UseSegmentCommandsOptions` 增加 `getLinks()`（候选、序号来自唯一派生）与 `getDefaultVoiceId()`；`SegmentCommands` 增加 `requestRemove`（打开删除框）、`chooseVoiceDuration`、`patchSegment` / `getSegment` / `getDefaultVoiceId`（供属性页的「本段音色」使用，不经 VEI 透传 props，满足 VEI 净增 ≤ 0）。`SegmentLinksValue` 增加可选的 `voiceVersionsById`。`SegmentImpact` 增加 `keptLockedItems` 与 `gapSeconds`（删除确认框需要）。`SegmentCommandPlan` 增加 `addedMaterials`（RV2-04 的副本在应用前加入素材库）。
- IF-8（§3.4.4 / §3.5 跨面板触发配音生成）：逐段 TTS 归 ScriptPanel 所有，而「任务中心 › 重试」「属性页 › 按新设置重新生成」「修改默认音色 › 重新生成 N 段」「批量补齐」都在别处触发。新增 `editorFocusStore.voiceRequest`（`requestSegmentVoice(ids)` + nonce），由 `useScriptVoiceFlows` 在下一次渲染后执行，保证与同一次点击中的设置变更（如新默认音色）一起生效。
- IF-9（§3.4.1 stale 判定的音色比较）：旧工程没有持久化的 `defaultVoiceId`，今天的面板音色可能是任意值。为不让旧工程的已生成配音突然全部变成「待更新」（I-1），只有在段落设置了 `voiceId` 或工程已持久化 `defaultVoiceId` 时才比较 `voice_type`；语速缺省视为 1.0。
- IF-10（§3.4.1 `isVoiceStale` 比较对象变化的可见影响）：按规格改为「时间轴上正在使用的配音」后，R1 测试 `voice_on_timeline_outdated_when_newer_voice_only_in_library` 的期望由 `ready` 变为 `stale`（时间轴上播放的是旧文案配音），同时新配音作为候选出现；该测试已按规格更新并在注释中说明。
- IF-11（§3.8 键盘重排）：`Alt+↑/↓` 只挂在拖动手柄上（手柄是 24×32 的 button），输入框里不会触发（I-9）；⋯ 菜单另有「上移 / 下移」。
- IF-12（§3.9.1 同比例说明行）：`CanvasMenu` 拿不到当前内容的比例，「当前画面与画布比例一致，三种方式效果相同」这一行未显示（i18n 已备好 `canvasFit.sameRatio`）；同比例时三种方式的实际效果确实相同（IF-FIT-4）。
- IF-13（§3.11 「打开画布设置」）：导出前检查面板与画布菜单不在同一组件树，「打开画布设置」通过点击 `.ws-canvas-trigger` 打开菜单实现。
- IF-14（§3.12 Agent 上下文）：`editorContext` 只注入到 Thinking 阶段的提示词（规格 §3.12 所述位置）；Agent 主体提示词未改动。字段缺省时提示词逐字不变（T-AG-1）。路由文件不能导出非 HTTP 方法，拼接逻辑放在 `src/lib/video-editing-agent/editorContextPrompt.ts` 并单测。
- IF-15（测试文件划分）：§7.1 的 `segmentCommands.visual/remove/reorder.test.ts` 合并在 `segmentCommands.tracks.test.ts`；T-UI-DURATION / T-UI-DELETE 在 `SegmentDialogs/__tests__/SegmentDialogs.test.tsx`；T-UI-DROP-SEG 追加在既有 `SegmentCard.test.tsx`（jsx preserve 下组件测试须走 compile harness）；T-L1..L5 在 `workbench/__tests__/r1Leftovers*.test.ts` 与 `VoiceSelector.test.tsx`。
