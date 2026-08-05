# 2D / 3D 运镜（Camera Motion）开发方案 v2

> Feature slug: `camera-motion-2d-3d`
> 状态：**v2（已评审）** — 评审记录见 §0，评审结论见文末 §13
> 作者：Solution Architect（Anthropic Engineering）
> 评审：Senior Reviewer（Anthropic Engineering），2026-08-05
> 适用分支：`feat/remove-user-system`（当前工作分支）

---

## 0. 评审记录（Review Notes）

评审维度：可行性（Feasibility）/ 完备性（Completeness）/ 一致性（Consistency）/
规模合理性（Right-sizing）。所有结论均**对照本仓真实代码与本机 FFmpeg 实测**得出，
证据逐条附在条目内。**P0 / P1 全部已在 v2 正文中修复**，P2 为不阻塞的改进建议
（下游开发节点可自行取舍，但正文已把可低成本吸收的部分一并写入）。

### 0.1 P0（阻断级：不修则功能必然出错）

| # | 维度 | 问题 | 证据 | v2 修复位置 |
|---|---|---|---|---|
| **P0-1** | 可行性 | **`rotate` 滤镜没有 `on` 变量**，v1 §4.4.3 对 zoompan / perspective / rotate 统一用 `T=(on/F)`，会让所有带 `roll` 的 2D 运镜导出**必然失败** | 本机实测 `ffmpeg -vf "rotate=a='(on/10)*PI/180'"` → `Undefined constant or missing '(' in 'on/10)*PI/180'` → `Failed to configure output pad`；换成 `n` 或 `t` 则 exit 0。且 `ffmpeg -h filter=rotate` 显示只有 `angle/a` 带运行时（`T`）标志 | §4.4.3 新增「帧计数变量对照表」：zoompan=`on`、perspective=`on`、rotate=`n`（`t` 亦可）；§4.4.4 增加「表达式预检」守卫 |
| **P0-2** | 正确性 | **2D `roll` 在预览与导出两端都会露黑角**。`rollCover` 只缩小了*源裁切*，而*目标矩形*仍是 `W×H`；把 `W×H` 绕中心旋转，四角必然留空 | 本机实测：纯白帧过 `rotate=a=10*PI/180:c=black:ow=iw:oh=ih` 后，左上 8×8 区域 `YAVG` 从 **235 → 16**（黑）。预览端同理：`drawImage(..., fit.x, fit.y, fit.width, fit.height)` 的目标矩形就是 fit-rect | §4.2.3 改为**运镜级常量 `RP`**（与 D5 的 coverScale 同构）；§4.3.2 目标矩形放大到 `RP·W × RP·H` 再旋转并 clip；§4.4.3 导出改为 `zoompan → rotate → crop(1/RP) → scale`；新增 D13 |
| **P0-3** | 完备性 | **`warnings` 挂在了错误的消息上**。导出是**异步**的：`start_video_composition` 立刻返回 `status='processing'`，运镜降级发生在之后的后台线程里，所以 v1 §6.1 / §5.6 放在 `VideoCompositionResponse` 上的 warnings **永远为空**，G7「降级必须被看见」落空 | `video_composition_service.py:754` 起 `start_video_composition` 注释即 "return immediately"；`_normalize_video` 在 `ThreadPoolExecutor(max_workers=5)`（:1206）内执行；前端 `videoComposition.ts` 走 `getCompositionStatus` 轮询；`video_router.py:195` 的 `safe_info` 是**显式字段白名单** | §4.4.4 / §5.6 / §6.1 / §6.3 全面改走 **status 通道**（服务态 → 路由白名单 → 前端轮询回调），并明确线程安全汇总方式；新增 D14 |
| **P0-4** | 一致性 | **D12 的修法不完整**：`compositorPassthroughFields()` 开头有 early-return 短路，只在 `return` 数组里追加运镜指纹，对「只配了运镜、其它字段都是 undefined」的 clip 仍返回 `''` → 签名不变 → 正是 D12/R8 要防的「点了应用但预览不动」 | `useTimelineComposition.ts:46-49`：`if (v.audioDetached === undefined && v.opacity === undefined && v.trackZ === undefined && !v.transitionIn && !v.transitionOut) return '';` | §4.3.4 明确要求**同时改守卫条件**；§9.1 回归闸单测改为「构造一个只有 `cameraMotion` 的序列」 |

### 0.2 P1（重要：影响正确性、可维护性或验收标准）

| # | 维度 | 问题 | v2 修复位置 |
|---|---|---|---|
| **P1-1** | 完备性 | **`resolveCameraDraw` 签名缺画面宽高比**。`rollCover`、`project3DCorners`、`coverScale` 全都依赖 `A=W/H`，但 v1 §6.2 的签名只有 `(motion, tLocal, clipDuration)`，实现时必然要临时加参数或读全局——两端取值不统一就是 WYSIWYG 漏洞 | §6.2 签名加 `frameAspect`；§4.2 明确两端 `A` 的取值来源与 <0.1% 偶数取整误差如何计入 1px 预算 |
| **P1-2** | 正确性 | **恒等快路径会吃掉合法的静态构图**。v1 §7.2 判「`intensity===0` → 视为无运镜」，但 `pull-out` 的 `start.scale=1.25`，intensity=0 应停在 1.25× 静态取景；判为无运镜会让预览/导出都渲染未缩放画面，与面板示意舞台直接矛盾 | §7.2 改为：恒等 ⟺ `start` 等于默认关键帧 **且**（`intensity===0` **或** `end` 等于默认关键帧） |
| **P1-3** | 一致性 | **`build_video_filter` 的非 padding 分支没被覆盖**。源与目标同比时该函数返回 `scale=…,setsar=1:1`（无 `pad`），v1 §4.4.2 只描述了 `scale → camera → pad` 一种形态 | §4.4.2 改为「紧跟 `scale`、位于 `pad`/`setsar` 之前」，两分支都注入；§9.1 零回归单测扩到两分支 |
| **P1-4** | 可行性 | **运镜降级重跑与既有 `_normalize_video_with_retry` 打架**。该包装器已有 `max_retries=3` + 指数退避（2/4/8s）；运镜表达式错误是**确定性失败**，会先白烧 4 次 ≈14s/clip 才轮到 §4.4.4 的无运镜重跑 | §4.4.4 把降级下沉到 `_normalize_video` **内部**（同进程立即无运镜重跑），外层 retry 只管瞬时故障 |
| **P1-5** | 完备性 | **分割 clip 会让运镜「重播一遍」**。`SplitService` 用 `{...original}` 展开继承（已核实），两半各跑一遍完整运镜，切点处画面跳回起点；v1 A9 把它当成期望行为，实际破坏 WYSIWYG 直觉 | §4.6 允许 `startOffset` 取负值 + 分割时窗口平移；§5.4 文件表补 `SplitService.ts` 与 `rebaseCameraMotionForSplit`；A9 验收改为「切点两侧连续无跳变」 |
| **P1-6** | 正确性 | **3D 模式下 `S` 不能再乘 `rollCover`**（roll 已折进 `Rz`，再乘一次等于重复计入，画面被多裁一层） | §4.2.3 明确 `rollCover` **仅 2D 生效**，3D 下 `S = clamp(k.scale, 1, 8)` |

### 0.3 P2（建议：不阻塞，正文已吸收低成本项）

| # | 维度 | 建议 | 处置 |
|---|---|---|---|
| P2-1 | 效率 | `coverScale` / `RP` 是 101 采样 × 4 条射线求交，不应每帧重算 | 已吸收：§4.2.5 要求按 `(fingerprint, aspect)` memoize |
| P2-2 | 严谨性 | §4.2.6 的 3D 锚点 `px` 有约 0.15px 手算偏差（复算 TL≈118.47 / TR≈1992.72，原文 118.59 / 1992.57；`py`、`q`、`coverScale=1.1409` 均吻合） | 已吸收：锚点标注为"由参考实现回填"，禁止把手算值钉死进单测 |
| P2-3 | 边界 | `wd = clamp(duration, MIN_WINDOW, clipDuration − w0)` 在 `w0 → clipDuration` 时 min>max，clamp 无定义 | 已吸收：§4.2.1 先夹 `w0` |
| P2-4 | 一致性 | `Modal` 的必填 prop 是 `labelledBy`（元素 id），v1 §4.5.2 未提 | 已吸收：§4.5.2 补 a11y 契约 |
| P2-5 | 交互 | §4.5.2 布局图里的 `[ 反向 ]` 按钮在数据模型与预设表中**没有任何定义** | 已吸收：§4.5.2 定义为「交换 `start`/`end` 并置 `presetId='custom'`」 |
| P2-6 | 规模 | `poly_degree_fallback: 5` 让 3D 拟合有三层兜底（3 次 → 5 次 → 降级），收益递减 | 保留但降级为可选：§7.3 标注「v1 可置空以关闭二次拟合」，不强制实现 |
| P2-7 | 完备性 | 「图片素材禁用运镜」的判据要落到具体字段，否则各处实现会漂移 | 已吸收：§4.5.1 给出单一判据函数 `canApplyCameraMotion(item)` |
| P2-8 | 严谨性 | 黄金向量 Python 侧 `pytest.skip` 会让跨语言闸门在 CI 上形同虚设 | 已吸收：§9.3 增加 `CAMERA_GOLDEN_REQUIRED=1` 强制开关 |
| P2-9 | 效率 | `perspective` 用 `eval=frame` 每帧重解 8 个系数，叠加 `zoompan` 的 2× 超采样，导出耗时需要实测基线 | 已吸收：§8 P6 增加一条 4K 导出耗时基准 |

### 0.4 未变更的评审结论（确认为正确的关键设计）

以下 v1 结论经复核**成立**，v2 原样保留，下游不要"顺手优化"掉：

- **D4 注入点**（`scale` 之后 `pad` 之前）是本方案最关键的一致性决策，复核正确：预览的
  fit-rect 与导出的 `scale_width×scale_height` 是同一个"内容矩形"，运镜作用其上才不会
  被黑边污染。
- **D5 覆盖缩放取运镜级常量**：逐帧射线求交无法写进 FFmpeg 表达式，取常量是唯一可两端
  对齐的形式。P0-2 的修复正是把同一思路复制到 roll 上。
- **§4.2.4 的单应数学**：复核 `rotateY=15°` 的 `q`（0.90743 / 1.11359）与
  `coverScale=1.1409` **与手工复算逐位吻合**，恒等自检也成立。
- **`perspective` 的可行性**：本机 `ffmpeg -h filter=perspective` 确认 `sense=destination`
  与 `eval=frame` 均存在；实测四角坐标**取到画面外**（`-50` / `W+50`）也能正常运行，
  §4.2.5 的 coverScale 外扩不会踩滤镜边界。
- **`SplitService` 自动继承**：已核实其走 `{...item.toPlainObject()}`，运镜字段无需额外接线
  （P1-5 修的是语义，不是接线）。
- **测试基建**：`vitest` 已就位（`npm run test` / `__tests__/*.test.ts` 命名一致），
  后端 `tests/` + `conftest.py` 就位，§5.7 的 12 个测试文件均可落地。

---

## 1. 概述（Overview）

Ecliptrix 的视频编辑器目前已经具备一条完整的「本地多轨合成」链路：预览端由
`CanvasCompositor.renderFrame(layers)` 逐帧把多条视频轨、字幕层、图片叠加层按
z 序合成到一张 `<canvas>` 上；导出端由后端 `video_composition_service` 先把每个
clip 规范化（trim → scale → pad → 定帧率），再交给
`composition/filtergraph_builder.build_filtergraph()` 复现预览的 z 序 / 透明度 /
转场语义，最终 mux 音频与字幕。也就是说，**"预览所见即导出所得"（WYSIWYG）已经
是这条链路的既有不变量**，本方案必须继承而不是破坏它。

本方案在这条链路上新增一类 clip 级视觉特效：**运镜（Camera Motion）**。运镜分两
类：**2D 运镜**（推近 / 拉远 / 上下左右平移 / 轻微旋转，即业界常说的 Ken Burns
效果）与 **3D 运镜**（带透视的推轨、左右环绕、俯仰、视差推进）。二者共享同一份
「关键帧 + 缓动 + 时间窗」的数据模型与同一份数学契约：一个纯函数把
`(运镜配置, clip 内相对时间)` 解析成「源画面裁切矩形 + 四角投影位置」，预览端用
Canvas2D（2D）与 WebGL（3D）实现，导出端用 FFmpeg `zoompan` / `perspective` /
`rotate` 实现。两端的数值一致性由一份**共享黄金向量（golden vectors）**在 TS 与
Python 两套单测中同时断言，从而把 WYSIWYG 从「口头约定」变成「可回归的测试」。

交互侧遵循 Anthropic 一贯的克制美学与人机交互最佳实践：时间轴工具栏新增一个
**「运镜」按钮**（选中视频 clip 后可用，快捷键 `M`），点击打开
**`CameraMotionModal` 弹窗面板**；面板左侧是 2D / 3D 分栏的预设卡片网格，右侧
是实时循环播放的运镜示意舞台 + 强度 / 缓动 / 时间窗 / 高级参数控件；应用后
时间轴 clip 上出现一枚运镜徽标（可双击 clip 再次打开面板编辑）。所有操作走既有的
undo/redo 快照机制，随项目 JSON 持久化，随导出请求下发后端。整个特性是**纯增量**
的：未配置运镜的 clip 在预览与导出上走与今天完全相同的代码路径（零回归面）。

---

## 2. 目标与非目标

### 2.1 目标（Must）

| # | 目标 |
|---|---|
| G1 | 视频 clip 可配置 2D 运镜（缩放 / 平移 / 旋转）与 3D 运镜（俯仰 / 环绕 / 推轨 / 视差） |
| G2 | 时间轴工具栏有明确入口按钮；点击打开设计精良的弹窗面板；面板内可选预设、调参、预览、应用 |
| G3 | 应用后**编辑器预览**逐帧正确呈现运镜（含播放、拖动播放头、暂停重绘） |
| G4 | **导出**产物逐帧复现与预览一致的运镜（误差 ≤ 1 像素量级），且导出不因运镜而失败 |
| G5 | 运镜配置随项目保存 / 加载 / JSON 导入导出、参与 undo/redo、随 clip 分割复制 |
| G6 | 中英双语文案；键盘可达；`prefers-reduced-motion` 友好；暗色模式一致 |
| G7 | 任何一环失效（WebGL 不可用、FFmpeg 滤镜缺失、camera pass 失败）都**降级而非崩溃**，并把降级如实告知用户 |

### 2.2 非目标（Out of scope，v1 明确不做）

