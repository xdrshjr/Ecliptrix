# Image to Video Conversion API Documentation

## Overview
The Image to Video Conversion API transforms static images into videos with various visual effects. It supports three types of effects: static conversion, Ken Burns effect (zoom), and pan effect (horizontal movement).

### Key Features
- **Multiple Effects**: Static, Ken Burns (zoom in/out), Pan (left-to-right/right-to-left)
- **Smooth Ken Burns Effect**: Enhanced with linear interpolation for gradual and fluid zoom transitions
- **Automatic Upload**: Generated videos are automatically uploaded to Supabase storage
- **Thumbnail Generation**: Automatic thumbnail creation for generated videos
- **Flexible Duration**: Configurable video duration (1-30 seconds)
- **High Quality**: Uses FFmpeg for professional video generation with optimized scaling

## Base URL
```
POST /api/video/image-to-video
```

## Authentication
No authentication required for this endpoint.

## Request

### Request Body
```json
{
  "image_url": "string",
  "effect": "static|ken_burns|pan",
  "duration": 5.0,
  "task_id": "string (optional)",
  "custom_filename": "string (optional)",
  "ken_burns_direction": "zoom_in|zoom_out (optional)",
  "pan_direction": "left_to_right|right_to_left (optional)"
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image_url` | string | Yes | - | URL of the image to convert to video |
| `effect` | string | Yes | - | Effect type: `static`, `ken_burns`, or `pan` |
| `duration` | float | No | 5.0 | Video duration in seconds (1.0-30.0) |
| `task_id` | string | No | null | Task ID for organization and logging |
| `custom_filename` | string | No | null | Custom filename for the output video |
| `ken_burns_direction` | string | No | "zoom_in" | Ken Burns direction: `zoom_in` or `zoom_out` |
| `pan_direction` | string | No | "left_to_right" | Pan direction: `left_to_right` or `right_to_left` |

### Effect Types

#### Static
Simple conversion of image to video with no motion effects.
```json
{
  "image_url": "https://example.com/image.jpg",
  "effect": "static",
  "duration": 5.0
}
```

#### Ken Burns Effect
Creates smooth zoom transitions on images with enhanced linear interpolation.

**Zoom In** (zoom_in): Starts at normal size (1.0x) and gradually zooms to 1.1x over the duration for a subtle effect
```json
{
  "image_url": "https://example.com/image.jpg",
  "effect": "ken_burns",
  "ken_burns_direction": "zoom_in",
  "duration": 5.0
}
```

**Zoom Out** (zoom_out): Starts at zoomed in state (1.1x) and gradually zooms out to normal size (1.0x)
```json
{
  "image_url": "https://example.com/image.jpg",
  "effect": "ken_burns",
  "ken_burns_direction": "zoom_out",
  "duration": 5.0
}
```

**Technical Details:**
- Uses linear interpolation formula: `zoom_start + (zoom_end - zoom_start) * (frame / total_frames)`
- Zoom range: 1.0x to 1.1x for subtle, natural-looking transitions
- Frame rate: 30 fps for fluid motion
- Stable center positioning using `(iw-ow)/2, (ih-oh)/2` to eliminate jitter
- No camera movement or shaking - pure zoom effect only

#### Pan Effect
Creates horizontal movement across the image.

**Left to Right**:
```json
{
  "image_url": "https://example.com/image.jpg",
  "effect": "pan",
  "pan_direction": "left_to_right",
  "duration": 5.0
}
```

**Right to Left**:
```json
{
  "image_url": "https://example.com/image.jpg",
  "effect": "pan",
  "pan_direction": "right_to_left",
  "duration": 5.0
}
```

### Request Example
```json
{
  "image_url": "https://example.com/beautiful-landscape.jpg",
  "effect": "ken_burns",
  "duration": 8.0,
  "task_id": "video-editing-task-123",
  "custom_filename": "landscape_zoom",
  "ken_burns_direction": "zoom_in"
}
```

## Response

### Success Response
```json
{
  "success": true,
  "message": "Image converted to video successfully",
  "video_url": "https://supabase-url/video.mp4",
  "thumbnail_url": "https://supabase-url/thumbnail.jpg",
  "file_size": 2048576,
  "duration": 8.0,
  "width": 1920,
  "height": 1080,
  "effect_applied": "ken_burns",
  "processing_time": 12.5
}
```

