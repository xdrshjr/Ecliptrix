# 多关键帧运镜曲线与舞台直接取景（Camera Motion v3 — Keyframe Curves & Direct Framing）设计方案 v2

> **文档版本：v2**（v1 → v2 为设计评审后的修订版；修订清单见下方「评审记录」，
> 结论见文末「评审结论」）
>
> 迭代：3/3　　上游：`docs/plans/camera-motion-2d-3d/spec.md`（v1，已发布 `4497eab`）、
> `docs/plans/camera-motion-stills-and-hardening/spec.md`（v2，已发布 `f4510cd`）
>
> 编号沿用前两轮，不重置：决策 **D30+**、风险 **R29+**、放行条件 **C20+**、验收 **A31+**。
> 前两轮的 D1–D29 / R1–R28 / C1–C19 / A1–A30 **全部继续有效**，本轮不推翻其中任何一条。
> v2 新增：决策 **D42–D46**、风险 **R39–R41**、放行条件 **C29–C32**、验收 **A45–A46**、
> 用例 **T18–T22**。

---

## 评审记录（Review Notes）

> 评审时间：2026-08-05　评审对象：本文档 v1　评审方式：**逐节对照真实代码**
> （所有行号、函数名、字段名均已在 `M:/takoAI/Ecliptrix` 工作区核对，非凭印象）。
> 维度：可行性 / 完整性 / 一致性 / 规模适配。
>
> **结论摘要**：方案的地基（D32 的 τ 解耦、D37/D38 的零回归双闸、D33 的 `at` 一参二用、
> D41 的分割免重基）是正确的，FFmpeg 结论**有可复现探针支撑**，这是三轮里第一份把
> 「性能预算该花在哪」用实测数字回答清楚的设计。评审发现的问题集中在**两端不对称**
> （前端改了、后端同一处没改）与**面板与既有代码的物理约束**（画布尺寸、被动 wheel、
> 擦洗条坐标系）两类，共 **3 个 P0 / 10 个 P1 / 9 个 P2**。
> **全部 P0 与 P1 已在本 v2 的正文内直接修订**，P2 记录在案（其中 P2-1/P2-2/P2-6/P2-7
> 顺手一并改了，其余作为实施注意事项）。

### P0（必须修，否则功能会「看起来能用、实际悄悄错」或整次导出失败）

| # | 位置 | 问题 | 修订 |
|---|---|---|---|
| **P0-1** | §4.2.5 / §5.3 第 21 条 | **恒等判据只推广了前端，后端漏了。** §4.2.5 明确点名 `identity.ts:32` 必须重写，但 §5.3 给 `camera_motion.py` 列的 7 项改动里**没有 `is_identity_camera_motion`**（实际在 `camera_motion.py:485`，只读 `start`/`intensity`/`end`）。而它是 `build_camera_filter_chain:692` 与 `build_still_overlay_plan:889` **两个入口的第一道门**。后果：一条「首尾默认、中间关键帧推到 2×」的曲线，前端预览正常播放，后端直接返回空链——**预览有、成片没有，且没有任何 warning**。这正是本文档自己命名的「第一颗地雷」，只是踩在了另一端 | §4.2.5 增补 Python 侧同款推广；§5.3 第 21 条加入第 ⑧ 项；T4 拆成 T4a（TS）/T4b（Py）；C22 改为「两端都有专门用例」 |
| **P0-2** | §6.3 / R30 / T11 | **pydantic 的字段级约束先于 `model_validator(mode="after")` 触发，R30 在给定写法下不可能成立。** 真实的 `CameraKeyframe`（`video_models.py:127-133`）每个分量都带 `Field(ge=…, le=…)`；`CameraKeyframeStop(CameraKeyframe)` 继承这些约束，再叠一个 `at: Field(..., ge=0, le=1)`。一条 `at: 1.4` 或 `scale: 9` 的坏关键帧会在**解析 `CameraMotion.keyframes` 的字段阶段**就抛 `ValidationError`，`mode="after"` 根本没机会跑 → **整个 `/api/video/compose` 返回 422**，正是 R30 想避免的事。T11 按现写法必然红 | §6.3 改为 `mode="before"` 的 `field_validator("keyframes")` 做规范化（在字段校验前把原始 list 清洗成合法值），`CameraKeyframeStop` 的分量**不继承约束**、只在 before 阶段夹取；`mode="after"` 只留「镜像/顺序」这类不会失败的不变量。新增 D42 |
| **P0-3** | §4.4.4 | **一级降级把自己刚产生的 warning 扔了。** 伪码是 `warnings.append(...)` 之后 `return build_camera_filter_chain(...)`——递归调用返回的是**一个全新的 warnings 列表**，于是「曲线过长已降级为两点」这条文案，连同本次调用里早已累积的能力缺失/拟合失败 warning（`no zoompan`、`3D degenerated`、`fit error`），**一起消失**。G5 承诺「每级降级都产出一条可见 warning」，v1 的 P0-3 就是同一个坑 | §4.4.4 改为显式 `chain2, w2 = build_camera_filter_chain(..., allow_collapse=False)` → `warnings.extend(w2)` → `return chain2, warnings`；T10 增加「warnings 同时包含降级文案与降级前已有文案」断言 |

### P1（必须修，否则会出现可见的画面缺陷、无法满足放行条件，或交互达不到「顶级」标准）

| # | 位置 | 问题 | 修订 |
|---|---|---|---|
| **P1-1** | D33 / §4.2 | **101 点均匀 τ 采样在多关键帧下不再命中轨迹极值。** `rollPadForMotion`（`cameraGeometry.ts:70`）、`coverScaleForMotion`（`:255`）、`_needs_zoom_segment`（`camera_motion.py:588`）、`_needs_roll_segment`（`:599`）都按 `i/100` 采样。今天轨迹是一条直线，极值必在 τ∈{0,1}，**恰好都在网格上**，所以是精确的。有了中间关键帧，极值落在**内部 stop** 上，而 `MIN_KEYFRAME_GAP=0.02` 允许一段只覆盖 2 个网格点。后果不是精度问题而是**可见缺陷**：`rollPad` 取小 → `rotate` 露黑角（v1 D13 实测的 YAVG 16 就是这个现象）；`coverScale` 取小 → 3D 四边形盖不住画面，边缘出现黑楔。D33 只论证了「τ 覆盖 [0,1]」，没论证「网格命中极值」 | 新增 D43 与 §4.2.7 `trajectorySamples(motion)`：按**段**均匀采样并**必含每个 stop**；2 stop 时逐字退化为 `[0,1/100,…,1]`（D37 得以保持、黄金向量零漂移）。四个采样点全部改走它，两端逐字镜像。新增 T18 |
| **P1-2** | §5.1 第 4 条 | `hasClampedComponent` 只说「改为走轨迹」，没说采样集。它默认 `samples=20`，同样会漏掉内部 stop → 面板的「已被范围夹住」提示对曲线时灵时不灵（T17 会假绿） | 同样改用 `trajectorySamples`；§5.1 第 4 条与 T17 写明 |
| **P1-3** | §4.5.1 | **擦洗条与关键帧轨不是同一个坐标系，「等宽同刻度、加在正下方」是假的。** `MotionPreviewStage.tsx:227` 把滑块 `u` 映射到 **clip 时间**（`tLocal = u * clipDuration`），而 `at` 是**运镜窗口内**的归一化时刻。只要用户用了自定义 `startOffset`/`duration`（面板里就有这两个控件），两条轴就错位；更糟的是把播放头拖到窗口**之外**再按 `[+]`，解析出的 `at` 被夹成 0 或 1，与锁死的首尾帧撞车——要么静默无效，要么把首帧的取景改掉 | §4.5.1 重写坐标契约：擦洗条上高亮出**运镜窗口段**，关键帧轨与该段等宽对齐；`[+]` 的 `at` 一律经 `progressAt` 换算；播放头在窗口外、或换算结果距已有 stop < `MIN_KEYFRAME_GAP` 时 `[+]` 禁用并给 `title` 说明。新增 D44、A45 |
| **P1-4** | §4.5.2 | **舞台的 CSS 尺寸不是 480×270，用常量做指针换算必然手感失真。** 画布的**后备存储**是 `STAGE_W/H = 480×270`，但它以 `className="w-full"` + `style={{aspectRatio:'16/9'}}` 布局（`MotionPreviewStage.tsx:296-301`），实际 CSS 宽度随面板/视口变化。若 `panDelta(dx,dy,crop,480,270)` 直接吃常量，拖动灵敏度会**随窗口宽度漂移**，且在窄屏上错得最厉害 | §4.5.2 写死两条：SVG 覆盖层用 `viewBox="0 0 480 270"` 画（分辨率无关）；**指针换算一律用 `getBoundingClientRect()` 的实测尺寸**。T14 增加「实测矩形 ≠ 后备存储」用例 |
| **P1-5** | §4.5.2 | **滚轮缩放会同时滚动面板。** React 把 `wheel` 注册为 **passive**，`onWheel` 里 `preventDefault()` 无效；而面板主体是 `overflow-y-auto`（`CameraMotionModal.tsx:261`）。结果是「滚轮缩放」每一下都伴随面板滚动——这在「符合人机交互最佳实践」的验收下不可接受 | §4.5.2 明确：wheel 必须用 ref + `addEventListener('wheel', h, { passive: false })` 原生注册并在卸载时移除，不得用 `onWheel`。新增 A46 |
| **P1-6** | §5.2 第 15 条 | **「把当前解析出的 `ResolvedCameraDraw` 通过回调交给父级」会让面板每帧重渲染。** 舞台现有实现刻意把播放头**直接写 DOM**以保证动画期间零 React 渲染（`MotionPreviewStage.tsx:320-322`）。每帧回调等于把这层优化全部作废（60Hz × 整个面板子树）。而且覆盖层**根本不需要每帧数据**：它画的是**选中关键帧**的取景框与整条静态路径，两者只在编辑时变 | §5.2 第 15 条改为「只增加覆盖层插槽（children）与一次性的 `stageRect` 上报」；覆盖层自行 `useMemo(motion, selectedIndex, rect)` 求解。新增 D45 |
| **P1-7** | §5.4 / C27 | **两处 `resolveCameraDraw` 的「影子实现」不在变更计划里，导致 C28 不可达、C27 自相矛盾。** ① `backend-services/basic-service/tests/test_camera_motion.py` 的 `_wire_from_camel`（字段白名单，不含 `keyframes`）与 `_resolve`（用 `ease(u)+keyframe_at` 手写了一遍解析链）——它就是 `CAMERA_GOLDEN_REQUIRED=1` 的黄金向量消费者，不改则新增用例两端必然对不上；② `splitRebase.test.ts:19` 的 `keyframeAt(motion, easedProgressAt(...))` 同理。而 C27 写的是「既有预览测试一个断言都不用改」，这两处**必须**改 | §5.4 增补第 37 条（`tests/test_camera_motion.py`）并更新文件计数；C27 增加显式豁免清单（只有这两个手写解析助手可改，改别的即视为 D32 被破坏） |
| **P1-8** | §4.4.2 / §6.3 | **`expand_stops` 的 Python 输出契约没定义，`_piecewise_expr` 直接下标取值会 500。** 伪码写 `stops[i][key]` / `stops[i]["at"]`，但入参可能是 pydantic 的 `CameraKeyframeStop`（属性而非下标）、也可能缺分量。一次 `KeyError`/`TypeError` = `/api/video/compose` 500，与 G5「运镜永不导出失败」直接冲突 | §6.3 给 `expand_stops` 定死返回契约：**一律返回 `_keyframe_dict()` 归一后的 snake_case 纯 dict + `at` + `easing`**，且是链构造器读 stops 的**唯一**入口。C23 的「唯一写入闸」在后端对应「唯一读取闸」 |
| **P1-9** | §7.3 / §7.4 | **`max_keyframes` 是个死旋钮，且 loader 默认值重蹈 v1 覆辙。** 方案把 8 这个上限落在前端常量与 pydantic 校验器里，两者都**看不到 YAML**；运维把 `max_keyframes` 调成 4 不会有任何效果。另外 `load_camera_config`（`camera_motion.py:134-152`）是逐字段手写回退，v1 评审抓到过的 `supersample` 默认值不一致就是这么来的，新增两个字段有同样风险 | §7.4 给 `max_keyframes` 指定真实执行点（`expand_stops` 内截断）；§5.3 第 21 条 ⑦ 补「loader 回退值必须与 dataclass 默认逐字相同」；新增 T19「裁剪过的 YAML 与没有 YAML 行为完全一致」 |
| **P1-10** | §4.6 | **反向的缓动镜像会静默改变两点运镜的行为，G4 未给豁免。** 今天 `reverseCameraMotion`（`cameraPresets.ts:99-106`）只交换 `start`/`end`，**不动 `easing`**。§4.6 的规则在 `n=2` 时等价于 `motion.easing := mirror(motion.easing)`，即同一个「反向」按钮在本轮之后产出不同结果，而 G4 ①（存储 JSON 逐字符相同）没有为它开口子 | §4.6 明确：**镜像只在存在曲线（stops > 2）时生效**，2 stop 走今天的原样交换；T9 拆成两条；「2 点反向也应镜像缓动」作为独立后续项记入 §13（它是 v1 的遗留缺陷，值得单独改 + 单独基线，不适合搭本轮零回归的车） |

### P2（记录在案，不阻塞放行）

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| **P2-1** | §4.2.6 | 指纹的消费者是 **4 个**不是 2 个：`useTimelineComposition.ts:63`、`useCompositionPlayback.ts:611`（暂停时立即重绘）、`cameraGeometry.ts:322`（常量 memo）、`CameraMotionModal.tsx:143-151`（脏检查 → A44 的二次确认）。四者都被 §4.2.6 的改动自动覆盖，但枚举错了容易被后人「优化」掉一个 | **已在 v2 §4.2.6 改正**并补 T20 |
| **P2-2** | §5.2 第 19 条 | `src/lib/i18n.ts` 有**三处**要改：`Translations` 接口（文件开头的类型声明）、英文块、中文块。漏掉接口是 `tsc` 硬失败 | **已在 v2 §5.2 写明** |
| **P2-3** | D40 / §7.3 | 表达式增长是**约 5 倍**而不是线性：`z_expr` 被内联进 `x_expr`/`y_expr` 各两次（`camera_motion.py:755-759`），于是 scale 的分段串在一条 zoompan 里出现 5 次。这正是 M1 实测 n=8 → 8.9KB 的来源。20000 这个数要按「组装后的整条链」理解，不能按「单分量 × 8」估 | **已在 v2 §4.4.4 注明** |
| **P2-4** | §4.4.4 | 若降级后的两点链**仍**超长（实践中不可能，但代码要有确定行为）：不再降级，原样返回，交给 `video_composition_service.py:791` 既有的「returncode≠0 则去掉 camera_chain 重试」兜底 | **已在 v2 §4.4.4 注明** |
| **P2-5** | §4.4 | `_dry_run_cache` / `_caps_cache`（`camera_motion.py:223`）是**无上限 dict**，键是整条滤镜串。多关键帧让不同串的数量成倍增长，长驻后端进程会缓慢涨内存；每条新曲线还多付一次 0.1s 子进程 | 实施时给 `_dry_run_cache` 加 LRU 上限（128），或明确接受并记录 |
| **P2-6** | §5.4 第 30 条 | 黄金向量 fixture 用的是**前端 camelCase**（`camera-golden.json` 里是 `rotateX`），Python 侧靠 `_wire_from_camel` 转换。新增的 `keyframes` 用例必须沿用 camelCase，转换在 P1-7 补的那一处做 | **已在 v2 §5.4 写明** |
| **P2-7** | §5.4 | 漏了两个直接相关的既有测试：`TimelineRepository.cameraMotion.test.ts`（工程存取往返）与 `CompositionAdapter.cameraMotion.test.ts`（wire 装配）。注意 `TimelineRepository.ts:291` 保存端是**原样透传** `item.cameraMotion`，所以 D38「老工程存回去逐字节相同」完全依赖 store 里永不出现平凡 `keyframes`——这条不变量目前没有任何往返测试守着 | **已在 v2 §5.4 补第 38/39 条**并新增 T21 |
| **P2-8** | §5 抬头 | 文件计数（「36 个文件」）在补齐上述条目后需要更新 | **已在 v2 §5 更新为 39** |
| **P2-9** | A38 | ≤1px 判据在分段边界处最脆弱：`at` 以 6 位小数进表达式，`lt()` 的比较可能把边界那一帧划进相邻段。因为两段在边界点上连续，误差有界（不超过一帧的运动量），但 A38 的取样时刻**不要正好落在 `at` 上** | **已在 v2 A38 注明** |

### 评审确认「没有问题」的部分（避免下游返工去「补」不存在的坑）

- **D32 / T1 恒等式**：对照 `easing.ts:117-128` 与 `camera_motion.py:331-340` 逐项验算，
  `raw = start + (end−start)·I·τ` 与 §4.2.3 的推导**逐字相同**，恒等式成立。
- **D33 的覆盖性**：`tauAtProgress` 在每段内单调、段间在 `at` 处接续，故 τ 满射到 [0,1]。
  覆盖性没问题，**命中极值**才是问题（P1-1）。
- **D41 分割免重基**：`splitRebase.ts:31-37` 只动 `startOffset`、`duration` 原样传递，
  `at` 相对窗口 → 两半自动同曲线。推导正确。
- **§4.4.2 的分段表达式**：嵌套顺序（`expr = seg(n-2)` 后从 `i=n-3` 向下包）展开后
  与 `keyframe_at_trajectory` 逐段一致；`clip()` 放在最外层符合「先插值后夹」。
- **持久化不需要白名单改造**：`TimelineRepository.ts:291` 保存原样透传、`:417` 载入过
  `sanitizeCameraMotion`，`CameraMotionData` 只是 `CameraMotion` 的别名
  （`domain/types.ts:30`），没有第二份结构体要同步。
- **预设/模式切换**：`applyPreset`/`emptyCameraMotion` 返回的对象不含 `keyframes`，
  面板的 `{...next, intensity, easing, …}` 展开天然丢弃旧曲线，§5.2 第 17 条的要求
  与现有代码是一致的，不需要额外防护。
- **FFmpeg 结论**：探针脚本 `probe_ffmpeg_piecewise.py` 真实存在且可独立运行，
  M1–M6 有据可查。这是本轮设计最扎实的一块。

---

## 0. 本轮迭代的定位（先读这一节）

前两轮已经把「运镜」这件事从零做到了**可用且两端一致**：

