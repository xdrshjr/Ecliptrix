# Video Compose API (Next.js Routes)

## Overview

The Video Compose API provides Next.js API routes that proxy video composition requests to the backend service. This API acts as an intermediary layer between the frontend and the Python backend service, providing consistent logging, error handling, and request validation.

**Key Features:**
- **Asynchronous Processing**: Video composition runs in background, returns immediately
- **10-Minute Timeout**: Extended timeout support for complex video processing
- **Enhanced Retry Mechanism**: 3-retry logic for individual video processing failures *(NEW)*
- **Detailed Error Reporting**: Comprehensive error details with specific failure reasons *(NEW)*
- **Chinese Subtitle Support**: Fixed Ubuntu Chinese subtitle rendering issues (v2024.01)
- Proxies requests to backend video composition service
- Comprehensive request validation and error handling
- Detailed logging for debugging and monitoring
- Consistent response format across all endpoints
- Automatic file download handling for composed videos
- Real-time progress tracking through status polling

## Retry Mechanism *(NEW)*

### Individual Video Processing Retry
Each video in the composition timeline is processed with a robust 3-retry mechanism:

- **Download Phase**: Up to 3 retry attempts for video download failures
- **Normalization Phase**: Up to 3 retry attempts for video processing failures
- **Exponential Backoff**: Progressive delay between retry attempts (1s, 2s, 4s, max 10s)
- **Strict Timeline Order**: Videos are processed in timeline order, no video is lost
- **Detailed Logging**: Each retry attempt is logged with specific failure reasons

### Error Handling Flow
1. **Individual Video Failure**: If a video fails after 3 retries, detailed error information is collected
2. **Immediate Failure Response**: The entire composition fails immediately if any video cannot be processed
3. **Detailed Error Details**: Specific failure reasons, suggestions, and affected video information are returned
4. **Frontend Toast Notifications**: Users receive informative error messages with actionable suggestions

## Base URL

