# 实验执行小结（节点 #3，Iteration 2）

> feature = `camera-motion-stills-and-desktop-gate` ｜ `environment: local`
> 被测提交：`81428c2`（节点 #2 实现）｜ 基线：`8c702ec`（Iteration 1 终态）
> 全部在本机执行，**不涉及远程主机、SSH 或任何私钥**；`results/` 下无任何凭据材料。
> 台架说明见 `../experiments/README.md`；每个指标的原始数字在同目录的 `*.json`，日志在 `logs/`。

---

## 1. 结论速览

| 指标 | 判定 | 关键数字 |
|------|------|----------|
| **N0** 无运镜盒基线（闸门） | **PASS** | 像素对齐盒四角偏差 **0.000px**（阈值 1px）；另测出一条与运镜无关的既有量化分叉，见 §3.1 |
| **N1** 静图几何一致性 | **PASS** | **1600** 个角点，最大偏差 **4.31e-4 px**，p95 **1.30e-4 px**（阈值 0.5px）；N1-c 三条绝对值断言全绿 |
| **N2** 预览 / 成片视觉一致性 | **PASS** | **24/24** 格，盒内 SSIM **0.9846–0.9916**（无运镜对照 0.9922）；方向哨兵最高仅 0.395；2px 位移探针最高 0.436 |
| **N3** 双轨 3D 露底逐像素 | **PASS** | 露底占盒 **16.3%–20.4%**，两侧掩码 IoU **0.982–0.985**，露出黑色像素 **0** |
| **N4** 零回归 | **PASS** | 16/16 视频侧滤镜串与 `8c702ec` **逐字符相同**（老代码真的跑了一遍）；无运镜叠加命令逐字符相同；前端 1642 通过 / 3 既有失败，失败文件集合与基线**逐条相同**；后端合成子集 HEAD 17 failed/127 passed vs 基线 17 failed/101 passed，**失败文件集合相同、无新增**（多出的 26 项通过是本轮新增用例） |
| **N5** 面板真透视 | **PASS** | 委托关系 5/5；降级 `role="status"` 且其 i18n 键齐全；真 WebGL 下 20 次开合 `acquire=release=20` |
| **N6** 桌面门禁 | **部分闭合** | 已用修好的打包链重新出包（含本轮全部运镜源码，冒烟测试 PASS）；打包端 FFmpeg **8.1.1** 与开发端 **7.x** 渲染同一运镜 **SSIM = 1.0000**，能力探测四个开关逐项一致；§8.4 的 4 项 GUI 步骤**未执行**，见 §4 |
| **N7** 性能与规范 | **PASS** | 静图运镜增量 **0.17 ms/图层**（预算 1.0）、总均值 0.83ms（阈值 12）、`targetFps` 全程 60；i18n en/zh-CN 各 57 键齐平；`tsc --noEmit` 通过 |

**H1–H3 成立并有实测支撑；H4 由假设变成了记录**（打包端 FFmpeg 是不同大版本，实测行为一致）。

---

## 2. 每个指标最值得看的一点

**N1 —— 比的是"导出真正会发给 FFmpeg 的那串表达式"。** 台架没有拿 Python 内核去和 TS 内核比（那只
证明两个内核一致），而是把发射器产出的 `perspective=x0='…'` 求值后与 TS 黄金向量逐角点比对。常数折叠
错、寄存器提升错、光栅角序换位错，都会在这里现形，而在内核对内核的比较里不会。

**N1-c 是唯一能看见 coverage 缺陷的东西**，三条断言全绿：静图纯平移在 `enforce_coverage=False` 下
`scale` 严格等于 1；开关本身是活的（开启后同一平移被抬到 1.2，正是计划预测的数）；开启时倍率取**盒**
长宽比而非画布长宽比。

**N2 —— 裁盒比对 + 每次自证灵敏度。** 盒 A 只占画布 9%，整帧 SSIM 会把误差稀释到看不见，因此比对裁到盒内；
而裁盒后为压掉两侧重采样差异做了 2× 降采样，所以每一格都额外跑一个"只把候选侧裁窗位移 2px"的探针，
实测 SSIM 从 0.99 掉到 **0.36–0.44** —— 证明当前尺度仍然抓得住 2px 错位，不是靠模糊蒙混过关。

