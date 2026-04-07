#!/usr/bin/env bash
#
# scripts/preflight.sh
#
# Pre-deploy sanity check for the unified-api-auth-refactor.
#
# Run this from the local repo root BEFORE SSH-ing into Singapore-01.
# It bundles every "is the codebase deploy-ready?" check into one command:
#
#   1. The 4 hard grep guards from master-plan §10 (success criteria 1-3)
#   2. /login page exists
#   3. Smoke script syntax check
#   4. Optionally: npm test, npm run build, pytest (gated by --full)
#
# Usage:
#   bash scripts/preflight.sh           # quick checks (grep + file existence)
#   bash scripts/preflight.sh --full    # everything including tests + build
#   bash scripts/preflight.sh --no-color
#
# Exit code: 0 if all checks pass, 1 otherwise.
#
# This script is idempotent and read-only — safe to run repeatedly.

set -u

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
FULL=0
USE_COLOR=1
for arg in "$@"; do
  case "$arg" in
    --full)     FULL=1 ;;
    --no-color) USE_COLOR=0 ;;
    -h|--help)
      sed -n '3,22p' "$0" | sed 's/^# *//'
      exit 0
      ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
if [ "$USE_COLOR" = "1" ] && [ -t 1 ]; then
  C_RESET=$'\e[0m'
  C_GREEN=$'\e[32m'
  C_RED=$'\e[31m'
  C_YELLOW=$'\e[33m'
  C_GRAY=$'\e[90m'
  C_BOLD=$'\e[1m'
else
  C_RESET=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_GRAY=""; C_BOLD=""
fi

mark_pass() { printf "  %s[PASS]%s %s\n" "$C_GREEN" "$C_RESET" "$1"; }
mark_fail() { printf "  %s[FAIL]%s %s\n" "$C_RED" "$C_RESET" "$1"; }
mark_skip() { printf "  %s[SKIP]%s %s\n" "$C_GRAY" "$C_RESET" "$1"; }
mark_warn() { printf "  %s[WARN]%s %s\n" "$C_YELLOW" "$C_RESET" "$1"; }
section()   { printf "\n%s%s%s\n" "$C_BOLD" "$1" "$C_RESET"; }

# ---------------------------------------------------------------------------
# Resolve repo root (independent of cwd)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || { echo "Cannot cd to repo root: $REPO_ROOT" >&2; exit 2; }

# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

record_pass() { PASS_COUNT=$((PASS_COUNT + 1)); }
record_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); }
record_skip() { SKIP_COUNT=$((SKIP_COUNT + 1)); }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# grep_count <pattern> <path> — counts matches without printing them.
# Returns 0 always; the caller checks the printed integer.
grep_count() {
  local pattern="$1"
  local path="$2"
  if [ -d "$path" ]; then
    grep -rE "$pattern" "$path" 2>/dev/null | wc -l | tr -d ' '
  else
    echo 0
  fi
}

printf "%sEcliptrix unified-api-auth preflight%s\n" "$C_BOLD" "$C_RESET"
printf "Repo:    %s\n" "$REPO_ROOT"
printf "Mode:    %s\n" "$([ $FULL -eq 1 ] && echo 'FULL (tests + build)' || echo 'QUICK (grep + files only)')"
printf "Date:    %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# ===========================================================================
# Section 1: 4 hard grep guards (master-plan §10 success criteria 1-3)
# ===========================================================================
section "Section 1: hard grep guards"

# Guard #1 — no process.env.BACKEND_URL/BACKEND_SERVICE_URL/PYTHON_BACKEND_URL
# anywhere under src/app/api/ (T04 sweep contract)
G1=$(grep_count 'process\.env\.BACKEND_URL|process\.env\.BACKEND_SERVICE_URL|process\.env\.PYTHON_BACKEND_URL' "src/app/api")
if [ "$G1" = "0" ]; then
  mark_pass "G1 no raw process.env.BACKEND_URL/BACKEND_SERVICE_URL/PYTHON_BACKEND_URL in src/app/api/"
  record_pass
