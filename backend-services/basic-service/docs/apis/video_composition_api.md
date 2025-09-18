# Video Composition API Documentation

## Overview
The Video Composition API provides functionality to compose videos from timeline data, including video clips, audio tracks, subtitles, and image overlays.

## Base URL
```
POST /api/video/compose
```

## Performance Optimizations

### URL Deduplication (New Feature)
The video composition service now includes intelligent URL deduplication to optimize download performance:

- **Duplicate Detection**: Automatically detects when multiple video items use the same URL
- **Single Download**: Downloads each unique URL only once, regardless of how many video items reference it
- **File Replication**: Creates file copies for video items that share the same URL after the initial download
- **Performance Impact**: Significantly reduces composition time when the same video material is used multiple times
- **Logging**: Detailed logs show URL analysis results and duplicate handling

**Example Scenario**: If a composition uses the same video URL in 5 different timeline positions, the system will:
1. Download the video file only once
2. Create 4 additional file copies for the remaining references
3. Log the deduplication statistics for monitoring

This optimization is particularly beneficial for compositions that reuse video materials across different timeline segments.

## Request Model

### VideoCompositionRequest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| task_id | string | Yes | Task ID for tracking and logging |
| video_items | VideoCompositionItem[] | Yes | List of video items to compose |
| audio_items | AudioCompositionItem[] | No | List of audio items to compose |
| subtitle_items | SubtitleCompositionItem[] | No | List of subtitle items to compose |
| image_items | ImageCompositionItem[] | No | List of image items to compose as overlays |
| total_duration | float | Yes | Total duration of the composition (seconds) |
| aspect_ratio | AspectRatio | No | Output video aspect ratio (default: 16:9) |
| output_resolution | Dict[str, int] | No | Output video resolution (auto-calculated if not provided) |
| output_fps | int | No | Output video frame rate (default: 30) |
| output_format | string | No | Output video format (default: mp4) |

### VideoCompositionItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the timeline item |
| name | string | Yes | Display name of the video item |
| url | string | Yes | Video URL (local file path or remote URL) |
| start_time | float | Yes | Start time in the timeline (seconds) |
| duration | float | Yes | Duration of the video segment (seconds) |
| track_id | string | Yes | ID of the track this item belongs to |
| volume | float | No | Volume level (0.0 to 2.0, default: 1.0) |
| opacity | float | No | Opacity level (0.0 to 1.0, default: 1.0) |
| clip_start | float | No | Start time within the source video file (seconds) |
| clip_end | float | Yes | End time within the source video file (seconds) |
| original_material_type | string | No | Original material type (video, image, audio, etc.) |
| image_position | ImagePosition | No | Position for image overlay (only for image materials) |

### AudioCompositionItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the timeline item |
| name | string | Yes | Display name of the audio item |
| url | string | Yes | Audio URL (local file path or remote URL) |
| start_time | float | Yes | Start time in the timeline (seconds) |
| duration | float | Yes | Duration of the audio segment (seconds) |
| track_id | string | Yes | ID of the track this item belongs to |
| volume | float | No | Volume level (0.0 to 2.0, default: 1.0) |
| clip_start | float | No | Start time within the source audio file (seconds) |
| clip_end | float | Yes | End time within the source audio file (seconds) |

