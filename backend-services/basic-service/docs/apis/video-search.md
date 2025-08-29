# Video Search API

## 概述
在线视频搜索接口，提供高质量的免费视频素材搜索功能。集成多个视频素材平台（如PEXELS），支持按关键词、方向等条件搜索视频资源。

## 端点
`POST /api/video-search`

## 请求格式

### Headers
```
Content-Type: application/json
```

### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| query | string | 是 | 搜索关键词 |
| max_videos | number | 否 | 最大返回视频数量，默认20，最大100（支持分页显示，推荐60条分3页） |
| orientation | string | 否 | 视频方向："mixed"(混合)、"landscape"(横屏)、"portrait"(竖屏)，默认"mixed" |

### 示例请求
```json
{
  "query": "自然风景",
  "max_videos": 20,
  "orientation": "landscape"
}
```

## 响应格式

### 成功响应
- **状态码**: 200 OK
- **Content-Type**: application/json

```json
{
  "success": true,
  "videos": [
    {
      "id": 123456,
      "title": "美丽的山景延时摄影",
      "author": "John Photographer",
      "width": 1920,
      "height": 1080,
      "duration": 30,
      "thumbnail": "https://example.com/thumbnail.jpg",
      "video_url": "https://example.com/video.mp4"
    }
  ],
  "total_found": 150,
  "message": "搜索成功"
}
```

### 错误响应
- **状态码**: 400 Bad Request
```json
{
  "success": false,
  "error": "Invalid request parameters",
  "message": "搜索关键词不能为空"
}
```

- **状态码**: 429 Too Many Requests
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "message": "请求过于频繁，请稍后重试"
}
```

- **状态码**: 500 Internal Server Error
```json
{
  "success": false,
  "error": "Video search service unavailable",
  "message": "搜索服务暂时不可用"
}
```

## 视频数据结构

### VideoSearchResult 接口
```typescript
interface VideoSearchResult {
  id: number;              // 视频唯一标识
  title: string;           // 视频标题
  author: string;          // 作者名称
  width: number;           // 视频宽度（像素）
  height: number;          // 视频高度（像素）
  duration?: number;       // 视频时长（秒）
  thumbnail?: string;      // 缩略图URL
  video_url?: string;      // 视频文件URL
}
```

## 搜索参数说明

### 方向参数 (orientation)
| 值 | 描述 | 适用场景 |
|---|------|---------|
| mixed | 混合方向 | 不限制视频方向 |
| landscape | 横屏 | 适合桌面播放、宽屏显示 |
| portrait | 竖屏 | 适合移动设备、短视频 |

### 搜索关键词建议
- **中文关键词**: 支持中文搜索，如"自然风景"、"商务办公"
- **英文关键词**: 支持英文搜索，如"nature landscape"、"business office"
- **组合关键词**: 使用空格分隔，如"海滩 日落"、"city night"

## 错误代码

### 状态码说明
| 状态码 | 说明 | 常见原因 |
|-------|------|---------|
| 400 | 请求参数错误 | 关键词为空或格式不正确 |
| 422 | 搜索处理失败 | 关键词包含不支持的字符 |
| 429 | 请求过于频繁 | 超出API调用频率限制 |
| 500 | 服务器内部错误 | 第三方搜索服务异常 |
| 503 | 服务不可用 | 搜索服务维护中 |

### 错误处理建议
1. **400错误**: 验证搜索关键词的有效性
2. **422错误**: 简化搜索词或使用英文关键词
3. **429错误**: 实现请求限流和重试机制
4. **500/503错误**: 提供缓存结果或提示用户稍后重试

## 使用示例

### JavaScript/TypeScript 示例
```typescript
async function searchVideos(query: string, maxVideos: number = 20, orientation: string = 'mixed') {
  try {
    const response = await fetch('/api/video-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query.trim(),
        max_videos: maxVideos,
        orientation: orientation,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.videos) {
      console.log(`Found ${data.total_found} videos, returning ${data.videos.length}`);
      return {
        videos: data.videos,
        totalFound: data.total_found
      };
    } else {
      throw new Error(data.message || '搜索失败');
    }
  } catch (error) {
    console.error('Video search failed:', error);
    throw error;
  }
}

