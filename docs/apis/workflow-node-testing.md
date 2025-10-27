# Workflow Node Testing API

## Overview
This document describes the API endpoint for testing individual workflow nodes independently. This feature allows users to debug and verify node behavior before running the full workflow.

## Endpoint

### Test Node
**POST** `/api/workflow/test-node`

Test a single workflow node with provided input and configuration.

#### Request Body
```json
{
  "node_id": "string",           // Required: Unique identifier of the node
  "node_type": "string",         // Required: Type of node (start, text-input, chat-llm, pexels-video-search, end)
  "node_label": "string",        // Optional: Display label for the node
  "node_config": {},             // Required: Node-specific configuration object
  "input": {}                    // Optional: Input data to pass to the node
}
```

#### Response (Success)
```json
{
  "success": true,
  "message": "Node test completed successfully",
  "output": {},                  // Node output data
  "execution_time_ms": 1234,     // Execution time in milliseconds
  "node_id": "string",           // Echo of node_id
  "node_type": "string"          // Echo of node_type
}
```

#### Response (Error)
```json
{
  "success": false,
  "error": "Error message description",
  "execution_time_ms": 123
}
```

## Node Types

### 1. Start Node
**Type:** `start`

**Configuration:**
```json
{
  "input": "string"  // Optional: Initial input text
}
```

**Input:** Any object or null

**Output:**
```json
{
  "text": "string",    // Input content
  "message": "Start node executed",
  "source": "test"
}
```

---

### 2. Text Input Node
**Type:** `text-input`

**Configuration:**
```json
{
  "content": "string"  // Required: Text content to output
}
```

**Input:** Any object (passed through)

**Output:**
```json
{
  "text": "string",      // Content from config
  "previousInput": {}    // Input that was received
}
```

---

### 3. Chat LLM Node
**Type:** `chat-llm`

**Configuration:**
```json
{
  "model": "string",        // Required: LLM model identifier
  "systemPrompt": "string", // Required: System prompt for LLM
  "temperature": 0.7,       // Optional: Temperature (0-2)
  "maxTokens": 2000        // Optional: Max tokens to generate
}
```

**Input:** String or object with `text`, `message`, or other fields

**Output:**
```json
{
  "text": "string",         // LLM response text
  "llmResponse": "string",  // Same as text
  "previousInput": {},      // Input that was received
  "model": "string"        // Model used
}
```

---

### 4. Pexels Video Search Node
**Type:** `pexels-video-search`

**Configuration:**
```json
{
  "keywords": "string",  // Required: Search keywords
  "count": 5            // Optional: Number of videos to return (default: 5)
}
```

**Input:** String or object with `keywords`, `text`, or `message`

**Output:**
```json
{
  "videos": [              // Array of video objects
    {
      "id": "number",
      "url": "string",     // Pexels video page URL
      "videoUrl": "string", // Direct video URL
      "thumbnail": "string",
      "width": "number",
      "height": "number",
      "duration": "number",
      "user": "object"
    }
  ],
  "videoUrls": ["string"], // Array of direct video URLs
  "totalFound": "number",  // Total videos found in search
  "keywords": "string",    // Keywords used
  "count": "number"        // Number of videos returned
}
```

---

### 5. End Node
**Type:** `end`

**Configuration:** Empty object `{}`

**Input:** Any object

**Output:**
```json
{
  "finalResult": {},  // Input that was received
  "message": "End node executed"
}
```

## Usage Examples

### Example 1: Test Text Input Node
```bash
curl -X POST http://localhost:3000/api/workflow/test-node \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "node-123",
    "node_type": "text-input",
    "node_label": "My Text Input",
    "node_config": {
      "content": "Hello, world!"
    },
    "input": {}
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Node test completed successfully",
  "output": {
    "text": "Hello, world!",
    "previousInput": {}
  },
  "execution_time_ms": 45,
  "node_id": "node-123",
  "node_type": "text-input"
}
```

---

### Example 2: Test Chat LLM Node
```bash
curl -X POST http://localhost:3000/api/workflow/test-node \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "node-456",
    "node_type": "chat-llm",
    "node_config": {
      "model": "gpt-4",
      "systemPrompt": "You are a helpful assistant.",
      "temperature": 0.7,
      "maxTokens": 1000
    },
    "input": {
      "text": "What is the capital of France?"
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Node test completed successfully",
  "output": {
    "text": "The capital of France is Paris.",
    "llmResponse": "The capital of France is Paris.",
    "previousInput": {
      "text": "What is the capital of France?"
    },
    "model": "gpt-4"
  },
  "execution_time_ms": 2340,
  "node_id": "node-456",
  "node_type": "chat-llm"
}
```

