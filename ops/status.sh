#!/usr/bin/env bash
# =============================================================================
# Ecliptrix - 服务状态查看脚本
# 由 web-deployer skill 生成 — 2026-04-07
# =============================================================================

set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.env"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE" || { echo "config.env 缺失"; exit 1; }

print_unit_status() {
  local unit="$1" label="$2"
  local active sub
  active=$(systemctl is-active "$unit" 2>/dev/null || echo "inactive")
  sub=$(systemctl show "$unit" -p SubState --value 2>/dev/null || echo "?")
  if [[ "$active" == "active" ]]; then
    echo -e "  ${GREEN}●${RESET} ${label}: ${GREEN}${active}${RESET} (${sub})"
  elif [[ "$active" == "activating" ]]; then
    echo -e "  ${YELLOW}●${RESET} ${label}: ${YELLOW}${active}${RESET} (${sub})"
  else
    echo -e "  ${RED}●${RESET} ${label}: ${RED}${active}${RESET} (${sub})"
  fi
}

print_health() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "---")
  if [[ "$code" =~ ^2 ]] || [[ "$code" =~ ^3 ]]; then
    echo -e "  ${GREEN}OK${RESET}   ${label}: HTTP ${code}  (${url})"
  else
    echo -e "  ${RED}FAIL${RESET} ${label}: HTTP ${code}  (${url})"
  fi
}

echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD}  Ecliptrix 服务状态${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""

echo -e "${BOLD}systemd 单元:${RESET}"
print_unit_status "${PROJECT_NAME}-backend.service"  "Backend     "
print_unit_status "${PROJECT_NAME}-frontend.service" "Frontend    "
print_unit_status "${PROJECT_NAME}-watchdog.timer"   "Watchdog tmr"
print_unit_status "${PROJECT_NAME}-watchdog.service" "Watchdog svc"

echo ""
echo -e "${BOLD}HTTP 健康检查:${RESET}"
print_health "Backend health  " "${BACKEND_HEALTH_URL}"
print_health "Backend fallback" "${BACKEND_HEALTH_FALLBACK_URL}"
print_health "Frontend        " "${FRONTEND_HEALTH_URL}"

echo ""
echo -e "${BOLD}监听端口:${RESET}"
ss -tlnH "( sport = :${BACKEND_PORT} or sport = :${FRONTEND_PORT} )" 2>/dev/null | \
  awk '{printf "  %-6s %-8s %s\n", $1, $5, ""}'

echo ""
echo -e "${BOLD}Watchdog 失败计数:${RESET}"
if [[ -d "${WATCHDOG_STATE_DIR}" ]]; then
  for f in "${WATCHDOG_STATE_DIR}"/${PROJECT_NAME}-watchdog-*-failures; do
    [[ -f "$f" ]] || continue
    name=$(basename "$f" | sed -E 's/.*-watchdog-(.*)-failures/\1/')
    count=$(cat "$f" 2>/dev/null || echo "?")
    echo -e "  ${name}: ${count}"
  done
else
  echo "  (目录不存在)"
fi

echo ""
echo -e "${BOLD}最近的 watchdog 检查:${RESET}"
journalctl -u "${PROJECT_NAME}-watchdog.service" -n 5 --no-pager 2>/dev/null \
  | sed 's/^/  /' || echo "  (暂无)"

echo ""
echo -e "${BOLD}访问入口:${RESET}"
echo -e "  Nginx 域名:  ${NGINX_DOMAIN}"
echo -e "  本机直连前端: http://localhost:${FRONTEND_PORT}/"
echo -e "  本机直连后端: http://localhost:${BACKEND_PORT}/docs"
echo ""
