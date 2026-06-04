# 人物建模包图片「图裂」问题诊断报告

- **Bug slug**: `character-pack-broken-images`
- **分析日期**: 2026-06-04
- **分支**: `feat/api-authz-rate-limiting`
- **诊断节点**: Subtask #0（问题定位与分析）
- **结论一句话**: 安全加固提交 `5473c7a` 把 `/api/storage/files` 从「匿名 StaticFiles 挂载」改成「需要登录态的 `storage_files_router`」，而浏览器 `<img>` 标签无法携带 `Authorization` 头；为媒体标签设计的 **cookie 兜底鉴权链路并未真正打通**（前端从未写入 `ecliptrix-session-token` cookie，且 Next.js 代理不转发 `Cookie` 头），导致所有以 `/api/storage/files/...` 为源的本地图片返回 **401**，在 UI 上表现为「图裂」。人物/场景/分镜/视频帧建模包恰好其图片 URL **永远是本地路径**，因此「全军覆没」，最先被用户察觉。

---

## 一、问题描述（Problem description）

通过「AI 创作 → AI 图像 → 人物建模」生成 3×3 宫格人物建模图后：

1. 生成流程**成功**（无报错），素材管理面板（MaterialsPanel）里**出现了**人物建模包卡片（GridPackCard）。
2. 但卡片缩略图（原始合成大图）显示为**图裂**（broken image 占位）。
3. 点开「人物建模包」弹窗（GridPackModal），里面的原图 + 9 张裁切帧**每一张都是图裂**。

即：**元数据/列表请求成功，图片二进制请求失败**。这正是「鉴权头能带上的接口都正常、`<img>` 带不上鉴权头的静态资源全挂」的典型症状。

---

## 二、复现步骤（Reproduction steps）

### 前置条件
- 后端 `backend-services/basic-service/` 已启动（默认 :8000）。
- 前端已启动（dev :3000 / start.sh :3010），并已**正常登录**（`localStorage` 内存在 `ecliptrix-session-token`）。
- 当前代码处于 `feat/api-authz-rate-limiting` 分支（即已合入安全加固提交 `5473c7a`）。

### 操作步骤
1. 进入视频编辑器页面，打开右侧「素材」面板。
2. 点击「AI 创作」下拉 → 选择「AI 图像」，打开 `AiImageModal`。
3. 切到「人物建模」(character) Tab，填写角色描述（如「身穿蓝色铠甲的精灵骑士」），点击「生成」。
4. 等待生成完成，关闭弹窗，把素材类型筛选切到「人物建模包」。
5. **观察**：人物建模包卡片缩略图为图裂。
6. 点击该卡片打开 `GridPackModal`，**观察**：原图 + 9 张帧全部图裂。

### 最小化验证（无需走完整生成流程，直接复现 401）
登录后在浏览器**地址栏 / 新标签页**直接访问任意一张建模包图片的同源 URL（即 `<img src>` 的请求方式 —— 不带 `Authorization` 头）：

```
http://localhost:3000/api/storage/files/character_pack/<YYYYMMDD>/<pack_id>/original.png
```

或用 curl 模拟「浏览器 img 标签请求」（**不带** Authorization 头，仅可能带 cookie）：

```bash
# 模拟 <img> 请求：无 Authorization 头 → 必现 401
curl -i "http://localhost:8000/api/storage/files/character_pack/20260604/<pack_id>/original.png"
# 预期：HTTP/1.1 401 Unauthorized，body error_code=UNAUTHORIZED, reason="Missing session token"

# 对照：带上 Authorization 头 → 200，图片正常返回
curl -i -H "Authorization: Bearer <你的 session token>" \
  "http://localhost:8000/api/storage/files/character_pack/20260604/<pack_id>/original.png"
# 预期：HTTP/1.1 200 OK
```

> 同样地，浏览器 DevTools → Network 里能看到对 `/api/storage/files/character_pack/...` 的请求是 **401**，而 `/api/image-pack/character/list`（带 Authorization 头）是 **200**。这条对照本身就是根因的直接证据。

---

## 三、根因分析（Root cause analysis）

### 3.1 数据链路与渲染方式

后端为建模包帧构造的 URL 是**本地同源服务路径**：

