#!/bin/bash

# ============================================
# Ecliptrix - One-Click Installation Script
# Ecliptrix 一键安装脚本
# ============================================
# Usage: bash install.sh [--skip-db] [--skip-frontend] [--skip-backend]
#
# Options:
#   --skip-db        Skip PostgreSQL database setup
#   --skip-frontend  Skip frontend (Node.js) installation
#   --skip-backend   Skip backend (Python) installation
#   --cn-mirror      Use Chinese mirror sources (npm/pip)
#   --help           Show this help message
# ============================================

set -o pipefail

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
INSTALL_LOG="$LOG_DIR/install.log"

# Database defaults
DB_NAME="ecliptrix"
DB_USER="ecliptrix"
DB_PASS="ecliptrix"
DB_HOST="localhost"
DB_PORT="5432"

# Database method (detected in Step 1): psql | none
DB_METHOD="none"

# Flags
SKIP_DB=false
SKIP_FRONTEND=false
SKIP_BACKEND=false
CN_MIRROR=false

# ============ Parse Arguments ============
for arg in "$@"; do
    case $arg in
        --skip-db)       SKIP_DB=true ;;
        --skip-frontend) SKIP_FRONTEND=true ;;
        --skip-backend)  SKIP_BACKEND=true ;;
        --cn-mirror)     CN_MIRROR=true ;;
        --help)
            head -n 14 "$0" | tail -n 10
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            exit 1
            ;;
    esac
done

# ============ Logging Functions ============
mkdir -p "$LOG_DIR"

log() {
    local level=$1 color=$2 msg=$3
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${color}[${level}]${NC} ${timestamp} - ${msg}" | tee -a "$INSTALL_LOG"
}

info()    { log "INFO"    "$BLUE"   "$1"; }
success() { log "OK"      "$GREEN"  "$1"; }
warn()    { log "WARN"    "$YELLOW" "$1"; }
error()   { log "ERROR"   "$RED"    "$1"; }
step()    { log "STEP"    "$PURPLE" "$1"; }
header()  { echo -e "\n${BOLD}${CYAN}$1${NC}" | tee -a "$INSTALL_LOG"; }

# ============ Helper Functions ============

# Compare version strings: returns 0 if $1 >= $2
version_gte() {
    local v1 v2
    v1=$(echo "$1" | sed 's/^v//' | sed 's/[^0-9.]//g')
    v2=$(echo "$2" | sed 's/^v//' | sed 's/[^0-9.]//g')
    [ "$(printf '%s\n' "$v2" "$v1" | sort -V | head -n1)" = "$v2" ]
}

# Detect Python command (python3 or python)
detect_python() {
    if command -v python3 &>/dev/null; then
        echo "python3"
    elif command -v python &>/dev/null; then
        echo "python"
    else
        echo ""
    fi
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)   echo "linux" ;;
        Darwin*)  echo "macos" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)        echo "unknown" ;;
    esac
}

# ============ Main Script ============

header "============================================"
header "   Ecliptrix Installation Script"
header "   Ecliptrix 一键安装脚本"
header "============================================"
echo ""

OS=$(detect_os)
info "Operating System / 操作系统: $OS"
info "Working Directory / 工作目录: $SCRIPT_DIR"
info "Install Log / 安装日志: $INSTALL_LOG"
echo ""

# ============ Step 1: Check Prerequisites ============
header "[1/7] Checking Prerequisites / 检查系统依赖"

PREREQ_OK=true

# --- Node.js ---
step "Checking Node.js..."
if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    if version_gte "$NODE_VER" "18.0.0"; then
        success "Node.js $NODE_VER"
    else
        error "Node.js $NODE_VER is too old. Required: >= 18.0.0"
        error "Node.js 版本过低，需要 >= 18.0.0"
        PREREQ_OK=false
    fi
else
    error "Node.js not found / 未找到 Node.js"
    error "Install from: https://nodejs.org/ (LTS recommended)"
    PREREQ_OK=false
fi

# --- npm ---
step "Checking npm..."
if command -v npm &>/dev/null; then
    NPM_VER=$(npm --version)
    success "npm $NPM_VER"
