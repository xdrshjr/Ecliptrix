# YouTube Search API

## 概述
YouTube视频搜索接口，基于yt-dlp实现真实的YouTube视频搜索功能。支持按关键词搜索、视频质量过滤、时长过滤等多种搜索条件。

## 端点

### 1. 搜索YouTube视频
`POST /api/youtube/search`

#### 请求格式

##### Headers
```
Content-Type: application/json
```

##### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| query | string | 是 | 搜索关键词，1-200字符 |
| max_videos | number | 否 | 最大返回视频数量，默认20，范围1-50 |
| orientation | string | 否 | 视频方向："mixed"(混合)、"landscape"(横屏)、"portrait"(竖屏)，默认"mixed" |
| min_duration | number | 否 | 最小时长（秒） |
| max_duration | number | 否 | 最大时长（秒） |
| min_views | number | 否 | 最小播放量 |
| max_views | number | 否 | 最大播放量 |

##### 示例请求
```json
{
  "query": "机器学习教程",
  "max_videos": 20,
  "orientation": "landscape",
  "min_duration": 300,
  "max_duration": 3600,
  "min_views": 1000
}
```

#### 响应格式

##### 成功响应
- **状态码**: 200 OK
- **Content-Type**: application/json

```json
{
  "success": true,
  "videos": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "机器学习入门教程",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "duration": 1800,
      "uploader": "AI教育频道",
      "upload_date": "20231201",
      "view_count": 50000,
      "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "description": "这是一个机器学习的入门教程，适合初学者...",
      "width": 1920,
      "height": 1080
    }
  ],
  "total_found": 15,
  "message": "成功找到 15 个视频",
  "query": "机器学习教程"
}
```

##### 错误响应
- **状态码**: 400 Bad Request
```json
{
  "success": false,
  "error": "搜索关键词不能为空",
  "videos": [],
  "total_found": 0,
  "query": ""
}
```

- **状态码**: 500 Internal Server Error
```json
{
  "success": false,
  "error": "YouTube搜索失败: 网络连接超时",
  "videos": [],
  "total_found": 0,
  "query": "机器学习教程"
}
```

### 2. 获取YouTube视频信息
`POST /api/youtube/info`

#### 请求格式

##### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| url | string | 是 | YouTube视频URL |

##### 示例请求
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

#### 响应格式

##### 成功响应
```json
{
  "success": true,
  "video": {
    "id": "dQw4w9WgXcQ",
    "title": "Never Gonna Give You Up",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "duration": 212,
    "uploader": "RickAstleyVEVO",
    "upload_date": "20091025",
    "view_count": 1400000000,
    "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    "description": "The official video for Rick Astley...",
    "width": 1920,
    "height": 1080
  },
  "message": "成功获取视频信息"
}
```

### 3. 下载YouTube视频
`POST /api/youtube/download`

#### 请求格式

##### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| url | string | 是 | YouTube视频URL |
| video_quality | string | 否 | 视频质量，默认"720p" |
| audio_quality | string | 否 | 音频质量，默认"best" |
| format_type | string | 否 | 输出格式，默认"mp4" |
| start_time | string | 否 | 开始时间，格式"00:01:30" |
| end_time | string | 否 | 结束时间，格式"00:05:00" |
| duration | string | 否 | 持续时间，格式"00:03:30" |
| subtitle | boolean | 否 | 是否下载字幕，默认false |

##### 示例请求
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "video_quality": "720p",
  "format_type": "mp4",
  "subtitle": true
}
```

#### 响应格式

##### 成功响应
```json
{
  "success": true,
  "message": "视频下载成功",
  "file_path": "/static/video/youtube/Never_Gonna_Give_You_Up_1703123456.mp4",
  "file_size": 52428800
}
```

### 4. 服务健康检查
`GET /api/youtube/health`

#### 响应格式
```json
{
  "status": "healthy",
  "service": "YouTube Service",
  "yt_dlp_version": "2023.12.30",
  "message": "YouTube服务运行正常"
}
```

## 视频数据结构

### YoutubeVideoInfo 接口
```typescript
interface YoutubeVideoInfo {
  id: string;              // 视频ID
  title: string;           // 视频标题
  url: string;             // 视频URL
  duration: number;        // 视频时长（秒）
  uploader: string;        // 上传者
  upload_date: string;     // 上传日期
  view_count: number;      // 播放量
  thumbnail_url: string;   // 缩略图URL
  description: string;     // 视频描述
  width?: number;          // 视频宽度
  height?: number;         // 视频高度
}
```

## 前端集成

### React Hook 使用示例
```typescript
import { useYoutubeSearch } from '@/components/video/hooks';