### SubtitleCompositionItem

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the timeline item |
| name | string | Yes | Display name of the subtitle item |
| text | string | Yes | Subtitle text content |
| start_time | float | Yes | Start time in the timeline (seconds) |
| duration | float | Yes | Duration of the subtitle display (seconds) |
| track_id | string | Yes | ID of the track this item belongs to |
| font_family | string | No | Font family (default, serif, sans-serif, monospace) |
| font_size | int | No | Font size in pixels (8-72, default: 24) |
| font_color | string | No | Font color in hex format (default: #FFFFFF) |
| background_color | string | No | Background color in hex format (optional) |
| position | string | No | Subtitle position (top, center, bottom, upper-3/4, lower-3/4) |

### ImageCompositionItem (New)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique identifier for the timeline item |
| name | string | Yes | Display name of the image item |
| url | string | Yes | Image URL (local file path or remote URL) |
| start_time | float | Yes | Start time in the timeline (seconds) |
| duration | float | Yes | Duration of the image display (seconds) |
| track_id | string | Yes | ID of the track this item belongs to |
| position | ImagePosition | Yes | Position and size of the image overlay |
| opacity | float | No | Opacity level (0.0 to 1.0, default: 1.0) |
| fade_in_duration | float | No | Fade-in duration in seconds (default: 0.0) |
| fade_out_duration | float | No | Fade-out duration in seconds (default: 0.0) |

### ImagePosition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| x | float | Yes | X coordinate (0-1, relative to video width) |
| y | float | Yes | Y coordinate (0-1, relative to video height) |
| width | float | Yes | Width (0-1, relative to video width) |
| height | float | Yes | Height (0-1, relative to video height) |
| z_index | int | No | Layer order for multiple image overlays (default: 10) |

## Response Model

### VideoCompositionResponse

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the operation was successful |
| message | string | Human-readable message about the operation |
| composition_id | string | Unique identifier for the composition job |
| status | string | Composition status (processing, completed, failed) |
| progress | float | Composition progress (0.0 to 1.0) |
| output_file_path | string | Path to the composed video file (when completed) |
| output_file_size | int | Size of the output file in bytes (when completed) |
| processing_time | float | Total processing time in seconds (when completed) |
| error_details | object | Error details if composition failed |

## Example Request

```json
{
  "task_id": "export_video_123",
  "aspect_ratio": "16:9",
  "video_items": [
    {
      "id": "video_1",
      "name": "Main Video",
      "url": "https://example.com/video1.mp4",
      "start_time": 0.0,
      "duration": 10.0,
      "track_id": "video-track-1",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 0.0,
      "clip_end": 10.0
    }
  ],
  "audio_items": [
    {
      "id": "audio_1",
      "name": "Background Music",
      "url": "https://example.com/audio1.mp3",
      "start_time": 0.0,
      "duration": 10.0,
      "track_id": "audio-track-1",
      "volume": 0.5,
      "clip_start": 0.0,
      "clip_end": 10.0
    }
  ],
  "image_items": [
    {
      "id": "image_1",
      "name": "Logo Overlay",
      "url": "https://example.com/logo.png",
      "start_time": 2.0,
      "duration": 5.0,
      "track_id": "image-track-1",
      "position": {
        "x": 0.8,
        "y": 0.05,
        "width": 0.15,
        "height": 0.15,
        "z_index": 10
      },
      "opacity": 0.8,
      "fade_in_duration": 0.5,
      "fade_out_duration": 0.5
    }
  ],
  "subtitle_items": [
    {
      "id": "subtitle_1",
      "name": "Opening Text",
      "text": "Welcome to our video",
      "start_time": 1.0,
      "duration": 3.0,
      "track_id": "subtitle-track-1",
      "font_family": "default",
      "font_size": 32,
      "font_color": "#FFFFFF",
      "position": "bottom"
    }
  ],
  "total_duration": 10.0,
  "output_fps": 30,
  "output_format": "mp4"
}
```

## Example Response

```json
{
  "success": true,
  "message": "Video composition started successfully",
  "composition_id": "comp_abc123def456",
  "status": "processing",
  "progress": 0.0
}
```

## Image Overlay Features

### Positioning
- Image overlays are positioned using relative coordinates (0-1) for responsive scaling
- X and Y coordinates represent the top-left corner of the image
- Width and height are also relative to the video dimensions
- Z-index controls layering when multiple images overlap

### Timing
- Images can be displayed for any duration within the video timeline
- Start time and duration control when and how long the image appears
- Multiple images can overlap in time for complex compositions

### Effects
- Opacity control for transparency effects
- Fade-in and fade-out animations for smooth transitions
- Images maintain their aspect ratio and can be scaled to fit the specified dimensions

### Supported Formats
- PNG (recommended for images with transparency)
- JPG/JPEG (for photographs)
- GIF (static frames only)
- WebP (where supported)

## Status Endpoints

### Get Composition Status
```
GET /api/video/compose/{composition_id}/status
```

### Download Completed Video
```
GET /api/video/compose/{composition_id}/download
```

## Notes

1. **Performance**: Image overlay processing adds computational overhead. Complex overlays with many images may increase processing time.

2. **File Handling**: Both local file paths and remote URLs are supported for images. Remote images are downloaded and cached during processing.

3. **Resolution**: Image overlays are processed at the output video resolution for optimal quality.

4. **Memory Usage**: Large images or many simultaneous overlays may require additional system memory.

5. **Error Handling**: If an image fails to load or process, the composition continues with remaining items and logs the error. 