# Video Analysis API Documentation

## Overview
The Video Analysis API provides intelligent video content analysis using Vision-Language Models (VLM). It supports two analysis modes:
1. **Quick Mode (Thumbnail-only)**: Uses video thumbnail for fast analysis without downloading the full video
2. **Professional Mode (Multi-frame)**: Extracts frames from videos at specified intervals for detailed analysis

Both modes use **concurrent processing** for improved performance and **queue management** to limit concurrent requests.

### Key Features
- **Dual Analysis Modes**: Quick mode for speed, professional mode for accuracy
- **Thumbnail Support**: Analyze videos using only their thumbnails (quick mode)
- **Queue Management**: Automatic queuing when concurrent limit is reached (max 2 concurrent analyses)
- **Concurrent VLM Processing**: Analyzes multiple frames simultaneously using configurable thread count
- **Configurable Frame Intervals**: Supports custom frame extraction intervals with fallback to configuration defaults
- **Performance Optimization**: Significantly faster processing compared to sequential analysis
- **Task Status Tracking**: Monitor task progress via task_id and queue status endpoint
- **Detailed Logging**: Comprehensive performance metrics and processing statistics

## Base URL
```
POST /api/video/analyze
```

## Authentication
No authentication required for this endpoint.

## Request

### Request Body

#### Quick Mode (Thumbnail-only Analysis)
```json
{
  "video_url": "string",
  "thumbnail_url": "string",
  "use_thumbnail": true,
  "custom_prompt": "string (optional)",
  "task_id": "string (optional)"
}
```

#### Professional Mode (Multi-frame Analysis)
```json
{
  "video_url": "string",
  "frame_interval": 5,
  "use_thumbnail": false,
  "custom_prompt": "string (optional)",
  "task_id": "string (optional)"
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `video_url` | string | Yes | - | URL or path to the video file to analyze |
| `frame_interval` | integer | No | 5 (configurable) | Interval in seconds between frames to extract. If not provided or ≤ 0, uses configuration default. **Ignored in quick mode** |
| `custom_prompt` | string | No | null | Custom prompt for LLM analysis |
| `thumbnail_url` | string | No | null | Thumbnail URL for quick mode analysis. **Required when use_thumbnail is true** |
| `use_thumbnail` | boolean | No | false | If true, analyzes only the thumbnail without downloading the full video (quick mode) |
| `task_id` | string | No | auto-generated | Optional task ID for tracking. If not provided, one will be generated automatically |

### Queue Management

The API uses a queue management system to limit concurrent video analysis tasks:

- **Maximum Concurrent Tasks**: 2 (configurable via `config/video-analysis-config.yaml`)
- **Automatic Queuing**: When the limit is reached, new requests are automatically queued
- **Task Tracking**: Each request can have a `task_id` for tracking progress
- **Queue Status**: Check queue status via `/api/video/analysis-queue-status` endpoint
- **Synchronized Status**: Multiple concurrent status checks will correctly reflect the actual queue state

### Configuration
The service uses a configuration file (`config/video-analysis-config.yaml`) with the following key settings:

```yaml
queue_management:
  queue_name: "video_analysis"
  max_concurrent: 2              # Maximum concurrent analysis tasks
  enable_for_single_analysis: true  # Enable queue for single video analysis

vlm_processing:
  concurrent_threads: 5          # Number of concurrent VLM API calls
  api_timeout: 30               # Timeout for individual API calls
  max_retries: 2                # Retry attempts for failed calls

frame_extraction:
  default_frame_interval_seconds: 5    # Default frame interval
  max_frames_per_video: 100           # Maximum frames to extract