```python
# backend-services/basic-service/app/services/grid_pack_service.py:143
def frame_url(pack_type: str, date_str: str, pack_id: str, filename: str) -> str:
    """Build a serving URL for a frame inside a given pack."""
    return f"/api/storage/files/{storage_dir_for(pack_type)}/{date_str}/{pack_id}/{filename}"
```

前端拿到这些 URL 后，**直接塞进 `<img src>`**，没有任何带鉴权的取流（blob）处理：

```tsx
// src/components/video/components/MaterialsPanel/GridPackCard.tsx:51
{pack.original_image_url && !imgError ? (
  <img src={pack.original_image_url} ... onError={() => setImgError(true)} />
) : ( ...占位图标... )}
```

```tsx
// src/components/video/components/MaterialsPanel/GridPackModal.tsx:57 / :76
<img src={pack.original_image_url} alt="original" ... />
...
{pack.frames.map((frame) => (
  <img src={frame.url} alt={frame.sub_view || ...} ... />
))}
```

`<img>` 的请求是**浏览器原生 GET**，**无法附加自定义 `Authorization` 头**（这正是 http-client 注释里反复强调的限制，见 `src/lib/api/http-client.ts:747-767`）。

### 3.2 `/api/storage/files` 已被改为「需鉴权」

提交 `5473c7a`（"[fix] security: harden auth/CORS/SSRF/path-traversal/secrets"，V01-C，CVSS 7.5）把原本的匿名静态挂载替换为带鉴权依赖的路由：

```python
# backend-services/basic-service/app/main.py:662-673
# Storage files (spec/01 §V01-C): the anonymous StaticFiles mount was
# replaced with an authenticated router that enforces an ownership model ...
from app.routers import storage_files_router
app.include_router(storage_files_router.router, prefix="/api")
```

该路由的处理函数是**无条件**依赖 `get_current_user` 的：

```python
# backend-services/basic-service/app/routers/storage_files_router.py:111-116
@router.get("/files/{file_path:path}")
async def serve_storage_file(
    file_path: str,
    request: Request,
    current_user: User = Depends(get_current_user),   # ← 强制登录态
) -> FileResponse:
```

而 `get_current_user` 在拿不到 token 时直接抛 401：

```python
# backend-services/basic-service/app/dependencies/auth.py:81-92
token = _extract_token(request)
if not token:
    logger.warning("Authentication failed: no session token in request")
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
        detail={... "error_code": "UNAUTHORIZED",
                "error_details": {"reason": "Missing session token"}})
```

### 3.3 中间件「放行」≠ 接口「免鉴权」（关键误区）

`SessionAuthMiddleware` 确实把 `/api/storage/files/` 列入了 allowlist：

```python
# backend-services/basic-service/app/middleware/auth_middleware.py:94-100
ALLOWLIST_PREFIX: Tuple[str, ...] = (
    "/static/",
    "/api/storage/files/",      # ← 中间件层放行
    "/api/audio/generated/",
    "/api/audio/subtitles/",
    "/api/config/",
)
```

但 allowlist 的语义是「**中间件不强制拦截、且不注入 `request.state.user`**」（见 `auth_middleware.py:222-224`），它**并不会**让路由级的 `Depends(get_current_user)` 失效。于是出现致命组合：

- 中间件：路径被放行 → **不**做 DB 查询、**不**设置 `request.state.user`；
- 路由：`get_current_user` 走「慢路径」，`request.state.user` 不存在 → 从请求里 `_extract_token` → 无 token → **抛 401**。

> 注意：此 401 与 `AUTH_ENFORCE_DEFAULT_DENY` 开关**无关**。该开关只影响中间件层对「非 allowlist 路径」的拒绝行为；而这里是**路由级硬依赖**在拦截，无论开关开关与否都会 401。

### 3.4 为媒体标签设计的「cookie 兜底」链路根本没打通（双重断点）

`5473c7a` 的设计意图是：既然 `<img>/<video>/<audio>` 带不了 `Authorization` 头，就让它们用 **cookie** 鉴权。后端确实加了 cookie 兜底：

```python
# backend-services/basic-service/app/dependencies/auth.py:46-52
# Cookie fallback for media-tag requests ...
cookie_token = request.cookies.get("ecliptrix-session-token")
if cookie_token:
    return cookie_token.strip()
```

但这条链路在前端侧有**两个独立的断点**，任何一个都足以让它失效：

