# Spec 01：鉴权与访问控制加固

> 覆盖 master-plan §3.1（鉴权与访问控制）

## 1. 范围（Scope）

修复因 router 挂载前缀错误、Session 中间件白名单过宽、前端 BFF 缺鉴权等导致的 **公网匿名可达** 的越权与资源访问问题。

**包含：**
- 三个 root-level FastAPI router 未受 `SessionAuthMiddleware` 保护
- Frontend BFF `/api/workflow/test-node` 无认证执行任意工作流节点
- `/api/storage/files` 静态挂载无访问控制（与 spec/04 部分交叉）
- `admin_playback` 与其他 admin 相关 router 的鉴权依赖核验

**不包含：**
- 已认证用户的水平越权（IDOR）—— master-plan §2 已排除
- TLS / 反代层鉴权 —— master-plan §2 已排除

## 2. 已识别的具体威胁点（来自 Phase 1 盘点）

### V01-A：root-level router 绕过 SessionAuthMiddleware

- **位置：**
  - `backend-services/basic-service/app/main.py:427` → `app.include_router(ai_video_generate_router)`（无 `prefix="/api"`）
  - `backend-services/basic-service/app/main.py:432` → `app.include_router(video_export_router)`
  - `backend-services/basic-service/app/main.py:457` → `app.include_router(intent_detection_router)`
- **机制：** `SessionAuthMiddleware`（`middleware/auth_middleware.py`）的白名单与保护策略基于 URL 前缀匹配；这三个 router 注册在 `/`，其内部端点（如 `/api/workflow/ai-video-generate`）可能被中间件按前缀匹配，但**因为 router 本身没挂在 `api_router`（即 prefix="/api"）下，是否真的被 middleware 拦截需要逐一验证**。
- **CVSS v3.1：** 9.8 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
  - 攻击者可未鉴权调用 LLM 推理、消耗付费 LLM token、间接触发 FFmpeg 外部进程，并可能写入/导出视频产物，故 I 与 A 均评为 H。
- **PoC 思路：** `curl -X POST http://host/api/workflow/ai-video-generate -d '{...}'` → 200/202，无需 Cookie 或 Authorization。

### V01-B：`/api/workflow/test-node`（前端 BFF）无鉴权

