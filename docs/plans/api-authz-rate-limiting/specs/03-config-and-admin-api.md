# Spec 03 — 配置与后台 API (Config & Admin API)

> 对应 master-plan §4.4、§4.5、§5(D6/D8)、§7(R7)
> 模块边界: 后端 `app/models/db_models.py`、`alembic/versions/`、`app/services/rate_limit_config.py`(新)、`app/routers/rate_limit_settings_router.py`(新)、`app/main.py`、`app/config.py`(默认值)

## 1. 目标

为限流提供「`SystemSetting` 持久化 + TTL 热加载 Provider + 管理后台 API + 审计」。限流配置可被根管理员/管理员在后台读写,改动**数秒内热生效**,改动入审计日志。本 spec 是 spec 02 限流内核的配置来源。

## 2. 设计

### 2.1 配置存储(复用 SystemSetting)

新增 `rate_limiting` 类别,沿用既有 `SystemSetting`(category+key→JSON value,db_models.py:103-120),**无需新表**。键定义:

| key | 类型 | 默认值 | 范围/校验 | 说明 |
|---|---|---|---|---|
| `enabled` | bool | `true` | —— | 全局开关 |
| `window_seconds` | int | `60` | 10–3600 | 滑动窗口长度 |
| `default_per_user_per_min` | int | `300` | 1–100000 | normal 类别(登录用户) |
| `default_per_ip_per_min` | int | `300` | 1–100000 | normal 类别(匿名) |
| `ai_generation_per_min` | int | `30` | 1–100000 | AI/生成类 |
| `auth_per_ip_per_min` | int | `10` | 1–100000 | 登录防爆破(按 IP) |
| `media_serving_per_min` | int | `6000` | 1–1000000 | 媒体服务高额度 |

- 默认值同时在 `app/config.py` 留一份 fallback 常量(DB 缺失时兜底,且 reset 用)。
- 数值经 `value_type` 标注,后台 API 据此做范围校验。

### 2.2 种子迁移 (Alembic)

新增迁移(参照 `004_seed_default_settings.py` 模式;现存最新版本为 `011`,故新迁移取 `012`,`down_revision="011"`),插入 `rate_limiting` 类别全部默认键值;每行需同时写 `value`、`default_value`(均为默认值)、`value_type`、`description` 四列(`SystemSetting` 中 `value`/`default_value`/`value_type` 均 `nullable=False`);`downgrade` 仅删除 `rate_limiting` 类别行(`DELETE ... WHERE category='rate_limiting'`,**勿**清空整表)。迁移须**幂等**(沿用 `004` 的 `INSERT ... ON CONFLICT ON CONSTRAINT uq_system_settings_category_key DO NOTHING`),兼容项目「alembic + create_all 混合」启动(见部署经验)。

### 2.3 热加载 Provider

```
class RateLimitConfigProvider:
    # _cache: dict | None
    # _expires_at: float
    # _ttl: float  # 默认 5–10s
    # _lock: asyncio.Lock

    async def get_config() -> RateLimitConfig
    # 行为:
    #   if _cache and now < _expires_at: return _cache (无 DB 往返)
    #   async with _lock:  # 双检
    #       if still expired: 从 SystemSetting 读 rate_limiting 全类别
    #          缺键用 config.py 默认值兜底; 解析为 RateLimitConfig dataclass
    #          _cache = ...; _expires_at = now + _ttl
    #   return _cache

    def invalidate()  # 后台写入后可主动失效, 立即生效(可选, 见 R7)
```

- `RateLimitConfig`:`{enabled, window_seconds, limits: {normal_user, normal_ip, ai_generation, auth_ip, media_serving}}`。
- **契约(对 spec 02)**:中间件每请求调用 `get_config()`,命中缓存时**无 DB I/O**;TTL 到期才刷新 → 满足「每请求读配置」又不压垮 DB。
- 全局单例 `rate_limit_config_provider`。
- 启动时可预热一次(`startup` 事件),避免首请求冷读。

