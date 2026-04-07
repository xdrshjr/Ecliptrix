#!/usr/bin/env bash
# =============================================================================
# Ecliptrix - 日志查看脚本
#
# 用法：
#   ./ops/logs.sh                       # 查看后端最近 100 行
#   ./ops/logs.sh -f                    # 跟随后端日志
#   ./ops/logs.sh frontend              # 查看前端最近 100 行
#   ./ops/logs.sh frontend -f           # 跟随前端
#   ./ops/logs.sh watchdog              # 查看 watchdog
#   ./ops/logs.sh all -f                # 跟随所有服务
#   ./ops/logs.sh -n 500                # 查看最近 500 行（默认 100）
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.env"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE" || { echo "config.env 缺失"; exit 1; }

TARGET="backend"
LINES=100
FOLLOW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    backend|frontend|watchdog|all) TARGET="$1" ;;
    -f|--follow) FOLLOW=true ;;
    -n|--lines)  LINES="$2"; shift ;;
    -h|--help)
      head -n 14 "$0" | tail -n 12
      exit 0
      ;;
  esac
  shift
done

case "$TARGET" in
  backend)   UNITS=("${PROJECT_NAME}-backend.service") ;;
  frontend)  UNITS=("${PROJECT_NAME}-frontend.service") ;;
  watchdog)  UNITS=("${PROJECT_NAME}-watchdog.service") ;;
  all)       UNITS=("${PROJECT_NAME}-backend.service" "${PROJECT_NAME}-frontend.service" "${PROJECT_NAME}-watchdog.service") ;;
esac

ARGS=()
for u in "${UNITS[@]}"; do
  ARGS+=(-u "$u")
done

if [[ "$FOLLOW" == true ]]; then
  exec journalctl "${ARGS[@]}" -f -n "$LINES" --no-pager
else
  exec journalctl "${ARGS[@]}" -n "$LINES" --no-pager
fi
