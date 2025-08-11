# 部署配置说明

## 概述
本文档说明了Ecliptrix项目在部署到服务器时的配置要求，特别是关于TTS API调用的修改。

## 主要修改内容

### 1. TTS API架构调整

#### 修改前的问题
- TTS API直接调用后台服务 `http://localhost:8000/api/tts/convert`
- 部署到服务器后无法正确调用后台接口

#### 修改后的解决方案
- 创建Next.js API路由作为代理：
  - `/api/tts/convert` - 文本转语音
  - `/api/tts/voice-types` - 获取语音类型
  - `/api/tts/batch-convert` - 批量转换
  - `/api/tts/health` - 健康检查
  - `/api/audio/generated/[filename]` - 音频文件下载

#### 架构流程
```
前端组件 → Next.js API路由 → 后台FastAPI服务
```

### 2. 文件修改列表

#### 新增文件
- `src/app/api/tts/convert/route.ts` - TTS转换API路由
- `src/app/api/tts/voice-types/route.ts` - 语音类型API路由  
- `src/app/api/tts/batch-convert/route.ts` - 批量转换API路由
- `src/app/api/tts/health/route.ts` - 健康检查API路由
- `src/app/api/audio/generated/[filename]/route.ts` - 音频下载API路由
- `backend-services/basic-service/docs/apis/tts_api.md` - TTS API文档
- `backend-services/basic-service/tests/test_tts_api.py` - TTS API测试

#### 修改文件
- `src/lib/api/tts.ts` - 移除硬编码的API_BASE_URL，改用相对路径
- `env.template` - 添加BACKEND_URL配置说明
- 其他API文件添加配置注释

## 部署配置

### 环境变量配置

#### 开发环境 (.env.local)
```bash
# 后台服务地址 - 开发环境使用localhost
BACKEND_URL=http://localhost:8000

# 前端API基础URL - 开发环境通常为空
NEXT_PUBLIC_API_BASE_URL=
```

#### 生产环境 (.env.production)
```bash
# 后台服务地址 - 生产环境使用实际服务器地址
BACKEND_URL=http://121.40.128.125:8000

# 前端API基础URL - 生产环境通常为空，使用相对路径
NEXT_PUBLIC_API_BASE_URL=
```

### 服务器部署步骤

#### 1. 后台服务部署
```bash
# 进入后台服务目录
cd backend-services/basic-service

# 安装依赖
pip install -r requirements.txt

# 启动服务 (确保端口8000可用)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

#### 2. 前端服务部署
```bash
# 设置环境变量
export BACKEND_URL=http://121.40.128.125:8000

# 构建应用
npm run build

# 启动生产服务
npm run start
```

#### 3. Nginx配置 (可选)
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端应用
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 直接代理到后台服务 (可选)
    location /api/backend/ {
        rewrite ^/api/backend/(.*) /api/$1 break;
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 验证部署

### 1. 健康检查
```bash
# 检查后台服务
curl http://121.40.128.125:8000/api/tts/health

# 检查前端API代理
curl http://121.40.128.125:3000/api/tts/health
```

### 2. 功能测试
```bash
# 测试TTS转换
curl -X POST http://121.40.128.125:3000/api/tts/convert \
  -H "Content-Type: application/json" \
  -d '{
    "text": "测试文本",
    "voice_type": "zh-CN-XiaoxiaoNeural",
    "speed_ratio": 1.0
  }'

# 测试语音类型获取
curl http://121.40.128.125:3000/api/tts/voice-types
```

## 日志监控

### 前端日志
- Next.js API路由日志会显示在控制台
- 包含详细的请求/响应信息和错误处理

### 后台日志
- FastAPI服务日志位于 `backend-services/basic-service/logs/`
- 包含TTS转换的详细日志记录

## 故障排除

### 常见问题

#### 1. TTS接口调用失败
**症状**: 前端显示"TTS service temporarily unavailable"
**解决方案**: 
- 检查BACKEND_URL环境变量是否正确设置
- 确认后台服务是否正常运行
- 检查网络连接和防火墙设置

#### 2. 音频文件下载失败  
**症状**: 音频文件无法下载或播放
**解决方案**:
- 检查后台服务的静态文件目录权限
- 确认音频文件是否正确生成
- 检查API路由的文件代理逻辑

#### 3. 语音类型获取失败
**症状**: 语音选择器显示为空
**解决方案**:
- 检查后台TTS配置文件
- 确认TTS引擎服务状态
- 查看后台日志中的错误信息

### 调试命令
```bash
# 查看后台服务状态
systemctl status ecliptrix-backend

# 查看前端服务状态  
systemctl status ecliptrix-frontend

# 查看后台日志
tail -f backend-services/basic-service/logs/app.log

# 查看前端日志
pm2 logs ecliptrix-frontend
```

## 性能优化建议

### 1. 缓存策略
- 音频文件设置适当的缓存头
- 语音类型列表启用长期缓存
- 使用CDN加速音频文件分发

### 2. 负载均衡
- 多个后台服务实例
- 前端服务的负载均衡
- 数据库连接池优化

### 3. 监控告警
- API响应时间监控
- 错误率监控
- 服务可用性监控

## 更新日志

### v1.0.0 (2024-01-10)
- 完成TTS API架构重构
- 添加Next.js API路由代理
- 完善部署配置文档
- 添加详细的错误处理和日志记录 