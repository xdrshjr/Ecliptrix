# timeline-camera-motion 实验执行记录（节点 #3）

> `environment: local` ｜ 本机 Windows 11 (win32, 10.0.26200) ｜ 全程无远程主机、无 SSH、无任何私钥
> 台架源码：`docs/plans/timeline-camera-motion/experiments/`（`python .../run_all.py` 可一键复跑）
> 原始指标：本目录下 `env.json` / `m1-geometry.json` / `m2-visual.json` / `m3-performance.json` /
> `m4-export.json` / `m5-regression.json` / `m6-ux-audit.json`；逐条日志在 `logs/`；对比图在 `samples/`
> 本文件是**指标记录**；面向评审的完整报告 `report.md` 由节点 #4 产出。
>
> ⚠️ **节点 #4 复核后的增量**：本文件记录的是节点 #3 交付时的状态。终审又查出并修复了
> 4 个问题（FFmpeg 能力探测结果未被消费、导出侧缺少 scale/dolly 下限导致与预览分叉、
> `isRenderable` 从未接进生产、`camera_motion.py` 929 行超阈值），细节与证据见同目录
> `report.md` §4。其中「§3 本节点改动的文件」一节所说的「未提交」已在终审提交中一并落地。

## 0. 一句话结论

M1–M6 **六项全部达标**；执行过程中查出并就地修复了**两个真实缺陷**，其中一个（3D 运镜预览上下颠倒）
足以让全部 8 个 3D 预设的「所见即所得」承诺完全失效，且现有的 jsdom 单测体系**结构上不可能**发现它。

| 指标 | 阈值 | 实测 | 结论 |
|------|------|------|------|
| **M1** 几何一致性 | ≤ 0.5 画布像素，336 组 100% 通过 | 1344 个角点，最大偏差 **6.84e-7 px**（p95 5.93e-7） | ✅ |
| **M2** 视觉一致性 | 2D 平移 ≥0.97 / 2D 放大 ≥0.93 / 3D ≥0.90 | 80 格全部通过，**最低 0.9911**（3D dolly-in-3d），三档均值 0.9958–0.9966 | ✅ |
| **M3** 预览性能 | 均值 ≤12ms 且 targetFps 恒 60 且 rAF p95 ≤20ms | 均值 **0.88ms**（无运镜基线 0.37ms），targetFps 全程 60，rAF p95 **6.5ms** | ✅ |
| **M4** 导出鲁棒性 | 16/16 成功 + 降级必告警 + 带运镜禁回退 concat | **16/16**，四条护栏（L1 / L11 / tier-2 / tier-3）全绿 | ✅ |
| **M5** 回归安全 | 滤镜串逐字符相同 + 抽帧 SSIM=1.000 + 既有测试 | 5 种无运镜时间轴逐字符相同；5 帧 SSIM 全 **1.0**；既有失败逐提交归因后**无本特性引入项** | ✅ |
| **M6** 交互质量 | 键盘/Esc/焦点/reduced-motion/双语/无硬编码 | i18n `en` 与 `zh-CN` 各 **55 键**齐平且接口已声明；9 项无障碍可供性全部命中；0 处硬编码文案；`tsc --noEmit` 通过 | ✅ |

运行环境：`ffmpeg version 2025-05-15-git-12b853530a-full_build-www.gyan.dev`，能力探测落在
**降级阶梯第 1 档**（`perspective` + `eval=frame` + `filter_complex_script` 均可用），
即本次全部导出走的是逐帧精确路径，不是任何降级路径。预览侧真实 GPU：
`ANGLE (Intel, Intel(R) Arc(TM) Graphics, Direct3D11)`，WebGL 2.0，`PerspectiveQuadRenderer.acquire()` 成功。

---

## 1. 执行中发现并修复的缺陷

### 缺陷 A（P0）｜3D 运镜预览上下颠倒

**现象**：`space:'3d'` 的 8 个预设，在预览画布上整层垂直翻转；导出侧完全正确。
即预览与成片**互为镜像**——用户在编辑器里看到的和最终成片是两回事。

**根因**：`PerspectiveQuadRenderer` 翻了两次 Y。
`_writeGeometry()` 已经把画布坐标（y 向下）转成裁剪空间（y 向上）——这是流水线需要的**唯一**一次翻转；
而 `_draw()` 又在上传纹理时打开了 `UNPACK_FLIP_Y_WEBGL`，同时 `QUAD_UVS` 写的却是 y 向下的
`[0,0, 1,0, 1,1, 0,1]`（角序 [TL,TR,BR,BL]）。两者相乘即整层倒置。
源码里 `QUAD_UVS` 的旧注释写着「(V flipped on upload)」——作者**意图**是配合翻转，但常量写成了不配合的那一种。

