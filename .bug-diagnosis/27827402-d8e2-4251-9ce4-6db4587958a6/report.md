# Bug Diagnosis Session

**Session UUID:** 27827402-d8e2-4251-9ce4-6db4587958a6
**Date:** 2026-11-23 03:21
**Mode:** Fully automatic（用户指令为「修复打包失败」，直接执行）
**Status:** Fixed

## Problem Description

桌面端打包失败。最近一次编排日志 `desktop/cache/build-logs/build-20261123-021916.log`
显示：preflight 通过、依赖安装跳过，进入 `=== 打包(scripts/build.js) ===` 后约 6 分钟失败：

```
Additionally, some packages in these conflicts have no matching distributions
available for your environment:
    certifi
    requests
ERROR: ResolutionImpossible: for help visit https://pip.pypa.io/en/latest/topics/...
[build] FAILED: python.exe exited with 1
```

失败点在 `prepare-backend` 的 `pip install -r build/backend/requirements.txt`，
即构建期装配内嵌 CPython 的依赖解析，不是 electron-builder、不是前端 build。

## Evidence Collected

- 编排层日志只记录退出码，无 pip 全量输出（PS 5.1 不转发 node 子进程输出）。
  按 `desktop/README.md` 的方法，直接复现 pip 解析：
  ```
  set PYTHONNOUSERSITE=1
  desktop\build\python\python.exe -m pip install --dry-run --no-warn-script-location \
      -r desktop\build\backend\requirements.txt
  ```
  结果与线上日志**逐字一致**：`ResolutionImpossible`（退出码 1，33s）。
- pip 给出的冲突链：
  - `The user requested certifi==2025.8.3`
  - `yt-dlp[default] 2026.10.26 depends on certifi>=2026.10.19; extra == "default"`
  - `The user requested requests==2.31.0`
  - `yt-dlp[default] 2026.10.26 depends on requests<3 and >=2.32.2; extra == "default"`
- PyPI 上 `yt-dlp 2026.10.26` 的 `requires_dist` 确认 `[default]` extra 的下限：
  `certifi>=2026.10.19`、`requests<3,>=2.32.2`、`urllib3<3,>=2.0.2`、
  `websockets>=13.0`、`yt-dlp-ejs==0.8.0`、`brotli`、`mutagen`、`pycryptodomex`。
- 引入点：提交 `00df25ff`（fix: restore in-app YouTube preview and manage the yt-dlp
  runtime）把 `requirements.txt` 的 `yt-dlp>=2024.9.27` 改成了
  `yt-dlp[default]>=2024.9.27`，但没有同步放宽 `certifi` / `requests` 的精确 pin。
- 对照上一次成功产物 `desktop/release/win-unpacked/resources/python/Lib/site-packages`：
  `certifi-2025.8.3` + `requests-2.31.0` + `yt_dlp-2026.10.26`。该产物生成于
  `[default]` extra 落地之前——不带 extra 的 yt-dlp 根本不依赖 certifi，所以旧组合能装上，
  这解释了「以前能打、现在必炸」。
- 全仓只有 `backend-services/basic-service/requirements.txt` 一处写这两个 pin
  （grep `certifi==2025.8.3|requests==2.31.0` 仅命中第 8、39 行），没有第二份约束文件。

## Root Cause Analysis

**Primary Hypothesis:**
`backend-services/basic-service/requirements.txt` 里 `yt-dlp[default]>=2024.9.27`（第 52 行）
与同一文件的 `certifi==2025.8.3`（第 8 行）、`requests==2.31.0`（第 39 行）互斥。
当前 yt-dlp 的最新版（2026.10.26）对 `[default]` extra 声明了
`certifi>=2026.10.19`、`requests>=2.32.2`，而两个精确 pin 都低于该下限，
pip 的解析器在所有 yt-dlp 版本上回溯后无解 → `ResolutionImpossible`。

**Why this causes the problem:**
`prepare-backend.js` 对 `requirements.txt` 做**全量** `pip install -r`（无 `--no-deps`、
无 constraints 放宽），构建期必然执行这次解析。因为 `yt-dlp` 用的是无上限的 `>=` 浮动范围，
pip 会取最新版，而最新版抬高了 extra 的下限，于是「pin 死的老依赖」与「浮动的最新 yt-dlp」
在每次构建时相撞——一旦上游发版就必须改 pin，本次正是这个时刻。

**Alternative Possibilities:**
1. ~~网络/镜像不可达~~ —— 反证：解析阶段已经成功下载并缓存了全部 metadata
   （日志里大量 `Using cached ...`），失败发生在依赖求解，不是取包。
2. ~~PYTHONNOUSERSITE / 内嵌运行时装配问题~~ —— 反证：同一运行时执行 `pip -V`、
   `--dry-run` 均正常，失败是纯版本约束问题。
3. ~~electron-builder / payload 断言 / 前端构建~~ —— 反证：失败发生在
   `prepare-backend` 早期，尚未进入 `electron-builder`，也无任何 `[assert]` 输出。
4. **保持 `[default]` extra 是否必要** —— 必要：`prepare-backend.js` 的
   YouTube 自检 `dispatch({"operation":"selftest","require_ejs":True,...})` 断言
   `ejs_challenge_ok`，依赖 extra 提供的 `yt-dlp-ejs==0.8.0`。去掉 extra 会让自检失败，
   所以修 pin，而不是去掉 extra。

