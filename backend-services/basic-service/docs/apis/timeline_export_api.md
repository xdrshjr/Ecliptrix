# Timeline Export API Documentation

## Overview

The Timeline Export API provides functionality to export video editing timeline data to JSON format. This includes all track information, material data, editing details, and timing information, allowing users to backup, share, or transfer their video editing projects.

## Base URL

```
http://localhost:8000/api/timeline
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Export Timeline to JSON

**Endpoint:** `POST /export`

**Description:** Export timeline editing data including tracks, materials, and all editing information to a JSON file.

#### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "task_id": "string",
  "timeline_state": {
    "current_time": 0.0,
    "total_duration": 120.5,
    "zoom_level": 1.0,
    "selected_items": ["item1", "item2"],
    "tracks": [
      {
        "id": "video-track-1",
        "name": "视频轨道",
        "type": "video",
        "height": 80,
        "is_locked": false,
        "is_muted": false,
        "is_visible": true,
        "volume": 100.0,
        "order": 0,
        "items": [
          {
            "id": "item1",
            "name": "视频片段1",
            "type": "video",
            "start_time": 0.0,
            "duration": 30.0,
            "track_id": "video-track-1",
            "color": "#3B82F6",
            "thumbnail_url": "http://example.com/thumb.jpg",
            "material_id": "material1",
            "volume": 0.8,
            "opacity": 1.0,
            "is_selected": false,
            "clip_start": 5.0,
            "clip_end": 35.0,
            "original_duration": 60.0,
            "original_material_type": "video"
          }
        ]
      }
    ],
    "playback_rate": 1.0,
    "is_playing": false,
    "snap_to_grid": true,
    "grid_size": 0.5,
    "scroll_left": 0.0
  },
  "materials": [
    {
      "id": "material1",
      "name": "示例视频.mp4",
      "type": "video",
      "format": "mp4",
      "size": 1048576,
      "duration": 60.0,
      "width": 1920,
      "height": 1080,
      "thumbnail_url": "http://example.com/thumb.jpg",
      "url": "http://example.com/video.mp4",
      "server_url": "http://server.com/video.mp4",
      "created_at": "2024-01-01T12:00:00Z",
      "tags": ["video", "demo"],
      "description": "这是一个示例视频，展示了产品的主要功能",
      "metadata": {
        "originalUrl": "http://youtube.com/watch?v=123",
        "fileName": "demo_video.mp4",
        "isLocalFile": false
      }
    }
  ],
  "export_data": null
}
```

#### Response

**Success (200):**
```json
{
  "success": true,
  "message": "时间轴数据导出成功",
  "file_name": "timeline_export_task123_20241201_143052.json",
  "download_url": "/static/timeline_exports/timeline_export_task123_20241201_143052.json",
  "data": {
    "metadata": {
      "exported_at": "2024-12-01T14:30:52.123456",
      "version": "1.0.0",
      "task_id": "task123",
      "total_duration": 120.5,
      "track_count": 3,
      "item_count": 5
    },
    "timeline": {
      "current_time": 0.0,
      "total_duration": 120.5,
      "zoom_level": 1.0,
      "selected_items": ["item1", "item2"],
      "playback_rate": 1.0,
      "is_playing": false,
      "snap_to_grid": true,
      "grid_size": 0.5,
      "scroll_left": 0.0
    },
    "tracks": [...],
    "materials": [...]
  },
  "details": {
    "file_size": 2048,
    "export_timestamp": "2024-12-01T14:30:52.123456",
    "track_count": 3,
    "material_count": 2
  }
}
```

**Error (400):**
```json
{
  "success": false,
  "message": "请求验证失败: 任务ID不能为空",
  "details": {
    "validation_error": "任务ID不能为空"
  }
}
```

**Error (500):**
```json
{
  "success": false,
  "message": "服务器内部错误: 文件写入失败",
  "error_type": "IOError"
}
```

### 2. Download Exported File

**Endpoint:** `GET /export/download/{file_name}`

**Description:** Download a previously exported timeline JSON file.

#### Parameters

- `file_name` (path parameter): Name of the exported file to download

#### Response

**Success (200):** Returns the JSON file as a download

**Error (400):**
```json
{
  "detail": "无效的文件名格式"
}
```

**Error (404):**
```json
{
  "detail": "请求的文件不存在"
}
```

**Error (403):**
```json
{
  "detail": "文件访问被拒绝"
}
```

### 3. Cleanup Old Exports

**Endpoint:** `DELETE /export/cleanup`

**Description:** Clean up old exported files to manage storage space.

#### Query Parameters

- `max_age_hours` (optional): Maximum age in hours for files to keep (default: 24)

#### Response

**Success (200):**
```json
{
  "success": true,
  "message": "成功清理了 3 个过期文件",
  "cleaned_count": 3,
  "max_age_hours": 24
}
```

## Data Models

### TimelineState

| Field | Type | Description |
|-------|------|-------------|
| current_time | float | 当前播放时间（秒） |
| total_duration | float | 总时长（秒） |
| zoom_level | float | 缩放级别 (0.1 - 5.0) |
| selected_items | array | 选中的项目ID数组 |
| tracks | array | 轨道列表 |
| playback_rate | float | 播放速度 |
| is_playing | boolean | 是否正在播放 |
| snap_to_grid | boolean | 是否吸附到网格 |
| grid_size | float | 网格大小（秒） |
| scroll_left | float | 水平滚动位置（像素） |

