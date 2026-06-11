# Global Execution Context: dead-code-cleanup

Accumulated context from all execution phases. Each agent MUST read this
file before starting work to understand the full project history.

## 治理与编排速览
- 模式：tripower_tokens（三权分立 + Token 经济），团队 = Google Core Engineering Team
- 分支：`feat/local-video-editing-refactor`，无远程服务器
- Phase 0：orchestrator 采集基线（清理前）→ Phase 1：dev-01/02/03 并行（只改不提交）→ Phase 2：dev-04 验证+提交
- **红线**：dev-01 不碰 `clipboard.ts`/`AgentMessageBubble`/`AgentToolCallCard`；dev-02 不加 `ops/_*.sh` 规则、不重复现有 gitignore；dev-03 不删 `_dp_upload2.py`/`_dp_wait2.py`
- **提交权独属 dev-04**；Phase 1 任何 dev 不得 `git commit`

---

## Phase 0 — 清理前基线（2026-06-11）

| 门禁 | 退出码 | 结果 |
|------|--------|------|
| type-check (`tsc --noEmit`) | 0 | 干净，无类型错误 |
| lint (`next lint`) | 1 | ~24 warning，**0 error**（no-unused-vars / no-explicit-any，既存） |
| build (`next build`) | 0 | 成功 |
| test (`vitest run`) | 1 | **3 failed / 1317 passed（共 1320）** |
| pytest | N/A | 后端无 venv；后端源码本次不改 → 删改前后等价 |

**基线既存失败的 3 个测试（删改后允许继续失败，不得新增）：**
1. `src/components/video/timeline/__tests__/cachePlayback.integration.test.ts > integration: ingest → cache → preview URL swap > end-to-end happy path`
2. `src/lib/api/server/__tests__/backend-proxy.test.ts > T18 — builder BackendPath resolves dynamic params > awaits ctx.params and feeds them to the builder`
3. `src/lib/api/server/__tests__/backend-proxy.test.ts > T2 — POST with JSON body > forwards stringified JSON and preserves Content-Type`

> 验收标准：清理后 type-check 仍 exit 0；lint 不新增 error/warning；build 仍 exit 0；test 失败集 ⊆ 上述 3 个（删 `usePlaybackWaitState.test.ts` 会使总数减少，属正常）。

---
