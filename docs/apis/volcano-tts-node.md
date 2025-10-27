# Volcano TTS Node - Workflow API Documentation

## Overview

The Volcano TTS (Text-to-Speech) Node is a workflow component that converts text content to speech audio using the Volcano TTS API. This node supports multiple voice types, adjustable speed ratios, and provides high-quality speech synthesis for both Chinese and English content.

## Node Information

- **Node Type**: `volcano-tts`
- **Node Label**: Volcano TTS
- **Category**: Audio Processing / Speech Synthesis
- **Visual Theme**: Orange gradient (`from-orange-500 to-orange-600`)

## Features

1. **Text-to-Speech Conversion**: Converts any text input to natural-sounding speech
2. **Multiple Voice Types**: Supports various voice types for different scenarios
3. **Speed Control**: Adjustable speech speed (0.5x - 2.0x)
4. **Language Support**: Supports both Chinese (中文) and English
5. **Node Testing**: Built-in test and debug panel for independent testing
6. **Audio Preview**: Play and download generated audio directly from the config panel

## Configuration

### Node Configuration Panel

The configuration panel provides the following settings:

#### 1. Language Selection
- **Chinese (中文)**: Select Chinese voice types
- **English**: Select English voice types

#### 2. Voice Type Selection

Voice types are organized by category:

**通用场景 (General Scenarios)**
- Various male and female voices for different use cases
- Examples: Brayan, Skye, neighboring girl, sunny youth, etc.

**趣味方言 (Regional Dialects)**
- Regional Chinese dialects
- Examples: Bay Area uncle, Sichuan girl, Guangzhou brother, etc.

**角色扮演 (Role Playing)**
- Character voices
- Examples: Charming girlfriend, late-night podcast, energetic child, etc.

**播报解说 (Broadcasting & Commentary)**
- Professional news and commentary voices
- Male and female options available

**有声阅读 (Audio Reading)**
- Voices optimized for audiobook narration

#### 3. Speed Ratio
- **Range**: 0.5x - 2.0x
- **Default**: 1.0x (normal speed)
- **Step**: 0.1x increments

#### 4. Text Content
- **Format**: Plain text
- **Max Length**: Recommended under 2000 characters per sentence
- **Multi-line Support**: Yes
- **Character Count**: Real-time display

## Input/Output

### Input Port
- **Label**: "Text Input"
- **Type**: String or Object
- **Accepted Formats**:
  - Direct string: `"Hello, world!"`
  - Object with `text` field: `{ "text": "Hello, world!" }`
  - Object with `message` field: `{ "message": "Hello, world!" }`
  - Object with `content` field: `{ "content": "Hello, world!" }`

### Output Port
- **Label**: "Audio Output"
- **Type**: Object
- **Output Format**:
```json
{
  "text": "Original text content",
  "audio_url": "/api/audio/generated/segment-xxx_concatenated_xxx.mp3",
  "duration": 12.8,
  "voice_type": "zh_male_shaonianzixin_moon_bigtts",
  "speed_ratio": 1.0,
  "sentence_results": [
    {
      "sentence_id": "node-xxx-1",
      "order": 0,
      "success": true,
      "audio_url": "/api/audio/generated/sentence-xxx.mp3",
      "duration": 5.2,
      "file_size": 83456,
      "start_time": 0.0,
      "end_time": 5.2,
      "processing_time": 6.1
    }
  ],
  "previousInput": { ... }
}
```

## API Endpoints Used

### 1. Voice Types Query
**Endpoint**: `GET /api/tts/voice-types?locale={locale}`

**Parameters**:
- `locale`: Language locale (`zh-CN` or `en`)

**Response**:
```json
{
  "success": true,
  "message": "Voice types retrieved successfully",
  "data": {
    "zh_male_shaonianzixin_moon_bigtts": {
      "id": "zh_male_shaonianzixin_moon_bigtts",
      "name": "少年梓辛",
      "language": "zh-CN",
      "gender": "male",
      "description": "Clear and youthful male voice",
      "category": "通用场景"
    }
    // ... more voice types
  }
}
```

### 2. Text-to-Speech Conversion
**Endpoint**: `POST /api/tts/convert-sentences`

**Request Body**:
```json
{
  "segment_id": "node-12345",
  "sentences": [
    {
      "sentence_id": "node-12345-1",
      "text": "Hello, this is a test.",
      "order": 0
    }
  ],
  "voice_type": "zh_male_shaonianzixin_moon_bigtts",
  "speed_ratio": 1.0,
  "task_id": "workflow-1234567890"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Sentence-level TTS conversion completed",
  "segment_id": "node-12345",
  "total_sentences": 1,
  "successful_sentences": 1,
  "failed_sentences": 0,
  "total_processing_time": 6.1,
  "concatenated_audio_url": "/api/audio/generated/segment-xxx_concatenated_xxx.mp3",
  "total_duration": 5.2,
  "concatenated_file_size": 83456,
  "sentence_results": [...]
}
```

