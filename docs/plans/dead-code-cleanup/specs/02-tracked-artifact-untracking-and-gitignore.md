# Spec 02：跟踪产物取消跟踪 + .gitignore 加固

> 对应 master-plan 类别二 + 类别四附属　|　风险等级：低
> 上游：无　|　下游：Spec 04（全量验证 + 提交）
> 内部顺序约束：**先 `git rm --cached`（02-a），后加 `.gitignore` 规则（02-b）**

## 1. 目标

1. 将 54 个误提交进 git 的生成媒体/日志文件**取消跟踪**（`git rm --cached`，保留本地文件、不重写历史）。
2. 处理后端 `__pycache__/` 与 `*.pyc`（当前未跟踪，靠 `.gitignore` 覆盖防误入库，可选清本地）。
3. 全面加固 `.gitignore`，杜绝上述产物再次入库。

## 2. 02-a：取消跟踪生成产物（git rm --cached）

### 2.1 待取消跟踪的文件类别（共 54 个，本地保留）

| 类别 | 路径模式 | 数量 | 说明 |
|------|---------|------|------|
| 日志 | `backend-services/basic-service/logs/app.log` | 1 | **~36MB**，运行时日志 |
| 日志 | `backend-services/basic-service/scripts/logs/app.log` | 1 | ~260KB |
| 日志 | `logs/app.log` | 1 | ~5KB（根级） |
| TTS 音频 | `backend-services/basic-service/static/audio/generated/*.mp3` | 24 | TTS/拼接产物 |
| 合成视频 | `backend-services/basic-service/static/video/composed/*.mp4` | 9 | 含 video-1/2.mp4 |
| 上传产物 | `backend-services/basic-service/static/uploads/**` (mp3/mp4/jpg) | 18 | 含缩略图 strip_*.jpg、poster.jpg、用户上传媒体 |

> 截至 2026-06-11 工作区核对：日志 3 + 音频 24 + 合成视频 9 + 上传产物 18 = **54**，与目标数一致。

> 精确清单以执行时 `git ls-files` 过滤结果为准（见下方命令），数量可能随当前工作区状态微调。

### 2.2 执行方式（伪流程）

```
# 1. 生成精确清单（不直接对通配硬删，先列出再核对）
git ls-files \
  | filter: 扩展名 ∈ {mp3,mp4,jpg,jpeg,png,wav,log} \
  且 路径 ∈ {static/audio, static/video, static/uploads, */logs/, ^logs/} \
  → tracked_artifacts.txt

# 2. 人工/审阅核对 tracked_artifacts.txt（确认无源码、无需入库的固件/种子被误列）
#    特别注意区分：backend-services/basic-service/datas/ 下的测试固件（保留跟踪，不动）

# 3. 取消跟踪（保留本地文件）。可逐条或批量喂给 git rm --cached：
git rm --cached -- <path>                 # 单条；-- 之后为路径，含空格用引号包裹
git rm --cached --pathspec-from-file=tracked_artifacts.txt   # 批量（路径清单逐行）

# 4. 校验：git status 显示这些文件为 "deleted"（指索引被删），本地文件仍在磁盘
```

> Windows 提示：上述命令在 Git Bash 直接可用。在 PowerShell 下，`grep` 不可用，第 1 步可改用
> `git ls-files | Select-String -Pattern '\.(mp3|mp4|jpg|jpeg|png|wav|log)$' | Select-String -Pattern '(static/(audio|video|uploads)|/logs/|^logs/)'`
> 生成清单；批量取消跟踪用 `git ls-files <pathspec> | ForEach-Object { git rm --cached -- $_ }`。
> 务必先核对清单再执行，**排除 `datas/`**（见 2.3）。

### 2.3 边界与排除

- **排除 `backend-services/basic-service/datas/`**：该目录的 `audio-01.mp3` / `video-*.mp4` / `*.srt` 是测试固件，**保留跟踪**，不在本次取消范围。
- **仅取消跟踪，不删本地**：`--cached` 保证磁盘文件保留，本地预览/导出/桌面运行不受影响。
- **不重写历史**：历史中的大 blob 不清理（master-plan D3）。

## 3. 02-附属：后端构建产物

- `__pycache__/`、`*.pyc`、`*.pyo` 当前**均未被 git 跟踪**（已核实 `git ls-files` 命中为 0），无需 `git rm`。
- 措施：现有 `.gitignore` 第 19–21 行（`__pycache__/` / `*.pyc` / `*.pyo`）**已完整覆盖**，本 Spec **无需新增任何字节码规则**（见 02-b §4.2）。
- 可选本地清理（纯本地，不影响 git，二选一按平台）：
  - Linux/macOS：`find backend-services -type d -name __pycache__ -prune -exec rm -rf {} +`
  - Windows PowerShell：`Get-ChildItem backend-services -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force`
  - 此为可选项，不强制。

## 4. 02-b：.gitignore 全面加固

### 4.1 加固原则

