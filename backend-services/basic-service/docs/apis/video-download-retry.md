# Video Download Retry API Documentation

## Overview

The Video Composition API now includes enhanced retry functionality for Pexels video downloads. When a Pexels video download fails, the system will automatically retry the download using different API keys, improving reliability and success rates.

## Features

### Automatic Pexels Detection
- The system automatically detects Pexels video URLs (containing "pexels.com")
- Pexels videos are handled with specialized retry logic
- Other video sources (YouTube, direct URLs) continue to work as before

### Configurable Retry Logic
- **Maximum Retries**: Configurable number of retry attempts (default: 5)
- **API Key Rotation**: Automatically switches between available Pexels API keys on retry
- **Retry Delay**: Configurable delay between retry attempts (default: 2.0 seconds)
- **Timeout**: Configurable download timeout per attempt (default: 120 seconds)

## Configuration

### Configuration File: `config/video-download.yaml`

```yaml
pexels:
  retry:
    # Maximum number of retry attempts when download fails
    max_retries: 5
    
    # Whether to switch API keys on each retry attempt
    switch_api_key_on_retry: true
    
    # Timeout for each download attempt (seconds)
    download_timeout: 120
    
    # Delay between retry attempts (seconds)
    retry_delay: 2.0
  
  download:
    # Maximum file size for video downloads (MB)
    max_file_size_mb: 500
    
    # Minimum file size to consider download valid (KB)
    min_file_size_kb: 1

general:
  # Temporary directory cleanup
  cleanup_temp_files: true
  
  # Enable detailed download logging
  detailed_logging: true
```

### Environment Variables

The system uses the existing Pexels API key configuration:

```bash
# Multiple API keys separated by commas
PEXELS_API_KEY=key1,key2,key3,key4,key5
```

## API Endpoints

### POST `/api/video/compose`

The existing video composition endpoint now includes enhanced Pexels download reliability.

#### Enhanced Behavior

1. **Pexels URL Detection**: Automatically detects Pexels video URLs in `video_items`
2. **Retry Logic**: If a Pexels download fails, automatically retries with:
   - Different API keys (if multiple are configured)
   - Configurable retry count and delays
   - Detailed logging of each attempt
3. **Fallback**: If all retries fail, returns appropriate error information

#### Request Example

```json
{
  "task_id": "composition_001",
  "aspect_ratio": "16:9",
  "video_items": [
    {
      "id": "video_1",
      "name": "Pexels Video",
      "url": "https://player.vimeo.com/external/12345.mp4?s=abcd&profile_id=174&oauth2_token_id=12345",
      "start_time": 0.0,
      "duration": 10.0,
      "track_id": "track_1",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 0.0,
      "clip_end": 10.0
    }
  ],
  "audio_items": [],
  "subtitle_items": [],
  "total_duration": 10.0,
  "output_resolution": {
    "width": 1920,
    "height": 1080
  },
  "output_fps": 30,
  "output_format": "mp4"
}
```

## Logging

### Enhanced Logging for Pexels Downloads

The system provides detailed logging for Pexels download attempts:

```
2025-08-24 15:59:00 - app.services.video_composition_service - INFO - [Thread 12756] Detected Pexels URL, using retry logic with API key switching
2025-08-24 15:59:00 - app.services.video_composition_service - INFO - [Thread 12756] Starting Pexels video download with retry logic (max_retries: 5)
2025-08-24 15:59:01 - app.services.video_composition_service - WARNING - [Thread 12756] Pexels download attempt 1 failed: FFmpeg download failed
2025-08-24 15:59:03 - app.services.video_composition_service - INFO - [Thread 12756] Retry attempt 1/5 for Pexels download
2025-08-24 15:59:03 - app.services.video_composition_service - INFO - [Thread 12756] Using API key: abcd1234567...xyz89
2025-08-24 15:59:05 - app.services.video_composition_service - INFO - [Thread 12756] Pexels download succeeded on retry attempt 1
```

### Log Levels

- **INFO**: Successful downloads, retry attempts, API key switching
- **WARNING**: Failed download attempts (before final failure)
- **ERROR**: Final failures after all retries exhausted
- **DEBUG**: Detailed internal state information

## Error Handling

### Retry Scenarios

The system will retry Pexels downloads in the following scenarios:
- Network timeouts
- FFmpeg download failures
- HTTP errors from video CDN
- Temporary file system issues

### Final Failure Handling

If all retry attempts fail:
1. The system logs the complete failure chain
2. Returns detailed error information including:
   - Number of attempts made
   - Last error encountered
   - Suggested troubleshooting steps

### Error Response Example

```json
{
  "success": false,
  "error": "All retry attempts failed. Last error: FFmpeg download failed: HTTP 403 Forbidden",
  "details": {
    "attempts_made": 6,
    "max_retries": 5,
    "video_url": "https://player.vimeo.com/...",
    "retry_configuration": {
      "max_retries": 5,
      "switch_api_key_on_retry": true,
      "retry_delay": 2.0
    }
  }
}
```

## Performance Impact

### Resource Usage
- **Memory**: Minimal additional memory usage
- **CPU**: Slight increase due to retry logic
- **Network**: Additional bandwidth for retry attempts
- **Time**: Configurable delays between retries

### Optimization
- API key rotation reduces rate limiting
- Configurable timeouts prevent hanging downloads
- Exponential backoff could be added in future versions

## Troubleshooting

### Common Issues

1. **No API Keys Configured**
   - Ensure `PEXELS_API_KEY` environment variable is set
   - Verify API keys are valid and active

2. **All Retries Failing**
   - Check network connectivity
   - Verify Pexels service status
   - Review API key quotas and limits

3. **Configuration Not Loading**
   - Verify `config/video-download.yaml` exists
   - Check YAML syntax
   - Review file permissions

### Monitoring

Monitor the following metrics:
- Pexels download success rates
- Average retry attempts per download
- API key usage distribution
- Download completion times

## Future Enhancements

Planned improvements include:
- Exponential backoff retry strategy
- Circuit breaker pattern for failed API keys
- Detailed metrics and monitoring
- Support for other video providers
- Intelligent API key health checking 