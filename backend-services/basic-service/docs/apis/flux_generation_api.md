# FLUX Text-to-Image Generation API Documentation

## Overview
The FLUX Generation API provides text-to-image generation capabilities using the FLUX model through RunningHub's infrastructure. This API allows you to create high-quality images from text prompts with various aspect ratios and customizable parameters.

### Key Features
- **FLUX Model Integration**: Leverages the powerful FLUX text-to-image model
- **Asynchronous Processing**: Non-blocking task creation with status polling
- **Multiple Aspect Ratios**: Support for various image dimensions
- **Real-time Status Tracking**: Monitor generation progress
- **Automatic Result Retrieval**: Get generated images when tasks complete
- **Comprehensive Logging**: Detailed logging for debugging and monitoring

## Base URL
```
/api/flux
```

## Authentication
No authentication required for these endpoints. The service uses a configured RunningHub API key internally.

## Endpoints

### 1. Create Generation Task

#### `POST /api/flux/generate`

Create a new FLUX text-to-image generation task.

**Request Body:**
```json
{
  "positive_prompt": "string (required, 1-5000 characters)",
  "aspect_ratio": "string (optional, default: '3:4 (Golden Ratio)')",
  "task_id": "string (optional)"
}
```

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `positive_prompt` | string | Yes | - | Text prompt for image generation (1-5000 characters) |
| `aspect_ratio` | string | No | "3:4 (Golden Ratio)" | Image aspect ratio. Options: "1:1 (Square)", "3:4 (Golden Ratio)", "4:3 (Standard)", "16:9 (Widescreen)", "9:16 (Portrait)", "2:3 (Portrait)", "3:2 (Landscape)" |
| `task_id` | string | No | auto-generated | Custom task ID for tracking |

**Success Response (200):**
```json
{
  "success": true,
  "task_id": "flux_abc12345",
  "runninghub_task_id": "1964366821157683201",
  "status": "RUNNING",
  "message": "FLUX generation task created successfully"
}
```

**Error Response (400/500):**
```json
{
  "success": false,
  "error": "Error description",
  "error_code": "ERROR_CODE",
  "task_id": "flux_abc12345"
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:8000/api/flux/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "positive_prompt": "可爱的动漫女孩，有着巨大的蓬松耳廓狐耳朵和一条蓬松的大尾巴，金色凌乱的长发，蓝眼睛，穿着女仆装",
    "aspect_ratio": "3:4 (Golden Ratio)",
    "task_id": "my_custom_task_001"
  }'
```

### 2. Check Task Status

#### `GET /api/flux/status/{task_id}`

Check the current status of a FLUX generation task.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Internal task ID from generation response |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `runninghub_task_id` | string | Yes | RunningHub task ID from generation response |

**Success Response (200):**
```json
{
  "success": true,
  "task_id": "flux_abc12345",
  "runninghub_task_id": "1964366821157683201",
  "status": "RUNNING",
  "message": "Task status: RUNNING"
}
```

**Status Values:**
- `PENDING`: Task is queued and waiting to start
- `RUNNING`: Task is currently being processed
- `COMPLETED`: Task has finished successfully
- `FAILED`: Task has failed due to an error

**Example Request:**
```bash
curl "http://localhost:8000/api/flux/status/flux_abc12345?runninghub_task_id=1964366821157683201"
```

### 3. Get Task Results

#### `GET /api/flux/results/{task_id}`

Retrieve the results of a completed FLUX generation task.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Internal task ID from generation response |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `runninghub_task_id` | string | Yes | RunningHub task ID from generation response |

**Success Response (200):**
```json
{
  "success": true,
  "task_id": "flux_abc12345",
  "runninghub_task_id": "1964366821157683201",
  "status": "COMPLETED",
  "results": [
    {
      "fileUrl": "https://rh-images.xiaoyaoyou.com/output/ComfyUI_00001.png",
      "fileType": "png",
      "taskCostTime": "85",
      "nodeId": "9"
    }
  ],
  "message": "Retrieved 1 generated images"
}
```

**Result Object:**

| Field | Type | Description |
|-------|------|-------------|
| `fileUrl` | string | Direct URL to the generated image |
| `fileType` | string | Image file format (png, jpg, etc.) |
| `taskCostTime` | string | Generation time in seconds |
| `nodeId` | string | ComfyUI node that generated this output |

**Example Request:**
```bash
curl "http://localhost:8000/api/flux/results/flux_abc12345?runninghub_task_id=1964366821157683201"
```

### 4. Health Check

#### `GET /api/flux/health`

Check if the FLUX generation service is available and properly configured.

