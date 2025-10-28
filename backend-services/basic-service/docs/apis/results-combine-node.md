# Results Combine Node API Documentation

## Overview

The **Results Combine Node** is a powerful workflow component that accepts an array of heterogeneous data items, transforms each item into a standardized format using LLM (Large Language Model), and outputs a unified array of structured results.

## Purpose

This node is designed to:
- Accept multiple inputs with different data structures
- Normalize and standardize data formats using AI
- Combine results into a consistent output schema
- Handle data aggregation and transformation in workflows

## Configuration Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `systemPrompt` | string | Instructions for the LLM on how to transform each input item to the standard format |
| `model` | string | LLM model name (e.g., "gpt-4", "claude-3-opus") |
| `modelId` | string | Unique identifier for the selected model |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `temperature` | number | 0.3 | Controls randomness (0.0 = precise, 2.0 = creative) |
| `maxTokens` | number | 2000 | Maximum length of generated response per transformation |
| `outputSchema` | string (JSON) | null | JSON schema defining the expected output structure for each item |
| `inputFormat` | DataFormat | 'array' | Format of incoming data ('text/plain', 'application/json', 'array') |
| `outputFormat` | DataFormat | 'array' | Format of outgoing data (typically 'array') |

## Input Format

The node expects an **array** input. The input can be:

1. **Direct Array**:
```json
[
  {"name": "Item 1", "value": 100},
  {"title": "Item 2", "amount": 200}
]
```

2. **Object with Array Property**:
```json
{
  "items": [...],
  "results": [...],
  "array": [...]
}
```

3. **Single Object** (automatically wrapped in array):
```json
{"data": "single item"}
```

## Output Format

The node outputs an **array** of standardized objects:

```json
[
  {
    "standardField1": "value1",
    "standardField2": "value2"
  },
  {
    "standardField1": "value3",
    "standardField2": "value4"
  }
]
```

## Processing Flow

1. **Input Validation**: Extracts array from input data
2. **Item Iteration**: Processes each item sequentially
3. **LLM Transformation**: Calls LLM for each item with:
   - System prompt (transformation instructions)
   - Output schema (if defined)
   - Item data as user message
4. **Result Collection**: Aggregates transformed items
5. **Output**: Returns array of standardized objects

## Example Usage

### Example 1: Product Data Standardization

**Input**:
```json
[
  {"name": "Product A", "price": "$29.99", "category": "Electronics"},
  {"title": "Product B", "cost": "49.99 USD", "type": "Books"},
  {"product": "Product C", "value": 19.99, "group": "Home & Garden"}
]
```

**Configuration**:
```json
{
  "systemPrompt": "Transform the product data into a standardized format. Extract the product name, price as a number, and category.",
  "model": "gpt-4",
  "temperature": 0.3,
  "maxTokens": 500,
  "outputSchema": "{\"productName\": \"string\", \"price\": \"number\", \"category\": \"string\"}"
}
```

**Output**:
```json
[
  {"productName": "Product A", "price": 29.99, "category": "Electronics"},
  {"productName": "Product B", "price": 49.99, "category": "Books"},
  {"productName": "Product C", "price": 19.99, "category": "Home & Garden"}
]
```

### Example 2: Search Results Aggregation

**Input**:
```json
[
  {
    "source": "API1",
    "data": {"headline": "News 1", "date": "2024-01-15"}
  },
  {
    "source": "API2",
    "info": {"title": "News 2", "timestamp": "2024-01-16T10:00:00Z"}
  }
]
```

**Configuration**:
```json
{
  "systemPrompt": "Normalize the news data. Extract title, date (ISO format), and source.",
  "model": "gpt-4-turbo",
  "temperature": 0.2,
  "outputSchema": "{\"title\": \"string\", \"date\": \"string\", \"source\": \"string\"}"
}
```

**Output**:
```json
[
  {"title": "News 1", "date": "2024-01-15T00:00:00Z", "source": "API1"},
  {"title": "News 2", "date": "2024-01-16T10:00:00Z", "source": "API2"}
]
```

