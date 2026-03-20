# TODO 02: 后端模型和服务层改动

**对应 Spec:** `specs/02-backend-changes.md`

## Dependencies

- depends_on: [01]
- blocks: [03, 04]
- parallel_group: B

**原因：** 依赖 API 测试结果确认请求格式。前端改动依赖后端接口变更。

## Tasks

- [ ] 修改 `app/models/ark_video_models.py`：添加 `mode`、`first_frame_url`、`last_frame_url` 字段
- [ ] 修改 `app/services/ark_video_service.py` 的 `create_task()`：根据 mode 分支构建 content 数组
- [ ] 模式B 验证：`first_frame_url` 为空时返回 ValueError
- [ ] 模式B 时强制 `ratio = "adaptive"`
- [ ] 确保向后兼容：不传 mode 时默认 "description"，行为与旧版一致
- [ ] 编写单元测试验证两种模式的 content 构建
