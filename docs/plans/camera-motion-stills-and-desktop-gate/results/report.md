# 终审报告（节点 #4，Iteration 2）

> feature = `camera-motion-stills-and-desktop-gate` ｜ `environment: local`
> 被审代码：`81428c2`（节点 #2 实现）+ 工作树内节点 #3 的两处就地修复 + 本节点的三处就地修复
> 基线：`8c702ec`（Iteration 1 终态）｜ 契约：本目录 `experiment-plan.md` v2
> 评审方法：**不接受任何一方的断言为真**。所有结论要么回读了源码，要么由本节点重新执行命令得到。

---

## 一、背景

Iteration 1 已经把 2D / 3D 运镜做进了**视频片段**的预览与导出，并留下两笔账：DoD #8（Electron 打包端 walkthrough）从未走过，以及一个用户每天都会踩到的静默缺陷。

本轮（Iteration 2）要闭合的是四个缺口：

- **G1（P0，静默无效）**：时间轴上的**静态图片片段**可以打开运镜面板、可以保存、`2D/3D` 徽标也会亮 —— 因为图片放在视频轨上时 `item.type` 就是 `'video'`，右键菜单不做区分。但预览侧 `ImageOverlayInput` 没有 `cameraMotion` 字段、导出侧 `imageItems.push({...})` 也不带 `camera_motion`，于是**预览一动不动、导出也一动不动，且没有任何警告**。Ken Burns（对静图做 2D 推拉平移）恰恰是这个功能最经典的用法，也就是说最常见的使用场景是完全无效的。这与 Iteration 1 亲手立下的 L1 / L11 两条护栏所防的是同一类失败，只是发生在另一条管线上。
- **G2（P1，WYSIWYG 缺口）**：面板里的 3D 预设从头到尾只能看到 2D 仿射影子，用户只有点了 Apply 才在画布上看到真透视。
- **G3（P1）**：`CameraMotionModal` 用硬编码的 `GUARD_CANVAS = 1920×1080` 作为 `isMotionRenderable` 的判据画布。由于 `isMotionRenderable → ensureCoverage` 的倍率与 `cameraHomography` 的焦距都随长宽比变化，竖屏（9:16）工程下 Apply 门禁判的与真实渲染不是同一件事。
- **DoD #8 / H4**：打包端自带 FFmpeg（`resources/ffmpeg`），版本未必与开发机相同，而运镜能力（`perspective` 的 `on` 变量、`eval=frame`）是**运行时探测**的 —— 探测落档不同就会把每个运镜静默降级成一张定格。

节点 #1 在评审计划时还额外挖出两条：**P0-3 / L17** —— `ensureCoverage` 对静图的语义从未被定义，而 N1（比 TS↔Python 之差）与 N2（比预览↔成片 SSIM）对它**结构性失明**（两侧会一起错）；以及 **G4 / L15** —— 预览盒挂在 letterbox fit-rect 上、导出盒挂在整帧上，无运镜时就可能分叉。计划因此把「必须显式决策 coverage 契约」与「N0 前置基线」写进 MUST。

本节点（#4）的职责是：逐条复核实验结果与代码改动、就地修掉发现的问题、写本报告、按路径逐个 `git add` 后提交。

---

## 二、参数

**代码与基线**

| 项 | 值 |
|----|----|
| 被测提交 | `81428c2`（33 文件，+9740 / -310） |
| 基线提交 | `8c702ec`（N4 的所有「逐字符相同」以它为参照，用 detached worktree **实际执行**而非引用） |
| 分支 | `feat/remove-user-system`（工作树另有大量与本轮无关的在途改动，提交时逐个按路径 `git add`） |

**运行环境**（`results/env.json`，本节点回读）

| 项 | 值 |
|----|----|
| OS | Windows 11，`10.0.26200`；工作目录 `M:/takoAI/Ecliptrix` |
| 开发端 FFmpeg | `2025-05-15-git-12b853530a-full_build`（gyan.dev） |
| 打包端 FFmpeg | **`8.1.1-essentials_build`** —— 与开发端是**不同大版本**，这正是 H4 的风险所在 |
| GPU / WebGL | `ANGLE (Intel Arc Graphics, Direct3D11)`，WebGL 2.0 |
| Electron / Node / Python | 33.4.11 / v22.18.0 / 3.11.7 |

