# timeline-camera-motion — 实验台架（节点 #3）

对应 `docs/plans/timeline-camera-motion/experiment-plan.md` §2.2 的 M1–M6。
`environment: local` —— 全部在本机跑，不涉及远程主机、不涉及 SSH、不涉及任何私钥。

## 一键运行

```bash
python docs/plans/timeline-camera-motion/experiments/run_all.py
```

单独跑某一项也可以（各自独立写 `results/*.json` 与 `results/logs/*.log`）：

| 脚本 | 指标 | 它到底测了什么 |
|------|------|----------------|
| `e0_environment.py` | — | 机器/版本快照 + `ffmpeg_caps.probe()` 实际落在降级阶梯哪一档 |
| `e1_m1_geometry.py` | **M1** | 用**线上预设表**（经生产 `toCameraMotionWire`）喂 Python 内核，逐角点比对冻结的黄金向量；同时跑仓库自带的 vitest / pytest 两条断言 |
| `e2_m4_export.py` | **M4** | 用**真实** `VideoCompositionService._compose_videos_filtergraph` 把 16 个预设各导一条片子；四条护栏（L1 / L11 / tier-2 / tier-3）；滤镜串长度（L7） |
| `e3_preview_capture.py` | M2 输入 / **M3** | 用 `desktop/node_modules/electron` 里的**真实 Chromium** 跑线上 `CanvasCompositor` + `PerspectiveQuadRenderer`：抓预览帧、量 30s 连续合成的耗时 |
| `e4_m2_visual.py` | **M2** | 预览帧 vs 成片帧，统一降采样到 640×360 后 `ffmpeg -lavfi ssim`；外加**方向哨兵**（同时和上下镜像的成片比一次） |
| `e5_m5_regression.py` | **M5** | 从 git 取出**特性提交之前**的 builder 现场执行，逐字符比滤镜串 + 双份渲染逐帧 SSIM + 既有测试套按提交归因 |
| `e6_m6_ux_audit.py` | **M6** | i18n 三处齐平（按模块真实加载，不 grep）、硬编码文案、无障碍可供性、文件行数上限、`tsc --noEmit` |

## 三条设计原则

1. **只跑线上代码。** TS 侧一律 `ts.transpileModule` 转译**出货文件**后直接执行（沿用
   `scripts/gen-camera-motion-golden.mjs` 的做法），Python 侧一律 `import` 真模块。台架不复刻任何几何或滤镜逻辑——
   一个自己算一遍的台架只能证明台架和自己一致。
2. **二进制不进仓库。** 渲染出的 mp4 / 全尺寸 PNG 落在 `CAMERA_MOTION_WORK`（默认系统临时目录下的
   `camera-motion-exp/`）。仓库里只留 JSON 指标、日志，以及 `results/samples/` 下几张几十 KB 的对比图（L10）。
3. **不可测就写明不可测。** 例如 axe 不是本仓库依赖，为一次实验引入依赖比如实登记缺口更糟——它留在
   Electron 桌面 walkthrough 的清单里，见 `results/m6-ux-audit.json` 的 `notRunHere`。

## 依赖

- FFmpeg / FFprobe（本机 gyan.dev full build，版本记在 `results/env.json`）
- Node（转译线上 TS）、Python 3.11 + Pillow + numpy
- Electron（复用 `desktop/node_modules/electron`，**不新增依赖**；缺失时 `e3` 会明确报错而不是悄悄跳过）

> Electron 注意：本台架可能本身就跑在一个 Electron 进程里，它会导出 `ELECTRON_RUN_AS_NODE=1`；
> 该变量若被子进程继承，`electron.exe` 会退化成纯 Node 而永远起不来。`_common.child_env()` 会摘掉它。

## 夹具

`fixture_media.py` 用代码合成一张 1920×1080 测试图并编码成 6s / 30fps 的定长片段：

- **可复现**：计划里的 D2 只记录 `static/uploads` 的路径 + SHA256，而那些文件不在版本控制里；合成图可以逐字节重建。
- **时间恒定**：预览侧靠 seek 取帧、导出侧靠帧号取帧，图案若随时间变化，seek 精度就会混进每一个 M2 数字里。
- **四角可辨**：四角形状+颜色各不相同，光栅角序换位（L12）这类错误会直接肉眼可见，而不是躲在一个略低的 SSIM 里。