**为什么既有测试抓不到**：本仓库前端测试跑在 jsdom，没有 WebGL、`drawImage` 是桩。
`cameraMotionCompositor.test.ts` 在文件头就诚实地写明「3D 分支只能负向验证」。
节点 #2 的 FFmpeg 实证校验覆盖的是**导出侧**（16 预设 × 3 帧 × 5 标记点 vs 单应矩阵），
预览侧的像素**从未被真实渲染过一次**。这不是谁疏忽，是测试基础设施的结构性盲区。

**修复**：`src/components/video/playback/PerspectiveQuadRenderer.ts` ——
`UNPACK_FLIP_Y_WEBGL` 显式置 `false`（不是删掉这行靠默认值，而是显式写死并注明原因，
否则下一个读者很容易「好心」把它改回来），并把 `QUAD_UVS` 的注释改写成两者必须同向的约定。

**防复发**：两道锁。
1. `src/components/video/playback/__tests__/PerspectiveQuadRenderer.upload.test.ts`（新增）——
   用记录型假 GL 上下文钉死「上传契约」：flip 必须为 false、UV 必须是 `[0,0,1,0,1,1,0,1]`。
   **已验证它能复现该 bug**：把 `false` 改回 `true`，该用例立刻变红；改回来即绿。
   该文件在头部明确声明它**不**断言 GL 渲染正确性——用 mock 伪造「渲染对了」正是计划 §4.2 禁止的假绿。
2. M2 的**方向哨兵**（`e4_m2_visual.py`）——每格除了和成片比，还要和**上下镜像的成片**比一次，
   要求正立分数至少高出 0.02。用修复前那一帧回测该哨兵：
   `upright = 0.4527` vs `mirrored = 0.9932` → **判定为翻转**（见 `m2-visual.json` 的
   `orientationSentinelValidation`，证据图 `samples/before-fix_preview_orbit-left_f0015.jpg`）。
   一个从没见过它要防的缺陷的检查，不值得信任；这条哨兵见过。

### 缺陷 B（P1）｜特性提交打破了一个既有测试的调用点

**现象**：`tests/test_filtergraph_builder.py::test_pre_trimmed_skips_trim_and_scale`
在 `6d0fa57` 报 `TypeError: build_filtergraph() got an unexpected keyword argument 'pre_trimmed'`，
在其父提交 `6d0fa57^` 是绿的。

**根因**：R-P1-2 把 `pre_trimmed` 收进了 `FiltergraphOptions`（为了不突破仓库 5 形参上限），
这是**破坏性的公开签名变更**，但仓库里还剩这一处旧调用点没有跟着改。
它被埋在既有的一堆失败里，不做逐提交归因就看不出来。

**修复**：更新该调用点为 `build_filtergraph(clips, 1920, 1080, FiltergraphOptions(pre_trimmed=True))`，
并注明签名迁移的原因。`tests/test_filtergraph_builder.py` 现 12/12 通过。
生产代码中已无 `pre_trimmed=` 关键字调用（已全仓核验）。

---

## 2. 各项指标怎么测的、测出了什么

### M1 — 几何一致性（`m1-geometry.json`）

- 预设端点**取自线上预设表**：`dump-preset-wire.mjs` 转译出货的 `cameraMotionPresets.ts` +
  `CameraMotionLayer.ts` + `videoComposition.ts`，调用生产的 `toCameraMotionWire(motionFromPreset(id))`，
  拿到导出请求里**逐字节相同**的 `camera_motion` 载荷。
- 该载荷经 `plan_from_spec` → `state_at` → `camera_homography` → `apply_homography_to_rect`
  跑 Python 内核，与冻结的黄金向量逐角点比对：**16 预设 × 21 采样 × 4 角 = 1344 次比较，最大 6.84e-7 px**，
  纯浮点尾差，比 0.5px 阈值低六个数量级。
- 补充说明一处**方法学改进**：仓库自带的 `test_camera_motion_geometry.py` 把预设端点在 Python 侧
  重新声明了一份（`PRESET_ENDPOINTS`）。那份副本正是「常量漂移」能藏身的地方，
  所以本台架绕开它、直接吃线上预设表。两条路径都跑了，都是绿的（vitest exit=0 / pytest exit=0）。

### M2 — 视觉一致性（`m2-visual.json`，样本图见 `samples/`）

