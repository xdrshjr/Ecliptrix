# camera-motion-box-parity-and-desktop-walkthrough — 实验台架

对应 `../experiment-plan.md` §2.6 的 E0–E10。
`environment: local` —— 全部在本机跑，不涉及远程主机、不涉及 SSH、不涉及任何私钥。

## 本目录当前的内容（节点 #2 交付）

E0 是**开工许可**，不是指标：它必须先于任何代码改动跑完，任一项失败都改变本轮的
走法。节点 #2 已把三项跑通并落档，节点 #3 接手 E1–E10 时**不需要重跑**，但重跑是
安全的（全部幂等）。

| 脚本 | 阶段 | 它到底测了什么 |
|------|------|----------------|
| `e0b_contain_probe.py` | **E0-b** | 用真实 FFmpeg 测定盒内 contain 的整数规则：`color` 造已知自然尺寸 → `scale=…decrease` → `pad=…:(ow-iw)/2:(oh-ih)/2` → `bbox` 读回内容矩形，一次拿到「缩放整数尺寸 + 居中偏移」。开发端与打包端各跑一次 |
| `e0c_cdp_probe.mjs` | **E0-c** | 在**打包应用**里端到端验证 CDP：启动 → `/json/version` → `/json/list` 页面 target → WebSocket 握手 → `Runtime.evaluate` → `Page.captureScreenshot`。六步全通才算过 |
| `gen_overlay_box_golden.py` | 夹具 | 由 E0-b 的实测读数 + B0 导出侧表达式生成 `../fixtures/overlay-box-golden.json`（TS 与 Python 孪生函数共用的黄金向量） |
| `e0_probes.py` | 汇总 | 跑 E0-a 并把三项结论汇成 `../results/e0-probes.json` |

```bash
# 复跑顺序（Windows / PowerShell 或 bash 皆可，路径用正斜杠）
python docs/plans/camera-motion-box-parity-and-desktop-walkthrough/experiments/e0b_contain_probe.py "<dev ffmpeg 绝对路径>" dev      docs/plans/camera-motion-box-parity-and-desktop-walkthrough/results/e0b-contain-dev.json
python docs/plans/camera-motion-box-parity-and-desktop-walkthrough/experiments/e0b_contain_probe.py "<打包 ffmpeg 绝对路径>" packaged docs/plans/camera-motion-box-parity-and-desktop-walkthrough/results/e0b-contain-packaged.json
node   docs/plans/camera-motion-box-parity-and-desktop-walkthrough/experiments/e0c_cdp_probe.mjs docs/plans/camera-motion-box-parity-and-desktop-walkthrough/results/e0c-cdp-probe.json --port 19222
python docs/plans/camera-motion-box-parity-and-desktop-walkthrough/experiments/gen_overlay_box_golden.py
python docs/plans/camera-motion-box-parity-and-desktop-walkthrough/experiments/e0_probes.py
```

> **FFmpeg 路径必须给绝对路径。** Windows 的 `CreateProcess` 对「正斜杠写法的相对
> 路径」会直接抛 `FileNotFoundError`，而文件其实存在——照相对路径写会得到一个看起来
> 像「打包端没装 FFmpeg」的假结论。

## 三条踩过的坑（别再踩一次）

1. **`bbox=min_val=1` 读不出 pad 边界。** yuv420p 的 `black` 是**限制范围**的 Y=16
   而不是 0，16 ≥ 1 于是 pad 边条也被算成内容，16 组读数会**全部恰好等于盒尺寸**
   ——一张非常整齐、实则什么都没测到的假绿表。阈值取 100（白 235 与黑 16 之间）。
   计划 §评审记录 R5 记的正是 `min_val=1` 的写法，判据必须换掉。
2. **奇数尺寸的盒会被编码器拒收。** `321×123` 在 `-f null` 下由 wrapped_avframe 报
   `Invalid argument (-22)`（yuv420p 要求偶数维度）。收尾加 `format=gray` 即可，
   顺带让 bbox 只读单平面。
3. **`ELECTRON_RUN_AS_NODE` 会把 `Ecliptrix.exe` 变成纯 Node。** agent 宿主常设这个
   变量，子进程继承后应用永远起不来。`e0c_cdp_probe.mjs` 的 `childEnv()` 会摘掉它
   （与 `desktop/scripts/smoke-test.js` 同一处理）。

## 产物

全部落 `../results/`，JSON 含原始命令与原始输出，可离线复核：

- `e0b-contain-dev.json` / `e0b-contain-packaged.json` —— 16 组逐组的预测 vs 实测
- `e0c-cdp-probe.json` —— 六步逐步的请求/响应 + 时间戳日志
- `e0-probes.json` —— 三项探针的汇总结论
- `node2-implementation-notes.json` —— 节点 #2 的预算实测、行为变更、SHOULD 取舍与移交残留
