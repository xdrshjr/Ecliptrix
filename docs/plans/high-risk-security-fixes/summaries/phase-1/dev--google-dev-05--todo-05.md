# DEV Summary — google-dev-05 — TODO 05 (Secrets & Config Exposure)

- **Agent:** google-dev-05
- **Spec:** [`specs/05-secrets-and-config-exposure.md`](../../specs/05-secrets-and-config-exposure.md)
- **TODO:** [`todos/05-secrets-and-config-exposure.md`](../../todos/05-secrets-and-config-exposure.md)
- **Phase:** 1 (parallel group A)
- **Date:** 2026-05-20

---

## Outcome

`PASS` — all in-scope items (阶段 A→H) addressed; 18/18 unit tests green.

## Scope Covered

| Vuln  | Title                                          | Status   |
| ----- | ---------------------------------------------- | -------- |
| V05-A | `.env*` tracked in git (real credentials)      | FIXED    |
| V05-B | `.gitignore` insufficient (futures-proofing)   | FIXED    |
| V05-C | Frontend `LLM_API_KEY` env fallback            | HARDENED |
| V05-D | Log middleware leaks Authorization / Cookie    | LIB DONE |
| V05-E | `env.template` placeholder normalization       | FIXED    |

---

## Concrete Changes

### V05-A — `git rm --cached` for credential-bearing .env files

Removed from git index (working copies preserved on disk; backups also saved
as `*.local.backup` files which are now `.gitignore`-blocked):

```
.env
.env.example
backend-services/basic-service/.env
backend-services/basic-service/.env.bak
env-config/haowang-cloud/.env
env-config/local-kt/.env
```

`ops/config.env` was inspected and **kept tracked** — it contains only the
default-doc'd database password (`ecliptrix`/`ecliptrix`) which matches the
public install.sh defaults, not real credentials.

### V05-B — `.gitignore` extension

Appended (kept existing rules untouched) at `.gitignore`:

- `.env`, `.env.*`, `**/.env`, `**/.env.*` with allow-list for
  `**/env.template`, `**/.env.example`, `ops/config.env`.
- `*.pyo`, `*.pyd`, `out/`, `*.tsbuildinfo`, `.vscode/`.
- `*.log`, `backend-services/basic-service/logs/`.
- `backend-services/basic-service/static/cached_materials/`.
- `.coverage`, `htmlcov/`, `.pytest_cache/`.
- `*.local.backup` (transitional safety net for this fix).

### V05-C — Frontend LLM_API_KEY fallback hardening

`src/app/api/chat/route.ts` — the route runs on the Next.js **server**
runtime only (no `NEXT_PUBLIC_` prefix → not bundled into client). Verified
`next.config.js` does **not** declare `env`, `publicRuntimeConfig`, or
DefinePlugin entries that would expose `LLM_API_KEY` to the browser.

Added explicit warn log on fallback that records only the host + model
(never the key value), and clarifying comment that documents the
server-only constraint.

### V05-D — Log redaction library

New file `backend-services/basic-service/app/security/log_redact.py`
exporting `redact_headers`, `redact_body`, `redact_string`, `REDACTED`.

- Header redaction covers `authorization`, `cookie`, `set-cookie`,
  `x-session-token`, `x-api-key`, `x-api-app-key`, `x-api-access-key`,
  `x-auth-token`, `proxy-authorization` (all case-insensitive).
- Body key matcher uses substring detection for `password`, `passwd`,
  `secret`, `token`, `api_key`, `apikey`, `access_key`, `private_key`,
  `session_token`, `active_session_token`, `authorization`, `credential`.
- String regex pass catches `Bearer …`, `Basic …`, `sk-…` (≥20 chars),
  and `api_key=…` / `session_token=…` query-string patterns.
- Recurses into nested dicts, lists, tuples; primitives pass through.
- `__init__.py` re-exports the new symbols alongside dev-03's `url_guard`.

### V05-E — `env.template` placeholder normalization

- `env.template` (root): replaced live `FAST_LLM_API_KEY=sk-...` with
  `your_fast_llm_api_key_here`; added clarifying banner at top.
- `backend-services/basic-service/env.template`: added security banner
  pointing to spec 05. (Body already used `your_*_here` placeholders.)
- Regex sweep for `sk-[A-Za-z0-9]{20,}`, `tvly-`, zhipu `id.secret`, JWT
  patterns now returns zero hits in either template (asserted in test).

---

## main.py patches — DEFERRED (caller's instruction)

Per the task's "不要直接 Edit `app/main.py`" rule, the redaction library is
ready but the request-logging middleware (around line 218–221) was not
re-wired. The exact replacement for the integrator:

```python
# backend-services/basic-service/app/main.py near line 18
from app.security.log_redact import redact_headers

# ... inside logging_middleware (replace existing line ~220):
logger.debug(f"Request headers: {redact_headers(request.headers)}")
```

This is the only call site in `main.py` that logs full headers. Other
loggers in routers/services were grep'd and do not currently emit raw
headers, so no follow-on call-site rewrites are required for V05-D.

---

## Files Touched

