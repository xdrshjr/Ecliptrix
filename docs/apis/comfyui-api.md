# ComfyUI API Service Documentation

## Overview

The ComfyUI API Service provides a RESTful API for generating images using ComfyUI. This service offers health checking, image generation, status monitoring, and file download capabilities.

## Base Configuration

- **Base URL**: `http://localhost:8000` (configurable via environment variables)
- **ComfyUI Integration**: Connects to ComfyUI instance specified in configuration
- **Authentication**: None (for internal use)

## Environment Configuration

Create a `.env` file in the service root directory:

```env
COMFYUI_BASE_URL=http://comfyui-tako.hk.cpolar.io
LOG_LEVEL=DEBUG
HOST=0.0.0.0
PORT=8000
DEBUG=false

# Application Configuration
APP_NAME=ComfyUI API Service
APP_VERSION=1.0.0

# File Storage Configuration
STATIC_DIR=static
GENERATED_IMAGES_DIR=static/generated
MAX_IMAGE_SIZE_MB=50

# Request Configuration
REQUEST_TIMEOUT=30
MAX_WAIT_TIME=300
POLL_INTERVAL=5

# ComfyUI Workflow Configuration
DEFAULT_WIDTH=1024
DEFAULT_HEIGHT=1024
DEFAULT_STEPS=20
DEFAULT_CFG=1.0
DEFAULT_GUIDANCE=3.5
DEFAULT_CHECKPOINT=flux1-dev-fp8.safetensors
```

## API Endpoints

### 1. Health Check

#### GET `/api/v1/health`

Check the health status of the ComfyUI service.

**Response:**
```json
{
    "status": "healthy",
    "comfyui_status": "healthy",
    "timestamp": "2024-01-01T12:00:00Z",
    "version": "1.0.0"
}
```

**Status Codes:**
- `200 OK`: Service is healthy and ComfyUI is accessible
- `503 Service Unavailable`: ComfyUI is not accessible

### 2. Generate Image

#### POST `/api/v1/generate-image`

Generate an image using ComfyUI with specified parameters.

