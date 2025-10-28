# Batch Video Analysis API Documentation

## Overview
The Batch Video Analysis API provides intelligent batch video content analysis using Vision-Language Models (VLM) with an optimized two-phase processing approach. This endpoint is specifically designed for the AI Mixed Editing feature to efficiently analyze multiple videos in a single API call.

### Key Features
- **Two-Phase Processing Architecture**:
  1. **Sequential Frame Extraction**: Extract frames from videos one by one to avoid resource contention
  2. **Concurrent VLM Analysis**: Analyze all extracted frames in parallel using configurable thread count
- **Optimized Performance**: Significantly faster than sequential single-video analysis
- **Configurable Concurrency**: Thread count controlled via configuration file
- **Detailed Performance Metrics**: Comprehensive timing and statistics for both phases
- **Automatic Result Storage**: Analysis results automatically stored for future use

### Performance Benefits
Compared to calling single video analysis endpoint multiple times:
- **Faster VLM Processing**: Analyzes all frames concurrently instead of sequentially
- **Better Resource Utilization**: Maximizes VLM API throughput
- **Detailed Insights**: Provides phase-specific timing metrics
- **Single API Call**: Reduces network overhead and simplifies client code

## Base URL
```
POST /api/video/batch-analyze
```

## Authentication
No authentication required for this endpoint.

## Request

### Request Body
```json
{
  "videos": [
    {
      "video_url": "string",
      "frame_interval": 5
    }
  ],
  "custom_prompt": "string (optional)"
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `videos` | array | Yes | - | List of videos to analyze |
| `videos[].video_url` | string | Yes | - | URL or path to the video file |
| `videos[].frame_interval` | integer | No | 5 | Interval in seconds between frames to extract |
| `custom_prompt` | string | No | null | Custom prompt for LLM analysis (applies to all videos) |

### Configuration
The service uses configuration from `config/video-analysis-config.yaml`:

```yaml
vlm_processing:
  concurrent_threads: 3          # Number of concurrent VLM API calls
  api_timeout: 30               # Timeout for individual API calls
  max_retries: 2                # Retry attempts for failed calls

frame_extraction:
  default_frame_interval_seconds: 5    # Default frame interval
  max_frames_per_video: 5             # Maximum frames to extract per video