### Error Response
```json
{
  "success": false,
  "message": "Conversion failed: Invalid image format",
  "error_code": "CONVERSION_ERROR",
  "details": "Unsupported image format: .bmp"
}
```

### Response Fields

#### Success Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` for successful conversions |
| `message` | string | Success message |
| `video_url` | string | URL of the generated video in Supabase storage |
| `thumbnail_url` | string | URL of the generated thumbnail (optional) |
| `file_size` | integer | File size of the generated video in bytes |
| `duration` | float | Actual duration of the generated video |
| `width` | integer | Video width in pixels |
| `height` | integer | Video height in pixels |
| `effect_applied` | string | The effect that was applied |
| `processing_time` | float | Time taken to process the conversion in seconds |

#### Error Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `false` for error responses |
| `message` | string | Human-readable error message |
| `error_code` | string | Machine-readable error code |
| `details` | string | Additional error details (optional) |

### Error Codes

| Error Code | Description |
|------------|-------------|
| `MISSING_IMAGE_URL` | Image URL is required but not provided |
| `INVALID_DURATION` | Duration is outside the allowed range (1-30 seconds) |
| `FFMPEG_ERROR` | FFmpeg processing failed |
| `FILE_NOT_CREATED` | Output video file was not created |
| `UPLOAD_FAILED` | Failed to upload video to Supabase storage |
| `CONVERSION_ERROR` | General conversion error |
| `INTERNAL_ERROR` | Internal server error |

## Status Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success - Image converted successfully |
| 400 | Bad Request - Invalid parameters |
| 500 | Internal Server Error - Processing failed |

## Usage Examples

### cURL Examples

#### Static Conversion
```bash
curl -X POST "http://localhost:8000/api/video/image-to-video" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/photo.jpg",
    "effect": "static",
    "duration": 5.0,
    "task_id": "my-task-123"
  }'
```

#### Ken Burns Effect
```bash
curl -X POST "http://localhost:8000/api/video/image-to-video" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/landscape.jpg",
    "effect": "ken_burns",
    "duration": 10.0,
    "ken_burns_direction": "zoom_out",
    "custom_filename": "landscape_zoom_out"
  }'
```

#### Pan Effect
```bash
curl -X POST "http://localhost:8000/api/video/image-to-video" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/panorama.jpg",
    "effect": "pan",
    "duration": 8.0,
    "pan_direction": "right_to_left"
  }'
```

### JavaScript Example
```javascript
const convertImageToVideo = async (imageUrl, effect, options = {}) => {
  const response = await fetch('/api/video/image-to-video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_url: imageUrl,
      effect: effect,
      duration: options.duration || 5.0,
      task_id: options.taskId,
      custom_filename: options.filename,
      ken_burns_direction: options.kenBurnsDirection || 'zoom_in',
      pan_direction: options.panDirection || 'left_to_right'
    }),
  });

  const result = await response.json();
  
  if (result.success) {
    console.log('Video generated:', result.video_url);
    return result;
  } else {
    console.error('Conversion failed:', result.message);
    throw new Error(result.message);
  }
};

// Usage
convertImageToVideo(
  'https://example.com/image.jpg',
  'ken_burns',
  {
    duration: 7.0,
    taskId: 'video-task-456',
    kenBurnsDirection: 'zoom_in'
  }
);
```

## Technical Details

### Supported Image Formats
- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)

### Video Output Specifications
- **Format**: MP4 (H.264)
- **Frame Rate**: 30 FPS
- **Pixel Format**: YUV420P
- **Resolution**: Maintains original image aspect ratio
- **Quality**: High quality encoding

### Processing Pipeline
1. **Download**: Image is downloaded from the provided URL
2. **Analysis**: Image dimensions and format are analyzed
3. **Conversion**: FFmpeg processes the image with the selected effect
4. **Thumbnail**: A thumbnail is generated from the video
5. **Upload**: Both video and thumbnail are uploaded to Supabase
6. **Cleanup**: Temporary files are cleaned up
7. **Response**: URLs and metadata are returned

### Performance Considerations
- Processing time varies based on image size and effect complexity
- Ken Burns and Pan effects take longer than static conversion
- Large images (>4K) may take significantly longer to process
- Timeout is set to 5 minutes for processing

## Rate Limits
No specific rate limits are currently enforced, but consider implementing them for production use.

## Error Handling
The API provides detailed error messages and codes to help diagnose issues. Always check the `success` field in the response to determine if the conversion was successful. 