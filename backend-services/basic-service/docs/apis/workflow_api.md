# Workflow API Documentation

## Overview

The Workflow API provides endpoints for managing and executing creative workflows. This API allows clients to discover available workflows, retrieve workflow configurations, and execute workflows with custom parameters.

## Base URL

```
/api/workflow
```

## Endpoints

### 1. Get Available Workflows

**GET** `/api/workflow/list`

Retrieves all available creative workflows with their configurations.

#### Response

```json
{
  "success": true,
  "message": "Successfully retrieved N available workflows",
  "data": [
    {
      "workflowName": "t2v-wan2.2",
      "workflowType": "TEXT-2-VIDEO",
      "showNameCh": "wan2 文生视频",
      "showNameEn": "wan2 text-video",
      "workflowId": "1964379800901177345",
      "description": "出色的文生视频功能",
      "icon": "https://example.com/icon.png",
      "nodeInfoList": [
        {
          "nodeId": "50",
          "fieldName": "value",
          "fieldValue": "2",
          "description": "设置时长（秒）"
        }
      ]
    }
  ]
}
```

#### Error Responses

- **404 Not Found**: Workflow configuration file not found
- **500 Internal Server Error**: Failed to retrieve workflows

### 2. Get Workflow by ID

**GET** `/api/workflow/{workflow_id}`

Retrieves a specific workflow by its ID.

#### Parameters

- `workflow_id` (path): The unique identifier of the workflow

#### Response

```json
{
  "success": true,
  "message": "Successfully retrieved workflow: workflow_name",
  "data": {
    "workflowName": "flux",
    "workflowType": "TEXT-2-IMG",
    "showNameCh": "flux 文生图",
    "showNameEn": "flux text-img",
    "workflowId": "1964363754437754881",
    "description": "出色的文生图功能",
    "icon": "https://example.com/icon.png",
    "nodeInfoList": [
      {
        "nodeId": "56",
        "fieldName": "prompt",
        "fieldValue": "可爱的动漫女孩...",
        "description": "文本输入框"
      }
    ]
  }
}
```

#### Error Responses

- **404 Not Found**: Workflow not found
- **500 Internal Server Error**: Failed to retrieve workflow

### 3. Execute Workflow

**POST** `/api/workflow/execute`

Executes a creative workflow with provided parameters.

#### Request Body

```json
{
  "workflow_id": "1964379800901177345",
  "parameters": [
    {
      "node_id": "50",
      "field_name": "value",
      "field_value": "5"
    },
    {
      "node_id": "90",
      "field_name": "text",
      "field_value": "A beautiful landscape with mountains"
    }
  ],
  "task_id": "optional_task_identifier"
}
```

#### Response

```json
{
  "success": true,
  "message": "Workflow workflow_name execution queued successfully",
  "data": {
    "workflow_id": "1964379800901177345",
    "workflow_name": "t2v-wan2.2",
    "status": "queued",
    "message": "Workflow execution has been queued (implementation pending)",
    "task_id": "optional_task_identifier",
    "parameters": {
      "50": "5",
      "90": "A beautiful landscape with mountains"
    },
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

#### Error Responses

- **400 Bad Request**: Invalid parameters for workflow execution
- **404 Not Found**: Workflow not found
- **500 Internal Server Error**: Failed to execute workflow

### 4. Check Workflow Task Status

**GET** `/api/workflow/status/{runninghub_task_id}`

Checks the status of a workflow task by RunningHub task ID.

#### Parameters

- `runninghub_task_id` (path): The RunningHub task ID to check status for

#### Response

```json
{
  "success": true,
  "message": "Status retrieved successfully",
  "data": {
    "runninghub_task_id": "task_12345",
    "status": "RUNNING",
    "task_id": "optional_task_identifier"
  }
}
```

#### Status Values

- `RUNNING`: Task is currently being processed
- `PENDING`: Task is queued and waiting to be processed
- `SUCCESS` / `COMPLETED` / `FINISHED` / `DONE`: Task completed successfully
- `FAILED` / `ERROR`: Task failed to complete

#### Error Responses

- **500 Internal Server Error**: Failed to check task status

### 5. Get Workflow Task Results

**GET** `/api/workflow/results/{runninghub_task_id}`

Gets the results of a completed workflow task by RunningHub task ID.

#### Parameters

- `runninghub_task_id` (path): The RunningHub task ID to get results for

#### Response

```json
{
  "success": true,
  "message": "Results retrieved successfully",
  "data": {
    "runninghub_task_id": "task_12345",
    "status": "SUCCESS",
    "results": [
      {
        "nodeId": "output_node_1",
        "fileUrl": "https://example.com/result1.png",
        "fileType": "png",
        "taskCostTime": 15.5
      },
      {
        "nodeId": "output_node_2", 
        "fileUrl": "https://example.com/result2.mp4",
        "fileType": "mp4",
        "taskCostTime": 15.5
      }
    ],
    "task_id": "optional_task_identifier"
  }
}
```

#### Error Responses

- **500 Internal Server Error**: Failed to retrieve task results

### 6. Workflow Health Check

**GET** `/api/workflow/health`

Checks the health status of the workflow service.

#### Response

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

#### Error Responses

- **503 Service Unavailable**: Workflow service is unhealthy

## Data Models

### WorkflowInfo

| Field | Type | Description |
|-------|------|-------------|
| workflowName | string | Internal workflow name |
| workflowType | string | Type of workflow (e.g., TEXT-2-VIDEO, TEXT-2-IMG) |
| showNameCh | string | Chinese display name |
| showNameEn | string | English display name |
| workflowId | string | Unique workflow identifier |
| description | string | Workflow description |
| icon | string | URL to workflow icon/thumbnail |
| nodeInfoList | array | List of workflow parameters |

### WorkflowNodeInfo

| Field | Type | Description |
|-------|------|-------------|
| nodeId | string | Node identifier in the workflow |
| fieldName | string | Field name for the parameter |
| fieldValue | any | Default value for the parameter |
| description | string | Human-readable description of the parameter |

### WorkflowParameter

| Field | Type | Description |
|-------|------|-------------|
| node_id | string | Node identifier |
| field_name | string | Field name |
| field_value | any | Parameter value |

## Usage Examples

### JavaScript/TypeScript

```typescript
// Get available workflows
const response = await fetch('/api/workflow/list');
const workflows = await response.json();