**帧对齐是被测出来的，不是假设的。** 发射器用 `(on-1)/fps` 驱动进度，而"FFmpeg 第一帧 `on` 是不是 1"
是个假设。24 格 × 偏移 {-1,0,+1} 的均值为 **0.958 / 0.988 / 0.955**，偏移 0 明显胜出 —— 没有差一帧。

**N3 —— 露底靠 alpha 这件事被端到端验了。** 不只比 SSIM，而是把盒内像素按"是否等于下层"分类，
两侧掩码 IoU 0.98 且**露出的黑色像素为 0**。这是 SSIM 结构上看不见的性质。

**N4 —— 基线是被执行的，不是被引用的。** 同一个 driver 文件分别在 HEAD 和 `8c702ec` 的 detached
worktree 里跑，再 diff 两份 JSON。`motionStateAt` / `state_at` 本轮都长了一个参数、
`camera_motion_filters` 也被改过，"默认值保证逐位不变"是一句需要运行才能相信的话 —— 现在它被运行过了。

**N7 —— 报的是增量。** 三张静图带运镜 30s 连续合成 0.828ms/帧，同一场景去掉运镜 0.317ms/帧，
增量 0.511ms 摊到 3 个图层 = **0.17ms/图层**。绝对值离开机器就没有意义，增量才有。

---

## 3. 执行中发现的问题

### 3.1 既有分叉：非整数摆放的盒，两侧量化方式不同（不是本轮引入，本轮不修）

N0 用三个盒测，其中两个归一化位置落在整像素上（0.1×1920=192 等），两侧**逐像素完全一致（0.000px）**；
第三个刻意不落在整像素（0.28×1920=537.6），实测：

- **盒**四角偏差 **1.166px**（超过 N0 的 1px 阈值）
- **成像** bbox 偏差最大 **4px**

原因是导出侧对同一个归一化位置做了三次整数化，而预览侧全程用浮点：`int(pos.x * video_width)` 截断原点、
`_ensure_even_dimensions` 把盒尺寸取偶、FFmpeg `scale` 再把 contain 后的尺寸取整。**这与运镜无关**——
测量时根本没有加运镜。它与计划 §1.3 的 G4（letterbox 基准不同源）同属一类但机理不同：本轮夹具已按计划
约束成"视频固有比例 == 工程画布比例"，所以 letterbox 那条路径没有被触发，这条是另一条。

**处理方式**：按计划 §2.2 N0 对不达标情形的规定，把下游 N1/N2/N3 的夹具收敛到像素对齐的盒（那里两侧
实测 0.000px，运镜偏差因此可归因），并把不达标的那组原样留在
`n0-box-baseline.json` 的 `evidenceOnlyCaseIds` 里作为 G4/L15 的证据底账。**本轮不扩大战线去修。**

### 3.2 已就地修复：`build_overlay_motion_filter` 107 行，超过仓库 50 行阈值

N7 的规范审计在**本轮新增文件**里查出一处：`app/services/composition/camera_motion_overlay.py` 的
`build_overlay_motion_filter` 长 107 行。已拆为 `_motion_fields`（动画/冻结两条路的字段解析）+
`_perspective_options`（几何与四角发射），主函数降到 ~20 行。

**风险控制**：拆分必须一个字节都不改变发射结果。已用 `git show 81428c2:` 取出提交版本在同一命名空间里
执行，与当前实现在 **16 预设 × 4 种盒 × animated/static = 128 组**上比对 `filter_text` /
`input_options` / `warnings`，**128/128 完全相同**（`node3-refactor-byte-identity.json`），
后端 26 项定向用例仍全绿。

### 3.3 已就地修复：桌面打包在本机必然失败（`tar` 把盘符当远程主机）

计划 §2.5 要求 N6 之前必须重新打包（L11：不能拿过期打包做 walkthrough）。首次执行
`desktop/build.ps1 -Dir` 在"组装内嵌 CPython 运行时"一步失败：

```
tar: Cannot connect to M: resolve failed
[build] FAILED: Failed to extract M:\takoAI\Ecliptrix\desktop\cache\python-3.11.9-embed-amd64.zip (exit 128)
```

`desktop/scripts/lib/download.js` 的 `extractZip` 直接 `spawnSync('tar', …)`，走 PATH 解析。本机
PATH 上先命中的是 Git for Windows 的 **GNU tar**，它把 `M:\…\python.zip` 解析成 rsh 的 `host:path`
形式，于是去"连接主机 M"。Windows 自带的 bsdtar（`System32\tar.exe`）不存在这个问题。

