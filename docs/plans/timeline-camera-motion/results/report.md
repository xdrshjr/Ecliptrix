# timeline-camera-motion 终审报告（节点 #4）

> 评审角色：Anthropic 工程团队高级代码评审 ｜ 评审对象：`experiment-plan.md`（v2）+ 提交 `6d0fa57` 的代码 + 节点 #3 的实验产物
> 评审方法：**不接受任何一方的断言为真**——所有指标结论都回读原始 JSON 与源码复核，关键护栏亲自复跑，最强的一条防复发断言（「测试能复现缺陷 A」）用改回旧代码的方式实证。
> 结论：**通过并已提交**。评审过程中另查出 4 个问题，全部就地修复，不留 TODO。

---

## 1. 背景

本特性要在 Ecliptrix 的时间轴剪辑器里补上「2D 运镜 / 3D 运镜」：工具栏与右键菜单有明确入口，面板可选预设、可调参、可撤销，**画布预览实时正确呈现**，**导出成片逐帧还原同一运镜**。它的难点不在于「做出一个特效」，而在于预览端（Canvas 2D + WebGL）与导出端（FFmpeg `perspective`）是两套完全不同的渲染器，却必须在像素级上说同一件事——所见即所得一旦破了，用户是在导出之后才知道的。

计划 v2 给出的支点是 H1：把 2D 与 3D 压成同一个抽象——**画布空间的 3×3 单应矩阵 `H`**，2D 只是末行为 `[0,0,1]` 的退化情形。三个消费者（预览 2D 走 `ctx.transform`、预览 3D 走 WebGL 贴图四边形、导出走 `perspective`）吃的是同一个 `H`，只是作用在不同的矩形上（预览是视频 fit-rect，导出是整幅画布矩形，因为归一化已把黑边烤进帧里）。TS 与 Python 双实现由一份冻结的黄金向量约束，这是 M1 的实质。

节点 #1 的评审在 v1 上查出 5 个 P0 与 12 个 P1 并就地修复，其中三条决定了本特性的成败：`assembleLayers` 拿不到画布尺寸所以几何必须两段式拆分（R-P0-1）、FFmpeg 的角序是**光栅序**而非顺时针（R-P0-2）、以及 filtergraph 失败后会**静默回退 concat**从而把「没有特效的成片」当成功交付给用户（R-P0-4）。节点 #2 按此实现，节点 #3 跑完 M1–M6 并查出 2 个真实缺陷。本节点是最后一道闸门。

关于范围的一句说明：`6d0fa57` 里还夹带了一处与运镜无关的改动——`CanvasCompositor` 的 `fitContain` 不再传 `targetAspectRatio`（属于 `preview-aspect-ratio-stretches-inner-video` 那条诊断线）。它已随该提交落地，本次终审不回滚，但在 §5 登记，因为它会影响 M2/M5 的解释边界。

---

## 2. 参数

**特性目录**：`docs/plans/timeline-camera-motion/`（`experiment-plan.md` 唯一入口；`fixtures/` 黄金向量；`experiments/` 台架；`results/` 指标）。

**运行环境**：本机 Windows 11（`win32`, 10.0.26200），工作目录 `M:/takoAI/Ecliptrix`，`environment: local`，全程无远程主机、无 SSH、无私钥。FFmpeg 为 `2025-05-15-git-12b853530a-full_build-www.gyan.dev`，能力探测落在**降级阶梯第 1 档**（`perspective` + `eval=frame` + `sense` 全部可用），即所有导出走的是逐帧精确路径。预览侧真实 GPU 为 `ANGLE (Intel Arc Graphics, Direct3D11)`，WebGL 2.0，`PerspectiveQuadRenderer.acquire()` 成功——3D 走的是真透视而非 2D 影子。

**几何参数**：中性态 `N = {scale:1, offset:0, roll:0, yaw:0, pitch:0, dolly:1}`；针孔焦距 `PERSPECTIVE_FOCAL_RATIO = 1.6 ×` 画布长边；强度语义为 `state(p) = N + (raw(p) − N)·intensity`，`intensity ∈ [0,2]`，故 `intensity = 0` 对任何预设都是**真恒等**（R-P1-7）；角序全局冻结为顺时针 `[TL,TR,BR,BL]`，Python 发射器换位成光栅序 `[TL,TR,BL,BR]`；`ensureCoverage()` 在 intensity 之后计算；3D 露底用 `#00000000` 透明 backdrop 的 `pad → perspective → crop`，margin 取偶且以**覆盖**而非溢出为触发条件。

