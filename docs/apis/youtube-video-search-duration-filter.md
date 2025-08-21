# YouTube视频搜索时间过滤功能 API 文档

## 概述

本文档描述了为YouTube视频搜索功能添加的时间范围过滤能力，允许用户根据视频时长进行精确搜索。

## 功能特性

- **预设时间范围**：提供1分钟、3分钟、5分钟、10分钟内的快速选择
- **自定义时间范围**：支持用户自定义最小和最大时长
- **默认配置**：默认搜索0-300秒（5分钟）内的视频
- **实时验证**：对时间参数进行实时验证和错误处理
- **详细日志**：完整记录用户的时间过滤操作

## API 接口

### 1. YouTube视频搜索接口

**接口地址**: `POST /api/youtube/search`

**请求参数**:

```json
{
  "query": "string",           // 搜索关键词（必需）
  "max_videos": 20,           // 最大返回视频数量（可选，默认20）
  "orientation": "mixed",      // 视频方向（可选，默认mixed）
  "min_duration": 0,          // 最小时长（秒）（可选）
  "max_duration": 300         // 最大时长（秒）（可选）
}
```

**参数说明**:

| 参数名 | 类型 | 必需 | 默认值 | 说明 |
|--------|------|------|--------|------|
| query | string | 是 | - | 搜索关键词 |
| max_videos | number | 否 | 20 | 返回视频数量，范围1-50 |
| orientation | string | 否 | "mixed" | 视频方向：landscape/portrait/mixed |
| min_duration | number | 否 | - | 最小时长（秒），必须≥0 |
| max_duration | number | 否 | - | 最大时长（秒），必须>min_duration |

**响应格式**:

```json
{
  "success": true,
  "videos": [
    {
      "id": "string",
      "title": "string",
      "channelTitle": "string",
      "description": "string",
      "thumbnailUrl": "string",
      "duration": 180,
      "viewCount": 1000000,
      "publishedAt": "2024-01-01T00:00:00Z",
      "width": 1920,
      "height": 1080
    }
  ],
  "total_found": 25,
  "message": "Search completed successfully"
}
```

## 前端实现

### 1. 类型定义

```typescript
// YouTube时间范围类型
export interface YoutubeDurationRange {
  minDuration: number; // 最小时长（秒）
  maxDuration: number; // 最大时长（秒）
}

// YouTube时间范围预设选项
export type YoutubeDurationPreset = 'under_1min' | 'under_3min' | 'under_5min' | 'under_10min' | 'custom';
```

### 2. Hook接口扩展

```typescript
export interface UseVideoSearchReturn {
  // ... 现有属性
  
  // 新增：YouTube时间范围相关状态
  youtubeDurationRange: YoutubeDurationRange;
  youtubeDurationPreset: YoutubeDurationPreset;
  
  // 新增：YouTube时间范围相关方法
  setYoutubeDurationRange: (range: YoutubeDurationRange) => void;
  setYoutubeDurationPreset: (preset: YoutubeDurationPreset) => void;
}
```

### 3. 服务层接口

```typescript
export interface YoutubeVideoSearchService {
  searchVideos(params: {
    query: string;
    maxVideos: number;
    orientation: SearchOrientation;
    minDuration?: number;    // 新增
    maxDuration?: number;    // 新增
  }): Promise<YoutubeVideoSearchResponse>;
}
```

## 使用示例

### 1. 搜索5分钟内的自然风景视频

```javascript
const result = await youtubeVideoSearchService.searchVideos({
  query: "自然风景",
  maxVideos: 20,
  orientation: "landscape",
  minDuration: 0,
  maxDuration: 300
});
```

### 2. 搜索1-3分钟的教程视频

```javascript
const result = await youtubeVideoSearchService.searchVideos({
  query: "编程教程",
  maxVideos: 15,
  orientation: "mixed",
  minDuration: 60,
  maxDuration: 180
});
```

