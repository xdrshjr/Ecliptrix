# Ecliptrix 部署运维工具包 (ops/)

这个目录包含了 Ecliptrix 在 Linux 服务器上以 systemd 方式部署、监控、运维的全部脚本。
由 `web-deployer` skill 自动生成于 `2026-04-07`，目标服务器：**Singapore-01 (47.245.126.128)**。

## 目录结构

```
ops/
├── config.env                  # 中央配置：所有脚本读取它
├── install-deps.sh             # 安装系统依赖 + PostgreSQL + Python venv + npm
├── install.sh                  # 渲染并安装 systemd / nginx / logrotate
├── deploy.sh                   # 一键重新部署（git pull + 构建 + 重启）
├── uninstall.sh                # 卸载所有 systemd / nginx 配置
├── status.sh                   # 查看服务状态与健康检查
├── logs.sh                     # 查看 / 跟随服务日志
├── healthcheck.sh              # Watchdog 健康检查（systemd timer 自动调用）
├── README.md                   # 本文件
└── templates/                  # systemd / nginx / logrotate 模板
    ├── ecliptrix-backend.service
    ├── ecliptrix-frontend.service
    ├── ecliptrix-watchdog.service
    ├── ecliptrix-watchdog.timer
    ├── ecliptrix-logrotate
    └── ecliptrix-nginx
```

## 部署架构

```
                       ┌─────────────────────────────┐
                       │  Nginx (80)                 │
                       │  ecliptrix.com              │
                       └──────────┬──────────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                ↓ /api/*, /docs   ↓ /, /_next/*     │
   ┌──────────────────────┐  ┌──────────────────────┐
   │ Backend (FastAPI)    │  │ Frontend (Next.js)   │
   │ localhost:8088       │  │ localhost:3088       │
   │ ecliptrix-backend    │  │ ecliptrix-frontend   │
   └──────┬───────────────┘  └──────────────────────┘
          │
          ↓
   ┌──────────────────────┐
   │ PostgreSQL           │
   │ localhost:5432       │
   │ db=ecliptrix         │
   └──────────────────────┘

           ┌──────────────────────────────────────────┐
           │  Watchdog (systemd timer, 60s)           │
           │  连续 3 次失败 → systemctl restart       │
           └──────────────────────────────────────────┘
```

## 首次部署流程

> 假定项目代码已位于 `/root/ecliptrix`，且 `ops/` 目录已上传到 `/root/ecliptrix/ops/`。

```bash
cd /root/ecliptrix

# 1. 安装系统依赖、PostgreSQL、Python venv、npm 依赖
sudo bash ops/install-deps.sh

# 2. 编辑 .env 文件，确认密钥
vi backend-services/basic-service/.env   # LLM_API_KEY、DATABASE_URL 等
vi .env                                   # NEXT_PUBLIC_BACKEND_URL 等

# 3. 构建前端
NODE_OPTIONS=--max-old-space-size=4096 npm run build

# 4. 安装 systemd 单元 + nginx + watchdog 并启动
sudo bash ops/install.sh

# 5. 查看状态
bash ops/status.sh
```

## 日常运维

### 查看状态

```bash
./ops/status.sh
```

输出包含：
- 4 个 systemd 单元的运行状态
- 3 个 HTTP 健康端点的返回码
- 后端/前端端口监听情况
- Watchdog 失败计数
- 最近的 watchdog 日志

### 查看日志

```bash
./ops/logs.sh                  # 后端最近 100 行
./ops/logs.sh -f               # 跟随后端
./ops/logs.sh frontend -f      # 跟随前端
./ops/logs.sh watchdog         # 查看 watchdog
./ops/logs.sh all -f           # 跟随所有服务
./ops/logs.sh -n 500           # 最近 500 行
```

### 重新部署

```bash
sudo ./ops/deploy.sh                  # 完整流程：备份 + git pull + 依赖 + 构建 + 重启
sudo ./ops/deploy.sh --skip-pull      # 仅重新构建并重启（不拉代码）
sudo ./ops/deploy.sh --skip-build     # 跳过前端构建
sudo ./ops/deploy.sh --rollback       # 回滚到上一次备份
```

### 手动控制服务

```bash
# 重启
sudo systemctl restart ecliptrix-backend
sudo systemctl restart ecliptrix-frontend

# 停止
sudo systemctl stop ecliptrix-backend ecliptrix-frontend ecliptrix-watchdog.timer

# 查看 systemd 状态
systemctl status ecliptrix-backend
systemctl status ecliptrix-frontend
systemctl list-timers | grep ecliptrix
```

### 卸载

```bash
sudo ./ops/uninstall.sh           # 仅删除服务，保留代码与数据
sudo ./ops/uninstall.sh --purge   # 同时删除数据库（不可逆）
```

## 看门狗 (Watchdog) 机制

