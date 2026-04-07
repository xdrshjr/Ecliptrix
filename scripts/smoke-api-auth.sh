#!/usr/bin/env bash
#
# scripts/smoke-api-auth.sh
#
# Production smoke test for the unified-api-auth refactor.
#
# Spec: docs/plans/unified-api-auth-refactor/specs/07-testing-suite.md section 6
#
# Usage:
#   bash scripts/smoke-api-auth.sh <base-url>
#   bash scripts/smoke-api-auth.sh https://ecliptrix.com
#   bash scripts/smoke-api-auth.sh http://localhost:3000 --no-color
#
# Env (optional):
#   SMOKE_USER  - username for Phase 3 (authenticated calls)
#   SMOKE_PASS  - password for Phase 3
#   If either is unset, Phase 3 is skipped with a clear note.
#
# Phases:
#   1. Allowlisted endpoints anonymous → expect 2xx / 4xx-not-401
#   2. Protected endpoints anonymous   → expect 401
#   3. Authenticated calls             → expect non-401, non-403
#
# Exit code: 0 if all checks pass, 1 otherwise.
#
# Run from anywhere — no cwd assumptions. The script self-resolves the
# script directory if it ever needs to read sibling files.

set -u   # NOTE: deliberately NOT `set -e`; we want to keep going on failure
         # so the final summary lists every failing endpoint at once.

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
USE_COLOR=1
for arg in "$@"; do
  if [ "$arg" = "--no-color" ]; then USE_COLOR=0; fi
done

if [ "$USE_COLOR" = "1" ] && [ -t 1 ]; then
  C_RESET=$'\e[0m'
  C_GREEN=$'\e[32m'
  C_RED=$'\e[31m'
  C_YELLOW=$'\e[33m'
  C_GRAY=$'\e[90m'
  C_BOLD=$'\e[1m'
else
  C_RESET=""
  C_GREEN=""
  C_RED=""
  C_YELLOW=""
  C_GRAY=""
  C_BOLD=""
fi

mark_pass() { printf "  %s✓%s %s\n" "$C_GREEN" "$C_RESET" "$1"; }
mark_fail() { printf "  %s✗%s %s\n" "$C_RED" "$C_RESET" "$1"; }
mark_skip() { printf "  %s—%s %s\n" "$C_GRAY" "$C_RESET" "$1"; }
section()   { printf "\n%s%s%s\n" "$C_BOLD" "$1" "$C_RESET"; }

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
BASE_URL=""
for arg in "$@"; do
  case "$arg" in
    --no-color) ;;
    -*) printf "%sUnknown flag: %s%s\n" "$C_RED" "$arg" "$C_RESET" >&2; exit 2 ;;
    *) BASE_URL="$arg" ;;
  esac
done

if [ -z "$BASE_URL" ]; then
  cat >&2 <<'USAGE'
Usage: bash scripts/smoke-api-auth.sh <base-url> [--no-color]

  base-url    e.g. https://ecliptrix.com  or  http://localhost:3000

Optional env:
  SMOKE_USER  username for Phase 3
  SMOKE_PASS  password for Phase 3
USAGE
  exit 2
fi

# Strip a trailing slash from BASE_URL so concatenation is consistent.
BASE_URL="${BASE_URL%/}"

# Verify curl is on PATH.
if ! command -v curl >/dev/null 2>&1; then
  printf "%sFATAL: curl is not installed%s\n" "$C_RED" "$C_RESET" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Counters and failure list
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILED_LINES=()

record_pass() { PASS_COUNT=$((PASS_COUNT + 1)); }
record_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_LINES+=("$1")
}
record_skip() { SKIP_COUNT=$((SKIP_COUNT + 1)); }