**断点 A —— 前端从未把 token 写进 cookie。**
会话 token 只存在 `localStorage`，没有任何地方写过同名 cookie：

```ts
// src/lib/auth/storage-keys.ts:12-13
export const SESSION_TOKEN_KEY = 'ecliptrix-session-token';   // 仅用于 localStorage
export const SESSION_USER_KEY = 'ecliptrix-user';
```

> 证据：全仓库检索 `document.cookie` / set-cookie 在前端鉴权写入侧**零命中**；`AuthContext.tsx` 内**无任何 cookie 写入**。因此浏览器对 `/api/storage/files` 的 `<img>` 请求**连 cookie 都带不上**。

**断点 B —— 即便 cookie 存在，Next.js 代理也不会把它转发给后端。**
所有 `/api/...` 请求（含 `<img>`）都先打到 Next.js（dev 同源 :3000；prod 经 nginx 把 `/api` 转给 Next.js），再由 BFF 代理转发到后端。代理构造转发头时**只**带 `Authorization`、`x-session-token` 和显式声明的 `forwardHeaders`，**不**带 `Cookie`：

```ts
// src/lib/api/server/backend-proxy.ts:133-155
function buildForwardedHeaders(req, opts): Headers {
  const headers = new Headers()
  const auth = req.headers.get('authorization')
  if (auth) headers.set('Authorization', auth)
  const legacy = req.headers.get('x-session-token')
  if (legacy) headers.set('x-session-token', legacy)
  for (const name of opts?.forwardHeaders ?? []) { ... }   // 只转发显式列出的头
  return headers                                            // ← Cookie 永远不在其中
}
```

而 storage-files 代理路由只声明了 `range`，没有 `cookie`：

```ts
// src/app/api/storage/files/[...path]/route.ts:13-25
export const { GET } = createPassthroughRoute(
  (p) => `/api/storage/files/${(p.path as string[]).join('/')}`,
  { streaming: true, forwardHeaders: ['range'], responseHeaderAllowlist: [...] },
)
```

**结论**：`<img>` → Next.js 代理（剥离 cookie/无 Authorization）→ 后端 `serve_storage_file` → `get_current_user` 取不到任何 token → **401** → 浏览器渲染为图裂。

### 3.5 证据小结
| 证据 | 位置 |
|---|---|
| 帧 URL 永远是 `/api/storage/files/...` 本地路径 | `grid_pack_service.py:143-145` |
| 前端直接 `<img src=url>` 渲染、无带鉴权取流 | `GridPackCard.tsx:51`、`GridPackModal.tsx:57,76` |
| storage 文件接口无条件 `Depends(get_current_user)` | `storage_files_router.py:111-116` |
| 无 token → 抛 401 | `dependencies/auth.py:81-92` |
| 中间件放行≠免鉴权（不注入 user） | `auth_middleware.py:94-100, 222-224` |
| 匿名挂载被替换为鉴权路由的提交 | `main.py:662-673`，commit `5473c7a` |
| 断点 A：token 只在 localStorage，无 cookie 写入 | `storage-keys.ts:12-13` + `AuthContext.tsx`（无 cookie） |
| 断点 B：代理不转发 Cookie 头 | `backend-proxy.ts:133-155`、`storage/files/[...path]/route.ts:13-25` |

> 备注：`backend-services/basic-service/logs/app.log` 为 2025-09 旧日志，早于本功能与本次安全加固，其中的 401 均来自外部 API（Pexels/RunningHub key 轮换），与本 bug 无关。本报告的根因由**代码引用链**充分支撑，不依赖运行日志。

---

## 四、影响面（Impact surface）

**根因是通用的**：凡是「以 `/api/storage/files/...` 为源、用浏览器原生媒体标签（`<img>/<video>/<audio>`）直接加载、且请求不携带有效 session」的地方都会 401。

