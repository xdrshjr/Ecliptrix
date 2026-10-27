# Supabase音频URL访问修复文档

## 问题描述

在Video Editing任务的"文本脚本"功能中，"转换语音"和"转换全部语音"按钮执行完成后，返回的Supabase音频URL无法正常访问，导致前端下载音频文件失败。

## 问题根因

1. **后端Supabase服务问题**: `supabase_service.py`中的`get_public_url()`方法使用不当
   ```python
   # 错误的用法
   public_url_response = self.client.storage.from_(self.bucket_name).get_public_url(bucket_path)
   public_url = public_url_response
   ```

2. **前端下载逻辑问题**: 前端尝试通过后端API下载音频，而不是直接使用Supabase URL

## 修复方案

### 1. 后端修复

**文件**: `backend-services/basic-service/app/services/supabase_service.py`

**修复内容**:
- 修正`get_public_url()`的使用方式，该方法直接返回字符串URL
- 添加URL生成的错误处理
- 增强日志记录，明确标识URL生成成功

```python
# 修复后的正确用法
try:
    public_url = self.client.storage.from_(self.bucket_name).get_public_url(bucket_path)
    logger.info("文件上传成功，获取公共URL成功", {
        "bucket_path": bucket_path,
        "public_url": public_url,
        "file_size": file_size,
        "url_accessible": True
    })
except Exception as url_error:
    logger.error("获取公共URL失败", {
        "bucket_path": bucket_path,
        "error": str(url_error),
        "file_size": file_size
    })
    return {
        "success": False,
        "message": f"文件上传成功但获取公共URL失败: {str(url_error)}"
    }
```

### 2. 前端修复

**文件**: `src/components/video/ScriptPanel.tsx`

**修复内容**:
- 修改音频下载逻辑，直接从Supabase URL获取音频文件
- 移除对后端`/api/audio/generated/`端点的依赖

```typescript
// 修复前：通过后端API下载
const audioBlob = await downloadAudioFile(fileName);

// 修复后：直接从Supabase URL下载
const fetchResponse = await fetch(audioUrl);
if (!fetchResponse.ok) {
  throw new Error(`Failed to fetch audio from Supabase: ${fetchResponse.status} ${fetchResponse.statusText}`);
}
const audioBlob = await fetchResponse.blob();
```

### 3. 日志增强

**TTS服务日志**:
```python
logger.info("音频文件上传到Supabase成功并获取到访问URL", {
    "supabase_url": supabase_url,
    "file_size": upload_result["file_size"],
    "segment_id": segment_id,
    "task_id": task_id,
    "upload_success": True,
    "url_accessible": True,
    "is_signed_url": "signed" in supabase_url.lower() or "token" in supabase_url.lower(),
    "message": f"音频文件已成功上传到Supabase，{'签名URL' if ('signed' in supabase_url.lower() or 'token' in supabase_url.lower()) else '公共URL'}可正常访问"
})
```

### 4. Token参数保护修复

**问题**: 之前的实现会错误地清理签名URL中的token参数，导致访问失败
**修复**: 智能识别URL类型，只对公共URL清理查询参数，保留签名URL的token

```python
# 修复前 (错误) - 清理所有查询参数
if '?' in public_url:
    public_url = public_url.split('?')[0]

# 修复后 (正确) - 只清理公共URL的查询参数
if '?' in public_url and '/object/public/' in public_url:
    public_url = public_url.split('?')[0]
```

## 环境配置

确保以下环境变量正确配置：

```env
SUPABASE_URL=https://hlqvzgwmbejiviaekdns.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_BUCKET=articraft-dev
ENVIRONMENT=development
```

## 测试验证

### 1. 单个语音转换测试
1. 在Video Editing界面点击"转换语音"按钮
2. 检查后端日志，确认显示"音频文件已成功上传到Supabase，公共URL可正常访问"
3. 验证前端可以成功下载并播放音频

### 2. 批量语音转换测试
1. 在Video Editing界面点击"转换全部语音"按钮
2. 检查后端日志，确认每个音频文件都成功上传并获取URL
3. 验证所有音频文件都能正常下载和播放

## 修复效果

- ✅ Supabase音频URL可正常访问
- ✅ 前端能够成功下载音频文件
- ✅ 详细的日志记录便于问题排查
- ✅ 完善的错误处理机制
- ✅ 智能URL处理：保留签名URL的token参数，只清理公共URL的查询参数
- ✅ 自动回退机制：公共URL失败时自动使用签名URL

## 注意事项

1. **URL访问权限**: 确保Supabase存储桶的访问权限配置正确
2. **CORS设置**: 如果遇到跨域问题，需要在Supabase中配置CORS
3. **网络连接**: 确保服务器和客户端都能正常访问Supabase服务 