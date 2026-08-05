# 为什么这个目录在克隆出来时是空的

本仓库的 `.gitignore:59` 用 `*.log` 全局屏蔽日志文件，来源是 spec/05 V05-D
（历史上有过 2834 次 Bearer JWT 通过日志泄露）。该规则**优先于**「实验证据应当入库」，
因此本目录下 `e0`–`e6` 各步产出的原始 `*.log` **有意留在本地、不进版本控制**。

可复现的部分都在版本控制里：

- 每一项指标的结论、退出码、失败文件清单、逐条数值，都已提取进同级目录的
  `m1-geometry.json` / `m2-visual.json` / `m3-performance.json` / `m4-export.json` /
  `m5-regression.json` / `m6-ux-audit.json` 与 `env.json`。JSON 里指向
  `logs/*.log` 的字段记录的是**本地产出路径**，不是仓库内路径。
- 视觉证据（含缺陷 A 修复前的翻转对比图）是 `.jpg`，不受该规则影响，已入库于
  `../samples/`。
- 台架源码在 `../../experiments/`，`python ../../experiments/run_all.py` 可一键重跑
  并在本目录重新生成全部日志。

如果需要把某段日志作为长期证据保留，请把它转成非 `.log` 后缀的产物（例如摘录进
`summary.md` / `report.md`，或另存为 `.txt` 并确认其中不含任何凭据），不要用
`git add -f` 绕开该规则。