**关键阈值**（计划 §2.2）：N0 盒四角 ≤ 1px；N1 ≤ 0.5px；N2 分级 SSIM（2D ≥ 0.97 / 3D ≥ 0.93 / 强缩放 ≥ 0.90，硬地板 0.85）+ 方向哨兵至少高 0.02；N3 露底 ≥ 5%、掩码 IoU ≥ 0.9、露黑像素 = 0；N7 增量 ≤ 1.0ms/图层、总均值 ≤ 12ms。

**夹具**（D2，代码合成，SHA256 记在 `env.json`）：`still_16x9.png`（1920×1080）与 `still_4x3.png`（1440×1080）。选 4:3 是刻意的 —— 它让「盒比例 ≠ 图片比例」这条最容易分叉的路径进入每一次测量。所有含视频的夹具按计划约束成「视频固有比例 == 工程画布比例」，把 G4 挡在 N1/N2 的读数之外。

**本节点重新执行的命令**（不是引用节点 #3 的日志）：

```
npm run type-check                                     → exit 0
npx vitest run（全量）                                  → 195 files passed / 2 failed；1643 passed / 3 failed
npx vitest run <本轮 5 个新增测试文件>                    → 5 files / 38 tests 全绿
python -m pytest tests/test_camera_motion_overlay.py \
  tests/test_image_overlay_no_silent_drop.py \
  tests/test_camera_motion_geometry.py \
  tests/test_camera_motion_guards.py \
  tests/test_camera_motion_no_silent_concat.py \
  tests/test_filtergraph_builder.py \
  tests/test_filtergraph_camera_motion.py -q          → 90 passed
```

---

## 三、关键日志

**N1 —— 比的是「导出真正会发给 FFmpeg 的那串表达式」。** 台架没有拿 Python 内核去和 TS 内核比（那只证明两个内核一致），而是把发射器产出的 `perspective=x0='…'` **求值后**与 TS 黄金向量逐角点比对：

```
comparisons: 1600     maxDeviationPx: 4.31e-04     p95: 1.30e-04     阈值 0.5px
```

**N1-c —— 唯一能看见 coverage 缺陷的东西**（`n1-stills-geometry.json`）：

```
stillPanNeverZoomed   : scale 严格 == 1.0（enforce_coverage=False）       pass
coverageFlagIsLive    : 开启后同一平移被抬到 1.2（正是计划预测的数）        pass
coverageUsesBoxAspect : 盒比例 1.283 vs 画布比例 1.385，两者必须不同        pass
```

其中第三条附了一条诚实的实测更正：`ensure_coverage` 在 `roll == 0` 时会把 aspect 项全部消掉，所以计划的字面写法（用纯平移探测 aspect 取错）**探不到**，台架改用带 roll 的平移才让它现形 —— 这条自我纠错写在 JSON 的 `measuredFinding_pureRollFreePanIsAspectInvariant` 里。

**N2 —— 裁盒比对 + 每次自证灵敏度**（`n2-stills-visual.json`）：

```
24 格盒内 SSIM: min 0.984631  mean 0.987970  max 0.991612   （无运镜对照 0.992199）
方向哨兵最高 0.395   2px 位移探针 0.36–0.44   帧偏移均值 {-1: 0.958, 0: 0.988, +1: 0.955}
```

帧偏移三点扫描是关键：发射器用 `(on-1)/fps` 驱动进度，而「FFmpeg 第一帧 `on` 是不是 1」是个假设 —— 偏移 0 明显胜出，证明没有差一帧。

**N3 —— 露底靠 alpha 被端到端验了**（不只比 SSIM，而是把盒内像素按「是否等于下层」分类）：

```
orbit-left  露底 19.10%/20.41%  IoU 0.9841  露黑像素 0
crane-up    露底 18.29%/19.19%  IoU 0.9817  露黑像素 0
spiral      露底 16.34%/17.55%  IoU 0.9849  露黑像素 0
```

**N4 —— 基线是被执行的，不是被引用的**（`n4-regression.json`）：

