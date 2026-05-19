# Master Plan：Ecliptrix 高危安全问题审计与修复

- **主题（topic）**：`high-risk-security-fixes`
- **生成日期**：2026-05-20
- **运行模式**：Full Process（需求发现 → 规划 → 多智能体修复）
- **语言**：中文
- **威胁模型**：公网匿名攻击者（unauthenticated remote attacker）
- **高危标准**：CVSS v3 Base Score ≥ 7.0（仅修复高危与严重）
- **审计范围**：全仓（`src/`、`backend-services/`、`dev/`、`install.sh`、`start.sh`、`kill.sh`、`env.template`、`env-config/`、`.env*`）
- **修复粒度**：前后端均可修改，允许内部重构（不再受 API 契约硬约束）
- **验证标准**：每个高危修复 **必须** 配套回归测试
- **依赖 CVE 扫描**：不在本次任务范围内（仅审计自身代码）
- **交付物**：修复补丁（代码）+ 简要安全报告（位于 `docs/plans/high-risk-security-fixes/REPORT.md`）

---

## 1. 目标（Goals）

1. **可达性优先**：识别并修复 **公网匿名攻击者可达的高危**（CVSS ≥ 7.0）漏洞，覆盖 OWASP Top 10 关键项：
   - A01: Broken Access Control（未鉴权 router、绕过 Session 中间件）
   - A03: Injection（命令注入、SSRF、path traversal）
   - A05: Security Misconfiguration（CORS 通配符、Debug、日志）
   - A07: Identification & Authentication Failures（会话/Token 处理）
   - A08: Software & Data Integrity（不安全反序列化、yt-dlp/ffmpeg 输入）
   - A09: Security Logging Failures（敏感字段写入日志）
2. **零功能回归**：现存功能（视频合成、TTS、登录、工作流执行、文件上传、媒体代理）行为不变；对外 API 契约保持向后兼容。
3. **可验证**：每个修复补 1 个或多个 pytest / Jest 回归用例（同时覆盖正向调用 + 攻击向量被阻断）。
4. **可审计**：交付简要报告，每条记录含 → 文件:行号 / CVSS 分量 / 攻击路径 / 修复点 / 验证方式。

## 2. 不在本次范围（Out of Scope）

- **依赖项 CVE 升级**（用户明确排除）：`npm audit` / `pip-audit` / `safety` 不跑。
- **中/低危项**：CVSS < 7.0 的问题（如代码风格类、未利用的内部 API 等）只列报告附录、不修复。
- **基础设施层**：服务器 OS 加固、TLS 配置、Nginx/反代规则、防火墙策略。
- **已认证用户的水平/垂直越权**（IDOR）：除非同时构成公网匿名可达，否则降级为中危记入附录。
- **DoS / 限流**：本次不做请求频率限制、上传体积限制等（除非直接构成 RCE/凭据泄露的放大）。
- **第三方服务侧问题**：ARK / Volcano TTS / OSS 自身的安全配置（如 OSS bucket 公开读）。

## 3. 已识别的威胁面（来自 Phase 1 代码盘点）

> 详细位置见各 spec；本节仅列分类与高位风险，供 audit 阶段交叉验证。

### 3.1 鉴权与访问控制（候选高危）

- **未鉴权 root-level routers**：`ai_video_generate_router`、`video_export_router`、`intent_detection_router` 三个 router 挂在 `/` 而非 `/api`，**绕过** `SessionAuthMiddleware` 的前缀匹配。
- **Frontend BFF `workflow/test-node`**：无认证检查，可触发任意工作流节点（LLM/Tavily/Pexels/Volcano）。
- **`/api/storage/files` 静态挂载**：StaticFiles 不强制鉴权（白名单中），但可能允许枚举 `cached_materials/`、`uploads/` 下的他人文件。

### 3.2 CORS / 跨域凭证（确认高危）