```

### Request Constraints
- **Maximum Videos**: 50 videos per batch request
- **Video URL**: Cannot be empty
- **Frame Interval**: Must be positive integer (or use default)

### Request Example
```json
{
  "videos": [
    {
      "video_url": "https://example.com/video1.mp4",
      "frame_interval": 5
    },
    {
      "video_url": "https://example.com/video2.mp4",
      "frame_interval": 3
    },
    {
      "video_url": "https://example.com/video3.mp4",
      "frame_interval": 5
    }
  ],
  "custom_prompt": "请详细描述视频中的场景、人物动作和情感表达"
}
```

## Response

### Success Response (200 OK)
```json
{
  "success": true,
  "total_videos": 3,
  "successful_videos": 3,
  "failed_videos": 0,
  "results": [
    {
      "video_url": "https://example.com/video1.mp4",
      "success": true,
      "total_frames_extracted": 6,
      "video_duration": 30.5,
      "frame_analyses": [
        {
          "frame_number": 0,
          "timestamp": 0.0,
          "analysis": "画面显示一个阳光明媚的公园场景...",
          "frame_path": "/tmp/frames/frame_0000_0.00s.jpg"
        },
        {
          "frame_number": 1,
          "timestamp": 5.0,
          "analysis": "镜头切换到湖边，有人在划船...",
          "frame_path": "/tmp/frames/frame_0001_5.00s.jpg"
        }
      ],
      "error_message": null
    },
    {
      "video_url": "https://example.com/video2.mp4",
      "success": true,
      "total_frames_extracted": 8,
      "video_duration": 24.0,
      "frame_analyses": [
        {
          "frame_number": 0,
          "timestamp": 0.0,
          "analysis": "室内场景，办公室环境...",
          "frame_path": "/tmp/frames/frame_0000_0.00s.jpg"
        }
      ],
      "error_message": null
    }
  ],
  "total_frames_extracted": 14,
  "total_processing_time": 25.3,
  "frame_extraction_time": 8.5,
  "vlm_analysis_time": 15.2,
  "concurrent_threads": 3,
  "timestamp": "2024-01-15T10:30:00Z",
  "message": "Batch analysis completed: 3/3 videos successful, 14 frames extracted and analyzed with 3 concurrent threads"
}
```

### Partial Success Response (200 OK)
When some videos fail but others succeed:
```json
{
  "success": false,
  "total_videos": 3,
  "successful_videos": 2,
  "failed_videos": 1,
  "results": [
    {
      "video_url": "https://example.com/video1.mp4",
      "success": true,
      "total_frames_extracted": 6,
      "video_duration": 30.5,
      "frame_analyses": [...],
      "error_message": null
    },
    {
      "video_url": "https://example.com/invalid-video.mp4",
      "success": false,
      "total_frames_extracted": 0,
      "video_duration": 0.0,
      "frame_analyses": [],
      "error_message": "Failed to open video file"
    }
  ],
  "total_frames_extracted": 6,
  "total_processing_time": 20.5,
  "frame_extraction_time": 5.2,
  "vlm_analysis_time": 14.1,
  "concurrent_threads": 3,
  "timestamp": "2024-01-15T10:30:00Z",
  "message": "Batch analysis completed: 2/3 videos successful, 6 frames extracted and analyzed with 3 concurrent threads"
}
```

### Error Response (400 Bad Request)
```json
{
  "detail": "At least one video must be provided for batch analysis"
}
```

### Error Response (500 Internal Server Error)
```json
{
  "detail": "Internal server error occurred during batch video analysis"
}
```

## Response Fields

### BatchVideoAnalysisResponse
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether all videos were successfully analyzed |
| `total_videos` | integer | Total number of videos in the batch |
| `successful_videos` | integer | Number of successfully analyzed videos |
| `failed_videos` | integer | Number of failed video analyses |
| `results` | array | List of individual video analysis results |
| `total_frames_extracted` | integer | Total frames extracted across all videos |
| `total_processing_time` | number | Total time in seconds for entire batch |
| `frame_extraction_time` | number | Time spent on sequential frame extraction (Phase 1) |
| `vlm_analysis_time` | number | Time spent on concurrent VLM analysis (Phase 2) |
| `concurrent_threads` | integer | Number of concurrent threads used for VLM analysis |
| `timestamp` | string | Timestamp of the analysis |
| `message` | string | Summary message |

### BatchVideoAnalysisResult (per video)
| Field | Type | Description |
|-------|------|-------------|
| `video_url` | string | URL of the analyzed video |
| `success` | boolean | Whether this video was successfully analyzed |
| `total_frames_extracted` | integer | Number of frames extracted from this video |
| `video_duration` | number | Duration of the video in seconds |
| `frame_analyses` | array | List of frame analysis results for this video |
| `error_message` | string | Error message if analysis failed (null if successful) |

### FrameAnalysis
| Field | Type | Description |
|-------|------|-------------|
| `frame_number` | integer | Frame number in the video |
| `timestamp` | number | Timestamp of the frame in seconds |
| `analysis` | string | LLM analysis description of the frame |
| `frame_path` | string | Path to the extracted frame image |

## Processing Flow

### Phase 1: Sequential Frame Extraction
1. Process each video one by one
2. Download video if needed
3. Extract frames at specified intervals
4. Store frame metadata and paths
5. Log extraction progress for each video

**Why Sequential?**
- Prevents disk I/O contention
- Reduces memory pressure
- More stable and predictable

### Phase 2: Concurrent VLM Analysis
1. Collect all extracted frames from all videos
2. Create concurrent tasks for each frame
3. Use semaphore to limit concurrent VLM API calls
4. Execute all frame analyses in parallel
5. Collect results and associate with videos

**Why Concurrent?**
- Maximizes VLM API throughput
- Significantly reduces total processing time
- Efficient use of network resources

## Performance Metrics

### Timing Breakdown
The response includes detailed timing information:
- **total_processing_time**: Complete end-to-end time
- **frame_extraction_time**: Time for Phase 1 (sequential)
- **vlm_analysis_time**: Time for Phase 2 (concurrent)

### Example Performance
For 3 videos with 5 frames each (15 total frames):
- **Sequential frame extraction**: ~8 seconds
- **Concurrent VLM analysis** (3 threads): ~15 seconds
- **Total processing time**: ~25 seconds

Compare to sequential single-video calls:
- **Estimated time**: 3 videos × 30 seconds = 90 seconds
- **Speedup**: ~3.6x faster with batch processing

### Performance Tuning
Adjust `concurrent_threads` in configuration based on:
- VLM API rate limits
- Available system resources
- Desired processing speed

## Error Handling

### Per-Video Error Handling
- Individual video failures don't stop the entire batch
- Failed videos return error details in their result object
- Successful videos return complete analysis data

### Common Errors
| Error | Cause | Solution |
|-------|-------|----------|
| Empty videos list | No videos provided | Provide at least one video |
| Too many videos | More than 50 videos | Split into multiple batches |
| Empty video URL | Invalid video URL | Provide valid video URL |
| Video file not found | Invalid URL or path | Check video URL/path |
| VLM API failure | API error or timeout | Check VLM configuration |

## Usage Examples

### Basic Batch Analysis
```bash
curl -X POST "http://localhost:8000/api/video/batch-analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "videos": [
      {
        "video_url": "https://example.com/video1.mp4",
        "frame_interval": 5
      },
      {
        "video_url": "https://example.com/video2.mp4",
        "frame_interval": 5
      }
    ]
  }'