## Node Testing

The node includes a built-in Test & Debug panel that allows you to:

1. **Edit Input JSON**: Modify the input data to test different scenarios
2. **Run Test**: Execute the node independently without running the full workflow
3. **View Output**: See the generated output and audio URL
4. **Play Audio**: Preview the generated audio directly in the panel
5. **Download Audio**: Download the generated audio file to your computer

### Example Test Input
```json
{
  "text": "Hello, this is a test of the Volcano text-to-speech system.",
  "message": "Text to convert to speech"
}
```

### Example Test Output
```json
{
  "text": "Hello, this is a test of the Volcano text-to-speech system.",
  "audio_url": "/api/audio/generated/segment-node-12345_concatenated_20240101_abc123.mp3",
  "duration": 5.2,
  "voice_type": "zh_male_shaonianzixin_moon_bigtts",
  "speed_ratio": 1.0,
  "sentence_results": [
    {
      "sentence_id": "node-12345-1",
      "order": 0,
      "success": true,
      "audio_url": "/api/audio/generated/sentence-node-12345-1_20240101_abc123.mp3",
      "duration": 5.2,
      "file_size": 83456,
      "start_time": 0.0,
      "end_time": 5.2,
      "processing_time": 6.1
    }
  ],
  "success": true
}
```

## Workflow Integration

### Example Workflow 1: Simple Text-to-Speech
```
[Start Node] → [Volcano TTS Node] → [End Node]
```
- Start node provides text input
- Volcano TTS node converts to speech
- End node receives audio output

### Example Workflow 2: Dynamic Content Generation
```
[Start Node] → [Chat LLM Node] → [Volcano TTS Node] → [End Node]
```
- Start node provides a prompt
- Chat LLM node generates content
- Volcano TTS node converts generated text to speech
- End node receives audio output

### Example Workflow 3: Multi-language Support
```
[Start Node] → [Text Input Node] → [Volcano TTS Node (Chinese)] → [End Node]
                              ↓
              [Volcano TTS Node (English)] → [End Node]
```
- Process the same text in multiple languages

## Error Handling

### Common Errors

1. **No Text Content**
   - Error: "Volcano TTS node requires text content"
   - Solution: Configure text in the node or provide input from previous node

2. **Invalid Voice Type**
   - Error: "Invalid voice type"
   - Solution: Select a voice type from the available list

3. **API Configuration Error**
   - Error: "TTS service configuration error"
   - Solution: Ensure backend API keys are properly configured

4. **Network Error**
   - Error: "TTS request failed: Network error"
   - Solution: Check network connectivity and backend service status

## Best Practices

1. **Text Length**: Keep individual text segments under 2000 characters for optimal performance
2. **Voice Selection**: Choose appropriate voice types based on content type and target audience
3. **Speed Ratio**: Use 1.0x for normal speech; adjust only when necessary
4. **Testing**: Always test the node independently before adding it to a complex workflow
5. **Error Handling**: Add appropriate error handling nodes in your workflow

## Configuration Example

```typescript
// Node configuration object
{
  text: "Welcome to our video tutorial. Today we will learn about AI and machine learning.",
  voiceType: "zh_male_shaonianzixin_moon_bigtts",
  speedRatio: 1.0
}
```

## Logging

The node provides comprehensive logging for debugging:

### Frontend Logs
- Node rendering events
- Configuration changes
- Test execution
- Audio playback events

### Backend Logs
- TTS API requests
- Voice type queries
- Conversion progress
- Error details

## Performance Considerations

- **Processing Time**: Typically 5-10 seconds per 100 characters
- **File Size**: Approximately 16KB per second of audio
- **Concurrent Requests**: Backend supports concurrent processing
- **Caching**: Audio files are cached on the server

## Related Nodes

- **Text Input Node**: Provides static text content
- **Chat LLM Node**: Generates dynamic text content
- **Start Node**: Initiates workflow with user input
- **End Node**: Collects final output

## Version History

- **v1.0.0** (2024-01-01): Initial release
  - Basic text-to-speech functionality
  - Multi-voice support
  - Speed control
  - Node testing capability
  - Audio preview and download

## Support

For issues or questions regarding the Volcano TTS Node:
1. Check the node logs for detailed error messages
2. Test the node independently using the Test & Debug panel
3. Verify backend API configuration
4. Ensure all required fields are properly configured

