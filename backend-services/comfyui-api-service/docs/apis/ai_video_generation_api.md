# AI Video Generation API

This document describes the AI Video Generation API endpoints provided by the ComfyUI API Service. The API allows generating videos from text prompts using the WanVideo workflow.

## Overview

The AI Video Generation API provides three main endpoints:
1. **Generate AI Video** - Start a new video generation task
2. **Check Status** - Monitor the progress of a generation task
3. **Download Video** - Download the completed video

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Generate AI Video

Start a new AI video generation task.

**Endpoint:** `POST /generate-ai-video`

**Request Body:**

```json
{
  "positive_prompt": "A beautiful landscape with flowing rivers and mountains, cinematic quality, 4K resolution",
  "negative_prompt": "低质量，模糊，静态，细节模糊不清",
  "width": 640,
  "height": 480,
  "duration_seconds": 5,
  "steps": 8,
  "seed": 12345,
  "enable_lora": true,
  "aspect_ratio": "16:9"
}
```

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `positive_prompt` | string | Yes | - | Text description of the video to generate |
| `negative_prompt` | string | No | Chinese default | What to avoid in the video |
| `width` | integer | No | 600 | Video width (must be multiple of 8) |
| `height` | integer | No | 800 | Video height (must be multiple of 8) |
| `duration_seconds` | integer | No | 5 | Video duration in seconds (1-30) |
| `steps` | integer | No | 8 | Number of sampling steps (1-100) |
| `seed` | integer | No | random | Random seed for reproducibility |
| `enable_lora` | boolean | No | true | Enable LoRA for enhanced quality |
| `aspect_ratio` | string | No | null | Preset aspect ratio (overrides width/height) |

**Supported Aspect Ratios:**
- `16:9` - Wide format (800x448)
- `9:16` - Vertical/portrait (448x800)
- `1:1` - Square (640x640)
- `4:3` - Traditional 4:3 (640x480)
- `3:4` - Portrait 4:3 (480x640)
- `21:9` - Ultra-wide (896x384)

**Response:**

```json
{
  "prompt_id": "abc123def456",
  "status": "pending",
  "message": "AI video generation started",
  "estimated_time": 85
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `prompt_id` | string | Unique identifier for the generation task |
| `status` | string | Current status: "pending", "processing", "completed", "failed" |
| `message` | string | Human-readable status message |
| `estimated_time` | integer | Estimated completion time in seconds |

**Status Codes:**
- `200` - Success
- `422` - Validation error
- `500` - Internal server error

**Example cURL:**

```bash
curl -X POST "http://localhost:8000/api/v1/generate-ai-video" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "A serene forest with sunlight filtering through trees",
    "duration_seconds": 3,
    "aspect_ratio": "16:9",
    "enable_lora": true
  }'
```

### 2. Check AI Video Status

Monitor the progress of an AI video generation task.

**Endpoint:** `GET /ai-video-status/{prompt_id}`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt_id` | string | Yes | The prompt ID returned from the generation request |

**Response:**

```json
{
  "prompt_id": "abc123def456",
  "status": "completed",
  "progress": 1.0,
  "videos": [
    {
      "filename": "AIVideo_1704067200_video.mp4",
      "subfolder": "",
      "type": "output",
      "url": "/static/generated/AIVideo_1704067200_video.mp4",
      "size_bytes": 2048000,
      "duration": 5.0
    }
  ],
  "error_message": null,
  "created_at": "2024-01-01T12:00:00Z",
  "completed_at": "2024-01-01T12:02:30Z",
  "request_parameters": {
    "positive_prompt": "A serene forest with sunlight filtering through trees",
    "negative_prompt": "低质量，模糊，静态",
    "width": 800,
    "height": 448,
    "duration_seconds": 3,
    "steps": 8,
    "enable_lora": true,
    "aspect_ratio": "16:9",
    "seed": null
  }
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `prompt_id` | string | The generation task identifier |
| `status` | string | Current status: "pending", "processing", "completed", "failed" |
| `progress` | float | Progress percentage (0.0 to 1.0) |
| `videos` | array | List of generated videos (when completed) |
| `error_message` | string | Error description (when failed) |
| `created_at` | string | Task creation timestamp (ISO 8601) |
| `completed_at` | string | Task completion timestamp (ISO 8601) |
| `request_parameters` | object | Original request parameters |

**Video Object Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `filename` | string | Video filename |
| `subfolder` | string | Subfolder path |
| `type` | string | File type ("output") |
| `url` | string | Download URL |
| `size_bytes` | integer | File size in bytes |
| `duration` | float | Video duration in seconds |

**Status Codes:**
- `200` - Success
- `404` - Task not found
- `400` - Not an AI video task
- `500` - Internal server error

**Example cURL:**

```bash
curl -X GET "http://localhost:8000/api/v1/ai-video-status/abc123def456"
```

### 3. Download AI Video

Download the generated video file.

**Endpoint:** `GET /download-ai-video/{prompt_id}`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt_id` | string | Yes | The prompt ID of the completed generation task |