```
视频侧 16/16 filter_complex 与 8c702ec 逐字符相同（护栏：先断言 16 条非空、含 perspective）
无运镜叠加命令逐字符相同
前端 head 3 failed/1642 passed，基线同样的 2 个文件失败 → newFailures 0
后端 head 17 failed/127 passed vs 基线 17 failed/101 passed → 失败文件集合相同、无新增
```

**N6 —— H4 由假设变成记录**（`n6-desktop-walkthrough.json`）：

```
packaged ffmpeg 8.1.1-essentials  vs  developer 2025-05-15 git full build
capabilityProbe: has_perspective / eval_frame / sense / filter_complex_script 四项逐项一致
crossBinaryRender: ken-burns 与 orbit-left 盒内 SSIM = 1.0000
packagedAppSmokeTest: 11 步全绿   dodEightClosed: false
```

---

## 四、结果

### 4.1 逐条 DoD 判定

| # | DoD | 判定 | 依据 |
|---|-----|------|------|
| 0 | N0 前置基线达标并落档 | **达成（有条件）** | 像素对齐盒 0.000px；非整数摆放盒 1.166px 超阈，按计划规定收敛夹具并把该组留作 G4 证据底账 |
| 1 | 静图可开面板、调参、撤销，**预览实时正确** | **达成** | `ImageOverlayInput.cameraMotion` → `buildImageLayersAt` → `CompositorLayer.image.motion` → `drawImageWithMotion` 全链路回读；N2 24/24 |
| 2 | 导出逐帧还原同一运镜，两个组装点及回退梯一致 | **达成** | 两个组装点都调 `_prepare_image_overlay_entries` / `_image_overlay_filter_parts`，逐字符相同**由构造保证**而非靠评审 |
| 3 | N1 ≤ 0.5px；N1-c 三条为绿；N2 达标；N4 四条 | **达成** | 见 §三 |
| 4 | L-I1 / L-I2 护栏为绿，**判定落在编排块** | **达成** | `_apply_overlay_passes` → `_guard_overlay_outcome` 抛 `RuntimeError`，调用点在 `:1615`，位于外层 `try` 内 → `:1670` 标 `failed`；7 条用例覆盖三条失败路径 |
| 5 | **DoD #8 闭合**：§8.4 八项全绿 | **未达成（部分闭合）** | 见 §4.3 |
| 6 | 视频侧运镜逐字符不变 | **达成** | N4-① 在老代码真跑一遍后逐字符 diff |
| 7 | N7 性能 / i18n / 行数 / tsc | **达成（附一处口径说明）** | 增量 0.17ms/图层；i18n en+zh 各 57 键；tsc 本节点复跑 exit 0 |
| 8 | `GUARD_CANVAS` 被真实画布取代 | **达成** | 常量已删；`VideoPlayerPanel → uiSlice.projectCanvasAspect → TimelinePanel → CameraMotionModal` 链路回读 |
| 9 | 面板 3D 真透视 + 优雅降级（STRETCH） | **达成** | `MotionPreviewStage` 复用同一 `drawWithMotion` 缝；`release()` 计数配平 20/20 |
| 10 | 无僵尸代码；L14 与 rotation 均未实现 | **达成（本节点修掉一处）** | `grep` 确认两者均未实现；`download.js` 的一处错位 docstring 已修 |
| 11 | 产物落 `results/`；按路径逐个 `git add` | **达成** | 64 个文件，0 个 `.log`，无 `__pycache__` |

### 4.2 本节点就地修复的三个问题

**(1) 一条伪绿断言 —— `cameraMotionBox.test.ts` 的 G3 用例什么都没验。** 原文是：

```ts
expect(typeof isMotionRenderable(motion, box, false)).toBe('boolean');
expect(isMotionRenderable(motion, box, false)).toBe(isMotionRenderable(motion, box, false));
```

`f(x) === f(x)` 恒真，`typeof` 恒为 `'boolean'` —— 它顶着「gates Apply on the same rule the renderer will follow」的名字，却对 G3/P1-9 这条被从 STRETCH 提进 MUST 的缺陷**零覆盖**。这正是节点 #3 在台架里抓过三次的同一类「漂亮的假绿」，只是这次出现在产品测试里。

