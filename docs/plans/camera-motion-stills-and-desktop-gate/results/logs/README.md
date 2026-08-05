# 为什么这个目录在克隆出来时是空的

本仓库的 `.gitignore:59` 用 `*.log` 全局屏蔽日志文件，来源是 spec/05 V05-D（历史上有过 2834 次
Bearer JWT 通过日志泄露）。该规则**优先于**「实验证据应当入库」，因此本目录下各实验产出的原始
`*.log` **有意留在本地、不进版本控制**。

可复现的部分都在版本控制里：

- 每一项指标的结论、退出码、失败文件清单、逐条数值，都已提取进同级目录的
  `n0-box-baseline.json` / `n1-stills-geometry.json` / `n2-stills-visual.json` /
  `n3-dual-track.json` / `n4-regression.json` / `n5-panel.json` /
  `n6-desktop-walkthrough.json` / `n7-budget.json` / `env.json` / `run-summary.json`。
  JSON 里指向 `logs/*.log` 的字段记录的是**本地产出路径**，不是仓库内路径。
- 视觉证据是 `.jpg`，不受该规则影响，已入库于 `../samples/`。
- 台架源码在 `../../experiments/`，
  `python docs/plans/camera-motion-stills-and-desktop-gate/experiments/run_all.py`
  可一键重跑并在本目录重新生成全部日志。

本轮日志里有两类内容值得单独说明，因为它们是**不会**被写进 JSON 的原始输出：

- `n4-driver-head.log` / `n4-driver-baseline.log` —— 同一个 driver 分别在 HEAD 与 `8c702ec`
  的 detached worktree 里执行的完整 stdout，是"基线被执行过而不是被引用"的现场记录。
- `n6-smoke-test.log` —— 打包端应用启动、前后端健康检查、主窗口加载、退出的逐步输出。

如果需要把某段日志作为长期证据保留，请把它转成非 `.log` 后缀的产物（例如摘录进 `summary.md` /
`report.md`，或另存为 `.txt` 并确认其中不含任何凭据），不要用 `git add -f` 绕开该规则。