| # | 非目标 | 说明 / 后续路径 |
|---|---|---|
| N1 | 图片素材（image overlay）的运镜 | 图片走的是 `ImageOverlayLayer` / 后端 `_process_image_overlays` 另一条链路，v1 不改。数据模型与数学模块与素材类型无关，二期在 §12 给出接入点 |
| N2 | 任意多关键帧曲线编辑器 | v1 是「起点关键帧 → 终点关键帧 + 缓动」的两点模型，覆盖 95% 剪辑场景；多关键帧是纯增量扩展（`keyframes: CameraKeyframe[]`） |
| N3 | 音频 / 字幕 / 转场的运镜联动 | 无关 |
| N4 | 运镜的 GPU 加速导出 | 导出仍走 CPU FFmpeg 滤镜；编码器仍复用既有 `detect_gpu_encoder` |
| N5 | 「运镜跟随主体」等 AI 能力 | 与本方案正交 |

---

## 3. 关键设计决策（Decisions）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 运镜数据挂在 **timeline item** 上（`TimelineItem.cameraMotion`），与 `transitionIn/Out`、`audioDetached` 同级 | 复用既有「item 字段 → CompositionAdapter → 预览序列 / 导出 wire」的成熟通道，无需新表、新接口、新状态源 |
| D2 | 2D 运镜实现为**源矩形裁切**（`drawImage` 的 `sx,sy,sw,sh`），而非 canvas 缩放变换 | 裁切天然不会露出信箱黑边、不会溢出到其它轨道，且与 FFmpeg `zoompan` 语义一一对应，是最容易保证两端一致的形式 |
| D3 | 3D 运镜实现为**平面四角投影（单应变换 / homography）** | FFmpeg `perspective` 滤镜本质就是单应变换；预览端用 WebGL 画一个带投影权重的纹理四边形即可精确对齐，无需自研 3D 管线 |
| D4 | 导出的运镜滤镜链**注入到既有 `_normalize_video` 的 `-vf` 中，位于 `scale` 与 `pad` 之间** | ① 不新增一次转码 pass；② 运镜作用于「视频内容矩形」而非已烤入黑边的画布，与预览完全一致（**这是本方案最关键的一致性决策**）；③ `filtergraph_builder` 的 `pre_trimmed=True` 契约完全不变 |
| D5 | 覆盖缩放系数（cover scale）取**整段运镜的最大值，作为运镜级常量**，而非逐帧计算 | 逐帧覆盖计算含射线-凸多边形求交，在 FFmpeg 表达式里无法写出；取常量后两端都只需算一次，彻底消除该项的一致性风险，代价只是构图上多一点点裁切 |
| D6 | 3D 导出的四角轨迹用 **numpy 三次多项式拟合**（对缓动后进度 `e` 拟合），并以「最大误差 ≤ 0.75px」为硬闸门 | 精确的三角函数表达式冗长且极易写错；多项式拟合短、可验证、可回退（3 次 → 5 次 → 关闭 3D 并告警） |
| D7 | 2D 的 `zoompan` 前后加 **2× 超采样**（升采样 → zoompan → 降采样） | `zoompan` 的 `x/y` 是整数像素，慢速平移会肉眼可见地"跳格"；在 2× 空间取整后再降采样即得 0.5px 精度。3D 的 `perspective` / `rotate` 是浮点重采样，不需要超采样（避免 4× 像素开销） |
| D8 | 预览 3D 优先 WebGL，不可用时降级为「单应矩阵在画面中心的仿射近似」（保留推拉与位移，丢弃梯形透视），并在面板与预览角标提示降级 | 保证在任何设备上都有可用预览，同时诚实告知与导出的差异 |
| D9 | v1 只支持视频 clip；图片 clip 的运镜按钮禁用并给出解释性 tooltip | 见 N1；宁可少做一半也不做一半错的 |
| D10 | 后端运镜可通过 `config/camera-motion.yaml` 全局关闭（`enabled: false`），关闭时导出无运镜且回传 warning | 运维兜底：万一某台机器的 FFmpeg 有问题，可以一键退回旧行为而不必回滚版本 |
| D11 | 导出响应新增 `warnings: List[str]`，前端以「警告」气泡展示 | 降级必须被看见，否则 WYSIWYG 破坏会静默发生 |
| D12 | 运镜写入必须进入 `useTimelineComposition` 的组合签名（`compositorPassthroughFields`），**且必须同时放宽该函数开头的 early-return 守卫** | 该 hook 用字符串签名做变更检测；不纳入签名会导致「面板点了应用但预览不动」——这是本仓历史上反复出现过的坑（见 `docs/diagnoses/` 中 timeline 预览快照类问题）。现码 `useTimelineComposition.ts:46-49` 在五个字段全 undefined 时直接 `return ''`，只追加指纹**不改守卫**等于没修（评审 P0-4） |
| **D13** | **roll 的覆盖系数取运镜级常量 `RP = max_e rollCover(roll(e))`，并把它作用在「目标矩形」上而非「源裁切」上** | 旋转发生在输出画布上，只缩小源裁切并不能填满被旋转的输出四角——本机实测在纯白帧上左上角亮度 235→16（评审 P0-2）。取常量后与 D5 的 coverScale 完全同构：两端各算一次、无逐帧漂移；`roll ≡ 0` 时 `RP = 1`，整条链逐字节退回今天的行为 |
| **D14** | **降级 warnings 走 `/compose/{id}/status` 通道，不走 compose 的即时响应** | 导出是异步的：`start_video_composition` 立刻返回 `processing`，运镜降级发生在其后的 `ThreadPoolExecutor` 线程里。挂在即时响应上的 warnings 永远为空，G7 会静默失效（评审 P0-3） |

---

## 4. 技术设计（Technical Design）

### 4.1 端到端数据流

```
                       ┌──────────────────────────┐
   用户 ─ 点「运镜」按钮 → │  CameraMotionModal (UI)  │
                       └───────────┬──────────────┘
                                   │ setCameraMotionAction(itemIds, motion)
                                   ▼
                    ┌──────────────────────────────────┐
                    │ timelineStore / TimelineAggregate │  item.cameraMotion
                    │  + history 快照 + 项目持久化       │
                    └───────┬──────────────────┬────────┘
                            │                  │
        CompositionAdapter  │                  │  useVideoExport
        .extractVideoSequences                 │  (item → wire)
                            ▼                  ▼
              VideoSequenceItem.cameraMotion   video_items[].camera_motion
                            │                  │
                            ▼                  ▼
   assembleLayers ─ resolveCameraDraw(t-clip.startTime)      FastAPI /api/video/compose
                            │                  │
                            ▼                  ▼
   CanvasCompositor._drawVideoLayer   _normalize_video 的 -vf:
     2D: drawImage(sx,sy,sw,sh)         scale → [camera chain] → pad
     3D: Camera3DRenderer(WebGL)        camera chain = fps,setpts,
                            │             [scale↑,zoompan,scale↓],
                            ▼             [perspective],[rotate]
                     预览画面                    │
                                                ▼
                                   filtergraph_builder（不变）→ 成片
```

### 4.2 数学契约（Single Source of Truth）

以下公式是 **TS 与 Python 必须逐字实现的同一份契约**。所有符号：`W/H` 为「画面
内容矩形」的宽高（预览端 = `fitContain` 得到的 fit-rect，等价于源视频固有宽高，
因为 contain 保持宽高比；导出端 = 规范化中 `scale` 之后、`pad` 之前的
`scale_width × scale_height`）。

> **宽高比是本契约的显式输入（评审 P1-1）。** `rollCover`、`project3DCorners`、
> `coverScale` 三者都依赖 `A = W/H`，因此**所有对外函数都必须显式接收 `frameAspect`
> （或 `W,H`），不得从全局/DOM 推断**——两端各自"就近取值"正是 WYSIWYG 漏洞的经典
> 来源。两端的 `A` 取值：
> - 预览端 `A = source.videoWidth / source.videoHeight`（即 fit-rect 的宽高比）；
> - 导出端 `A = scale_width / scale_height`（`video_scaling.ensure_even_dimensions`
>   会把两者向上取偶）。
>
> 偶数取整带来的相对误差上界为 `1/scale_height ≤ 1/1080 < 0.1%`，在 1920 宽画面上
> 折合 < 0.9px 的四角位移**下界**估计——它与 §9.2 A5 的「≤ 1px 量级」共用同一预算，
> 因此 §9.1 的黄金向量断言一律以**归一化坐标**（0..1）比较，容差 `1e-6`；只有
> §9.2 的人工验收才落到像素。

#### 4.2.1 进度与缓动

```
tLocal = t_composition − clip.startTime            // clip 内相对时间，单位秒
// 先夹 w0，保证 [w0, clipDuration] 至少留出一个 MIN_WINDOW（评审 P2-3：
// 否则 w0 → clipDuration 时下面 clamp 的 min > max，行为未定义）
w0     = clamp(motion.startOffset ?? 0,
               −clipDuration,                       // 允许为负：分割后的右半段（§4.6）
               max(0, clipDuration − MIN_WINDOW))
wdMax  = max(MIN_WINDOW, clipDuration − w0)        // 两步求解，避免 clamp 的 min > max
wd     = motion.duration != null
           ? clamp(motion.duration, MIN_WINDOW, wdMax)
           : wdMax
u      = wd <= MIN_WINDOW ? 1 : clamp((tLocal − w0) / wd, 0, 1)
e      = ease(u)
```

`MIN_WINDOW = 0.05`（秒）。窗口外自动"保持"：`tLocal < w0` 时 `u=0`（停在起点），
`tLocal > w0+wd` 时 `u=1`（停在终点）。**`w0` 允许为负**，语义是「运镜窗口在本 clip
开始之前就已经启动」——这是 §4.6 分割 clip 后保持画面连续所必需的（评审 P1-5）。

缓动函数（`ease`）：

| easing | 公式 |
|---|---|
| `linear` | `e = u` |
| `easeIn` | `e = u³` |
| `easeOut` | `e = 1 − (1−u)³` |
| `easeInOut` | `u < 0.5 ? 4u³ : 1 − (−2u+2)³/2` |

#### 4.2.2 关键帧插值

对 `scale, x, y, roll, rotateX, rotateY, dolly` 逐分量：

```
raw_c = start_c + (end_c − start_c) · intensity · e
k_c   = clamp(raw_c, RANGE_c.min, RANGE_c.max)          // 先插值后钳位
```

`RANGE`：`scale ∈ [1, 4]`，`x,y ∈ [0, 1]`，`roll ∈ [−45, 45]`，
`rotateX, rotateY ∈ [−45, 45]`，`dolly ∈ [−0.6, 0.6]`。
`intensity ∈ [0, 2]`（默认 1；0 表示静止在起点）。

#### 4.2.3 2D：裁切矩形与 roll 覆盖（**v2 重写，评审 P0-2 / P1-6**）

```
rollCover(roll, W, H):
    a = |cos(roll·π/180)| ; b = |sin(roll·π/180)|
    return max( (W·a + H·b) / W , (W·b + H·a) / H )
```

**`RP`（roll pad）是运镜级常量**，与 D5 的 `coverScale` 同构：

```
RP = (mode == '2d')
       ? max over e ∈ {0, 1/100, …, 1} of rollCover(k(e).roll, W, H)
       : 1                                  // 3D 的 roll 已折进 Rz，由 coverScale 兜底
RP = clamp(RP, 1, 4)
```

逐帧量：

```
S  = clamp( k.scale · RP, 1, 8 )
sw = RP · W / S            // == W / k.scale（当 S 未被钳位时）
sh = RP · H / S
sx = clamp( k.x·W − sw/2, 0, W − sw )
sy = clamp( k.y·H − sh/2, 0, H − sh )
```

**为什么 `RP` 必须是常量、且必须作用在目标矩形上。** 旋转发生在*输出*画布上：把
`W×H` 的目标矩形绕中心转 `roll` 度，四角必然留空——只缩小源裁切填不满它。本机实测
纯白帧过 `rotate=a=10°:c=black:ow=iw:oh=ih` 后，左上 8×8 区域 `YAVG` 从 235 掉到 16。
因此渲染契约是：

> **把源上的 `sw×sh` 画进一个 `RP·W × RP·H` 的目标矩形（与内容矩形同心），
> 再绕该中心旋转 `roll`，最后按内容矩形 clip。**

覆盖成立的充要条件是 `RP ≥ rollCover(roll)`，由 `RP` 取 max 保证。取常量而非逐帧值
有两个理由：① 逐帧值会让目标矩形尺寸每帧变化，而 FFmpeg `rotate` 的 `ow/oh`
**只在初始化时求值一次**（`ffmpeg -h filter=rotate` 中 `ow/oh` 不带运行时标志），
逐帧尺寸在导出端根本无法表达；② 常量让两端各算一次，彻底消除该项的漂移风险。

`roll ≡ 0` 时 `RP = 1`，上式退化为 `S = k.scale`、`sw = W/S`、目标矩形 = 内容矩形，
**与 v1 及今天的行为逐字节一致**（零回归）。

`ResolvedCameraDraw` 因此需要同时回传 `rollPad`（见 §4.3.1）。

#### 4.2.4 3D：四角投影（单应）

常量：`CAMERA_FOV_DEG = 25`，`D = 0.5 / tan(FOV/2) ≈ 2.2553378`，
`Z_MIN = 0.05·D`。

```
A  = W / H
模型四角（顺序固定为 TL, TR, BL, BR，与 FFmpeg perspective 的 x0..x3 一致）：
  m0 = (−A/2, −1/2, 0)   m1 = (+A/2, −1/2, 0)
  m2 = (−A/2, +1/2, 0)   m3 = (+A/2, +1/2, 0)

R  = Rz(roll) · Ry(rotateY) · Rx(rotateX)         // 右乘列向量：v' = R·m
zc = D · (1 − dolly)                              // dolly>0 → 相机靠近 → 画面变大

对每个角 i：
  v'  = R · m_i
  wq  = zc + v'.z                 // wq < Z_MIN → 判定退化，本 clip 降级为纯 2D
  px_i = W/2 + H·D·v'.x / wq
  py_i = H/2 + H·D·v'.y / wq
  q_i  = D / wq                   // 透视权重，供 WebGL 做透视正确插值
```
自检：`roll=rotateX=rotateY=dolly=0` 时 `v'=m`、`wq=D`，得
`px = W/2 ± H·A/2 = W/2 ± W/2`、`py = H/2 ± H/2`、`q = 1`——即恒等映射。

#### 4.2.5 覆盖缩放（运镜级常量，D5）

