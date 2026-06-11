# Spec 03：工作区运维垃圾清理（untracked-ops-junk-cleanup）

> 对应 master-plan 类别三　|　风险等级：中（误删在用工具 → 丢失运维能力）
> 上游：无　|　下游：Spec 04（全量验证 + 提交）

## 1. 目标

清理 `ops/` 下未跟踪的工作区垃圾：

1. 删除 4 个部署包 `ops/*.tgz`（~272MB，可重新生成）。
2. 删除明显重复 / 一次性的排障脚本 `ops/_dp_*.py` / `ops/_ssh_*.py`（共 138 个候选）。
3. **保留**经确认仍在使用的部署工具（白名单）。
4. 处理 `nul`（Windows 设备噪音）与 `.cursor/`、`.agentmesh/`（IDE/agent 缓存，未跟踪）。

## 2. 关键约束：未跟踪 = 无 git 安全网

`ops/_dp_*.py`、`ops/_ssh_*.py`、`ops/*.tgz` 均**未被 git 跟踪**，一旦删除**无法用 git 恢复**。因此：

- 删除前**必须先枚举完整删除清单并记录在执行报告中**（留痕，便于人工追溯）。
- 白名单内的脚本**绝不删除**。
- 无法确信是"重复/废弃"的脚本 → **默认保留**，不删。
- `*.tgz` 是可重新生成的构建产物，确定删除。

## 3. 部署包删除（确定执行）

| 文件 | 大小 | 动作 |
|------|------|------|
| `ops/_deploy.tgz` | 43.7MB | 删 |
| `ops/_fresh_deploy.tgz` | 90.7MB | 删 |
| `ops/_update.tgz` | 41.7MB | 删 |
| `ops/_update_head.tgz` | 96.1MB | 删 |

> tgz 由 `git archive` / 打包脚本按需重新生成（见部署记忆），删除无损失。

## 4. 脚本分类规则

执行时先 `ls ops/_dp_*.py ops/_ssh_*.py ops/_*.sh ops/_*.conf` 枚举全部，按下表分类：

### 4.1 保留白名单（绝不删）

| 脚本 | 原因 |
|------|------|
| `ops/_dp_upload2.py` | 在用的可续传上传工具（部署记忆） |
| `ops/_dp_wait2.py` | 在用的修正版等待器（部署记忆） |
| 任何被 `MEMORY.md` / `docs/` 部署文档显式引用的脚本 | 在用 |

> 执行时先 `grep` 仓库内 `docs/`、`MEMORY.md`、`ops/*.md` 对脚本名的引用，命中者一律并入白名单。

### 4.2 删除候选（高置信重复/一次性）

满足以下任一**且不在白名单**者，判为可删：

- 存在**更高版本同名兄弟**的旧版：如 `_dp_recover.py` 当 `_dp_recover2.py` 存在、`_ssh_verify.py` 当 `_ssh_verify2.py` 存在。**保留最新版，删旧版**。
  - 注意：仅当两者确为同一脚本的版本迭代时才适用。形如 `_dp_check3.py` 与 `_dp_check_deps.py`/`_dp_check_extract.py` 看似同族，实为**不同用途**的脚本（`*_deps` 查依赖、`*_extract` 查解包、`3` 为第三版通用检查），不构成版本对，**不可据此互删**——这类需逐一判定，存疑即保留（见 4.3）。
- **同一事故的序号迭代**：如 `_ssh_diag502.py`、`_ssh_diag502b.py` … `_ssh_diag502f.py`（已解决的 502 排障迭代，无 `502a`，首个即裸名）—— 整组删除（事故已闭环）。
- 文件名/内容明确指向**一次性、已完成的排障/事故响应**（如 `_ssh_ir1.py`/`_ssh_ir2.py` 事故响应、`_ssh_fix_cors.py`/`_ssh_fix_cors2.py`/`_ssh_fix_cors3.py` 已合入仓库的修复迭代）。

### 4.3 默认保留（存疑即留）

- 无法判定是否仍有用的脚本一律保留，记入"存疑保留"清单供后续人工决策。
- `_seed_models.sh` / `_seed_models_v2.sh` / `_sysdeps_install.sh` 等可能是有用工具 → 保留（除非有更高版本明确取代，如 `_seed_models.sh` 被 `_seed_models_v2.sh` 取代则删旧版）。
- `_nginx_ecliptrix.conf`：若与 `ops/templates/` 中已入库的 nginx 模板内容一致 → 可删；否则保留（可能是未入库的有效配置）。

## 5. 其他工作区噪音

| 项 | 处理 |
|----|------|
| `nul` | Windows 空设备名，非真实文件，无法常规删除；加入 `.gitignore`（Spec 02-b）即可，不强制删 |
| `.cursor/` | IDE 缓存，未跟踪；可选本地删，建议加入 `.gitignore` |
| `.agentmesh/` | agent 缓存，未跟踪；可选本地删，建议加入 `.gitignore` |

> `.cursor/`、`.agentmesh/` 的删除为可选项；最稳妥是仅加 `.gitignore`，不强删（可能含本地配置）。

## 6. 执行流程（伪流程）

```
# 1. 删除 tgz（确定）
rm ops/_deploy.tgz ops/_fresh_deploy.tgz ops/_update.tgz ops/_update_head.tgz

# 2. 枚举全部脚本
scripts = ls ops/_dp_*.py ops/_ssh_*.py ops/_*.sh ops/_*.conf

# 3. 构建白名单（含记忆/文档引用扫描）
whitelist = {_dp_upload2.py, _dp_wait2.py} ∪ grep-referenced(docs, MEMORY.md, ops/*.md)

# 4. 对每个脚本分类
for s in scripts:
    if s in whitelist: keep
    elif 命中 4.2 高置信重复规则: → 删除清单
    else: → 存疑保留清单

# 5. 打印【删除清单】【白名单】【存疑保留清单】到执行报告
# 6. 删除【删除清单】中的脚本
# 7. 报告：删了哪些、保留了哪些、为何
```

## 7. 接口与影响面

- 不触碰任何源码或 `git` 跟踪文件（这些都未跟踪），运行时行为不变。
- 仅清理工作区磁盘文件；不产生 git 索引变化（未跟踪文件删除不进 commit）。
- 因此本类别**不产生源码 commit**；其成果体现在 `git status` 的未跟踪清单缩短，以及 `.gitignore`（Spec 02）阻止复现。

## 8. 回退方式

- **tgz**：无 git 备份，但可由打包脚本重新生成（无损失）。
- **脚本**：删除前的完整清单已记录在执行报告，必要时可从备份/历史会话恢复；故仅删高置信项，存疑一律保留。

## 9. 完成判据

- [ ] 4 个 `*.tgz` 已删（~272MB 释放）。
- [ ] 白名单脚本（含 `_dp_upload2.py`、`_dp_wait2.py`）完好无损。
- [ ] 高置信重复/一次性脚本已删，清单记录在案。
- [ ] 存疑脚本一律保留，清单记录在案。
- [ ] 执行报告含【删除/白名单/存疑】三份清单。
