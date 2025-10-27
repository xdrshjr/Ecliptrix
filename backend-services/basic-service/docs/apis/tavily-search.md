# Tavily Search API Documentation

## Overview

The Tavily Search API provides AI-powered web search functionality using the Tavily API service. It supports multiple API keys with automatic rotation and fallback mechanisms to ensure reliability.

**Base URL**: `/api/workflow/`

**Service**: `tavily_search_service.py`

**Models**: `tavily_models.py`

## Features

- 🔍 AI-powered web search using Tavily API
- 🔄 Automatic API key rotation with fallback
- 📊 Configurable result count (1-50)
- 🎯 Basic and advanced search depth options
- 🖼️ Optional image results
- 💬 Optional AI-generated answers
- 📝 Detailed logging and error handling

## Endpoints

### 1. Tavily Search

Perform a web search using Tavily AI-powered search API.

**Endpoint**: `POST /api/workflow/tavily-search`

#### Request

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "keywords": "artificial intelligence trends 2024",
  "count": 5,
  "search_depth": "basic",
  "include_images": false,
  "include_answer": false
}
```

**Parameters**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `keywords` | string | Yes | - | Search query/keywords |
| `count` | integer | No | 5 | Number of results to return (1-50) |
| `search_depth` | string | No | "basic" | Search depth: "basic" or "advanced" |
| `include_images` | boolean | No | false | Whether to include image results |
| `include_answer` | boolean | No | false | Whether to include AI-generated answer |

#### Response

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Successfully found 5 results",
  "query": "artificial intelligence trends 2024",
  "results": [
    {
      "title": "Top AI Trends in 2024",
      "url": "https://example.com/ai-trends-2024",
      "content": "Artificial intelligence continues to evolve with groundbreaking developments in machine learning, natural language processing, and generative AI...",
      "score": 0.95
    },
    {
      "title": "The Future of AI: 2024 Predictions",
      "url": "https://example.com/future-ai-2024",
      "content": "As we move into 2024, AI technologies are expected to transform industries...",
      "score": 0.92
    }
  ],
  "total_results": 5,
  "answer": null,
  "images": null,
  "api_key_used": "tvly-dev...xpA"
}
```

**Error Response (500 Internal Server Error)**:
```json
{
  "success": false,
  "message": "All API keys failed. Errors: ...",
  "query": "artificial intelligence trends 2024",
  "results": [],
  "total_results": 0,
  "errors": [
    "API key tvly-dev...xpA: API returned status 401: Unauthorized",
    "API key tvly-dev...is9: Request timeout after 30 seconds"
  ]
}
```

**Validation Error (400 Bad Request)**:
```json
{
  "detail": [
    {
      "loc": ["body", "keywords"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

### 2. Test Node

Test a single workflow node independently, including Tavily Search nodes.

**Endpoint**: `POST /api/workflow/test-node`

#### Request

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "node_id": "node-1234567890",
  "node_type": "tavily-search",
  "node_label": "Tavily Search",
  "node_config": {
    "keywords": "machine learning algorithms",
    "count": 5
  },
  "input": {
    "keywords": "deep learning neural networks"
  }
}
```

**Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `node_id` | string | Yes | Unique ID of the node |
| `node_type` | string | Yes | Type of node (e.g., "tavily-search") |
| `node_label` | string | Yes | Display label for the node |
| `node_config` | object | Yes | Node configuration |
| `input` | object | Yes | Input data for the node |

#### Response

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Found 5 search results",
  "output": {
    "results": [
      {
        "title": "Understanding Deep Learning",
        "url": "https://example.com/deep-learning",
        "content": "Deep learning is a subset of machine learning...",
        "score": 0.98
      }
    ],
    "count": 5,
    "keywords": "deep learning neural networks"
  },
  "error": null
}
```

**Error Response (500 Internal Server Error)**:
```json
{
  "success": false,
  "message": "Node test failed",
  "output": {},
  "error": "Keywords are required for Tavily Search node"
}
```

## Configuration

### Environment Variables

The Tavily Search service requires the following environment variable to be configured in `.env`:

```bash
# Tavily API Keys (comma-separated for rotation)
TAVILY_API_KEYS=tvly-dev-key1,tvly-dev-key2,tvly-dev-key3,tvly-dev-key4,tvly-dev-key5
```

**API Key Rotation**:
- The service automatically rotates through available API keys
- If one key fails, it tries the next one
- Rotation continues until a successful response or all keys are exhausted

### Service Configuration

**File**: `app/services/tavily_search_service.py`

**Key Features**:
- API endpoint: `https://api.tavily.com/search`
- Request timeout: 30 seconds
- Automatic key rotation on failure
- Comprehensive error logging

## Usage Examples

### Example 1: Basic Search

Search for general information:

