# Video Compose API (Next.js Routes)

## Overview

The Video Compose API provides Next.js API routes that proxy video composition requests to the backend service. This API acts as an intermediary layer between the frontend and the Python backend service, providing consistent logging, error handling, and request validation.

**Key Features:**
- **Asynchronous Processing**: Video composition runs in background, returns immediately
- **10-Minute Timeout**: Extended timeout support for complex video processing
- **Chinese Subtitle Support**: Fixed Ubuntu Chinese subtitle rendering issues (v2024.01)
- Proxies requests to backend video composition service
- Comprehensive request validation and error handling
- Detailed logging for debugging and monitoring
- Consistent response format across all endpoints
- Automatic file download handling for composed videos
- Real-time progress tracking through status polling

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
      "opacity": 1.0,
      "clip_start": 0.0,
      "clip_end": 5.0
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
      "volume": 1.0,
      "clip_start": 0.0,
      "clip_end": 5.0
    }
  ],
  "subtitle_items": [
    {
      "id": "string",
      "name": "string",
      "text": "string",
      "start_time": 0.0,
      "duration": 5.0,
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

#### Request Validation

- `task_id`: Required string identifier
- `video_items`: Required non-empty array with valid video items
- `total_duration`: Required positive number
- Each video/audio item must have: `id`, `name`, `url`, `start_time`, `duration`

#### Response

The endpoint returns immediately with the composition details:

```json
{
  "success": true,
  "message": "Video composition started successfully",
  "composition_id": "comp_1234567890",
  "status": "processing",
  "progress": 0.0
}
```

**Note**: The `status` will always be `"processing"` initially. Use the status endpoint to track progress.

#### Status Codes

- `200 OK`: Composition started successfully
- `400 Bad Request`: Invalid request data or validation error
- `500 Internal Server Error`: Backend service unavailable or internal error

#### Logging

The API logs the following information:
- Request timestamp and parameters
- Video/audio/subtitle item counts
- Total duration and output settings
- Backend service response status
- Success/failure with composition ID

### 2. Get Composition Status

**GET** `/api/video-compose/{compositionId}/status`

Retrieves the current status of a video composition.

**⚠️ Timeout Configuration**: This endpoint has a 30-second timeout for quick status responses.

#### Path Parameters

- `compositionId` (string): The composition ID returned from the compose request

#### Response

```json
{
  "composition_id": "comp_1234567890",
  "task_id": "export_1234567890",
  "status": "processing|completed|failed",
  "progress": 0.75,
  "start_time": 1640995200,
  "processing_time": 45.2,
  "output_file_size": 52428800,
  "error_details": null
}
```

#### Status Codes

- `200 OK`: Status retrieved successfully
- `400 Bad Request`: Invalid composition ID
- `404 Not Found`: Composition not found
- `500 Internal Server Error`: Backend service unavailable

#### Logging

- Request timestamp and composition ID
- Backend service response status
- Composition status and progress percentage

### 3. Download Composed Video

**GET** `/api/video-compose/{compositionId}/download?task_id={task_id}&filename={filename}`

Downloads the completed video file.

**⚠️ Timeout Configuration**: This endpoint has a 10-minute (600 seconds) timeout to accommodate large video file downloads.

#### Path Parameters

- `compositionId` (string): The composition ID

#### Query Parameters

- `task_id` (optional): Task identifier for tracking
- `filename` (optional): Suggested filename for download

#### Response

Binary video file with headers:
- `Content-Type`: `video/mp4`
- `Content-Length`: File size in bytes
- `X-Composition-ID`: Composition ID
- `Content-Disposition`: `attachment; filename="composed_video.mp4"`

#### Status Codes

- `200 OK`: File download successful
- `400 Bad Request`: Invalid composition ID
- `404 Not Found`: Composition not found or not ready
- `500 Internal Server Error`: Backend service unavailable

#### Logging

- Request timestamp, composition ID, task ID, and filename
- Backend service response status
- File size in MB for successful downloads

### 4. Health Check

**GET** `/api/video-compose/health`

Checks the health status of the video composition service.

**⚠️ Timeout Configuration**: This endpoint has a 10-second timeout for quick health checks.

#### Response

```json
{
  "service": "video_composition",
  "status": "healthy|degraded|error",
  "ffmpeg_available": true,
  "active_compositions": 2,
  "message": "Service is operational",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Status Codes

- `200 OK`: Health check successful
- `503 Service Unavailable`: Backend service unavailable
- `500 Internal Server Error`: Internal error

#### Logging

- Request timestamp
- Backend service response status
- Service status and availability

## Error Handling

### Common Error Response Format

```json
{
  "success": false,
  "message": "Error description",
  "data": null
}
```

### Error Types

1. **Validation Errors** (400): Invalid request parameters
2. **Not Found Errors** (404): Composition not found
3. **Timeout Errors** (408/500): Request timeout after configured limits
4. **Service Unavailable** (500/503): Backend service issues
5. **Internal Errors** (500): Unexpected server errors

### Timeout Handling

The API implements different timeout configurations for different operations:

- **Video Composition** (`POST /api/video-compose`): 10 minutes (600s)
- **Video Download** (`GET /api/video-compose/{id}/download`): 10 minutes (600s)  
- **Status Check** (`GET /api/video-compose/{id}/status`): 30 seconds
- **Health Check** (`GET /api/video-compose/health`): 10 seconds

**Timeout Error Response:**
```json
{
  "success": false,
  "message": "Request timeout - operation exceeded time limit",
  "data": null
}
```

**Frontend Timeout Handling:**
- All API calls from the frontend include appropriate timeout configurations
- Timeout errors are logged with detailed context information
- Users receive clear error messages when timeouts occur

## Environment Configuration

The API uses the following environment variable:

- `BACKEND_URL`: Backend service URL (default: `http://localhost:8000`)

## Asynchronous Processing

The API uses asynchronous processing for video composition to provide better user experience:

### How It Works

1. **Immediate Response**: The `/api/video-compose` endpoint returns immediately with a `composition_id`
2. **Background Processing**: Video composition runs in a background thread on the server
3. **Status Polling**: Frontend polls the status endpoint to track progress
4. **Completion Notification**: When complete, status changes to `"completed"` and download is available

### Benefits

- **No Timeouts**: Frontend doesn't wait for long-running operations
- **Progress Tracking**: Real-time progress updates through status polling
- **Better UX**: Users can see progress and aren't blocked by long waits
- **Scalability**: Server can handle multiple compositions simultaneously

## Logging Format

All API routes use consistent logging with the following format:

```
[Video Compose API] YYYY-MM-DDTHH:mm:ss.sssZ - Action description
[Video Compose API] Parameter: value
```

Example:
```
[Video Compose API] 2024-01-15T10:30:00.000Z - Video composition request
[Video Compose API] Task ID: export_20240115_103000
[Video Compose API] Video items count: 3
[Video Compose API] Audio items count: 2
[Video Compose API] Total duration: 45.5s
```

## Usage Examples

### Frontend Integration

```typescript
import { videoCompositionAPI } from '@/lib/api/videoComposition';

// Start composition (returns immediately)
const response = await videoCompositionAPI.composeVideo({
  task_id: 'export_20240115_103000',
  video_items: [...],
  audio_items: [...],
  total_duration: 45.5,
  output_resolution: { width: 1920, height: 1080 }
});

console.log('Composition started:', response.composition_id);
// Response: { success: true, composition_id: "comp_123", status: "processing", progress: 0.0 }

// Poll for completion with progress updates
await videoCompositionAPI.pollCompositionStatus(
  response.composition_id,
  (status) => {
    console.log(`Progress: ${(status.progress * 100).toFixed(1)}%`);
    console.log(`Status: ${status.status}`);
    // Update your progress bar here
  }
);

// Download when complete (handled automatically by pollCompositionStatus)
await videoCompositionAPI.triggerDownload(
  response.composition_id,
  'export_20240115_103000',
  'my_video.mp4'
);
```

### Direct API Calls

```javascript
// Start composition
const response = await fetch('/api/video-compose', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    task_id: 'export_20240115_103000',
    video_items: [...],
    total_duration: 45.5
  })
});

// Check status
const status = await fetch(`/api/video-compose/${compositionId}/status`);

// Download
const downloadUrl = `/api/video-compose/${compositionId}/download?filename=my_video.mp4`;
```

## Performance Notes

- All requests are proxied to the backend service
- File downloads stream through Next.js for consistent error handling
- Comprehensive logging may impact performance in high-traffic scenarios
- Backend service availability directly affects API response times

### Video Composition Performance

Video composition is a CPU-intensive operation that can take significant time depending on:

- **Video Resolution**: Higher resolutions (4K, 1080p) take longer than lower resolutions
- **Video Duration**: Longer videos require more processing time
- **Number of Tracks**: Multiple video/audio tracks increase complexity
- **Video Codecs**: Some codecs require more processing than others
- **Server Resources**: CPU and memory availability affect processing speed

**Typical Processing Times:**
- Simple composition (1-2 videos, 30s): 30-60 seconds
- Complex composition (3+ videos, 60s+): 2-5 minutes
- Very complex (multiple tracks, effects): 5-10 minutes

**Optimization Recommendations:**
1. Use lower resolution source videos when possible
2. Limit the number of simultaneous tracks
3. Pre-process videos to consistent formats
4. Consider breaking long compositions into segments

## Chinese Subtitle Support (Ubuntu Fix)

### Issue Fixed (v2024.01)

Previously, Chinese subtitles would appear as garbled characters (乱码) when composing videos on Ubuntu systems. This was caused by incorrect font priority in the subtitle rendering system.

### Solution Implemented

The subtitle service now includes:

1. **Smart Font Detection**: Automatically detects Chinese characters in subtitle text
2. **Prioritized Font Selection**: When Chinese characters are detected, Chinese fonts are prioritized:
   - Noto CJK fonts (primary)
   - WenQuanYi fonts (secondary)
   - Source Han fonts (tertiary)
3. **Enhanced Ubuntu Font Support**: Added comprehensive Chinese font paths for Ubuntu systems

### System Requirements

For optimal Chinese subtitle support on Ubuntu, install recommended fonts:

```bash
# Install Noto CJK fonts (recommended)
sudo apt-get install fonts-noto-cjk

# Install WenQuanYi fonts (alternative)
sudo apt-get install fonts-wqy-microhei fonts-wqy-zenhei

# Install Source Han fonts (optional)
sudo apt-get install fonts-source-han-sans-cn
```

### Verification

To verify Chinese font availability:

```bash
# List all Chinese fonts
fc-list :lang=zh

# Check specific font
ls /usr/share/fonts/opentype/noto/NotoSansCJK*
```

### Testing Chinese Subtitles

Example request with Chinese subtitles:

```json
{
  "task_id": "chinese_test_001",
  "video_items": [...],
  "subtitle_items": [
    {
      "id": "sub_cn_1",
      "text": "这是中文字幕测试",
      "start_time": 0.0,
      "duration": 3.0,
      "font_size": 24,
      "font_color": "#FFFFFF",
      "position": "bottom"
    },
    {
      "id": "sub_mixed_1", 
      "text": "Mixed 中英文 subtitles",
      "start_time": 3.0,
      "duration": 3.0,
      "font_size": 24,
      "font_color": "#FFFFFF"
    }
  ],
  "total_duration": 30.0
}
```

### Troubleshooting

If Chinese subtitles still appear garbled:

1. **Check system fonts**:
   ```bash
   python backend-services/basic-service/test_chinese_subtitle_fix.py
   ```

2. **Install missing fonts**:
   ```bash
   sudo apt-get update
   sudo apt-get install fonts-noto-cjk fonts-wqy-microhei
   ```

3. **Check logs** for font selection details:
   ```bash
   tail -f backend-services/basic-service/logs/app.log | grep "font"
   ```

## Migration from Direct Backend Calls

This API replaces direct calls to `http://localhost:8000/api/video/compose` with Next.js routes:

| Old Direct Call | New Next.js Route |
|----------------|-------------------|
| `POST http://localhost:8000/api/video/compose` | `POST /api/video-compose` |
| `GET http://localhost:8000/api/video/compose/{id}/status` | `GET /api/video-compose/{id}/status` |
| `GET http://localhost:8000/api/video/compose/{id}/download` | `GET /api/video-compose/{id}/download` |
| `GET http://localhost:8000/api/video/compose/health` | `GET /api/video-compose/health` |

The `VideoCompositionAPI` class has been updated to use these new routes automatically. 