**Request Body:**
```json
{
    "positive_prompt": "A beautiful sunset over mountains",
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

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `positive_prompt` | string | Yes | - | Text description of desired image (max 5000 chars) |
| `negative_prompt` | string | No | "low quality, blurry, distorted" | What to avoid in the image (max 2000 chars) |
| `width` | integer | No | 1024 | Image width (64-2048, must be multiple of 8) |
| `height` | integer | No | 1024 | Image height (64-2048, must be multiple of 8) |
| `steps` | integer | No | 20 | Sampling steps (1-100) |
| `seed` | integer | No | null | Random seed for reproducibility |
| `cfg` | number | No | 1.0 | CFG scale (0.1-20.0) |
| `guidance` | number | No | 3.5 | Guidance scale (0.1-20.0) |
| `checkpoint` | string | No | "flux1-dev-fp8.safetensors" | Model checkpoint to use |

**Response:**
```json
{
    "prompt_id": "12345678-1234-1234-1234-123456789abc",
    "status": "pending",
    "message": "Image generation started",
    "estimated_time": 30
}
```

**Status Codes:**
- `200 OK`: Generation request submitted successfully
- `422 Unprocessable Entity`: Invalid request parameters
- `500 Internal Server Error`: Failed to submit to ComfyUI

### 3. Check Generation Status

#### GET `/api/v1/status/{prompt_id}`

Check the status of an image generation task.

**Path Parameters:**
- `prompt_id`: The unique identifier returned from the generate-image endpoint

**Response (Pending/Processing):**
```json
{
    "prompt_id": "12345678-1234-1234-1234-123456789abc",
    "status": "processing",
    "progress": null,
    "images": [],
    "error_message": null,
    "created_at": 1640995200.0,
    "completed_at": null
}
```

**Response (Completed):**
```json
{
    "prompt_id": "12345678-1234-1234-1234-123456789abc",
    "status": "completed",
    "progress": 1.0,
    "images": [
        {
            "filename": "ComfyUI_00001_.png",
            "subfolder": "",
            "type": "output",
            "url": "/static/generated/12345678-1234-1234-1234-123456789abc_20240101_120000.png",
            "size_bytes": 1024000
        }
    ],
    "error_message": null,
    "created_at": 1640995200.0,
    "completed_at": 1640995230.0
}
```

**Status Values:**
- `pending`: Task is queued
- `processing`: Task is being processed
- `completed`: Task completed successfully
- `failed`: Task failed or timed out

**Status Codes:**
- `200 OK`: Status retrieved successfully
- `404 Not Found`: Prompt ID not found

### 4. Download Generated Image

#### GET `/api/v1/download/{prompt_id}`

Download the generated image file.

**Path Parameters:**
- `prompt_id`: The unique identifier of the completed generation task

**Response:**
- Returns the image file directly as a binary response
- Content-Type: `image/png`
- Filename: `generated_{prompt_id}.png`

**Status Codes:**
- `200 OK`: Image file returned
- `400 Bad Request`: Generation not completed yet
- `404 Not Found`: Prompt ID not found or image file missing

### 5. Service Information

#### GET `/`

Get basic service information.

**Response:**
```json
{
    "service": "ComfyUI API Service",
    "version": "1.0.0",
    "status": "running",
    "docs": "/docs",
    "comfyui_base_url": "http://comfyui-tako.hk.cpolar.io"
}
```

#### GET `/info`

Get detailed service configuration.

**Response:**
```json
{
    "service": "ComfyUI API Service",
    "version": "1.0.0",
    "debug": false,
    "log_level": "DEBUG",
    "comfyui": {
        "base_url": "http://comfyui-tako.hk.cpolar.io",
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

## Usage Examples

### Python Example

```python
import requests
import time

# Base URL of the service
BASE_URL = "http://localhost:8000"

# 1. Check service health
health_response = requests.get(f"{BASE_URL}/api/v1/health")
print(f"Health check: {health_response.json()}")

# 2. Generate image
generation_request = {
    "positive_prompt": "A cute anime girl with blue eyes and blonde hair",
    "negative_prompt": "low quality, blurry",
    "width": 512,
    "height": 512,
    "steps": 15
}

response = requests.post(f"{BASE_URL}/api/v1/generate-image", json=generation_request)
if response.status_code == 200:
    result = response.json()
    prompt_id = result["prompt_id"]
    print(f"Generation started: {prompt_id}")
    
    # 3. Poll for completion
    while True:
        status_response = requests.get(f"{BASE_URL}/api/v1/status/{prompt_id}")
        status_data = status_response.json()
        
        print(f"Status: {status_data['status']}")
        
        if status_data["status"] == "completed":
            print("Generation completed!")
            break
        elif status_data["status"] == "failed":
            print("Generation failed!")
            break
        
        time.sleep(5)
    
    # 4. Download image
    if status_data["status"] == "completed":
        download_response = requests.get(f"{BASE_URL}/api/v1/download/{prompt_id}")
        if download_response.status_code == 200:
            with open(f"generated_{prompt_id}.png", "wb") as f:
                f.write(download_response.content)
            print("Image downloaded successfully!")
```

### curl Examples

```bash
# Health check
curl -X GET "http://localhost:8000/api/v1/health"

# Generate image
curl -X POST "http://localhost:8000/api/v1/generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "A beautiful landscape",
    "width": 512,
    "height": 512
  }'

# Check status
curl -X GET "http://localhost:8000/api/v1/status/YOUR_PROMPT_ID"

# Download image
curl -X GET "http://localhost:8000/api/v1/download/YOUR_PROMPT_ID" \
  -o "generated_image.png"
```

## Error Responses

All error responses follow this format:

```json
{
    "error": "Error description",
    "detail": "Detailed error information",
    "timestamp": "2024-01-01T12:00:00Z"
}
```

## Running the Service

### Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure environment variables in `.env` file

3. Start the service:
```bash
python run.py
```

The service will be available at `http://localhost:8000` by default.

### Testing

Run the test suite:
```bash
pytest tests/ -v
```

## Interactive API Documentation

Once the service is running, you can access:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

These provide interactive API documentation where you can test endpoints directly from the browser. 