```
coverScaleForQuad(corners, W, H):
    c = (W/2, H/2) ; need = 1
    for r in {(0,0), (W,0), (0,H), (W,H)}:            // 输出矩形四角
        p = 射线 c→r 与凸四边形 [TL,TR,BR,BL] 边界的交点
        if 求交失败: return DEGENERATE
        need = max(need, |r − c| / |p − c|)
    return need

coverScale(motion) = max over e ∈ {0, 1/100, …, 1} of
                     coverScaleForQuad(project3D(k(e)), W, H)
最终角 i = c + coverScale · (corner_i − c)
```
`DEGENERATE` → 本 clip 3D 降级为 2D（预览与导出都降级，且导出回传 warning）。

**记忆化（评审 P2-1）**：`coverScale` 与 `RP` 都是 101 采样 × 4 条射线-凸四边形求交，
**每个运镜只算一次**。实现上以 `(cameraMotionFingerprint(motion), frameAspect)` 为键做
LRU 记忆化（预览端 `Map` 上限 64 条即可覆盖任何真实项目；导出端每 clip 天然只算一次）。
逐帧路径上**不得**出现求交循环——`resolveCameraDraw` 的热路径只应做插值 + 常数乘法。

#### 4.2.6 参考锚点（供实现自检，非全部用例）

`W=1920, H=1080`：

| 用例 | 期望 |
|---|---|
| `scale=1, x=y=0.5, roll=0` | `RP = 1`, `crop = (0, 0, 1920, 1080)`, `dest = 1920×1080` |
| `scale=2, x=y=0.5, roll=0` | `RP = 1`, `crop = (480, 270, 960, 540)`, `dest = 1920×1080` |
| `scale=2, x=0.9, y=0.5, roll=0` | `sx = 960`（被 `W−sw=960` 钳住）, `sy = 270` |
| `scale=1, roll ≡ 10°`（**v2 重算**） | `RP = S ≈ 1.293508`；`sw = RP·W/S = 1920`, `sh = 1080` → `crop = (0, 0, 1920, 1080)`；`dest ≈ 2483.53 × 1396.99`（绕内容矩形中心旋转 10° 后**恰好**覆盖 1920×1080，四角无空洞） |
| `roll: 0 → 10°`（窗口内） | `RP = rollCover(10°) ≈ 1.293508`（取 max，全程恒定）；`e=0` 时 `S = 1.293508`、画面已被放大 1.29×——这是 roll 运镜"起手即有裁切"的固有代价，面板须在 `RP > 1.2` 时给出画质提示（§4.5.2） |
| 3D 全零参数 | `corners = (0,0),(1920,0),(0,1080),(1920,1080)`, `q = 1,1,1,1`, `coverScale = 1`, `RP = 1` |
| 3D `rotateY=15°`（**v2 复算**） | `TL ≈ (118.47, 49.98) q≈0.90743`；`TR ≈ (1992.72, −61.34) q≈1.11359`；`BL ≈ (118.47, 1030.02)`；`BR ≈ (1992.72, 1141.34)`；`coverScale ≈ 1.14090` |

> **锚点使用规则（评审 P2-2）。** 前 6 行是可手工验算的**硬锚点**，必须出现在 TS 单测中
> （容差：归一化坐标 `1e-6`）。第 7 行（3D `rotateY=15°`）的 `px` 分量在 v1 中有约
> 0.15px 的手算偏差（原文 `TL.x=118.59 / TR.x=1992.57`，复算为 `118.47 / 1992.72`；
> `py`、`q`、`coverScale` 三项与原文逐位吻合）。**实现时以参考实现输出为准回填本表，
> 不要把手算值钉死进单测**；3D 锚点在单测中的容差取 0.5px（等价归一化 `2.6e-4`）。
> 完整黄金向量（见 §9.3）由 TS 实现生成并入库，Python 侧断言其一致——目的是锁住
> "两端不漂移"，而非锁住某个人的手算精度。

### 4.3 预览链路（Preview）

#### 4.3.1 层装配：`internal/assembleLayers.ts`

`buildVideoLayers(entries, t)` 在现有「opacity × 转场 alpha」之外，新增一步：

```ts
const src = entry.source as { videoWidth?: number; videoHeight?: number };
const aspect = (src.videoWidth && src.videoHeight)
  ? src.videoWidth / src.videoHeight
  : undefined;                       // 尺寸未知（readyState<1）→ 本帧跳过运镜
const camera = aspect
  ? resolveCameraDraw(entry.clip.cameraMotion, t - entry.clip.startTime,
                      entry.clip.duration, aspect)
  : undefined;
layers.push({ kind:'video', id, source, opacity, z, camera });   // camera 可为 undefined
```

> **`frameAspect` 是必填参数（评审 P1-1）**：`RP` / `project3DCorners` / `coverScale`
> 都依赖它。`assembleLayers` 目前只读 `DrawableVideoSource.readyState`，因此
> `ActiveVideoEntry.source` 的类型需要扩出可选的 `videoWidth/videoHeight`（仍是纯读、
> jsdom 可 stub）。尺寸尚未就绪时**退回无运镜绘制**而不是猜一个宽高比——猜错就是
> 一帧构图跳变。

`resolveCameraDraw` 定义在 `playback/camera/`，返回**与画面尺寸无关**的归一化结果：

```ts
export interface ResolvedCameraDraw {
  mode: '2d' | '3d';
  /** 归一化裁切矩形（相对源画面，0..1），2D/3D 都有。 */
  crop: { x: number; y: number; w: number; h: number };
  /** 2D 的画面内旋转角（度）；3D 模式恒为 0（roll 已折进单应）。 */
  roll: number;
  /**
   * 目标矩形相对内容矩形的放大倍数（D13 的 `RP`，运镜级常量，≥ 1）。
   * 2D 且 roll≠0 时 > 1：绘制时目标矩形取 `RP·fit.width × RP·fit.height`
   * 并与 fit-rect 同心，旋转后才不会露黑角。roll≡0 与 3D 模式恒为 1。
   */
  rollPad: number;
  /** 3D 模式的四角（归一化到 0..1 的画面坐标，TL,TR,BL,BR）+ 透视权重。 */
  quad?: { pts: Array<{ x: number; y: number; q: number }> };
  /** 3D 退化 → 本帧按 2D 绘制。 */
  degraded?: boolean;
}
```
纯函数、无 DOM，jsdom 可测。`cameraMotion` 为空或**等价于恒等**（判定见 §7.2）时返回
`undefined`（**零开销快路径**，保证未使用该特性的项目性能完全不变）。

#### 4.3.2 合成器：`CanvasCompositor._drawVideoLayer`

```
fit = fitContain(...)                          // 现有逻辑不变
if (!layer.camera) { 现有 drawImage(source, fit) ; return }

ctx.save()
ctx.beginPath(); ctx.rect(fit.x, fit.y, fit.width, fit.height); ctx.clip()   // 绝不越界
ctx.globalAlpha = clamp01(layer.opacity)

if (2D 或 camera.degraded):
    sx = crop.x·videoWidth ; sy = crop.y·videoHeight
    sw = crop.w·videoWidth ; sh = crop.h·videoHeight
    // —— D13：目标矩形按 rollPad 放大并与 fit-rect 同心，否则旋转必露黑角 ——
    cx = fit.x + fit.width/2 ; cy = fit.y + fit.height/2
    dw = fit.width · camera.rollPad ; dh = fit.height · camera.rollPad
    if (roll ≠ 0):
        ctx.translate(cx, cy); ctx.rotate(roll·π/180); ctx.translate(−cx, −cy)
    ctx.drawImage(source, sx, sy, sw, sh, cx − dw/2, cy − dh/2, dw, dh)
    // 上面的 ctx.clip(fit) 把溢出部分裁掉；rollPad ≥ rollCover(roll) 保证四角被填满
else:
    surface = camera3DRenderer.render(source, crop, quad, ceil(fit.width), ceil(fit.height))
    if (surface) ctx.drawImage(surface, fit.x, fit.y, fit.width, fit.height)
    else 回落到 2D 分支（并置 degradedOnce 标志，仅告警一次）
ctx.restore()
```
`detach()` 需同时释放 `Camera3DRenderer`（销毁 GL 上下文与纹理）。
每层的绘制成功/失败仍走既有 `_recordLayerStat` 统计，不改语义。

#### 4.3.3 `Camera3DRenderer`（WebGL）

- 惰性创建一个离屏 `<canvas>` + `webgl2`（回落 `webgl`）上下文；尺寸随目标 fit-rect
  变化时重建 viewport（尺寸缓存，避免每帧 resize）。
- 单个着色器程序：顶点属性 `a_pos`（裁剪空间，由 `quad.pts` 归一化坐标映射而来）
  与 `a_uvq = vec3(u·q, v·q, q)`；片元 `texture2D(u_tex, v_uvq.xy / v_uvq.z)` —— 即
  经典的透视正确四边形贴图。`u,v` 取自 `crop` 子矩形，从而 2D 裁切与 3D 投影天然
  串联（与导出的 `zoompan → perspective` 顺序一致）。
- 每帧 `texImage2D(gl.TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, videoElement)`；
  `readyState < 2` 时直接返回 `null` 交由调用方跳过本层。
- 能力探测失败 / `getContext` 返回 null / shader 编译失败 → `isAvailable=false`，
  之后所有 3D 层走 §4.3.2 的 2D 近似分支（`affineApproxFromQuad`：取四角中心
  Jacobian 得到等效 scale 与位移，写回 `crop`）。

#### 4.3.4 变更检测（**必须**，D12）

`useTimelineComposition.ts` 的 `compositorPassthroughFields()` 需要**两处**改动，
缺任何一处这个防线都是形同虚设的（评审 P0-4）。

**① 放宽 early-return 守卫。** 现码（`useTimelineComposition.ts:46-49`）是：

```ts
if (v.audioDetached === undefined && v.opacity === undefined &&
    v.trackZ === undefined && !v.transitionIn && !v.transitionOut) {
  return '';
}
```

一个「只配了运镜、其它四个字段都是 `undefined`」的 clip 会在这里被短路掉，
**无论你在下面的 return 里追加什么指纹都不会生效**。必须同时加上
`&& v.cameraMotion === undefined`。

**② 在返回的字段数组末尾追加指纹：**

```ts
v.cameraMotion ? cameraMotionFingerprint(v.cameraMotion) : ''
```

`cameraMotionFingerprint` 是稳定的短字符串（`version|mode|presetId|intensity|easing|
startOffset|duration|start 7 个分量|end 7 个分量`，数值 `toFixed(4)`；`undefined` 的
可选字段统一序列化为空串，保证同一配置每次得到逐字符相同的指纹）。不加这一段，面板
「应用」后签名不变 → `setCompositionPlayback` 不触发 → 预览不更新。

> 指纹**只**参与变更检测，不参与任何数值计算；因此 `toFixed(4)` 的精度损失不会
> 影响画面，只会影响"小于 1e-4 的参数微调不触发重绘"——这是可接受且期望的行为。

暂停态下的重绘：`useCompositionPlayback` 已有 viewport 变化时的"单帧重绘"通道
（`subscribeViewportChange`）与 `imageOverlaySignature` 的同类处理；本方案复用
同一模式，新增 `cameraMotionSignature`（对所有视频序列的运镜指纹求拼接）作为
`useEffect` 依赖，变化时请求一次非播放态重绘，使暂停时应用运镜也能立刻看到。

### 4.4 导出链路（Export）

#### 4.4.1 请求构造（前端）

`useVideoExport.ts` 现有的 `video_items.push({...})` 追加一行：

```ts
camera_motion: toCameraMotionWire(item.cameraMotion),   // undefined → 不下发
```
`toCameraMotionWire` 位于 `playback/camera/wire.ts`，做 camelCase → snake_case 转换
并做一次范围钳位（防御脏数据）。

#### 4.4.2 滤镜注入点（后端，D4）

`_normalize_video()` 目前构造：

```
-ss <clip_start> -i <src> -t <clip_dur> -vf "<build_video_filter(scaling_params)>" -r F -an …
```

改为：

```python
camera_chain = build_camera_filter_chain(
    motion=video_info.get('camera_motion'),
    frame_w=scaling_params['scale_width'],
    frame_h=scaling_params['scale_height'],
    fps=video_info['target_fps'],
    clip_duration=clip_duration,
    caps=self._camera_caps,          # FFmpeg 滤镜能力探测结果（进程级缓存）
    config=self._camera_config,      # config/camera-motion.yaml
)
vf_params = build_video_filter(scaling_params, camera_chain=camera_chain)
```
`build_video_filter` 新增可选形参，把 `camera_chain` **紧跟在 `scale` 之后、
`pad` / `setsar` 之前**注入。注意该函数有**两条返回分支**（评审 P1-3），两条都要改：

```python
# needs_padding == False（源与目标同比，现码直接返回 scale + setsar）
f"scale={w}:{h}" + (f",{camera_chain}" if camera_chain else "") + ",setsar=1:1"

# needs_padding == True
f"scale={w}:{h}" + (f",{camera_chain}" if camera_chain else "") + f",{pad_filter},setsar=1:1"
```

`camera_chain` 为空串时两条分支的输出都与今天**逐字符相同**（**这是零回归的保证**，
§9.1 对两条分支各有一条断言）。

#### 4.4.3 运镜滤镜链模板

设内容矩形 `SW×SH`、目标帧率 `F`、超采样 `OS`（默认 2，仅 2D 缩放/平移段启用）、
roll 常量 `RP`（§4.2.3 的 D13）。`U = clip((T−w0)/wd,0,1)`；`E = <缓动表达式>(U)`。

> **⚠️ 帧计数变量在三个滤镜里不同名（评审 P0-1，本机实测）。** v1 对三者统一用
> `T=(on/F)` 会让所有带 `roll` 的导出**必然失败**：
>
> | 滤镜 | 可用的帧/时间变量 | 本方案取用 | 实测 |
> |---|---|---|---|
> | `zoompan` | `on`（输出帧号）、`in` | `T = (on/F)` | ✅ exit 0 |
> | `perspective` | `on`、`in`（需 `eval=frame`） | `T = (on/F)` | ✅ exit 0 |
> | `rotate` | **`n`（帧号）、`t`（秒）**，**没有 `on`** | `T = (n/F)`（等价可用 `t`） | ❌ `on` → `Undefined constant or missing '(' in 'on/10)*PI/180'` → `Failed to configure output pad`；改 `n` / `t` → exit 0 |
>
> 实现上把 `T` 做成 `build_camera_filter_chain` 内部的**按滤镜取值的局部串**，
> 不要提成一个全局常量字符串。