**预设**：16 个（2D / 3D 各 8），未做 §8 的规模裁剪。**画布**：1920×1080，`output_fps = 30`。**阈值**：M1 ≤ 0.5px；M2 分级 SSIM 0.97 / 0.93 / 0.90，硬地板 0.85；M3 `lastDrawMs` 均值 ≤ 12ms 且 `targetFps` 恒 60 且 rAF p95 ≤ 20ms；M4 16/16 且降级必告警且带运镜禁回退 concat；M5 三条；M6 六项。

**本次终审实际执行的命令**：`npx vitest run`（全量）、`npx vitest run <运镜相关目录>`、`npm run type-check`、`pytest tests/ -k "composition or filtergraph or camera or scaling or transition"`、以及四个运镜后端测试文件的定向复跑。

---

## 3. 关键日志

**前端全量（终审复跑）**：`Test Files 2 failed | 190 passed (192)`、`Tests 3 failed | 1605 passed (1608)`。失败集合是 `cachePlayback.integration.test.ts` 与 `backend-proxy.test.ts` 共 3 项——与 `m5-regression.json` 记录的、在 `6d0fa57^` 的 detached worktree 里复跑同样失败的既存项**完全一致**；通过数由 1602 升到 1605，正是本节点新增的 3 条 `isMotionRenderable` 用例。**本节点净引入回归 0 项。**

**后端回归切片（终审复跑）**：`17 failed, 101 passed, 944 deselected, 1 error in 76.21s`。失败文件集合与节点 #3 记录的**父提交失败集合逐个相同**（`test_video_composition*.py` 五个文件，成因是 cv2 桩、TTS 网络等环境因素，父提交即已失败）；通过数由 96 升到 101，正是本节点新增的 5 条用例。缺陷 B（`test_filtergraph_builder.py` 的 `pre_trimmed=` 旧调用点）保持修复状态，该文件 12/12 绿。

**运镜定向套件**：`64 passed in 3.58s`（`test_filtergraph_builder` + `test_camera_motion_geometry` + `test_camera_motion_no_silent_concat` + `test_filtergraph_camera_motion` + 本节点新增的 `test_camera_motion_guards`）。`tsc --noEmit` 静默通过。

**实证复核一条最强断言**：节点 #3 声称新增的 `PerspectiveQuadRenderer.upload.test.ts` 能复现缺陷 A（3D 预览上下颠倒）。终审把 `UNPACK_FLIP_Y_WEBGL` 从 `false` 改回 `true` 后复跑，得到 `Tests 1 failed | 2 passed (3)`；改回来后 `3 passed`，文件 diff 恢复为 `17 insertions(+), 2 deletions(-)`，与节点 #3 的原始改动逐字相同。**这条防复发锁是真的见过它要防的缺陷**，不是事后补的空转断言。

**关于原始日志的一条说明**：本仓库 `.gitignore:59` 用 `*.log` 全局屏蔽日志（来源 spec/05 V05-D，历史上有过 2834 次 Bearer JWT 经日志泄露）。因此 `results/logs/` 下的原始日志**有意不入库**，不用 `git add -f` 绕开——结论、退出码与失败清单都已提取进同级的 6 份 JSON，视觉证据是 `.jpg` 已入库，台架 `run_all.py` 可一键重跑再生。详见 `results/logs/README.md`。

**新增护栏的日志**：`test_camera_motion_guards.py` 的两条参数化断言把「导出发射出的常量四角」与「几何内核 `camera_homography` 算出的四角（换算到 padded 坐标系）」逐点比较，容差 1e-6px——这顺带成了 padded 3D 帧下发射器与内核的一次独立交叉校验。

---

## 4. 结果

### 4.1 对节点 #3 六项指标的复核结论

M1–M6 **全部复核属实**，无一项需要推翻：M1 在 1344 个角点上最大偏差 6.84e-7px（阈值 0.5px，低六个数量级）；M2 的 80 格最低 0.9911（3D `dolly-in-3d`），三档均值 0.9958–0.9966，无一格触碰 0.85 硬地板，且每格额外与**上下镜像的成片**比过一次方向哨兵；M3 `lastDrawMs` 均值 0.88ms（无运镜基线 0.37ms，增量约 0.51ms/帧），`targetFps` 全程 60，rAF p95 6.5ms；M4 16/16 成功，L1 / L11 / tier-2 / tier-3 四条护栏全绿，最长滤镜串 4173 字符；M5 三条件全满足，且条件①比的是**从 git 取出的真正的改动前代码**而非作者自己冻结的字面量；M6 i18n `en` / `zh-CN` 齐平、9 项无障碍可供性命中、0 处硬编码文案。

