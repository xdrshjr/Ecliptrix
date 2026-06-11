# TODO 03：工作区运维垃圾清理

> 对应 spec：`specs/03-untracked-ops-junk-cleanup.md`

## Dependencies

- `depends_on: []` — 无前置
- `blocks: [04]`
- `parallel_group: A` — 与 TODO 01、02 并行（仅删 `ops/` 未跟踪文件，不动 git 索引）

> 本任务只删未跟踪文件，不产生 git 提交，与其他任务零冲突。

## 任务清单

### 准备
- [ ] 读 `master-plan.md`、`specs/03-untracked-ops-junk-cleanup.md`
- [ ] **重申安全原则**：`ops/*.tgz` 与 `ops/_*.py/.sh/.conf` 均未跟踪，删除**无 git 安全网** → 先枚举、后删除、存疑即留

### 部署包删除（确定）
- [ ] 确认 4 个 tgz 存在且未跟踪：`ls -la ops/*.tgz` + `git status --porcelain ops/ | grep tgz`
- [ ] 删除：`rm ops/_deploy.tgz ops/_fresh_deploy.tgz ops/_update.tgz ops/_update_head.tgz`（~272MB）

### 脚本分类
- [ ] 枚举全部：`ls ops/_dp_*.py ops/_ssh_*.py ops/_*.sh ops/_*.conf`（预期 ~138 个 .py + 少量 .sh/.conf）
- [ ] 构建白名单：`{_dp_upload2.py, _dp_wait2.py}` ∪ 被 `docs/`、`MEMORY.md`、`ops/*.md` 引用的脚本（`grep -rl <name>`）
- [ ] 对每个脚本判定：
  - 在白名单 → **keep**
  - 命中高置信重复规则（旧版本被更高版本取代，如 `_dp_recover.py`←`_dp_recover2.py`、`_ssh_verify.py`←`_ssh_verify2.py`；同事故迭代如 `_ssh_diag502*`、`_ssh_fix_cors*`；一次性事故响应 `_ssh_ir1/2.py`）→ **delete**
  - 其余 → **keep（存疑保留）**
- [ ] ⚠️ 注意反模式：`_dp_check3.py` vs `_dp_check_deps.py`/`_dp_check_extract.py` 是**不同用途**，非版本对，不可互删
- [ ] 存疑保留特例（spec 4.3）：
  - `_seed_models.sh` / `_seed_models_v2.sh` / `_sysdeps_install.sh` 等疑似有用工具 → **keep**；仅当明确版本取代（`_seed_models.sh` 被 `_seed_models_v2.sh` 取代）才删旧版
  - `_nginx_ecliptrix.conf`：与 `ops/templates/` 已入库 nginx 模板内容**一致 → 可删**，否则 **keep**（可能是未入库的有效配置）

### 三份清单 + 删除
- [ ] 打印【删除清单】【白名单】【存疑保留清单】到执行 summary
- [ ] 删除【删除清单】中的脚本
- [ ] 复核白名单脚本（`_dp_upload2.py`、`_dp_wait2.py`）仍在

### 其他噪音（可选 / 仅加 .gitignore）
- [ ] `nul`：Windows 设备名，不强删，已由 Spec 02 加入 `.gitignore`
- [ ] `.cursor/`、`.agentmesh/`：未跟踪缓存，建议仅靠 `.gitignore`，不强删

### 收尾
- [ ] **不产生 commit**（删的是未跟踪文件）
- [ ] 写执行 summary：tgz 删除、三份脚本清单、白名单完好确认
