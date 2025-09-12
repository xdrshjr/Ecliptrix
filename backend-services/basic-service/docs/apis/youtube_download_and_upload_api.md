# YouTube Video Download and Upload API

## Overview

The YouTube Video Download and Upload API provides functionality to download YouTube videos and automatically upload them to Supabase storage with complete metadata extraction and thumbnail generation. The API features **concurrent processing** (up to 5 simultaneous downloads) and **automatic retry mechanisms** (up to 3 retries with exponential backoff) for enhanced reliability and performance.

## Base URL

```
/api/youtube
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Download and Upload YouTube Video

**POST** `/download-and-upload`

Download a YouTube video and automatically upload it to Supabase storage with metadata extraction and thumbnail generation. Features concurrent processing control and automatic retry mechanisms for enhanced reliability.

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

### Concurrent Processing Control
- **Configurable Concurrency**: Maximum concurrent downloads configurable via `config/youtube.yaml` (default: 20)
- **Queue Management**: Requests exceeding the limit are queued and processed as slots become available
- **Resource Protection**: Prevents system overload from too many concurrent operations
- **Dynamic Configuration**: Concurrency settings can be adjusted without code changes

### Download Process with Retry Logic
1. **Concurrency Check**: Acquire download slot (configurable, default: 20 concurrent)
2. **Video Download**: Downloads the YouTube video using yt-dlp with specified quality settings
3. **Metadata Extraction**: Uses ffprobe to extract video metadata (duration, dimensions, etc.)
4. **Video Upload**: Uploads the video file to Supabase storage
5. **Thumbnail Generation**: Generates a thumbnail image at the middle of the video using ffmpeg
6. **Thumbnail Upload**: Uploads the thumbnail to Supabase storage
7. **Cleanup**: Removes temporary files
8. **Response**: Returns complete video information including Supabase URLs

### Retry Mechanism
- **Configurable Retries**: Retry attempts configurable via `config/youtube.yaml` (default: 3)
- **Configurable Delays**: Base retry delay configurable (default: 5s)
- **Exponential Backoff**: Delay increases exponentially with random jitter
- **Smart Recovery**: Retries entire process on any step failure
- **Detailed Logging**: Each retry attempt is logged with failure reason and remaining attempts

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

The API handles various error scenarios with automatic retry mechanisms:

- **Invalid YouTube URL**: Returns 400 Bad Request (no retry)
- **Download Failure**: Automatically retries up to 3 times with exponential backoff
- **Upload Failure**: Automatically retries up to 3 times with exponential backoff
- **Metadata Extraction Failure**: Continues without metadata, logs warning
- **Thumbnail Generation Failure**: Continues without thumbnail, logs warning
- **Concurrency Limit**: Requests wait in queue until a download slot becomes available
- **Persistent Failures**: After all retries are exhausted, returns detailed error information

## Dependencies

- **yt-dlp**: For YouTube video downloading
- **ffprobe**: For video metadata extraction
- **ffmpeg**: For thumbnail generation
- **Supabase**: For file storage

## Logging

The API provides comprehensive logging for:

### Concurrency and Queue Management
- Semaphore status (available slots, waiting queue length)
- Download slot acquisition and release
- Current concurrency levels

### Process Execution
- Step-by-step timing information for each process stage
- Download progress and completion with file sizes
- Metadata extraction results and timing
- Upload progress and completion with URLs
- Thumbnail generation and upload with timing

### Retry Logic
- Each retry attempt with attempt number and total attempts
- Failure reasons for each retry
- Exponential backoff delay calculations
- Final failure after all retries exhausted

### Performance Metrics
- Total execution time for complete process
- Individual step timing (download, metadata, upload, thumbnail)
- File size and video metadata information
- Error conditions and cleanup operations

## Concurrency Control

### Built-in Concurrency Management
- **Configurable Concurrent Downloads**: Simultaneous video downloads (default: 20, configurable via `config/youtube.yaml`)
- **Automatic Queue Management**: Requests exceeding the limit are automatically queued
- **Fair Processing**: Requests are processed in the order they acquire download slots
- **Resource Protection**: Prevents system overload from excessive concurrent operations

### Rate Limiting
Currently, no additional rate limiting is implemented beyond the concurrency control. Consider implementing rate limiting for production use to prevent abuse.

## Configuration

The API behavior can be customized via `config/youtube.yaml`:

### Download Configuration
```yaml
download:
  # Maximum concurrent downloads (default: 20)
  max_concurrent_downloads: 20
  
  # Download timeout in seconds (default: 300)
  download_timeout: 300
  
  # Maximum retry attempts (default: 3)
  max_retries: 3
  
  # Retry delay in seconds (default: 5)
  retry_delay: 5
