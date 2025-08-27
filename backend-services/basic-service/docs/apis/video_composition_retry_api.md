# Video Composition API with Enhanced Retry Mechanism

## Overview

The Video Composition API provides robust video composition functionality with enhanced retry mechanisms and detailed error reporting. This API is designed to handle video composition failures gracefully with comprehensive retry logic and informative error responses.

**Key Features:**
- **3-Retry Mechanism**: Individual video download and processing retry with exponential backoff
- **Strict Timeline Order**: Videos are processed in exact timeline order, no videos are lost
- **Detailed Error Tracking**: Comprehensive error details with specific failure reasons
- **Stage-by-Stage Processing**: Clear separation of download, normalization, and composition phases
- **Recovery Suggestions**: Actionable suggestions for resolving composition failures

## Base URL

```
http://localhost:8000/api/video
```

## Endpoints

### POST `/api/video/compose`

Composes a video from timeline data with enhanced retry mechanisms for individual video processing.

#### Retry Behavior

**Video Download Phase:**
- Up to 3 retry attempts for each video download failure
- Exponential backoff: 1s, 2s, 4s (capped at 10s)
- Detailed logging of each retry attempt
- Specific error tracking for each failed video

**Video Normalization Phase:**
- Up to 3 retry attempts for each video processing failure
- Same exponential backoff strategy
- FFmpeg error detection and recovery
- Format compatibility retry logic

**Error Handling:**
- Immediate failure if any video fails after all retries
- Detailed error response with specific failure information
- Timeline order preserved throughout retry attempts
- Recovery suggestions based on failure type

#### Request Body

```json
{
  "task_id": "composition_task_001",
  "video_items": [
    {
      "id": "video_001",
      "name": "intro.mp4",
      "url": "https://example.com/intro.mp4",
      "start_time": 0.0,
      "duration": 10.0,
      "track_id": "track_video_1",
      "clip_start": 0.0,
      "clip_end": 10.0,
      "original_duration": 15.0,
      "volume": 1.0,
      "opacity": 1.0
    },
    {
      "id": "video_002", 
      "name": "content.mp4",
      "url": "https://example.com/content.mp4",
      "start_time": 10.0,
      "duration": 20.0,
      "track_id": "track_video_1",
      "clip_start": 5.0,
      "clip_end": 25.0,
      "original_duration": 30.0,
      "volume": 1.0,
      "opacity": 1.0
    }
  ],
  "audio_items": [
    {
      "id": "audio_001",
      "name": "background.mp3",
      "url": "https://example.com/background.mp3",
      "start_time": 0.0,
      "duration": 30.0,
      "track_id": "track_audio_1",
      "volume": 0.8,
      "clip_start": 0.0,
      "clip_end": 30.0
    }
  ],
  "subtitle_items": [
    {
      "id": "sub_001",
      "name": "intro_subtitle",
      "text": "Welcome to our video",
      "start_time": 2.0,
      "duration": 3.0,
      "track_id": "track_subtitle_1",
      "font_family": "default",
      "font_size": 24,
      "font_color": "#FFFFFF",
      "position": "bottom"
    }
  ],
  "image_items": [
    {
      "id": "img_001",
      "name": "logo.png",
      "url": "https://example.com/logo.png",
      "start_time": 0.0,
      "duration": 5.0,
      "track_id": "track_image_1",
      "position": {
        "x": 0.8,
        "y": 0.1,
        "width": 0.15,
        "height": 0.15,
        "rotation": 0,
        "z_index": 10
      },
      "opacity": 0.8,
      "fade_in_duration": 0.5,
      "fade_out_duration": 0.5
    }
  ],
  "total_duration": 30.0,
  "aspect_ratio": "16:9",
  "output_resolution": {
    "width": 1920,
    "height": 1080
  },
  "output_fps": 30,
  "output_format": "mp4"
}
```

#### Success Response

