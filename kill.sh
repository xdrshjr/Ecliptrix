#!/bin/bash

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}开始清理端口进程...${NC}\n"

# 定义要清理的端口
PORTS=(8000 8001 3000 3001 3008)

# 遍历每个端口
for PORT in "${PORTS[@]}"; do
    echo -e "${YELLOW}检查端口 ${PORT}...${NC}"

    # 查找占用该端口的进程ID
    PIDS=$(lsof -ti :$PORT 2>/dev/null)

    if [ -z "$PIDS" ]; then
        echo -e "${GREEN}端口 ${PORT} 没有运行的进程${NC}\n"
    else
        echo -e "${RED}发现端口 ${PORT} 的进程: ${PIDS}${NC}"

        # 杀掉进程
        for PID in $PIDS; do
            kill -9 $PID 2>/dev/null
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}已杀掉进程 ${PID}${NC}"
            else
                echo -e "${RED}无法杀掉进程 ${PID} (可能需要sudo权限)${NC}"
            fi
        done
        echo ""
    fi
done

echo -e "${GREEN}端口清理完成！${NC}"