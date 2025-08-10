# Video Composition API

## Overview

The Video Composition API provides endpoints for composing multiple video, audio, and subtitle tracks into a single video file. This API is designed to work with timeline data from video editing interfaces.

## Base URL

```
/api/video
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Compose Video

**POST** `/compose`

Compose a video from timeline data containing video, audio, and subtitle items.

#### Request Body

```json
{
  "task_id": "string",
  "video_items": [
    {
      "id": "string",
      "name": "string",
      "url": "string",
      "start_time": 0.0,
      "duration": 5.0,
      "track_id": "string",
      "volume": 1.0,
      "opacity": 1.0
    }
  ],
  "audio_items": [
    {
      "id": "string",
      "name": "string", 
      "url": "string",
      "start_time": 0.0,
      "duration": 5.0,
      "track_id": "string",
      "volume": 1.0
    }
  ],
  "subtitle_items": [
    {
      "id": "string",
      "name": "string",
      "text": "string",
      "start_time": 0.0,
      "duration": 3.0,
      "track_id": "string",
      "font_size": 24,
      "font_color": "#FFFFFF",
      "background_color": "#000000",
      "position": "bottom"
    }
  ],
  "total_duration": 10.0,
  "output_resolution": {
    "width": 1920,
    "height": 1080
  },
  "output_fps": 30,
  "output_format": "mp4"
}
```

#### Response

```json
{
  "success": true,
  "message": "Video composition completed successfully",
  "composition_id": "uuid-string",
  "status": "completed",
  "progress": 1.0,
  "output_file_path": "/path/to/composed_video.mp4",
  "output_file_size": 52428800,
  "processing_time": 45.2,
  "error_details": null
}
```

#### Status Codes

- `200 OK`: Composition request accepted and processed
- `400 Bad Request`: Invalid request parameters
- `500 Internal Server Error`: Composition failed

### 2. Get Composition Status

**GET** `/compose/{composition_id}/status`

Get the current status of a video composition.

#### Path Parameters

- `composition_id` (string, required): ID of the composition

#### Response

```json
{
  "composition_id": "uuid-string",
  "task_id": "string",
  "status": "processing|completed|failed",
  "progress": 0.75,
  "start_time": 1640995200.0,
  "processing_time": 30.5,
  "output_file_size": 52428800,
  "error_details": null
}
```

#### Status Codes

- `200 OK`: Status retrieved successfully
- `404 Not Found`: Composition not found
- `500 Internal Server Error`: Error retrieving status

### 3. Download Composed Video

**GET** `/download/{composition_id}`

Download the composed video file.

#### Path Parameters

- `composition_id` (string, required): ID of the composition

#### Query Parameters

- `task_id` (string, optional): Task ID for tracking

#### Response

Returns the composed video file as a binary stream with appropriate headers.

#### Headers

- `Content-Type`: `video/mp4`
- `Content-Length`: File size in bytes
- `X-Composition-ID`: Composition ID
- `Content-Disposition`: `attachment; filename="composed_video.mp4"`

#### Status Codes

- `200 OK`: File download successful
- `404 Not Found`: Composition not found or not ready
- `500 Internal Server Error`: Download error

### 4. Composition Service Health

**GET** `/compose/health`

Check the health status of the video composition service.

#### Response

```json
{
  "service": "video_composition",
  "status": "healthy|degraded|error",
  "ffmpeg_available": true,
  "active_compositions": 2,
  "message": "Service is operational"
}
```

#### Status Codes

- `200 OK`: Health check successful

## Data Models

### VideoCompositionItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the timeline item |
| name | string | Yes | Display name of the video item |
| url | string | Yes | Video URL (local or remote) |
| start_time | float | Yes | Start time in timeline (seconds, ≥ 0) |
| duration | float | Yes | Duration of video segment (seconds, > 0) |
| track_id | string | Yes | ID of the track this item belongs to |
| volume | float | No | Volume level (0.0 to 2.0, default: 1.0) |
| opacity | float | No | Opacity level (0.0 to 1.0, default: 1.0) |

### AudioCompositionItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the timeline item |
| name | string | Yes | Display name of the audio item |
| url | string | Yes | Audio URL (local or remote) |
| start_time | float | Yes | Start time in timeline (seconds, ≥ 0) |
| duration | float | Yes | Duration of audio segment (seconds, > 0) |
| track_id | string | Yes | ID of the track this item belongs to |
| volume | float | No | Volume level (0.0 to 2.0, default: 1.0) |

### SubtitleCompositionItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the timeline item |
| name | string | Yes | Display name of the subtitle item |
| text | string | Yes | Subtitle text content |
| start_time | float | Yes | Start time in timeline (seconds, ≥ 0) |
| duration | float | Yes | Duration of subtitle display (seconds, > 0) |
| track_id | string | Yes | ID of the track this item belongs to |
| font_size | int | No | Font size in pixels (8-72, default: 24) |
| font_color | string | No | Font color in hex format (default: "#FFFFFF") |
| background_color | string | No | Background color in hex format (optional) |
| position | string | No | Position (top, center, bottom, default: "bottom") |

## Error Handling

All endpoints return structured error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error_code": "ERROR_TYPE",
  "error_details": {
    "detail": "Detailed error information"
  }
}
```

## Usage Examples

### Basic Video Composition

```bash
curl -X POST "http://localhost:8000/api/video/compose" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "video_edit_001",
    "video_items": [
      {
        "id": "video_1",
        "name": "Intro Video",
        "url": "https://example.com/video1.mp4",
        "start_time": 0.0,
        "duration": 5.0,
        "track_id": "track_1",
        "volume": 1.0,
        "opacity": 1.0
      },
      {
        "id": "video_2", 
        "name": "Main Video",
        "url": "https://example.com/video2.mp4",
        "start_time": 5.0,
        "duration": 10.0,
        "track_id": "track_1",
        "volume": 1.0,
        "opacity": 1.0
      }
    ],
    "total_duration": 15.0,
    "output_resolution": {
      "width": 1920,
      "height": 1080
    },
    "output_fps": 30,
    "output_format": "mp4"
  }'
```

### Check Composition Status

```bash
curl -X GET "http://localhost:8000/api/video/compose/{composition_id}/status"
```

### Download Composed Video

```bash
curl -X GET "http://localhost:8000/api/video/download/{composition_id}" \
  -o composed_video.mp4
```

## Notes

1. **Video Processing**: Videos are automatically normalized to the specified resolution and frame rate
2. **Concurrent Processing**: Multiple videos are processed in parallel for better performance
3. **Temporary Files**: Temporary files are automatically cleaned up after composition
4. **Error Recovery**: The service includes retry mechanisms for network-related failures
5. **File Storage**: Composed videos are stored in the `static/video/composed` directory
6. **Dependencies**: Requires `ffmpeg` to be installed and available in the system PATH

## Future Enhancements

- Audio track mixing and synchronization
- Subtitle rendering with custom fonts and styles  
- Transition effects between video segments
- Real-time progress updates via WebSocket
- Batch composition for multiple projects 