方法学上有两处值得肯定：M1 绕开了 Python 侧那份重新声明的 `PRESET_ENDPOINTS` 副本，直接吃线上预设表转译出的 wire 载荷——常量漂移正是藏在副本里的；M5 的「既存失败」是在干净的 detached worktree 里**测出来的**，不是推断出来的。

### 4.2 终审查出并修复的 4 个问题

**问题 1（P1，导出鲁棒性）｜能力探测的结果没人消费。** `ffmpeg_caps.FfmpegCaps.supports_filter_complex_script` 被探测、被日志打印、docstring 还写明它是「巨图的逃生舱」，但 `_run_filtergraph` 在滤镜串超过 8KB 时**无条件**使用 `-filter_complex_script`。计划 §4.3 第 3 档明确要求「由能力探测二选一」。后果不是崩溃而是**误导**：缺该选项的构建会以「未知选项」失败，而带运镜时的重试阶梯会转而归咎于 `eval=frame`，给用户一条静态取景的片子和一句与真实原因无关的警告。修复：把改道挂在能力位上，不支持时退回内联并 `logger.warning`——8KB 是我们自己设的阈值，只有 Windows `CreateProcess` 真实上限（约 32767）的四分之一，内联在这种情形下仍然正确。新增回归用例 `test_large_filtergraph_inlines_when_the_build_has_no_script_option`。

**问题 2（P0，预览/导出分叉）｜导出侧缺少几何内核的 `scale` / `dolly` 下限。** 两侧内核都在 `camera_homography` 里做 `max(scale, 1e-4)` 与 `max(dolly, 0.05)`，但 Python 发射出的 FFmpeg 表达式没有带上这两个夹子。而面板的高级滑杆允许 `scale` 低到 0.5、`dolly` 低到 0.4，`intensity` 又会把「相对中性态的偏移」放大一倍——`scale 0.5 @ intensity 2` 精确落在 **0**，`dolly 0.4 @ intensity 2` 落在 **−0.2**。前者让 `perspective` 的四个点重合成一个奇异方程组，后者把成像面推到针孔背后。预览照常渲染（有夹子），导出则整单失败。这是本特性最不该出现的那类分叉。修复：在 `_field_symbols` 里镜像同样的夹子，且**只在夹子可能生效时才发射**——两个字段都对缓动进度仿射、进度本身被 `clip(...,0,1)` 约束，所以整段运动的最小值就是两端点的较小者；端点越过下限时才包 `max(...)`。因此**所有出货预设的滤镜串逐字符不变**，M5 与既有冻结断言不受影响。新增 4 条用例，其中两条把发射结果与内核四角逐点对齐。

**问题 3（P1，计划要求缺失）｜`isRenderable` 从未接进生产。** 计划 §3.1 把它定义为「高级参数」的可渲染性守卫，节点 #2 写了、单测覆盖了、`index.ts` 导出了，但生产路径没有一处调用——它是死代码，守卫等于不存在。修复：在几何内核新增 `isMotionRenderable(motion, canvas)`（按**进度**而非时间采样整个运动窗口，因此不需要 clip），并接到 `CameraMotionModal`：草稿不可渲染时 `Apply` 置灰、旁边给出 `role="alert"` 的本地化说明，按钮以 `aria-describedby` 指向它。这里**刻意偏离**了计划原文的「按二分法把 yaw/pitch 钳回最后一个可渲染值」：悄悄改写用户手输的数值不如明确拒绝并说明原因，后者才符合人机交互的可预期原则。文案 `unrenderable` 按 R-P2-2 的规矩三处同改（TS 接口 / en / zh）。新增 3 条用例，其中一条专门证明**只看两端点会漏判**（端点合法、中点越界）。

