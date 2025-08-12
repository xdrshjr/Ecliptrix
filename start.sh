#!/bin/bash

# Ecliptrix 一键启动脚本
# 同时启动前端Next.js应用和后端FastAPI服务

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 默认配置
FRONTEND_PORT=3000
BACKEND_DIR="backend-services/basic-service"
LOG_DIR="logs"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_LOG="$LOG_DIR/backend.log"
STARTUP_LOG="$LOG_DIR/startup.log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log_info() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${BLUE}[INFO]${NC} ${timestamp} - $1" | tee -a "$STARTUP_LOG"
}

log_success() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${GREEN}[SUCCESS]${NC} ${timestamp} - $1" | tee -a "$STARTUP_LOG"
}

log_warning() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${YELLOW}[WARNING]${NC} ${timestamp} - $1" | tee -a "$STARTUP_LOG"
}

log_error() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${RED}[ERROR]${NC} ${timestamp} - $1" | tee -a "$STARTUP_LOG"
}

log_step() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${PURPLE}[STEP]${NC} ${timestamp} - $1" | tee -a "$STARTUP_LOG"
}

# 错误处理函数
handle_error() {
    log_error "脚本执行失败，正在清理进程..."
    cleanup
    exit 1
}

# 清理函数
cleanup() {
    log_info "正在停止所有服务..."
    
    # 停止前端进程
    if [ ! -z "$FRONTEND_PID" ]; then
        log_info "停止前端服务 (PID: $FRONTEND_PID)..."
        kill $FRONTEND_PID 2>/dev/null
    fi
    
    # 停止后端进程
    if [ ! -z "$BACKEND_PID" ]; then
        log_info "停止后端服务 (PID: $BACKEND_PID)..."
        kill $BACKEND_PID 2>/dev/null
    fi
    
    # 等待进程结束
    sleep 2
    
    # 强制停止如果还在运行
    if [ ! -z "$FRONTEND_PID" ] && kill -0 $FRONTEND_PID 2>/dev/null; then
        log_warning "强制停止前端服务..."
        kill -9 $FRONTEND_PID 2>/dev/null
    fi
    
    if [ ! -z "$BACKEND_PID" ] && kill -0 $BACKEND_PID 2>/dev/null; then
        log_warning "强制停止后端服务..."
        kill -9 $BACKEND_PID 2>/dev/null
    fi
    
    log_info "所有服务已停止"
}

# 设置信号处理
trap cleanup INT TERM

# 参数处理
if [ $# -eq 1 ]; then
    if [[ $1 =~ ^[0-9]+$ ]]; then
        FRONTEND_PORT=$1
        log_info "使用自定义前端端口: $FRONTEND_PORT"
    else
        log_error "端口号必须是数字"
        exit 1
    fi
fi

# 获取脚本目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

log_info "=========================================="
log_info "         Ecliptrix 启动脚本"
log_info "=========================================="
log_info "工作目录: $(pwd)"
log_info "前端端口: $FRONTEND_PORT"
log_info "后端目录: $BACKEND_DIR"

# 环境检查
log_step "检查运行环境..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js 未安装，请先安装 Node.js"
    exit 1
fi
NODE_VERSION=$(node --version)
log_success "Node.js 版本: $NODE_VERSION"

# 检查 npm
if ! command -v npm &> /dev/null; then
    log_error "npm 未安装，请先安装 npm"
    exit 1
fi
NPM_VERSION=$(npm --version)
log_success "npm 版本: $NPM_VERSION"

# 检查 Python
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null; then
    log_error "Python 未安装，请先安装 Python"
    exit 1
fi

PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

PYTHON_VERSION=$($PYTHON_CMD --version)
log_success "Python 版本: $PYTHON_VERSION"

# 检查 pip
if ! command -v pip &> /dev/null && ! command -v pip3 &> /dev/null; then
    log_error "pip 未安装，请先安装 pip"
    exit 1
fi

PIP_CMD="pip3"
if ! command -v pip3 &> /dev/null; then
    PIP_CMD="pip"
fi

PIP_VERSION=$($PIP_CMD --version)
log_success "pip 版本: $PIP_VERSION"

# 检查后端目录
if [ ! -d "$BACKEND_DIR" ]; then
    log_error "后端目录不存在: $BACKEND_DIR"
    exit 1
fi

if [ ! -f "$BACKEND_DIR/run.py" ]; then
    log_error "后端启动文件不存在: $BACKEND_DIR/run.py"
    exit 1
fi

## 前端依赖安装
#log_step "检查前端依赖..."
#if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
#    log_info "安装前端依赖..."
#    npm install
#    if [ $? -ne 0 ]; then
#        log_error "前端依赖安装失败"
#        handle_error
#    fi
#    log_success "前端依赖安装完成"
#else
#    log_info "前端依赖已存在，跳过安装"
#fi
#
## 后端依赖安装
#log_step "检查后端依赖..."
#cd "$BACKEND_DIR"
#
## 安装后端依赖
#if [ -f "requirements.txt" ]; then
#    log_info "安装后端依赖..."
#    $PIP_CMD install -r requirements.txt
#    if [ $? -ne 0 ]; then
#        log_error "后端依赖安装失败"
#        cd "$SCRIPT_DIR"
#        handle_error
#    fi
#    log_success "后端依赖安装完成"
#else
#    log_warning "requirements.txt 文件不存在"
#fi

cd "$SCRIPT_DIR"

# 构建前端
log_step "构建前端项目..."
ESLINT_NO_DEV_ERRORS=true npm run build
if [ $? -ne 0 ]; then
    log_error "前端构建失败"
    handle_error
fi
log_success "前端构建完成"

# 启动服务
log_step "启动服务..."

# 启动后端服务
log_info "启动后端服务..."
cd "$BACKEND_DIR"
nohup $PYTHON_CMD run.py > "../../$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
cd "$SCRIPT_DIR"

# 等待后端启动
sleep 3

# 检查后端是否启动成功
if kill -0 $BACKEND_PID 2>/dev/null; then
    log_success "后端服务启动成功 (PID: $BACKEND_PID)"
else
    log_error "后端服务启动失败"
    handle_error
fi

# 启动前端服务
log_info "启动前端服务..."
nohup npm start -- -p $FRONTEND_PORT > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

# 等待前端启动
sleep 3

# 检查前端是否启动成功
if kill -0 $FRONTEND_PID 2>/dev/null; then
    log_success "前端服务启动成功 (PID: $FRONTEND_PID)"
else
    log_error "前端服务启动失败"
    handle_error
fi

# 显示启动信息
log_info "=========================================="
log_success "🚀 Ecliptrix 启动成功！"
log_info "=========================================="
log_info "前端地址: http://localhost:$FRONTEND_PORT"
log_info "后端地址: http://localhost:8000"
log_info "前端PID: $FRONTEND_PID"
log_info "后端PID: $BACKEND_PID"
log_info "=========================================="
log_info "日志文件:"
log_info "  启动日志: $STARTUP_LOG"
log_info "  前端日志: $FRONTEND_LOG"
log_info "  后端日志: $BACKEND_LOG"
log_info "=========================================="
log_info "按 Ctrl+C 停止所有服务"

# 等待用户中断
while true; do
    # 检查进程是否还在运行
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        log_error "前端服务已停止"
        break
    fi
    
    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        log_error "后端服务已停止"
        break
    fi
    
    sleep 5
done

# 清理并退出
cleanup
log_info "脚本执行完成" 