else
    error "npm not found / 未找到 npm"
    PREREQ_OK=false
fi

# --- Python ---
step "Checking Python..."
PYTHON_CMD=$(detect_python)
if [ -n "$PYTHON_CMD" ]; then
    PY_VER=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
    if version_gte "$PY_VER" "3.10.0"; then
        success "Python $PY_VER ($PYTHON_CMD)"
    else
        error "Python $PY_VER is too old. Required: >= 3.10.0"
        error "Python 版本过低，需要 >= 3.10.0"
        PREREQ_OK=false
    fi
else
    error "Python not found / 未找到 Python"
    error "Install from: https://www.python.org/downloads/"
    PREREQ_OK=false
fi

# --- FFmpeg ---
step "Checking FFmpeg..."
if command -v ffmpeg &>/dev/null; then
    FFMPEG_VER=$(ffmpeg -version 2>&1 | head -n1 | awk '{print $3}')
    success "FFmpeg $FFMPEG_VER"
else
    warn "FFmpeg not found / 未找到 FFmpeg"
    warn "Video processing features will not work without FFmpeg"
    warn "视频处理功能需要 FFmpeg，请安装后再使用相关功能"
    case $OS in
        linux)   warn "  Install: sudo apt install ffmpeg" ;;
        macos)   warn "  Install: brew install ffmpeg" ;;
        windows) warn "  Install: choco install ffmpeg  OR  https://ffmpeg.org/download.html" ;;
    esac
fi

# --- PostgreSQL ---
step "Checking PostgreSQL setup method..."
if [ "$SKIP_DB" = false ]; then
    if command -v psql &>/dev/null; then
        PG_VER=$(psql --version 2>&1 | awk '{print $3}')
        success "PostgreSQL client $PG_VER"
        DB_METHOD="psql"
    else
        warn "psql not found / 未找到 psql"
        warn "Will attempt to install PostgreSQL / 将尝试安装 PostgreSQL"
        case $OS in
            linux)
                step "Installing PostgreSQL via apt / 通过 apt 安装 PostgreSQL..."
                if sudo apt-get update -qq >> "$INSTALL_LOG" 2>&1 && \
                   sudo apt-get install -y -qq postgresql postgresql-client >> "$INSTALL_LOG" 2>&1; then
                    success "PostgreSQL installed / PostgreSQL 安装完成"
                    # Start PostgreSQL service
                    sudo systemctl enable postgresql >> "$INSTALL_LOG" 2>&1 || true
                    sudo systemctl start postgresql >> "$INSTALL_LOG" 2>&1 || true
                    DB_METHOD="psql"
                else
                    error "Failed to install PostgreSQL / PostgreSQL 安装失败"
                    warn "Install manually: sudo apt install postgresql postgresql-client"
                    SKIP_DB=true
                fi
                ;;
            macos)
                if command -v brew &>/dev/null; then
                    step "Installing PostgreSQL via Homebrew / 通过 Homebrew 安装 PostgreSQL..."
                    if brew install postgresql@16 >> "$INSTALL_LOG" 2>&1; then
                        brew services start postgresql@16 >> "$INSTALL_LOG" 2>&1 || true
                        success "PostgreSQL installed / PostgreSQL 安装完成"
                        DB_METHOD="psql"
                    else
                        error "Failed to install PostgreSQL / PostgreSQL 安装失败"
                        SKIP_DB=true
                    fi
                else
                    warn "Homebrew not found. Install PostgreSQL manually: brew install postgresql@16"
                    SKIP_DB=true
                fi
                ;;
            *)
                warn "Auto-install not supported on this OS / 该系统不支持自动安装"
                warn "Please install PostgreSQL manually / 请手动安装 PostgreSQL"
                warn "  https://www.postgresql.org/download/"
                SKIP_DB=true
                ;;
        esac
    fi
else
    info "Database setup skipped by flag / 已通过参数跳过数据库配置"
fi

