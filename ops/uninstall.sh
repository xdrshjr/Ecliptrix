#!/usr/bin/env bash
# =============================================================================
# Ecliptrix - 卸载 systemd / nginx / watchdog 配置
#
# 由 web-deployer skill 生成 — 2026-04-07
#
# 使用方法：
#   sudo ./ops/uninstall.sh           # 卸载服务，保留代码与数据
#   sudo ./ops/uninstall.sh --purge   # 同时清理数据库（危险）
# =============================================================================

set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly RESET='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] OK${RESET} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN${RESET} $*"; }

PURGE=false
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=true ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo -e "${RED}本脚本需要 root 权限。${RESET}" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.env"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE" || { echo "config.env 缺失"; exit 1; }

log "停止服务..."
systemctl stop "${PROJECT_NAME}-watchdog.timer"   2>/dev/null || true
systemctl stop "${PROJECT_NAME}-watchdog.service" 2>/dev/null || true
systemctl stop "${PROJECT_NAME}-frontend.service" 2>/dev/null || true
systemctl stop "${PROJECT_NAME}-backend.service"  2>/dev/null || true

log "禁用开机自启..."
systemctl disable "${PROJECT_NAME}-watchdog.timer"   2>/dev/null || true
systemctl disable "${PROJECT_NAME}-frontend.service" 2>/dev/null || true
systemctl disable "${PROJECT_NAME}-backend.service"  2>/dev/null || true

log "删除 unit 文件..."
rm -f /etc/systemd/system/${PROJECT_NAME}-*.service
rm -f /etc/systemd/system/${PROJECT_NAME}-*.timer

log "删除 logrotate 配置..."
rm -f /etc/logrotate.d/${PROJECT_NAME}

log "删除 nginx 配置..."
rm -f /etc/nginx/sites-enabled/${NGINX_SITE_NAME}
rm -f /etc/nginx/sites-available/${NGINX_SITE_NAME}
if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
fi

systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true

if [[ "$PURGE" == true ]]; then
  warn "--purge 模式：删除数据库 ${DB_NAME} 与用户 ${DB_USER}"
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null || true
  sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};" 2>/dev/null || true
  warn "--purge 模式：清理 watchdog 状态目录"
  rm -rf "${WATCHDOG_STATE_DIR}"
fi

ok "卸载完成。代码目录 ${PROJECT_DIR} 未被删除。"