| 受影响功能 | 是否必现 | 说明 |
|---|---|---|
| 人物建模包（character_pack）卡片缩略图 + 弹窗全部帧 | **必现** | URL 永远是本地 `/api/storage/files/character_pack/...` |
| 场景建模包（scene_pack） | **必现** | 同上，复用 `GridPackCard/GridPackModal` |
| 分镜包 / 视频帧包（storyboard / frame_pack） | **必现** | 帧 URL 同为 `/api/storage/files/...` |
| 本地上传的图片素材缩略图 | **大概率** | 若 `thumbnailUrl` 是 `/api/storage/files/...`（`MaterialsPanel.tsx:2103`） |
| `cached_materials/` 预下载素材的直接 `<img/video src>` 预览 | 受影响 | 路由对它「任意登录用户可读」，但**仍要求登录态**；`<img>` 带不上凭证一样 401 |
| 时间轴预览（download-first blob 方案的素材） | **不受影响** | 这些走带鉴权的 fetch→blob，不依赖 `<img src=/api/storage/files>` |
| 远程图源（Pexels/Unsplash 等 `https://...`）缩略图 | **不受影响** | 直连第三方，不经本地鉴权 —— 这也解释了「为什么搜索来的图正常、唯独建模包全裂」 |

**用户层面**：所有登录用户、所有用 AI 图像建模功能的人都会遇到；本地素材/导出物的内联预览也会受影响。属于功能性回归（regression），由安全加固 `5473c7a` 引入。

---

## 五、候选修复方案（Candidate fixes）

> 约束：本节只做方案对比，不落代码（落码在 Subtask #2）。

### 方案 A：放宽「非用户私有的公共资源」目录的鉴权
对建模包/缓存素材等**非按用户隔离**的前缀（`cached_materials/`、`character_pack/`、`scene_pack/`、`storyboard/`、`frame_pack/`）在 `storage_files_router` 内做「免登录即可读」分流（保留 `user_<id>` 私有路径的鉴权与所有路径遍历防护）。

### 方案 B（推荐）：补全「cookie 兜底」鉴权链路（最小改动版）
让 `5473c7a` 设计但未打通的 cookie 链路真正闭环：
1. **前端写 cookie**：登录/会话写入时，除 `localStorage` 外，同步把 `ecliptrix-session-token` 写成同源 cookie（`path=/; SameSite=Lax`；登出时清除）。集中改在 `AuthContext`（与 `storage-keys.ts` 同源）。
2. **代理转发 cookie**：给 storage-files 代理路由的 `forwardHeaders` 增加 `'cookie'`（`src/app/api/storage/files/[...path]/route.ts`），使浏览器自动携带的 cookie 能透传到后端，命中 `get_current_user` 的 cookie 兜底。

> 该方案不削弱后端安全模型（仍需有效 session、仍走 owner/admin 归属校验），且**一次性修好所有媒体标签**（img/video/audio 全局）。

### 方案 C：前端改为「带鉴权取流 + blob」渲染
新增一个鉴权图片组件/hook：用 `http`（自动注入 Authorization）取字节 → `URL.createObjectURL` 生成 blob → 作为 `<img src>`；用完 `revokeObjectURL`。逐处替换 GridPackCard/GridPackModal 等所有渲染本地图片的位置。

### 对比表
| 维度 | 方案 A（放宽公共目录鉴权） | 方案 B（补全 cookie 链路）**推荐** | 方案 C（blob 取流） |
|---|---|---|---|
| 侵入性 | 低（仅后端 1 处分流） | 低-中（前端 cookie 写入 + 代理 1 处加白名单） | 中-高（需改所有渲染点 + blob 生命周期管理） |
| 修复范围 | 仅放宽的前缀；用户私有图仍裂 | **全局**所有 `<img/video/audio>` 媒体标签 | 仅改到的渲染点；漏改处仍裂 |
| 对安全模型影响 | **削弱** V01-C（这些前缀回到「无需登录」可枚举） | 不削弱（仍需有效 session + 归属校验） | 不削弱（最严格） |
| 风险点 | 重新打开枚举面（虽为非敏感生成物） | cookie 无法 HttpOnly（但 token 本就在 localStorage，无额外暴露）；需同源/SameSite 正确 | 内存占用（blob）、revoke 时机、改动点多易遗漏 |
| 工作量 | 最小 | 小 | 较大 |
| 与既有设计意图一致性 | 偏离（再次开放匿名读取） | **完全一致**（`5473c7a` 注释明示「读 cookie 让媒体标签鉴权」） | 一致但另起一套机制 |

---

## 六、推荐方案（Recommended fix）

**推荐方案 B：补全 cookie 兜底鉴权链路（最小改动版）。**

