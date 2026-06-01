# TODO 02 — 限流内核

> Spec: [`specs/02-rate-limiter-core.md`](../specs/02-rate-limiter-core.md)

## Dependencies

- `depends_on: []` —— 无前置;可与 01 并行。配置 Provider 由 03 提供,但本任务可先以 fallback 默认值定义消费接口,等 03 接入。
- `blocks: [03, 04, 06]` —— 03 的 Provider 契约与本任务的配置键消费一致;04 前端依赖限流行为;06 测试限流。
- `parallel_group: A` —— 与 TODO 01 同组并行。
- WHY: 限流内核是新增层,自成一体;其消费的配置接口契约需先定型,03 据此实现 Provider。

## Tasks

### A. RateLimiter 内核(`app/services/rate_limiter.py`)
- [ ] Read `app/services/media_proxy_service.py:276-304` 现有 per-IP 滑动窗口实现作参照。
- [ ] 实现 `RateLimiter`:`_windows: Dict[str, Deque[float]]` + `asyncio.Lock`;`async check(key, limit, window_seconds=60) -> Decision`(放行/超限、retry_after、remaining)。
- [ ] GC:key 数超阈值(默认 4096)清理空队列/最旧 key,防内存无界。
- [ ] 暴露只读统计快照:`total_checked`/`total_blocked`/`active_keys`(供 03 `/status`)。
- [ ] 提供测试隔离钩子(`reset()` 或可新建实例),供 06 用例间隔离。
- [ ] 全局单例 `rate_limiter`。

### B. 身份解析与类别注册表
- [ ] `get_client_ip(request)`:优先 `X-Forwarded-For` 首段(strip),否则 `request.client.host`。
- [ ] `resolve_category(path) -> str`:按 spec §2.3 顺序匹配(`auth` → `media_serving` → `ai_generation` → `normal`);确保 `/api/audio/generated/` 等 media 子前缀排在 `ai_generation` 的 `/api/audio/` 之前。
- [ ] 对照 `app/main.py` 实际 prefix 核定 `ai_generation` 前缀集合。
- [ ] identity key = `f"{identity}:{category}"`;`auth` 类别强制按 IP。

### C. 限流中间件(`app/middleware/rate_limit_middleware.py`)
- [ ] 实现 `RateLimitMiddleware`:读 Provider 配置;`enabled=false` 直通;OPTIONS 直通;`normal` 按身份取 `default_per_user_per_min`/`default_per_ip_per_min`,其余类别用各自单一键。
- [ ] 超限返回 `429` + `Retry-After` 头 + 统一 `ErrorResponse`(`error_code="rate_limit.exceeded"`);可选附 `X-RateLimit-*`。
- [ ] 消费 03 的 `rate_limit_config_provider.get_config()`(命中缓存无 DB I/O);03 未就绪前先用本地 fallback。

### D. 中间件注册顺序(R5,关键)
- [ ] 在 `app/main.py` **先 `add_middleware(RateLimitMiddleware)`、后 `add_middleware(SessionAuthMiddleware)`**,使执行序为 `Auth → RateLimit`(LIFO:后注册者最外层最先执行)。
- [ ] PR 中加注释说明注册顺序与执行序的关系;确保限流在异常处理之内、业务路由之外。

### E. 自检
- [ ] 本地:同用户超额 → 429+Retry-After;AI 类别独立更早触发;auth 按 IP;`enabled=false` 直通;media 高额度不打断。
- [ ] 确认限流能读到 `request.state.user`(顺序正确)。
- [ ] 写执行摘要(产出的接口:`rate_limiter`/`resolve_category`/`get_client_ip`/`RateLimitMiddleware`;消费的配置键清单)供 03/04/06。
