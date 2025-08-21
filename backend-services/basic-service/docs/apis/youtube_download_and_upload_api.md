# YouTube Download and Upload API

## Overview

The YouTube Download and Upload API provides functionality to download YouTube videos and automatically upload them to Supabase storage in a single operation. This is particularly useful for video editing workflows where YouTube videos need to be processed and stored for further use.

## Base URL

```
/api/youtube
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Download and Upload YouTube Video

**POST** `/download-and-upload`

Download a YouTube video and automatically upload it to Supabase storage bucket.

#### Request

**Content-Type**: `application/json`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | YouTube video URL (youtube.com or youtu.be) |
| `task_id` | string | No | Task ID associated with the video |
| `video_quality` | string | No | Video quality (default: "720p") |
| `audio_quality` | string | No | Audio quality (default: "best") |
| `format_type` | string | No | Output format (default: "mp4") |
| `generate_thumbnail` | boolean | No | Whether to generate thumbnail (default: true) |
| `custom_filename` | string | No | Custom filename for the uploaded file |

#### Request Example

```bash
curl -X POST "http://localhost:8000/api/youtube/download-and-upload" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "task_id": "task-123",
    "video_quality": "720p",
    "format_type": "mp4",
    "generate_thumbnail": true
  }'
```

#### Response

**Success Response (200 OK):**

```json
{
  "success": true,
  "message": "YouTube视频下载并上传成功",
  "video_url": "https://supabase-url/storage/v1/object/public/bucket/video/youtube/2024/01/15/task-123/youtube_video_20240115_143022.mp4",
  "thumbnail_url": null,
  "file_size": 15728640,
  "duration": null,
  "width": null,
  "height": null,
  "original_youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Error Response (400 Bad Request):**

```json
{
  "success": false,
  "message": "视频URL不能为空",
  "error": "视频URL不能为空",
  "original_youtube_url": null
}
```

**Error Response (500 Internal Server Error):**

```json
{
  "success": false,
  "message": "下载并上传过程中发生错误",
  "error": "YouTube视频下载失败: Video not available",
  "original_youtube_url": "https://www.youtube.com/watch?v=invalid"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the operation was successful |
| `message` | string | Human-readable message |
| `video_url` | string | Supabase public URL of the uploaded video |
| `thumbnail_url` | string | Supabase public URL of the thumbnail (if generated) |
| `file_size` | number | File size in bytes |
| `duration` | number | Video duration in seconds (currently null) |
| `width` | number | Video width in pixels (currently null) |
| `height` | number | Video height in pixels (currently null) |
| `original_youtube_url` | string | Original YouTube URL |
| `error` | string | Error message (only present when success is false) |

## Usage Examples

### Frontend Integration

```typescript
// Example usage in a React component
const downloadAndUploadVideo = async (youtubeUrl: string, taskId: string) => {
  try {
    const response = await fetch('/api/youtube/download-and-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: youtubeUrl,
        task_id: taskId,
        video_quality: '720p',
        format_type: 'mp4'
      }),
    });

    const result = await response.json();

    if (result.success) {
      console.log('Video uploaded to:', result.video_url);
      // Update material with the new URL
      updateMaterial({
        url: result.video_url,
        downloadStatus: 'completed'
      });
    } else {
      console.error('Download failed:', result.error);
      // Update material with error status
      updateMaterial({
        downloadStatus: 'error',
        downloadError: result.error
      });
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
};
```

### Video Editing Workflow

1. **Search YouTube Videos**: Use the `/search` endpoint to find videos
2. **Add to Materials**: Add selected videos to the materials panel with `downloading` status
3. **Auto Download**: Trigger this endpoint to download and upload videos
4. **Update Status**: Update material status to `completed` or `error` based on response
5. **Enable Dragging**: Allow users to drag completed videos to timeline

## Error Handling

The API provides detailed error information for common scenarios:

- **Invalid URL**: Returns 400 with validation error
- **YouTube Download Failure**: Returns 500 with YouTube-specific error
- **Supabase Upload Failure**: Returns 500 with upload-specific error
- **File System Errors**: Returns 500 with file operation errors

## Performance Considerations

- **Async Operation**: The download and upload process is asynchronous
- **File Cleanup**: Temporary downloaded files are automatically cleaned up
- **Quality Settings**: Lower quality settings result in faster downloads and smaller files
- **Timeout**: Large videos may take several minutes to process

## Security Notes

- Only YouTube URLs are accepted (youtube.com and youtu.be domains)
- File paths are sanitized to prevent directory traversal
- Temporary files are stored securely and cleaned up after upload
- No user authentication is currently required (consider adding for production use)

## Related Endpoints

- `POST /search` - Search YouTube videos
- `POST /info` - Get YouTube video information
- `POST /download` - Download YouTube video only (without upload)
- `POST /api/supabase/upload-video` - Upload video file to Supabase 