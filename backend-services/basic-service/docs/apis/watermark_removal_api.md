# Watermark Removal API

## Overview
The Watermark Removal API provides functionality to remove watermarks from videos using OpenCV inpainting techniques. This API processes videos frame by frame to intelligently remove watermarks while preserving the original video quality and audio track.

## Recent Updates
- **Coordinate System Fix**: Fixed coordinate offset issue where watermark removal position was offset to the lower-right of user selection
- **Enhanced Logging**: Added detailed coordinate conversion logging for debugging purposes
- **Improved Accuracy**: Now uses actual video element positioning instead of manual calculations

## Endpoint

### POST /api/video/watermark-removal

Remove watermark from a video using OpenCV inpainting.

**URL:** `POST /api/video/watermark-removal`

**Content-Type:** `application/json`

## Request

### Request Body

```json
{
  "task_id": "string",
  "video_url": "string", 
  "watermark_area": {
    "x1": 0,
    "y1": 0,
    "x2": 100,
    "y2": 100
  },
  "custom_filename": "string (optional)",
  "inpaint_radius": 5,
  "inpaint_method": "telea"
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Unique identifier for the task |
| `video_url` | string | Yes | URL of the video to process (local file path or remote URL) |
| `watermark_area` | object | Yes | Coordinates of the watermark area to remove |
| `watermark_area.x1` | integer | Yes | Left x coordinate (≥ 0) |
| `watermark_area.y1` | integer | Yes | Top y coordinate (≥ 0) |
| `watermark_area.x2` | integer | Yes | Right x coordinate (> x1) |
| `watermark_area.y2` | integer | Yes | Bottom y coordinate (> y1) |
| `custom_filename` | string | No | Custom filename for the output video |
| `inpaint_radius` | integer | No | Inpainting radius in pixels (1-20, default: 5) |
| `inpaint_method` | string | No | Inpainting method: "telea" or "ns" (default: "telea") |

### Coordinate System

The coordinate system uses the video's natural dimensions:
- Origin (0,0) is at the top-left corner of the video
- X coordinates increase from left to right
- Y coordinates increase from top to bottom
- All coordinates are in pixels relative to the video's original resolution

**Important**: The frontend automatically converts display coordinates to video coordinates, accounting for video scaling and positioning within the player.

### Inpainting Methods

- **telea**: Fast Marching Method (recommended for most cases)
- **ns**: Navier-Stokes based method (better for fluid-like textures)

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Watermark removal completed successfully",
  "task_id": "task_123456",
  "original_video_url": "https://example.com/video.mp4",
  "processed_video_url": "https://example.com/processed_video_no_watermark.mp4",
  "watermark_area": {
    "x1": 10,
    "y1": 10,
    "x2": 300,
    "y2": 250
  },
  "processing_time": 45.2,
  "video_duration": 30.0,
  "total_frames": 900,
  "inpaint_method": "telea"
}
```

### Error Response (400/500)

```json
{
  "success": false,
  "message": "Watermark removal failed",
  "task_id": "task_123456",
  "error_code": "PROCESSING_ERROR",
  "details": "Failed to process video frames"
}
```

### Response Fields

#### Success Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always true for successful responses |
| `message` | string | Success message |
| `task_id` | string | Task identifier |
| `original_video_url` | string | Original video URL |
| `processed_video_url` | string | URL of the processed video without watermark |
| `watermark_area` | object | Coordinates of the removed watermark area |
| `processing_time` | number | Processing time in seconds |
| `video_duration` | number | Video duration in seconds |
| `total_frames` | number | Total number of frames processed |
| `inpaint_method` | string | Inpainting method used |

#### Error Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always false for error responses |
| `message` | string | Error message |
| `task_id` | string | Task identifier (if available) |
| `error_code` | string | Error code for categorization |
| `details` | string | Detailed error information |

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_VIDEO_URL` | Video URL is empty or invalid |
| `INVALID_COORDINATES` | Watermark area coordinates are invalid |
| `PROCESSING_ERROR` | Error during video processing |
| `INTERNAL_ERROR` | Internal server error |

## Usage Examples

### Basic Watermark Removal

```bash
curl -X POST "http://localhost:8000/api/video/watermark-removal" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task_123456",
    "video_url": "https://example.com/video_with_watermark.mp4",
    "watermark_area": {
      "x1": 10,
      "y1": 10,
      "x2": 300,
      "y2": 250
    }
  }'
```

### Advanced Configuration

```bash
curl -X POST "http://localhost:8000/api/video/watermark-removal" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task_789012",
    "video_url": "https://example.com/video_with_watermark.mp4",
    "watermark_area": {
      "x1": 50,
      "y1": 50,
      "x2": 200,
      "y2": 150
    },
    "custom_filename": "clean_video.mp4",
    "inpaint_radius": 8,
    "inpaint_method": "ns"
  }'
```

## Processing Details

### Algorithm

1. **Video Download**: Downloads the source video if it's a remote URL
2. **Frame Extraction**: Processes video frame by frame using OpenCV
3. **Mask Creation**: Creates a binary mask for the watermark area
4. **Inpainting**: Applies the selected inpainting algorithm to each frame
5. **Video Reconstruction**: Rebuilds the video with processed frames
6. **Audio Preservation**: Merges original audio track using FFmpeg
7. **Upload**: Uploads the processed video to Supabase storage

### Performance

- Processing time depends on video length, resolution, and watermark area size
- Typical processing speed: 10-30 fps (varies by hardware)
- Memory usage scales with video resolution
- Automatic cleanup of temporary files

### Limitations

- Watermark area coordinates must be within video dimensions
- Best results achieved with static watermarks
- Processing time increases with video duration and resolution
- Requires sufficient disk space for temporary files

## Error Handling

The API implements comprehensive error handling:

- **Input Validation**: Validates all request parameters
- **Resource Management**: Automatic cleanup of temporary files
- **Timeout Protection**: Prevents hanging processes
- **Detailed Logging**: Comprehensive logging for debugging
- **Graceful Degradation**: Falls back to video without audio if audio merge fails

## Integration Notes

- Designed to work with the frontend video editing interface
- Compatible with Supabase storage system
- Supports both local file paths and remote URLs
- Integrates with the existing task management system 