- `app/main.py` CORSMiddleware: `allow_origins=["*"]` + `allow_credentials=True` —— FastAPI 在该组合下默认会拒绝 credentials，但部分浏览器/版本可能允许；即便规范遵守，组合本身仍属 misconfiguration anti-pattern，且若任何反代覆盖了 `Access-Control-Allow-Origin` 反射来源即出问题。

### 3.3 外部进程注入 / SSRF

- **yt-dlp**：`youtube_service.py` 直接把用户传入的 `request.url` / `request.query` 喂给 `YoutubeDL.extract_info` / `ytsearch{N}:<query>`，没有 scheme/host 白名单 → 任意 URL 下载、内网探测 SSRF。
- **FFmpeg**：所有调用使用列表参数（`subprocess.run([...])`）相对安全，**但**：
  - `preview_proxy_service.py` 用 FFmpeg 转码远程 URL（用户可控的 `upstream_url`）→ SSRF。
  - 视频合成参数来自 timeline JSON 中的 `source_path` / `file_path` —— 需确认是否过滤本地路径前缀。

### 3.4 路径穿越 / 文件上传

- `storage_router.py` 上传接口接受 form 参数 `bucket_path`，传入 `storage_service.upload_file(custom_path=...)`，最终经 `_validate_path()` 校验。需验证：
  - `_validate_path` 是否能阻断 `..` / 绝对路径 / 符号链接 / 相对 trick（如 `foo/../../etc/passwd`）。
  - 用户控制的 `filename` 是否被 `_sanitize_filename()` 处理，且不可绕过。
- 部分 router（如 `image_pack`、`frame_pack`、`voice_clone`）也接收上传，需逐个核验。

### 3.5 凭据 / 配置泄露

- **追踪进 Git 的 `.env`**：`.gitignore` 未屏蔽 `.env`/`.env.*`，需确认仓库中是否实际存在带真实密钥的 `.env*`（特别是 `backend-services/basic-service/.env.bak`、`env-config/haowang-cloud/.env`、`env-config/local-kt/.env`）。**这是潜在 CVSS ≥ 9.0 项**。
- **代码中直接读 `process.env.LLM_API_KEY`**：fallback 路径下，前端 BFF 直接持有后端密钥。
- **日志泄露**：`app/main.py` 启动期或请求中间件是否打印完整 headers（含 Authorization / session token）。

### 3.6 不安全的反序列化 / 数据完整性

- `AgentWorkflow.workflow_data` 是 JSON，但反序列化时是否 `eval` / `pickle` ？需确认。
- 静音/TTS 缓存命中是否基于客户端可控的哈希？

### 3.7 信息暴露与安全响应头缺失

- `/docs`、`/redoc`、`/openapi.json` 是否在生产环境也开放？这本身不是高危，但若同时存在未鉴权敏感端点，会被放大利用。
- 缺失的安全响应头（`X-Content-Type-Options`、`X-Frame-Options` / `Content-Security-Policy: frame-ancestors`、`Referrer-Policy` 等）：单独属于中危，但当存在未鉴权 endpoint 或 CORS 配置不当时会被放大；与 §3.2 合并到 `specs/02` 一起评估与修复。

## 4. 审计与修复方法论

> Phase 编号约定（参考 Full Process 模式）：
> - Phase 1 = 需求发现 Q&A（已完成）
> - Phase 2 = 规划文档编写（本文档与 specs / todos / orchestration）
> - Phase 3 = 用户审阅与确认
> - Phase 4 = 多智能体并发审计与修复（DEV / REVIEWER / TESTER）
> - Phase 5 = 集成验证与报告产出