- **位置：** `src/app/api/workflow/test-node/route.ts:1-200`
- **机制：** 该 BFF 路由读取请求体，执行任意工作流节点（含 Chat-LLM / Tavily / Pexels / Volcano TTS 调用），且无 `verifySession()` 或类似中间件包裹。
- **CVSS v3.1：** 8.2 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:H`
  - 攻击者可耗光 LLM/Tavily/Pexels 配额（资源耗尽 DoS），并通过工作流节点回显部分上下文（轻度数据泄露）。
- **PoC 思路：** 持续向 `/api/workflow/test-node` POST 高并发 LLM 调用请求 → 烧光 API 额度。

### V01-C：`/api/storage/files/*` 越权读取

- **位置：** `app/main.py:549-587` StaticFiles 挂载；`middleware/auth_middleware.py:57-90` 白名单包含 `/api/storage/files/`
- **机制：** 任何匿名用户可访问 `STORAGE_ROOT` 下所有文件（含他人上传），仅靠"用户不知道文件名"作为安全屏障（security by obscurity）。
- **CVSS v3.1：** 7.5 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`
  - 若文件名可枚举（UUID 弱、自增 ID、可预测时间戳），即敏感数据泄露。
- **PoC 思路：** `curl http://host/api/storage/files/audio/<predictable-pattern>/foo.mp3` → 直接拉取。

### V01-D：`admin_playback` 等 admin router 鉴权依赖核验

- **位置：** `app/main.py` 中所有 `admin*` router；需 `Grep -rn "admin" backend-services/basic-service/app/routers/` 列出所有 admin 端点，并核验每个端点是否使用 `Depends(require_admin)` 或 `Depends(require_root)`。
- **CVSS v3.1：** 待 Phase 4 确认；若发现未受保护的 admin endpoint，参考评分 `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L` → 9.6。仅当实测确认未受保护时纳入修复队列；否则记入附录。
- **PoC 思路：** 未鉴权 `curl /api/admin/...` 看是否 200。

## 3. 修复方案

### V01-A：显式 Depends 注入（防御性，不破坏 API 契约）

```pseudo
# 方案：在三个 root-level router 的所有写操作端点上，显式加 Depends(get_current_user)

# router 文件（ai_video_generate_router.py 等）：
# 在 router-level 添加 dependencies=[Depends(get_current_user)]

router = APIRouter(
    prefix="",                              # 保持原前缀，避免破坏前端调用
    dependencies=[Depends(get_current_user)] # 整体保护
)

# 同时在 SessionAuthMiddleware 中增加 "不在 /api 下也要保护" 的逻辑：
# 若 path 匹配以下模式 → 强制要求 token：
#   - /api/workflow/ai-video-generate
#   - /api/workflow/video-export
#   - /api/intent-detection/*
```

**注意：** 不要改 router 挂载前缀（否则前端 URL 失效）；只增加 `dependencies` 列表。

### V01-B：前端 BFF 加 session 校验

```pseudo
# src/app/api/workflow/test-node/route.ts
import { verifySessionFromCookie } from '@/lib/auth/sessionGuard'  # 复用现有或新建

export async function POST(req: Request) {
    const session = await verifySessionFromCookie(req)
    if (!session.valid) return Response.json({ error: 'unauthorized' }, { status: 401 })
    // ...原逻辑
}
```

如果项目无现成 `verifySessionFromCookie`，则在 `src/lib/auth/` 下新建 helper：
- 读取 `ecliptrix-session-token` cookie 或 `Authorization` header
- 调用 backend `/api/auth/validate-session`（已存在）→ 200 即视为已认证
- 失败返回 401，不再调用下游节点

### V01-C：StaticFiles 替换为受控 endpoint（重构）

```pseudo
# 方案：
# 1. 移除 main.py 中 app.mount('/api/storage/files', StaticFiles(...)) 这一行
# 2. 新建 routers/storage_files_router.py 提供 GET /api/storage/files/{path:path}
#    - Depends(get_current_user) → 强制鉴权
#    - 校验 path 不含 ../，必须在 STORAGE_ROOT 下（用 _validate_path 复用）
#    - 校验调用者 user_id 与文件 owner_id 一致（或文件标记为 public）
#    - 用 FileResponse 返回
# 3. 不影响 cached_materials/ 等公共资源 → 另起一个公共 mount /api/storage/public/files
#    或在新 router 中根据 path 前缀分流
```

**兼容性提示：** 前端读取的 `local_url`（master-plan 上下文中提到的 `/api/storage/files/cached_materials/...`）格式不变；只是后端实现从 StaticFiles 改为 router，对前端透明。

### V01-D：admin router 全量核验

```pseudo
# 操作（Phase 4 DEV agent 执行）：
1. Grep 'admin' under app/routers/  → 列出 N 个文件
2. 对每个文件检查：
   - router-level 是否有 dependencies=[Depends(require_admin)]
   - 每个 @router.<method> 装饰器下是否有 Depends 注入
3. 对于无保护的 admin endpoint，在 router-level 添加 Depends(require_admin)
4. 若 endpoint 名义上 "admin" 但其实属于普通用户操作 → 改名/挪走
```

## 4. 接口与行为变化

| 端点 | 变更前 | 变更后 |
|---|---|---|
| `POST /api/workflow/ai-video-generate` | 匿名 200 | 无 token → 401 |
| `POST /api/workflow/video-export` | 匿名 200 | 无 token → 401 |
| `POST /api/intent-detection/detect` | 匿名 200 | 无 token → 401 |
| `POST /api/workflow/test-node`（前端 BFF） | 匿名 200 | 无 cookie/header → 401 |
| `GET /api/storage/files/<owned-by-user-X>` | 任何人可读 | 仅 user X 或 admin |
| `GET /api/storage/files/cached_materials/...` | 任何人可读 | 保持不变（公共资源） |

## 5. 验证策略

`backend-services/basic-service/tests/security/test_01_auth.py`（pytest）：

- **正向用例：**
  - 已登录用户 → POST `/api/workflow/ai-video-generate` → 200
  - 已登录用户 → GET 自己的 `/api/storage/files/...` → 200
  - admin 用户 → GET 任何用户的文件 → 200
- **攻击向量用例：**
  - 匿名请求 → POST `/api/workflow/ai-video-generate` → 401
  - 匿名请求 → POST `/api/intent-detection/detect` → 401
  - 匿名请求 → POST `/api/workflow/test-node`（直接打前端 BFF） → 401
  - 用户 A 登录 → GET 用户 B 的 `/api/storage/files/...` → 403 或 404
  - 匿名请求 → GET admin endpoints → 401

## 6. 依赖关系

- **depends_on:** 无（可独立完成）
- **blocks:** spec/04（path traversal 修复部分逻辑需复用本 spec 引入的 storage_files_router）
- **parallel_group:** A

## 7. 已知风险与缓解

| 风险 | 缓解 |
|---|---|
| 加 Depends 后某些"系统内部调用"被误拒 | 盘点全仓无 internal service-to-service 调用进入这些 endpoint（已通过 Phase 1 验证） |
| `/api/storage/files` 改 router 后性能下降（StaticFiles 用 sendfile） | FileResponse 内部仍走 sendfile，影响极小；如需可加 ETag/cache header |
| 前端 BFF `test-node` 加鉴权可能影响 dev 联调 | dev 模式下保留 backdoor？→ **不**：dev 仍正常登录，无 backdoor，避免后门遗留 |
