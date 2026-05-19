# TODO 05：后端远端素材同源代理

> Reference: [`specs/05-backend-media-proxy.md`](../specs/05-backend-media-proxy.md)

## Dependencies

- `depends_on`: []
- `blocks`: [06, 07]
- `parallel_group`: B
- 说明：完全独立的后端能力，可以与 spec 02/03 同期并行开发。Spec 06 与 07 都强依赖它的端点。

## Tasks

- [ ] 在 `backend-services/basic-service/config/media-proxy-config.yaml` 写初始配置：`allowed_domains` 含 Pexels / Unsplash / 火山 ARK / 阿里 OSS / 用户上传 host；`signed_url_domains` 含 ARK；其他默认值见 spec 05 §五
- [ ] 在 `app/config.py` 的 `get_settings()` 中加载新 YAML，提供 typed config 对象
- [ ] 新增 `app/routers/media_proxy_router.py`：路由 `GET /api/media/proxy` 与 `GET /api/media/proxy/status`
- [ ] 在 `app/main.py` 注册新 router，挂载到 `/api/media`
- [ ] 新增 `app/services/media_proxy_service.py`：核心代理逻辑
- [ ] 实现 URL 白名单校验（左前缀通配符），拒绝 `*` 通配；URL scheme 强制 `https`（dev 可配 `enable_http`）
- [ ] 实现 SSRF 防护：DNS 解析后 IP 不在保留网段；解析与连接同一 IP（拒绝 DNS rebinding）；上游 follow_redirects=False（开启时复用同检查，≤ 3 跳）
- [ ] 实现 httpx 异步 streaming：透传 Range 头；上游无 Range 时改全量；transcribe Content-Type / Content-Length / Content-Range
- [ ] 实现 per-key `asyncio.Lock`（弱引用 dict，用完即清）防重复全量拉取；其他并发 tail-follow 已落盘字节
- [ ] 实现"边转发边落盘"：临时文件 → 完成后调用 `MaterialDownloadService.store_external_download_async(url, local_path, source, source_id)`；中途断开 → 删临时文件并把 `proxy_status` 置 `partial`/`error`
- [ ] 实现 Alembic 迁移：`cached_materials` 加 `proxy_status` / `proxy_last_updated` / `proxy_bytes_cached`
- [ ] 实现 `GET /api/media/proxy/status` 端点：读 `cached_materials` 返回缓存状态
- [ ] 实现 per-IP 速率限制（100 req/min）；总下载 size 上限触发即截断并标记 `error`、返回 413
- [ ] 响应头 `X-Material-Local-Url`：按 CLAUDE.md 规则 `/api/storage/files/cached_materials/<source>/<basename>`
- [ ] 单测 `tests/test_media_proxy.py`：正常 200/206、Range 精确字节、未知 host→403、私有 IP→403、超大→413、并发同 key 仅 1 个上游、缓存命中复用
- [ ] 集成测试 `tests/test_media_proxy_integration.py`：mock httpx + 本地 FS，验证 `store_external_download_async` 被调用、`cached_materials` 入库
- [ ] 运行 `alembic upgrade head` 确认迁移可双向（含 downgrade）
- [ ] 在 `env.template` 添加 `MEDIA_PROXY_MAX_SIZE_MB`、`MEDIA_PROXY_CONCURRENT_DOWNLOADS`