```
┌─────────────────────────────────────────────────────────────┐
│                    Audit & Fix Pipeline                     │
├─────────────────────────────────────────────────────────────┤
│  Phase 4-5 multi-agent execution under Three-Powers gov.    │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐               │
│  │  DEV-N   │ →  │REVIEWER-N│ →  │ TESTER-N │               │
│  │ 找+修+ut │    │ 复核补丁 │    │ 跑回归   │               │
│  └──────────┘    └──────────┘    └──────────┘               │
│       ↓                                                     │
│  Per-spec workflow:                                         │
│    1) 静态定位（Read/Grep）→ 列出确认漏洞                  │
│    2) CVSS 评分（仅 >=7.0 进入修复队列）                    │
│    3) 写最小变更补丁（防御性优先，必要时重构）              │
│    4) 写 pytest / Jest 回归（正向 + 攻击向量）              │
│    5) 跑 backend pytest + frontend type-check + 启服烟测    │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 漏洞确认门槛

- **必须**满足以下四要素中至少三项才认定高危：
  1. 公网匿名可达（无需登录或绕过既有鉴权即可触达）
  2. 单一请求 / 单一可控输入即可触发（无需复杂前置条件）
  3. 后果属下列之一：RCE / 凭据泄露 / 越权 / 敏感数据泄露
  4. CVSS v3 Base Score ≥ 7.0（依据 AV/AC/PR/UI/S/C/I/A 评估）
- 不能仅凭"看起来不安全"就修；每个修复点附 PoC 思路一句话（不需 working exploit，但需说明攻击者如何达成）。

### 4.2 修复策略选择优先级（同一漏洞）

按以下顺序尝试：
1. **加防御**（输入校验、白名单、`Depends(get_current_user)`、安全响应头）—— 不动 API 契约。
2. **重构内部实现**（隔离用户输入、抽出验证层、移除危险 fallback）—— 内部签名可变，外部契约不变。
3. **必要时引入破坏性变更**（如收紧 CORS、给敏感 router 加默认鉴权）—— 同步修改前端调用方，纳入回归测试覆盖。

### 4.3 验证矩阵

| 验证类型 | 工具 | 触发时机 |
|---|---|---|
| 单元 / 回归测试 | `pytest backend-services/basic-service/tests/` | 每个修复补丁完成后 |
| 前端类型检查 | `npm run type-check`、`npm run lint` | 涉及前端修复后 |
| 全套后端测试 | `pytest tests/ -v` | Phase 5.5 集成验证 |
| 烟测（可选） | `uvicorn` 启服 + 关键路由 curl | 涉及 router/middleware 改动后 |

## 5. 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 测试数据库 | 沿用现有 `sqlite+aiosqlite:///:memory:` | 现有 pytest 已用 SQLite，避免引入新依赖 |
| 防御补丁库位置 | `app/security/` 新建（如不存在），存放复用的校验函数 | 集中管理；现有重复校验逐步迁移 |
| URL 白名单实现 | `app/security/url_guard.py` 提供 `validate_external_url()` | 给 yt-dlp、preview_proxy、media_proxy 共享 |
| Auth 中间件加固 | 增加 router 级 `Depends`，不依赖白名单前缀 | 防止挂错前缀就绕过；显式优于隐式 |
| `.env` 处理 | git rm + 加入 `.gitignore` + 历史不重写（除非用户要求） | 用户未要求改历史；只防未来。但需 **强烈建议** 轮换泄露过的密钥 |
| CORS 修复 | `allow_origins` 改为环境变量驱动的白名单，prod 默认拒绝 `*` | 兼容开发环境同时关掉生产风险 |
| 回归测试位置 | `backend-services/basic-service/tests/security/test_<spec_name>.py` | 与现有 tests/ 同级，便于发现 |

## 6. 依赖与约束