# ---------------------------------------------------------------------------
# HTTP helper — returns the status code on stdout.
# Usage: status=$(http_status METHOD URL [BEARER] [BODY])
# ---------------------------------------------------------------------------
http_status() {
  local method="$1"
  local url="$2"
  local bearer="${3:-}"
  local body="${4:-}"
  local args=(-s -o /dev/null -w "%{http_code}" -X "$method" --max-time 15)
  if [ -n "$bearer" ]; then
    args+=(-H "Authorization: Bearer $bearer")
  fi
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" --data "$body")
  fi
  local out
  out=$(curl "${args[@]}" "$url" 2>/dev/null) || out="000"
  # `-w '%{http_code}'` always prints exactly 3 digits with no newline. If
  # curl somehow produced extra bytes (e.g. progress meter on a misconfigured
  # terminal), keep only the LAST 3 characters which is the http code.
  if [ -z "$out" ]; then out="000"; fi
  printf "%s" "${out: -3}"
}

# ---------------------------------------------------------------------------
# Endpoint lists
#
# These are derived from `docs/plans/unified-api-auth-refactor/audit/
# backend-route-protection.md` (T01 audit) and the `route-sweep-audit.md`
# (T04 audit). The smoke script always hits the FRONTEND (Next.js / Nginx)
# URL shape, not the backend port directly.
# ---------------------------------------------------------------------------

# Phase 1: anonymous calls to allowlisted endpoints. Format: METHOD|PATH|BODY
# - Allowlist (T01 spec section 4):
#   /api/auth/login, /api/auth/register, /api/auth/validate-session,
#   /api/health, /docs, /redoc, /openapi.json, /static/, /api/storage/files/
# - Note: /api/health and /api/auth/register do NOT exist as Next.js routes
#   (only on the backend), so this list focuses on the routes the smoke
#   script can actually hit through the frontend layer.
ALLOWLIST_ENDPOINTS=(
  "POST|/api/auth/login|{\"username\":\"\",\"password\":\"\"}"
  "POST|/api/auth/validate-session|{\"user_id\":\"\",\"session_token\":\"\"}"
)

# Phase 2: anonymous calls to protected endpoints. We expect 401 from each.
# At least 20 entries spanning all major modules.
PROTECTED_ENDPOINTS=(
  "POST|/api/video-search|{}"
  "POST|/api/video-compose|{}"
  "GET|/api/llm/models|"
  "POST|/api/intent-detection/detect|{}"
  "GET|/api/admin/users/list|"
  "GET|/api/system-settings/categories|"
  "GET|/api/system-settings/audit-log|"
  "GET|/api/model-settings/providers|"
  "GET|/api/model-settings/providers/saved|"
  "GET|/api/model-settings/assignments|"
  "POST|/api/workflow/ai-video-generate|{}"
  "POST|/api/workflow-preferences/save|{}"
  "POST|/api/workflow-preferences/load|{}"
  "POST|/api/audio/transcribe-local|{}"
  "POST|/api/storyboard/generate|{}"
  "POST|/api/tts/convert|{}"
  "POST|/api/timeline-export|{}"
  "GET|/api/config|"
  "POST|/api/ai-mixed-editing|{}"
  "POST|/api/youtube/download|{}"
  "POST|/api/ark-image/generate|{}"
  "POST|/api/video-understanding-script|{}"
  "GET|/api/storage/user-materials|"
  "POST|/api/workflow/agent/save|{}"
)

# Phase 3: authenticated calls. We expect anything except 401 / 403, since
# these are simple GETs (or trivial POSTs) that may legitimately return 200,
# 422, or 5xx for missing third-party API keys.
AUTH_OK_ENDPOINTS=(
  "GET|/api/llm/models|"
  "GET|/api/model-settings/providers|"
  "GET|/api/model-settings/providers/saved|"
  "GET|/api/model-settings/assignments|"
  "GET|/api/config|"
  "GET|/api/storage/user-materials|"
)

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
printf "%sEcliptrix unified-api-auth smoke test%s\n" "$C_BOLD" "$C_RESET"
printf "Target: %s\n" "$BASE_URL"
printf "Date:   %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# ---------------------------------------------------------------------------
# Phase 1: allowlist anonymous (expect non-401; 2xx, 4xx-not-401, or 422 are ok)
# ---------------------------------------------------------------------------
section "Phase 1: allowlist anonymous (expect non-401)"