**修复**：Windows 分支改为显式使用 `%SystemRoot%\System32\tar.exe`（存在时），否则回落裸 `tar`。
没有用 `--force-local` —— 那个参数能救 GNU tar 但 bsdtar 不认，会把另一半环境弄坏。

**修复后实测**：`desktop/build.ps1 -Dir` 完整跑通，耗时 **9.3 分钟**，产出
`desktop/release/win-unpacked/`（2026-08-05T04:29:32），其
`resources/backend/app/services/composition/` 下 `camera_motion.py` /
`camera_motion_filters.py` / `camera_motion_overlay.py` **三个文件齐备**（L11 前置由此满足）；
打包脚本自带的冒烟测试 **PASS**（前后端服务健康、主窗口加载、无残留进程）。

> 这是一个**环境相关**的缺陷：同一台机器上，从不同 shell 启动打包，一个成功一个失败，而错误信息完全
> 指不到根因。它直接卡住了计划里 N6 的前置条件，所以在本节点范围内。

### 3.4 顺带记录（未修）：Iteration 1 的实验台架已无法运行

`docs/plans/timeline-camera-motion/experiments/preview-harness/build-kernel.mjs` 的模块清单早于本轮的
`internal/drawWithMotion` / `internal/boxTextureCache` / `ImageOverlayLayer` 改造，现在
`require('CanvasCompositor.js')` 会直接失败。该目录是只读归档，本轮**未改动**它；本轮另起了一份台架。
若将来需要重跑 Iteration 1 的 M2/M3，需要先补这三个模块。

---

## 4. N6 的边界：什么被测了，什么没有

**被实测的（H4 的风险所在）**：打包端自带的 FFmpeg 是 **8.1.1-essentials**，开发端是
**2025-05-15 git full build**，是不同大版本。运镜完全依赖 `perspective` 的 `on` 变量与 `eval=frame`，
而代码是**运行时探测**这项能力的——探测落档不同就会把每个运镜降级成一张定格。实测：

- 生产 `ffmpeg_caps.probe()` 在两个二进制上的四个能力开关**逐项一致**（仅 `version` 字符串不同）；
- 用**打包端二进制**跑同一条生产导出路径渲染 `ken-burns`（2D）与 `orbit-left`（3D），与开发端渲染
  结果盒内 SSIM **1.0000**。

**未执行的**：§8.4 清单第 3–6 步（在打包应用里建工程、导入素材、开面板、看画布）与第 7 步的"在打包端
播放器里回放确认"。这些是 GUI 中的人工操作，本节点没有诚实执行它们的手段，因此在
`n6-desktop-walkthrough.json` 里逐条标为 `not-run-here` 并写明每一步在包外的替代证据（N2 / N3 / N4-②），
**没有**把它们算作通过。`dodEightClosed: false`。

**前置条件已就绪**：仓库里原有的 `desktop/release/win-unpacked/` 打包于 2026-06-30，早于 `6d0fa57`，
其 `resources/backend/app/services/composition/` 里连 `camera_motion.py` 都没有——拿它做 walkthrough
验的是完全没有运镜功能的旧代码（L11）。本节点修掉 §3.3 的打包缺陷并重新打包，产出 2026-08-05 的新包，
三个运镜源码文件齐备，且**打包端应用能真的启动**（N6 会重跑一次 `desktop/scripts/smoke-test.js`：
前后端服务健康、主窗口加载、干净退出）。人工 walkthrough 由此具备可执行前提。打包产物的时间戳、HEAD、
"是否含本轮后端源码"与冒烟测试逐步输出都记录在 `n6-desktop-walkthrough.json`。

**留给人工的，就是 §8.4 的第 3–7 步**，且只需要一次：新建工程 → 导入一段视频 + 一张图片 + 一条字幕 →
给视频加 3D 预设、给图片加 2D（Ken Burns）与 3D 预设 → 看画布 → 导出并回放。包外的等价证据已经齐全，
这一步验的是"在打包端这条链路上也确实如此"。

---

## 5. 测量方法上的三处自我纠错（留给复核者）

三处都是台架自己的问题，不是产品问题，但如果不写下来，读者会误以为对应的结论更强：

1. **2px 位移探针一开始是空的。** 最初的实现把裁窗在**两张图上同时**位移，那只是换个位置看同一件事，
   SSIM 自然不变（实测 0.9917 vs 0.9916）。改成只位移候选侧后，探针才真的有区分度（掉到 0.36–0.44）。
