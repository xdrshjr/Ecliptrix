# Workflow Execution API

## Overview
This API provides endpoints for executing creative workflows through the RunningHub service. It supports various workflow types including text-to-video, text-to-image, and other AI generation tasks.

## Base URL
```
{BACKEND_URL}/api/workflow
```

## Endpoints

### Execute Workflow
Execute a creative workflow with provided parameters.

**Endpoint:** `POST /execute`

**Request Body:**
```json
{
  "workflow_id": "string",
  "parameters": [
    {
      "node_id": "string",
      "field_name": "string", 
      "field_value": "any"
    }
  ],
  "task_id": "string (optional)"
}
```

**Request Parameters:**
- `workflow_id` (string, required): The RunningHub workflow ID to execute
- `parameters` (array, required): List of workflow parameters
  - `node_id` (string): The node identifier in the workflow
  - `field_name` (string): The parameter field name (e.g., "text", "prompt", "value")
  - `field_value` (any): The parameter value
- `task_id` (string, optional): Internal task ID for tracking

**Response:**
```json
{
  "success": true,
  "message": "Workflow {workflow_name} execution queued successfully",
  "data": {
    "workflow_id": "string",
    "workflow_name": "string", 
    "status": "RUNNING",
    "message": "Workflow execution started successfully",
    "task_id": "string",
    "runninghub_task_id": "string",
    "parameters": {},
    "timestamp": "2025-01-07T13:36:54.954Z",
    "net_wss_url": "string (optional)",
    "client_id": "string (optional)"
  }
}
```

**Response Fields:**
- `workflow_id`: The executed workflow ID
- `workflow_name`: Human-readable workflow name
- `status`: Current execution status (typically "RUNNING" for new tasks)
- `message`: Status message
- `task_id`: Internal task ID for tracking
- `runninghub_task_id`: **Critical field** - RunningHub task ID needed for polling status
- `parameters`: The parameters used for execution
- `timestamp`: Execution start timestamp
- `net_wss_url`: WebSocket URL for real-time updates (if available)
- `client_id`: Client identifier (if available)

**Error Responses:**

**400 Bad Request - Invalid Parameters:**
```json
{
  "success": false,
  "message": "Invalid parameters for workflow execution",
  "error_code": "INVALID_PARAMETERS"
}
```

**404 Not Found - Workflow Not Found:**
```json
{
  "success": false,
  "message": "Workflow not found: {workflow_id}",
  "error_code": "WORKFLOW_NOT_FOUND"
}
```

**500 Internal Server Error - Execution Failed:**
```json
{
  "success": false,
  "message": "Workflow execution failed: {error_details}",
  "error_code": "EXECUTION_FAILED"
}
```

**503 Service Unavailable - Queue Full:**
```json
{
  "success": false,
  "message": "TASK_QUEUE_MAXED: The task queue is currently full. Please try again later.",
  "error_code": "TASK_QUEUE_MAXED",
  "timestamp": "2025-01-07T13:36:54.954Z"
}
```

## Usage Examples

### Text-to-Video Generation
```bash
curl -X POST "{BACKEND_URL}/api/workflow/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_id": "1964379800901177345",
    "parameters": [
      {
        "node_id": "6",
        "field_name": "text",
        "field_value": "A beautiful sunset over the ocean"
      },
      {
        "node_id": "25", 
        "field_name": "value",
        "field_value": 50
      }
    ],
    "task_id": "task-1757251697186"
  }'
```

### Text-to-Image Generation
```bash
curl -X POST "{BACKEND_URL}/api/workflow/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_id": "flux_dev_workflow_id",
    "parameters": [
      {
        "node_id": "prompt_node",
        "field_name": "prompt", 
        "field_value": "A majestic mountain landscape"
      },
      {
        "node_id": "size_node",
        "field_name": "aspect_ratio",
        "field_value": "16:9"
      }
    ]
  }'
```

## Important Notes

### Critical Field: runninghub_task_id
The `runninghub_task_id` field in the response is **critical** for the frontend polling mechanism. This ID is required to:
- Poll task status using `/api/workflow/status/{runninghub_task_id}`
- Retrieve task results using `/api/workflow/results/{runninghub_task_id}`

### Field Name Consistency
- **Backend Response**: Uses snake_case field names (`runninghub_task_id`, `workflow_id`, etc.)
- **Frontend Processing**: Converts to camelCase (`runninghubTaskId`, `workflowId`, etc.)

### Error Handling
The API includes comprehensive error handling for:
- Invalid workflow IDs
- Missing or invalid parameters
- RunningHub API failures
- Queue capacity limits (TASK_QUEUE_MAXED)

### Polling Workflow
After successful execution:
1. Extract `runninghub_task_id` from response
2. Use it to poll status: `GET /api/workflow/status/{runninghub_task_id}`
3. When complete, get results: `GET /api/workflow/results/{runninghub_task_id}`

## Related Endpoints
- `GET /workflow/list` - Get available workflows
- `GET /workflow/{workflow_id}` - Get workflow details
- `GET /workflow/status/{runninghub_task_id}` - Check task status
- `GET /workflow/results/{runninghub_task_id}` - Get task results
- `GET /workflow/health` - Service health check