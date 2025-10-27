# Workflow Chat Integration - Backend API

## Overview

Backend support for workflow-chat integration, enabling AI Chat to execute workflows and stream results in real-time.

## Architecture

The workflow-chat integration uses a proxy pattern:
1. Frontend calls Next.js API route (`/api/chat/workflow`)
2. Next.js route acts as a proxy and orchestrator
3. Actual workflow execution happens via existing workflow execution infrastructure
4. Results are streamed back to frontend via Server-Sent Events (SSE)

## Existing Backend Endpoints

The integration leverages existing workflow endpoints:

### GET /api/workflow/agent/load/{user_id}

Load all workflows for a user.

**Implementation**: `app/routers/workflow_router.py::load_agent_workflows`

**Response**:
```python
{
    "success": bool,
    "message": str,
    "data": [
        {
            "id": str,
            "user_id": str,
            "workflow_id": str,
            "workflow_name": str,
            "workflow_description": str,
            "nodes": List[dict],
            "connections": List[dict],
            "is_active": bool,
            "is_template": bool,
            "version": int,
            "created_at": str,
            "updated_at": str,
            "last_executed_at": str
        }
    ]
}
```

### POST /api/workflow/execute

Execute a workflow (existing endpoint, can be extended for chat integration).

**Implementation**: `app/routers/workflow_router.py::execute_workflow`

**Request**:
```python
{
    "workflow_id": str,
    "parameters": List[{
        "node_id": str,
        "field_name": str,
        "field_value": any
    }],
    "task_id": str
}
```

## Frontend Proxy Layer

The Next.js proxy (`/api/chat/workflow`) handles:
- Request validation
- Workflow loading
- Execution orchestration
- SSE streaming to frontend
- Error handling and logging

## Data Flow

```
User Input
    ↓
Frontend (ChatInterface)
    ↓
Next.js API (/api/chat/workflow)
    ↓
Workflow Execution (simulated/real)
    ↓
SSE Stream
    ↓
Frontend (Real-time UI updates)
    ↓
Final Result Display
```

## Logging

### Backend Logs

**Service**: `backend-services/basic-service/app/routers/workflow_router.py`

Logs include:
- Workflow loading requests
- Execution requests
- Parameter validation
- Execution progress
- Completion/errors

**Log Format**:
```python
logger.info(f"API request: Load agent workflows for user: {user_id}")
logger.info(f"Agent workflows loaded successfully", {
    "user_id": user_id,
    "workflows_count": workflows_count
})
```

### Frontend Proxy Logs

**Service**: `src/app/api/chat/workflow/route.ts`

Logs include:
- Request receipt
- Workflow ID validation
- User input processing
- Stream events
- Errors

**Log Format**:
```typescript
console.log('[Workflow Chat API] Request received:', {
  workflowId,
  userInputLength: userInput?.length || 0,
  timestamp: new Date().toISOString()
});
```

## Error Handling

### Error Types

1. **Validation Errors** (400)
   - Missing workflow ID
   - Missing user input
   - Invalid parameters

2. **Not Found Errors** (404)
   - Workflow not found
   - User not found

3. **Execution Errors** (500)
   - Workflow execution failed
   - Node execution error
   - Stream error

### Error Response Format

```json
{
  "error": "Error description",
  "details": "Detailed error message"
}
```

## Security Considerations

1. **Authentication**:
   - User ID validation required
   - Workflow ownership verification
   - Session-based authentication recommended

2. **Authorization**:
   - Users can only access their own workflows
   - Workflow execution permissions checked

3. **Input Validation**:
   - User input sanitization
   - Workflow ID validation
   - Parameter type checking

## Performance

### Optimization Strategies

1. **Caching**:
   - Cache workflow definitions
   - Cache user workflow lists
   - TTL-based invalidation

2. **Streaming**:
   - Use SSE for efficient real-time updates
   - Minimize payload size
   - Chunk large outputs

3. **Resource Management**:
   - Limit concurrent executions
   - Timeout long-running workflows
   - Clean up resources on completion

## Database Schema

### Agent Workflows Table

The existing `agent_workflows` table supports this integration:

```sql
CREATE TABLE agent_workflows (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL,
    workflow_id VARCHAR NOT NULL,
    workflow_name VARCHAR NOT NULL,
    workflow_description TEXT,
    nodes JSONB NOT NULL,
    connections JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_template BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_executed_at TIMESTAMP,
    UNIQUE(user_id, workflow_id)
);
```

## Testing

### Unit Tests

Test files should be created in:
- `backend-services/basic-service/tests/test_workflow_chat_integration.py`

Test cases:
1. Load workflows for user
2. Execute workflow with user input
3. Handle missing workflow
4. Handle execution errors
5. Validate streaming format

### Integration Tests

Test the full flow:
1. Frontend → Next.js API → Backend
2. Workflow execution
3. SSE streaming
4. Error scenarios

## Monitoring

### Metrics to Track

1. **Usage Metrics**:
   - Workflow executions via chat
   - Average execution time
   - Success/failure rate

2. **Performance Metrics**:
   - API response time
   - Stream latency
   - Database query time

3. **Error Metrics**:
   - Error rate by type
   - Failed executions
   - Timeout occurrences

### Logging Best Practices

1. Log all workflow executions with:
   - User ID
   - Workflow ID
   - Timestamp
   - Duration
   - Status

2. Log errors with:
   - Error type
   - Stack trace
   - Request context
   - User info

## Future Enhancements

### Backend Improvements

1. **Real Workflow Execution**:
   - Replace simulation with actual workflow executor
   - Integrate with WorkflowExecutor class
   - Support all node types

2. **Advanced Features**:
   - Workflow execution pause/resume
   - Retry failed nodes
   - Execution history persistence
   - Metrics collection

3. **Performance Optimizations**:
   - Workflow caching
   - Connection pooling
   - Async execution
   - Result pagination

## Related Files

### Backend
- `backend-services/basic-service/app/routers/workflow_router.py` - Main workflow routes
- `backend-services/basic-service/app/services/agent_workflow_service.py` - Workflow service
- `backend-services/basic-service/app/models/workflow_models.py` - Data models

### Frontend
- `src/app/api/chat/workflow/route.ts` - Next.js proxy endpoint
- `src/components/chat/ChatInterface.tsx` - Chat interface with workflow support
- `src/components/chat/WorkflowSelectionModal.tsx` - Workflow selection UI

## API Examples

### Load User Workflows

```bash
curl -X GET "http://localhost:8000/api/workflow/agent/load/{user_id}" \
  -H "Content-Type: application/json"
```

### Execute Workflow via Chat

```bash
curl -X POST "http://localhost:3000/api/chat/workflow" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "workflow-123",
    "userInput": "Process this text",
    "messages": []
  }'
```

## Deployment Notes

### Environment Variables

No additional environment variables required beyond existing workflow configuration.

### Dependencies

Uses existing dependencies:
- FastAPI (backend)
- Next.js (frontend proxy)
- PostgreSQL (workflow storage)

### Deployment Checklist

- [ ] Backend workflow endpoints deployed
- [ ] Frontend proxy endpoints deployed
- [ ] Database migrations applied
- [ ] Workflow permissions configured
- [ ] Monitoring enabled
- [ ] Logging configured
- [ ] Error tracking setup

## Support

For issues or questions:
1. Check logs in `backend-services/basic-service/logs/app.log`
2. Review frontend console logs
3. Verify workflow exists and is accessible
4. Check database connectivity
5. Validate user permissions