## 预设时间范围

| 预设选项 | 时间范围 | 说明 |
|----------|----------|------|
| under_1min | 0-60秒 | 1分钟内的短视频 |
| under_3min | 0-180秒 | 3分钟内的视频 |
| under_5min | 0-300秒 | 5分钟内的视频（默认） |
| under_10min | 0-600秒 | 10分钟内的视频 |
| custom | 自定义 | 用户自定义时间范围 |

## 验证规则

### 1. 时间参数验证

- `minDuration` 必须 ≥ 0
- `maxDuration` 必须 > `minDuration`
- 两个参数都必须是非负整数

### 2. 错误处理

```json
// 时间参数无效时的错误响应
{
  "success": false,
  "error": "Duration values must be non-negative",
  "videos": [],
  "total_found": 0
}
```

```json
// 时间范围无效时的错误响应
{
  "success": false,
  "error": "Min duration must be less than max duration",
  "videos": [],
  "total_found": 0
}
```

## 日志记录

### 1. 用户操作日志

```javascript
// 预设选择日志
logger.userAction('YouTube时长预设选择', 'durationPresetSelect', {
  preset: 'under_5min',
  activeLibrary: 'youtube'
});

// 自定义范围日志
logger.userAction('YouTube自定义时间范围变化', 'durationRangeChange', {
  range: { minDuration: 60, maxDuration: 240 },
  wasPresetRange: false,
  currentPreset: 'custom',
  activeLibrary: 'youtube'
});
```

### 2. API调用日志

```javascript
// 搜索请求日志
logger.apiCall('开始Youtube视频搜索流程', '/api/youtube/search', {
  query: 'nature',
  maxVideos: 20,
  orientation: 'landscape',
  minDuration: 0,
  maxDuration: 300,
  hasDurationFilter: true
});
```

### 3. 错误日志

```javascript
// 参数验证错误
logger.error('Youtube视频搜索时间参数验证失败', new Error(error), {
  minDuration: -10,
  maxDuration: 300,
  reason: 'negative_duration'
});
```

## UI组件

### 1. 时间范围选择器

- **位置**：搜索控制区，仅在YouTube视频库激活时显示
- **样式**：与现有控件保持一致的Apple风格设计
- **交互**：支持预设选择和自定义输入
- **验证**：实时验证用户输入的时间范围

### 2. 自定义时间输入

- **显示条件**：仅在选择"自定义"预设时显示
- **输入控件**：两个数字输入框（最小秒数、最大秒数）
- **验证**：最小值≥0，最大值>最小值
- **样式**：紧凑的输入框设计，适配搜索栏布局

## 技术实现细节

### 1. 状态管理

- 使用React useState管理时间范围状态
- 预设变化时自动更新时间范围
- 自定义输入时自动切换到custom预设

### 2. 性能优化

- 使用useCallback优化事件处理函数
- 合理的依赖数组避免不必要的重渲染
- 防抖处理用户输入（如需要）

### 3. 错误处理

- 前端参数验证
- 后端API错误响应处理
- 用户友好的错误提示

## 兼容性说明

- 该功能仅适用于YouTube视频库
- 官方视频库保持原有搜索逻辑不变
- 向后兼容：不传递时间参数时使用默认行为
- 前端优雅降级：API不支持时间参数时正常工作

## 更新日志

### v1.0.0 (2024-12-19)

- ✅ 添加YouTube视频搜索时间范围过滤功能
- ✅ 实现预设时间范围选择（1分钟、3分钟、5分钟、10分钟）
- ✅ 支持自定义时间范围输入
- ✅ 添加完整的参数验证和错误处理
- ✅ 实现详细的用户操作日志记录
- ✅ 更新前端UI组件支持时间过滤
- ✅ 扩展相关TypeScript类型定义

---

**维护者**: AI Assistant  
**最后更新**: 2024年12月19日  
**版本**: v1.0.0 