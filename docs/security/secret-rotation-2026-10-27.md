# 密钥泄露事件与轮换清单（2026-10-27）

> 范围：`github.com/xdrshjr/Ecliptrix`（public 仓库）的全部历史提交与全部分支。
> 结论：**20+ 个真实凭据曾以明文出现在公开历史中，必须全部视为已泄露并轮换**。
> 本文档记录已完成的清理动作、仍需人工完成的轮换动作，以及防复发措施。

## 1. 事件摘要

| 项目 | 事实 |
|---|---|
| 仓库可见性 | `public`（匿名可访问 raw 内容，按 commit SHA 可取历史文件） |
| 泄露内容 | LLM 密钥（智谱 / 百炼 / Kimi / Anthropic 兼容）、阿里云 OSS AK/SK、火山引擎 TTS/ASR token 与 secret、ARK、RunningHub、Freesound、Pexels、Unsplash、Tavily、Supabase anon key、一把 SSH 私钥、服务器 root 密码 |
| 承载位置 | `.env` / `.env.bak` / `.env.example` / 各级 `env.template` / `logs/app.log` / `docs/**` 文档与调试脚本 / `ops/key/*.pem` / `ops/config.env` |
| 受影响 refs | `main` + 4 个功能分支 + 4 个 tag（全部已重写并强推） |
| 处置 | 用 `git filter-repo` 重写全部 ref，替换为占位符，删除纯密钥/日志/密钥文件；清理后全对象库复扫 0 命中 |

**关键认识：代码清理不等于止损。** 旧提交对象在 GitHub 侧被 GC 之前，仍可用
`https://raw.githubusercontent.com/xdrshjr/Ecliptrix/<旧SHA>/<路径>` 直接读取。
因此**轮换是唯一的止损手段**，清理只是让后续访问不再有收获。

## 2. 必须轮换的凭据（按优先级）

> 轮换后逐个更新本地 `backend-services/basic-service/.env`、仓库根 `.env`，
> 并重启打包好的桌面应用；应用内「设置 → 模型与凭据」里保存过的 key 存在
> SQLite 的 `model_settings` 表里，也要同步更新。

### P0 — 当前仍在使用的密钥（泄露即等于账号被他人使用）