| 轮次 | 交付 | 提交 |
|---|---|---|
| v1 | clip 级运镜数据模型、共享数学内核（TS ⇄ Python 双份 + 黄金向量）、预览（Canvas/WebGL）、导出（zoompan / rotate / perspective）、面板与四个入口 | `4497eab` |
| v2 | 静帧（图片）运镜、唯一 overlay 构造器、能力探测 + lavfi 预检、warnings 全链路、降级角标 | `f4510cd` |

**今天缺的不是「能不能动」，而是「能不能编」。** 现状下一次运镜只有两个端点：
`start` 与 `end`，中间由 `easing` 一条曲线连起来（`easing.ts:117` 的
`keyframeAt` 就是 `start + (end−start)·intensity·e`）。这意味着用户能表达的运动
只有**一段单调直线**——「先推近再向左摇」「停一拍再拉开」这类最基本的镜头语言
根本写不出来。而面板里唯一能改取景的手段是四到七个数字输入框（`ParameterControls.tsx`
的 `KEYS_2D` / `KEYS_3D`），用户必须在脑子里把 `x=0.38` 翻译成画面位置——
这不是 Anthropic 顶级产品该有的交互密度。

因此本轮做三件事，且**只做这三件**：

1. **多关键帧曲线（G1）**——运镜从「两点一线」升级为「2–8 个关键帧的分段曲线」，
   每段有自己的缓动。预览与导出**同时**支持，不留单边。
2. **关键帧编辑器（G2）**——面板里新增一条关键帧轨，可在播放头处添加、拖动改时刻、
   删除、选中；参数区从「编辑 start/end」改为「编辑当前选中的关键帧」。
3. **舞台直接取景（G3）**——在面板的实时舞台上直接拖动取景、滚轮缩放、
   Shift 拖动改 roll / 环绕，并画出取景框与运动路径。数字输入框全部保留，
   作为无障碍与精确输入的正规通道。

外加一条贯穿始终的**收口（G4）**：本轮引入的每一处都必须保证
「≤2 关键帧的老运镜逐字符零回归」——老工程、老请求体、老滤镜串一个字节都不许变。

### 0.1 本轮**不重做**的东西（继承，禁止「顺手优化」）

- **数学契约**（v1 §4.2）的几何部分：`rollCover` / `computeCropRect` /
  `project3DCorners` / `coverScaleForQuad` / `affineApproxFromQuad`
  **零改动**。本轮只改「参数 → 关键帧」这一层，不碰「关键帧 → 像素」那一层。
- **D4 注入点**（`scale` 之后 `pad` 之前）、**D5/D13 覆盖常量取运镜级最大值**、
  **D16 静帧唯一构造器**、**D26 lavfi 预检**、**D27 单趟装配**：全部照旧。
- **`version: 1` 不升版**（见 D30）。
- 静帧链路（v2）除了透传新字段以外**不动**。

---

## 1. 概述（Overview）

本方案把 Ecliptrix 视频编辑器的运镜特效，从「起点 → 终点」的单段插值，
升级为**由 2 到 8 个关键帧串起来的分段运镜曲线**，并给面板补上一套
「看得见、抓得住」的直接编辑手感。数据模型上，`CameraMotion` 新增一个可选数组
`keyframes: CameraKeyframeStop[]`；每个关键帧携带自己在运镜窗口内的归一化时刻 `at`
（0..1）、七个取景分量（`scale/x/y/roll/rotateX/rotateY/dolly`），以及一条
**出向缓动** `easing`（管辖它到下一个关键帧之间那一段）。`start` / `end` 两个字段
**保留并继续作为首尾关键帧的镜像**，因此任何还不认识 `keyframes` 的代码路径
（旧版本客户端、旧工程 JSON、导出侧的降级分支）读到的仍是一条起止正确的直线运镜，
而不是一个坏掉的对象——这是本轮唯一的向后/向前兼容策略。

技术上最关键的一步，是把今天混在一起的两件事拆开：**「时间怎么走」与「取景怎么变」**。
现状的 `keyframeAt(motion, e)` 接收的是**已经缓动过**的进度 `e`，于是缓动与轨迹被绑死；
一旦有了多段，每段还各有各的缓动，这个签名就无法表达了。本方案引入一个中间量
**轨迹参数 τ**：`tauAtProgress(motion, u)` 负责「线性时间进度 u → τ」（这一步吃掉缓动），
`keyframeAtTrajectory(motion, τ)` 负责「τ → 关键帧」（这一步是纯几何的分段线性插值）。
对只有两个端点的老运镜，`τ = ease(u, motion.easing)`，而
`keyframeAtTrajectory(motion, τ) = start + (end−start)·intensity·τ` ——
**与今天的 `keyframeAt(motion, e)` 逐字相同**。这条恒等式是整个方案的地基：
它让 `rollPadForMotion` / `coverScaleForMotion` / `_needs_zoom_segment`
这些「按 101 采样求最大值」的存量函数**一行都不用改**，黄金向量也不会漂移。

导出侧，多关键帧被翻译成 FFmpeg 表达式里的**嵌套 `if` 分段函数**：
`if(lt(U,at₁), 段0, if(lt(U,at₂), 段1, … 段N−1))`，每一段内部是
`base_i + delta_i·ease_i(局部进度)` 的仿射式。3D 的四角轨迹继续走多项式拟合，
但改为**逐段拟合再嵌套**——因为分段路径在关键帧处有折角，整窗口一条三次曲线必然拟合失败。
这些 FFmpeg 行为不是推断，是在本机 FFmpeg（`2025-05-15-git-12b853530a-full_build`）
上**实测**过的：嵌套 `if` 在 `zoompan` / `rotate` / `perspective` 三个滤镜里都能跑，
表达式长到 9KB 仍然正常，而且——这是本轮最重要的一个实测结论——
**8 关键帧的分段表达式与 2 关键帧的耗时没有可测差异**（1080p/3s：0.75s vs 0.84s，
在噪声范围内）。也就是说，多关键帧在导出侧**几乎是免费的**，性能预算应当花在别处。

---

## 2. 目标与非目标

### 2.1 目标（Must）

- **G1** `CameraMotion` 支持 2–8 个关键帧；每段独立缓动；预览与导出结果一致
  （复用 v1 A6 的「同一帧偏差 ≤1px」判据）。
- **G2** 面板新增关键帧轨：播放头处添加、拖动改时刻、删除、选中高亮；
  参数区编辑「当前选中关键帧」；每段缓动可单独选择。
- **G3** 舞台支持直接操作：拖动改 `x/y`、滚轮改 `scale`、`Shift`+横拖改 `roll`
  （2D）/ 改 `rotateY`（3D）、`Shift`+纵拖改 `rotateX`（3D）；
  叠加显示取景框、四角线框（3D）与运动路径；**全部操作有键盘等价物**。
- **G4** **零回归**：≤2 关键帧的运镜，其 ① 存储 JSON、② 导出请求体、
  ③ FFmpeg 滤镜串、④ 预览绘制结果，与本轮之前**逐字符/逐像素相同**。
- **G5** 运镜永不导出失败：曲线过长 / 拟合失败 / 能力缺失 → 逐级降级
  （分段 → 两点 → 无运镜），每级都产出一条可见 warning（沿用 v2 的 status 通道）。

### 2.2 非目标（Out of scope，本轮明确不做）

- **N7** 不做**每分量独立曲线**（即 `scale` 与 `x` 各有一套关键帧）。
  本轮所有分量共享同一组时刻 `at`——这是「镜头关键帧」而非「属性关键帧」的模型，
  与剪辑软件里的「镜头运动」心智一致，也让 `coverScale` 仍能取一个运镜级常量（D5）。
- **N8** 不做**贝塞尔手柄**。缓动仍是四选一的枚举（`linear/easeIn/easeOut/easeInOut`），
  只是从「整条一条」细化到「每段一条」。自定义贝塞尔需要在 FFmpeg 表达式里写三次
  求根，收益远小于代价。
- **N9** 不做运镜模板库 / 收藏（v1 §12-3）、不做 AI 建议运镜（v1 §12-4）。
- **N10** 不升 `version`（见 D30），不引入任何数据库表、不引入任何 `NEXT_PUBLIC_` 开关
  （沿用 v1 D10 / v2 N4）。
- **N11** 不改主预览（时间轴）里的运镜交互——直接取景**只在面板舞台内**提供。
  在主预览上拖取景框会与既有的图片位置框拖拽（v2 N5）抢手势，属于另一轮的事。
- **N12** 不改 `jsx: "preserve"` 编译配置（v1 §14 I5 / v2 N6）：新增的面板组件
  **不做挂载测试**，可测逻辑一律抽成纯模块再测。

---

## 3. 关键设计决策（Decisions D30–D46）

| # | 决策 | 理由 |
|---|---|---|
| **D30** | **不升 `version`**：`keyframes` 作为 `version: 1` 上的**可选新增字段** | `sanitizeCameraMotion`（`wire.ts:114-117`）与 `resolveCameraDraw`（`:32`）都硬门 `version !== 1 → 丢弃`。升到 2 会让**所有存量工程的运镜被静默清空**。可选字段则天然双向兼容：旧代码读到新工程 → 忽略 `keyframes`，按 `start/end` 渲染一条直线（因为 D31 保证首尾镜像），是优雅降级而不是损坏 |
| **D31** | **镜像不变量**：`keyframes[0] ≡ start`、`keyframes[n−1] ≡ end`、`at[0] = 0`、`at[n−1] = 1`，由 `normalizeCameraKeyframes()` 在**每一次写入**处强制 | 这是 D30 能成立的唯一前提。任何一处允许首尾与 `start/end` 脱钩，"旧路径优雅降级"立刻变成"旧路径画错" |
| **D32** | **τ 解耦**：`tauAtProgress(u)` 吃缓动，`keyframeAtTrajectory(τ)` 只做几何；`keyframeAt` **保留为 `keyframeAtTrajectory` 的别名导出** | 让 `rollPadForMotion:67` / `coverScaleForMotion:252` / `_needs_zoom_segment` / `_needs_roll_segment` **无需改变语义**（它们采的仍是"整条轨迹的最大值"），黄金向量对老运镜零漂移。**修订（评审 P1-1）**：这四处的循环体不变，但采样**点集**要换成 D43 的 `trajectorySamples`——原因见 §4.2.7；2 关键帧下该点集与今天逐个元素相同，所以"存量 3D 运镜构图不漂移"这个核心保证依旧成立 |
| **D33** | **`at` 一参二用**：既是时间位置，也是轨迹位置 | 于是「按 τ 采样」覆盖的正是真实渲染到的整条轨迹（τ 在段内单调、段间接续，故满射到 [0,1]），D5/D13 的最大值求解语义无需改动。若让 `at` 只管时间、另设弧长参数，采样覆盖性就要重新证明。**注意区分"覆盖"与"命中极值"**：前者由本决策保证，后者由 D43 保证 |
| **D34** | **缓动挂在出向段**：`keyframes[i].easing` 管辖 `[i, i+1]`，最后一个关键帧的 `easing` 无意义（规范化时置 `undefined`） | 与今天 `motion.easing` 管辖 `start→end` 的语义一致，老数据展开成 2 段时 `keyframes[0].easing = motion.easing` 正好对上 |
| **D35** | **`intensity` 相对首帧**：`k(τ) = k₀ + (traj(τ) − k₀)·intensity` | 保持 v1 P1-2 的结论：`intensity = 0` 意味着"静止在起点框"，而不是"没有运镜"。多关键帧下唯一自洽的推广就是相对 `k₀` 缩放整条轨迹 |
| **D36** | **最多 8 个关键帧**（`CAMERA_MAX_KEYFRAMES = 8`），前端规范化截断、后端校验截断、面板加按钮到顶即禁用 | 实测 8 关键帧的 zoompan 表达式 ≈1.8KB、perspective 全八角 ≈6.8KB，都远在可用区；但 32 关键帧会到 9KB 且面板上那条 ~420px 的轨已经放不下可点的关键帧。8 是"交互能承受"而非"FFmpeg 能承受"的上限 |
| **D37** | **两点运镜逐字符零回归**：所有表达式构造器在 `len(stops) == 2 且 at == [0,1]` 时**走今天那条老代码路径**，而不是"分段代码恰好退化成同样的串" | v1 C8 / v2 C11 的教训：`clip((U-0)/1,0,1)` 与 `U` 数值相等但字符不同，一旦 wrap 进去，"无运镜/老运镜零回归"的比对闸就永久红掉，后续没人再敢信它 |
| **D38** | **wire 与持久化省略平凡 `keyframes`**：当 `keyframes` 恰好是 `start/end` 的 2 点镜像时，`toCameraMotionWire` 与工程序列化**不输出该字段** | 老工程存回去仍然逐字节相同；导出请求体不变，v2 §9.4 那条"命令行逐字符比对"的主判据继续可用 |
| **D39** | **3D 逐段拟合再嵌套**：`_build_perspective_segment` 对每一段各拟合一条三次多项式，再用 `if(lt(U,at_i),…)` 串起来 | 分段轨迹在关键帧处有折角，整窗口一条三次曲线必然超出 `max_fit_error_px` 而整体降级为 2D——那等于多关键帧对 3D 完全不可用。逐段之后每段仍是光滑单应，拟合难度不高于今天 |
| **D40** | **表达式长度闸**：新增 `max_expr_chars`（默认 20000，按实测 9KB 可跑、15KB 滤镜串可跑留足余量）。任一滤镜选项串超限 → **降级为 2 点运镜**并 warning，而不是放弃运镜、更不是让导出失败 | G5。降到 2 点仍保留用户设定的起止构图，是信息损失最小的一级降级 |
| **D41** | **分割不重基关键帧**：`rebaseCameraMotionForSplit` **不动 `keyframes`** | `at` 是**相对运镜窗口**的归一化量，而分割只搬动窗口原点（`startOffset`），窗口长度 `duration` 不变（`splitRebase.ts:31-37`）。因此两半自动继续走同一条曲线的不同区间。这是 v1「窗口用 clip 内相对时间表达」那条契约白送的红利，必须写成断言，别让后人"顺手补一段重基"把它弄坏 |

### 3.1 评审后新增决策（D42–D46）

| # | 决策 | 理由 |
|---|---|---|
| **D42** | **后端 `keyframes` 的清洗放在 `mode="before"`，不放 `mode="after"`** | 评审 P0-2：`CameraKeyframe`（`video_models.py:127-133`）每个分量都带 `Field(ge=…, le=…)`，子类 `CameraKeyframeStop` 继承之。pydantic 的**字段级校验先于** `model_validator(mode="after")`，所以一条 `at:1.4` 或 `scale:9` 的坏关键帧会在字段阶段就抛 `ValidationError` → 整个 `/api/video/compose` **422**，R30 想避免的正是这件事。清洗必须发生在字段校验**之前**，对着原始 list 做 |
| **D43** | **共享轨迹采样集 `trajectorySamples`**：所有"沿窗口求最大值/存在性"的函数改用它；2 关键帧时逐元素退化为今天的 `i/100` | 评审 P1-1。均匀网格在多关键帧下不再命中极值（内部 stop 才是极值点，而最短段只有 2 个网格点），导致 `rollPad`/`coverScale` 取小 → **黑角/黑楔**。见 §4.2.7 的完整推导与伪码 |
| **D44** | **关键帧轨的横轴 = 运镜窗口，擦洗条的横轴 = clip 时长；两者在 UI 上通过"窗口高亮段"对齐，而不是假装同一把尺** | 评审 P1-3。`MotionPreviewStage.tsx:227` 把滑块位置映射到 clip 时间，`at` 却是窗口内归一化量。自定义 `startOffset`/`duration` 时两轴必然错位，`[+]` 在窗口外会解析出 `at=0/1` 与锁死的首尾帧撞车 |
| **D45** | **覆盖层不订阅每帧数据**：它只依赖 `(motion, selectedStopIndex, stageRect)`，用 `useMemo` 求解 | 评审 P1-6。舞台刻意把播放头**直接写 DOM**以保证动画期间零 React 渲染（`MotionPreviewStage.tsx:320-322`）；把 `ResolvedCameraDraw` 每帧回调上去等于按 60Hz 重渲染整个面板子树。而覆盖层画的本来就是**静态**内容（选中帧的取景框 + 整条路径），不需要每帧 |
| **D46** | **反向的缓动镜像只对曲线（stops > 2）生效**，2 关键帧保持今天的"原样交换、不动 easing" | 评审 P1-10。G4 ① 承诺"≤2 关键帧的存储 JSON 逐字符相同"，而今天的 `reverseCameraMotion`（`cameraPresets.ts:99-106`）不动 `easing`。把镜像悄悄搭在本轮的车上，会让同一个「反向」按钮在升级前后产出不同结果，且没有基线守着。2 点反向该不该镜像是 v1 的遗留问题，列入 §13 单独处理 |

---

## 4. 技术设计（Technical Design）

### 4.1 分层：本轮只动中间那一层

```
   时间                     参数                     像素
 ┌─────────┐   u    ┌──────────────┐  keyframe  ┌──────────────┐
 │progressAt│──────▶│ tauAtProgress │──────────▶│ computeCropRect│
 │(窗口求解) │       │      ↓ τ      │           │ project3DCorners│
 └─────────┘       │keyframeAtTraj │           │ coverScale…    │
   ▲ 不变           └──────────────┘            └──────────────┘
   │                  ▲ 本轮全部改动在这里            ▲ 不变（v1 §4.2）
   └── v1 §4.2.1 窗口契约照旧（startOffset 可为负、explicit duration 不夹）
```

`resolveCameraDraw` 的改动只有一行语义替换：

```ts
// 之前
const e = easedProgressAt(motion, tLocal, clipDuration);
const k = keyframeAt(motion, e);
// 之后
const u   = progressAt(motion, tLocal, clipDuration);   // 线性进度，未缓动
const tau = tauAtProgress(motion, u);                   // 缓动在这里被吃掉
const k   = keyframeAtTrajectory(motion, tau);          // 纯几何
```

对**没有** `keyframes` 的运镜，`tauAtProgress` 返回 `ease(u, motion.easing)`，
`keyframeAtTrajectory` 返回 `start + (end−start)·intensity·τ`，
合起来与今天的 `keyframeAt(motion, easedProgressAt(...))` **逐位相同**。
这条恒等式必须落成单测（见 §9.1 T1）。

### 4.2 数学契约（增量部分）

沿用 v1 §4.2 的全部记号。新增两个函数，两端（TS / Python）各一份，逐字对应。

#### 4.2.1 展开：任何运镜都可视为一串 stops

```
expandStops(motion) -> [S₀, S₁, …, S_{n−1}]，n ≥ 2

若 motion.keyframes 存在且规范（见 §4.2.4）：
    S_i = motion.keyframes[i]
否则（老运镜）：
    S₀ = { at: 0, easing: motion.easing, ...motion.start }
    S₁ = { at: 1, easing: undefined,     ...motion.end   }
```