```
setpts=PTS-STARTPTS,
fps=F,                                        # 强制 CFR，使 on/F 精确等于时间
# ══ 2D 段（mode='2d'；存在缩放/平移/roll 中任意一项即启用）══
#    上采样倍数 = OS·RP：既给 zoompan 取整留精度（D7），又给 roll 的
#    crop-back 留分辨率，使最终 SW×SH 仍是原生像素而非拉伸像素。
scale=(OS*RP)*SW:(OS*RP)*SH:flags=bicubic,
zoompan=z='<SCALE(E)>':x='clip((<CX(E)>)*iw*(<SCALE(E)>)-ow/2,0,iw*(<SCALE(E)>)-ow)'
       :y='clip((<CY(E)>)*ih*(<SCALE(E)>)-oh/2,0,ih*(<SCALE(E)>)-oh)'
       :d=1:fps=F:s=<(OS*RP)*SW>x<(OS*RP)*SH>,
#   —— roll 子段（仅 roll 不恒为 0）：先原地旋转（四角会留空），
#      再居中裁掉 1/RP（该区域由 RP ≥ rollCover 保证无空洞）——
rotate=a='(<ROLL(E)>)*PI/180':c=black:ow=iw:oh=ih,
crop=iw/RP:ih/RP:(iw-iw/RP)/2:(ih-ih/RP)/2,
scale=SW:SH:flags=bicubic,
# ══ 3D 段（仅 mode='3d'）══
perspective=x0='<P0x(E)>':y0='<P0y(E)>':x1=…:y1=…:x2=…:y2=…:x3=…:y3=…
           :sense=destination:eval=frame:interpolation=linear
```

要点：
- **`zoompan` 的 `z` 用 `SCALE(E) = k(e).scale`（不含 `RP`）**，因为 `RP` 的放大是由
  后面的 `crop=iw/RP` + `scale=SW:SH` 完成的；两者相乘恰好等于 §4.2.3 的
  `S = scale·RP`。`roll ≡ 0` 时 `RP=1`，`rotate`/`crop` 两行**整行省略**，
  链路与 v1、与今天的行为一致。
- `zoompan` 的窗口宽 `ow = iw`，故 `z=1` 即"满画面"；`x` 的取整误差发生在
  `OS·RP×` 空间，降采样后 = `1/(OS·RP)` 像素（D7）。
- `SCALE(E)` 需**内联**而非引用 `zoom` 变量——不依赖 `zoompan` 变量可见性的实现细节。
- `crop` 的 `w/h/x/y` 只在初始化求值，`RP` 是常量，因此完全合法；`rotate` 的
  `ow/oh` 同样只在初始化求值（这正是 `RP` 必须是常量的原因，见 D13）。
- `perspective` 的角顺序为 **TL(x0,y0), TR(x1,y1), BL(x2,y2), BR(x3,y3)**，
  `sense=destination` 表示"输入四角被映射到给定位置"，与 §4.2.4 的 `px/py` 同义；
  已乘 `coverScale`，故输出画面恒被覆盖，不会出现黑楔。本机 `ffmpeg -h filter=perspective`
  确认 `sense`/`eval` 选项存在，且实测四角**取到画面外**（`-50` / `W+50`）时滤镜
  正常运行（exit 0），coverScale 外扩不会踩到滤镜边界。
- `P*(E)` 为 §4.2.4 轨迹的三次多项式拟合（D6），以 Horner 形式书写：
  `a+(E)*(b+(E)*(c+(E)*d))`。
- 3D 模式的 `roll` 已折进 `R`，**不再**追加 `rotate`；3D 的 `RP` 恒为 1（§4.2.3）。
- **表达式预检（新增守卫）**：`build_camera_filter_chain` 产出后，`_normalize_video`
  在正式转码前先跑一次极廉价的 dry-run
  （`ffmpeg -f lavfi -i color=c=black:s=64x36:d=0.1 -vf "<chain>" -f null -`）。
  这能在 0.1s 内抓住任何表达式/变量名错误（正是 P0-1 那类问题），失败即降级并回传
  warning，而不是让 4K 素材跑到一半才失败。探测结果按 `chain` 字符串做进程级缓存。

#### 4.4.4 降级与守卫（G7）

| 情况 | 行为 |
|---|---|
| `config.enabled == false` | 不注入任何滤镜；warning：`运镜已在服务端禁用` |
| `ffmpeg -filters` 中缺 `zoompan`/`perspective`/`rotate`/`crop` | 缺谁降级谁（缺 `perspective` → 3D 退化为其 2D 分量；缺 `rotate` 或 `crop` → 丢弃 roll 分量，其余 2D 保留）；warning 指明 |
| **滤镜串 dry-run 预检失败**（§4.4.3 末） | 该 clip 整体降级为无运镜；warning 附 FFmpeg 首行 stderr |
| 多项式拟合最大误差 > 0.75px（3 次后再试 5 次仍超） | 该 clip 3D 退化为 2D 分量；warning |
| 四角退化（`wq < Z_MIN` 或求交失败） | 同上 |
| 带运镜的 normalize 失败（`returncode != 0`） | **在 `_normalize_video` 内部同进程立即重跑一次不带运镜的 normalize**；成功则导出继续 + warning；再失败才返回 `success=False` 交给既有失败路径 |
| normalize 产物时长与 `clip_duration` 偏差 > 2 帧 | 视同失败，走上一行的无运镜重跑（时长用 `ffprobe`/`cv2` 读，与现码 `_get_video_properties` 同源） |

**降级必须下沉到 `_normalize_video` 内部（评审 P1-4）。** 现码
`_normalize_video_with_retry(video_info, max_retries=3)` 已有 4 次尝试 + 指数退避
（2/4/8s）。运镜表达式错误是**确定性失败**，若把「无运镜重跑」放在外层，一个坏 clip
会先白烧 4 次 ≈14s 才轮到降级；放在内层则第一次失败后立刻降级返回 `success=True`，
外层 retry 只保留它原本的职责——处理磁盘/编码器一类的瞬时故障。

#### 4.4.5 warnings 的传递通道（**v2 新增，评审 P0-3 / D14**）

导出是**异步**的，warnings **不能**挂在 compose 的即时响应上：

```
POST /api/video/compose ──► start_video_composition()  立即返回 {status:'processing'}
                                     │  （此时还没开始 normalize，warnings 必然为空）
                                     ▼  后台线程 ThreadPoolExecutor(max_workers=5)
                            _normalize_video_with_retry ──► _normalize_video
                                     │                        └─ 运镜降级发生在这里
                                     ▼
                     self.compositions[composition_id]['warnings'] += […]
                                     │
GET /api/video/compose/{id}/status ──┴──► safe_info（显式白名单！）──► 前端轮询回调
```

四个必改点，缺一则 G7 静默失效：

| # | 位置 | 改动 |
|---|---|---|
| W1 | `_normalize_video` 返回值 | 结果 dict 增加 `"warnings": list[str]`（含 clip 名/索引），成功失败路径都带 |
| W2 | 汇总处（`as_completed` 循环，`video_composition_service.py:1211` 附近） | 在**主线程**把每个 future 结果里的 warnings 追加到 `self.compositions[cid]['warnings']`。工作线程**不得**直接写共享 dict——warnings 随结果值回传是唯一的线程安全路径 |
| W3 | `video_router.get_composition_status` 的 `safe_info` | 该结构是**显式字段白名单**（只挑 `composition_id/task_id/status/progress/start_time` 等），必须显式加一行 `"warnings": composition_info.get("warnings", [])` |
| W4 | 前端 `CompositionStatusResponse` + `useVideoExport` 轮询回调 | 类型加 `warnings?: string[]`；轮询时按内容去重累积，导出完成后以「部分片段的运镜未能渲染」+ 明细通过 `showWarning` 呈现（导出**成功**，只是提示降级） |

为兼容起见，`VideoCompositionResponse` 上也保留一个 `warnings: List[str] = []`
字段，承载**同步阶段**就能判定的 warning（例如 `config.enabled == false`、
请求里的运镜被 pydantic 钳位），但**不承担** normalize 阶段的降级上报。

### 4.5 UI / 交互设计

#### 4.5.1 入口

1. **工具栏按钮（主入口）**：`TimelineToolbar` 的 `advancedButtons` 中，在
   `effects` 之前插入 `motion` 按钮（摄像机图标），沿用该数组既有的
   `{ id, icon, label, shortcut, onClick, disabled }` 形状与 `renderIconButton`。
   - `disabled` 条件由**单一判据函数**给出（评审 P2-7，避免工具栏 / 快捷键 / 双击 /
     徽标四处各写一份判断而漂移）：

     ```ts
     // playback/camera/eligibility.ts
     export function canApplyCameraMotion(
       item: TimelineItemData, track: TrackData | undefined,
     ): boolean {
       if (!track || track.locked) return false;
       if (track.type !== 'video') return false;      // 音频/字幕轨直接排除
       return item.type === 'video';                  // 图片素材（type==='image'）排除，见 D9/N1
     }
     ```
     工具栏按钮 `disabled = !selectedItems.some(canApplyCameraMotion)`；`M` 快捷键、
     双击、徽标点击全部复用同一函数。
   - `title` / `aria-label`：`运镜 (M)`；禁用时 tooltip 说明原因
     （`请先选中一个视频片段` / `图片片段暂不支持运镜` / `轨道已锁定`）。
2. **快捷键**：`TimelinePanel` 的全局 keydown 中新增 `m/M`（与既有 `e/t/s` 同样的
   非输入态守卫），走同一个 `handleOpenCameraMotionRef`。
3. **clip 双击（加速器）**：视频 item 双击打开面板（`TimelineItem.handleDoubleClick`
   目前只处理字幕 item，视频分支为空，无冲突）。
4. **clip 徽标**：已配置运镜的 clip 右上角显示一枚 12px 的摄像机徽标 + 预设名缩写，
   `title` 为完整描述；点击徽标同样打开面板（`stopPropagation` 防止触发拖拽）。

#### 4.5.2 弹窗面板 `CameraMotionModal`

基于 `src/components/ui/Modal.tsx`（已内建 Esc 关闭、焦点陷阱、焦点归还）。

> **a11y 契约（评审 P2-4）**：`Modal` 的 props 是
> `{ isOpen, onClose, labelledBy, describedBy?, children, className?, contentClassName?,
> closeOnBackdrop? }`——**`labelledBy` 是必填的元素 id**。面板标题需带一个稳定 id
> （如 `camera-motion-modal-title`）并传入 `labelledBy`；片段名那行作为 `describedBy`。
> `closeOnBackdrop` 取默认（点遮罩关闭），但**面板有未应用的改动时**要拦截并二次确认，
> 避免误点丢参数。

布局（桌面 ≥1024px 为双栏，窄屏纵向堆叠）：

```
┌──────────────────────────────────────────────────────────────┐
│  运镜                       片段：城市航拍_01.mp4        [✕]  │
├───────────────────────────┬──────────────────────────────────┤
│  [ 2D 运镜 ] [ 3D 运镜 ]   │   ┌────────────────────────┐     │
│                           │   │  实时示意舞台（循环）    │     │
│  ┌────┐ ┌────┐ ┌────┐     │   │  poster + 运镜取景框     │     │
│  │ 无 │ │推近│ │拉远│     │   └────────────────────────┘     │
│  └────┘ └────┘ └────┘     │   强度   ●────────  1.0x         │
│  ┌────┐ ┌────┐ ┌────┐     │   缓动   [ 缓入缓出 ▾ ]           │
│  │左移│ │右移│ │上移│     │   范围   (•) 整个片段 ( ) 自定义   │
│  └────┘ └────┘ └────┘     │   ▸ 高级参数（起点 / 终点数值）    │
│  ┌────┐ ┌────┐            │                                   │
│  │下移│ │旋转│            │   [ 反向 ]                        │
│  └────┘ └────┘            │                                   │
├───────────────────────────┴──────────────────────────────────┤
│  已选中 3 个片段  □ 应用到全部选中       [重置] [取消] [应用]  │
└──────────────────────────────────────────────────────────────┘
```

- **预设卡片**：`role="radiogroup"`，方向键切换，Enter/Space 选中；卡片内是
  纯 CSS/SVG 的迷你动画示意（一个取景框在缩略图上做对应运动），`prefers-reduced-motion:
  reduce` 时改为静态箭头示意。卡片选中态用 `ring-2 ring-primary`（与仓内既有
  组件一致的 shadcn/Tailwind token：`bg-card / border-border / text-muted-foreground /
  focus-visible:ring-*`），暗色模式自动跟随 CSS 变量。
- **示意舞台**：一个 `<canvas>`，用 clip 的 `thumbnailUrl`（无则纯色占位）作为纹理，
  以 2 秒循环调用**同一个** `resolveCameraDraw`+绘制代码渲染——所见即所得，并且
  天然验证了数学模块。3D 走同一个 `Camera3DRenderer`；不可用时显示「3D 预览已降级」
  角标。
- **参数控件**：强度 `range 0–2 step 0.05`（`aria-valuetext="1.0 倍"`）；缓动
  `<select>`；范围 radio + 两个数字输入（起始偏移 / 持续，单位秒，钳位到 clip 时长）；
  「高级参数」`<details>` 折叠，内含起点/终点的 `scale/x/y/roll`（3D 追加
  `rotateX/rotateY/dolly`）数字输入，任何手改自动把 `presetId` 切到 `custom`。
- **「反向」按钮**（评审 P2-5：v1 布局图里画了但没定义）：交换 `start` 与 `end` 两个
  关键帧，并把 `presetId` 置为 `'custom'`（因为它已不再等同于任何具名预设）。
  它是一个纯本地操作，和其它参数一样要点「应用」才落库。`aria-label="反向运镜方向"`。
- **画质提示（行内、非阻断）**：出现以下任一情况时，在示意舞台下方给出一行
  `text-muted-foreground` 的提示，说明"裁切较多，画质可能下降"并指出成因：
  - `coverScale > 1.6`（3D 角度过大）；
  - `RP > 1.2`（roll 角度过大——roll 的覆盖代价是**全程恒定**的，起手即有裁切，
    见 §4.2.6 第 5 行）；
  - 任一分量被 `RANGE` 钳位（评审 P2-5：例如 `pull-out` 在 `intensity=2` 时
    `scale` 会在中途撞到下限 1，运镜会提前静止）。此时提示改为
    "当前强度下部分参数已达上限，运镜会提前结束"。
- **底部**：多选时出现「应用到全部选中」复选框（默认勾选）。`应用` 为 primary
  按钮；`重置` 清空该 clip 运镜（等价于 `cameraMotion = undefined`）。
- **无侵入**：面板打开不暂停主预览、不修改 store；只有点「应用」才写入（可取消）。

#### 4.5.3 预设表（`cameraPresets.ts`）

`scale/x/y` 未列出者取默认（`scale=1, x=y=0.5, roll=0, rotateX=rotateY=dolly=0`）。

