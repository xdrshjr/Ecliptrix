# ComfyUI API Service Documentation

## Overview

The ComfyUI API Service provides a FastAPI-based interface for ComfyUI image generation. This service handles workflow submission, status monitoring, and image retrieval with comprehensive logging and error handling.

## Base Configuration

- **Base URL**: Configured via `COMFYUI_BASE_URL` environment variable
- **Default Port**: 8000 (configurable via `PORT` environment variable)
- **API Version**: v1
- **Documentation**: Available at `/docs` (Swagger UI)

## Authentication

Currently, no authentication is required. All endpoints are publicly accessible.

## API Endpoints

### 1. Root Endpoint

**GET /**

Returns basic service information.

**Response Example:**
```json
{
  "service": "ComfyUI API Service",
  "version": "1.0.0",
  "status": "running",
  "docs": "/docs",
  "comfyui_base_url": "http://localhost:8188"
}
```

### 2. Service Information

**GET /info**

Returns detailed service configuration.

**Response Example:**
```json
{
  "service": "ComfyUI API Service",
  "version": "1.0.0",
  "debug": false,
  "log_level": "INFO",
  "comfyui": {
    "base_url": "http://localhost:8188",
    "request_timeout": 30,
    "max_wait_time": 300,
    "poll_interval": 5
  },
  "workflow": {
    "default_width": 1024,
    "default_height": 1024,
    "default_steps": 20,
    "default_cfg": 1.0,
    "default_guidance": 3.5,
    "default_checkpoint": "flux1-dev-fp8.safetensors"
  },
  "storage": {
    "static_dir": "static",
    "generated_images_dir": "static/generated",
    "max_image_size_mb": 50
  }
}
```

### 3. Health Check

**GET /api/v1/health**

Checks the health status of both the API service and ComfyUI connection.

**Response Example:**
```json
{
  "status": "healthy",
  "comfyui_status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0"
}
```

**Error Response:**
```json
{
  "error": "Service unavailable",
  "detail": "Connection to ComfyUI failed"
}
```

### 4. Image Generation

**POST /api/v1/generate-image**

Submits an image generation request to ComfyUI.

**Request Body:**
```json
{
  "positive_prompt": "A beautiful landscape with mountains and rivers",
  "negative_prompt": "low quality, blurry, distorted",
  "width": 1024,
  "height": 1024,
  "steps": 20,
  "seed": null,
  "cfg": 1.0,
  "guidance": 3.5,
  "checkpoint": "flux1-dev-fp8.safetensors"
}
```

**Request Parameters:**
- `positive_prompt` (string, required): Positive prompt for image generation (max 5000 chars)
- `negative_prompt` (string, optional): Negative prompt (max 2000 chars, default: "low quality, blurry, distorted")
- `width` (integer, optional): Image width (64-2048, must be multiple of 8, default: 1024)
- `height` (integer, optional): Image height (64-2048, must be multiple of 8, default: 1024)
- `steps` (integer, optional): Sampling steps (1-100, default: 20)
- `seed` (integer, optional): Random seed for reproducibility (default: random)
- `cfg` (float, optional): CFG scale (0.1-20.0, default: 1.0)
- `guidance` (float, optional): Guidance scale (0.1-20.0, default: 3.5)
- `checkpoint` (string, optional): Model checkpoint (default: "flux1-dev-fp8.safetensors")

**Response Example:**
```json
{
  "prompt_id": "12345678-abcd-efgh-ijkl-123456789012",
  "status": "pending",
  "message": "Image generation started",
  "estimated_time": 30
}
```

**Error Responses:**
- `422 Validation Error`: Invalid request parameters
- `500 Internal Server Error`: Failed to submit to ComfyUI

### 5. Generation Status

**GET /api/v1/status/{prompt_id}**

Checks the status of an image generation task.

**Path Parameters:**
- `prompt_id` (string, required): The generation task ID returned from the generate-image endpoint

**Response Example (Pending):**
```json
{
  "prompt_id": "12345678-abcd-efgh-ijkl-123456789012",
  "status": "processing",
  "progress": null,
  "images": [],
  "error_message": null,
  "created_at": "2024-01-15T10:30:00Z",
  "completed_at": null
}
```

**Response Example (Completed):**
```json
{
  "prompt_id": "12345678-abcd-efgh-ijkl-123456789012",
  "status": "completed",
  "progress": 1.0,
  "images": [
    {
      "filename": "ComfyUI_12345_20240115_103000.png",
      "subfolder": "",
      "type": "output",
      "url": "/static/generated/12345678-abcd-efgh-ijkl-123456789012_20240115_103000.png",
      "size_bytes": 2048576
    }
  ],
  "error_message": null,
  "created_at": "2024-01-15T10:30:00Z",
  "completed_at": "2024-01-15T10:31:30Z"
}
```

**Error Responses:**
- `404 Not Found`: Generation task not found
- `500 Internal Server Error`: Error checking status

### 6. Image Download

**GET /api/v1/download/{prompt_id}**

Downloads the generated image for a specific task.

**Path Parameters:**
- `prompt_id` (string, required): The generation task ID

**Response:**
- Returns the image file as `image/png`
- Filename: `generated_{prompt_id}.png`

**Error Responses:**
- `404 Not Found`: Generation task not found or no images available
- `400 Bad Request`: Generation not completed yet
- `500 Internal Server Error`: Error accessing image file

## Status Values

### Generation Status
- `pending`: Task submitted, waiting to start
- `processing`: Task is being processed by ComfyUI
- `completed`: Task completed successfully
- `failed`: Task failed or timed out

## Error Handling

All endpoints return structured error responses:

```json
{
  "error": "Error message",
  "detail": "Detailed error information",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Rate Limiting

Currently, no rate limiting is implemented. Consider implementing rate limiting for production use.

## Monitoring and Logging

- All requests are logged with processing time
- Detailed error logging with stack traces
- Health check monitoring available
- Request/response middleware for debugging

## Configuration

Key environment variables:

- `COMFYUI_BASE_URL`: ComfyUI server URL
- `PORT`: API service port
- `DEBUG`: Enable debug mode
- `LOG_LEVEL`: Logging level (DEBUG, INFO, WARNING, ERROR)
- `REQUEST_TIMEOUT`: Request timeout in seconds
- `MAX_WAIT_TIME`: Maximum wait time for generation
- `POLL_INTERVAL`: Status polling interval

## Static Files

Generated images are served from `/static/generated/` path and stored locally in the configured directory. 