`expandStops` 是纯函数、无副作用、**不写回 motion**。所有下游一律先展开再算，
于是"老运镜"与"新运镜"在数学层面不再有分支——分支只存在于**字符串构造**
（D37）与**序列化**（D38）两处。

#### 4.2.2 时间 → 轨迹参数 τ

```
tauAtProgress(motion, u):
    S = expandStops(motion)
    u = clamp(u, 0, 1)
    找到 i 使 S_i.at ≤ u ≤ S_{i+1}.at         # u == 1 时取最后一段
    span = S_{i+1}.at − S_i.at                # 规范化保证 span ≥ MIN_KEYFRAME_GAP
    s    = clamp((u − S_i.at) / span, 0, 1)
    return S_i.at + ease(s, S_i.easing ?? 'easeInOut') * span
```

老运镜：`S = [{at:0, easing:motion.easing}, {at:1}]`，`span = 1`，`s = u`，
`τ = ease(u, motion.easing)`。✅ 与今天一致。

#### 4.2.3 轨迹参数 τ → 关键帧

```
keyframeAtTrajectory(motion, tau):
    S = expandStops(motion)
    I = clamp(motion.intensity, 0, 2)
    tau = clamp(tau, 0, 1)
    找到同样的 i（这次按 tau 找，网格同为 S.at —— D33）
    s = clamp((tau − S_i.at) / (S_{i+1}.at − S_i.at), 0, 1)
    对每个分量 key ∈ {scale,x,y,roll,rotateX,rotateY,dolly}:
        v = S_i[key] + (S_{i+1}[key] − S_i[key]) * s        # 纯几何轨迹
        raw = S₀[key] + (v − S₀[key]) * I                   # D35：相对首帧施加强度
        out[key] = clamp(raw, CAMERA_RANGES[key])           # 先插值后夹（v1 §4.2.2）
    return out
```

老运镜：`i = 0`，`s = τ`，`v = start + (end−start)·τ`，
`raw = start + (start + (end−start)·τ − start)·I = start + (end−start)·I·τ`。
✅ 与 `easing.ts:117-128` 现有实现逐项相同。

> **实现注记**：`keyframeAt(motion, e)` 继续导出，实现体改为
> `return keyframeAtTrajectory(motion, e)`，并在 doc 注释里写明
> "参数是轨迹参数不是时间"。**不要删除这个导出**——
> `cameraGeometry.ts:71,256`、`camera_motion.py:357,463,589,600,623` 六个调用点
> 依赖它，且它们的语义在 D32 下**恰好正确**。

#### 4.2.4 规范化（唯一写入闸）

```
normalizeCameraKeyframes(motion) -> CameraMotion
  1. 若 motion.keyframes 缺失/非数组/长度 < 2 → 删除该字段，原样返回（老运镜形态）
  2. 逐项：at 夹到 [0,1]；七分量按 CAMERA_RANGES 夹；mode==='2d' 时
     rotateX/rotateY/dolly 归零（与 wire.ts:63-67 的既有规则一致）
  3. 按 at 升序稳定排序
  4. 强制 at[0] = 0、at[n−1] = 1
  5. 相邻间隔 < MIN_KEYFRAME_GAP(=0.02) 的，删除后者（首尾除外；
     若删到只剩 2 个就停）
  6. 截断到前 CAMERA_MAX_KEYFRAMES(=8) 个（保留首尾：超限时从中间等距淘汰）
  7. 最后一个 stop 的 easing 置 undefined（D34）
  8. 回写镜像（D31）：start ← keyframes[0] 的七分量，
     end ← keyframes[n−1] 的七分量；motion.easing ← keyframes[0].easing
  9. 若规范化后恰为 2 个 stop 且 at == [0,1] → **删除 keyframes 字段**
     （D38：平凡曲线不落盘、不上线）
```

第 9 步是 D37/D38 零回归的机械保证：只要用户没有真的加出第三个关键帧，
数据结构就**回到今天的形状**，后面所有字符串比对自动成立。

#### 4.2.5 恒等（identity）判据的推广

`isIdentityCameraMotion` 必须重写为（`identity.ts:32`）：

```
S = expandStops(motion)
if S₀ ≠ DEFAULT_KEYFRAME: return false          # k(0) = S₀，非默认即有运镜
if |intensity| ≤ ε:       return true           # D35：轨迹被压成一点 S₀ = 默认
return 所有 S_i 都等于 DEFAULT_KEYFRAME          # 轨迹恒为默认才算恒等
```

推导：`k(τ) = S₀ + (traj(τ) − S₀)·I`。`∀τ: k(τ) = DEFAULT`
⟺ `S₀ = DEFAULT` 且（`I ≈ 0` 或 `traj ≡ S₀`）；而 `traj` 是过所有 `S_i` 的分段线性路径，
`traj ≡ S₀` ⟺ 所有 `S_i = S₀`。
**注意**：老运镜下这退化为"`start` 默认 且（`I≈0` 或 `end` 默认）"，
与 `identity.ts:32-38` 现状**完全一致**，无回归。

> ⚠️ **这是本轮第一颗地雷**：若沿用旧判据（只看 `start`/`end`），
> 一条 `start=end=默认` 但中间关键帧推到 2× 的运镜会被判成"无运镜"，
> 于是 `resolveCameraDraw` 返回 `undefined`、导出返回空链——
> **用户做的运镜在预览和成片里同时消失**，且面板里看得见。必须有专门用例（T4a/T4b）。

> 🔴 **同一处必须在后端同步推广（评审 P0-1）**。`is_identity_camera_motion`
> （`camera_motion.py:485`）是**两个导出入口的第一道门**：
> `build_camera_filter_chain:692` 与 `build_still_overlay_plan:889` 都以它开场，
> 返回 True 就直接给空链 / 静态叠加计划，**而且不产出任何 warning**（因为"用户没要运镜，
> 无需解释"）。只改前端会得到最难查的一类缺陷：**面板与主预览都在动，成片是静的，
> 状态里一句话都没有**。Python 侧改法与上面逐字对应：
>
> ```python
> def is_identity_camera_motion(motion) -> bool:
>     if motion is None:
>         return True
>     stops = expand_stops(motion)                      # §4.2.1 的 Python 镜像
>     if not keyframe_equals_default(stops[0]):
>         return False
>     intensity = float(_motion_field(motion, "intensity", 1.0))
>     if abs(intensity) <= KEYFRAME_EPSILON:
>         return True
>     return all(keyframe_equals_default(s) for s in stops[1:])
> ```
>
> 老运镜下 `stops = [start, end]`，退化为今天的 `start 默认 且（I≈0 或 end 默认）`，
> **逐字无回归**。注意 `keyframe_equals_default` 只看七个分量，`at`/`easing`
> 这两个多余键不参与比较（`_keyframe_dict` 的取值方式天然忽略它们）。

#### 4.2.6 指纹（change detection + memo key）的推广

`cameraMotionFingerprint`（`fingerprint.ts:27`）必须把 stops 编进去：

```
[...现有 9 段..., stopsPart].join('|')
其中 stopsPart = keyframes 缺失时为 ''，否则为
  keyframes.map(s => `${s.at.toFixed(4)}:${s.easing ?? ''}:${keyframePart(s)}`).join(';')
```

**`keyframes` 缺失时必须产出空串**，这样老运镜的指纹**逐字符不变**（D37）。

> ⚠️ **这是本轮第二颗地雷，且是 P0 级**：指纹有**四个**消费者（评审 P2-1 更正，
> v1 只列了两个）——
> ① `useTimelineComposition.ts:63` 的合成签名（v1 D12，改中间关键帧不进指纹 →
> **预览不重绘**，用户以为没生效）；
> ② `useCompositionPlayback.ts:611` 的 `cameraMotionSignature`（**暂停时**应用运镜要立刻
> 重绘的那条边沿；不进指纹 → 应用后画面纹丝不动，直到用户手动 seek）；
> ③ `cameraMotionConstants` 的 memo key（`cameraGeometry.ts:322`，
> 不进指纹 → **拿到上一条曲线的 `coverScale`/`rollPad`**，3D 构图直接错位）；
> ④ `CameraMotionModal.tsx:143-151` 的脏检查（不进指纹 → 只改了中间关键帧就直接关面板，
> **不会二次确认，改动静默丢失**，A44 假绿）。
> 四个都是"看起来能用、实际悄悄错"的类型。必须有专门用例（T5 + T20）。
> 四者都由本节这一处改动自动覆盖——**正因为如此，谁都不许给其中某一个"优化"出
> 一条不含 stops 的短路径**。

### 4.2.7 轨迹采样集 `trajectorySamples`（评审 P1-1，新增）

四个存量函数按 `i/100` 均匀采样求最大值：
`rollPadForMotion`（`cameraGeometry.ts:70`）、`coverScaleForMotion`（`:255`）、
`_needs_zoom_segment`（`camera_motion.py:588`）、`_needs_roll_segment`（`:599`），
外加面板用的 `hasClampedComponent`（`easing.ts:131`，默认 21 点）。

D32 让它们的**采样空间**自动变成 τ（这部分是对的），但 **D33 只证明了「τ 覆盖 [0,1]」，
没有证明「均匀网格命中极值」**——而后者才是这些函数正确的前提：

- 今天轨迹是**一条直线**，任何分量的极值必在 τ∈{0,1}，两点都恰好在 `i/100` 网格上，
  所以 101 点采样对 2 关键帧是**精确**的，不是近似。
- 有了中间关键帧，分量在 τ 上是**分段线性**的，极值落在**内部 stop**；
  而 `MIN_KEYFRAME_GAP = 0.02` 允许某一段只覆盖 2 个网格点，
  stop 本身也可能落在两个网格点之间（最大偏差 0.005）。

后果不是"精度略差"，是**可见缺陷**：`rollPad` 取小 → `rotate` 露出黑角
（v1 D13 实测的 YAVG 从 235 掉到 16 就是这个现象）；`coverScale` 取小 →
3D 四边形盖不住输出矩形，画面边缘出现黑楔。两者都是**成片与预览同时错**，
不会被 A38 的 ≤1px 判据抓住（它比的是取景框位置，不是边角是否有料）。

**因此新增一个共享的采样集构造器（D43），上述五处全部改走它**：

```
trajectorySamples(motion) -> number[]        # 升序、去重、首尾必含 0 与 1
    S = expandStops(motion)
    if len(S) == 2:                          # D37：老运镜逐字退化
        return [i / CAMERA_COVER_SAMPLES for i in 0..CAMERA_COVER_SAMPLES]
    per = max(CAMERA_SEGMENT_SAMPLES,        # = 16，每段的最小采样数
              ceil(CAMERA_COVER_SAMPLES / (len(S) - 1)))
    out = []
    for i in 0..len(S)-2:                    # 逐段均匀采样，含段首
        a0, a1 = S[i].at, S[i+1].at
        out += [a0 + j / per * (a1 - a0) for j in 0..per-1]
    out.append(1)                            # 末尾 stop
    return out                               # 每个 stop 都在集合里（j=0 命中）
```

- **2 关键帧时返回的数组与今天的循环逐个元素相同**，所以 `rollPad` / `coverScale` /
  两个 `_needs_*` 判定、以及依赖它们的黄金向量**一个数都不会动**（D37 / C21 得以保持）。
- 8 关键帧时是 7 段 × 16 = 113 个点，比今天的 101 点略多。这三个函数都是
  **每条运镜算一次**（前端有 `cameraMotionConstants` 的 LRU memo，后端一次导出一次），
  不在每帧路径上，代价可忽略。
- **两端必须逐字镜像同一个采样集**：`rollPad`/`coverScale` 都进黄金向量比对
  （§9.2 判据 <1e-6），采样集不同 → 最大值不同 → 跨语言比对红。

`hasClampedComponent` 同样改走它（评审 P1-2）：否则「仅中间关键帧越界」的曲线
在面板里不会给出"已被范围夹住"的提示，T17 会假绿。

### 4.3 预览链路

改动面极小，因为 v1/v2 已经把"运镜"收敛到 `resolveCameraDraw` 一个入口：

- `resolveCameraDraw`（`resolveCameraDraw.ts:26`）：按 §4.1 换成 τ 两步式。
  **其余全部不变**——`cameraMotionConstants`、`computeCropRect`、
  `project3DCorners`、`scaleQuad`、`fallbackCropForDraw` 一行不改。
- `CanvasCompositor` / `Camera3DRenderer` / `ImageOverlayLayer` /
  `assembleLayers`：**零改动**。它们消费的是 `ResolvedCameraDraw`，
  而该契约本轮不变。
- 变更检测：见 §4.2.6，只改指纹函数本体。

这正是 v1 把 `ResolvedCameraDraw` 定义成"分辨率无关的每帧绘制指令"的回报：
运镜表达能力翻倍，绘制侧一个文件都不用碰。

### 4.4 导出链路

#### 4.4.1 wire

`toCameraMotionWire`（`wire.ts:84`）新增：

```ts
// D38：平凡 2 点镜像不上线 —— 老运镜的请求体逐字节不变
const stops = motion.keyframes;
...(stops && stops.length > 2 ? { keyframes: stops.map(toStopWire) } : {}),
```

`sanitizeCameraMotion`（`wire.ts:114`）新增：读 `source.keyframes`，
逐项 `readKeyframe` + `at`/`easing` 校验，然后**必须**跑一次
`normalizeCameraKeyframes`（§4.2.4）。工程 JSON 是用户可编辑的（R11），
一个 `at: [0, 0.5, 0.3, 1]` 的乱序数组若直传到 FFmpeg 表达式，
会生成 `if(lt(U,0.5),…,if(lt(U,0.3),…))` 这种**永远进不去第二段**的死分支。

#### 4.4.2 分段表达式构造器（新增，`camera_motion.py`）

```python
def _piecewise_expr(
    stops, key, intensity, u_expr, *, low, high,
) -> str:
    """clip(nested-if(...), low, high) —— keyframe_at_trajectory 的表达式镜像。

    D37：调用方保证 len(stops) > 2；两点情形走 _component_expr 的老路径。
    """
    v0 = stops[0][key]
    def seg(i):
        a0, a1 = stops[i]["at"], stops[i + 1]["at"]
        base  = v0 + (stops[i][key] - v0) * intensity          # 段起点（含 intensity）
        delta = (stops[i + 1][key] - stops[i][key]) * intensity
        if abs(delta) <= 1e-12:
            return _num(base)
        local = f"clip(({u_expr}-{_num(a0)})/{_num(a1 - a0)},0,1)"
        return f"{_num(base)}+({_num(delta)})*({_ease_expr(local, stops[i].get('easing') or 'easeInOut')})"
    expr = seg(len(stops) - 2)
    for i in range(len(stops) - 3, -1, -1):
        expr = f"if(lt({u_expr},{_num(stops[i + 1]['at'])}),{seg(i)},{expr})"
    return f"clip({expr},{_num(low)},{_num(high)})"
```

**正确性证明**（必须写进代码注释，供 review 复核）：
在第 i 段内，`tauAtProgress` 给出 `τ = a₀ + ease(s)·(a₁−a₀)`，
代回 `keyframeAtTrajectory` 得 `s' = (τ−a₀)/(a₁−a₀) = ease(s)`，
于是 `v = v_i + (v_{i+1}−v_i)·ease(s)`，再施加 D35 的 intensity：
`k = v₀ + (v − v₀)·I = [v₀ + (v_i−v₀)·I] + (v_{i+1}−v_i)·I·ease(s) = base + delta·ease(s)`。
✅ 与上式逐项相同。

调用点（全部在 `build_camera_filter_chain`，`camera_motion.py:667`）：

| 分量 | 滤镜 | 帧变量 | 老路径（D37） | 新路径 |
|---|---|---|---|---|
| `z`（缩放） | `zoompan` | `on` | `_component_expr(start,end,…)` | `_piecewise_expr(stops,'scale',…)` |
| `x` / `y`（取景中心） | `zoompan` | `on` | 同上 | `_piecewise_expr(stops,'x'/'y',…)` |
| `roll` | `rotate` | **`n`** ⚠️ | 同上 | `_piecewise_expr(stops,'roll',…)` |
| 四角 ×8 | `perspective` | `on`（需 `eval=frame`） | `_horner(整窗口拟合)` | 逐段 `_horner` + 嵌套 `if`（D39） |

> ⚠️ **`rotate` 没有 `on` 变量，只有 `n`**（v1 P0-1，实测）。`_piecewise_expr`
> 通过 `u_expr` 参数接收调用方已经构造好的进度表达式，**不得在函数内部硬编码帧变量**。
> 已实测：嵌套 `if` 在 `rotate` 的 `a=` 里可用（§4.4.5 M4）。

#### 4.4.3 3D 逐段拟合（D39）

`_build_perspective_segment`（`camera_motion.py:605`）改造：

```
若 len(stops) == 2：完全走今天的代码（整窗口 41 点、一条三次、_horner）→ 字符串不变
否则，对每一段 i：
    在该段内取 POLY_FIT_SAMPLES 个 s ∈ [0,1]
    τ_j = at_i + s_j·(at_{i+1} − at_i)          # 拟合在 τ 空间做，缓动在表达式里补
    pts = project_3d_corners(keyframe_at_trajectory(motion, τ_j), aspect)
    若 pts is None → warning + 整体返回 None（沿用今天的降级）
    scaled = scale_quad(pts, cover)              # cover 仍是运镜级常量（D5，不变）
    对 8 条轨迹各拟合 degree=poly_degree 的多项式，自变量取该段的 **ease 后局部进度**
    该段表达式 = _horner(coeffs, _ease_expr(局部进度, stops[i].easing))
最后按 at 用 if(lt(U, at_{i+1}), …) 嵌套 8 条角轨迹
若任一段 worst > max_fit_error_px → 沿用今天的多度数回退，仍失败则 warning + 降级为 2D
```

`cover = cover_scale_for_motion(motion, aspect)` **不变**——它内部按
`keyframe_at(motion, i/100)` 采样（`camera_motion.py:463`），
而 D32 让 `keyframe_at` 现在就是轨迹采样，**自动覆盖整条分段曲线**。这是 D32 的直接红利。

#### 4.4.4 长度闸与逐级降级（D40 / G5）

在 `build_camera_filter_chain` 组装完 `parts` 之后、返回之前：