| id | 名称（zh / en） | mode | start → end |
|---|---|---|---|
| `none` | 无 / None | – | – |
| `push-in` | 缓慢推近 / Push In | 2d | `scale 1 → 1.25` |
| `pull-out` | 缓慢拉远 / Pull Out | 2d | `scale 1.25 → 1` |
| `pan-left` | 左移 / Pan Left | 2d | `scale 1.15`，`x 0.62 → 0.38` |
| `pan-right` | 右移 / Pan Right | 2d | `scale 1.15`，`x 0.38 → 0.62` |
| `pan-up` | 上移 / Pan Up | 2d | `scale 1.15`，`y 0.62 → 0.38` |
| `pan-down` | 下移 / Pan Down | 2d | `scale 1.15`，`y 0.38 → 0.62` |
| `zoom-pan-diagonal` | 推近并左移 / Zoom & Drift | 2d | `scale 1 → 1.3`，`x 0.55 → 0.42`，`y 0.55 → 0.45` |
| `roll-slight` | 轻微旋转 / Slight Roll | 2d | `scale 1.05`，`roll −2 → 2` |
| `dolly-in-3d` | 3D 推轨 / 3D Dolly In | 3d | `dolly 0 → 0.22`，`rotateY 0 → −3` |
| `dolly-out-3d` | 3D 拉轨 / 3D Dolly Out | 3d | `dolly 0.22 → 0` |
| `orbit-left` | 左环绕 / Orbit Left | 3d | `rotateY 10 → −10` |
| `orbit-right` | 右环绕 / Orbit Right | 3d | `rotateY −10 → 10` |
| `tilt-down` | 俯视下压 / Tilt Down | 3d | `rotateX −8 → 8` |
| `tilt-up` | 仰视上抬 / Tilt Up | 3d | `rotateX 8 → −8` |
| `parallax-push` | 视差推进 / Parallax Push | 3d | `dolly 0 → 0.18`，`rotateY 6 → −6`，`scale 1 → 1.08` |
| `sway-3d` | 3D 轻摆 / 3D Sway | 3d | `rotateY −5 → 5`，`rotateX 3 → −3` |
| `custom` | 自定义 / Custom | 2d/3d | 用户手改 |

> 预设角度刻意保守（`|rotate| ≤ 10°`）：§4.2.6 的实测显示 15° 已需要约 1.14×
> 覆盖缩放，角度越大裁切越多、边缘重采样越明显。用户仍可通过「强度」放大到 2×。

### 4.6 状态、持久化与撤销重做

- **Store 动作**：`timelineSlice.updateItemCameraMotion(itemId, motion | null)`
  （模式完全对齐既有 `updateItemImagePosition`：`findItem` → 赋值 → `_syncDerivedState`）。
- **编排动作**：`store/actions/setCameraMotion.ts` 导出
  `setCameraMotionAction(get, itemIds, motion | null)`：
  `recordAction('UPDATE_ITEM', { itemIds, kind:'CAMERA_MOTION' })` → 逐个
  `updateItemCameraMotion` → `requestAnimationFrame(() => get().captureNextState())`
  （与 `detachAudioAction` 逐字同构，保证 undo/redo 原子）。
- **实体**：`domain/entities/TimelineItem.ts` 增加 `_cameraMotion` 私有字段、
  getter/setter，并在 `fromPlainObject` / `toPlainObject` / 构造参数三处透传
  （逐字对齐既有的 `_audioDetached`：`:100` 字段、`:159` 构造、`:217` getter/setter、
  `:258` `create`、`:296` `fromPlainObject`、`:473` `toPlainObject` 的 `!= null` 收敛）。
  `clone()` 走 `toPlainObject→fromPlainObject`，因此**复制 clip 自动继承运镜**。

- **分割的时间窗必须重基（v2 新增，评审 P1-5）**：`SplitService.splitItemAtTime`
  用 `{ ...original }` 展开构造左右两半（已核实），运镜字段**接线上**自动继承——但
  **语义上是错的**：两半会各自跑一遍完整运镜，切点处画面跳回起点，与"分割不改变画面"
  的直觉和 WYSIWYG 都冲突。修复是一个纯函数 + 两行调用：

  ```ts
  // playback/camera/splitRebase.ts
  export function rebaseCameraMotionForSplit(
    motion: CameraMotion | undefined,
    originalClipDuration: number,
    cutOffset: number,               // 切点在原 clip 内的相对时间
  ): { left?: CameraMotion; right?: CameraMotion } {
    if (!motion) return {};
    // ① 先把"整个片段"（duration == null）物化成绝对时长，否则两半会各自重新铺满
    const w0 = motion.startOffset ?? 0;
    const wd = motion.duration ?? Math.max(0, originalClipDuration - w0);
    // ② 左半段窗口不变；右半段整体左移 cutOffset（startOffset 可为负 → §4.2.1 已允许）
    return {
      left:  { ...motion, startOffset: w0,             duration: wd },
      right: { ...motion, startOffset: w0 - cutOffset, duration: wd },
    };
  }
  ```

  在 `SplitService.splitItemAtTime` 里于 `leftData` / `rightData` 构造后各覆盖一次
  `cameraMotion`。这样两段拼起来**逐帧等价于原 clip**：右半段在 `tLocal=0` 处解出的
  `u` 恰好等于原 clip 在 `tLocal=cutOffset` 处的 `u`。`cameraMotion` 为 `undefined`
  时该函数是 no-op，`SplitService` 的既有行为零回归。

- **裁剪（resize）的语义**：默认窗口是「整个片段」（`duration == null`），拖动任一边
  后运镜自然重新铺满新时长——这是期望行为，无需额外处理。若用户显式设了窗口
  （`duration != null`）且**从左边**拖动，`startOffset` 按 `Δ` 同向平移（与分割同一
  语义），由 `resizeItem` 复用 `rebaseCameraMotionForSplit` 的位移分支实现。
- **JSON 项目导入导出**：`TimelineRepository` 的三处显式白名单（类型声明、导出
  map、导入 map）各加一行 `cameraMotion`；导入侧调用
  `sanitizeCameraMotion(raw)`（未知字段丢弃、数值钳位、版本不匹配则丢弃）——
  外部 JSON 不可信。
- **项目存档**：`VideoEditorContainer` 走 `TimelineData` 整体 JSON 持久化，
  `toPlainObject` 覆盖即自动生效，无需额外改动。

---

## 5. 文件 / 模块变更计划

### 5.1 前端 — 类型与数据模型

| 文件 | 动作 | 意图（一句话） |
|---|---|---|
| `src/types/index.ts` | 修改 | 新增 `CameraMotionMode/CameraEasing/CameraKeyframe/CameraMotion`，并在 `TimelineItem` 上加 `cameraMotion?` |
| `src/components/video/timeline/domain/types.ts` | 修改 | `TimelineItemData` 与 `CreateItemProps` 加 `cameraMotion?: CameraMotionData` |
| `src/components/video/timeline/domain/entities/TimelineItem.ts` | 修改 | 私有字段 + getter/setter + 构造参数 + `fromPlainObject` / `toPlainObject` 透传 |
| `src/components/video/types/videoEditingTypes.ts` | 修改 | `VideoSequenceItem` 加 `cameraMotion?` |
| `src/components/video/timeline/domain/ports.ts` | 修改 | 端口层 `VideoSequenceItem` 与 `VideoCompositionRequest` 项加运镜字段 |

### 5.2 前端 — 运镜数学（新增纯模块）

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/components/video/playback/camera/types.ts` | 新增 | 运镜类型、取值范围常量、`ResolvedCameraDraw` |
| `src/components/video/playback/camera/easing.ts` | 新增 | 四种缓动 + 进度求解（§4.2.1） |
| `src/components/video/playback/camera/cameraPresets.ts` | 新增 | §4.5.3 预设表 + `applyPreset(presetId, mode)` |
| `src/components/video/playback/camera/cameraGeometry.ts` | 新增 | `rollCover` / `rollPadForMotion`（D13 常量）/ `computeCropRect` / `project3DCorners` / `coverScaleForQuad` / `affineApproxFromQuad`（§4.2.3–4.2.5）+ 按 `(fingerprint, aspect)` 的 LRU 记忆化 |
| `src/components/video/playback/camera/resolveCameraDraw.ts` | 新增 | 对外唯一入口：`(motion, tLocal, clipDuration, frameAspect) → ResolvedCameraDraw \| undefined`（**含 `frameAspect`**，评审 P1-1） |
| `src/components/video/playback/camera/fingerprint.ts` | 新增 | `cameraMotionFingerprint(motion)`（D12 用） |
| `src/components/video/playback/camera/identity.ts` | 新增 | `isIdentityCameraMotion(motion)`——§7.2 的恒等判定（评审 P1-2），被快路径与徽标显示共用 |
| `src/components/video/playback/camera/eligibility.ts` | 新增 | `canApplyCameraMotion(item, track)`——工具栏/快捷键/双击/徽标共用的单一判据（评审 P2-7） |
| `src/components/video/playback/camera/splitRebase.ts` | 新增 | `rebaseCameraMotionForSplit(...)`——分割/左侧裁剪时的窗口重基（评审 P1-5） |
| `src/components/video/playback/camera/wire.ts` | 新增 | `toCameraMotionWire` / `sanitizeCameraMotion` |
| `src/components/video/playback/camera/Camera3DRenderer.ts` | 新增 | WebGL 透视四边形渲染器 + 能力探测 + 资源释放 |
| `src/components/video/playback/camera/index.ts` | 新增 | barrel 导出 |

### 5.3 前端 — 预览与导出接线

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/components/video/playback/types.ts` | 修改 | `CompositorLayer` 的 `video` 变体加 `camera?: ResolvedCameraDraw` |
| `src/components/video/playback/internal/assembleLayers.ts` | 修改 | `buildVideoLayers` 计算并挂载 `camera`；`ActiveVideoEntry.source` 扩出可选 `videoWidth/videoHeight` 以取 `frameAspect`（P1-1） |
| `src/components/video/playback/CanvasCompositor.ts` | 修改 | `_drawVideoLayer` 支持裁切 / `rollPad` 放大目标矩形后旋转（D13）/ 3D；`detach` 释放渲染器 |
| `src/components/video/playback/index.ts` | 修改 | 导出 camera 子模块 |
| `src/components/video/hooks/useTimelineComposition.ts` | 修改 | 组合签名纳入运镜指纹（D12）——**同时放宽 `compositorPassthroughFields` 开头的 early-return 守卫**（P0-4，`:46-49`） |
| `src/components/video/hooks/useCompositionPlayback.ts` | 修改 | 新增 `cameraMotionSignature` 依赖（照抄 `:553` 的 `imageOverlaySignature` 模式），变化时请求一次暂停态重绘 |
| `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | 修改 | 抽取序列时透传 `cameraMotion`；`buildCompositionRequest` 加 `camera_motion` |
| `src/components/video/hooks/useVideoExport.ts` | 修改 | `videoItems.push({…})`（`:326`）加 `camera_motion`；**在轮询回调里累积 `status.warnings`**（W4，不是读 compose 的即时响应） |
| `src/lib/api/videoComposition.ts` | 修改 | wire 类型 `CameraMotionWire`、`VideoCompositionItem.camera_motion`、**`CompositionStatusResponse.warnings?: string[]`**（W4）、`VideoCompositionResponse.warnings?: string[]`（同步阶段用） |

### 5.4 前端 — Store / 持久化

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/components/video/timeline/store/slices/timelineSlice.ts` | 修改 | `updateItemCameraMotion`（对齐 `updateItemImagePosition`：`findItem` → 赋值 → `_syncDerivedState`） |
| `src/components/video/timeline/store/actions/setCameraMotion.ts` | 新增 | 带历史记录的批量编排动作 |
| `src/components/video/timeline/store/index.ts` | 修改 | 导出新动作 |
| `src/components/video/timeline/domain/services/SplitService.ts` | **修改（v2 新增）** | 分割后调用 `rebaseCameraMotionForSplit` 覆盖左右两半的 `cameraMotion`（评审 P1-5） |
| `src/components/video/timeline/store/actions/resizeItem.ts` | **修改（v2 新增）** | 显式窗口（`duration != null`）在左边拖动时平移 `startOffset`；`duration == null` 无需处理 |
| `src/components/video/timeline/infrastructure/TimelineRepository.ts` | 修改 | JSON 类型声明（`:167` 附近）、导出 map（`:282` 附近）、导入 map（`:406` 附近）三处各加一行 `cameraMotion` + 导入侧 `sanitizeCameraMotion` |

