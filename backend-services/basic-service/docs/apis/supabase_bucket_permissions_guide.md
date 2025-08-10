# Supabase存储桶权限配置指南

## 问题诊断

如果遇到"Bucket not found"错误，通常是以下原因之一：

1. **存储桶不存在**
2. **存储桶权限配置不正确**
3. **RLS (Row Level Security) 策略阻止了访问**

## 解决方案

### 1. 检查存储桶是否存在

在Supabase控制台中：
1. 进入 **Storage** > **Buckets**
2. 确认存储桶 `articraft-dev` 存在
3. 如果不存在，创建新的存储桶

### 2. 配置存储桶为公共访问

#### 方法一：通过Supabase控制台
1. 在Storage页面，找到 `articraft-dev` 存储桶
2. 点击存储桶右侧的设置图标
3. 选择 **"Make public"** 或确保 **"Public bucket"** 选项已启用

#### 方法二：通过SQL命令
在Supabase SQL编辑器中执行：

```sql
-- 更新存储桶为公共访问
UPDATE storage.buckets 
SET public = true 
WHERE name = 'articraft-dev';

-- 创建允许公共访问的RLS策略
INSERT INTO storage.policies (name, bucket_id, definition, check_definition, command)
VALUES (
  'Public Access',
  (SELECT id FROM storage.buckets WHERE name = 'articraft-dev'),
  'true',
  'true',
  'SELECT'
);

-- 允许公共插入（上传）
INSERT INTO storage.policies (name, bucket_id, definition, check_definition, command)
VALUES (
  'Public Upload',
  (SELECT id FROM storage.buckets WHERE name = 'articraft-dev'),
  'true',
  'true',
  'INSERT'
);
```

### 3. 验证权限配置

#### 检查存储桶状态
```sql
SELECT name, public, created_at 
FROM storage.buckets 
WHERE name = 'articraft-dev';
```

#### 检查RLS策略
```sql
SELECT name, definition, check_definition, command
FROM storage.policies
WHERE bucket_id = (SELECT id FROM storage.buckets WHERE name = 'articraft-dev');
```

### 4. 备选方案：使用签名URL

如果公共访问仍有问题，系统会自动回退到签名URL：

- **优点**: 绕过权限问题，更安全
- **缺点**: URL较长，有时间限制（24小时）
- **适用场景**: 临时访问，敏感文件

## 环境变量确认

确保以下环境变量正确设置：

```env
SUPABASE_URL=https://hlqvzgwmbejiviaekdns.supabase.co
SUPABASE_ANON_KEY=***REMOVED***t_IDz-_tlUR8C4Yai2G05l4UdFiHOMUom-DNW08dIws
SUPABASE_BUCKET=articraft-dev
ENVIRONMENT=development
```

## 故障排除步骤

1. **检查日志**: 查看后端日志中的存储桶状态检查信息
2. **验证URL格式**: 确认生成的URL格式正确
3. **测试URL可访问性**: 系统会自动测试URL并记录结果
4. **自动回退**: 如果公共URL失败，会自动尝试签名URL

## 预期日志输出

成功配置后，应该看到类似的日志：

```
2025-08-11 02:06:01 - app.services.supabase_service - INFO - 存储桶状态检查
2025-08-11 02:06:01 - app.services.supabase_service - INFO - 文件上传成功，获取可访问URL成功
2025-08-11 02:06:01 - app.services.tts_service - INFO - 音频文件已成功上传到Supabase，公共URL可正常访问
```

## 常见问题

**Q: 为什么会出现"Bucket not found"错误？**
A: 通常是存储桶权限配置问题，按照上述步骤配置公共访问即可。

**Q: 签名URL和公共URL有什么区别？**
A: 公共URL永久有效但需要正确的权限配置；签名URL有时间限制但更安全。

**Q: 如何确认配置是否正确？**
A: 检查后端日志中的URL可访问性测试结果。 