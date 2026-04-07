#!/usr/bin/env bash
# =============================================================================
# Ecliptrix - Watchdog 健康检查脚本
#
# 检查已配置服务的 HTTP 存活性。在 WATCHDOG_FAIL_THRESHOLD 次连续失败后
# 重启对应的 systemd 服务。由 ecliptrix-watchdog.timer 触发。
#
# 由 web-deployer skill 生成 — 2026-04-07
#
# 使用方法: 通常由 systemd 调用，不需要手动执行
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.env"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Configuration file not found: $CONFIG_FILE" >&2
  exit 1
fi
# shellcheck source=config.env
source "$CONFIG_FILE"

# 默认值
PROJECT_NAME="${PROJECT_NAME:-ecliptrix}"
BACKEND_PORT="${BACKEND_PORT:-8088}"
FRONTEND_PORT="${FRONTEND_PORT:-3088}"
WATCHDOG_FAIL_THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-3}"
WATCHDOG_STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/ecliptrix-watchdog}"

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:${BACKEND_PORT}/health}"
BACKEND_HEALTH_FALLBACK_URL="${BACKEND_HEALTH_FALLBACK_URL:-http://localhost:${BACKEND_PORT}/docs}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-http://localhost:${FRONTEND_PORT}/}"

mkdir -p "$WATCHDOG_STATE_DIR"

# ---------------------------------------------------------------------------
# 日志（写到 syslog 与 stdout，由 journal 捕获）
# ---------------------------------------------------------------------------
log() {
  logger -t "${PROJECT_NAME}-watchdog" "$*"
  echo "$*"
}

# ---------------------------------------------------------------------------
# flock 防并发
# ---------------------------------------------------------------------------
LOCK_FILE="$WATCHDOG_STATE_DIR/${PROJECT_NAME}-watchdog.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "另一个 healthcheck 正在运行，跳过本次。"
  exit 0
fi

# ---------------------------------------------------------------------------
# 健康检查函数
#   $1 — service 名称（backend / frontend）
#   $2 — 端口
#   $3 — systemd unit 名称
#   $4 — 主健康 URL
#   $5 — 备用健康 URL（可选）
# ---------------------------------------------------------------------------
check_service() {
  local name="$1"
  local port="$2"
  local unit="$3"
  local url="$4"
  local fallback_url="${5:-}"
  local fail_file="$WATCHDOG_STATE_DIR/${PROJECT_NAME}-watchdog-${name}-failures"
  local http_code

  http_code=$(curl -sf -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 30 "$url" 2>/dev/null) || true

  if ! [[ "$http_code" =~ ^2 ]] && ! [[ "$http_code" =~ ^3 ]] && [[ -n "$fallback_url" ]]; then
    http_code=$(curl -sf -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 30 "$fallback_url" 2>/dev/null) || true
  fi

  if [[ "$http_code" =~ ^2 ]] || [[ "$http_code" =~ ^3 ]]; then
    echo "0" > "$fail_file"
    log "[OK] ${name} 健康 (${url} -> ${http_code})"
    return 0
  fi

  # HTTP 失败但端口仍在监听 — 进程可能正忙，不计入失败
  if ss -tlnH "sport = :${port}" 2>/dev/null | grep -q .; then
    log "[WARN] ${name} HTTP 检查失败但端口 :${port} 仍在监听 — 进程可能繁忙，本次不计为失败"
    return 0
  fi

  # 真正失败 — 累加计数
  local current_failures=0
  if [[ -f "$fail_file" ]]; then
    current_failures=$(cat "$fail_file" 2>/dev/null) || true
    if ! [[ "$current_failures" =~ ^[0-9]+$ ]]; then
      current_failures=0
    fi
  fi
  current_failures=$((current_failures + 1))
  echo "$current_failures" > "$fail_file"

  log "[FAIL] ${name} 检查失败 (累计 ${current_failures}/${WATCHDOG_FAIL_THRESHOLD})"

  if [[ "$current_failures" -ge "$WATCHDOG_FAIL_THRESHOLD" ]]; then
    log "[RESTART] ${name} — 连续 ${WATCHDOG_FAIL_THRESHOLD} 次失败后重启"
    if systemctl restart "$unit" 2>/dev/null; then
      log "[OK] ${name} 重启成功"
    else
      log "[ERROR] ${name} 重启失败"
    fi
    echo "0" > "$fail_file"
  fi
}

# ---------------------------------------------------------------------------
# 执行检查
# ---------------------------------------------------------------------------
check_service "backend" "$BACKEND_PORT" "${PROJECT_NAME}-backend.service" \
  "$BACKEND_HEALTH_URL" "$BACKEND_HEALTH_FALLBACK_URL"

check_service "frontend" "$FRONTEND_PORT" "${PROJECT_NAME}-frontend.service" \
  "$FRONTEND_HEALTH_URL" ""