### 2.4 后台 API(`rate_limit_settings_router`,`require_admin`)

挂载于 `/api/rate-limit`(在 `app/main.py` 注册,`prefix="/api/rate-limit"`):

| 方法 | 路径 | 行为 | 角色 |
|---|---|---|---|
| GET | `/config` | 返回当前生效配置 + 每键的默认值/类型/说明/范围(供前端表单渲染) | admin |
| PUT | `/config` | 批量更新若干键;逐键范围校验;写 `SystemSetting` + `SettingsAuditLog`;`provider.invalidate()` | admin |
| POST | `/reset` | 重置 `rate_limiting` 全部键为默认;写审计;失效缓存 | admin |
| GET | `/status` | 只读观测:`enabled`(取自当前生效配置)、`active_keys`、`total_checked`、`total_blocked`(后三项取自 spec 02 `rate_limiter` 只读快照) | admin |

- **校验**:超范围/类型不符 → 422 `ErrorResponse`,不写库。
- **审计**:每次 PUT/reset 写 `SettingsAuditLog`(`setting_type='system_setting'`、`category='rate_limiting'`、`action='update'|'reset'`、`changed_by=current_user.username`)。注:`SettingsAuditLog.changed_by` 与 `SystemSetting.updated_by` 均为 `String(50)` 用户名列(非 UUID id),须与既有 `system_settings_service` 行为一致——写库时一并把 `SystemSetting.updated_by` 设为 `current_user.username`。
- **响应**:统一 `BaseResponse`/`ErrorResponse` 形状。

### 2.5 复用 vs 专用路由

虽 `system_settings_router` 已支持任意类别的通用 CRUD,但限流需要额外的 `/config`(带元数据)与 `/status`(运行时观测)语义,故**新增专用** `rate_limit_settings_router`,持久化层仍复用 `SystemSetting` + `SettingsAuditLog`,保证审计一致。

## 3. 接口契约 (Interfaces)

- **Produces**: `rate_limit_config_provider`(单例,被 spec 02 中间件消费)、`rate_limit_settings_router`(被 `app/main.py` 注册、被 spec 04 前端消费)。
- **Consumes**: spec 02 `rate_limiter` 的只读统计快照(用于 `/status`)。
- **Consumes**: 既有 `SystemSetting` / `SettingsAuditLog` 模型与 DB 会话依赖 `get_db_session()`。
- **Config schema(前后端共享认知)**:`GET /config` 返回结构需与 spec 04 前端表单字段一一对应:
  ```
  { enabled, window_seconds,
    limits: { default_per_user_per_min, default_per_ip_per_min,
              ai_generation_per_min, auth_per_ip_per_min, media_serving_per_min },
    meta: { <key>: { default, type, min, max, description } } }
  ```

## 4. 行为与边界

- TTL 导致后台改动延迟生效(R7)→ PUT 后调用 `invalidate()` 可近即时生效;前端文案提示「数秒内生效」。
- 迁移须幂等,避免重复 seed 报错。
- `/status` 为单进程视角(R3),多 worker 下仅反映当前进程。
- 配置读取在 DB 不可用时降级为 `config.py` 默认值(不让限流配置故障打挂全站)。

## 5. 验收点

1. 迁移后 `rate_limiting` 类别 7 键默认值就位且幂等。
2. `GET /config` 返回值含 meta(默认/范围/说明),admin 可读、非 admin 403。
3. `PUT /config` 改 `ai_generation_per_min` 后,**数秒内**(或 invalidate 后立即)spec 02 中间件按新值限流。
4. 越界值被 422 拒绝,不写库。
5. 每次更新写入 `SettingsAuditLog`(`category='rate_limiting'`),可经既有 `GET /api/system-settings/audit-log?category=rate_limiting` 端点查询(本 spec 不新增审计列表端点,复用既有)。
6. `enabled=false` 经后台落库后,中间件直通。
