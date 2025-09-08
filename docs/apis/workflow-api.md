# Workflow API Documentation

## Overview

The Workflow API provides endpoints for managing and executing creative workflows through the Next.js backend, which proxies requests to the Python FastAPI backend service (backend-services/basic-service).

All workflow API calls are routed through Next.js proxy endpoints to ensure proper request handling, logging, and error management.

## Base URL

All endpoints are accessed through the Next.js frontend:
- Development: `http://localhost:3000`
- Production: `${NEXT_PUBLIC_FRONTEND_URL}`

## Environment Variables

The Next.js proxy routes use the following environment variable to connect to the Python backend:
- `BACKEND_SERVICE_URL`: URL of the Python FastAPI backend service (default: `http://localhost:8000`)

## Endpoints

### 1. List Available Workflows

**Endpoint:** `GET /api/workflow/list`

**Description:** Retrieves all available creative workflows from the backend service.

**Request:**
```http
GET /api/workflow/list
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "workflowId": "string",
      "workflowName": "string",
      "description": "string",
      "nodeInfoList": [
        {
          "nodeId": "string",
          "nodeName": "string",
          "fieldName": "string",
          "fieldType": "string",
          "defaultValue": "any",
          "required": boolean
        }
      ]
    }
  ],
  "message": "string"
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "string",
  "error": "string",
  "error_details": "string"
}
```

### 2. Execute Workflow

**Endpoint:** `POST /api/workflow/execute`

**Description:** Executes a workflow with provided parameters.

**Request:**
```http
POST /api/workflow/execute
Content-Type: application/json

{
  "workflow_id": "string",
  "parameters": [
    {
      "node_id": "string",
      "field_name": "string",
      "field_value": "any"
    }
  ],
  "task_id": "string"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "task_id": "string",
    "runninghub_task_id": "string",
    "status": "string",
    "message": "string"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "string",
  "error": "string",
  "error_details": "string",
  "timestamp": "string"
}
```

### 3. Check Workflow Status

**Endpoint:** `GET /api/workflow/status/{taskId}`

**Description:** Checks the status of a workflow execution task.

**Request:**
```http
GET /api/workflow/status/{taskId}
Content-Type: application/json
```

**Path Parameters:**
- `taskId` (string): The task ID returned from workflow execution

**Response:**
```json
{
  "success": true,
  "data": {
    "task_id": "string",
    "runninghub_task_id": "string",
    "status": "string",
    "progress": number,
    "message": "string"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "string",
  "error": "string",
  "error_details": "string"
}
```

### 4. Get Workflow Results

**Endpoint:** `GET /api/workflow/results/{taskId}`

**Description:** Retrieves the results of a completed workflow execution.

**Request:**
```http
GET /api/workflow/results/{taskId}
Content-Type: application/json
```

**Path Parameters:**
- `taskId` (string): The task ID returned from workflow execution

**Response:**
```json
{
  "success": true,
  "data": {
    "task_id": "string",
    "runninghub_task_id": "string",
    "status": "string",
    "results": [
      {
        "type": "string",
        "url": "string",
        "filename": "string",
        "metadata": {}
      }
    ]
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "string",
  "error": "string",
  "error_details": "string"
}
```

## Implementation Details

### Next.js Proxy Routes

All workflow endpoints are implemented as Next.js API routes that proxy requests to the Python backend:

- `src/app/api/workflow/list/route.ts`
- `src/app/api/workflow/execute/route.ts`
- `src/app/api/workflow/status/[taskId]/route.ts`
- `src/app/api/workflow/results/[taskId]/route.ts`

### Frontend Service

The frontend uses `WorkflowService` class located in `src/components/video/services/workflowService.ts` to interact with these API endpoints. The service automatically routes requests through the Next.js proxy routes.

### Error Handling

All proxy routes include comprehensive error handling:
- Request timeouts (30-60 seconds depending on operation)
- Backend service connectivity errors
- JSON parsing errors
- HTTP status code propagation
- Detailed error logging

### CORS Headers

All endpoints include appropriate CORS headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Usage Example

```typescript
import { workflowService } from '@/components/video/services/workflowService';

// Get available workflows
const workflows = await workflowService.getAvailableWorkflows();

// Execute a workflow
const result = await workflowService.executeWorkflow({
  workflowId: 'my-workflow-id',
  parameters: [
    {
      nodeId: 'node1',
      fieldName: 'prompt',
      fieldValue: 'Generate a creative video'
    }
  ],
  taskId: 'unique-task-id'
});

// Check status
const status = await workflowService.getTaskStatus(result.taskId);

// Get results when completed
if (status.status === 'completed') {
  const results = await workflowService.getTaskResults(result.taskId);
}
```

## Logging

All workflow API operations include detailed logging:
- Request parameters (sanitized)
- Response status and timing
- Error details and stack traces
- Task execution progress

Logs are structured and include contextual information for debugging and monitoring.