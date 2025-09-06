# RunningHub Workflow API Documentation

## Overview

This document describes the RunningHub Workflow API integration that enables real-time AI content generation through the RunningHub platform. The API supports various workflow types including text-to-image and text-to-video generation.

## Architecture

```
Frontend (React) → Next.js API Routes → FastAPI Backend → RunningHub API
```

## API Endpoints

### 1. Get Available Workflows

**Endpoint:** `GET /api/workflow/list`

**Description:** Retrieves all available creative workflows from the configuration.

**Response:**
```json
{
  "success": true,
  "message": "Successfully retrieved 2 available workflows",
  "data": [
    {
      "workflowName": "flux",
      "workflowType": "TEXT-2-IMG",
      "showNameCh": "flux 文生图",
      "showNameEn": "flux text-img",
      "workflowId": "1964363754437754881",
      "description": "出色的文生图功能",
      "icon": "https://...",
      "nodeInfoList": [
        {
          "nodeId": "56",
          "fieldName": "prompt",
          "fieldValue": "可爱的动漫女孩...",
          "description": "文本输入框"
        }
      ]
    }
  ]
}
```

### 2. Execute Workflow

**Endpoint:** `POST /api/workflow/execute`

**Description:** Executes a workflow with provided parameters through RunningHub API.

**Request Body:**
```json
{
  "workflow_id": "1964363754437754881",
  "parameters": [
    {
      "node_id": "56",
      "field_name": "prompt",
      "field_value": "可爱的动漫女孩，有着巨大的蓬松耳廓狐耳朵..."
    },
    {
      "node_id": "52",
      "field_name": "aspect_ratio",
      "field_value": "3:4 (Golden Ratio)"
    }
  ],
  "task_id": "video_editing_task_123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Workflow flux 文生图 execution queued successfully",
  "data": {
    "workflow_id": "1964363754437754881",
    "workflow_name": "flux",
    "status": "RUNNING",
    "message": "Workflow task created successfully",
    "task_id": "video_editing_task_123",
    "runninghub_task_id": "1964366821157683201",
    "parameters": {
      "56": "可爱的动漫女孩...",
      "52": "3:4 (Golden Ratio)"
    },
    "timestamp": "2024-01-15T10:30:00.000Z",
    "net_wss_url": "wss://www.runninghub.cn:443/ws/...",
    "client_id": "f87c3b2beeacc2ea62c24d366a36ace9"
  }
}
```

### 3. Check Task Status

**Endpoint:** `GET /api/workflow/status/{runninghub_task_id}`

**Description:** Checks the current status of a running workflow task.

**Path Parameters:**
- `runninghub_task_id`: The RunningHub task ID returned from workflow execution

**Response:**
```json
{
  "success": true,
  "message": "Status retrieved successfully",
  "data": {
    "runninghub_task_id": "1964366821157683201",
    "status": "RUNNING",
    "task_id": "video_editing_task_123"
  }
}
```

**Status Values:**
- `RUNNING`: Task is currently processing
- `SUCCESS`/`COMPLETED`: Task completed successfully
- `FAILED`/`ERROR`: Task failed
- `PENDING`: Task is queued but not started

### 4. Get Task Results

**Endpoint:** `GET /api/workflow/results/{runninghub_task_id}`

**Description:** Retrieves the results of a completed workflow task.

**Path Parameters:**
- `runninghub_task_id`: The RunningHub task ID

**Response:**
```json
{
  "success": true,
  "message": "Retrieved 1 results",
  "data": {
    "runninghub_task_id": "1964366821157683201",
    "status": "COMPLETED",
    "results": [
      {
        "fileUrl": "https://rh-images.xiaoyaoyou.com/5e64834ac9bb62219d766f489345dfdd/output/ComfyUI_00001_lfrgr_1757176603.png",
        "fileType": "png",
        "taskCostTime": "85",
        "nodeId": "9"
      }
    ],
    "task_id": "video_editing_task_123"
  }
}
```

### 5. Health Check

**Endpoint:** `GET /api/workflow/health`

**Description:** Checks the health status of the workflow service.

**Response:**
```json
{
  "success": true,
  "message": "Workflow service is healthy",
  "data": {
    "service": "workflow_service",
    "status": "healthy",
    "available_workflows": 2,
    "config_path": "/path/to/workflow-config.json",
    "config_exists": true
  }
}
```

## RunningHub API Integration

### Direct API Endpoints

The backend service integrates with the following RunningHub API endpoints:

1. **Create Task:** `POST https://www.runninghub.cn/task/openapi/create`
2. **Check Status:** `POST https://www.runninghub.cn/task/openapi/status`
3. **Get Results:** `POST https://www.runninghub.cn/task/openapi/outputs`

### Authentication

All RunningHub API calls require an API key configured in the environment variable:
```bash
RUNNING_HUB_API_KEY=your_api_key_here
```