## Error Handling

### Partial Failures

The node continues processing even if individual items fail:
- Failed items are logged with error details
- Successfully transformed items are included in output
- Error count is reported in logs

### Complete Failures

The node throws an error if:
- Configuration is missing (no model or systemPrompt)
- Input is not an array or convertible to array
- All items fail transformation
- LLM API is unavailable

## Logging

The node provides detailed logging at each stage:

1. **Start**: Input array size, configuration details
2. **Processing**: Each item transformation (start, success/failure)
3. **Completion**: Success count, error count, total items
4. **Errors**: Detailed error messages with item index

Example log output:
```
[WorkflowExecutor] Processing 5 items for combination
[WorkflowExecutor] Transforming item 1/5
[WorkflowExecutor] Item 1 transformed successfully
[WorkflowExecutor] Transforming item 2/5
[WorkflowExecutor] Failed to transform item 2: Invalid JSON format
[WorkflowExecutor] Combined 4 items (1 failed)
```

## Testing

### Single Node Testing

Use the **Test & Debug** panel in the node configuration:

1. Provide sample array input
2. Configure system prompt and output schema
3. Click "Run Test"
4. Review output and adjust configuration

### Example Test Input

```json
[
  {"id": 1, "data": "Sample 1"},
  {"id": 2, "data": "Sample 2"},
  {"id": 3, "data": "Sample 3"}
]
```

## Best Practices

1. **Clear System Prompt**: Provide explicit transformation instructions
2. **Define Output Schema**: Use JSON schema for consistent results
3. **Lower Temperature**: Use 0.2-0.4 for deterministic transformations
4. **Test First**: Use single node testing before full workflow
5. **Monitor Logs**: Check logs for transformation quality
6. **Handle Failures**: Expect partial failures with diverse input data

## Integration

### Workflow Position

Typically placed after:
- Search nodes (Pexels, Tavily)
- Data collection nodes
- To Array node (if conversion needed)

Typically before:
- End node
- Further processing nodes
- Output/export nodes

### Example Workflow

```
Start → Tavily Search → Results Combine → End
```

This workflow:
1. Starts with user query
2. Searches with Tavily (returns varied results)
3. Standardizes results with Results Combine
4. Outputs unified data

## API Endpoint

### Test Node API

**Endpoint**: `POST /api/workflow/test-node`

**Request Body**:
```json
{
  "node_id": "node-123",
  "node_type": "results-combine",
  "node_label": "Results Combine",
  "node_config": {
    "systemPrompt": "Transform data...",
    "model": "gpt-4",
    "temperature": 0.3,
    "maxTokens": 2000,
    "outputSchema": "{...}"
  },
  "input": [...]
}
```

**Response**:
```json
{
  "success": true,
  "message": "Node test completed successfully",
  "output": [...],
  "execution_time_ms": 1234,
  "node_id": "node-123",
  "node_type": "results-combine"
}
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Input is not an array" | Input format mismatch | Use To Array node before Results Combine |
| "All items failed" | Invalid system prompt | Revise prompt, add examples |
| "Parse errors" | LLM output not JSON | Add schema to system prompt, lower temperature |
| "Empty output" | Empty input array | Check previous node output |

## Performance Considerations

- **Sequential Processing**: Items processed one at a time
- **LLM Latency**: Expect ~1-3s per item depending on model
- **Batch Size**: Recommended max 20-50 items per node
- **Optimization**: Use faster models (gpt-3.5-turbo) for simple transforms

## Version History

- **v1.0.0** (2024-10-28): Initial implementation
  - Array input processing
  - LLM-based transformation
  - Schema support
  - Error handling and logging

## Related Documentation

- [Chat LLM Node](./chat-llm-node.md)
- [To Array Node](./to-array-node.md)
- [Workflow Execution](../workflow-execution.md)
- [LLM Configuration](../llm-configuration.md)

## Support

For issues or questions:
- Check logs for detailed error information
- Use Test & Debug panel for troubleshooting
- Review system prompt and output schema
- Consult workflow execution logs