const VideoSearchComponent = () => {
  const { searchVideos, results, isSearching, error } = useYoutubeSearch();

  const handleSearch = async () => {
    await searchVideos({
      query: '机器学习',
      maxVideos: 20,
      orientation: 'landscape'
    });
  };

  return (
    <div>
      <button onClick={handleSearch} disabled={isSearching}>
        {isSearching ? '搜索中...' : '搜索YouTube视频'}
      </button>
      
      {error && <div className="error">{error}</div>}
      
      <div className="results">
        {results.map(video => (
          <div key={video.id} className="video-item">
            <img src={video.thumbnail_url} alt={video.title} />
            <h3>{video.title}</h3>
            <p>上传者: {video.uploader}</p>
            <p>播放量: {video.view_count.toLocaleString()}</p>
            <p>时长: {Math.floor(video.duration / 60)}:{video.duration % 60}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### API 调用示例
```typescript
// 搜索YouTube视频
const searchYouTubeVideos = async (query: string) => {
  try {
    const response = await fetch('/api/youtube/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim(),
        max_videos: 20,
        orientation: 'mixed'
      })
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('找到视频:', data.videos);
      return data.videos;
    } else {
      console.error('搜索失败:', data.error);
      return [];
    }
  } catch (error) {
    console.error('网络错误:', error);
    return [];
  }
};

// 获取视频信息
const getVideoInfo = async (url: string) => {
  try {
    const response = await fetch('/api/youtube/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    return data.success ? data.video : null;
  } catch (error) {
    console.error('获取视频信息失败:', error);
    return null;
  }
};
```

### cURL 示例
```bash
# 搜索YouTube视频
curl -X POST http://localhost:8000/api/youtube/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "机器学习教程",
    "max_videos": 10,
    "orientation": "landscape",
    "min_duration": 300
  }'

# 获取视频信息
curl -X POST http://localhost:8000/api/youtube/info \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }'

# 下载视频
curl -X POST http://localhost:8000/api/youtube/download \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "video_quality": "720p",
    "format_type": "mp4"
  }'

# 健康检查
curl -X GET http://localhost:8000/api/youtube/health
```

## 搜索优化建议

### 关键词策略
1. **具体描述**: 使用具体的描述词，如"Python机器学习教程"而不是"教程"
2. **英文关键词**: 英文关键词通常有更多搜索结果
3. **组合搜索**: 使用多个相关关键词提高匹配度
4. **避免过长**: 关键词不宜超过200个字符

### 过滤技巧
```typescript
// 搜索高质量教程视频
const searchHighQualityTutorials = {
  query: "machine learning tutorial",
  max_videos: 20,
  orientation: "landscape",
  min_duration: 600,      // 至少10分钟
  max_duration: 3600,     // 最多1小时
  min_views: 10000        // 至少1万播放量
};

// 搜索短视频内容
const searchShortVideos = {
  query: "AI news",
  max_videos: 30,
  orientation: "mixed",
  max_duration: 300       // 最多5分钟
};
```

## 错误处理

### 常见错误码
- `400`: 请求参数错误
- `404`: 视频不存在
- `429`: 请求频率过高
- `500`: 服务器内部错误
- `503`: YouTube服务不可用

### 错误处理最佳实践
```typescript
const handleYouTubeSearch = async (query: string) => {
  try {
    const response = await fetch('/api/youtube/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('请求过于频繁，请稍后重试');
      } else if (response.status === 503) {
        throw new Error('YouTube服务暂时不可用');
      } else {
        throw new Error(`搜索失败: ${response.status}`);
      }
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('YouTube搜索错误:', error);
    throw error;
  }
};
```

## 性能优化

### 缓存策略
- 搜索结果缓存：相同查询在5分钟内返回缓存结果
- 视频信息缓存：视频基本信息缓存1小时
- 缩略图预加载：异步加载缩略图提升用户体验

### 请求限制
- 单次搜索最多50个结果
- 每分钟最多10次搜索请求
- 下载功能需要适当的权限控制

## 依赖要求

### 后端依赖
- `yt-dlp`: YouTube视频处理核心库
- `fastapi`: Web框架
- `pydantic`: 数据验证

### 系统要求
- Python 3.8+
- 足够的磁盘空间用于视频下载
- 稳定的网络连接访问YouTube

## 注意事项

1. **版权合规**: 下载的视频仅供个人学习使用，请遵守相关版权法律
2. **网络依赖**: 功能依赖于YouTube服务的可用性
3. **存储管理**: 定期清理下载的视频文件以节省存储空间
4. **速率限制**: 避免频繁请求以防止被YouTube限制访问 