理由：
1. **与既有安全设计意图完全一致**。`5473c7a` 已在 `dependencies/auth.py` 与 `auth_middleware.py` 主动实现了 `ecliptrix-session-token` cookie 兜底，注释明确写着「so `<video>/<audio>` tags can still authenticate」。当前 bug 本质是这条链路**前端两端没接上**（cookie 没写、代理没转发）。方案 B 只是把既定设计补完，而非另立机制或推翻安全加固。
2. **不削弱安全模型**。仍然要求有效 session，`storage_files_router` 的 owner/admin 归属校验、路径遍历防护、`nosniff`、危险扩展名降级全部保留。相较方案 A「重新开放匿名读取」，B 不引入新的越权/枚举面。
3. **一次性修复整类问题**。建模包只是最显眼的受害者；方案 B 让全站所有 `<img/video/audio>` 直链本地资源的场景同时恢复，避免方案 C「逐处替换、易漏改」的长尾。
4. **改动小且集中**：前端会话写入处加 cookie（含登出清除）、storage-files 代理路由 `forwardHeaders` 增加 `'cookie'`，共两处，blast radius 可控。

落地注意事项（交给 Subtask #2）：
- cookie 必须 `path=/`，`SameSite=Lax`（同源足够，避免 `None` 引入跨站语义）；生产 HTTPS 下可加 `Secure`。因需 JS 写入，无法 `HttpOnly`，但 token 本就存于 localStorage，安全等级未下降。
- 登出 / 会话过期（`http-client` 的 `handleSessionExpired`）时必须**同步清除该 cookie**，避免与 localStorage 不一致。
- 验收：登录后建模包卡片与弹窗 9 帧均正常显示；DevTools Network 中 `/api/storage/files/character_pack/...` 由 401 变 200；登出后再次直链应回到 401（确认鉴权仍生效）。
- 回归对照：确认搜索来的远程图（Pexels/Unsplash）与时间轴 blob 预览不受影响。

---

## 七、给评审节点的结论（Subtask #1 可直接采用）
- **根因已确证**（代码引用链完整，见 §3.5），非猜测。
- **推荐方案 B**，证据充分、与既有安全设计意图一致、最小化破坏面、一次性修复整类问题。
- 若评审更看重「绝不依赖前端改动 / 零信任媒体直链」，可退而考虑方案 C（最严格、最贵）；方案 A 因会削弱 `5473c7a` 的 V01-C 加固，仅建议作为应急回滚手段，不建议作为长期方案。

---

## 八、评审补充证据与勘误（Subtask #1 reviewer 独立复核）

> 本节由评审节点逐文件、逐行独立核对原报告引用后补写：① 加固已属实的证据；② 一处需精确的勘误；③ 排除 404 替代解释；④ 对修复方案的边界/回归再评估。结论不改变原根因，仅令证据链「无缝」。

### 8.1 根因引用逐条复核（全部属实）

| 复核项 | 复核结论（含精确行号） |
|---|---|
| 帧 URL 永远是本地 `/api/storage/files/...` | `grid_pack_service.py:143-145` `frame_url()`；原图回退 `_pack_dict_from_metadata` 默认 `frame_url(... original.<ext>)`（`grid_pack_service.py:500-503`）—— **属实** |
| 前端直接 `<img src=url>`、无带鉴权取流 | `GridPackCard.tsx:51-57`、`GridPackModal.tsx:57,76-80`、`MaterialsPanel.tsx:2103`（本地素材缩略图同样裸 `<img>`）—— **属实** |
| storage 接口无条件 `Depends(get_current_user)` | `storage_files_router.py:111-116` —— **属实** |
| 无 token → 抛 401（`error_code=UNAUTHORIZED`） | `dependencies/auth.py:81-92` —— **属实** |
| cookie 兜底链路在后端就绪 | `dependencies/auth.py:46-50` + `auth_middleware.py:169-171` 取 `ecliptrix-session-token` cookie —— **属实** |
| 中间件「放行」短路发生在 enforce 之前，故 401 与 `AUTH_ENFORCE_DEFAULT_DENY` 无关 | `auth_middleware.py:222-224` `_is_allowlisted()→return await call_next` 直接短路，**先于** enforce gate（`auth_middleware.py:226-241`，`getattr(..., False)` 默认关）—— **属实，印证 §3.3** |
| 归属判定不会反噬建模包 | `character_pack` 路径无 `user_<id>` 段、且不在 `_PUBLIC_PREFIXES`（`storage_files_router.py:56` 仅 `cached_materials/`）→ `_extract_owner_from_path` 返回 `None` → 落入「任意登录用户可读」分支（`storage_files_router.py:162-181`）。**含义**：cookie 链路补通后，所有登录用户都能读建模包，不会出现 per-user 403 —— **属实** |

