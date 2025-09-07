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
    "instanceType": "plus",
      "nodeInfoList": [
        {
          "nodeId": "56",
          "fieldName": "prompt",
          "fieldValue": "可爱的动漫女孩...",
          "description": "文本输入框",
          "uiConfig": {
            "inputType": "textarea",
            "validation": {
              "required": true,
              "maxLength": 1000
            },
            "helpText": "描述您想要生成的图片内容，越详细效果越好"
          }
        },
        {
          "nodeId": "52",
          "fieldName": "aspect_ratio",
          "fieldValue": "3:4 (Golden Ratio)",
          "description": "输出宽高比",
          "uiConfig": {
            "inputType": "select",
            "options": [
              {
                "label": "1:1 (Perfect Square)",
                "value": "1:1 (Perfect Square)",
                "description": "完美正方形，适合头像和社交媒体"
              },
              {
                "label": "3:4 (Golden Ratio)",
                "value": "3:4 (Golden Ratio)",
                "description": "黄金比例，适合人像摄影",
                "default": true
              },
              {
                "label": "16:9 (Panorama)",
                "value": "16:9 (Panorama)",
                "description": "全景比例"
              },
              {
                "label": "21:9 (Epic Ultrawide)",
                "value": "21:9 (Epic Ultrawide)",
                "description": "史诗级超宽屏"
              }
            ],
            "validation": {
              "required": true
            },
            "helpText": "选择图片的宽高比例，这将影响最终生成图片的尺寸和构图"
          }
        }
      ]
  }
}
```

#### UI Configuration

Each node in the `nodeInfoList` can optionally include a `uiConfig` field that provides frontend-specific configuration for parameter input rendering:

```json
{
  "uiConfig": {
    "inputType": "select",           // Input component type
    "options": [                     // Available options (for select inputs)
      {
        "label": "Display Label",    // User-visible label
        "value": "actual_value",     // Value sent to API
        "description": "Help text",  // Optional tooltip/description
        "default": true              // Whether this is the default option
      }
    ],
    "validation": {                  // Validation rules
      "required": true,              // Field is required
      "min": 1,                      // Minimum value (numbers)
      "max": 10,                     // Maximum value (numbers)
      "step": 1,                     // Step value (numbers)
      "minLength": 5,                // Minimum text length
      "maxLength": 1000,             // Maximum text length
      "pattern": "^[a-zA-Z]+$"       // Regex pattern
    },
    "placeholder": "Enter text...",  // Input placeholder
    "helpText": "Guidance text",     // Help text displayed below input
    "defaultValue": "default"        // Default value override
  }
}
```

**Supported Input Types:**
- `text`: Single-line text input
- `textarea`: Multi-line text input
- `number`: Numeric input with validation
- `select`: Dropdown selection with predefined options
- `multiselect`: Multiple selection dropdown
- `slider`: Range slider for numeric values
- `toggle`: Boolean toggle switch

**Backward Compatibility:**
- Nodes without `uiConfig` will use legacy rendering based on `fieldName`
- All existing workflows continue to work without modification

#### Instance Type Support

Workflows can optionally specify an `instanceType` field to control the RunningHub execution environment:

```json
{
  "workflowName": "t2v-wan2.2",
  "workflowType": "TEXT-2-VIDEO",
  "instanceType": "plus",
  ...
}
```

**Supported Instance Types:**
- `plus`: High-performance instance for demanding workflows
- `standard`: Default instance type (used when not specified)

**Behavior:**
- When `instanceType` is specified, it's automatically passed to RunningHub API
- Workflows without `instanceType` use the default RunningHub instance
- Instance type affects processing speed and resource allocation

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

##### Common Error Response Format

All error responses follow this structure:

```json
{
  "success": false,
  "message": "Error description",
  "timestamp": "2025-01-07T15:08:02.455031",
  "data": null,
  "error_code": "HTTP_XXX",
  "error_details": {
    "status_code": 500
  }
}
```

##### Specific Error Cases

**Task Queue Full (TASK_QUEUE_MAXED)**

When the system task queue is at maximum capacity:

```json
{
  "success": false,
  "message": "Workflow execution failed: TASK_QUEUE_MAXED",
  "timestamp": "2025-01-07T15:08:02.455031",
  "data": null,
  "error_code": "HTTP_500",
  "error_details": {
    "status_code": 500
  }
}
```

This error indicates that the system is currently processing the maximum number of concurrent tasks. Users should wait a few minutes before retrying their request.

**Invalid Parameters**

```json
{
  "success": false,
  "message": "Invalid parameters for workflow execution",
  "timestamp": "2025-01-07T15:08:02.455031",
  "data": null,
  "error_code": "HTTP_400",
  "error_details": {
    "status_code": 400,
    "validation_errors": ["Missing required parameter: prompt"]
  }
}
```

**Workflow Not Found**

```json
{
  "success": false,
  "message": "Workflow not found: invalid_workflow_id",
  "timestamp": "2025-01-07T15:08:02.455031",
  "data": null,
  "error_code": "HTTP_404",
  "error_details": {
    "status_code": 404
  }
}
```

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
| instanceType | string | Optional RunningHub instance type (e.g., 'plus') |
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