```

### Request Examples

### Quick Mode Example
```json
{
  "video_url": "https://example.com/video.mp4",
  "thumbnail_url": "https://example.com/video_thumbnail.jpg",
  "use_thumbnail": true,
  "custom_prompt": "请用一小段话（不超过50字）简要描述这个视频封面中的主要内容和关键元素。",
  "task_id": "my_custom_task_123"
}
```

#### Professional Mode Example
```json
{
  "video_url": "https://example.com/video.mp4",
  "frame_interval": 3,
  "use_thumbnail": false,
  "custom_prompt": "请详细描述视频中的场景、人物动作和情感表达"
}
```

#### Queue Status Check Example
Before submitting analysis requests, you can check the queue status:

```bash
curl -X GET "http://localhost:8000/api/video/analysis-queue-status"
```

Response:
```json
{
  "success": true,
  "queue_info": {
    "queue_name": "video_analysis",
    "max_concurrent": 2,
    "current_processing": 1,
    "queued_count": 2,
    "total_processed": 15,
    "average_processing_time": 45.5
  },
  "tasks": null
}
```

This helps you understand:
- How many videos are currently being processed (`current_processing`)
- How many videos are waiting in queue (`queued_count`)
- Whether there's capacity for immediate processing

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

### Analysis Mode Comparison
| Feature | Quick Mode | Professional Mode |
|---------|-----------|-------------------|
| Video Download | ❌ Not needed | ✅ Required |
| Frame Extraction | ❌ Not needed | ✅ Multiple frames |
| Frames Analyzed | 1 (thumbnail) | Multiple (configurable) |
| Processing Time | 🚀 Fast (3-5 seconds) | ⏱️ Slower (15-60+ seconds) |
| Resource Usage | 💡 Very Low | 🔥 Higher |
| Accuracy | 📊 Basic (single frame) | 🎯 Detailed (multiple frames) |
| Use Case | Quick preview, selection | Detailed analysis, script generation |

### Concurrent Processing (Professional Mode)
The API uses concurrent processing to analyze multiple frames simultaneously:

- **Default Threads**: 5 concurrent VLM API calls
- **Configurable**: Adjustable via configuration file
- **Performance Gain**: Typically 3-5x faster than sequential processing
- **Rate Limiting**: Built-in semaphore prevents API overload

### Processing Time Comparison (Professional Mode)
| Frames | Sequential (estimated) | Concurrent (5 threads) | Speedup |
|--------|----------------------|----------------------|---------|
| 3 frames | ~18 seconds | ~6 seconds | 3x |
| 10 frames | ~60 seconds | ~15 seconds | 4x |
| 20 frames | ~120 seconds | ~30 seconds | 4x |

### Quick Mode Performance
| Operation | Time |
|-----------|------|
| Thumbnail download | ~1-2 seconds |
| VLM analysis (1 frame) | ~2-3 seconds |
| **Total** | **~3-5 seconds** |

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 500 | Internal Server Error - Analysis failed |

## Usage Examples

### Quick Mode - Thumbnail Analysis (Fast)
```bash
curl -X POST "http://localhost:8000/api/video/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/sample-video.mp4",
    "thumbnail_url": "https://example.com/sample-video_thumbnail.jpg",
    "use_thumbnail": true,
    "custom_prompt": "请简要描述这个视频封面的主要内容"
  }'
```

### Professional Mode - Basic Video Analysis
```bash
curl -X POST "http://localhost:8000/api/video/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/sample-video.mp4",
    "use_thumbnail": false
  }'
```

### Professional Mode - Custom Frame Interval
```bash
curl -X POST "http://localhost:8000/api/video/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/sample-video.mp4",
    "frame_interval": 2,
    "use_thumbnail": false
  }'
```

### Professional Mode - Custom Analysis with Specific Prompt
```bash
curl -X POST "http://localhost:8000/api/video/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/product-demo.mp4",
    "frame_interval": 2,
    "use_thumbnail": false,
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

1. **Queue Management**:
   - Maximum 2 concurrent video analysis tasks by default
   - Additional requests are automatically queued when limit is reached
   - Queue status can be checked via `/api/video/analysis-queue-status`
   - Task progress can be tracked using the `task_id` parameter
2. **Analysis Modes**: 
   - **Quick Mode**: Uses thumbnail only, very fast (seconds), suitable for preview and quick selection
   - **Professional Mode**: Extracts multiple frames, slower (minutes), suitable for detailed analysis
3. **Video Format Support**: Supports common video formats (MP4, AVI, MOV, MKV, WebM, FLV)
4. **Processing Time**: 
   - Quick mode: ~3-5 seconds (thumbnail download + 1 VLM call)
   - Professional mode: Significantly improved with concurrent processing (3-5x speedup typical)
5. **Frame Extraction**: Frames are extracted at specified intervals and temporarily stored (professional mode only)
6. **Cleanup**: Temporary files (frames/thumbnails) are automatically cleaned up after analysis
7. **VLM Configuration**: Requires proper VL_LLM configuration in environment variables
8. **Concurrent Limits**: Thread count is configurable to balance speed vs. API rate limits
9. **Error Handling**: Individual frame failures don't stop the entire analysis
10. **Performance Logging**: Detailed metrics available for monitoring and optimization
11. **Thumbnail Requirement**: Quick mode requires a valid thumbnail_url parameter

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