```
/api/video-compose
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Compose Video

**POST** `/api/video-compose`

Initiates video composition by proxying the request to the backend service. The composition runs asynchronously in the background, and this endpoint returns immediately with a `composition_id` for tracking progress.

**⚠️ Timeout Configuration**: This endpoint has a 10-minute (600 seconds) timeout to accommodate complex video processing operations. For very complex compositions, ensure the backend service can complete processing within this timeframe.

**✨ Enhanced Error Handling**: The endpoint now provides detailed error information when individual videos fail to process, including specific failure reasons and recovery suggestions.

#### Request Body

```json
{
  "task_id": "string",
  "video_items": [
    {
      "id": "string",
      "name": "string", 
      "url": "string",
      "start_time": 0,
      "duration": 30,
      "track_id": "string",
      "clip_start": 0,
      "clip_end": 30,
      "volume": 1.0,
      "opacity": 1.0
    }
  ],
  "audio_items": [
    {
      "id": "string",
      "name": "string",
      "url": "string", 
      "start_time": 0,
      "duration": 30,
      "track_id": "string",
      "volume": 1.0,
      "clip_start": 0,
      "clip_end": 30
    }
  ],
  "subtitle_items": [
    {
      "id": "string",
      "name": "string",
      "text": "string",
      "start_time": 0,
      "duration": 5,
      "track_id": "string",
      "font_family": "default",
      "font_size": 24,
      "font_color": "#FFFFFF",
      "position": "bottom"
    }
  ],
  "image_items": [
    {
      "id": "string",
      "name": "string",
      "url": "string",
      "start_time": 0,
      "duration": 10,
      "track_id": "string",
      "position": {
        "x": 0.1,
        "y": 0.1,
        "width": 0.3,
        "height": 0.3,
        "rotation": 0,
        "z_index": 10
      },
      "opacity": 1.0,
      "fade_in_duration": 0.5,
      "fade_out_duration": 0.5
    }
  ],
  "total_duration": 60,
  "aspect_ratio": "16:9",
  "output_resolution": {
    "width": 1920,
    "height": 1080
  },
  "output_fps": 30,
  "output_format": "mp4"
}
```

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Unique identifier for this composition task |
| `video_items` | array | Yes | List of video items to compose in timeline order |
| `audio_items` | array | No | List of audio items to mix |
| `subtitle_items` | array | No | List of subtitle overlays |
| `image_items` | array | No | List of image overlays |
| `total_duration` | number | Yes | Total duration of the final video (seconds) |
| `aspect_ratio` | string | No | Video aspect ratio (default: "16:9") |
| `output_resolution` | object | No | Output resolution (auto-calculated if not provided) |
| `output_fps` | number | No | Output frame rate (default: 30) |
| `output_format` | string | No | Output format (default: "mp4") |

#### Response Format

**Success Response:**
```json
{
  "success": true,
  "message": "Video composition started successfully",
  "composition_id": "comp_123456789",
  "status": "processing",
  "progress": 0.0,
  "data": {
    "task_id": "video_export_task_001",
    "estimated_completion": "2024-01-15T10:30:00Z"
  }
}
```

**Error Response (Enhanced):**
```json
{
  "success": false,
  "message": "2 out of 5 videos failed to download after 3 retry attempts",
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
        "last_error": "Connection timeout after 30 seconds",
        "timeline_position": 0.0,
        "duration": 10.0
      },
      {
        "video_index": 2,
        "video_id": "video_003",
        "video_name": "content.mp4", 
        "video_url": "https://example.com/content.mp4",
        "stage": "normalization",
        "attempts": 4,
        "max_retries": 3,
        "error_message": "Video normalization failed after 4 attempts",
        "last_error": "FFmpeg processing error: Invalid video format",
        "timeline_position": 20.0,
        "duration": 15.0
      }
    ],
    "total_videos": 5,
    "successful_videos": 3,
    "composition_stage": "video_download",
    "error_summary": "2 out of 5 videos failed to download after 3 retry attempts",
    "recovery_suggestions": [
      "Check if the video URLs are accessible",
      "Verify your internet connection", 
      "Try using different video sources",
      "Contact support if the issue persists"
    ]
  },
  "data": null
}
```

#### Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success - Composition started |
| 400 | Bad Request - Invalid request parameters |
| 500 | Internal Server Error - Composition failed with detailed error information |
| 503 | Service Unavailable - Backend service temporarily unavailable |

#### Processing Stages

The composition process includes the following stages with retry mechanisms:

1. **Request Validation** - Validates all input parameters
2. **Video Download** *(with 3 retries)* - Downloads all video files
3. **Video Normalization** *(with 3 retries)* - Processes videos to consistent format
4. **Video Concatenation** - Combines videos in timeline order
5. **Audio Processing** - Mixes and synchronizes audio tracks
6. **Subtitle Overlay** - Adds subtitle tracks
7. **Image Overlay** - Adds image overlays
8. **Finalization** - Creates final output file

### 2. Check Composition Status

**GET** `/api/video-compose/{composition_id}/status`

Retrieves the current status and progress of a video composition job.

#### Response Format

```json
{
  "success": true,
  "composition_id": "comp_123456789",
  "status": "processing", // "processing", "completed", "failed"
  "progress": 0.75, // 0.0 to 1.0
  "message": "Video composition in progress",
  "estimated_completion": "2024-01-15T10:35:00Z",
  "data": {
    "current_stage": "audio_processing",
    "processed_videos": 4,
    "total_videos": 5
  }
}
```

### 3. Download Composed Video

**GET** `/api/video-compose/{composition_id}/download`

Downloads the completed video file.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | No | Task ID for logging purposes |

#### Response

- **Success**: Returns the video file as a binary download
- **Error**: Returns JSON error response if file not found or composition not completed

## Error Recovery

### Frontend Error Handling

The frontend now provides enhanced error handling with:

- **Toast Notifications**: Replace alert dialogs with user-friendly toast messages
- **Detailed Error Display**: Show specific failure reasons and affected videos
- **Recovery Suggestions**: Provide actionable steps to resolve issues
- **Extended Display Time**: Error messages show for 15 seconds to allow reading

### Common Error Scenarios

1. **Video Download Failures**
   - Network connectivity issues
   - Invalid or inaccessible video URLs
   - Video source server downtime

2. **Video Processing Failures**
   - Corrupted video files
   - Unsupported video formats
   - Insufficient system resources

3. **System Resource Issues**
   - Insufficient disk space
   - Memory limitations
   - FFmpeg processing errors

### Recovery Recommendations

1. **For Download Errors**:
   - Verify video URLs are accessible
   - Check network connectivity
   - Try alternative video sources
   - Contact video provider if needed

2. **For Processing Errors**:
   - Verify video file integrity
   - Check available disk space
   - Reduce output resolution/quality
   - Ensure FFmpeg is properly configured

3. **For Timeout Issues**:
   - Reduce video complexity
   - Lower output resolution
   - Decrease number of simultaneous tracks
   - Retry during off-peak hours

## Best Practices

1. **Timeline Order**: Ensure videos are properly ordered in the timeline before composition
2. **URL Accessibility**: Verify all video URLs are accessible before starting composition
3. **Resource Management**: Monitor system resources during large compositions
4. **Error Monitoring**: Use the detailed error information for troubleshooting
5. **Retry Strategy**: Allow users to retry failed compositions with modifications

## Logging

The API provides comprehensive logging for:
- All retry attempts with specific failure reasons
- Timeline order verification
- Processing stage transitions
- Error details and recovery suggestions
- Performance metrics and timing information

This enhanced logging helps with debugging and provides insights into composition performance and reliability. 