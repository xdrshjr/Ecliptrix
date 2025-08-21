# YouTube Concurrent Download Implementation

## Overview

This document describes the implementation of configurable concurrent YouTube video download and upload functionality for the Video Editing system. When users add YouTube videos from the search results to the material library, the system automatically downloads and uploads them to Supabase with configurable concurrency.

## Implementation Summary

### 1. Configuration System

#### Backend Configuration (`config/youtube.yaml`)
```yaml
# YouTube Video Download and Upload Configuration
download:
  max_concurrent_downloads: 3  # Configurable concurrency (1-10 recommended)
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

#### Configuration Models (`app/config.py`)
- `YoutubeDownloadConfig`: Download-specific settings
- `YoutubeUploadConfig`: Upload-specific settings  
- `YoutubeQualityConfig`: Video quality settings
- `YoutubeFileManagementConfig`: File management settings
- `YoutubeLoggingConfig`: Logging configuration
- `YoutubeConfig`: Main YouTube configuration container

### 2. API Endpoints

#### Configuration Endpoint
- **GET** `/api/config` - Returns application configuration including YouTube settings
- **Response includes**: `youtube.download.max_concurrent_downloads` and other settings
- **Documentation**: `docs/apis/config_api.md`

#### Existing Download Endpoint
- **POST** `/api/youtube/download-and-upload` - Downloads and uploads individual videos
- **Used by**: Frontend concurrent download system

### 3. Frontend Implementation

#### Configuration Service (`src/lib/api/config.ts`)
```typescript
// Fetch YouTube configuration from backend
export async function getMaxConcurrentDownloads(): Promise<number>

// Fallback to default value (3) if config fetch fails
```

#### Video Search Hook (`src/components/video/hooks/useVideoSearch.ts`)
- Loads YouTube configuration on initialization
- Uses dynamic `maxConcurrentDownloads` instead of hardcoded value
- Maintains existing concurrent download logic in `downloadVideosInParallel()`

#### API Proxy (`src/app/api/config/route.ts`)
- Next.js API route that proxies backend configuration
- Handles errors and timeouts gracefully
- Returns YouTube configuration to frontend

### 4. Workflow

1. **User Action**: User searches YouTube videos and selects videos to add to material library
2. **Configuration Loading**: Frontend loads YouTube configuration from backend on component initialization
3. **Material Addition**: Selected videos are converted to materials and added to library with "downloading" status
4. **Concurrent Download**: System uses configured `max_concurrent_downloads` to process videos in batches
5. **Individual Processing**: Each video is downloaded via `/api/youtube/download-and-upload` endpoint
6. **Status Updates**: Material status is updated to "completed" or "error" based on results
7. **Supabase Upload**: Videos are automatically uploaded to Supabase as part of the download process

### 5. Key Features

#### Configurable Concurrency
- Default: 3 concurrent downloads
- Configurable via `youtube.yaml`
- Recommended range: 1-10 based on server resources

#### Robust Error Handling
- Automatic retries with configurable delays
- Graceful fallback to default values
- Detailed logging for debugging

#### Batch Processing
- Videos processed in batches based on concurrency limit
- Progress tracking for each batch
- Comprehensive logging of batch operations

#### Status Management
- Real-time status updates for each video
- Progress tracking (downloading → completed/error)
- Material library reflects current download status

#### File Name Sanitization
- Automatic removal of emoji and special characters
- Safe character preservation (letters, numbers, basic punctuation)
- Supabase-compatible file naming
- Prevention of upload errors due to invalid characters

### 6. Configuration Management

#### Modifying Concurrency
1. Edit `backend-services/basic-service/config/youtube.yaml`
2. Change `download.max_concurrent_downloads` value
3. Restart backend service (configuration is loaded on startup)
4. Frontend will automatically use new configuration

#### Monitoring
- Backend logs show configuration loading
- Frontend logs show configuration fetch and usage
- Download progress is logged with batch information

### 7. Files Modified/Created

#### Backend Files
- `config/youtube.yaml` - Configuration file
- `app/config.py` - Added YouTube configuration models
- `app/routers/api_router.py` - Extended config endpoint
- `docs/apis/config_api.md` - API documentation

#### Frontend Files  
- `src/lib/api/config.ts` - Configuration API service
- `src/components/video/hooks/useVideoSearch.ts` - Dynamic configuration usage
- `src/app/api/config/route.ts` - Next.js API proxy

### 8. Logging and Monitoring

#### Backend Logging
- Configuration loading success/failure
- API endpoint access
- YouTube download operations

#### Frontend Logging
- Configuration fetch attempts
- Concurrent download initiation
- Batch processing progress
- Individual video download status

### 9. Error Handling

#### Configuration Errors
- Backend: Graceful fallback to default values if YAML is invalid
- Frontend: Fallback to default concurrency (3) if config fetch fails

#### Download Errors
- Automatic retries with exponential backoff
- Status updates to reflect error state
- Detailed error logging for debugging

### 10. Performance Considerations

#### Concurrency Limits
- Recommended: 3-5 for typical server setups
- Higher values may impact server performance
- Network bandwidth should be considered

#### Resource Management
- Automatic cleanup of temporary files
- Configurable retention periods
- Memory-efficient batch processing

## Usage Example

```typescript
// Frontend usage - automatic configuration loading
const videoSearch = useVideoSearch(taskId, onAddMaterials);

// When user adds YouTube videos:
// 1. Configuration is already loaded (max_concurrent_downloads: 3)
// 2. Videos are processed in batches of 3
// 3. Each video is downloaded and uploaded to Supabase
// 4. Material library is updated with results
```

## Testing

The implementation has been tested with:
- ✅ Configuration loading from YAML file
- ✅ Backend API endpoint returning YouTube config
- ✅ Frontend configuration service with fallback
- ✅ Integration with existing concurrent download logic
- ✅ File name sanitization for emoji and special characters
- ✅ Supabase upload with cleaned file names

## Future Enhancements

1. **Dynamic Configuration**: Allow runtime configuration updates without restart
2. **Advanced Monitoring**: Add metrics for download success rates and performance
3. **Queue Management**: Implement download queue with priority handling
4. **Resource Optimization**: Adaptive concurrency based on system load 