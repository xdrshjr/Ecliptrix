#!/usr/bin/env bash
# =============================================================================
# Ecliptrix - 系统依赖与项目依赖安装脚本
#
# 在服务器上安装：
#   1. 系统包：postgresql, postgresql-client, ffmpeg, build-essential
#   2. 创建并初始化 PostgreSQL 数据库与用户
#   3. 创建后端 Python venv 并安装 requirements.txt
#   4. 安装前端 npm 依赖
#   5. 创建项目所需的运行目录
#
# 由 web-deployer skill 生成 — 2026-04-07
#
# 使用方法：
#   sudo ./ops/install-deps.sh                # 完整安装
#   sudo ./ops/install-deps.sh --skip-system  # 跳过 apt 系统包安装
#   sudo ./ops/install-deps.sh --skip-db      # 跳过 PostgreSQL 设置
#   sudo ./ops/install-deps.sh --skip-py      # 跳过 Python 依赖
#   sudo ./ops/install-deps.sh --skip-node    # 跳过 npm install
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 颜色与日志
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------
SKIP_SYSTEM=false
SKIP_DB=false
SKIP_PY=false
SKIP_NODE=false

for arg in "$@"; do
  case "$arg" in
    --skip-system) SKIP_SYSTEM=true ;;
    --skip-db)     SKIP_DB=true ;;
    --skip-py)     SKIP_PY=true ;;
    --skip-node)   SKIP_NODE=true ;;
    --help|-h)
      head -n 18 "$0" | tail -n 16
      exit 0
      ;;
    *) warn "未知参数: $arg" ;;
  esac
done

# ---------------------------------------------------------------------------
# 路径解析
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.env"

if [[ ! -f "$CONFIG_FILE" ]]; then
  die "找不到配置文件: $CONFIG_FILE"
fi
# shellcheck source=config.env
source "$CONFIG_FILE"

BACKEND_DIR="$PROJECT_DIR/$BACKEND_SUBDIRECTORY"
VENV_DIR="$BACKEND_DIR/venv"

echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD}  Ecliptrix - 安装系统与项目依赖${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: 系统包
# ---------------------------------------------------------------------------
if [[ "$SKIP_SYSTEM" == false ]]; then
  log "[1/5] 安装系统依赖 (apt)..."
  if [[ "$(id -u)" -ne 0 ]]; then
    die "系统包安装需要 root 权限。请用 sudo 运行。"
  fi

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq

  PKGS=(
    build-essential
    python3-venv
    python3-dev
    python3-pip
    postgresql
    postgresql-client
    libpq-dev
    ffmpeg
    nginx
    curl
    git
  )
  apt-get install -y -qq "${PKGS[@]}" || die "apt 安装失败"
  ok "系统依赖安装完成"

  systemctl enable postgresql >/dev/null 2>&1 || true
  systemctl start postgresql >/dev/null 2>&1 || true
else
  warn "[1/5] 跳过系统依赖安装 (--skip-system)"
fi

# ---------------------------------------------------------------------------
# Step 2: PostgreSQL 数据库
# ---------------------------------------------------------------------------
if [[ "$SKIP_DB" == false ]]; then
  log "[2/5] 配置 PostgreSQL 数据库..."

  if ! systemctl is-active --quiet postgresql; then
    systemctl start postgresql || die "PostgreSQL 启动失败"
  fi

  # 创建用户（如果不存在）
  USER_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")
  if [[ "$USER_EXISTS" != "1" ]]; then
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
    ok "创建用户 ${DB_USER}"
  else
    log "用户 ${DB_USER} 已存在，跳过"
  fi

  # 创建数据库（如果不存在）
  DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")
  if [[ "$DB_EXISTS" != "1" ]]; then
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
    sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" >/dev/null 2>&1 || true
    ok "创建数据库 ${DB_NAME}"
  else
    log "数据库 ${DB_NAME} 已存在，跳过"
  fi

  ok "PostgreSQL 配置完成"
else
  warn "[2/5] 跳过数据库配置 (--skip-db)"
fi

# ---------------------------------------------------------------------------
# Step 3: 创建运行目录
# ---------------------------------------------------------------------------
log "[3/5] 创建运行所需目录..."
DIRS=(
  "$BACKEND_DIR/static/uploads/video"
  "$BACKEND_DIR/static/uploads/audio"
  "$BACKEND_DIR/static/uploads/images"
  "$BACKEND_DIR/static/uploads/files"
  "$BACKEND_DIR/static/video/composed"
  "$BACKEND_DIR/static/video/thumbnails"
  "$BACKEND_DIR/static/audio/generated"
  "$BACKEND_DIR/static/audio/subtitles"
  "$BACKEND_DIR/static/timeline_exports"
  "$BACKEND_DIR/temp"
  "$BACKEND_DIR/logs"
  "$PROJECT_DIR/logs"
  "$WATCHDOG_STATE_DIR"
)
for d in "${DIRS[@]}"; do
  mkdir -p "$d"
done
chown -R "${RUN_USER}:${RUN_GROUP}" "$WATCHDOG_STATE_DIR" 2>/dev/null || true
ok "目录创建完成"

# ---------------------------------------------------------------------------
# Step 4: Python 后端依赖
# ---------------------------------------------------------------------------
if [[ "$SKIP_PY" == false ]]; then
  log "[4/5] 安装 Python 后端依赖..."

  REQ_FILE="$BACKEND_DIR/requirements.txt"
  REQ_FIXED="$BACKEND_DIR/requirements.fixed.txt"

  if [[ ! -f "$REQ_FILE" ]]; then
    die "找不到 requirements.txt: $REQ_FILE"
  fi

  # 检测编码（Windows 环境常见情况：UTF-16 LE 无 BOM，被 file 识别为 "data"）
  ENCODING_INFO=$(file -b "$REQ_FILE")
  log "requirements.txt 编码: $ENCODING_INFO"

  # 通过检查前 2 字节判断是否为 UTF-16 LE（ASCII 字符 + 0x00）
  FIRST_BYTES=$(head -c 2 "$REQ_FILE" | od -An -tx1 | tr -d ' \n')

  if echo "$ENCODING_INFO" | grep -qi 'utf-16'; then
    log "转换 UTF-16 -> UTF-8..."
    iconv -f UTF-16 -t UTF-8 "$REQ_FILE" 2>/dev/null | sed 's/\r$//' > "$REQ_FIXED" || \
    iconv -f UTF-16LE -t UTF-8 "$REQ_FILE" | sed 's/\r$//' > "$REQ_FIXED"
  elif [[ "${FIRST_BYTES:2:2}" == "00" ]]; then
    log "检测到 UTF-16 LE 无 BOM 格式，转换 -> UTF-8..."
    iconv -f UTF-16LE -t UTF-8 "$REQ_FILE" | sed 's/\r$//' > "$REQ_FIXED"
  else
    sed 's/\r$//' "$REQ_FILE" > "$REQ_FIXED"
  fi

  # 校验：转换后的文件应该是可读的文本，且不应为空
  if [[ ! -s "$REQ_FIXED" ]]; then
    die "requirements 转换后为空，无法继续。原始文件: $REQ_FILE"
  fi
  log "转换后的 requirements.txt 大小: $(wc -l < "$REQ_FIXED") 行"

  # 创建/重建 venv
  if [[ ! -f "$VENV_DIR/bin/python" ]]; then
    log "创建 Python venv: $VENV_DIR"
    python3 -m venv "$VENV_DIR"
  fi

  # 升级 pip 并安装
  "$VENV_DIR/bin/pip" install --upgrade pip wheel setuptools >/dev/null

  log "安装 requirements.txt（这可能需要几分钟）..."
  if ! "$VENV_DIR/bin/pip" install -r "$REQ_FIXED"; then
    warn "首次安装失败，尝试使用清华镜像..."
    "$VENV_DIR/bin/pip" install -r "$REQ_FIXED" -i https://pypi.tuna.tsinghua.edu.cn/simple || die "Python 依赖安装失败"
  fi

  rm -f "$REQ_FIXED"
  ok "Python 后端依赖安装完成"
else
  warn "[4/5] 跳过 Python 依赖 (--skip-py)"
fi

# ---------------------------------------------------------------------------
# Step 5: 前端 npm 依赖
# ---------------------------------------------------------------------------
if [[ "$SKIP_NODE" == false ]]; then
  log "[5/5] 安装前端 npm 依赖..."
  cd "$PROJECT_DIR"

  if [[ ! -f "package.json" ]]; then
    die "找不到 package.json: $PROJECT_DIR/package.json"
  fi

  if ! "$NPM_BIN" install --no-audit --no-fund 2>&1 | tail -n 30; then
    warn "默认 registry 安装失败，尝试国内镜像..."
    "$NPM_BIN" install --no-audit --no-fund --registry https://registry.npmmirror.com || die "npm install 失败"
  fi

  ok "前端 npm 依赖安装完成"
else
  warn "[5/5] 跳过 npm install (--skip-node)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${GREEN}${BOLD}  依赖安装完成！${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""
echo -e "  下一步："
echo -e "    1. 编辑 .env 文件填入实际密钥（如未提供）"
echo -e "    2. 运行 sudo ./ops/install.sh 安装 systemd 服务"
echo -e "    3. 运行 ./ops/status.sh 查看服务状态"
echo ""