### 5.5 前端 — UI

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/components/video/components/CameraMotionModal/CameraMotionModal.tsx` | 新增 | 弹窗主体（双栏布局、应用/取消/重置、多选批量） |
| `src/components/video/components/CameraMotionModal/PresetGrid.tsx` | 新增 | 预设卡片 radiogroup + 迷你动画示意 |
| `src/components/video/components/CameraMotionModal/MotionPreviewStage.tsx` | 新增 | 循环播放的运镜示意舞台（复用 `resolveCameraDraw`） |
| `src/components/video/components/CameraMotionModal/ParameterControls.tsx` | 新增 | 强度 / 缓动 / 时间窗 / 高级参数 |
| `src/components/video/components/CameraMotionModal/index.ts` | 新增 | 导出 |
| `src/components/video/components/index.ts` | 修改 | 追加导出 |
| `src/components/video/timeline/TimelineToolbar.tsx` | 修改 | 新增「运镜」按钮 + 可用性判定 |
| `src/components/video/timeline/TimelinePanel.tsx` | 修改 | 面板状态、打开/应用回调、`M` 快捷键、渲染 Modal、向下透传 `onOpenCameraMotion` |
| `src/components/video/timeline/TrackContainer.tsx` | 修改 | 透传 `onOpenCameraMotion`（照抄 `onRetryLocalDownload` 的链路） |
| `src/components/video/timeline/Track.tsx` | 修改 | 同上 |
| `src/components/video/timeline/TimelineItem.tsx` | 修改 | 运镜徽标 + 双击/点击徽标打开面板 |
| `src/lib/i18n.ts` | 修改 | 接口声明 + `en` + `zh` 三处新增 `timeline.cameraMotion.*` 文案与 `toolbar.motion` / `shortcuts.motionShortcut` |

### 5.6 后端

| 文件 | 动作 | 意图 |
|---|---|---|
| `backend-services/basic-service/app/models/video_models.py` | 修改 | `CameraKeyframe` / `CameraMotion` pydantic 模型（`Field(ge=,le=)` 二次校验）；`VideoCompositionItem.camera_motion`；`VideoCompositionResponse.warnings: List[str] = []`（仅同步阶段用，见 §4.4.5） |
| `backend-services/basic-service/app/services/composition/camera_motion.py` | 新增 | 数学镜像（§4.2，含 D13 的 `RP`）、多项式拟合、`build_camera_filter_chain()`、`probe_camera_filters()`、`dry_run_chain()`、`load_camera_config()` |
| `backend-services/basic-service/app/services/composition/video_scaling.py` | 修改 | `build_video_filter(scaling_params, camera_chain="")`——**两条返回分支都要注入**（评审 P1-3） |
| `backend-services/basic-service/app/services/composition/__init__.py` | 修改 | 模块说明追加 `camera_motion` |
| `backend-services/basic-service/app/services/video_composition_service.py` | 修改 | `video_tasks` 构造处（`:1184`）加 `'camera_motion'`；能力/配置进程级缓存；`_normalize_video` 内的 dry-run 预检、时长守卫、**同进程无运镜重跑**（P1-4）与 `warnings` 回传（W1）；`as_completed` 汇总处（`:1211`）在主线程写 `self.compositions[cid]['warnings']`（W2） |
| `backend-services/basic-service/app/routers/video_router.py` | **修改（v2 新增）** | `get_composition_status` 的 `safe_info` **显式白名单**加 `"warnings"`（W3，`:195` 起）——不加则 warnings 走不到前端（评审 P0-3） |
| `backend-services/basic-service/config/camera-motion.yaml` | 新增 | `enabled` / `supersample` / `interpolation` / `poly_degree` / `max_fit_error_px`（加载方式对齐既有 `yaml.safe_load` 约定，见 `video_composition_service.py:282`） |

### 5.7 测试

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/components/video/playback/camera/__tests__/easing.test.ts` | 新增 | 进度/缓动/窗口外保持语义 + **负 `startOffset`** + `w0 → clipDuration` 无 NaN |
| `src/components/video/playback/camera/__tests__/cameraGeometry.test.ts` | 新增 | §4.2.6 硬锚点 + 边界钳位 + 退化分支 + **`rollPad` 覆盖性几何断言**（P0-2 回归闸） |
| `src/components/video/playback/camera/__tests__/identity.test.ts` | **新增（v2）** | `pull-out` + `intensity=0` 不得判为恒等（P1-2 回归闸） |
| `src/components/video/playback/camera/__tests__/splitRebase.test.ts` | **新增（v2）** | 分割后两段拼接与原 clip 逐帧等价（P1-5 回归闸） |
| `backend-services/basic-service/tests/test_camera_motion_warnings.py` | **新增（v2）** | warnings 经 `self.compositions` → 路由 `safe_info` 白名单出现在 status 返回体（P0-3 回归闸） |
| `src/components/video/playback/camera/__tests__/fixtures/camera-golden.json` | 新增 | 跨语言黄金向量（TS 生成、入库、Python 断言） |
| `src/components/video/playback/camera/__tests__/goldenVectors.test.ts` | 新增 | TS 侧断言黄金向量 |
| `src/components/video/playback/__tests__/CanvasCompositor.camera.test.ts` | 新增 | 断言 `drawImage` 收到正确的 9 参裁切、clip 调用、无运镜时走旧路径 |
| `src/components/video/playback/__tests__/assembleLayers.camera.test.ts` | 新增 | 层上 `camera` 的时间取值（clip 内相对时间）与 undefined 快路径 |
| `src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.cameraMotion.test.ts` | 新增 | 透传 + wire 转换 |
| `src/components/video/timeline/infrastructure/__tests__/TimelineRepository.cameraMotion.test.ts` | 新增 | JSON 往返 + 脏数据 sanitize |
| `src/components/video/hooks/__tests__/useTimelineComposition.cameraSignature.test.ts` | 新增 | 仅改运镜也必须触发组合状态刷新（D12 回归闸） |
| `src/components/video/hooks/__tests__/useVideoExport.cameraMotion.test.ts` | 新增 | 导出请求含 `camera_motion`；warnings 上抛 |
| `src/components/video/components/CameraMotionModal/__tests__/CameraMotionModal.test.tsx` | 新增 | 打开/选预设/改参数/应用/取消/多选批量/a11y 角色 |
| `backend-services/basic-service/tests/test_camera_motion.py` | 新增 | 数学与 TS 黄金向量一致；滤镜串形状；降级分支；`build_video_filter` 空链路零回归 |

---

## 6. 接口设计（Interfaces）

### 6.1 HTTP wire（前端 → `/api/video-compose` → 后端 `/api/video/compose`）

`video_items[]` 新增可选字段（缺省 = 无运镜，完全向后兼容）：

```jsonc
{
  "id": "item-1", "name": "…", "url": "/api/storage/files/…",
  "start_time": 0, "duration": 6.0, "track_id": "video-1",
  "clip_start": 0, "clip_end": 6.0,
  "camera_motion": {
    "version": 1,
    "mode": "3d",                       // "2d" | "3d"
    "preset_id": "orbit-left",
    "intensity": 1.0,                   // 0..2
    "easing": "easeInOut",              // linear|easeIn|easeOut|easeInOut
    "start_offset": 0.0,                // 可选，秒，缺省 0
    "duration": null,                   // 可选，秒，null = 整个 clip
    "start": { "scale": 1.0, "x": 0.5, "y": 0.5, "roll": 0.0,
               "rotate_x": 0.0, "rotate_y": 10.0, "dolly": 0.0 },
    "end":   { "scale": 1.0, "x": 0.5, "y": 0.5, "roll": 0.0,
               "rotate_x": 0.0, "rotate_y": -10.0, "dolly": 0.0 }
  }
}
```

**响应（v2 修正，评审 P0-3）。** 运镜降级发生在异步 normalize 阶段，因此 warnings 的
主通道是**状态轮询**而非 compose 的即时响应：

```jsonc
// POST /api/video/compose  的即时响应 —— 只承载同步阶段就能判定的 warning
{ "success": true, "status": "processing", "progress": 0.0,
  "composition_id": "…",
  "warnings": [] }

// GET /api/video/compose/{composition_id}/status  —— 降级的真正出口
{ "composition_id": "…", "task_id": "…", "status": "completed", "progress": 1.0,
  "start_time": 1754380000,
  "warnings": ["片段「城市航拍_01」的 3D 运镜已降级为 2D（FFmpeg 缺少 perspective 滤镜）"] }
```

> `get_composition_status` 路由内的 `safe_info` 是**显式字段白名单**，不加这一行
> 就算服务态里存了 warnings 也传不出去（§4.4.5 的 W3）。

### 6.2 前端内部 API

```ts
// playback/camera
/**
 * 唯一入口。`frameAspect = 内容矩形宽 / 内容矩形高`，**必填**（评审 P1-1）——
 * rollPad / 3D 投影 / coverScale 全都依赖它，两端各自"就近取值"就是 WYSIWYG 漏洞。
 * 返回 undefined 表示"本 clip 无运镜"（零开销快路径）。
 */
export function resolveCameraDraw(
  motion: CameraMotion | undefined, tLocal: number, clipDuration: number,
  frameAspect: number,
): ResolvedCameraDraw | undefined;

export function applyPreset(presetId: string, mode: CameraMotionMode): CameraMotion;
export function cameraMotionFingerprint(motion: CameraMotion): string;
/** §7.2 的恒等判定（评审 P1-2）：intensity=0 且起点非默认时**不是**恒等。 */
export function isIdentityCameraMotion(motion: CameraMotion): boolean;
export function canApplyCameraMotion(item: TimelineItemData, track?: TrackData): boolean;
export function rebaseCameraMotionForSplit(
  motion: CameraMotion | undefined, originalClipDuration: number, cutOffset: number,
): { left?: CameraMotion; right?: CameraMotion };
export function toCameraMotionWire(motion?: CameraMotion): CameraMotionWire | undefined;
export function sanitizeCameraMotion(raw: unknown): CameraMotion | undefined;

export class Camera3DRenderer {
  static isSupported(): boolean;
  render(source: HTMLVideoElement | HTMLImageElement,
         crop: NormalizedRect, quad: CameraQuad,
         outW: number, outH: number): HTMLCanvasElement | null;
  dispose(): void;
}

// store
export function setCameraMotionAction(
  get: () => TimelineStore, itemIds: string[], motion: CameraMotion | null,
): void;
```

### 6.3 后端内部 API

```python
def build_camera_filter_chain(
    motion: Optional[CameraMotion], frame_w: int, frame_h: int,
    fps: int, clip_duration: float,
    caps: CameraFilterCaps, config: CameraMotionConfig,
) -> tuple[str, list[str]]:
    """返回 (filter_chain, warnings)；无运镜/被禁用时返回 ('', warnings)。

    frame_w/frame_h 即 scaling_params['scale_width'/'scale_height']（内容矩形），
    宽高比由二者相除得到，与预览端的 fit-rect 宽高比同源（§4.2 引言）。
    """

def probe_camera_filters(ffmpeg_path: str = "ffmpeg") -> CameraFilterCaps:
    """解析 `ffmpeg -hide_banner -filters`，进程级缓存（模式对齐 encode.detect_gpu_encoder）。"""

def dry_run_chain(chain: str, ffmpeg_path: str = "ffmpeg") -> tuple[bool, str]:
    """用 64x36/0.1s 的 lavfi color 源空跑一遍滤镜串，返回 (ok, first_stderr_line)。

    进程级按 chain 字符串缓存。这是 P0-1 那类"变量名不存在"的错误的最廉价拦截点：
    0.1 秒即可判定，而不是让 4K 素材跑一半才失败。
    """

def build_video_filter(scaling_params: dict, camera_chain: str = "") -> str:
    """现有签名 + 可选运镜链，紧跟 scale 之后、pad/setsar 之前。

    needs_padding 的两条返回分支都要注入；camera_chain == "" 时两条分支的输出
    与改动前逐字符相同（评审 P1-3）。
    """
```

---

## 7. 数据模型（Data Model）

**无数据库变更**（运镜随时间轴 JSON 存储，`video_projects` 表结构不变，无需
Alembic 迁移）。

### 7.1 `CameraKeyframe`

| 字段 | 类型 | 范围 | 默认 | 说明 |
|---|---|---|---|---|
| `scale` | number | `[1, 4]` | `1` | 画面放大倍数，1 = 满画面 |
| `x` | number | `[0, 1]` | `0.5` | 取景中心的归一化横坐标 |
| `y` | number | `[0, 1]` | `0.5` | 取景中心的归一化纵坐标 |
| `roll` | number | `[−45, 45]` | `0` | 画面内旋转角（度，顺时针为正） |
| `rotateX` | number | `[−45, 45]` | `0` | 俯仰（3D，度） |
| `rotateY` | number | `[−45, 45]` | `0` | 偏航 / 环绕（3D，度） |
| `dolly` | number | `[−0.6, 0.6]` | `0` | 推轨（3D），正值靠近相机 |

`mode='2d'` 时 `rotateX/rotateY/dolly` **必须为 0**（写入前由 `sanitize` 归零）。

### 7.2 `CameraMotion`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | `1` | 是 | 结构版本；将来变更时用于迁移，`sanitize` 遇到未知版本直接丢弃 |
| `mode` | `'2d' \| '3d'` | 是 | 决定预览渲染器与导出滤镜 |
| `presetId` | string | 是 | 预设 id 或 `'custom'`；仅用于 UI 回显与徽标文案 |
| `intensity` | number `[0,2]` | 是 | 缩放起终点差值的倍率 |
| `easing` | `CameraEasing` | 是 | 见 §4.2.1 |
| `startOffset` | number ≥ 0 | 否 | 运镜窗口在 clip 内的起点（秒），缺省 0 |
| `duration` | number > 0 | 否 | 窗口时长（秒），缺省 = clip 剩余时长 |
| `start` | `CameraKeyframe` | 是 | 起点 |
| `end` | `CameraKeyframe` | 是 | 终点 |

**等价恒等判定**（决定是否走零开销快路径）——**v2 修正，评审 P1-2**：

```
isIdentity(motion) =
    keyframeEqualsDefault(motion.start)
    && ( motion.intensity === 0 || keyframeEqualsDefault(motion.end) )
```

v1 的「`intensity === 0` → 视为无运镜」是**错的**：`pull-out` 预设的
`start.scale = 1.25`，`intensity = 0` 的正确语义是「停在 1.25× 的静态取景」
（§4.2.1 已明确"0 表示静止在起点"）。若判为无运镜，预览与导出都会渲染**未缩放**的
原画面，与面板示意舞台直接矛盾——这正是最难排查的一类 WYSIWYG 偏差。

因为 `k(e) = start + (end − start)·intensity·e`，上式是「`k(e)` 对所有 `e` 恒等于默认
关键帧」的充要条件。`keyframeEqualsDefault` 用 `1e-6` 容差逐分量比较。

### 7.3 `config/camera-motion.yaml`

```yaml
camera_motion:
  enabled: true              # D10 运维兜底开关
  supersample: 2             # 1..3；1 = 关闭 2D 超采样（实际上采样倍数 = supersample × RP）
  interpolation: linear      # linear | cubic（perspective 插值质量）
  poly_degree: 3             # 3D 轨迹拟合初始次数
  poly_degree_fallback: null # 评审 P2-6：v1 置 null 即"一次拟合不过就降级"；
                             # 需要时再填 5，避免三层兜底带来的分支与测试成本
  max_fit_error_px: 0.75     # 超过则该 clip 3D 降级为 2D
  dry_run_probe: true        # §4.4.3 的滤镜串空跑预检（建议保持开启）
```
加载方式对齐仓内既有约定（`yaml.safe_load` + 缺文件时用内置默认，
见 `video_composition_service.py:282` 的 `video-download.yaml` 读取），
**配置文件缺失不得导致启动失败**。

---

## 8. 实施顺序（建议给下游开发节点）

1. **P0 数学内核**：§5.2 全部新增模块 + 其单测（含硬锚点）。此阶段与 UI/后端解耦，
   可独立验证。
2. **P1 数据模型贯通**：§5.1 + §5.4，跑通「store 写入 → toPlainObject → JSON 往返」。
3. **P2 预览**：§5.3 的 playback 部分 + `CanvasCompositor` + 变更检测（D12）。
   此时可用浏览器手动验证：直接在 devtools 里给 item 塞 `cameraMotion` 看预览动。
4. **P3 UI**：§5.5，从工具栏按钮 → 弹窗 → 应用闭环。
5. **P4 导出**：§5.6，先让 `build_camera_filter_chain` 单测过，再接
   `_normalize_video`，最后跑真实导出比对首尾帧。
6. **P5 降级与告警**：§4.4.4 全部分支 + §4.4.5 的 W1–W4 四个传递点。
   **W3（路由白名单）最容易漏**，实现完立刻用一次真实导出验证 warnings 能到前端。
