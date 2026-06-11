# TODO 03 执行报告：工作区运维垃圾清理（untracked-ops-junk-cleanup）

## Meta

- **Agent**: `google-dev-03`（Google Core Engineering Team）
- **TODO**: `todos/03-untracked-ops-junk-cleanup.md` ← `specs/03-untracked-ops-junk-cleanup.md`
- **Verdict**: **COMPLETED**
- **日期**: 2026-06-11
- **分支**: `feat/local-video-editing-refactor`
- **Git 提交**: 无（本任务仅删除未跟踪文件，**未** `git add`/`commit`/`rm`）

## Key Decisions（关键决策）

1. **「文档引用 = 白名单」规则必须排除清理计划自身的目录。**
   朴素 `grep` 会把 `docs/plans/dead-code-cleanup/` 内的 spec/todo 对脚本名的提及也算作「引用」。
   但这些文档正是在**描述要删哪些脚本**（spec 4.2 明确点名 `_ssh_diag502*`、`_ssh_fix_cors*`、
   `_ssh_ir1/2`、`_dp_recover`←`_dp_recover2`、`_ssh_verify`←`_ssh_verify2`），把它们当白名单触发
   会让整个任务变成空操作——显然违背意图。因此**计算真实白名单时排除了 `docs/plans/dead-code-cleanup/`**，
   只把 memory 文件与非清理类 docs（如 `docs/diagnoses/chinese-subtitle-tofu-on-export/analysis.md`）
   中的引用算作「在用」白名单触发。

2. **默认保留，存疑即留（spec 4.3）。** 只删除 spec 4.2 **显式点名**的高置信项 + 真实闭环事故序列。
   形如 `_ssh_diag_reset` / `_ssh_diag_reset2`、`_ssh_alembic_fix` / `_ssh_alembic_fix2`、
   `_ssh_trace` / `_ssh_trace2`、`_ssh_prod_check` / `_ssh_prod_check2` 等「2」变体，经读取文件头确认是
   **不同侧重的后续脚本**（不同诊断目标 / 不同修复策略），**非严格版本取代** → 一律 KEEP（存疑保留）。
   `_ssh_seed_models2.py`（「上传 _seed_models.sh 并运行」）与 `_ssh_seed_models.py`（「内联事务从 .env 播种」）
   是**完全不同用途**，更非版本对 → KEEP。

3. **反模式规避（spec 4.2 注）。** `_dp_check3.py` vs `_dp_check_deps.py`/`_dp_check_extract.py` 是
   不同用途（通用第三版检查 / 查依赖 / 查解包），**不构成版本对，未据此互删** → 三者全 KEEP。