**断点 A 再加固（cookie 在浏览器根本不存在）**：
- 前端：全仓检索 `document.cookie` / set-cookie **零命中**（唯一命中是 `storage/files/[...path]/route.ts` 注释里「Set-Cookie suppressed」）；token 写入点只有 `localStorage`（`storage-keys.ts:12`，consumer 见 AuthContext / http-client）。
- 后端：`auth_router.py` **零 `set_cookie` 调用** —— 即该 cookie **既非前端 JS 写入、也非后端登录响应 Set-Cookie 下发**，浏览器侧根本不存在它。
- 补刀：即便将来后端在 `/api/auth/login` 用 `Set-Cookie` 下发，也到不了浏览器——`backend-proxy.ts:345-350` 的 buffered（非 streaming）回程**只透出 `Content-Type`**，会吞掉后端所有 `Set-Cookie`。这进一步坐实 cookie 兜底是「设计了但前端两端都没接上」。

### 8.2 勘误：列表接口为何返回 200（不改根因，但需精确）

原报告 §1 / §2 将症状概括为「**鉴权头能带上的接口正常、`<img>` 带不上鉴权头的资源全挂**」，并以「`/api/image-pack/character/list`（带 Authorization 头）是 200」作对照。**此处需精确**：

- `image_pack_router.list_packs`（`image_pack_router.py:58-59`）**根本没有** `Depends(get_current_user)`；该路径也不在中间件 allowlist 内，于是走 enforce gate，而 `AUTH_ENFORCE_DEFAULT_DENY` 默认 `False`（`auth_middleware.py:240`）→ **无 token 也放行** → 200。
- 也就是说 list 返回 200 的真实原因是「**该路由未做鉴权 + 默认不拒**」，**并非**「因为带上了 Authorization 头」。

**对根因的影响**：无。决定性证据是 **storage 路由独有的硬依赖 `Depends(get_current_user)`**（list 路由没有），二者一对照恰好得到「同为浏览器请求，一个 200 一个 401」。修正这一措辞后，证据链反而更干净：401 来源被唯一锁定在路由级鉴权依赖，而非「img 与 fetch 的 header 差异」这一较弱前提。

### 8.3 排除替代解释：是 401，不是 404（两者修法完全不同）

「图裂」可由 401 或 404 同样触发，但修法相反，必须排除：

- **文件确实在盘上**：`metadata.json` 与 `original.png`/`frame_*.png` 由同一生成流程写入**同一 pack 目录**（`grid_pack_service.py` 顶部布局注释 + `crop_grid`/`write_pack_metadata`）。`list_packs` 能读到 `metadata.json` 渲染出卡片（含 prompt/grid_size/frame_count），即证明该目录与图片文件已落盘 → **排除 404**。
- **原图也裂 → 原图也是本地路径**：用户同时报告「原图 + 9 帧全裂」。若 `original_image_url` 为 OSS 远程 https，它会正常显示；既然全裂，说明原图 URL 同为本地 `/api/storage/files/...`（OSS 未启用），与 `_pack_dict_from_metadata` 的 fallback 完全吻合。
- **交 Subtask #2 的判定动作（强约束）**：实施前先用 DevTools Network 或 `curl`（不带 Authorization）确认该请求状态码为 **401 且 body `error_code=UNAUTHORIZED`**。若实测是 **404**，则根因另议（落盘/路径问题），本报告结论需重审——不要在未确认状态码的情况下直接动鉴权链路。

### 8.4 修复方案再评估（边界 / 并发 / 回归）

**方案 B —— 两处改动均「必要且最小」**：代理是服务端、自身不持有用户 token，只能依赖浏览器把 cookie 同源带上；因此「前端写 cookie」与「代理转发 cookie」**缺一不可**，不存在更小的子集。