```python
chain = ",".join(parts)
if allow_collapse and len(chain) > config.max_expr_chars:
    warnings.append(f"{label}: camera curve is too complex for the export filter "
                    f"({len(chain)} chars > {config.max_expr_chars}); "
                    f"rendered as a two-keyframe motion")
    chain, collapsed_warnings = build_camera_filter_chain(
        _collapse_to_two_stops(motion), frame_w, frame_h, fps, clip_duration,
        caps=caps, config=config, label=label,
        allow_collapse=False,                 # 只降一级，且实现上不可能再降
    )
    warnings.extend(collapsed_warnings)       # ⚠️ 见下方 P0-3
    return chain, warnings
```

> 🔴 **评审 P0-3（本节 v1 伪码的实际缺陷）**：v1 写的是
> `return build_camera_filter_chain(...)`，而递归调用返回的是**一个全新的
> `warnings` 列表**。于是刚 `append` 进去的"曲线过长已降级"那条文案、
> 以及本次调用里**早已累积**的其它 warning（`FFmpeg has no 'zoompan'`、
> `3D camera motion degenerated`、`3D trajectory fit error …`）会**一起被丢掉**。
> 用户看到的是"成片和预览不一样，而且状态里什么都没说"——
> v1 的 P0-3（warnings 没走通 status 通道）就是同一类错误，代价是一整轮返工。
> 正确写法就是上面这样：**保留本地 `warnings`，把递归的 warnings `extend` 进来，
> 返回本地列表**。T10 必须同时断言两件事：含降级文案、且**含降级前已有的那条文案**。

`_collapse_to_two_stops(motion)` 返回一个**去掉 `keyframes`** 的浅拷贝
（首尾镜像由 D31 保证已经在 `start`/`end` 里），因此二次调用必然走 D37 老路径、
必然不会再超长，**递归至多一层**（用显式 `allow_collapse: bool = True`
参数而不是真递归，避免任何未来改动把它变成无限递归）。

> **注（评审 P2-4）**：若降级后的两点链**仍然**超过 `max_expr_chars`
> （实践中不可能——两点链的量级是几百字符），行为定死为：
> **不再降级、原样返回**。最终兜底交给 `video_composition_service.py:791`
> 既有的「returncode ≠ 0 且 camera_chain 非空 → 去掉 camera_chain 重试」路径。
> 不允许在这里返回 `""`：那会让"运镜消失"这件事再多一条无 warning 的路径。

> **注（评审 P2-3）——为什么闸门要设在"组装后的整条链"上**：
> 表达式不是线性增长的。`z_expr` 会被内联进 `x_expr` 与 `y_expr` **各两次**
> （`camera_motion.py:755-759`），所以 scale 的分段串在**一条 zoompan 里出现 5 次**。
> 这正是 M1 实测 n=8 → 8.9KB 的来源。20000 这个数必须按"整条链"理解，
> 不能按"单分量长度 × 8"去估；也正因为如此，M6 的 `st()/ld()` 虽被本轮否决，
> 但它是这条曲线真的顶到天花板时**第一个该重新评估**的手段。

降级顺序（每级都有 warning，用户始终知道成片与预览不同）：

```
分段曲线 ──超长/拟合失败──▶ 两点运镜 ──能力缺失/预检失败──▶ 无运镜
                                          （v1/v2 既有逻辑，不变）
```

#### 4.4.5 FFmpeg 实测记录（本机 `2025-05-15-git-12b853530a-full_build`）

| # | 命题 | 结果 |
|---|---|---|
| **M1** | 嵌套 `if` 分段表达式在 `zoompan` 的 `z`/`x`/`y` 里可用 | ✅ n=3/5/8/12 关键帧全部 rc=0（滤镜串 2.1KB / 4.4KB / 8.9KB / 15.0KB） |
| **M2** | 表达式长度上限 | ✅ 32 关键帧、单个 `z` 表达式 8985 字符仍 rc=0。**故 `max_expr_chars=20000` 有充分余量** |
| **M3** | `perspective` 八个角同时用分段表达式（`eval=frame`） | ✅ n=5、滤镜串 6.8KB，rc=0 |
| **M4** | `rotate` 的 `a=` 里用分段表达式（帧变量 `n`） | ✅ n=5，rc=0（配 `crop` 回切与 v1 D13 三件套） |
| **M5** | **性能**：1080p / 3s / 30fps，2 关键帧 vs 8 关键帧 | ✅ **0.84s vs 0.75s** —— 差异在噪声内，**分段表达式的求值开销可忽略**。表达式复杂度不是导出成本的主项（`scale`/`zoompan` 的重采样才是） |
| **M6** | `st()/ld()` 表达式变量在 `zoompan` 内可用（可用于把 `U` 提取一次） | ✅ 可用（`;` 与转义 `\,` 两种写法都跑通）。**但本方案明确不采用**：M5 证明没有性能必要，而在 filtergraph 里塞 `,`/`;` 会引入一类与既有引号规则纠缠的解析风险，不值得 |

复现脚本：本轮实测用的探针见 §9.5。

### 4.5 UI / 交互设计

面板整体骨架（`CameraMotionModal.tsx`）保持不变：左预设、右舞台+参数、底部应用。
本轮在**右栏**插入一条关键帧轨，并给舞台加一层交互覆盖。

```
┌──────────────────────────── 运镜 ───────────────────────────────┐
│ [2D] [3D] │  ┌────────── 舞台 480×270 ──────────┐               │
│           │  │  ╔═══════════╗  ← 取景框(选中帧)  │               │
│  预设网格  │  │  ║           ║   · · ·  ← 运动路径 │               │
│           │  │  ╚═══════════╝                   │               │
│           │  └──────────────────────────────────┘               │
│           │  ▶ ──●────────◆────────◆──────────── 100%           │  ← 播放/擦洗
│           │  ┌── 关键帧轨 ────────────────────────┐              │
│           │  │ ◆0.00      ◆0.42       ◆1.00      │ [+] [🗑]     │
│           │  │  └ easeOut ┘ └ easeInOut ┘        │              │
│           │  └───────────────────────────────────┘              │
│           │  当前关键帧 #2 / 3   缩放[1.00] X[0.50] Y[0.50] …    │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.5.1 关键帧轨（`KeyframeStrip.tsx`，新增）

- 一条水平轨，横轴 = **运镜窗口内**的归一化时刻 `at` ∈ [0,1]。

  > 🔴 **评审 P1-3：两条轴不是同一把尺，必须显式对齐（D44）**。
  > v1 写的是"与擦洗条等宽同刻度……新关键帧出现在正下方"。事实是：
  > 擦洗条的 `u` 被映射到 **clip 时间**（`MotionPreviewStage.tsx:227`：
  > `tLocal = u * clipDuration`），而 `at` 是**运镜窗口**内的归一化量。
  > 只要用户动过 `startOffset` / `duration`（面板里就有这两个控件），
  > 两条轴立刻错位；把播放头拖到窗口**之外**再按 `[+]`，
  > `progressAt` 会把结果夹成 0 或 1，与 D31 锁死的首尾帧撞车——
  > 轻则静默无效，重则把首帧的取景改掉。
  >
  > 因此定死三条：
  > 1. **擦洗条上画出运镜窗口段**（一条浅色高亮 band，`[w0, w0+wd]` 映射到
  >    `[w0/clipDuration, (w0+wd)/clipDuration]`），关键帧轨在**该 band 的水平范围内**
  >    左右对齐，而不是与整条擦洗条等宽。窗口 = 整个 clip 时（默认情形）
  >    band 铺满，视觉上与 v1 的描述一致。
  > 2. `[+]` 取的 `at` 一律经 `progressAt(motion, u * clipDuration, clipDuration)` 换算，
  >    **不得**直接把擦洗条的 `u` 当 `at` 用。
  > 3. 播放头落在窗口外，或换算出的 `at` 距任一已有 stop < `MIN_KEYFRAME_GAP` 时，
  >    `[+]` **禁用**并给 `title` 说明（"把播放头移到运镜窗口内" /
  >    "此处已有关键帧"）。禁用比"点了没反应"和"点了改坏别的帧"都好。
- 每个关键帧渲染成一个 `<button role="option">`（轨本身 `role="listbox"`），
  菱形标记；选中态用 `aria-selected` + 视觉高亮（`ring-2 ring-primary`）。
- **拖动改时刻**：`pointerdown` → `setPointerCapture` → 按像素映射回 `at`，
  夹到 `[前一帧.at + MIN_KEYFRAME_GAP, 后一帧.at − MIN_KEYFRAME_GAP]`；
  **首尾帧的 `at` 不可拖动**（D31 锁死 0 与 1），其标记渲染为 `cursor-default`
  并带 `aria-disabled` 说明。
- **键盘**：`←/→` 移动 `at`（步进 0.01，`Shift` 加速到 0.1）、`Delete/Backspace` 删除、
  `Tab` 在关键帧间移动焦点。首尾帧上按方向键无效果并保持焦点。
- 段落缓动：相邻两帧之间渲染一个小 `<select>`（四选一），改动写入**左侧帧**的
  `easing`（D34）。
- `[+]` 按钮：在当前擦洗位置插入关键帧，其七分量**取该时刻的解析值**
  （`keyframeAtTrajectory(motion, tauAtProgress(motion, u))`）——
  于是"加一个关键帧"这个动作**不改变当前画面**，只是把曲线在该处钉住。
  这是关键帧编辑器的基本礼貌：添加不应该跳变。到达 `CAMERA_MAX_KEYFRAMES` 时禁用并给出
  `title` 说明。
- `[🗑]` 按钮：删除选中帧；首尾帧不可删（禁用 + 说明）。

#### 4.5.2 舞台直接取景（`StageOverlay.tsx` + `stageInteraction.ts`，新增）

覆盖层是一个绝对定位、与 canvas 同尺寸的 `<div>`，内部画一个 SVG。

> 🔴 **评审 P1-4：画的坐标系与量的坐标系必须分开**。舞台画布的**后备存储**
> 固定为 `STAGE_W/STAGE_H = 480×270`，但它是以 `className="w-full"` +
> `style={{ aspectRatio: '16/9' }}` 布局的（`MotionPreviewStage.tsx:296-301`）——
> **CSS 尺寸随面板宽度变，几乎永远不等于 480×270**。若手势换算直接吃 480/270 这两个常量，
> 拖动灵敏度会随窗口宽度漂移，窄屏上错得最厉害。定死两条：
> - **画**：SVG 用 `viewBox="0 0 480 270"`（外加 `preserveAspectRatio="none"` 不需要，
>   因为宽高比恒为 16:9），于是 `cropToStageRect` / `quadToStagePoints` 可以继续
>   在 480×270 的逻辑坐标里算，浏览器负责缩放——分辨率无关，零额外测量。
> - **量**：所有指针换算用覆盖层的 `getBoundingClientRect()` 实测 `width/height`，
>   经 `stageInteraction` 的 `w`/`h` 形参传入。这两个函数签名本来就收 `w`/`h`
>   （§6.2），**不要**在调用点把 `STAGE_W/STAGE_H` 塞进去。
>   T14 必须有一条"实测矩形 ≠ 后备存储"的用例（例如 rect 为 960×540 时，
>   同样的 `dx` 得到一半的归一化位移）。

> 🔴 **评审 P1-5：滚轮必须用非被动原生监听**。React 把 `wheel` 注册为 **passive**，
> `onWheel` 里的 `preventDefault()` 是无效的（并会在控制台留下 passive 警告）；
> 而面板主体是 `overflow-y-auto`（`CameraMotionModal.tsx:261`），
> 于是"滚轮缩放"的每一下都会**同时把面板滚走**。正确做法：
> `ref` + `addEventListener('wheel', handler, { passive: false })`，
> 在 `useEffect` 的清理函数里 `removeEventListener`。
> 这条不是锦上添花——它决定了 A34 能不能真的验收通过（A46）。

- **取景框**：把选中关键帧的 `crop`（经 `computeCropRect`）反算成舞台坐标的矩形。
  2D 显示为带四角把手的矩形；3D 额外显示 `project3DCorners` 投影出的四角线框
  （虚线），让透视一目了然。
- **运动路径**：把所有关键帧的取景中心 `(x, y)` 连成折线（`<polyline>`），
  关键帧处画小圆点，选中的那个高亮。这是"这段运镜到底怎么走"的唯一视觉答案。
- **手势**（全部作用于**选中的关键帧**，`stageInteraction.ts` 提供纯映射函数）：

| 手势 | 2D | 3D | 纯函数 |
|---|---|---|---|
| 拖动 | `x`/`y` | `x`/`y` | `panDelta(dx, dy, crop, stageW, stageH)` |
| 滚轮 | `scale` | `scale` | `zoomDelta(deltaY, scale)`（每 120 单位 ×1.06，指数） |
| `Shift`+横拖 | `roll` | `rotateY` | `rollDelta(dx, stageW)` / `orbitDelta(dx, stageW)` |
| `Shift`+纵拖 | —— | `rotateX` | `tiltDelta(dy, stageH)` |

  拖动的位移换算必须**除以当前 crop 宽度**：放大 2× 时，鼠标走 10px
  对应源图上只走 5px，否则高倍率下手感会飞。即
  `Δx_norm = −dx / stageW * crop.w`（负号：拖画面向右 = 取景中心向左）。

- **键盘等价物**（无障碍必需，不是可选项）：覆盖层可聚焦（`tabIndex=0`，
  `role="application"`，`aria-label` 说明可用按键），`←→↑↓` 平移（步进 0.005，
  `Shift` ×5）、`+`/`-` 缩放、`[`/`]` 改 roll。
  **同时，`ParameterControls` 里的数字输入框全部保留**——舞台是加速器，不是唯一通道。
- 拖动过程中舞台自动暂停播放并把擦洗位置钉到选中关键帧的 `at`
  （否则用户在调 0.4s 处的构图、画面却在演 0.8s 的，纯属误导）。
  「钉到 `at`」要经 D44 的换算反向走一遍：擦洗条的值 = `(w0 + at·wd) / clipDuration`。
- **覆盖层不订阅每帧数据（D45，评审 P1-6）**：它的输入只有
  `(motion, selectedStopIndex, stageRect)` 三样，全部经 `useMemo` 求解一次——
  取景框画的是**选中关键帧**的构图，路径画的是**所有 stop** 的中心点，
  两者只在用户编辑时变化，与播放头无关。
  舞台现有实现是刻意把播放头**直接写进 DOM**、绕开 React 的
  （`MotionPreviewStage.tsx:320-322` 的注释写得很清楚："an animated slider costs
  zero React renders"）；如果为了覆盖层去每帧回调 `ResolvedCameraDraw`，
  等于按 60Hz 重渲染整个面板子树，把那层优化整个作废。
  播放中覆盖层保持显示（路径与选中框都是静态信息，不会与画面打架）。
- `prefers-reduced-motion` 下不改变上述行为（这是直接操作，不是装饰动画）。

#### 4.5.3 参数区（`ParameterControls.tsx` 改造）

- 标题从「起点 / 终点」改为「关键帧 #i / n」，下拉或轨上的选中态决定编辑对象。
- 老运镜（2 个 stop）下，UI 仍然显示两组"起点/终点"，
  **视觉与今天完全一致**——用户不加关键帧就感觉不到本轮的存在（G4 的交互面）。
- 顶层 `easing` 控件在 stops > 2 时隐藏（已被段落缓动取代），
  并在轨上方给一行说明文字，避免"两个缓动谁说了算"的困惑。
- 「反向」按钮（v1 P2-5）：`reverseCameraMotion` 改为整条曲线反向（见 §4.6）。

### 4.6 反向、分割与撤销重做

- **反向**（`cameraPresets.ts:99`）：**分两种情形（D46，评审 P1-10）**。
  - **有曲线（stops > 2）**：`at_i' = 1 − at_{n−1−i}`，stops 逆序；段落缓动随段走，即
    `easing_i' = mirror(easing_{n−2−i})`，其中
    `mirror: easeIn ↔ easeOut，linear/easeInOut 不变`。最后一帧 `easing` 置空（D34）。
    没有这个 `mirror`，反向一条 `easeIn` 会得到一条仍然 `easeIn` 的曲线，
    节奏感与用户预期相反。反向后按 D31 回写 `start`/`end`/`motion.easing` 镜像。
  - **无曲线（stops == 2）**：**逐字走今天的实现**——
    `{ ...motion, presetId: 'custom', start: end, end: start }`，**不动 `motion.easing`**。

  > 🔴 **为什么不顺手把 2 点也镜像了**：今天的 `reverseCameraMotion`
  > （`cameraPresets.ts:99-106`）确实不动 `easing`，而 §4.6 的通用规则在 `n=2` 时
  > 等价于 `motion.easing := mirror(motion.easing)`。那意味着**同一个「反向」按钮
  > 在本轮升级前后会产出不同的存储 JSON**，而 G4 ① 承诺的正是"≤2 关键帧的存储 JSON
  > 逐字符相同"，且没有任何基线守着这个行为。
  > "2 点反向也该镜像缓动"本身是 v1 的遗留缺陷，值得改——但它该有自己的改动、
  > 自己的基线更新和自己的验收，不该搭本轮零回归的顺风车悄悄溜进去。
  > 已记入 §13 后续扩展点第 6 条。
- **分割**：`rebaseCameraMotionForSplit` **不改**（D41）。必须补一条断言测试：
  分割一个带 4 关键帧的 clip，两半的 `keyframes` 数组**逐项相等**，
  且两半在切点处解析出的关键帧连续（差值 < 1e-6）。
- **左边缘裁剪**：`shiftCameraMotionWindow` 同样不改（只动 `startOffset`）。
- **撤销重做**：`setCameraMotionAction` 不改——它整条替换 `cameraMotion` 对象，
  一次面板「应用」= 一条历史记录，多关键帧不改变这个粒度。

---

## 5. 文件 / 模块变更计划

> 统计（v2 修订后）：**源文件 21 个（改 16 / 新增 5）**、
> **测试文件 17 个（改 11 / 新增 6）**、配置 1 个（改）。合计 **39 个文件**。
> （v1 写的是 36：漏了 §5.4 第 37–39 条，见评审 P1-7 / P2-7。）
>
> **实施后实际 41 个**：另加 `CameraMotionModal/keyframeStripGeometry.ts`（新，
> 见「实施过程发现的方案缺陷」F6——`[+]` 的三条禁用规则与 T22 在 N12 下必须
> 住在纯 `.ts` 里）与 `camera/__tests__/trajectory.test.ts`（新，T1/T17/T18 的家；
> §5.4 第 24 条只点了 T1，实际这三条同源，合为一个文件）。

