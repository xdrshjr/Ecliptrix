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
| `elementType` | ArrayElementType | 'string' | Data type of array elements: 'string', 'number', 'boolean', or 'object' |
| `objectSchema` | ObjectSchemaField[] | undefined | Schema definition for object elements (required when elementType is 'object') |

#### Array Element Types

The node supports the following element types:

- **string**: Each array element will be a string value
- **number**: Each array element will be a numeric value
- **boolean**: Each array element will be a boolean value (true/false)
- **object**: Each array element will be a JSON object with a defined schema

#### Object Schema Structure

When `elementType` is set to `'object'`, you must define the object structure using `objectSchema`:

```typescript
interface ObjectSchemaField {
  name: string;              // Field name
  type: ArrayElementType;    // Field type (string, number, boolean, or object)
  required?: boolean;        // Whether the field is required (default: true)
  description?: string;      // Optional field description
  objectSchema?: ObjectSchemaField[]; // Nested schema for object-type fields
}
```

## Data Formats

### Input Formats Supported

- `text/plain`: Plain text input
- `application/json`: JSON object input
- `array`: Array input (can be used for array transformation)

### Output Format

- **Always**: `array` - The node guarantees array output

## Usage Examples

### Example 1: String Array - Converting Comma-Separated Values

**Configuration:**
```json
{
  "systemPrompt": "Convert the input data into a clean JSON array format. Extract relevant items from the input and structure them as an array. Respond ONLY with a valid JSON array.",
  "model": "gpt-4",
  "temperature": 0.3,
  "maxTokens": 2000,
  "elementType": "string"
}
```

**Input:**
```json
{
  "text": "Apple, Banana, Orange, Grape, Watermelon"
}
```

**Output:**
```json
["Apple", "Banana", "Orange", "Grape", "Watermelon"]
```

### Example 2: Number Array - Extracting Numeric Values

**Configuration:**
```json
{
  "systemPrompt": "Extract all numeric values from the input and return them as a JSON array of numbers.",
  "model": "gpt-4",
  "temperature": 0.2,
  "maxTokens": 1000,
  "elementType": "number"
}
```

**Input:**
```json
{
  "text": "The scores are: 95, 87, 92, 78, 100"
}
```

**Output:**
```json
[95, 87, 92, 78, 100]
```

### Example 3: Boolean Array - Converting Yes/No Values

**Configuration:**
```json
{
  "systemPrompt": "Convert the input text into an array of boolean values. Use true for affirmative responses and false for negative ones.",
  "model": "gpt-4",
  "temperature": 0.1,
  "elementType": "boolean"
}
```

**Input:**
```json
{
  "text": "Question 1: Yes, Question 2: No, Question 3: Yes, Question 4: Yes, Question 5: No"
}
```

**Output:**
```json
[true, false, true, true, false]
```

### Example 4: Object Array - Simple User Data

**Configuration:**
```json
{
  "systemPrompt": "Extract user information and convert to an array of objects. Follow the exact schema provided.",
  "model": "gpt-4",
  "temperature": 0.2,
  "elementType": "object",
  "objectSchema": [
    {
      "name": "name",
      "type": "string",
      "required": true,
      "description": "User's full name"
    },
    {
      "name": "age",
      "type": "number",
      "required": true,
      "description": "User's age in years"
    },
    {
      "name": "active",
      "type": "boolean",
      "required": false,
      "description": "Whether user is active"
    }
  ]
}
```

**Input:**
```json
{
  "text": "Users: John (age 30, active), Sarah (age 25, inactive), Mike (age 35, active)"
}
```

**Output:**
```json
[
  {"name": "John", "age": 30, "active": true},
  {"name": "Sarah", "age": 25, "active": false},
  {"name": "Mike", "age": 35, "active": true}
]
```

### Example 5: Object Array - Nested Structure

**Configuration:**
```json
{
  "systemPrompt": "Extract product information and convert to an array of objects with nested address data. Follow the schema exactly.",
  "model": "gpt-4",
  "temperature": 0.2,
  "elementType": "object",
  "objectSchema": [
    {
      "name": "productName",
      "type": "string",
      "required": true,
      "description": "Product name"
    },
    {
      "name": "price",
      "type": "number",
      "required": true,
      "description": "Product price"
    },
    {
      "name": "inStock",
      "type": "boolean",
      "required": true,
      "description": "Stock availability"
    },
    {
      "name": "supplier",
      "type": "object",
      "required": true,
      "description": "Supplier information",
      "objectSchema": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "country",
          "type": "string",
          "required": true
        }
      ]
    }
  ]
}
```

**Input:**
```json
{
  "text": "Product: Laptop, Price: $999, In Stock: Yes, Supplier: TechCorp from USA\nProduct: Mouse, Price: $25, In Stock: No, Supplier: AccessoryPlus from China"
}
```