```

### Custom Frame Interval per Video
```bash
curl -X POST "http://localhost:8000/api/video/batch-analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "videos": [
      {
        "video_url": "https://example.com/short-video.mp4",
        "frame_interval": 2
      },
      {
        "video_url": "https://example.com/long-video.mp4",
        "frame_interval": 10
      }
    ],
    "custom_prompt": "分析视频中的产品特性和使用场景"
  }'
```

### AI Mixed Editing Integration
```javascript
// Frontend example for AI Mixed Editing feature
const videoMaterials = [
  { url: "video1.mp4", frameInterval: 5 },
  { url: "video2.mp4", frameInterval: 5 },
  { url: "video3.mp4", frameInterval: 5 }
];

const response = await fetch('/api/video/batch-analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    videos: videoMaterials.map(v => ({
      video_url: v.url,
      frame_interval: v.frameInterval
    }))
  })
});

const result = await response.json();
console.log(`Analyzed ${result.successful_videos}/${result.total_videos} videos`);
console.log(`Extracted ${result.total_frames_extracted} frames in ${result.total_processing_time}s`);
```

## Best Practices

### Batch Size
- **Recommended**: 3-10 videos per batch
- **Maximum**: 50 videos per batch
- **Consideration**: Balance between efficiency and processing time

### Frame Interval
- **Quick mode**: 1 frame per video (frame_interval = video_duration)
- **Standard mode**: 5-second intervals (default)
- **Detailed mode**: 2-3 second intervals

### Error Recovery
- Check `success` field for overall status
- Check individual video `success` fields
- Handle partial failures gracefully
- Retry failed videos separately if needed

### Performance Optimization
1. Group similar-length videos together
2. Adjust concurrent_threads based on API limits
3. Use appropriate frame intervals
4. Monitor processing time metrics

## Integration with AI Mixed Editing

The batch analysis API is specifically designed for the AI Mixed Editing workflow:

1. **User selects multiple videos** for AI mixed editing
2. **Frontend calls batch-analyze** with all videos in one request
3. **Backend performs two-phase processing**:
   - Sequential frame extraction from each video
   - Concurrent VLM analysis of all frames
4. **Results are stored** and used by AI mixed editing service
5. **Timeline is generated** with video analysis insights

### Benefits for AI Mixed Editing
- **Single API call** instead of multiple sequential calls
- **Faster processing** through concurrent VLM analysis
- **Better UX** with more predictable processing time
- **Detailed metrics** for progress reporting

## Configuration Requirements

### Environment Variables
```env
VL_LLM_API_KEY=your_vl_llm_api_key
VL_LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VL_LLM_MODEL=qwen-vl-plus
```

### Configuration File
Located at: `backend-services/basic-service/config/video-analysis-config.yaml`

```yaml
vlm_processing:
  concurrent_threads: 3      # Adjust based on API rate limits
  api_timeout: 30           # Increase for slower networks
  max_retries: 2            # Retry failed API calls

frame_extraction:
  default_frame_interval_seconds: 5
  max_frames_per_video: 5

performance:
  enable_performance_logging: true
  log_concurrent_stats: true
  max_video_duration_seconds: 3600

temp_files:
  auto_cleanup: true
  cleanup_timeout: 300
```

## Monitoring and Logging

The API provides comprehensive logging:
- Phase-specific progress logging
- Per-video extraction status
- Concurrent processing statistics
- Performance metrics and speedup calculations
- Error details for failed videos

### Log Levels
- **INFO**: Processing progress and statistics
- **DEBUG**: Detailed frame-by-frame information
- **WARNING**: Partial failures or degraded performance
- **ERROR**: Critical failures with stack traces

## Notes

1. **Video Format Support**: MP4, AVI, MOV, MKV, WebM, FLV
2. **Frame Cleanup**: Temporary files automatically cleaned up
3. **Result Storage**: Analysis results stored for future use
4. **Concurrent Safety**: Thread-safe implementation with semaphores
5. **Memory Efficient**: Sequential extraction prevents memory issues
6. **API Efficient**: Concurrent analysis maximizes throughput
7. **Detailed Metrics**: Comprehensive timing and performance data