### 5.1 前端 — 类型与纯数据层

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 1 | `src/types/index.ts` | 改 | 新增 `CameraKeyframeStop`（`CameraKeyframe` + `at: number` + `easing?: CameraEasing`）；`CameraMotion` 增 `keyframes?: CameraKeyframeStop[]`，注释写明 D30/D31 两条不变量 |
| 2 | `src/components/video/playback/camera/types.ts` | 改 | re-export `CameraKeyframeStop`；新增 `CAMERA_MAX_KEYFRAMES = 8`、`MIN_KEYFRAME_GAP = 0.02`、`CAMERA_SEGMENT_SAMPLES = 16`（D43） |
| 3 | `src/components/video/playback/camera/keyframes.ts` | **新** | `expandStops` / `normalizeCameraKeyframes` / `insertKeyframeAt` / `removeKeyframeAt` / `retimeKeyframe` / `setKeyframeComponent` / `segmentIndexAt` / **`trajectorySamples`（D43）**。**纯函数，无 DOM**，是本轮唯一的曲线写入闸（§4.2.4） |
| 4 | `.../camera/easing.ts` | 改 | 新增 `tauAtProgress`、`keyframeAtTrajectory`；`keyframeAt` 改为前者的别名（D32，**不得删除导出**）；`hasClampedComponent` 改为**沿 `trajectorySamples` 采样**（D43 / 评审 P1-2；只改采样集合，不改 21 点的默认密度语义——2 stop 时两者一致） |
| 5 | `.../camera/resolveCameraDraw.ts` | 改 | 按 §4.1 换成 `progressAt → tauAtProgress → keyframeAtTrajectory` 三步 |
| 6 | `.../camera/fingerprint.ts` | 改 | 追加 stops 段；**`keyframes` 缺失必须产出空串**（§4.2.6，P0） |
| 7 | `.../camera/identity.ts` | 改 | 按 §4.2.5 推广恒等判据（P0） |
| 8 | `.../camera/cameraPresets.ts` | 改 | `reverseCameraMotion` 支持整条曲线反向 + 缓动镜像（§4.6） |
| 9 | `.../camera/wire.ts` | 改 | `toCameraMotionWire` 按 D38 条件输出 `keyframes`；`sanitizeCameraMotion` 读入并**必过** `normalizeCameraKeyframes` |
| 10 | `.../camera/splitRebase.ts` | 改（仅注释） | 写明 D41「`at` 相对窗口，分割无需重基」的推导，防止后人补一段错误的重基 |
| **10a** | `.../camera/cameraGeometry.ts` | **改（评审 P1-1 新增，v1 漏列）** | `rollPadForMotion`（`:70`）与 `coverScaleForMotion`（`:255`）的 `for (i=0..100)` 循环改为遍历 `trajectorySamples(motion)`（D43）。**只换采样集合，循环体一字不改**；2 关键帧下集合与今天逐元素相同，故存量 3D 运镜的 `coverScale` 常量零漂移。`cameraMotionConstants` 的 memo 与 LRU 不变 |
| 11 | `.../camera/index.ts` | 改 | 导出 `keyframes.ts` 全部公开符号 + 三个新常量 + `tauAtProgress`/`keyframeAtTrajectory`/`trajectorySamples` |

### 5.2 前端 — 面板 UI

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 12 | `.../CameraMotionModal/KeyframeStrip.tsx` | **新** | §4.5.1 的关键帧轨（listbox 语义、拖动改时刻、段落缓动、增删按钮） |
| 13 | `.../CameraMotionModal/StageOverlay.tsx` | **新** | §4.5.2 的 SVG 覆盖层：取景框、3D 四角线框、运动路径、指针与键盘事件 |
| 14 | `.../CameraMotionModal/stageInteraction.ts` | **新** | 上者的**纯几何映射**（`panDelta`/`zoomDelta`/`rollDelta`/`orbitDelta`/`tiltDelta`/`cropToStageRect`/`quadToStagePoints`）。抽出来是为了在 N12 约束下仍然可测 |
| 15 | `.../CameraMotionModal/MotionPreviewStage.tsx` | 改 | **（评审 P1-6 修订）** 只做两件事：① 接纳覆盖层为 `children`（绝对定位在 canvas 之上）；② 在擦洗条上渲染 D44 的「运镜窗口高亮段」。**不得**把每帧的 `ResolvedCameraDraw` 通过回调抛给父级——覆盖层按 D45 自行 `useMemo` 求解。draw 循环与"直接写 DOM 的播放头"一字不改 |
| 16 | `.../CameraMotionModal/ParameterControls.tsx` | 改 | 从「编辑 start/end」改为「编辑选中关键帧」；stops > 2 时隐藏顶层 easing；保留全部数字输入 |
| 17 | `.../CameraMotionModal/CameraMotionModal.tsx` | 改 | 新增 `selectedStopIndex` 状态与增/删/改时刻/改分量的回调；把擦洗位置与选中帧联动；预设/模式切换时重置为 2 点曲线 |
| 18 | `.../CameraMotionModal/index.ts` | 改 | 补导出 |
| 19 | `src/lib/i18n.ts` | 改 | `timeline.cameraMotion` 下新增约 20 条文案（关键帧轨、增删提示与禁用原因、段落缓动、舞台手势说明、`aria-label`、超限与降级提示）。**注意有三处要同步改（评审 P2-2）**：文件开头的 `export interface Translations` 类型声明、英文块、中文块。漏掉类型声明是 `tsc --noEmit` 硬失败 |

### 5.3 后端

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 20 | `app/models/video_models.py` | 改 | 新增 `CameraKeyframeStop`（**不继承 `CameraKeyframe` 的 `ge/le` 约束**，七分量为裸 `float`，另加 `at: float`、`easing: Optional[Literal[...]]`）；`CameraMotion.keyframes: Optional[List[CameraKeyframeStop]]`；**规范化放在 `field_validator("keyframes", mode="before")`**（D42 / 评审 P0-2）——必须在字段校验**之前**清洗，否则 `mode="after"` 根本跑不到，坏曲线会让整次合成 422（R30） |
| 21 | `app/services/composition/camera_motion.py` | 改 | ① `expand_stops` / `tau_at_progress` / `keyframe_at_trajectory` 三个 Python 镜像（`expand_stops` 的返回契约见 §6.3，评审 P1-8）；② `keyframe_at` 变别名；③ `_piecewise_expr`；④ `build_camera_filter_chain` 四个分量按 D37 二选一；⑤ `_build_perspective_segment` 逐段拟合（D39）；⑥ `max_expr_chars` 长度闸与一级降级（D40，warnings 必须 `extend` 不得丢弃——评审 P0-3）；⑦ `CameraMotionConfig` 增两个字段，**且 `load_camera_config`（`:134-152`）的逐字段回退值必须与 dataclass 默认逐字相同**（v1 评审在 `supersample` 上抓到过同款不一致，评审 P1-9 / T19）；⑧ **`is_identity_camera_motion`（`:485`）按 §4.2.5 推广**（评审 P0-1，v1 漏列，是本轮最严重的一处两端不对称）；⑨ `trajectory_samples` 镜像 + 四个采样点改走它（D43 / 评审 P1-1）；⑩ `max_keyframes` 在 `expand_stops` 内落实截断（评审 P1-9，否则是死旋钮） |
| 22 | `config/camera-motion.yaml` | 改 | 增 `max_expr_chars: 20000`、`max_keyframes: 8`，并附实测依据注释（M2/M5）；两个键都必须有真实执行点，见第 21 条 ⑦⑩ |

> 静帧链路（`build_still_overlay_plan`）**零改动**：它把 `motion` 原样转交
> `build_camera_filter_chain`（`camera_motion.py:923`），多关键帧自动生效。
> 这一条必须落一个断言测试（§9.1 T13），否则它是"看起来会自动生效"而没人验证过。

### 5.4 测试

| # | 文件 | 改/新 | 覆盖 |
|---|---|---|---|
| 23 | `camera/__tests__/keyframes.test.ts` | **新** | 规范化 9 步逐条、插入不跳变、间隔合并、8 帧截断、镜像回写、平凡曲线被删字段 |
| 24 | `camera/__tests__/trajectory.test.ts` | **新** | **T1 恒等式**：老运镜下 `keyframeAtTrajectory(tauAtProgress(u))` 与 `keyframeAt(ease(u))` 逐位相等（四种缓动 × 21 个 u × 7 分量） |
| 25 | `camera/__tests__/fingerprintKeyframes.test.ts` | **新** | **T5（P0）**：老运镜指纹逐字符不变；改中间帧任一分量/`at`/段缓动 → 指纹必变；`cameraMotionConstants` 不复用他条曲线的 memo |
| 26 | `camera/__tests__/identity.test.ts` | 改 | **T4a（P0）**：`start=end=默认` 但中间帧非默认 → **非**恒等；老运镜判据逐项不变。（Python 侧的 T4b 在第 36 条，评审 P0-1） |
| 27 | `camera/__tests__/easing.test.ts` | 改 | `tauAtProgress` 分段查找、边界（u=0/1、落在 `at` 上）、`hasClampedComponent` 走中间帧 |
| 28 | `camera/__tests__/splitRebase.test.ts` | 改 | **T7（D41）**：4 关键帧分割后两半 `keyframes` 逐项相等 + 切点连续性 |
| 29 | `camera/__tests__/goldenVectors.test.ts` | 改 | 读新增多关键帧用例 |
| 30 | `camera/__tests__/fixtures/camera-golden.json` | 改 | **新增 ≥8 个多关键帧用例**：3 点 2D 折返、4 点带停顿、5 点 3D 环绕、段落缓动混合、intensity=0.5、intensity=0、`at` 非均匀、8 点满载。每例给出 3 个采样 t。**沿用 fixture 既有的前端 camelCase 约定**（`rotateX`/`rotateY`，不是 `rotate_x`），snake_case 转换在第 37 条那一处做（评审 P2-6） |
| 31 | `camera/__tests__/eligibility.test.ts` | 改 | 不变的回归（确认本轮没碰入口判据） |
| 32 | `CameraMotionModal/__tests__/stageInteraction.test.ts` | **新** | 五个手势映射的纯几何：拖动位移按 `crop.w` 折算、缩放指数步进、边界夹取、`cropToStageRect`/`quadToStagePoints` 往返 |
| 33 | `CameraMotionModal/__tests__/KeyframeStrip.test.ts` | **新** | 源码级契约（N12：不挂载）：listbox/option 角色齐全、首尾帧 `aria-disabled`、增删按钮到界禁用、每段一个 easing select |
| 34 | `hooks/__tests__/useTimelineComposition.cameraSignature.test.ts` | 改 | 改中间关键帧 → 合成签名必变（预览重绘闸） |
| 35 | `hooks/__tests__/useVideoExport.cameraMotion.test.ts` | 改 | **D38**：2 点运镜的请求体**不含** `keyframes` 键且与本轮前逐字段相同；>2 点时含 |
| 36 | `backend/tests/test_camera_motion_keyframes.py` | **新** | **T2 字符串零回归**（2 点运镜滤镜串与本轮前逐字符相等）、分段表达式结构、`rotate` 用 `n`、逐段拟合、`max_expr_chars` 触发一级降级且只降一级且 **warnings 不丢**、pydantic 规范化而非 422、**T4b 后端恒等判据**、**T13 静帧多关键帧**、T19 裁剪 YAML 等价性 |
| **37** | `backend/tests/test_camera_motion.py` | **改（评审 P1-7 新增，v1 漏列）** | 这是 `CAMERA_GOLDEN_REQUIRED=1` 的**黄金向量消费者**（`:382-440`），内含两处必须同步的手写实现：① `_wire_from_camel` 是**字段白名单**，不认 `keyframes` → 新增用例会拿 2 点运镜去比 TS 的曲线，必然红；② `_resolve` 用 `ease(u) + keyframe_at` **手写了一遍 `resolveCameraDraw`**，必须改成 `progressAt → tau_at_progress → keyframe_at_trajectory` 三步。不改这一条，**C28 不可能达成** |
| **38** | `timeline/infrastructure/__tests__/TimelineRepository.cameraMotion.test.ts` | **改（评审 P2-7 新增）** | **T21 持久化往返**：保存端是**原样透传**（`TimelineRepository.ts:291`），载入端过 `sanitizeCameraMotion`（`:417`）。断言 ① 带曲线的运镜存-取后 `keyframes` 逐项相等；② **老运镜（无曲线）存回去的 JSON 与本轮前逐字符相同**（D38 / G4 ① 在真实持久化路径上的唯一守门人）；③ 工程 JSON 里塞一个乱序/超 8 的 `keyframes` → 载入后被规范化，不抛异常 |
| **39** | `timeline/infrastructure/__tests__/CompositionAdapter.cameraMotion.test.ts` | **改（评审 P2-7 新增）** | wire 装配侧的 D38：`CompositionAdapter.ts:343` 出来的 `camera_motion` 在 2 点时无 `keyframes` 键、>2 点时有且 `at` 升序、分量为 snake_case |

---

## 6. 接口设计（Interfaces）

### 6.1 HTTP wire（前端 → `/api/video-compose` → 后端 `/api/video/compose`）

`video_items[].camera_motion` 与 `image_items[].camera_motion` **新增一个可选键**：

```jsonc
{
  "camera_motion": {
    "version": 1,
    "mode": "3d",
    "preset_id": "custom",
    "intensity": 1,
    "easing": "easeOut",          // 老字段：仍是 keyframes[0].easing 的镜像
    "start_offset": 0.5,
    "duration": 4.0,
    "start": { "scale": 1, "x": 0.5, "y": 0.5, "roll": 0,
               "rotate_x": 0, "rotate_y": -12, "dolly": 0 },   // ≡ keyframes[0]
    "end":   { "scale": 1.2, "x": 0.4, "y": 0.5, "roll": 0,
               "rotate_x": 0, "rotate_y": 12, "dolly": 0.1 },  // ≡ keyframes[n-1]

    // 新增（可选）。仅当关键帧数 > 2 时出现（D38）
    "keyframes": [
      { "at": 0,    "easing": "easeOut",
        "scale": 1, "x": 0.5, "y": 0.5, "roll": 0, "rotate_x": 0, "rotate_y": -12, "dolly": 0 },
      { "at": 0.45, "easing": "linear",
        "scale": 1.15, "x": 0.5, "y": 0.5, "roll": 0, "rotate_x": 0, "rotate_y": 0, "dolly": 0.05 },
      { "at": 1,
        "scale": 1.2, "x": 0.4, "y": 0.5, "roll": 0, "rotate_x": 0, "rotate_y": 12, "dolly": 0.1 }
    ]
  }
}
```

**响应不变**：降级信息继续走 v2 的 `warnings` → 任务 `status` 通道
（v1 D14 / v2 C12），本轮只是多了两种文案（曲线超长、逐段拟合失败）。
路由的 `safe_info` 白名单**无需改动**——warnings 字段本身没变。

### 6.2 前端内部 API（新增/变更签名）

```ts
// camera/keyframes.ts（新）
export function expandStops(motion: CameraMotion): CameraKeyframeStop[];
export function normalizeCameraKeyframes(motion: CameraMotion): CameraMotion;
export function insertKeyframeAt(motion: CameraMotion, at: number): CameraMotion;   // 不跳变
export function removeKeyframeAt(motion: CameraMotion, index: number): CameraMotion; // 首尾不可删
export function retimeKeyframe(motion: CameraMotion, index: number, at: number): CameraMotion;
export function setKeyframeComponent(
  motion: CameraMotion, index: number, key: keyof CameraKeyframe, value: number,
): CameraMotion;                                    // 内部置 presetId='custom'
export function segmentIndexAt(stops: CameraKeyframeStop[], p: number): number;

// camera/easing.ts（新增两个，keyframeAt 保留为别名）
export function tauAtProgress(motion: CameraMotion, u: number): number;
export function keyframeAtTrajectory(motion: CameraMotion, tau: number): CameraKeyframe;

// CameraMotionModal/stageInteraction.ts（新）
export function cropToStageRect(crop: NormalizedRect, w: number, h: number): DOMRectLike;
export function quadToStagePoints(quad: CameraQuad, w: number, h: number): Array<{x:number;y:number}>;
export function panDelta(dx: number, dy: number, crop: NormalizedRect, w: number, h: number)
  : { dx: number; dy: number };                      // 归一化增量，已按 crop.w/h 折算
export function zoomDelta(wheelDeltaY: number, scale: number): number;
export function rollDelta(dx: number, w: number): number;
export function orbitDelta(dx: number, w: number): number;
export function tiltDelta(dy: number, h: number): number;
```

**签名不变但语义需在注释里更新**：`keyframeAt(motion, e)` 的 `e` 现在是**轨迹参数**。

### 6.3 后端内部 API

```python
# app/services/composition/camera_motion.py

def expand_stops(motion: Any) -> List[Dict[str, Any]]:
    """展开为 stops 列表。**这是后端读取曲线的唯一入口**（评审 P1-8）。

    返回契约（不满足即视为实现错误）：
      * 每一项都是 **纯 dict**，不是 pydantic 模型；
      * 七个分量走 `_keyframe_dict()` 归一，键为 **snake_case**
        （`rotate_x` / `rotate_y`），缺失的分量取 DEFAULT_KEYFRAME；
      * 额外携带 `at: float` 与 `easing: Optional[str]`；
      * 长度 >= 2，`at` 升序，`at[0] == 0`、`at[-1] == 1`；
      * 超过 `config.max_keyframes` 的部分在此截断（保留首尾，中间等距淘汰）。

    理由：`_piecewise_expr` 用 `stops[i][key]` / `stops[i]["at"]` 下标取值。
    入参既可能是 pydantic 的 `CameraKeyframeStop`（属性访问）也可能是裸 dict，
    还可能缺分量；直接下标一次 KeyError/TypeError 就是
    `/api/video/compose` 一个 500，与 G5「运镜永不导出失败」正面冲突。
    """

def trajectory_samples(motion: Any) -> List[float]: ...   # D43，与 TS 逐字镜像
def tau_at_progress(motion: Any, u: float) -> float: ...
def keyframe_at_trajectory(motion: Any, tau: float) -> Dict[str, float]: ...
def keyframe_at(motion: Any, e: float) -> Dict[str, float]:      # 别名，签名不变
    return keyframe_at_trajectory(motion, e)

def _piecewise_expr(
    stops: Sequence[Dict[str, Any]], key: str, intensity: float, u_expr: str,
    *, low: float, high: float,
) -> str: ...

def build_camera_filter_chain(
    motion, frame_w, frame_h, fps, clip_duration,
    caps=None, config=None, label="clip",
    allow_collapse: bool = True,        # 新增：D40 的一级降级开关，二次调用传 False
) -> Tuple[str, List[str]]: ...          # 其余签名与返回契约不变
```