- 预览帧：Electron（`desktop/node_modules/electron`，**不新增依赖**）里的**真实 Chromium**，
  跑的是出货的 `CanvasCompositor`；层对象的形状与 `assembleLayers` 产出的完全一致，
  时间→状态用生产的 `motionStateAt`。2D 走 `ctx.transform` 分支，3D 走 WebGL 透视四边形分支（已确认真实取到 GL 上下文，非降级影子）。
- 成片帧：`e2_m4_export.py` 渲染出的真片，按**精确帧号**抽帧（`perspective` 的首帧 `on = 1`，
  故帧号 n ↔ clip 本地时间 n/fps，与预览请求的时刻严格同一）。
- 两边统一降采样到 640×360 再算 SSIM——剥离「导出先归一化到画布再重采样」造成的锐度差（与几何无关）。
- 结果：80 格全部达标。三档最低值分别为 2D 平移 0.9961 / 2D 放大 0.9946 / 3D 0.9911，
  距各自阈值（0.97 / 0.93 / 0.90）都有很大余量；无一格低于 0.85 的硬地板。

### M3 — 预览性能（`m3-performance.json`）

- 场景按计划：1 个 3D + 2 个 2D 同屏，1920×1080 画布，连续 30s；另跑 10s 去掉运镜的同构基线。
- `lastDrawMs` 均值 **0.88ms**（基线 0.37ms，即运镜带来的增量约 0.51ms/帧），p95 1.3ms，
  远低于触发 60→30 自适应降级的 `ADAPTIVE_DEGRADE_DRAW_MS = 12`；`targetFps` 全程恒为 60。
- 两点如实说明：
  1. 首帧 `max = 50.3ms` 是 GL 上下文与纹理的一次性分配，之后再未出现（p95 1.3ms）。
  2. 本机显示器为高刷新率，rAF 实际约 156Hz（4682 帧 / 30s），所以每帧预算比 60Hz 更紧，
     0.88ms 的均值是在更严苛的节拍下取得的；`targetFps` 指的是合成器自身的自适应档位，不是显示器刷新率。
- 台架细节：隐藏窗口下 Chromium 会把 rAF 节流到约 1Hz（首次测得 33 帧/30s），
  性能场次改用**可见且置顶**的窗口，否则量到的是节流而不是合成器。

### M4 — 导出鲁棒性（`m4-export.json`）

- **不是**照抄导出命令，而是直接驱动线上 `VideoCompositionService._compose_videos_filtergraph`：
  真实的 `VideoCompositionRequest`、真实的能力探测、真实的编码进程。
- 16/16 成功，每条都是 180 帧 / 1920×1080 / 6.0s，5 个采样帧全部抽出。
- 四条护栏：
  - **L1**：带运镜时 `can_use_concat = False`，不带时仍为 `True`（捷径本身没被破坏）。
  - **L11**：强制 FFmpeg 返回非 0 后，观察到**恰好 2 次** filtergraph 尝试（原图 + 静态兜底重试）、
    **0 次** `_concat_videos` 调用、最终**抛出**结构化错误。即「导出成功但没有特效」这条最坏路径已被切断。
  - **tier-2**（无 `eval=frame`）：产出 `camera_motion_static:` 前缀的 warning，且静态取景仍能成功编码。
  - **tier-3**（无 `perspective`）：抛 `CameraMotionUnsupportedError`，错误文案含可执行的修复建议。
- L7 滤镜串长度：最长 `spiral` 4173 字符，低于 8192 内联阈值，更远低于 Windows `CreateProcess` 的约 32767 上限。

### M5 — 回归安全（`m5-regression.json`）

- **条件①**：从 git 取出 `6d0fa57^` 的 `filtergraph_builder.py`，在真实包命名空间里现场执行，
  与当前 builder 在 5 种无运镜时间轴上对比（单轨无转场 / 单轨带转场 / 单轨带透明度 / 双轨叠加 / 双轨转场+透明度）——
  `filter_complex`、`can_use_concat`、`output_label`、输入顺序**四项全部逐字符相同**。
  这比「和作者自己冻结的字面量比」强一档：比的是**真正的改动前代码**。