## Fix Plan

只改 `requirements.txt` 的两行精确 pin，把它们抬到 `yt-dlp[default]` 的下限之上，
并选「满足下限的最小版本」以控制行为变更面：

- `certifi==2025.8.3` → `certifi==2026.10.23`
  （yt-dlp 满足下限的版本；也正是 yt-dlp 自己 `pin` extra 采用的版本）
- `requests==2.31.0` → `requests==2.32.5`
  （满足 `>=2.32.2,<3` 的最小发布，`urllib3==2.5.0` / `charset-normalizer==3.4.2` /
  `idna==3.10` 均在其允许区间内，无需连带改动）

保留 `yt-dlp[default]>=2024.9.27`（构建期必须装配 ejs），并加注说明这组 pin 与
`[default]` extra 下限的耦合关系，避免下次上游抬下限时再次撞车。

不改 `openai`（同样是浮动范围，解析成功，属既有行为，超出本次缺陷范围）。

## Verification Plan

1. 复现（红）：`pip install --dry-run -r build/backend/requirements.txt` → 必须失败于
   `ResolutionImpossible`。**已完成**。
2. 修复后在同样的 dry-run 上确认 `Would install ... certifi-2026.10.23 ...
   requests-2.32.5 ... yt-dlp-2026.10.26 yt-dlp-ejs-0.8.0` 且无 ERROR。
3. 实跑 `desktop` 的 `node scripts/prepare-backend.js`：必须越过 pip 阶段，走完
   内嵌运行时装配、`backend imports ok`、`backend package import ok`、playwright 版本校验、
   `YouTube JS self-test OK`。
4. 打包：`desktop/build.ps1 -Dir -SkipFrontend -SkipBackend` 复用已有工件，确认
   payload 断言通过、electron-builder 产出 `win-unpacked`、冒烟测试 PASS。

## Fix Applied

**Files modified:**
- `backend-services/basic-service/requirements.txt:8` - `certifi==2025.8.3` → `certifi==2026.10.23`
- `backend-services/basic-service/requirements.txt:39` - `requests==2.31.0` → `requests==2.32.5`
- `backend-services/basic-service/requirements.txt:52-58` - 在 `yt-dlp[default]` 上方加注，
  记录这组 pin 与该 extra 下限的耦合规则（抬 pin，不要删 extra）

**Changes:**
把两个精确 pin 抬到 `yt-dlp[default]` 声明的下限之上，`yt-dlp[default]>=2024.9.27`
保持不变（构建期 YouTube 自检需要 `yt-dlp-ejs`）。`urllib3==2.5.0` /
`charset-normalizer==3.4.2` / `idna==3.10` 本来就在新 requests 的允许区间内，未改动。

## Verification

1. **红（复现）**：`desktop\build\python\python.exe -m pip install --dry-run
   -r desktop\build\backend\requirements.txt`（`PYTHONNOUSERSITE=1`）→ 退出码 1，
   `ERROR: ResolutionImpossible`，与失败构建日志同一条冲突链。
2. **绿（解析）**：同一命令换用修复后的 pin → 退出码 0，
   `Would install ... certifi-2026.10.23 ... requests-2.32.5 ... yt-dlp-2026.10.26
   yt-dlp-ejs-0.8.0`。
3. **绿（真实装配）**：`desktop/scripts/prepare-backend.js` 实跑 2m11s，退出码 0：
   `Successfully installed ... certifi-2026.10.23 ... requests-2.32.5 ...
   yt-dlp-2026.10.26 yt-dlp-ejs-0.8.0` → `backend imports ok` →
   `backend package import ok` → 研究依赖版本验证 → `YouTube JS self-test OK` →
   `[prepare-backend] done`。日志 `desktop/cache/verify-prepare-backend.log`。
4. **绿（端到端打包）**：`powershell -NoProfile -ExecutionPolicy Bypass -File
   desktop\build.ps1 -Dir -SkipFrontend -SkipBackend -NoPause` → 退出码 **0**，9.1 分钟：
   `[assert] all payloads present`、`[assert] effects payload identity ok (12089 files)`
   （source 与 packaged 各一次）、electron-builder 产出 `win-unpacked`、
   `[smoke-test] ... [smoke-test] PASS`、`no residual processes`。
   日志 `desktop/cache/verify-build-full.log`。
5. **产物实测**：`desktop/release/win-unpacked/resources/python/Lib/site-packages`
   含 `certifi-2026.10.23`、`requests-2.32.5`、`urllib3-2.5.0`、`yt_dlp-2026.10.26`、
   `yt_dlp_ejs-0.8.0`——包内运行时与解析结果一致。

未覆盖：`prepare-frontend`（Next.js 构建）本次用 `-SkipFrontend` 复用既有工件，
该步骤与本缺陷无关；NSIS 安装包（`npm run build` 非 `-Dir`）未重跑。


## Notes

- 该缺陷只在不带 `--skip-backend` 的打包路径暴露；`--skip-backend` 复用旧工件时会绿，
  容易被误判为「偶发」。
- 工作区存在大量与本缺陷无关的未提交改动（skillrouter 相关），本次不动、不提交。
- 真正的「最后一次成功日志」`build-20261120-060905.log` 并不存在（首次读取失败）；
  成功判定改用产物 `win-unpacked` 的 site-packages 实测清单，而非推断。