```python
# app/models/video_models.py

class CameraKeyframeStop(BaseModel):
    """曲线上的一个关键帧。

    ⚠️ 评审 P0-2 / D42：**故意不继承 `CameraKeyframe`**，七个分量声明为裸 `float`
    且不带 `ge/le`。原因：`CameraKeyframe`（`video_models.py:127-133`）每个字段都有
    `Field(ge=…, le=…)`，而 pydantic 的**字段级校验先于** `model_validator(mode="after")`
    执行。若继承，一条 `scale: 9` 或 `at: 1.4` 的坏关键帧会在字段阶段直接抛
    `ValidationError` → FastAPI 返回 **422，整次合成请求失败**，
    正是 R30 要避免的事，而 `after` 校验器根本没机会跑。
    夹取改由下面的 before 校验器承担，落点与 `CameraKeyframe` 的范围完全一致。
    """
    at: float = 0.0
    easing: Optional[Literal["linear", "easeIn", "easeOut", "easeInOut"]] = None
    scale: float = 1.0
    x: float = 0.5
    y: float = 0.5
    roll: float = 0.0
    rotate_x: float = 0.0
    rotate_y: float = 0.0
    dolly: float = 0.0


class CameraMotion(BaseModel):
    ...
    keyframes: Optional[List[CameraKeyframeStop]] = None

    @field_validator("keyframes", mode="before")
    @classmethod
    def _normalize_keyframes(cls, raw):
        """规范化而非报错：一条坏曲线绝不能让整个合成请求 422（R30 / D42）。

        对**原始输入**（list of dict）做 §4.2.4 第 1–7 步：
        丢弃非 dict 项 / 分量与 at 按 CAMERA_RANGES 夹取 / 按 at 升序 /
        强制首尾 0 与 1 / 合并间隔 < MIN_KEYFRAME_GAP / 截断到 max_keyframes /
        末帧 easing 置 None。任何一步走不下去（非 list、有效项 < 2）→ 返回 None，
        motion 退化为两点运镜。**这个函数不允许抛异常。**
        """

    @model_validator(mode="after")
    def _mirror_endpoints(self):
        """D31 镜像的最后一道闸：keyframes[0] / [-1] 与 start / end 对齐。

        只做赋值，不做判断失败——所有会失败的清洗都已经在 before 阶段做完了。
        """
```

> **为什么不干脆在 before 阶段就把整个 `CameraMotion` 清洗一遍**：
> `start`/`end` 的 `ge/le` 是 v1 刻意留下的第二道防线（`video_models.py:122-125`
> 的注释写明了理由），本轮不动它——那条路径今天就在生产上跑着，
> 且前端 `toCameraMotionWire` 已经夹过一次，坏值只可能来自手改的工程 JSON，
> 让它 422 是可以接受的既有行为。变的只是**新增的 `keyframes`**：
> 它是可选字段，为了它把一次导出整个打回去，代价与收益完全不成比例。

---

## 7. 数据模型（Data Model）

### 7.1 新增类型

```ts
/** 曲线上的一个关键帧：取景七分量 + 窗口内归一化时刻 + 出向缓动。 */
export interface CameraKeyframeStop extends CameraKeyframe {
  /** 在运镜窗口内的归一化时刻 [0,1]。首帧恒为 0，末帧恒为 1（D31）。 */
  at: number;
  /** 本帧到下一帧那一段的缓动（D34）。末帧无意义，规范化后为 undefined。 */
  easing?: CameraEasing;
}
```

### 7.2 `CameraMotion` 增量

| 字段 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `keyframes` | `CameraKeyframeStop[]` | `undefined` | 2–8 项。**缺省即今天的两点运镜**。`keyframes[0]`/`[n−1]` 必须与 `start`/`end` 镜像（D31），平凡 2 点情形不落盘（D38） |

其余字段语义**全部不变**。`easing` 在有曲线时降级为 `keyframes[0].easing` 的镜像
（保留字段是为了 D30 的旧代码降级路径）。

### 7.3 常量

| 常量 | 值 | 依据 |
|---|---|---|
| `CAMERA_MAX_KEYFRAMES` | 8 | D36（交互上限，非 FFmpeg 上限；实测 32 点也能跑） |
| `MIN_KEYFRAME_GAP` | 0.02 | 归一化时刻的最小间隔。窗口 4s 时约 80ms，短于此的两帧在时间轴上不可区分，且会让分段除法趋近 0 |
| `CAMERA_SEGMENT_SAMPLES` | 16 | D43（评审 P1-1）：每段的最小采样数，保证最短段（0.02）也有 16 个样本；8 关键帧时总样本 113 点，与今天的 101 点同量级。这些采样都在**每条运镜一次**的路径上（前端有 LRU memo，后端一次导出一次），不在每帧路径上 |
| `max_expr_chars`（YAML） | 20000 | M2 实测 8985 字符可跑、15KB 滤镜串可跑，取约 2× 余量。**闸门作用于组装后的整条链**（评审 P2-3：`z_expr` 被内联 5 次，长度不是线性增长的） |
| `max_keyframes`（YAML） | 8 | 与前端 `CAMERA_MAX_KEYFRAMES` 对齐，运维可下调。**执行点在 `expand_stops` 内**（评审 P1-9）：pydantic 模型看不到 YAML，前端常量更看不到，只在那两处截断的话这个键就是个**死旋钮**——运维调成 4 不会有任何效果，比没有这个键更糟 |

### 7.4 `config/camera-motion.yaml` 增量

```yaml
camera_motion:
  # …既有键不变（enabled / supersample / interpolation / poly_degree /
  #   poly_degree_fallback / max_fit_error_px / dry_run_probe / stills）…

  # 单条滤镜链的字符上限。超过则把分段曲线降级为两点运镜并给出 warning（D40）。
  # 实测（FFmpeg 2025-05-15 full build）：单个 zoompan z 表达式 8985 字符、
  # 整条滤镜串 15KB 均可正常执行；20000 取约 2 倍余量。
  # 注意闸的是「组装后的整条链」：z 表达式会被内联进 x/y 各两次，
  # 所以 scale 的分段串在一条 zoompan 里出现 5 次，长度不是线性增长的。
  max_expr_chars: 20000
  # 关键帧数上限，与前端 CAMERA_MAX_KEYFRAMES 对齐。
  # 真实执行点在 expand_stops()（截断时保留首尾、中间等距淘汰）；
  # 前端常量与 pydantic 校验器都看不到本文件，只改那两处的话这个键无效。
  max_keyframes: 8
```

> **加载器约束（评审 P1-9）**：`load_camera_config`（`camera_motion.py:134-152`）
> 是逐字段手写的 `section.get(key, <默认>)`。新增这两个字段时，
> **`get` 的第二参数必须与 `CameraMotionConfig` 的 dataclass 默认逐字相同**。
> v1 评审就在 `supersample` 上抓到过这类不一致（YAML 里省掉该键会静默切到
> 7× 慢的那条路径）。T19 用「裁剪掉这两个键的 YAML」与「完全没有 YAML」
> 两种加载结果逐字段相等来钉死它。

---

## 8. 实施顺序（给下游开发节点）

顺序有依赖，**不得调换 P1 与 P2**：数学内核定不下来，两端都会返工。

- **P1 — 数学内核（TS）**：`keyframes.ts` 新增（含 `trajectorySamples`，D43）+
  `easing.ts` 的 τ 两步式 + `identity.ts` / `fingerprint.ts` 推广 +
  `cameraGeometry.ts` 的两个采样循环换点集（§5.1 第 10a 条）。
  **先写 T1 恒等式测试与 T18 采样集测试再写实现**（T1 是全轮零回归的锚，
  T18 的第 ① 条是"2 关键帧逐元素相同"，两条一起把 D37 钉在地上）。
- **P2 — 数学内核（Python 镜像）+ 黄金向量**：`camera_motion.py` 的镜像函数
  （含 `trajectory_samples` 与 **`is_identity_camera_motion` 的推广，评审 P0-1**），
  扩充 `camera-golden.json`，**同时改 `tests/test_camera_motion.py` 的
  `_wire_from_camel` / `_resolve`**（§5.4 第 37 条，否则两端对不上），
  两端对齐到 1e-6。
- **P3 — 导出表达式**：`_piecewise_expr` + 四个分量的 D37 二选一 +
  `_build_perspective_segment` 逐段拟合 + `max_expr_chars` 闸
  （**warnings 必须 `extend` 不得丢弃，评审 P0-3**）。
  **先写 T2 字符串零回归测试**。
- **P4 — wire 与模型**：`wire.ts`（D38 省略规则）+ `video_models.py`
  （**`mode="before"` 规范化，D42**）+ 持久化往返 T21。
- **P5 — 预览接线**：`resolveCameraDraw` 换步；跑 v1/v2 全部既有预览测试确认全绿
  （这一步应当**一个断言都不用改**，若要改则说明 D32 被破坏了，停下来查）。
- **P6 — 面板 UI**：`stageInteraction.ts`（纯函数先行，含 T14 的双尺寸用例）→
  `StageOverlay.tsx`（**viewBox 画 / rect 量、非被动 wheel、不订阅每帧**——
  评审 P1-4/P1-5/P1-6）→ `KeyframeStrip.tsx`（**窗口对齐与 `[+]` 禁用规则**，D44）→
  `ParameterControls.tsx` → `CameraMotionModal.tsx` → i18n（**三处同步**，评审 P2-2）。
  这一阶段跑完立刻做一次手动走查，别攒到 P7：R41 那三条都不会让测试变红。
- **P7 — 收口**：§9.4 量化基线采集、§9.3 桌面走查、把实施中发现的方案缺陷
  写回本文档的「实施过程发现的方案缺陷」段。

---

## 9. 测试与验收标准

### 9.1 单元测试（必须全部通过）

| # | 用例 | 断言 |
|---|---|---|
| **T1** | 老运镜恒等式（**全轮锚点**） | 四种缓动 × u∈{0,0.05,…,1} × 七分量：`keyframeAtTrajectory(m, tauAtProgress(m,u))` 与旧式 `keyframeAt(m, ease(u,m.easing))` 差 < 1e-12 |
| **T2** | 导出字符串零回归 | 对 `CAMERA_PRESETS` 的全部 **16** 个预设（`push-in`…`sway-3d`）各构一条运镜，`build_camera_filter_chain` 的输出与本轮前的基线串**逐字符相等**（基线串以常量数组钉在测试里） |
| **T3** | 分段表达式结构 | 4 关键帧 → `z` 表达式含 2 个 `if(lt(`、末段无 `if`；`rotate` 的 `a=` 用 `n` 不用 `on`；`perspective` 八角各自独立嵌套 |
| **T4a** | 恒等判据 · TS（**P0**） | `start=end=默认` + 中间帧 `scale=2` → `isIdentityCameraMotion === false`；全默认 stops → `true`；`intensity=0` + 首帧默认 → `true`；老运镜三种情形判据逐项不变 |
| **T4b** | 恒等判据 · Python（**P0**，评审 P0-1） | 同一条曲线送进 `is_identity_camera_motion` → `False`；并断言 `build_camera_filter_chain` 与 `build_still_overlay_plan` 对它**都产出非空运镜**（不是只测判据本身——这两个入口才是缺陷真正暴露的地方） |
| **T5** | 指纹（**P0**） | ① 老运镜指纹逐字符不变；② 改中间帧任一分量 → 变；③ 改 `at` → 变；④ 改段缓动 → 变；⑤ 两条只差中间帧的曲线拿到**不同**的 `cameraMotionConstants` |
| **T6** | 规范化 | 乱序 `at` 被排序；`at[0]≠0` 被强制；间隔 <0.02 被合并；9 帧被截到 8 且首尾保留；末帧 `easing` 被清空；平凡 2 点 → 字段被删 |
| **T7** | 分割（D41） | 4 关键帧 clip 在 t=2 分割：两半 `keyframes` 逐项相等；左半末帧与右半首帧解析出的关键帧差 < 1e-6 |
| **T8** | 插入不跳变 | 在 u=0.37 插入关键帧后，`resolveCameraDraw` 在该时刻的 `crop`/`quad` 与插入前差 < 1e-9 |
| **T9a** | 反向 · 曲线 | 5 关键帧反向后：`at` 序列为原序列的 `1−at` 逆序；`easeIn` 段变 `easeOut` 段；再反向一次回到原值 |
| **T9b** | 反向 · 两点（D46，评审 P1-10） | 2 关键帧运镜反向后，输出与**本轮之前**逐字段相同——特别是 `easing` **不被镜像** |
| **T10** | 长度闸（D40） | 构造超 `max_expr_chars` 的曲线 → 返回的链等于同 motion 去掉 `keyframes` 的链；**断言只降一级**（不会再触发第二次降级）；**warnings 同时含"two-keyframe"文案与降级前已产生的那条文案**（评审 P0-3 的回归闸） |
| **T11** | 模型规范化不报错（R30 / D42） | 乱序 / 超 8 / `at` 越界（`at: 1.4`）/ **分量越界（`scale: 9`）** / 缺首尾 / `keyframes` 是字符串 / 数组里混进 `null` —— 送进 `CameraMotion` → **一律不抛 `ValidationError`**，字段被规范化或置 `None`。`scale: 9` 这一例是 D42 的核心断言：它在 v1 的写法下必然 422 |
| **T12** | wire 省略（D38） | 2 点运镜 → 请求体**无** `keyframes` 键且与基线逐字段相等；3 点 → 有且 `at` 升序 |
| **T13** | 静帧多关键帧 | `build_still_overlay_plan` 传入 4 关键帧运镜 → `chain` 含分段 `if`、`input_args` 仍为 `-loop/-t/-framerate`、`overlay_suffix` 仍为 `:eof_action=pass`（v2 D17/D25 不受影响） |
| **T14** | 舞台交互几何 | 拖动增量按 `crop.w` 折算（2× 放大时同样像素位移得到一半归一化位移）；滚轮指数步进；越界夹取；`cropToStageRect` 与 `quadToStagePoints` 往返一致；**（评审 P1-4）实测矩形 ≠ 后备存储的用例**：`w=960` 时同样的 `dx` 得到 `w=480` 时一半的归一化位移——证明换算吃的是形参而不是 `STAGE_W` 常量 |
| **T15** | 关键帧轨契约（N12 源码级） | listbox/option 角色、首尾 `aria-disabled`、`[+]` 到 8 禁用、`[🗑]` 对首尾禁用、每段一个 easing `<select>` |
| **T16** | 合成签名 | 改中间关键帧 → `useTimelineComposition` 的签名变化（预览重绘闸） |
| **T17** | 越界提示 | `hasClampedComponent` 对"仅中间帧越界"的曲线返回 true（老实现只看首尾会漏）；且该判断走 `trajectorySamples`，不依赖 21 点均匀网格是否恰好命中 |
| **T18** | 采样集（D43，评审 **P1-1**） | ① 2 关键帧运镜的 `trajectorySamples` 与 `[0,0.01,…,1]` **逐元素相等**（D37 的机械保证）；② 任意曲线的采样集**包含每一个 `at`**；③ 构造一条「第 2 帧 `roll=45`、两侧为 0、`at` 落在 0.505（不在 `i/100` 网格上）」的曲线，断言 `rollPadForMotion` ≥ `rollCover(45, aspect)` —— **v1 的均匀网格在这条用例上会取小**；④ 3D 同款：内部 stop 的 `coverScale` 不被低估；⑤ TS 与 Python 的采样集逐元素相等 |
| **T19** | 配置加载（评审 P1-9） | 「裁剪掉 `max_expr_chars` / `max_keyframes` 两个键的 YAML」与「完全没有 YAML」加载出的 `CameraMotionConfig` **逐字段相等**；把 `max_keyframes` 调成 4 → `expand_stops` 真的只吐 4 个 stop（证明它不是死旋钮） |
| **T20** | 指纹的四个消费者（评审 P2-1） | 只改中间关键帧的两条运镜：`cameraMotionFingerprint` 不同 ⇒ ① `useTimelineComposition` 签名不同、② `useCompositionPlayback` 的 `cameraMotionSignature` 不同、③ `cameraMotionConstants` 不复用、④ 面板脏检查判定为 dirty（A44 的二次确认真的会弹） |
| **T21** | 持久化往返（评审 P2-7） | `TimelineRepository` 存-取：带曲线 → `keyframes` 逐项相等；**无曲线 → 序列化 JSON 与本轮前逐字符相同**；工程 JSON 里的乱序/超限 `keyframes` 载入后被规范化且不抛 |
| **T22** | 舞台/轨坐标对齐（D44，评审 P1-3） | 给定 `startOffset=1, duration=2, clipDuration=6`：擦洗条 `u=0.5`（clip 第 3s）→ `at=1.0`；`u=0.1`（窗口外）→ `[+]` 判定为禁用；`at` 距已有 stop < `MIN_KEYFRAME_GAP` → 禁用。纯函数级，不挂载组件（N12） |

### 9.2 跨语言黄金向量（§9.3 沿用 v1 机制）

`camera-golden.json` 新增 ≥8 个多关键帧用例（§5.4 第 30 条列明）。
Python 侧继续受 `CAMERA_GOLDEN_REQUIRED=1` 强制（v1 P2-8），
**不允许 `pytest.skip` 静默通过**。判据：两端 `crop`/`roll`/`rollPad`/`quad`
逐分量差 < 1e-6。

### 9.3 集成 / 人工验收（Definition of Done）

