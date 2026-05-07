#!/bin/bash

# ============================================
# Ecliptrix - One-Click Start Script
# Ecliptrix 一键启动脚本
# ============================================
# Usage: bash start.sh [PORT]
#
# Options:
#   PORT   Custom frontend port (default: 3010)
#   --dev  Start frontend in dev mode (no build, npm run dev)
#   --help Show this help message
# ============================================

set -o pipefail
unset all_proxy; unset ALL_PROXY

# ============ Color Definitions ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ============ Configuration ============
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend-services/basic-service"
LOG_DIR="$SCRIPT_DIR/logs"

FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_LOG="$LOG_DIR/backend.log"
STARTUP_LOG="$LOG_DIR/startup.log"

FRONTEND_PORT=3010
DEV_MODE=false

# PIDs for cleanup
FRONTEND_PID=""
BACKEND_PID=""

# ============ Parse Arguments ============
for arg in "$@"; do
    case $arg in
        --dev)   DEV_MODE=true ;;
        --help)
            head -n 12 "$0" | tail -n 8
            exit 0
            ;;
        *)
            if [[ $arg =~ ^[0-9]+$ ]]; then
                FRONTEND_PORT=$arg
            else
                echo "Unknown option: $arg (use --help for usage)"
                exit 1
            fi
            ;;
    esac
done

# ============ Logging Functions ============
mkdir -p "$LOG_DIR"

log() {
    local level=$1 color=$2 msg=$3
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${color}[${level}]${NC} ${timestamp} - ${msg}" | tee -a "$STARTUP_LOG"
}

info()    { log "INFO"    "$BLUE"   "$1"; }
success() { log "OK"      "$GREEN"  "$1"; }
warn()    { log "WARN"    "$YELLOW" "$1"; }
error()   { log "ERROR"   "$RED"    "$1"; }
step()    { log "STEP"    "$PURPLE" "$1"; }
header()  { echo -e "\n${BOLD}${CYAN}$1${NC}" | tee -a "$STARTUP_LOG"; }

# ============ Helper Functions ============

detect_os() {
    case "$(uname -s)" in
        Linux*)   echo "linux" ;;
        Darwin*)  echo "macos" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)        echo "unknown" ;;
    esac
}

# ============ Port Cleanup ============

# Kill any existing process on a given port
kill_port() {
    local port=$1
    local killed=false

    if [ "$OS" = "windows" ]; then
        local pids
        pids=$(netstat -ano 2>/dev/null | grep ":${port} " | grep "LISTENING" | awk '{print $5}' | sort -u)
        for pid in $pids; do
            if [ "$pid" != "0" ] && [ -n "$pid" ]; then
                taskkill //F //PID "$pid" > /dev/null 2>&1 && \
                    warn "Killed existing process on port $port (PID: $pid) / 已停止端口 $port 上的进程"
                killed=true
            fi
        done
    else
        # Try lsof first, then fuser as fallback
        local pids
        pids=$(lsof -ti :"$port" 2>/dev/null)
        if [ -z "$pids" ] && command -v fuser &>/dev/null; then
            pids=$(fuser "$port/tcp" 2>/dev/null | tr -s ' ')
        fi
        if [ -z "$pids" ] && command -v ss &>/dev/null; then
            pids=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
        fi
        for pid in $pids; do
            pid=$(echo "$pid" | tr -d '[:space:]')
            [ -z "$pid" ] && continue
            kill -9 "$pid" 2>/dev/null && \
                warn "Killed existing process on port $port (PID: $pid) / 已停止端口 $port 上的进程"
            killed=true
        done
    fi

    # Wait for port to be released
    if [ "$killed" = true ]; then
        sleep 1
    fi
}

# ============ Cleanup & Signal Handling ============

cleanup() {
    echo ""
    info "Stopping all services / 正在停止所有服务..."

    for pid_var in FRONTEND_PID BACKEND_PID; do
        pid=${!pid_var}
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            info "Stopping PID $pid..."
            kill "$pid" 2>/dev/null
        fi
    done

    sleep 2

    for pid_var in FRONTEND_PID BACKEND_PID; do
        pid=${!pid_var}
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            warn "Force stopping PID $pid..."
            kill -9 "$pid" 2>/dev/null
        fi
    done

    info "All services stopped / 所有服务已停止"
}

handle_error() {
    error "Script failed, cleaning up / 脚本执行失败，正在清理..."
    cleanup
    exit 1
}

trap cleanup INT TERM

# ============ Main Script ============

OS=$(detect_os)

header "=========================================="
header "   Ecliptrix Start Script"
header "   Ecliptrix 一键启动脚本"
header "=========================================="
echo ""
info "OS / 操作系统: $OS"
info "Working Directory / 工作目录: $SCRIPT_DIR"
info "Frontend port / 前端端口: $FRONTEND_PORT"
if [ "$DEV_MODE" = true ]; then
    info "Mode / 模式: Development (npm run dev)"
