#!/usr/bin/env bash
# =============================================================================
# Ecliptrix - 一键重新部署脚本
#
# 执行完整的重新部署流程：
#   1. 备份当前状态
#   2. （可选）git pull 拉取最新代码
#   3. 安装/更新依赖
#   4. 构建前端
#   5. 重新加载 systemd 单元并重启服务
#   6. 验证服务健康
#
# 由 web-deployer skill 生成 — 2026-04-07
#
# 使用方法：
#   sudo ./ops/deploy.sh                  # 完整重新部署
#   sudo ./ops/deploy.sh --skip-deps      # 跳过依赖安装
#   sudo ./ops/deploy.sh --skip-build     # 跳过前端构建
#   sudo ./ops/deploy.sh --skip-pull      # 跳过 git pull
#   sudo ./ops/deploy.sh --skip-backup    # 跳过备份
#   sudo ./ops/deploy.sh --branch=main    # 指定 git 分支
#   sudo ./ops/deploy.sh --rollback       # 回滚到上一次备份
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

SKIP_DEPS=false
SKIP_BUILD=false
SKIP_PULL=false
SKIP_BACKUP=false
BRANCH=""
ROLLBACK=false

for arg in "$@"; do
  case "$arg" in
    --skip-deps)   SKIP_DEPS=true ;;
    --skip-build)  SKIP_BUILD=true ;;
    --skip-pull)   SKIP_PULL=true ;;
    --skip-backup) SKIP_BACKUP=true ;;
    --branch=*)    BRANCH="${arg#*=}" ;;
    --rollback)    ROLLBACK=true ;;
    --help|-h)     head -n 24 "$0" | tail -n 22 ; exit 0 ;;
    *) warn "未知参数: $arg" ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  die "本脚本需要 root 权限。请用 sudo 运行。"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.env"
[[ -f "$CONFIG_FILE" ]] || die "找不到配置文件: $CONFIG_FILE"
# shellcheck source=config.env
source "$CONFIG_FILE"

DEPLOY_BACKUP_DIR="${PROJECT_DIR}/.deploy-backups"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"

echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD}  Ecliptrix - 部署${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Rollback 模式
# ---------------------------------------------------------------------------
if [[ "$ROLLBACK" == true ]]; then
  log "查找最近的备份..."
  [[ -d "$DEPLOY_BACKUP_DIR" ]] || die "未找到备份目录: $DEPLOY_BACKUP_DIR"
  LATEST=$(ls -td "$DEPLOY_BACKUP_DIR"/*/ 2>/dev/null | head -1) || true
  [[ -n "$LATEST" ]] || die "无可用备份"
  log "使用备份: $LATEST"
  if [[ -f "$LATEST/git-ref" ]]; then
    ref=$(cat "$LATEST/git-ref")
    log "回滚 git 到: $ref"
    git -C "$PROJECT_DIR" checkout "$ref" 2>/dev/null || git -C "$PROJECT_DIR" reset --hard "$ref"
  fi
  cp "$LATEST/config.env.bak" "$CONFIG_FILE" 2>/dev/null || true
  bash "$SCRIPT_DIR/install.sh"
  ok "回滚完成"
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. 备份
# ---------------------------------------------------------------------------
if [[ "$SKIP_BACKUP" == false ]]; then
  log "[1/6] 创建备份..."
  BACKUP_PATH="${DEPLOY_BACKUP_DIR}/${TIMESTAMP}"
  mkdir -p "$BACKUP_PATH"
  if [[ -d "$PROJECT_DIR/.git" ]]; then
    git -C "$PROJECT_DIR" rev-parse HEAD > "$BACKUP_PATH/git-ref" 2>/dev/null || true
  fi
  cp "$CONFIG_FILE" "$BACKUP_PATH/config.env.bak" 2>/dev/null || true
  ok "备份保存到 $BACKUP_PATH"
  # 仅保留最近 5 份
  ls -td "$DEPLOY_BACKUP_DIR"/*/ 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true
else
  warn "[1/6] 跳过备份"
fi

# ---------------------------------------------------------------------------
# 2. git pull
# ---------------------------------------------------------------------------
if [[ "$SKIP_PULL" == false ]] && [[ -d "$PROJECT_DIR/.git" ]]; then
  log "[2/6] 拉取最新代码..."
  if [[ -n "$BRANCH" ]]; then
    git -C "$PROJECT_DIR" fetch --all --prune
    git -C "$PROJECT_DIR" checkout "$BRANCH"
  fi
  git -C "$PROJECT_DIR" pull --ff-only || warn "fast-forward pull 失败，请手动解决冲突"
  ok "代码已更新到: $(git -C "$PROJECT_DIR" log --oneline -1)"
else
  warn "[2/6] 跳过 git pull"
fi

# ---------------------------------------------------------------------------
# 3. 安装依赖
# ---------------------------------------------------------------------------
if [[ "$SKIP_DEPS" == false ]]; then
  log "[3/6] 安装依赖..."
  bash "$SCRIPT_DIR/install-deps.sh" --skip-system --skip-db
  ok "依赖更新完成"
else
  warn "[3/6] 跳过依赖安装"
fi

# ---------------------------------------------------------------------------
# 4. 构建前端
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == false ]]; then
  log "[4/6] 构建前端 (NODE_OPTIONS=--max-old-space-size=4096)..."
  cd "$PROJECT_DIR"
  NODE_OPTIONS=--max-old-space-size=4096 "$NPM_BIN" run build || die "前端构建失败"
  ok "前端构建完成"