// 使用示例
searchVideos('自然风景', 10, 'landscape')
  .then(result => {
    console.log(`搜索成功，找到 ${result.totalFound} 个视频`);
    result.videos.forEach(video => {
      console.log(`- ${video.title} (${video.width}x${video.height}) by ${video.author}`);
    });
  })
  .catch(error => {
    console.error('搜索失败:', error.message);
  });
```

### React Hook 示例
```typescript
import { useState, useCallback } from 'react';

interface VideoSearchHook {
  searchVideos: (query: string, options?: SearchOptions) => Promise<void>;
  results: VideoSearchResult[];
  isSearching: boolean;
  error: string | null;
}

interface SearchOptions {
  maxVideos?: number;
  orientation?: 'mixed' | 'landscape' | 'portrait';
}

export const useVideoSearch = (): VideoSearchHook => {
  const [results, setResults] = useState<VideoSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchVideos = useCallback(async (query: string, options: SearchOptions = {}) => {
    if (!query.trim()) {
      setError('搜索关键词不能为空');
      return;
    }

    setIsSearching(true);
    setError(null);
    
    try {
      const response = await fetch('/api/video-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          max_videos: options.maxVideos || 20,
          orientation: options.orientation || 'mixed'
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setResults(data.videos || []);
      } else {
        setError(data.message || '搜索失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setIsSearching(false);
    }
  }, []);

  return { searchVideos, results, isSearching, error };
};
```

### cURL 示例
```bash
# 基础搜索
curl -X POST http://localhost:3000/api/video-search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "sunset beach",
    "max_videos": 10,
    "orientation": "landscape"
  }'

# 中文搜索
curl -X POST http://localhost:3000/api/video-search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "城市夜景",
    "max_videos": 15,
    "orientation": "mixed"
  }'
```

## 搜索优化建议

### 关键词策略
1. **具体描述**: 使用具体的描述词，如"日落海滩"而不是"漂亮"
2. **英文优先**: 英文关键词通常有更多搜索结果
3. **组合搜索**: 使用多个相关关键词提高匹配度
4. **避免过长**: 关键词不宜超过50个字符

### 搜索技巧
```typescript
// 好的搜索示例
const goodSearches = [
  'mountain landscape',
  'business meeting',
  'cooking food',
  '城市建筑',
  'ocean waves'
];