```

### Upload Configuration
```yaml
upload:
  # Upload timeout in seconds (default: 600)
  upload_timeout: 600
  
  # Maximum retry attempts (default: 3)
  max_retries: 3
  
  # Retry delay in seconds (default: 10)
  retry_delay: 10
```

### Quality Configuration
```yaml
quality:
  # Default video quality (default: "720p")
  default_video_quality: "720p"
  
  # Default audio quality (default: "best")
  default_audio_quality: "best"
  
  # Default output format (default: "mp4")
  default_format: "mp4"
```

### File Management Configuration
```yaml
file_management:
  # Auto cleanup temporary files (default: true)
  auto_cleanup: true
  
  # Temporary file retention hours (default: 24)
  temp_file_retention_hours: 24
  
  # Generate thumbnails (default: true)
  generate_thumbnail: true
```

## Security Considerations

- Validate YouTube URLs to prevent SSRF attacks
- Implement file size limits to prevent abuse
- Consider implementing authentication for production use
- Monitor disk usage for temporary files
- **Concurrency limits** provide natural protection against DoS attacks
- **Retry mechanisms** include jitter to prevent thundering herd problems
- Monitor system resources when running at maximum concurrency

## Performance Characteristics

### Concurrency Benefits
- **Improved Throughput**: Up to 5x faster processing when downloading multiple videos
- **Better Resource Utilization**: Efficient use of network and CPU resources
- **Scalable Processing**: Handles batch requests efficiently

### Retry Benefits
- **Enhanced Reliability**: Automatic recovery from temporary network issues
- **Reduced Manual Intervention**: Handles transient errors automatically
- **Smart Backoff**: Prevents overwhelming services during temporary outages

### Best Practices for Multiple Downloads
1. **Batch Processing**: Send multiple requests simultaneously for best performance
2. **Monitor Logs**: Use detailed logging to track progress and identify issues
3. **Handle Timeouts**: Allow sufficient time for retries in client applications
4. **Resource Monitoring**: Monitor server resources when processing at maximum concurrency

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

### Batch Download Example

```javascript
// Example: Download multiple YouTube videos concurrently
async function downloadMultipleVideos(videoUrls, taskId) {
  console.log(`Starting concurrent download of ${videoUrls.length} videos...`);
  
  // Create promises for all downloads (will be processed with max 5 concurrent)
  const downloadPromises = videoUrls.map((url, index) => 
    downloadAndUploadYouTubeVideo(url, `${taskId}-${index}`)
      .then(result => ({ url, index, result }))
      .catch(error => ({ url, index, error: error.message }))
  );
  
  // Wait for all downloads to complete
  const results = await Promise.all(downloadPromises);
  
  // Process results
  const successful = results.filter(r => r.result && r.result.success);
  const failed = results.filter(r => r.error || (r.result && !r.result.success));
  
  console.log(`Batch download completed: ${successful.length} successful, ${failed.length} failed`);
  
  return { successful, failed, total: results.length };
}

// Usage
const videoUrls = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=oHg5SJYRHA0',
  'https://www.youtube.com/watch?v=iik25wqIuFo'
];

downloadMultipleVideos(videoUrls, 'batch-task-123')
  .then(results => console.log('Batch results:', results));
``` 