else
  warn "[4/6] 跳过前端构建"
fi

# ---------------------------------------------------------------------------
# 5. 重新安装 systemd 服务并重启
# ---------------------------------------------------------------------------
log "[5/6] 重新安装 systemd 单元..."
bash "$SCRIPT_DIR/install.sh" --no-start
ok "systemd 单元已更新"

# ---------------------------------------------------------------------------
# 6. 重启并验证
# ---------------------------------------------------------------------------
log "[6/6] 重启并验证服务..."

systemctl restart "${PROJECT_NAME}-backend.service"
log "等待后端就绪 (最多 90s)..."
BACKEND_READY=false
for _ in $(seq 1 90); do
  if curl -sf "${BACKEND_HEALTH_URL}" >/dev/null 2>&1 || \
     curl -sf "${BACKEND_HEALTH_FALLBACK_URL}" >/dev/null 2>&1; then
    BACKEND_READY=true
    break
  fi
  sleep 1
done
[[ "$BACKEND_READY" == true ]] && ok "后端健康" || warn "后端 90s 未响应，查看 journalctl -u ${PROJECT_NAME}-backend"

systemctl restart "${PROJECT_NAME}-frontend.service"
log "等待前端就绪 (最多 60s)..."
FRONTEND_READY=false
for _ in $(seq 1 60); do
  if curl -sf "${FRONTEND_HEALTH_URL}" >/dev/null 2>&1; then
    FRONTEND_READY=true
    break
  fi
  sleep 1
done
[[ "$FRONTEND_READY" == true ]] && ok "前端健康" || warn "前端 60s 未响应，查看 journalctl -u ${PROJECT_NAME}-frontend"

systemctl restart "${PROJECT_NAME}-watchdog.timer"

echo ""
echo -e "${BOLD}============================================================${RESET}"
DEPLOY_STATUS="${GREEN}${BOLD}SUCCESS${RESET}"
[[ "$BACKEND_READY" != true ]] && DEPLOY_STATUS="${YELLOW}${BOLD}PARTIAL (backend unhealthy)${RESET}"
[[ "$FRONTEND_READY" != true ]] && DEPLOY_STATUS="${YELLOW}${BOLD}PARTIAL (frontend unhealthy)${RESET}"
echo -e "  部署结果: ${DEPLOY_STATUS}"
echo -e "  时间戳:   ${CYAN}${TIMESTAMP}${RESET}"
echo -e ""
echo -e "  ${BOLD}快速命令:${RESET}"
echo -e "    ./ops/status.sh                 # 服务状态"
echo -e "    ./ops/logs.sh -f                # 跟随日志"
echo -e "    sudo ./ops/deploy.sh --rollback # 回滚"
echo -e "${BOLD}============================================================${RESET}"
echo ""
