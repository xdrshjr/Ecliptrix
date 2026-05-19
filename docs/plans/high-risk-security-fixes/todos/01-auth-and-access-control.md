# TODO 01：鉴权与访问控制加固

> 对应 spec：[`specs/01-auth-and-access-control.md`](../specs/01-auth-and-access-control.md)

## Dependencies

- **depends_on:** 无（首批可启动）
- **blocks:** `04`（spec/04 的鉴权前提依赖 spec/01 引入的 `storage_files_router`）
- **parallel_group:** A

**依赖原因**：spec/04 文件上传/下载加固假定所有 storage 端点都已挂上 `Depends(get_current_user)`；该 dependency 在 spec/01 落地后才存在。

## 任务清单

### 阶段 A：核验 + 准备（无破坏性）

- [ ] A1 — Read `backend-services/basic-service/app/main.py` 完整文件，标注所有 `include_router` 调用位置与 prefix
- [ ] A2 — Read `backend-services/basic-service/app/middleware/auth_middleware.py`，确认白名单逻辑与前缀匹配规则
- [ ] A3 — Read `backend-services/basic-service/app/dependencies/auth.py`，确认 `get_current_user` / `require_admin` / `require_root` 签名
- [ ] A4 — `Grep -rn "admin" backend-services/basic-service/app/routers/` 列出所有 admin 相关 router 文件
- [ ] A5 — `Grep -n "Depends" <admin router 文件>` 核验每个 admin 端点的 dependencies
- [ ] A6 — 用 `curl` 或 pytest TestClient 实测：未鉴权请求 `/api/workflow/ai-video-generate`、`/api/workflow/video-export`、`/api/intent-detection/detect`、`/api/workflow/test-node` 是否返回 200（确认威胁）

### 阶段 B：修复 V01-A（root-level router 鉴权）

- [ ] B1 — 修改 `backend-services/basic-service/app/routers/ai_video_generate_router.py`：在 APIRouter 实例化时加 `dependencies=[Depends(get_current_user)]`
- [ ] B2 — 同上修改 `video_export_router.py` 与 `intent_detection_router.py`
- [ ] B3 — 不动 `main.py` 的 `include_router` 行（保留 root-level mount）
- [ ] B4 — 为 `auth_middleware.SessionAuthMiddleware` 加显式硬名单：path 命中 `/api/workflow/ai-video-generate`、`/api/workflow/video-export`、`/api/intent-detection/*` 时强制要求 session
- [ ] B5 — 写 pytest：未鉴权 → 401；有 token → 200/202

### 阶段 C：修复 V01-B（前端 BFF test-node）

- [ ] C1 — Read `src/app/api/workflow/test-node/route.ts` 全部
- [ ] C2 — 在 `src/lib/auth/` 下新建或复用 `sessionGuard.ts`，导出 `verifySessionFromCookie(req)` helper
  - 读取 `ecliptrix-session-token` cookie 或 `Authorization: Bearer` header
  - 调用后端 `/api/auth/validate-session` 验证
- [ ] C3 — 在 `test-node/route.ts` 的 `POST` 函数入口加 session 校验，失败返回 401
- [ ] C4 — 写 Jest/Vitest 测试（如项目已有 frontend 测试框架）或 pytest 集成测试（通过 BACKEND_URL proxy）

### 阶段 D：修复 V01-C（storage files 替换 StaticFiles）

- [ ] D1 — 新建 `backend-services/basic-service/app/routers/storage_files_router.py`
  - `GET /api/storage/files/{path:path}` with `Depends(get_current_user)`
  - 内部：用 `storage_service._validate_path` 校验路径
  - 根据 path 前缀判断公共/私有：`cached_materials/` 前缀 → 任何已登录用户；其他 → 只允许 owner 或 admin
  - 用 `FileResponse` 返回，加 `X-Content-Type-Options: nosniff`
- [ ] D2 — Read `app/main.py` 找到 `app.mount("/api/storage/files", StaticFiles(...))` 行
- [ ] D3 — 替换：移除 mount 行，改为 `app.include_router(storage_files_router, prefix="/api")`
- [ ] D4 — 确认 owner 字段获取方式：read `app/models/db_models.py` 看 storage file 表的 owner_id 字段（如不存在，则只做 path-prefix 隔离 + admin 跨用户访问）
- [ ] D5 — 写 pytest：用户 A 读自己的文件 200；用户 A 读用户 B 的文件 403；admin 读任意文件 200；匿名 401

### 阶段 E：修复 V01-D（admin router 全量核验）

- [ ] E1 — 基于 A4-A5 的盘点结果，对每个未受保护的 admin 端点添加 `dependencies=[Depends(require_admin)]`
- [ ] E2 — 写 pytest：匿名 → 401；普通用户 → 403；admin → 200

### 阶段 F：回归与冒烟

- [ ] F1 — 在 `backend-services/basic-service/tests/security/__init__.py` 与 `tests/security/conftest.py` 加测试基础设施（如果不存在）
- [ ] F2 — 跑 `pytest backend-services/basic-service/tests/security/test_01_auth.py -v` 全部通过
- [ ] F3 — 跑全套 `pytest backend-services/basic-service/tests/ -v` 验证未引入回归
- [ ] F4 — 前端：`npm run type-check` 与 `npm run lint` 通过

## 完成准则

- [ ] 4 项威胁（V01-A/B/C/D）均有补丁或显式标注为不适用
- [ ] 每项有对应回归测试（正向 + 攻击向量）
- [ ] 后端测试套 100% 绿
- [ ] 前端类型/lint 绿
- [ ] 在 phase 5 summary 中产出 dev 摘要