| # | 验收项 |
|---|---|
| **A31** | 打开面板，选一个 2D 预设 → 面板**与今天视觉一致**（不加关键帧感觉不到本轮存在） |
| **A32** | 擦洗到中段按 `[+]` → 轨上出现第三个关键帧，**画面不跳变** |
| **A33** | 选中该关键帧，在舞台上拖动 → 取景实时跟手，运动路径折线随之更新 |
| **A34** | 滚轮缩放、`Shift`+横拖改 roll（2D）/ 环绕（3D）均生效且被范围夹住 |
| **A35** | 拖动关键帧改时刻 → 节奏改变；首尾帧拖不动且有说明 |
| **A36** | 每段可独立选缓动；`easeIn` 段与 `linear` 段的手感肉眼可辨 |
| **A37** | 应用后主预览按新曲线播放；撤销一次整条运镜回到应用前（单条历史） |
| **A38** | 导出成片与预览逐帧对齐：取 3 个时刻，成片帧与预览帧的取景框偏差 ≤1px（沿用 v1 A6 判据、v2 P2-5 的取样限制：素材位置框须整框在画面内）。**取样时刻不要正好落在某个 `at` 上**（评审 P2-9）：`at` 以 6 位小数进表达式，`lt()` 在边界那一帧可能划进相邻段；两段在边界点上连续，所以误差有界（不超过一帧的运动量），但没必要拿边界去考 ≤1px |
| **A39** | 3D 五关键帧环绕导出正确（逐段拟合生效，无整体降级 warning） |
| **A40** | 图片素材上做 4 关键帧运镜 + **同时存在字幕** → 成片里运镜与字幕都在（v2 H3 的回归面） |
| **A41** | 分割一个带曲线的 clip → 切点处画面连续，不回跳 |
| **A42** | 8 关键帧满载时 `[+]` 禁用且有 `title` 说明 |
| **A43** | 全键盘完成一次曲线编辑：`Tab` 到轨 → `←→` 改时刻 → `Tab` 到舞台 → 方向键改取景 → 应用。屏幕阅读器读得出关键帧序号与时刻 |
| **A44** | 关闭面板前有未应用改动 → 仍然二次确认（v1 行为不回退）。**只改了中间关键帧也必须弹**（指纹含 stops 的直接体现，见 T20） |
| **A45** | （评审 P1-3）把运镜窗口改成 `startOffset=1s / duration=2s`：擦洗条上出现窗口高亮段，关键帧轨与该段左右对齐；把播放头拖到窗口外，`[+]` **禁用且 `title` 说明原因**；拖回窗口内按 `[+]`，新关键帧落在轨上正确的位置且画面不跳变 |
| **A46** | （评审 P1-5）在舞台上滚动滚轮：只有取景缩放，**面板主体不跟着滚动**；控制台无 passive listener 警告 |

### 9.4 量化基线（补齐 v1 P6 / v2 §9.4 的欠账）

必须实测并把数字写回本文档：

1. 1080p / 10s clip：无运镜 / 2 关键帧 2D / 8 关键帧 2D / 5 关键帧 3D 的导出耗时。
   **预期**：按 M5，关键帧数对耗时无显著影响；若实测反直觉，说明实现里
   把某个常量算进了每帧路径，必须查。
2. 主判据继续取「`filter_complex` 字符串 + 完整命令行逐字符相同」
   （v2 P2-7），MD5 仅作辅助。

#### 9.4.1 实测结果（2026-08-05，本机 FFmpeg `2025-05-15-git-12b853530a-full_build`）

条件：`testsrc2` 1080p / 30fps / 10s → `scale=1920:1080` + 本轮构造的运镜链 →
`libx264 -preset veryfast -f null -`。每例预热 1 次后跑 3 次取中位数。
链由 `build_camera_filter_chain` 真实产出（非手写）。

| 用例 | 耗时 | 相对无运镜 | 滤镜链长度 |
|---|---|---|---|
| 无运镜 | **1.15s** | 1.00× | 0 |
| 2 关键帧 2D（push-in） | **1.49s** | 1.30× | 903 |
| **8 关键帧 2D 曲线** | **1.50s** | **1.30×** | 6602 |
| 2 关键帧 3D（orbit-left） | **2.99s** | 2.60× | 3137 |
| **5 关键帧 3D 环绕** | **3.27s** | 2.84× | 10637 |

**结论与 M5 一致，且更强**：2D 侧 8 关键帧与 2 关键帧的耗时**完全相同**
（1.50s vs 1.49s，差异远在噪声内），而滤镜链长了 7.3 倍——**分段表达式的求值
开销可以忽略**。3D 侧 5 关键帧比 2 关键帧只贵 9%（3.27s vs 2.99s），
而 3D 相对 2D 贵 2 倍：**真正的成本是 `perspective` 这个滤镜本身，不是关键帧数、
也不是逐段拟合**（D39 的逐段拟合只改变系数个数，不改变每帧的采样工作量）。

即：**多关键帧在导出侧几乎免费，性能预算不该花在压缩表达式上**
（这也是 M6 的 `st()/ld()` 被否决的实测依据在本轮再次被确认）。
`max_expr_chars = 20000` 相对 8 关键帧实测的 6602 字符仍有 3 倍余量。

### 9.5 实测探针（可复现）

本轮 §4.4.5 的 M1–M6 由探针脚本
**`docs/plans/camera-motion-keyframe-curves/probe_ffmpeg_piecewise.py`** 产出
（`ffmpeg -f lavfi` + `-f null -`，全程不落盘）。直接运行即可复现：

```bash
python docs/plans/camera-motion-keyframe-curves/probe_ffmpeg_piecewise.py
```

它覆盖：嵌套 `if` 在 `zoompan`/`rotate`/`perspective` 三处、
n∈{3,5,8,12,32} 的长度梯度、`st()/ld()` 可用性、1080p 的 2kf vs 8kf 计时对照。
本轮实测输出（供比对）：M1 全部 rc=0；M2 单表达式 8985 字符 rc=0；
M3 滤镜串 6800 字符 rc=0；M4 rc=0；M5 `2kf: 0.84s` / `8kf: 0.75s`；M6 两种写法均 rc=0。
**若下游机器的 FFmpeg 构建不同而 M1/M3/M4 任一失败，必须停下来改设计
（回退到"逐段各生成一条滤镜、用 `enable=between(t,…)` 串接"的备选形态），
而不是硬着头皮上。**

---

## 10. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| **R29** | 指纹漏掉 stops → 预览不重绘 / 常量 memo 污染 | 高（静默错误，用户看到"改了没反应"或 3D 构图错位） | §4.2.6 明确写法 + T5 双向断言（老指纹不变 / 新字段必变）；memo 键复用同一指纹，天然连坐 |
| **R30** | pydantic 对坏 `keyframes` 抛 `ValidationError` → 整个 `/api/video/compose` 422 | 高（一条曲线毁掉整次导出） | D-级约束：校验器**只规范化不报错**，最坏退化为 `None`（两点运镜）；T11 钉死 |
| **R31** | 3D 逐段拟合在短段上样本不足或病态 | 中（整体降级为 2D，用户丢透视） | 每段固定 `POLY_FIT_SAMPLES` 个样本（不按段长缩放）；沿用既有 `poly_degree_fallback` 二次尝试；失败仍走 v1 的 2D 降级 + warning，不失败导出 |
| **R32** | 表达式过长撑爆 FFmpeg 命令行/解析 | 中 | D40 长度闸（实测余量 2×）+ 一级降级；`allow_collapse` 参数防递归 |
| **R33** | 舞台拖动与 `Modal` 的焦点陷阱/背景点击关闭冲突 | 中（拖到画布外松手导致面板关闭，工作丢失） | 用 `setPointerCapture` 把整个拖拽生命周期锁在覆盖层；拖拽期间置一个 `isDraggingRef`，`handleRequestClose` 在其为真时直接 return |
| **R34** | 首尾镜像不变量被某条写入路径绕过 | 高（D30 的向后兼容全线失效） | `normalizeCameraKeyframes` 是唯一写入闸：面板所有编辑动作、`sanitizeCameraMotion`、后端校验器三处都必须过它；T6 覆盖 |
| **R35** | 用户把关键帧堆在一起导致极短段、缓动数值抖动 | 低 | `MIN_KEYFRAME_GAP` 在规范化时合并；轨上拖动时实时夹取 |
| **R36** | `keyframeAt` 语义变更（时间→轨迹）被后人误读 | 中 | 保留导出但在 doc 注释里显式标注；`easing.ts` 顶部加一段"两个参数空间"的说明；T1 是它的活文档 |
| **R37** | 面板新增两个组件后，`jsx: preserve` 下无法挂载测试，覆盖率虚高 | 低 | N12 的既定做法：几何与状态迁移全部抽进 `stageInteraction.ts` / `keyframes.ts` 这类纯模块，组件只剩接线；T14/T15 分别覆盖两侧 |
| **R38** | 桌面端 GUI 走查再次因环境缺失被跳过（v1 C9 → v2 C16 的连续欠账） | 中（交互类缺陷只能靠人眼） | 本轮把它单列为放行条件 C25，并要求**据实声明**：跑不了就写"未执行"，不允许标记为已完成 |
| **R39** | **两端不对称**：某个判据/采样只在一端推广了（评审 P0-1 就是实例：`is_identity_camera_motion` 前端改了、后端没改） | 高（预览有、成片没有，且**无 warning**——最难查的一类） | 凡是"TS 与 Python 各有一份"的函数，本轮改动清单必须成对出现；C29 用 grep 逐对核；黄金向量对 `rollPad`/`coverScale` 的比对能顺带抓住采样集不一致 |
| **R40** | 后端把坏曲线当成"请求非法"而不是"数据要清洗"，一次导出整个 422 | 高 | D42 把清洗放到 `mode="before"`；T11 用 `scale: 9` 这种**字段级越界**做主用例（这正是 v1 写法必然失败的那一类） |
| **R41** | 面板交互被既有物理约束打败：常量尺寸 ≠ CSS 尺寸（P1-4）、React 的 wheel 是 passive（P1-5）、每帧回调打穿零渲染优化（P1-6） | 中（体验类缺陷不会让测试变红，只会让用户觉得"这软件手感很差"） | 三条都已在 §4.5.2 写成硬约束并各配一条验收（T14 / A46 / D45）；实施时**先做 `stageInteraction.ts` 纯函数与一次手动走查**，再接组件 |

---

## 11. 与既有设计的关系 / 文档债

- 本方案**继承并不推翻** v1 与 v2 的全部决策。若实现中发现与 D1–D29 冲突，
  以先前决策为准并回来改本文档，而不是就地改老代码。
- 结清的历史项：v1 §12-2「多关键帧曲线」= 本轮 G1；v2 §13-4「预览里直接拖取景框」
  = 本轮 G3（限面板舞台，见 N11）。
- 仍**未**结清、本轮明确不做：v1 §12-3 运镜模板库、v1 §12-4 AI 建议运镜（N9）。
- v2 P2-3（面板底图取源不一致）**已在实现中解决**：`TimelinePanel.tsx:214-222`
  现为 `material?.url ?? target.url`。本轮无需再处理。
- v2 P2-5（位置框越出画面时 ≤1px 预算必然失败）**仍然存在**，本轮不修，
  A38 的取样素材必须整框在画面内。

---

## 12. 放行条件（下游节点必须逐条满足）

| # | 条件 |
|---|---|
| **C20** | **T1 恒等式**通过：老运镜的 τ 两步式与旧式逐位相同（差 < 1e-12） |
| **C21** | **T2 字符串零回归**通过：全部 16 个预设的滤镜串与本轮前逐字符相等；且 T12 证明 2 点运镜的请求体不含 `keyframes` |
| **C22** | **T4a + T4b + T5 + T20 四条**都有专门用例并通过（恒等判据推广 **两端各一**、指纹含 stops 且四个消费者都被覆盖）。只做前端那一半不算达成（评审 P0-1） |
| **C23** | `normalizeCameraKeyframes` 是**唯一**曲线写入闸，且面板/`sanitize`/后端校验器三处都经过它（可用 grep 证明没有别处直接赋值 `keyframes`） |
| **C24** | 后端对坏曲线**规范化而非 422**（T11），且 D40 的降级**只降一级**（T10） |
| **C25** | §9.3 桌面端走查**真的执行并留痕**；确实无法执行时，必须在文档中据实声明"未执行"，**不得标记为完成**（v1 C9 / v2 C16 已经连欠两轮） |
| **C26** | §9.4 量化基线**采集到真实数字**并写回 §9.4；若与 M5 结论相悖，必须给出解释 |
| **C27** | P5 完成时，v1/v2 的既有预览测试**一个断言都不用改**即全绿；若必须改，说明 D32 被破坏，停止并回查。**豁免清单（评审 P1-7，仅此两处）**：`splitRebase.test.ts:19` 与 `tests/test_camera_motion.py::_resolve` —— 这两个是手写的 `resolveCameraDraw` 影子实现，必须跟着换成 τ 两步式。改动它们**以外**的任何既有断言即视为 D32 被破坏 |
| **C28** | 黄金向量新增用例在 `CAMERA_GOLDEN_REQUIRED=1` 下两端对齐（不得 skip）。前置：`tests/test_camera_motion.py` 的 `_wire_from_camel` 已认识 `keyframes` 并做 camel→snake 转换（§5.4 第 37 条），否则这条**不可能达成** |
| **C29** | **两端对称核对（R39）**：`is_identity_camera_motion`、`trajectory_samples`、`expand_stops`、`tau_at_progress`、`keyframe_at_trajectory` 五对函数，TS 与 Python 各有一份且行为一致；逐对给出 grep 证据 |
| **C30** | **降级不吞 warning（P0-3）**：T10 断言降级后的 warnings 同时包含降级文案与降级前已有的文案 |
| **C31** | **坏曲线不 422（P0-2 / D42）**：T11 的七个坏输入（含 `scale: 9` 这种字段级越界）全部规范化通过，`/api/video/compose` 不返回 422 |
| **C32** | **面板三条物理约束（R41）**：① 指针换算取自 `getBoundingClientRect()`（T14 的双尺寸用例通过）；② wheel 用非被动原生监听（A46 走查通过、无 passive 警告）；③ `MotionPreviewStage` 没有新增每帧回调（代码级核对，D45） |

### 不予放行的情形

- 给多关键帧另写一套数学 / 另写一套面板 / 另写一套导出路径；
- 为了"省事"把 `keyframes` 无条件写进 wire 或工程 JSON（D38 失守，零回归比对闸永久红）；
- 删除或改写 `keyframeAt` 的签名，导致 `rollPadForMotion` / `coverScaleForMotion` /
  `_needs_zoom_segment` 的采样空间变化（存量 3D 运镜构图会漂移）；
- 把 `version` 升到 2（存量工程运镜被静默清空）；
- 在 `TimelineItem` / 工具栏里内联重写可用性判据（v1 P2-7 的第四次复发）；
- **只在一端推广判据/采样**（评审 P0-1 / R39）：前端 `identity.ts` 改了而
  `camera_motion.py:485` 没改，等于亲手做出一个"预览有、成片没有、状态里一句话都没有"的缺陷；
- **为了让 `keyframes` 的校验"更严格"而让后端返回 422**（评审 P0-2 / D42）：
  一条可选的曲线不该有权毁掉整次导出。

---

## 13. 后续扩展点（明确不在本轮）

1. **每分量独立曲线**（N7 的反面）：需要重新论证 `coverScale` 能否仍取运镜级常量。
2. **贝塞尔缓动手柄**（N8）。
3. **运镜模板库 / 收藏**（v1 §12-3）：数据模型已经是纯 JSON，落地成本主要在 UI。
4. **AI 建议运镜**（v1 §12-4）：`video-editing-agent` 增一个 `applyCameraMotion` 工具，
   复用 `setCameraMotionAction`。有了多关键帧，AI 能表达的镜头语言才真正够用。
5. **主预览上的直接取景**（N11）：需要先解决与图片位置框拖拽的手势冲突。
6. **两点运镜的反向也镜像缓动**（评审 P1-10 / D46）：今天
   `reverseCameraMotion`（`cameraPresets.ts:99-106`）反向时不动 `easing`，
   于是反向一条 `easeIn` 得到的还是 `easeIn`，节奏与预期相反。这是 v1 的遗留缺陷，
   改动本身只有一行，但它会改变存量"反向"按钮的输出，必须配自己的基线更新与验收，
   不该搭本轮零回归的顺风车。
7. **`_dry_run_cache` 的容量上限**（评审 P2-5）：`camera_motion.py:223` 是个无上限
   dict，键为整条滤镜串。多关键帧让不同串的数量成倍增长，长驻后端进程会缓慢涨内存。
   加一个 LRU 上限（128）即可，与本轮功能无关，故不在本轮做。

---

**字数自检**：正文约 9k 字（远超 800 字下限），覆盖概述 / 技术设计 /
文件模块变更计划 / 接口设计 / 数据模型 / 测试与验收 / 风险与缓解 / 放行条件全部要求段落。
**下一节点**：按 §8 的 P1→P7 顺序实施，逐条对照 §12 的 **C20–C32** 验收。

---

## 实施过程发现的方案缺陷

> 实施时间：2026-08-05。以下 8 条是**照着 v2 正文写下去会出问题**、或正文与代码
> 现实冲突的地方。每条都按放行条件第 5 项的要求先写在这里，再按「修正后的做法」
> 落到代码里，**没有一条是就地绕过**。

### F1（**功能缺陷**）`insertKeyframeAt` 存「解析值」会把 intensity 施加两次

§4.5.1 与 §6.2 都写：新关键帧的七分量取
`keyframeAtTrajectory(motion, tauAtProgress(motion, u))`。但按 §4.2.3，
`keyframeAtTrajectory` **已经施加了 intensity**（`raw = S₀ + (v − S₀)·I`）。
把这个值存成 stop，下次求解会再乘一次 I：

```
存入： s = S₀ + (traj(τ) − S₀)·I
再解： k = S₀ + (s − S₀)·I = S₀ + (traj(τ) − S₀)·I²
```

`I = 1` 时恰好相等，所以默认情形看不出来；`intensity = 0.5` 时按下 `[+]`
画面**立刻跳变**——正是 §4.5.1 自己写的「添加不应该跳变」被违反。
T8 若只用默认 intensity 也发现不了。

**修正**：在 `keyframes.ts` 增加纯几何的 `trajectoryAt(motion, tau)`
（分段线性、不含 intensity、不夹取），`keyframeAtTrajectory` 定义为它之上
再施加 D35 与夹取。`insertKeyframeAt` 存 `trajectoryAt` 的结果。
T8 相应改成 `it.each([1, 0.5, 0])`，三个 intensity 都断言 `crop` 差 < 1e-9。

### F2（**数据模型**）`at` 需要规范精度，否则「反向两次」不回到原值

§4.6 的 `at_i' = 1 − at_{n−1−i}` 在浮点下不是对合：`1 − (1 − 0.8)` 得到
`0.19999999999999996`。T9a 的「再反向一次回到原值」按字面写必然红，而且
`at` 会随每次编辑累积噪声，两端的 stop 列表也会在末位比特上分叉。

**修正**：`at` 在规范化的第 2 步统一取 6 位小数
（`floor(x·1e6 + 0.5)/1e6`，即 JS 的 `Math.round`，**不是** Python 的 `round`
——后者是银行家舍入，两端会在 .5 处分歧）。6 位是因为 `_num` 本来就以 6 位
小数写进 FFmpeg 表达式，下游看不到更多精度。
配套：`MIN_KEYFRAME_GAP` 的比较加 `1e-9` 容差，否则「把关键帧拖到极限位置」
（`next.at − GAP`）经舍入后可能变成 `0.019999`，被规范化当成过近而**删掉**，
表现为「拖到头关键帧就消失」。TS / Python / pydantic 三处同款。

### F3（**零回归**）指纹追加空段会多一个尾随 `|`