**关键正确性约束（并发/状态一致性，原报告未量化）**：token 在前端只有 **1 个写入点**（`AuthContext.tsx:321` 唯一的 `setItem(SESSION_TOKEN_KEY, ...)`），却有 **5 个清除点**（`AuthContext.tsx:143 / 219 / 255 / 361` + `http-client.ts:164` `handleSessionExpired`，后者由 401 自动登出在 `http-client.ts:506,704` 触发）。
> 若只在写入点加 cookie、漏掉任一清除点，会出现「**localStorage 已登出、cookie 仍在**」的不一致：登出后 `<img>` 仍可凭旧 cookie 取到他人/旧会话文件，直到后端 token 轮换才 401。
> **因此必须把 cookie 的写/清集中到一个 helper**（例如在 `storage-keys.ts` 旁新增 `setSessionToken()/clearSessionToken()` 同时操作 localStorage + cookie，或在 AuthContext 内封装），在「1 写 + 5 清」共 6 处统一调用，杜绝发散。这是方案 B 能否「正确」落地的核心，必须写进 Subtask #2 验收项。

**Cookie 属性边界**：`path=/`、`SameSite=Lax`（同源 `<img>/<video>` 子资源在 Lax 下照常携带；避免 `None` 引入跨站语义）、生产 HTTPS 加 `Secure`；因需 JS 读写无法 `HttpOnly`，但 token 本就在 localStorage，**XSS 暴露面未升级**；存储接口是 GET 取文件 + `SameSite=Lax` + CORS 阻止跨源读响应体 → **无可利用的 CSRF**。

**`forwardHeaders` 增加 `'cookie'` 的副作用**：会把整条 `Cookie` 头透传后端（含无关 cookie），后端 `_extract_token` 只取 `ecliptrix-session-token`、忽略其余，无副作用；作用域**仅** `storage/files` 一条路由（其它代理路由不受影响），blast radius 可控。

**方案 C 的额外硬伤（原报告仅以「内存/改动多」带过）**：blob 方案需**整文件下载**，等于**放弃 storage 路由专门为 `<video>` 保留的 HTTP Range 透传**（`route.ts` `forwardHeaders:['range']` + 回传 `content-range/accept-ranges`）。后果：视频预览失去按需 seek、大文件全量入内存。**对「一次性修好全站媒体标签」这一对比维度而言，C 不只是更贵，而是对 `<video>` 功能性更差**——这是 C 相对 B 的实质性回归，应在选型中明确扣分。

**方案 A 的硬伤**：把 `character_pack/scene_pack/storyboard/frame_pack/cached_materials` 改为匿名可读，直接弱化 `5473c7a`（V01-C, CVSS 7.5）的「防未授权枚举/越权读取」加固，且**漏修用户私有上传**的 `<img>`（仍裂），不能作长期方案。

---

## 评审结论（Review Verdict）

**最终推荐（唯一）：方案 B —— 补全「cookie 兜底」鉴权链路（前端写 cookie + 代理转发 cookie），最小改动版。**

### 裁决理由
1. **根因已确证、证据链无缝**：经逐行独立复核（§8.1），「storage 路由硬依赖 `get_current_user`（`storage_files_router.py:111-116`）+ 浏览器 `<img>` 无法携带 token + cookie 链路前后端两端均未接上（§3.4 / §8.1 断点 A·B）」共同、充分地解释了「建模包原图与 9 帧必现 401 图裂」，并已**排除 404**（§8.3）。原报告对 list 接口的措辞已在 §8.2 勘误，根因不变且更精确。
2. **与既有安全设计完全一致**：`5473c7a` 已在后端实现 `ecliptrix-session-token` cookie 兜底，注释明示其目的就是让媒体标签可鉴权。方案 B 只是把这条**已设计但未闭环**的链路接通，不另立机制、不推翻加固。
3. **不削弱安全模型**：仍需有效 session；owner/admin 归属、路径遍历防护、`nosniff`、危险扩展名降级全部保留；新增的非 HttpOnly cookie 不抬高 XSS 暴露面（token 本就在 localStorage），且无可利用 CSRF（§8.4）。相较方案 A「重开匿名读取」更安全。
4. **一次性修复整类问题，且不引入 video 回归**：全站 `<img>/<video>/<audio>` 直链本地资源同时恢复；相较方案 C，B **保留** `<video>` 的 HTTP Range seek（C 会破坏，§8.4）。
5. **改动小且可控**：仅前端会话写/清 + 一条代理路由白名单，blast radius 局限于 storage/files。

