# TODO 06：杂项高危检查 + 最终报告

> 对应 spec：[`specs/06-misc-and-report-finalize.md`](../specs/06-misc-and-report-finalize.md)

## Dependencies

- **depends_on:** `01`, `02`, `03`, `04`, `05`（REPORT.md 需要汇总全部 spec 的修复结果）
- **blocks:** 无
- **parallel_group:** C

**依赖原因**：REPORT.md 必须包含 spec 01-05 的 verdict 与测试结果。该任务作为收尾阶段执行，确保信息完整。

## 任务清单

### 阶段 A：反序列化静态扫描

- [ ] A1 — `Grep -rn 'pickle.loads\|pickle.load' backend-services/basic-service/app/`
- [ ] A2 — `Grep -rn 'yaml.load(' backend-services/basic-service/app/`（不带 `safe_`）
- [ ] A3 — `Grep -rn 'eval(' backend-services/basic-service/app/`
- [ ] A4 — `Grep -rn 'exec(' backend-services/basic-service/app/`
- [ ] A5 — 对每个匹配判断输入来源：
  - 用户请求路径 → 立即修
  - 内部固定数据 → 不修，但在 REPORT 中提到
- [ ] A6 — 修复方式：
  - `yaml.load(x)` → `yaml.safe_load(x)`
  - `pickle.loads(client_data)` → `json.loads` 或重新设计
  - `eval(literal)` → `ast.literal_eval`

### 阶段 B：TTS / 静音缓存键

- [ ] B1 — Read `backend-services/basic-service/app/services/sentence_tts_service.py`、`silence_removal_service.py`，定位 `cache_key` 生成函数
- [ ] B2 — 检查 cache_key 是否包含 `user_id`：
  - 如不包含且业务上是 per-user 数据 → 加入；改造前需评估对现存缓存命中率的影响（仅新写入采用新 key，旧缓存按旧 key 命中）
  - 如缓存本就是 deterministic 的 public 数据（同文本同语音 → 同结果）→ 不需要 user_id，跳过

### 阶段 C：openapi 在生产禁用

- [ ] C1 — Read `app/main.py` 中 `FastAPI(...)` 实例化处
- [ ] C2 — 修改：
  ```pseudo
  is_dev = settings.env in ("development", "dev")
  app = FastAPI(
      docs_url="/docs" if is_dev else None,
      redoc_url="/redoc" if is_dev else None,
      openapi_url="/openapi.json" if is_dev else None,
      ...
  )
  ```
- [ ] C3 — 注意：openapi 在 prod 禁用后，FastAPI 的某些 dependency injection 仍工作，不影响业务

### 阶段 D：测试

- [ ] D1 — 新建 `backend-services/basic-service/tests/security/test_06_misc.py`
- [ ] D2 — 反序列化测试：
  - mock settings.env=production → GET `/docs` → 404
  - mock settings.env=development → GET `/docs` → 200
- [ ] D3 — 静态测试（subprocess）：
  - `grep -rn 'yaml.load(' app/` 仅匹配 `safe_load` 或带 `Loader=SafeLoader`
  - `grep -rn 'pickle.loads' app/` 仅匹配安全/受信任使用

### 阶段 E：生成 REPORT.md

- [ ] E1 — 创建 `docs/plans/high-risk-security-fixes/REPORT.md`
- [ ] E2 — 模板（详见 spec/06 §3.4）：
  - Executive Summary（数字概览）
  - 高危漏洞修复明细（按 V01-A、V02-A、V03-A、V03-C、V03-E、V04-A、V04-B、V05-A、V05-D、V06-C 等列出）
  - 每项含：CVSS / 位置 / 攻击路径 / 修复点 / 回归测试文件:行
  - 已识别但未修（含原因）
  - 运维动作清单（含密钥轮换提醒 + 部署后 CORS 配置）
  - 测试覆盖统计

- [ ] E3 — 从 `docs/plans/high-risk-security-fixes/summaries/` 下的所有 dev/reviewer/tester 摘要中提取真实结果，**不要写"预期值"**，必须基于 Phase 5 整合验证后的事实
- [ ] E4 — 最终行数控制在 100-200 行，每个漏洞 5-8 行

### 阶段 F：最终验证

- [ ] F1 — 跑 `pytest backend-services/basic-service/tests/security/ -v` 全绿
- [ ] F2 — 跑全套 `pytest backend-services/basic-service/tests/ -v` 验证无回归
- [ ] F3 — `npm run type-check` + `npm run lint` 全绿
- [ ] F4 — 启动 backend + frontend，手工冒烟登录 + 创建简单工作流 + 上传一个文件
- [ ] F5 — 在 REPORT.md 最末加"验证结果"段落，记录全部测试与冒烟结果

## 完成准则

- [ ] V06-A/B/C 均有结论（修复或确认无问题）
- [ ] REPORT.md 已生成，含全部 spec 的修复明细 + 运维动作 + 验证结果
- [ ] 全套后端测试 100% 绿
- [ ] 前端 type-check 与 lint 100% 绿
- [ ] 冒烟测试通过
