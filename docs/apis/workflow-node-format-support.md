# Workflow Node Format Support API Documentation

## Overview

This document describes the data format support feature for workflow nodes in the Ecliptrix platform. All workflow nodes now support configurable input and output data formats, allowing seamless data transformation between different node types.

**Last Updated:** 2024-10-27  
**Version:** 1.0.0  
**Feature:** Workflow Node Format Support

---

## Table of Contents

1. [Introduction](#introduction)
2. [Supported Data Formats](#supported-data-formats)
3. [Node Configuration](#node-configuration)
4. [Format Conversion Rules](#format-conversion-rules)
5. [Implementation Details](#implementation-details)
6. [API Endpoints](#api-endpoints)
7. [Examples](#examples)
8. [Troubleshooting](#troubleshooting)

---

## Introduction

### Feature Summary

All workflow nodes now support input and output data format configuration. This allows users to:

- **Control data formats**: Choose how data is received and sent between nodes
- **Automatic conversion**: System automatically converts data between formats
- **Backward compatibility**: Nodes without format configuration default to JSON (existing behavior)
- **Single node testing**: Test nodes independently with format conversion

### Benefits

- **Flexibility**: Mix nodes that work with different data formats
- **Simplicity**: Automatic format conversion eliminates manual data transformation
- **Debugging**: Single node testing with format specification
- **Type safety**: Clear data format contracts between nodes

---

## Supported Data Formats

### 1. Plain Text (`text/plain`)

**Description**: Simple text string without structure

**Use Cases**:
- Raw text content
- Single-line messages
- Simple string data

**Example**:
```
Hello, this is plain text content.
```

### 2. JSON Object (`application/json`)

**Description**: Structured JSON object with key-value pairs

**Use Cases**:
- Structured data
- Complex objects
- API responses
- Default format for most nodes

**Example**:
```json
{
  "text": "Hello world",
  "status": "success",
  "data": {
    "id": 123,
    "name": "Example"
  }
}
```

### 3. Array (`array`)

**Description**: JavaScript/JSON array of items

**Use Cases**:
- Lists of items
- Multiple results
- Batch processing

**Example**:
```json
[
  "Item 1",
  "Item 2",
  "Item 3"
]
```

---

## Node Configuration

### Node Types and Format Support

| Node Type | Input Format | Output Format | Notes |
|-----------|--------------|---------------|-------|
| Start Node | N/A | ✅ | Only has output (workflow entry point) |
| Text Input | ✅ | ✅ | Full format support |
| Chat LLM | ✅ | ✅ | Full format support |
| Pexels Video Search | ✅ | ✅ | Full format support |
| Tavily Search | ✅ | ✅ | Full format support |
| Volcano TTS | ✅ | ✅ | Full format support |
| End Node | ✅ | N/A | Only has input (workflow exit point) |

### Configuration Panel

Each node configuration panel includes:

1. **Format Configuration Section**: Located below the Test Panel
2. **Input Format Selector**: Dropdown with three options
   - Plain Text
   - JSON Object
   - Array
3. **Output Format Selector**: Dropdown with three options
   - Plain Text
   - JSON Object
   - Array

### Default Behavior

- **Default Format**: `application/json` for all nodes
- **Backward Compatibility**: Existing workflows without format configuration work unchanged
- **Auto-detection**: System detects current format before conversion

---

## Format Conversion Rules

### Text to JSON

```
Input: "Hello world"
Output: { "text": "Hello world" }
```

If input is valid JSON string:
```
Input: '{"key": "value"}'
Output: {"key": "value"}
```

### JSON to Text

Priority order for extraction:
1. If `text` property exists: use it
2. If `message` property exists: use it
3. If `content` property exists: use it
4. Otherwise: `JSON.stringify(data, null, 2)`

Example:
```
Input: { "text": "Hello", "other": "data" }
Output: "Hello"
```

### Text to Array

Split by newlines and filter empty lines:
```
Input: "Line 1\nLine 2\nLine 3"
Output: ["Line 1", "Line 2", "Line 3"]
```

### Array to Text

Join array items with newlines:
```
Input: ["Item 1", "Item 2", "Item 3"]
Output: "Item 1\nItem 2\nItem 3"
```

### JSON to Array

Priority order:
1. If root is array: use it
2. If `items` property is array: use it
3. If `results` property is array: use it
4. If `data` property is array: use it
5. Otherwise: wrap in array `[data]`

### Array to JSON

Arrays are valid JSON, returned as-is:
```
Input: [1, 2, 3]
Output: [1, 2, 3]
```

---

## Implementation Details

### Frontend Components

#### 1. Format Converter Utility
**File**: `src/lib/utils/formatConverter.ts`

Key functions:
- `convertFormat(options)`: Main conversion function
- `detectFormat(data)`: Auto-detect current format
- `getFormatDisplayName(format)`: Get human-readable name
- `getFormatIcon(format)`: Get icon identifier

#### 2. Format Selector Component
**File**: `src/components/workflow/FormatSelector.tsx`

Reusable UI component for format selection with:
- Visual indicators (icons)
- Input/Output type differentiation
- Helpful tooltips
- Apple-style clean design

#### 3. Workflow Executor
**File**: `src/components/workflow/WorkflowExecutor.ts`

Enhanced execution logic:
- `convertInputFormat(node, input)`: Convert before node execution
- `convertOutputFormat(node, output)`: Convert after node execution
- Detailed logging of conversions
- Error handling with fallback to original data

### Backend API

#### Test Node Endpoint
**File**: `src/app/api/workflow/test-node/route.ts`

Endpoint: `POST /api/workflow/test-node`

Enhanced with:
- Format detection and conversion
- Input format conversion before execution
- Output format conversion after execution
- Logging of format conversions

---

## API Endpoints

### Test Node with Format Conversion

**Endpoint**: `POST /api/workflow/test-node`

**Request Body**:
```json
{
  "node_id": "node-123",
  "node_type": "chat-llm",
  "node_label": "Chat LLM Node",
  "node_config": {
    "systemPrompt": "You are a helpful assistant",
    "model": "gpt-4",
    "temperature": 0.7,
    "maxTokens": 2000,
    "inputFormat": "text/plain",
    "outputFormat": "application/json"
  },
  "input": "What is AI?"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Node test completed successfully",
  "output": {
    "text": "AI stands for Artificial Intelligence...",
    "llmResponse": "AI stands for Artificial Intelligence...",
    "model": "gpt-4"
  },
  "execution_time_ms": 1234,
  "node_id": "node-123",
  "node_type": "chat-llm"
}
```

**Format Conversion Flow**:
1. Input arrives as plain text
2. System detects format: `text/plain`
3. Converts to node's input format (if specified)
4. Node executes with converted input
5. Node produces output (usually JSON)
6. System converts output to specified format
7. Returns formatted output

---

## Examples

### Example 1: Text Input to LLM (Text → JSON)

**Setup**:
- Start Node: Output format = `text/plain`
- Chat LLM Node: Input format = `text/plain`, Output format = `application/json`

**Flow**:
```
Start Node Output: "What is machine learning?"
  ↓ (text/plain)
Chat LLM Node Input: "What is machine learning?"
  ↓ (processes)
Chat LLM Node Output: {
  "text": "Machine learning is...",
  "llmResponse": "Machine learning is..."
}
```

### Example 2: Search Results as Array

**Setup**:
- Text Input: Output format = `text/plain`
- Pexels Video Search: Input format = `text/plain`, Output format = `array`

**Flow**:
```
Text Input Output: "beautiful nature"
  ↓ (text/plain)
Pexels Search Input: "beautiful nature"
  ↓ (searches)
Pexels Search Output: [
  { "id": 1, "url": "..." },
  { "id": 2, "url": "..." },
  { "id": 3, "url": "..." }
]
```

### Example 3: Array to Text Summary

**Setup**:
- Tavily Search: Output format = `array`
- Chat LLM: Input format = `array`, Output format = `text/plain`

**Flow**:
```
Tavily Search Output: [
  { "title": "Result 1", "content": "..." },
  { "title": "Result 2", "content": "..." }
]
  ↓ (array)
Chat LLM processes array and outputs:
  ↓ (text/plain)
"Based on the search results, here's a summary..."
```

---

## Troubleshooting

### Common Issues

#### 1. Format Conversion Failures

**Symptom**: Node receives unexpected data format

**Solution**:
- Check logs for conversion errors
- System falls back to original data on conversion failure
- Verify format selectors are correctly configured
- Ensure data is compatible with target format

#### 2. Missing Format Configuration

**Symptom**: Node doesn't respect format settings

**Solution**:
- Verify node configuration is saved
- Check that format fields exist in node config
- Re-save node configuration if needed

#### 3. Complex Object Conversion

**Symptom**: JSON to text conversion produces unexpected results

**Solution**:
- JSON to text uses priority: `text` → `message` → `content` → `JSON.stringify`
- Ensure your objects have appropriate text fields
- Or use JSON output format if structure is important

### Debugging Tips

1. **Check Execution Logs**: All format conversions are logged
2. **Use Test Panel**: Test single nodes to verify format behavior
3. **Inspect Node States**: Check execution state for input/output
4. **Default Behavior**: Remove format settings to use default JSON

### Log Messages

Format conversion logs include:
- `Converting input format: from X to Y`
- `Converting output format: from X to Y`
- `Input converted from X to Y`
- `Output converted from X to Y`
- `Format conversion failed: [error]`

---

## Best Practices

1. **Start with JSON**: Use JSON format for most nodes (default behavior)
2. **Text for LLMs**: Use text format for LLM inputs when passing simple prompts
3. **Arrays for Lists**: Use array format when working with multiple items
4. **Test Conversions**: Use single node testing to verify format conversions
5. **Log Review**: Check logs to understand conversion behavior

---

## Future Enhancements

Potential future additions:
- XML format support
- CSV format support
- Custom format transformers
- Format validation rules
- Visual format indicators on nodes

---

## Support

For issues or questions:
- Check execution logs for detailed error messages
- Review this documentation for format conversion rules
- Test nodes independently using the Test Panel
- Verify node configurations are saved correctly

---

## Changelog

### Version 1.0.0 (2024-10-27)
- Initial release
- Support for three data formats: text/plain, application/json, array
- Format selector UI component
- Workflow executor format conversion
- Test node API format conversion
- Comprehensive logging
- Backward compatibility with existing workflows

