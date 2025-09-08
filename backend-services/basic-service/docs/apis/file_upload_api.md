# File Upload API Documentation

## Overview

The File Upload API provides endpoints for uploading files to RunningHub for use in AI creative workflows. This API supports image, video, and audio file uploads with automatic file type validation.

## Base URL

```
/api/files
```

## RunningHub Integration

This API proxies file upload requests to RunningHub's file upload service at:
- **RunningHub URL**: `https://www.runninghub.cn/task/openapi/upload`
- **Authentication**: API key passed as `apiKey` field in form data

## Endpoints

### 1. Upload File

**POST** `/api/files/upload`

Upload a file to RunningHub for use in workflows.

#### Request

**Content-Type**: `multipart/form-data`

**Form Parameters**:
- `file` (file, required): The file to upload
- `task_id` (string, optional): Task identifier for tracking
- `upload_type` (string, optional): Type of upload for validation (`img`, `video`, `audio`)

#### Supported File Types

**Images** (`upload_type=img`):
- jpg, jpeg, png, gif, bmp, webp

**Videos** (`upload_type=video`):
- mp4, avi, mov, mkv, webm, flv

**Audio** (`upload_type=audio`):
- mp3, wav, flac, aac, m4a, ogg

#### Response

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "filename": "example.jpg",
    "file_url": "https://runninghub.cn/files/example.jpg",
    "file_size": 1024000,
    "content_type": "image/jpeg",
    "task_id": "upload_abc123"
  }
}
```

**Error Responses**:

- **400 Bad Request**: Invalid file type
```json
{
  "success": false,
  "message": "Invalid file type. Allowed types for img: jpg, jpeg, png, gif, bmp, webp"
}
```

- **502 Bad Gateway**: RunningHub API error
```json
{
  "success": false,
  "message": "File upload failed with status 500"
}
```

- **500 Internal Server Error**: Internal server error
```json
{
  "success": false,
  "message": "Failed to upload file: Internal error message"
}
```

### 2. Health Check

**GET** `/api/files/health`

Check the health status of the file upload service.

#### Response

```json
{
  "success": true,
  "message": "File upload service is healthy",
  "data": {
    "service": "file_upload_service",
    "status": "healthy",
    "base_url": "https://www.runninghub.cn",
    "upload_endpoint": "/api/files/upload",
    "api_key_configured": true
  }
}
```

## Usage Examples

### Upload Image File

```bash
curl -X POST "http://localhost:8000/api/files/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@example.jpg" \
  -F "upload_type=img" \
  -F "task_id=my_task_123"
```

### Upload Video File

```bash
curl -X POST "http://localhost:8000/api/files/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@example.mp4" \
  -F "upload_type=video"
```

### JavaScript Example

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('upload_type', 'img');
formData.append('task_id', 'workflow_123');

const response = await fetch('/api/files/upload', {
  method: 'POST',
  body: formData
});

const result = await response.json();
if (result.success) {
  console.log('File uploaded:', result.data.filename);
  console.log('File URL:', result.data.file_url);
}
```

## Integration with Workflows

When a workflow configuration includes upload requirements:
- `needUploadImg: "True"` - Requires image upload
- `needUploadVideo: "True"` - Requires video upload  
- `needUploadAudio: "True"` - Requires audio upload

The frontend will automatically show file upload UI for the required file types. After upload, users can reference the uploaded file by its filename in workflow parameters.

## Error Handling

- All endpoints return structured JSON responses with `success` boolean flag
- Error messages are descriptive and include validation details
- HTTP status codes follow REST conventions
- File type validation is performed before upload
- Comprehensive logging for debugging and monitoring

## Security

- File uploads are proxied through the backend service
- RunningHub API key is managed server-side
- File type validation prevents malicious uploads
- Upload size limits are enforced by the underlying service