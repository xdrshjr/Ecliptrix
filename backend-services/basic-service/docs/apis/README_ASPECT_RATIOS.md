# Video Aspect Ratio Support

This document describes the new aspect ratio support feature for video composition.

## Overview

The video composition API now supports automatic aspect ratio conversion with letterboxing/pillarboxing to maintain original video proportions. This is particularly useful for creating content for different social media platforms and display formats.

## Supported Aspect Ratios

| Aspect Ratio | Resolution | Use Case |
|--------------|------------|----------|
| `16:9` | 1920x1080 | Standard widescreen, YouTube, desktop |
| `9:16` | 1080x1920 | Vertical/Portrait, TikTok, Instagram Stories |
| `4:3` | 1440x1080 | Traditional TV, presentations |
| `1:1` | 1080x1080 | Square format, Instagram posts |
| `21:9` | 2560x1080 | Ultra-wide, cinematic content |

## How It Works

### Letterboxing/Pillarboxing
- When converting between different aspect ratios, the system preserves the original video's aspect ratio
- Black bars are added as needed instead of stretching or cropping the video
- **Example**: Converting a 16:9 video to 9:16 will add black bars at the top and bottom

### Multi-Video Composition
- The system can compose multiple videos into a single output video
- Each video is placed sequentially in the timeline
- All videos are normalized to the target aspect ratio before composition
- Duration is evenly distributed among all input videos

### Automatic Resolution Calculation
- The `output_resolution` parameter is now optional
- If not provided, resolution is automatically calculated from the `aspect_ratio` parameter
- You can still override with custom resolution if needed

## API Usage

### Multi-Video Composition with Aspect Ratio

```json
{
  "task_id": "multi_video_composition",
  "aspect_ratio": "9:16",
  "video_items": [
    {
      "id": "video1",
      "name": "video-1.mp4",
      "url": "videos/video-1.mp4",
      "start_time": 0.0,
      "duration": 10.0,
      "track_id": "track1",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 0.0,
      "clip_end": 10.0
    },
    {
      "id": "video2",
      "name": "video-2.mp4",
      "url": "videos/video-2.mp4",
      "start_time": 10.0,
      "duration": 10.0,
      "track_id": "track1",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 0.0,
      "clip_end": 10.0
    }
  ],
  "total_duration": 20.0,
  "output_fps": 30
}
```

### Custom Resolution Override

```json
{
  "task_id": "my_video_task", 
  "aspect_ratio": "16:9",
  "output_resolution": {
    "width": 1280,
    "height": 720
  },
  "video_items": [...],
  "total_duration": 30.0
}
```

## Testing

### Prerequisites
1. Start the backend server: `python run.py`
2. Ensure the server is running on `http://localhost:8000`
3. Make sure you have video files in the `videos/` directory

### Test Scripts

#### 1. Multi-Video Composition Test Script
```bash
# Test all aspect ratios with all videos composed together
python test_aspect_ratios.py

# Test specific aspect ratio with all videos
python test_aspect_ratios.py 9:16

# Test with custom duration (30 seconds total)
python test_aspect_ratios.py 16:9 30
```

#### 2. Advanced Test Suite
```bash
# Run comprehensive tests
python tests/test_video_aspect_ratios.py

# Run single test
python tests/test_video_aspect_ratios.py --aspect-ratio 9:16
```

### Expected Test Results

For each test, you should see:
1. 📹 List of videos found in the videos directory
2. 📊 Composition details showing how videos are arranged in timeline
3. ✅ Composition request accepted
4. ⏳ Progress updates during processing
5. 🎉 Successful completion with output file size
6. 📂 Generated video file in `static/video/composed/`

### Test Example Output

```
🎬 Testing: Multiple videos composition -> 9:16
📹 Found 2 videos: ['video-1.mp4', 'video-2.mp4']
📊 Composition details:
   - Total duration: 20.0s
   - Videos: 2
   - Duration per video: 10.0s
   - video-1.mp4: 0.0s - 10.0s
   - video-2.mp4: 10.0s - 20.0s
📤 Sending composition request...
✅ Composition started: abc123-def456-789
⏳ Status: processing, Progress: 45.0% (15s)
🎉 Composition completed in 45s!
📁 Output size: 15,234,567 bytes (14.5 MB)
📂 Output file: static/video/composed/composed_abc123-def456-789.mp4
```

### Verifying Results

1. **Check output videos**: Look in `static/video/composed/` for generated files
2. **Verify aspect ratios**: Use a video player or tool to confirm the output aspect ratio
3. **Check video sequence**: Ensure videos play in the correct order
4. **Check for letterboxing**: Ensure black bars are present when converting between different ratios
5. **Validate quality**: Confirm original video quality is preserved

## Common Use Cases

### Social Media Content Creation
```python
# Create vertical video for TikTok/Instagram Stories from multiple clips
request = {
    "aspect_ratio": "9:16",
    "video_items": [
        {"url": "videos/intro.mp4", "start_time": 0.0, "duration": 5.0},
        {"url": "videos/main.mp4", "start_time": 5.0, "duration": 15.0},
        {"url": "videos/outro.mp4", "start_time": 20.0, "duration": 5.0}
    ],
    "total_duration": 25.0
}

# Create square video for Instagram Posts
request = {
    "aspect_ratio": "1:1", 
    "video_items": [multiple_clips],
    "total_duration": 30.0
}
```

### Professional Content
```python
# Create cinematic ultra-wide compilation
request = {
    "aspect_ratio": "21:9",
    "video_items": [multiple_clips],
    "total_duration": 60.0
}

# Create traditional presentation format
request = {
    "aspect_ratio": "4:3",
    "video_items": [presentation_clips],
    "total_duration": 45.0
}
```

## Troubleshooting

### Common Issues

1. **Server not responding**
   - Check if the backend server is running: `curl http://localhost:8000/api/video/compose/health`
   - Restart the server if needed: `python run.py`

2. **Video files not found**
   - Ensure video files are in the `videos/` directory
   - Check file permissions and formats (MP4 recommended)

3. **Composition fails**
   - Check server logs for detailed error messages
   - Verify FFmpeg is installed and accessible
   - Ensure sufficient disk space for output files

4. **Unexpected aspect ratios**
   - Verify the `aspect_ratio` parameter is correctly set
   - Check if custom `output_resolution` is overriding the aspect ratio

5. **Videos not in correct order**
   - Check the `start_time` values in video_items
   - Ensure no overlapping time ranges

### Debug Mode

Enable detailed logging by setting the log level to DEBUG in your configuration:

```python
import logging
logging.getLogger('app.services.video_composition_service').setLevel(logging.DEBUG)
```

## Performance Notes

- **Processing time**: Varies based on total video length, number of videos, resolution, and aspect ratio conversion complexity
- **File sizes**: Output file sizes depend on the target resolution and compression settings
- **Memory usage**: Higher resolutions and more videos require more memory during processing
- **Concurrent processing**: Multiple videos are processed in parallel during normalization

## API Documentation

For complete API documentation including all parameters and response formats, see:
- `docs/apis/video_composition_api.md`

## Examples

The `videos/` directory contains sample videos for testing:
- `video-1.mp4` - Sample video file 1
- `video-2.mp4` - Sample video file 2

These videos will be composed together in sequence when running the test scripts to verify multi-video aspect ratio conversion functionality. 