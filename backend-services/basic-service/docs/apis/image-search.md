# Image Search API

## 概述

图片搜索API提供基于Unsplash API的在线图片搜索功能，支持按关键词、方向、颜色和排序方式等条件搜索高质量的图片。

## 基础信息

- **基础URL**: `/api/image`
- **认证方式**: 无需认证（后端使用Unsplash API Key）
- **支持格式**: JSON

## 端点

### 1. 搜索图片

搜索在线图片，支持多种过滤条件和排序方式。

**端点**: `POST /api/image/search`

#### 请求参数

```json
{
  "query": "nature landscape",
  "max_images": 60,
  "orientation": "landscape",
  "color": "all",
  "order_by": "relevant"
}
```

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词，1-200字符 |
| `max_images` | integer | 否 | 最大返回数量，默认60，范围1-60 |
| `orientation` | string | 否 | 图片方向，默认"all"，可选值：all, landscape, portrait, squarish |
| `color` | string | 否 | 图片颜色，默认"all"，可选值：all, black_and_white, black, white, yellow, orange, red, purple, magenta, green, teal, blue |
| `order_by` | string | 否 | 排序方式，默认"relevant"，可选值：relevant, latest, popular |

#### 方向说明

- `all`: 所有方向
- `landscape`: 横向（宽度 > 高度）
- `portrait`: 纵向（高度 > 宽度）
- `squarish`: 方形（宽高比接近1:1）

#### 排序方式说明

- `relevant`: 按相关度排序（默认）
- `latest`: 按最新时间排序
- `popular`: 按热度排序（点赞数）

#### 响应格式

**成功响应** (200):
```json
{
  "success": true,
  "message": "Found 60 images",
  "images": [
    {
      "id": "abc123def456",
      "description": "Beautiful mountain landscape at sunset",
      "alt_description": "Mountain peaks with orange sunset sky",
      "width": 4000,
      "height": 3000,
      "color": "#ff6b35",
      "blur_hash": "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
      "raw_url": "https://images.unsplash.com/photo-1234567890/raw",
      "full_url": "https://images.unsplash.com/photo-1234567890/full",
      "regular_url": "https://images.unsplash.com/photo-1234567890/regular",
      "small_url": "https://images.unsplash.com/photo-1234567890/small",
      "thumb_url": "https://images.unsplash.com/photo-1234567890/thumb",
      "user_id": "user123",
      "user_name": "John Photographer",
      "user_username": "johnphoto",
      "user_profile_url": "https://unsplash.com/@johnphoto",
      "user_avatar_url": "https://images.unsplash.com/profile-1234567890",
      "likes": 1523,
      "downloads": 45678,
      "created_at": "2023-01-15T10:30:00Z",
      "updated_at": "2023-01-15T10:30:00Z",
      "tags": ["landscape", "mountain", "sunset", "nature"],
      "categories": ["nature", "landscape"],
      "html_url": "https://unsplash.com/photos/abc123def456",
      "download_location": "https://api.unsplash.com/photos/abc123def456/download"
    }
  ],
  "total_found": 10000,
  "query": "nature landscape"
}
```

**错误响应** (400):
```json
{
  "success": false,
  "message": "Search query cannot be empty",
  "images": [],
  "total_found": 0,
  "query": ""
}
```

**错误响应** (500):
```json
{
  "success": false,
  "message": "Failed to fetch data from Unsplash API",
  "images": [],
  "total_found": 0,
  "query": "nature landscape"
}
```

### 2. 健康检查

检查图片搜索服务的健康状态。

**端点**: `GET /api/image/health`

#### 响应格式

**健康状态** (200):
```json
{
  "status": "healthy",
  "message": "Image search service is operational",
  "service": "image_search",
  "api_keys_count": 2,
  "timestamp": "2023-01-15T10:30:00Z"
}
```

**不健康状态** (503):
```json
{
  "status": "unhealthy",
  "message": "Unsplash API keys not configured",
  "service": "image_search",
  "timestamp": "2023-01-15T10:30:00Z"
}
```

## 图片尺寸说明

Unsplash提供多种尺寸的图片URL：

- `raw_url`: 原始分辨率（最高质量，文件最大）
- `full_url`: 完整尺寸（高质量）
- `regular_url`: 常规尺寸（1080px宽，适合大多数用途）
- `small_url`: 小尺寸（400px宽，适合缩略图）
- `thumb_url`: 缩略图（200px宽，适合预览）

## 使用限制

- 每次搜索最多返回60张图片
- API使用Unsplash的免费API，有一定的速率限制
- 支持多个API Key轮换以提高可用性
- 所有图片均来自Unsplash，遵循其使用条款

## 错误代码

| 状态码 | 说明 |
|--------|------|
| 200 | 搜索成功 |
| 400 | 请求参数错误 |
| 500 | 服务器内部错误或API调用失败 |
| 503 | 服务不可用（API Key未配置） |

## 示例用法

### 搜索风景图片
```bash
curl -X POST "http://localhost:8000/api/image/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mountain landscape",
    "max_images": 20,
    "orientation": "landscape",
    "order_by": "popular"
  }'
```

### 搜索黑白人像
```bash
curl -X POST "http://localhost:8000/api/image/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "portrait",
    "max_images": 30,
    "orientation": "portrait",
    "color": "black_and_white",
    "order_by": "latest"
  }'
``` 