```json
{
  "success": true,
  "message": "Video composition completed successfully",
  "composition_id": "comp_123456789",
  "status": "completed",
  "progress": 1.0,
  "output_file_path": "static/video/composed/composed_comp_123456789.mp4",
  "output_file_size": 52428800,
  "processing_time": 45.7
}
```

#### Error Response (Enhanced)

```json
{
  "success": false,
  "message": "2 out of 3 videos failed to process after retry attempts",
  "composition_id": "comp_123456789",
  "status": "failed",
  "progress": 0.4,
  "error_details": {
    "failed_videos": [
      {
        "video_index": 0,
        "video_id": "video_001",
        "video_name": "intro.mp4",
        "video_url": "https://example.com/intro.mp4",
        "stage": "download",
        "attempts": 4,
        "max_retries": 3,
        "error_message": "Video download failed after 4 attempts",
        "last_error": "HTTPError: 404 Client Error: Not Found for url: https://example.com/intro.mp4",
        "timeline_position": 0.0,
        "duration": 10.0
      },
      {
        "video_index": 2,
        "video_id": "video_003",
        "video_name": "outro.mp4",
        "video_url": "https://example.com/outro.mp4",
        "stage": "normalization",
        "attempts": 4,
        "max_retries": 3,
        "error_message": "Video normalization failed after 4 attempts",
        "last_error": "FFmpeg error: Invalid data found when processing input",
        "timeline_position": 20.0,
        "duration": 10.0
      }
    ],
    "total_videos": 3,
    "successful_videos": 1,
    "composition_stage": "video_download",
    "error_summary": "2 out of 3 videos failed to process after retry attempts",
    "recovery_suggestions": [
      "Check if the video URLs are accessible",
      "Verify your internet connection",
      "Try using different video sources",
      "Ensure video files are not corrupted",
      "Contact support if the issue persists"
    ]
  }
}
```

## Processing Stages

### 1. Request Validation
- Validates all input parameters
- Checks video item requirements
- Verifies timeline structure

### 2. Video Download (with Retry)
- **Retry Logic**: Up to 3 attempts per video
- **Backoff Strategy**: Exponential (1s, 2s, 4s, max 10s)
- **Error Tracking**: Detailed failure reasons for each video
- **Order Preservation**: Maintains timeline order throughout retry process

**Video Download Process:**
1. Detect video source type (YouTube, Pexels, direct URL)
2. Apply appropriate download method
3. Validate downloaded file integrity
4. Record success/failure with detailed logs

**Retry Scenarios:**
- Network connectivity issues
- Server timeouts
- HTTP errors (404, 500, etc.)
- Partial download failures
- File corruption detection

### 3. Video Normalization (with Retry)
- **Retry Logic**: Up to 3 attempts per video  
- **Format Standardization**: Consistent resolution, frame rate, codec
- **Error Recovery**: FFmpeg error detection and retry
- **Quality Preservation**: Maintains video quality while standardizing format

**Video Normalization Process:**
1. Analyze source video properties
2. Apply clipping/trimming if specified
3. Normalize to target specifications
4. Validate output file integrity

**Retry Scenarios:**
- FFmpeg processing errors
- Codec compatibility issues
- Disk space limitations
- Memory allocation failures
- File format conversion errors

### 4. Video Concatenation
- Combines normalized videos in timeline order
- Applies timeline-specific durations
- Ensures seamless transitions

### 5. Audio Processing
- Mixes multiple audio tracks
- Synchronizes with video timeline
- Applies volume adjustments

### 6. Subtitle Overlay
- Renders subtitle tracks
- Supports Chinese character display
- Applies font and positioning

### 7. Image Overlay
- Adds image overlays with positioning
- Supports fade effects
- Manages z-index layering

### 8. Finalization
- Creates final output file
- Validates final composition
- Updates progress to completion

## Error Models