// Execute a workflow
const executionRequest = {
  workflow_id: '1964379800901177345',
  parameters: [
    {
      node_id: '50',
      field_name: 'value',
      field_value: '5'
    }
  ],
  task_id: 'my-task-123'
};

const executionResponse = await fetch('/api/workflow/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(executionRequest)
});

const executionResult = await executionResponse.json();
const runninghubTaskId = executionResult.data.runninghub_task_id;

// Poll task status every 5 seconds
const pollStatus = async () => {
  const statusResponse = await fetch(`/api/workflow/status/${runninghubTaskId}`);
  const statusResult = await statusResponse.json();
  
  if (statusResult.data.status === 'SUCCESS') {
    // Get results
    const resultsResponse = await fetch(`/api/workflow/results/${runninghubTaskId}`);
    const results = await resultsResponse.json();
    console.log('Task completed:', results.data.results);
  } else if (statusResult.data.status === 'FAILED') {
    console.log('Task failed');
  } else {
    // Continue polling
    setTimeout(pollStatus, 5000);
  }
};

// Start polling
pollStatus();
```

### Python

```python
import requests
import time

# Get available workflows
response = requests.get('/api/workflow/list')
workflows = response.json()

# Execute a workflow
execution_request = {
    'workflow_id': '1964379800901177345',
    'parameters': [
        {
            'node_id': '50',
            'field_name': 'value',
            'field_value': '5'
        }
    ],
    'task_id': 'my-task-123'
}

execution_response = requests.post('/api/workflow/execute', json=execution_request)
execution_result = execution_response.json()
runninghub_task_id = execution_result['data']['runninghub_task_id']

# Poll task status every 5 seconds
while True:
    status_response = requests.get(f'/api/workflow/status/{runninghub_task_id}')
    status_result = status_response.json()
    
    if status_result['data']['status'] == 'SUCCESS':
        # Get results
        results_response = requests.get(f'/api/workflow/results/{runninghub_task_id}')
        results = results_response.json()
        print('Task completed:', results['data']['results'])
        break
    elif status_result['data']['status'] == 'FAILED':
        print('Task failed')
        break
    else:
        # Continue polling
        time.sleep(5)
```

## Error Handling

All endpoints return standardized error responses with the following structure:

```json
{
  "success": false,
  "message": "Error description",
  "error_code": "ERROR_CODE",
  "error_details": {
    "detail": "Detailed error information"
  }
}
```

## Rate Limiting

Currently, no rate limiting is implemented. Consider implementing rate limiting for production use.

## Authentication

Currently, no authentication is required. Consider implementing authentication for production use.

## Notes

- Workflow execution is fully implemented with RunningHub integration
- Status polling should be performed every 5 seconds after workflow execution
- Completed tasks provide downloadable file URLs in the results
- Workflow configurations are loaded from `workflow/workflow-config.json`
- All timestamps are in ISO 8601 format
- Parameter validation is performed against the workflow's nodeInfoList configuration
- Task results are cached and can be retrieved multiple times using the same RunningHub task ID