- **依赖**：现有 `pytest`、`httpx`、`pytest-asyncio` 已在 `requirements.txt`；前端 `next`、`typescript` 已具备。
- **约束**：
  - **不破坏现存功能** —— 这是用户给出的最强约束。任何修复都必须保证现有功能调用路径在测试中仍 PASS。
  - **生产环境无 alembic 迁移**（来自记忆）—— 不可以在本次修复中新增 ORM 字段或 schema 变更。
  - **`.env` 是被 git 跟踪的**（用户记忆）—— 部署时会被覆盖，因此 `.env` 安全相关修改需通过 `env.template` 文档化，并提醒用户在部署后手工覆盖。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 修复触碰到核心路径（如视频合成 ffmpeg 参数）引入回归 | 高 | 每个 ffmpeg/yt-dlp 调用点的修复必须配套已有测试集 + 新增的攻击向量测试 |
| `.env` 历史中已泄露的密钥 | 致命 | **修复 + 报告 + 建议用户立即轮换全部密钥**；本次任务不重写 git 历史，但需明确告警 |
| CORS 改严后某些前端流程在 prod 跨域失败 | 中 | 提供 env 白名单 + dev 默认宽松；切换前在 `start.sh --dev` 路径验证 |
| 鉴权加严后前端忘记带 token | 中 | 修复路径同步搜索前端 fetch 调用点，确保 `credentials: 'include'` 或 header 已带 token |
| 未鉴权 router 加 Depends 可能影响内部调用方 | 中 | 仅对**外部可达的 endpoint** 加；内部 service-to-service 调用如有需要可豁免（但本次盘点未发现内部反向调用） |

## 8. 子文档目录（specs / todos / orchestration）

下列 spec 与 §3 威胁面分类一一对应（每个 spec 覆盖一类高危威胁面）：

| Spec 文件 | 覆盖的威胁面（§3） | 主要内容 |
|---|---|---|
| `specs/01-auth-and-access-control.md` | §3.1 | 未鉴权 router、Session 中间件加固、admin endpoint 检查 |
| `specs/02-cors-and-secure-headers.md` | §3.2、§3.7（部分） | CORS 通配符修正、`/docs`/`/redoc`/`/openapi.json` 生产暴露策略、缺失的安全响应头（X-Content-Type-Options、Frame-Options、CSP 等） |
| `specs/03-external-process-injection.md` | §3.3 | yt-dlp / ffmpeg / preview_proxy 的 URL & 命令参数防护、SSRF 阻断 |
| `specs/04-path-traversal-and-upload.md` | §3.4 | `storage_service._validate_path` 加固、各上传 router 复核、文件名 sanitize |
| `specs/05-secrets-and-config-exposure.md` | §3.5 | `.env` 文件 git 状态、日志中敏感字段脱敏、前端 LLM_API_KEY fallback、env.template 修正 |
| `specs/06-misc-and-report-finalize.md` | §3.6、§3.7（剩余） | 不安全反序列化检查、缓存键完整性、最终 `REPORT.md` 生成 |

附属文件：

- `todos/0N-*.md` —— 每个 spec 对应一份 TODO（含依赖元数据，编号与 spec 对齐）
- `task-orchestration.md` —— 依赖图、执行阶段、Agent 分配（DEV-N / REVIEWER-N / TESTER-N）

> 注：以上 6 个 spec 为本次规划的最终切分；若 Phase 4 审计中发现某类威胁面下问题为零，对应 spec 可标记为"无高危项，跳过修复"但仍需在 REPORT 中说明扫描覆盖。

## 9. 完成准则（Definition of Done）

整个项目"完成"当且仅当：

- [ ] 所有 spec 中标记为 **HIGH（CVSS ≥ 7.0）** 的漏洞均有修复补丁
- [ ] 每个修复补丁有 ≥ 1 个回归测试（正向调用 + 攻击向量阻断）
- [ ] `pytest backend-services/basic-service/tests/ -v` 全 PASS
- [ ] 涉及前端的修复，`npm run type-check` 与 `npm run lint` 全 PASS
- [ ] `docs/plans/high-risk-security-fixes/REPORT.md` 简要报告产出，每个修复 ≤ 6 行
- [ ] 任何**未修复**的高危项必须显式说明原因（用户否决 / 范围外 / 修复风险大于收益等）