- 新增规则前先读取现有 `.gitignore`（**77 行，已相当完整**），**严禁重复条目**。
- 规则只针对**生成物目录**与**明确产物**，绝不误伤需入库的源码/配置/模板。
- 已跟踪文件需先经 02-a 取消跟踪，`.gitignore` 才对其生效。

### 4.2 现有 `.gitignore` 已覆盖的部分（**不要重复新增**）

经 2026-06-11 核对，下列规则**已存在**于现有 `.gitignore`，本 Spec **不得再重复添加**：

| 已有规则 | 行号 | 覆盖内容 |
|---------|------|---------|
| `*.log` | 59 | **全部 3 个 `app.log`**（根级、scripts、backend）已被忽略 |
| `backend-services/basic-service/logs/` | 60 | backend 日志目录 |
| `__pycache__/` `*.pyc` `*.pyo` `*.pyd` | 19–21、46 | Python 字节码（本就未跟踪，规则已防误入库） |
| `.env` `.env.*` `**/.env` `**/.env.*` + `!**/env.template` `!**/.env.example` `!ops/config.env` | 38–43 | env 文件已黑名单 + 模板/示例/`ops/config.env` 已用 `!` 取反保护 |
| `backend-services/basic-service/static/cached_materials/` | 63 | 远端缓存大文件 |
| `static/uploads/`（根锚定） | 2 | **仅**仓库根 `static/uploads/`，**不**含 backend 子树 |

> 关键结论：**日志与 env/pycache 无需任何新增规则**——现有 `*.log`（59）与 env 黑白名单（38–43）已完整覆盖。再写 `.env`/`.env.*`/`!env.template` 等只会产生**更弱的重复**（现有版本含 `**/` 变体与 `!ops/config.env`，更严密），故一律不加。

### 4.3 真正缺失、需新增的规则（仅这些）

```gitignore
# --- 生成媒体（运行时产物，按需重新生成；现有 static/uploads/ 仅锚定根，未覆盖 backend 子树）---
backend-services/basic-service/static/audio/generated/
backend-services/basic-service/static/video/composed/
backend-services/basic-service/static/video/thumbnails/
backend-services/basic-service/static/uploads/

# --- 部署包（见 Spec 03；仓库内无任何应入库的 .tgz，blanket 安全）---
*.tgz

# --- Windows 设备/噪音文件 ---
nul
```

> 说明一：`backend-services/basic-service/static/uploads/` 一条即可覆盖该子树下所有上传产物（mp3/mp4/jpg/缩略图），无需再单列 `static/uploads/static/video/thumbnails/`。
> 说明二：`*.tgz` 经核对仓库内**无任何已跟踪 `.tgz`**（`docs/example/volcengine_voice_clone_demo.tar.gz` 是 `.tar.gz`，不被 `*.tgz` 命中），故 blanket 规则无附带损害；`ops/*.tgz` 可省，`*.tgz` 已含。
> 说明三：**绝不**新增 `ops/_*.py` / `ops/_*.sh` / `ops/_*.conf` 这类规则——`ops/_sysdeps_install.sh` 是**已跟踪且 Spec 03 判定保留**的工具脚本，`ops/_*.sh` 会与 Spec 03 的保留清单直接冲突。运维临时脚本/部署包的清理属 Spec 03 的工作区删除范畴，不应由 `.gitignore` 通配兜底。

### 4.4 校验

- 加规则后执行 `git status --ignored` 抽查：确认目标产物落入 ignored，且**无源码/模板被误 ignore**。
- 重点确认 `env.template`、`backend-services/basic-service/env.template`、`desktop/scripts/env.template.desktop`、`.env.example`、`ops/templates/*.service`、`ops/config.env`、`ops/_sysdeps_install.sh` 等需入库文件**未被误伤**。
- 验证手法（不依赖跟踪状态）：`git check-ignore --no-index -v <path>`——已跟踪文件 `git check-ignore`（无 `--no-index`）恒返回未忽略，必须加 `--no-index` 才能真实检验规则命中。

## 5. 接口与影响面

- 不触碰任何源码、运行时行为不变。
- 本地磁盘文件全部保留；仅 git 索引与 `.gitignore` 变化。
- 桌面/本地运行所需的 `static/` 产物仍在磁盘，可正常读取。

## 6. 回退方式

- 提交前回退（仅撤销暂存的删除，文件重新跟踪）：`git restore --staged -- <path>`（旧版 git 用 `git reset HEAD -- <path>`）。
- 提交后回退：`git revert <commit>`，或对单文件 `git checkout <commit>^ -- <path>` 重新加回索引。
- `.gitignore` 改动随该 commit，revert 即恢复。
- 本类别建议分两个 commit：`[update] untrack generated media and logs` 与 `[update] harden .gitignore against generated artifacts`。

## 7. 完成判据

- [ ] 54 个生成媒体/日志全部取消跟踪，本地文件保留。
- [ ] `datas/` 测试固件未被误取消。
- [ ] `.gitignore` 加固完成且与现有规则去重。
- [ ] `git status --ignored` 抽查：产物被忽略，源码/模板/配置未被误伤。
- [ ] `git status` 不再将这些产物列为待提交。