if [ "$PREREQ_OK" = false ]; then
    error "============================================"
    error "Missing required prerequisites. Please install them first."
    error "缺少必要依赖，请先安装上述缺失的工具。"
    error "============================================"
    exit 1
fi

echo ""
success "All prerequisites OK / 所有依赖检查通过"

# ============ Step 2: Frontend Installation ============
if [ "$SKIP_FRONTEND" = false ]; then
    header "[2/7] Installing Frontend Dependencies / 安装前端依赖"

    cd "$SCRIPT_DIR"

    NPM_ARGS=""
    if [ "$CN_MIRROR" = true ]; then
        info "Using Chinese npm mirror / 使用国内 npm 镜像"
        NPM_ARGS="--registry https://registry.npmmirror.com"
    fi

    step "Running npm install..."
    if npm install $NPM_ARGS 2>&1 | tee -a "$INSTALL_LOG"; then
        success "Frontend dependencies installed / 前端依赖安装完成"
    else
        error "npm install failed / npm install 失败"
        exit 1
    fi
else
    info "[2/8] Skipping frontend installation (--skip-frontend)"
fi

# ============ Step 3: Backend Python Dependencies (basic-service) ============
if [ "$SKIP_BACKEND" = false ]; then
    header "[3/7] Installing Backend Python Dependencies / 安装后端 Python 依赖"

    cd "$BACKEND_DIR"

    # Check if running inside a conda/virtual environment
    if [ -n "$CONDA_DEFAULT_ENV" ]; then
        info "Using conda environment: $CONDA_DEFAULT_ENV"
    elif [ -n "$VIRTUAL_ENV" ]; then
        info "Using virtual environment: $VIRTUAL_ENV"
    else
        warn "============================================"
        warn "No conda/virtual environment detected! / 未检测到 conda/虚拟环境！"
        warn "It is recommended to create a dedicated environment first / 建议先创建独立环境："
        warn ""
        warn "  conda create -n ecliptrix python=3.10 -y"
        warn "  conda activate ecliptrix"
        warn ""
        warn "Then re-run this script / 然后重新运行此脚本"
        warn "============================================"
        echo ""
        read -r -p "Continue installing into system Python anyway? / 仍然安装到系统 Python？ [y/N] " REPLY
        if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
            info "Installation aborted. Please activate a conda environment and re-run."
            info "安装已中止，请激活 conda 环境后重新运行。"
            exit 0
        fi
    fi

    PIP_ARGS=""
    if [ "$CN_MIRROR" = true ]; then
        PIP_ARGS="-i https://pypi.tuna.tsinghua.edu.cn/simple"
    fi

    # Upgrade pip
    step "Upgrading pip..."
    pip install --upgrade pip $PIP_ARGS 2>&1 | tee -a "$INSTALL_LOG"

    # Install Python dependencies
    step "Installing Python dependencies / 安装 Python 依赖..."
    if pip install -r requirements.txt $PIP_ARGS 2>&1 | tee -a "$INSTALL_LOG"; then
        success "Python dependencies installed / Python 依赖安装完成"
    else
        error "pip install failed / pip install 失败"
        exit 1
    fi

    # Install Playwright browsers (for browser automation features)
    step "Installing Playwright browsers (this may take a while) / 安装 Playwright 浏览器..."
    $PYTHON_CMD -m playwright install chromium 2>&1 | tee -a "$INSTALL_LOG" || warn "Playwright install skipped (optional) / Playwright 安装跳过（可选功能）"
else
    info "[3/8] Skipping backend installation (--skip-backend)"
fi

# ============ Step 4: Environment Configuration ============
header "[4/7] Setting Up Environment Files / 配置环境变量文件"

# Frontend .env.local
FRONTEND_ENV="$SCRIPT_DIR/.env.local"
if [ ! -f "$FRONTEND_ENV" ]; then
    if [ -f "$SCRIPT_DIR/env.template" ]; then
        step "Creating frontend .env.local from template / 从模板创建前端 .env.local"
        cp "$SCRIPT_DIR/env.template" "$FRONTEND_ENV"
        success "Created $FRONTEND_ENV"
        warn "Please edit .env.local and fill in your API keys / 请编辑 .env.local 填入你的 API 密钥"
    else
        warn "No env.template found, skipping frontend env setup"
    fi
