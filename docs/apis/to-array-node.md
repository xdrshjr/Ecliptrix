# To Array Node API Documentation

## Overview

The **To Array Node** is a workflow component that converts input data of any format into a clean JSON array format using Large Language Models (LLM). It provides intelligent data transformation capabilities within workflow pipelines.

## Features

- **Universal Input Support**: Accepts any input format (text, JSON, objects, etc.)
- **LLM-Powered Conversion**: Uses advanced language models to intelligently parse and structure data
- **Array Output Guarantee**: Always outputs data in array format
- **Configurable Conversion Logic**: Customize the conversion behavior via system prompts
- **Single Node Testing**: Built-in test panel for debugging individual nodes
- **Apple-style UI**: Clean, elegant gray-themed interface

## Node Configuration

### Basic Information

- **Node Type**: `to-array`
- **Display Label**: "To Array"
- **Icon**: Horizontal lines (representing array items)
- **Color Scheme**: Gray (elegant, minimalist)

### Configuration Parameters

#### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `systemPrompt` | string | Instructions for the LLM on how to convert data to array format |
| `model` | string | LLM model name (e.g., "gpt-4", "claude-3-opus") |
| `modelId` | string | Unique identifier for the selected LLM model |

#### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `temperature` | number | 0.3 | Controls randomness (0.0-2.0). Lower values recommended for data conversion |
| `maxTokens` | number | 2000 | Maximum length of the generated array output |
| `inputFormat` | DataFormat | 'application/json' | Format of input data |
| `outputFormat` | DataFormat | 'array' | Always 'array' for this node (fixed) |

## Data Formats

### Input Formats Supported

- `text/plain`: Plain text input
- `application/json`: JSON object input
- `array`: Array input (can be used for array transformation)

### Output Format

- **Always**: `array` - The node guarantees array output

## Usage Examples

### Example 1: Converting Comma-Separated Values

**Input:**
```json
{
  "text": "Apple, Banana, Orange, Grape, Watermelon"
}
```

**Configuration:**
```json
{
  "systemPrompt": "Convert the input data into a clean JSON array format. Extract relevant items from the input and structure them as an array. Respond ONLY with a valid JSON array.",
  "model": "gpt-4",
  "temperature": 0.3,
  "maxTokens": 2000
}
```

**Output:**
```json
["Apple", "Banana", "Orange", "Grape", "Watermelon"]
```

### Example 2: Extracting Structured Data

**Input:**
```json
{
  "text": "Users: John (age 30), Sarah (age 25), Mike (age 35)"
}
```

**Configuration:**
```json
{
  "systemPrompt": "Extract user information and convert to an array of objects with name and age properties. Respond with a JSON array only.",
  "model": "gpt-4",
  "temperature": 0.2
}
```

**Output:**
```json
[
  {"name": "John", "age": 30},
  {"name": "Sarah", "age": 25},
  {"name": "Mike", "age": 35}
]
```

### Example 3: Processing LLM Text Output

**Input:**
```json
{
  "text": "Here are the top programming languages:\n1. Python\n2. JavaScript\n3. Java\n4. C++\n5. Go"
}
```

**Output:**
```json
["Python", "JavaScript", "Java", "C++", "Go"]
```

## API Endpoints

### Test Single Node

**Endpoint:** `POST /api/workflow/test-node`

**Request Body:**
```json
{
  "node_id": "node-123",
  "node_type": "to-array",
  "node_label": "To Array",
  "node_config": {
    "systemPrompt": "Convert input to array format",
    "model": "gpt-4",
    "modelId": "model-id-123",
    "temperature": 0.3,
    "maxTokens": 2000,
    "inputFormat": "application/json",
    "outputFormat": "array"
  },
  "input": {
    "text": "Item1, Item2, Item3"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Node test completed successfully",
  "output": ["Item1", "Item2", "Item3"],
  "execution_time_ms": 1234,
  "node_id": "node-123",
  "node_type": "to-array"
}
```

## Workflow Integration

### Connecting Nodes

The To Array node can be connected to:

**Input Sources:**
- Start Node
- Text Input Node
- Chat LLM Node
- Pexels Video Search Node
- Tavily Search Node
- Any node that outputs data

**Output Targets:**
- End Node
- Chat LLM Node (for further processing)
- Any node that accepts array input

### Example Workflow

```
Start Node → Chat LLM Node → To Array Node → End Node
```

1. **Start Node**: Provides initial query
2. **Chat LLM Node**: Generates a list response
3. **To Array Node**: Converts the list to structured array
4. **End Node**: Outputs the final array result