2. **pytest 子集一开始什么都没跑。** 两个后端测试文件在本机无法被 collect，留着会让整个 session 在
   收集阶段中止，输出 `945 deselected, 2 errors` —— 而按 `FAILED ` 前缀统计失败文件的代码把它读成了
   "0 个失败"，一个完全虚假的绿。现已显式 `--ignore` 这两个文件，并在比较前断言真的收集到了用例
   （现在 HEAD 17 failed/127 passed，基线 17 failed/101 passed，失败文件集合相同、无新增）。
   同类护栏也补给了 N4-①：两个空字符串比较起来永远相等，所以现在会先断言 16 条视频侧滤镜串非空
   （实测 1074–4271 字符、含 `perspective`），否则直接报错而不是给出一个漂亮的假绿。
3. **打包端冒烟测试第一次是被我的环境弄红的。** 它断言应用在干净档案下报告"LLM 未配置"，而打包端应用
   会继承启动进程的环境变量——本台架所在 shell 恰好导出了 LLM 凭据，于是应用如实回答"已配置"，测试失败。
   这与打包产物无关。现在 N6 会先把环境里含 `LLM` 的键剔掉再启动（剔除清单记进
   `n6-desktop-walkthrough.json.packagedAppSmokeTest.envKeysStripped`），11 步全绿。

---

## 6. 产物清单

| 文件 | 内容 |
|------|------|
| `env.json` | 机器 / 二进制 / GPU / 夹具 SHA256；含开发端与打包端两份 `ffmpeg_caps` 落档 |
| `n0-box-baseline.json` | N0 三个盒的盒级与成像级偏差，含 §3.1 的既有分叉证据 |
| `n1-stills-geometry.json` | 1600 角点分布、16 预设逐条、N1-c 三条断言、黄金向量可复现性 |
| `n2-stills-visual.json` | 24 格 SSIM、方向哨兵、位移探针、帧偏移扫描、无运镜对照 |
| `n3-dual-track.json` | 露底比例、掩码 IoU、露黑像素计数 |
| `n4-regression.json` | 两棵树的滤镜串 diff、前后端失败集合按提交归因 |
| `n5-panel.json` | 委托 / 降级 / 生命周期，及明确的 `notRunHere` |
| `n6-desktop-walkthrough.json` | 打包身份、两份 FFmpeg 版本与能力、跨二进制渲染比对、§8.4 逐项状态 |
| `n7-budget.json` | 绘制增量、i18n 齐平、行数/函数/形参审计、tsc |
| `node3-refactor-byte-identity.json` | §3.2 拆分的 128 组逐字节等价证明 |
| `run-summary.json` | 一次性完整跑（`run_all.py`）的逐阶段退出码与耗时 |
| `logs/*.log` | 每个实验的完整执行日志（`.gitignore` 未覆盖，提交时按路径挑选） |
| `samples/*.jpg` | 预览 / 成片对比缩略图，每张几十 KB |

全部 9 个阶段在**同一次** `run_all.py` 里跑完并全绿（总耗时 571s，逐阶段退出码见 `run-summary.json`）。

按本节点约束**未执行 `git commit`**。交给节点 #4 的改动面（`git status` 实测）：

| 路径 | 状态 | 来源 |
|------|------|------|
| `backend-services/basic-service/app/services/composition/camera_motion_overlay.py` | 已修改 | §3.2 拆函数 |
| `desktop/scripts/lib/download.js` | 已修改 | §3.3 打包 tar 修复 |
| `docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md` | 未跟踪 | 节点 #0/#1 的产物，本轮从未入库 |
| `docs/plans/camera-motion-stills-and-desktop-gate/experiments/` | 未跟踪 | 本节点台架 |
| `docs/plans/camera-motion-stills-and-desktop-gate/results/` | 未跟踪 | 本节点产物 |

提交注意（CLAUDE.md）：`.gitignore` 覆盖不全，**按路径逐个 `git add`，禁用 `-A` / `.`**；
`experiments/__pycache__/` 已在本节点删除，若重跑过实验请再确认一次；`results/logs/*.log` 被
`.gitignore:59` 的 `*.log` 规则屏蔽（原因见 `results/logs/README.md`），不要 `git add -f` 绕开；
`desktop/build|release|cache/` 均已被忽略，重新打包的产物不会入库。
