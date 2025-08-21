# Configuration API

## Overview

The Configuration API provides access to application configuration settings, including YouTube video download and upload configuration.

## Base URL

```
/api
```

## Authentication

Currently, no authentication is required for this endpoint.

## Endpoints

### 1. Get Application Configuration

**GET** `/config`

Get non-sensitive application configuration information, including YouTube settings.

#### Request

No parameters required.

#### Request Example

```bash
curl -X GET "http://localhost:8000/api/config" \
  -H "Accept: application/json"
```

#### Response

**Success Response (200 OK):**

```json
{
  "success": true,
  "message": "Configuration retrieved successfully",
  "data": {
    "app_name": "Basic Service API",
    "app_version": "1.0.0",
    "log_level": "INFO",
    "debug": false,
    "llm_api_url": "https://api.example.com",
    "host": "0.0.0.0",
    "port": 8000,
    "youtube": {
      "download": {
        "max_concurrent_downloads": 3,
        "download_timeout": 300,
        "max_retries": 3,
        "retry_delay": 5
      },
      "upload": {
        "upload_timeout": 600,
        "max_retries": 3,
        "retry_delay": 10
      },
      "quality": {
        "default_video_quality": "720p",
        "default_audio_quality": "best",
        "default_format": "mp4"
      },
      "file_management": {
        "auto_cleanup": true,
        "temp_file_retention_hours": 24,
        "generate_thumbnail": true
      },
      "logging": {
        "enable_detailed_logging": true,
        "log_download_progress": true,
        "progress_log_interval": 10
      }
    }
  }
}
```

**Error Response (500 Internal Server Error):**

```json
{
  "success": false,
  "message": "Configuration retrieval failed",
  "error": "Internal server error"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request was successful |
| `message` | string | Response message |
| `data` | object | Configuration data |
| `data.app_name` | string | Application name |
| `data.app_version` | string | Application version |
| `data.log_level` | string | Current logging level |
| `data.debug` | boolean | Whether debug mode is enabled |
| `data.llm_api_url` | string | LLM API base URL |
| `data.host` | string | Server host |
| `data.port` | number | Server port |
| `data.youtube` | object | YouTube configuration |
| `data.youtube.download` | object | Download configuration |
| `data.youtube.download.max_concurrent_downloads` | number | Maximum concurrent downloads (1-10) |
| `data.youtube.download.download_timeout` | number | Download timeout in seconds |
| `data.youtube.download.max_retries` | number | Maximum retry attempts |
| `data.youtube.download.retry_delay` | number | Delay between retries in seconds |
| `data.youtube.upload` | object | Upload configuration |
| `data.youtube.upload.upload_timeout` | number | Upload timeout in seconds |
| `data.youtube.upload.max_retries` | number | Maximum retry attempts |
| `data.youtube.upload.retry_delay` | number | Delay between retries in seconds |
| `data.youtube.quality` | object | Quality configuration |
| `data.youtube.quality.default_video_quality` | string | Default video quality |
| `data.youtube.quality.default_audio_quality` | string | Default audio quality |
| `data.youtube.quality.default_format` | string | Default output format |
| `data.youtube.file_management` | object | File management configuration |
| `data.youtube.file_management.auto_cleanup` | boolean | Whether to auto-cleanup temporary files |
| `data.youtube.file_management.temp_file_retention_hours` | number | Hours to retain temporary files |
| `data.youtube.file_management.generate_thumbnail` | boolean | Whether to generate thumbnails |
| `data.youtube.logging` | object | Logging configuration |
| `data.youtube.logging.enable_detailed_logging` | boolean | Whether to enable detailed logging |
| `data.youtube.logging.log_download_progress` | boolean | Whether to log download progress |
| `data.youtube.logging.progress_log_interval` | number | Progress log interval in seconds |

## Configuration File

The YouTube configuration is loaded from `config/youtube.yaml`. You can modify this file to change the default settings:

```yaml
# YouTube Video Download and Upload Configuration
download:
  max_concurrent_downloads: 3  # 1-10 recommended
  download_timeout: 300
  max_retries: 3
  retry_delay: 5

upload:
  upload_timeout: 600
  max_retries: 3
  retry_delay: 10

quality:
  default_video_quality: "720p"
  default_audio_quality: "best"
  default_format: "mp4"

file_management:
  auto_cleanup: true
  temp_file_retention_hours: 24
  generate_thumbnail: true

logging:
  enable_detailed_logging: true
  log_download_progress: true
  progress_log_interval: 10
```

## Usage Notes

1. **Concurrent Downloads**: The `max_concurrent_downloads` setting controls how many YouTube videos can be downloaded simultaneously. Recommended range is 1-10 based on server resources.

2. **Timeouts**: Download and upload timeouts are in seconds. Adjust based on your network conditions and video sizes.

3. **Retries**: The system will automatically retry failed downloads/uploads based on the retry configuration.

4. **File Management**: Auto-cleanup helps manage disk space by removing temporary files after the specified retention period.

5. **Logging**: Detailed logging helps with debugging but may impact performance with high-volume operations.

## Error Handling

The endpoint returns standard HTTP status codes:

- `200 OK`: Configuration retrieved successfully
- `500 Internal Server Error`: Server error occurred

All errors include a descriptive message in the response body. 