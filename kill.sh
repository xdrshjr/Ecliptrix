#!/bin/bash

# ============================================
# Ecliptrix - Kill Services Script
# Ecliptrix 停止服务脚本
# ============================================
# Kills processes on ports used by Ecliptrix
# 停止 Ecliptrix 使用的端口上的进程
# ============================================

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)   echo "linux" ;;
        Darwin*)  echo "macos" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)        echo "unknown" ;;
    esac
}

OS=$(detect_os)

echo -e "${YELLOW}Stopping Ecliptrix services / 正在停止 Ecliptrix 服务...${NC}"
echo ""

# Ports to clean up (must match start.sh)
PORTS=(8000 3000 3001 3008 3010)

for PORT in "${PORTS[@]}"; do
    echo -e "${YELLOW}Checking port / 检查端口 ${PORT}...${NC}"

    KILLED=false

    if [ "$OS" = "windows" ]; then
        # Windows (Git Bash / MSYS2): use netstat + taskkill
        PIDS=$(netstat -ano 2>/dev/null | grep ":${PORT} " | grep "LISTENING" | awk '{print $5}' | sort -u)

        if [ -z "$PIDS" ]; then
            echo -e "${GREEN}  No process on port ${PORT} / 端口 ${PORT} 无进程${NC}"
        else
            for PID in $PIDS; do
                if [ "$PID" != "0" ] && [ -n "$PID" ]; then
                    taskkill //F //PID "$PID" > /dev/null 2>&1
                    if [ $? -eq 0 ]; then
                        echo -e "${GREEN}  Killed PID ${PID} on port ${PORT} / 已停止进程 ${PID}${NC}"
                        KILLED=true
                    else
                        echo -e "${RED}  Failed to kill PID ${PID} (may need admin) / 无法停止进程 ${PID}（可能需要管理员权限）${NC}"
                    fi
                fi
            done
            if [ "$KILLED" = false ]; then
                echo -e "${GREEN}  No process on port ${PORT} / 端口 ${PORT} 无进程${NC}"
            fi
        fi
    else
        # Linux / macOS: use lsof
        PIDS=$(lsof -ti :$PORT 2>/dev/null)

        if [ -z "$PIDS" ]; then
            echo -e "${GREEN}  No process on port ${PORT} / 端口 ${PORT} 无进程${NC}"
        else
            for PID in $PIDS; do
                kill -9 "$PID" 2>/dev/null
                if [ $? -eq 0 ]; then
                    echo -e "${GREEN}  Killed PID ${PID} on port ${PORT} / 已停止进程 ${PID}${NC}"
                else
                    echo -e "${RED}  Failed to kill PID ${PID} (may need sudo) / 无法停止进程 ${PID}（可能需要 sudo）${NC}"
                fi
            done
        fi
    fi
done

echo ""
echo -e "${GREEN}Done / 完成！${NC}"
