#!/usr/bin/env bash
# =============================================================================
# Ecliptrix - systemd / nginx / watchdog 安装脚本
#
# 把 ops/templates/ 下的单元文件渲染并安装到 /etc/systemd/system/
# 配置 nginx、logrotate、watchdog 定时器
#
# 由 web-deployer skill 生成 — 2026-04-07
#
# 使用方法：
#   sudo ./ops/install.sh             # 完整安装并启动服务
#   sudo ./ops/install.sh --no-start  # 仅安装单元文件，不启动
#   sudo ./ops/install.sh --no-nginx  # 跳过 Nginx 配置
# =============================================================================

set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly RESET='\033[0m'

log()   { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*"; }
ok()    { echo -e "${GREEN}[$(date '+%H:%M:%S')] OK${RESET} $*"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN${RESET} $*"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR${RESET} $*" >&2; }
die()   { error "$*"; exit 1; }

NO_START=false
NO_NGINX=false
for arg in "$@"; do
  case "$arg" in
    --no-start) NO_START=true ;;
    --no-nginx) NO_NGINX=true ;;
    --help|-h)  head -n 14 "$0" | tail -n 12 ; exit 0 ;;
    *) warn "未知参数: $arg" ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  die "本脚本需要 root 权限。请用 sudo 运行。"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.env"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

[[ -f "$CONFIG_FILE" ]] || die "找不到配置文件: $CONFIG_FILE"
# shellcheck source=config.env
source "$CONFIG_FILE"

[[ -d "$TEMPLATES_DIR" ]] || die "找不到模板目录: $TEMPLATES_DIR"

echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD}  Ecliptrix - 安装 systemd 服务${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 模板渲染函数：用 sed 替换占位符
# ---------------------------------------------------------------------------
render_template() {
  local src="$1" dst="$2"
  sed \
    -e "s|@@PROJECT_NAME@@|${PROJECT_NAME}|g" \
    -e "s|@@PROJECT_DIR@@|${PROJECT_DIR}|g" \
    -e "s|@@RUN_USER@@|${RUN_USER}|g" \
    -e "s|@@RUN_GROUP@@|${RUN_GROUP}|g" \
    -e "s|@@BACKEND_PORT@@|${BACKEND_PORT}|g" \
    -e "s|@@FRONTEND_PORT@@|${FRONTEND_PORT}|g" \
    -e "s|@@VENV_PYTHON@@|${VENV_PYTHON}|g" \
    -e "s|@@NODE_BIN@@|${NODE_BIN}|g" \
    -e "s|@@NPM_BIN@@|${NPM_BIN}|g" \
    -e "s|@@NPX_BIN@@|${NPX_BIN}|g" \
    -e "s|@@BACKEND_DIR@@|${PROJECT_DIR}/${BACKEND_SUBDIRECTORY}|g" \
    -e "s|@@FRONTEND_DIR@@|${PROJECT_DIR}|g" \
    -e "s|@@WATCHDOG_INTERVAL@@|${WATCHDOG_INTERVAL}|g" \
    -e "s|@@SCRIPT_DIR@@|${SCRIPT_DIR}|g" \
    -e "s|@@NGINX_DOMAIN@@|${NGINX_DOMAIN}|g" \
    "$src" > "$dst"
}

# ---------------------------------------------------------------------------
# 1. 渲染并安装 systemd unit 文件
# ---------------------------------------------------------------------------
log "[1/5] 渲染并安装 systemd unit 文件..."

UNITS=(
  "${PROJECT_NAME}-backend.service"
  "${PROJECT_NAME}-frontend.service"
  "${PROJECT_NAME}-watchdog.service"
  "${PROJECT_NAME}-watchdog.timer"
)
for unit in "${UNITS[@]}"; do
  src="$TEMPLATES_DIR/${unit}"
  dst="/etc/systemd/system/${unit}"
  if [[ ! -f "$src" ]]; then
    warn "模板缺失，跳过: $src"
    continue
  fi
  render_template "$src" "$dst"
  chmod 644 "$dst"
  ok "已安装 $dst"
done

systemctl daemon-reload
ok "systemd daemon 已重载"

# ---------------------------------------------------------------------------
# 2. 安装 logrotate 配置
# ---------------------------------------------------------------------------
log "[2/5] 安装 logrotate 配置..."
LOGROTATE_SRC="$TEMPLATES_DIR/${PROJECT_NAME}-logrotate"
if [[ -f "$LOGROTATE_SRC" ]]; then
  render_template "$LOGROTATE_SRC" "/etc/logrotate.d/${PROJECT_NAME}"
  chmod 644 "/etc/logrotate.d/${PROJECT_NAME}"
  ok "已安装 /etc/logrotate.d/${PROJECT_NAME}"
else
  warn "logrotate 模板未找到，跳过"
fi

# ---------------------------------------------------------------------------
# 3. 安装 nginx 站点配置
# ---------------------------------------------------------------------------
if [[ "$NO_NGINX" == false ]] && [[ -n "${NGINX_DOMAIN:-}" ]] && command -v nginx >/dev/null 2>&1; then
  log "[3/5] 安装 nginx 站点配置..."
  NGINX_SRC="$TEMPLATES_DIR/${PROJECT_NAME}-nginx"
  NGINX_DST="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
  if [[ -f "$NGINX_SRC" ]]; then
    # ----- 安全保护：如果已有配置含 HTTPS（443/SSL），不要覆盖 -----
    # 模板是 HTTP-only 的；certbot --nginx 会向现有配置添加 `listen 443 ssl`
    # 和证书路径。直接覆盖会让 HTTPS 站点下线。检测到 SSL 标记则跳过覆盖，
    # 让 ops 同事用 --no-nginx 或手动维护配置。
    # （要强制重新渲染模板，使用 --force-nginx。）
    if [[ -f "$NGINX_DST" ]] && [[ "${FORCE_NGINX:-false}" != true ]] \
       && grep -qE '^[[:space:]]*listen[[:space:]]+(\[::\]:)?443[[:space:]]+ssl' "$NGINX_DST"; then
      warn "$NGINX_DST 已包含 'listen 443 ssl'（看起来是 certbot 管理的 HTTPS 配置）"
      warn "为避免破坏 HTTPS 站点，跳过 nginx 模板覆盖。"
      warn "如需强制覆盖：sudo FORCE_NGINX=true bash $0 ...（覆盖前会先备份）"
    else
      # 备份已有配置
      if [[ -f "$NGINX_DST" ]]; then
        cp "$NGINX_DST" "${NGINX_DST}.bak.$(date +%Y%m%d-%H%M%S)"
        log "已备份原 nginx 配置"
      fi
      render_template "$NGINX_SRC" "$NGINX_DST"
      chmod 644 "$NGINX_DST"
      ln -sf "$NGINX_DST" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
      if nginx -t 2>&1; then
        systemctl reload nginx
        ok "Nginx 配置已生效（${NGINX_DOMAIN}）"
      else
        error "nginx -t 校验失败！"
        LATEST_BAK=$(ls -t "${NGINX_DST}.bak."* 2>/dev/null | head -1) || true
        if [[ -n "$LATEST_BAK" ]]; then
          cp "$LATEST_BAK" "$NGINX_DST"
          warn "已恢复备份"
        else
          rm -f "$NGINX_DST" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
        fi
        die "nginx 配置安装失败"
      fi
    fi
  else
    warn "nginx 模板未找到，跳过"
  fi
else
  warn "[3/5] 跳过 nginx 配置"
fi

# ---------------------------------------------------------------------------
# 4. 启用并启动服务
# ---------------------------------------------------------------------------
log "[4/5] 启用 systemd 单元..."
systemctl enable "${PROJECT_NAME}-backend.service" >/dev/null 2>&1 || true
systemctl enable "${PROJECT_NAME}-frontend.service" >/dev/null 2>&1 || true
systemctl enable "${PROJECT_NAME}-watchdog.timer" >/dev/null 2>&1 || true
ok "已启用开机自启"

if [[ "$NO_START" == true ]]; then
  warn "[5/5] 跳过服务启动 (--no-start)"
  echo ""
  echo -e "${BOLD}手动启动命令：${RESET}"
  echo "  sudo systemctl start ${PROJECT_NAME}-backend.service"
  echo "  sudo systemctl start ${PROJECT_NAME}-frontend.service"
  echo "  sudo systemctl start ${PROJECT_NAME}-watchdog.timer"
  exit 0
fi

# ---------------------------------------------------------------------------
# 5. 启动服务并等待就绪
# ---------------------------------------------------------------------------
log "[5/5] 启动服务..."

systemctl restart "${PROJECT_NAME}-backend.service"
log "等待后端就绪 (最多 90s)..."
BACKEND_READY=false
for i in $(seq 1 90); do
  if curl -sf --max-time 5 "${BACKEND_HEALTH_URL}" >/dev/null 2>&1 || \
     curl -sf --max-time 5 "${BACKEND_HEALTH_FALLBACK_URL}" >/dev/null 2>&1; then
    BACKEND_READY=true
    break
  fi
  sleep 1
done
if [[ "$BACKEND_READY" == true ]]; then
  ok "后端已就绪 (端口 ${BACKEND_PORT})"
else
  warn "后端 90s 内未响应。请运行：journalctl -u ${PROJECT_NAME}-backend -n 50"
fi

systemctl restart "${PROJECT_NAME}-frontend.service"
log "等待前端就绪 (最多 60s)..."
FRONTEND_READY=false
for i in $(seq 1 60); do
  if curl -sf --max-time 5 "${FRONTEND_HEALTH_URL}" >/dev/null 2>&1; then
    FRONTEND_READY=true
    break
  fi
  sleep 1
done
if [[ "$FRONTEND_READY" == true ]]; then
  ok "前端已就绪 (端口 ${FRONTEND_PORT})"
else
  warn "前端 60s 内未响应。请运行：journalctl -u ${PROJECT_NAME}-frontend -n 50"
fi

systemctl restart "${PROJECT_NAME}-watchdog.timer"
ok "Watchdog 定时器已启动 (每 ${WATCHDOG_INTERVAL}s 检查一次)"

echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${GREEN}${BOLD}  安装完成！${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""
echo -e "  服务状态:    ./ops/status.sh"
echo -e "  日志:        ./ops/logs.sh -f"
echo -e "  访问:        http://${NGINX_DOMAIN%% *}/"
echo -e "  本机端口:    前端 :${FRONTEND_PORT}  后端 :${BACKEND_PORT}"
echo ""
