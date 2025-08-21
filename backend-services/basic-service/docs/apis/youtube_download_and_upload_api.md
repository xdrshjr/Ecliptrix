# YouTube Video Download and Upload API

## Overview

The YouTube Video Download and Upload API provides functionality to download YouTube videos and automatically upload them to Supabase storage with complete metadata extraction and thumbnail generation.

## Base URL

```
/api/youtube
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Download and Upload YouTube Video

**POST** `/download-and-upload`

Download a YouTube video and automatically upload it to Supabase storage with metadata extraction and thumbnail generation.

#### Request

**Content-Type**: `application/json`

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | - | YouTube video URL (youtube.com or youtu.be) |
| `task_id` | string | No | null | Task ID associated with the video |
| `video_quality` | string | No | "720p" | Video quality (720p, 1080p, etc.) |
| `audio_quality` | string | No | "best" | Audio quality setting |
| `format_type` | string | No | "mp4" | Output video format |
| `generate_thumbnail` | boolean | No | true | Whether to generate thumbnail |
| `custom_filename` | string | No | null | Custom filename for the uploaded file |

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
  "video_url": "https://supabase-url/storage/v1/object/public/bucket/video/youtube/2024/01/15/task-123/youtube_video_title.mp4",
  "thumbnail_url": "https://supabase-url/storage/v1/object/public/bucket/video/youtube/2024/01/15/task-123/thumb_youtube_video_title.jpg",
  "file_size": 15728640,
  "duration": 210.5,
  "width": 1280,
  "height": 720,
  "original_youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Error Response (400 Bad Request):**

```json
{
  "success": false,
  "message": "YouTube视频下载失败",
  "error": "Invalid YouTube URL format",
  "original_youtube_url": "https://invalid-url.com"
}
```

**Error Response (500 Internal Server Error):**

```json
{
  "success": false,
  "message": "下载并上传过程中发生错误",
  "error": "Network timeout during download",
  "original_youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the operation was successful |
| `message` | string | Human-readable message describing the result |
| `video_url` | string | Supabase URL of the uploaded video (if successful) |
| `thumbnail_url` | string | Supabase URL of the generated thumbnail (if successful and generated) |
| `file_size` | integer | File size in bytes (if successful) |
| `duration` | float | Video duration in seconds (if metadata extraction successful) |
| `width` | integer | Video width in pixels (if metadata extraction successful) |
| `height` | integer | Video height in pixels (if metadata extraction successful) |
| `original_youtube_url` | string | Original YouTube URL that was processed |
| `error` | string | Error message (if unsuccessful) |

## Process Flow

1. **Video Download**: Downloads the YouTube video using yt-dlp with specified quality settings
2. **Metadata Extraction**: Uses ffprobe to extract video metadata (duration, dimensions, etc.)
3. **Video Upload**: Uploads the video file to Supabase storage
4. **Thumbnail Generation**: Generates a thumbnail image at the middle of the video using ffmpeg
5. **Thumbnail Upload**: Uploads the thumbnail to Supabase storage
6. **Cleanup**: Removes temporary files
7. **Response**: Returns complete video information including Supabase URLs

## File Organization

Videos are organized in Supabase storage with the following structure:

```
video/youtube/YYYY/MM/DD/task-{task_id}/filename.mp4
video/youtube/YYYY/MM/DD/task-{task_id}/thumb_filename.jpg
```

If no task_id is provided:

```
video/youtube/YYYY/MM/DD/filename.mp4
video/youtube/YYYY/MM/DD/thumb_filename.jpg
```

## Error Handling

The API handles various error scenarios:

- **Invalid YouTube URL**: Returns 400 Bad Request
- **Download Failure**: Returns error with download failure details
- **Upload Failure**: Returns error with Supabase upload failure details
- **Metadata Extraction Failure**: Continues without metadata, logs warning
- **Thumbnail Generation Failure**: Continues without thumbnail, logs warning

## Dependencies

- **yt-dlp**: For YouTube video downloading
- **ffprobe**: For video metadata extraction
- **ffmpeg**: For thumbnail generation
- **Supabase**: For file storage

## Logging

The API provides detailed logging for:

- Download progress and completion
- Metadata extraction results
- Upload progress and completion
- Thumbnail generation and upload
- Error conditions and cleanup operations

## Rate Limiting

Currently, no rate limiting is implemented. Consider implementing rate limiting for production use.

## Security Considerations

- Validate YouTube URLs to prevent SSRF attacks
- Implement file size limits to prevent abuse
- Consider implementing authentication for production use
- Monitor disk usage for temporary files

## Example Integration

### Frontend JavaScript

```javascript
async function downloadAndUploadYouTubeVideo(youtubeUrl, taskId) {
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
        generate_thumbnail: true
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('Video uploaded successfully:', result.video_url);
      console.log('Thumbnail URL:', result.thumbnail_url);
      console.log('Video metadata:', {
        duration: result.duration,
        width: result.width,
        height: result.height,
        size: result.file_size
      });
    } else {
      console.error('Upload failed:', result.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
}
```

### Python Client

```python
import requests

def download_and_upload_youtube_video(youtube_url, task_id=None):
    url = "http://localhost:8000/api/youtube/download-and-upload"
    
    payload = {
        "url": youtube_url,
        "task_id": task_id,
        "video_quality": "720p",
        "generate_thumbnail": True
    }
    
    response = requests.post(url, json=payload)
    result = response.json()
    
    if result["success"]:
        print(f"Video uploaded: {result['video_url']}")
        print(f"Thumbnail: {result['thumbnail_url']}")
        print(f"Duration: {result['duration']}s")
        print(f"Resolution: {result['width']}x{result['height']}")
    else:
        print(f"Error: {result['error']}")
    
    return result
``` 