### Track

| Field | Type | Description |
|-------|------|-------------|
| id | string | 轨道唯一标识符 |
| name | string | 轨道名称 |
| type | string | 轨道类型：video, audio, subtitle |
| height | integer | 轨道高度（像素） |
| is_locked | boolean | 是否锁定 |
| is_muted | boolean | 是否静音 |
| is_visible | boolean | 是否可见 |
| volume | float | 音量大小（0-200） |
| order | integer | 轨道顺序 |
| items | array | 轨道中的项目列表 |

### TimelineItem

| Field | Type | Description |
|-------|------|-------------|
| id | string | 项目唯一标识符 |
| name | string | 项目名称 |
| type | string | 项目类型：video, audio, subtitle |
| start_time | float | 开始时间（秒） |
| duration | float | 持续时间（秒） |
| track_id | string | 所属轨道ID |
| color | string | 显示颜色 |
| thumbnail_url | string | 缩略图URL（可选） |
| waveform_data | array | 波形数据（可选） |
| text | string | 文本内容（字幕用，可选） |
| material_id | string | 关联的素材ID（可选） |
| volume | float | 音量 (0-1)（可选） |
| opacity | float | 透明度 (0-1)（可选） |
| is_selected | boolean | 是否选中（可选） |
| clip_start | float | 原始素材中的开始时间（秒）（可选） |
| clip_end | float | 原始素材中的结束时间（秒）（可选） |
| original_duration | float | 原始素材的总时长（秒）（可选） |
| original_material_type | string | 原始素材类型（可选） |
| subtitle_style | object | 字幕样式（可选） |
| image_position | object | 图片位置信息（可选） |

### Material

| Field | Type | Description |
|-------|------|-------------|
| id | string | 素材唯一标识符 |
| name | string | 素材名称 |
| type | string | 素材类型 |
| format | string | 文件格式 |
| size | integer | 文件大小（字节） |
| duration | float | 时长（秒）（可选） |
| width | integer | 宽度（像素）（可选） |
| height | integer | 高度（像素）（可选） |
| thumbnail_url | string | 缩略图URL（可选） |
| url | string | 文件URL |
| server_url | string | 服务器文件URL（可选） |
| created_at | string | 创建时间ISO字符串 |
| tags | array | 标签列表（可选） |
| description | string | 描述信息（可选） |
| metadata | object | 额外元数据（可选） |

## Export Data Structure

The exported JSON file contains the following structure:

```json
{
  "metadata": {
    "exported_at": "2024-12-01T14:30:52.123456",
    "version": "1.0.0",
    "task_id": "task123",
    "total_duration": 120.5,
    "track_count": 3,
    "item_count": 5
  },
  "timeline": {
    // Timeline state data
  },
  "tracks": [
    // Array of track data with items
  ],
  "materials": [
    // Array of material data including descriptions
  ]
}
```

## Usage Examples

### Basic Export

```bash
curl -X POST "http://localhost:8000/api/timeline/export" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "my-project-123",
    "timeline_state": {
      "current_time": 0,
      "total_duration": 60,
      "zoom_level": 1.0,
      "selected_items": [],
      "tracks": [
        {
          "id": "video-track-1",
          "name": "视频轨道",
          "type": "video",
          "height": 80,
          "is_locked": false,
          "is_muted": false,
          "is_visible": true,
          "volume": 100,
          "order": 0,
          "items": []
        }
      ],
      "playback_rate": 1.0,
      "is_playing": false,
      "snap_to_grid": true,
      "grid_size": 0.5,
      "scroll_left": 0
    },
    "materials": []
  }'
```

### Download Exported File

```bash
curl -X GET "http://localhost:8000/api/timeline/export/download/timeline_export_task123_20241201_143052.json" \
  -o "my_timeline_backup.json"
```

### Cleanup Old Files

```bash
curl -X DELETE "http://localhost:8000/api/timeline/export/cleanup?max_age_hours=48"
```

## Error Handling

The API uses standard HTTP status codes and returns structured error responses:

- **400 Bad Request**: Invalid request data or validation errors
- **403 Forbidden**: File access denied
- **404 Not Found**: Requested file not found
- **500 Internal Server Error**: Server processing errors

All error responses include:
- `success`: Always `false` for errors
- `message`: Human-readable error description
- `details`: Additional error information (optional)

## Security Considerations

1. **File Access**: Only files with the `timeline_export_` prefix can be downloaded
2. **Path Traversal**: File paths are validated to prevent directory traversal attacks
3. **File Cleanup**: Automatic cleanup prevents storage abuse
4. **CORS**: Configure CORS settings appropriately for production use

## Rate Limiting

Currently, no rate limiting is implemented. Consider adding rate limiting for production deployments to prevent abuse.

## File Storage

- Exported files are stored in `static/timeline_exports/` directory
- Files are automatically cleaned up after 24 hours by default
- File naming format: `timeline_export_{task_id}_{timestamp}.json`

## Version History

- **v1.0.0**: Initial release with basic timeline export functionality