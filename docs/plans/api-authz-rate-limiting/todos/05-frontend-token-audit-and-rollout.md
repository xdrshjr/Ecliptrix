# TODO 05 — 前端 Token 审计与上线

> Spec: [`specs/05-frontend-token-audit-and-rollout.md`](../specs/05-frontend-token-audit-and-rollout.md)

## Dependencies

- `depends_on: [01]` —— 需 01 的 PUBLIC_ALLOWLIST 与 `AUTH_ENFORCE_DEFAULT_DENY` 开关定型,才能判定哪些路径无需 token、如何灰度上线。
- `blocks: [06]` —— 06 的「默认拒绝开启后无回归」验收依赖本任务完成。
- `parallel_group: B` —— 与 TODO 03 同组并行(均在 Phase 1 后启动,互不依赖)。
- WHY: 这是默认拒绝正式启用的前置闸门;审计结论与上线开关是 06 回归验收的前提。

## Tasks

### A. 现状核实(必做第一步)
- [ ] Read `src/lib/api/server/backend-proxy.ts`:确认 `buildForwardedHeaders` 已对每个代理调用透传 `Authorization` + legacy `x-session-token`;`createPassthroughRoute`/`backendProxy` 覆盖面。
- [ ] Read `src/lib/api/http-client.ts:292,328-330`:`requireAuth` 默认 true + Bearer 自动注入。
- [ ] 结论:R1 真实风险收窄为「核实助手覆盖面 + 枚举少数逃生通道」,非逐路由补转发。

### B. 代理路由审计
- [ ] 枚举 `src/app/api/**/route.ts`(100+),核对是否均经 `backend-proxy` 助手;列出未经助手的路由。
- [ ] 产出清单:每路由 → 经助手?/ 若未经是否显式转发 auth → 需修复(Y/N)。

### C. 逃生通道审计
- [ ] 枚举标注 `SWEEP-EXCEPTION`/`Pattern E` 或自拼裸 `fetch` 的路由(如 chat、video-editing-agent、video-proxy)。
- [ ] 逐项分类:「无需后端会话(第三方 LLM/CDN 直连)」或「需会话且已/未转发 token」→ 需修复(Y/N)。
- [ ] 重点核查媒体/流式/SSE/下载/`<video src>`:媒体走 cookie 认证(01 已列白名单),确认 cookie 正确下发;SSE/流式确认带 token。

### D. 修复
- [ ] 未接入助手且需会话的路由 → 收口到 `backend-proxy` 助手(优先)或显式补 `Authorization`/`x-session-token`。
- [ ] 绕过 http-client 的裸 fetch(需会话)→ 收口或显式补 token。
- [ ] 第三方直连例外 → 文档化标注「无需 auth」并保留。

### E. 上线/灰度
- [ ] 确认 `AUTH_ENFORCE_DEFAULT_DENY` 开关(与 01 联动),默认 `false`;限流 `enabled` 开关与之独立。
- [ ] 编写上线 checklist:① 合并代码开关 false → ② 完成审计修复 → ③ 测试环境置 true 跑 06 集成 + 手动回归(登录/视频编辑/TTS/工作流/播放)→ ④ 生产置 true。
- [ ] (可选)宽限记录模式:置 true 前先开仅日志模式,记录无 token 请求路径二次确认漏点。

### F. 自检
- [ ] 全部代理路由有转发结论;逃生通道清单逐项有结论。
- [ ] `AUTH_ENFORCE_DEFAULT_DENY=true` 下核心流程端到端无回归(本地/测试环境)。
- [ ] 写执行摘要(审计清单 + 上线 checklist + 开关说明)供 06。