else
  mark_fail "G1 found $G1 raw env reads in src/app/api/ (expected 0)"
  record_fail
fi

# Guard #2 — no 'http://localhost:8000' literal anywhere under src/app/api/
# (T04 sweep removed all the fallback strings)
G2=$(grep_count "'http://localhost:8000'" "src/app/api")
if [ "$G2" = "0" ]; then
  mark_pass "G2 no literal 'http://localhost:8000' in src/app/api/"
  record_pass
else
  mark_fail "G2 found $G2 literal 'http://localhost:8000' in src/app/api/ (expected 0)"
  record_fail
fi

# Guard #2b — also check the entire src/ tree (master-plan §10 #3)
G2B=$(grep_count "'http://localhost:8000'" "src")
if [ "$G2B" = "0" ]; then
  mark_pass "G2b no literal 'http://localhost:8000' anywhere in src/"
  record_pass
else
  mark_fail "G2b found $G2B literal 'http://localhost:8000' in src/ (expected 0)"
  record_fail
fi

# Guard #3 — no NEXT_PUBLIC_BACKEND_URL or NEXT_PUBLIC_API_BASE_URL anywhere
# under src/ (T06 direct-call migration)
G3=$(grep_count 'NEXT_PUBLIC_BACKEND_URL|NEXT_PUBLIC_API_BASE_URL' "src")
if [ "$G3" = "0" ]; then
  mark_pass "G3 no NEXT_PUBLIC_BACKEND_URL/NEXT_PUBLIC_API_BASE_URL in src/"
  record_pass
else
  mark_fail "G3 found $G3 NEXT_PUBLIC backend refs in src/ (expected 0)"
  record_fail
fi

# Guard #4 — no getAuthHeaders helper anywhere under src/ (T05 lib/api refactor)
G4=$(grep_count 'function getAuthHeaders|const getAuthHeaders' "src")
if [ "$G4" = "0" ]; then
  mark_pass "G4 no getAuthHeaders helper in src/ (replaced by http-client)"
  record_pass
else
  mark_fail "G4 found $G4 getAuthHeaders definitions in src/ (expected 0)"
  record_fail
fi

# Guard #5 — no raw fetch('/api/...') anywhere in src/ outside the wrapper
# Added in Phase 3.6 after the dev-server test caught 31 unmigrated component
# files. The original AC#3/AC#4 guards only checked src/lib/api/ and src/app/api/,
# so component files (src/components/**) bypassing the wrapper went undetected.
# This guard widens the scope to all of src/ and excludes only the wrapper itself,
# the server-side proxy helper, and test files.
G5=$(grep -rE "fetch\(['\"]/api/" src \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v 'src/lib/api/http-client.ts' \
  | grep -v 'src/lib/api/server/backend-proxy.ts' \
  | grep -v '__tests__' \
  | wc -l | tr -d ' ')
if [ "$G5" = "0" ]; then
  mark_pass "G5 no raw fetch('/api/...') in src/ outside wrapper (Phase 3.6 hardened guard)"
  record_pass
else
  mark_fail "G5 found $G5 raw fetch('/api/...') call sites in src/ outside wrapper (expected 0)"
  record_fail
fi