for entry in "${ALLOWLIST_ENDPOINTS[@]}"; do
  method="${entry%%|*}"
  rest="${entry#*|}"
  path="${rest%%|*}"
  body="${rest#*|}"
  url="$BASE_URL$path"
  status=$(http_status "$method" "$url" "" "$body")
  if [ "$status" = "401" ] || [ "$status" = "000" ]; then
    mark_fail "$method $path -> $status (expected non-401, non-network-error)"
    record_fail "P1 $method $path -> $status"
  else
    mark_pass "$method $path -> $status"
    record_pass
  fi
done

# ---------------------------------------------------------------------------
# Phase 2: protected anonymous (expect 401)
# ---------------------------------------------------------------------------
section "Phase 2: protected endpoints anonymous (expect 401)"

for entry in "${PROTECTED_ENDPOINTS[@]}"; do
  method="${entry%%|*}"
  rest="${entry#*|}"
  path="${rest%%|*}"
  body="${rest#*|}"
  url="$BASE_URL$path"
  status=$(http_status "$method" "$url" "" "$body")
  if [ "$status" = "401" ]; then
    mark_pass "$method $path -> 401"
    record_pass
  else
    mark_fail "$method $path -> $status (expected 401)"
    record_fail "P2 $method $path -> $status"
  fi
done

# ---------------------------------------------------------------------------
# Phase 3: authenticated success (only if SMOKE_USER + SMOKE_PASS set)
# ---------------------------------------------------------------------------
section "Phase 3: authenticated calls (expect non-401, non-403)"

# `:-` defaults to empty if unset, even under `set -u`.
SMOKE_USER_VAL="${SMOKE_USER:-}"
SMOKE_PASS_VAL="${SMOKE_PASS:-}"

if [ -z "$SMOKE_USER_VAL" ] || [ -z "$SMOKE_PASS_VAL" ]; then
  mark_skip "SMOKE_USER and/or SMOKE_PASS unset — Phase 3 skipped"
  record_skip
else
  # Login to capture token
  login_url="$BASE_URL/api/auth/login"
  login_body=$(printf '{"username":"%s","password":"%s"}' "$SMOKE_USER_VAL" "$SMOKE_PASS_VAL")
  login_response=$(curl -s --max-time 15 -X POST -H "Content-Type: application/json" \
    --data "$login_body" "$login_url" 2>/dev/null || echo "")

  # Extract session_token via grep + sed (no jq dependency).
  TOKEN=$(printf "%s" "$login_response" | grep -o '"session_token"[^,}]*' | head -1 \
    | sed -E 's/.*"session_token"[[:space:]]*:[[:space:]]*"?([^",}]*)"?.*/\1/')

  if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    mark_fail "Login did not return a session_token (response: ${login_response:0:200})"
    record_fail "P3 login failed"
  else
    mark_pass "Login OK, token captured (length=${#TOKEN})"
    record_pass

    for entry in "${AUTH_OK_ENDPOINTS[@]}"; do
      method="${entry%%|*}"
      rest="${entry#*|}"
      path="${rest%%|*}"
      body="${rest#*|}"
      url="$BASE_URL$path"
      status=$(http_status "$method" "$url" "$TOKEN" "$body")
      # Phase 3 PASS = anything except 401/403/000.
      if [ "$status" = "401" ] || [ "$status" = "403" ] || [ "$status" = "000" ]; then
        mark_fail "$method $path -> $status (expected non-401/403)"
        record_fail "P3 $method $path -> $status"
      else
        mark_pass "$method $path -> $status"
        record_pass
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Summary"
printf "%sPassed:%s  %d\n" "$C_GREEN" "$C_RESET" "$PASS_COUNT"
printf "%sFailed:%s  %d\n" "$C_RED" "$C_RESET" "$FAIL_COUNT"
printf "%sSkipped:%s %d\n" "$C_GRAY" "$C_RESET" "$SKIP_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  printf "\n%sFailures:%s\n" "$C_RED" "$C_RESET"
  for line in "${FAILED_LINES[@]}"; do
    printf "  - %s\n" "$line"
  done
  exit 1
fi

printf "\n%sAll checks passed.%s\n" "$C_GREEN" "$C_RESET"
exit 0
