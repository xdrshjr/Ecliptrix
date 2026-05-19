# DEV Summary — google-dev-06 — TODO 06 (Misc + Report Finalize)

## Meta

- **agent-id:** google-dev-06
- **role:** DEV
- **task:** todo-06 (misc high-risk checks + final REPORT.md)
- **phase:** 3 (parallel_group C — terminal stage)
- **timestamp:** 2026-05-20
- **verdict:** PARTIAL (REPORT.md content produced in agent reply, file write blocked by harness)

## Scope Covered

| Vuln  | Title                                       | Status      |
| ----- | ------------------------------------------- | ----------- |
| V06-A | Unsafe deserialisation (pickle/yaml/eval)   | NO HITS     |
| V06-B | TTS / silence cache-key per-user isolation  | NOT NEEDED  |
| V06-C | openapi.json / docs in production           | FIXED       |
| REPORT.md final aggregate                   | TEXT-ONLY (in agent reply; harness blocked .md write) |

## Phase A — Deserialisation Static Scan (V06-A)

Ran ripgrep over `backend-services/basic-service/app/` for:

- `pickle.loads` / `pickle.load`
- `yaml.load(` (any non-safe form)
- `\beval(` (word-boundary)
- `\bexec(` (word-boundary)

**Result: 0 matches in any of the four patterns.**

The codebase uniformly uses `yaml.safe_load` (in config loaders) and `json.loads`
for any client-data deserialisation. `AgentWorkflow.workflow_data` is a
SQLAlchemy JSON column, not pickle.

Verdict: **no fix required; verdict permanently locked by 4 new pytest
invariant tests + 1 ripgrep cross-check test**.

## Phase B — TTS / silence cache-key (V06-B)

Read `app/services/sentence_tts_service.py`, `silence_removal_service.py`,
`batch_tts_service.py`, and `tts_service.py`.

Grep for `cache_key|_cache_key|cache_path|hash|sha256|md5` against these
files returned no matches. The services do not implement a hash-keyed cache;
generated artifacts are named `tts_segment-{N}_{timestamp}_{uuid4-suffix}.mp3`
(per-request unique).

Verdict: **no per-user isolation risk; nothing to fix**.

## Phase C — openapi prod disable (V06-C)

Edited `app/main.py` directly (allowed per task spec — single agent, no
concurrency conflict). Change:

```python
_is_dev_env = (getattr(settings, "env", "production") or "production").lower() in (
    "development", "dev",
)
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="...",
    lifespan=lifespan,
    debug=settings.debug,
    docs_url="/docs" if _is_dev_env else None,
    redoc_url="/redoc" if _is_dev_env else None,
    openapi_url="/openapi.json" if _is_dev_env else None,
)
```

## Phase D — Tests

Created `backend-services/basic-service/tests/security/test_06_misc.py`
with 9 tests:

- `test_V06C_prod_disables_docs` — `/docs` / `/redoc` / `/openapi.json` all 404 in prod
- `test_V06C_dev_enables_docs` — `/docs` 200 with swagger markup; `/openapi.json` 200 with valid JSON
- `test_V06C_dev_alias_marker` — "dev" alias equivalent to "development"
- `test_V06C_main_py_uses_env_gated_docs_kwargs` — source-pattern lock against future refactor accidentally re-enabling docs in prod
- `test_V06A_no_pickle_loads` — walk every .py under app/ for `\bpickle\.loads?\s*\(`, drop comments → 0 hits required
- `test_V06A_no_unsafe_yaml_load` — same walk, `\byaml\.load\s*\(` minus `safe_load`/`Loader=Safe*` → 0 hits
- `test_V06A_no_eval` — `(?<![A-Za-z0-9_])eval\s*\(`
- `test_V06A_no_exec` — `(?<![A-Za-z0-9_])exec\s*\(`
- `test_V06A_grep_subprocess_matches_python_walk` — when ripgrep is available, cross-check (skipped when rg not on PATH)

## Artifacts

### Created

- `backend-services/basic-service/tests/security/test_06_misc.py`
- `docs/plans/high-risk-security-fixes/summaries/phase-3/dev--google-dev-06--todo-06.md` (this file)

### Modified

- `backend-services/basic-service/app/main.py` — FastAPI(...) instantiation gains
  `docs_url`/`redoc_url`/`openapi_url` env-gated kwargs + leading 5-line comment

### REPORT.md

**Blocked by harness** — the agent runtime intercepted the `Write` call to
`docs/plans/high-risk-security-fixes/REPORT.md` and required the content be
returned as text in the agent's final reply. The full ~250-line report body
is embedded verbatim in the dev-06 reply to the orchestrator; the
orchestrator should land it at the documented path.

## Test Run

```
cd backend-services/basic-service
python -m pytest tests/security/test_06_misc.py -v
================== 8 passed, 1 skipped, 23 warnings in 0.70s ==================

python -m pytest tests/security/ -v
================ 124 passed, 3 skipped, 43 warnings in 12.51s =================

python -m pytest tests/test_auth_middleware.py -v
====================== 22 passed, 23 warnings in 2.00s ========================
```

- 1 skip in test_06_misc = ripgrep cross-check (rg not on PATH in this
  sandbox; pure-Python scan still covered the invariant).
- 3 skips in tests/security/ total = above + 2 Unix-only symlink tests from
  test_04 (skipped on Windows).

No regression: phase-1/2 verdicts (79 + 37 = 116) plus this DEV's 8 = 124
green security tests; auth middleware untouched at 22.

## Issues & Risks

- **R1 (BLOCKING for spec deliverable):** Harness blocks creation of
  `docs/plans/high-risk-security-fixes/REPORT.md`. Workaround: REPORT content
  returned in DEV reply text; orchestrator should write it. No code or
  test impact — purely a doc-emission constraint.
- **R2:** The V06-A static-scan tests are *literal pattern matchers*. A
  future engineer who legitimately needs `eval`/`exec` (e.g. a sandboxed
  expression evaluator) will need to explicitly suppress these tests +
  refactor the regex to exclude their call site. This is intentional —
  high-risk primitives should require explicit justification.
- **R3:** No git stash / reset / checkout used anywhere in this task.
  Working tree was modified only via Edit / Write tools.

## Context for Downstream / Orchestrator

- **REPORT.md content** is in this agent's final reply (text). Length
  ~250 lines, matches spec/06 §3.4 template, references all phase-1/2
  V-stamped fixes with CVSS / location / attack path / fix / regression
  test mapping.
- **Verification commands** for the orchestrator to re-run before
  merging:
  ```
  cd backend-services/basic-service
  python -m pytest tests/security/ -v
  python -m pytest tests/test_auth_middleware.py -v
  ```
  Both must remain at 124+3 / 22+0.

---

PARTIAL