4. **白名单内 `_dp_wait.py` / `_dp_upload.py` / `_ssh_update_deploy.py` 即便 memory 标注为「已被取代/broken」，
   仍保留。** 规则是「被 docs/MEMORY/ops/*.md 引用者一律并入白名单，绝不删」——引用即在用记录，不删。

5. **逐文件读头确认。** 删除前读取了全部 13 个删除候选 + 10 个版本对候选的文件头，确认 diag502(a–f)、
   fix_cors(1–3)、ir(1–2) 确为闭环一次性事故迭代；`_dp_recover.py`/`_ssh_verify.py` 确有更高版本兄弟。

## Execution Flow（执行流程）

1. 读完 5 份必读文档（master-plan、spec 03、todo 03、global-context、MEMORY.md）+ 2 份 memory
   细节文件（production-server.md、project_ecliptrix_deploy_pitfalls.md）补全部署工具引用。
2. `ls -la ops/*.tgz` + `git status --porcelain ops/ | grep tgz` → 确认 4 个 tgz 存在且未跟踪。
3. 枚举：`_dp_*.py`=36，`_ssh_*.py`=102，`_*.sh`=3，`_*.conf`=1 → **共 142 个脚本**。
4. 对每个脚本 basename 在 `docs/` + `ops/README.md` + 全部 memory `.md` 中 grep 引用；
   **排除 `docs/plans/dead-code-cleanup/` 自指**后得 15 个真实白名单。
5. 按 spec 4.2 分类删除候选；读文件头逐一确认；版本对家族逐一甄别（多数判为存疑保留）。
6. **删除前打印三份清单**（见 Artifacts）。
7. `rm` 4 个 tgz（~272MB）+ 13 个高置信脚本。
8. 复核：红线文件 `_dp_upload2.py`/`_dp_wait2.py` 存活；tgz 全清零；13 个删除项全消失；
   白名单全完好；计数 35 `_dp_.py` / 90 `_ssh_.py` / 3 `.sh` / 1 `.conf`。
9. 确认 `git status ops/` 无本任务引入的索引变化（3 个 `M` 模板/config 改动为任务前既存，未触碰）；
   `nul` / `.cursor/` / `.agentmesh/` 原样保留。

## Artifacts（三份清单）

### A. DELETED — 删除清单（4 tgz + 13 脚本 = 17 项）

**部署包（4，~272MB）：**
- `ops/_deploy.tgz`（43.7MB）
- `ops/_fresh_deploy.tgz`（90.7MB）
- `ops/_update.tgz`（41.7MB）
- `ops/_update_head.tgz`（96.1MB）

**脚本（13，高置信重复/一次性，spec 4.2 显式点名）：**
- `ops/_dp_recover.py` — 被 `_dp_recover2.py`（「Last recovery attempt」）取代的旧版恢复脚本
- `ops/_ssh_verify.py` — 被 `_ssh_verify2.py` 取代（spec 显式删除示例）
- `ops/_ssh_diag502.py`、`_ssh_diag502b.py`、`_ssh_diag502c.py`、`_ssh_diag502d.py`、
  `_ssh_diag502e.py`、`_ssh_diag502f.py` — 已闭环的 502 排障序列迭代（6 个）
- `ops/_ssh_fix_cors.py`、`_ssh_fix_cors2.py`、`_ssh_fix_cors3.py` — 已合入仓库的 CORS 修复迭代（3 个）
- `ops/_ssh_ir1.py`、`_ssh_ir2.py` — 一次性事故响应（incident-response，2 个）

### B. WHITELIST — 白名单（15，绝不删，全部完好）

强制红线（2）：`_dp_upload2.py`、`_dp_wait2.py`
memory/docs 引用（13）：
`_dp_upload.py`、`_dp_wait.py`、`_nginx_ecliptrix.conf`、`_seed_models.sh`、`_seed_models_v2.sh`、
`_ssh_build_frontend.py`、`_ssh_db_and_installs.py`、`_ssh_lib.py`、`_ssh_put_env.py`、
`_ssh_run_sysdeps.py`、`_ssh_update_deploy.py`、`_ssh_verify_final.py`、`_sysdeps_install.sh`

> 引用来源：`production-server.md`、`project_ecliptrix_deploy_pitfalls.md`、
> `incident-prod-compromise-2026-06-03.md`、`MEMORY.md`、
> `docs/diagnoses/chinese-subtitle-tofu-on-export/analysis.md`、`ops/README.md`。

### C. KEPT-AMBIGUOUS — 存疑保留清单（114，默认保留）

`142 总 − 13 删 − 15 白名单 = 114 存疑保留`。全部保留在 `ops/`。完整列表：

`_dp_backend.py` `_dp_build.py` `_dp_check_deps.py` `_dp_check_extract.py` `_dp_check3.py`
`_dp_clean_restart.py` `_dp_cloudagent.py` `_dp_diag_venv.py` `_dp_dpkg_restore.py` `_dp_entry.py`
`_dp_fast_restart.py` `_dp_final_state.py` `_dp_forensics.py` `_dp_frontend.py` `_dp_import_err.py`
`_dp_installdeps.py` `_dp_neutralize_deploy.py` `_dp_nginx.py` `_dp_poll_sysdeps.py` `_dp_preflight.py`
`_dp_pycheck.py` `_dp_recover2.py` `_dp_restore_and_backend.py` `_dp_state2.py` `_dp_sysdeps.py`
`_dp_ufw.py` `_dp_update.py` `_dp_update_backend.py` `_dp_update_frontend.py` `_dp_verify.py`
`_dp_watchdog_check.py` `_ssh_add_tts_key.py` `_ssh_add_tts_resource.py` `_ssh_alembic_fix.py`
`_ssh_alembic_fix2.py` `_ssh_apply_full_nginx.py` `_ssh_apply_nginx.py` `_ssh_build_journal.py`
`_ssh_build_log.py` `_ssh_certbot.py` `_ssh_check.py` `_ssh_check_backend2.py` `_ssh_check_db.py`
`_ssh_check_deploy_unit.py` `_ssh_check_dns.py` `_ssh_check_env.py` `_ssh_check_github.py`
`_ssh_check_installs.py` `_ssh_check_modeldb.py` `_ssh_check_progress.py` `_ssh_check_tts_env.py`
`_ssh_cleanup.py` `_ssh_cleanup_deploy.py` `_ssh_connect_diag.py` `_ssh_deploykey_clone.py`
`_ssh_diag_backend.py` `_ssh_diag_backup.py` `_ssh_diag_reset.py` `_ssh_diag_reset2.py`
`_ssh_finish_deploy.py` `_ssh_fix_data_and_build.py` `_ssh_fix_dpkg_relaunch.py` `_ssh_fix_python.py`
`_ssh_fix_python2.py` `_ssh_gitpull.py` `_ssh_import_gate.py` `_ssh_inspect_dir.py`
`_ssh_install_cjk_fonts.py` `_ssh_install_services.py` `_ssh_launch_sysdeps.py` `_ssh_locate.py`
`_ssh_nginx_http.py` `_ssh_nginx_inspect.py` `_ssh_old_server.py` `_ssh_once.py` `_ssh_ping.py`
`_ssh_poll_pip_npm.py` `_ssh_poll_sysdeps.py` `_ssh_poll_sysdeps2.py` `_ssh_preflight.py`
`_ssh_probe_attr.py` `_ssh_probe_exec.py` `_ssh_probe_remnants.py` `_ssh_prod_check.py`
`_ssh_prod_check2.py` `_ssh_prod_state.py` `_ssh_public_smoke.py` `_ssh_pull_and_deploy.py`
`_ssh_pull_and_restart_backend.py` `_ssh_recon.py` `_ssh_reconnect.py` `_ssh_redeploy_all.py`
`_ssh_restart_verify.py` `_ssh_seed_models.py` `_ssh_seed_models2.py` `_ssh_stamp_and_seed.py`
`_ssh_start_backend.py` `_ssh_start_frontend.py` `_ssh_status.py` `_ssh_status_after_reimage.py`
`_ssh_status_check.py` `_ssh_sync_code.py` `_ssh_systemd_deploy.py` `_ssh_trace.py` `_ssh_trace2.py`
`_ssh_tts_diag.py` `_ssh_update1_backup_extract.py` `_ssh_update1b_extract.py` `_ssh_upload_code.py`
`_ssh_upload_extract.py` `_ssh_verify_all.py` `_ssh_verify_deps.py` `_ssh_verify2.py` `_ssh_wait_build.py`

> 注：`_ssh_verify2.py` 被 KEEP（它是 `_ssh_verify.py` 的取代者，留最新版）；
> `_dp_recover2.py` 同理 KEEP。

## Issues & Risks（问题与风险）

- **未跟踪 = 无 git 安全网**：13 个被删脚本无法 git 恢复。已在删前打印完整清单留痕（本报告 Artifacts.A），
  必要时可从历史会话/备份恢复。删除集严格限于 spec 显式点名的高置信项，存疑一律保留，风险可控。
- **`nul` / `.cursor/` / `.agentmesh/`**：按红线未强删，留待 TODO 02 的 `.gitignore` 覆盖处理。
- **白名单保守偏置**：把 memory 标注「broken/已取代」的 `_dp_wait.py`、`_dp_upload.py`、`_ssh_update_deploy.py`
  也保留（因被文档引用）。代价是磁盘上仍有少量过时脚本，但杜绝了误删在用工具的风险——符合「存疑即留」红线。
- **无 git 索引变化**：`git status ops/` 中的 3 个 `M`（`config.env`、两个 `.service` 模板）为任务前既存改动，
  本任务未触碰任何跟踪文件。

## Context for Downstream（下游上下文）

- **本 TODO 不产生 commit**，对 Spec 04（全量验证 + 分类提交）无源码层面输入；其成果仅体现为
  `git status` 未跟踪清单缩短（少了 4 tgz + 13 脚本）。
- **dev-04 / Spec 04 注意**：提交时不应包含 `ops/_*.py`、`ops/_*.sh`、`ops/_*.conf`、`ops/*.tgz`、
  `ops/__pycache__/`——这些应由 TODO 02 的 `.gitignore` 规则覆盖（dev-02 红线：不加 `ops/_*.sh` 规则，
  但 spec 02 负责 `*.tgz` 与 `ops/` 临时脚本的忽略）。本任务删除已释放 ~272MB+。
- **剩余 ops 脚本**：35 `_dp_*.py` + 90 `_ssh_*.py` + 3 `.sh` + 1 `.conf` = 129 个脚本仍在工作区
  （15 白名单 + 114 存疑保留）。若后续需进一步精简，应由人工逐一决策存疑保留清单（本报告 Artifacts.C）。
- **红线确认**：`_dp_upload2.py`、`_dp_wait2.py` 删除后复核**确认存活**。
