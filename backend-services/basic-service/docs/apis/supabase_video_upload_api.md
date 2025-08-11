# Supabase Video Upload API

## Overview

The Supabase Video Upload API provides functionality to upload video files to Supabase storage with automatic thumbnail generation and metadata extraction.

## Base URL

```
/api/supabase
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Upload Video File

**POST** `/upload-video`

Upload a video file to Supabase storage bucket with optional thumbnail generation.

#### Request

**Content-Type**: `multipart/form-data`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | File | Yes | Video file to upload (accepts video/* MIME types) |
| `task_id` | string | No | Task ID associated with the video |
| `custom_filename` | string | No | Custom filename for the uploaded file |
| `generate_thumbnail` | boolean | No | Whether to generate thumbnail (default: true) |

#### Request Example

```bash
curl -X POST "http://localhost:8000/api/supabase/upload-video" \
  -F "file=@/path/to/video.mp4" \
  -F "task_id=task-123" \
  -F "custom_filename=my-video.mp4" \
  -F "generate_thumbnail=true"
```

#### Response

**Success Response (200 OK):**

```json
{
  "success": true,
  "message": "视频文件上传成功",
  "video_url": "https://example.supabase.co/storage/v1/object/sign/bucket/video/uploaded/2025/01/11/task-123/my-video_20250111_143022.mp4?token=...",
  "file_path": "video/uploaded/2025/01/11/task-123/my-video_20250111_143022.mp4",
  "file_size": 15728640,
  "duration": 30.5,
  "width": 1920,
  "height": 1080,
  "thumbnail_url": "https://example.supabase.co/storage/v1/object/sign/bucket/video/uploaded/2025/01/11/task-123/thumb_my-video_20250111_143022.jpg?token=...",
  "task_id": "task-123",
  "upload_time": "2025-01-11T14:30:22.123456",
  "metadata": {
    "original_filename": "video.mp4",
    "upload_time": "2025-01-11T14:30:22.123456",
    "file_size": 15728640,
    "width": 1920,
    "height": 1080,
    "duration": 30.5,
    "ffprobe_success": true
  }
}
```

**Error Response (400/500):**

```json
{
  "success": false,
  "message": "不支持的文件类型: text/plain",
  "error_code": "INVALID_FILE_TYPE"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the upload was successful |
| `message` | string | Response message |
| `video_url` | string | Signed URL of the uploaded video file |
| `file_path` | string | Path in Supabase bucket |
| `file_size` | integer | Size of the video file in bytes |
| `duration` | float | Duration of the video in seconds (if available) |
| `width` | integer | Video width in pixels (if available) |
| `height` | integer | Video height in pixels (if available) |
| `thumbnail_url` | string | URL of the generated thumbnail (if generated) |
| `task_id` | string | Task ID associated with the video |
| `upload_time` | datetime | Upload timestamp |
| `metadata` | object | Additional video metadata |

#### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_FILE_TYPE` | Uploaded file is not a video file |
| `UPLOAD_FAILED` | Failed to upload to Supabase |
| `INTERNAL_ERROR` | Internal server error |

## Features

### Automatic Metadata Extraction

The API automatically extracts video metadata using FFmpeg/FFprobe:
- Video duration
- Video dimensions (width, height)
- File format information

### Thumbnail Generation

When `generate_thumbnail=true` (default), the API:
- Generates a thumbnail image from the middle of the video
- Uploads the thumbnail to Supabase
- Returns the thumbnail URL in the response

### File Organization

Uploaded videos are organized in the following structure:
```
video/uploaded/{YYYY}/{MM}/{DD}/[task-{task_id}/]{filename}
```

Examples:
- Without task_id: `video/uploaded/2025/01/11/my-video_20250111_143022.mp4`
- With task_id: `video/uploaded/2025/01/11/task-123/my-video_20250111_143022.mp4`

## Dependencies

The video upload functionality requires:
- **FFmpeg**: For video metadata extraction and thumbnail generation
- **FFprobe**: For video information analysis

If FFmpeg is not available, the API will still upload the video but:
- Video metadata (duration, dimensions) will be null
- Thumbnail generation will be skipped
- A warning will be logged

## Usage Examples

### Upload Video with Thumbnail

```javascript
const formData = new FormData();
formData.append('file', videoFile);
formData.append('task_id', 'task-123');
formData.append('generate_thumbnail', 'true');

const response = await fetch('/api/supabase/upload-video', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Video URL:', result.video_url);
console.log('Thumbnail URL:', result.thumbnail_url);
```

### Upload Video without Thumbnail

```javascript
const formData = new FormData();
formData.append('file', videoFile);
formData.append('generate_thumbnail', 'false');

const response = await fetch('/api/supabase/upload-video', {
  method: 'POST',
  body: formData
});
```

## Integration with Frontend

This API is designed to work with the frontend material management system:

1. **Frontend uploads video** → `/upload-video` endpoint
2. **Backend processes and uploads** → Returns Supabase URLs
3. **Frontend downloads video** → Creates local blob URL
4. **Frontend creates MaterialItem** → Adds to materials panel

The response provides both:
- `video_url`: For downloading the video to create local blob
- `thumbnail_url`: For displaying thumbnail in the materials panel

## Logging

The API provides detailed logging for:
- Upload requests and parameters
- Video metadata extraction
- Thumbnail generation process
- Upload success/failure
- Error conditions and warnings

All logs include relevant context like filename, task_id, file size, and processing times. 