7. **P6 回归**：`npm run test`（vitest）、`npm run type-check`、`npm run lint`、
   `pytest tests/ -v`，以及桌面端一次完整走查（加素材 → 运镜 → 预览 → 导出 → 播放成片）。
   另加两条量化基线（评审 P2-9）：
   - **零回归基线**：同一个不含运镜的项目，改动前后各导出一次，产物 MD5 或逐帧
     PSNR 必须一致（对应 A6）。
   - **耗时基线**：一条 4K 素材分别在「无运镜 / 2D 推近 / 3D 环绕」下导出，记录
     normalize 阶段耗时。`zoompan` 在 `supersample × RP` 的上采样空间开销显著，
     若 2D 相对无运镜劣化超过 3×，把 `supersample` 默认值下调到 1 并记录取舍。

---

## 9. 测试与验收标准

### 9.1 单元测试（必须全部通过）

- **数学**：§4.2.6 七个锚点（3D 那条容差 0.5px）；`u` 在窗口外保持 0/1；
  `w0` 为负时（分割后的右半段）`u` 起点正确；`w0 → clipDuration` 不产生 NaN（P2-3）；
  `scale` 钳位；`rollCover(0°) === 1` 且此时 `rollPad === 1`；四角退化触发 `degraded`。
- **恒等判定（P1-2 回归闸）**：`pull-out` 预设 + `intensity=0` 时
  `isIdentityCameraMotion` 必须返回 **false**，且 `resolveCameraDraw` 返回的
  `crop.w ≈ 1/1.25`——而不是 `undefined`。
- **roll 几何（P0-2 回归闸）**：`roll ≡ 10°` 时 `rollPad ≈ 1.293508`；把返回的
  `crop + rollPad + roll` 代入 §4.3.2 的绘制公式，验证旋转后的目标矩形四角**完全包含**
  内容矩形（几何断言，不需要真实画布）。`roll ≡ 0` 时 `rollPad === 1`。
- **合成器**：有运镜时 `drawImage` 以 9 参形式调用且 `sx,sy,sw,sh` 等于期望值；
  `roll ≠ 0` 时目标矩形宽高等于 `fit.width×rollPad`、`fit.height×rollPad` 且与 fit 同心；
  调用了 `ctx.clip()`；无运镜时仍是 5 参调用（旧路径零回归）；`opacity` 与转场
  alpha 仍然生效（运镜不得吞掉透明度）。
- **层装配**：`camera` 使用 clip 内相对时间（clip 从 t=4s 开始、运镜 2s 窗口 →
  t=5s 时 `u=0.5`）；`videoWidth/videoHeight` 未就绪时 `camera === undefined`；
  无运镜时字段为 `undefined`。
- **签名（D12 / P0-4 回归闸）**：构造一个**只设了 `cameraMotion`、
  `audioDetached/opacity/trackZ/transitionIn/transitionOut` 全为 `undefined`** 的
  视频序列，断言 `computeCompositionSignature` 在运镜变化前后**不相等**。
  （只测"opacity 已设的 clip 改运镜"会漏掉 early-return 短路，等于没测。）
- **分割重基（P1-5 回归闸）**：一个 6s clip 配「整段推近」，在 t=2s 处分割后，
  右半段 `tLocal=0` 解出的 `k` 必须等于原 clip `tLocal=2` 解出的 `k`（逐分量 1e-6）。
- **持久化**：JSON 往返后运镜逐字段相等；构造非法 JSON（`scale: 99`、
  `version: 2`、缺字段、`mode:'2d'` 却带 `rotateY`）时 sanitize 结果安全。
- **导出请求**：`video_items[0].camera_motion.mode/start.rotate_y` 等字段正确
  snake_case 化；未配置运镜的 item 不含该键。
- **后端**：`build_camera_filter_chain` 在（无运镜 / 纯 2D / 2D+roll / 3D /
  禁用 / 缺滤镜 / dry-run 失败）七种输入下的输出串形状；**`rotate` 段用 `n` 而非 `on`**
  （P0-1 回归闸：断言生成串里不出现 `rotate=a='(on/`）；`roll ≠ 0` 时链尾必有
  `crop=iw/…` + `scale=SW:SH`；`build_video_filter(params, "")` 在
  `needs_padding` **True 与 False 两条分支**上都与改动前逐字符相同；多项式拟合误差
  ≤ 阈值；Python 与 TS 黄金向量差 ≤ 1e-6。
- **warnings 通道（P0-3 回归闸）**：mock 一次 `_normalize_video` 返回带 warnings 的
  结果，断言它经 `self.compositions[cid]['warnings']` 出现在
  `get_composition_status` 的返回体中——**必须覆盖路由的 `safe_info` 白名单**，
  只测 service 层会漏掉真正的断点。

### 9.2 集成 / 人工验收（Definition of Done）

| # | 场景 | 期望 |
|---|---|---|
| A1 | 选中一个视频 clip，点工具栏「运镜」 | 弹窗打开，标题显示片段名，默认停在「无」 |
| A2 | 选「缓慢推近」→ 应用 | 弹窗关闭；clip 出现运镜徽标；预览播放时画面平滑推近，无黑边、无抖动 |
| A3 | 暂停状态下应用运镜 | 预览**立即**重绘出运镜首帧（不需要先播放） |
| A4 | 选「左环绕」（3D）→ 应用 → 播放 | 画面呈现带透视的左右环绕，边缘无黑楔 |
| A5 | 导出成片并播放 | 运镜的方向、幅度、时机与预览一致（逐帧比对首/中/尾三帧，主观一致、客观 ≤ 1px 量级） |
| A6 | 未配置运镜的项目导出 | 产物与本次改动前逐帧一致（零回归） |
| A7 | Ctrl+Z / Ctrl+Y | 运镜的应用与清除可撤销、可重做 |
| A8 | 保存项目 → 刷新 → 重新打开 | 运镜配置完整保留；导出 JSON → 重新导入亦然 |
| A9 | 分割带运镜的 clip | 两段都带运镜徽标，且**切点前后画面连续、无跳回起点**（v2 修正：v1 的"各自重新解算"会让运镜重播一遍） |
| A10 | 键盘全流程 | `M` 打开面板 → 方向键选预设 → Tab 到「应用」→ Enter；Esc 可取消；焦点归还触发元素 |
| A11 | 在无 WebGL 的环境打开 3D 预设 | 预览降级为 2D 近似 + 明确角标；导出仍为完整 3D |
| A12 | 把 `camera-motion.yaml` 的 `enabled` 置 false 后导出 | 导出成功、无运镜、气泡提示"运镜已在服务端禁用" |
| **A13** | 「轻微旋转」（`roll`）预设 → 应用 → 播放 → 导出 | 预览与成片**四角均无黑楔**（P0-2 的验收面）；逐帧检查首/中/尾三帧的四角像素非纯黑 |
| **A14** | 人为制造一次降级（临时把 `perspective` 从 caps 里屏蔽）后导出 3D 运镜 | 导出**成功**；完成后前端气泡出现「部分片段的运镜未能渲染」+ 明细（P0-3 的端到端验收面） |
| **A15** | 选 `pull-out` 预设并把强度拉到 0 → 应用 | 预览是**静止的 1.25× 特写**，与面板示意舞台一致（P1-2 的验收面）；不是未缩放的原画面 |

### 9.3 黄金向量（跨语言一致性）

`src/components/video/playback/camera/__tests__/fixtures/camera-golden.json`：

```jsonc
{
  "version": 1,
  "frame": { "w": 1920, "h": 1080 },
  "cases": [
    { "name": "identity-2d", "motion": { /* … */ }, "clipDuration": 5, "t": 2.5,
      "expect": { "crop": [0,0,1920,1080], "roll": 0 } },
    { "name": "orbit-left-mid", "motion": { /* … */ }, "clipDuration": 5, "t": 2.5,
      "expect": { "crop": [0,0,1920,1080], "coverScale": 1.0,
                  "quad": [[…],[…],[…],[…]] } }
    // … 覆盖每个预设的 t=0 / 中点 / 末尾，共 ≥ 30 例
  ]
}
```
生成方式：TS 侧提供 `npm run gen:camera-golden`（`scripts/` 下的一次性脚本，或
测试内 `--update` 开关）；文件入库后，**TS 与 Python 两侧测试都只读不写**。
Python 侧以 `Path(__file__).resolve().parents[3] / "src" / …` 定位，文件缺失时
`pytest.skip`（保证仅拉取后端目录的环境不红）。

> **CI 必须禁止这条 skip（评审 P2-8）**：一条永远 skip 的跨语言闸门等于没有闸门。
> 读环境变量 `CAMERA_GOLDEN_REQUIRED`：为 `1` 时文件缺失直接 `pytest.fail`，
> CI 配置里置 1，本地/桌面打包环境保持默认 skip。
>
> 用例集除每个预设的 `t=0 / 中点 / 末尾`（≥30 例）外，**必须**额外覆盖：
> `roll ≠ 0`（验证 `rollPad`）、`intensity=0` 且起点非默认（验证 P1-2）、
> `startOffset < 0`（验证分割重基）、3D 退化（`wq < Z_MIN`）四类边界。

---

## 10. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **预览与导出的画面基准不一致**（预览对视频内容矩形，导出对已填充黑边的画布） | 运镜幅度与构图肉眼可见地对不上，WYSIWYG 破坏 | D4：滤镜注入在 `scale` 之后、`pad` 之前，两端基准都是"内容矩形"；A5 逐帧验收把它变成可测项 |
| R2 | `zoompan` 的 `x/y` 整数取整造成慢速平移抖动 | 观感廉价 | D7：2× 超采样后降采样，误差降到 0.5px；`supersample` 可配 |
| R3 | `zoompan` 的 `fps` 重采样导致片段时长漂移，破坏时间轴对齐 | 音画不同步、总时长变化 | 链首强制 `fps=F`；normalize 后校验时长偏差 ≤ 2 帧，超差则无运镜重跑（§4.4.4） |
| R4 | 目标机器的 FFmpeg 缺 `perspective` 或该滤镜不支持 `eval=frame` | 导出直接失败 | `probe_camera_filters` 启动期探测；缺失则 3D 退化为 2D 分量 + warning，绝不整单失败 |
| R5 | 3D 轨迹多项式拟合误差偏大 | 导出与预览的透视有可察觉差异 | 硬闸门 0.75px：3 次 → 5 次 → 关闭 3D；阈值可配；单测覆盖 |
| R6 | WebGL 不可用 / 上下文丢失（切换 GPU、系统休眠） | 3D 预览黑屏 | `isSupported()` 探测 + `webglcontextlost` 监听 → 置 `isAvailable=false` → 走 2D 仿射近似；仅告警一次，永不抛错 |
| R7 | 逐帧多一次纹理上传 / 裁切重采样导致掉帧 | 预览卡顿 | 无运镜零开销快路径；`CanvasCompositor` 既有自适应降帧（60→30）机制天然兜底；3D 渲染器复用同一 GL 上下文与纹理对象 |
| R8 | 运镜写入未纳入组合签名 | 「点了应用但预览不动」——本仓历史高频坑 | D12 + 专门的回归单测（§9.1「签名回归闸」） |
| R9 | `zoompan` 在 4K 素材 + 2× 超采样下内存/CPU 飙升 | 导出耗时显著变长甚至 OOM | 超采样只作用于 2D 段且可配为 1；normalize 已在 `ThreadPoolExecutor(max_workers=5)` 内并发，必要时可通过配置降并发 |
| R10 | 用户把强度拉到 2× 叠加大角度 → 覆盖缩放过大、画质劣化 | 成片模糊 | 预设角度保守（§4.5.3 注）；`scale` 硬钳 `[1,4]`、`S` 钳 `[1,8]`；面板在 `coverScale > 1.6` 时给出"裁切较多，画质可能下降"的行内提示 |
| R11 | JSON 项目文件被手工篡改后注入异常运镜 | 前端崩溃 / 后端表达式异常 | 导入侧 `sanitizeCameraMotion` 严格白名单 + 钳位；后端 pydantic `Field(ge=, le=)` 二次校验；表达式仅由数值格式化生成，**不拼接任何用户字符串**（无注入面） |
| R12 | 面板与主预览的运镜观感不一致（两套绘制代码） | 用户困惑 | 示意舞台复用**同一个** `resolveCameraDraw` 与 `Camera3DRenderer`，不另写实现 |
| **R13** | **FFmpeg 表达式里用了某个滤镜不存在的变量名**（P0-1 的一般化：三个滤镜的变量表并不相同，且不同 FFmpeg 版本还会增删） | 该 clip 导出直接失败 | ① §4.4.3 的变量对照表写死在实现注释里；② `dry_run_chain` 用 64×36/0.1s 的 lavfi 源空跑预检，失败即降级；③ §9.1 有"不得出现 `rotate=a='(on/`"的字符串断言 |
| **R14** | **旋转导致的四角空洞**（P0-2）——只缩小源裁切并不能填满被旋转的输出矩形 | 成片四角出现黑楔，观感廉价 | D13：`RP` 作用在目标矩形上；预览端几何断言 + 导出端 `crop=iw/RP` 兜底；A13 把它变成可验收项 |
| **R15** | **异步导出的 warnings 沉默**（P0-3）——降级发生在响应返回之后 | G7 名存实亡，WYSIWYG 破坏静默发生 | D14：warnings 走 status 通道，四个传递点 W1–W4 逐点落测；A14 端到端验收 |
| **R16** | 预览端与导出端的内容矩形宽高比因偶数取整而微差（`ensure_even_dimensions`） | 3D 四角有亚像素级偏移 | 相对误差 < 0.1%；黄金向量一律比归一化坐标（`1e-6`），像素级比对只在 §9.2 A5 的 1px 预算内进行 |

---

## 11. 与既有设计的关系

- 继承 spec 02（多轨预览合成器）的 `CompositorLayer` / `assembleLayers` 契约，
  只增字段不改语义；`z` 序、`opacity`、转场 alpha 的计算顺序完全不动。
- 继承 spec 05（FFmpeg 导出）的「规范化 → filtergraph/concat」两段式；运镜作用在
  规范化阶段，`filtergraph_builder` 与 `audio_mix` 零改动。
- 继承 spec 01 的 clip 时间契约：运镜时间窗一律以 **clip 内相对时间** 表达，
  与 `clipStart/clipEnd` 的媒体时间解耦，因此裁剪 clip 不会让运镜"跑位"。

## 12. 后续扩展点（非本次范围）

1. **图片素材运镜（Ken Burns on stills）**：预览接
   `ImageOverlayLayer.buildLayers`（把 `crop/quad` 传给 image 层的绘制），导出接
   `_process_image_overlays` 的 per-image overlay 链（在 overlay 之前插入同一套
   `zoompan/perspective`）。数据模型与数学模块无需任何改动。
2. **多关键帧曲线**：`CameraMotion.keyframes: Array<{ at: number } & CameraKeyframe>`，
   `resolveCameraDraw` 改为分段查找；导出侧对每段各拟合一条多项式。
