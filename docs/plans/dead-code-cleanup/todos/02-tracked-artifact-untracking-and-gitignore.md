# TODO 02：跟踪产物取消跟踪 + .gitignore 加固

> 对应 spec：`specs/02-tracked-artifact-untracking-and-gitignore.md`

## Dependencies

- `depends_on: []` — 无前置
- `blocks: [04]`
- `parallel_group: A` — 与 TODO 01、03 并行（文件集不重叠）
- **内部顺序**：02-a（`git rm --cached`）必须先于 02-b（加 `.gitignore` 规则）

> 并发注意：本任务会改 git 索引（`git rm --cached`）。与 TODO 01/03 并行时只做"取消跟踪 + 改 .gitignore"，**不 commit**；提交由 TODO 04 串行。若编排选择串行执行三类，本任务仍只改不提交。

## 任务清单

### 02-a：取消跟踪生成产物
- [ ] 读 `master-plan.md`、`specs/02`、现有 `.gitignore`（如有 `summaries/global-context.md` 则一并读）
- [ ] 生成精确清单（Git Bash）：`git ls-files | grep -E '\.(mp3|mp4|jpg|jpeg|png|wav|log)$' | grep -E '(static/(audio|video|uploads)|/logs/|^logs/)' > /tmp/tracked_artifacts.txt`
  - PowerShell 等价：`git ls-files | Select-String '\.(mp3|mp4|jpg|jpeg|png|wav|log)$' | Select-String '(static/(audio|video|uploads)|/logs/|^logs/)'`
- [ ] 核对清单：预期 **54** 条（日志 3 + 音频 24 + 合成视频 9 + 上传产物 18）
- [ ] **排除 `backend-services/basic-service/datas/`** 下的测试固件（不在清单内；若误入则剔除）
- [ ] 取消跟踪（保留本地）：`git rm --cached -- <path>` 逐条，或 `git rm --cached --pathspec-from-file=tracked_artifacts.txt` 批量
- [ ] 校验：`git status` 显示这些文件为索引内 "deleted"，磁盘文件仍在

### 02-附属：后端构建产物
- [ ] 确认 `__pycache__`/`*.pyc`/`*.pyo` 未被跟踪（`git ls-files | grep -c pyc` 应为 0）→ 无需 `git rm`
- [ ] （可选）本地清理 `__pycache__` 目录，纯本地不影响 git

### 02-b：.gitignore 加固
- [ ] 读现有 `.gitignore`（77 行），**核对已覆盖项**：`*.log`(59)、`backend.../logs/`(60)、`__pycache__`/`*.pyc`/`*.pyo`(19-21,46)、`.env*` 黑白名单(38-43)、`static/uploads/` 根锚定(2)
- [ ] **仅新增以下缺失规则**（去重，不重复已有项）：
  ```
  backend-services/basic-service/static/audio/generated/
  backend-services/basic-service/static/video/composed/
  backend-services/basic-service/static/video/thumbnails/
  backend-services/basic-service/static/uploads/
  *.tgz
  nul
  ```
- [ ] **绝不新增** `ops/_*.py` / `ops/_*.sh` / `ops/_*.conf`（会误伤 Spec 03 保留的 `_sysdeps_install.sh` 等已跟踪脚本）
- [ ] **绝不重复**日志/env/pycache 规则（现有版本更严密）

### 校验
- [ ] `git check-ignore --no-index -v <path>` 抽查 6 条新规则命中目标产物
- [ ] 确认未误伤需入库文件：`env.template`、`backend.../env.template`、`desktop/scripts/env.template.desktop`、`.env.example`、`ops/templates/*.service`、`ops/config.env`、`ops/_sysdeps_install.sh`
- [ ] `git status --ignored` 抽查：产物已 ignored，源码/模板/配置未被误伤

### 收尾
- [ ] **不 commit**（交 TODO 04 串行提交，分两个 commit：取消跟踪 / gitignore 加固）
- [ ] 写执行 summary：取消跟踪文件数、新增 gitignore 规则、误伤检查结果
