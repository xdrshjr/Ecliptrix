# Spec 06：杂项高危检查 + 最终报告

> 覆盖 master-plan §3.6（不安全反序列化）+ §3.7（信息暴露 openapi 部分）+ REPORT.md 生成

## 1. 范围

- AgentWorkflow.workflow_data 反序列化是否使用 `eval/pickle/yaml.load(unsafe)`
- 静音/TTS 缓存命中是否基于客户端可控的哈希（缓存中毒）
- `/docs`、`/redoc`、`/openapi.json` 在生产环境是否开放
- 最终生成 `docs/plans/high-risk-security-fixes/REPORT.md`，汇总所有 spec 中确认并修复的高危项

**不包含：**
- 工作流执行引擎自身的逻辑安全（非反序列化层面）
- 其他规模较大的重构提案

## 2. 已识别的具体威胁点

### V06-A：反序列化层

- **位置：** `app/models/db_models.py` AgentWorkflow.workflow_data（JSON 类型）、`app/services/workflow_*.py` 读取处
- **机制核验项（DEV agent 实际 grep）：**
  - `yaml.load(` 是否未用 `Loader=SafeLoader`
  - `pickle.loads(` 是否被用于任何来自客户端的数据
  - `eval(` / `exec(` 在 service / router 中是否存在
- **CVSS v3.1：** 如果发现 unsafe yaml/pickle 在请求路径上 → 9.8（`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`，RCE）；若仅出现在内部配置加载（受限路径），则记入附录。
- **PoC 思路：** 构造恶意 yaml `!!python/object/apply:os.system ["...""]` 提交

### V06-B：TTS / 静音缓存中毒

- **位置：** `app/services/sentence_tts_service.py`、`app/services/silence_removal_service.py`、`app/services/audio_*` 中的缓存路径生成
- **机制：** 若缓存键是 `hash(client_supplied_text + voice_id)` 且无 user_id 隔离，攻击者可：
  - 提交特定文本生成 TTS → 缓存
  - 然后用相同文本 → 直接命中缓存（无 user_id 校验）→ 信息泄露的可能性低，但若有 user 个性化 prompt 注入缓存键则有越权风险
- **CVSS v3.1：** 视实际实现 5.0–7.0（典型 `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N` ≈ 5.4）；DEV agent 需 Read 后定级，仅在 ≥ 7.0 时纳入修复，否则记入附录。
- **本 spec 仅做核验，确认无高危即可**

### V06-C：openapi 在生产暴露

- **位置：** `app/main.py` FastAPI 实例创建处
- **机制：** 默认 FastAPI `/docs`、`/redoc`、`/openapi.json` 公开。本身不是漏洞，但帮助攻击者枚举 endpoint。
- **CVSS v3.1：** 5.3 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`（中危，单独不达高危阈值；本 spec 仍纳入修复以缩小攻击面，因实现成本极低）
- **修复策略：** 在 prod 模式下禁用（仅 dev 启用）

## 3. 修复方案

### 3.1 反序列化静态扫描

```pseudo
# DEV agent 操作：
1. grep -rn 'pickle.loads\|yaml.load\|eval(\|exec(' backend-services/basic-service/app/
2. 对每个匹配：
   a. 判断输入来源（用户请求 / 内部 / 配置文件）
   b. 若来自用户请求：替换为安全等价物：
      - yaml.load → yaml.safe_load
      - pickle.loads → 改用 json.loads（如果数据本来就是结构化）
      - eval → ast.literal_eval（如果只需字面量）
3. 把发现与修复列入 REPORT.md
```

### 3.2 TTS / 缓存键加固

```pseudo
# 在 cache_key 生成处：
def _cache_key(text: str, voice_id: str, user_id: str | None = None) -> str:
    # 关键：将 user_id 纳入 key，避免不同用户命中同一缓存项导致越权
    base = f"{user_id or 'public'}|{voice_id}|{text}"
    return hashlib.sha256(base.encode()).hexdigest()