§4.2.6 写 `[...现有 9 段, stopsPart].join('|')` 且「缺失时产出空串」。
这两句在 `join` 语义下自相矛盾：追加空串仍会多出一个分隔符，老运镜的指纹
从 `…|1.0000,…` 变成 `…|1.0000,…|`，T5 ①「逐字符不变」必红。

**修正**：**有曲线时才 push**。四个消费者只做相等比较，不关心格式，
所以条件追加同时满足「老指纹逐字符不变」与「曲线必须进指纹」。

### F4（**接口**）`hasClampedComponent` 的 `samples` 形参改后无意义

§5.1 第 4 条只说改采样集合。但原签名是 `(motion, samples = 20)`，
改走 `trajectorySamples` 之后这个形参**无处可用**（采样点由曲线决定），
留着会让调用方以为能控制密度。

**修正**：删除该形参。唯一调用点 `CameraMotionModal.tsx:162` 本来就没传。
2 关键帧下新旧结果一致（直线的极值在端点，21 点与 101 点等价），
已在 T17 的「两点运镜不变」用例里钉住。

### F5（**测试可行性**）`STAGE_VIEW_W/H` 不能定义在 `.tsx` 里

§4.5.2 把 480×270 视作舞台组件的常量。但 N12 的根因是
`jsx: "preserve"`——vitest **根本无法 import 任何 `.tsx`**（会报
`Failed to parse source for import analysis`）。T14 需要拿这两个常量做
「实测矩形 ≠ 后备存储」对照，从 `StageOverlay.tsx` 导入会让整个测试文件加载失败。

**修正**：两个常量移到 `stageInteraction.ts`（纯 `.ts`），
`StageOverlay.tsx` 从那里 import。注释写明「这是**画**的空间，
**量**一律用 `getBoundingClientRect()`」。

### F6（**文件计划**）需要一个 v2 未列出的纯模块 `keyframeStripGeometry.ts`

§4.5.1 的 `[+]` 三条禁用规则（窗口外 / 过近 / 到顶）与 T22 是纯逻辑，
但 §5.2 只规划了 `KeyframeStrip.tsx`。规则若写在组件里，在 N12 下**不可测**，
而 T22 是 A45 的唯一自动化守门人。

**修正**：新增 `keyframeStripGeometry.ts`（`decideInsertAt` / `retimeBounds` /
`canRemoveStop` / `pointerToAt` / `stopOffset`），组件只剩接线。
这与 §5.2 第 14 条把手势几何抽进 `stageInteraction.ts` 是同一个理由，
只是 v2 漏了轨这一半。文件计数 39 → **41**（另加 F7 的 `trajectory.test.ts`
已在计划内，此处仅 +1 源文件 +1 测试文件）。

### F8（**两端一致性**）`max_keyframes` 的截断没有传到四个采样点

§7.3 把 `max_keyframes` 的执行点定在 `expand_stops` 内（评审 P1-9 的正确修正）。
但 `roll_pad_for_motion` / `cover_scale_for_motion` / `_needs_zoom_segment` /
`_needs_roll_segment` 的签名里**没有 config**，于是它们内部的
`trajectory_samples(motion)` 会各自 `load_camera_config()` 拿**默认** config。

后果：运维把 `max_keyframes` 调成 4 时，滤镜链按 4 个 stop 构造，
而 `roll_pad` 却按 **8 个 stop 的轨迹**求最大值。若被截掉的恰好是 roll 峰值，
`roll_pad` 会大于该链真正需要的值——而 `roll_pad` 不只是「多留边」，
它进 `compute_crop_rect` **直接决定取景**（`w = RP/S`），
所以成片的构图会整体偏离预览。方向是「多裁」而不是「露黑角」，
所以不会有明显破绽，只会 WYSIWYG 悄悄不准——本项目最不该留的那一类。

**修正**：四个函数各加一个可选尾参 `config`，
`build_camera_filter_chain` 与 `_build_perspective_segment` 在调用时传自己那份
（外部调用方不传时行为与今天完全一致，签名向后兼容）。
新增用例 `test_max_keyframes_also_governs_the_trajectory_maxima`：
把 roll 峰值放在第一个内部 stop 上，`max_keyframes=3` 会淘汰它，
断言 `roll_pad` 相应回到 1.0。

> 顺带记录一个**不是缺陷**的观察，免得后人以为写错了：截断到 3 个关键帧时
> 保留的是「首、尾、最居中的那个内部 stop」（`target == 1 → round(span/2)`），
> 不是「首、尾、第一个内部 stop」。这是 §4.2.4 第 6 步「中间等距淘汰」的正确行为。

### F7（**C27 豁免清单**）还有第三处既有断言必须改

C27 列了两处手写 `resolveCameraDraw` 影子实现作为豁免。实施中发现第三处：
`CameraMotionModal/__tests__/CameraMotionModal.test.ts` 的
「flips presetId to custom on any advanced-field edit」断言
`ParameterControls.tsx` 源码里含 `presetId: 'custom'`。本轮按 C23
把「置 custom」收进唯一写入闸 `setKeyframeComponent`，组件里自然不再有这个字面量。

**这不构成 D32 被破坏**：它是**源码级契约**断言（N12 下的替代品），
不是预览行为断言，改的是「谁负责置 custom」而不是「置不置」。
修正后该用例断言得更强：组件必须走 `onKeyframeComponent`、
**且不得**自建 `{ ...motion[edge] }`、**且**闸里确实有 `presetId: 'custom'`。
C27 的豁免清单应记为**三处**。

### F9（**评审补充 · 面板 WYSIWYG**）覆盖层画 stop 原值，`intensity ≠ 1` 时与画面对不上

§4.5.2 写「取景框：把选中关键帧的 `crop`（经 `computeCropRect`）反算成舞台坐标的矩形」。
照字面实现就是 `computeCropRect(stops[i], rollPad)`——吃的是**存进 stop 的原始分量**。
但 D35 规定实际解析值是 `k = S₀ + (stop − S₀)·I`，而面板在选中 / 拖动关键帧时会把播放头
钉到该帧的 `at` 上（§4.5.2 末条），于是同一块画面上：canvas 画 `k`、覆盖层画 `stop`。
`intensity = 1` 时两者恒等（默认情形永远看不出来），`intensity = 0.5` 时取景框、3D 四角
线框、运动路径**三样一起**偏到画面永远不会到达的位置。这正是本轮反复强调的
「两处各说各话」，只不过这次两处都在面板里，且不会让任何测试变红（N12 下组件不挂载）。

**修正**：覆盖层的三样绘制一律先经 `keyframeAtTrajectory(motion, stop.at)` 解析再画——
在 stop 上恒有 `τ = at`（终于该 stop 的那一段 `s = 1`），因此与 `resolveCameraDraw`
同源逐位相同；手势的读 / 写仍取 stop 原值，否则 `intensity` 会被折进去两次（同 F1）。
`intensity = 1` 时输出逐位不变，默认情形零回归。

---

## 放行条件核对（实施节点自查）

| # | 条件 | 状态 | 证据 |
|---|---|---|---|
| **C20** | T1 恒等式 < 1e-12 | ✅ | `trajectory.test.ts`「T1」3 例（16 预设 × 4 缓动 × 21 个 u × 7 分量，另加 6 个 intensity） |
| **C21** | 16 预设滤镜串逐字符相等 + T12 | ✅ | `test_camera_motion_keyframes.py::TestStringZeroRegression`，基线由 `git show HEAD:` 的**改前代码**实跑生成后钉死；黄金向量 fixture `git diff --numstat` = **+2385 / −0**（既有向量一个字节没动） |
| **C22** | T4a + T4b + T5 + T20 | ✅ | `identity.test.ts`「T4a」5 例、`test_camera_motion_keyframes.py::TestIdentityGeneralization` 7 例（含**两个导出入口**各一条）、`fingerprintKeyframes.test.ts` 9 例、`useTimelineComposition.cameraSignature.test.ts`「T16 / T20」7 例（四个消费者逐个） |
| **C23** | 唯一写入闸 | ✅ | 见下方 grep 证据 |
| **C24** | 坏曲线规范化 + 只降一级 | ✅ | `TestModelNormalization` 9 例、`TestLengthGate` 6 例 |
| **C25** | 桌面端 GUI 走查 | ⚠️ **未执行** | 本节点为无界面自动化环境（无 Electron / 无显示器），**据实声明未执行**，不标记为完成。见下方「C25 的实际状态」 |
| **C26** | 量化基线 | ✅ | §9.4.1，5 组真实数字 |
| **C27** | 既有预览断言零改动 | ✅ | `src/components/video` 1455 passed；唯一失败 `cachePlayback.integration.test.ts` 在 stash 后的**改前**工作区同样失败（预存债）。豁免实际用到 3 处，见 F7 |
| **C28** | 黄金向量两端对齐、不 skip | ✅ | `CAMERA_GOLDEN_REQUIRED=1` 下 153 passed；新增 26 条多关键帧向量（8 条曲线 × 3 时刻 + 非 16:9 + 自定义窗口） |
| **C29** | 五对函数两端对称 | ✅ | 见下方 grep 证据 |
| **C30** | 降级不吞 warning | ✅ | `TestLengthGate::test_the_degrade_does_not_swallow_earlier_warnings`（先造 `no 'zoompan'` 再触发降级，断言两条都在） |
| **C31** | 坏曲线不 422 | ✅ | `TestModelNormalization` 7 种坏输入全部参数化，含 `scale: 9` 这条字段级越界 |
| **C32** | 面板三条物理约束 | ✅ | `stageInteraction.test.ts`「④ THE MEASURED-RECT CASE」+ `KeyframeStrip.test.ts` 的 C32 ①②③ 三组源码级断言 |

### C29 两端对称核对（grep 证据）

| 函数 | TypeScript | Python |
|---|---|---|
| `expandStops` / `expand_stops` | `playback/camera/keyframes.ts:` `export function expandStops` | `camera_motion.py:` `def expand_stops` |
| `trajectorySamples` / `trajectory_samples` | `keyframes.ts:` `export function trajectorySamples` | `camera_motion.py:` `def trajectory_samples` |
| `tauAtProgress` / `tau_at_progress` | `easing.ts:` `export function tauAtProgress` | `camera_motion.py:` `def tau_at_progress` |
| `keyframeAtTrajectory` / `keyframe_at_trajectory` | `easing.ts:` `export function keyframeAtTrajectory` | `camera_motion.py:` `def keyframe_at_trajectory` |
| `isIdentityCameraMotion` / `is_identity_camera_motion` | `identity.ts:` 改为走 `expandStops` | `camera_motion.py:` 改为走 `expand_stops`（**评审 P0-1 的正主**） |

四个采样点也已成对改造：TS `rollPadForMotion` / `coverScaleForMotion`
↔ Py `roll_pad_for_motion` / `cover_scale_for_motion` / `_needs_zoom_segment` /
`_needs_roll_segment`，全部改为遍历各自的 `trajectorySamples` / `trajectory_samples`。
两端采样集一致性由黄金向量的 `rollPad`（< 1e-6）与
`test_camera_motion_keyframes.py::test_trajectory_samples_degenerate_to_the_old_grid`
双向钉住。

### C23 唯一写入闸（grep 证据）

`grep -rn "keyframes:" src --include=*.ts --include=*.tsx`（排除测试与类型声明）
命中 **5 处，全部合规**，逐条核对如下——这里刻意列全而不是只列三处，
因为「只有三处」这个说法本身经不起 grep：

| 位置 | 性质 | 是否过闸 |
|---|---|---|
| `keyframes.ts:271` | `normalizeCameraKeyframes` **自身的输出**（闸门本体） | 就是闸 |
| `keyframes.ts:293` | `withStops()` — 面板增/删/改时刻/改分量/改段缓动的共同出口 | ✅ `return normalizeCameraKeyframes(...)` |
| `cameraPresets.ts:156` | `reverseCameraMotion` 的曲线分支 | ✅ 同上，整体包在 `normalizeCameraKeyframes(...)` 里 |
| `wire.ts:189` | `sanitizeCameraMotion`（工程 JSON 载入） | ✅ 组装后立即 `return normalizeCameraKeyframes(parsed)` |
| `wire.ts:121` | `toCameraMotionWire` | **不是 store 写入**：这是出站的 snake_case wire 对象（`CameraKeyframeStopWire`），与 store 的 `CameraKeyframeStop` 是两个类型 |

后端对应的唯一入口是 `video_models.py::CameraMotion._normalize_keyframes`
（`mode="before"`）与读取侧的 `camera_motion.py::expand_stops`（§6.3 的「唯一读取闸」）。

`CameraMotionModal.tsx` 内**没有**任何 `keyframes: [` 字面量，
且以上不变量由 `KeyframeStrip.test.ts::「C23 — 写入闸是机械可验证的」`
以源码扫描的方式钉住——不是靠这份文档里的一次性 grep。

### C25 的实际状态（据实声明，不得标记为完成）

本轮**没有**执行桌面端 GUI 走查：执行环境是无界面的自动化容器，
既没有 Electron 运行时也没有显示器，`npm run dev` 起得来但没有人能去点。
按 R38 / C25 的明文要求，此处**声明为「未执行」**，不做任何粉饰。

已经能自动验证的部分（不能替代走查，但缩小了走查范围）：

- A31/A32/A35/A42/A45 的**判定逻辑**已由 T22 与 `decideInsertAt` 覆盖
  （窗口对齐、`[+]` 三种禁用、首尾不可拖不可删）；
- A34/A43 的**映射与键盘等价物**由 T14 与 `KeyframeStrip.test.ts` 覆盖；
- A46（滚轮不带动面板）与 A33/A36/A41 的**手感**类判据**只能靠人眼**，
  这正是 C25 存在的理由，也正是本轮仍然欠着的部分。

**建议下一节点在有界面的机器上按 §9.3 逐条走查，重点是 A33 / A34 / A36 /
A38 / A40 / A41 / A46 这 7 条自动化够不着的。**

---

## 评审结论（Review Verdict）

### **有条件通过（Approved with conditions）**

**总体判断.** 这是三轮里方法论最扎实的一份设计。它没有重做前两轮已经跑通的东西，
而是准确地指出了「能动但不能编」这个真实缺口；D32 的 τ 解耦是一步好棋——
它让表达能力翻倍的同时，`rollPadForMotion` / `coverScaleForMotion` /
`_needs_zoom_segment` 的**语义**一行不改，存量 3D 运镜的构图不漂移；
D37/D38 用「走老代码路径」而不是「新代码恰好退化成同样的串」来兑现零回归，
是被 v1 C8 / v2 C11 教训过的人才写得出的条款；而 §4.4.5 的 M1–M6 有**可独立运行的
探针脚本**背书（`probe_ffmpeg_piecewise.py`，评审已核对其真实存在且逻辑正确），
M5 那条「8 关键帧与 2 关键帧耗时无可测差异」的结论直接改变了性能预算该花在哪儿——
这类"先测再设计"的做法应当成为后续所有轮次的默认姿势。

**同时，评审发现的问题有一个清晰的共同模式，值得下游反复自查：
凡是「TS 与 Python 各有一份」的东西，v1 只推广了前端那一份。**
P0-1（`is_identity_camera_motion`）是最严重的一例——它是后端两个导出入口的第一道门，
漏改的后果是「预览有、成片没有，而且状态里一句话都没有」。
P0-2（pydantic 字段级校验先于 `mode="after"`）与 P0-3（降级时丢掉 warnings）
则都属于「照着 v1 伪码写下去必然出问题」的类型。
P1-1 更微妙一些：D33 证明了 τ **覆盖** [0,1]，却没有证明均匀网格**命中极值**——
在两点直线时这两件事碰巧等价，多关键帧下就不再等价，代价是 `rotate` 露黑角、
3D 四边形盖不住画面。这三类问题在 v2 正文里都已直接修订。

**面板侧的三条（P1-3/P1-4/P1-5）性质不同：它们不会让任何测试变红，
只会让用户觉得"这软件手感不对"。** 擦洗条是 clip 坐标而关键帧是窗口坐标、
画布后备存储 480×270 而 CSS 宽度随视口变、React 的 wheel 是 passive
所以缩放会连带滚动面板——每一条都直接违背"符合人机交互最佳实践"这个验收目标，
且都只能靠人眼发现。这也是为什么 C25（桌面走查据实留痕）这轮**不能再欠**：
它已经连欠两轮，而本轮是三轮里交互面最大的一轮。

**P0 / P1 状态.** 3 个 P0 与 10 个 P1 **全部已在本 v2 的正文中直接修订**，
并落成可执行的约束：新增决策 D42–D46、风险 R39–R41、用例 T18–T22、
验收 A45–A46、放行条件 C29–C32，并修订了 D32/D33、§4.2.5、§4.2.7（新增）、
§4.4.4、§4.5.1、§4.5.2、§4.6、§5.1（补 10a）、§5.2、§5.3、§5.4（补 37–39）、
§6.3、§7.3、§7.4、§8、§9.1、§9.3、§10、§12、§13。
**无遗留未解决的 P0 / P1。**

### 放行所附条件（下游实施节点必须逐条兑现）

1. **C20–C32 全部满足**（v2 新增 C29–C32：两端对称核对、降级不吞 warning、
   坏曲线不 422、面板三条物理约束）。
2. **P0 的三条各配一个会失败的用例**——即先写出在 v1 设计下**必然红**的测试
   （T4b 的两个入口断言、T11 的 `scale: 9`、T10 的 warnings 保留断言），
   再写实现。只写"能过的测试"等于没验证。
3. **C25 桌面端走查这一轮必须真的执行并留痕**；确实执行不了就在文档里写"未执行"，
   **不得标记为完成**（已连欠 v1 C9 / v2 C16 两轮，而本轮交互改动最大）。
4. **§9.4 的量化基线要落到真实数字**并写回文档；若与 M5 的结论相悖，
   停下来查是不是把某个常量算进了每帧路径。
5. **实施中若发现本方案的新缺陷**，写回文档的「实施过程发现的方案缺陷」段，
   而不是就地改代码绕过去——前两轮正是靠这条把设计与实现的漂移控制住的。
6. **P2 的 9 条**中，P2-1 / P2-2 / P2-6 / P2-7 / P2-8 已在 v2 顺手改入正文；
   剩余 P2-3 / P2-4 / P2-5 / P2-9 作为实施注意事项，
   其中 P2-5（`_dry_run_cache` 无上限）已记入 §13 第 7 条作为后续项。

> **评审人签署**：以上条件全部兑现即视为达成本轮 Definition of Done。
> 若实施中发现某条条件与代码现实冲突，**先回来改本文档**，
> 再动代码——这是前两轮唯一被证明有效的纪律。