else
    info "Mode / 模式: Production (npm run build + npm start)"
fi
echo ""

# ============ Step 1: Check Prerequisites ============
header "[1/5] Checking Prerequisites / 检查运行环境"

# --- Node.js ---
if ! command -v node &>/dev/null; then
    error "Node.js not found / 未找到 Node.js. Run install.sh first / 请先运行 install.sh"
    exit 1
fi
success "Node.js $(node --version)"

# --- npm ---
if ! command -v npm &>/dev/null; then
    error "npm not found / 未找到 npm"
    exit 1
fi
success "npm $(npm --version)"

# --- Python ---
PYTHON_CMD="python3"
if ! command -v python3 &>/dev/null; then
    PYTHON_CMD="python"
fi
if ! command -v $PYTHON_CMD &>/dev/null; then
    error "Python not found / 未找到 Python. Run install.sh first / 请先运行 install.sh"
    exit 1
fi
success "Python $($PYTHON_CMD --version 2>&1 | awk '{print $2}')"

# --- Backend directory ---
if [ ! -d "$BACKEND_DIR" ]; then
    error "Backend directory not found / 未找到后端目录: $BACKEND_DIR"
    exit 1
fi
success "Backend directory found / 后端目录已找到"

# --- Python environment ---
if [ -n "$CONDA_DEFAULT_ENV" ]; then
    success "Conda environment: $CONDA_DEFAULT_ENV"
elif [ -n "$VIRTUAL_ENV" ]; then
    success "Virtual environment: $VIRTUAL_ENV"
else
    warn "No conda/virtual environment detected / 未检测到 conda/虚拟环境"
    warn "Please activate your environment first / 请先激活你的环境:"
    warn "  conda activate ecliptrix"
    exit 1
fi

echo ""

# ============ Step 2: Ensure Database ============
header "[2/5] Checking Database / 检查数据库"

DB_STARTED=false

# Check if PostgreSQL is running via systemctl
if command -v systemctl &>/dev/null; then
    if systemctl is-active --quiet postgresql 2>/dev/null; then
        success "PostgreSQL service is running / PostgreSQL 服务运行中"
        DB_STARTED=true
    fi
fi

# Verify database connectivity
if [ "$DB_STARTED" = false ] && command -v psql &>/dev/null; then
    if PGPASSWORD=ecliptrix psql -w -h localhost -p 5432 -U ecliptrix -d ecliptrix -c "SELECT 1" &>/dev/null 2>&1; then
        success "PostgreSQL is reachable / PostgreSQL 可连接"
        DB_STARTED=true
    elif sudo -u postgres psql -c "SELECT 1" &>/dev/null 2>&1; then
        success "PostgreSQL server is running / PostgreSQL 服务器运行中"
        DB_STARTED=true
    fi
fi

if [ "$DB_STARTED" = false ]; then
    warn "Could not verify PostgreSQL is running / 无法确认 PostgreSQL 是否运行"
    warn "Start PostgreSQL: sudo systemctl start postgresql"
    warn "请启动 PostgreSQL: sudo systemctl start postgresql"
    warn "Backend may fail to start without database / 没有数据库后端可能无法启动"
fi

echo ""

# ============ Step 2.5: Detect stale .next vs source ============
FORCE_REBUILD=false
if [ -d "$SCRIPT_DIR/.next" ] && [ -f "$SCRIPT_DIR/.next/BUILD_ID" ]; then
    FIND_ROOTS=("$SCRIPT_DIR/src")
    [ -d "$SCRIPT_DIR/public" ] && FIND_ROOTS+=("$SCRIPT_DIR/public")
    NEWER=$(find "${FIND_ROOTS[@]}" \
                 -type f \
                 -newer "$SCRIPT_DIR/.next/BUILD_ID" \
                 -print -quit 2>/dev/null)
    if [ -n "$NEWER" ]; then
        warn "Stale .next detected (source newer than BUILD_ID): $NEWER"
        warn "Removing .next to force a rebuild / 检测到过期构建，强制重新构建"
        rm -rf "$SCRIPT_DIR/.next"
        FORCE_REBUILD=true
    fi
fi

# ============ Step 2.6: Sync Node dependencies ============
NEED_NPM_INSTALL=false
NPM_INSTALL_REASON=""
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    NEED_NPM_INSTALL=true
    NPM_INSTALL_REASON="node_modules/ missing"
elif [ -f "$SCRIPT_DIR/package-lock.json" ]; then
    if [ ! -f "$SCRIPT_DIR/node_modules/.package-lock.json" ]; then
        NEED_NPM_INSTALL=true
        NPM_INSTALL_REASON="node_modules/.package-lock.json missing"
    elif [ "$SCRIPT_DIR/package-lock.json" -nt "$SCRIPT_DIR/node_modules/.package-lock.json" ]; then
        NEED_NPM_INSTALL=true
        NPM_INSTALL_REASON="package-lock.json newer than node_modules/.package-lock.json"
    fi