**Success Response (200):**
```json
{
  "status": "healthy",
  "message": "FLUX generation service is available",
  "workflow_id": "1964363754437754881",
  "base_url": "https://www.runninghub.cn",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Error Response (503):**
```json
{
  "status": "unhealthy",
  "message": "RunningHub API key not configured",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Usage Workflow

### Typical Integration Flow

1. **Create Task**: Call `POST /api/flux/generate` with your prompt
2. **Poll Status**: Regularly call `GET /api/flux/status/{task_id}` every 5 seconds
3. **Get Results**: When status is `COMPLETED`, call `GET /api/flux/results/{task_id}`

### Example Integration Code (JavaScript)

```javascript
async function generateFluxImage(prompt, aspectRatio = "3:4 (Golden Ratio)") {
  // Step 1: Create generation task
  const createResponse = await fetch('/api/flux/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      positive_prompt: prompt,
      aspect_ratio: aspectRatio
    })
  });
  
  const taskData = await createResponse.json();
  if (!taskData.success) {
    throw new Error(taskData.error);
  }
  
  const { task_id, runninghub_task_id } = taskData;
  
  // Step 2: Poll for completion
  while (true) {
    const statusResponse = await fetch(
      `/api/flux/status/${task_id}?runninghub_task_id=${runninghub_task_id}`
    );
    const statusData = await statusResponse.json();
    
    if (statusData.status === 'COMPLETED') {
      break;
    } else if (statusData.status === 'FAILED') {
      throw new Error('Generation failed');
    }
    
    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  // Step 3: Get results
  const resultsResponse = await fetch(
    `/api/flux/results/${task_id}?runninghub_task_id=${runninghub_task_id}`
  );
  const resultsData = await resultsResponse.json();
  
  return resultsData.results;
}
```

## Error Handling

### Common Error Codes

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `INVALID_PROMPT` | Empty or invalid prompt | Provide a non-empty prompt (1-5000 characters) |
| `API_ERROR` | RunningHub API request failed | Check network connectivity and API status |
| `RUNNINGHUB_ERROR` | RunningHub returned an error | Check RunningHub service status |
| `INTERNAL_ERROR` | Internal service error | Check service logs and configuration |

### Error Response Format

All error responses follow this format:
```json
{
  "success": false,
  "error": "Human-readable error message",
  "error_code": "MACHINE_READABLE_CODE",
  "task_id": "task_id_if_available"
}
```

## Configuration

### Environment Variables

The service requires the following environment variable:

```bash
RUNNING_HUB_API_KEY=your_runninghub_api_key_here
```

### Workflow Configuration

The service uses configuration files in the `workflow/` directory:

- `flux_config.yaml`: Main configuration including workflow ID, endpoints, and polling settings
- `flux_nodeinfo_template.json`: Template for ComfyUI node parameters

### Supported Aspect Ratios

| Aspect Ratio | Description | Use Case |
|--------------|-------------|----------|
| "1:1 (Square)" | Square format | Social media posts, avatars |
| "3:4 (Golden Ratio)" | Portrait with golden ratio | Portraits, posters |
| "4:3 (Standard)" | Standard landscape | Presentations, displays |
| "16:9 (Widescreen)" | Widescreen format | Banners, headers |
| "9:16 (Portrait)" | Vertical mobile format | Mobile wallpapers, stories |
| "2:3 (Portrait)" | Standard portrait | Photos, prints |
| "3:2 (Landscape)" | Standard landscape | Photos, prints |

## Performance Considerations

### Polling Strategy

- **Recommended Interval**: 5 seconds between status checks
- **Timeout**: Tasks typically complete within 2-10 minutes
- **Max Polling Duration**: 10 minutes (120 attempts × 5 seconds)

### Rate Limiting

- No explicit rate limiting on the API endpoints
- RunningHub may have its own rate limits
- Consider implementing client-side rate limiting for production use

### Caching

- Generated image URLs are permanent and can be cached
- Status responses should not be cached
- Health check responses can be cached for 1-5 minutes

## Monitoring and Logging

### Log Levels

The service provides detailed logging at multiple levels:

- **INFO**: Task creation, completion, and major events
- **DEBUG**: Status checks and detailed flow information
- **ERROR**: Failures, API errors, and exceptions
- **WARNING**: Invalid inputs and recoverable issues

### Metrics to Monitor

- Task creation rate
- Task completion rate
- Average generation time
- Error rates by type
- API response times

## Troubleshooting

### Common Issues

1. **"RunningHub API key not configured"**
   - Ensure `RUNNING_HUB_API_KEY` is set in environment variables
   - Verify the API key is valid and active

2. **"Configuration file not found"**
   - Ensure `workflow/flux_config.yaml` and `workflow/flux_nodeinfo_template.json` exist
   - Check file permissions and paths

3. **Tasks stuck in RUNNING status**
   - Check RunningHub service status
   - Verify network connectivity to RunningHub API
   - Check for API rate limiting

4. **Empty or invalid results**
   - Verify task completed successfully before calling results endpoint
   - Check RunningHub task logs for generation errors
   - Ensure prompt meets content guidelines

### Debug Steps

1. Check service health: `GET /api/flux/health`
2. Review service logs for error details
3. Verify environment configuration
4. Test with simple prompts first
5. Check RunningHub API status independently