3. **运镜模板库 / 收藏**：把 `CameraMotion` 存进用户偏好，面板增加"我的运镜"分栏。
4. **AI 建议运镜**：由 `video-editing-agent` 新增一个 `applyCameraMotion` 工具，
   直接复用 `setCameraMotionAction`。

---

## 13. 评审结论（Review Verdict）

### 结论：**有条件通过（Approved with Conditions）**

方案的**架构判断是正确的**，且是这条链路上少见的、真正把 WYSIWYG 当成可测不变量来
设计的方案。三个核心决策经复核成立，构成本方案的价值主体：

- **D4（滤镜注入在 `scale` 之后、`pad` 之前）** —— 让预览与导出作用在同一个「内容
  矩形」上，是整个 WYSIWYG 承诺的地基；
- **D5 / D13（覆盖系数取运镜级常量）** —— 逐帧射线求交写不进 FFmpeg 表达式，取常量
  是唯一两端可对齐的形式；
- **跨语言黄金向量** —— 把「两端不漂移」从口头约定变成可回归的闸门。

数学契约本身经手工复算无误（`rotateY=15°` 的 `q` 与 `coverScale=1.1409` 逐位吻合），
所依赖的 FFmpeg 能力（`perspective` 的 `sense=destination` / `eval=frame`、四角取到
画面外）已在本机实测确认可用，所依赖的仓内接缝（vitest、`SplitService` 的展开继承、
`detect_gpu_encoder` 的探测缓存模式、`yaml.safe_load` 的配置约定）也全部核实存在。

但 v1 存在 **4 个 P0 与 6 个 P1**，其中三个若不修则功能必然出错——`rotate` 用了不存在
的 `on` 变量（实测报错）、roll 在两端都露黑角（实测纯白帧角落亮度 235→16）、warnings
挂在了异步导出的错误消息上（永远为空）。第四个 P0（签名 early-return 短路）会精确地
复现本仓历史上反复出现的「点了应用但预览不动」。**这些问题都已在 v2 正文中修复**，
因此结论不是「打回」而是「有条件通过」。

### 放行条件（下游开发节点必须逐条满足）

| # | 条件 | 验收锚点 |
|---|---|---|
| C1 | `rotate` 段一律用 `n`/`t`，不得出现 `on`；`build_camera_filter_chain` 产出的串必须先过 `dry_run_chain` 预检 | §9.1 字符串断言 + §4.4.3 变量对照表 |
| C2 | roll 按 D13 实现：`RP` 为运镜级常量、作用在**目标矩形**上；导出端 `rotate → crop(1/RP) → scale` 三件套齐全 | §9.1 几何断言 + A13 四角非黑 |
| C3 | warnings 走 status 通道，W1–W4 四个点全部落地（**W3 的路由白名单最易漏**） | §9.1 warnings 回归闸 + A14 端到端 |
| C4 | `compositorPassthroughFields` 的 early-return 守卫**同时**加上 `v.cameraMotion === undefined` | §9.1 D12 回归闸（必须用"只设了运镜"的序列构造） |
| C5 | `resolveCameraDraw` 显式接收 `frameAspect`；两端取值按 §4.2 引言 | 黄金向量在归一化坐标下 `1e-6` 一致 |
| C6 | 恒等快路径按 §7.2 的新判定实现 | A15：`pull-out` + 强度 0 呈现静态 1.25× 特写 |
| C7 | 分割走 `rebaseCameraMotionForSplit` | A9：切点前后画面连续无跳变 |
| C8 | `build_video_filter` 的**两条**返回分支都注入，且空链路零回归 | §9.1 逐字符断言 ×2 + A6 产物一致 |
| C9 | 交付前跑完 §8 P6 的全部回归 + 桌面端完整走查，并留下 4K 导出耗时基线 | P6 检查单 |

### 规模评价（Right-sizing）

- **总体规模合适**。27 改 + 22 新（v2 后为 30 改 + 25 新）+ 12 测试对一个跨预览/导出
  双链路、需要跨语言数值一致性的特效来说不算过度；把数学内核独立成无 DOM 的纯模块，
  是让这件事可测的前提，这个结构值得保留。
- **两处可以收敛**：`poly_degree_fallback`（5 次拟合）已在 §7.3 降级为可选（默认
  `null`，一次拟合不过就降级），少一条分支和一份测试；`interpolation: cubic` 同理，
  v1 可只走 `linear`。
- **没有欠规格的部分**。v1 唯一的"画了但没定义"是面板上的 `[ 反向 ]` 按钮，v2 §4.5.2
  已补齐语义。
- **N1–N5 的非目标划得干净**，尤其 D9（图片 clip 一律禁用而非做半套）符合"宁可少做
  一半也不做一半错的"——v2 只是把判据收敛成了单一函数，避免四处实现漂移。

### 一致性（与 CLAUDE.md 及仓内约定）

无冲突。已逐项核对：路径别名 `@/*`、`__tests__/*.test.ts` 命名、
`Router → Service` 分层、`BaseResponse`/`ErrorResponse` 形状、YAML 配置加载方式、
中英混合注释、**无数据库变更因而不需要 Alembic 迁移**、`.gitignore` 极简因而提交时
要避开 `__pycache__`/`.next`/`tsconfig.tsbuildinfo`。唯一需要提醒下游的是：
本特性**不引入任何 `NEXT_PUBLIC_` 开关**，运维兜底只有服务端的
`config/camera-motion.yaml`（D10）——这是刻意的，客户端开关会让 WYSIWYG 多一个
不可控的分叉维度。

---

**文档版本**：**v2（评审节点产出）**
**评审人**：Senior Reviewer, Anthropic Engineering — 2026-08-05
**评审范围**：仅 `spec.md`；未改动任何源码，未执行 `git commit`
**遗留**：P2-6（多项式二次拟合）与 P2-9（导出耗时基线）为开发期决策项，
不阻塞进入实现节点。
**下一节点**：按 §8 的 P0→P6 顺序实施，逐条对照 §13 的 C1–C9 放行条件验收。

---

## 14. 实施过程发现的方案缺陷（Issues Found During Implementation）

> 记录于实现节点（2026-08-05）。按 §Constraints 的要求，**不静默偏离**：以下每条
> 都给出「方案原文 → 为什么错 → 实际采用的修正 → 落测位置」。P0/P1 全部已在代码中
> 修正并有回归测试；正文 §4 / §7 的对应段落**尚未回写**，下一次修订 spec 时应一并
> 更新（本节即为待回写清单）。

### I1（阻断级）— §4.2.1 的窗口 clamp 会让 §4.6 的分割重基失效

**方案原文**（§4.2.1）：

```
wdMax = max(MIN_WINDOW, clipDuration − w0)
wd    = motion.duration != null ? clamp(motion.duration, MIN_WINDOW, wdMax) : wdMax
w0    = clamp(motion.startOffset ?? 0, −clipDuration, max(0, clipDuration − MIN_WINDOW))
```

**为什么错。** §4.6 的 `rebaseCameraMotionForSplit` 把「整段运镜」物化后交给两半：
左半段拿到 `{startOffset: 0, duration: 6}`，但它自己只有 2s 长。上式把 `wd` 夹到
`clipDuration − w0 = 2`，于是左半段会在 2 秒内跑完**整段**运镜——正是 P1-5 要消灭的
「切点跳变」，只是从右半段挪到了左半段。`w0` 的下界同理：6s clip 在 t=4 处分割，右半段
时长 2s、`w0 = −4`，被 `−clipDuration = −2` 夹住后同样跳变。

**修正。** 显式窗口**不再**按 clip 时长夹：`wd = max(duration, MIN_WINDOW)`；`w0` 只保留
**上界** `min(w0, max(0, clipDuration − MIN_WINDOW))`（这一条才是 P2-3 「不产生 NaN」的
真正来源——它保证隐式窗口下 `clipDuration − w0 ≥ MIN_WINDOW`），下界只做有限性守卫。
`u = clamp((t−w0)/wd, 0, 1)` 对任意 `wd > 0` 都成立，窗口长于 clip 是**合法且必需**的
语义：「这段运镜只播到一半就被切断了」。

**落测**：`__tests__/easing.test.ts`「does NOT clip an explicit window to the clip
length」、`splitRebase.test.ts`「keeps the two halves frame-identical」；Python 侧
`test_camera_motion.py::test_window_does_not_clip_an_explicit_duration`。

### I2（阻断级）— §4.4.3 把 zoompan 段限定为 `mode=='2d'`，会丢掉 3D 的缩放分量

**方案原文**（§4.4.3 注释）：`# ══ 2D 段（mode='2d'；存在缩放/平移/roll 中任意一项即启用）══`

**为什么错。** §4.3.3 明确写着预览端 3D 的 `u,v` **取自 `crop` 子矩形**、且
「与导出的 `zoompan → perspective` 顺序一致」；§4.2.3 也为 3D 定义了
`S = clamp(k.scale, 1, 8)`。两处都要求 3D 同样走裁切。若按 §4.4.3 的注释只在 2D 启用
zoompan，`parallax-push`（`scale 1 → 1.08`）的缩放分量会**只出现在预览、不出现在成片**
——一个标准的 WYSIWYG 破口。

**修正。** zoompan 段的启用条件改为**与 mode 无关**：整个窗口内 `crop` 只要不恒等于
全画面就启用（`_needs_zoom_segment`）。roll 子段仍然只在 2D 启用（3D 的 roll 已折进
`Rz`，见 P1-6）。链序保持 `zoompan → perspective`，与 §4.3.3 一致。

**落测**：`test_camera_motion.py::test_3d_with_a_scale_component_still_zooms`。

### I3（正确性）— 射线-线段求交的 `s` 参数符号写反（本次实现引入并已修复，记录以免重犯）

`coverScaleForQuad` 判定交点是否落在线段内时，`s` 的 Cramer 解分母应为 `+det`
而非 `−det`。写反会让**每一条**射线都落在 `s ∈ [0,1]` 之外 → 判定为
`DEGENERATE` → **所有 3D 运镜静默退化为 2D**（预览与导出都退化，且退化路径本身是
"正常工作"的，所以只会表现为「3D 没有透视」而不是报错）。

**落测**：`cameraGeometry.test.ts`「grows the quad until it swallows the whole output
rect」+ `rotateY=15°` 锚点（`coverScale ≈ 1.14090`）；Python 侧同名断言。两侧的锚点值
同时被黄金向量锁住，符号再写反必然红。

### I4（规模/性能）— §7.3 的 `supersample: 2` 默认值超出 §8 P6 自己定的 3× 闸门

**实测**（本机 FFmpeg + 4K 3840×2160 / 30fps / 4s，normalize 阶段，libx264 ultrafast）：

| 用例 | supersample=2 | supersample=1 |
|---|---|---|
| 无运镜 | 3.01s（基线） | — |
| 2D 推近 | 21.26s（**7.07×**） | 6.26s（2.08×） |
| 2D 旋转 | 46.11s（15.32×） | 12.49s（4.15×） |
| 3D 环绕 | 6.21s（2.06×） | 6.23s（2.07×） |

§8 P6 原文：「若 2D 相对无运镜劣化超过 3×，把 `supersample` 默认值下调到 1 并记录
取舍」。7.07× 已明显超标，故**默认值改为 1**（§7.3 的 `2` 应回写为 `1`）。
**取舍**：平移的取整精度由 0.5px 退回 1px（D7）；慢速平移若出现肉眼可见跳格，可在
`config/camera-motion.yaml` 里改回 2。3D 环绕不含 zoompan 段，两档耗时相同。

2D 旋转即使在 supersample=1 下仍是 4.15×，那部分开销来自 D13 的 `RP` 上采样本身
（覆盖旋转四角的必要代价），不是超采样，无法进一步下调。

### I5（一致性，非阻断）— §9.1 要求的组件挂载测试在本仓的 vitest 下不可行

§5.7 列的 `CameraMotionModal.test.tsx` 无法按「挂载组件 + fireEvent」的形式落地：
本仓 `tsconfig.json` 是 `jsx: "preserve"`，vitest 的 rolldown/vite transform 因此
**无法转换任何组件 JSX**（实测 `render(<Modal/>)` 与 `import` 任意 `.tsx` 组件都会
在 import analysis 阶段失败）。这是仓内既有约束，`PreviewCanvas.test.tsx` /
`ProjectCard.test.tsx` 已经因此改用**源码级契约断言**。

**处置**：`CameraMotionModal.test.ts`（`@vitest-environment node`）沿用同一模式，
断言 a11y 契约（`labelledBy`/`describedBy`/`radiogroup`/`aria-checked`/roving
tabindex/方向键）、「只有『应用』才写库」的无侵入契约、批量勾选的目标收敛，以及
示意舞台复用 `resolveCameraDraw`（R12）；面板**行为**本身（预设 → 运镜、恒等判定、
反向、强度 0）则以真实单测打在其委托的纯模块上。改动 `jsx` 编译配置属于本方案范围外，
未做。

### I6（可行性备注）— §4.4.3 的 `dry_run_chain` 不能只看 returncode

`rotate` 用错变量名时（P0-1 的原始症状）FFmpeg 会把
`Undefined constant ... Failed to configure output pad` 打到 **stderr，但进程仍然
`exit 0`**（本机实测）。因此 `dry_run_chain` 的判据是
`returncode == 0 且 stderr 为空`，只判 returncode 会让这道闸门形同虚设。

### 已实测确认成立的方案结论（无需改动）

- **P0-1**：`rotate` 确无 `on` 变量。实测 `rotate=a='(on/30)*PI/180'` →
  `Undefined constant or missing '(' in 'on/30)*PI/180'` → `Failed to configure
  output pad`；换 `n` 后 exit 0、stderr 空。
- **P0-2 / D13**：纯白 1920×1080 帧过 `rotate=a=10°:c=black:ow=iw:oh=ih` 后左上
  8×8 的 `YAVG` = **16**（黑角）；走 D13 三件套
  （`scale=2484:1398 → rotate → crop=iw/1.293516 → scale=1920:1080`）后 `YAVG` = **235**。
- **R3（时长漂移）**：3s/30fps 素材过完整 2D 链后 `duration=3.000000`、`nb_frames=90`，
  无漂移。
- **§4.2.6 锚点**：`rollCover(10°, 16:9) = 1.2935156`；`rotateY=15°` 的
  `q = 0.907435 / 1.113594`、`coverScale = 1.140881` —— 与正文（1.293508 /
  0.90743 / 1.11359 / 1.14090）在其自述的容差内吻合。`px` 复算为
  `TL ≈ 118.545 / TR ≈ 1992.623`（正文 118.47 / 1992.72，差 < 0.1px，正文已声明
  「以参考实现输出为准回填」，故未改正文，单测按 0.5px 容差）。