else
    info "Frontend .env.local already exists / 前端 .env.local 已存在"
fi

# Backend .env
BACKEND_ENV="$BACKEND_DIR/.env"
BACKEND_ENV_TEMPLATE="$BACKEND_DIR/env.template"
if [ ! -f "$BACKEND_ENV" ]; then
    if [ -f "$BACKEND_ENV_TEMPLATE" ]; then
        step "Creating backend .env from template / 从模板创建后端 .env"
        cp "$BACKEND_ENV_TEMPLATE" "$BACKEND_ENV"
        success "Created $BACKEND_ENV"
        warn "Please edit backend .env and fill in your API keys"
        warn "请编辑后端 .env 并填入你的 API 密钥"
    else
        warn "No backend env.template found"
    fi
else
    info "Backend .env already exists / 后端 .env 已存在"
fi

# ============ Step 5: Database Setup ============
if [ "$SKIP_DB" = false ]; then
    header "[5/7] Setting Up PostgreSQL Database / 配置 PostgreSQL 数据库"

    if [ "$DB_METHOD" = "psql" ]; then
        step "Setting up PostgreSQL database / 配置 PostgreSQL 数据库..."

        # Try connecting via sudo -u postgres (common on Linux servers)
        # or via psql -U postgres (password-based auth)
        PG_CONNECTED=false

        if sudo -u postgres psql -c "SELECT 1" &>/dev/null 2>&1; then
            PG_CMD="sudo -u postgres psql"
            PG_CONNECTED=true
        elif psql -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "SELECT 1" &>/dev/null 2>&1; then
            PG_CMD="psql -w -h $DB_HOST -p $DB_PORT -U postgres"
            PG_CONNECTED=true
        fi

        if [ "$PG_CONNECTED" = true ]; then
            success "PostgreSQL server is running / PostgreSQL 服务器运行中"

            DB_EXISTS=$($PG_CMD -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null)

            if [ "$DB_EXISTS" = "1" ]; then
                info "Database '$DB_NAME' already exists / 数据库已存在"
            else
                step "Creating database and user / 创建数据库和用户..."

                $PG_CMD -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true

                if $PG_CMD -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null; then
                    success "Database '$DB_NAME' created / 数据库创建成功"

                    $PG_CMD -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null

                    PGPASSWORD="$DB_PASS" psql -w -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
                        "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || \
                    $PG_CMD -d "$DB_NAME" -c \
                        "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true

                    success "Database setup complete / 数据库配置完成"
                else
                    error "Failed to create database / 数据库创建失败"
                    warn "You may need to create it manually / 你可能需要手动创建数据库:"
                    warn "  sudo -u postgres psql"
                    warn "  CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
                    warn "  CREATE DATABASE $DB_NAME OWNER $DB_USER;"
                fi
            fi
        else
            warn "Cannot connect to PostgreSQL server / 无法连接到 PostgreSQL 服务器"
            warn "Make sure PostgreSQL is running / 请确保 PostgreSQL 正在运行"
            warn "  sudo systemctl start postgresql"
            echo ""
            warn "Then set up the database manually / 然后手动设置数据库:"
            warn "  sudo -u postgres psql"
            warn "  CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
            warn "  CREATE DATABASE $DB_NAME OWNER $DB_USER;"
            warn "  GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
        fi
    fi
else
    info "[5/7] Skipping database setup (--skip-db)"
fi

# ============ Step 6: Run Database Migrations ============
if [ "$SKIP_DB" = false ] && [ "$SKIP_BACKEND" = false ]; then
    header "[6/7] Running Database Migrations / 执行数据库迁移"

    cd "$BACKEND_DIR"

    step "Running Alembic migrations / 运行 Alembic 迁移..."
    if alembic upgrade head 2>&1 | tee -a "$INSTALL_LOG"; then
        success "Database migrations complete / 数据库迁移完成"
    else
        warn "Alembic migration failed (database may not be accessible yet)"
        warn "迁移失败（数据库可能尚未就绪）"
        warn "Run manually later / 稍后手动运行:"
        warn "  cd $BACKEND_DIR && alembic upgrade head"
    fi