- Modified: `.gitignore`
- Modified: `env.template`
- Modified: `backend-services/basic-service/env.template`
- Modified: `backend-services/basic-service/app/security/__init__.py`
- Modified: `src/app/api/chat/route.ts`
- New: `backend-services/basic-service/app/security/log_redact.py`
- New: `backend-services/basic-service/tests/security/test_05_secrets.py`
- Removed from git index (NOT from disk):
  - `.env`, `.env.example`
  - `backend-services/basic-service/.env`
  - `backend-services/basic-service/.env.bak`
  - `env-config/haowang-cloud/.env`
  - `env-config/local-kt/.env`

---

## Test Run

```
cd backend-services/basic-service
python -m pytest tests/security/test_05_secrets.py -v
============================== 18 passed in 0.16s ==============================
```

Test groups:

- `TestRedactHeaders` (5 tests) — header masking, case-insensitivity,
  iterable input, immutability.
- `TestRedactBody` (9 tests) — dict / list / nested / string redaction,
  primitive pass-through, immutability.
- `TestGitTracking` (2 tests) — `git ls-files` excludes `.env*` &
  `__pycache__/*` (skips cleanly if git unavailable).
- `test_env_template_has_no_real_keys` (2 parametrized) — both
  `env.template` files contain no `sk-…`, JWT, Tavily, or zhipu-style
  real credentials.

Existing tests not run as part of this task (scope-bounded).

---

## Keys to Rotate

The following keys were observed in **git-tracked** `.env*` files before
this commit. Even after `git rm --cached`, the values remain in
`git log -p` / `git show <past-commit>` history (no `filter-repo` was
run per spec 05 §3.1 user direction). Operators MUST rotate each of these
upstream before relying on the cleanup:

> Listed by KEY name only; values redacted from this document.

**Dashscope / Alibaba Qwen (`LLM_API_KEY` pool):**

- `LLM_API_KEY`
- `AI_VIDEO_MATCH_LLM_API_KEY`
- `FAST_LLM_API_KEY`
- `VL_LLM_API_KEY`

**Zhipu GLM (`AGENT_LLM_*`, `LLM_API_KEY` in some files):**

- `AGENT_LLM_API_01_KEY`
- `AGENT_LLM_API_02_KEY`
- `VIDEO_CUT_LLM_API_KEY` (Moonshot variant **and** Zhipu variant)

**External services:**

- `UNSPLASH_ACCESS_KEYS` (2 keys, comma-separated)
- `PEXELS_API_KEY` (3 keys, comma-separated)
- `TAVILY_API_KEYS` (2 keys, comma-separated)
- `RUNNING_HUB_API_KEY`
- `FREESOUND_API_KEY`
- `ARK_API_KEY` (ByteDance Seedance)

**Volcano (ByteDance speech):**

- `VOLCANO_TTS_API_KEY`
- `VOLCANO_TTS_APPID` + `VOLCANO_TTS_ACCESS_TOKEN` + `VOLCANO_TTS_SECRET_KEY`
- `VOLCANO_ASR_APPID` + `***REMOVED***` + `VOLCANO_ASR_SECRET_KEY`

**Aliyun OSS (storage):**

- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`

**Supabase (legacy `.env.bak` only; possibly still active):**

- `SUPABASE_ANON_KEY` (JWT — found leaking into
  `backend-services/basic-service/logs/app.log` 2834 times via the
  `hpack.hpack` DEBUG path — see "Log audit" below)
- `SUPABASE_URL`

**Database credential pair (from `ops/config.env`, NOT removed):**

- `DB_USER` / `DB_PASS` — currently `ecliptrix`/`ecliptrix` (default).
  Recommend changing for any prod-facing deployment but not a leak per se.

---

## Log Audit (incidental finding)

`backend-services/basic-service/logs/app.log` (175 345 lines) was grepped
for sensitive markers; **2 834 hits** containing `Bearer <JWT>`
authorization headers were written by the `hpack.hpack` DEBUG logger —
not by Ecliptrix code, but by the HTTP/2 layer of an httpx call.

**Mitigations already in place:**

- `app/main.py` already sets `logging.getLogger("httpx").setLevel(WARNING)`
  (lines 33–35).
- This DEBUG-level leakage requires `LOG_LEVEL=DEBUG` to surface; in
  `env.template` we keep `LOG_LEVEL=INFO`.

**Recommended follow-up** (out of TODO 05 scope, belongs in REPORT.md
ops-actions section):

```python
# app/main.py — add alongside the other quieting calls (line ~33):
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("h2").setLevel(logging.WARNING)
```

Plus rotate the Supabase JWT that is repeated 2 834 times in the log
(listed in "Keys to Rotate" above).

---

## Notes for Downstream Reviewer / Tester

1. The `.env.example` file at repo root contained **real** Dashscope keys
   (see git history). It was removed from the index. If you re-introduce
   a fresh `.env.example`, ensure it uses only `your_*_here` placeholders
   — the regex test in `test_05_secrets.py` will fail-loud otherwise.
2. The redaction library does NOT yet redact values nested inside JSON
   *strings* arbitrarily deep — by design (cheap & deterministic). If a
   future feature serializes a credential-bearing dict to JSON before
   logging, redact the dict before serialization.
3. No production-runtime behaviour changed. CORS, auth, request routing
   are all identical. Only file tracking + a server-side log warn + a
   library addition.
4. dev-03 created `app/security/__init__.py` and `url_guard.py` in
   parallel; my edits added log_redact exports alongside theirs and did
   not collide.

---

## Status

`PASS`