### 落地清单（交 Subtask #2，精确到点）
1. **集中式 token+cookie 同步 helper**：新增 `setSessionToken(token)` / `clearSessionToken()`（建议置于 `src/lib/auth/storage-keys.ts` 同源处，或 AuthContext 内），二者同时读写 `localStorage[SESSION_TOKEN_KEY]` 与同源 cookie `ecliptrix-session-token`（`path=/; SameSite=Lax`，生产 HTTPS 追加 `Secure`）。
2. **替换全部 token 读写点（1 写 + 5 清，缺一不可）**：写——`AuthContext.tsx:321`；清——`AuthContext.tsx:143 / 219 / 255 / 361` 与 `http-client.ts:164`（`handleSessionExpired`）。
3. **代理转发 cookie**：`src/app/api/storage/files/[...path]/route.ts` 的 `forwardHeaders` 由 `['range']` 改为 `['range', 'cookie']`（仅此一处路由）。
4. **不要改动**：后端 `dependencies/auth.py` 与 `auth_middleware.py` 的 cookie 兜底已就绪，保持不动；`storage_files_router` 的鉴权/归属/遍历防护/安全头全部保留。

### 验收标准（Definition of Done，交 Subtask #2 执行）
- 登录后：建模包卡片缩略图 + 弹窗原图 + 9 帧全部正常显示；DevTools 中 `/api/storage/files/character_pack/...` 由 **401 → 200**。
- 登出后：直链同一 URL 回到 **401**（确认鉴权仍生效、cookie 已被清除——验证「1 写 + 5 清」无遗漏）。
- 回归对照：远程图（Pexels/Unsplash）与时间轴 blob 预览不受影响；`<video>` 预览的 Range seek 仍可用。
- 实施前置判定：先确认目标请求确为 **401（`error_code=UNAUTHORIZED`）而非 404**（§8.3），否则停手、回退到根因重审。

**风险等级：低**（改动集中、向后兼容、不弱化安全模型；唯一需要严防的是 cookie 与 localStorage 的清除一致性——已通过「集中式 helper + 6 处统一调用」消解）。

---

## 实施过程发现的方案缺陷（Subtask #2 实现节点补记）

> 实现节点严格按方案 B 落地时，发现「仅在 1 个写入点（`AuthContext` login:321）写 cookie」存在一个会**让复现步骤仍然失败**的边界，记录如下并已采用修正实现。

### 缺陷：只在「登录瞬间」写 cookie，覆盖不到「已登录」用户

- 方案 B 的落地清单把 cookie 写入唯一锁定在 `AuthContext` 的 login 路径（`:321`）。但**本报告 §二复现前置条件本身就是「已正常登录（localStorage 内已存在 token）」**——这类用户在升级到本修复后，并不会再次触发 login 写入路径，于是 **cookie 始终不存在**，`<img>` 仍 401、仍图裂。换言之：按字面实现，「重新执行复现步骤」对一个既有登录态用户**不会消除 bug**，与 DoD「Running the reproduction steps no longer triggers the bug」相冲突，必须显式登出再登录才会生效。
- 同理，若 cookie 因任何原因先于 localStorage 失效（例如未来改回 session-scoped cookie、浏览器清 cookie 不清 localStorage），也会出现「localStorage 有 token、cookie 没了 → 图又裂」的窗口。

### 修正实现（仍在方案 B 范畴内，未另立机制）

1. **cookie 设为持久**：`setSessionToken()` 写入时带 `Max-Age=1 year`，使其生命周期与 localStorage token 对齐（后端本就以 DB token 轮换失效会话，而非 cookie TTL）。
2. **会话校验成功时自愈式补写 cookie**：在 `AuthContext.validateSession()` 确认「会话仍然有效」的成功分支（`return true` 前）调用一次 `setSessionToken(storedToken)`。该函数在**挂载时**（`loadAuthState → validateSession`）与**每 5 分钟轮询**时都会执行，于是：
   - 既有登录态用户首次加载页面即补齐 cookie，无需登出重登；
   - cookie 若意外丢失，最迟下个校验周期自愈。

> 该修正只新增「1 处幂等的 cookie 补写」，不改变安全模型（仍要求 localStorage 内有 token 且后端校验通过才会补写），不触碰后端，blast radius 仍局限于会话写入侧。最终实现的 token cookie 写入点为 **2 处**（login `:321` + validateSession 成功分支），清除点仍为 **5 处**（全部经 `clearSessionToken()`）。
