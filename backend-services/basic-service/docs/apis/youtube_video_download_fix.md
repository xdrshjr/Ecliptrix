# YouTube Video Download Fix for Video Composition

## Overview

This document describes the fix implemented for YouTube video download issues in the Video Composition service. Previously, when YouTube videos were added to the timeline and used in video composition, the system would fail because FFmpeg cannot directly process YouTube URLs.

## Problem Description

### Issue
- **Error**: `Error opening input file https://www.youtube.com/watch?v=QRKGAY8EoW8. Error opening input files: Invalid data found when processing input`
- **Root Cause**: The video composition service was attempting to use FFmpeg directly on YouTube URLs, which is not supported
- **Impact**: YouTube videos added from the video search panel could not be used in video composition

### Error Log Example
```
2025-08-21 21:50:38 - app.services.video_composition_service - ERROR - [Thread 12204] Download failed: ffmpeg version 2025-05-15-git-12b853530a-full_build-www.gyan.dev
[in#0 @ 0000028fa3233700] Error opening input: Invalid data found when processing input
Error opening input file https://www.youtube.com/watch?v=QRKGAY8EoW8.
Error opening input files: Invalid data found when processing input
```

## Solution Implementation

### Architecture Changes

1. **YouTube URL Detection**: Added `_is_youtube_url()` method to detect YouTube URLs
2. **Service Integration**: Integrated existing `YouTubeService` into `VideoCompositionService`
3. **Download Strategy**: Split download logic into YouTube-specific and FFmpeg-based methods

### Code Changes

#### 1. Service Initialization
```python
# Added YouTube service initialization
self.youtube_service = YouTubeService()
```

#### 2. URL Detection Method
```python
def _is_youtube_url(self, url: str) -> bool:
    """Check if the URL is a YouTube URL."""
    return "youtube.com" in url or "youtu.be" in url
```

#### 3. Enhanced Download Method
```python
def _download_video(self, video_url: str, temp_dir: str, index: int) -> Dict[str, Any]:
    """Download a single video file."""
    # Check if it's a YouTube URL
    if self._is_youtube_url(video_url):
        return self._download_youtube_video(video_url, video_path, thread_id)
    else:
        return self._download_video_with_ffmpeg(video_url, video_path, thread_id)
```

#### 4. YouTube-Specific Download
```python
def _download_youtube_video(self, video_url: str, target_path: str, thread_id: int) -> Dict[str, Any]:
    """Download YouTube video using YouTubeService."""
    # Uses yt-dlp through YouTubeService
    # Downloads with 720p quality for optimal composition performance
    # Moves downloaded file to target location
```

### Dependencies

- **yt-dlp**: YouTube video downloader (already available in project)
- **YouTubeService**: Existing service for YouTube operations
- **YoutubeVideoDownloadRequest**: Model for YouTube download requests

## API Impact

### Endpoints Affected
- **POST** `/api/video/compose` - Now supports YouTube URLs in video_items

### Request Format (No Changes)
The API request format remains the same. YouTube URLs can be used directly in the `url` field of video items:

```json
{
  "task_id": "export_task-1755783964700_1755784234136",
  "video_items": [
    {
      "id": "item-1755784214010-k2my5ekrx",
      "name": "Puppy Playtime - Westie pups have fun in the garden",
      "url": "https://www.youtube.com/watch?v=QRKGAY8EoW8",
      "start_time": 0.0,
      "duration": 44.2,
      "track_id": "video-track-1",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 0.0,
      "clip_end": 44.2
    }
  ]
}
```

### Response Format (No Changes)
The response format remains unchanged. Success/failure is reported through the existing status endpoints.

## Logging Enhancements

### New Log Messages
- `Detected YouTube URL, using yt-dlp for download`
- `Starting YouTube download with yt-dlp`
- `YouTube download successful: {size}MB`
- `Using FFmpeg for direct video URL download`
- `Executing FFmpeg download command`

### Error Handling
- Detailed error messages for YouTube download failures
- Fallback error handling for file movement operations
- Thread-specific logging for concurrent downloads

## Performance Considerations

### YouTube Download Settings
- **Quality**: 720p (balance between quality and download speed)
- **Format**: MP4 (optimal for FFmpeg processing)
- **Timeout**: Managed by yt-dlp internal settings
- **Retries**: 3 attempts (yt-dlp default)

### File Management
- Downloaded files are moved to temporary composition directory
- Automatic cleanup of temporary files after composition
- File size validation to ensure successful downloads

## Testing

### Test Scenarios
1. **YouTube URL Composition**: Verify YouTube videos can be downloaded and composed
2. **Mixed URL Types**: Test composition with both YouTube and direct video URLs
3. **Error Handling**: Verify proper error reporting for failed downloads
4. **Concurrent Downloads**: Test multiple YouTube videos downloading simultaneously

### Validation Steps
1. Add YouTube video to timeline
2. Initiate video composition
3. Verify successful download and composition
4. Check log messages for proper flow indication

## Backward Compatibility

- **Non-YouTube URLs**: Continue to use FFmpeg for direct video URLs
- **Existing API**: No changes to request/response formats
- **Error Handling**: Enhanced error messages, same error structure

## Future Enhancements

### Potential Improvements
1. **Quality Selection**: Allow dynamic quality selection based on composition requirements
2. **Caching**: Implement caching for frequently used YouTube videos
3. **Progress Tracking**: Add download progress reporting for large videos
4. **Format Optimization**: Automatic format selection based on composition needs

### Monitoring
- Track YouTube download success rates
- Monitor download times and file sizes
- Log quality degradation issues

## Troubleshooting

### Common Issues
1. **yt-dlp Not Available**: Ensure yt-dlp is installed in the environment
2. **Network Issues**: YouTube downloads may fail due to network connectivity
3. **Rate Limiting**: YouTube may rate limit requests from the same IP
4. **Video Unavailability**: Some YouTube videos may not be downloadable

### Debug Steps
1. Check log messages for specific error details
2. Verify yt-dlp installation: `pip list | grep yt-dlp`
3. Test YouTube URL directly with yt-dlp command line
4. Check network connectivity and proxy settings

## Related Documentation
- [Video Composition API](./video_composition_api.md)
- [YouTube Service API](./youtube_api.md)
- [Error Handling Guide](./error_handling.md) 