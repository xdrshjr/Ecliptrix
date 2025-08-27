# Image Generation API Documentation

## Overview

The Image Generation API provides a comprehensive interface for creating AI-generated images using ComfyUI. This endpoint supports the Flux model with extensive customization options.

## Endpoint Details

### POST /api/v1/generate-image

Submits an image generation request to ComfyUI and returns a task identifier for tracking progress.

## Request Format

### Headers
```
Content-Type: application/json
```

### Request Body Schema

```json
{
  "positive_prompt": "string (required)",
  "negative_prompt": "string (optional)",
  "width": "integer (optional)",
  "height": "integer (optional)", 
  "steps": "integer (optional)",
  "seed": "integer (optional)",
  "cfg": "float (optional)",
  "guidance": "float (optional)",
  "checkpoint": "string (optional)"
}
```

### Parameter Details

#### positive_prompt (required)
- **Type**: String
- **Min Length**: 1 character
- **Max Length**: 5000 characters
- **Description**: The main prompt describing what you want to generate
- **Example**: "A majestic mountain landscape at sunset with golden light reflecting on a crystal-clear lake"

#### negative_prompt (optional)
- **Type**: String
- **Default**: "low quality, blurry, distorted"
- **Max Length**: 2000 characters
- **Description**: Describes what you don't want in the image
- **Example**: "dark, gloomy, low quality, blurry, distorted, watermark, text"

#### width (optional)
- **Type**: Integer
- **Range**: 64 - 2048
- **Constraint**: Must be multiple of 8
- **Default**: 1024
- **Description**: Image width in pixels
- **Common Values**: 512, 768, 1024, 1536, 2048

#### height (optional)
- **Type**: Integer
- **Range**: 64 - 2048
- **Constraint**: Must be multiple of 8
- **Default**: 1024
- **Description**: Image height in pixels
- **Common Values**: 512, 768, 1024, 1536, 2048

#### steps (optional)
- **Type**: Integer
- **Range**: 1 - 100
- **Default**: 20
- **Description**: Number of denoising steps (more steps = higher quality but slower)
- **Recommended**: 15-30 for most use cases

#### seed (optional)
- **Type**: Integer or null
- **Default**: null (random)
- **Description**: Random seed for reproducible results
- **Usage**: Use the same seed with same parameters to get identical results

#### cfg (optional)
- **Type**: Float
- **Range**: 0.1 - 20.0
- **Default**: 1.0
- **Description**: Classifier-Free Guidance scale (how closely to follow the prompt)
- **Usage**: Higher values = stricter adherence to prompt

#### guidance (optional)
- **Type**: Float
- **Range**: 0.1 - 20.0
- **Default**: 3.5
- **Description**: Flux guidance scale for image generation
- **Usage**: Affects image style and adherence to prompt

#### checkpoint (optional)
- **Type**: String
- **Default**: "flux1-dev-fp8.safetensors"
- **Description**: Model checkpoint to use for generation
- **Available Models**: Depends on ComfyUI server configuration

## Response Format

### Success Response (HTTP 200)

```json
{
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending", 
  "message": "Image generation started",
  "estimated_time": 30
}
```

#### Response Fields

- **prompt_id**: Unique identifier for tracking this generation task
- **status**: Current status ("pending", "processing", "completed", "failed")
- **message**: Human-readable status message
- **estimated_time**: Estimated completion time in seconds (approximate)

### Error Responses

#### 422 Validation Error
```json
{
  "error": "Validation error",
  "detail": [
    {
      "loc": ["body", "positive_prompt"],
      "msg": "ensure this value has at most 5000 characters",
      "type": "value_error.any_str.max_length"
    }
  ],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "detail": "Failed to submit generation request",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Usage Examples

### Basic Generation
```bash
curl -X POST "http://localhost:8000/api/v1/generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "A serene Japanese garden with cherry blossoms"
  }'
```

### Advanced Generation with Custom Parameters
```bash
curl -X POST "http://localhost:8000/api/v1/generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "A futuristic cityscape at night with neon lights",
    "negative_prompt": "daytime, bright, low quality, blurry",
    "width": 1536,
    "height": 864,
    "steps": 25,
    "seed": 42,
    "cfg": 1.2,
    "guidance": 4.0
  }'
```

### Reproducible Generation
```bash
curl -X POST "http://localhost:8000/api/v1/generate-image" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "A magical forest with glowing mushrooms",
    "seed": 123456,
    "steps": 20
  }'
```

## Workflow After Submission

1. **Submit Request**: POST to `/api/v1/generate-image`
2. **Receive prompt_id**: Use this to track progress
3. **Poll Status**: GET `/api/v1/status/{prompt_id}` periodically
4. **Download Image**: GET `/api/v1/download/{prompt_id}` when completed

## Best Practices

### Prompt Writing
- Be specific and descriptive
- Include style information (e.g., "photorealistic", "oil painting", "digital art")
- Mention lighting, composition, and mood
- Use artistic references when appropriate

### Parameter Tuning
- **For quality**: Increase steps (20-30) and use appropriate guidance values
- **For speed**: Use lower steps (15-20) and smaller dimensions
- **For consistency**: Use the same seed value
- **For variety**: Leave seed as null for random generation

### Error Handling
- Always check response status codes
- Implement retry logic for 5xx errors
- Validate parameters before sending requests
- Handle timeout scenarios gracefully

## Performance Considerations

- **Generation Time**: Typically 15-60 seconds depending on parameters
- **Resource Usage**: Higher resolution and more steps require more processing time
- **Concurrent Requests**: Multiple requests are queued and processed sequentially
- **Image Size**: Larger images require more memory and processing time

## Common Aspect Ratios

| Ratio | Width x Height | Use Case |
|-------|---------------|----------|
| 1:1 | 1024x1024 | Square, social media |
| 3:2 | 1536x1024 | Landscape photography |
| 16:9 | 1536x864 | Widescreen, presentations |
| 4:5 | 1024x1280 | Portrait orientation |
| 2:3 | 1024x1536 | Vertical content |

## Troubleshooting

### Common Issues

1. **"Positive prompt cannot be empty"**
   - Ensure positive_prompt is provided and not empty

2. **"Width and height must be multiples of 8"**
   - Adjust dimensions to nearest multiple of 8

3. **"Failed to submit generation request"**
   - Check ComfyUI server availability
   - Verify network connectivity
   - Check server logs for detailed error information

4. **Generation stuck in "pending" status**
   - ComfyUI server may be overloaded
   - Check ComfyUI server status and logs

### Getting Help

- Check service health: `GET /api/v1/health`
- Review logs in the service logs directory
- Verify ComfyUI server is running and accessible
- Test with minimal parameters first 