**Response:**

- **Content-Type:** `video/mp4`
- **Content-Disposition:** `attachment; filename="ai_video_{prompt_id}.mp4"`
- **Body:** Binary video file data

**Status Codes:**
- `200` - Success (file download)
- `400` - Generation not completed
- `404` - Task not found or no videos available
- `500` - Internal server error

**Example cURL:**

```bash
curl -X GET "http://localhost:8000/api/v1/download-ai-video/abc123def456" \
  --output "my_generated_video.mp4"
```

## Workflow Integration

This API uses the `Wan2.2-KJ-Video-Gen.json` workflow file located in the `workflows/` directory. The workflow supports:

- **Text-to-Video Generation:** Generate videos from text prompts
- **LoRA Support:** Enhanced quality with LoRA models
- **Configurable Parameters:** Adjustable dimensions, duration, and steps
- **Multiple Aspect Ratios:** Preset ratios for common use cases

## Error Handling

All endpoints return structured error responses:

```json
{
  "detail": "Error description",
  "error": "Error type",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

Common error scenarios:

### Validation Errors (422)
- Empty or too long prompts
- Invalid dimensions (not multiples of 8)
- Invalid duration (outside 1-30 seconds range)
- Invalid aspect ratio
- Invalid steps count

### Service Errors (500)
- ComfyUI service unavailable
- Workflow file missing or invalid
- Video generation failure
- File system errors

### Not Found Errors (404)
- Task ID not found
- Generated video files missing

## Usage Examples

### Basic Video Generation

```bash
# 1. Start generation
curl -X POST "http://localhost:8000/api/v1/generate-ai-video" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "A cat playing in a garden",
    "duration_seconds": 3
  }'

# Response: {"prompt_id": "task123", "status": "pending", ...}

# 2. Check status
curl -X GET "http://localhost:8000/api/v1/ai-video-status/task123"

# 3. Download when completed
curl -X GET "http://localhost:8000/api/v1/download-ai-video/task123" \
  --output "cat_video.mp4"
```

### Advanced Video Generation

```bash
curl -X POST "http://localhost:8000/api/v1/generate-ai-video" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "Epic cinematic scene of a dragon flying over a medieval castle, golden hour lighting, ultra detailed, 4K quality",
    "negative_prompt": "blurry, low quality, static, cartoon",
    "aspect_ratio": "21:9",
    "duration_seconds": 8,
    "steps": 15,
    "enable_lora": true,
    "seed": 42
  }'
```

### Monitoring Generation Progress

```python
import requests
import time

# Start generation
response = requests.post(
    "http://localhost:8000/api/v1/generate-ai-video",
    json={
        "positive_prompt": "A peaceful lake at sunset",
        "duration_seconds": 5
    }
)
prompt_id = response.json()["prompt_id"]

# Poll for completion
while True:
    status_response = requests.get(f"http://localhost:8000/api/v1/ai-video-status/{prompt_id}")
    status_data = status_response.json()
    
    print(f"Status: {status_data['status']}")
    
    if status_data["status"] == "completed":
        print("Generation completed!")
        # Download the video
        video_response = requests.get(f"http://localhost:8000/api/v1/download-ai-video/{prompt_id}")
        with open("generated_video.mp4", "wb") as f:
            f.write(video_response.content)
        break
    elif status_data["status"] == "failed":
        print(f"Generation failed: {status_data.get('error_message', 'Unknown error')}")
        break
    
    time.sleep(10)  # Wait 10 seconds before checking again
```

## Performance Considerations

- **Generation Time:** Varies based on duration, steps, and complexity (typically 1-5 minutes)
- **File Size:** Videos range from 1-10 MB depending on duration and quality
- **Concurrent Requests:** Service can handle multiple simultaneous generations
- **Resource Usage:** Higher steps and longer durations require more GPU resources

## Troubleshooting

### Common Issues

1. **"Workflow validation failed"**
   - Ensure ComfyUI has all required models installed
   - Check that workflow file exists and is valid
   - Verify ComfyUI service is running

2. **"Generation failed or timed out"**
   - Check ComfyUI service logs
   - Verify sufficient GPU memory
   - Reduce steps or duration if needed

3. **"Video file not found"**
   - Check file permissions
   - Verify storage directory exists
   - Ensure sufficient disk space

### Logs

Check the service logs for detailed error information:

```bash
tail -f logs/comfyui_api.log
```

## Rate Limiting

Currently, no rate limiting is enforced, but consider implementing limits based on:
- Requests per minute per IP
- Concurrent generations per user
- Total daily generation time

## Future Enhancements

Planned improvements include:
- Batch video generation
- Custom model selection
- Progress callbacks
- WebSocket status updates
- Video preview generation
- Custom LoRA upload