# Video Analysis API Documentation

## Overview
The Video Analysis API provides intelligent video content analysis using Vision-Language Models (VLM). It extracts frames from videos at specified intervals and generates detailed descriptions of each frame's content.

## Base URL
```
POST /api/video/analyze
```

## Authentication
No authentication required for this endpoint.

## Request

### Request Body
```json
{
  "video_url": "string",
  "frame_interval": 5,
  "custom_prompt": "string (optional)"
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `video_url` | string | Yes | - | URL or path to the video file to analyze |
| `frame_interval` | integer | No | 5 | Interval in seconds between frames to extract |
| `custom_prompt` | string | No | null | Custom prompt for LLM analysis |

### Request Example
```json
{
  "video_url": "https://example.com/video.mp4",
  "frame_interval": 3,
  "custom_prompt": "请详细描述视频中的场景、人物动作和情感表达"
}
```

## Response

### Success Response (200 OK)
```json
{
  "success": true,
  "video_url": "https://example.com/video.mp4",
  "total_frames_extracted": 10,
  "video_duration": 30.5,
  "frame_analyses": [
    {
      "frame_number": 0,
      "timestamp": 0.0,
      "analysis": "画面显示一个阳光明媚的公园场景，有绿色的草地和蓝天白云...",
      "frame_path": "/tmp/frames/frame_0000_0.00s.jpg"
    },
    {
      "frame_number": 1,
      "timestamp": 3.0,
      "analysis": "场景切换到室内，一位女性正在厨房准备食物...",
      "frame_path": "/tmp/frames/frame_0001_3.00s.jpg"
    }
  ],
  "processing_time": 45.2,
  "timestamp": "2024-01-15T10:30:00Z",
  "message": "Successfully analyzed 10 frames from video"
}
```

### Error Response (400 Bad Request)
```json
{
  "detail": "Video URL cannot be empty"
}
```

### Error Response (500 Internal Server Error)
```json
{
  "detail": "Internal server error occurred during video analysis"
}
```

## Response Fields

### VideoAnalysisResponse
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the analysis was successful |
| `video_url` | string | URL of the analyzed video |
| `total_frames_extracted` | integer | Total number of frames extracted |
| `video_duration` | number | Duration of the video in seconds |
| `frame_analyses` | array | List of frame analysis results |
| `processing_time` | number | Time taken to process the video in seconds |
| `timestamp` | string | Timestamp of the analysis |
| `message` | string | Additional message |

### FrameAnalysis
| Field | Type | Description |
|-------|------|-------------|
| `frame_number` | integer | Frame number in the video |
| `timestamp` | number | Timestamp of the frame in seconds |
| `analysis` | string | LLM analysis description of the frame |
| `frame_path` | string | Path to the extracted frame image |

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 500 | Internal Server Error - Analysis failed |

## Usage Examples

### Basic Video Analysis
```bash
curl -X POST "http://localhost:8000/api/video/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/sample-video.mp4",
    "frame_interval": 5
  }'
```

### Custom Analysis with Specific Prompt
```bash
curl -X POST "http://localhost:8000/api/video/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/product-demo.mp4",
    "frame_interval": 2,
    "custom_prompt": "分析视频中展示的产品特性和使用方法"
  }'
```

## Notes

1. **Video Format Support**: Supports common video formats (MP4, AVI, MOV, etc.)
2. **Processing Time**: Analysis time depends on video length and frame interval
3. **Frame Extraction**: Frames are extracted at specified intervals and temporarily stored
4. **Cleanup**: Temporary files are automatically cleaned up after analysis
5. **VLM Configuration**: Requires proper VL_LLM configuration in environment variables

## Configuration Requirements

The following environment variables must be set:

```env
VL_LLM_API_KEY=your_vl_llm_api_key
VL_LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VL_LLM_MODEL=qwen-vl-plus
```

## Rate Limits

- No specific rate limits are enforced at the API level
- Processing time may vary based on video size and complexity
- Consider implementing client-side throttling for better user experience 