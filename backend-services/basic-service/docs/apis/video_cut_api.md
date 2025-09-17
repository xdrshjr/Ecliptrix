# Video Cut API Documentation

## Overview
The Video Cut API provides functionality to cut video clips from a source video and upload them to Supabase storage with optional thumbnail generation.

## Base URL
```
POST /api/video/cut
```

## Request Model

### VideoCutRequest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| task_id | string | Yes | Task ID for tracking and logging |
| video_url | string | Yes | URL of the source video to cut (local path or remote URL) |
| clips | VideoCutClipRequest[] | Yes | List of clips to cut from the video |
| generate_thumbnails | boolean | No | Whether to generate thumbnails for cut clips (default: true) |

### VideoCutClipRequest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the clip |
| name | string | Yes | Display name of the clip |
| start_time | float | Yes | Start time in seconds within the original video |
| end_time | float | Yes | End time in seconds within the original video |
| duration | float | Yes | Duration of the clip in seconds |

## Response Model

### VideoCutResponse

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the operation was successful |
| message | string | Response message |
| clips | VideoCutClipResult[] | List of cut and uploaded video clips |
| total_clips | integer | Total number of clips processed successfully |
| processing_time | float | Total processing time in seconds |

### VideoCutClipResult

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the clip |
| name | string | Display name of the clip |
| video_url | string | URL of the uploaded video clip |
| thumbnail_url | string | URL of the video thumbnail (if generated) |
| file_size | integer | File size in bytes |
| duration | float | Duration of the clip in seconds |
| width | integer | Video width in pixels |
| height | integer | Video height in pixels |
| format | string | Video format (e.g., mp4) |

## Example Request

```json
{
  "task_id": "cut_task_123",
  "video_url": "https://example.com/source-video.mp4",
  "clips": [
    {
      "id": "clip_1",
      "name": "Opening Scene",
      "start_time": 0.0,
      "end_time": 30.0,
      "duration": 30.0
    },
    {
      "id": "clip_2", 
      "name": "Main Content",
      "start_time": 60.0,
      "end_time": 120.0,
      "duration": 60.0
    }
  ],
  "generate_thumbnails": true
}
```

## Example Response

```json
{
  "success": true,
  "message": "Successfully cut and uploaded 2 video clips",
  "clips": [
    {
      "id": "clip_1",
      "name": "Opening Scene",
      "video_url": "https://supabase.example.com/storage/v1/object/public/videos/cut_task_123_clip_1.mp4",
      "thumbnail_url": "https://supabase.example.com/storage/v1/object/public/thumbnails/cut_task_123_clip_1.jpg",
      "file_size": 5242880,
      "duration": 30.0,
      "width": 1920,
      "height": 1080,
      "format": "mp4"
    },
    {
      "id": "clip_2",
      "name": "Main Content", 
      "video_url": "https://supabase.example.com/storage/v1/object/public/videos/cut_task_123_clip_2.mp4",
      "thumbnail_url": "https://supabase.example.com/storage/v1/object/public/thumbnails/cut_task_123_clip_2.jpg",
      "file_size": 10485760,
      "duration": 60.0,
      "width": 1920,
      "height": 1080,
      "format": "mp4"
    }
  ],
  "total_clips": 2,
  "processing_time": 25.3
}
```

## Error Responses

### Validation Errors (400)
```json
{
  "success": false,
  "message": "At least one clip must be specified",
  "clips": [],
  "total_clips": 0,
  "processing_time": 0.0
}
```

### Processing Errors (500)
```json
{
  "success": false,
  "message": "Video cutting failed: Failed to download video",
  "clips": [],
  "total_clips": 0,
  "processing_time": 5.2
}
```

## Implementation Notes

1. **Video Download**: If the source video is a remote URL, it will be downloaded to a temporary location first
2. **Clip Cutting**: Uses FFmpeg to extract video clips with precise timing
3. **Upload Process**: Each cut clip is uploaded to Supabase storage
4. **Thumbnail Generation**: Optional thumbnails are generated for each clip
5. **Cleanup**: Temporary files are cleaned up after processing
6. **Error Handling**: Individual clip failures don't stop processing of other clips

## Dependencies

- FFmpeg (for video cutting and analysis)
- curl (for video download)
- Supabase service (for file upload)

## Performance Considerations

- Processing time depends on video size and number of clips
- Large videos may take longer to download and process
- Multiple clips are processed sequentially for stability
- Temporary storage space is required during processing 