### VideoProcessingError
```json
{
  "video_index": 0,
  "video_id": "string",
  "video_name": "string", 
  "video_url": "string",
  "stage": "download|normalization|concatenation|audio_processing|finalization",
  "attempts": 4,
  "max_retries": 3,
  "error_message": "string",
  "last_error": "string",
  "timeline_position": 0.0,
  "duration": 10.0
}
```

### CompositionErrorDetails
```json
{
  "failed_videos": [VideoProcessingError],
  "total_videos": 5,
  "successful_videos": 3,
  "composition_stage": "string",
  "error_summary": "string",
  "recovery_suggestions": ["string"]
}
```

## Recovery Suggestions by Error Type

### Download Errors
- **Network Issues**: "Check your internet connection and try again"
- **URL Access**: "Verify that video URLs are accessible and not expired"
- **Server Issues**: "Video source server may be temporarily unavailable"
- **Authentication**: "Check if video source requires authentication"

### Normalization Errors  
- **Codec Issues**: "Video format may not be supported, try converting to MP4"
- **Corruption**: "Source video file appears to be corrupted"
- **Resources**: "Insufficient system resources, try reducing video quality"
- **FFmpeg**: "FFmpeg processing error, check system configuration"

### System Errors
- **Disk Space**: "Insufficient disk space for video processing"
- **Memory**: "Insufficient memory for large video processing"
- **Permissions**: "File system permissions may be preventing video processing"

## Logging

### Download Retry Logging
```
[Thread 12345] Starting video download with retry: https://example.com/video.mp4 (max_retries: 3)
[Thread 12345] Download attempt 1/4 for video 0
[Thread 12345] Download attempt 1 failed: Connection timeout
[Thread 12345] Waiting 1s before retry 2
[Thread 12345] Download attempt 2/4 for video 0
[Thread 12345] Video download succeeded on retry attempt 2
```

### Normalization Retry Logging
```
Starting video normalization with retry: index 1 (max_retries: 3)
Normalization attempt 1/4 for video 1
Normalization attempt 1 failed: FFmpeg processing error
Waiting 2s before normalization retry 2
Normalization attempt 2/4 for video 1
Video normalization succeeded on retry attempt 2
```

### Error Summary Logging
```
Video composition failed: 2 videos failed to download
- Video 0 (intro.mp4): Download failed after 4 attempts - 404 Not Found
- Video 2 (outro.mp4): Normalization failed after 4 attempts - Invalid format
```

## Configuration

### Retry Configuration
The retry mechanism can be configured in the service:

```python
# Default retry settings
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 1  # seconds
RETRY_BACKOFF_MAX = 10  # seconds
```

### Logging Configuration
Detailed retry logging can be enabled/disabled:

```python
# Enable detailed retry logging
DETAILED_RETRY_LOGGING = True
```

## Status Codes

| Code | Status | Description |
|------|--------|-------------|
| 200 | Success | Video composition completed successfully |
| 400 | Bad Request | Invalid request parameters or validation error |
| 500 | Internal Server Error | Composition failed with detailed error information |

## Best Practices

### For Developers
1. **Timeline Order**: Always provide videos in the correct timeline order
2. **URL Validation**: Verify video URLs are accessible before composition
3. **Error Handling**: Parse and display detailed error information to users
4. **Retry Strategy**: Allow users to retry failed compositions with modifications

### For Users  
1. **Video Sources**: Use reliable video hosting services
2. **File Formats**: Prefer widely supported formats (MP4, WebM)
3. **Network**: Ensure stable internet connection during composition
4. **Resources**: Monitor system resources for large compositions

## Migration Notes

This enhanced API maintains backward compatibility with existing requests while adding:
- Detailed error responses with `error_details` field
- Enhanced retry mechanisms (transparent to clients)
- Improved logging and monitoring
- Better timeline order preservation

Existing client code will continue to work, but should be updated to handle the new detailed error format for better user experience. 