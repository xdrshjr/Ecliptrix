# Video Cut API Documentation

## Overview
The Video Cut API provides functionality to cut video clips from a source video and upload them to Supabase storage with optional thumbnail generation. The service uses FFmpeg with precise frame positioning and re-encoding to avoid playback issues like initial frame freezing.

## Base URL
```
POST /api/video/cut
```

## Key Features
- **Frame-Perfect Cutting**: Uses FFmpeg re-encoding to ensure clips start with keyframes, eliminating playback stuttering
- **Optimized for Web**: Outputs use `faststart` flag for immediate web playback
- **Quality Preservation**: Uses CRF 23 encoding for optimal balance between quality and file size
- **Detailed Logging**: Comprehensive logging for monitoring and debugging
- **Robust Error Handling**: Continues processing other clips even if individual clips fail

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

## Technical Details

### Video Processing Pipeline
1. **Source Video**: Downloaded if remote URL, validated if local path
2. **Video Analysis**: FFprobe extracts metadata (dimensions, duration, format)
3. **Clip Cutting**: FFmpeg with dual-seek method for frame-accurate cutting
4. **Re-encoding**: H.264/AAC encoding ensures keyframe alignment and web compatibility
5. **Upload**: Processed clips uploaded to Supabase with organized paths
6. **Cleanup**: Temporary files removed after successful upload

### FFmpeg Configuration
- **Video Codec**: libx264 with CRF 23 for optimal quality/size balance
- **Audio Codec**: AAC for universal compatibility
- **Preset**: Medium for balanced encoding speed and quality
- **Web Optimization**: `movflags +faststart` for immediate streaming
- **Seeking**: Double-seek method (`-ss` before and after `-i`) for precision

### Thumbnail Generation
- **Timing**: Extract at min(0.5s, duration/4) to avoid black frames
- **Quality**: JPEG with q:v 2 (high quality)
- **Format**: Standard JPEG for universal browser support
- **Fallback**: Continues processing if thumbnail generation fails

## Common Issues and Solutions

### ✅ FIXED: Video Stuttering at Start
**Previous Issue**: Clips had 1-2 second freeze/stutter at beginning  
**Root Cause**: Stream copying (`-c copy`) without keyframe alignment  
**Solution**: Re-encoding ensures clips start with I-frames, eliminating stuttering  
**Status**: Resolved in current implementation

### Issue: Long Processing Times
**Cause**: Re-encoding is more thorough than stream copying  
**Mitigation**: 
- Optimized encoding parameters (medium preset)
- Efficient dual-seek method reduces unnecessary processing
- Parallel processing where possible

### Issue: Large Output Files
**Solution**: CRF 23 provides optimal balance (typically 80-90% of source size)  
**Alternative**: Adjust CRF value in service configuration if needed

### Issue: Thumbnail Generation Failures
**Cause**: Some videos have black frames or issues at fixed positions  
**Solution**: Dynamic thumbnail timing based on clip duration  
**Fallback**: Video processing continues even if thumbnails fail

## Performance Expectations

| Metric | Typical Range | Notes |
|--------|---------------|-------|
| Processing Speed | 0.2-0.5x realtime | 10min video = 20-50min processing |
| Quality Loss | Minimal (CRF 23) | Near-lossless for most content |
| File Size | 80-90% of source | Depends on source compression |
| Success Rate | >95% for valid inputs | Individual clip failures don't stop batch |

## Monitoring and Debugging

### Log Levels
- **INFO**: Progress updates, timing, file sizes
- **DEBUG**: FFmpeg output, detailed processing steps
- **WARNING**: Non-critical failures (thumbnail generation, cleanup)
- **ERROR**: Critical failures that stop processing

### Key Metrics to Monitor
- Processing time per clip
- Upload success rates
- Temporary storage usage
- FFmpeg error patterns 