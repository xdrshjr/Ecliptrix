# Timeline Import API Documentation

## Overview

The Timeline Import API provides functionality to import video editing timeline data from JSON format. This allows users to restore, share, or transfer their video editing projects by importing previously exported timeline files. The API supports comprehensive validation, data processing, and seamless integration with the existing timeline system.

## Base URL

```
http://localhost:8000/api/timeline
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Import Timeline from JSON Data

**Endpoint:** `POST /import`

**Description:** Import timeline editing data including tracks, materials, and all editing information from a JSON data structure.

#### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "task_id": "string",
  "import_data": {
    "metadata": {
      "exported_at": "2025-09-10T06:42:07.211Z",
      "version": "1.0.0",
      "task_id": "task-1757486160247",
      "total_duration": 180.79520000000002,
      "track_count": 5,
      "item_count": 14
    },
    "timeline": {
      "current_time": 0.0,
      "total_duration": 180.79520000000002,
      "zoom_level": 1.0,
      "selected_items": ["item1", "item2"],
      "playback_rate": 1.0,
      "is_playing": false,
      "snap_to_grid": true,
      "grid_size": 0.5,
      "scroll_left": 0.0
    },
    "tracks": [
      {
        "id": "video-track-1",
        "name": "Video Track",
        "type": "video",
        "height": 80,
        "is_locked": false,
        "is_muted": false,
        "is_visible": true,
        "volume": 100.0,
        "order": 0,
        "items": [
          {
            "id": "item1",
            "name": "Video Clip 1",
            "type": "video",
            "start_time": 0.0,
            "duration": 30.0,
            "track_id": "video-track-1",
            "color": "#3B82F6",
            "thumbnail_url": "http://example.com/thumb.jpg",
            "material_id": "material1",
            "volume": 0.8,
            "opacity": 1.0,
            "clip_start": 5.0,
            "clip_end": 35.0,
            "original_duration": 60.0,
            "original_material_type": "video"
          }
        ]
      }
    ],
    "materials": [
      {
        "id": "material1",
        "name": "Sample Video",
        "type": "video",
        "format": "mp4",
        "size": 1024000,
        "duration": 60.0,
        "width": 1920,
        "height": 1080,
        "thumbnail_url": "http://example.com/thumb.jpg",
        "url": "http://example.com/video.mp4",
        "created_at": "2025-09-10T06:37:49.340Z",
        "tags": ["sample", "video"],
        "description": "Sample video file"
      }
    ]
  },
  "merge_mode": "replace",
  "preserve_ids": true
}
```

**Parameters:**
- `task_id` (string, required): Unique identifier for the import task
- `import_data` (object, required): Complete timeline data structure to import
- `merge_mode` (string, optional): Import mode - "replace" (default) or "append"
- `preserve_ids` (boolean, optional): Whether to preserve original IDs (default: true)

#### Response

**Success (200):**
```json
{
  "success": true,
  "message": "Timeline imported successfully",
  "validation_result": {
    "is_valid": true,
    "errors": [],
    "warnings": [],
    "metadata": {
      "exported_at": "2025-09-10T06:42:07.211Z",
      "version": "1.0.0",
      "task_id": "task-1757486160247",
      "total_duration": 180.79520000000002,
      "track_count": 5,
      "item_count": 14
    },
    "track_count": 5,
    "item_count": 14,
    "material_count": 6
  },
  "imported_data": {
    "timeline_state": {
      "current_time": 0.0,
      "total_duration": 180.79520000000002,
      "zoom_level": 1.0,
      "selected_items": [],
      "tracks": [...],
      "playback_rate": 1.0,
      "is_playing": false,
      "snap_to_grid": true,
      "grid_size": 0.5,
      "scroll_left": 0.0
    },
    "materials": [...],
    "id_mappings": {
      "old-id-1": "new-id-1",
      "old-id-2": "new-id-2"
    },
    "processing_notes": [
      "Track ID video-track-1 -> track_abc123",
      "Material ID material1 -> material_def456"
    ]
  },
  "statistics": {
    "original_track_count": 5,
    "imported_track_count": 5,
    "original_material_count": 6,
    "imported_material_count": 6,
    "id_mappings_created": 12,
    "processing_notes_count": 12,
    "import_timestamp": "2025-09-10T06:45:30.123Z"
  }
}
```

**Error (400):**
```json
{
  "success": false,
  "message": "Import data validation failed",
  "validation_result": {
    "is_valid": false,
    "errors": [
      "Missing required field: metadata",
      "Track ID duplicate: video-track-1"
    ],
    "warnings": [
      "Version 2.0.0 may not be fully compatible"
    ]
  }
}
```

### 2. Import Timeline from Uploaded File

**Endpoint:** `POST /import/upload`

**Description:** Upload a JSON file containing timeline data and import it directly into the current editing session.

#### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "task_id": "string",
  "file_content": "stringified JSON content",
  "file_name": "timeline_export_task-123_20250910_143000.json",
  "merge_mode": "replace",
  "preserve_ids": false
}
```

**Parameters:**
- `task_id` (string, required): Unique identifier for the import task
- `file_content` (string, required): Complete JSON file content as string
- `file_name` (string, optional): Original filename for logging purposes
- `merge_mode` (string, optional): Import mode - "replace" (default) or "append"
- `preserve_ids` (boolean, optional): Whether to preserve original IDs (default: true)

#### Response

Same as the `/import` endpoint above.

### 3. Validate Import File

**Endpoint:** `POST /validate`

**Description:** Validate a JSON file before importing it, providing detailed information about any issues or warnings.

#### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "task_id": "string",
  "file_content": "stringified JSON content",
  "file_name": "timeline_export_task-123_20250910_143000.json"
}
```

#### Response

**Success (200):**
```json
{
  "success": true,
  "message": "File validation completed",
  "validation_result": {
    "is_valid": true,
    "errors": [],
    "warnings": [
      "Version 1.5.0 may have compatibility issues"
    ],
    "metadata": {
      "exported_at": "2025-09-10T06:42:07.211Z",
      "version": "1.5.0",
      "task_id": "task-1757486160247",
      "total_duration": 180.79520000000002,
      "track_count": 5,
      "item_count": 14
    },
    "track_count": 5,
    "item_count": 14,
    "material_count": 6
  }
}
```

**Error (400):**
```json
{
  "success": true,
  "message": "File validation completed",
  "validation_result": {
    "is_valid": false,
    "errors": [
      "JSON format error: Expecting ',' delimiter",
      "Missing required field: timeline",
      "Track ID duplicate: audio-track-1"
    ],
    "warnings": []
  }
}
```

## Data Models

### Import Request Model
- **task_id**: Unique task identifier
- **import_data**: Complete timeline export data structure
- **merge_mode**: "replace" or "append"
- **preserve_ids**: Boolean flag for ID preservation

### Validation Result Model
- **is_valid**: Boolean validation status
- **errors**: Array of validation errors
- **warnings**: Array of validation warnings
- **metadata**: Export metadata information
- **track_count**: Number of tracks in the file
- **item_count**: Number of timeline items
- **material_count**: Number of materials

### Processed Import Data Model
- **timeline_state**: Processed timeline state
- **materials**: Array of processed materials
- **id_mappings**: Mapping of old IDs to new IDs
- **processing_notes**: Array of processing information

## Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Input data validation failed |
| `JSON_PARSE_ERROR` | Invalid JSON format |
| `MISSING_FIELD` | Required field is missing |
| `DUPLICATE_ID` | Duplicate identifier found |
| `VERSION_INCOMPATIBLE` | Unsupported format version |
| `INTERNAL_ERROR` | Server processing error |

## Usage Examples

### Example 1: Basic File Import

```bash
curl -X POST http://localhost:8000/api/timeline/import/upload \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "import-task-001",
    "file_content": "{\"metadata\":{...},\"timeline\":{...},\"tracks\":[...],\"materials\":[...]}",
    "file_name": "my_project.json",
    "merge_mode": "replace",
    "preserve_ids": false
  }'
```

### Example 2: File Validation

```bash
curl -X POST http://localhost:8000/api/timeline/validate \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "validate-task-001",
    "file_content": "{\"metadata\":{...},\"timeline\":{...}}",
    "file_name": "project_to_validate.json"
  }'
```

### Example 3: Direct Data Import

```bash
curl -X POST http://localhost:8000/api/timeline/import \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "direct-import-001",
    "import_data": {
      "metadata": {...},
      "timeline": {...},
      "tracks": [...],
      "materials": [...]
    },
    "merge_mode": "append",
    "preserve_ids": true
  }'
```

## Best Practices

1. **Always validate files first** using the `/validate` endpoint before importing
2. **Use meaningful task IDs** for better logging and debugging
3. **Consider ID preservation** based on your use case:
   - Use `preserve_ids: true` when importing into a clean timeline
   - Use `preserve_ids: false` when avoiding ID conflicts
4. **Check validation warnings** even for successful validations
5. **Handle errors gracefully** by checking the validation_result in responses
6. **Monitor import statistics** to understand what was imported

## Logging

All import operations are comprehensively logged with the following information:
- Request details (task ID, file size, merge mode)
- Validation results (errors, warnings, statistics)
- Processing steps (ID mappings, data transformations)
- Performance metrics (processing time, memory usage)
- Success/failure status with detailed error information

## Rate Limits

Currently, no rate limits are enforced, but it's recommended to:
- Avoid concurrent imports for the same task ID
- Limit file sizes to reasonable bounds (< 10MB recommended)
- Implement client-side validation for better user experience