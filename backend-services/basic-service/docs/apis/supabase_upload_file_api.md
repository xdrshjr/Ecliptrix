# Supabase File Upload API Documentation

## Overview

The Supabase File Upload API provides endpoints for uploading files and videos to Supabase storage through Next.js proxy routes. These endpoints act as proxies to the backend FastAPI service, ensuring proper deployment compatibility.

## Architecture

```
Frontend → Next.js API Routes → FastAPI Backend → Supabase Storage
```

## Base Configuration

- **Next.js API Routes**: `/api/supabase/upload-file`, `/api/supabase/upload-video`
- **Backend Service**: Configured via `BACKEND_URL` environment variable
- **Authentication**: None (for internal use)
- **File Storage**: Supabase Storage Buckets

## Environment Configuration

### Next.js Frontend (.env.local)
```env
# Backend service URL - used by Next.js API routes to proxy requests
BACKEND_URL=http://localhost:8000

# Frontend API base URL - should be empty to use relative paths
NEXT_PUBLIC_API_BASE_URL=
```

### FastAPI Backend (.env)
```env
# Supabase configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_BUCKET=your_bucket_name
ENVIRONMENT=development
```

## API Endpoints

### 1. Upload File (Generic)

#### POST `/api/supabase/upload-file`

Upload any type of file to Supabase storage.

**Request:**
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Body Parameters**:
  - `file` (File, required): The file to upload
  - `task_id` (string, optional): Task identifier for organization
  - `bucket_path` (string, optional): Custom path within the bucket
  - `segment_id` (string, optional): Segment identifier for organization

**Response:**

Success (200):
```json
{
  "success": true,
  "message": "文件上传成功",
  "file_url": "https://supabase-url/storage/v1/object/public/bucket/path/filename.ext",
  "file_path": "path/filename.ext",
  "file_size": 1024000,
  "upload_time": "2024-01-01T12:00:00Z"
}
```

Error (400/500):
```json
{
  "success": false,
  "message": "Error description",
  "error_code": "ERROR_CODE",
  "details": {
    "additional": "error details"
  }
}
```

**Example Usage:**

```javascript
const formData = new FormData();
formData.append('file', file);
formData.append('task_id', 'task-123');

const response = await fetch('/api/supabase/upload-file', {
  method: 'POST',
  body: formData
});

const result = await response.json();
```

### 2. Upload Video

#### POST `/api/supabase/upload-video`

Upload video files to Supabase storage with additional video processing features.

**Request:**
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Body Parameters**:
  - `file` (File, required): The video file to upload (must be video/* MIME type)
  - `task_id` (string, optional): Task identifier for organization
  - `custom_filename` (string, optional): Custom filename for the uploaded file
  - `generate_thumbnail` (boolean, optional): Whether to generate a thumbnail (default: true)

**Response:**

Success (200):
```json
{
  "success": true,
  "message": "视频上传成功",
  "video_url": "https://supabase-url/storage/v1/object/public/bucket/video/filename.mp4",
  "file_path": "video/filename.mp4",
  "file_size": 10240000,
  "duration": 120.5,
  "width": 1920,
  "height": 1080,
  "thumbnail_url": "https://supabase-url/storage/v1/object/public/bucket/thumbnails/filename.jpg",
  "task_id": "task-123",
  "upload_time": "2024-01-01T12:00:00Z",
  "metadata": {
    "codec": "h264",
    "bitrate": 5000000
  }
}
```

Error (400/500):
```json
{
  "success": false,
  "message": "Error description",
  "error_code": "ERROR_CODE",
  "details": {
    "additional": "error details"
  }
}
```

**Example Usage:**

```javascript
const formData = new FormData();
formData.append('file', videoFile);
formData.append('task_id', 'task-123');
formData.append('generate_thumbnail', 'true');

const response = await fetch('/api/supabase/upload-video', {
  method: 'POST',
  body: formData
});

const result = await response.json();
```

## Error Codes

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `MISSING_FILE` | No file provided in request | 400 |
| `INVALID_FILE_TYPE` | Unsupported file type (video endpoints only) | 400 |
| `BACKEND_ERROR` | Backend service unavailable or error | 500/502/503 |
| `INTERNAL_ERROR` | Internal server error in Next.js proxy | 500 |
| `UPLOAD_FAILED` | File upload to Supabase failed | 500 |
| `NETWORK_ERROR` | Network connectivity issues | 500 |

## File Organization

### Upload Paths

Files are automatically organized in the following structure:

**Generic Files:**
```
files/uploaded/{YYYY}/{MM}/{DD}/[task-{task_id}/]{filename}
```

**Video Files:**
```
video/uploaded/{YYYY}/{MM}/{DD}/[task-{task_id}/]{filename}
thumbnails/{YYYY}/{MM}/{DD}/[task-{task_id}/]{filename}.jpg
```

### Supported File Types

**Generic Upload:**
- All file types supported
- Maximum file size: 50MB (configurable)

**Video Upload:**
- MIME types: `video/*`
- Supported formats: MP4, AVI, MOV, MKV, WebM
- Maximum file size: 500MB (configurable)
- Automatic thumbnail generation

## Logging

All requests and responses are logged with the following information:

**Request Logs:**
- Timestamp
- User agent
- File name, size, and type
- Task ID and other parameters

**Success Logs:**
- Upload completion
- File URLs and metadata
- Processing time

**Error Logs:**
- Error details and codes
- Request parameters
- Backend response status

## Deployment Notes

### Development Environment
- Next.js runs on `http://localhost:3000`
- FastAPI backend runs on `http://localhost:8000`
- Requests flow: Frontend → Next.js API → FastAPI → Supabase

### Production Environment
- Configure `BACKEND_URL` to point to production FastAPI service
- Ensure proper network connectivity between Next.js and FastAPI services
- Use HTTPS for all external communications

### Security Considerations
- File type validation on both frontend and backend
- File size limits enforced
- Proper error handling to prevent information leakage
- Rate limiting recommended for production use

## Testing

### Manual Testing

```bash
# Test file upload
curl -X POST "http://localhost:3000/api/supabase/upload-file" \
  -F "file=@test-file.txt" \
  -F "task_id=test-task"

# Test video upload
curl -X POST "http://localhost:3000/api/supabase/upload-video" \
  -F "file=@test-video.mp4" \
  -F "task_id=test-task" \
  -F "generate_thumbnail=true"
```

### Integration Testing

The backend service includes comprehensive test suites:
- `backend-services/basic-service/tests/test_supabase_router.py`
- `backend-services/basic-service/tests/test_supabase_video_upload.py`

## Troubleshooting

### Common Issues

1. **Backend Service Unavailable**
   - Check `BACKEND_URL` configuration
   - Verify FastAPI service is running
   - Check network connectivity

2. **File Upload Failures**
   - Verify Supabase credentials
   - Check file size limits
   - Validate file types

3. **Timeout Errors**
   - Increase timeout values for large files
   - Check network stability
   - Monitor server resources

### Debug Logging

Enable debug logging by setting log levels:

```env
# Next.js
NODE_ENV=development

# FastAPI Backend
LOG_LEVEL=DEBUG
``` 