# Guard #6 — every app.mount() in main.py has a matching ALLOWLIST_PREFIX entry
# Added in Phase 3.7 after the dev-server test served 401 on a /api/audio/generated/
# TTS file. The original spec only enumerated /api/storage/files/, missing 2 of the
# 4 static mounts. This guard parses the mount paths from main.py and asserts each
# one (with trailing slash) appears in the auth_middleware.py allowlist tuple.
MAIN_PY="backend-services/basic-service/app/main.py"
MIDDLEWARE_PY="backend-services/basic-service/app/middleware/auth_middleware.py"
G6_FAIL=0
if [ -f "$MAIN_PY" ] && [ -f "$MIDDLEWARE_PY" ]; then
  # Extract first arg of every app.mount("...", ...) call
  # Strip both the leading `app.mount("` and the trailing `"`
  MOUNTS=$(grep -oE 'app\.mount\("([^"]+)"' "$MAIN_PY" 2>/dev/null \
            | sed -e 's/app\.mount("//' -e 's/"$//')
  G6_MISSING=""
  for mount in $MOUNTS; do
    # Normalize: ensure trailing slash for prefix comparison
    case "$mount" in
      */) prefix="$mount" ;;
      *)  prefix="${mount}/" ;;
    esac
    # The /static/timeline_exports/ mount is covered by the broader /static/ prefix
    case "$prefix" in
      /static/*) continue ;;
    esac
    if ! grep -q "\"$prefix\"" "$MIDDLEWARE_PY" 2>/dev/null; then
      G6_MISSING="$G6_MISSING $prefix"
      G6_FAIL=$((G6_FAIL + 1))
    fi
  done
  if [ "$G6_FAIL" = "0" ]; then
    mark_pass "G6 every app.mount() in main.py is covered by ALLOWLIST_PREFIX (Phase 3.7 hardened guard)"
    record_pass
  else
    mark_fail "G6 found$G6_MISSING in app.mount() but missing from ALLOWLIST_PREFIX (expected 0 missing)"
    record_fail
  fi
else
  mark_skip "G6 main.py or auth_middleware.py not found — backend not present"
  record_skip
fi

# ===========================================================================
# Section 2: required files exist
# ===========================================================================
section "Section 2: required files exist"

REQUIRED_FILES=(
  "src/app/login/page.tsx"
  "src/lib/config/backend.ts"
  "src/lib/api/http-client.ts"
  "src/lib/api/server/backend-proxy.ts"
  "src/lib/api/auth.ts"
  "src/lib/api/workflowPreferences.ts"
  "src/lib/auth/storage-keys.ts"
  "scripts/smoke-api-auth.sh"
  "backend-services/basic-service/app/middleware/auth_middleware.py"
  "backend-services/basic-service/tests/test_auth_middleware.py"
  "ops/deploy.sh"
  "ops/healthcheck.sh"
  "vitest.config.ts"
  "vitest.integration.config.ts"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [ -f "$f" ]; then
    mark_pass "$f"
    record_pass
  else
    mark_fail "$f MISSING"
    record_fail
  fi
done

# ===========================================================================
# Section 3: backend middleware is registered in main.py
# ===========================================================================
section "Section 3: backend middleware registration"

if grep -q 'add_middleware(SessionAuthMiddleware)' backend-services/basic-service/app/main.py 2>/dev/null; then
  mark_pass "SessionAuthMiddleware registered in app/main.py"
  record_pass
else
  mark_fail "SessionAuthMiddleware NOT registered in app/main.py"
  record_fail
fi

# ===========================================================================
# Section 4: smoke script syntax check
# ===========================================================================
section "Section 4: smoke script syntax"

if bash -n scripts/smoke-api-auth.sh 2>/dev/null; then
  mark_pass "scripts/smoke-api-auth.sh bash -n OK"
  record_pass
else
  mark_fail "scripts/smoke-api-auth.sh has syntax errors"
  record_fail
fi

# ===========================================================================
# Section 5: env.template does NOT contain deprecated names
# ===========================================================================
section "Section 5: env.template cleanup"

# The deprecated names may appear in COMMENTS (documentation), but should
# NOT appear as bare assignments. Check that any line containing the names
# either starts with `#` (comment) or is absent entirely.
TEMPLATE_BAD=0
for var in BACKEND_SERVICE_URL PYTHON_BACKEND_URL NEXT_PUBLIC_BACKEND_URL NEXT_PUBLIC_API_BASE_URL; do
  if grep -E "^[[:space:]]*${var}=" env.template >/dev/null 2>&1; then
    mark_fail "env.template still has bare assignment: $var"
    TEMPLATE_BAD=$((TEMPLATE_BAD + 1))
    record_fail
  fi
done
if [ "$TEMPLATE_BAD" = "0" ]; then
  mark_pass "env.template has no bare deprecated-var assignments"
  record_pass
fi

# Verify BACKEND_URL IS present in env.template
if grep -E "^[[:space:]]*BACKEND_URL=" env.template >/dev/null 2>&1; then
  mark_pass "env.template defines BACKEND_URL"
  record_pass
else
  mark_fail "env.template does NOT define BACKEND_URL"
  record_fail
fi

# ===========================================================================
# Section 6 (full mode only): tests + build
# ===========================================================================
if [ "$FULL" = "1" ]; then
  section "Section 6: full validation (tests + build)"

  if [ -f package.json ]; then
    printf "  running: npm test\n"
    if npm test >/tmp/preflight-npm-test.log 2>&1; then
      tail -5 /tmp/preflight-npm-test.log | sed 's/^/    /'
      mark_pass "npm test"
      record_pass
    else
      tail -20 /tmp/preflight-npm-test.log | sed 's/^/    /'
      mark_fail "npm test (see /tmp/preflight-npm-test.log)"
      record_fail
    fi

    printf "  running: npm run type-check\n"
    if npm run type-check >/tmp/preflight-tsc.log 2>&1; then
      mark_pass "npm run type-check"
      record_pass
    else
      tail -20 /tmp/preflight-tsc.log | sed 's/^/    /'
      mark_fail "npm run type-check (see /tmp/preflight-tsc.log)"
      record_fail
    fi

    printf "  running: BACKEND_URL=http://localhost:8088 npm run build\n"
    if BACKEND_URL=http://localhost:8088 npm run build >/tmp/preflight-build.log 2>&1; then
      tail -5 /tmp/preflight-build.log | sed 's/^/    /'
      mark_pass "npm run build"
      record_pass
    else
      tail -20 /tmp/preflight-build.log | sed 's/^/    /'
      mark_fail "npm run build (see /tmp/preflight-build.log)"
      record_fail
    fi
  else
    mark_skip "no package.json — skipping npm checks"
    record_skip
  fi

  if command -v python >/dev/null 2>&1; then
    printf "  running: pytest tests/test_auth_middleware.py\n"
    if (cd backend-services/basic-service && python -m pytest tests/test_auth_middleware.py -q) >/tmp/preflight-pytest.log 2>&1; then
      tail -3 /tmp/preflight-pytest.log | sed 's/^/    /'
      mark_pass "pytest tests/test_auth_middleware.py"
      record_pass
    else
      tail -20 /tmp/preflight-pytest.log | sed 's/^/    /'
      mark_fail "pytest (see /tmp/preflight-pytest.log)"
      record_fail
    fi
  else
    mark_skip "no python on PATH — skipping pytest"
    record_skip
  fi
else
  section "Section 6: full validation"
  mark_skip "skipped (run with --full to include tests + build)"
  record_skip
fi

# ===========================================================================
# Summary
# ===========================================================================
section "Summary"
printf "%sPassed:%s  %d\n" "$C_GREEN" "$C_RESET" "$PASS_COUNT"
printf "%sFailed:%s  %d\n" "$C_RED" "$C_RESET" "$FAIL_COUNT"
printf "%sSkipped:%s %d\n" "$C_GRAY" "$C_RESET" "$SKIP_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  printf "\n%sPREFLIGHT FAILED — do NOT deploy.%s\n" "$C_RED" "$C_RESET"
  printf "Investigate the failures above before SSH-ing to Singapore-01.\n"
  exit 1
fi

printf "\n%sPreflight passed.%s You may proceed to runbook §1.\n" "$C_GREEN" "$C_RESET"
exit 0