## Frontend Integration

### Workflow Execution Flow

1. **User selects workflow** from AI Creation modal
2. **User configures parameters** for the selected workflow
3. **User clicks "开始创作"** to start the workflow
4. **Modal closes immediately** and shows generating material in materials panel
5. **Backend polls task status** every 5 seconds until completion
6. **Results are fetched** and displayed as new materials when task completes

### Material Management Integration

The system integrates with the existing material management system:

- **Generating State:** Shows a placeholder material with "正在生成" status
- **Completed State:** Replaces placeholder with actual generated content
- **Error Handling:** Removes placeholder if task fails

### Task Polling

The frontend implements automatic task status polling:

```typescript
// Poll every 5 seconds until completion
const pollTaskStatus = async (runninghubTaskId: string) => {
  const statusResult = await workflowService.checkTaskStatus(runninghubTaskId);
  
  if (statusResult.status === 'SUCCESS' || statusResult.status === 'COMPLETED') {
    const results = await workflowService.getTaskResults(runninghubTaskId);
    // Process and display results
    stopPolling();
  }
};
```

## Configuration

### Workflow Configuration

Workflows are configured in `backend-services/basic-service/workflow/workflow-config.json`:

```json
[
  {
    "workflowName": "flux",
    "workflowType": "TEXT-2-IMG",
    "showNameCh": "flux 文生图",
    "showNameEn": "flux text-img",
    "workflowId": "1964363754437754881",
    "description": "出色的文生图功能",
    "icon": "https://...",
    "nodeInfoList": [
      {
        "nodeId": "56",
        "fieldName": "prompt",
        "fieldValue": "默认提示词",
        "description": "文本输入框"
      }
    ]
  }
]
```

### Environment Variables

Required environment variables:

```bash
# Backend service URL for Next.js API routes
BACKEND_URL=http://localhost:8000

# RunningHub API key
RUNNING_HUB_API_KEY=your_api_key_here
```

## Error Handling

### Common Error Scenarios

1. **Invalid API Key:** Returns 401 Unauthorized
2. **Workflow Not Found:** Returns 404 Not Found
3. **Invalid Parameters:** Returns 400 Bad Request with validation errors
4. **RunningHub Service Down:** Returns 503 Service Unavailable
5. **Task Timeout:** Polling stops after extended failure

### Error Response Format

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message",
  "error_code": "ERROR_CODE",
  "error_details": {
    "additional": "context"
  }
}
```

## Logging

### Backend Logging

The FastAPI backend provides comprehensive logging:

- **Request/Response logging** for all API calls
- **RunningHub API interaction** logging
- **Task status polling** progress
- **Error tracking** with full stack traces

### Frontend Logging

The React frontend uses VideoEditingLogger:

- **User actions** (workflow selection, parameter changes)
- **API call results** (success/failure)
- **Task polling progress**
- **Material management** operations

## Testing

### Manual Testing

1. **Start backend service:** `cd backend-services/basic-service && python run.py`
2. **Start frontend:** `npm run dev`
3. **Open video editing interface**
4. **Click "AI创作" button**
5. **Select a workflow and configure parameters**
6. **Click "开始创作" and verify:**
   - Modal closes immediately
   - Generating material appears in materials panel
   - Task completes and result appears

### API Testing

Use the provided test endpoints:

```bash
# Test workflow list
curl http://localhost:8000/api/workflow/list

# Test workflow execution
curl -X POST http://localhost:8000/api/workflow/execute \
  -H "Content-Type: application/json" \
  -d '{"workflow_id": "1964363754437754881", "parameters": [...]}'

# Test status check
curl http://localhost:8000/api/workflow/status/{task_id}

# Test results retrieval
curl http://localhost:8000/api/workflow/results/{task_id}
```

## Performance Considerations

### Polling Optimization

- **5-second intervals** balance responsiveness with API load
- **Automatic cleanup** prevents memory leaks
- **Error handling** stops polling on failures

### Resource Management

- **Connection pooling** for HTTP requests
- **Timeout handling** prevents hanging requests
- **Memory cleanup** for completed tasks

## Security

### API Key Management

- Store API keys in environment variables
- Never expose keys in frontend code
- Use secure key rotation practices

### Input Validation

- Validate all user parameters before API calls
- Sanitize file URLs and metadata
- Implement rate limiting for API requests

## Troubleshooting

### Common Issues

1. **"API Key not found":** Check RUNNING_HUB_API_KEY environment variable
2. **"Workflow not found":** Verify workflow ID in configuration file
3. **"Task stuck in RUNNING":** Check RunningHub service status
4. **"Results not appearing":** Verify polling is active and task completed

### Debug Steps

1. Check backend logs for API errors
2. Verify environment variables are set
3. Test RunningHub API directly
4. Check network connectivity
5. Validate workflow configuration format