```

仅当 DEV agent 实际找到 cache_key 中未包含 user_id 且业务上确实是 per-user 隔离的，才修。否则记入附录。

### 3.3 openapi 生产禁用

```pseudo
# app/main.py（FastAPI() 实例创建）：
docs_url = "/docs" if settings.env in ("development", "dev") else None
redoc_url = "/redoc" if settings.env in ("development", "dev") else None
openapi_url = "/openapi.json" if settings.env in ("development", "dev") else None

app = FastAPI(
    docs_url=docs_url,
    redoc_url=redoc_url,
    openapi_url=openapi_url,
    ...
)
```

### 3.4 最终报告 REPORT.md

DEV/Tester 协作产出 `docs/plans/high-risk-security-fixes/REPORT.md`，结构：

```markdown
# Ecliptrix 安全审计报告（2026-05-20）

## Executive Summary
- 修复高危漏洞数：N
- 已修复 / 已识别但未修（含原因）
- 强烈建议用户立即执行的运维动作：密钥轮换列表

## 高危漏洞修复明细
### V01-A 未鉴权 router 绕过 Session 中间件
- **CVSS:** 8.6 (AV:N/AC:L/PR:N/...)
- **位置:** app/main.py:427,432,457
- **攻击路径:** 一句话
- **修复:** commit/补丁说明 + 涉及文件
- **回归测试:** tests/security/test_01_auth.py::test_xxx

### V02-A CORS 通配符 + credentials
...

## 已识别但未修复
### Vxx-x 描述
- **原因:** 范围外 / 中危 / 修复风险 > 收益 / ...

## 运维动作建议（用户必读）
- [ ] 立即轮换以下密钥（参见 spec/05）：
  - LLM_API_KEY
  - ARK_API_KEY
  - VOLCANO_TTS_*
  - PEXELS_API_KEY
  - ...
- [ ] 部署后手工填写 `CORS_ALLOWED_ORIGINS`（参见 spec/02）
- [ ] 检查日志目录历史文件是否含敏感数据

## 测试覆盖
- pytest backend-services/basic-service/tests/security/ -v 全部 PASS
- 涉及前端文件：npm run type-check + npm run lint 全部 PASS
```

## 4. 接口与行为变化

| 项 | 变更前 | 变更后（prod） |
|---|---|---|
| `/docs` | 200 | 404 |
| `/redoc` | 200 | 404 |
| `/openapi.json` | 200 | 404 |
| dev 环境 | 不变 | 不变 |
| 反序列化路径 | 视发现 | 替换为 safe 等价 |

## 5. 验证策略

`backend-services/basic-service/tests/security/test_06_misc.py`：

- **正向：**
  - dev 模式下 GET `/docs` → 200 + HTML
  - 反序列化合法 JSON / yaml 内容 → OK
- **攻击向量：**
  - prod 模式下 GET `/docs` → 404
  - prod 模式下 GET `/openapi.json` → 404
  - 提交恶意 yaml `!!python/object/apply:os.system [...]` → 拒绝或安全失败（依赖 spec/03 是否触达该路径）
- **静态扫描：**
  - 跑 `grep -rn 'yaml.load(' backend-services/basic-service/app/` → 期望仅匹配 `safe_load` 或带 `Loader=SafeLoader`
  - 跑 `grep -rn 'pickle.loads\|exec(\|^[^#]*eval(' backend-services/basic-service/app/` → 期望空 / 仅安全用法

## 6. 依赖关系

- **depends_on:** spec/01、spec/02、spec/03、spec/04、spec/05（REPORT.md 需要汇总所有修复）
- **blocks:** 无
- **parallel_group:** C（最后阶段，所有 A/B 完成后启动）

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| TTS 缓存键修改可能让现存缓存全部 miss | 不强制改变现有 cache file naming，只在新写入时使用新 key；旧缓存命中走 fallback |
| openapi 在 prod 禁用后某些前端 sdk 生成失败 | 项目自身不通过 openapi 生成 sdk；用户若有外部接入需求可临时通过 env 重新开启 |
| REPORT 中列出密钥泄露可能引起恐慌 | 报告语言中性，明确"建议轮换"而非"已被滥用" |
