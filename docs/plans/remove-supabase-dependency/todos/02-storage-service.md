# TODO 02: 本地文件存储服务

> 对应 Spec: `specs/02-storage-service.md`

## config.py 变更

- [ ] 新建 `StorageConfig` 类（root, max_file_size, allowed_video_types, allowed_audio_types, allowed_image_types）
- [ ] 在 `Settings` 中新增 `storage: StorageConfig` 字段
- [ ] 在 `get_settings()` 中新增 STORAGE_ROOT, STORAGE_MAX_FILE_SIZE 环境变量读取

## storage_service.py 创建

- [ ] 新建 `app/services/storage_service.py`
- [ ] 实现 `__init__`：读取配置，确保存储根目录存在
- [ ] 实现 `_generate_storage_path()`：根据类型/日期/用户/任务生成路径
- [ ] 实现 `_get_file_url()`：生成 `/api/storage/files/{path}` 格式URL
- [ ] 实现 `_validate_path()`：路径遍历攻击防护（resolve + startswith 检查）
- [ ] 实现 `_sanitize_filename()`：清理文件名中的危险字符
- [ ] 实现 `_validate_file_type()`：根据 folder 类型验证 MIME 类型
- [ ] 实现 `upload_file()`：通用文件上传（aiofiles 异步写入）
- [ ] 实现 `upload_audio_file()`：音频上传封装
- [ ] 实现 `upload_video_file()`：视频上传 + FFmpeg 缩略图生成 + ffprobe 元数据提取
- [ ] 实现 `delete_file()`：文件删除（含安全检查）
- [ ] 实现 `list_user_materials()`：递归遍历用户目录，分页返回
- [ ] 实现 `_create_file_info()`：从文件系统提取文件信息（名称、大小、类型、时间）
- [ ] 实现 `health_check()`：检查存储目录可用性
- [ ] 在模块末尾创建全局单例 `storage_service = StorageService()`

## main.py 静态文件挂载

- [ ] 新增 `app.mount("/api/storage/files", StaticFiles(directory=uploads_dir), name="storage_files")`
- [ ] 确保 uploads_dir 在挂载前创建

## 验证

- [ ] 测试文件上传到正确的本地路径
- [ ] 测试上传后的 URL 能通过 FastAPI 静态文件服务正常访问
- [ ] 测试视频缩略图生成功能（FFmpeg 可用时）
- [ ] 测试路径遍历防护（传入 `../../etc/passwd` 等路径）
- [ ] 测试文件大小限制生效