- **触发器**：`ecliptrix-watchdog.timer`（systemd timer）
- **频率**：每 `WATCHDOG_INTERVAL` 秒（默认 60s）
- **检查目标**：
  - `http://localhost:8088/health` （后端，回退到 `/docs`）
  - `http://localhost:3088/` （前端）
- **失败处理**：
  - HTTP 不在 2xx/3xx 时计为失败
  - **如果端口仍在监听则不计失败**（避免在繁忙时误重启）
  - 连续 `WATCHDOG_FAIL_THRESHOLD` 次（默认 3 次）失败 → `systemctl restart`
  - 重启后失败计数清零
- **状态文件**：`/var/lib/ecliptrix-watchdog/ecliptrix-watchdog-{backend|frontend}-failures`
- **并发保护**：`flock` 锁文件 `/var/lib/ecliptrix-watchdog/ecliptrix-watchdog.lock`

查看实时检查日志：

```bash
journalctl -u ecliptrix-watchdog -f
# 或
./ops/logs.sh watchdog -f
```

## 配置文件 (config.env)

修改任何配置后，请重新运行 `sudo ./ops/install.sh` 让更改生效。

| 变量 | 当前值 | 说明 |
|---|---|---|
| `PROJECT_DIR` | `/root/ecliptrix` | 项目根目录 |
| `RUN_USER` / `RUN_GROUP` | `root` / `root` | 运行用户 |
| `BACKEND_PORT` | `8088` | FastAPI 监听端口 |
| `FRONTEND_PORT` | `3088` | Next.js 监听端口 |
| `WATCHDOG_INTERVAL` | `60` | watchdog 检查间隔（秒） |
| `WATCHDOG_FAIL_THRESHOLD` | `3` | 连续失败重启阈值 |
| `NGINX_DOMAIN` | `ecliptrix.com www.ecliptrix.com` | nginx server_name |
| `DB_NAME / DB_USER / DB_PASS` | `ecliptrix / ecliptrix / ecliptrix` | PostgreSQL 配置 |

## 添加 SSL（HTTPS）

域名解析到服务器后，可以一键加 SSL：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ecliptrix.com -d www.ecliptrix.com
```

certbot 会自动改写 nginx 配置加上 443 listener 和证书路径。

## 故障排查

| 现象 | 排查命令 |
|---|---|
| 后端启动失败 | `journalctl -u ecliptrix-backend -n 100` |
| 前端启动失败 | `journalctl -u ecliptrix-frontend -n 100` |
| Nginx 502 | `curl -v http://localhost:8088/health` `curl -v http://localhost:3088/` |
| 数据库连不上 | `sudo -u postgres psql -c "\l"` `systemctl status postgresql` |
| Watchdog 频繁重启 | `journalctl -u ecliptrix-watchdog -n 200 \| grep -E 'FAIL\|RESTART'` |
| Nginx 配置错误 | `sudo nginx -t` |
| 端口冲突 | `ss -tlnp \| grep -E ':(3088\|8088\|80)'` |
| 内存不足 (OOM) | `dmesg \| grep -i oom` `free -h` |

## 资源限制说明

- 服务器是 7.1GB 内存的小机器，配置中已加 `MemoryMax`：
  - Backend: `MemoryMax=4G`
  - Frontend: `MemoryMax=3G`
- Next.js build 通过 `NODE_OPTIONS=--max-old-space-size=4096` 提升 heap，避免 OOM
- 如果之后扩容，可在 service 文件中调高 `MemoryMax`，然后 `sudo systemctl daemon-reload && sudo systemctl restart ecliptrix-{backend,frontend}`

## 部署到非 8000 端口的额外配置（重要）

Next.js 的 API route handler 代码里读取的环境变量名 **不统一**，已发现 3 种：

| 变量名 | 调用次数 | 示例路由 |
|---|---|---|
| `BACKEND_URL` | 67 | storage/_, storyboard/_, youtube/_, chat, video-cut |
| `BACKEND_SERVICE_URL` | 13 | /api/config, /api/timeline-export, 部分 workflow 路由 |
| `PYTHON_BACKEND_URL` | 几次 | 部分 workflow agent 路由 |

每个文件都有 `|| 'http://localhost:8000'` 的硬编码 fallback。如果后端不在 8000 端口（生产用 8088），**这 3 个变量必须全部设到 .env**，否则部分路由会落到 fallback 然后 ECONNREFUSED：

```bash
# 在 /root/ecliptrix/.env 末尾必须有这三行（值都指向真实后端端口）
BACKEND_URL=http://localhost:8088
BACKEND_SERVICE_URL=http://localhost:8088
PYTHON_BACKEND_URL=http://localhost:8088
```

修改后必须 `sudo systemctl restart ecliptrix-frontend` 让 systemd 重新读 EnvironmentFile。