fi

if [ "$NEED_NPM_INSTALL" = true ]; then
    warn "Node dependencies out of sync ($NPM_INSTALL_REASON) / 前端依赖不同步"
    cd "$SCRIPT_DIR"
    step "Running npm ci to sync dependencies / 运行 npm ci 同步依赖..."
    if npm ci 2>&1 | tee -a "$STARTUP_LOG"; then
        success "Node dependencies synced via npm ci / 前端依赖已同步"
    else
        warn "npm ci failed, falling back to npm install / npm ci 失败，回退到 npm install"
        if npm install 2>&1 | tee -a "$STARTUP_LOG"; then
            success "Node dependencies synced via npm install / 前端依赖已同步"
        else
            error "npm install failed / npm install 失败"
            handle_error
        fi
    fi
fi

echo ""

# ============ Step 3: Build Frontend (production mode only) ============
if [ "$DEV_MODE" = false ] || [ "$FORCE_REBUILD" = true ]; then
    header "[3/5] Building Frontend / 构建前端项目"
    cd "$SCRIPT_DIR"

    step "Running npm run build..."
    if ESLINT_NO_DEV_ERRORS=true npm run build 2>&1 | tee -a "$STARTUP_LOG"; then
        success "Frontend build complete / 前端构建完成"
    else
        error "Frontend build failed / 前端构建失败"
        handle_error
    fi
else
    info "[3/5] Skipping build (dev mode) / 跳过构建（开发模式）"
fi

echo ""

# ============ Step 4: Start Services ============
header "[4/5] Starting Services / 启动服务"

cd "$SCRIPT_DIR"

# --- Kill existing processes on service ports ---
step "Cleaning up occupied ports / 清理被占用的端口..."
kill_port 8000
kill_port $FRONTEND_PORT

# --- Start Backend Service ---
step "Starting backend service / 启动后端服务..."
(
    cd "$BACKEND_DIR"
    $PYTHON_CMD run.py
) > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

sleep 3

if kill -0 $BACKEND_PID 2>/dev/null; then
    success "Backend service started (PID: $BACKEND_PID) / 后端服务已启动"
else
    error "Backend service failed to start / 后端服务启动失败"
    error "Check log / 查看日志: $BACKEND_LOG"
    handle_error
fi

# --- Load Frontend Environment Variables ---
# Next.js may fail to load .env in production on some systems (CRLF issues, etc.)
# Explicitly export env vars from root .env to ensure they're available at runtime
# This only affects the frontend process (backend is already running)
step "Loading frontend environment variables / 加载前端环境变量..."
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # Strip CRLF (Windows line endings) before sourcing to avoid \r in values
    source <(sed 's/\r$//' "$SCRIPT_DIR/.env") 2>/dev/null || true
    set +a
    success "Environment variables loaded from .env / 已从 .env 加载环境变量"
else
    warn "No .env file found / 未找到 .env 文件, frontend may use default config"
fi

# --- Start Frontend Service ---
step "Starting frontend service / 启动前端服务..."
cd "$SCRIPT_DIR"
if [ "$DEV_MODE" = true ]; then
    npm run dev -- -p $FRONTEND_PORT > "$FRONTEND_LOG" 2>&1 &
else
    npm start -- -p $FRONTEND_PORT > "$FRONTEND_LOG" 2>&1 &
fi
FRONTEND_PID=$!

sleep 3

if kill -0 $FRONTEND_PID 2>/dev/null; then
    success "Frontend service started (PID: $FRONTEND_PID) / 前端服务已启动"
else
    error "Frontend service failed to start / 前端服务启动失败"
    error "Check log / 查看日志: $FRONTEND_LOG"
    handle_error
fi

echo ""

# ============ Step 5: Show Status ============
header "[5/5] All Services Running / 所有服务已启动"
echo ""
info "=========================================="
success "Ecliptrix started successfully!"
success "Ecliptrix 启动成功！"
info "=========================================="
echo ""
info "Services / 服务:"
info "  Frontend / 前端:     http://localhost:$FRONTEND_PORT  (PID: $FRONTEND_PID)"
info "  Backend  / 后端:     http://localhost:8000            (PID: $BACKEND_PID)"
echo ""
info "Logs / 日志:"
info "  Startup  / 启动: $STARTUP_LOG"
info "  Frontend / 前端: $FRONTEND_LOG"
info "  Backend  / 后端: $BACKEND_LOG"
echo ""
info "Press Ctrl+C to stop all services / 按 Ctrl+C 停止所有服务"
info "Or run: bash kill.sh / 或运行: bash kill.sh"
echo ""

# ============ Monitor Processes ============
while true; do
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        error "Frontend service stopped / 前端服务已停止"
        break
    fi

    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        error "Backend service stopped / 后端服务已停止"
        break
    fi

    sleep 5
done

# Cleanup on exit
cleanup
