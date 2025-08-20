# Video Analysis API Documentation

## Overview
The Video Analysis API provides intelligent video content analysis using Vision-Language Models (VLM). It extracts frames from videos at specified intervals and generates detailed descriptions of each frame's content using **concurrent processing** for improved performance.

### Key Features
- **Concurrent VLM Processing**: Analyzes multiple frames simultaneously using configurable thread count
- **Configurable Frame Intervals**: Supports custom frame extraction intervals with fallback to configuration defaults
- **Performance Optimization**: Significantly faster processing compared to sequential analysis
- **Detailed Logging**: Comprehensive performance metrics and processing statistics

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
| `frame_interval` | integer | No | 5 (configurable) | Interval in seconds between frames to extract. If not provided or ≤ 0, uses configuration default |
| `custom_prompt` | string | No | null | Custom prompt for LLM analysis |

### Configuration
The service uses a configuration file (`config/video-analysis-config.yaml`) with the following key settings:

```yaml
vlm_processing:
  concurrent_threads: 5          # Number of concurrent VLM API calls
  api_timeout: 30               # Timeout for individual API calls
  max_retries: 2                # Retry attempts for failed calls

frame_extraction:
  default_frame_interval_seconds: 5    # Default frame interval
  max_frames_per_video: 100           # Maximum frames to extract
```

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
  "processing_time": 12.5,
  "timestamp": "2024-01-15T10:30:00Z",
  "message": "Successfully analyzed 10 frames from video using 5 concurrent threads"
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
| `processing_time` | number | Time taken to process the video in seconds (includes concurrent processing) |
| `timestamp` | string | Timestamp of the analysis |
| `message` | string | Additional message including concurrent processing info |

### FrameAnalysis
| Field | Type | Description |
|-------|------|-------------|
| `frame_number` | integer | Frame number in the video |
| `timestamp` | number | Timestamp of the frame in seconds |
| `analysis` | string | LLM analysis description of the frame |
| `frame_path` | string | Path to the extracted frame image |

## Performance Improvements

### Concurrent Processing
The API now uses concurrent processing to analyze multiple frames simultaneously:

- **Default Threads**: 5 concurrent VLM API calls
- **Configurable**: Adjustable via configuration file
- **Performance Gain**: Typically 3-5x faster than sequential processing
- **Rate Limiting**: Built-in semaphore prevents API overload

### Processing Time Comparison
| Frames | Sequential (estimated) | Concurrent (5 threads) | Speedup |
|--------|----------------------|----------------------|---------|
| 3 frames | ~18 seconds | ~6 seconds | 3x |
| 10 frames | ~60 seconds | ~15 seconds | 4x |
| 20 frames | ~120 seconds | ~30 seconds | 4x |

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
    "video_url": "https://example.com/sample-video.mp4"
  }'
```

### Custom Frame Interval
```bash
curl -X POST "http://localhost:8000/api/video/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/sample-video.mp4",
    "frame_interval": 2
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

## Configuration Management

### Configuration File Location
```
backend-services/basic-service/config/video-analysis-config.yaml
```

### Key Configuration Options

#### VLM Processing
```yaml
vlm_processing:
  concurrent_threads: 5      # Adjust based on API rate limits
  api_timeout: 30           # Increase for slower networks
  max_retries: 2            # Retry failed API calls
```

#### Frame Extraction
```yaml
frame_extraction:
  default_frame_interval_seconds: 5    # Default when not specified
  max_frames_per_video: 100           # Prevent excessive processing
```

#### Performance Tuning
```yaml
performance:
  enable_performance_logging: true     # Log detailed metrics
  log_concurrent_stats: true          # Log concurrent processing stats
  max_video_duration_seconds: 3600    # Maximum video length (1 hour)
```

## Notes

1. **Video Format Support**: Supports common video formats (MP4, AVI, MOV, MKV, WebM, FLV)
2. **Processing Time**: Significantly improved with concurrent processing (3-5x speedup typical)
3. **Frame Extraction**: Frames are extracted at specified intervals and temporarily stored
4. **Cleanup**: Temporary files are automatically cleaned up after analysis
5. **VLM Configuration**: Requires proper VL_LLM configuration in environment variables
6. **Concurrent Limits**: Thread count is configurable to balance speed vs. API rate limits
7. **Error Handling**: Individual frame failures don't stop the entire analysis
8. **Performance Logging**: Detailed metrics available for monitoring and optimization

## Configuration Requirements

The following environment variables must be set:

```env
VL_LLM_API_KEY=your_vl_llm_api_key
VL_LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VL_LLM_MODEL=qwen-vl-plus
```

## Rate Limits and Best Practices

- **API Rate Limits**: Adjust `concurrent_threads` based on your VLM API rate limits
- **Processing Time**: Monitor processing times and adjust thread count accordingly  
- **Memory Usage**: Higher thread counts may increase memory usage
- **Error Handling**: Individual frame failures are logged but don't stop processing
- **Client-side Throttling**: Consider implementing client-side throttling for better user experience

## Monitoring and Logging

The API provides comprehensive logging including:
- Concurrent processing statistics
- Individual frame processing times
- Performance metrics and speedup calculations
- Error rates and retry attempts
- Resource usage and cleanup operations 