```python
import requests

url = "http://localhost:8000/api/workflow/tavily-search"
payload = {
    "keywords": "climate change solutions",
    "count": 10
}

response = requests.post(url, json=payload)
data = response.json()

if data["success"]:
    for result in data["results"]:
        print(f"Title: {result['title']}")
        print(f"URL: {result['url']}")
        print(f"Content: {result['content'][:100]}...")
        print("---")
```

### Example 2: Advanced Search with Images

Search with additional options:

```python
import requests

url = "http://localhost:8000/api/workflow/tavily-search"
payload = {
    "keywords": "sustainable architecture",
    "count": 5,
    "search_depth": "advanced",
    "include_images": true,
    "include_answer": true
}

response = requests.post(url, json=payload)
data = response.json()

if data["success"]:
    # AI-generated answer
    if data["answer"]:
        print(f"AI Answer: {data['answer']}")
    
    # Search results
    for result in data["results"]:
        print(f"Title: {result['title']}")
        print(f"URL: {result['url']}")
    
    # Images
    if data["images"]:
        print(f"Found {len(data['images'])} images")
```

### Example 3: Workflow Node Integration

Using Tavily Search in a workflow:

```typescript
// Frontend: Add Tavily Search node to workflow
const tavilyNode = {
  id: 'node-tavily-1',
  type: 'tavily-search',
  position: { x: 300, y: 200 },
  data: {
    label: 'Tavily Search',
    type: 'tavily-search',
    config: {
      keywords: 'web3 blockchain',
      count: 5
    }
  }
};

// The node will execute during workflow execution
// Input can be provided dynamically from previous nodes
```

### Example 4: Node Testing

Test a Tavily Search node before running the full workflow:

```typescript
// Frontend: Test node independently
const testRequest = {
  node_id: 'node-tavily-1',
  node_type: 'tavily-search',
  node_label: 'Tavily Search',
  node_config: {
    keywords: 'quantum computing',
    count: 3
  },
  input: {
    keywords: 'quantum algorithms' // Override config keywords
  }
};

const response = await fetch('/api/workflow/test-node', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testRequest)
});

const result = await response.json();
if (result.success) {
  console.log('Test Results:', result.output);
}
```

## Error Handling

### Common Errors

1. **Empty Keywords**
   - **Status**: 400 Bad Request
   - **Message**: "Keywords cannot be empty"
   - **Solution**: Provide valid search keywords

2. **All API Keys Failed**
   - **Status**: 500 Internal Server Error
   - **Message**: "All API keys failed. Errors: ..."
   - **Solution**: Check API key validity and Tavily service status

3. **Request Timeout**
   - **Error**: "Request timeout after 30 seconds"
   - **Solution**: Check network connectivity or try again

4. **Invalid Search Depth**
   - **Status**: 422 Validation Error
   - **Message**: "Search depth must be either 'basic' or 'advanced'"
   - **Solution**: Use only allowed values

### Error Response Structure

All errors follow a consistent structure:

```json
{
  "success": false,
  "message": "Error description",
  "query": "original query",
  "results": [],
  "total_results": 0,
  "errors": ["Detailed error 1", "Detailed error 2"]
}
```

## Logging

### Log Levels

The service logs at different levels:

- **INFO**: Normal operations (search requests, successful responses)
- **DEBUG**: Detailed information (API request/response details)
- **WARNING**: Recoverable issues (single API key failure)
- **ERROR**: Critical errors (all API keys failed)

### Sample Log Output

```
[2024-01-15 10:30:45] INFO - Starting Tavily search with query: 'AI trends', max_results: 5
[2024-01-15 10:30:45] INFO - Attempt 1/6 - Using API key: tvly-dev...xpA
[2024-01-15 10:30:46] INFO - Tavily search successful - Found 5 results
[2024-01-15 10:30:46] INFO - Tavily search successful - query: AI trends, results_count: 5
```

## Performance

- **Average Response Time**: 1-3 seconds
- **Timeout**: 30 seconds per API request
- **Retry Logic**: Automatic failover to next API key
- **Concurrent Requests**: Supported with async/await

## Best Practices

1. **Use Specific Keywords**: More specific queries yield better results
2. **Optimize Result Count**: Request only what you need (1-50)
3. **Handle Errors Gracefully**: Implement proper error handling
4. **Monitor API Keys**: Rotate and refresh keys regularly
5. **Cache Results**: Consider caching for repeated queries
6. **Test First**: Use the test-node endpoint before production

## Version History

- **v1.0.0** (2024-01-15): Initial release
  - Basic Tavily search functionality
  - API key rotation support
  - Node testing capabilities

## Support

For issues or questions:
- Check logs in `backend-services/basic-service/logs/app.log`
- Review error messages in API responses
- Verify API key configuration in `.env`

## Related Documentation

- [Workflow API Documentation](./workflow-api.md)
- [Node Test Panel Documentation](./node-test-panel.md)
- [Tavily API Official Documentation](https://docs.tavily.com/)