| 服务 | 环境变量 | 泄露位置 | 轮换入口 | 不轮换的后果 |
|---|---|---|---|---|
| 智谱 GLM | `LLM_API_KEY`、`FAST_LLM_API_KEY`、`AGENT_LLM_API_01/02_KEY`、`VIDEO_CUT_LLM_API_KEY` | `docs/coding-plan/glm/*.py`、各级 `env.template`、`.env` 历史 | https://bigmodel.cn/usercenter/apikeys | 他人可消费你的额度，并读取你发送的提示词与素材文本 |
| 阿里云百炼 DashScope | `VL_LLM_API_KEY`（历史 `LLM_API_KEY`） | `docs/apis/*.md`、`.env*` 历史、`docs/plans/high-risk-security-fixes/REPORT.md` | https://bailian.console.aliyun.com/ | 同上 |
| 阿里云 RAM AccessKey | `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | 各级 `env.template`、`.env` 历史 | https://ram.console.aliyun.com/manage/ak | **可直接读写/删除 OSS bucket `ecliptrix`**，属最高危 |
| 火山引擎语音（TTS/ASR） | `VOLCANO_TTS_*`、`VOLCANO_ASR_*`（APPID `3461****96` 及其 access token / secret key） | `env.template*`、`.env` 历史、`docs/plans/asr-*` | https://console.volcengine.com/speech/app | 盗用语音合成与识别额度；可冒用你的音色复刻 |
| 火山方舟 ARK | `ARK_API_KEY` | `env.template*`、`.env` 历史 | https://console.volcengine.com/ark | 盗用视频/图片生成额度（成本高） |

### P1 — 第三方素材/搜索 API

| 服务 | 环境变量 | 轮换入口 |
|---|---|---|
| RunningHub | `RUNNING_HUB_API_KEY` | https://www.runninghub.cn/ 用户中心 → API |
| Freesound | `FREESOUND_API_KEY` | https://freesound.org/apiv2/apply/ |
| Pexels（3 个 key） | `PEXELS_API_KEY` | https://www.pexels.com/api/ |
| Unsplash（2 个 key） | `UNSPLASH_ACCESS_KEYS` | https://unsplash.com/oauth/applications |
| Tavily（2 个 key） | `TAVILY_API_KEYS` | https://app.tavily.com/home |

### P2 — 历史遗留，已不再使用，仍建议吊销

| 凭据 | 位置 | 处置 |
|---|---|---|
| Kimi coding-plan key（`sk-kimi-…`） | `docs/coding-plan/kimi/test_kimi_k2.5.py` | https://platform.moonshot.cn/console/api-keys 吊销 |
| Anthropic 兼容网关 key（`sk-rMpb…`） | 历史 `claude.ps1`、`docs/apis/ai_mixed_editing_api.md` | 在对应供应商后台吊销 |
| 历史 OpenAI 风格 key（`sk-05oqz…`、`sk-a5f209d8…`、`sk-Pagpy…`） | 历史 `.env.bak` / `.env` | 在对应供应商后台吊销 |
| Supabase `SUPABASE_ANON_KEY`（项目 `hlqvzgwmbejiviaekdns`） | 历史 `.env`、`docs/apis/supabase_*` | 该存储方案已被本地文件系统取代：删除 Supabase 项目即可 |
| **SSH 私钥** `ops/key/inkclaw-singpore-260322.pem` | 历史 `ops/key/` | 从该服务器 `~/.ssh/authorized_keys` 删除并重建密钥对；检查登录日志 |
| 服务器 root 密码（`ROOT_PASSWORD`） | 历史 `ops/config.env`、`env.template*` | 改密码；关闭密码登录，改密钥 + 仅内网/跳板访问 |

### P3 — 仅本机、低风险

`ADMIN_USERNAME=admin` / `ADMIN_PASSWORD=admin`、`DATABASE_URL` 里的
`ecliptrix:ecliptrix@localhost`：单机 SQLite 桌面应用，无对外服务，无需轮换，
但不要在新环境复用。

## 3. 已完成的仓库清理

1. **历史重写**（`git filter-repo`，本地镜像副本中执行）：
   - 58 条真实密钥值 + 4 条形似规则全部替换为 `***REMOVED***`，
     随后人工改写为 `<redacted>`（文档）或 `your_*_here`（模板）占位符；
   - 内嵌在审计报告里的 PEM 私钥正文，按行替换为 `***REMOVED-PRIVATE-KEY***`。
2. **从全部历史中删除**（不留任何版本）：
   - `.env`、`*.env`、`*.env.bak`、`env-config/**`（纯密钥文件）
   - `*.pem`（SSH 私钥）、`*.log`（含 Bearer JWT 的运行日志）、
     `*.bak`、`coverage/`、`*.tsbuildinfo`、`node_modules/*`（历史误提交的构建产物）
3. **误伤修复**：替换启发式曾把 `process.env.*_KEY`、`settings.*_api_key`
   这类**标识符**当作值替换，已从重写前版本恢复 16 个源码/测试文件，
   并逐文件确认未重新引入任何真实密钥。
4. **历史重写后的人工收尾**：两个 coding-plan 调试脚本改为从环境变量读 key
   （`ZHIPU_API_KEY` / `KIMI_API_KEY`），脱敏测试改用合成 key。
5. **强推**：`main` + 4 个功能分支 + 4 个 tag 全部改写后强推；
   本地遗留的 `backup/*` 分支与 7 个 stash（指向旧历史）已删除。

## 4. GitHub 侧仍需人工完成

历史重写只让旧提交**不可达**，并不立即删除。请按序处理：

1. **等 24 小时后再复验**旧 SHA 是否还能访问：
   ```bash
   curl -s -o NUL -w "%{http_code}\n" \
     "https://raw.githubusercontent.com/xdrshjr/Ecliptrix/b2629915f2d048f9e5d2014405702ddf7e530ff9/backend-services/basic-service/docs/apis/intent-detection-api.md"
   ```
   返回 `200` 说明 GitHub 仍持有旧对象（本次检查即为 200）。
2. **联系 GitHub Support**，请求对泄露的 commit 执行 GC / 清理缓存视图
   （主题写 “Request purge of sensitive data from a public repository after
   history rewrite”，附旧 SHA 列表）。客服处理后旧 SHA 才会真正 404。
   等价方案：删除仓库后重新创建并推送（会丢失 star / issue / PR / 旧链接）。
3. **检查非 git 面泄露**（filter-repo 管不到）：
   - Releases 里附件/源码包、Actions 的 build log 与 artifacts、Wiki、
     Issue/PR 评论中粘贴过的 key；
   - 仓库的 fork（若有）仍保留旧历史，需联系 owner 或（若为镜像）删除；
   - GitHub 上保存的 PAT / SSH key / Deploy key 是否还有别的滥用迹象。
4. **审计用量**：在阿里云 / 火山 / 智谱 / Tavily 等控制台查看最近账单与调用日志，
   确认没有异常消费；OSS bucket `ecliptrix` 检查是否存在非本人写入的对象。

## 5. 防复发

| 措施 | 位置 |
|---|---|
| 密钥形状扫描（工作树，秒级） | `python scripts/scan-secrets.py`（`npm run scan:secrets`） |
| 全历史扫描（对象库） | `python scripts/scan-secrets.py --history` |
| pytest 门禁：跟踪文件不得含凭据字面量 | `backend-services/basic-service/tests/security/test_05_secrets.py` |
| `.gitignore` 屏蔽 `*.pem` `*.key` `*.p12` `*.jks` `ops/key/` `secrets/` | `.gitignore` |
| 提交规范 | 用 `git add <具体路径>`，提交前看 `git status --porcelain`；不要 `git add -A` |

建议再加一道本地钩子（可选）：

```bash
# .git/hooks/pre-commit
python scripts/scan-secrets.py || exit 1
```

## 6. 本次验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 重写后全对象库无真实密钥 | `python .agentmesh/tmp/verify_repo.py <重写克隆>` | 0 命中（34 个已知值 + 8 类形态模式） |
| 远端 main 已干净 | `curl raw…/main/.env.example`、`…/docs/coding-plan/glm/*.py` | 返回 `your_llm_api_key_here` / `os.getenv(...)` |
| 全部分支 tip 无密钥形状 | `git grep` 于每个分支 tip | 0 文件命中 |
| 本地工作树无密钥字面量 | `python scripts/scan-secrets.py` | OK |
| 旧 SHA 仍可访问（GitHub 侧未 GC） | `curl -w %{http_code}` | `200` → 需执行 §4 |

## 7. 备份与回滚

- 重写前的完整仓库（含全部分支、tag、stash）保存在
  `.agentmesh/tmp/backup/ecliptrix-all-refs.bundle` 与
  `.agentmesh/tmp/backup/ecliptrix-mirror.git`（均被 `.gitignore` 排除，不会上传）。
- **这份备份同样包含明文密钥**：轮换全部完成后请直接删除该目录，
  不要在别处长期留存。