**问题 4（P2，规范阈值）｜`camera_motion.py` 929 行，超过仓库 800 行硬阈值。** 计划 §7 与 DoD #9 都写明「所有新文件 ≤ 800 行」，而 M6 的 `fileSizeCeiling` 审计只列了 8 个前端文件，后端新增文件根本不在审计集里，所以这条一直是绿的。修复：沿文件里**已经存在的那道分节线**（`# FFmpeg filter emission`）拆成两个模块——`camera_motion.py`（524 行）留纯几何内核，也就是必须与 TS 孪生保持字节兼容、被黄金向量比对的那一半；`camera_motion_filters.py`（480 行）承担 FFmpeg 特有的部分（表达式寄存器、光栅角序、透明 backdrop、能力阶梯）。依赖是单向的（filters → kernel），两者可独立评审。同步更新 2 处生产导入与 2 处测试导入，并把 `m6-ux-audit.json` 的审计集**扩到全部新增源文件**并加注说明——一份漏掉一半被审对象的绿灯，比红灯更危险。

### 4.3 对计划落地条件的逐条判定

节点 #1 列的 5 条「开工前必须接受」的条件，逐条核对源码后全部成立：几何两段式未被合并（`motionStateAt` 在 `assembleLayers`，`cameraHomography` + `projectRect` 在 `CanvasCompositor._drawVideoLayer`）；角序换位由 `quad_to_perspective_points` 集中承担并有专测；L1 与 L11 两条护栏测试存在且为绿（`_track_needs_filtergraph` 把 camera_motion 作为硬触发；`_compose_videos_filtergraph` 在带运镜时先重试静态取景再 `raise`，绝不 `return False`）；指标按 v2 口径执行；规模未裁剪，16 个预设全交付。DoD 第 1–7、9、10 条均达成，第 8 条见 §5。

---

## 5. 风险

**R1｜Electron 桌面端 walkthrough 仍未完成，这是唯一未闭合的 DoD（第 8 条）。** 本仓库长期有 dev 端与打包端行为不一致的历史（starlette Range、打包 env 覆盖）。节点 #3 用的是 `desktop/node_modules` 里的 Electron 与本机 FFmpeg，打包端内置的 FFmpeg 版本可能不同。能力探测本就是运行时行为，但必须在打包端实走一次「加运镜 → 预览 → 导出 → 播放成片」，并记录一次 `ffmpeg -version` 到 `results/`。**这是本特性合并前的最后一道门禁，不可省。**

**R2｜双轨叠加下的 3D 露底只验到滤镜串层面，没有逐像素比对。** 透明 backdrop 能让下层轨道正确透出（§2.5 探测 3/4 已实测），但 M2 用的是单轨合成图案。建议在 walkthrough 里人工确认一次双轨 3D 露底。相关的既有缺陷 L13（上层轨道的黑色 letterbox 边在导出侧是不透明的，`pad=...:black` 烤进帧里）**不在本特性范围**，但它会让「叠加轨用非画布比例素材」的场景出现与运镜无关的差异，排查时不要误判。

**R3｜后端 17 项既有 composition 失败未修。** 它们在父提交即已存在（cv2 桩、TTS 网络等），但会持续遮蔽新回归——缺陷 B 正是被它们遮住、靠逐提交归因才挖出来的。建议单独立项清理。

**R4｜`-filter_complex_script` 已被上游标记为 deprecated。** 问题 1 修复后它至少不会在缺失时炸掉，但新版 FFmpeg 推荐的是 `-/filter_complex <file>` 形式。当前实现只探测并使用旧写法；等旧写法真正被移除时需要补上新形式的探测分支。本机实测旧写法仍被接受，短期无风险。

**R5｜jsdom 测不了真渲染，这是结构性盲区。** 缺陷 A（3D 预览上下颠倒）能瞒过 1600+ 条前端用例，根因就在这里。现有对策是两道锁：上传契约的记录型假 GL 断言（已实证能复现该缺陷），以及 M2 的方向哨兵（每格与镜像成片对比，要求正立分数至少高 0.02）。二者都不能替代真渲染验证——`PerspectiveQuadRenderer` 的着色器一旦改动，必须重跑 M2 而不是只看单测。

**R6｜i18n.ts 已 7175 行，远超 800 行阈值。** 这是既有技术债（R-P2-2 已登记），本特性只是又往里加了几个键。拆分会牵动构建，且该文件同时承载着本分支在途的 remove-user-system 改动，不在本特性范围内处理。

**R7｜本分支工作树仍有大量 remove-user-system 的在途改动（300+ 文件）。** 本次提交严格按文件路径逐个 `git add`，未使用 `git add -A` / `git add .`，也未纳入任何 `__pycache__` / `.next` / 构建产物。合并前请确认这两条改动线的先后顺序。
