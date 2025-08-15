# Supabase 文件上传重试机制

## 概述

为了提高 Supabase 文件上传的可靠性，我们在 `SupabaseService` 中实现了智能重试机制。该机制能够自动处理网络连接问题、临时服务器错误等可恢复的上传失败情况。

## 功能特性

### 1. 自动重试机制
- **重试次数**: 最多重试 3 次
- **退避策略**: 指数退避，延迟时间为 1秒、2秒、4秒
- **智能错误识别**: 只对可重试的错误进行重试

### 2. 错误类型处理

#### 可重试错误
以下错误类型会触发重试机制：
- `ConnectionError` - 连接错误
- `ConnectError` - 连接建立错误
- `ConnectionResetError` - 连接重置错误
- `TimeoutError` - 超时错误
- `ReadTimeoutError` - 读取超时
- `ConnectTimeoutError` - 连接超时
- `SSLError` - SSL错误
- `ProxyError` - 代理错误
- `ChunkedEncodingError` - 分块编码错误
- 包含 "远程主机强迫关闭了一个现有的连接" 的错误

#### 不可重试错误
以下错误类型不会触发重试：
- **客户端错误 (4xx)**: 400、401、403、404 等状态码错误
- **非网络相关错误**: 如文件格式错误、参数错误等

### 3. 详细日志记录

#### 重试过程日志
```
2025-08-15 18:18:15 - app.services.supabase_service - INFO - 尝试上传文件到Supabase (第1次尝试)
2025-08-15 18:18:16 - app.services.supabase_service - WARNING - 上传过程中发生异常 (第1次尝试)
2025-08-15 18:18:16 - app.services.supabase_service - INFO - 网络错误，等待 1.0 秒后重试
2025-08-15 18:18:17 - app.services.supabase_service - INFO - 尝试上传文件到Supabase (第2次尝试)
2025-08-15 18:18:18 - app.services.supabase_service - INFO - 文件上传到Supabase成功 (第2次尝试)
```

#### 日志信息包含
- 尝试次数和最大重试次数
- 文件大小和内容类型
- 错误类型和详细错误信息
- 重试延迟时间
- 最终上传结果

## 配置参数

在 `SupabaseService` 类中定义的重试配置：

```python
# 重试配置
MAX_UPLOAD_RETRIES = 3          # 最大重试次数
RETRY_BASE_DELAY = 1.0          # 基础延迟时间（秒）
RETRY_BACKOFF_FACTOR = 2.0      # 指数退避因子
```

## 使用示例

### 基本使用
```python
from app.services.supabase_service import supabase_service

# 上传文件（自动包含重试机制）
result = supabase_service.upload_file(
    local_file_path="/path/to/audio.mp3",
    bucket_path="audio/generated/2025/01/15/audio_20250115_181820.mp3",
    content_type="audio/mpeg"
)

if result["success"]:
    print(f"上传成功: {result['file_url']}")
else:
    print(f"上传失败: {result['message']}")
```

### 上传音频文件
```python
# 上传音频文件（内部调用 upload_file）
result = supabase_service.upload_audio_file(
    audio_file_path="/path/to/audio.mp3",
    segment_id="seg_001",
    task_id="task_123",
    voice_type="zh_female_wanqudashu_moon_bigtts"
)
```

## 返回值格式

### 成功响应
```json
{
    "success": true,
    "message": "文件上传成功",
    "file_url": "https://supabase.co/storage/v1/object/sign/bucket/path/file.mp3?token=...",
    "file_path": "audio/generated/2025/01/15/audio_20250115_181820.mp3",
    "file_size": 1024,
    "upload_time": "2025-01-15T18:18:20",
    "content_type": "audio/mpeg"
}
```

### 失败响应
```json
{
    "success": false,
    "message": "文件上传失败 (已重试3次): ConnectionResetError(10054, '远程主机强迫关闭了一个现有的连接。')"
}
```

## 错误处理最佳实践

### 1. 调用方处理
```python
result = supabase_service.upload_file(file_path)

if not result["success"]:
    if "已重试" in result["message"]:
        # 重试机制已用尽，可能需要人工干预
        logger.error("文件上传彻底失败，需要检查网络或服务状态")
    elif "客户端错误" in result.get("error_type", ""):
        # 客户端错误，检查文件或权限
        logger.error("文件上传客户端错误，检查文件格式或权限")
    else:
        # 其他错误
        logger.error(f"文件上传失败: {result['message']}")
```

### 2. 监控和告警
- 监控重试成功率
- 设置告警阈值（如重试失败率超过10%）
- 记录频繁失败的文件类型或大小

## 性能影响

### 1. 延迟影响
- **成功情况**: 无额外延迟
- **重试情况**: 最多增加 7 秒延迟（1+2+4秒）
- **失败情况**: 总延迟约 7-10 秒

### 2. 资源消耗
- **网络**: 失败时会重复传输文件数据
- **CPU**: 重试逻辑消耗极少
- **内存**: 文件数据在内存中保持，直到上传成功或失败

## 故障排查

### 1. 常见问题

#### 问题：重试次数用尽仍然失败
**可能原因**:
- 网络连接持续不稳定
- Supabase 服务端问题
- 代理服务器配置问题

**解决方案**:
- 检查网络连接状态
- 验证 Supabase 服务状态
- 检查代理配置

#### 问题：文件上传成功但 URL 无法访问
**可能原因**:
- Bucket 权限配置问题
- 签名 URL 生成失败

**解决方案**:
- 检查 Supabase bucket 权限设置
- 验证签名 URL 生成逻辑

### 2. 调试技巧

#### 启用详细日志
```python
import logging
logging.getLogger('app.services.supabase_service').setLevel(logging.DEBUG)
```

#### 检查重试统计
通过日志分析重试成功率：
```bash
grep "尝试上传文件到Supabase" logs/app.log | wc -l  # 总尝试次数
grep "文件上传到Supabase成功" logs/app.log | wc -l   # 成功次数
```

## 测试

### 单元测试
运行重试机制测试：
```bash
cd backend-services/basic-service
python -m pytest tests/test_supabase_retry.py -v
```

### 集成测试
测试真实网络环境下的重试机制：
```bash
python -m pytest tests/test_supabase_retry.py::TestSupabaseRetryMechanism::test_upload_retry_on_connection_error -v
```

## 更新历史

- **2025-01-15**: 初始实现重试机制
  - 添加 3 次重试逻辑
  - 实现指数退避策略
  - 添加智能错误识别
  - 完善日志记录

## 相关文档

- [Supabase 音频上传 API](./supabase_audio_upload_api.md)
- [TTS API 文档](./tts_api.md)
- [Supabase Bucket 权限指南](./supabase_bucket_permissions_guide.md)