**Output:**
```json
[
  {
    "productName": "Laptop",
    "price": 999,
    "inStock": true,
    "supplier": {
      "name": "TechCorp",
      "country": "USA"
    }
  },
  {
    "productName": "Mouse",
    "price": 25,
    "inStock": false,
    "supplier": {
      "name": "AccessoryPlus",
      "country": "China"
    }
  }
]
```

### Example 6: Processing LLM Text Output (String Array)

**Configuration:**
```json
{
  "systemPrompt": "Extract the programming languages from the numbered list and return as a JSON array of strings.",
  "model": "gpt-4",
  "temperature": 0.2,
  "elementType": "string"
}
```

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

## Schema Configuration Guide

### Setting Up Element Type

1. **Open Node Configuration**: Double-click the To Array node in the workflow canvas
2. **Select Element Type**: In the "Array Element Schema" section, choose from:
   - **String**: For text-based arrays
   - **Number**: For numeric arrays
   - **Boolean**: For true/false arrays
   - **Object**: For structured data arrays

### Defining Object Schema (When Element Type = Object)

When you select "Object" as the element type, the Object Fields builder appears:

#### Adding Fields

1. Click the **"Add Field"** button
2. For each field, configure:
   - **Field Name**: The property name (e.g., "name", "age", "email")
   - **Field Type**: Choose string, number, boolean, or object
   - **Required**: Check if the field must be present
   - **Description**: Optional description for the field

#### Adding Nested Fields

For object-type fields, you can add nested properties:

1. Set a field's type to "Object"
2. Click **"+ Add Nested"** under that field
3. Configure nested field properties

#### Example Schema Setup

To create an array of user objects with nested address:

```
Field 1:
  - Name: "username"
  - Type: string
  - Required: ✓
  
Field 2:
  - Name: "age"
  - Type: number
  - Required: ✓
  
Field 3:
  - Name: "address"
  - Type: object
  - Required: ✓
  - Nested Fields:
    - Name: "city"
      Type: string
      Required: ✓
    - Name: "zipCode"
      Type: string
      Required: ✓
```

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

### 2. Element Type Selection

- Use **string** for simple text lists
- Use **number** when extracting numeric data (prices, scores, counts)
- Use **boolean** for yes/no, true/false data
- Use **object** for structured data with multiple properties

### 3. Schema Design Tips

- Keep object schemas as simple as possible
- Only mark fields as required if they must always be present
- Use descriptive field names (e.g., "userEmail" not "e")
- Limit nesting depth to 2-3 levels for best LLM performance
- Test with sample data before deploying

### 4. Temperature Settings

- **Data Extraction (0.0-0.3)**: For precise, deterministic conversions
- **Creative Transformation (0.5-0.8)**: For generating varied array content
- **High Creativity (0.9-2.0)**: Not recommended for array conversion

### 5. Input Preparation

Ensure input contains parseable content:
```json
{
  "text": "Clear, structured data that can be converted"
}
```

### 6. Testing

Always use the built-in test panel before deploying workflows:
1. Double-click the node to open configuration
2. Configure element type and schema (if object)
3. Expand the "Test & Debug" section
4. Edit input JSON
5. Click "Run Test"
6. Verify array output matches expected schema

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

### Issue: Wrong Element Types in Output

**Cause**: LLM didn't follow the specified element type

**Solution**:
- Check console logs for validation warnings
- The backend validates and logs type mismatches
- Adjust system prompt to emphasize data types
- Use lower temperature for more consistent typing

### Issue: Missing Required Fields in Object Schema

**Cause**: LLM didn't generate all required fields

**Solution**:
- Check validation logs in console (warnings appear for missing fields)
- Update system prompt to emphasize required fields
- Simplify schema if too complex
- Provide clearer input data

### Issue: Nested Object Fields Not Generated

**Cause**: Complex nested schemas may confuse the LLM

**Solution**:
- Keep nesting depth to 2-3 levels maximum
- Provide example output in system prompt
- Use clearer field names and descriptions
- Consider flattening the schema structure

### Issue: Schema Validation Warnings

**Cause**: Output doesn't perfectly match defined schema

**Solution**:
- These are warnings, not errors - output is still returned
- Review warnings in browser console
- Adjust prompt or schema based on warnings
- Consider if fields should be optional instead of required

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

- **v2.0.0** (2025): Added schema support with element type configuration
  - Support for string, number, boolean, and object element types
  - Object schema builder with nested field support
  - Schema validation and detailed logging
  - Enhanced UI with schema configuration panel
- **v1.0.0** (2024): Initial implementation with LLM-powered array conversion

## Related Documentation

- [Chat LLM Node](./chat-llm-node.md)
- [Workflow API](./workflow-api.md)
- [Node Testing](./workflow-node-testing.md)