---

### Example 3: Test Pexels Video Search Node
```bash
curl -X POST http://localhost:3000/api/workflow/test-node \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "node-789",
    "node_type": "pexels-video-search",
    "node_config": {
      "keywords": "sunset beach",
      "count": 3
    },
    "input": null
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Node test completed successfully",
  "output": {
    "videos": [
      {
        "id": 12345,
        "url": "https://www.pexels.com/video/...",
        "videoUrl": "https://player.vimeo.com/...",
        "thumbnail": "https://images.pexels.com/...",
        "width": 1920,
        "height": 1080,
        "duration": 15,
        "user": { "name": "Photographer Name" }
      }
    ],
    "videoUrls": ["https://player.vimeo.com/..."],
    "totalFound": 150,
    "keywords": "sunset beach",
    "count": 3
  },
  "execution_time_ms": 856,
  "node_id": "node-789",
  "node_type": "pexels-video-search"
}
```

## Error Responses

### Missing Required Fields
```json
{
  "success": false,
  "error": "Missing required fields: node_id and node_type are required"
}
```
**Status Code:** 400 Bad Request

---

### Unknown Node Type
```json
{
  "success": false,
  "error": "Unknown node type: invalid-type"
}
```
**Status Code:** 400 Bad Request

---

### Node Configuration Error
```json
{
  "success": false,
  "error": "Text Input node requires content configuration"
}
```
**Status Code:** 500 Internal Server Error

---

### API Call Failure (e.g., LLM or Pexels)
```json
{
  "success": false,
  "error": "LLM API request failed with status 503"
}
```
**Status Code:** 500 Internal Server Error

## Frontend Integration

The test functionality is integrated into the node configuration panels through the `NodeTestPanel` component.

### Usage in Config Panels
```tsx
import NodeTestPanel from './NodeTestPanel';

// In your config panel component:
<NodeTestPanel
  nodeId={nodeId}
  nodeType="text-input"
  nodeLabel="Text Input"
  nodeConfig={config}
/>
```

### Features
- Editable JSON input with smart defaults for each node type
- One-click test execution
- JSON output display
- Error handling and display
- Collapsible interface
- Copy output to clipboard
- Apple-style gray-black color scheme

### Default Input Examples

Each node type comes with a pre-populated default input JSON to help users understand what data format is expected:

**Start Node:**
```json
{
  "text": "Hello, this is the workflow start"
}
```

**Text Input Node:**
```json
{
  "text": "Previous node output",
  "message": "Input from previous step"
}
```

**Chat LLM Node:**
```json
{
  "text": "What is artificial intelligence?",
  "message": "User question or prompt"
}
```

**Pexels Video Search Node:**
```json
{
  "keywords": "beautiful nature landscape",
  "text": "Search keywords from previous node"
}
```

**End Node:**
```json
{
  "result": "Final workflow output",
  "data": {
    "status": "completed",
    "output": "Processing result"
  }
}
```

## Best Practices

1. **Test nodes independently** before running full workflows to catch configuration issues early
2. **Use realistic input data** that matches what the node would receive in a workflow
3. **Check execution times** to identify performance bottlenecks
4. **Validate output format** matches expected structure for downstream nodes
5. **Test error cases** with invalid configurations to understand failure modes

## Logging

All test executions are logged with the following information:
- Node ID and type
- Execution duration
- Success/failure status
- Error messages (if applicable)

Check application logs for detailed debugging information:
```
[API] POST /api/workflow/test-node - Request received
[API] Test node request: { node_id, node_type, ... }
[API] Executing Start node
[API] Node test completed successfully: { duration, hasOutput }
```

## Security Considerations

- API endpoint is accessible without authentication (add auth if needed)
- LLM API calls use configured credentials
- Input data is validated before processing
- Execution timeouts prevent long-running tests
- No data persistence - all tests are ephemeral

## Future Enhancements

- Add execution history and caching
- Support for batch testing multiple nodes
- Performance profiling and metrics
- Test result comparison
- Mock data generation for testing