## Node Behavior

### Conversion Logic

The node performs the following steps:

1. **Input Processing**: Extracts text content from any input format
2. **LLM Call**: Sends the content to the configured LLM with system prompt
3. **Response Parsing**: Intelligently parses the LLM response
4. **Array Extraction**: Attempts to extract array in multiple ways:
   - Direct JSON array parsing
   - Extracting nested arrays (e.g., `response.array`, `response.items`)
   - Finding JSON array patterns in text
   - Fallback to line-by-line splitting
5. **Output Return**: Returns validated array format

### Error Handling

The node handles various error scenarios:

- **Missing Configuration**: Throws error if model or systemPrompt not configured
- **LLM API Failure**: Captures and reports API errors
- **Parsing Failures**: Attempts multiple parsing strategies with fallbacks
- **Empty Results**: Returns empty array `[]` if no data can be extracted

## Best Practices

### 1. System Prompt Design

**Good:**
```
"Convert the input data into a JSON array. Extract all items and return ONLY a valid JSON array, no explanations."
```

**Bad:**
```
"Convert to array" // Too vague
```

### 2. Temperature Settings

- **Data Extraction (0.0-0.3)**: For precise, deterministic conversions
- **Creative Transformation (0.5-0.8)**: For generating varied array content
- **High Creativity (0.9-2.0)**: Not recommended for array conversion

### 3. Input Preparation

Ensure input contains parseable content:
```json
{
  "text": "Clear, structured data that can be converted"
}
```

### 4. Testing

Always use the built-in test panel before deploying workflows:
1. Double-click the node to open configuration
2. Expand the "Test & Debug" section
3. Edit input JSON
4. Click "Run Test"
5. Verify array output

## Performance Considerations

- **LLM Latency**: Expect 1-5 seconds for typical conversions
- **Token Usage**: Configured maxTokens affects cost and response length
- **Model Selection**: Faster models (e.g., GPT-3.5) vs. more capable models (GPT-4)

## Logging

The node provides detailed logging:

```
[API] Executing To Array node
[API] Calling LLM API for array conversion: { model: 'gpt-4', ... }
[API] LLM response received for array conversion: { responseLength: 150 }
[WorkflowExecutor] Array conversion completed (5 items)
```

## UI Features

### Visual Indicators

- **Configuration Status**: Colored badge showing if node is configured
- **Output Badge**: "Array Output" indicator clearly shows output format
- **Execution Status**: Visual feedback during workflow execution (pending/executing/completed/error)

### Configuration Panel

- **Model Selection**: Dropdown with all available LLM models
- **System Prompt**: Large textarea for conversion instructions
- **Temperature Slider**: Visual control with value display
- **Max Tokens Slider**: Range control for output length
- **Format Selectors**: Input and output format configuration
- **Test Panel**: Integrated testing interface

## Troubleshooting

### Issue: Empty Array Output

**Cause**: LLM response doesn't contain parseable array data

**Solution**: 
- Refine system prompt to be more explicit
- Check input data quality
- Review LLM response in logs

### Issue: Invalid JSON Error

**Cause**: LLM returned non-JSON text

**Solution**:
- Emphasize "ONLY JSON array" in system prompt
- Use lower temperature (0.0-0.3)
- Try different model

### Issue: Wrapped Objects Instead of Array

**Cause**: LLM returned `{ "array": [...] }` instead of `[...]`

**Solution**: The node automatically handles this - checks for `.array`, `.items`, `.results` properties

## Code References

### Frontend Components

- **Node Component**: `src/components/workflow/nodes/ToArrayNode.tsx`
- **Config Panel**: `src/components/workflow/ToArrayConfigPanel.tsx`
- **Type Definitions**: `src/types/index.ts` (ToArrayNodeConfig)

### Backend API

- **Test Endpoint**: `src/app/api/workflow/test-node/route.ts` (executeToArrayNode)
- **Workflow Executor**: `src/components/workflow/WorkflowExecutor.ts` (executeToArrayNode)

### Registration

- **Canvas**: `src/components/workflow/WorkflowCanvas.tsx`
- **Node Creation**: Context menu in WorkflowCanvas

## Version History

- **v1.0.0** (2024): Initial implementation with LLM-powered array conversion

## Related Documentation

- [Chat LLM Node](./chat-llm-node.md)
- [Workflow API](./workflow-api.md)
- [Node Testing](./workflow-node-testing.md)

