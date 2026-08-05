# camera-motion-stills-and-desktop-gate — 实验台架（节点 #3）

对应 `../experiment-plan.md` §2.2 的 **N0–N7**。`environment: local` —— 全部在本机跑，
不涉及远程主机、不涉及 SSH、不涉及任何私钥。

## 一键运行

```bash
python docs/plans/camera-motion-stills-and-desktop-gate/experiments/run_all.py
python docs/plans/camera-motion-stills-and-desktop-gate/experiments/run_all.py n1 n4   # 只跑子集
```

**N0 是闸门**：不通过就停下，不跑后面。理由见下。

| 脚本 | 指标 | 它到底测了什么 |
|------|------|----------------|
| `e5_environment.py` | — | 机器 / 二进制 / 夹具 SHA256 快照，含**开发端与打包端两份** `ffmpeg_caps.probe()` 落档 |
| `e6_n0_box_baseline.py` | **N0** | **无运镜**时，预览盒 vs 导出盒（各自从生产代码读出）+ 两侧成像的 bbox 端到端比对 |
| `e7_n1_stills_geometry.py` | **N1** | TS 黄金向量 vs **导出真正发射的 `perspective` 表达式**（求值后逐角点）；含 N1-c 三条绝对值断言 |
| `e8_n2_stills_visual.py` | **N2** | 真 Chromium 预览帧 vs 真 FFmpeg 成片帧，**裁到盒内**做 SSIM + 方向哨兵 + 位移灵敏度探针 + 帧对齐扫描 |
| `e9_n3_dual_track.py` | **N3** | 双轨 3D 露底**逐像素**：露底比例、露底区域 IoU、以及"露出的是下层而不是黑"的显式断言 |
| `e10_n4_regression.py` | **N4** | 在 `8c702ec` 的 **detached worktree 里真的把老代码跑一遍**，逐字符 diff；前后端失败集合按提交归因 |
| `e11_n5_panel.py` | **N5** | 面板委托关系（无自己的三角函数）、降级提示与其 i18n 键、真 WebGL 下 20 次开合的 `acquire`/`release` 配平 |
| `e12_n6_desktop_gate.py` | **N6** | **打包端 FFmpeg 亲自渲染**同一批运镜，与开发端逐像素比对；§8.4 清单逐项标注状态 |
| `e13_n7_budget.py` | **N7** | 静图运镜的**增量**绘制耗时、i18n 齐平、改动文件的行数/函数长度/形参数、`tsc --noEmit` |

## 五条设计原则

1. **只跑线上代码。** TS 侧一律 `ts.transpileModule` 转译**出货文件**后在真 Chromium 里执行，
   Python 侧一律 `import` 真模块、调真 `_process_image_overlays`。台架不复刻任何几何或滤镜逻辑
   —— 一个自己算一遍的台架只能证明台架和自己一致。
2. **两侧都不许自报位置。** N0 把带洋红定位框的静图渲染出来，再从**像素里**找它。
   问任何一侧"你觉得你画在哪"，就等于把要验的东西当成前提。
3. **基线要执行，不要引用。** N4 的"与 `8c702ec` 逐字符相同"靠 detached worktree 里**真的运行**老
   代码得出，而不是引用某个测试文件里冻结的字面量 —— 后者只能证明当时作者的信念。
4. **不可测就写明不可测。** N5 不挂载 React 组件、N6 不驱动打包端 GUI，这两件事在 JSON 里各有一条
   `notRunHere` / `manualStepsNotRun`，写清楚原因和替代证据，而不是悄悄跳过或含糊带过。
5. **二进制不进仓库。** 渲染出的 mp4 / 全尺寸 PNG 落在 `CAMERA_MOTION_WORK`（默认系统临时目录下的
   `camera-motion-exp/`）。仓库里只留 JSON 指标、日志，以及 `results/samples/` 下几十 KB 的对比图。

## 两个容易踩的坑（已在代码里注释，这里再说一次）

- **SSIM 必须裁到盒内。** 盒 A 只占画布 9%，整帧 SSIM 会把静图的误差平均进两侧逐字节相同的背景里，
  静图画到完全错误的位置也能拿到 ~0.99。N2 因此裁盒比对，并用"只位移候选侧 2px"的探针**每次都证明**
  当前比对尺度仍然抓得住 2px 错位（位移后 SSIM 掉到 ~0.36）。
- **pytest 子集会静默地什么都不跑。** 两个后端测试文件在本机无法被 collect，留着会让整个 session
  在收集阶段中止并报 `945 deselected, 2 errors` —— 读起来就是"0 个失败"。N4 因此显式 `--ignore`
  这两个文件，并在比较前断言真的收集到了用例。

## 复用与边界

- `_harness.py` **导入**上一轮的 `docs/plans/timeline-camera-motion/experiments/_common.py`
  并把它的目录常量指向本目录，而不是复制一份 —— 两份会漂移的测量台架比没有台架更糟。
  `fixture_media.py` 同理（静图沿用上一轮的四角可辨测试图）。
- 上一轮的 `preview-harness/` 是**只读归档**，本轮另起一份：其模块清单早于
  `internal/drawWithMotion` / `internal/boxTextureCache` / `ImageOverlayLayer` 的改造，
  已经 `require` 不动今天的 `CanvasCompositor`。
- 依赖：FFmpeg / FFprobe、Node、Python 3.11 + Pillow + numpy、Electron（复用
  `desktop/node_modules/electron`，**不新增依赖**）。

> Electron 注意：本台架可能本身就跑在一个 Electron 进程里，它会导出 `ELECTRON_RUN_AS_NODE=1`；
> 该变量若被子进程继承，`electron.exe` 会退化成纯 Node 而永远起不来。`_common.child_env()` 会摘掉它。
> 另：renderer 的 `require` 一律**惰性**放在上报用的 try 里 —— 顶层 require 抛错时不会有任何 IPC 发出，
> 父进程只能干等到超时（本轮第一次跑就是这样浪费了 15 分钟）。