else
    info "[6/7] Skipping database migrations"
fi

# ============ Step 7: Create Required Directories ============
header "[7/7] Creating Required Directories / 创建必要目录"

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
    "$LOG_DIR"
)

for dir in "${DIRS[@]}"; do
    mkdir -p "$dir"
done
success "All directories created / 所有目录已创建"

# ============ Installation Summary ============
header "============================================"
header "   Installation Complete!"
header "   安装完成！"
header "============================================"
echo ""

echo -e "${BOLD}Project Structure / 项目结构:${NC}"
echo "  Frontend   / 前端:     $SCRIPT_DIR"
echo "  Backend    / 后端:     $BACKEND_DIR"
if [ -n "$CONDA_DEFAULT_ENV" ]; then
    echo "  Conda env:              $CONDA_DEFAULT_ENV"
fi
echo ""

echo -e "${BOLD}Configuration Files / 配置文件:${NC}"
if [ -f "$FRONTEND_ENV" ]; then
    echo -e "  Frontend .env: ${GREEN}$FRONTEND_ENV${NC}"
else
    echo -e "  Frontend .env: ${RED}Not created (copy env.template to .env.local)${NC}"
fi
if [ -f "$BACKEND_ENV" ]; then
    echo -e "  Backend  .env: ${GREEN}$BACKEND_ENV${NC}"
else
    echo -e "  Backend  .env: ${RED}Not created (copy env.template to .env)${NC}"
fi
echo ""

echo -e "${BOLD}Next Steps / 下一步:${NC}"
echo ""
echo -e "  ${YELLOW}1.${NC} Edit environment files with your API keys / 编辑环境变量文件，填入你的 API 密钥:"
echo "     - $FRONTEND_ENV"
echo "     - $BACKEND_ENV"
echo ""

if [ "$SKIP_DB" = true ]; then
    echo -e "  ${YELLOW}2.${NC} Set up PostgreSQL database / 配置 PostgreSQL 数据库:"
    echo ""
    case $OS in
        linux)   echo "     Install: sudo apt install postgresql postgresql-client" ;;
        macos)   echo "     Install: brew install postgresql@16 && brew services start postgresql@16" ;;
        windows) echo "     Install: https://www.postgresql.org/download/windows/" ;;
    esac
    echo ""
    echo "     Then create the database / 然后创建数据库:"
    echo "     sudo -u postgres psql"
    echo "     CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
    echo "     CREATE DATABASE $DB_NAME OWNER $DB_USER;"
    echo "     GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
    echo ""
    echo -e "  ${YELLOW}3.${NC} Run database migrations / 运行数据库迁移:"
    echo "     cd $BACKEND_DIR"
    echo "     conda activate ecliptrix  # or your environment name"
    echo "     alembic upgrade head"
    echo ""
fi

echo -e "  ${YELLOW}Start Services / 启动服务:${NC}"
echo ""
echo "     # One-click start (recommended) / 一键启动（推荐）:"
echo "     bash start.sh"
echo ""
echo "     # Or start manually / 或手动启动:"
echo ""
echo "     # Terminal 1: Start Backend / 启动后端"
echo "     cd $BACKEND_DIR"
echo "     conda activate ecliptrix  # or your environment name"
echo "     uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo ""
echo "     # Terminal 2: Start Frontend / 启动前端"
echo "     cd $SCRIPT_DIR"
echo "     npm run dev"
echo ""

echo -e "  ${YELLOW}Access / 访问:${NC}"
echo "     Frontend: http://localhost:3000"
echo "     Backend:  http://localhost:8000"
echo "     API Docs: http://localhost:8000/docs"
echo ""

echo -e "  ${YELLOW}Default Login / 默认登录:${NC}"
echo "     Username: admin"
echo "     Password: admin"
echo ""

echo -e "${GREEN}Installation log saved to: $INSTALL_LOG${NC}"
echo ""