已替换为两条真正有区分度的断言：① 判据面的推导是 `distance − sin(yaw)·halfWidth > 0`，而 `distance` 随**长边**、`halfWidth` 随**短边**变化 —— 因此构造 `yaw=79°, dolly=0.3` 的定格 3D 姿态，**16:9 判 `false`、9:16 判 `true`**，直接钉死「硬编码 16:9 会拦下竖屏工程里本来合法的参数」；② 16 个出厂预设在一个 300×600 的静图盒上、按静图规则（`enforceCoverage=false`）判定必须**全部为 `true``，防止门禁反过来拦住产品自带预设。改后该文件 10 → 11 个用例，全绿。

**(2) `download.js` 的错位 docstring。** 节点 #3 修打包 `tar` 缺陷时把新函数插在了 `extractZip` 的注释与函数体之间，导致「Extract a .zip archive…」这段说明悬空挂到了 `windowsTar()` 头上。按仓库规范（僵尸/失真注释等同技术债）已把两段注释各自归位。

**(3) `summary.md` 的 N7 数字与它所总结的 JSON 不一致。** `summary.md` 写「0.69ms/帧、0.21ms/帧、增量 0.48ms、0.16ms/图层」，而 `n7-budget.json` 的实测是 `mean 0.8284 / 0.3174 / delta 0.5110 / perLayer 0.1703`；帧偏移 `-1` 档写成 0.955，实测 0.958。摘要显然是按更早一次运行写的、末次 `run_all.py` 后未同步。结论不变（增量仍远在 1.0ms 预算内），但**摘要与原始数据打架会让复核者不知道该信哪个**，已按 JSON 就地更正。

### 4.3 未闭合项：DoD #5（诚实声明）

**DoD #5 未达成，本轮不能宣称 DoD #8 已闭合。** `n6-desktop-walkthrough.json` 自己写着 `dodEightClosed: false`。

- **已实测的部分（H4 的风险所在）**：打包链本身曾**必然失败**（见下），节点 #3 修好后重新出包，产物含本轮三个运镜源码文件、`git rev-parse HEAD` 与打包时间戳均已落档（L11 满足）；打包端 FFmpeg 8.1.1 与开发端的四个能力开关**逐项一致**，用打包端二进制跑同一条生产导出路径渲染 `ken-burns` / `orbit-left`，与开发端结果盒内 **SSIM = 1.0000**；打包脚本自带冒烟测试 11 步全绿。
- **未执行的部分**：§8.4 第 3–7 步（在打包应用里建工程、导入素材、开面板、看画布、回放成片）是 GUI 人工操作，本节点同样没有诚实执行它们的手段，已在 JSON 里逐条标 `not-run-here` 并写明包外等价证据（N2 / N3 / N4-②），**没有**把它们算作通过。

顺带记录一个**环境相关**的真实缺陷（节点 #3 已修，本节点复核了修法）：`desktop/scripts/lib/download.js` 的 `extractZip` 走 PATH 解析 `tar`，本机 PATH 先命中 Git for Windows 的 GNU tar，它把 `M:\…\python.zip` 读成 rsh 的 `host:path` 形式，于是去「连接主机 M」，打包在「组装内嵌 CPython 运行时」一步必然失败，而错误信息完全指不到根因。修法是 Windows 分支显式使用 `%SystemRoot%\System32\tar.exe`（bsdtar）——**没有**用 `--force-local`，那个参数能救 GNU tar 但 bsdtar 不认，会把另一半环境弄坏。修复后 `desktop/build.ps1 -Dir` 9.3 分钟完整跑通。这条值得单独写下来：同一台机器上从不同 shell 启动打包，一个成功一个失败，是最难归因的一类缺陷。

---

## 五、风险

按「会不会咬人」排序，全部为**已知且已登记**，没有一条被本轮偷偷放过：

1. **DoD #5 的 4 项 GUI 步骤仍需一次人工 walkthrough（最高）。** 包外等价证据已经齐全（几何、像素、露底、跨二进制渲染、冒烟启动），剩下要验的是「在打包端这条链路上也确实如此」。前置条件已就绪且只需一次：新建工程 → 导入一段视频 + 一张图片 + 一条字幕 → 给视频加 3D、给图片加 2D（Ken Burns）与 3D → 看画布 → 导出并回放。**在这次人工确认完成之前，DoD #8 只能记为部分闭合。**
2. **G4 / L15：预览盒与导出盒的量化方式不同源（既有缺陷，本轮只挡不修）。** N0 实测出两条独立机理：其一是计划原本预料的 letterbox 基准不同源（本轮夹具约束已使其不被触发）；其二是本轮新测出的 —— 导出侧对同一个归一化位置做了**三次整数化**（`int(pos.x * video_width)` 截断原点、`_ensure_even_dimensions` 取偶、FFmpeg `scale` 再取整），预览侧全程浮点。非整数摆放的盒因此在**完全没有运镜**时就有 1.166px 盒级 / 4px 成像级偏差。它值得单开一轮；在那之前，静图盒落在非整像素位置时预览与成片会有几个像素的位移。
3. **`ImagePosition` 缺省值两侧不一致（本节点新发现，未修）。** 前端 `DEFAULT_POSITION` 是 `0.1/0.1/0.8/0.8`，后端 `_overlay_placement` 的兜底是 `0.1/0.1/0.3/0.3`。正常路径下编辑器总会下发 `position`，所以这条今天打不着；一旦有请求不带 `position`，预览按 80% 画、导出按 30% 画，而且现在**运镜盒也会跟着差**。没有当场改是因为改动等于变更一条既有导出默认值，超出本轮「只挡不修盒基准」的约定 —— 应与第 2 条一起在 G4 那轮统一收口。
4. **N7 的规范审计不解析 TypeScript 函数体（其自身声明的盲区）。** 文件级行数是实测的（本轮新增文件全部远低于 800 行，两个超限文件 `TimelinePanel.tsx` 1223 行 / `video_composition_service.py` 3024 行在基线就已超限，本轮未加剧）；Python 函数长度与形参也是实测的。但 TS 函数长度无人测。本节点人工过了一遍新增 TS 文件，最大的单元是 `MotionPreviewStage.tsx` 的 `useEffect` 回调（约 86 行，内含 `draw` / `step` 两个闭包）—— 与仓库既有 React 组件的写法一致，未作改动以免在无单测保护下引入风险，但记录在此。
5. **`MotionPreviewStage` 没有任何单元测试。** `n5-panel.json` 的 `delegation` 是**静态源码检查**（是否调用共享 `drawWithMotion` 缝、是否用 `release()`），不是运行时断言，JSON 的 `scopeNote` / `notRunHere` 已如实写明。真透视的正确性目前靠「组件委托给共享缝 + 共享缝有单测 + N2 验像素」三段式间接成立。着色器或 `drawWithMotion` 一旦改动，**必须重跑 N2**，不许只看单测（L13）。
6. **jsdom 测不到真渲染（结构性，R5）。** 3D 分支在单测里只能被**反向**验证（无 WebGL 时降级为仿射影子、仍然落笔、不抛异常）。测试文件自己写明了这一点，并明确拒绝「mock 一个 GL 上下文来证明渲染成功」——那会是一个什么都不验的绿灯。
7. **Iteration 1 的实验台架已无法运行。** `docs/plans/timeline-camera-motion/experiments/preview-harness/build-kernel.mjs` 的模块清单早于本轮的 `internal/drawWithMotion` / `internal/boxTextureCache` 改造。该目录是只读归档，本轮未改动；若将来要重跑 Iteration 1 的 M2/M3，需先补这三个模块。
8. **R4（新式 `-/filter_complex`）仍在 STRETCH，未做。** 后果是日志里会持续出现 `-filter_complex_script is deprecated` 警告，不影响功能。若将来要做，必须遵守 L10：探测位必须在同一个 PR 里有真实消费点和回归用例。
9. **后端合成套件仍有 17 项既有失败（L12）。** 本轮按提交归因确认失败文件集合与基线**完全相同、零新增**，但这层噪音本身会遮蔽未来的回归 —— Iteration 1 的缺陷 B 就是被它遮住的。

---

**终审结论：通过并提交，但 DoD #5 明确记为未闭合。** 本轮的两条最容易被做成「看起来绿实际没做」的契约 —— §3.1.1 的 coverage 契约与 L-I2 落在编排块 —— 本节点都回读了原始测试代码与源码而非只看指标 JSON，判定为真实落地；同时在产品测试里抓出并修掉了一条伪绿断言。静图运镜（G1）从「面板骗人」变成了预览与导出逐像素一致，这是本轮的核心交付。