// 避免的搜索示例
const badSearches = [
  'good',           // 太泛泛
  'beautiful nice', // 形容词无意义
  '',              // 空字符串
  'a',             // 太短
  'very long search query with too many words that makes no sense' // 太长
];
```

## 测试

### 单元测试示例
```typescript
describe('Video Search API', () => {
  test('should return videos for valid search', async () => {
    const mockRequest = {
      query: 'nature',
      max_videos: 5,
      orientation: 'landscape'
    };

    const response = await fetch('/api/video-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockRequest)
    });

    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.videos).toBeInstanceOf(Array);
    expect(result.videos.length).toBeLessThanOrEqual(5);
    
    // 验证视频数据结构
    if (result.videos.length > 0) {
      const video = result.videos[0];
      expect(video).toHaveProperty('id');
      expect(video).toHaveProperty('title');
      expect(video).toHaveProperty('author');
      expect(video).toHaveProperty('width');
      expect(video).toHaveProperty('height');
    }
  });

  test('should return 400 for empty query', async () => {
    const mockRequest = {
      query: '',
      max_videos: 10
    };

    const response = await fetch('/api/video-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockRequest)
    });

    expect(response.status).toBe(400);
    
    const result = await response.json();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should respect max_videos limit', async () => {
    const mockRequest = {
      query: 'test',
      max_videos: 3
    };

    const response = await fetch('/api/video-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockRequest)
    });

    const result = await response.json();
    if (result.success && result.videos) {
      expect(result.videos.length).toBeLessThanOrEqual(3);
    }
  });
});
```

### 集成测试示例
```typescript
describe('Video Search Service Integration', () => {
  test('should validate search results', async () => {
    const videoSearchService = createVideoSearchService('test_task');
    
    const result = await videoSearchService.searchVideos({
      query: 'nature landscape',
      maxVideos: 10,
      orientation: 'landscape'
    });

    expect(result.success).toBe(true);
    expect(result.videos).toBeDefined();
    
    if (result.videos && result.videos.length > 0) {
      // 验证每个视频数据的完整性
      result.videos.forEach(video => {
        expect(typeof video.id).toBe('number');
        expect(typeof video.title).toBe('string');
        expect(typeof video.author).toBe('string');
        expect(typeof video.width).toBe('number');
        expect(typeof video.height).toBe('number');
        expect(video.width).toBeGreaterThan(0);
        expect(video.height).toBeGreaterThan(0);
      });
    }
  });

  test('should convert videos to materials', async () => {
    const videoSearchService = createVideoSearchService('test_task');
    
    const mockVideos: VideoSearchResult[] = [
      {
        id: 123,
        title: 'Test Video',
        author: 'Test Author',
        width: 1920,
        height: 1080,
        duration: 30,
        thumbnail: 'https://example.com/thumb.jpg',
        video_url: 'https://example.com/video.mp4'
      }
    ];

    const materials = videoSearchService.convertToMaterials(mockVideos);
    
    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      id: 'pexels-123',
      name: 'Test Video',
      type: 'video',
      format: 'mp4',
      width: 1920,
      height: 1080,
      duration: 30,
      url: 'https://example.com/video.mp4'
    });
  });
});
```

## 性能指标

### 搜索性能
- **搜索响应时间**: < 3 秒
- **缓存命中率**: > 60%
- **成功率**: > 95%

### 资源限制
- **每分钟请求限制**: 60 次/用户
- **每小时请求限制**: 1000 次/用户
- **单次最大返回**: 100 个视频

### 数据质量
- **视频可用性**: > 98%
- **缩略图加载成功率**: > 95%
- **元数据准确性**: > 90%

## 最佳实践

### 客户端实现
```typescript
class VideoSearchClient {
  private cache = new Map<string, any>();
  private requestQueue: Promise<any>[] = [];
  
  async searchWithCache(query: string, options: SearchOptions = {}) {
    const cacheKey = `${query}-${JSON.stringify(options)}`;
    
    // 检查缓存
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // 限制并发请求
    if (this.requestQueue.length >= 3) {
      await Promise.race(this.requestQueue);
    }
    
    const searchPromise = this.performSearch(query, options);
    this.requestQueue.push(searchPromise);
    
    try {
      const result = await searchPromise;
      
      // 缓存结果（5分钟）
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);
      
      return result;
    } finally {
      const index = this.requestQueue.indexOf(searchPromise);
      if (index > -1) {
        this.requestQueue.splice(index, 1);
      }
    }
  }
  
  private async performSearch(query: string, options: SearchOptions) {
    // 实际搜索实现
    return searchVideos(query, options.maxVideos, options.orientation);
  }
}
```

## 更新日志

### v1.0.0 (2024-01-15)
- 初始版本发布
- 支持PEXELS视频搜索
- 基础关键词和方向筛选

### v1.1.0 (2024-01-20)
- 添加中文关键词支持
- 优化搜索结果质量
- 增加请求限流机制

### v1.2.0 (当前版本)
- 重构为服务层架构
- 添加结果验证和转换功能
- 改进错误处理和日志记录
- 增加搜索结果缓存机制 