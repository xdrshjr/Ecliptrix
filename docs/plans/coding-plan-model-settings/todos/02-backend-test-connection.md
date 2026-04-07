# TODO 02: 连接测试增强与 API 格式支持

**对应 Spec:** `specs/02-backend-test-connection.md`

## Dependencies

- **depends_on:** [01] (依赖 Pydantic 模型扩展和 `_resolve_api_format` 辅助函数)
- **blocks:** [03] (前端测试 UI 依赖后端增强的测试接口)
- **parallel_group:** A

依赖 TODO 01 完成的 `_resolve_api_format` 函数和数据库 `api_format` 列。

## Tasks

### 请求/响应模型扩展
- [ ] 在 `TestConnectionRequest` 中新增 `api_format: Optional[str] = None`
- [ ] 在 `TestConnectionResponse` 中新增 `model_info: Optional[dict] = None`

### 辅助方法
- [ ] 新增 `_get_provider_db_format(provider_id: Optional[str]) -> Optional[str]` 方法，从数据库查询提供商的 api_format

### test_connection 重构
- [ ] 提取现有 OpenAI 格式测试逻辑为独立方法 `_test_openai_connection(api_url, api_key, model_name)`
- [ ] 重构 `test_connection`：获取 db_format → 调用 `_resolve_api_format` → 分发到对应测试方法
- [ ] 测试成功时填充 `model_info = {"model": model_name, "format_used": api_format}`

### Kimi 特殊处理验证
- [ ] 确认 `_test_anthropic_connection` 对 `kimi_coding` 类型正确附加 `User-Agent: claude-code/1.0`
- [ ] 验证 Kimi K2.5 端到端连接测试通过

### GLM Coding Plan 验证
- [ ] 验证 GLM 使用 OpenAI 格式 + 正确端点 `https://open.bigmodel.cn/api/coding/paas/v4` 测试连接通过
- [ ] 验证 GLM glm-5.1 模型连接测试通过