- **条件②**：两份滤镜串各渲染一次，抽 5 帧比对，SSIM 全为 **1.0**。
- **条件③**：既有测试套按提交归因——
  - 后端 composition 相关：工作树 17 失败，特性提交 18 失败，父提交 17 失败 →
    差集精确指出缺陷 B；修复后工作树失败集合与父提交**完全相同**，即本特性净引入 0 项。
    其余 17 项在父提交即已失败（cv2 桩、TTS 网络等环境因素），不属本特性。
  - 前端：1605 项（含本节点新增的 3 项上传契约用例）中 3 项失败、分布在 2 个文件。
    在 `6d0fa57^` 的 detached worktree 里重跑**同样的文件**，同样是 3 失败 →
    确认为既存失败。「既存」在这里是**测出来的**，不是推断出来的。
  - 另有 2 个后端测试文件在本机根本无法被收集（`test_content_polish_api.py` 的非 ASCII 字节字面量 SyntaxError、
    `test_tts_api.py` 调用 pytest 4 起已移除的 `pytest.config`），与本特性无关，已显式登记并排除，不是用 `-k` 悄悄滤掉。

### M6 — 交互质量（`m6-ux-audit.json`）

- i18n 用**加载模块**而非 grep 来核：`en` 与 `zh-CN` 的 `timeline.cameraMotion` 各 55 键、无缺无多，
  `Translations` 接口侧也已声明（R-P2-2 的三处齐改已落实）。
  （台架自身也踩过一次坑：本仓库中文 locale 注册名是 `zh-CN` 而非 `zh`，写死 `zh` 会让检查在空集合上「通过」。已修正为按模块实际 locale 列表逐个比对。）
- 面板 4 个 tsx 文件中 **0 处**硬编码用户可见文案。
- 9 项无障碍可供性全部命中：`role="radiogroup"` / `role="radio"` / `aria-checked` / Esc 关闭 /
  方向键导航 / 焦点管理 / `prefers-reduced-motion` / `aria-valuetext` / `role="dialog"`+`aria-modal`。
- 工具栏 `effects` 入口已点亮（不再 `comingSoon: true`）。
- 8 个新增文件全部在 800 行上限内；`tsc --noEmit` 通过。
- **未在此处覆盖**（如实登记，见 `notRunHere`）：axe 自动化审计（本仓库无该依赖，为一次实验引入依赖不划算）、
  真人键盘/读屏走查。两项都留在 Electron 桌面 walkthrough 清单里——那仍是本特性的验收门禁。

---

## 3. 本节点改动的文件

代码（修缺陷 + 防复发，**未提交**，按分工留给节点 #4 一并提交）：

| 文件 | 改动 |
|------|------|
| `src/components/video/playback/PerspectiveQuadRenderer.ts` | 缺陷 A 修复：`UNPACK_FLIP_Y_WEBGL` 显式 false + 角序/UV 同向约定的注释 |
| `src/components/video/playback/__tests__/PerspectiveQuadRenderer.upload.test.ts` | 新增：上传契约回归锁（已验证能复现缺陷 A） |
| `backend-services/basic-service/tests/test_filtergraph_builder.py` | 缺陷 B 修复：迁移到 `FiltergraphOptions` |

台架与结果（新增）：`docs/plans/timeline-camera-motion/experiments/**`、
`docs/plans/timeline-camera-motion/results/**`。

> `env.json` 记录的 `git.head` 是 `6d0fa57`；上述三处代码改动在本记录写就时尚未提交，
> 所有指标均在**含这些改动**的工作树上测得（M5 的逐提交归因除外，它按设计在干净的 detached worktree 里跑）。

## 4. 遗留与风险

1. **桌面 walkthrough 仍是必须的门禁**（计划 §2.5 / L5）。本节点用的是 `desktop/node_modules` 里的 Electron 与
   本机 FFmpeg；打包端内置的 FFmpeg 版本可能不同，能力探测虽是运行时行为，但仍需在打包端记录一次
   `ffmpeg -version` 并实走「加运镜 → 预览 → 导出 → 播放成片」。
2. **M2 用的是合成图案 + 单轨**。双轨叠加下的透明 backdrop 行为（R-P0-3）本节点只验到了滤镜串层面（M4 tier 检查），
   未做双轨逐像素比对——原因是计划 §2.3 D3 要求叠加轨素材必须与画布同比例以绕开 L13 既有缺陷，
   构造该夹具的收益低于它引入的解释成本。建议节点 #4 在 walkthrough 里人工确认一次双轨 3D 露底。
3. **后端既有 17 项 composition 失败**（父提交即存在）未修，不在本特性范围；但它们会持续遮蔽新回归，
   建议单独立项清理——缺陷 B 正是被它们遮住的。
4. **`e5` 会创建并删除临时 git worktree**。若被中断，可用 `git worktree list` / `git worktree remove --force` 清理；
   它从不触碰当前工作树（本分支尚有 remove-user-system 的在途改动）。
