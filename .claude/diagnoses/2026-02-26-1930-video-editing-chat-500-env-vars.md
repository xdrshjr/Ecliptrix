# Bug Diagnosis: video-editing-chat-500-env-vars

**Date:** 2026-02-26 19:30
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

部署在服务器上（Linux, IP: 192.168.1.123），使用 `start.sh` 启动后，`POST /api/video-editing-chat` 返回 500 Internal Server Error。

## Root Cause

**Next.js 生产模式没有正确读取根目录 `.env` 中的 LLM 环境变量**，导致使用了代码默认值：

- `LLM_API_URL` → 未读到 → fallback 到 `https://api.openai.com/v1`
- `LLM_MODEL` → 未读到 → fallback 到 `gpt-3.5-turbo`
- `LLM_API_KEY` → 可能通过系统环境的 `OPENAI_API_KEY` 获取到

服务器无法访问 `api.openai.com`（ConnectTimeoutError: 199.59.148.96:443, timeout: 10000ms），导致 500 错误。

**根本原因：** `.env` 文件使用 Windows CRLF 行尾 (`\r\n`)，在 Linux 服务器上可能导致 Next.js 的 dotenv 解析异常。同时 `start.sh` 等 shell 脚本也有 CRLF 问题。

**日志证据：**
```
[Video Editing Chat API] Model: gpt-3.5-turbo
[Video Editing Chat API] 调用 LLM API: https://api.openai.com/v1/chat/completions
[Video Editing Chat API] 意外错误: TypeError: fetch failed
  [cause]: ConnectTimeoutError: Connect Timeout Error (attempted addresses: 199.59.148.96:443, timeout: 10000ms)
```

## Fix Applied

**Files modified:**
- `start.sh:315-328` - 在启动前端前显式加载 `.env` 环境变量（带 CRLF 处理）
- `.env` - 行尾从 CRLF 转为 LF
- `backend-services/basic-service/.env` - 行尾从 CRLF 转为 LF
- `start.sh` - 行尾从 CRLF 转为 LF
- `install.sh` - 行尾从 CRLF 转为 LF
- `kill.sh` - 行尾从 CRLF 转为 LF
- `.gitattributes` - 新增，强制 `.env` 和 `.sh` 文件使用 LF 行尾

**Changes:**
1. 在 `start.sh` 中，后端启动后、前端启动前，用 `set -a` + `source` 显式导出 `.env` 环境变量，并用 `sed 's/\r$//'` 处理 CRLF
2. 将所有 `.env` 和 `.sh` 文件转为 LF 格式
3. 添加 `.gitattributes` 防止 git 在 Windows 上自动转为 CRLF

## Verification

需要在服务器上重新部署并测试：
1. `git pull` 获取更新
2. `bash start.sh` 重新启动
3. 检查 `logs/frontend.log` 确认 Model 和 URL 使用了正确的 dashscope 配置
4. 测试 `/api/video-editing-chat` 接口

## Notes

- 后端不受影响：`start.sh` 在后端已启动后才 source `.env`，后端进程不会继承这些变量
- Python 后端使用 `python-dotenv` 读取自己目录下的 `.env`，不受根目录 `.env` 影响
- `NEXT_PUBLIC_*` 变量在 `npm run build` 时被内联，运行时的 `source .env` 不影响它们
